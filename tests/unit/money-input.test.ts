import { describe, expect, it } from "vitest";
import {
  applyMoneyEdit,
  formatMoneyText,
  isIncrementalMoneyEdit,
  parseMoneyText,
  parseTypedMoneyText,
  regroupMoneyText,
} from "@/lib/money-input";

/**
 * AK-P3-05(b): input nominal id-ID. parseMoneyText menerima teks yang
 * diketik pengguna (pemisah ribuan titik, desimal koma — atau angka polos)
 * dan mengembalikan string Decimal kanonis 4 desimal, atau pesan kesalahan
 * Bahasa Indonesia. Tidak pernah mengembalikan NaN diam-diam.
 */
describe("parseMoneyText", () => {
  it.each([
    ["1500000", "1500000.0000"],
    ["1.500.000", "1500000.0000"],
    ["1.500.000,50", "1500000.5000"],
    ["1.234.567,89", "1234567.8900"],
    ["1500,5", "1500.5000"],
    ["1500.5", "1500.5000"],
    ["1.5000", "1.5000"],
    ["0", "0.0000"],
    ["0,00", "0.0000"],
    ["12.345", "12345.0000"],
    ["Rp 1.500", "1500.0000"],
    [" 250.000 ", "250000.0000"],
  ])("parses %s → %s", (input, expected) => {
    expect(parseMoneyText(input)).toEqual({ ok: true, value: expected });
  });

  it("treats empty input as empty (not an error)", () => {
    expect(parseMoneyText("")).toEqual({ ok: true, value: "" });
    expect(parseMoneyText("   ")).toEqual({ ok: true, value: "" });
  });

  it.each(["abc", "1,2,3", "1.2.3", "-100", "1.50.000", "100,00001", "1.500.00", "Rp"])(
    "rejects %s with an Indonesian error message",
    (input) => {
      const result = parseMoneyText(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    },
  );
});

/**
 * A-23 SIS-01: kontrak MENGETIK berbeda dari kontrak tempel/commit.
 * Selama mengetik, titik adalah pemisah ribuan yang sedang terbentuk —
 * nilai kanonis setiap keadaan antara harus sama dengan awalan digit
 * yang diketik (1→15→150→1.500→15.000→…), dan koma adalah satu-satunya
 * jalan desimal. parseMoneyText (tempel/blur) tidak berubah.
 */
describe("regroupMoneyText (semantik mengetik)", () => {
  it("never turns an in-progress thousand group into a decimal comma", () => {
    expect(regroupMoneyText("1.5000")).toBe("15.000");
    expect(regroupMoneyText("1.50000")).toBe("150.000");
    expect(regroupMoneyText("1500.5")).toBe("15.005");
  });

  it("keeps the comma fraction as typed", () => {
    expect(regroupMoneyText("1.500,")).toBe("1.500,");
    expect(regroupMoneyText("250.000,75")).toBe("250.000,75");
  });
});

describe("parseTypedMoneyText", () => {
  it.each([
    ["1.5000", "15000.0000"],
    ["15.000", "15000.0000"],
    ["1.500.000", "1500000.0000"],
    ["1.500,5", "1500.5000"],
    ["0,05", "0.0500"],
    ["1500.", "1500.0000"],
    ["", ""],
  ])("parses typed %s → %s", (input, expected) => {
    expect(parseTypedMoneyText(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["abc", "1,2,3", "-100", "1.500,"])("rejects typed %s", (input) => {
    expect(parseTypedMoneyText(input).ok).toBe(false);
  });
});

describe("isIncrementalMoneyEdit", () => {
  it.each([
    ["1.500", "1.5000"],
    ["15.000", "15.00"],
    ["1.500", "12.500"],
    ["1.500.000", "5"],
    ["", "1"],
    ["1.500,", "1.500,5"],
  ])("treats %s → %s as typing", (prev, next) => {
    expect(isIncrementalMoneyEdit(prev, next)).toBe(true);
  });

  it.each([
    ["", "1500.5"],
    ["", "1.500.000"],
    ["1.500", "9.999.999"],
  ])("treats %s → %s as a fresh paste", (prev, next) => {
    expect(isIncrementalMoneyEdit(prev, next)).toBe(false);
  });
});

/** Simulates the MoneyInput component: one applyMoneyEdit per keystroke. */
function typeKeys(keys: string) {
  let text = "";
  let value = "";
  const emitted: string[] = [];
  for (const ch of keys) {
    const outcome = applyMoneyEdit(text, text + ch);
    text = outcome.text;
    if (outcome.kind === "value") {
      value = outcome.value;
      emitted.push(outcome.value);
    }
  }
  return { text, value, emitted };
}

function backspace(state: { text: string; value: string }) {
  const outcome = applyMoneyEdit(state.text, state.text.slice(0, -1));
  return {
    text: outcome.text,
    value: outcome.kind === "value" ? outcome.value : state.value,
  };
}

describe("applyMoneyEdit — keystroke simulation (SIS-01 regression)", () => {
  it("typing 1500000 digit by digit keeps every prefix value exact", () => {
    const { text, value, emitted } = typeKeys("1500000");
    expect(emitted).toEqual([
      "1.0000",
      "15.0000",
      "150.0000",
      "1500.0000",
      "15000.0000",
      "150000.0000",
      "1500000.0000",
    ]);
    expect(text).toBe("1.500.000");
    expect(value).toBe("1500000.0000");
  });

  it("typing a 9-digit amount stays exact", () => {
    const { text, value } = typeKeys("123456789");
    expect(text).toBe("123.456.789");
    expect(value).toBe("123456789.0000");
  });

  it("typing a comma fraction reaches the decimal value", () => {
    const { text, value } = typeKeys("1500,5");
    expect(text).toBe("1.500,5");
    expect(value).toBe("1500.5000");
    const big = typeKeys("250000,75");
    expect(big.text).toBe("250.000,75");
    expect(big.value).toBe("250000.7500");
  });

  it("backspace across a thousand separator removes one digit of value", () => {
    let state: { text: string; value: string } = typeKeys("1500000");
    expect(state.text).toBe("1.500.000");
    state = backspace(state);
    expect(state).toEqual({ text: "150.000", value: "150000.0000" });
    state = backspace(state);
    expect(state).toEqual({ text: "15.000", value: "15000.0000" });
    state = backspace(state);
    expect(state).toEqual({ text: "1.500", value: "1500.0000" });
    state = backspace(state);
    expect(state).toEqual({ text: "150", value: "150.0000" });
  });

  it("backspace over the comma leaves a pending state, then recovers", () => {
    let state: { text: string; value: string } = typeKeys("1500,5");
    state = backspace(state); // removes "5" → "1.500," pending, value stays
    expect(state.text).toBe("1.500,");
    expect(state.value).toBe("1500.5000");
    state = backspace(state); // removes "," → plain 1500 again
    expect(state).toEqual({ text: "1.500", value: "1500.0000" });
  });

  it("typing garbage reports an Indonesian error instead of emitting", () => {
    const outcome = applyMoneyEdit("", "a");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") expect(outcome.error.length).toBeGreaterThan(0);
  });
});

describe("applyMoneyEdit — paste keeps commit semantics", () => {
  it("pasting a plain decimal dot still means a decimal", () => {
    const outcome = applyMoneyEdit("", "1500.5", { pasted: true });
    expect(outcome).toEqual({ kind: "value", text: "1.500,5", value: "1500.5000" });
  });

  it("pasting a grouped value formats the display to the canonical value", () => {
    const outcome = applyMoneyEdit("", "1.500.000", { pasted: true });
    expect(outcome).toEqual({ kind: "value", text: "1.500.000", value: "1500000.0000" });
  });

  it("pasting the ambiguous 1.5000 keeps the legacy parse meaning (1.5)", () => {
    const outcome = applyMoneyEdit("", "1.5000", { pasted: true });
    expect(outcome).toEqual({ kind: "value", text: "1,5", value: "1.5000" });
  });

  it("pasting garbage is an error, a plausible prefix stays pending", () => {
    expect(applyMoneyEdit("", "abc", { pasted: true }).kind).toBe("error");
    expect(applyMoneyEdit("", "1.500,", { pasted: true }).kind).toBe("pending");
  });
});

describe("formatMoneyText", () => {
  it.each([
    ["1500000.0000", "1.500.000"],
    ["1500000.5000", "1.500.000,5"],
    ["1234567.8900", "1.234.567,89"],
    ["0.0000", "0"],
    ["", ""],
    ["250000", "250.000"],
  ])("formats %s → %s", (input, expected) => {
    expect(formatMoneyText(input)).toBe(expected);
  });

  it("round-trips through parseMoneyText", () => {
    for (const canonical of ["1500000.0000", "1234567.8900", "0.5000", "42.0000"]) {
      expect(parseMoneyText(formatMoneyText(canonical))).toEqual({ ok: true, value: canonical });
    }
  });
});
