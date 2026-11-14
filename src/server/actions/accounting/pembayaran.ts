// A-26 Q4 (K-03): pecahan src/server/actions/accounting.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { runIdempotentPayment } from "@/server/idempotency";



import {
  payExpensePayable,
  payPayableDocument,
  voidPayablePayment,
} from "@/server/payables";
import {
  writeOffExpensePayable,
  writeOffOpeningBalance,
  writeOffPayableReceipt,
  writeOffReceivableSale,
} from "@/server/party-writeoffs";

import { requirePermissionInModule } from "@/lib/session";

import {
  AppError,
  guard,
} from "@/lib/errors";
import {
  isoDate,
  moneyString,
  moneyStringOptionalNonNegative,
  parseInput,
} from "@/lib/action-validation";

import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";

import { buildWithholdingInput } from "./shared";

export async function payPayableAction(input: {
  receiptId: string;
  idempotencyKey: string;
  amount: string | number;
  accountId?: string;
  /** A-21 (R3-02): sumber dana kredit pemasok (pengganti akun). */
  creditId?: string;
  /** A-21 Tahap R3-A (R3-01): fee final; kosong = bawaan konfigurasi metode. */
  fee?: string | number;
  /** A-21 Tahap R3-A (R3-06): potongan pajak pembayaran keluar. */
  withholdingType?: string;
  withholdingRate?: string | number;
  withholdingAmount?: string | number;
  notes?: string;
  reference?: string;
  date?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({
        receiptId: z.string().uuid(),
        idempotencyKey: z.string().uuid(),
        amount: moneyString("Nominal pembayaran"),
        accountId: z.string().uuid().optional(),
        creditId: z.string().uuid().optional(),
        fee: moneyStringOptionalNonNegative("Fee pembayaran").optional(),
        withholdingType: z.enum(["pph23", "pph42"]).optional(),
        withholdingRate: moneyStringOptionalNonNegative("Tarif potongan").optional(),
        withholdingAmount: moneyStringOptionalNonNegative("Nominal potongan").optional(),
        notes: z.string().max(300).optional(),
        // A-21 (R3-08): nomor referensi/bukti pembayaran.
        reference: z.string().trim().max(100).optional(),
        // AK-P2-03: tanggal pembayaran bisa dipilih (mis. pembayaran yang
        // sebenarnya terjadi kemarin); default hari ini agar kompatibel.
        // Periode tertutup tetap menolak lewat postJournal/assertPeriodOpen.
        date: isoDate("Tanggal pembayaran").optional(),
      }),
      input,
    );
    const amount = d(data.amount);
    if (amount.lte(0)) throw new AppError("VALIDATION", "Nominal pembayaran harus lebih dari nol.");
    const payDate = data.date ?? todayISO();

    // Domain di src/server/payables.ts — dipakai bersama pembayaran
    // FIFO modal Catat Transaksi (A-12).
    const result = await withCompany(ctx.company.id, (tx) =>
      runIdempotentPayment(
        tx,
        {
          companyId: ctx.company.id,
          key: data.idempotencyKey,
          request: { kind: "payable", ...data, date: payDate },
        },
        () =>
          payPayableDocument(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            receiptId: data.receiptId,
            date: payDate,
            amount: data.amount,
            accountId: data.accountId,
            creditId: data.creditId,
            fee: data.fee,
            withholding: buildWithholdingInput(data),
            notes: data.notes,
            reference: data.reference,
          }),
      ),
    );

    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/gudang");
    return result;
  });
}

/**
 * A-21 (R3-11): pembayaran satu dokumen beban terutang dari halaman
 * Piutang & Utang — cermin payPayableAction; domainnya
 * payExpensePayable memakai mekanisme party_payments yang sama.
 */
