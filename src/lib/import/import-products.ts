/**
 * Impor produk — pecahan lib/import/import-parse.ts demi plafon
 * ukuran berkas. `import-parse.ts` mengekspor ulang semuanya agar API
 * lama (dan tes) tidak berubah.
 *
 * Perhatian khusus bentuk ekspor Accurate:
 * - Harga jual asli ada di `Def. Hrg. Jual Satuan #1`, BUKAN
 *   `Harga dari rincian grup` (kolom boolean).
 * - Stok awal ada di `Kuantitas Saldo Awal`, BUKAN `Batas Minimum Stok`.
 * - Multi-satuan dibaca dari `Satuan #2..#5` + `Rasio Satuan #2..#5`
 *   oleh import-accurate.ts, bukan dari kolom kemasan ERP.
 */

import type { PackagingInput } from "@/lib/packaging";
import {
  normalizeBarcode,
  numericCell,
  suggestMappingFor,
  type ImportField,
} from "./import-cells";
import { parseAccuratePackagings, parseProductAttributes } from "./import-accurate";
import { parsePackagingCells } from "./import-packaging";

export const IMPORT_FIELDS: {
  key: ImportField;
  label: string;
  required?: boolean;
  aliases: string[];
  exclude?: string[];
}[] = [
  { key: "sku", label: "Kode / SKU", required: true, aliases: ["kode barang", "kode", "sku", "item code", "no barang", "nomor barang", "kode item"] },
  { key: "name", label: "Nama barang", required: true, aliases: ["nama barang", "nama", "item name", "deskripsi", "deskripsi barang"] },
  { key: "barcode", label: "Barcode", aliases: ["barcode", "kode barcode", "upc", "upc barcode", "ean", "ean 13"] },
  { key: "category", label: "Kategori", aliases: ["kategori barang", "kategori", "category", "grup", "kelompok"], exclude: ["rincian grup"] },
  { key: "unit", label: "Satuan", aliases: ["satuan", "unit", "uom", "satuan utama"] },
  { key: "supplier", label: "Pemasok", aliases: ["pemasok utama", "pemasok", "supplier", "vendor"] },
  {
    key: "costPrice",
    label: "Harga beli",
    aliases: ["harga beli", "harga pokok", "cost", "hpp", "harga modal", "def hrg beli satuan 1", "harga beli satuan 1"],
    exclude: ["kemasan"],
  },
  {
    key: "salePrice",
    label: "Harga jual",
    aliases: ["harga jual", "harga", "sale price", "price", "def hrg jual satuan 1", "harga jual satuan 1"],
    // Accurate mengekspor kolom boolean "Harga dari rincian grup" yang
    // mengandung kata "harga" tetapi BUKAN harga. Tanpa penjaga ini,
    // kolom itu menangkap mapping harga jual dan seluruh berkas gagal.
    exclude: ["rincian grup", "kemasan"],
  },
  {
    key: "minStock",
    label: "Stok minimum",
    aliases: [
      "batas minimum stok",
      "stok minimum",
      "min stok",
      "min stock",
      "minimum stok",
      "stok minimal",
      "minimum persediaan",
    ],
  },
  {
    key: "stock",
    label: "Stok awal",
    aliases: [
      "kuantitas saldo awal",
      "qty saldo awal",
      "stok awal",
      "stok akhir",
      "saldo stok",
      "saldo awal",
      "stok",
      "qty",
      "quantity",
      "jumlah",
    ],
    exclude: ["minimum", "min", "kemasan"],
  },
  { key: "notes", label: "Keterangan", aliases: ["keterangan", "catatan", "notes", "memo", "keterangan barang"] },
  // Atribut produk (dulu selalu dipaksa aktif & berbasis stok). Nilai
  // Accurate: "Jenis Barang" = INV/Non Persediaan/Jasa/Grup,
  // "Non Aktif" = YA/TIDAK, "Menggunakan No. Seri" & "Pakai tanggal
  // kadaluarsa" = YA/TIDAK. Ekspor ERP sendiri memakai "Lacak
  // Persediaan", "Lacak Batch", dan "Status".
  { key: "itemType", label: "Jenis barang / lacak stok", aliases: ["jenis barang", "tipe barang", "inventory type", "lacak persediaan", "item type"] },
  { key: "activeStatus", label: "Status aktif", aliases: ["status", "non aktif", "nonaktif", "aktif", "is active", "status produk"], exclude: ["kemasan"] },
  { key: "serialTracked", label: "Lacak nomor seri", aliases: ["menggunakan no seri", "menggunakan nomor seri", "nomor seri", "serial", "lacak nomor seri", "lacak seri"], exclude: ["tipe nomor seri"] },
  { key: "batchTracked", label: "Lacak batch / kedaluwarsa", aliases: ["pakai tanggal kadaluarsa", "tanggal kadaluarsa", "lacak batch", "batch", "expiry", "kadaluarsa"] },
  // S6 (Program Satuan Kemasan): kolom kemasan OPSIONAL — daftar paralel
  // berpisah titik koma, satu posisi per kemasan produk itu (lihat
  // parsePackagingCells). Urutan field di sini sengaja yang spesifik
  // dulu ("Isi Kemasan", "Barcode Kemasan", …) dan "Kemasan" terakhir,
  // agar saran pemetaan mengklaim header spesifik secara eksak sebelum
  // header umum "Kemasan" dipasangkan.
  { key: "packagingIsi", label: "Isi Kemasan", aliases: ["isi kemasan", "isi per kemasan"] },
  { key: "packagingBuyPrices", label: "Harga Beli Kemasan", aliases: ["harga beli kemasan"] },
  { key: "packagingSalePrices", label: "Harga Jual Kemasan", aliases: ["harga jual kemasan"] },
  { key: "packagingBarcodes", label: "Barcode Kemasan", aliases: ["barcode kemasan"] },
  { key: "packagingStatuses", label: "Status Kemasan", aliases: ["status kemasan"] },
  { key: "packagingDefaults", label: "Kemasan Bawaan", aliases: ["kemasan bawaan", "bawaan kemasan"] },
  { key: "packagingNames", label: "Kemasan", aliases: ["nama kemasan", "kemasan"] },
];

