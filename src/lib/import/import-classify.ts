/**
 * Klasifikasi baris pratinjau impor produk (A-10/D-21).
 *
 * Logika murni: menerima baris-baris hasil pemetaan (`mapProductRow`)
 * beserta indeks katalog perusahaan, mengembalikan bendera per baris
 * yang dipakai filter pratinjau, pilihan massal, dan hitungan kategori.
 *
 * Kelas error mengikuti aturan impor yang sudah berlaku — modul ini
 * TIDAK menciptakan aturan baru:
 * - nama kosong / harga & stok tak terbaca atau negatif: error keras
 *   (sudah diputuskan `mapProductRow`);
 * - SKU duplikat di dalam berkas: baris pertama dipakai, baris
 *   berikutnya error (sama seperti analisis & commit);
 * - barcode yang dipakai produk katalog lain (SKU berbeda): error;
 * - SKU yang sudah ada di katalog: BUKAN error — baris dilewati atau
 *   diperbarui saat commit, jadi hanya bendera informatif;
 * - barcode kosong dan harga kosong: BUKAN error (sel kosong sah
 *   bernilai 0 menurut mapper) — bendera informatif untuk penyaringan.
 */

import {
  importFallbackSku,
  normalizeBarcode,
  type MappedProduct,
} from "@/lib/import-parse";

export type ProductRowFlags = {
  barcodeKosong: boolean;
  hargaJualKosong: boolean;
  hargaBeliKosong: boolean;
  /** SKU atau barcode sama dengan baris lain di berkas yang sama. */
  duplikatDalamBerkas: boolean;
  /** SKU sudah ada di katalog, atau barcode dimiliki produk katalog. */
  duplikatKatalog: boolean;
  /** Error keras menurut aturan impor saat ini — tidak bisa dipilih. */
  bermasalah: boolean;
  /** Pending tanpa masalah — secara teknis bisa diproses. */
  siap: boolean;
  /**
   * Pending, tanpa error, DAN lengkap: SKU, Nama, Barcode, Satuan,
   * Harga beli > 0, Harga jual > 0. Inilah yang boleh dipilih untuk
   * impor lewat filter "Siap impor".
   */
  lengkap: boolean;
  /** Pending tanpa error tetapi salah satu field wajib masih kosong/0. */
  belumLengkap: boolean;
};

export type ClassifiableProductRow = {
  rowNumber: number;
  status: string;
  /** Isu error tersimpan dari analisis terakhir (kolom `error` baris). */
  storedIssue: string | null;
  mapped: { value?: MappedProduct; error?: string };
  /** Teks sel SKU mentah, sudah dipangkas. */
  rawSku: string;
  /** Sel barcode mentah (dinormalisasi di sini bila mapper gagal). */
  barcodeRaw: unknown;
  /** Sel harga jual mentah kosong, atau kolomnya tidak dipetakan. */
  salePriceEmpty: boolean;
  /** Sel harga beli mentah kosong, atau kolomnya tidak dipetakan. */
  costPriceEmpty: boolean;
  /** Harga jual hasil map = 0 (termasuk sel "0.000000" dari Accurate). */
  salePriceZero: boolean;
  /** Harga beli hasil map = 0 (termasuk sel "0.000000" dari Accurate). */
  costPriceZero: boolean;
};

export type ProductCatalogIndex = {
  /** SKU katalog dalam huruf kecil. */
  skuKeys: ReadonlySet<string>;
  /** Barcode katalog -> kunci SKU pemiliknya (huruf kecil). */
  barcodeToSkuKey: ReadonlyMap<string, string>;
};

export type ProductCatalogLookupKeys = {
  skuKeys: string[];
  barcodes: string[];
};

export type ProductImportFilter =
  | "all"
  | "valid"
  | "complete"
  | "incomplete"
  | "problem"
  | "barcode_empty"
  | "sale_price_empty"
  | "cost_price_empty"
  | "duplicate";

