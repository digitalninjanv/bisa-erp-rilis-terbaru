import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  expenses,
  partyOpeningBalances,
  partyPayments,
  sales,
  stockReceipts,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type D } from "@/lib/money";
import { getAccountMap, postJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { ensurePaymentDeductionAccounts } from "@/server/payment-deductions";
import { nextDocumentNumber } from "@/server/sequences";
import { sumReturnAllocations } from "@/server/supplier-returns";

import { getCompanySettingsRow } from "@/server/settings";
/**
 * A-21 Tahap R3-A (R3-07): write-off sisa pelunasan BERIZIN.
 *
 * Aksi tersendiri pada dokumen piutang/utang — bukan diam-diam di
 * dalam pembayaran — untuk sisa kecil yang tidak realistis lagi
 * ditagih/dibayar (selisih pembulatan, kekurangan receh). Syarat:
 * - alasan wajib (pola alasan void: minimal 3 karakter);
 * - ambang maksimum per perusahaan `company_settings.writeoff_max_amount`
 *   (D-25: konfigurasi, bukan angka mati) — bawaan 0 berarti fitur
 *   MATI sampai pemilik mengisinya di Pengaturan; sisa di atas ambang
 *   ditolak;
 * - izin ditegakkan di lapisan aksi (`accounting.manage`).
 *
 * Implementasinya SENGAJA berbentuk baris party_payments biasa:
 * - nomor seri "PAYMENT" yang sama dan kunci idempotensi jurnal
 *   standar per dokumen (`ar:<saleId>:<nomor>`, `ap:<receiptId>:<nomor>`,
 *   `ap-expense:<expenseId>:<nomor>`, `ap-opening:`/`ar-opening:<id>:<nomor>`)
 *   → aksi void pembayaran yang SUDAH ADA membalik jurnalnya persis;
 * - amount baris = sisa persis, sehingga hitung-ulang terbayar pada
 *   void (Σ amount non-void) memulihkan sisa & status dokumen secara
 *   otomatis — tidak ada jalur pemulihan khusus write-off;
 * - account_id baris adalah akun lawan penyelesaian (beban write-off /
 *   pendapatan lain-lain), pola yang sama seperti baris bersumber
 *   kredit pihak (R3-02) yang account_id-nya akun kredit terpeta;
 * - alasan tersimpan di kolom khusus `writeoff_reason` (migrasi 0053)
 *   sebagai jejak audit dokumen.
 *
 * Jurnal: piutang — Dr pemetaan `receivable_writeoff` (6100 Beban
 * Piutang Tak Tertagih, dipastikan ensurePaymentDeductionAccounts) /
 * Cr piutang bertag pelanggan. Utang — Dr utang bertag pemasok / Cr
 * pemetaan `other_income` (pendapatan lain-lain yang sudah ada; pola
 * fallback map.other_income ?? map.revenue seperti createReceipt).
 */

export type WriteOffResult = {
  paymentId: string;
  journalId: string;
  /** Nomor dokumen pembayaran (seri PAYMENT) yang membawa write-off. */
  number: string;
  /** Sisa yang ditutup, string desimal basis data. */
  amount: string;
  warnings: string[];
};

type WriteOffInput = {
  companyId: string;
  userId: string;
  date: string;
  reason: string;
};

/**
 * Penjaga bersama: alasan + ambang perusahaan. Mengembalikan sisa
 * yang lolos sebagai Decimal untuk dipakai pemanggil.
 */
async function assertWriteOffAllowed(
  tx: Tx,
  companyId: string,
  reason: string,
  remaining: D,
): Promise<void> {
  if (!reason || reason.trim().length < 3) {
    throw new AppError(
      "VALIDATION",
      "Alasan write-off wajib diisi (minimal 3 karakter) — sisa yang ditutup harus bisa dijelaskan.",
    );
  }
  if (remaining.lte(0)) {
    throw new AppError("INVALID_STATE", "Dokumen ini tidak punya sisa untuk di-write-off.");
  }
  const settings = await getCompanySettingsRow(tx, companyId);
  const max = d(settings?.writeoffMaxAmount ?? 0);
  if (max.lte(0)) {
    throw new AppError(
      "VALIDATION",
      "Write-off belum diaktifkan untuk perusahaan ini: ambang maksimum write-off masih 0. Pemilik dapat mengisinya di Pengaturan.",
    );
  }
  if (remaining.gt(max)) {
    throw new AppError(
      "VALIDATION",
      `Sisa ${remaining.toFixed(0)} melebihi ambang maksimum write-off ${max.toFixed(0)} per dokumen. Lunasi selisihnya lewat pembayaran biasa atau naikkan ambang di Pengaturan.`,
    );
  }
}

/** Inti bersama: nomor seri, baris pembayaran, jurnal, audit. */
async function postWriteOff(
  tx: Tx,
  input: WriteOffInput & {
    direction: "receivable" | "payable";
    partyType: "customer" | "supplier";
    partyId: string;
    /** Tautan dokumen induk pada baris pembayaran (tepat satu terisi). */
    link: { saleId?: string; receiptId?: string; expenseId?: string; openingId?: string };
    /** Awalan kunci idempotensi jurnal dokumen ("ar", "ap", …). */
    keyPrefix: string;
    docId: string;
    docNumber: string;
    remaining: D;
    /** Akun penyelesaian: beban write-off (piutang) / pendapatan lain (utang). */
    settlementAccountId: string;
    /** Akun piutang/utang terpeta yang ditutup. */
    controlAccountId: string;
    auditAction: string;
    entityType: string;
  },
): Promise<WriteOffResult> {
  const number = await nextDocumentNumber(tx, input.companyId, "PAYMENT", input.date);
  const reason = input.reason.trim();
  const party = { partyType: input.partyType, partyId: input.partyId } as const;
  const lines =
    input.direction === "receivable"
      ? [
          {
            accountId: input.settlementAccountId,
            debit: input.remaining,
            description: `Write-off sisa piutang ${input.docNumber} — ${reason}`,
          },
          {
            accountId: input.controlAccountId,
            credit: input.remaining,
            description: `Write-off sisa piutang ${input.docNumber}`,
            ...party,
          },
        ]
      : [
          {
            accountId: input.controlAccountId,
            debit: input.remaining,
            description: `Write-off sisa utang ${input.docNumber}`,
            ...party,
          },
          {
            accountId: input.settlementAccountId,
            credit: input.remaining,
            description: `Write-off sisa utang ${input.docNumber} — ${reason}`,
          },
        ];
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description:
      input.direction === "receivable"
        ? `Write-off sisa piutang ${input.docNumber} — ${reason}`
        : `Write-off sisa utang ${input.docNumber} — ${reason}`,
    sourceType: "payment",
    sourceId: input.docId,
    createdBy: input.userId,
    idempotencyKey: `${input.keyPrefix}:${input.docId}:${number}`,
    lines,
  });
  const [payment] = await tx
    .insert(partyPayments)
    .values({
      companyId: input.companyId,
      type: input.direction,
      partyType: input.partyType,
      partyId: input.partyId,
      saleId: input.link.saleId,
      receiptId: input.link.receiptId,
      expenseId: input.link.expenseId,
      openingId: input.link.openingId,
      number,
      date: input.date,
      amount: toDb(input.remaining),
      accountId: input.settlementAccountId,
      writeoffReason: reason,
      notes: `Write-off sisa — ${reason}`,
      createdBy: input.userId,
    })
    .returning({ id: partyPayments.id });
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: input.auditAction,
    entityType: input.entityType,
    entityId: input.docId,
    after: { number, amount: toDb(input.remaining), reason },
  });
  return {
    paymentId: payment.id,
    journalId: journal.id,
    number,
    amount: toDb(input.remaining),
    warnings: journal.warnings,
  };
}

