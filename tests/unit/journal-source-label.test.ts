import { describe, expect, it } from "vitest";
import { journalSourceLabel } from "@/lib/format";
import { formatIDR, formatIDRSigned } from "@/lib/money";

// CT-14: cash-flow / journal source types must read as Bahasa Indonesia
// labels from ONE shared mapping — never as raw snake_case system words.
describe("journalSourceLabel (CT-14)", () => {
  it.each([
    ["sale", "Penjualan"],
    ["sale_return", "Retur penjualan"],
    ["payment", "Penerimaan pembayaran"],
    ["payroll", "Beban gaji"],
    ["payroll_payment", "Pembayaran gaji"],
    ["opening", "Saldo awal"],
    ["opening_balance", "Saldo awal"],
    ["bank_transfer", "Transfer bank"],
    ["bank_statement", "Mutasi bank"],
    ["manual", "Jurnal manual"],
    ["purchase", "Pembelian"],
    ["receipt_opening", "Penerimaan stok awal"],
    ["receipt_bonus", "Bonus penerimaan barang"],
    ["receipt_customer_return", "Retur pelanggan"],
    ["receipt_other", "Penerimaan lainnya"],
    ["purchase_return", "Retur pembelian"],
    ["adjustment", "Penyesuaian stok"],
    ["opname", "Stok opname"],
    // FIX-GDG Tahap 3: jurnal selisih transfer dua tahap (GDG tunda
    // Tahap 2) sebelumnya jatuh ke fallback kata-per-kata.
    ["transfer_difference", "Selisih transfer"],
    ["expense", "Beban"],
    ["capital", "Setoran modal"],
    ["cash_session", "Sesi kas"],
    ["cash_movement", "Pergerakan kas"],
  ] as const)("maps %s → %s", (sourceType, label) => {
    expect(journalSourceLabel(sourceType)).toBe(label);
  });

  it.each([
    ["sale_reversal", "Pembalikan penjualan"],
    ["bank_transfer_reversal", "Pembalikan transfer bank"],
    ["manual_reversal", "Pembalikan jurnal manual"],
    ["payment_reversal", "Pembalikan penerimaan pembayaran"],
    ["transfer_difference_reversal", "Pembalikan selisih transfer"],
  ] as const)("maps reversal %s → %s", (sourceType, label) => {
    expect(journalSourceLabel(sourceType)).toBe(label);
  });

  it("never leaks raw snake_case for unknown types", () => {
    const label = journalSourceLabel("some_new_source");
    expect(label).not.toContain("_");
    expect(label.length).toBeGreaterThan(0);
  });
});

// CT-15: report figures that ROUND to zero must print as "Rp 0" — a
// negative zero ("− Rp 0") on an official statement reads as an error.
describe("formatIDRSigned (CT-15)", () => {
  it("renders exact zero without a sign", () => {
    expect(formatIDRSigned(0)).toBe(formatIDR(0));
    expect(formatIDRSigned(0)).not.toMatch(/[-−]/);
  });

  it("normalizes values that round to zero", () => {
    for (const value of [-0.0001, -0.4, "-0.0000", -0]) {
      const rendered = formatIDRSigned(value);
      expect(rendered, `value=${value}`).toBe(formatIDR(0));
      expect(rendered).not.toMatch(/[-−]/);
    }
  });

  it("keeps the minus on genuinely negative amounts", () => {
    expect(formatIDRSigned(-64236000)).toBe(formatIDR(-64236000));
    expect(formatIDRSigned(-64236000)).toMatch(/[-−]/);
    expect(formatIDRSigned(-1)).toMatch(/[-−]/);
  });

  it("renders positives exactly like formatIDR", () => {
    expect(formatIDRSigned(1500000)).toBe(formatIDR(1500000));
    expect(formatIDRSigned("28349600.0000")).toBe(formatIDR("28349600.0000"));
  });
});
