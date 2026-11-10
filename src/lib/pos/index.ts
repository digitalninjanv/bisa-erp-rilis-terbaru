/**
 * Barrel grup POS di lib/ (A-26 Q9) — cermin quote offline terminal (kontrak D-23) dan penangkap burst barcode — dimiliki modul POS; berjalan juga di klien terminal.
 *
 * Peta kepemilikan lengkap lib/ ada di src/lib/README.md. Berkas
 * anggota juga tetap terjangkau lewat fasad lamanya ("@/lib/<nama>")
 * dan jalur penuh grupnya ("@/lib/pos/<nama>").
 */
export * from "./pos-offline";
export * from "./barcode-burst";