/** Write-off sisa piutang penjualan POS (dokumen `sales`). */
export async function writeOffReceivableSale(
  tx: Tx,
  input: WriteOffInput & { saleId: string },
): Promise<WriteOffResult> {
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, input.saleId)))
    .limit(1)
    .for("update");
  if (!sale) throw new AppError("NOT_FOUND", "Transaksi penjualan tidak ditemukan.");
  if (sale.status === "void") throw new AppError("INVALID_STATE", "Transaksi sudah dibatalkan.");
  if (sale.paymentStatus === "paid") throw new AppError("INVALID_STATE", "Piutang sudah lunas.");
  if (!sale.customerId) {
    throw new AppError("VALIDATION", "Penjualan tanpa pelanggan tidak dapat di-write-off.");
  }
  const remaining = d(sale.total).minus(d(sale.paidTotal));
  await assertWriteOffAllowed(tx, input.companyId, input.reason, remaining);
  const map = await getAccountMap(tx, input.companyId);
  if (!map.receivable) {
    throw new AppError("VALIDATION", 'Akun untuk "receivable" belum dipetakan di Pengaturan.');
  }
  const deductionAccounts = await ensurePaymentDeductionAccounts(tx, input.companyId);
  const result = await postWriteOff(tx, {
    ...input,
    direction: "receivable",
    partyType: "customer",
    partyId: sale.customerId,
    link: { saleId: sale.id },
    keyPrefix: "ar",
    docId: sale.id,
    docNumber: sale.number,
    remaining,
    settlementAccountId: deductionAccounts.receivable_writeoff,
    controlAccountId: map.receivable,
    auditAction: "ar.writeoff",
    entityType: "sale",
  });
  await tx
    .update(sales)
    .set({ paidTotal: toDb(d(sale.total)), paymentStatus: "paid" })
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, sale.id)));
  return result;
}

