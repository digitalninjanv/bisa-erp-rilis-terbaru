// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  count,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { d } from "@/lib/money";
import type { HomeDashboardScope } from "@/lib/home-dashboard-scope";
import {
  cashSessions,
  products,
  sales,
} from "@/db/schema";
import { listCashBankAccounts, signedBalance } from "@/server/accounting";
import {
  FAR_FUTURE_DATE,
  cumulativeAccountTotals,
  mappedBalance,
  totalsOf,
} from "./shared";

const FULL_HOME_DASHBOARD_SCOPE: HomeDashboardScope = {
  sales: true,
  inventoryValue: true,
  lowStock: true,
  openSession: true,
  cashBank: true,
};

export async function getHomeSummary(
  tx: Tx,
  companyId: string,
  today: string,
  scope: HomeDashboardScope = FULL_HOME_DASHBOARD_SCOPE,
) {
  const monthStart = `${today.slice(0, 7)}-01`;

  const [todayRow, monthRow, inventoryValue, lowStock, openSession, cash] = await Promise.all([
    scope.sales
      ? tx
          .select({
            total: sql<string>`coalesce(sum(${sales.total}), 0)`,
            transactions: count(),
          })
          .from(sales)
          .where(and(eq(sales.companyId, companyId), eq(sales.date, today), eq(sales.status, "completed")))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    scope.sales
      ? tx
          .select({
            total: sql<string>`coalesce(sum(${sales.total}), 0)`,
            transactions: count(),
          })
          .from(sales)
          .where(
            and(
              eq(sales.companyId, companyId),
              gte(sales.date, monthStart),
              lte(sales.date, today),
              eq(sales.status, "completed"),
            ),
          )
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    scope.inventoryValue ? mappedBalance(tx, companyId, ["inventory"]) : Promise.resolve(0),
    scope.lowStock
      ? tx
          .select({ value: count() })
          .from(products)
          .where(
            and(
              eq(products.companyId, companyId),
              eq(products.isActive, true),
              sql`coalesce((
                select sum(soh.qty) from stock_on_hand soh
                where soh.company_id = ${companyId} and soh.product_id = ${products.id}
              ), 0) <= ${products.minStock}`,
            ),
          )
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    scope.openSession
      ? tx
          .select({ id: cashSessions.id, openedAt: cashSessions.openedAt })
          .from(cashSessions)
          .where(and(eq(cashSessions.companyId, companyId), eq(cashSessions.status, "open")))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    scope.cashBank
      ? (async () => {
          // A-27 B2: total kas & bank dashboard = agregat akun aktif
          // postable berkelas cash|bank|clearing.
          const [cashBankAccounts, cashTotals] = await Promise.all([
            listCashBankAccounts(tx, companyId),
            cumulativeAccountTotals(tx, companyId, FAR_FUTURE_DATE),
          ]);
          return cashBankAccounts
            .reduce((acc, row) => {
              const totals = totalsOf(cashTotals, row.id);
              return acc.plus(signedBalance(row.type, totals.debit, totals.credit));
            }, d(0))
            .toNumber();
        })()
      : Promise.resolve(0),
  ]);

  return {
    todaySales: d(todayRow?.total ?? 0).toNumber(),
    todayTransactions: todayRow?.transactions ?? 0,
    monthSales: d(monthRow?.total ?? 0).toNumber(),
    monthTransactions: monthRow?.transactions ?? 0,
    inventoryValue,
    lowStockCount: lowStock?.value ?? 0,
    openSession,
    cashBalance: cash,
  };
}
