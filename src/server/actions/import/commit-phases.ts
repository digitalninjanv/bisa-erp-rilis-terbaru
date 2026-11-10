// A-26 Q8: fase-fase commit impor produk — dipecah dari
// commitImportBatchAction (517 baris) per tahap bernama: kunci &
// validasi job → commit entitas master (non-produk) → muat baris
// pending → siapkan batch (petakan + muat master terkait) → proses
// baris produk → jurnal stok awal → finalisasi job. Bukan berkas
// "use server" (pola shared.ts); aksi di commit.ts tinggal
// orkestrasi. Perilaku, urutan langkah, & pesan identik dengan
// badan aksi asal sebelum tahap ini.

import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, importJobs, importRows, products, suppliers, units } from "@/db/schema";
import { getAccountMap, postJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import {
  findUsedPackagingIds,
  listPackagingsForProducts,
  listProductPackagings,
  syncProductPackagings,
} from "@/server/catalog";
import type { PackagingInput, PackagingSnapshot } from "@/lib/packaging";
import { prepareImportPackagings } from "./commit-packaging";
import { duplicateImportMessage, findAppliedImportDuplicate } from "@/server/import-files";
import {
  assertMasterEntity,
  commitMasterBatch,
  commitOpeningBalancesImport,
  commitOpeningStockImport,
  loadRequiredCustomFields,
  requiredCustomFieldsNote,
} from "@/server/import-masters";
import { applyStockMovement } from "@/server/inventory";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { importFallbackSku, mapProductRow, type ImportField, type MappedProduct } from "@/lib/import-parse";
import { d, toDb, type Decimal } from "@/lib/money";
import { defaultWarehouse } from "./shared";

export type JobRow = typeof importJobs.$inferSelect;
type ImportRowRow = typeof importRows.$inferSelect;

export type CommitData = {
  jobId: string;
  mapping: Record<string, string | undefined>;
  limit: number;
  updateExisting: boolean;
  importStock: boolean;
  warehouseId?: string;
  /** Tanggal cut-off untuk stok awal produk & impor stok awal. */
  date?: string;
  selectedRows?: number[];
};

export type CommitResult = {
  processed: number;
  remaining: number;
  done: boolean;
  imported: number;
  skipped: number;
  failed: number;
  stockValue?: number;
};

/**
 * Fase validasi: kunci baris job selama commit. Dua commit bersamaan
 * atas job yang sama (dua tab, retry paralel wizard) dulu sama-sama
 * membaca baris "pending" yang sama: stok awal diterapkan dua kali
 * sementara jurnalnya terdedupe oleh kunci idempotensinya — GL dan
 * subledger pecah diam-diam. Dengan kunci ini commit kedua menunggu,
 * lalu membaca status baris yang sudah final (GDG3-16). Termasuk
 * penjaga duplikat berkas identik (GDG3-15).
 */
export async function lockImportJob(tx: Tx, companyId: string, jobId: string): Promise<JobRow> {
  const [job] = await tx
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)))
    .limit(1)
    .for("update");
  if (!job) throw new AppError("NOT_FOUND", "Job impor tidak ditemukan.");
  if (job.status === "completed") throw new AppError("INVALID_STATE", "Job impor sudah selesai.");
  if (job.status === "cancelled") throw new AppError("INVALID_STATE", "Job impor sudah dibatalkan.");
  if (job.fileHash) {
    const duplicate = await findAppliedImportDuplicate(tx, {
      companyId,
      fileHash: job.fileHash,
      excludeJobId: job.id,
    });
    if (duplicate) throw new AppError("CONFLICT", duplicateImportMessage(duplicate));
  }
  return job;
}

/**
 * Fase commit entitas master: job non-"products" di-commit per batch
 * oleh domain import-masters. Mengembalikan hasil commit, atau null
 * bila job adalah impor produk (jalur utama di commit.ts).
 */
