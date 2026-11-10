/**
 * Barrel skema database (A-26 Q2).
 *
 * Definisi tabel hidup per domain di src/db/schema/; berkas ini hanya
 * me-re-export agar setiap impor "@/db/schema" yang sudah ada tetap sah
 * dengan nama & tipe identik. Jangan menambah definisi di sini.
 */
export * from "./schema/index";
