// A-26 Q6 (K-10): helper bersama antar berkas aksi impor (bukan
// berkas "use server") — analisis & klasifikasi baris produk dipakai
// aksi analisis, daftar baris, dan edit baris agar ketiganya selalu
// sepakat soal bendera dan isu baris.

import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  categories,
  importJobs,
  importRows,
  productPackagings,
  products,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  importFallbackSku,
  mapProductRow,
  type ImportField,
  type MappedProduct,
} from "@/lib/import-parse";
import {
  classifyProductImportRows,
  countProductImportRows,
  type ClassifiableProductRow,
  type ProductCatalogIndex,
  type ProductRowFlags,
} from "@/lib/import-classify";
import { loadRequiredCustomFields, requiredCustomFieldsNote } from "@/server/import-masters";

export type ClassifiedProductRow = {
  id: string;
  rowNumber: number;
  status: string;
  error: string | null;
  preview: MappedProduct | null;
  raw: Record<string, unknown>;
  /** Teks sel mentah per kolom yang bisa diedit di pratinjau. */
  cells: Record<"name" | "sku" | "barcode" | "salePrice" | "costPrice" | "unit", string>;
  /** Baris pernah diubah lewat edit di tempat (A-10/D-21). */
  edited: boolean;
  flags: ProductRowFlags;
};


/**
 * Analisis baris impor produk (dipakai analyzeImportAction dan, sejak
 * A-10/D-21, updateImportRowAction agar edit di tempat selalu diikuti
 * analisis ulang penuh yang sama). Menghitung ringkasan + pratinjau dan
 * menyimpan isu error per baris pending ke `import_rows.error`.
 */
