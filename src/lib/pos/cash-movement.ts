/**
 * Satu-satunya pemetaan antara niat kasir (uang masuk/keluar laci) dan
 * tipe mutasi domain. Domain memakai sudut pandang bank:
 * deposit = setor ke bank (laci keluar), withdrawal = tarik dari bank
 * (laci masuk). UI tidak boleh menebak sendiri.
 */
export type CashMovementIntent = "in" | "out";

export const CASH_MOVEMENT_TYPE_BY_INTENT: Record<
  CashMovementIntent,
  "deposit" | "withdrawal"
> = {
  in: "withdrawal",
  out: "deposit",
};

export function cashMovementToast(type: "deposit" | "withdrawal"): string {
  return type === "withdrawal" ? "Kas masuk" : "Kas keluar";
}
