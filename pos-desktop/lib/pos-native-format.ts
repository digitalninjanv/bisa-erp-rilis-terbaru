/** Format angka & tanggal bersama untuk terminal native (murni, tanpa Tauri). */

export function formatIDR(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function formatQtyLabel(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(value);
}

export function cashTenderSuggestions(total: number): number[] {
  const exact = Math.ceil(total);
  const values = [
    exact,
    Math.ceil((total + 1) / 5_000) * 5_000,
    Math.ceil((total + 1) / 10_000) * 10_000,
    Math.ceil((total + 1) / 20_000) * 20_000,
  ];
  return [...new Set(values)].filter((amount) => amount >= total);
}

export function todayISODate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function dateAfterDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}
