import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { expenses, journalEntries, partyPayments, stockReceipts } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { d, toDb, type MoneyInput } from "@/lib/money";
import { getAccountId, getAccountMap, postJournal, reverseJournalEntry } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { assertCashLikeAccount } from "@/server/employee-advances";
import {
  resolveWithholding,
  type ResolvedWithholding,
  type WithholdingInput,
} from "@/server/payment-deductions";
import { resolvePaymentFee } from "@/server/payment-fees";
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
import { sumReturnAllocations } from "@/server/supplier-returns";

/**
 * A-21 Tahap R3-A (R3-01): fee pembayaran keluar — model di atas
 * nominal (pola createBankTransfer): pemasok menerima bruto penuh,
 * bank membebankan fee tambahan dari rekening perusahaan. Fee final
 * dari konfigurasi metode pemilik akun sumber (nilai awal) atau
 * keputusan eksplisit pengguna; pembayaran bersumber kredit tidak
 * punya mutasi bank sehingga fee di atasnya ditolak.
 */
export async function resolveOutgoingFee(
  tx: Tx,
  companyId: string,
  opts: {
    creditFunded: boolean;
    accountId: string;
    amount: ReturnType<typeof d>;
    explicitFee?: MoneyInput;
    map: Record<string, string>;
  },
) {
  if (opts.creditFunded) {
    if (
      opts.explicitFee !== undefined &&
      opts.explicitFee !== null &&
      opts.explicitFee !== "" &&
      d(opts.explicitFee).gt(0)
    ) {
      throw new AppError("VALIDATION", "Pembayaran dari kredit pemasok tidak dikenai fee bank.");
    }
    return d(0);
  }
  const resolved = await resolvePaymentFee(tx, companyId, {
    accountId: opts.accountId,
    base: opts.amount,
    explicitFee: opts.explicitFee,
  });
  if (resolved.fee.gt(0) && !opts.map.bank_fee) {
    throw new AppError(
      "VALIDATION",
      'Akun untuk "bank_fee" belum dipetakan di Pengaturan, jadi fee pembayaran tidak dapat dijurnal.',
    );
  }
  return resolved.fee;
}

/**
 * A-21 Tahap R3-A (R3-06): potongan pajak pembayaran keluar —
 * divalidasi payment-deductions.resolveWithholding (saklar per
 * perusahaan + jenis + plafon nominal). Pembayaran bersumber kredit
 * tidak punya kas keluar yang bisa dipotong: potongan di atasnya
 * ditolak.
 */
export async function resolveOutgoingWithholding(
  tx: Tx,
  companyId: string,
  opts: {
    creditFunded: boolean;
    input?: WithholdingInput;
    grossAmount: ReturnType<typeof d>;
  },
): Promise<ResolvedWithholding | null> {
  if (opts.creditFunded) {
    if (opts.input && d(opts.input.amount).gt(0)) {
      throw new AppError(
        "VALIDATION",
        "Pembayaran dari kredit pemasok tidak dapat dipotong pajak — tidak ada kas keluar pada pembayaran ini.",
      );
    }
    return null;
  }
  return resolveWithholding(tx, companyId, opts.input, opts.grossAmount);
}

/** Nominal pembayaran utang harus positif — penjaga pertama kedua jalur. */
function parsePaymentAmount(amount: MoneyInput) {
  const value = d(amount);
  if (!value.isFinite() || value.lte(0)) {
    throw new AppError("VALIDATION", "Nominal pembayaran harus lebih dari nol.");
  }
  return value;
}

/**
 * Rujukan dokumen utang untuk inti pembayaran bersama: yang berbeda
 * antar jenis dokumen (penerimaan barang vs beban terutang) dinyatakan
 * di sini oleh pembungkusnya — tautan baris pembayaran, deskripsi &
 * awalan kunci idempotensi jurnal, label asal kredit, entitas audit,
 * dan cara menerapkan total terbayar baru (status dokumen memang
 * berbeda rumusnya per jenis dokumen).
 */
