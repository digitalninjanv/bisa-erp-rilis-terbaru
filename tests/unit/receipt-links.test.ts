import { describe, expect, it } from "vitest";
import { invoiceHref, receiptHref } from "@/lib/pos/receipt-links";

describe("POS receipt/invoice links", () => {
  it("carries the first-print token so checkout links are not reprints", () => {
    const token = "01900000-0000-7000-8000-000000000abc";
    expect(receiptHref("sale-1", { printToken: token })).toBe(
      `/app/pos/nota/sale-1?printToken=${token}`,
    );
    expect(invoiceHref("sale-1", { printToken: token })).toBe(
      `/app/pos/nota/sale-1/faktur?printToken=${token}`,
    );
  });

  it("uses salinan=1 only for explicit copies", () => {
    expect(receiptHref("sale-1", { copy: true })).toBe(
      "/app/pos/nota/sale-1?salinan=1",
    );
    expect(invoiceHref("sale-1", { copy: true })).toBe(
      "/app/pos/nota/sale-1/faktur?salinan=1",
    );
    expect(receiptHref("sale-1")).toBe("/app/pos/nota/sale-1");
  });

  it("preserves print and popup options and encodes the sale id", () => {
    expect(
      receiptHref("sale/with space", {
        printToken: "token",
        autoprint: true,
        popup: true,
        copy: true,
      }),
    ).toBe(
      "/app/pos/nota/sale%2Fwith%20space?autoprint=1&popup=1&salinan=1&printToken=token",
    );
  });
});
