import { describe, expect, it } from "vitest";
import { encodeCode128B } from "@/lib/barcode-svg";
import { computeLocalOfflineQuote } from "@/lib/pos/pos-offline";
import { eligiblePromotions, promotionDiscountForLine } from "@/lib/pos/promotions";

describe("Workflow harian minimarket", () => {
  it("memisahkan produk kena PPN (BKP) dan bebas PPN (Non-BKP) dalam satu keranjang", () => {
    const quote = computeLocalOfflineQuote({
      taxRate: 11,
      companyRoundingMode: "none",
      catalog: {
        beras: {
          name: "Beras Ramos 5kg",
          sku: "BRS-5KG",
          salePrice: 75000,
          stock: 20,
          trackStock: true,
          trackSerial: false,
          isTaxExempt: true,
        },
        snack: {
          name: "Keripik Kentang 100g",
          sku: "SNK-100",
          salePrice: 11100,
          stock: 30,
          trackStock: true,
          trackSerial: false,
          isTaxExempt: false,
        },
      },
      lines: [
        { productId: "beras", qty: 1 },
        { productId: "snack", qty: 1 },
      ],
    });

    expect(quote).not.toBeNull();
    expect(quote!.lines[0].taxRate).toBe(0);
    expect(quote!.lines[0].taxAmount).toBe(0);
    expect(quote!.lines[1].taxRate).toBe(11);
    expect(quote!.lines[1].taxAmount).toBe(1100);
    expect(quote!.taxTotal).toBe(1100);
    expect(quote!.total).toBe(86100);
  });

  it("menghasilkan bar Code-128B valid untuk barcode produk dan mengabaikan string kosong", () => {
    expect(encodeCode128B("   ")).toBeNull();
    const encoded = encodeCode128B("8992761139014");
    expect(encoded).not.toBeNull();
    expect(encoded!.value).toBe("8992761139014");
    expect(encoded!.bars.length).toBeGreaterThan(20);
    expect(encoded!.totalWidth).toBeGreaterThan(100);
  });

  it("mengevaluasi promo yang memenuhi syarat tanpa menimpa diskon manual kasir", () => {
    const rules = [
      { id: "p1", name: "Diskon Akhir Pekan", type: "percent" as const, value: 10, minSubtotal: 50000, productId: null },
      { id: "p2", name: "Min Belanja 200rb", type: "nominal" as const, value: 5000, minSubtotal: 200000, productId: null },
    ];
    const lines = [
      { productId: "a", qty: 2, unitPrice: 30000, discountType: null, discountValue: 0 },
      { productId: "b", qty: 1, unitPrice: 10000, discountType: "percent" as const, discountValue: 5 },
    ];
    const eligible = eligiblePromotions(lines, rules);
    expect(eligible.map((r) => r.id)).toEqual(["p1"]);
    expect(promotionDiscountForLine(lines[0], rules[0])).toEqual({ discountType: "percent", discountValue: 10 });
    expect(promotionDiscountForLine(lines[1], rules[0])).toBeNull();
  });
});
