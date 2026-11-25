"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  autoMatch,
  createJournalFromLine,
  importStatement,
  matchLine,
  unmatchLine,
} from "@/server/bank-reconciliation";
import { requirePermissionInModule } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";

const PAGE_PATH = "/app/akuntansi/rekonsiliasi";

const importSchema = z.object({
  accountId: z.string().uuid("Akun bank wajib dipilih."),
  fileName: z.string().max(200).optional(),
  csvText: z.string().min(1, "Isi CSV mutasi tidak boleh kosong.").max(2_000_000),
});

export async function importStatementAction(input: z.input<typeof importSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(importSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      importStatement(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        accountId: data.accountId,
        fileName: data.fileName ?? "mutasi.csv",
        csvText: data.csvText,
      }),
    );
    revalidatePath(PAGE_PATH);
    return result;
  });
}

const accountSchema = z.object({
  accountId: z.string().uuid("Akun bank wajib dipilih."),
});

export async function autoMatchAction(input: z.input<typeof accountSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(accountSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      autoMatch(tx, { companyId: ctx.company.id, accountId: data.accountId }),
    );
    revalidatePath(PAGE_PATH);
    return result;
  });
}

const matchSchema = z.object({
  statementLineId: z.string().uuid(),
  journalLineId: z.string().uuid(),
});

export async function matchLineAction(input: z.input<typeof matchSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(matchSchema, input);
    await withCompany(ctx.company.id, (tx) =>
      matchLine(tx, {
        companyId: ctx.company.id,
        statementLineId: data.statementLineId,
        journalLineId: data.journalLineId,
      }),
    );
    revalidatePath(PAGE_PATH);
    return { matched: true };
  });
}

const statementLineSchema = z.object({
  statementLineId: z.string().uuid(),
});

export async function unmatchLineAction(input: z.input<typeof statementLineSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(statementLineSchema, input);
    await withCompany(ctx.company.id, (tx) =>
      unmatchLine(tx, { companyId: ctx.company.id, statementLineId: data.statementLineId }),
    );
    revalidatePath(PAGE_PATH);
    return { unmatched: true };
  });
}

const createJournalSchema = z.object({
  statementLineId: z.string().uuid(),
  contraAccountId: z.string().uuid("Akun lawan wajib dipilih."),
  // A-21 (R3-12): baris lawan kedua opsional (potongan bank) — akun
  // dan nominal wajib datang berpasangan; domain memvalidasi
  // nominal & akunnya.
  secondContraAccountId: z.string().uuid().optional(),
  secondContraAmount: z.string().trim().max(40).optional(),
  date: z.string().min(10).max(10).optional(),
  description: z.string().max(300).optional(),
});

export async function createJournalFromLineAction(input: z.input<typeof createJournalSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(createJournalSchema, input);
    if (Boolean(data.secondContraAccountId) !== Boolean(data.secondContraAmount)) {
      throw new AppError(
        "VALIDATION",
        "Baris lawan kedua memerlukan akun dan nominal sekaligus — isi keduanya atau kosongkan keduanya.",
      );
    }
    const result = await withCompany(ctx.company.id, (tx) =>
      createJournalFromLine(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        statementLineId: data.statementLineId,
        contraAccountId: data.contraAccountId,
        secondContra:
          data.secondContraAccountId && data.secondContraAmount
            ? { accountId: data.secondContraAccountId, amount: data.secondContraAmount }
            : undefined,
        date: data.date,
        description: data.description,
      }),
    );
    revalidatePath(PAGE_PATH);
    return result;
  });
}
