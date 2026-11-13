/**
 * SIM-2 Fase S3 — Master Data Management (§18).
 *
 * Domain operasi master data massal & pihak: bulk-edit produk
 * berpreview, deteksi duplikat, detail pihak, dan merge pihak. Semua
 * operasi tulis berjalan dalam transaksi pemanggil (aksi server),
 * tercatat di audit_log, dan tidak pernah menghapus histori dokumen.
 *
 * A-26 Q8 (K-10): berkas asal server/master-data.ts dipecah per
 * agregat ke folder ini (bulk-edit / parties / merge); master-data.ts
 * kini barrel re-export murni. Perilaku tidak berubah.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, productPackagings, products, stockMovements, units } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import Decimal from "decimal.js";
import { buildProductWhere } from "@/server/catalog";
import { writeAudit } from "@/server/audit";

/* ------------------------------------------------------------------ */
/* Bulk edit produk (§18B/E)                                           */
/* ------------------------------------------------------------------ */

export type BulkProductSelection =
  | { mode: "ids"; ids: string[] }
  | { mode: "filter"; q?: string; categoryId?: string; lowStock?: boolean };

export type BulkProductOperation =
  | { kind: "price"; target: "salePrice" | "costPrice"; mode: "percent" | "nominal"; value: string }
  | { kind: "category"; categoryId: string | null }
  | { kind: "unit"; unitId: string }
  | { kind: "active"; isActive: boolean }
  | { kind: "minStock"; value: string };

export type BulkFieldChange = { field: string; label: string; before: string; after: string };
export type BulkRowChange = {
  id: string;
  sku: string;
  name: string;
  changes: BulkFieldChange[];
};
export type BulkRowProblem = { id: string; sku: string; name: string; reason: string };

export type BulkPreview = {
  /** Total produk yang dicakup pemilihan (sebelum validasi per baris). */
  totalSelected: number;
  /** Baris yang benar-benar akan berubah (sampel dibatasi). */
  changes: BulkRowChange[];
  changedCount: number;
  /** Baris terpilih yang sudah dalam keadaan tujuan — tidak diubah. */
  unchangedCount: number;
  /** Baris bermasalah yang akan DILEWATI saat penerapan (dibatasi). */
  errors: BulkRowProblem[];
  errorCount: number;
  /**
   * S6 — aturan kemasan pada edit massal, dinyatakan terus terang:
   * operasi massal TIDAK PERNAH menyentuh tabel kemasan (bidang
   * kemasan bukan bidang massal). Bila ada produk terpilih yang
   * berkemasan, pratinjau membawa catatan ini agar tidak terbaca
   * seolah harga/isi kemasan ikut berubah; null bila tak relevan.
   */
  packagingNote: string | null;
};

const PREVIEW_SAMPLE = 50;

type BulkProductRow = {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitId: string | null;
  unitCode: string | null;
  costPrice: string;
  salePrice: string;
  minStock: string;
  isActive: boolean;
};

async function resolveBulkProducts(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  selection: BulkProductSelection,
): Promise<BulkProductRow[]> {
  const base = () =>
    tx
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        categoryId: products.categoryId,
        categoryName: categories.name,
        unitId: products.unitId,
        unitCode: units.code,
        costPrice: products.costPrice,
        salePrice: products.salePrice,
        minStock: products.minStock,
        isActive: products.isActive,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(units, eq(products.unitId, units.id));

  if (selection.mode === "ids") {
    const ids = [...new Set(selection.ids)];
    if (ids.length === 0) return [];
    return base()
      .where(and(eq(products.companyId, companyId), inArray(products.id, ids)))
      .orderBy(asc(products.name));
  }
  const where = await buildProductWhere(tx, {
    companyId,
    warehouseId,
    q: selection.q,
    categoryId: selection.categoryId,
    lowStock: selection.lowStock,
    // Pemilihan filter mencerminkan daftar produk halaman (semua status).
    activeOnly: false,
  });
  return base().where(where).orderBy(asc(products.name));
}