export async function commitMasterEntity(
  tx: Tx,
  input: { companyId: string; userId: string; job: JobRow; data: CommitData },
): Promise<CommitResult | null> {
  const { job, data } = input;
  if (job.entity === "products") return null;
  // T4-5a: master di-commit per batch seperti produk; stok awal
  // satu dokumen penerimaan per job (lihat import-masters).
  const entity = assertMasterEntity(job.entity);
  const masterMapping = Object.fromEntries(
    Object.entries(data.mapping).filter(([, value]) => Boolean(value)),
  ) as Partial<Record<string, string>>;
  if (entity === "opening_stock") {
    const warehouseId = data.warehouseId ?? (await defaultWarehouse(tx, input.companyId));
    return commitOpeningStockImport(tx, {
      companyId: input.companyId,
      userId: input.userId,
      job,
      mapping: masterMapping,
      warehouseId,
      date: data.date,
      selectedRows: data.selectedRows,
    });
  }
  if (entity === "opening_payables" || entity === "opening_receivables") {
    // T4-5b: saldo awal — satu dokumen + satu jurnal per baris.
    return commitOpeningBalancesImport(tx, {
      companyId: input.companyId,
      userId: input.userId,
      job,
      mapping: masterMapping,
      limit: data.limit,
      selectedRows: data.selectedRows,
    });
  }
  return commitMasterBatch(tx, {
    companyId: input.companyId,
    userId: input.userId,
    job,
    mapping: masterMapping,
    limit: data.limit,
    selectedRows: data.selectedRows,
  });
}

/** Fase staging: ambil baris "pending" berikutnya untuk batch ini. */
export async function loadPendingProductRows(
  tx: Tx,
  input: { companyId: string; jobId: string; limit: number; selectedRows?: number[] },
): Promise<ImportRowRow[]> {
  return tx
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, input.companyId),
        eq(importRows.jobId, input.jobId),
        eq(importRows.status, "pending"),
        input.selectedRows?.length ? inArray(importRows.rowNumber, input.selectedRows) : sql`true`,
      ),
    )
    .orderBy(asc(importRows.rowNumber))
    .limit(input.limit);
}

async function countPendingRows(tx: Tx, companyId: string, jobId: string): Promise<number> {
  const [pending] = await tx
    .select({ value: count() })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        eq(importRows.status, "pending"),
      ),
    );
  return pending?.value ?? 0;
}

/**
 * Batch kosong: bila tidak ada lagi baris pending, job ditandai
 * selesai dan hasil akhir dikembalikan; bila masih ada (baris terpilih
 * sudah terproses), hasil "0 terproses" dikembalikan. Null bila bukan
 * kasus batch kosong.
 */
export async function finishIfBatchEmpty(
  tx: Tx,
  input: { companyId: string; job: JobRow; jobId: string },
): Promise<CommitResult> {
  const remaining = await countPendingRows(tx, input.companyId, input.jobId);
  if (remaining === 0) {
    await tx
      .update(importJobs)
      .set({
        status: "completed",
        summary: { ...(input.job.summary as object), finishedAt: new Date().toISOString() },
      })
      .where(and(eq(importJobs.companyId, input.companyId), eq(importJobs.id, input.jobId)));
  }
  return { processed: 0, remaining, done: remaining === 0, imported: 0, skipped: 0, failed: 0 };
}

export type ProductBatch = {
  mappedRows: { row: ImportRowRow; mapped: ReturnType<typeof mapProductRow> }[];
  categoryMap: Map<string, string>;
  unitMap: Map<string, string>;
  supplierMap: Map<string, string>;
  skuMap: Map<string, { id: string; sku: string; barcode: string | null; attributes: unknown }>;
  barcodeMap: Map<string, { id: string; sku: string; barcode: string | null; attributes: unknown }>;
  existingAttributesById: Map<string, unknown>;
  requiredProductDefs: Awaited<ReturnType<typeof loadRequiredCustomFields>>;
  productRequiredNote: string | null;
  nextSupplierSeq: number;
  // S6: kemasan tersimpan produk-produk lama di batch ini + id kemasan
  // yang sudah terpakai transaksi — bahan pra-cek sinkronisasi kemasan
  // impor (nama adalah identitas kemasan di jalur impor).
  packagingsByProductId: Map<string, PackagingSnapshot[]>;
  usedPackagingIds: Set<string>;
};

