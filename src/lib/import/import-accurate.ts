/**
 * Kompatibilitas impor dengan bentuk ekspor Accurate Online/Desktop.
 *
 * Dua hal yang tidak bisa diselesaikan lewat pemetaan kolom biasa:
 * 1. Multi-satuan Accurate diekspor sebagai kolom terpisah
 *    (`Satuan #2..#5`, `Rasio Satuan #2..#5`, `Def. Hrg. Jual Satuan
 *    #2..#5`), sedangkan ERP menyimpan kemasan sebagai daftar
 *    `PackagingInput` per produk.
 * 2. Atribut produk Accurate memakai istilah sendiri
 *    (`Jenis Barang`, `Non Aktif`, `Menggunakan No. Seri`,
 *    `Pakai tanggal kadaluarsa`) dan ekspor ERP memakai
 *    (`Lacak Persediaan`, `Status`, `Lacak Batch`).
 *
 * Modul ini murni (tanpa database) dan menjadi satu-satunya tempat
 * penerjemahan bentuk Accurate, sehingga parser produk tidak perlu
 * menebak-nebak header.
 */

import type { PackagingInput } from "@/lib/packaging";
import { validatePackagingInput } from "@/lib/packaging";
import { normalizeHeader, parseNumber, type ImportField } from "./import-cells";

type Row = Record<string, unknown>;

export type ProductAttributes = {
  trackStock: boolean;
  isActive: boolean;
  trackSerial: boolean;
  trackBatch: boolean;
};

function headerLookup(row: Row): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of Object.keys(row)) {
    const normalized = normalizeHeader(key);
    if (!map.has(normalized)) map.set(normalized, key);
  }
  return map;
}

function lookupCell(row: Row, lookup: Map<string, string>, header: string): unknown {
  const key = lookup.get(normalizeHeader(header));
  return key ? row[key] : undefined;
}

function textCell(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function priceCell(
  raw: unknown,
  label: string,
  packagingName: string,
): { value: string | null } | { error: string } {
  const text = textCell(raw);
  if (!text) return { value: null };
  const parsed = parseNumber(text);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
    return {
      error: `${label} kemasan "${packagingName}" tidak terbaca atau negatif: "${text.slice(0, 40)}"`,
    };
  }
  return { value: String(parsed) };
}

/**
 * Membaca kolom multi-satuan ekspor Accurate menjadi kemasan ERP.
 * `Rasio Satuan #n` adalah isi satuan ke-n terhadap satuan dasar
 * (mis. 1 Renceng = 10 Pcs), sama dengan makna `PackagingInput.isi`.
 * `Satuan Beli` menandai kemasan bawaan pembelian bila namanya cocok.
 * Barcode per kemasan tidak diekspor Accurate, jadi null.
 */
export function parseAccuratePackagings(row: Row): { value: PackagingInput[] } | { error: string } {
  if (Object.keys(row).length === 0) return { value: [] };
  const lookup = headerLookup(row);
  const entries: PackagingInput[] = [];

  for (const level of [2, 3, 4, 5] as const) {
    const unit = textCell(lookupCell(row, lookup, `Satuan #${level}`));
    if (!unit) continue;
    const ratioRaw = lookupCell(row, lookup, `Rasio Satuan #${level}`);
    const ratio = parseNumber(ratioRaw);
    if (ratio === null || !Number.isInteger(ratio) || ratio < 2) {
      return {
        error: `Rasio Satuan #${level} untuk "${unit}" tidak valid: "${textCell(ratioRaw).slice(0, 40)}" — harus bilangan bulat ≥ 2`,
      };
    }
    const sale = priceCell(
      lookupCell(row, lookup, `Def. Hrg. Jual Satuan #${level}`),
      "Harga jual",
      unit,
    );
    if ("error" in sale) return { error: sale.error };
    const buy = priceCell(
      lookupCell(row, lookup, `Def. Hrg. Beli Satuan #${level}`),
      "Harga beli",
      unit,
    );
    if ("error" in buy) return { error: buy.error };

    entries.push({
      name: unit,
      isi: String(ratio),
      buyPrice: buy.value,
      salePrice: sale.value,
      barcode: null,
      isDefaultPurchase: false,
      isDefaultSale: false,
      isActive: true,
    });
  }

  if (entries.length === 0) return { value: [] };

  const buyUnit = textCell(lookupCell(row, lookup, "Satuan Beli"));
  if (buyUnit) {
    const match = entries.find((entry) => entry.name.toLowerCase() === buyUnit.toLowerCase());
    if (match) match.isDefaultPurchase = true;
  }

  for (const entry of entries) {
    const issues = validatePackagingInput(entry);
    if (issues.length > 0) return { error: issues.join(" ") };
  }
  return { value: entries };
}

