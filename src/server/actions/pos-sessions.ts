"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import { toDb } from "@/lib/money";
import {
  cashDrawerMovement,
  closeCashSession,
  issueSessionCloseToken,
  openCashSession,
  previewCashSession,
  verifySessionCloseToken,
} from "@/server/pos";

export async function openSessionAction(input: {
  openingCash: string | number;
  branchId?: string | null;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.session", "pos");
    const data = parseInput(
      z.object({
        openingCash: z.union([z.string(), z.number()]),
        branchId: z.string().uuid().nullish(),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, (tx) =>
      openCashSession(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        branchId: data.branchId ?? null,
        openingCash: data.openingCash,
      }),
    );
    revalidatePath("/app/pos/sesi");
    revalidatePath("/app/pos");
    return result;
  });
}

/**
 * Fase 1 tutup sesi: kasir menyerahkan hitungan fisik, server mengunci
 * expected + selisih ke token berumur pendek. Angka pembanding baru
 * dikembalikan SESUDAH hitungan diserahkan, sehingga hitungan awal tidak
 * ter-anchor pada target.
 */
export async function prepareSessionCloseAction(input: {
  sessionId: string;
  countedCash: string | number;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.session", "pos");
    const data = parseInput(
      z.object({
        sessionId: z.string().uuid(),
        countedCash: z.union([z.string(), z.number()]),
      }),
      input,
    );
    return withCompany(ctx.company.id, async (tx) => {
      const preview = await previewCashSession(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
      });
      const locked = await issueSessionCloseToken(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
        counted: data.countedCash,
        expected: toDb(preview.expected),
      });
      return { ...locked, tolerance: toDb(preview.tolerance) };
    });
  });
}

export async function closeSessionAction(input: {
  sessionId: string;
  countedCash: string | number;
  countToken?: string;
  notes?: string;
  differenceReason?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.session", "pos");
    const data = parseInput(
      z.object({
        sessionId: z.string().uuid(),
        countedCash: z.union([z.string(), z.number()]),
        countToken: z.string().min(8).optional(),
        notes: z.string().max(300).optional(),
        differenceReason: z.string().max(300).optional(),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, async (tx) => {
      if (!data.countToken) {
        throw new AppError(
          "CONFLICT",
          "Kunci hitungan fisik wajib ada. Kunci hitungan terlebih dahulu sebelum menutup sesi.",
        );
      }
      const verified = await verifySessionCloseToken(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
        counted: data.countedCash,
        token: data.countToken,
      });
      return closeCashSession(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
        countedCash: data.countedCash,
        notes: data.notes,
        differenceReason: data.differenceReason,
        expectedGuard: verified.expected,
      });
    });
    revalidatePath("/app/pos/sesi");
    revalidatePath("/app/pos");
    return result;
  });
}

/**
 * Force-close sesi kasir lain. Tindakan supervisor (`pos.void`) dengan
 * hitungan fisik dan alasan selisih yang sama seperti tutup normal; audit
 * mencatat aktor, kasir target, dan penanda `forced`.
 */
export async function forceCloseSessionAction(input: {
  sessionId: string;
  countedCash: string | number;
  notes?: string;
  differenceReason?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(
      z.object({
        sessionId: z.string().uuid(),
        countedCash: z.union([z.string(), z.number()]),
        notes: z.string().max(300).optional(),
        differenceReason: z.string().max(300).optional(),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, (tx) =>
      closeCashSession(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
        countedCash: data.countedCash,
        notes: data.notes,
        differenceReason: data.differenceReason,
        allowAnyUser: true,
      }),
    );
    revalidatePath("/app/pos/sesi");
    revalidatePath(`/app/pos/sesi/riwayat/${data.sessionId}`);
    revalidatePath("/app/pos");
    return result;
  });
}

export async function cashMovementAction(input: {
  sessionId: string;
  type: "deposit" | "withdrawal";
  amount: string | number;
  notes?: string;
  idempotencyKey?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.session", "pos");
    const data = parseInput(
      z.object({
        sessionId: z.string().uuid(),
        type: z.enum(["deposit", "withdrawal"]),
        amount: z.union([z.string(), z.number()]),
        notes: z.string().max(300).optional(),
        idempotencyKey: z.string().min(8).max(128).optional(),
      }),
      input,
    );
    await withCompany(ctx.company.id, (tx) =>
      cashDrawerMovement(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
        type: data.type,
        amount: data.amount,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey,
      }),
    );
    revalidatePath("/app/pos/sesi");
    return { ok: true };
  });
}
