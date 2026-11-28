// A-26 Q6 (K-10): pecahan src/server/actions/import.ts per tahap
// wizard impor. Nama aksi, skema Zod, izin, & payload tidak berubah;
// pemanggil kini mengimpor dari berkas sub-domain ini langsung
// (re-export silang antar berkas "use server" tidak dipakai —
// pelajaran A-24 T2).

"use server";

import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { importJobs, importRows } from "@/db/schema";
import { requirePermissionInModule } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { writeAudit } from "@/server/audit";
import { importFallbackSku, mapProductRow, type ImportField } from "@/lib/import-parse";
import { productRowMatchesFilter, type ProductImportFilter } from "@/lib/import-classify";
import { assertMasterEntity, mapMasterRow, masterPreview } from "@/server/import-masters";
import { analyzeProductJob, loadClassifiedProductRows } from "./shared";

export async function listImportRowsAction(input: {
  jobId: string;
  page?: number;
  pageSize?: number;
  filter?: ProductImportFilter;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("import.manage", "gudang");
    const data = parseInput(
      z.object({
        jobId: z.string().uuid(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(10).max(200).optional(),
        filter: z
          .enum([
            "all",
            "problem",
            "valid",
            "complete",
            "incomplete",
            "barcode_empty",
            "sale_price_empty",
            "cost_price_empty",
            "duplicate",
          ])
          .optional(),
      }),
      input,
    );

    return withCompany(ctx.company.id, async (tx) => {
      const [job] = await tx
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.companyId, ctx.company.id), eq(importJobs.id, data.jobId)))
        .limit(1);
      if (!job) throw new AppError("NOT_FOUND", "Job impor tidak ditemukan.");
      const mapping = (job.mapping ?? {}) as Partial<Record<ImportField, string>>;

      const page = data.page ?? 1;
      const pageSize = data.pageSize ?? 50;

      if (job.entity === "products") {
        // A-10/D-21: jalur produk mengklasifikasikan seluruh baris di
        // memori (classifier murni lib/import-classify) supaya filter
        // kategori, hitungan, dan bendera per baris selalu dihitung dari
        // data baris terbaru — termasuk sesudah edit di tempat. Filter
        // lama tetap bermakna sama: "problem" = bermasalah, "valid" =
        // siap (pending tanpa masalah).
        const { rows: classifiedRows, counts } = await loadClassifiedProductRows(
          tx,
          ctx.company.id,
          data.jobId,
          mapping,
        );
        const filter = (data.filter ?? "all") as ProductImportFilter;
        const matched = classifiedRows.filter((row) => productRowMatchesFilter(row.flags, filter));
        return {
          job,
          mapping,
          rows: matched.slice((page - 1) * pageSize, page * pageSize),
          total: matched.length,
          page,
          pageSize,
          counts,
          filterRowNumbers: matched.map((row) => row.rowNumber),
          incompleteRowNumbers: classifiedRows
            .filter((row) => row.flags.belumLengkap)
            .map((row) => row.rowNumber),
          // Semua baris pending tanpa error boleh dipilih. Field opsional/
          // nilai kosong dipetakan ke default domain saat commit.
          selectableRowNumbers: classifiedRows
            .filter((row) => row.flags.siap)
            .map((row) => row.rowNumber),
          problemRowNumbers: classifiedRows
            .filter((row) => row.status === "pending" && row.flags.bermasalah)
            .map((row) => row.rowNumber),
        };
      }

      // GD-P2-7: analisis menyimpan isu baris bermasalah ke kolom `error`
      // (status tetap "pending"), jadi filter harus membaca keduanya —
      // "problem" = gagal saat commit ATAU punya isu analisis; "valid" =
      // pending tanpa isu. Total mengikuti filter agar pagination jujur.
      const filterCondition =
        data.filter === "problem"
          ? or(
              eq(importRows.status, "error"),
              and(eq(importRows.status, "pending"), isNotNull(importRows.error)),
            )
          : data.filter === "valid"
            ? and(eq(importRows.status, "pending"), isNull(importRows.error))
            : sql`true`;
      const rows = await tx
        .select()
        .from(importRows)
        .where(
          and(
            eq(importRows.companyId, ctx.company.id),
            eq(importRows.jobId, data.jobId),
            filterCondition,
          ),
        )
        .orderBy(asc(importRows.rowNumber))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [totalRow] = await tx
        .select({ value: count() })
        .from(importRows)
        .where(
          and(
            eq(importRows.companyId, ctx.company.id),
            eq(importRows.jobId, data.jobId),
            filterCondition,
          ),
        );

      return {
        job,
        mapping,
        rows: rows.map((row) => {
          const source = (row.data ?? {}) as Record<string, unknown>;
          if (job.entity !== "products") {
            // T4-5a: pratinjau master memakai label/detail generik dari
            // mapper entitasnya — bentuk produk di bawah tidak berubah.
            const mapped = mapMasterRow(
              assertMasterEntity(job.entity),
              source,
              mapping as Partial<Record<string, string>>,
            );
            return {
              id: row.id,
              rowNumber: row.rowNumber,
              status: row.status,
              error: row.error,
              preview: mapped.value ? masterPreview(mapped.value) : null,
              raw: source,
            };
          }
          const mapped = mapProductRow(source, mapping, importFallbackSku(row.rowNumber));
          return {
            id: row.id,
            rowNumber: row.rowNumber,
            status: row.status,
            error: row.error,
            preview: mapped.value ?? null,
            raw: source,
          };
        }),
        total: totalRow?.value ?? 0,
        page,
        pageSize,
      };
    });
  });
}

