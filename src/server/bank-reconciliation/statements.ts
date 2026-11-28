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
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/server/audit";
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
    /** Saldo akhir pada rekening koran (opsional, untuk sign-off). */
    statementEndingBalance?: string | null;
    /** Tanggal cut-off saldo akhir koran (wajib bila saldo diisi). */
    statementEndDate?: string | null;
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
      statementEndingBalance: input.statementEndingBalance
        ? toDb(input.statementEndingBalance)
        : null,
      statementEndDate: input.statementEndDate || null,
    })
    .returning({ id: bankStatementImports.id });

  let inserted = 0;
  const CHUNK_SIZE = 500;
  for (let i = 0; i < parsed.rows.length; i += CHUNK_SIZE) {
    const chunk = parsed.rows.slice(i, i + CHUNK_SIZE);
    const createdRows = await tx
      .insert(bankStatementLines)
      .values(
        chunk.map((row) => ({
          companyId: input.companyId,
          importId: batch.id,
          accountId: input.accountId,
          date: row.date,
          description: row.description,
          debit: toDb(row.debit),
          credit: toDb(row.credit),
          fingerprint: statementFingerprint(input.accountId, row),
          createdBy: input.userId,
        })),
      )
      .onConflictDoNothing({
        target: [bankStatementLines.companyId, bankStatementLines.fingerprint],
      })
      .returning({ id: bankStatementLines.id });
    inserted += createdRows.length;
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
    .select({
      id: bankStatementImports.id,
      companyId: bankStatementImports.companyId,
      accountId: bankStatementImports.accountId,
      fileName: bankStatementImports.fileName,
      importedBy: bankStatementImports.importedBy,
      totalRows: bankStatementImports.totalRows,
      insertedRows: bankStatementImports.insertedRows,
      skippedRows: bankStatementImports.skippedRows,
      statementEndingBalance: bankStatementImports.statementEndingBalance,
      statementEndDate: bankStatementImports.statementEndDate,
      reconciledAt: bankStatementImports.reconciledAt,
      reconciledBy: bankStatementImports.reconciledBy,
      createdAt: bankStatementImports.createdAt,
      matchedCount: sql<number>`count(${bankStatementLines.matchedJournalLineId})::int`,
      unmatchedCount: sql<number>`(count(${bankStatementLines.id}) - count(${bankStatementLines.matchedJournalLineId}))::int`,
    })
    .from(bankStatementImports)
    .leftJoin(
      bankStatementLines,
      and(
        eq(bankStatementLines.companyId, bankStatementImports.companyId),
        eq(bankStatementLines.importId, bankStatementImports.id),
      ),
    )
    .where(
      and(eq(bankStatementImports.companyId, companyId), eq(bankStatementImports.accountId, accountId)),
    )
    .groupBy(bankStatementImports.id)
    .orderBy(desc(bankStatementImports.createdAt))
    .limit(10);
}

/**
 * Menandai satu berkas impor sebagai selesai direkonsiliasi. Semua
 * barisnya wajib sudah tertaut ke jurnal; kalau masih ada yang belum,
 * pengguna harus menyelesaikannya (match atau buat jurnal) lebih dulu.
 */
export async function markStatementImportReconciled(
  tx: Tx,
  input: { companyId: string; userId: string; importId: string },
) {
  const [batch] = await tx
    .select()
    .from(bankStatementImports)
    .where(
      and(
        eq(bankStatementImports.companyId, input.companyId),
        eq(bankStatementImports.id, input.importId),
      ),
    )
    .limit(1)
    .for("update");
  if (!batch) throw new AppError("NOT_FOUND", "Berkas impor mutasi tidak ditemukan.");
  if (batch.reconciledAt) {
    throw new AppError("INVALID_STATE", "Berkas impor ini sudah ditandai selesai.");
  }
  const [stats] = await tx
    .select({
      total: count(),
      matched: sql<number>`count(*) filter (where ${bankStatementLines.matchedJournalLineId} is not null)::int`,
    })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.companyId, input.companyId),
        eq(bankStatementLines.importId, input.importId),
      ),
    );
  const unmatched = (stats?.total ?? 0) - Number(stats?.matched ?? 0);
  if (unmatched > 0) {
    throw new AppError(
      "INVALID_STATE",
      `Masih ada ${unmatched} baris mutasi yang belum tertaut. Tautkan atau buat jurnal untuk baris tersebut sebelum menandai rekonsiliasi selesai.`,
    );
  }
  await tx
    .update(bankStatementImports)
    .set({ reconciledAt: new Date(), reconciledBy: input.userId })
    .where(
      and(
        eq(bankStatementImports.companyId, input.companyId),
        eq(bankStatementImports.id, input.importId),
      ),
    );
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "bank_reconciliation.complete",
    entityType: "bank_statement_import",
    entityId: input.importId,
    after: { fileName: batch.fileName, reconciled: true },
  });
  return { id: input.importId };
}

/**
 * Menghapus berkas impor beserta barisnya. Ditolak bila sudah
 * direkonsiliasi atau salah satu barisnya sudah tertaut ke jurnal —
 * hapus tautan lebih dulu agar jurnal tidak kehilangan pasangan.
 */
export async function deleteStatementImport(
  tx: Tx,
  input: { companyId: string; userId: string; importId: string },
) {
  const [batch] = await tx
    .select()
    .from(bankStatementImports)
    .where(
      and(
        eq(bankStatementImports.companyId, input.companyId),
        eq(bankStatementImports.id, input.importId),
      ),
    )
    .limit(1)
    .for("update");
  if (!batch) throw new AppError("NOT_FOUND", "Berkas impor mutasi tidak ditemukan.");
  if (batch.reconciledAt) {
    throw new AppError(
      "INVALID_STATE",
      "Berkas impor ini sudah ditandai selesai dan tidak dapat dihapus.",
    );
  }
  const [matched] = await tx
    .select({ value: count() })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.companyId, input.companyId),
        eq(bankStatementLines.importId, input.importId),
        isNotNull(bankStatementLines.matchedJournalLineId),
      ),
    );
  if ((matched?.value ?? 0) > 0) {
    throw new AppError(
      "INVALID_STATE",
      `Masih ada ${matched.value} baris yang tertaut ke jurnal. Lepas tautannya sebelum menghapus berkas impor.`,
    );
  }
  await tx
    .delete(bankStatementImports)
    .where(
      and(
        eq(bankStatementImports.companyId, input.companyId),
        eq(bankStatementImports.id, input.importId),
      ),
    );
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "bank_reconciliation.delete_import",
    entityType: "bank_statement_import",
    entityId: input.importId,
    before: { fileName: batch.fileName, insertedRows: batch.insertedRows },
  });
  return { id: input.importId };
}
