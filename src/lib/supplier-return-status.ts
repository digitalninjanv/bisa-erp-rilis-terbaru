/**
 * Status retur pemasok yang dianggap sudah terposting dan boleh
 * mengurangi sisa dapat diretur. Ditempatkan di `lib` agar modul
 * katalog (pembaca opsi retur) tidak perlu mengimpor barrel
 * `server/supplier-returns` — impor itu membentuk siklus
 * catalog → supplier-returns → inventory → catalog.
 */
export const POSTED_RETURN_STATUSES = [
  "posted",
  "partially_resolved",
  "resolved",
] as const;
