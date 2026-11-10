import { describe, expect, it } from "vitest";
import { withCompanyReadOnly } from "@/db/tenant";
import { buildAnalyticsPeriod, getBusinessAnalytics } from "@/server/analytics";
import { getIncomeStatement } from "@/server/reports";

const ORG = "01900000-0000-7000-8000-000000000001";

describe("modul Analisa — 12 indikator", () => {
  it("periode & pertumbuhan dihitung dari rentang yang sama panjang", () => {
    const period = buildAnalyticsPeriod("2026-11-01", "2026-11-30");
    expect(period.days).toBe(30);
    expect(period.priorTo).toBe("2026-10-31");
    expect(period.priorFrom).toBe("2026-10-02");
  });

  it("kesehatan, penggerak, dan risiko terisi dari data demo", async () => {
    const data = await withCompanyReadOnly(ORG, async (tx) => {
      const analytics = await getBusinessAnalytics(tx, ORG, "2026-11-01", "2026-11-30");
      const income = await getIncomeStatement(tx, ORG, {
        from: "2026-11-01T00:00:00",
        to: "2026-11-30T23:59:59",
      });
      return { analytics, income };
    });
    expect(data.analytics.health.revenue).toBeGreaterThan(0);
    expect(data.analytics.health.grossMargin).toBeGreaterThan(0);
    expect(data.analytics.health.operatingProfit).toBeCloseTo(data.income.operatingProfit, 2);
    expect(data.analytics.health.operatingCashFlow).not.toBe(0);

    expect(data.analytics.drivers.abcFsn.length).toBeGreaterThan(0);
    expect(data.analytics.drivers.abcFsn[0].category).toBeTruthy();
    expect(data.analytics.drivers.abcFsn[0].margin).not.toBeNull();
    const abc = data.analytics.drivers.abcCounts;
    expect(abc.A + abc.B + abc.C).toBe(data.analytics.drivers.abcFsn.length);
    expect(abc.F + abc.S + abc.N).toBe(data.analytics.drivers.abcFsn.length);
    expect(data.analytics.drivers.inventoryTurnover).toBeGreaterThan(0);
    expect(data.analytics.drivers.gmroi).toBeGreaterThan(0);

    expect(data.analytics.risk.stockoutRate).toBeGreaterThanOrEqual(0);
    expect(data.analytics.risk.stockoutRate).toBeLessThanOrEqual(100);
    expect(data.analytics.risk.deadRatio).toBeGreaterThanOrEqual(0);
    expect(data.analytics.risk.deadRatio).toBeLessThanOrEqual(100);
    expect(data.analytics.risk.shrinkageRate).toBeGreaterThanOrEqual(0);
    expect(data.analytics.risk.inventoryAccuracy).toBeNull(); // belum ada opname posted
    expect(data.analytics.risk.totalSkus).toBeGreaterThan(0);
    expect(Array.isArray(data.analytics.risk.deadStock)).toBe(true);
    expect(Array.isArray(data.analytics.risk.stockoutProducts)).toBe(true);
  });
});
