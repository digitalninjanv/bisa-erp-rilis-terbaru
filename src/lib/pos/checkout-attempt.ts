import type { checkoutAction } from "@/server/actions/pos";

export type CheckoutAttempt = {
  request: Parameters<typeof checkoutAction>[0];
  cartSignature: string;
};

export function readCheckoutAttempt(storageKey: string): CheckoutAttempt | null {
  const raw = localStorage.getItem(`${storageKey}.checkout`);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.cartSignature !== "string" || !value.request ||
      typeof value.request !== "object" || typeof value.request.idempotencyKey !== "string" ||
      !Array.isArray(value.request.lines) || !Array.isArray(value.request.payments)) {
    throw new Error("Data percobaan pembayaran tidak dapat dibaca. Periksa riwayat bersama supervisor.");
  }
  // Restored input is untrusted; checkoutAction validates every field before using it.
  return value;
}

export function storeCheckoutAttempt(storageKey: string, attempt: CheckoutAttempt): void {
  localStorage.setItem(`${storageKey}.checkout`, JSON.stringify(attempt));
}

export function clearCheckoutAttempt(storageKey: string): void {
  localStorage.removeItem(`${storageKey}.checkout`);
}