export async function analyzeProductJob(
  tx: Tx,
  companyId: string,
  jobId: string,
  mapping: Partial<Record<ImportField, string>>,
) {
  const rows = await tx
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      data: importRows.data,
      status: importRows.status,
    })
    .from(importRows)
    .where(and(eq(importRows.companyId, companyId), eq(importRows.jobId, jobId)))
    .orderBy(asc(importRows.rowNumber));

  const existing = await tx
    .select({ id: products.id, sku: products.sku, barcode: products.barcode, name: products.name })
    .from(products)
    .where(eq(products.companyId, companyId));
  const skuMap = new Map(existing.map((row) => [row.sku.toLowerCase(), row]));
  const barcodeMap = new Map(existing.filter((r) => r.barcode).map((row) => [row.barcode!, row]));
  // S6: barcode kemasan berbagi SATU ruang nama dengan barcode satuan
  // dasar (aturan domain kemasan) — analisis memeriksa keduanya agar
  // pratinjau jujur sebelum commit.
  const existingPackagingBarcodes = await tx
    .select({
      barcode: productPackagings.barcode,
      packagingName: productPackagings.name,
      sku: products.sku,
      productName: products.name,
    })
    .from(productPackagings)
    .innerJoin(products, eq(productPackagings.productId, products.id))
    .where(and(eq(productPackagings.companyId, companyId), sql`${productPackagings.barcode} is not null`));
  const packagingBarcodeMap = new Map(
    existingPackagingBarcodes.map((row) => [row.barcode!, row]),
  );

  const seenSku = new Set<string>();
  const seenBarcode = new Map<string, string>();
  let missingName = 0;
  let missingSku = 0;
  let duplicateInFile = 0;
  let existingCount = 0;
  let barcodeConflict = 0;
  let duplicateBarcodeInFile = 0;
  let invalidPrice = 0;
  let invalidValue = 0;
  let invalidPackaging = 0;
  let valid = 0;
  /** Baris yang lolos error DAN enam field wajib terisi. */
  let lengkap = 0;
  // GD-P2-7: isu bermasalah per baris untuk disimpan ke import_rows.
  const rowIssues: { id: string; status: string; issue: string | null }[] = [];
  const newCategories = new Set<string>();
  const newUnits = new Set<string>();
  const newSuppliers = new Set<string>();
  const preview: {
    rowNumber: number;
    name: string | null;
    sku: string | null;
    barcode: string | null;
    price: number;
    stock: number;
    issue: string | null;
    action: "insert" | "update" | "skip" | "error";
  }[] = [];

  const categoryRows = await tx.select({ name: categories.name }).from(categories).where(eq(categories.companyId, companyId));
  const unitRows = await tx.select({ code: units.code }).from(units).where(eq(units.companyId, companyId));
  const supplierRows = await tx.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.companyId, companyId));
  const categorySet = new Set(categoryRows.map((r) => r.name.toLowerCase()));
  const unitSet = new Set(unitRows.map((r) => r.code.toLowerCase()));
  const supplierSet = new Set(supplierRows.map((r) => r.name.toLowerCase()));

  // T5R-3: baris produk BARU yang akan terimpor ditandai catatan
  // kolom kustom wajib (impor tidak membawa nilai kustom). Di jalur
  // produk catatan ini hanya tampil di pratinjau analisis — sesuai
  // konvensi jalur ini, hanya isu error yang disimpan ke baris;
  // catatan hasil finalnya ditulis saat commit.
  const requiredProductDefs = await loadRequiredCustomFields(tx, companyId, "product");
  const productRequiredNote =
    requiredProductDefs.length > 0
      ? requiredCustomFieldsNote(requiredProductDefs.map((field) => field.label))
      : null;

  for (const row of rows) {
    const source = (row.data ?? {}) as Record<string, unknown>;
    const mapped = mapProductRow(source, mapping, importFallbackSku(row.rowNumber));
    if (!mapped.value) {
      // GD-P3-2: mapProductRow kini menolak data buruk itu sendiri
      // (harga tak terbaca, stok/minimum negatif), jadi analisis cukup
      // menghitungnya per kelompok error — tidak ada pemeriksaan sel
      // mentah terpisah yang bisa berbeda pendapat.
      if (mapped.errorKind === "price") invalidPrice += 1;
      else if (mapped.errorKind === "stock") invalidValue += 1;
      else if (mapped.errorKind === "attribute") invalidValue += 1;
      else if (mapped.errorKind === "packaging") invalidPackaging += 1;
      else missingName += 1;
      rowIssues.push({
        id: row.id,
        status: row.status,
        issue: mapped.error ?? "Baris tidak valid",
      });
      if (preview.length < 30) {
        preview.push({
          rowNumber: row.rowNumber,
          name: null,
          sku: null,
          barcode: null,
          price: 0,
          stock: 0,
          issue: mapped.error ?? "Baris tidak valid",
          action: "error",
        });
      }
      continue;
    }
    const value = mapped.value;
    if (!String(source[mapping.sku ?? ""] ?? "").trim()) missingSku += 1;

    const skuKey = value.sku.toLowerCase();
    let issue: string | null = null;
    let action: "insert" | "update" | "skip" | "error" = "insert";

    if (seenSku.has(skuKey)) {
      duplicateInFile += 1;
      issue = "SKU duplikat di file (baris pertama dipakai)";
      action = "error";
    } else {
      seenSku.add(skuKey);
      const match = skuMap.get(skuKey);
      if (match) {
        existingCount += 1;
        issue = "SKU sudah ada — akan diperbarui bila opsi aktif";
        action = "skip";
      }
      if (value.barcode) {
        const conflict = barcodeMap.get(value.barcode);
        if (conflict && conflict.sku.toLowerCase() !== skuKey) {
          barcodeConflict += 1;
          issue = `Barcode sudah dipakai ${conflict.name} (${conflict.sku})`;
          action = "error";
        }
        // A-10/D-21: duplikat barcode di dalam berkas kini dideteksi
        // juga di pratinjau — commit memang selalu menolak baris
        // berikutnya, jadi pratinjau yang diam saja menipu pengguna.
        // Hanya baris kemunculan-pertama SKU yang mendaftarkan
        // barcode-nya, selaras classifier & commit.
        const firstSkuForBarcode = seenBarcode.get(value.barcode);
        if (firstSkuForBarcode === undefined) {
          seenBarcode.set(value.barcode, skuKey);
        } else if (firstSkuForBarcode !== skuKey) {
          duplicateBarcodeInFile += 1;
          if (action !== "error") {
            issue = "Barcode duplikat di file (baris pertama dipakai)";
            action = "error";
          }
        }
      }
      // S6: barcode kemasan baris ini diperiksa terhadap katalog
      // (barcode dasar produk lain & barcode kemasan produk lain) dan
      // terhadap SEMUA barcode yang sudah terlihat di berkas ini —
      // peta `seenBarcode` yang sama, karena ruang namanya memang satu.
      for (const pack of value.packagings) {
        if (!pack.barcode) continue;
        if (pack.barcode === value.barcode) {
          issue = `Barcode kemasan "${pack.name}" sama dengan barcode satuan dasar produk ini — satu barcode hanya boleh berarti satu hal`;
          action = "error";
          continue;
        }
        const baseConflict = barcodeMap.get(pack.barcode);
        if (baseConflict && baseConflict.sku.toLowerCase() !== skuKey) {
          barcodeConflict += 1;
          issue = `Barcode kemasan "${pack.name}" sudah dipakai ${baseConflict.name} (${baseConflict.sku})`;
          action = "error";
          continue;
        }
        const packConflict = packagingBarcodeMap.get(pack.barcode);
        if (packConflict && packConflict.sku.toLowerCase() !== skuKey) {
          issue = `Barcode kemasan "${pack.name}" sudah dipakai kemasan "${packConflict.packagingName}" pada ${packConflict.productName} (${packConflict.sku})`;
          action = "error";
          continue;
        }
        const firstSkuForPackBarcode = seenBarcode.get(pack.barcode);
        if (firstSkuForPackBarcode === undefined) {
          seenBarcode.set(pack.barcode, skuKey);
        } else if (firstSkuForPackBarcode !== skuKey) {
          duplicateBarcodeInFile += 1;
          if (action !== "error") {
            issue = "Barcode kemasan duplikat di file (baris pertama dipakai)";
            action = "error";
          }
        }
      }
    }

    if (value.category && !categorySet.has(value.category.toLowerCase())) newCategories.add(value.category);
    if (value.unit && !unitSet.has(value.unit.toLowerCase())) newUnits.add(value.unit);
    if (value.supplier && !supplierSet.has(value.supplier.toLowerCase())) newSuppliers.add(value.supplier);
    if (!issue) valid += 1;
    if (action !== "error") {
      const rawSku = String(source[mapping.sku ?? ""] ?? "").trim();
      if (
        rawSku &&
        value.name.trim() &&
        (value.barcode ?? "").trim() &&
        (value.unit ?? "").trim() &&
        value.costPrice > 0 &&
        value.salePrice > 0
      ) {
        lengkap += 1;
      }
    }
    // Hanya isu bermasalah (action "error") yang disimpan; catatan
    // informatif seperti "SKU sudah ada" tidak menandai baris bermasalah.
    rowIssues.push({ id: row.id, status: row.status, issue: action === "error" ? issue : null });

    if (preview.length < 30) {
      preview.push({
        rowNumber: row.rowNumber,
        name: value.name,
        sku: value.sku,
        barcode: value.barcode,
        price: value.salePrice,
        stock: value.stock,
        issue: issue ?? (action === "insert" ? productRequiredNote : null),
        action,
      });
    }
  }

  const summary = {
    totalRows: rows.length,
    valid,
    lengkap,
    missingName,
    missingSku,
    duplicateInFile,
    existingCount,
    barcodeConflict,
    duplicateBarcodeInFile,
    invalidPrice,
    invalidValue,
    invalidPackaging,
    newCategories: [...newCategories].slice(0, 50),
    newUnits: [...newUnits].slice(0, 20),
    newSuppliers: [...newSuppliers].slice(0, 50),
    // T4-5a: field penyatu dengan ringkasan master (import-masters).
    // WAJIB menghitung semua baris ber-isu, bukan hanya pratinjau 30
    // baris — sebelumnya 1.000 baris gagal tampil sebagai "30 masalah".
    invalidRows: rowIssues.filter((item) => item.issue !== null).length,
    unknownGroups: [] as string[],
    unknownProducts: 0,
  };

  // GD-P2-7: simpan isu per baris ke `error` agar tabel seleksi wizard
  // membaca masalah nyata dari data baris di semua halaman — bukan
  // hanya dari pratinjau 30 baris. Hanya baris "pending" yang ditulis:
  // baris yang sudah diproses commit menyimpan pesan hasilnya sendiri,
  // dan analisis ulang membersihkan isu lama baris yang sudah valid.
  for (const item of rowIssues) {
    if (item.status !== "pending") continue;
    await tx
      .update(importRows)
      .set({ error: item.issue })
      .where(eq(importRows.id, item.id));
  }

  await tx
    .update(importJobs)
    .set({ mapping, summary, totalRows: rows.length })
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)));

  return { summary, preview };
}

