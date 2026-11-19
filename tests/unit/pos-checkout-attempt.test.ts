import { afterEach, expect, it, vi } from "vitest";
import { clearCheckoutAttempt, readCheckoutAttempt, storeCheckoutAttempt, type CheckoutAttempt } from "@/lib/pos/checkout-attempt";

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}
afterEach(() => vi.unstubAllGlobals());

it("preserves the exact checkout request across reloads, scoped by cashier", () => {
  storage();
  const attempt: CheckoutAttempt = {
    cartSignature: "cart-at-payment",
    request: { warehouseId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      lines: [{ productId: crypto.randomUUID(), qty: 2, discountType: "percent", discountValue: 5 }],
      payments: [{ methodId: crypto.randomUUID(), amount: 19000, tendered: 20000, reference: "paid" }] },
  };
  storeCheckoutAttempt("company.cashier1", attempt);
  expect(readCheckoutAttempt("company.cashier1")).toEqual(attempt);
  expect(readCheckoutAttempt("company.cashier2")).toBeNull();
  clearCheckoutAttempt("company.cashier1");
  expect(readCheckoutAttempt("company.cashier1")).toBeNull();
});

it("fails closed for corrupt or inaccessible storage", () => {
  const values = storage();
  values.set("cashier.checkout", "broken-json");
  expect(() => readCheckoutAttempt("cashier")).toThrow();
  values.set("cashier.checkout", JSON.stringify({ request: { idempotencyKey: "key" } }));
  expect(() => readCheckoutAttempt("cashier")).toThrow(/tidak dapat dibaca/);
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("storage denied"); } });
  expect(() => readCheckoutAttempt("cashier")).toThrow("storage denied");
});
