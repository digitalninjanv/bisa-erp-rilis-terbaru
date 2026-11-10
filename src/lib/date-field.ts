/**
 * A-25 U2 — logika murni komponen DateField bersama (pasangan
 * `src/components/date-field.tsx`), mengikuti pola lib/money-input:
 * nilai yang dipertukarkan komponen selalu ISO `yyyy-mm-dd`
 * ("" = kosong), sedangkan teks yang DILIHAT pengguna selalu format
 * Indonesia `dd/mm/yyyy`. Sisa U0 ditutup di sini: input tanggal
 * native merender mm/dd/yyyy di Chromium tanpa memandang `lang`,
 * jadi format tampilan tidak lagi diserahkan ke peramban.
 *
 * Parser menerima yang wajar diketik/ditempel pengguna Indonesia:
 * - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (satu/dua digit)
 * - yyyy-mm-dd (ISO, mis. hasil tempel dari sistem lain)
 * - "6 Nov 2026" / "6 November 2026" (nama bulan Indonesia, singkat
 *   atau penuh, tidak peka huruf besar/kecil)
 * Tanggal kalender yang tidak ada (31/02) ditolak — bukan digeser.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, ags: 8, agustus: 8,
  sep: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  des: 12, desember: 12,
};

export const DATE_DISPLAY_PLACEHOLDER = "dd/mm/yyyy";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Putaran UTC membuktikan tanggalnya benar-benar ada di kalender.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** ISO `yyyy-mm-dd` → tampilan `dd/mm/yyyy`. Input tak dikenal → "". */
export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export type DateParseResult = { ok: true; value: string } | { ok: false; error: string };

const INVALID_MESSAGE = "Tanggal tidak valid — gunakan format dd/mm/yyyy.";

/** Teks tampilan → ISO. Teks kosong adalah nilai kosong yang sah. */
export function parseDateText(raw: string): DateParseResult {
  const text = raw.trim();
  if (text === "") return { ok: true, value: "" };

  // ISO lebih dulu: yyyy-mm-dd (juga hasil tempel antar-sistem).
  const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (isoMatch) {
    const value = toISO(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    return value ? { ok: true, value } : { ok: false, error: INVALID_MESSAGE };
  }

  // dd/mm/yyyy dengan pemisah /, -, atau .
  const dmyMatch = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
  if (dmyMatch) {
    const value = toISO(Number(dmyMatch[3]), Number(dmyMatch[2]), Number(dmyMatch[1]));
    return value ? { ok: true, value } : { ok: false, error: INVALID_MESSAGE };
  }

  // "6 Nov 2026" / "6 November 2026"
  const namedMatch = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(text);
  if (namedMatch) {
    const month = MONTH_NAMES[namedMatch[2].toLowerCase()];
    if (month) {
      const value = toISO(Number(namedMatch[3]), month, Number(namedMatch[1]));
      if (value) return { ok: true, value };
    }
    return { ok: false, error: INVALID_MESSAGE };
  }

  return { ok: false, error: INVALID_MESSAGE };
}

/**
 * Pengelompokan otomatis saat mengetik: deretan digit murni (dengan
 * atau tanpa pemisah yang sudah diketik) disusun menjadi dd/mm/yyyy
 * secara progresif — "06" → "06", "061" → "06/1", "06112026" →
 * "06/11/2026". Teks yang mengandung huruf (nama bulan) dibiarkan
 * apa adanya agar jalur "6 Nov 2026" tidak dirusak.
 */
export function groupDateDigits(raw: string): string {
  if (/[A-Za-z]/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Apakah teks sudah merupakan tanggal lengkap yang terbaca? */
export function isCompleteDateText(raw: string): boolean {
  const result = parseDateText(raw);
  return result.ok && result.value !== "";
}