/** Write-off sisa utang penerimaan barang (dokumen `stock_receipts`). */
export async function writeOffPayableReceipt(
  tx: Tx,
  input: WriteOffInput & { receiptId: string },
): Promise<WriteOffResult> {
  const [receipt] = await tx
    .select()
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, input.receiptId)))
    .limit(1)
    .for("update");
  if (!receipt) throw new AppError("NOT_FOUND", "Penerimaan barang tidak ditemukan.");
  if (receipt.status === "void") throw new AppError("INVALID_STATE", "Penerimaan sudah dibatalkan.");
  if (receipt.paymentStatus === "paid") throw new AppError("INVALID_STATE", "Utang sudah lunas.");
  if (!receipt.supplierId) {
    throw new AppError("VALIDATION", "Penerimaan tanpa pemasok tidak dapat di-write-off.");
  }
  const allocated = await sumReturnAllocations(tx, input.companyId, { receiptId: receipt.id });
  const remaining = d(receipt.total).minus(d(receipt.paidAmount)).minus(allocated);
  await assertWriteOffAllowed(tx, input.companyId, input.reason, remaining);
  const map = await getAccountMap(tx, input.companyId);
  if (!map.payable) {
    throw new AppError("VALIDATION", 'Akun untuk "payable" belum dipetakan di Pengaturan.');
  }
  const otherIncome = map.other_income ?? map.revenue;
  if (!otherIncome) {
    throw new AppError("VALIDATION", 'Akun untuk "other_income" belum dipetakan di Pengaturan.');
  }
  const result = await postWriteOff(tx, {
    ...input,
    direction: "payable",
    partyType: "supplier",
    partyId: receipt.supplierId,
    link: { receiptId: receipt.id },
    keyPrefix: "ap",
    docId: receipt.id,
    docNumber: receipt.number,
    remaining,
    settlementAccountId: otherIncome,
    controlAccountId: map.payable,
    auditAction: "ap.writeoff",
    entityType: "stock_receipt",
  });
  await tx
    .update(stockReceipts)
    .set({
      paidAmount: toDb(d(receipt.paidAmount).plus(remaining)),
      paymentStatus: "paid",
    })
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, receipt.id)));
  return result;
}

