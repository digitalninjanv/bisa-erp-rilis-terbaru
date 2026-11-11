import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { accounts, products, saleLines, sales, warehouses } from "@/db/schema";
import { postJournal } from "@/server/accounting";
import { buildAnalyticsPeriod, getBusinessAnalytics } from "@/server/analytics";
import { getIncomeStatement } from "@/server/reports";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const rollbackTransaction = makeRollbackTransaction(ORG);

describe("modul Analisa — 12 indikator", () => {
  it("periode & pertumbuhan dihitung dari rentang yang sama panjang", () => {
    const period = buildAnalyticsPeriod("2026-11-01", "2026-11-30");
    expect(period.days).toBe(30);
    expect(period.priorTo).toBe("2026-10-31");
    expect(period.priorFrom).toBe("2026-10-02");
  });

  it("kesehatan, penggerak, dan risiko terisi dari data demo", async () => {
    const data = await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
        .limit(1);
      const [product] = await tx
        .select({ id: products.id, name: products.name, sku: products.sku })
        .from(products)
        .where(eq(products.companyId, ORG))
        .limit(1);
      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG));
      const byCode = new Map(accountRows.map((row) => [row.code, row.id]));
      const cash = byCode.get("110107")!;
      const revenue = byCode.get("400001")!;
      const cogs = byCode.get("5101")!;
      const inventory = byCode.get("110401")!;

      const saleId = crypto.randomUUID();
      await tx.insert(sales).values({
        id: saleId,
        companyId: ORG,
        warehouseId: warehouse.id,
        number: `TST-ANALYTICS-${crypto.randomUUID().slice(0, 8)}`,
        date: "2026-11-11",
        cashierId: USER_ID,
        status: "completed",
        subtotal: "100000",
        total: "100000",
        costTotal: "40000",
        paidTotal: "100000",
        paymentStatus: "paid",
        createdBy: USER_ID,
      });
      await tx.insert(saleLines).values({
        companyId: ORG,
        saleId,
        productId: product.id,
        qty: "1",
        unitPrice: "100000",
        lineTotal: "100000",
        unitCost: "40000",
        productName: product.name,
        productSku: product.sku,
        qtyInput: "1",
      });
      await postJournal(tx, {
        companyId: ORG,
        date: "2026-11-11",
        description: "Fixture analytics: penjualan tunai",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash, debit: 100000, description: "Kas" },
          { accountId: revenue, credit: 100000, description: "Penjualan" },
        ],
      });
      await postJournal(tx, {
        companyId: ORG,
        date: "2026-11-11",
        description: "Fixture analytics: HPP",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cogs, debit: 40000, description: "HPP" },
          { accountId: inventory, credit: 40000, description: "Persediaan" },
        ],
      });

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
  });
});
