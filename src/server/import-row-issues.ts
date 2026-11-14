import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { importRows } from "@/db/schema";

const ROW_ISSUE_UPDATE_BATCH_SIZE = 500;
type ImportRowIssue = { id: string; status: string; issue: string | null };

export function chunkPendingImportRowIssues(rowIssues: ImportRowIssue[]) {
  const pending = rowIssues.filter((row) => row.status === "pending");
  const batches: ImportRowIssue[][] = [];
  for (let offset = 0; offset < pending.length; offset += ROW_ISSUE_UPDATE_BATCH_SIZE) {
    batches.push(pending.slice(offset, offset + ROW_ISSUE_UPDATE_BATCH_SIZE));
  }
  return batches;
}

/**
 * Persist analyzed row issues without issuing one UPDATE round-trip per row.
 * The company, job, and pending-state predicates keep this bulk write scoped
 * to the rows this analysis is allowed to change.
 */
export async function persistPendingImportRowIssues(
  tx: Tx,
  companyId: string,
  jobId: string,
  rowIssues: ImportRowIssue[],
) {
  for (const batch of chunkPendingImportRowIssues(rowIssues)) {
    const cases = sql.join(
      batch.map(({ id, issue }) => sql`when ${importRows.id} = ${id} then ${issue}`),
      sql` `,
    );

    await tx
      .update(importRows)
      .set({ error: sql<string | null>`case ${cases} else ${importRows.error} end` })
      .where(
        and(
          eq(importRows.companyId, companyId),
          eq(importRows.jobId, jobId),
          eq(importRows.status, "pending"),
          inArray(importRows.id, batch.map(({ id }) => id)),
        ),
      );
  }
}
