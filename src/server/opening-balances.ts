/**
 * Barrel modul saldo awal (A-26 Q8, K-10).
 *
 * Definisi hidup di src/server/opening-balances/ (documents.ts &
 * payments.ts); berkas ini hanya me-re-export agar setiap impor
 * "@/server/opening-balances" yang sudah ada tetap sah dengan nama &
 * tanda tangan identik. Jangan menambah definisi di sini.
 */
export * from "./opening-balances/index";