type PayableDocRef = {
  receiptId?: string;
  expenseId?: string;
  docId: string;
  /** Sisa utang dokumen (penerimaan: neto alokasi retur pemasok). */
  outstanding: ReturnType<typeof d>;
  journalDescription: string;
  /** "ap" penerimaan / "ap-expense" beban — voidPayablePayment menargetkan jurnal pembayaran lewat awalan ini. */
  idempotencyPrefix: "ap" | "ap-expense";
  creditOriginLabel: (paymentNumber: string) => string;
  auditEntityType: "stock_receipt" | "expense";
  applyPaid: (paidTotal: ReturnType<typeof d>) => Promise<void>;
};

/**
 * A-26 Q8 (P-04/D-02): inti tunggal pembayaran dokumen utang.
 * Sebelum tahap ini payPayableDocument & payExpensePayable adalah dua
 * salinan pola yang sama (±225 baris klon — D-02 audit sentralisasi);
 * kini kerangka bersama hidup di sini SATU kali: resolusi sumber dana
 * (tunai/bank atau kredit pemasok), fee, withholding, satu baris
 * party_payments, jurnal Dr Utang / Cr kas-bank bertag pemasok,
 * penerapan terbayar ke dokumen induk, kredit pemasok dari kelebihan
 * bayar, konsumsi kredit, dan audit. Yang tetap di pembungkus publik:
 * pemuatan & penjaga khas dokumennya (status, tanggal, jenis utang)
 * dan PayableDocRef di atas. Perilaku dikunci test karakterisasi
 * tests/integration/a26-q8-payables-parity.test.ts.
 */
