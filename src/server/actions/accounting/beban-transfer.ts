// A-26 Q4 (K-03): pecahan src/server/actions/accounting.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";


import {
  createExpense,
  effectiveTaxRate,
  voidExpense,
} from "@/server/expenses";
import {
  createBankTransfer,
  voidBankTransfer,
} from "@/server/bank-transfers";

import { requirePermissionInModule } from "@/lib/session";

import {
  AppError,
  guard,
} from "@/lib/errors";
import {
  isoDate,
  moneyString,
  moneyStringOptional,
  parseInput,
} from "@/lib/action-validation";

import { d } from "@/lib/money";

const expenseSchema = z.object({
  date: isoDate("Tanggal beban"),
  expenseAccountId: z.string().uuid(),
  // A-21 (R3-11): mode ditentukan oleh mana yang diisi — akun
  // pembayaran (tunai) atau pemasok (terutang); domain createExpense
  // menegakkan tepat satu mode, keduanya opsional di skema ini.
  paymentAccountId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  amount: moneyString("Nominal beban"),
  description: z.string().min(3).max(200),
  // FIX-P1 Tahap 4 (AK4-04): opsi "Termasuk PPN" yang tertunda sejak
  // A-12. Tarif tidak pernah datang dari klien — dibaca dari
  // pengaturan perusahaan di dalam transaksi (effectiveTaxRate).
  taxIncluded: z.boolean().optional(),
  // A-21 (R3-04, pola AK-P3-02): kunci idempotensi per sesi form dari
  // klien — retry/klik ganda mengembalikan beban yang sama, bukan
  // menggandakannya (domain createExpense menegakkannya).
  idempotencyKey: z.string().trim().min(1).max(80).optional(),
});

export async function createExpenseAction(input: z.input<typeof expenseSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(expenseSchema, input);
    const amount = d(data.amount);
    if (amount.lte(0)) throw new AppError("VALIDATION", "Nominal beban harus lebih dari nol.");

    // Domain di src/server/expenses.ts — dipakai bersama modal Catat
    // Transaksi (A-12) agar tidak ada dua jalur pencatatan beban.
    const result = await withCompany(ctx.company.id, async (tx) =>
      createExpense(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        date: data.date,
        expenseAccountId: data.expenseAccountId,
        paymentAccountId: data.paymentAccountId ?? null,
        supplierId: data.supplierId ?? null,
        amount: data.amount,
        description: data.description,
        taxIncluded: data.taxIncluded ?? false,
        taxRate: await effectiveTaxRate(tx, ctx.company.id),
        idempotencyKey: data.idempotencyKey ?? null,
      }),
    );

    revalidatePath("/app/akuntansi/beban");
    revalidatePath("/app/akuntansi");
    // Beban terutang langsung tampil sebagai utang terbuka.
    if (data.supplierId) revalidatePath("/app/akuntansi/piutang-utang");
    return result;
  });
}

export async function voidExpenseAction(input: { id: string; reason: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(200) }), input);

    // A-26 Q4 (K-03): logika pembatalan hidup di domain expenses.
    await withCompany(ctx.company.id, async (tx) =>
      voidExpense(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        expenseId: data.id,
        reason: data.reason,
      }),
    );

    revalidatePath("/app/akuntansi/beban");
    revalidatePath("/app/akuntansi");
    revalidatePath("/app/akuntansi/piutang-utang");
    return { id: data.id };
  });
}

const transferSchema = z.object({
  date: isoDate("Tanggal transfer"),
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: moneyString("Nominal transfer"),
  fee: moneyStringOptional("Biaya transfer"),
  reference: z.string().max(120).optional(),
  description: z.string().max(200).optional(),
  // A-21 (R3-04, pola AK-P3-02): kunci idempotensi per sesi form dari
  // klien — retry/klik ganda mengembalikan transfer yang sama, bukan
  // menggandakannya (domain createBankTransfer menegakkannya).
  idempotencyKey: z.string().trim().min(1).max(80).optional(),
});

export async function createBankTransferAction(input: z.input<typeof transferSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(transferSchema, input);
    if (data.fromAccountId === data.toAccountId) {
      throw new AppError("VALIDATION", "Rekening asal dan tujuan harus berbeda.");
    }
    const amount = d(data.amount);
    const fee = d(data.fee ?? 0);
    if (amount.lte(0)) throw new AppError("VALIDATION", "Nominal transfer harus lebih dari nol.");
    if (fee.lt(0)) throw new AppError("VALIDATION", "Biaya transfer tidak boleh negatif.");

    // Domain di src/server/bank-transfers.ts — dipakai bersama modal
    // Catat Transaksi (A-12).
    const result = await withCompany(ctx.company.id, (tx) =>
      createBankTransfer(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        date: data.date,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        amount: data.amount,
        fee: data.fee,
        reference: data.reference,
        description: data.description,
        idempotencyKey: data.idempotencyKey ?? null,
      }),
    );

    revalidatePath("/app/akuntansi/bank");
    revalidatePath("/app/akuntansi");
    return result;
  });
}

export async function voidBankTransferAction(input: { id: string; reason: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(200) }), input);

    // A-26 Q4 (K-03): logika pembatalan hidup di domain bank-transfers.
    await withCompany(ctx.company.id, async (tx) =>
      voidBankTransfer(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        transferId: data.id,
        reason: data.reason,
      }),
    );

    revalidatePath("/app/akuntansi/bank");
    revalidatePath("/app/akuntansi");
    return { id: data.id };
  });
}
