import { describe, expect, it } from "vitest";
import { isDefinitiveCheckoutError, isHeldSaleUnavailableMessage } from "@/lib/pos/checkout-recovery";
import { computePaymentPlan } from "@/lib/pos/payment-plan";
import { paymentStateAfterCompletedSale } from "@/lib/pos/payment-state";
import { setCartLineQty } from "@/components/pos/terminal/cart-lines";
import { terminalPayState } from "@/components/pos/terminal/use-terminal-pay-state";

const methods = new Map([
  ["cash", { id: "cash", name: "Tunai", type: "cash" }],
  ["qris", { id: "qris", name: "QRIS", type: "qris" }],
  ["credit", { id: "credit", name: "Utang", type: "credit" }],
]);

describe("POS deep hardening — checkout recovery", () => {
  it("treats every server rollback code as definitive", () => {
    for (const code of [
      "VALIDATION",
      "NOT_FOUND",
      "INVALID_STATE",
      "INSUFFICIENT_STOCK",
      "PERIOD_CLOSED",
      "CONFLICT",
      "ALREADY_POSTED",
    ]) {
      expect(isDefinitiveCheckoutError(code)).toBe(true);
    }
    expect(isDefinitiveCheckoutError("INTERNAL")).toBe(false);
    expect(isDefinitiveCheckoutError(undefined)).toBe(false);
  });

  it("recognises a stale held-sale rejection", () => {
    expect(
      isHeldSaleUnavailableMessage("Pesanan tahanan sudah diselesaikan atau tidak tersedia."),
    ).toBe(true);
    expect(isHeldSaleUnavailableMessage("Stok tidak cukup.")).toBe(false);
  });
});

describe("POS deep hardening — payment plan", () => {
  it("detects single cash under-tender, but treats empty tendered as exact", () => {
    const under = computePaymentPlan({
      mode: "single",
      entries: { cash: { amount: "100000", tendered: "50000", reference: "" } },
      methodById: methods,
      total: 100_000,
      singleMethod: "cash",
      single: methods.get("cash"),
      isCreditSingle: false,
      cashTendered: 50_000,
    });
    expect(under.cashShortfall).toBe(50_000);
    expect(under.hasCashUnderpay).toBe(true);

    const exact = computePaymentPlan({
      mode: "single",
      entries: {},
      methodById: methods,
      total: 100_000,
      singleMethod: "cash",
      single: methods.get("cash"),
      isCreditSingle: false,
      cashTendered: 0,
    });
    expect(exact.cashShortfall).toBe(0);
    expect(exact.hasCashUnderpay).toBe(false);
  });

  it("detects mixed cash under-tender against the applied portion", () => {
    const plan = computePaymentPlan({
      mode: "mixed",
      entries: {
        cash: { amount: "50000", tendered: "30000", reference: "" },
        qris: { amount: "50000", tendered: "50000", reference: "" },
      },
      methodById: methods,
      total: 100_000,
      singleMethod: "cash",
      single: methods.get("cash"),
      isCreditSingle: false,
      cashTendered: 0,
    });
    expect(plan.cashShortfall).toBe(20_000);
    expect(plan.hasCashUnderpay).toBe(true);
    expect(plan.outstanding).toBe(0);
  });

  it("does not flag a cash row whose tendered covers the amount actually applied", () => {
    const plan = computePaymentPlan({
      mode: "mixed",
      entries: {
        cash: { amount: "120000", tendered: "120000", reference: "" },
      },
      methodById: methods,
      total: 100_000,
      singleMethod: "cash",
      single: methods.get("cash"),
      isCreditSingle: false,
      cashTendered: 0,
    });
    expect(plan.cashShortfall).toBe(0);
    expect(plan.hasCashUnderpay).toBe(false);
    expect(plan.change).toBe(20_000);
  });
});

describe("POS deep hardening — terminal pay gate", () => {
  const base = {
    cartLoaded: true,
    pendingCheckout: null,
    recoveryError: null,
    submitting: false,
    cartCount: 1,
    sessionOpen: true,
    quote: { total: 100_000 },
    quoting: false,
    quoteError: null,
    quoteBusy: false,
    nonCashNeedsConfirm: false,
    nonCashConfirmed: false,
    hasCashUnderpay: false,
    cashShortfall: 0,
    mixedShortfall: false,
    outstanding: 0,
    total: 100_000,
    serialIncomplete: false,
  };

  it("menonaktifkan Bayar saat tunai kurang", () => {
    const state = terminalPayState({ ...base, hasCashUnderpay: true, cashShortfall: 20_000 });
    expect(state.payDisabled).toBe(true);
    expect(state.payLabel).toContain("Uang diterima kurang");
  });

  it("mengaktifkan Bayar saat semua gerbang lolos", () => {
    const state = terminalPayState(base);
    expect(state.payDisabled).toBe(false);
    expect(state.payLabel).toContain("Bayar");
    expect(state.payLabel).toContain("100.000");
  });
});

describe("POS deep hardening — completed sale payment state", () => {
  it("always clears entries and non-cash confirmation", () => {
    expect(paymentStateAfterCompletedSale()).toEqual({
      entries: {},
      nonCashConfirmedFor: null,
    });
  });
});

describe("POS deep hardening — serial cart qty", () => {
  it("trims hidden trailing serial numbers when qty decreases", () => {
    const next = setCartLineQty(
      [
        {
          productId: "p1",
          qty: 3,
          serialNumbers: ["SN1", "SN2", "SN3"],
        },
      ],
      "p1|",
      2,
      2,
    );
    expect(next[0]?.qty).toBe(2);
    expect(next[0]?.serialNumbers).toEqual(["SN1", "SN2"]);
  });
});
