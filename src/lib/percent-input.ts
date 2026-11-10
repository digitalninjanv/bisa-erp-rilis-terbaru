import { d, toDb } from "./money";

/**
 * A-25 U6 — parsing & formatting untuk input PERSEN id-ID
 * (tarif statutori Payroll Indonesia, tarif TER, ambang persen).
 *
 * Kontraknya SENGAJA meniru `lib/money-input` persis — satu model
 * mental untuk semua input angka di aplikasi:
 *
 * - Nilai kanonis yang diserahkan ke form adalah string Decimal
 *   yang sama seperti yang disimpan server selama ini ("4.0000"
 *   berarti 4 persen — BUKAN pecahan 0,04). Komponen ini hanya
 *   mengubah CARA NILAI DITAMPILKAN & DIKETIK, tidak mengubah
 *   nilai yang disimpan.
 * - Tampilan: pemisah ribuan ".", desimal ",", nol ekor dibuang —
 *   "4.0000" → "4", "1.2700" → "1,27", "0.2400" → "0,24".
 * - Mengetik: koma satu-satunya jalur desimal; titik hanya pemisah
 *   ribuan yang sedang terbentuk (kontrak SIS-01 yang sama).
 * - Tempel: titik desimal polos ("1.27") tetap diterima, dan tanda
 *   "%" di ujung teks dibuang.
 */

export type PercentParseResult = { ok: true; value: string } | { ok: false; error: string };

const ERROR_MESSAGE = "Persen tidak terbaca. Gunakan format seperti 4 atau 1,27.";

function fail(): PercentParseResult {
  return { ok: false, error: ERROR_MESSAGE };
}

function stripPercentSign(raw: string): string {
  return raw.trim().replace(/\s+/g, "").replace(/%$/, "");
}

export function parsePercentText(raw: string): PercentParseResult {
  if (raw.trim() === "") return { ok: true, value: "" };
  const text = stripPercentSign(raw);
  if (text === "") {
    // Input tak kosong tanpa satu pun digit (mis. hanya "%") tidak
    // terbaca, bukan "kosong".
    return /\d/.test(raw) ? { ok: true, value: "" } : fail();
  }
  if (!/^[\d.,]+$/.test(text)) return fail();

  let intPart: string;
  let fracPart = "";

  if (text.includes(",")) {
    const parts = text.split(",");
    if (parts.length !== 2) return fail();
    [intPart, fracPart] = parts;
    if (fracPart.length < 1 || fracPart.length > 4 || !/^\d+$/.test(fracPart)) return fail();
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // Pengelompokan ribuan murni, mis. "1.500".
    intPart = text;
  } else if (/^\d+\.\d{1,4}$/.test(text)) {
    // Titik desimal polos, mis. "1.27" (termasuk tempelan nilai
    // kanonis "1.2700").
    [intPart, fracPart] = text.split(".");
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
  return { ok: true, value: toDb(decimal) };
}

/** String Decimal kanonis → teks tampilan id-ID ("1.2700" → "1,27"). */
export function formatPercentText(canonical: string): string {
  if (!canonical) return "";
  const value = d(canonical);
  if (!value.isFinite()) return "";
  const [intRaw, fracRaw = ""] = value.toFixed(4).split(".");
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
 * desimal dipertahankan apa adanya, titik tidak pernah ditafsir
 * ulang sebagai titik desimal di tengah ketikan.
 */
export function regroupPercentText(raw: string): string {
  const text = raw.trim().replace(/%$/, "");
  const [intRaw, fracRaw] = text.split(",");
  const intDigits = (intRaw ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (fracRaw !== undefined) {
    return `${groupThousands(intDigits)},${fracRaw.replace(/\D/g, "").slice(0, 4)}`;
  }
  return groupThousands(intDigits);
}

/**
 * Parse di bawah kontrak MENGETIK (sama seperti parseTypedMoneyText):
 * titik di bagian bulat adalah pemisah ribuan yang sedang terbentuk
 * dan dibuang begitu saja; koma satu-satunya pemisah desimal.
 */
export function parseTypedPercentText(raw: string): PercentParseResult {
  if (raw.trim() === "") return { ok: true, value: "" };
  const text = stripPercentSign(raw);
  if (text === "") {
    return /\d/.test(raw) ? { ok: true, value: "" } : fail();
  }
  if (!/^[\d.,]+$/.test(text)) return fail();

  const parts = text.split(",");
  if (parts.length > 2) return fail();
  const intDigits = parts[0].replace(/\./g, "");
  const fracPart = parts[1];
  if (fracPart !== undefined && (fracPart.length < 1 || fracPart.length > 4 || !/^\d+$/.test(fracPart))) {
    return fail();
  }
  if (!/^\d+$/.test(intDigits)) return fail();

  const decimal = d(fracPart ? `${intDigits}.${fracPart}` : intDigits);
  if (!decimal.isFinite()) return fail();
  return { ok: true, value: toDb(decimal) };
}

export type PercentEditOutcome =
  | { kind: "value"; text: string; value: string }
  | { kind: "pending"; text: string }
  | { kind: "error"; text: string; error: string };

function isPlausiblePercentPrefix(raw: string): boolean {
  const commaCount = (raw.match(/,/g) ?? []).length;
  return /^[\d.,\s%]*$/.test(raw) && commaCount <= 1;
}

/**
 * Satu peristiwa perubahan PercentInput, diputuskan di satu tempat
 * (pola applyMoneyEdit): jalur ketik memakai kontrak ketik, jalur
 * tempel memakai parsePercentText, awalan yang masuk akal tetapi
 * belum lengkap ("1,") berstatus "pending" — blur yang menuntaskan.
 */
export function applyPercentEdit(
  prevText: string,
  raw: string,
  opts?: { pasted?: boolean },
): PercentEditOutcome {
  void prevText;
  if (opts?.pasted) {
    const parsed = parsePercentText(raw);
    if (parsed.ok) {
      return { kind: "value", text: formatPercentText(parsed.value), value: parsed.value };
    }
    if (isPlausiblePercentPrefix(raw)) return { kind: "pending", text: raw };
    return { kind: "error", text: raw, error: parsed.error };
  }
  const parsed = parseTypedPercentText(raw);
  if (parsed.ok) {
    return { kind: "value", text: regroupPercentText(raw), value: parsed.value };
  }
  if (isPlausiblePercentPrefix(raw)) return { kind: "pending", text: regroupPercentText(raw) };
  return { kind: "error", text: raw, error: parsed.error };
}