/** Write-off sisa beban terutang (dokumen `expenses` ber-pemasok). */
export async function writeOffExpensePayable(
  tx: Tx,
  input: WriteOffInput & { expenseId: string },
): Promise<WriteOffResult> {
  const [expense] = await tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, input.expenseId)))
    .limit(1)
    .for("update");
  if (!expense) throw new AppError("NOT_FOUND", "Beban tidak ditemukan.");
  if (expense.status === "void") throw new AppError("INVALID_STATE", "Beban sudah dibatalkan.");
  if (expense.paymentStatus === "paid") throw new AppError("INVALID_STATE", "Beban terutang sudah lunas.");
  if (!expense.supplierId) {
    throw new AppError("VALIDATION", "Beban tunai (tanpa pemasok) tidak punya utang untuk di-write-off.");
  }
  const remaining = d(expense.amount).minus(d(expense.paidAmount));
  await assertWriteOffAllowed(tx, input.companyId, input.reason, remaining);
  const map = await getAccountMap(tx, input.companyId);
  if (!map.payable) {
    throw new AppError("VALIDATION", 'Akun untuk "payable" belum dipetakan di Pengaturan.');
  }
  const otherIncome = map.other_income ?? map.revenue;
  if (!otherIncome) {
    throw new AppError("VALIDATION", 'Akun untuk "other_income" belum dipetakan di Pengaturan.');
  }
  const result = await postWriteOff(tx, {
    ...input,
    direction: "payable",
    partyType: "supplier",
    partyId: expense.supplierId,
    link: { expenseId: expense.id },
    keyPrefix: "ap-expense",
    docId: expense.id,
    docNumber: expense.number,
    remaining,
    settlementAccountId: otherIncome,
    controlAccountId: map.payable,
    auditAction: "ap.writeoff",
    entityType: "expense",
  });
  await tx
    .update(expenses)
    .set({
      paidAmount: toDb(d(expense.paidAmount).plus(remaining)),
      paymentStatus: "paid",
    })
    .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, expense.id)));
  return result;
}

/** Write-off sisa dokumen saldo awal (piutang maupun utang). */
export async function writeOffOpeningBalance(
  tx: Tx,
  input: WriteOffInput & { openingId: string },
): Promise<WriteOffResult> {
  const [doc] = await tx
    .select()
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, input.companyId),
        eq(partyOpeningBalances.id, input.openingId),
      ),
    )
    .limit(1)
    .for("update");
  if (!doc) throw new AppError("NOT_FOUND", "Dokumen saldo awal tidak ditemukan.");
  if (doc.status === "void") throw new AppError("INVALID_STATE", "Saldo awal sudah dibatalkan.");
  if (doc.status === "settled") throw new AppError("INVALID_STATE", "Saldo awal sudah lunas.");
  const allocated = await sumReturnAllocations(tx, input.companyId, { openingId: doc.id });
  const remaining = d(doc.amount).minus(d(doc.paidAmount)).minus(allocated);
  await assertWriteOffAllowed(tx, input.companyId, input.reason, remaining);
  const map = await getAccountMap(tx, input.companyId);
  const isPayable = doc.kind === "payable";
  let settlementAccountId: string;
  let controlAccountId: string;
  if (isPayable) {
    if (!map.payable) {
      throw new AppError("VALIDATION", 'Akun untuk "payable" belum dipetakan di Pengaturan.');
    }
    const otherIncome = map.other_income ?? map.revenue;
    if (!otherIncome) {
      throw new AppError("VALIDATION", 'Akun untuk "other_income" belum dipetakan di Pengaturan.');
    }
    controlAccountId = map.payable;
    settlementAccountId = otherIncome;
  } else {
    if (!map.receivable) {
      throw new AppError("VALIDATION", 'Akun untuk "receivable" belum dipetakan di Pengaturan.');
    }
    const deductionAccounts = await ensurePaymentDeductionAccounts(tx, input.companyId);
    controlAccountId = map.receivable;
    settlementAccountId = deductionAccounts.receivable_writeoff;
  }
  const result = await postWriteOff(tx, {
    ...input,
    direction: isPayable ? "payable" : "receivable",
    partyType: doc.partyType === "supplier" ? "supplier" : "customer",
    partyId: doc.partyId,
    link: { openingId: doc.id },
    keyPrefix: isPayable ? "ap-opening" : "ar-opening",
    docId: doc.id,
    docNumber: doc.number,
    remaining,
    settlementAccountId,
    controlAccountId,
    auditAction: isPayable ? "ap.writeoff" : "ar.writeoff",
    entityType: "party_opening_balance",
  });
  await tx
    .update(partyOpeningBalances)
    .set({
      paidAmount: toDb(d(doc.paidAmount).plus(remaining)),
      status: "settled",
    })
    .where(
      and(
        eq(partyOpeningBalances.companyId, input.companyId),
        eq(partyOpeningBalances.id, doc.id),
      ),
    );
  return result;
}
