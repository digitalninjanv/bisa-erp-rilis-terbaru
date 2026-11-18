import { describe, expect, it } from "vitest";
import { buildLoyaltyBalances, loyaltyPointsForTotal } from "../../src/lib/pos/loyalty";

describe("loyalty POS", () => {
  it("memberi 1 poin per Rp10.000", () => {
    expect(loyaltyPointsForTotal(25_000)).toBe(2);
    expect(loyaltyPointsForTotal("50000")).toBe(5);
    expect(loyaltyPointsForTotal(-100)).toBe(0);
  });

  it("mengagregat poin per pelanggan dan mengabaikan penjualan anonim", () => {
    const balances = buildLoyaltyBalances([
      { customerId: "c1", total: 25_000 },
      { customerId: "c1", total: 10_000 },
      { customerId: null, total: 100_000 },
      { customerId: "c2", total: 5_000 },
    ]);
    expect(balances.get("c1")).toBe(3);
    expect(balances.get("c2")).toBeUndefined();
  });
});
