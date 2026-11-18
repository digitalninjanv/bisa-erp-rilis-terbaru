import { describe, expect, it } from "vitest";
import {
  eligiblePromotions,
  promotionDiscountForLine,
  type PromotionLine,
  type PromotionRule,
} from "../../src/lib/pos/promotions";

const line = (overrides: Partial<PromotionLine> = {}): PromotionLine => ({
  productId: "prod-1",
  qty: 3,
  unitPrice: 10000,
  discountType: null,
  discountValue: 0,
  ...overrides,
});

const rule = (overrides: Partial<PromotionRule> = {}): PromotionRule => ({
  id: "promo-1",
  name: "Diskon 10%",
  type: "percent",
  value: 10,
  minSubtotal: 0,
  productId: null,
  ...overrides,
});

describe("promosi POS", () => {
  it("hanya menawarkan promo yang memenuhi minimum subtotal", () => {
    expect(eligiblePromotions([line()], [rule({ minSubtotal: 50000 })])).toHaveLength(0);
    expect(eligiblePromotions([line()], [rule({ minSubtotal: 20000 })])).toHaveLength(1);
  });

  it("hanya menawarkan promo untuk produk yang cocok", () => {
    expect(eligiblePromotions([line()], [rule({ productId: "prod-lain" })])).toHaveLength(0);
    expect(eligiblePromotions([line()], [rule({ productId: "prod-1" })])).toHaveLength(1);
  });

  it("menghitung diskon persen dan nominal per baris tanpa melebihi bruto", () => {
    expect(promotionDiscountForLine(line(), rule({ type: "percent", value: 10 }))).toEqual({
      discountType: "percent", discountValue: 10,
    });
    expect(promotionDiscountForLine(line(), rule({ type: "nominal", value: 5000 }))).toEqual({
      discountType: "nominal", discountValue: 5000,
    });
    expect(promotionDiscountForLine(line({ unitPrice: 1000 }), rule({ type: "nominal", value: 99999 }))).toEqual({
      discountType: "nominal", discountValue: 1000,
    });
  });

  it("tidak menimpa diskon manual yang sudah ada", () => {
    const manual = line({ discountType: "percent", discountValue: 25 });
    expect(promotionDiscountForLine(manual, rule())).toBeNull();
  });
});