/**
 * Fase persiapan batch: petakan semua baris lebih dulu — hasilnya
 * menentukan master data apa saja yang benar-benar perlu dimuat
 * (GD-P3-8). Commit tidak lagi memindai seluruh tabel produk/
 * kategori/satuan/pemasok perusahaan pada setiap batch — hanya baris
 * yang SKU, barcode, atau namanya muncul di batch ini.
 */
export async function prepareProductBatch(
  tx: Tx,
  input: {
    companyId: string;
    rows: ImportRowRow[];
    mapping: Partial<Record<ImportField, string>>;
  },
): Promise<ProductBatch> {
  const { companyId } = input;
  const mappedRows = input.rows.map((row) => ({
    row,
    mapped: mapProductRow(
      (row.data ?? {}) as Record<string, unknown>,
      input.mapping,
      importFallbackSku(row.rowNumber),
    ),
  }));
  const batchValues = mappedRows.flatMap(({ mapped }) => (mapped.value ? [mapped.value] : []));
  const skuKeys = [...new Set(batchValues.map((value) => value.sku.toLowerCase()))];
  const barcodeKeys = [...new Set(batchValues.flatMap((value) => (value.barcode ? [value.barcode] : [])))];
  const categoryKeys = [
    ...new Set(batchValues.flatMap((value) => (value.category ? [value.category.toLowerCase()] : []))),
  ];
  const unitKeys = [
    ...new Set(
      batchValues.flatMap((value) => (value.unit ? [value.unit.toUpperCase().slice(0, 20).toLowerCase()] : [])),
    ),
  ];
  const supplierKeys = [
    ...new Set(batchValues.flatMap((value) => (value.supplier ? [value.supplier.toLowerCase()] : []))),
  ];

  const [categoryRows, unitRows, supplierRows, existingProducts, supplierCountRows] = await Promise.all([
    categoryKeys.length
      ? tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.companyId, companyId), inArray(sql`lower(${categories.name})`, categoryKeys)))
      : [],
    unitKeys.length
      ? tx
          .select({ id: units.id, code: units.code })
          .from(units)
          .where(and(eq(units.companyId, companyId), inArray(sql`lower(${units.code})`, unitKeys)))
      : [],
    supplierKeys.length
      ? tx
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(
            and(eq(suppliers.companyId, companyId), inArray(sql`lower(${suppliers.name})`, supplierKeys)),
          )
      : [],
    skuKeys.length || barcodeKeys.length
      ? tx
          .select({
            id: products.id,
            sku: products.sku,
            barcode: products.barcode,
            attributes: products.attributes,
          })
          .from(products)
          .where(
            and(
              eq(products.companyId, companyId),
              or(
                skuKeys.length ? inArray(sql`lower(${products.sku})`, skuKeys) : sql`false`,
                barcodeKeys.length ? inArray(products.barcode, barcodeKeys) : sql`false`,
              ),
            ),
          )
      : [],
    // Kode pemasok baru diteruskan dari jumlah pemasok perusahaan
    // (satu query hitung) — bukan dari ukuran peta master yang kini
    // terfilter per batch, agar tidak bertabrakan dengan kode lama.
    tx.select({ value: count() }).from(suppliers).where(eq(suppliers.companyId, companyId)),
  ]);

  // T5R-3: kolom kustom wajib produk — produk baru selalu berangkat
  // tanpa nilai kustom; produk yang diperbarui hanya dicatat bila
  // nilai tersimpannya memang masih kosong untuk kolom wajib itu.
  const requiredProductDefs = await loadRequiredCustomFields(tx, companyId, "product");

  // S6: kemasan tersimpan milik produk lama di batch ini (untuk
  // pencocokan nama → id dan pra-cek rencana sinkronisasi kemasan).
  const packagingsByProductId = await listPackagingsForProducts(
    tx,
    companyId,
    existingProducts.map((row) => row.id),
  );
  const usedPackagingIds = await findUsedPackagingIds(
    tx,
    companyId,
    [...packagingsByProductId.values()].flatMap((list) => list.map((pack) => pack.id)),
  );

  return {
    mappedRows,
    categoryMap: new Map(categoryRows.map((r) => [r.name.toLowerCase(), r.id])),
    unitMap: new Map(unitRows.map((r) => [r.code.toLowerCase(), r.id])),
    supplierMap: new Map(supplierRows.map((r) => [r.name.toLowerCase(), r.id])),
    skuMap: new Map(existingProducts.map((r) => [r.sku.toLowerCase(), r])),
    barcodeMap: new Map(existingProducts.filter((r) => r.barcode).map((r) => [r.barcode!, r])),
    existingAttributesById: new Map(existingProducts.map((row) => [row.id, row.attributes])),
    requiredProductDefs,
    productRequiredNote:
      requiredProductDefs.length > 0
        ? requiredCustomFieldsNote(requiredProductDefs.map((field) => field.label))
        : null,
    nextSupplierSeq: (supplierCountRows[0]?.value ?? 0) + 1,
    packagingsByProductId,
    usedPackagingIds,
  };
}