/** Harga hasil penyesuaian massal: dibulatkan ke sen (2 desimal, half-up). */
function adjustedPrice(before: string, mode: "percent" | "nominal", value: string): Decimal {
  const base = d(before);
  const delta = d(value);
  const raw =
    mode === "percent" ? base.times(d(1).plus(delta.div(100))) : base.plus(delta);
  return raw.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

type EvaluatedRow =
  | { row: BulkProductRow; changes: BulkFieldChange[]; patch: Partial<{ salePrice: string; costPrice: string; categoryId: string | null; unitId: string; isActive: boolean; minStock: string }> }
  | { row: BulkProductRow; problem: string }
  | { row: BulkProductRow; unchanged: true };

async function evaluateBulkOperation(
  tx: Tx,
  companyId: string,
  rows: BulkProductRow[],
  operation: BulkProductOperation,
): Promise<EvaluatedRow[]> {
  // Validasi tingkat operasi (bukan per baris): target kategori/satuan
  // harus milik perusahaan ini; nilai stok minimum tidak boleh negatif.
  let targetCategoryName: string | null = null;
  if (operation.kind === "category" && operation.categoryId) {
    const [category] = await tx
      .select({ name: categories.name })
      .from(categories)
      .where(and(eq(categories.companyId, companyId), eq(categories.id, operation.categoryId)))
      .limit(1);
    if (!category) throw new AppError("VALIDATION", "Kategori tujuan tidak ditemukan di perusahaan ini.");
    targetCategoryName = category.name;
  }
  let targetUnitCode: string | null = null;
  if (operation.kind === "unit") {
    const [unit] = await tx
      .select({ code: units.code })
      .from(units)
      .where(and(eq(units.companyId, companyId), eq(units.id, operation.unitId)))
      .limit(1);
    if (!unit) throw new AppError("VALIDATION", "Satuan tujuan tidak ditemukan di perusahaan ini.");
    targetUnitCode = unit.code;
  }
  if (operation.kind === "price" && !d(operation.value).isFinite()) {
    throw new AppError("VALIDATION", "Nilai penyesuaian harga tidak terbaca.");
  }
  if (operation.kind === "minStock" && d(operation.value).lt(0)) {
    throw new AppError("VALIDATION", "Stok minimum tidak boleh negatif.");
  }

  const costManagedIds = new Set<string>();
  if (operation.kind === "price" && operation.target === "costPrice" && rows.length > 0) {
    const moved = await tx.selectDistinct({ productId: stockMovements.productId })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, companyId), inArray(stockMovements.productId, rows.map((row) => row.id))));
    for (const row of moved) costManagedIds.add(row.productId);
  }

  return rows.map((row): EvaluatedRow => {
    switch (operation.kind) {
      case "price": {
        if (operation.target === "costPrice" && costManagedIds.has(row.id)) {
          return { row, problem: "Harga pokok dikelola AVCO karena produk sudah memiliki mutasi. Gunakan dokumen persediaan untuk koreksi nilai." };
        }
        const before = operation.target === "salePrice" ? row.salePrice : row.costPrice;
        const after = adjustedPrice(before, operation.mode, operation.value);
        if (after.lt(0)) {
          return {
            row,
            problem: `Harga ${operation.target === "salePrice" ? "jual" : "beli"} menjadi negatif (${after.toFixed(2)}).`,
          };
        }
        if (after.eq(d(before))) return { row, unchanged: true };
        const label = operation.target === "salePrice" ? "Harga jual" : "Harga beli";
        return {
          row,
          changes: [
            {
              field: operation.target,
              label,
              before: d(before).toFixed(2),
              after: after.toFixed(2),
            },
          ],
          patch: { [operation.target]: after.toFixed(2) },
        };
      }
      case "category": {
        if (row.categoryId === operation.categoryId) return { row, unchanged: true };
        return {
          row,
          changes: [
            {
              field: "categoryId",
              label: "Kategori",
              before: row.categoryName ?? "—",
              after: targetCategoryName ?? "—",
            },
          ],
          patch: { categoryId: operation.categoryId },
        };
      }
      case "unit": {
        if (row.unitId === operation.unitId) return { row, unchanged: true };
        return {
          row,
          changes: [
            { field: "unitId", label: "Satuan", before: row.unitCode ?? "—", after: targetUnitCode ?? "—" },
          ],
          patch: { unitId: operation.unitId },
        };
      }
      case "active": {
        if (row.isActive === operation.isActive) return { row, unchanged: true };
        return {
          row,
          changes: [
            {
              field: "isActive",
              label: "Status",
              before: row.isActive ? "Aktif" : "Nonaktif",
              after: operation.isActive ? "Aktif" : "Nonaktif",
            },
          ],
          patch: { isActive: operation.isActive },
        };
      }
      case "minStock": {
        const after = d(operation.value);
        if (after.eq(d(row.minStock))) return { row, unchanged: true };
        return {
          row,
          changes: [
            { field: "minStock", label: "Stok minimum", before: d(row.minStock).toString(), after: after.toString() },
          ],
          patch: { minStock: after.toString() },
        };
      }
    }
  });
}

/**
 * Pratinjau bulk-edit: menghitung nilai sebelum→sesudah per produk
 * TANPA menulis apa pun. Baris bermasalah dilaporkan terpisah agar
 * pengguna memutuskan dengan informasi penuh sebelum konfirmasi.
 */
