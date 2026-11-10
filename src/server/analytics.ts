import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  categories,
  products,
  saleLines,
  sales,
  stockDocumentLines,
  stockDocuments,
  stockMovements,
} from "@/db/schema";
import { d } from "@/lib/money";
import { getAccountMap } from "@/server/accounting";
import {
  getBalanceSheet,
  getCashFlow,
  getIncomeStatement,
  getInventoryValuation,
  getSalesSummary,
} from "@/server/reports";

/**
 * Modul Analisa — 12 indikator bisnis minimarket (3 kelompok):
 * kesehatan bisnis, penggerak kinerja, dan pengendalian risiko.
 * Semua angka diturunkan dari jurnal posted + dokumen operasional
 * yang sudah ada; tidak ada tabel agregat baru.
 */

export type AnalyticsPeriod = {
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  days: number;
};

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDays(value: string, days: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function buildAnalyticsPeriod(from: string, to: string): AnalyticsPeriod {
  const start = utcDate(from);
  const end = utcDate(to);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const priorTo = shiftDays(from, -1);
  const priorFrom = shiftDays(priorTo, -(days - 1));
  return { from, to, priorFrom, priorTo, days };
}

export type AbcFsnRow = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  qty: number;
  revenue: number;
  profit: number;
  margin: number | null;
  transactions: number;
  lastSoldDate: string;
  revenueShare: number;
  cumulativeShare: number;
  abc: "A" | "B" | "C";
  fsn: "F" | "S" | "N";
};

export async function getBusinessHealth(
  tx: Tx,
  companyId: string,
  period: AnalyticsPeriod,
) {
  const dateRange = { from: period.from, to: period.to };
  const priorRange = { from: period.priorFrom, to: period.priorTo };
  const tsRange = { from: `${period.from}T00:00:00`, to: `${period.to}T23:59:59` };

  const [currentSales, priorSales, income, cashFlow] = await Promise.all([
    getSalesSummary(tx, companyId, dateRange),
    getSalesSummary(tx, companyId, priorRange),
    getIncomeStatement(tx, companyId, tsRange),
    getCashFlow(tx, companyId, tsRange),
  ]);

  const revenue = currentSales.total;
  const priorRevenue = priorSales.total;
  const growth =
    priorRevenue > 0 ? ((revenue - priorRevenue) / priorRevenue) * 100 : null;
  const grossMargin =
    income.totalRevenue > 0
      ? ((income.totalRevenue - income.totalCogs) / income.totalRevenue) * 100
      : null;

  return {
    revenue,
    priorRevenue,
    growth,
    transactions: currentSales.transactions,
    averageTransaction: currentSales.average,
    grossMargin,
    grossProfit: income.grossProfit,
    operatingProfit: income.operatingProfit,
    netProfit: income.netProfit,
    operatingCashFlow: cashFlow.groups.operating,
    cashClosing: cashFlow.closing,
  };
}

