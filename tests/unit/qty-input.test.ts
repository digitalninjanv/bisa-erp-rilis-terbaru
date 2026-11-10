import { describe, expect, it } from "vitest";
import {
  applyQtyEdit,
  clampQtyValue,
  formatQtyText,
  parseQtyText,
  parseTypedQtyText,
  regroupQtyText,
} from "@/lib/qty-input";

/**
 * G2 (FRM-03): input kuantitas bersama. Kontraknya meniru
 * money-input/percent-input: nilai kanonis adalah string Decimal
 * yang SUDAH hidup di state form & disimpan server selama ini
 * ("2.5000") — lib ini hanya memusatkan tampilan, ketikan & jepit,
 * tidak pernah mengubah nilai bisnisnya.
 */
describe("formatQtyText", () => {
  it.each([
    ["2.5000", "2,5"],
    ["1500.0000", "1.500"],
    ["40.0000", "40"],
    ["0.0000", "0"],
    ["173.0000", "173"],
    ["1250.5000", "1.250,5"],
    ["0.1250", "0,125"],
    ["", ""],
  ])("formats %s → %s", (input, expected) => {
    expect(formatQtyText(input)).toBe(expected);
  });

  it("honours the per-context decimal step", () => {
    expect(formatQtyText("2.0000", { decimals: 0 })).toBe("2");
    expect(formatQtyText("2.1250", { decimals: 4 })).toBe("2,125");
  });
});

describe("parseQtyText (kontrak tempel/blur)", () => {
  it.each([
    ["10", "10.0000"],
    ["1,5", "1.5000"],
    ["1.5", "1.5000"],
    ["2.5000", "2.5000"],
    ["1.500", "1500.0000"],
    ["0", "0.0000"],
    [" 3 ", "3.0000"],
  ])("parses %s → %s", (input, expected) => {
    expect(parseQtyText(input)).toEqual({ ok: true, value: expected });
  });

  it("treats empty input as empty (not an error)", () => {
    expect(parseQtyText("")).toEqual({ ok: true, value: "" });
    expect(parseQtyText("   ")).toEqual({ ok: true, value: "" });
  });

  it.each(["abc", "1,2,3", "-4", "1.2.3", "1,2345"])("rejects %s", (input) => {
    const result = parseQtyText(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Kuantitas tidak terbaca");
  });

  it("accepts a 4th decimal only when the context allows it", () => {
    expect(parseQtyText("1,2345", { decimals: 4 })).toEqual({ ok: true, value: "1.2345" });
  });

  it("round-trips canonical quantities", () => {
    for (const canonical of ["0.0000", "1.0000", "2.5000", "40.0000", "173.0000", "1500.0000"]) {
      expect(parseQtyText(formatQtyText(canonical))).toEqual({ ok: true, value: canonical });
    }
  });
});

describe("jepit min/max (perilaku onChange form retur POS lama)", () => {
  it("clamps parsed values into [min, max]", () => {
    expect(parseQtyText("99", { max: "40" })).toEqual({ ok: true, value: "40.0000" });
    expect(parseQtyText("0", { min: "1" })).toEqual({ ok: true, value: "1.0000" });
    expect(parseQtyText("5", { min: "0", max: "40" })).toEqual({ ok: true, value: "5.0000" });
  });

  it("clampQtyValue leaves in-range and empty values untouched", () => {
    expect(clampQtyValue("5.0000", { min: "0", max: "40" })).toBe("5.0000");
    expect(clampQtyValue("41.0000", { max: "40" })).toBe("40.0000");
    expect(clampQtyValue("", { min: "1" })).toBe("");
  });

  it("clamps while typing too, jumping the text to the clamped value", () => {
    expect(applyQtyEdit("", "99", { max: "40" })).toEqual({ kind: "value", text: "40", value: "40.0000" });
  });
});

describe("parseTypedQtyText (kontrak ketik)", () => {
  it.each([
    ["2", "2.0000"],
    ["1,5", "1.5000"],
    ["1,25", "1.2500"],
    ["0,5", "0.5000"],
  ])("parses %s → %s", (input, expected) => {
    expect(parseTypedQtyText(input)).toEqual({ ok: true, value: expected });
  });

  it("never reinterprets a typed thousand dot as a decimal point", () => {
    // Mengetik "1.500" digit demi digit harus tetap 1500, bukan 1,5.
    expect(parseTypedQtyText("1.500")).toEqual({ ok: true, value: "1500.0000" });
  });
});

describe("applyQtyEdit", () => {
  it("emits canonical values while typing decimals", () => {
    expect(applyQtyEdit("", "1")).toEqual({ kind: "value", text: "1", value: "1.0000" });
    expect(applyQtyEdit("1", "1,")).toEqual({ kind: "pending", text: "1," });
    expect(applyQtyEdit("1,", "1,5")).toEqual({ kind: "value", text: "1,5", value: "1.5000" });
  });

  it("accepts pasted plain-dot decimals", () => {
    expect(applyQtyEdit("", "1.5", { pasted: true })).toEqual({
      kind: "value",
      text: "1,5",
      value: "1.5000",
    });
    expect(applyQtyEdit("", "2.5000", { pasted: true })).toEqual({
      kind: "value",
      text: "2,5",
      value: "2.5000",
    });
  });

  it("reports unreadable text as an error, never NaN", () => {
    expect(applyQtyEdit("", "ab").kind).toBe("error");
  });

  it("regroups while typing", () => {
    expect(regroupQtyText("1500,5")).toBe("1.500,5");
    expect(regroupQtyText("2,")).toBe("2,");
  });
});

describe("paritas parameter payroll (UX4-11)", () => {
  it("nilai kanonis tersimpan tidak berubah oleh tampil/parse", () => {
    // Parameter lama tersimpan "173.0000" (pembagi jam lembur):
    // tampil "173", dan menyimpan dari tampilan itu mengembalikan
    // nilai kanonis yang persis sama.
    expect(formatQtyText("173.0000")).toBe("173");
    expect(parseQtyText(formatQtyText("173.0000"))).toEqual({ ok: true, value: "173.0000" });
  });
});