function effectiveSkuKey(row: ClassifiableProductRow): string {
  if (row.mapped.value) return row.mapped.value.sku.toLowerCase();
  return (row.rawSku || importFallbackSku(row.rowNumber)).slice(0, 60).toLowerCase();
}

function effectiveBarcode(row: ClassifiableProductRow): string | null {
  if (row.mapped.value) return row.mapped.value.barcode;
  return normalizeBarcode(row.barcodeRaw);
}

/**
 * Distinct catalog keys needed to classify this import. Keeping the lookup
 * bounded to these keys avoids loading the company's full product catalog.
 */
export function productCatalogLookupKeys(
  rows: ClassifiableProductRow[],
): ProductCatalogLookupKeys {
  return {
    skuKeys: [...new Set(rows.map(effectiveSkuKey))],
    barcodes: [...new Set(rows.map(effectiveBarcode).filter((value): value is string => value !== null))],
  };
}

export function classifyProductImportRows(
  rows: ClassifiableProductRow[],
  catalog: ProductCatalogIndex,
): Map<number, ProductRowFlags> {
  const ordered = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const skuKeys = new Map(ordered.map((row) => [row.rowNumber, effectiveSkuKey(row)]));
  const barcodes = new Map(ordered.map((row) => [row.rowNumber, effectiveBarcode(row)]));

  // Kelompok duplikat di dalam berkas: semua anggota tertandai, dan
  // pemilik pertama (nomor baris terkecil) adalah yang "dipakai".
  const skuGroups = new Map<string, number[]>();
  for (const row of ordered) {
    const skuKey = skuKeys.get(row.rowNumber)!;
    const group = skuGroups.get(skuKey) ?? [];
    group.push(row.rowNumber);
    skuGroups.set(skuKey, group);
  }
  // Kelompok barcode hanya dihitung dari baris yang merupakan
  // kemunculan pertama SKU-nya: baris duplikat SKU tidak akan pernah
  // terimpor (commit menolaknya lebih dulu), jadi barcode miliknya
  // tidak boleh mencemari baris lain — persis perilaku commit.
  const barcodeGroups = new Map<string, number[]>();
  for (const row of ordered) {
    const skuGroup = skuGroups.get(skuKeys.get(row.rowNumber)!) ?? [];
    if (skuGroup[0] !== row.rowNumber) continue;
    const barcode = barcodes.get(row.rowNumber);
    if (barcode) {
      const bGroup = barcodeGroups.get(barcode) ?? [];
      bGroup.push(row.rowNumber);
      barcodeGroups.set(barcode, bGroup);
    }
  }

  const result = new Map<number, ProductRowFlags>();
  for (const row of ordered) {
    const skuKey = skuKeys.get(row.rowNumber)!;
    const barcode = barcodes.get(row.rowNumber);

    const skuGroup = skuGroups.get(skuKey) ?? [];
    const isSkuFirst = skuGroup[0] === row.rowNumber;
    const barcodeGroup = barcode ? (barcodeGroups.get(barcode) ?? []) : [];
    const duplikatDalamBerkas =
      skuGroup.length > 1 || (isSkuFirst && barcodeGroup.length > 1);
    // Baris berikutnya dalam kelompok adalah error duplikat. Kelompok
    // barcode hanya berisi baris kemunculan-pertama SKU yang SKU-nya
    // pasti berbeda satu sama lain, jadi anggota berikutnya selalu
    // error duplikat barcode.
    const duplikatSkuError = skuGroup.length > 1 && !isSkuFirst;
    const duplikatBarcodeError =
      isSkuFirst && barcodeGroup.length > 1 && barcodeGroup[0] !== row.rowNumber;

    const catalogOwner = barcode ? catalog.barcodeToSkuKey.get(barcode) : undefined;
    const barcodeKonflikKatalog = catalogOwner !== undefined && catalogOwner !== skuKey;
    const duplikatKatalog = catalog.skuKeys.has(skuKey) || catalogOwner !== undefined;

    const bermasalah =
      row.status === "error" ||
      (row.status === "pending" &&
        (row.mapped.error !== undefined ||
          row.storedIssue !== null ||
          duplikatSkuError ||
          duplikatBarcodeError ||
          barcodeKonflikKatalog));

    // Definisi "Siap impor" yang diminta pemilik: enam field ini harus
    // benar-benar terisi. Harga 0 dianggap belum diisi (Accurate
    // mengekspor harga kosong sebagai 0.000000), barcode juga wajib.
    const value = row.mapped.value;
    const fieldsComplete =
      value !== undefined &&
      row.rawSku.trim() !== "" &&
      value.name.trim() !== "" &&
      (value.barcode ?? "").trim() !== "" &&
      (value.unit ?? "").trim() !== "" &&
      value.costPrice > 0 &&
      value.salePrice > 0;
    const siap = row.status === "pending" && !bermasalah;
    const lengkap = siap && fieldsComplete;
    const belumLengkap = siap && !fieldsComplete;

    result.set(row.rowNumber, {
      barcodeKosong: barcode === null,
      // "Kosong" mencakup sel kosong DAN nilai 0. Accurate mengekspor
      // harga yang tidak diisi sebagai "0.000000", bukan sel kosong;
      // tanpa ini filter koreksi harga tidak pernah menemukan barisnya.
      hargaJualKosong: row.salePriceEmpty || row.salePriceZero,
      hargaBeliKosong: row.costPriceEmpty || row.costPriceZero,
      duplikatDalamBerkas,
      duplikatKatalog,
      bermasalah,
      siap,
      lengkap,
      belumLengkap,
    });
  }
  return result;
}

