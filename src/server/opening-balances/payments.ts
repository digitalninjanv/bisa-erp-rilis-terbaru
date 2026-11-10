// A-26 Q8 (K-10): pembayaran & pembatalan pembayaran saldo awal —
// dipisah dari siklus hidup dokumen (documents.ts). Mesin pembayaran
// dwiarah (utang di atas nominal, piutang terpotong) SENGAJA tidak
// digabung ke inti payables (executePayablePayment): dokumennya
// bukan penerimaan/beban, model fee-nya berbeda per arah, dan bentuk
// hasilnya membawa paymentId/journalId/doc — penilaian P-04 di
// AUDIT-SENTRALISASI §P-04 dicatat di sini sebagai keputusan tertulis.

import { and, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  journalEntries,
  partyOpeningBalances,
  partyPayments,
  paymentMethods,
} from "@/db/schema";
import {
  getAccountId,
  getAccountMap,
  listCashBankIds,
  postJournal,
  reverseJournalEntry,
} from "@/server/accounting";
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
import { resolveOutgoingFee, resolveOutgoingWithholding } from "@/server/payables";
import { resolvePaymentFee } from "@/server/payment-fees";
import type { WithholdingInput } from "@/server/payment-deductions";
import { sumReturnAllocations } from "@/server/supplier-returns";
import { writeAudit } from "@/server/audit";
import { AppError } from "@/lib/errors";
import { d, toDb, type MoneyInput } from "@/lib/money";
import { lockOpeningDoc, type OpeningDoc } from "./documents";

/**
 * Akun pembayaran divalidasi persis pola POS-PAY-01 / R-1 (lihat
 * payReceivable di pos.ts): akun harus milik perusahaan, postable,
 * aktif, dan merupakan saluran penerimaan/pembayaran nyata — akun
 * metode pembayaran aktif (selain tipe kredit) atau akun pemetaan
 * kas/bank/QRIS.
 */
