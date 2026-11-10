/**
 * Barrel grup HR & payroll di lib/ (A-26 Q9) — mesin statutori Payroll Indonesia (tarif, PTKP, TER) dan helper HR murni — dimiliki modul HR; logika murni tanpa DB, diuji unit langsung.
 *
 * Peta kepemilikan lengkap lib/ ada di src/lib/README.md. Berkas
 * anggota juga tetap terjangkau lewat fasad lamanya ("@/lib/<nama>")
 * dan jalur penuh grupnya ("@/lib/payroll/<nama>").
 */
export * from "./payroll-indonesia";
export * from "./payroll-indonesia-defaults";
export * from "./hr";
