/**
 * A-26 Q6 (K-10): sidik isi berkas impor & deteksi duplikat antar-job
 * (berpindah utuh dari src/server/import-files.ts; fasad lama tetap
 * me-re-export dari folder domain impor ini).
 */

import { createHash } from "node:crypto";
import { and, eq, exists, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import { importJobs, importRows } from "@/db/schema";

/**
 * GDG3-15: sidik isi berkas impor (SHA-256 atas byte mentah berkas).
 * Dua unggahan dengan byte identik menghasilkan sidik yang sama walau
 * nama berkasnya berbeda — itulah yang membuat impor ulang berkas yang
 * sama dapat dikenali sebelum stok/saldo awal diterapkan dua kali.
 */
export function hashImportFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export type AppliedImportDuplicate = {
  id: string;
  fileName: string;
  createdAt: Date;
};

/**
 * Cari job impor LAIN di perusahaan yang sama dengan sidik berkas yang
 * sama dan datanya SUDAH diterapkan (status completed, atau memiliki
 * baris berstatus imported). Job pratinjau yang belum pernah di-commit
 * dan job yang dibatalkan TIDAK menghalangi: mengunggah ulang sesudah
 * pratinjau terbengkalai adalah alur yang sah.
 */
export async function findAppliedImportDuplicate(
  tx: Tx,
  input: { companyId: string; fileHash: string; excludeJobId?: string },
): Promise<AppliedImportDuplicate | null> {
  const notSelf = input.excludeJobId ? ne(importJobs.id, input.excludeJobId) : undefined;
  const [row] = await tx
    .select({ id: importJobs.id, fileName: importJobs.fileName, createdAt: importJobs.createdAt })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.companyId, input.companyId),
        eq(importJobs.fileHash, input.fileHash),
        notSelf,
        exists(
          tx
            .select({ one: importRows.id })
            .from(importRows)
            .where(
              and(
                eq(importRows.jobId, importJobs.id),
                eq(importRows.companyId, input.companyId),
                eq(importRows.status, "imported"),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  if (row) return row;
  const [completed] = await tx
    .select({ id: importJobs.id, fileName: importJobs.fileName, createdAt: importJobs.createdAt })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.companyId, input.companyId),
        eq(importJobs.fileHash, input.fileHash),
        notSelf,
        eq(importJobs.status, "completed"),
      ),
    )
    .limit(1);
  return completed ?? null;
}

/** Pesan penolakan impor ulang — menyebut job asal dengan jelas. */
export function duplicateImportMessage(duplicate: AppliedImportDuplicate): string {
  const when = duplicate.createdAt.toISOString().slice(0, 10);
  return (
    `Berkas ini identik dengan berkas "${duplicate.fileName}" yang diunggah pada ${when} dan datanya sudah diterapkan. ` +
    "Mengimpor berkas yang sama lagi akan menggandakan stok/saldo awal. " +
    "Bila memang ada perubahan, unggah berkas dengan isi yang berbeda."
  );
}
