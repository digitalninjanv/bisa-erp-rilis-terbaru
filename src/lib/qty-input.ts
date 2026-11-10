import { d, toDb } from "./money";

/**
 * G2 (FRM-03) — parsing & formatting untuk input KUANTITAS id-ID
 * bersama, menutup keputusan A-28 yang menunda QtyInput: pola
 * pengganti terbukti disalin di ≥15 titik pada 11 berkas dan parse/
 * jepit ditulis ulang per form (AUDIT-FORM-CRUD-TABEL FRM-03).
 *
 * Kontraknya SENGAJA meniru `lib/money-input` & `lib/percent-input`
 * persis — satu model mental untuk semua input angka di aplikasi:
 *
 * - Nilai kanonis yang diserahkan ke form adalah string Decimal
 *   yang sama seperti yang selama ini hidup di state form dan
 *   disimpan server ("2.5000"). Komponen ini hanya memusatkan CARA
 *   NILAI DITAMPILKAN, DIKETIK, DAN DIJEPIT — bukan nilai bisnisnya.
 * - Tampilan mengikuti `formatQty` (lib/money): pemisah ribuan ".",
 *   desimal ",", nol ekor dibuang — "2.5000" → "2,5",
 *   "1500.0000" → "1.500".
 * - Mengetik: koma satu-satunya jalur desimal; titik hanya pemisah
 *   ribuan yang sedang terbentuk (kontrak SIS-01 yang sama).
 * - Tempel: titik desimal polos ("1.5") tetap diterima.
 * - `decimals` = langkah desimal per konteks (bawaan 3, selaras
 *   tampilan formatQty); `min`/`max` = jepit per konteks yang
 *   diterapkan pada nilai yang diserahkan (onChange), meniru
 *   penjepitan onChange yang dulu ditulis tangan di form retur POS.
 */

export type QtyParseResult = { ok: true; value: string } | { ok: false; error: string };

export type QtyLimits = { decimals?: number; min?: string; max?: string };

const ERROR_MESSAGE = "Kuantitas tidak terbaca. Gunakan format seperti 10 atau 1,5.";
const DEFAULT_DECIMALS = 3;

function fail(): QtyParseResult {
  return { ok: false, error: ERROR_MESSAGE };
}

function decimalsOf(opts?: QtyLimits): number {
  const decimals = opts?.decimals ?? DEFAULT_DECIMALS;
  return Math.max(0, Math.min(4, Math.floor(decimals)));
}

/**
 * Jepit nilai kanonis ke [min, max] bila batas diberikan. Nilai
 * kosong tidak pernah dijepit (kosong adalah keadaan sah form).
 */
export function clampQtyValue(canonical: string, opts?: QtyLimits): string {
  if (!canonical) return canonical;
  const value = d(canonical);
  if (!value.isFinite()) return canonical;
  let result = value;
  if (opts?.min !== undefined && result.lt(d(opts.min))) result = d(opts.min);
  if (opts?.max !== undefined && result.gt(d(opts.max))) result = d(opts.max);
  return result.eq(value) ? canonical : toDb(result);
}

export function parseQtyText(raw: string, opts?: QtyLimits): QtyParseResult {
  const decimals = decimalsOf(opts);
  if (raw.trim() === "") return { ok: true, value: "" };
  const text = raw.trim().replace(/\s+/g, "");
  if (text === "") return fail();
  if (!/^[\d.,]+$/.test(text)) return fail();

  let intPart: string;
  let fracPart = "";

  if (text.includes(",")) {
    const parts = text.split(",");
    if (parts.length !== 2) return fail();
    [intPart, fracPart] = parts;
    if (fracPart.length < 1 || fracPart.length > decimals || !/^\d+$/.test(fracPart)) return fail();
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // Pengelompokan ribuan murni, mis. "1.500".
    intPart = text;
  } else if (decimals > 0 && /^\d+\.\d+$/.test(text)) {
    // Titik desimal polos, mis. "1.5" (termasuk tempelan nilai
    // kanonis "2.5000"); panjang pecahan dibatasi langkah konteks.
    const parts = text.split(".");
    if (parts[1].length > Math.max(decimals, 4)) return fail();
    [intPart, fracPart] = parts;
  } else if (/^\d+$/.test(text)) {
    intPart = text;
  } else {
    return fail();
  }

  if (intPart.includes(".")) {
    const groups = intPart.split(".");
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return fail();
    intPart = groups.join("");
  }
  if (!/^\d+$/.test(intPart)) return fail();

  const decimal = d(fracPart ? `${intPart}.${fracPart}` : intPart);
  if (!decimal.isFinite()) return fail();
  return { ok: true, value: clampQtyValue(toDb(decimal), opts) };
}

