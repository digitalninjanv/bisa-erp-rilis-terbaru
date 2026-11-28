import { describe, expect, it } from "vitest";
import { assertHeldSaleOwner } from "@/server/pos/sales-hold";

describe("kepemilikan pesanan ditahan", () => {
  it("kasir yang menahan boleh melanjutkan checkout tahanannya", () => {
    expect(() =>
      assertHeldSaleOwner({
        heldCashierId: "cashier-a",
        userId: "cashier-a",
        canVoid: false,
      }),
    ).not.toThrow();
  });

  it("kasir lain tanpa pos.void tidak boleh menyelesaikan tahanan orang lain", () => {
    expect(() =>
      assertHeldSaleOwner({
        heldCashierId: "cashier-a",
        userId: "cashier-b",
        canVoid: false,
      }),
    ).toThrow(/kasir lain/i);
  });

  it("supervisor dengan pos.void boleh menyelesaikan tahanan kasir lain", () => {
    expect(() =>
      assertHeldSaleOwner({
        heldCashierId: "cashier-a",
        userId: "supervisor",
        canVoid: true,
      }),
    ).not.toThrow();
  });
});
