import { describe, expect, it } from "vitest";
import { formatIDR, formatIDRReport } from "@/lib/money";

// FIX-R2 Tahap 1 (RD2-04/RD2-11): konvensi angka laporan keuangan
// formal — negatif dalam kurung akuntansi, nol sebagai strip pada
// dokumen cetak, "Rp" dapat ditekan pada baris rincian kelompok.
// Kontrak dasar: positif & nol identik byte dengan formatIDR (yang
// dipakai seluruh aplikasi); hanya negatif & opsi yang berbeda.
describe("formatIDRReport — konvensi angka laporan formal", () => {
  it("positif dengan simbol identik dengan formatIDR", () => {
    expect(formatIDRReport(1234567)).toBe(formatIDR(1234567));
    expect(formatIDRReport("2500")).toBe(formatIDR(2500));
    expect(formatIDRReport(1234567)).toContain("1.234.567");
  });

  it("negatif dalam kurung akuntansi, bukan tanda minus", () => {
    expect(formatIDRReport(-1234567)).toBe(`(${formatIDR(1234567)})`);
    expect(formatIDRReport(-1234567)).not.toContain("−");
    expect(formatIDRReport("-0.6")).toBe(`(${formatIDR(1)})`);
  });

  it("tanpa simbol: angka polos, negatif tetap berkurung", () => {
    expect(formatIDRReport(1234567, { symbol: false })).toBe("1.234.567");
    expect(formatIDRReport(-1234567, { symbol: false })).toBe("(1.234.567)");
  });

  it("nol di layar tetap eksplisit seperti formatIDR (kontrak e2e)", () => {
    expect(formatIDRReport(0)).toBe(formatIDR(0));
    expect(formatIDRReport("0.4")).toBe(formatIDR(0));
    expect(formatIDRReport(0, { symbol: false })).toBe("0");
  });

  it("nol pada dokumen cetak menjadi strip — (zeroDash)", () => {
    expect(formatIDRReport(0, { zeroDash: true })).toBe("—");
    expect(formatIDRReport("-0.2", { zeroDash: true, symbol: false })).toBe("—");
  });

  it("pembulatan setengah ke atas konsisten dengan formatIDR", () => {
    expect(formatIDRReport("1500.5")).toBe(formatIDR(1501));
    expect(formatIDRReport("-1500.5")).toBe(`(${formatIDR(1501)})`);
  });

  it("null/undefined dibaca nol", () => {
    expect(formatIDRReport(null)).toBe(formatIDR(0));
    expect(formatIDRReport(undefined, { zeroDash: true })).toBe("—");
  });
});