export async function previewBulkEditProducts(
  tx: Tx,
  input: {
    companyId: string;
    warehouseId: string;
    selection: BulkProductSelection;
    operation: BulkProductOperation;
  },
): Promise<BulkPreview> {
  const rows = await resolveBulkProducts(tx, input.companyId, input.warehouseId, input.selection);
  const evaluated = await evaluateBulkOperation(tx, input.companyId, rows, input.operation);
  const changes: BulkRowChange[] = [];
  const errors: BulkRowProblem[] = [];
  let changedCount = 0;
  let unchangedCount = 0;
  let errorCount = 0;
  for (const item of evaluated) {
    if ("problem" in item) {
      errorCount += 1;
      if (errors.length < PREVIEW_SAMPLE) {
        errors.push({ id: item.row.id, sku: item.row.sku, name: item.row.name, reason: item.problem });
      }
    } else if ("unchanged" in item) {
      unchangedCount += 1;
    } else {
      changedCount += 1;
      if (changes.length < PREVIEW_SAMPLE) {
        changes.push({ id: item.row.id, sku: item.row.sku, name: item.row.name, changes: item.changes });
      }
    }
  }
  // S6: hitung produk terpilih yang berkemasan aktif — catatan
  // pratinjau menyebutkannya secara eksplisit (lihat BulkPreview).
  let packagingNote: string | null = null;
  if (rows.length > 0) {
    const packaged = await tx
      .select({ productId: productPackagings.productId })
      .from(productPackagings)
      .where(
        and(
          eq(productPackagings.companyId, input.companyId),
          eq(productPackagings.isActive, true),
          inArray(
            productPackagings.productId,
            rows.map((row) => row.id),
          ),
        ),
      );
    const packagedCount = new Set(packaged.map((row) => row.productId)).size;
    if (packagedCount > 0) {
      packagingNote =
        `${packagedCount} produk terpilih memiliki kemasan (Dus/Pak/dll). Edit massal hanya mengubah ` +
        `bidang produk di atas — harga dan isi kemasan TIDAK ikut berubah karena harga kemasan berdiri ` +
        `sendiri; ubah kemasan lewat formulir produk masing-masing. Mengganti satuan di sini hanya ` +
        `mengganti label satuan dasar, bukan isi kemasan.`;
    }
  }
  return {
    totalSelected: rows.length,
    changes,
    changedCount,
    unchangedCount,
    errors,
    errorCount,
    packagingNote,
  };
}

/**
 * Penerapan bulk-edit: resolusi + evaluasi ulang di dalam transaksi
 * pemanggil (data bisa berubah sejak pratinjau — yang diterapkan selalu
 * hasil evaluasi saat ini), satu baris audit per batch, baris bermasalah
 * dilewati dan dilaporkan per baris, bukan menggagalkan batch diam-diam.
 */
export async function applyBulkEditProducts(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    selection: BulkProductSelection;
    operation: BulkProductOperation;
  },
): Promise<{ applied: { id: string; sku: string }[]; skipped: BulkRowProblem[]; unchangedCount: number }> {
  const rows = await resolveBulkProducts(tx, input.companyId, input.warehouseId, input.selection);
  if (rows.length > 0) {
    await tx.select({ id: products.id }).from(products)
      .where(and(eq(products.companyId, input.companyId), inArray(products.id, rows.map((row) => row.id))))
      .orderBy(asc(products.id)).for("update");
  }
  const evaluated = await evaluateBulkOperation(tx, input.companyId, rows, input.operation);
  const applied: { id: string; sku: string }[] = [];
  const skipped: BulkRowProblem[] = [];
  let unchangedCount = 0;
  for (const item of evaluated) {
    if ("problem" in item) {
      skipped.push({ id: item.row.id, sku: item.row.sku, name: item.row.name, reason: item.problem });
      continue;
    }
    if ("unchanged" in item) {
      unchangedCount += 1;
      continue;
    }
    await tx
      .update(products)
      .set({ ...item.patch, updatedAt: new Date() })
      .where(and(eq(products.companyId, input.companyId), eq(products.id, item.row.id)));
    applied.push({ id: item.row.id, sku: item.row.sku });
  }
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "product.bulk_edit",
    entityType: "product",
    entityId: null,
    after: {
      operation: input.operation,
      selection:
        input.selection.mode === "ids"
          ? { mode: "ids", count: input.selection.ids.length }
          : {
              mode: "filter",
              q: input.selection.q ?? null,
              categoryId: input.selection.categoryId ?? null,
              lowStock: input.selection.lowStock ?? false,
            },
      appliedCount: applied.length,
      appliedIds: applied.slice(0, 1000).map((row) => row.id),
      appliedIdsTruncated: applied.length > 1000,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 100),
      unchangedCount,
    },
  });
  return { applied, skipped, unchangedCount };
}

/* ------------------------------------------------------------------ */
/* Deteksi duplikat pihak (§18G)                                       */
