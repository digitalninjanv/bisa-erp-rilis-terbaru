// A-26 Q8 (K-10): pecahan src/server/bank-reconciliation.ts per
// concern (akun / baris buku / mutasi / pencocokan / baca). Perilaku
// tidak berubah; jalur impor publik tetap lewat
// src/server/bank-reconciliation.ts (barrel).

import { createHash } from "node:crypto";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { bankStatementImports, bankStatementLines, journalEntries, journalLines } from "@/db/schema";
import { normalizePageParams, pageOffset, pageResult } from "@/lib/pagination";
import { toDb } from "@/lib/money";
import {
  parseStatementCsv,
  type ParsedStatementRow,
  type StatementRowError,
} from "@/lib/statement-csv";
import { requireReconciliationAccount } from "./accounts";

function statementFingerprint(accountId: string, row: ParsedStatementRow): string {
  const description = row.description.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update([accountId, row.date, description, row.debit.toFixed(4), row.credit.toFixed(4)].join("|"))
    .digest("hex");
}

/* ------------------------------------------------------------------ */
/* Import                                                              */

/* ------------------------------------------------------------------ */

export async function importStatement(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    accountId: string;
    fileName: string;
    csvText: string;
  },
): Promise<{
  importId: string;
  totalRows: number;
  insertedRows: number;
  skippedRows: number;
  errors: StatementRowError[];
}> {
  await requireReconciliationAccount(tx, input.companyId, input.accountId);
  const parsed = parseStatementCsv(input.csvText);

  const [batch] = await tx
    .insert(bankStatementImports)
    .values({
      companyId: input.companyId,
      accountId: input.accountId,
      fileName: input.fileName || "mutasi.csv",
      importedBy: input.userId,
      totalRows: parsed.totalRows,
      insertedRows: 0,
      skippedRows: 0,
    })
    .returning({ id: bankStatementImports.id });

  let inserted = 0;
  for (const row of parsed.rows) {
    const [created] = await tx
      .insert(bankStatementLines)
      .values({
        companyId: input.companyId,
        importId: batch.id,
        accountId: input.accountId,
        date: row.date,
        description: row.description,
        debit: toDb(row.debit),
        credit: toDb(row.credit),
        fingerprint: statementFingerprint(input.accountId, row),
        createdBy: input.userId,
      })
      .onConflictDoNothing({
        target: [bankStatementLines.companyId, bankStatementLines.fingerprint],
      })
      .returning({ id: bankStatementLines.id });
    if (created) inserted += 1;
  }
  const skipped = parsed.rows.length - inserted;

  await tx
    .update(bankStatementImports)
    .set({ insertedRows: inserted, skippedRows: skipped })
    .where(eq(bankStatementImports.id, batch.id));

  return {
    importId: batch.id,
    totalRows: parsed.totalRows,
    insertedRows: inserted,
    skippedRows: skipped,
    errors: parsed.errors,
  };
}

/* ------------------------------------------------------------------ */
/* Book lines (candidates)                                             */
/* ------------------------------------------------------------------ */

export async function listStatementLines(
  tx: Tx,
  companyId: string,
  accountId: string,
  opts: { status?: "all" | "matched" | "unmatched"; page?: number; pageSize?: number } = {},
) {
  const { page, pageSize } = normalizePageParams(opts, 50);
  const status = opts.status ?? "all";
  const statusCondition =
    status === "matched"
      ? isNotNull(bankStatementLines.matchedJournalLineId)
      : status === "unmatched"
        ? isNull(bankStatementLines.matchedJournalLineId)
        : sql`true`;
  const where = and(
    eq(bankStatementLines.companyId, companyId),
    eq(bankStatementLines.accountId, accountId),
    statusCondition,
  );

  const rows = await tx
    .select({
      id: bankStatementLines.id,
      date: bankStatementLines.date,
      description: bankStatementLines.description,
      debit: bankStatementLines.debit,
      credit: bankStatementLines.credit,
      matchedJournalLineId: bankStatementLines.matchedJournalLineId,
      matchedEntryNumber: journalEntries.number,
      matchedEntryDate: journalEntries.date,
      importFileName: bankStatementImports.fileName,
    })
    .from(bankStatementLines)
    .leftJoin(
      journalLines,
      eq(bankStatementLines.matchedJournalLineId, journalLines.id),
    )
    .leftJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .leftJoin(bankStatementImports, eq(bankStatementLines.importId, bankStatementImports.id))
    .where(where)
    .orderBy(desc(bankStatementLines.date), desc(bankStatementLines.createdAt), desc(bankStatementLines.id))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));

  const [totalRow] = await tx
    .select({ value: count() })
    .from(bankStatementLines)
    .where(where);

  return pageResult(rows, totalRow?.value ?? 0, page, pageSize);
}

export async function listStatementImports(tx: Tx, companyId: string, accountId: string) {
  return tx
    .select()
    .from(bankStatementImports)
    .where(
      and(eq(bankStatementImports.companyId, companyId), eq(bankStatementImports.accountId, accountId)),
    )
    .orderBy(desc(bankStatementImports.createdAt))
    .limit(10);
}