async function executePayablePayment(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    date: string;
    amount: ReturnType<typeof d>;
    accountId?: string;
    fee?: MoneyInput;
    withholding?: WithholdingInput;
    notes?: string;
    reference?: string;
    creditId?: string;
    supplierId: string;
    alreadyPaid: ReturnType<typeof d>;
    doc: PayableDocRef;
  },
) {
  const { companyId, userId, supplierId, doc } = input;
  const amount = input.amount;
  // A-21 (R3-02): pembayaran tunai boleh melebihi sisa — kelebihannya
  // menjadi kredit pemasok (dokumen kredit pihak), bukan penolakan.
  // Sumber dana kredit sebaliknya tidak pernah melahirkan kredit
  // baru: nominalnya dibatasi sisa utang DAN sisa kredit dokumennya.
  const map = await getAccountMap(tx, companyId);
  let fundingAccountId: string;
  let credit: Awaited<ReturnType<typeof resolvePartyCreditForUse>>["credit"] | null = null;
  if (input.creditId) {
    const resolved = await resolvePartyCreditForUse(tx, {
      companyId,
      creditId: input.creditId,
      partyType: "supplier",
      partyId: supplierId,
      amount,
    });
    credit = resolved.credit;
    fundingAccountId = resolved.accountId;
    if (amount.gt(doc.outstanding)) {
      throw new AppError("VALIDATION", `Pembayaran melebihi sisa utang ${doc.outstanding.toFixed(0)}.`);
    }
  } else {
    if (!input.accountId) {
      throw new AppError("VALIDATION", "Pilih akun kas/bank sumber pembayaran.");
    }
    // A-21 (R3-03): akun saluran pembayaran harus akun kas/bank/QRIS
    // terpetakan — penjaga domain yang sama seperti kasbon/pinjaman/
    // klaim; tanpa ini pembayaran utang dapat dikreditkan ke akun apa
    // pun (mis. akun pendapatan) bila aksi dipanggil di luar pilihan UI.
    await assertCashLikeAccount(tx, companyId, input.accountId);
    fundingAccountId = input.accountId;
  }
  const applied = credit ? amount : amount.gt(doc.outstanding) ? doc.outstanding : amount;
  const excess = amount.minus(applied);
  // Fee dihitung dari nominal bruto pembayaran (satu transfer keluar),
  // BUKAN dari porsi teralokasi — kelebihan bayar tidak mengubah fee.
  const fee = await resolveOutgoingFee(tx, companyId, {
    creditFunded: Boolean(credit),
    accountId: fundingAccountId,
    amount,
    explicitFee: input.fee,
    map,
  });
  const withholding = await resolveOutgoingWithholding(tx, companyId, {
    creditFunded: Boolean(credit),
    input: input.withholding,
    grossAmount: amount,
  });

  const number = await nextDocumentNumber(tx, companyId, "PAYMENT", input.date);
  const [payment] = await tx
    .insert(partyPayments)
    .values({
      companyId,
      type: "payable",
      partyType: "supplier",
      partyId: supplierId,
      ...(doc.receiptId ? { receiptId: doc.receiptId } : {}),
      ...(doc.expenseId ? { expenseId: doc.expenseId } : {}),
      number,
      date: input.date,
      // Hanya porsi teralokasi yang tercatat sebagai pembayaran
      // dokumen — kelebihan hidup di dokumen kredit (invariant
      // Σ pembayaran == terbayar dokumen untuk hitung ulang void).
      amount: toDb(applied),
      feeAmount: toDb(fee),
      withholdingType: withholding?.type ?? null,
      withholdingRate: withholding?.rate ? toDb(withholding.rate) : null,
      withholdingAmount: toDb(withholding?.amount ?? 0),
      accountId: fundingAccountId,
      creditId: credit?.id ?? null,
      notes: input.notes,
      reference: input.reference?.trim() || null,
      createdBy: userId,
    })
    .returning({ id: partyPayments.id });

  const supplierParty = { partyType: "supplier", partyId: supplierId } as const;
  const journal = await postJournal(tx, {
    companyId,
    date: input.date,
    description: doc.journalDescription,
    sourceType: "payment",
    sourceId: doc.docId,
    createdBy: userId,
    idempotencyKey: `${doc.idempotencyPrefix}:${doc.docId}:${number}`,
    lines: credit
      ? [
          {
            accountId: map.payable,
            debit: applied,
            description: "Utang berkurang (kredit pemasok)",
            ...supplierParty,
          },
          {
            accountId: fundingAccountId,
            credit: applied,
            description: "Kredit pemasok terpakai",
            ...supplierParty,
          },
        ]
      : [
          {
            accountId: map.payable,
            debit: applied,
            description: "Utang berkurang",
            ...supplierParty,
          },
          ...(excess.gt(0)
            ? [
                {
                  accountId: await getAccountId(tx, companyId, "supplier_credit"),
                  debit: excess,
                  description: "Kelebihan bayar menjadi kredit pemasok",
                  ...supplierParty,
                },
              ]
            : []),
          ...(fee.gt(0)
            ? [
                {
                  accountId: map.bank_fee,
                  debit: fee,
                  description: "Biaya (fee/MDR) metode pembayaran",
                },
              ]
            : []),
          ...(withholding
            ? [
                {
                  accountId: withholding.accountId,
                  credit: withholding.amount,
                  description: `Potongan ${withholding.label} atas pembayaran`,
                  ...supplierParty,
                },
              ]
            : []),
          {
            accountId: fundingAccountId,
            credit: amount.plus(fee).minus(withholding?.amount ?? 0),
            description: "Kas/bank keluar",
          },
        ],
  });

  await doc.applyPaid(input.alreadyPaid.plus(applied));

  let creditNumber: string | undefined;
  if (excess.gt(0)) {
    const created = await createPartyCredit(tx, {
      companyId,
      userId,
      partyType: "supplier",
      partyId: supplierId,
      date: input.date,
      amount: excess,
      originPaymentId: payment.id,
      originLabel: doc.creditOriginLabel(number),
      notes: input.notes ?? null,
    });
    await setPartyCreditJournal(tx, companyId, created.id, journal.id);
    creditNumber = created.number;
  }
  if (credit) {
    await consumePartyCredit(tx, {
      companyId,
      userId,
      credit,
      amount: applied,
    });
  }

  await writeAudit(tx, {
    companyId,
    userId,
    action: "ap.payment",
    entityType: doc.auditEntityType,
    entityId: doc.docId,
    after: {
      number,
      amount: toDb(amount),
      date: input.date,
      ...(fee.gt(0) ? { feeAmount: toDb(fee) } : {}),
      ...(creditNumber ? { creditNumber, creditAmount: toDb(excess) } : {}),
      ...(credit ? { creditUsed: credit.number } : {}),
    },
  });
  // FIX-R2 Tahap 3 (RV2-01): peringatan penjaga saldo kas/bank (mode warn).
  return {
    number,
    amount: amount.toNumber(),
    date: input.date,
    warnings: journal.warnings,
    ...(creditNumber ? { creditNumber, creditAmount: toDb(excess) } : {}),
  };
}