/** Suggest a column mapping from the file headers. */
export function suggestMapping(headers: string[]): Partial<Record<ImportField, string>> {
  return suggestMappingFor(IMPORT_FIELDS, headers) as Partial<Record<ImportField, string>>;
}

export function slugSku(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(5, "0")}`;
}

/**
 * Fallback SKU for a row without one (GD-P3-1). Preview, analysis, and
 * commit must all derive the same SKU, otherwise the product created at
 * commit differs from what the user reviewed. The pattern matches the
 * SKUs already created by past commits (`IMP-` + zero-padded row number).
 */
export function importFallbackSku(rowNumber: number): string {
  return `IMP-${String(rowNumber).padStart(6, "0")}`;
}

export type MappedProduct = {
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  unit: string | null;
  supplier: string | null;
  costPrice: number;
  salePrice: number;
  minStock: number;
  stock: number;
  notes: string | null;
  /** Atribut produk; dulu commit memaksa trackStock/isActive = true. */
  trackStock: boolean;
  isActive: boolean;
  trackSerial: boolean;
  trackBatch: boolean;
  /**
   * S6: kemasan produk dari kolom kemasan impor (kosong = baris tidak
   * membawa kemasan; commit tidak menyentuh kemasan produk itu).
   * Bentuknya persis `PackagingInput` domain kemasan agar commit dapat
   * menyerahkannya ke `syncProductPackagings` tanpa terjemahan kedua.
   */
  packagings: PackagingInput[];
};

/** Which input group a row error belongs to; analysis counts them apart. */
export type MapRowErrorKind = "name" | "price" | "stock" | "attribute" | "packaging";

export function mapProductRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<ImportField, string>>,
  fallbackSku: string,
): { value?: MappedProduct; error?: string; errorKind?: MapRowErrorKind } {
  const get = (field: ImportField): unknown => {
    const column = mapping[field];
    return column ? row[column] : undefined;
  };

  const name = String(get("name") ?? "").trim();
  if (!name) return { error: "Nama barang kosong", errorKind: "name" };

  const rawSku = String(get("sku") ?? "").trim();
  const sku = (rawSku || fallbackSku).slice(0, 60);
  if (!sku) return { error: "SKU kosong", errorKind: "name" };

  const costPrice = numericCell(get("costPrice"), "Harga beli");
  if ("error" in costPrice) return { error: costPrice.error, errorKind: "price" };
  const salePrice = numericCell(get("salePrice"), "Harga jual");
  if ("error" in salePrice) return { error: salePrice.error, errorKind: "price" };
  if (costPrice.value < 0 || salePrice.value < 0) {
    return { error: "Harga tidak boleh negatif", errorKind: "price" };
  }

  const stock = numericCell(get("stock"), "Stok awal");
  if ("error" in stock) return { error: stock.error, errorKind: "stock" };
  if (stock.value < 0) return { error: "Stok awal tidak boleh negatif", errorKind: "stock" };
  const minStock = numericCell(get("minStock"), "Stok minimum");
  if ("error" in minStock) return { error: minStock.error, errorKind: "stock" };
  if (minStock.value < 0) {
    return { error: "Stok minimum tidak boleh negatif", errorKind: "stock" };
  }

  const attributes = parseProductAttributes(row, mapping);
  if ("error" in attributes) return { error: attributes.error, errorKind: "attribute" };

  // Kolom kemasan ERP hanya dipakai bila kolom "Kemasan" benar-benar
  // dipetakan. Kolom kemasan lain yang dipetakan tanpa nama (mis.
  // "Harga Jual Kemasan" saja) JANGAN membuat seluruh baris gagal —
  // fallback ke kolom multi-satuan Accurate bila ada. Sebelum perbaikan
  // ini, satu mapping menggantung menghasilkan 1.000 error baris.
  const packagings = !attributes.value.trackStock
    ? { value: [] as PackagingInput[] }
    : mapping.packagingNames
      ? parsePackagingCells(get)
      : parseAccuratePackagings(row);
  if ("error" in packagings) return { error: packagings.error, errorKind: "packaging" };

  return {
    value: {
      sku,
      name: name.slice(0, 180),
      barcode: normalizeBarcode(get("barcode")),
      category: String(get("category") ?? "").trim() || null,
      unit: String(get("unit") ?? "").trim() || null,
      supplier: String(get("supplier") ?? "").trim() || null,
      costPrice: costPrice.value,
      salePrice: salePrice.value,
      minStock: minStock.value,
      stock: stock.value,
      notes: String(get("notes") ?? "").trim() || null,
      ...attributes.value,
      packagings: packagings.value,
    },
  };
}
