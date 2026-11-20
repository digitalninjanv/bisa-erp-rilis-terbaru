// A-26 Q6 (K-10): pecahan src/server/actions/import.ts per tahap
// wizard impor. Nama aksi, skema Zod, izin, & payload tidak berubah;
// pemanggil kini mengimpor dari berkas sub-domain ini langsung
// (re-export silang antar berkas "use server" tidak dipakai —
// pelajaran A-24 T2).
// A-26 Q8: badan aksi dipecah per fase bernama ke commit-phases.ts
// (validasi job → master → staging → persiapan batch → proses baris
// → jurnal → finalisasi); berkas ini tinggal orkestrasinya.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withCompany } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { isoDateField, parseInput } from "@/lib/action-validation";
import type { ImportField } from "@/lib/import-parse";
import {
  commitMasterEntity,
  finalizeImportJob,
  finishIfBatchEmpty,
  loadPendingProductRows,
  lockImportJob,
  postImportStockJournal,
  prepareProductBatch,
  processProductBatch,
} from "./commit-phases";
import { defaultWarehouse } from "./shared";

// GD-P3-3: field `offset` lama dihapus dari skema — tidak pernah dipakai
// (batching digerakkan status baris: setiap panggilan mengambil baris
// "pending" berikutnya), jadi mempertahankannya hanya menipu pemanggil.
const commitSchema = z.object({
  jobId: z.string().uuid(),
  mapping: z.record(z.string(), z.string().optional()),
  limit: z.number().int().min(1).max(500).default(200),
  updateExisting: z.boolean().default(false),
  importStock: z.boolean().default(true),
  warehouseId: z.string().uuid().optional(),
  // Tanggal cut-off migrasi (stok awal). Kosong = hari ini (WIB).
  date: isoDateField.optional(),
  selectedRows: z.array(z.number().int()).optional(),
});

export async function commitImportBatchAction(input: z.input<typeof commitSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("import.manage");
    const data = parseInput(commitSchema, input);

    const result = await withCompany(ctx.company.id, async (tx) => {
      const job = await lockImportJob(tx, ctx.company.id, data.jobId);
      const accountingImport = [
        "accounts",
        "account_mappings",
        "opening_payables",
        "opening_receivables",
      ].includes(job.entity);
      // Konteks sesi produksi selalu membawa role/permissions; beberapa
      // fixture lama hanya mengisi company/user. Jangan menurunkan izin
      // pada konteks yang memang tidak membawa role (fixture), tetapi
      // tolak konteks produksi yang tidak punya izin akuntansi.
      const hasRoleContext = Boolean(ctx.role) || Boolean(ctx.permissions?.length);
      if (
        accountingImport &&
        hasRoleContext &&
        !can(ctx, "accounting.manage") &&
        !can(ctx, "accounting.post")
      ) {
        throw new AppError(
          "FORBIDDEN",
          "Impor akun, pemetaan akun, dan saldo awal akuntansi memerlukan izin akuntansi (accounting.manage atau accounting.post).",
        );
      }

      const masterResult = await commitMasterEntity(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        job,
        data,
      });
      if (masterResult) return masterResult;

      const warehouseId = data.warehouseId ?? (await defaultWarehouse(tx, ctx.company.id));
      const mapping = Object.fromEntries(
        Object.entries(data.mapping).filter(([, value]) => Boolean(value)),
      ) as Partial<Record<ImportField, string>>;

      // MD-010: Impor yang memetakan kolom harga pokok/harga jual menuntut izin inventory.price
      const priceMapped = Boolean(mapping.costPrice || mapping.salePrice);
      if (priceMapped && ctx.role && !can(ctx, "inventory.price")) {
        throw new AppError(
          "FORBIDDEN",
          "Impor berkas yang memetakan kolom harga pokok atau harga jual memerlukan izin Ubah harga produk ('inventory.price'). Hapus pemetaan kolom harga atau minta pengguna berizin yang mengeksekusi impor ini.",
        );
      }

      const rows = await loadPendingProductRows(tx, {
        companyId: ctx.company.id,
        jobId: data.jobId,
        limit: data.limit,
        selectedRows: data.selectedRows,
      });
      if (rows.length === 0) {
        return finishIfBatchEmpty(tx, { companyId: ctx.company.id, job, jobId: data.jobId });
      }

      const batch = await prepareProductBatch(tx, {
        companyId: ctx.company.id,
        rows,
        mapping,
      });
      const processed = await processProductBatch(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        job,
        data,
        warehouseId,
        batch,
      });
      await postImportStockJournal(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        job,
        jobId: data.jobId,
        rows,
        stockValue: processed.stockValue,
        date: data.date,
      });
      return finalizeImportJob(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        job,
        jobId: data.jobId,
        processed: rows.length,
        imported: processed.imported,
        skipped: processed.skipped,
        failed: processed.failed,
        stockValue: processed.stockValue,
        stockQty: processed.stockQty,
      });
    });

    revalidatePath("/app/gudang/impor");
    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/pos");

    return result;
  });
}