export type ProductImportRowCounts = {
  total: number;
  /** Pending tanpa error (belum tentu lengkap). */
  siap: number;
  /** Pending, tanpa error, dan enam field wajib terisi. */
  lengkap: number;
  /** Pending tanpa error tetapi field wajibnya belum lengkap. */
  belumLengkap: number;
  bermasalah: number;
  barcodeKosong: number;
  hargaJualKosong: number;
  hargaBeliKosong: number;
  /** Gabungan duplikat dalam berkas dan duplikat katalog. */
  duplikat: number;
};

export function countProductImportRows(
  rows: ClassifiableProductRow[],
  classified: Map<number, ProductRowFlags>,
): ProductImportRowCounts {
  const counts: ProductImportRowCounts = {
    total: rows.length,
    siap: 0,
    lengkap: 0,
    belumLengkap: 0,
    bermasalah: 0,
    barcodeKosong: 0,
    hargaJualKosong: 0,
    hargaBeliKosong: 0,
    duplikat: 0,
  };
  for (const row of rows) {
    const flags = classified.get(row.rowNumber);
    if (!flags) continue;
    if (flags.siap) counts.siap += 1;
    if (flags.lengkap) counts.lengkap += 1;
    if (flags.belumLengkap) counts.belumLengkap += 1;
    if (flags.bermasalah) counts.bermasalah += 1;
    if (flags.barcodeKosong) counts.barcodeKosong += 1;
    if (flags.hargaJualKosong) counts.hargaJualKosong += 1;
    if (flags.hargaBeliKosong) counts.hargaBeliKosong += 1;
    if (flags.duplikatDalamBerkas || flags.duplikatKatalog) counts.duplikat += 1;
  }
  return counts;
}

export function productRowMatchesFilter(flags: ProductRowFlags, filter: ProductImportFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "valid":
      return flags.siap;
    case "complete":
      return flags.lengkap;
    case "incomplete":
      return flags.belumLengkap;
    case "problem":
      return flags.bermasalah;
    case "barcode_empty":
      return flags.barcodeKosong;
    case "sale_price_empty":
      return flags.hargaJualKosong;
    case "cost_price_empty":
      return flags.hargaBeliKosong;
    case "duplicate":
      return flags.duplikatDalamBerkas || flags.duplikatKatalog;
  }
}
