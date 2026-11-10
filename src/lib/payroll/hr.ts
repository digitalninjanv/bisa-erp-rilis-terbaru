/**
 * SIM-2 S7B-1 — Helper HR murni (tanpa DB): kalender kerja, keterlambatan,
 * masa kerja. Hari kerja selalu datang dari konfigurasi shift/perusahaan
 * (daftar weekday), tidak pernah diasumsikan di dalam kode — fungsi di
 * sini hanya menghitung dari daftar yang diberikan pemanggil.
 *
 * Konvensi weekday mengikuti Date.getUTCDay(): 0=Minggu … 6=Sabtu.
 */

/** Weekday (0=Minggu … 6=Sabtu) dari tanggal ISO YYYY-MM-DD. */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function isWorkday(isoDate: string, workDays: number[]): boolean {
  return workDays.includes(weekdayOf(isoDate));
}

/** Seluruh tanggal ISO dari `from` s.d. `to` inklusif (maksimal 400 hari). */
export function enumerateDates(from: string, to: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime() && result.length < 400) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

/** Jumlah hari kerja (menurut daftar weekday) pada rentang inklusif. */
export function countWorkdays(from: string, to: string, workDays: number[]): number {
  return enumerateDates(from, to).filter((date) => isWorkday(date, workDays)).length;
}

/** Menit keterlambatan: check-in sesudah jam mulai shift; tidak pernah negatif. */
export function lateMinutes(shiftStart: string, checkIn: string): number {
  const toMinutes = (value: string) => {
    const [hours = 0, minutes = 0] = value.split(":").map((part) => Number(part));
    return hours * 60 + minutes;
  };
  return Math.max(0, toMinutes(checkIn) - toMinutes(shiftStart));
}

/**
 * Bulan penuh masa kerja antara dua tanggal (untuk prorata THR):
 * 2026-01-15 → 2026-07-14 = 5 bulan; → 2026-07-15 = 6 bulan.
 */
export function fullMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

/** Tanggal akhir periode payroll YYYY-MM (pola yang sama dengan lib/format). */
export function periodRange(period: string): { start: string; end: string } {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(lastDay).padStart(2, "0")}`,
  };
}