function parseYesNo(
  raw: unknown,
  label: string,
): { value: boolean } | { error: string } {
  const text = normalizeHeader(textCell(raw));
  if (!text) return { value: false };
  if (["ya", "yes", "true", "1", "y", "aktif", "active"].includes(text)) return { value: true };
  if (["tidak", "no", "false", "0", "n", "nonaktif", "non aktif", "inactive"].includes(text)) {
    return { value: false };
  }
  return { error: `${label} tidak dikenal: "${textCell(raw).slice(0, 40)}" (pakai Ya/Tidak)` };
}

function parseTrackStock(raw: unknown): { value: boolean } | { error: string } {
  const text = normalizeHeader(textCell(raw));
  if (!text) return { value: true };
  if (["inv", "inventory", "persediaan", "dagang", "barang dagang", "ya", "yes", "true", "1"].includes(text)) {
    return { value: true };
  }
  if (
    [
      "non persediaan",
      "non inventory",
      "noninv",
      "jasa",
      "service",
      "tidak",
      "no",
      "false",
      "0",
    ].includes(text)
  ) {
    return { value: false };
  }
  if (["grup", "group", "bundle", "paket"].includes(text)) {
    return {
      error:
        "Jenis barang Grup/bundle belum didukung impor ini — impor komponennya sebagai produk biasa lalu susun paket secara manual.",
    };
  }
  return {
    error: `Jenis barang tidak dikenal: "${textCell(raw).slice(0, 40)}" (pakai INV/Non Persediaan/Jasa)`,
  };
}

/**
 * Menerjemahkan atribut produk dari header Accurate maupun ekspor ERP.
 * `activeStatus` sengaja sadar-header: kolom `Non Aktif` adalah flag
 * kebalikan (YA = nonaktif), sedangkan `Status` berisi Aktif/Nonaktif.
 */
export function parseProductAttributes(
  row: Row,
  mapping: Partial<Record<ImportField, string>>,
): { value: ProductAttributes } | { error: string } {
  const get = (field: ImportField): unknown => {
    const column = mapping[field];
    return column ? row[column] : undefined;
  };
  const column = (field: ImportField): string =>
    mapping[field] ? normalizeHeader(mapping[field] as string) : "";

  const trackStock = parseTrackStock(get("itemType"));
  if ("error" in trackStock) return { error: trackStock.error };

  let isActive = true;
  const activeRaw = get("activeStatus");
  if (textCell(activeRaw)) {
    const status = normalizeHeader(textCell(activeRaw));
    const parsed = ["aktif", "active", "ya", "yes", "true", "1", "y"].includes(status)
      ? true
      : ["nonaktif", "non aktif", "inactive", "tidak", "no", "false", "0", "n"].includes(status)
        ? false
        : null;
    if (parsed === null) {
      return {
        error: `Status aktif tidak dikenal: "${textCell(activeRaw).slice(0, 40)}" (pakai Aktif/Nonaktif atau Ya/Tidak)`,
      };
    }
    const header = column("activeStatus");
    isActive =
      header.includes("non aktif") || header.includes("nonaktif") || header.includes("inactive")
        ? !parsed
        : parsed;
  }

  const serial = parseYesNo(get("serialTracked"), "Lacak nomor seri");
  if ("error" in serial) return { error: serial.error };
  const batch = parseYesNo(get("batchTracked"), "Lacak batch/kedaluwarsa");
  if ("error" in batch) return { error: batch.error };

  return {
    value: {
      trackStock: trackStock.value,
      isActive,
      // Produk non-persediaan tidak mungkin punya seri/batch.
      trackSerial: trackStock.value ? serial.value : false,
      trackBatch: trackStock.value ? batch.value : false,
    },
  };
}
