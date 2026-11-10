import { describe, expect, it } from "vitest";

import { applyMoneyEdit } from "@/lib/money-input";
import { applyPercentEdit } from "@/lib/percent-input";
import { d } from "@/lib/money";

/**
 * Validasi 3 (F-02) — paritas nilai migrasi residu field mentah →
 * MoneyInput/PercentInput bersama, mengikuti pola A-28 Tahap 4
 * (a28-tahap4-input-parity.test.ts).
 *
 * Empat lokasi yang dimigrasi pada putaran ini:
 * - payment-form & quick-entry/kind-fields: Tarif (%) potongan pajak
 *   (dulu <input> mentah di samping MoneyInput nominal potongan).
 * - advance-panel: mode "Persen potongan" rencana cicilan kasbon
 *   (mode nominalnya sudah MoneyInput; mode persennya mentah).
 * - group-pricing: nilai aturan harga kelompok sadar-mode
 *   (percent → PercentInput, fixed → MoneyInput; dulu satu <input>
 *   mentah untuk keduanya).
 *
 * Kontrak: string kanonis komponen bersama adalah Decimal/Number
 * yang IDENTIK dengan string field mentah lama untuk angka yang
 * sama, termasuk pada perhitungan turunan yang memakai nilainya.
 */

function typePercent(text: string): string {
  let display = "";
  let value = "";
  for (const ch of text) {
    const outcome = applyPercentEdit(display, display + ch);
    if (outcome.kind === "value") {
      display = outcome.text;
      value = outcome.value;
    } else if (outcome.kind === "pending") {
      display = outcome.text;
    } else {
      throw new Error(`Ketikan "${text}" ditolak di "${display + ch}": ${outcome.error}`);
    }
  }
  return value;
}

function typeMoney(text: string): string {
  let display = "";
  let value = "";
  for (const ch of text) {
    const outcome = applyMoneyEdit(display, display + ch);
    if (outcome.kind === "value") {
      display = outcome.text;
      value = outcome.value;
    } else if (outcome.kind === "pending") {
      display = outcome.text;
    } else {
      throw new Error(`Ketikan "${text}" ditolak di "${display + ch}": ${outcome.error}`);
    }
  }
  return value;
}

describe("F-02 PercentInput — tarif potongan pajak & persen kasbon", () => {
  it.each([
    ["tarif PPh 23 lazim", "2", "2"],
    ["tarif PPh 4(2) pecahan", "0,5", "0.5"],
    ["tarif pecahan dua digit", "1,5", "1.5"],
    ["persen potongan kasbon", "50", "50"],
    ["persen kasbon pecahan", "33,33", "33.33"],
  ])("%s: ketik %s → Decimal identik dengan mentah %s", (_ctx, typed, rawBefore) => {
    const canonical = typePercent(typed);
    expect(d(canonical).eq(d(rawBefore))).toBe(true);
    expect(Number(canonical)).toBe(Number(rawBefore));
  });

  it("nominal potongan turunan (payment-form) identik: jumlah × tarif / 100", () => {
    // Jalur lama: d(whRate mentah); jalur baru: d(string kanonis
    // PercentInput) — hasil whDefaultAmount harus persis sama.
    const amount = d("1000000");
    const withRaw = amount.mul(d("2")).div(100).toDecimalPlaces(2);
    const withCanonical = amount.mul(d(typePercent("2"))).div(100).toDecimalPlaces(2);
    expect(withCanonical.eq(withRaw)).toBe(true);
    expect(withCanonical.toFixed(2)).toBe("20000.00");
  });

  it("potongan kasbon per periode identik: gaji pokok × persen / 100", () => {
    const baseSalary = d("5000000");
    const withRaw = baseSalary.mul(d("50")).div(100);
    const withCanonical = baseSalary.mul(d(typePercent("50"))).div(100);
    expect(withCanonical.eq(withRaw)).toBe(true);
    expect(withCanonical.toFixed(0)).toBe("2500000");
  });
});

describe("F-02 group-pricing — nilai aturan sadar-mode", () => {
  it("mode percent: pratinjau harga kelompok identik (Number semantics)", () => {
    // Preview group-pricing memakai Number(ruleValue): string kanonis
    // persen harus menghasilkan angka & harga pratinjau yang sama.
    const normal = 200_000;
    const previewRaw = normal * (1 - Number("10") / 100);
    const previewCanonical = normal * (1 - Number(typePercent("10")) / 100);
    expect(previewCanonical).toBe(previewRaw);
    expect(previewCanonical).toBe(180_000);
  });

  it("mode fixed: harga tetap kanonis MoneyInput Decimal-identik dengan mentah", () => {
    const canonical = typeMoney("150000");
    expect(d(canonical).eq(d("150000"))).toBe(true);
    expect(canonical).toBe("150000.0000");
    // Nilai yang disimpan server (discount_value) terbaca sama.
    expect(Number(canonical)).toBe(Number("150000"));
  });
});
