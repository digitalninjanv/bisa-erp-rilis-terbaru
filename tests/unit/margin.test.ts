import { describe, expect, it } from "vitest";
import { formatMargin, marginPercent, marginTone, priceForMargin } from "@/lib/margin";

describe("margin kotor", () => {
  it("menghitung margin dari harga jual, bukan markup dari HPP", () => {
    // jual 15.000, HPP 10.000 → margin 33,33% (markup 50%).
    expect(marginPercent("10000", "15000")).toBeCloseTo(33.33, 2);
    expect(marginPercent("2600", "4000")).toBeCloseTo(35, 2);
  });

  it("null bila harga jual nol/negatif", () => {
    expect(marginPercent("1000", "0")).toBeNull();
    expect(marginPercent("1000", "-5")).toBeNull();
  });

  it("harga untuk target margin dibulatkan 2 desimal", () => {
    expect(priceForMargin("10000", "25")).toBe("13333.33");
    expect(priceForMargin("2600", "35")).toBe("4000.00");
    expect(priceForMargin("1000", "0")).toBe("1000.00");
    expect(priceForMargin("1000", "100")).toBeNull();
    expect(priceForMargin("1000", "-1")).toBeNull();
  });

  it("nada & format tampilan", () => {
    expect(marginTone(25)).toBe("green");
    expect(marginTone(10)).toBe("amber");
    expect(marginTone(-2)).toBe("red");
    expect(marginTone(null)).toBe("muted");
    expect(formatMargin(23.25)).toBe("23,3%");
    expect(formatMargin(null)).toBe("—");
  });
});