async function setRowResult(
  tx: Tx,
  rowId: string,
  result: { status: string; error: string | null; entityId?: string },
) {
  await tx
    .update(importRows)
    .set({ status: result.status, error: result.error, ...(result.entityId ? { entityId: result.entityId } : {}) })
    .where(eq(importRows.id, rowId));
}

async function resolveCategoryId(
  tx: Tx,
  companyId: string,
  batch: ProductBatch,
  categoryName: string,
): Promise<string | null> {
  const lookup = categoryName.toLowerCase();
  const known = batch.categoryMap.get(lookup);
  if (known) return known;
  const [created] = await tx
    .insert(categories)
    .values({ companyId, name: categoryName })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  if (created) {
    batch.categoryMap.set(lookup, created.id);
    return created.id;
  }
  const [existing] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), eq(categories.name, categoryName)))
    .limit(1);
  const id = existing?.id ?? null;
  if (id) batch.categoryMap.set(lookup, id);
  return id;
}

async function resolveUnitId(
  tx: Tx,
  companyId: string,
  batch: ProductBatch,
  unitName: string,
): Promise<string | null> {
  const code = unitName.toUpperCase().slice(0, 20);
  const lookup = code.toLowerCase();
  const known = batch.unitMap.get(lookup);
  if (known) return known;
  const [created] = await tx
    .insert(units)
    .values({ companyId, code, name: unitName })
    .onConflictDoNothing()
    .returning({ id: units.id });
  if (created) {
    batch.unitMap.set(lookup, created.id);
    return created.id;
  }
  return null;
}

async function resolveSupplierId(
  tx: Tx,
  companyId: string,
  batch: ProductBatch,
  supplierName: string,
): Promise<string | null> {
  const lookup = supplierName.toLowerCase();
  const known = batch.supplierMap.get(lookup);
  if (known) return known;
  const code = `SUP-${String(batch.nextSupplierSeq).padStart(3, "0")}`;
  batch.nextSupplierSeq += 1;
  const [created] = await tx
    .insert(suppliers)
    .values({ companyId, code, name: supplierName })
    .onConflictDoNothing()
    .returning({ id: suppliers.id });
  if (created) {
    batch.supplierMap.set(lookup, created.id);
    return created.id;
  }
  return null;
}

/** Terapkan stok awal satu baris (produk baru maupun diperbarui) bila opsi impor stok aktif. */
async function applyImportedStock(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    jobId: string;
    fileName: string;
    warehouseId: string;
    productId: string;
    value: MappedProduct;
    date?: string;
  },
): Promise<Decimal | null> {
  await applyStockMovement(tx, {
    companyId: input.companyId,
    warehouseId: input.warehouseId,
    productId: input.productId,
    delta: input.value.stock,
    unitCost: input.value.costPrice,
    movementType: "opening",
    referenceType: "import",
    referenceId: input.jobId,
    referenceNumber: input.fileName,
    reason: "Saldo awal migrasi",
    userId: input.userId,
    date: input.date,
  });
  return d(input.value.stock).mul(input.value.costPrice);
}