/**
 * Memuat seluruh baris sebuah job produk dan mengklasifikasikannya
 * dengan classifier murni (A-10/D-21). Dipakai daftar baris pratinjau
 * dan aksi edit agar keduanya selalu sepakat soal bendera baris.
 */
export async function loadClassifiedProductRows(
  tx: Tx,
  companyId: string,
  jobId: string,
  mapping: Partial<Record<ImportField, string>>,
): Promise<{ rows: ClassifiedProductRow[]; counts: ReturnType<typeof countProductImportRows> }> {
  const rows = await tx
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      data: importRows.data,
      status: importRows.status,
      error: importRows.error,
    })
    .from(importRows)
    .where(and(eq(importRows.companyId, companyId), eq(importRows.jobId, jobId)))
    .orderBy(asc(importRows.rowNumber));

  const existing = await tx
    .select({ sku: products.sku, barcode: products.barcode })
    .from(products)
    .where(eq(products.companyId, companyId));
  const catalog: ProductCatalogIndex = {
    skuKeys: new Set(existing.map((row) => row.sku.toLowerCase())),
    barcodeToSkuKey: new Map(
      existing.filter((row) => row.barcode).map((row) => [row.barcode!, row.sku.toLowerCase()]),
    ),
  };

  const inputs: ClassifiableProductRow[] = [];
  const base = rows.map((row) => {
    const source = (row.data ?? {}) as Record<string, unknown>;
    const mapped = mapProductRow(source, mapping, importFallbackSku(row.rowNumber));
    const cellRaw = (field: ImportField): unknown => {
      const column = mapping[field];
      return column ? source[column] : undefined;
    };
    const cellText = (field: ImportField): string => {
      const value = cellRaw(field);
      return value === undefined || value === null ? "" : String(value);
    };
    inputs.push({
      rowNumber: row.rowNumber,
      status: row.status,
      storedIssue: row.error,
      mapped,
      rawSku: cellText("sku").trim(),
      barcodeRaw: cellRaw("barcode"),
      salePriceEmpty: cellText("salePrice").trim() === "",
      costPriceEmpty: cellText("costPrice").trim() === "",
      salePriceZero: mapped.value?.salePrice === 0,
      costPriceZero: mapped.value?.costPrice === 0,
    });
    const editedFields = (source as { __editedFields?: unknown }).__editedFields;
    return {
      id: row.id,
      rowNumber: row.rowNumber,
      status: row.status,
      error: row.error,
      preview: mapped.value ?? null,
      raw: source,
      cells: {
        name: cellText("name"),
        sku: cellText("sku"),
        barcode: cellText("barcode"),
        salePrice: cellText("salePrice"),
        costPrice: cellText("costPrice"),
        unit: cellText("unit"),
      },
      edited: Array.isArray(editedFields) && editedFields.length > 0,
    };
  });

  const classified = classifyProductImportRows(inputs, catalog);
  const counts = countProductImportRows(inputs, classified);
  return {
    rows: base.map((row) => ({ ...row, flags: classified.get(row.rowNumber)! })),
    counts,
  };
}

export async function defaultWarehouse(tx: Tx, companyId: string) {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), eq(warehouses.isActive, true)))
    .orderBy(sql`${warehouses.isDefault} desc, ${warehouses.name} asc`)
    .limit(1);
  if (!row) throw new AppError("VALIDATION", "Belum ada gudang aktif.");
  return row.id;
}