/**
 * Pembayaran satu dokumen utang pembelian kredit (diekstrak dari
 * payPayableAction agar pembayaran FIFO modal Catat Transaksi A-12
 * memakai mekanisme party_payments yang persis sama, dalam transaksi
 * pemanggil): satu baris party_payments + jurnal Dr Utang / Cr kas-bank
 * bertag pemasok + status dokumen diperbarui. Sisa utang selalu
 * dikurangi alokasi retur pemasok (A-9/D-20), jadi utang yang sudah
 * diselesaikan retur tidak pernah terbayar dua kali.
 */
export async function payPayableDocument(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    receiptId: string;
    date: string;
    amount: MoneyInput;
    /** Akun kas/bank sumber dana — wajib kecuali creditId diisi. */
    accountId?: string;
    /**
     * A-21 Tahap R3-A (R3-01): fee/MDR final pembayaran ini. Kosong =
     * bawaan konfigurasi metode pemilik akun sumber; terisi =
     * keputusan pengguna di form. Fee ditambahkan di atas nominal
     * (pemasok menerima bruto penuh).
     */
    fee?: MoneyInput;
    /**
     * A-21 Tahap R3-A (R3-06): potongan pajak (withholding) pembayaran
     * ini — nominal final diputuskan pengguna, dijurnal ke Utang PPh
     * Dipotong bertag pemasok; kas keluar berkurang sebesar potongan.
     */
    withholding?: WithholdingInput;
    notes?: string;
    /** Nomor referensi/bukti pembayaran (R3-08, migrasi 0048). */
    reference?: string;
    /**
     * A-21 (R3-02): sumber dana kredit pemasok — dokumen kredit pihak
     * yang dipakai melunasi dokumen ini. Bila diisi, pembayaran tanpa
     * jurnal kas: Dr Utang / Cr Kredit Pemasok (1210), dan nominal
     * tidak boleh melebihi sisa utang maupun sisa kredit.
     */
    creditId?: string;
  },
) {
  const amount = parsePaymentAmount(input.amount);

  const [receipt] = await tx
    .select()
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, input.receiptId)))
    .limit(1)
    .for("update");
  if (!receipt) throw new AppError("NOT_FOUND", "Penerimaan barang tidak ditemukan.");
  // FIX-P1 (AK3-02): penerimaan yang sudah di-void TIDAK boleh dibayar.
  // Jurnal utangnya sudah dibalik oleh void, jadi pembayaran yang lolos
  // mengeluarkan uang atas utang yang tidak ada dan membuat GL utang
  // pemasok negatif — sementara dokumennya tidak tampil di daftar utang.
  // Penjaga setara sisi penjualan: payReceivable menolak penjualan
  // non-completed; di sini hanya dokumen posted yang dapat dibayar.
  if (receipt.status === "void") {
    throw new AppError(
      "INVALID_STATE",
      `Penerimaan ${receipt.number} sudah dibatalkan (void) dan tidak dapat dibayar.`,
    );
  }
  if (receipt.status !== "posted") {
    throw new AppError("INVALID_STATE", "Hanya penerimaan berstatus posted yang dapat dibayar.");
  }
  // D-5: only credit purchases carry a payable. Cash purchases are born
  // paid and non-purchase receipts owe nothing, so there is nothing to
  // pay here — and their supplierId may legitimately be null.
  const supplierId = receipt.supplierId;
  if (receipt.source !== "purchase" || receipt.paymentAccountId || !supplierId) {
    throw new AppError(
      "INVALID_STATE",
      "Penerimaan ini bukan utang pembelian kredit, sehingga tidak dapat dibayar dari menu utang.",
    );
  }
  if (receipt.paymentStatus === "paid") throw new AppError("INVALID_STATE", "Utang sudah lunas.");
  // A-21 (R3-15): penjaga simetris POS1-12 di sisi piutang — pembayaran
  // tidak boleh bertanggal sebelum penerimaan yang dilunasinya; jurnal
  // pembayaran yang mendahului jurnal penerimaannya membuat arus kas &
  // aging berbasis tanggal dokumen tidak kronologis. Karena FIFO utang
  // (payPayableFifo) memanggil fungsi ini per dokumen, penjaga di sini
  // menutupi jalur FIFO juga.
  if (input.date < receipt.date) {
    throw new AppError(
      "VALIDATION",
      `Tanggal pembayaran ${input.date} lebih awal dari tanggal penerimaan ${receipt.date}. Pembayaran utang tidak dapat mendahului penerimaan barangnya.`,
    );
  }
  const allocated = await sumReturnAllocations(tx, input.companyId, { receiptId: receipt.id });
  const outstanding = d(receipt.total).minus(d(receipt.paidAmount)).minus(allocated);

  return executePayablePayment(tx, {
    companyId: input.companyId,
    userId: input.userId,
    date: input.date,
    amount,
    accountId: input.accountId,
    fee: input.fee,
    withholding: input.withholding,
    notes: input.notes,
    reference: input.reference,
    creditId: input.creditId,
    supplierId,
    alreadyPaid: d(receipt.paidAmount),
    doc: {
      receiptId: receipt.id,
      docId: receipt.id,
      outstanding,
      journalDescription: `Pembayaran utang ${receipt.number}`,
      idempotencyPrefix: "ap",
      creditOriginLabel: (paymentNumber) =>
        `Kelebihan pembayaran utang ${receipt.number} (${paymentNumber})`,
      auditEntityType: "stock_receipt",
      applyPaid: async (paid) => {
        await tx
          .update(stockReceipts)
          .set({
            paidAmount: toDb(paid),
            paymentStatus: paid.plus(allocated).gte(d(receipt.total)) ? "paid" : "partial",
          })
          .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, receipt.id)));
      },
    },
  });
}

