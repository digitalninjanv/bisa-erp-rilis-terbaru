import { describe, expect, it } from "vitest";
import {
  applyPercentEdit,
  formatPercentText,
  parsePercentText,
  parseTypedPercentText,
  regroupPercentText,
} from "@/lib/percent-input";

/**
 * A-25 U6: input persen statutori. Kontraknya meniru money-input:
 * nilai kanonis adalah string Decimal persen yang SUDAH disimpan
 * server selama ini ("4.0000" = 4%) — lib ini hanya mengubah
 * tampilan & ketikan, tidak pernah mengubah nilai kanonis.
 */
describe("formatPercentText", () => {
  it.each([
    ["4.0000", "4"],
    ["1.2700", "1,27"],
    ["0.2400", "0,24"],
    ["3.7000", "3,7"],
    ["20.0000", "20"],
    ["100.0000", "100"],
    ["0.0000", "0"],
    ["1250.5000", "1.250,5"],
    ["", ""],
  ])("formats %s → %s", (input, expected) => {
    expect(formatPercentText(input)).toBe(expected);
  });
});

describe("parsePercentText (kontrak tempel/blur)", () => {
  it.each([
    ["4", "4.0000"],
    ["4,5", "4.5000"],
    ["1,27", "1.2700"],
    ["1.27", "1.2700"],
    ["1.2700", "1.2700"],
    ["0,24", "0.2400"],
    ["20", "20.0000"],
    ["4%", "4.0000"],
    ["4 %", "4.0000"],
    [" 1,27 ", "1.2700"],
    ["0", "0.0000"],
  ])("parses %s → %s", (input, expected) => {
    expect(parsePercentText(input)).toEqual({ ok: true, value: expected });
  });

  it("treats empty input as empty (not an error)", () => {
    expect(parsePercentText("")).toEqual({ ok: true, value: "" });
    expect(parsePercentText("   ")).toEqual({ ok: true, value: "" });
  });

  it.each(["abc", "1,2,3", "-4", "%", "4,12345", "1.2.3"])("rejects %s", (input) => {
    const result = parsePercentText(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Persen tidak terbaca");
  });

  it("round-trips canonical statutory rates", () => {
    for (const canonical of ["0.2400", "0.3000", "1.0000", "1.2700", "2.0000", "3.7000", "4.0000", "5.0000", "20.0000"]) {
      const parsed = parsePercentText(formatPercentText(canonical));
      expect(parsed).toEqual({ ok: true, value: canonical });
    }
  });
});

describe("parseTypedPercentText (kontrak ketik)", () => {
  it.each([
    ["4", "4.0000"],
    ["1,27", "1.2700"],
    ["1,2", "1.2000"],
    ["0,24", "0.2400"],
    ["12,5", "12.5000"],
  ])("parses %s → %s", (input, expected) => {
    expect(parseTypedPercentText(input)).toEqual({ ok: true, value: expected });
  });

  it("never reinterprets a typed thousand dot as a decimal point", () => {
    // Mengetik "1.250" digit demi digit harus tetap 1250, bukan 1,25.
    expect(parseTypedPercentText("1.250")).toEqual({ ok: true, value: "1250.0000" });
  });
});

describe("applyPercentEdit", () => {
  it("emits canonical values while typing decimals", () => {
    expect(applyPercentEdit("", "1")).toEqual({ kind: "value", text: "1", value: "1.0000" });
    expect(applyPercentEdit("1", "1,")).toEqual({ kind: "pending", text: "1," });
    expect(applyPercentEdit("1,", "1,2")).toEqual({ kind: "value", text: "1,2", value: "1.2000" });
    expect(applyPercentEdit("1,2", "1,27")).toEqual({ kind: "value", text: "1,27", value: "1.2700" });
  });

  it("accepts pasted plain-dot decimals and percent signs", () => {
    expect(applyPercentEdit("", "1.27", { pasted: true })).toEqual({
      kind: "value",
      text: "1,27",
      value: "1.2700",
    });
    expect(applyPercentEdit("", "4%", { pasted: true })).toEqual({
      kind: "value",
      text: "4",
      value: "4.0000",
    });
  });

  it("reports unreadable text as an error, never NaN", () => {
    const outcome = applyPercentEdit("", "ab");
    expect(outcome.kind).toBe("error");
  });

  it("regroups while typing", () => {
    expect(regroupPercentText("1250,5")).toBe("1.250,5");
    expect(regroupPercentText("4,")).toBe("4,");
  });
});
