/**
 * A-28 Tahap 1 (H-POS-03): denominasi uang tunai Rupiah untuk hitungan
 * laci saat tutup sesi POS. Hitungan berdenominasi adalah cara masukan
 * `countedCash` di formulir tutup sesi — kasir mengisi jumlah lembar/
 * koin per pecahan dan sistem menjumlahkan totalnya; domain tetap
 * hanya menyimpan SATU angka total (cash_sessions.counted_cash).
 *
 * Daftar mengikuti pecahan Rupiah yang beredar: uang kertas
 * 100.000–1.000 (termasuk pecahan peringatan 75.000) dan uang logam
 * 1.000–100. Urutan menurun agar formulir membacanya dari pecahan
 * terbesar, seperti urutan menyusun uang di laci.
 */
export const IDR_CASH_DENOMINATIONS: readonly number[] = [
  100_000, 75_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
];

/**
 * Total hitungan dari peta pecahan → jumlah lembar/koin. Kunci yang
 * bukan pecahan dikenal diabaikan; jumlah negatif/non-angka dianggap
 * 0 — formulir membatasi masukan, fungsi ini tetap defensif karena
 * hasil totalnya mengalir ke domain sebagai countedCash.
 */
export function denominationTotal(counts: Readonly<Record<string, string | number>>): number {
  let total = 0;
  for (const denom of IDR_CASH_DENOMINATIONS) {
    const raw = counts[String(denom)];
    const pieces = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (Number.isFinite(pieces) && pieces > 0) total += denom * Math.floor(pieces);
  }
  return total;
}
