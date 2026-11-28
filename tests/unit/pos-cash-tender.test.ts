import { describe, expect, it } from "vitest";
import { cashTenderError } from "@/lib/pos/payment-plan";

describe("uang diterima tunai harus eksplisit", () => {
  it("kolom kosong tidak lagi dianggap uang pas", () => {
    expect(cashTenderError({ total: 25_000, tendered: 0, isCash: true })).toMatch(/uang pas/i);
  });

  it("nominal kurang dari total ditolak", () => {
    expect(cashTenderError({ total: 25_000, tendered: 10_000, isCash: true })).toMatch(/kurang/i);
  });

  it("uang pas dan lebih bayar diterima", () => {
    expect(cashTenderError({ total: 25_000, tendered: 25_000, isCash: true })).toBeNull();
    expect(cashTenderError({ total: 25_000, tendered: 50_000, isCash: true })).toBeNull();
  });

  it("metode non-tunai tidak membutuhkan nominal diterima", () => {
    expect(cashTenderError({ total: 25_000, tendered: 0, isCash: false })).toBeNull();
  });
});
