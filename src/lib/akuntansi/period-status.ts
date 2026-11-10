/**
 * FIX-P1 Tahap 5 (AK5-03): penilaian status periode untuk TANGGAL yang
 * dipilih di formulir — cermin semantik domain `assertPeriodOpen`
 * (FIX-P1 Tahap 3, AK1-01) agar peringatan di formulir tidak pernah
 * berjanji lebih longgar daripada yang akan ditegakkan server:
 *
 * - baris periode ada → statusnya yang berlaku;
 * - tanpa baris & tahun = tahun berjalan / berikutnya → "open"
 *   (barisnya termaterialisasi otomatis saat posting);
 * - tanpa baris & tahun lain → "missing" (dianggap tertutup; hanya
 *   owner yang dapat mematerialisasinya dari halaman Periode).
 */

export type PeriodStatusRow = { year: number; month: number; status: string };
export type EffectivePeriodStatus = "open" | "closed" | "locked" | "missing";

export function periodStatusForDate(
  periods: readonly PeriodStatusRow[],
  date: string,
  currentYear: number,
): EffectivePeriodStatus | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const row = periods.find((p) => p.year === year && p.month === month);
  if (row) {
    if (row.status === "closed" || row.status === "locked") return row.status;
    return "open";
  }
  if (year === currentYear || year === currentYear + 1) return "open";
  return "missing";
}
