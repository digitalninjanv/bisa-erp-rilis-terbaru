/**
 * Sel-sel dasar impor (S6 — pecahan lib/import/import-parse.ts demi
 * plafon ukuran berkas): tipe field produk, parser angka format
 * Indonesia, dan normalisasi barcode. import-parse.ts mengekspor
 * ulang semuanya agar API lama tidak berubah.
 */

export type ImportField =
  | "sku"
  | "name"
  | "barcode"
  | "category"
  | "unit"
  | "supplier"
  | "costPrice"
  | "salePrice"
  | "minStock"
  | "stock"
  | "notes"
  | "itemType"
  | "activeStatus"
  | "serialTracked"
  | "batchTracked"
  | "packagingIsi"
  | "packagingBuyPrices"
  | "packagingSalePrices"
  | "packagingBarcodes"
  | "packagingStatuses"
  | "packagingDefaults"
  | "packagingNames";

export type ImportFieldDef = {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
  /**
   * Frasa yang membuat sebuah header TIDAK boleh dipakai field ini.
   * Dipakai untuk alias umum yang berbahaya: mis. "harga" tidak boleh
   * menangkap "Harga dari rincian grup" (kolom boolean Accurate), dan
   * "status" tidak boleh menangkap "Status Kemasan".
   */
  exclude?: string[];
};

/** Lowercase, buang tanda baca, rapikan spasi — bentuk kanonis header. */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses Indonesian-formatted numbers ("Rp 12.500,50", "1.500", "12,5").
 * A lone dot followed by exactly three digits is treated as a thousands separator.
 */
export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = String(value).trim().replace(/[^\d,.\-]/g, "");
  if (!text) return null;
  const negative = text.startsWith("-");
  text = text.replace(/-/g, "");

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    // Whichever separator comes last is the decimal separator.
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = text.split(",");
    text = parts.length === 2 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : text.replace(/,/g, "");
  } else if (hasDot) {
    const parts = text.split(".");
    if (parts.length > 2) text = text.replace(/\./g, "");
    else if (parts[1]?.length === 3) text = parts.join("");
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * Saran pemetaan kolom generik. Exact alias selalu menang atas partial,
 * dan `exclude` menutup alias umum yang berbahaya (lihat
 * IMPORT_FIELDS). Partial dipertahankan agar header seperti
 * "Kode Barang Accurate" atau "Harga Jual Rp" tetap terbaca.
 */
export function suggestMappingFor(
  fields: readonly ImportFieldDef[],
  headers: string[],
): Partial<Record<string, string>> {
  const normalized = headers.map((header) => ({ raw: header, norm: normalizeHeader(header) }));
  const mapping: Partial<Record<string, string>> = {};
  const used = new Set<string>();
  const blocked = (header: { norm: string }, field: ImportFieldDef) =>
    (field.exclude ?? []).some((phrase) => header.norm.includes(phrase));

  for (const field of fields) {
    const exact = normalized.find(
      (h) => !used.has(h.raw) && !blocked(h, field) && field.aliases.includes(h.norm),
    );
    if (exact) {
      mapping[field.key] = exact.raw;
      used.add(exact.raw);
      continue;
    }
    const partial = normalized.find(
      (h) =>
        !used.has(h.raw) &&
        !blocked(h, field) &&
        field.aliases.some((alias) => h.norm.includes(alias)),
    );
    if (partial) {
      mapping[field.key] = partial.raw;
      used.add(partial.raw);
    }
  }
  return mapping;
}

/**
 * Membaca satu sel angka. Sel kosong sah bernilai 0, tetapi sel terisi
 * yang tidak terbaca adalah data buruk (GD-P3-2): jangan diam-diam
 * menjadi 0 karena harga/stok bisa salah.
 */
export function numericCell(
  raw: unknown,
  label: string,
): { value: number } | { error: string } {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { value: 0 };
  const parsed = parseNumber(raw);
  if (parsed === null) {
    return { error: `${label} tidak terbaca: "${String(raw).trim().slice(0, 40)}"` };
  }
  return { value: parsed };
}

/** Teks sel terpangkas, maksimum `max` karakter; kosong = null. */
export function cellText(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
  field: string,
  max: number,
): string | null {
  const column = mapping[field];
  const text = column ? String(row[column] ?? "").trim() : "";
  return text ? text.slice(0, max) : null;
}

const ACTIVE_TRUE = new Set(["aktif", "active", "ya", "yes", "1", "true"]);
const ACTIVE_FALSE = new Set([
  "nonaktif",
  "non aktif",
  "tidak aktif",
  "tidak",
  "no",
  "0",
  "false",
]);

/** Status aktif/nonaktif dari sel; kosong = aktif (bawaan master). */
export function activeCell(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
  field = "isActive",
): { value: boolean } | { error: string } {
  const raw = cellText(row, mapping, field, 20);
  if (!raw) return { value: true };
  const normalized = normalizeHeader(raw);
  if (ACTIVE_TRUE.has(normalized)) return { value: true };
  if (ACTIVE_FALSE.has(normalized)) return { value: false };
  return { error: `Status tidak dikenal: "${raw}" (pakai Aktif/Nonaktif)` };
}

/**
 * Termin hari dari sel impor. Menerima "30", "Net 30", "30 hari",
 * "2/10 Net 30" (angka terakhir = jatuh tempo), dan COD/tunai = 0.
 * Kosong = null (pakai termin bawaan pihak).
 */
export function termDaysCell(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value: number | null } | { error: string } {
  const raw = mapping.paymentTermDays ? row[mapping.paymentTermDays] : undefined;
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!text) return { value: null };

  const normalized = normalizeHeader(text);
  if (["cod", "cash", "tunai", "kontan"].some((word) => normalized.includes(word))) {
    return { value: 0 };
  }
  const numbers = text.match(/\d+/g);
  if (!numbers || numbers.length === 0) {
    return {
      error: `Termin tidak terbaca: "${text.slice(0, 40)}" (pakai angka hari, Net 30, atau COD)`,
    };
  }
  const days = Number(numbers[numbers.length - 1]);
  if (!Number.isInteger(days) || days < 0) {
    return { error: "Termin (hari) harus bilangan bulat nol atau positif" };
  }
  return { value: days };
}

export function normalizeBarcode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .trim()
    .replace(/[\s'-]/g, "");
  if (!text) return null;
  // Excel sometimes stores long barcodes as scientific notation.
  if (/^\d+(\.\d+)?e\+\d+$/i.test(text)) {
    const asNumber = Number(text);
    return Number.isFinite(asNumber) ? asNumber.toFixed(0) : text;
  }
  return text.slice(0, 60);
}