/**
 * Fase proses baris produk: per baris — validasi hasil peta, duplikat
 * SKU dalam berkas, resolusi master (kategori/satuan/pemasok dibuat
 * bila belum ada), konflik barcode, lalu perbarui produk lama atau
 * sisipkan produk baru (masing-masing + stok awalnya bila aktif).
 */
export async function processProductBatch(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    job: JobRow;
    data: CommitData;
    warehouseId: string;
    batch: ProductBatch;
  },
): Promise<{ imported: number; skipped: number; failed: number; stockValue: Decimal; stockQty: Decimal }> {
  const { companyId, data, batch } = input;
  const seenInBatch = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let stockValue = d(0);
  let stockQty = d(0);

  for (const { row, mapped } of batch.mappedRows) {
    if (!mapped.value) {
      failed += 1;
      await setRowResult(tx, row.id, { status: "error", error: mapped.error ?? "Baris tidak valid" });
      continue;
    }
    const value = mapped.value;
    const key = value.sku.toLowerCase();

    if (seenInBatch.has(key)) {
      failed += 1;
      await setRowResult(tx, row.id, { status: "error", error: "SKU duplikat di file" });
      continue;
    }
    seenInBatch.add(key);

    const categoryId = value.category ? await resolveCategoryId(tx, companyId, batch, value.category) : null;
    const unitId = value.unit ? await resolveUnitId(tx, companyId, batch, value.unit) : null;
    const supplierId = value.supplier ? await resolveSupplierId(tx, companyId, batch, value.supplier) : null;

    const barcodeConflict = value.barcode ? batch.barcodeMap.get(value.barcode) : undefined;
    if (barcodeConflict && barcodeConflict.sku.toLowerCase() !== key) {
      failed += 1;
      await setRowResult(tx, row.id, {
        status: "error",
        error: `Barcode dipakai produk ${barcodeConflict.sku}`,
      });
      continue;
    }

    const existing = batch.skuMap.get(key);
    if (existing && !data.updateExisting) {
      skipped += 1;
      await setRowResult(tx, row.id, { status: "skipped", error: "SKU sudah ada", entityId: existing.id });
      continue;
    }

    // Produk non-persediaan tidak boleh menerima stok; produk ber-seri/
    // batch tidak boleh menerima stok lewat gerakan tunggal — stoknya
    // wajib masuk lewat penerimaan dengan daftar seri/batch agar
    // on-hand per batch/seri tidak yatim.
    if (data.importStock && value.stock > 0) {
      const stockError = !value.trackStock
        ? "Produk non-persediaan/jasa tidak boleh menerima stok awal — kosongkan Qty atau ubah Jenis Barang menjadi INV."
        : value.trackSerial
          ? "Produk bernomor seri tidak dapat menerima stok awal lewat impor ini — impor stoknya lewat Penerimaan dengan daftar nomor seri."
          : value.trackBatch
            ? "Produk ber-batch tidak dapat menerima stok awal lewat impor ini — impor stoknya lewat Penerimaan dengan batch/kedaluwarsa."
            : null;
      if (stockError) {
        failed += 1;
        await setRowResult(tx, row.id, { status: "error", error: stockError });
        continue;
      }
    }

    // S6: baris yang membawa kemasan — pra-cek dulu (gagal = baris
    // gagal, produk tidak ditulis sama sekali). Baris yang dilewati
    // (SKU sudah ada tanpa opsi perbarui) tidak sampai ke sini:
    // kemasannya memang tidak diterapkan, sama seperti field lain.
    let packagingSubmitted: PackagingInput[] | null = null;
    if (value.packagings.length > 0) {
      try {
        packagingSubmitted = await prepareImportPackagings(tx, {
          companyId,
          value,
          existingId: existing?.id ?? null,
          current: existing ? (batch.packagingsByProductId.get(existing.id) ?? []) : [],
          usedIds: batch.usedPackagingIds,
        });
      } catch (error) {
        if (error instanceof AppError) {
          failed += 1;
          await setRowResult(tx, row.id, { status: "error", error: error.message });
          continue;
        }
        throw error;
      }
    }

    if (existing) {
      // MD-010: Jangan menimpa field lama dengan null/nol jika kolom tidak dipetakan dalam file impor
      const updateFields: Record<string, unknown> = {
        name: value.name,
        updatedAt: new Date(),
      };
      if (data.mapping.barcode && value.barcode) updateFields.barcode = value.barcode;
      if (data.mapping.category && categoryId) updateFields.categoryId = categoryId;
      if (data.mapping.unit && unitId) updateFields.unitId = unitId;
      if (data.mapping.supplier && supplierId) updateFields.supplierId = supplierId;
      if (data.mapping.costPrice && value.costPrice !== undefined) updateFields.costPrice = toDb(value.costPrice);
      if (data.mapping.salePrice && value.salePrice !== undefined) updateFields.salePrice = toDb(value.salePrice);
      if (data.mapping.minStock && value.minStock !== undefined) updateFields.minStock = toDb(value.minStock);
      if (data.mapping.notes && value.notes !== undefined) updateFields.notes = value.notes;
      if (data.mapping.activeStatus && value.isActive !== undefined) updateFields.isActive = value.isActive;

      await tx
        .update(products)
        .set(updateFields)
        .where(and(eq(products.companyId, companyId), eq(products.id, existing.id)));
      if (packagingSubmitted) {
        // Gerbang izin harga formulir tidak berlaku di sini: commit
        // impor sendiri adalah penulisan master berizin (aksi commit
        // digerbang izin impor), dan pra-cek di atas sudah menegakkan
        // semua penjaga domain lainnya.
        await syncProductPackagings(tx, companyId, existing.id, packagingSubmitted, {
          priceGateSatisfied: true,
        });
        batch.packagingsByProductId.set(
          existing.id,
          await listProductPackagings(tx, companyId, existing.id),
        );
      }
      // GD-P1-6: produk yang diperbarui juga menerima stok awalnya bila
      // opsi impor stok aktif — persis seperti cabang insert di bawah.
      // Tanpa ini wizard menjanjikan stok awal yang tidak pernah masuk.
      // Pengulangan aman: baris impor hanya diproses saat berstatus
      // "pending" (setelah ini menjadi "imported"), dan jurnal saldo
      // awal batch di bawah memakai kunci idempotensi per batch, jadi
      // menjalankan ulang impor yang sama tidak menggandakan stok.
      if (data.importStock && value.stock > 0 && value.costPrice >= 0) {
        const added = await applyImportedStock(tx, {
          companyId,
          userId: input.userId,
          jobId: data.jobId,
          fileName: input.job.fileName,
          warehouseId: input.warehouseId,
          productId: existing.id,
          value,
          date: data.date,
        });
        if (added) {
          stockValue = stockValue.plus(added);
          stockQty = stockQty.plus(value.stock);
        }
      }
      imported += 1;
      // T5R-3: pembaruan tidak menyentuh nilai kustom produk; bila
      // ada kolom wajib yang nilai tersimpannya masih kosong,
      // catatan kolom wajib ikut pada pesan hasil baris ini.
      const storedAttributes = batch.existingAttributesById.get(existing.id);
      const missingRequired = batch.requiredProductDefs.filter((field) => {
        const fieldValue =
          storedAttributes && typeof storedAttributes === "object"
            ? (storedAttributes as Record<string, unknown>)[field.key]
            : undefined;
        return fieldValue === undefined || fieldValue === null || fieldValue === "";
      });
      await setRowResult(tx, row.id, {
        status: "imported",
        error:
          missingRequired.length > 0
            ? `Diperbarui. ${requiredCustomFieldsNote(missingRequired.map((field) => field.label))}`
            : "Diperbarui",
        entityId: existing.id,
      });
      continue;
    }

    const [created] = await tx
      .insert(products)
      .values({
        companyId,
        sku: value.sku,
        barcode: value.barcode,
        name: value.name,
        categoryId,
        unitId,
        supplierId,
        costPrice: toDb(value.costPrice),
        salePrice: toDb(value.salePrice),
        minStock: toDb(value.minStock),
        trackStock: value.trackStock,
        trackBatch: value.trackBatch,
        trackSerial: value.trackSerial,
        isActive: value.isActive,
        notes: value.notes,
      })
      .returning({ id: products.id });

    batch.skuMap.set(key, { id: created.id, sku: value.sku, barcode: value.barcode, attributes: null });
    if (value.barcode) {
      batch.barcodeMap.set(value.barcode, { id: created.id, sku: value.sku, barcode: value.barcode, attributes: null });
    }
    if (packagingSubmitted) {
      await syncProductPackagings(tx, companyId, created.id, packagingSubmitted, {
        priceGateSatisfied: true,
      });
      batch.packagingsByProductId.set(
        created.id,
        await listProductPackagings(tx, companyId, created.id),
      );
    }

    if (data.importStock && value.stock > 0 && value.costPrice >= 0) {
      const added = await applyImportedStock(tx, {
        companyId,
        userId: input.userId,
        jobId: data.jobId,
        fileName: input.job.fileName,
        warehouseId: input.warehouseId,
        productId: created.id,
        value,
        date: data.date,
      });
      if (added) {
        stockValue = stockValue.plus(added);
        stockQty = stockQty.plus(value.stock);
      }
    }

    imported += 1;
    await setRowResult(tx, row.id, {
      status: "imported",
      error: batch.productRequiredNote,
      entityId: created.id,
    });
  }

  return { imported, skipped, failed, stockValue, stockQty };
}