async function assertPaymentAccount(tx: Tx, companyId: string, accountId: string) {
  const [account] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) {
    throw new AppError("VALIDATION", "Akun pembayaran tidak ditemukan di perusahaan ini.");
  }
  if (!account.isPostable || !account.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun pembayaran ${account.code} — ${account.name} tidak dapat dipakai: akun harus aktif dan dapat diposting.`,
    );
  }
  const map = await getAccountMap(tx, companyId);
  const allowed = new Set<string>();
  const methodRows = await tx
    .select({ accountId: paymentMethods.accountId, type: paymentMethods.type })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.isActive, true)));
  for (const method of methodRows) {
    if (method.accountId && method.type !== "credit") allowed.add(method.accountId);
  }
  // A-27 B2: sisi kas/bank dari gabungan ini kini himpunan KELAS
  // (listCashBankIds); sisi metode pembayaran aktif dipertahankan.
  for (const id of await listCashBankIds(tx, companyId)) {
    allowed.add(id);
  }
  if (!allowed.has(accountId)) {
    throw new AppError(
      "VALIDATION",
      `Akun pembayaran ${account.code} — ${account.name} bukan akun metode pembayaran aktif atau akun berkelas kas/bank/kliring untuk perusahaan ini.`,
    );
  }
  return map;
}

export async function payOpeningBalance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    openingId: string;
    date: string;
    amount: MoneyInput;
    /** Akun kas/bank saluran pembayaran — wajib kecuali creditId diisi. */
    accountId?: string;
    /**
     * A-21 Tahap R3-A (R3-01): fee/MDR final pembayaran ini — arah
     * utang model di atas nominal, arah piutang model terpotong
     * (lihat payables.ts / pos/receivables.ts).
     */
    fee?: MoneyInput;
    /**
     * A-21 Tahap R3-A (R3-06): potongan pajak — hanya arah utang
     * (pembayaran keluar); arah piutang menolaknya.
     */
    withholding?: WithholdingInput;
    notes?: string | null;
    /** Nomor referensi/bukti pembayaran (R3-08, migrasi 0048). */
    reference?: string | null;
    /**
     * A-21 (R3-02): sumber dana kredit pihak dokumen saldo awal ini
     * (kredit pelanggan untuk piutang, kredit pemasok untuk utang).
     */
    creditId?: string;
  },
): Promise<{
  paymentId: string;
  journalId: string;
  number: string;
  doc: OpeningDoc;
  warnings: string[];
  creditNumber?: string;
  creditAmount?: string;
}> {
  const doc = await lockOpeningDoc(tx, input.companyId, input.openingId);
  if (doc.status === "void") throw new AppError("INVALID_STATE", "Saldo awal sudah dibatalkan.");
  if (doc.status === "settled") throw new AppError("INVALID_STATE", "Saldo awal sudah lunas.");

  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nominal pembayaran harus lebih dari nol.");
  }
  // A-9 (D-20): return allocations settle opening payables without cash.
  const allocated =
    doc.kind === "payable"
      ? await sumReturnAllocations(tx, input.companyId, { openingId: doc.id })
      : d(0);
  const outstanding = d(doc.amount).minus(d(doc.paidAmount)).minus(allocated);
  // A-21 (R3-02): tunai boleh melebihi sisa — kelebihannya menjadi
  // kredit pihak (kredit pelanggan / kredit pemasok mengikuti jenis
  // saldo awal). Sumber kredit dibatasi sisa & saldo kreditnya.
  const partyType = doc.partyType as "customer" | "supplier";
  let fundingAccountId: string;
  let credit: Awaited<ReturnType<typeof resolvePartyCreditForUse>>["credit"] | null = null;
  let map: Record<string, string>;
  if (input.creditId) {
    const resolved = await resolvePartyCreditForUse(tx, {
      companyId: input.companyId,
      creditId: input.creditId,
      partyType,
      partyId: doc.partyId,
      amount,
    });
    credit = resolved.credit;
    fundingAccountId = resolved.accountId;
    if (amount.gt(outstanding)) {
      throw new AppError(
        "VALIDATION",
        `Pembayaran melebihi sisa saldo awal ${outstanding.toFixed(0)}.`,
      );
    }
    map = await getAccountMap(tx, input.companyId);
  } else {
    if (!input.accountId) {
      throw new AppError("VALIDATION", "Pilih akun kas/bank pembayaran.");
    }
    map = await assertPaymentAccount(tx, input.companyId, input.accountId);
    fundingAccountId = input.accountId;
  }
  const applied = credit ? amount : amount.gt(outstanding) ? outstanding : amount;
  const excess = amount.minus(applied);
  const creditAccountId = excess.gt(0)
    ? await getAccountId(tx, input.companyId, doc.kind === "payable" ? "supplier_credit" : "customer_credit")
    : null;
  // A-21 Tahap R3-A (R3-01): fee mengikuti arah dokumen — utang di
  // atas nominal, piutang terpotong (fee dari bruto yang diterima).
  const isPayableDoc = doc.kind === "payable";
  // A-21 Tahap R3-A (R3-06): potongan pajak hanya untuk arah utang.
  const withholding = isPayableDoc
    ? await resolveOutgoingWithholding(tx, input.companyId, {
        creditFunded: Boolean(credit),
        input: input.withholding,
        grossAmount: amount,
      })
    : null;
  if (!isPayableDoc && input.withholding && d(input.withholding.amount).gt(0)) {
    throw new AppError(
      "VALIDATION",
      "Potongan pajak hanya berlaku untuk pembayaran utang (uang keluar), bukan penerimaan piutang.",
    );
  }
  let fee = d(0);
  if (isPayableDoc) {
    fee = await resolveOutgoingFee(tx, input.companyId, {
      creditFunded: Boolean(credit),
      accountId: fundingAccountId,
      amount,
      explicitFee: input.fee,
      map,
    });
  } else if (credit) {
    if (input.fee !== undefined && input.fee !== null && input.fee !== "" && d(input.fee).gt(0)) {
      throw new AppError("VALIDATION", "Pembayaran dari kredit pihak tidak dikenai fee bank.");
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

  const number = await nextDocumentNumber(tx, input.companyId, "PAYMENT", input.date);
  const [payment] = await tx
    .insert(partyPayments)
    .values({
      companyId: input.companyId,
      type: doc.kind,
      partyType: doc.partyType,
      partyId: doc.partyId,
      openingId: doc.id,
      number,
      date: input.date,
      amount: toDb(applied),
      feeAmount: toDb(fee),
      withholdingType: withholding?.type ?? null,
      withholdingRate: withholding?.rate ? toDb(withholding.rate) : null,
      withholdingAmount: toDb(withholding?.amount ?? 0),
      accountId: fundingAccountId,
      creditId: credit?.id ?? null,
      notes: input.notes ?? null,
      reference: input.reference?.trim() || null,
      createdBy: input.userId,
    })
    .returning({ id: partyPayments.id });

  const isPayable = doc.kind === "payable";
  const party = { partyType: doc.partyType, partyId: doc.partyId };
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: isPayable
      ? `Pembayaran saldo awal utang ${doc.number}`
      : `Penerimaan saldo awal piutang ${doc.number}`,
    sourceType: "payment",
    sourceId: doc.id,
    createdBy: input.userId,
    idempotencyKey: `${isPayable ? "ap" : "ar"}-opening:${doc.id}:${number}`,
    lines: credit
      ? isPayable
        ? [
            {
              accountId: map.payable,
              debit: applied,
              description: "Utang saldo awal berkurang (kredit pemasok)",
              ...party,
            },
            {
              accountId: fundingAccountId,
              credit: applied,
              description: "Kredit pemasok terpakai",
              ...party,
            },
          ]
        : [
            {
              accountId: fundingAccountId,
              debit: applied,
              description: "Kredit pelanggan terpakai",
              ...party,
            },
            {
              accountId: map.receivable,
              credit: applied,
              description: "Piutang saldo awal berkurang (kredit pelanggan)",
              ...party,
            },
          ]
      : isPayable
        ? [
            {
              accountId: map.payable,
              debit: applied,
              description: "Utang saldo awal berkurang",
              ...party,
            },
            ...(creditAccountId
              ? [
                  {
                    accountId: creditAccountId,
                    debit: excess,
                    description: "Kelebihan bayar menjadi kredit pemasok",
                    ...party,
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
                    ...party,
                  },
                ]
              : []),
            {
              accountId: fundingAccountId,
              credit: amount.plus(fee).minus(withholding?.amount ?? 0),
              description: "Kas/bank keluar",
            },
          ]
        : [
            {
              accountId: fundingAccountId,
              debit: amount.minus(fee),
              description: "Penerimaan piutang saldo awal",
            },
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
              description: "Piutang saldo awal berkurang",
              ...party,
            },
            ...(creditAccountId
              ? [
                  {
                    accountId: creditAccountId,
                    credit: excess,
                    description: "Kelebihan bayar menjadi kredit pelanggan",
                    ...party,
                  },
                ]
              : []),
          ],
  });

  const paid = d(doc.paidAmount).plus(applied);
  const [updated] = await tx
    .update(partyOpeningBalances)
    .set({
      paidAmount: toDb(paid),
      status: paid.plus(allocated).gte(d(doc.amount)) ? "settled" : "open",
    })
    .where(and(eq(partyOpeningBalances.companyId, input.companyId), eq(partyOpeningBalances.id, doc.id)))
    .returning();

  let creditNumber: string | undefined;
  if (excess.gt(0)) {
    const created = await createPartyCredit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      partyType,
      partyId: doc.partyId,
      date: input.date,
      amount: excess,
      originPaymentId: payment.id,
      originLabel: `Kelebihan pembayaran saldo awal ${doc.number} (${number})`,
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
    action: "opening_balance.payment",
    entityType: "party_opening_balance",
    entityId: doc.id,
    after: {
      number,
      amount: toDb(amount),
      date: input.date,
      ...(creditNumber ? { creditNumber, creditAmount: toDb(excess) } : {}),
      ...(credit ? { creditUsed: credit.number } : {}),
    },
  });
  // FIX-R2 Tahap 3 (RV2-01): peringatan penjaga saldo kas/bank (mode warn).
  return {
    paymentId: payment.id,
    journalId: journal.id,
    number,
    doc: updated,
    warnings: journal.warnings,
    ...(creditNumber ? { creditNumber, creditAmount: toDb(excess) } : {}),
  };
}

export async function voidOpeningPayment(
  tx: Tx,
  input: { companyId: string; userId: string; paymentId: string; reason: string; date: string },
): Promise<{ doc: OpeningDoc; reversalNumber: string }> {
  const [payment] = await tx
    .select()
    .from(partyPayments)
    .where(and(eq(partyPayments.companyId, input.companyId), eq(partyPayments.id, input.paymentId)))
    .limit(1)
    .for("update");
  if (!payment) throw new AppError("NOT_FOUND", "Pembayaran tidak ditemukan.");
  if (!payment.openingId) {
    throw new AppError("VALIDATION", "Pembayaran ini bukan pembayaran saldo awal.");
  }
  if (payment.status === "void") throw new AppError("INVALID_STATE", "Pembayaran sudah dibatalkan.");

  // A-21 (R3-02): rantai kredit pihak — pembayaran asal yang
  // kreditnya sudah terpakai tidak dapat dibatalkan (jurnal pembalik
  // akan membalik baris kredit yang saldonya sudah berpindah).
  await assertOriginCreditVoidable(tx, input.companyId, payment.id);

  const doc = await lockOpeningDoc(tx, input.companyId, payment.openingId);

  // Sama seperti void pembayaran AK-P2-03: jurnal pembayaran ditargetkan
  // lewat idempotency key-nya dan dibalik per entri.
  const keyPrefix = payment.type === "payable" ? "ap-opening" : "ar-opening";
  const [entry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.idempotencyKey, `${keyPrefix}:${doc.id}:${payment.number}`),
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
    date: input.date,
    description: `Pembatalan pembayaran saldo awal ${payment.number} — ${input.reason}`,
    createdBy: input.userId,
  });

  await tx
    .update(partyPayments)
    .set({ status: "void" })
    .where(and(eq(partyPayments.companyId, input.companyId), eq(partyPayments.id, payment.id)));

  // A-21 (R3-02): selaraskan subledger kredit — pembayaran pemakai
  // kredit yang dibatalkan memulihkan saldo kreditnya; pembayaran
  // asal yang dibatalkan membatalkan dokumen kredit yang lahir
  // darinya (sudah dipastikan belum terpakai oleh penjaga di atas).
  await restorePartyCreditUsage(tx, { companyId: input.companyId, userId: input.userId, payment });
  await voidOriginPartyCredit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    paymentId: payment.id,
  });

  // Hitung ulang terbayar dari pembayaran non-void saja.
  const [paidRow] = await tx
    .select({ total: sql<string>`coalesce(sum(${partyPayments.amount}), 0)` })
    .from(partyPayments)
    .where(
      and(
        eq(partyPayments.companyId, input.companyId),
        eq(partyPayments.openingId, doc.id),
        ne(partyPayments.status, "void"),
      ),
    );
  const paid = d(paidRow?.total ?? "0");
  // A-9 (D-20): return allocations count toward settled, like payments.
  const allocated =
    doc.kind === "payable"
      ? await sumReturnAllocations(tx, input.companyId, { openingId: doc.id })
      : d(0);
  const [updated] = await tx
    .update(partyOpeningBalances)
    .set({
      paidAmount: toDb(paid),
      status: paid.plus(allocated).gte(d(doc.amount)) ? "settled" : "open",
    })
    .where(and(eq(partyOpeningBalances.companyId, input.companyId), eq(partyOpeningBalances.id, doc.id)))
    .returning();

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "opening_balance.payment.void",
    entityType: "party_payment",
    entityId: payment.id,
    after: {
      number: payment.number,
      openingNumber: doc.number,
      amount: payment.amount,
      reason: input.reason,
      reversalNumber: reversal.number,
    },
  });
  return { doc: updated, reversalNumber: reversal.number };
}
