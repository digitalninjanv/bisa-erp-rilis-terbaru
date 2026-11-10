import { and, count, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { importJobs, importRows } from "@/db/schema";
import { writeAudit } from "@/server/audit";

/**
 * A-26 Q6 (K-10): helper bersama internal domain impor di
 * src/server/import/ (pecahan src/server/import-masters.ts) — tipe
 * baris job serta penanda hasil baris & finalisasi job yang dipakai
 * analisis dan semua jalur commit. Bukan permukaan publik modul;
 * permukaan publik ada di index.ts folder ini.
 */

export type JobRow = typeof importJobs.$inferSelect;
export type RowData = Record<string, unknown>;
export type Mapping = Partial<Record<string, string>>;

export async function markRow(
  tx: Tx,
  rowId: string,
  status: "imported" | "skipped" | "error",
  error: string | null,
  entityId?: string | null,
) {
  await tx
    .update(importRows)
    .set({ status, error, ...(entityId !== undefined ? { entityId } : {}) })
    .where(eq(importRows.id, rowId));
}


export async function finalizeJob(
  tx: Tx,
  input: { companyId: string; userId: string; job: JobRow; imported: number; failed: number; extraSummary?: Record<string, unknown> },
) {
  const [pendingRow] = await tx
    .select({ value: count() })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, input.companyId),
        eq(importRows.jobId, input.job.id),
        eq(importRows.status, "pending"),
      ),
    );
  const remaining = pendingRow?.value ?? 0;
  const previous = (input.job.summary ?? {}) as Record<string, unknown>;
  await tx
    .update(importJobs)
    .set({
      successRows: input.job.successRows + input.imported,
      failedRows: input.job.failedRows + input.failed,
      status: remaining === 0 ? "completed" : "preview",
      summary: { ...previous, ...(input.extraSummary ?? {}), updatedAt: new Date().toISOString() },
    })
    .where(and(eq(importJobs.companyId, input.companyId), eq(importJobs.id, input.job.id)));

  if (remaining === 0) {
    await writeAudit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      action: "import.complete",
      entityType: "import_job",
      entityId: input.job.id,
      after: {
        fileName: input.job.fileName,
        entity: input.job.entity,
        imported: input.job.successRows + input.imported,
        failed: input.job.failedRows + input.failed,
      },
    });
  }
  return remaining;
}
