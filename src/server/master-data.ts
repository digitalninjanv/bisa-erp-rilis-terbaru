/**
 * Barrel modul master data (A-26 Q8, K-10).
 *
 * Definisi hidup per agregat di src/server/master-data/;
 * berkas ini hanya me-re-export agar setiap impor
 * "@/server/master-data" yang sudah ada tetap sah dengan nama &
 * tanda tangan identik. Jangan menambah definisi di sini.
 */
export * from "./master-data/index";