/**
 * A-26 Q4 (K-03): pembatalan pembayaran utang (penerimaan barang atau
 * beban terutang) — dipindah utuh dari voidPayablePaymentAction;
 * lapisan aksi kini hanya auth, parsing, dan revalidasi. Perilaku,
 * urutan langkah, & pesan identik dengan blok transaksi lama.
 */
export async function voidPayablePayment(
  tx: Tx,
  input: { companyId: string; userId: string; paymentId: string; reason: string },
) {
  const [payment] = await tx
    .select()
    .from(partyPayments)
    .where(and(eq(partyPayments.companyId, input.companyId), eq(partyPayments.id, input.paymentId)))
    .limit(1)
    .for("update");
  if (!payment) throw new AppError("NOT_FOUND", "Pembayaran tidak ditemukan.");
  if (payment.type !== "payable" || (!payment.receiptId && !payment.expenseId)) {
    throw new AppError("VALIDATION", "Pembayaran ini bukan pembayaran utang penerimaan barang atau beban terutang.");
  }
  if (payment.status === "void") throw new AppError("INVALID_STATE", "Pembayaran sudah dibatalkan.");

  // A-21 (R3-02): rantai kredit pihak — pembayaran asal yang
  // kreditnya sudah terpakai tidak dapat dibatalkan sebelum
  // pembayaran pemakai kredit dibatalkan lebih dulu.
  await assertOriginCreditVoidable(tx, input.companyId, payment.id);

  // A-21 (R3-11): dokumen induk pembayaran utang bisa penerimaan
  // barang ATAU beban terutang — keduanya memakai mekanisme yang
  // sama persis; yang berbeda hanya tabel induk & awalan kunci
  // idempotensi jurnalnya.
  const isExpense = Boolean(payment.expenseId);
  const docId = (payment.expenseId ?? payment.receiptId)!;
  let receipt: typeof stockReceipts.$inferSelect | undefined;
  let expense: typeof expenses.$inferSelect | undefined;
  if (isExpense) {
    [expense] = await tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, docId)))
      .limit(1)
      .for("update");
    if (!expense) throw new AppError("NOT_FOUND", "Beban tidak ditemukan.");
  } else {
    [receipt] = await tx
      .select()
      .from(stockReceipts)
      .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, docId)))
      .limit(1)
      .for("update");
    if (!receipt) throw new AppError("NOT_FOUND", "Penerimaan barang tidak ditemukan.");
  }
  const docNumber = (expense ?? receipt)!.number;

  // AK-P2-03: jurnal pembayaran terhubung ke dokumen induk
  // (sourceType "payment", sourceId = dokumen), jadi jurnal pembayaran
  // INI ditargetkan lewat idempotency key-nya dan dibalik per entri —
  // reverseSourceJournal per dokumen akan membalik pembayaran pertama
  // saja pada pembayaran sebagian berkali-kali.
  const [entry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(
          journalEntries.idempotencyKey,
          isExpense ? `ap-expense:${docId}:${payment.number}` : `ap:${docId}:${payment.number}`,
        ),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (!entry) {
    throw new AppError(
      "VALIDATION",
      `Jurnal pembayaran ${payment.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan pembayaran dibatalkan agar daftar pembayaran dan buku besar tetap selaras; periksa jurnal pembayaran ini terlebih dahulu.`,
    );
  }
  const { reversal } = await reverseJournalEntry(tx, {
    companyId: input.companyId,
    entryId: entry.id,
    date: todayISO(),
    description: `Pembatalan pembayaran utang ${payment.number} — ${input.reason}`,
    createdBy: input.userId,
  });

  await tx
    .update(partyPayments)
    .set({ status: "void" })
    .where(and(eq(partyPayments.companyId, input.companyId), eq(partyPayments.id, payment.id)));

  // A-21 (R3-02): selaraskan subledger kredit — pemakaian kredit
  // oleh pembayaran ini dipulihkan; kredit yang lahir dari
  // pembayaran ini ikut batal (belum terpakai, per penjaga di atas).
  await restorePartyCreditUsage(tx, { companyId: input.companyId, userId: input.userId, payment });
  await voidOriginPartyCredit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    paymentId: payment.id,
  });

  // Hitung ulang terbayar dari pembayaran non-void saja, supaya sisa
  // utang dan status dokumen induk kembali seperti sebelum pembayaran ini.
  if (isExpense) {
    const [paidRow] = await tx
      .select({ total: sql<string>`coalesce(sum(${partyPayments.amount}), 0)` })
      .from(partyPayments)
      .where(
        and(
          eq(partyPayments.companyId, input.companyId),
          eq(partyPayments.expenseId, docId),
          ne(partyPayments.status, "void"),
        ),
      );
    const paid = d(paidRow?.total ?? "0");
    await tx
      .update(expenses)
      .set({
        paidAmount: toDb(paid),
        paymentStatus: paid.gte(d(expense!.amount)) ? "paid" : paid.gt(0) ? "partial" : "unpaid",
      })
      .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, docId)));
  } else {
    const [paidRow] = await tx
      .select({ total: sql<string>`coalesce(sum(${partyPayments.amount}), 0)` })
      .from(partyPayments)
      .where(
        and(
          eq(partyPayments.companyId, input.companyId),
          eq(partyPayments.receiptId, receipt!.id),
          ne(partyPayments.status, "void"),
        ),
      );
    const paid = d(paidRow?.total ?? "0");
    // A-9 (D-20): return allocations settle alongside cash payments.
    const allocated = await sumReturnAllocations(tx, input.companyId, { receiptId: receipt!.id });
    const settled = paid.plus(allocated);
    await tx
      .update(stockReceipts)
      .set({
        paidAmount: toDb(paid),
        paymentStatus: settled.gte(d(receipt!.total)) ? "paid" : settled.gt(0) ? "partial" : "unpaid",
      })
      .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, receipt!.id)));
  }

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "ap.payment.void",
    entityType: "party_payment",
    entityId: payment.id,
    after: {
      number: payment.number,
      ...(isExpense ? { expenseNumber: docNumber } : { receiptNumber: docNumber }),
      amount: payment.amount,
      reason: input.reason,
      reversalNumber: reversal.number,
    },
  });
}

