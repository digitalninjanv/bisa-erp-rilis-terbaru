// A-26 Q4 (K-03): pecahan src/server/actions/accounting.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";

import {
  createOpeningBalance,
  payOpeningBalance,
  voidOpeningBalance,
  voidOpeningPayment,
} from "@/server/opening-balances";

import {
  requireAuth,
  requirePermissionInModule,
} from "@/lib/session";
import {
  MODULES,
  type ModuleKey,
} from "@/lib/modules";
import { can } from "@/lib/permissions";
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

import { todayISO } from "@/lib/format";

import { buildWithholdingInput } from "./shared";

/* ------------------------------------------------------------------ */
/* T4-5b (D-14): dokumen saldo awal hutang/piutang. Domain di           */
/* src/server/opening-balances.ts; actions di sini hanya auth, parsing, */
/* dan revalidasi — mengikuti izin pembayaran yang sudah ada.           */
/* ------------------------------------------------------------------ */

const openingDateSchema = isoDate("Tanggal");

export async function createOpeningBalanceAction(input: {
  kind: "payable" | "receivable";
  partyId: string;
  date: string;
  dueDate?: string | null;
  amount: string | number;
  reference?: string;
  notes?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({
        kind: z.enum(["payable", "receivable"]),
        partyId: z.string().uuid(),
        date: openingDateSchema,
        dueDate: isoDate("Tanggal jatuh tempo").nullish(),
        amount: moneyString("Nominal saldo awal"),
        reference: z.string().max(120).optional(),
        notes: z.string().max(300).optional(),
      }),
      input,
    );
    const doc = await withCompany(ctx.company.id, (tx) =>
      createOpeningBalance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        kind: data.kind,
        partyId: data.partyId,
        date: data.date,
        dueDate: data.dueDate ?? null,
        amount: data.amount,
        reference: data.reference,
        notes: data.notes,
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/akuntansi");
    return { id: doc.id, number: doc.number };
  });
}

/**
 * T5R-2 pengecualian dwi-modul: pembayaran saldo awal boleh dicatat
 * pemegang accounting.post (jalur Akuntansi) ATAU pos.sell (jalur kasir,
 * D-14), jadi gerbang modulnya mengikuti jalur izin yang benar-benar
 * dipakai pemanggil — lolos bila salah satu jalur terbuka, dan pesan
 * penolakan menyebut modul dari jalur izin yang dimiliki pengguna.
 */
function assertOpeningPaymentModule(
  ctx: Awaited<ReturnType<typeof requireAuth>>,
): void {
  const viaAccounting = can(ctx, "accounting.post") && ctx.enabledModules.includes("akuntansi");
  const viaPos = can(ctx, "pos.sell") && ctx.enabledModules.includes("pos");
  if (viaAccounting || viaPos) return;
  const moduleKey: ModuleKey = can(ctx, "accounting.post") ? "akuntansi" : "pos";
  throw new AppError(
    "FORBIDDEN",
    `Modul ${MODULES[moduleKey].name} sedang dinonaktifkan untuk perusahaan ini.`,
  );
}

export async function payOpeningBalanceAction(input: {
  openingId: string;
  amount: string | number;
  accountId?: string;
  /** A-21 (R3-02): sumber dana kredit pihak (pengganti akun). */
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
    // Sama seperti halaman piutang-utang: pembayaran boleh oleh pemegang
    // accounting.post (akuntansi) maupun pos.sell (kasir untuk piutang).
    const ctx = await requireAuth();
    if (!can(ctx, "accounting.post") && !can(ctx, "pos.sell")) {
      throw new AppError("FORBIDDEN", "Anda tidak memiliki izin mencatat pembayaran.");
    }
    assertOpeningPaymentModule(ctx);
    const data = parseInput(
      z.object({
        openingId: z.string().uuid(),
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
        date: openingDateSchema.optional(),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, (tx) =>
      payOpeningBalance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        openingId: data.openingId,
        date: data.date ?? todayISO(),
        amount: data.amount,
        accountId: data.accountId,
        creditId: data.creditId,
        fee: data.fee,
        withholding: buildWithholdingInput(data),
        notes: data.notes,
        reference: data.reference,
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/akuntansi");
    // FIX-R2 Tahap 3 (RV2-01): teruskan peringatan penjaga saldo kas/bank.
    return { number: result.number, paymentId: result.paymentId, warnings: result.warnings };
  });
}

export async function voidOpeningBalanceAction(input: { openingId: string; reason: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({ openingId: z.string().uuid(), reason: z.string().trim().min(3).max(200) }),
      input,
    );
    const doc = await withCompany(ctx.company.id, (tx) =>
      voidOpeningBalance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        openingId: data.openingId,
        reason: data.reason,
        date: todayISO(),
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/akuntansi");
    return { id: doc.id, number: doc.number };
  });
}

export async function voidOpeningPaymentAction(input: { paymentId: string; reason: string }) {
  return guard(async () => {
    const ctx = await requireAuth();
    if (!can(ctx, "accounting.post") && !can(ctx, "pos.sell")) {
      throw new AppError("FORBIDDEN", "Anda tidak memiliki izin membatalkan pembayaran.");
    }
    assertOpeningPaymentModule(ctx);
    const data = parseInput(
      z.object({ paymentId: z.string().uuid(), reason: z.string().trim().min(3).max(200) }),
      input,
    );
    const result = await withCompany(ctx.company.id, (tx) =>
      voidOpeningPayment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        paymentId: data.paymentId,
        reason: data.reason,
        date: todayISO(),
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/akuntansi");
    return { id: data.paymentId, reversalNumber: result.reversalNumber };
  });
}
