"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  autoMatch,
  createJournalFromLine,
  deleteStatementImport,
  importStatement,
  markStatementImportReconciled,
  matchLine,
  unmatchLine,
} from "@/server/bank-reconciliation";
import { requirePermissionInModule } from "@/lib/session";
import { writeAudit } from "@/server/audit";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { d } from "@/lib/money";

const PAGE_PATH = "/app/akuntansi/rekonsiliasi";

const importSchema = z.object({
  accountId: z.string().uuid("Akun bank wajib dipilih."),
  fileName: z.string().max(200).optional(),
  csvText: z.string().min(1, "Isi CSV mutasi tidak boleh kosong.").max(2_000_000),
  statementEndingBalance: z
    .string()
    .trim()
    .max(40)
    .refine((value) => {
      try {
        return d(value).isFinite();
      } catch {
        return false;
      }
    }, "Saldo akhir rekening koran tidak valid.")
    .optional(),
  statementEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD.").optional(),
});

export async function importStatementAction(input: z.input<typeof importSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(importSchema, input);
    if (Boolean(data.statementEndingBalance) !== Boolean(data.statementEndDate)) {
      throw new AppError(
        "VALIDATION",
        "Saldo akhir rekening koran dan tanggal cut-off harus diisi bersama.",
      );
    }
    const result = await withCompany(ctx.company.id, async (tx) => {
      const imported = await importStatement(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        accountId: data.accountId,
        fileName: data.fileName ?? "mutasi.csv",
        csvText: data.csvText,
        statementEndingBalance: data.statementEndingBalance,
        statementEndDate: data.statementEndDate,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "bank_reconciliation.import",
        entityType: "bank_statement_import",
        entityId: imported.importId,
        after: { accountId: data.accountId, fileName: data.fileName ?? "mutasi.csv" },
      });
      return imported;
    });
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
    const result = await withCompany(ctx.company.id, async (tx) => {
      const matched = await autoMatch(tx, { companyId: ctx.company.id, accountId: data.accountId });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "bank_reconciliation.auto_match",
        entityType: "account",
        entityId: data.accountId,
        after: { ...matched },
      });
      return matched;
    });
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
    await withCompany(ctx.company.id, async (tx) => {
      await matchLine(tx, {
        companyId: ctx.company.id,
        statementLineId: data.statementLineId,
        journalLineId: data.journalLineId,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "bank_reconciliation.match",
        entityType: "bank_statement_line",
        entityId: data.statementLineId,
        after: { journalLineId: data.journalLineId },
      });
    });
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
    await withCompany(ctx.company.id, async (tx) => {
      await unmatchLine(tx, { companyId: ctx.company.id, statementLineId: data.statementLineId });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "bank_reconciliation.unmatch",
        entityType: "bank_statement_line",
        entityId: data.statementLineId,
      });
    });
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
    const result = await withCompany(ctx.company.id, async (tx) => {
      const created = await createJournalFromLine(tx, {
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
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "bank_reconciliation.create_journal",
        entityType: "bank_statement_line",
        entityId: data.statementLineId,
        after: { journalId: created.id ?? null, contraAccountId: data.contraAccountId },
      });
      return created;
    });
    revalidatePath(PAGE_PATH);
    return result;
  });
}


const importIdSchema = z.object({ importId: z.string().uuid("Berkas impor tidak valid.") });

export async function markStatementImportReconciledAction(input: z.input<typeof importIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(importIdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      markStatementImportReconciled(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        importId: data.importId,
      }),
    );
    revalidatePath(PAGE_PATH);
    return result;
  });
}

export async function deleteStatementImportAction(input: z.input<typeof importIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(importIdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      deleteStatementImport(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        importId: data.importId,
      }),
    );
    revalidatePath(PAGE_PATH);
    return result;
  });
}