/**
 * A-21 (R3-11): dokumen beban terutang yang masih terbuka — definisi
 * tunggal yang dipakai daftar utang (reports.listPayables) dan FIFO
 * bayar utang (quick-entry), supaya ketiganya tidak pernah berbeda
 * pendapat tentang utang beban mana yang masih harus dibayar.
 * SENGAJA terpisah dari listSupplierOpenPayableDocs milik retur
 * pemasok: retur hanya boleh menyelesaikan utang barang (penerimaan
 * & saldo awal), tidak pernah utang beban.
 */
export async function listOpenExpensePayables(
  tx: Tx,
  companyId: string,
  supplierId?: string,
) {
  const rows = await tx
    .select({
      id: expenses.id,
      number: expenses.number,
      date: expenses.date,
      total: expenses.amount,
      paidAmount: expenses.paidAmount,
      paymentStatus: expenses.paymentStatus,
      supplierId: expenses.supplierId,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.companyId, companyId),
        eq(expenses.status, "posted"),
        inArray(expenses.paymentStatus, ["unpaid", "partial"]),
        ...(supplierId ? [eq(expenses.supplierId, supplierId)] : []),
      ),
    )
    .orderBy(asc(expenses.date), asc(expenses.createdAt));
  return rows
    .filter((row) => row.supplierId)
    .map((row) => ({
      ...row,
      outstanding: d(row.total).minus(d(row.paidAmount)),
    }))
    .filter((row) => row.outstanding.gt(0));
}

