import { describe, expect, it } from "vitest";
import {
  d,
  lineDiscount,
  lineTax,
  receiptLineDiscount,
  roundTo,
  roundTotal,
  sum,
  toDb,
} from "@/lib/money";

describe("roundTo", () => {
  it.each([
    [61_750, 500, "down", 61_500],
    [61_750, 500, "up", 62_000],
    [61_750, 500, "nearest", 62_000],
    [61_700, 500, "nearest", 61_500],
    [809_100, 500, "down", 809_000],
    [809_100, 1000, "down", 809_000],
    [809_100, 1000, "up", 810_000],
    [809_500, 1000, "nearest", 810_000],
    [12_345, 0, "down", 12_345],
  ] as const)("rounds %s to %s %s → %s", (value, step, direction, expected) => {
    expect(roundTo(value, step, direction).toNumber()).toBe(expected);
  });
});

describe("roundTotal", () => {
  it.each([
    ["none", 1234.56, 1234.56, 0],
    ["nearest_100", 1234.56, 1200, -34.56],
    ["nearest_500", 1234.56, 1000, -234.56],
    ["nearest_1000", 1234.56, 1000, -234.56],
    ["nearest_100", 1250, 1300, 50],
    ["up_500", 1234.56, 1500, 265.44],
    ["up_1000", 1000, 1000, 0],
    ["up_1000", 1000.0001, 2000, 999.9999],
  ] as const)("%s on %s → %s", (mode, input, rounded, adjustment) => {
    const result = roundTotal(input, mode);
    expect(result.rounded.toNumber()).toBe(rounded);
    expect(result.adjustment.toNumber()).toBeCloseTo(adjustment, 4);
  });

  it("keeps gain and loss signed", () => {
    expect(roundTotal(1240, "nearest_100").adjustment.toNumber()).toBe(-40);
    expect(roundTotal(1260, "nearest_100").adjustment.toNumber()).toBe(40);
  });
});

describe("lineDiscount", () => {
  it("computes percent discounts from gross", () => {
    expect(
      lineDiscount({ qty: 3, unitPrice: 10_000, type: "percent", value: 10 }).toNumber(),
    ).toBe(3_000);
  });

  it("treats nominal discounts as per-unit", () => {
    expect(
      lineDiscount({ qty: 3, unitPrice: 10_000, type: "nominal", value: 500 }).toNumber(),
    ).toBe(1_500);
  });

  it("never exceeds gross and never goes negative", () => {
    expect(
      lineDiscount({ qty: 1, unitPrice: 1_000, type: "nominal", value: 5_000 }).toNumber(),
    ).toBe(1_000);
    expect(
      lineDiscount({ qty: 1, unitPrice: 1_000, type: "nominal", value: -50 }).toNumber(),
    ).toBe(0);
  });

  it("returns zero without a discount type", () => {
    expect(lineDiscount({ qty: 1, unitPrice: 1_000, value: 10 }).toNumber()).toBe(0);
  });
});

describe("receiptLineDiscount", () => {
  it("computes percent discounts from the line gross", () => {
    expect(receiptLineDiscount(100_000, "percent", 10).toNumber()).toBe(10_000);
  });

  it("treats nominal discounts as the TOTAL line discount", () => {
    expect(receiptLineDiscount(100_000, "nominal", 5_000).toNumber()).toBe(5_000);
  });

  it("returns zero without a type or value", () => {
    expect(receiptLineDiscount(100_000, null, 5_000).toNumber()).toBe(0);
    expect(receiptLineDiscount(100_000, "percent", 0).toNumber()).toBe(0);
  });

  it("does not clamp — the receipt domain rejects over-gross discounts", () => {
    expect(receiptLineDiscount(1_000, "nominal", 5_000).toNumber()).toBe(5_000);
  });
});

describe("lineTax", () => {
  it("extracts inclusive tax from the net amount", () => {
    // 11% inclusive on 111.000 = 11.000
    expect(lineTax({ net: 111_000, rate: 11, inclusive: true }).toNumber()).toBeCloseTo(11_000, 4);
  });

  it("adds exclusive tax on top of net", () => {
    expect(lineTax({ net: 100_000, rate: 11, inclusive: false }).toNumber()).toBeCloseTo(11_000, 4);
  });

  it("returns zero for a zero rate", () => {
    expect(lineTax({ net: 100_000, rate: 0 }).toNumber()).toBe(0);
  });
});

describe("money helpers", () => {
  it("stores four decimal places", () => {
    expect(toDb("1234.5")).toBe("1234.5000");
    expect(toDb(null)).toBe("0.0000");
    expect(toDb(d("0.1").plus("0.2"))).toBe("0.3000");
  });

  it("sums mixed inputs without floating point drift", () => {
    expect(sum(["0.1", 0.2, d("0.3")]).toFixed(4)).toBe("0.6000");
  });
});
