import { describe, expect, it } from "vitest";
import { defaultSection, resolveCashFlowGroup, resolveSection } from "@/lib/accounting";

// FIX-R2 Tahap 3 (AK2-04): fallback kelompok laporan TIDAK lagi menebak
// dari rentang kode akun string. Resolusi: (1) nilai eksplisit akun,
// (2) bawaan tipe yang terdokumentasi. Test ini mengunci perilaku itu —
// termasuk kasus yang dulu ajaib secara leksikografis: aset "1990"
// (≥ "1500") dulu jatuh ke aset tidak lancar dan utang "2400" tidak
// punya jalan menjadi pendanaan tanpa penanda eksplisit.

describe("defaultSection — bawaan murni dari tipe", () => {
  it("memetakan setiap tipe ke section bawaannya", () => {
    expect(defaultSection("asset")).toBe("current_asset");
    expect(defaultSection("liability")).toBe("current_liability");
    expect(defaultSection("equity")).toBe("equity");
    expect(defaultSection("revenue")).toBe("revenue");
    expect(defaultSection("cogs")).toBe("cogs");
    expect(defaultSection("expense")).toBe("operating_expense");
    expect(defaultSection("tipe-ngawur")).toBeNull();
  });
});

describe("resolveSection — eksplisit menang, kode tidak dibaca", () => {
  it("section eksplisit selalu menang atas tipe & kode", () => {
    expect(
      resolveSection({ type: "liability", code: "2400", section: "non_current_liability" }),
    ).toBe("non_current_liability");
    expect(resolveSection({ type: "asset", code: "1500", section: "current_asset" })).toBe(
      "current_asset",
    );
  });

  it("aset berkode 1990 TANPA section kini aset LANCAR (dulu: tidak lancar via rentang kode)", () => {
    expect(resolveSection({ type: "asset", code: "1990", section: null })).toBe("current_asset");
    expect(resolveSection({ type: "asset", code: "9999", section: null })).toBe("current_asset");
  });

  it("liabilitas berkode berapa pun tanpa section = jangka pendek (bawaan terdokumentasi)", () => {
    expect(resolveSection({ type: "liability", code: "2400", section: null })).toBe(
      "current_liability",
    );
    expect(resolveSection({ type: "liability", code: "999", section: null })).toBe(
      "current_liability",
    );
  });

  it("pengecualian kode lama hilang: pendapatan 4030 & beban 8000/9001 mengikuti tipe", () => {
    expect(resolveSection({ type: "revenue", code: "4030", section: null })).toBe("revenue");
    expect(resolveSection({ type: "revenue", code: "9000", section: null })).toBe("revenue");
    expect(resolveSection({ type: "expense", code: "8000", section: null })).toBe(
      "operating_expense",
    );
    expect(resolveSection({ type: "expense", code: "9001", section: null })).toBe(
      "operating_expense",
    );
  });
});

describe("resolveCashFlowGroup — eksplisit menang, aset tanpa penanda = null", () => {
  it("cash_flow_group eksplisit selalu menang", () => {
    expect(
      resolveCashFlowGroup({ type: "liability", code: "2400", cashFlowGroup: "financing" }),
    ).toBe("financing");
    expect(resolveCashFlowGroup({ type: "asset", code: "1500", cashFlowGroup: "investing" })).toBe(
      "investing",
    );
  });

  it("bawaan tipe: pendapatan/HPP/beban/liabilitas = operasi, ekuitas = pendanaan", () => {
    expect(resolveCashFlowGroup({ type: "revenue", code: "4000", cashFlowGroup: null })).toBe(
      "operating",
    );
    expect(resolveCashFlowGroup({ type: "cogs", code: "5000", cashFlowGroup: null })).toBe(
      "operating",
    );
    expect(resolveCashFlowGroup({ type: "expense", code: "6010", cashFlowGroup: null })).toBe(
      "operating",
    );
    // Utang bank berkode 2400 tanpa penanda TIDAK menjadi pendanaan
    // lewat tebakan kode — bawaan liabilitas adalah operasi.
    expect(resolveCashFlowGroup({ type: "liability", code: "2400", cashFlowGroup: null })).toBe(
      "operating",
    );
    expect(resolveCashFlowGroup({ type: "equity", code: "3000", cashFlowGroup: null })).toBe(
      "financing",
    );
  });

  it("aset tanpa penanda mengembalikan null (→ kelompok Belum terklasifikasi di laporan arus kas)", () => {
    expect(resolveCashFlowGroup({ type: "asset", code: "1300", cashFlowGroup: null })).toBeNull();
    expect(resolveCashFlowGroup({ type: "asset", code: "1990", cashFlowGroup: null })).toBeNull();
  });
});
