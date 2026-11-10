/**
 * Saldo awal hutang/piutang (T4-5b, D-14) — indeks modul hasil
 * pemecahan A-26 Q8. Mengekspor ulang persis API publik berkas asal
 * server/opening-balances.ts.
 */
export type { OpeningKind, OpeningDoc } from "./documents";
export { createOpeningBalance, voidOpeningBalance } from "./documents";
export { payOpeningBalance, voidOpeningPayment } from "./payments";