export async function getPerformanceDrivers(
  tx: Tx,
  companyId: string,
  period: AnalyticsPeriod,
) {
  const [salesRows, valuation, income, map] = await Promise.all([
    tx
      .select({
        productId: saleLines.productId,
        sku: saleLines.productSku,
        name: saleLines.productName,
        category: categories.name,
        qty: sql<string>`coalesce(sum(${saleLines.qty}), 0)`,
        revenue: sql<string>`coalesce(sum(${saleLines.lineTotal} + ${saleLines.taxAmount}), 0)`,
        netRevenue: sql<string>`coalesce(sum(${saleLines.lineTotal}), 0)`,
        profit: sql<string>`coalesce(sum(${saleLines.lineTotal} - (${saleLines.unitCost} * ${saleLines.qty})), 0)`,
        transactions: sql<number>`count(distinct ${sales.id})`,
        lastSoldDate: sql<string>`max(${sales.date})`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(saleLines.saleId, sales.id))
      .leftJoin(products, eq(saleLines.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(
        and(
          eq(saleLines.companyId, companyId),
          gte(sales.date, period.from),
          lte(sales.date, period.to),
          inArray(sales.status, ["completed", "returned"]),
        ),
      )
      .groupBy(
        saleLines.productId,
        saleLines.productSku,
        saleLines.productName,
        categories.name,
      )
      .orderBy(desc(sql`sum(${saleLines.lineTotal} + ${saleLines.taxAmount})`)),
    getInventoryValuation(tx, companyId, undefined, { skipLowStock: true }),
    getIncomeStatement(tx, companyId, {
      from: `${period.from}T00:00:00`,
      to: `${period.to}T23:59:59`,
    }),
    getAccountMap(tx, companyId),
  ]);

  const totalRevenue = salesRows.reduce((acc, row) => acc + d(row.revenue).toNumber(), 0);
  let cumulative = 0;
  const abcFsn: AbcFsnRow[] = salesRows.map((row) => {
    const revenue = d(row.revenue).toNumber();
    const share = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
    cumulative += share;
    const transactions = Number(row.transactions ?? 0);
    const netRevenue = d(row.netRevenue);
    const profit = d(row.profit);
    return {
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      category: row.category ?? "Tanpa kategori",
      qty: d(row.qty).toNumber(),
      revenue,
      profit: profit.toNumber(),
      margin: netRevenue.gt(0) ? profit.div(netRevenue).mul(100).toDecimalPlaces(1).toNumber() : null,
      transactions,
      lastSoldDate: row.lastSoldDate,
      revenueShare: share,
      cumulativeShare: cumulative,
      abc: cumulative <= 80 ? "A" : cumulative <= 95 ? "B" : "C",
      fsn: transactions >= 10 ? "F" : transactions >= 4 ? "S" : "N",
    };
  });

  const closingInventory = d(valuation.totalValue);
  const openingSheet = map.inventory
    ? await getBalanceSheet(tx, companyId, shiftDays(period.from, -1))
    : null;
  const openingInventory = openingSheet
    ? d(
        [...openingSheet.currentAssets, ...openingSheet.nonCurrentAssets].find(
          (row) => row.accountId === map.inventory,
        )?.amount ?? 0,
      )
    : d(0);
  const averageInventory =
    openingInventory.gt(0) && closingInventory.gt(0)
      ? openingInventory.plus(closingInventory).div(2)
      : closingInventory;
  const cogs = d(income.totalCogs);
  const grossProfit = d(income.grossProfit);

  return {
    abcFsn,
    abcCounts: {
      A: abcFsn.filter((row) => row.abc === "A").length,
      B: abcFsn.filter((row) => row.abc === "B").length,
      C: abcFsn.filter((row) => row.abc === "C").length,
      F: abcFsn.filter((row) => row.fsn === "F").length,
      S: abcFsn.filter((row) => row.fsn === "S").length,
      N: abcFsn.filter((row) => row.fsn === "N").length,
    },
    cogs: cogs.toNumber(),
    grossProfit: grossProfit.toNumber(),
    inventoryValue: closingInventory.toNumber(),
    openingInventory: openingInventory.toNumber(),
    averageInventory: averageInventory.toNumber(),
    // Disetahunkan agar angka bulanan dapat dibandingkan dengan
    // tolok ukur retail (perputaran & GMROI biasanya annual).
    inventoryTurnover:
      averageInventory.gt(0)
        ? cogs.div(averageInventory).mul(365 / period.days).toDecimalPlaces(2).toNumber()
        : null,
    gmroi:
      averageInventory.gt(0)
        ? grossProfit.div(averageInventory).mul(365 / period.days).toDecimalPlaces(2).toNumber()
        : null,
  };
}

export async function getRiskControls(
  tx: Tx,
  companyId: string,
  period: AnalyticsPeriod,
) {
  const [valuation, salesSummary, shrinkRow, soldRows, opnameRows] = await Promise.all([
    getInventoryValuation(tx, companyId, undefined, { skipLowStock: true }),
    getSalesSummary(tx, companyId, { from: period.from, to: period.to }),
    tx
      .select({ value: sql<string>`coalesce(sum(abs(${stockMovements.qty} * ${stockMovements.unitCost})), 0)` })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.companyId, companyId),
          gte(stockMovements.date, period.from),
          lte(stockMovements.date, period.to),
          sql`${stockMovements.qty} < 0`,
          inArray(stockMovements.movementType, [
            "damaged",
            "expired",
            "lost",
            "adjustment",
            "opname",
          ]),
        ),
      ),
    tx
      .selectDistinct({ productId: saleLines.productId })
      .from(saleLines)
      .innerJoin(sales, eq(saleLines.saleId, sales.id))
      .where(
        and(
          eq(saleLines.companyId, companyId),
          gte(sales.date, shiftDays(period.to, -90)),
          lte(sales.date, period.to),
          inArray(sales.status, ["completed", "returned"]),
        ),
      ),
    tx
      .select({ id: stockDocuments.id, date: stockDocuments.date })
      .from(stockDocuments)
      .where(
        and(
          eq(stockDocuments.companyId, companyId),
          eq(stockDocuments.type, "opname"),
          eq(stockDocuments.status, "posted"),
          gte(stockDocuments.date, period.from),
          lte(stockDocuments.date, period.to),
        ),
      )
      .orderBy(desc(stockDocuments.date))
      .limit(1),
  ]);

  const sold = new Set(soldRows.map((row) => row.productId));
  let deadValue = 0;
  let stockout = 0;
  const deadStock: {
    productId: string;
    sku: string;
    name: string;
    category: string;
    qty: string;
    value: string;
  }[] = [];
  const stockoutProducts: {
    productId: string;
    sku: string;
    name: string;
    category: string;
    minStock: string;
  }[] = [];
  for (const item of valuation.items) {
    if (d(item.qty).lte(0)) {
      stockout += 1;
      stockoutProducts.push({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        minStock: item.minStock,
      });
    }
    if (d(item.qty).gt(0) && !sold.has(item.productId)) {
      deadValue += d(item.value).toNumber();
      deadStock.push({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        qty: item.qty,
        value: item.value,
      });
    }
  }
  deadStock.sort((a, b) => d(b.value).comparedTo(d(a.value)));
  stockoutProducts.sort((a, b) => a.name.localeCompare(b.name, "id"));
  const totalValue = d(valuation.totalValue).toNumber();
  const deadRatio = totalValue > 0 ? (deadValue / totalValue) * 100 : null;
  const stockoutRate =
    valuation.items.length > 0 ? (stockout / valuation.items.length) * 100 : null;
  const shrinkValue = d(shrinkRow[0]?.value ?? 0).toNumber();
  const shrinkageRate = salesSummary.total > 0 ? (shrinkValue / salesSummary.total) * 100 : null;

  let inventoryAccuracy: number | null = null;
  let opnameDate: string | null = null;
  if (opnameRows[0]) {
    opnameDate = opnameRows[0].date;
    const lines = await tx
      .select({
        systemQty: stockDocumentLines.systemQty,
        qty: stockDocumentLines.qty,
      })
      .from(stockDocumentLines)
      .where(eq(stockDocumentLines.documentId, opnameRows[0].id));
    let systemTotal = d(0);
    let differenceTotal = d(0);
    for (const line of lines) {
      systemTotal = systemTotal.plus(d(line.systemQty ?? 0));
      differenceTotal = differenceTotal.plus(d(line.qty).abs());
    }
    if (systemTotal.gt(0)) {
      inventoryAccuracy = Math.max(
        0,
        (1 - differenceTotal.div(systemTotal).toNumber()) * 100,
      );
    }
  }

  return {
    stockoutRate,
    stockoutCount: stockout,
    deadRatio,
    deadValue,
    inventoryValue: totalValue,
    shrinkageRate,
    shrinkValue,
    inventoryAccuracy,
    opnameDate,
    totalSkus: valuation.items.length,
    deadStock,
    stockoutProducts,
  };
}

export async function getBusinessAnalytics(
  tx: Tx,
  companyId: string,
  from: string,
  to: string,
) {
  const period = buildAnalyticsPeriod(from, to);
  const [health, drivers, risk] = await Promise.all([
    getBusinessHealth(tx, companyId, period),
    getPerformanceDrivers(tx, companyId, period),
    getRiskControls(tx, companyId, period),
  ]);
  return { period, health, drivers, risk };
}