export async function payExpensePayableAction(input: {
  expenseId: string;
  idempotencyKey: string;
  amount: string | number;
  accountId?: string;
  /** A-21 (R3-02): sumber dana kredit pemasok (pengganti akun). */
  creditId?: string;
  /** A-21 Tahap R3-A (R3-01): fee final; kosong = bawaan konfigurasi metode. */
  fee?: string | number;
  /** A-21 Tahap R3-A (R3-06): potongan pajak pembayaran keluar. */
  withholdingType?: string;
  withholdingRate?: string | number;
  withholdingAmount?: string | number;
  notes?: string;
  reference?: string;
  date?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({
        expenseId: z.string().uuid(),
        idempotencyKey: z.string().uuid(),
        amount: moneyString("Nominal pembayaran"),
        accountId: z.string().uuid().optional(),
        creditId: z.string().uuid().optional(),
        fee: moneyStringOptionalNonNegative("Fee pembayaran").optional(),
        withholdingType: z.enum(["pph23", "pph42"]).optional(),
        withholdingRate: moneyStringOptionalNonNegative("Tarif potongan").optional(),
        withholdingAmount: moneyStringOptionalNonNegative("Nominal potongan").optional(),
        notes: z.string().max(300).optional(),
        reference: z.string().trim().max(100).optional(),
        date: isoDate("Tanggal pembayaran").optional(),
      }),
      input,
    );
    const amount = d(data.amount);
    if (amount.lte(0)) throw new AppError("VALIDATION", "Nominal pembayaran harus lebih dari nol.");
    const payDate = data.date ?? todayISO();

    const result = await withCompany(ctx.company.id, (tx) =>
      runIdempotentPayment(
        tx,
        {
          companyId: ctx.company.id,
          key: data.idempotencyKey,
          request: { kind: "expense-payable", ...data, date: payDate },
        },
        () =>
          payExpensePayable(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            expenseId: data.expenseId,
            date: payDate,
            amount: data.amount,
            accountId: data.accountId,
            creditId: data.creditId,
            fee: data.fee,
            withholding: buildWithholdingInput(data),
            notes: data.notes,
            reference: data.reference,
          }),
      ),
    );

    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/akuntansi/beban");
    revalidatePath("/app/akuntansi");
    return result;
  });
}

/**
 * A-21 Tahap R3-A (R3-07): write-off sisa pelunasan — aksi TERPISAH
 * pada dokumen, bukan bagian pembayaran. Menutup sisa piutang/utang
 * berarti mengakui beban/pendapatan penyelesaian, tindakan yang
 * mengubah hasil buku tanpa arus kas, jadi gerbangnya izin pengelola
 * akuntansi (`accounting.manage` — pemilik COA & pengaturan; pemegang:
 * owner/admin/accountant), alasan wajib, dan ambang per perusahaan
 * (company_settings.writeoff_max_amount, bawaan 0 = mati) ditegakkan
 * domain party-writeoffs. Hasilnya baris party_payments biasa yang
 * dapat dibatalkan lewat aksi void pembayaran yang sudah ada.
 */
const writeOffSchema = z.object({
  reason: z.string().trim().min(3, "Alasan write-off wajib diisi (minimal 3 karakter).").max(200),
  date: isoDate("Tanggal write-off").optional(),
});

export async function writeOffReceivableAction(input: {
  saleId: string;
  reason: string;
  date?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(writeOffSchema.extend({ saleId: z.string().uuid() }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      writeOffReceivableSale(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        saleId: data.saleId,
        date: data.date ?? todayISO(),
        reason: data.reason,
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/pos/riwayat");
    return result;
  });
}

export async function writeOffPayableAction(input: {
  receiptId: string;
  reason: string;
  date?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(writeOffSchema.extend({ receiptId: z.string().uuid() }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      writeOffPayableReceipt(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        receiptId: data.receiptId,
        date: data.date ?? todayISO(),
        reason: data.reason,
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/gudang");
    return result;
  });
}

export async function writeOffExpensePayableAction(input: {
  expenseId: string;
  reason: string;
  date?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(writeOffSchema.extend({ expenseId: z.string().uuid() }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      writeOffExpensePayable(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        expenseId: data.expenseId,
        date: data.date ?? todayISO(),
        reason: data.reason,
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/akuntansi/beban");
    return result;
  });
}

export async function writeOffOpeningBalanceAction(input: {
  openingId: string;
  reason: string;
  date?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(writeOffSchema.extend({ openingId: z.string().uuid() }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      writeOffOpeningBalance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        openingId: data.openingId,
        date: data.date ?? todayISO(),
        reason: data.reason,
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/akuntansi");
    return result;
  });
}

export async function voidPayablePaymentAction(input: { paymentId: string; reason: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({ paymentId: z.string().uuid(), reason: z.string().trim().min(3).max(200) }),
      input,
    );

    // A-26 Q4 (K-03): rantai pembatalan pembayaran utang hidup di
    // domain payables (voidPayablePayment).
    await withCompany(ctx.company.id, async (tx) =>
      voidPayablePayment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        paymentId: data.paymentId,
        reason: data.reason,
      }),
    );

    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/gudang");
    revalidatePath("/app/akuntansi/beban");
    revalidatePath("/app/akuntansi");
    return { id: data.paymentId };
  });
}
