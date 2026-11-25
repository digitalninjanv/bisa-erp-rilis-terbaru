// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, cashMovements, cashSessions, idempotencyKeys, journalEntries, partyPayments, paymentMethods, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { d, toDb, type MoneyInput } from "@/lib/money";
import { getAccountId, getAccountMap, listCashBankIds, postJournal, reverseJournalEntry } from "@/server/accounting";
import { resolvePaymentFee } from "@/server/payment-fees";
import { writeAudit } from "@/server/audit";
import {
  assertOriginCreditVoidable,
  consumePartyCredit,
  createPartyCredit,
  resolvePartyCreditForUse,
  restorePartyCreditUsage,
  setPartyCreditJournal,
  voidOriginPartyCredit,
} from "@/server/party-credits";
import { nextDocumentNumber } from "@/server/sequences";
import { getOpenCashSession } from "./sessions";

export async function payReceivable(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    saleId: string;
    date: string;
    amount: string | number;
    /** Akun penerimaan kas/bank/QRIS — wajib kecuali creditId diisi. */
    accountId?: string;
    /**
     * A-21 (R3-02): sumber dana kredit pelanggan — dokumen kredit
     * pihak milik pelanggan penjualan ini. Pembayaran tanpa jurnal
     * kas: Dr Kredit Pelanggan (2300) / Cr Piutang.
     */
    creditId?: string;
    /**
     * A-21 Tahap R3-A (R3-01): fee/MDR final penerimaan ini. Kosong =
     * bawaan konfigurasi metode pemilik akun penerimaan; terisi =
     * keputusan pengguna di form. Fee dipotong dari yang masuk
     * (model terpotong): hak pelanggan tetap sebesar bruto.
     */
    fee?: MoneyInput;
    notes?: string;
    /** Nomor referensi/bukti penerimaan (R3-08, migrasi 0048). */
    reference?: string;
    // POS1-05: kunci idempotensi per permintaan dari klien/aksi —
    // setara checkout (POS-IDEM-01). Tanpa kunci, domain menerapkan
    // dedupe jendela pendek untuk panggilan yang persis identik.
    idempotencyKey?: string;
    /** POS: cash receipt must enter an open drawer session. */
    requireCashSession?: boolean;
  },
): Promise<{
  number: string;
  warnings: string[];
  creditNumber?: string;
  creditAmount?: string;
}> {
  // POS1-05 (klaim kunci): pola yang sama dengan checkout — klaim
  // dicatat dalam transaksi yang sama dengan pembayarannya, jadi
  // pembayaran yang gagal melepaskan klaimnya, dan pengiriman ulang
  // (klik ganda / retry jaringan) mengembalikan hasil pertama alih-alih
  // mencatat penerimaan kedua. Klaim yang menang dalam balapan commit
  // membuat yang kalah membaca hasil pemenang di sini.
  const findPaymentClaim = async () => {
    if (!input.idempotencyKey) return undefined;
    const [row] = await tx
      .select({ resultRef: idempotencyKeys.resultRef })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.companyId, input.companyId),
          eq(idempotencyKeys.key, input.idempotencyKey),
          eq(idempotencyKeys.scope, "pos.ar_payment"),
        ),
      )
      .limit(1);
    return row;
  };
  if (input.idempotencyKey) {
    const prior = await findPaymentClaim();
    if (prior?.resultRef) {
      return { number: prior.resultRef, warnings: [] as string[] };
    }
    const [claim] = await tx
      .insert(idempotencyKeys)
      .values({ companyId: input.companyId, key: input.idempotencyKey, scope: "pos.ar_payment" })
      .onConflictDoNothing({ target: [idempotencyKeys.companyId, idempotencyKeys.scope, idempotencyKeys.key] })
      .returning({ id: idempotencyKeys.id });
    if (!claim) {
      const winner = await findPaymentClaim();
      if (winner?.resultRef) {
        return { number: winner.resultRef, warnings: [] as string[] };
      }
      throw new AppError("CONFLICT", "Pembayaran dengan kunci yang sama sedang diproses. Coba lagi sebentar.");
    }
  }

  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, input.saleId)))
    .limit(1)
    .for("update");
  if (!sale) throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.");

  // POS1-05 (dedupe jendela, jalur tanpa kunci): panggilan yang PERSIS
  // identik — penjualan, jumlah, akun, tanggal, dan pelaku yang sama —
  // dalam 60 detik terakhir adalah pengiriman ulang dari penerimaan
  // yang sama, bukan penerimaan kedua; kembalikan pembayaran pertama.
  // Pembayaran kedua yang sungguh berbeda (jumlah/akun/tanggal lain,
  // atau di luar jendela) tetap tercatat normal. Pemeriksaan berjalan
  // di bawah kunci baris penjualan di atas, jadi dua pengiriman
  // bersamaan terserialisasi: yang kedua melihat baris yang pertama.
  if (!input.idempotencyKey && !input.creditId && input.accountId) {
    const [duplicate] = await tx
      .select({ number: partyPayments.number })
      .from(partyPayments)
      .where(
        and(
          eq(partyPayments.companyId, input.companyId),
          eq(partyPayments.saleId, sale.id),
          eq(partyPayments.type, "receivable"),
          eq(partyPayments.status, "posted"),
          eq(partyPayments.amount, toDb(d(input.amount))),
          eq(partyPayments.accountId, input.accountId),
          eq(partyPayments.date, input.date),
          eq(partyPayments.createdBy, input.userId),
          sql`${partyPayments.createdAt} > now() - interval '60 seconds'`,
        ),
      )
      .limit(1);
    if (duplicate) {
      return { number: duplicate.number, warnings: [] as string[] };
    }
  }
  // FIX-P1 (AK3-01/AK4-03): hanya penjualan berstatus completed yang
  // dapat menerima pembayaran piutang. Sebelumnya penjualan yang sudah
  // di-void atau diretur penuh masih bisa "dibayar" — menjurnal
  // Dr Kas / Cr Piutang untuk dokumen yang sudah tidak ada.
  if (sale.status !== "completed") {
    throw new AppError(
      "INVALID_STATE",
      sale.status === "void"
        ? "Transaksi sudah dibatalkan (void) sehingga tidak dapat menerima pembayaran piutang."
        : "Hanya penjualan selesai yang dapat menerima pembayaran piutang.",
    );
  }
  if (sale.paymentStatus === "paid") throw new AppError("INVALID_STATE", "Piutang sudah lunas.");
  // POS1-12: penerimaan tidak boleh bertanggal sebelum penjualan yang
  // dilunasinya — jurnal penerimaan yang mendahului jurnal penjualan
  // membuat arus kas & aging berbasis tanggal dokumen tidak kronologis.
  if (input.date < sale.date) {
    throw new AppError(
      "VALIDATION",
      `Tanggal pembayaran ${input.date} lebih awal dari tanggal penjualan ${sale.date}. Pembayaran piutang tidak dapat mendahului penjualannya.`,
    );
  }
  const outstanding = d(sale.total).minus(d(sale.paidTotal));
  const amount = d(input.amount);
  if (amount.lte(0)) throw new AppError("VALIDATION", "Jumlah pembayaran harus lebih dari nol.");
  // Baris party_payments wajib bertag pihak (party_id NOT NULL) —
  // penjualan tanpa pelanggan tidak punya rumah subledger pembayaran.
  // Penjualan tempo selalu menangkap pelanggan (D-19), jadi keadaan
  // ini hanya mungkin dari data yang diubah di luar jalur domain;
  // sebelumnya sisipan mentahnya gagal sebagai error basis data.
  if (!sale.customerId) {
    throw new AppError(
      "VALIDATION",
      "Penjualan tanpa pelanggan tidak dapat menerima pembayaran piutang.",
    );
  }
  const customerId = sale.customerId;

  // A-21 (R3-02): penerimaan tunai boleh melebihi sisa — kelebihannya
  // menjadi kredit pelanggan (dokumen kredit pihak). Sumber dana
  // kredit sebaliknya dibatasi sisa piutang & sisa kreditnya, dan
  // tidak melewati validasi saluran POS-PAY-01 (akunnya akun kredit
  // terpeta, bukan akun penerimaan).
  const map = await getAccountMap(tx, input.companyId);
  let fundingAccountId: string;
  let credit: Awaited<ReturnType<typeof resolvePartyCreditForUse>>["credit"] | null = null;
  let receivingAccount: { cashBankKind: string | null } | null = null;
  if (input.creditId) {
    const resolved = await resolvePartyCreditForUse(tx, {
      companyId: input.companyId,
      creditId: input.creditId,
      partyType: "customer",
      partyId: customerId,
      amount,
    });
    credit = resolved.credit;
    fundingAccountId = resolved.accountId;
    if (amount.gt(outstanding)) {
      throw new AppError("VALIDATION", `Pembayaran melebihi sisa piutang ${outstanding.toFixed(0)}.`);
    }
  } else {
    if (!input.accountId) {
      throw new AppError("VALIDATION", "Pilih akun penerimaan pembayaran.");
    }
    // POS-PAY-01: the receiving account comes from the client, so the domain
    // must not trust it — same pattern as R-1 for goods receipts. The account
    // must exist in this company, be postable & active, and be a real receipt
    // channel: an active payment method's account, or a mapped cash/bank/qris
    // account. Credit-type methods are excluded on purpose: their account is
    // the receivable itself, so "paying" into it would book a Dr/Cr receivable
    // pair that nets to nothing while marking the sale paid.
    const [account] = await tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        cashBankKind: accounts.cashBankKind,
        isPostable: accounts.isPostable,
        isActive: accounts.isActive,
      })
      .from(accounts)
      .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, input.accountId)))
      .limit(1);
    if (!account) {
      throw new AppError("VALIDATION", "Akun penerimaan tidak ditemukan di perusahaan ini.");
    }
    if (!account.isPostable || !account.isActive) {
      throw new AppError(
        "VALIDATION",
        `Akun penerimaan ${account.code} — ${account.name} tidak dapat dipakai: akun harus aktif dan dapat diposting.`,
      );
    }
    const allowedReceiptAccounts = new Set<string>();
    const methodRows = await tx
      .select({ accountId: paymentMethods.accountId, type: paymentMethods.type })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, input.companyId), eq(paymentMethods.isActive, true)));
    for (const method of methodRows) {
      if (method.accountId && method.type !== "credit") allowedReceiptAccounts.add(method.accountId);
    }
    // A-27 B2: sisi kas/bank dari gabungan ini kini himpunan KELAS
    // (listCashBankIds); sisi metode pembayaran aktif dipertahankan.
    for (const id of await listCashBankIds(tx, input.companyId)) {
      allowedReceiptAccounts.add(id);
    }
    if (!allowedReceiptAccounts.has(input.accountId)) {
      throw new AppError(
        "VALIDATION",
        `Akun penerimaan ${account.code} — ${account.name} bukan akun metode pembayaran aktif atau akun berkelas kas/bank/kliring untuk perusahaan ini.`,
      );
    }
    fundingAccountId = input.accountId;
    receivingAccount = account;
  }
  // A-21 Tahap R3-A (R3-01): fee dihitung dari BRUTO yang diterima —
  // kelebihan bayar (R3-B) dihitung dari porsi teralokasi bruto, fee
  // bukan bagian alokasi dan tidak mengurangi kredit pelanggan.
  // Pembayaran bersumber kredit tidak punya mutasi bank: fee apa pun
  // di atasnya ditolak.
  let fee = d(0);
  if (credit) {
    if (input.fee !== undefined && input.fee !== null && input.fee !== "" && d(input.fee).gt(0)) {
      throw new AppError("VALIDATION", "Pembayaran dari kredit pelanggan tidak dikenai fee bank.");
    }
  } else {
    const resolved = await resolvePaymentFee(tx, input.companyId, {
      accountId: fundingAccountId,
      base: amount,
      explicitFee: input.fee,
    });
    fee = resolved.fee;
    if (fee.gte(amount)) {
      throw new AppError("VALIDATION", "Fee tidak boleh melebihi nominal penerimaan (yang masuk menjadi negatif).");
    }
    if (fee.gt(0) && !map.bank_fee) {
      throw new AppError(
        "VALIDATION",
        'Akun untuk "bank_fee" belum dipetakan di Pengaturan, jadi fee penerimaan tidak dapat dijurnal.',
      );
    }
  }
  const applied = credit ? amount : amount.gt(outstanding) ? outstanding : amount;
  const excess = amount.minus(applied);
  const creditAccountId = excess.gt(0)
    ? await getAccountId(tx, input.companyId, "customer_credit")
    : null;

  const number = await nextDocumentNumber(tx, input.companyId, "PAYMENT", input.date);
  const [payment] = await tx
    .insert(partyPayments)
    .values({
      companyId: input.companyId,
      type: "receivable",
      partyType: "customer",
      partyId: customerId,
      saleId: sale.id,
      number,
      date: input.date,
      // Hanya porsi teralokasi — kelebihan hidup di dokumen kredit
      // (invariant Σ pembayaran == terbayar dokumen untuk void).
      amount: toDb(applied),
      feeAmount: toDb(fee),
      accountId: fundingAccountId,
      creditId: credit?.id ?? null,
      notes: input.notes ?? null,
      reference: input.reference?.trim() || null,
      createdBy: input.userId,
    })
    .returning({ id: partyPayments.id });

  // POS-002: Catat mutasi kas ke sesi laci kasir yang sedang aktif jika penerimaan berupa kas
  if (!credit && (receivingAccount?.cashBankKind === "cash" || fundingAccountId === map.cash)) {
    const [session] = await tx.select({ id: cashSessions.id }).from(cashSessions)
      .where(and(eq(cashSessions.companyId, input.companyId), eq(cashSessions.userId, input.userId), eq(cashSessions.status, "open")))
      .limit(1).for("update");
    if (!session) {
      if (input.requireCashSession) {
        throw new AppError(
          "VALIDATION",
          "Penerimaan piutang tunai dari POS memerlukan sesi kas terbuka. Buka sesi kas terlebih dahulu agar uang masuk ke laci yang benar.",
        );
      }
    } else {
      await tx.insert(cashMovements).values({
      companyId: input.companyId,
      sessionId: session.id,
      // Penerimaan piutang adalah arus kas masuk laci, tetapi BUKAN
      // penjualan POS. Tipe terpisah menjaga laporan sesi tidak
      // mencampur koleksi piutang dengan omzet kasir.
      type: "receivable",
      amount: toDb(amount),
      referenceType: "payment",
      referenceId: payment.id,
      notes: `Penerimaan piutang ${sale.number} (${number})`,
      createdBy: input.userId,
      });
    }
  }

  const customerParty = { partyType: "customer", partyId: customerId } as const;
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Pembayaran piutang ${sale.number}`,
    sourceType: "payment",
    sourceId: sale.id,
    createdBy: input.userId,
    idempotencyKey: `ar:${sale.id}:${number}`,
    lines: credit
      ? [
          {
            accountId: fundingAccountId,
            debit: applied,
            description: "Kredit pelanggan terpakai",
            ...customerParty,
          },
          {
            accountId: map.receivable,
            credit: applied,
            description: "Piutang berkurang",
            ...customerParty,
          },
        ]
      : [
          // Model terpotong (R3-01): yang masuk akun adalah neto
          // sesudah fee; fee mendebit beban fee terpetakan.
          { accountId: fundingAccountId, debit: amount.minus(fee), description: "Penerimaan piutang" },
          ...(fee.gt(0)
            ? [
                {
                  accountId: map.bank_fee,
                  debit: fee,
                  description: "Biaya (fee/MDR) metode pembayaran",
                },
              ]
            : []),
          {
            accountId: map.receivable,
            credit: applied,
            description: "Piutang berkurang",
            ...customerParty,
          },
          ...(creditAccountId
            ? [
                {
                  accountId: creditAccountId,
                  credit: excess,
                  description: "Kelebihan bayar menjadi kredit pelanggan",
                  ...customerParty,
                },
              ]
            : []),
        ],
  });

  const newPaid = d(sale.paidTotal).plus(applied);
  await tx
    .update(sales)
    .set({
      paidTotal: toDb(newPaid),
      paymentStatus: newPaid.gte(d(sale.total)) ? "paid" : "partial",
    })
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, sale.id)));

  let creditNumber: string | undefined;
  if (excess.gt(0)) {
    const created = await createPartyCredit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      partyType: "customer",
      partyId: customerId,
      date: input.date,
      amount: excess,
      originPaymentId: payment.id,
      originLabel: `Kelebihan pembayaran piutang ${sale.number} (${number})`,
      notes: input.notes ?? null,
    });
    await setPartyCreditJournal(tx, input.companyId, created.id, journal.id);
    creditNumber = created.number;
  }
  if (credit) {
    await consumePartyCredit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      credit,
      amount: applied,
    });
  }

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "ar.payment",
    entityType: "sale",
    entityId: sale.id,
    after: {
      amount: toDb(amount),
      number,
      ...(fee.gt(0) ? { feeAmount: toDb(fee) } : {}),
      ...(creditNumber ? { creditNumber, creditAmount: toDb(excess) } : {}),
      ...(credit ? { creditUsed: credit.number } : {}),
    },
  });

  // POS1-05: lengkapi klaim kunci dengan nomor pembayaran yang
  // terbentuk, agar pengiriman ulang kunci yang sama mengembalikan
  // hasil pertama ini (lihat klaim di awal fungsi).
  if (input.idempotencyKey) {
    await tx
      .update(idempotencyKeys)
      .set({ resultRef: number })
      .where(
        and(
          eq(idempotencyKeys.companyId, input.companyId),
          eq(idempotencyKeys.key, input.idempotencyKey),
          eq(idempotencyKeys.scope, "pos.ar_payment"),
        ),
      );
  }

  // FIX-R2 Tahap 3 (RV2-01): bentuk hasil seragam dengan jalur
  // pembayaran lain — jurnal penerimaan mendebit kas sehingga
  // peringatan penjaga praktis selalu kosong di jalur ini.
  return {
    number,
    warnings: journal.warnings,
    ...(creditNumber ? { creditNumber, creditAmount: toDb(excess) } : {}),
  };
}

export async function voidReceivablePayment(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    paymentId: string;
    reason: string;
    requireCashSession?: boolean;
  },
) {
  const [payment] = await tx
    .select()
    .from(partyPayments)
    .where(and(eq(partyPayments.companyId, input.companyId), eq(partyPayments.id, input.paymentId)))
    .limit(1)
    .for("update");
  if (!payment) throw new AppError("NOT_FOUND", "Penerimaan pembayaran tidak ditemukan.");
  if (payment.type !== "receivable" || !payment.saleId) {
    throw new AppError("VALIDATION", "Pembayaran ini bukan penerimaan piutang penjualan.");
  }
  if (payment.status === "void") throw new AppError("INVALID_STATE", "Penerimaan sudah dibatalkan.");

  await assertOriginCreditVoidable(tx, input.companyId, payment.id);

  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, payment.saleId)))
    .limit(1)
    .for("update");
  if (!sale) throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.");

  const [entry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.idempotencyKey, `ar:${sale.id}:${payment.number}`),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (!entry) {
    throw new AppError(
      "VALIDATION",
      `Jurnal penerimaan ${payment.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan penerimaan dibatalkan agar daftar pembayaran dan buku besar tetap selaras; periksa jurnal penerimaan ini terlebih dahulu.`,
    );
  }
  const { reversal } = await reverseJournalEntry(tx, {
    companyId: input.companyId,
    entryId: entry.id,
    date: todayISO(),
    description: `Pembatalan penerimaan piutang ${payment.number} — ${input.reason}`,
    createdBy: input.userId,
  });

  await tx
    .update(partyPayments)
    .set({ status: "void" })
    .where(and(eq(partyPayments.companyId, input.companyId), eq(partyPayments.id, payment.id)));

  await restorePartyCreditUsage(tx, { companyId: input.companyId, userId: input.userId, payment });
  await voidOriginPartyCredit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    paymentId: payment.id,
  });

  const diff = d(sale.paidTotal).minus(d(payment.amount));
  const paid = diff.gt(0) ? diff : d(0);
  await tx
    .update(sales)
    .set({
      paidTotal: toDb(paid),
      paymentStatus: paid.gte(d(sale.total)) ? "paid" : paid.gt(0) ? "partial" : "unpaid",
    })
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, sale.id)));

  const [existingCashMovement] = await tx
    .select()
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.companyId, input.companyId),
        eq(cashMovements.referenceType, "payment"),
        eq(cashMovements.referenceId, payment.id),
      ),
    )
    .limit(1);
  if (existingCashMovement) {
    const processorSession = await getOpenCashSession(tx, input.companyId, input.userId);
    if (!processorSession) {
      if (input.requireCashSession) {
        throw new AppError(
          "INVALID_STATE",
          "Pembatalan penerimaan piutang tunai dari POS memerlukan sesi kas terbuka agar uang keluar dari laci tercatat. Buka sesi kas lalu ulangi pembatalan.",
        );
      }
    } else {
      await tx.insert(cashMovements).values({
        companyId: input.companyId,
        sessionId: processorSession.id,
        type: "refund",
        amount: toDb(d(existingCashMovement.amount).neg()),
        referenceType: "payment_void",
        referenceId: payment.id,
        notes: `Pembatalan penerimaan piutang ${payment.number} — ${input.reason}`,
        createdBy: input.userId,
      });
    }
  }

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "ar.payment.void",
    entityType: "party_payment",
    entityId: payment.id,
    after: {
      number: payment.number,
      saleNumber: sale.number,
      amount: payment.amount,
      reason: input.reason,
      reversalNumber: reversal.number,
    },
  });

  return { id: payment.id };
}

/** Constraint name of a Postgres unique violation in the error chain
 * (drizzle wraps the postgres.js error), or null when it is not one. */