/** String Decimal kanonis → teks tampilan id-ID ("2.5000" → "2,5"). */
export function formatQtyText(canonical: string, opts?: QtyLimits): string {
  if (!canonical) return "";
  const value = d(canonical);
  if (!value.isFinite()) return "";
  const decimals = decimalsOf(opts);
  const fixed = value.toFixed(decimals);
  const [intRaw, fracRaw = ""] = fixed.split(".");
  const negative = intRaw.startsWith("-");
  const intDigits = negative ? intRaw.slice(1) : intRaw;
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = fracRaw.replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Teks tampilan SELAMA mengetik — kontrak yang sama dengan
 * regroupMoneyText: pemisah ribuan muncul langsung, koma & digit
 * desimal dipertahankan apa adanya sampai langkah konteks.
 */
export function regroupQtyText(raw: string, opts?: QtyLimits): string {
  const decimals = decimalsOf(opts);
  const text = raw.trim();
  const [intRaw, fracRaw] = text.split(",");
  const intDigits = (intRaw ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (fracRaw !== undefined) {
    return `${groupThousands(intDigits)},${fracRaw.replace(/\D/g, "").slice(0, decimals)}`;
  }
  return groupThousands(intDigits);
}

/**
 * Parse di bawah kontrak MENGETIK (sama seperti parseTypedMoneyText):
 * titik di bagian bulat adalah pemisah ribuan yang sedang terbentuk
 * dan dibuang begitu saja; koma satu-satunya pemisah desimal.
 */
export function parseTypedQtyText(raw: string, opts?: QtyLimits): QtyParseResult {
  const decimals = decimalsOf(opts);
  if (raw.trim() === "") return { ok: true, value: "" };
  const text = raw.trim().replace(/\s+/g, "");
  if (text === "") return fail();
  if (!/^[\d.,]+$/.test(text)) return fail();

  const parts = text.split(",");
  if (parts.length > 2) return fail();
  const intDigits = parts[0].replace(/\./g, "");
  const fracPart = parts[1];
  if (fracPart !== undefined && (fracPart.length < 1 || fracPart.length > decimals || !/^\d+$/.test(fracPart))) {
    return fail();
  }
  if (!/^\d+$/.test(intDigits)) return fail();

  const decimal = d(fracPart ? `${intDigits}.${fracPart}` : intDigits);
  if (!decimal.isFinite()) return fail();
  return { ok: true, value: clampQtyValue(toDb(decimal), opts) };
}

export type QtyEditOutcome =
  | { kind: "value"; text: string; value: string }
  | { kind: "pending"; text: string }
  | { kind: "error"; text: string; error: string };

function isPlausibleQtyPrefix(raw: string): boolean {
  const commaCount = (raw.match(/,/g) ?? []).length;
  return /^[\d.,\s]*$/.test(raw) && commaCount <= 1;
}

/**
 * Satu peristiwa perubahan QtyInput, diputuskan di satu tempat
 * (pola applyMoneyEdit): jalur ketik memakai kontrak ketik, jalur
 * tempel memakai parseQtyText; awalan yang masuk akal tetapi belum
 * lengkap ("1,") berstatus "pending" — blur yang menuntaskan.
 *
 * Penjepitan min/max terjadi pada nilai yang diserahkan: bila nilai
 * hasil parse melewati batas, teks tampil dilompatkan ke bentuk
 * terformat dari nilai terjepit — persis perilaku form retur POS
 * lama yang menjepit `min(remaining, max(0, …))` di onChange.
 */
export function applyQtyEdit(
  prevText: string,
  raw: string,
  opts?: QtyLimits & { pasted?: boolean },
): QtyEditOutcome {
  void prevText;
  if (opts?.pasted) {
    const parsed = parseQtyText(raw, opts);
    if (parsed.ok) {
      return { kind: "value", text: formatQtyText(parsed.value, opts), value: parsed.value };
    }
    if (isPlausibleQtyPrefix(raw)) return { kind: "pending", text: raw };
    return { kind: "error", text: raw, error: parsed.error };
  }
  const parsed = parseTypedQtyText(raw, opts);
  if (parsed.ok) {
    const unclamped = parseTypedQtyText(raw, { decimals: opts?.decimals });
    const wasClamped = unclamped.ok && unclamped.value !== parsed.value;
    return {
      kind: "value",
      text: wasClamped ? formatQtyText(parsed.value, opts) : regroupQtyText(raw, opts),
      value: parsed.value,
    };
  }
  if (isPlausibleQtyPrefix(raw)) return { kind: "pending", text: regroupQtyText(raw, opts) };
  return { kind: "error", text: raw, error: parsed.error };
}