const EDITABLE_IMPORT_FIELDS = ["name", "sku", "barcode", "salePrice", "costPrice", "unit"] as const;

const editRowSchema = z.object({
  jobId: z.string().uuid(),
  rowNumber: z.number().int().min(1),
  fields: z
    .object({
      name: z.string().max(180).optional(),
      sku: z.string().max(60).optional(),
      barcode: z.string().max(60).optional(),
      salePrice: z.string().max(40).optional(),
      costPrice: z.string().max(40).optional(),
      unit: z.string().max(20).optional(),
    })
    .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
      message: "Tidak ada kolom yang diubah.",
    }),
});

/**
 * Edit baris pratinjau impor produk di tempat (A-10/D-21). Nilai edit
 * ditulis ke sel data baris di server (kolom terpetakan; kolom yang
 * belum dipetakan dibuatkan kolom sintetis `__edit_<field>` dan
 * pemetaannya disimpan), lalu analisis penuh dijalankan ulang dalam
 * transaksi yang sama — server tidak pernah mempercayai klasifikasi
 * klien, dan commit tetap memvalidasi ulang dari data tersimpan ini.
 */
export async function updateImportRowAction(input: z.input<typeof editRowSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("import.manage", "gudang");
    const data = parseInput(editRowSchema, input);

    const result = await withCompany(ctx.company.id, async (tx) => {
      const [job] = await tx
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.companyId, ctx.company.id), eq(importJobs.id, data.jobId)))
        .limit(1);
      if (!job) throw new AppError("NOT_FOUND", "Job impor tidak ditemukan.");
      if (job.entity !== "products") {
        throw new AppError("VALIDATION", "Edit baris hanya tersedia untuk impor produk.");
      }
      if (job.status === "completed" || job.status === "cancelled") {
        throw new AppError("INVALID_STATE", "Job impor sudah ditutup; barisnya tidak bisa diubah.");
      }

      const [row] = await tx
        .select()
        .from(importRows)
        .where(
          and(
            eq(importRows.companyId, ctx.company.id),
            eq(importRows.jobId, data.jobId),
            eq(importRows.rowNumber, data.rowNumber),
          ),
        )
        .limit(1);
      if (!row) throw new AppError("NOT_FOUND", "Baris impor tidak ditemukan.");
      if (row.status !== "pending") {
        throw new AppError("INVALID_STATE", "Baris ini sudah diproses dan tidak bisa diubah.");
      }

      const mapping = { ...((job.mapping ?? {}) as Partial<Record<ImportField, string>>) };
      const source = { ...((row.data ?? {}) as Record<string, unknown>) };
      const editedFields = new Set<string>(
        Array.isArray(source.__editedFields) ? (source.__editedFields as string[]) : [],
      );
      for (const field of EDITABLE_IMPORT_FIELDS) {
        const value = data.fields[field];
        if (value === undefined) continue;
        let column = mapping[field];
        if (!column) {
          column = `__edit_${field}`;
          mapping[field] = column;
        }
        source[column] = value;
        editedFields.add(field);
      }
      source.__editedFields = [...editedFields];
      await tx.update(importRows).set({ data: source }).where(eq(importRows.id, row.id));

      // Analisis ulang penuh dalam transaksi yang sama: isu tersimpan
      // semua baris pending menjadi segar (duplikat bisa berubah di
      // baris lain), dan pemetaan baru ikut tersimpan oleh analisis.
      const { summary } = await analyzeProductJob(tx, ctx.company.id, data.jobId, mapping);
      const { rows, counts } = await loadClassifiedProductRows(tx, ctx.company.id, data.jobId, mapping);
      const updated = rows.find((item) => item.rowNumber === data.rowNumber);
      if (!updated) throw new AppError("NOT_FOUND", "Baris impor tidak ditemukan.");
      return { row: updated, counts, summary, mapping };
    });
    revalidatePath("/app/gudang/impor");
    return result;
  });
}

