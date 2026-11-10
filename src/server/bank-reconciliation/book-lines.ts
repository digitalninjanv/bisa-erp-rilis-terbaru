// A-26 Q8 (K-10): pecahan src/server/bank-reconciliation.ts per
// concern (akun / baris buku / mutasi / pencocokan / baca). Perilaku
// tidak berubah; jalur impor publik tetap lewat
// src/server/bank-reconciliation.ts (barrel).

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { bankStatementLines, journalEntries, journalLines } from "@/db/schema";

/** Posted journal lines that are still "live": not a reversal and not reversed. */
function liveBookLineWhere(companyId: string, accountId: string) {
  return and(
    eq(journalLines.companyId, companyId),
    eq(journalLines.accountId, accountId),
    eq(journalEntries.status, "posted"),
    isNull(journalEntries.reversalOfId),
    sql`not exists (select 1 from journal_entries rev where rev.reversal_of_id = ${journalEntries.id} and rev.status = 'posted')`,
  );
}

export type BookLineRow = {
  id: string;
  entryId: string;
  entryNumber: string;
  date: string;
  description: string | null;
  debit: string;
  credit: string;
};

export async function loadBookLines(tx: Tx, companyId: string, accountId: string): Promise<BookLineRow[]> {
  return tx
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
      date: journalEntries.date,
      description: journalEntries.description,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(liveBookLineWhere(companyId, accountId))
    .orderBy(asc(journalEntries.date), asc(journalLines.id));
}

export async function claimedJournalLineIds(
  tx: Tx,
  companyId: string,
  accountId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ journalLineId: bankStatementLines.matchedJournalLineId })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.companyId, companyId),
        eq(bankStatementLines.accountId, accountId),
        isNotNull(bankStatementLines.matchedJournalLineId),
      ),
    );
  return new Set(rows.map((row) => row.journalLineId).filter((id): id is string => Boolean(id)));
}