/**
 * A-21 (R3-11): pembayaran satu dokumen beban terutang — cermin
 * payPayableDocument untuk dokumen expenses: satu baris
 * party_payments (expense_id) + jurnal Dr Utang bertag pemasok /
 * Cr kas-bank + status dokumen diperbarui. Semua penjaga disamakan
 * dengan jalur penerimaan: hanya dokumen posted, tanggal tidak
 * mendahului dokumen, nominal tidak melebihi sisa, akun saluran
 * harus kas/bank/QRIS terpeta (R3-03). Kerangka pembayarannya sendiri
 * adalah inti bersama executePayablePayment (A-26 Q8, P-04).
 */
export async function payExpensePayable(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    expenseId: string;
    date: string;
    amount: MoneyInput;
    /** Akun kas/bank sumber dana — wajib kecuali creditId diisi. */
    accountId?: string;
    /** A-21 Tahap R3-A (R3-01): fee/MDR final (lihat payPayableDocument). */
    fee?: MoneyInput;
    /** A-21 Tahap R3-A (R3-06): potongan pajak (lihat payPayableDocument). */
    withholding?: WithholdingInput;
    notes?: string;
    /** Nomor referensi/bukti pembayaran (R3-08). */
    reference?: string;
    /** A-21 (R3-02): sumber dana kredit pemasok (lihat payPayableDocument). */
    creditId?: string;
  },
) {
  const amount = parsePaymentAmount(input.amount);

  const [expense] = await tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, input.expenseId)))
    .limit(1)
    .for("update");
  if (!expense) throw new AppError("NOT_FOUND", "Beban tidak ditemukan.");
  if (expense.status === "void") {
    throw new AppError(
      "INVALID_STATE",
      `Beban ${expense.number} sudah dibatalkan (void) dan tidak dapat dibayar.`,
    );
  }
  if (expense.status !== "posted") {
    throw new AppError("INVALID_STATE", "Hanya beban berstatus posted yang dapat dibayar.");
  }
  // Beban tunai lahir terbayar dan tidak punya pemasok — tidak ada
  // utang yang bisa dilunasi di sini.
  const supplierId = expense.supplierId;
  if (!supplierId) {
    throw new AppError(
      "INVALID_STATE",
      "Beban ini bukan beban terutang, sehingga tidak dapat dibayar dari menu utang.",
    );
  }
  if (expense.paymentStatus === "paid") throw new AppError("INVALID_STATE", "Utang sudah lunas.");
  // Penjaga tanggal simetris R3-15/POS1-12: pembayaran tidak boleh
  // mendahului pengakuan bebannya.
  if (input.date < expense.date) {
    throw new AppError(
      "VALIDATION",
      `Tanggal pembayaran ${input.date} lebih awal dari tanggal beban ${expense.date}. Pembayaran utang tidak dapat mendahului pengakuan bebannya.`,
    );
  }
  const outstanding = d(expense.amount).minus(d(expense.paidAmount));

  return executePayablePayment(tx, {
    companyId: input.companyId,
    userId: input.userId,
    date: input.date,
    amount,
    accountId: input.accountId,
    fee: input.fee,
    withholding: input.withholding,
    notes: input.notes,
    reference: input.reference,
    creditId: input.creditId,
    supplierId,
    alreadyPaid: d(expense.paidAmount),
    doc: {
      expenseId: expense.id,
      docId: expense.id,
      outstanding,
      journalDescription: `Pembayaran utang beban ${expense.number}`,
      idempotencyPrefix: "ap-expense",
      creditOriginLabel: (paymentNumber) =>
        `Kelebihan pembayaran utang beban ${expense.number} (${paymentNumber})`,
      auditEntityType: "expense",
      applyPaid: async (paid) => {
        await tx
          .update(expenses)
          .set({
            paidAmount: toDb(paid),
            paymentStatus: paid.gte(d(expense.amount)) ? "paid" : "partial",
          })
          .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, expense.id)));
      },
    },
  });
}