/** Fase jurnal: saldo awal persediaan hasil impor batch ini (kunci idempotensi per batch). */
export async function postImportStockJournal(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    job: JobRow;
    jobId: string;
    rows: ImportRowRow[];
    stockValue: Decimal;
    date?: string;
  },
) {
  if (!input.stockValue.gt(0)) return;
  const map = await getAccountMap(tx, input.companyId);
  await postJournal(tx, {
    companyId: input.companyId,
    date: input.date ?? todayISO(),
    description: `Saldo awal persediaan hasil impor ${input.job.fileName} (${input.rows[0]?.rowNumber ?? 0}-${input.rows[input.rows.length - 1]?.rowNumber ?? 0})`,
    sourceType: "opening",
    sourceId: input.jobId,
    createdBy: input.userId,
    idempotencyKey: `import:${input.jobId}:${input.rows[0]?.rowNumber ?? 0}`,
    lines: [
      { accountId: map.inventory, debit: input.stockValue, description: "Persediaan awal impor" },
      { accountId: map.equity, credit: input.stockValue, description: "Modal awal impor" },
    ],
  });
}

/** Fase finalisasi: hitung sisa pending, perbarui ringkasan job, audit bila tuntas. */
export async function finalizeImportJob(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    job: JobRow;
    jobId: string;
    processed: number;
    imported: number;
    skipped: number;
    failed: number;
    stockValue: Decimal;
    stockQty: Decimal;
  },
): Promise<CommitResult> {
  const { job } = input;
  const remaining = await countPendingRows(tx, input.companyId, input.jobId);
  const previous = (job.summary ?? {}) as Record<string, unknown>;
  await tx
    .update(importJobs)
    .set({
      successRows: job.successRows + input.imported,
      failedRows: job.failedRows + input.failed,
      status: remaining === 0 ? "completed" : "preview",
      summary: {
        ...previous,
        importedStockQty: Number(previous.importedStockQty ?? 0) + input.stockQty.toNumber(),
        importedStockValue: Number(previous.importedStockValue ?? 0) + input.stockValue.toNumber(),
        updatedAt: new Date().toISOString(),
      },
    })
    .where(and(eq(importJobs.companyId, input.companyId), eq(importJobs.id, input.jobId)));

  if (remaining === 0) {
    await writeAudit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      action: "import.complete",
      entityType: "import_job",
      entityId: input.jobId,
      after: {
        fileName: job.fileName,
        imported: job.successRows + input.imported,
        failed: job.failedRows + input.failed,
      },
    });
  }

  return {
    processed: input.processed,
    remaining,
    done: remaining === 0,
    imported: input.imported,
    skipped: input.skipped,
    failed: input.failed,
    stockValue: input.stockValue.toNumber(),
  };
}
