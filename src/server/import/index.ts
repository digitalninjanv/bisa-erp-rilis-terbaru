/**
 * Barrel domain impor (A-26 Q6, K-10).
 *
 * T4-5a — analisis & commit impor untuk entitas selain produk.
 * Kerangkanya meniru impor produk persis: analisis menyimpan isu per
 * baris ke `import_rows.error` (hanya baris "pending"), commit berjalan
 * per batch dari baris "pending" dan menandai setiap baris dengan hasil
 * akhirnya (imported/skipped/error + entityId). Produk tetap di jalur
 * lamanya di actions/import/.
 *
 * Definisi hidup per concern di folder ini: files.ts (sidik berkas &
 * deteksi duplikat), masters.ts (pemetaan & pratinjau entitas),
 * analyze.ts (analisis master), commit.ts (commit batch master),
 * opening.ts (commit saldo awal). Parser murni tetap di
 * lib/import-parse & lib/import-classify (dipakai klien juga).
 * Fasad kompatibilitas src/server/import-masters.ts dan
 * src/server/import-files.ts me-re-export dari barrel ini.
 * Jangan menambah definisi di sini.
 */
export * from "./files";
export * from "./masters";
export * from "./analyze";
export * from "./commit";
export * from "./opening";