export async function cancelImportAction(jobId: string) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("import.manage", "gudang");
    const data = parseInput(z.string().uuid(), jobId);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const [job] = await tx
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.companyId, ctx.company.id), eq(importJobs.id, data)))
        .limit(1);
      if (!job) throw new AppError("NOT_FOUND", "Job impor tidak ditemukan.");
      if (job.status === "cancelled") {
        throw new AppError("INVALID_STATE", "Job impor ini sudah dibatalkan.");
      }

      // GD-P2-8: membatalkan tidak boleh menghapus jejak. Bila sebagian
      // baris sudah ter-commit, produk/stoknya sudah masuk dan menghapus
      // riwayatnya akan menghilangkan bukti impor — tolak dengan
      // ringkasan dampak dan arahkan ke koreksi yang sah.
      const [importedRow] = await tx
        .select({ value: count() })
        .from(importRows)
        .where(
          and(
            eq(importRows.companyId, ctx.company.id),
            eq(importRows.jobId, data),
            eq(importRows.status, "imported"),
          ),
        );
      const importedCount = importedRow?.value ?? 0;
      if (job.status === "completed" || importedCount > 0) {
        const summary = (job.summary ?? {}) as Record<string, unknown>;
        const stockValue = Number(summary.importedStockValue ?? 0);
        const stockNote =
          stockValue > 0
            ? `, termasuk stok awal senilai Rp${stockValue.toLocaleString("id-ID")}`
            : "";
        throw new AppError(
          "CONFLICT",
          `Impor ini tidak bisa dibatalkan: ${importedCount} baris sudah ter-commit menjadi produk${stockNote}. ` +
            "Membatalkan sekarang akan menghilangkan jejak audit impor sementara produk dan stoknya tetap ada. " +
            "Koreksi yang sah: nonaktifkan produk hasil impor dari daftar produk, atau buat dokumen penyesuaian stok untuk mengeluarkan stoknya.",
        );
      }

      // Belum ada yang ter-commit: tandai batal, jangan hapus. Baris
      // pending ikut berstatus "cancelled"; baris yang sudah berstatus
      // akhir (skipped/error) mempertahankan riwayatnya sendiri.
      const cancelledRows = await tx
        .update(importRows)
        .set({ status: "cancelled", error: "Impor dibatalkan" })
        .where(
          and(
            eq(importRows.companyId, ctx.company.id),
            eq(importRows.jobId, data),
            eq(importRows.status, "pending"),
          ),
        )
        .returning({ id: importRows.id });

      await tx
        .update(importJobs)
        .set({ status: "cancelled" })
        .where(and(eq(importJobs.companyId, ctx.company.id), eq(importJobs.id, data)));

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "import.cancel",
        entityType: "import_job",
        entityId: data,
        after: { fileName: job.fileName, cancelledRows: cancelledRows.length },
      });

      return { status: "cancelled" as const, cancelledRows: cancelledRows.length };
    });
    revalidatePath("/app/gudang/impor");
    return result;
  });
}

export async function skipImportRowsAction(input: {
  jobId: string;
  rowNumbers: number[];
  keepError?: boolean;
  reason?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("import.manage", "gudang");
    const data = parseInput(
      z.object({
        jobId: z.string().uuid(),
        rowNumbers: z.array(z.number().int()).max(1000),
        // A-10/D-21: baris bermasalah yang dilewati wizard produk
        // mempertahankan isu analisisnya sebagai alasan lewatinya,
        // bukan pesan generik.
        keepError: z.boolean().optional(),
        // Alasan eksplisit (mis. baris belum lengkap).
        reason: z.string().trim().min(1).max(300).optional(),
      }),
      input,
    );
    if (data.rowNumbers.length === 0) return { skipped: 0 };
    const updated = await withCompany(ctx.company.id, async (tx) =>
      tx
        .update(importRows)
        .set(
          data.reason
            ? { status: "skipped", error: data.reason }
            : data.keepError
              ? { status: "skipped" }
              : { status: "skipped", error: "Dilewati saat pratinjau" },
        )
        .where(
          and(
            eq(importRows.companyId, ctx.company.id),
            eq(importRows.jobId, data.jobId),
            eq(importRows.status, "pending"),
            inArray(importRows.rowNumber, data.rowNumbers),
          ),
        )
        // GD-P3-3: laporkan jumlah yang benar-benar berubah, bukan
        // jumlah yang diminta (baris tak dikenal/sudah diproses tidak
        // ikut terhitung).
        .returning({ id: importRows.id }),
    );
    return { skipped: updated.length };
  });
}
