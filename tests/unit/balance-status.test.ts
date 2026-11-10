import { describe, expect, it } from "vitest";
import { balanceBadgeText, balanceSentenceText } from "@/lib/balance-status";
import { d, formatIDR } from "@/lib/money";

/**
 * A-22 Tahap K4 (UX-10 audit / UX-12 mandat + Pola 3): SATU bahasa
 * sinyal keseimbangan jurnal di semua permukaan — modal Catat
 * Transaksi, bilah lengket & panel editor jurnal manual. Bentuk lencana
 * (ringkas): "Seimbang" / "Selisih RpX". Bentuk kalimat: "Seimbang" /
 * "Belum seimbang — selisih RpX". Suffix konteks ("siap diposting",
 * "jurnal dibuat otomatis…") ditambahkan pemanggil, bukan di sini.
 */

describe("balanceBadgeText", () => {
  it("seimbang → 'Seimbang' tanpa nominal", () => {
    expect(balanceBadgeText(true, d(0))).toBe("Seimbang");
    expect(balanceBadgeText(true, d("5000"))).toBe("Seimbang");
  });

  it("tidak seimbang → 'Selisih RpX' dari nilai absolut selisih", () => {
    expect(balanceBadgeText(false, d("6500"))).toBe(`Selisih ${formatIDR(6500)}`);
    expect(balanceBadgeText(false, d("-6500"))).toBe(`Selisih ${formatIDR(6500)}`);
  });
});

describe("balanceSentenceText", () => {
  it("seimbang → 'Seimbang'", () => {
    expect(balanceSentenceText(true, d(0))).toBe("Seimbang");
  });

  it("tidak seimbang → 'Belum seimbang — selisih RpX'", () => {
    expect(balanceSentenceText(false, d("150000"))).toBe(`Belum seimbang — selisih ${formatIDR(150000)}`);
    expect(balanceSentenceText(false, d("-1"))).toBe(`Belum seimbang — selisih ${formatIDR(1)}`);
  });
});
