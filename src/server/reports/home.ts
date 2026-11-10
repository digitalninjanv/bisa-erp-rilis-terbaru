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

export async function getHomeSummary(tx: Tx, companyId: string, today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;

  const [todayRow] = await tx
    .select({
      total: sql<string>`coalesce(sum(${sales.total}), 0)`,
      transactions: count(),
    })
    .from(sales)
    .where(and(eq(sales.companyId, companyId), eq(sales.date, today), eq(sales.status, "completed")));

  const [monthRow] = await tx
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
    );

  // AK-P2-11: same GL-based inventory value as getAccountingSummary.
  const inventoryValue = await mappedBalance(tx, companyId, ["inventory"]);

  const [lowStock] = await tx
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
    );

  const [openSession] = await tx
    .select({ id: cashSessions.id, openedAt: cashSessions.openedAt })
    .from(cashSessions)
    .where(and(eq(cashSessions.companyId, companyId), eq(cashSessions.status, "open")))
    .limit(1);

  // A-27 B2: total kas & bank dashboard = agregat himpunan KELAS
  // kas/bank (listCashBankAccounts — semua akun berkelas cash|bank|
  // clearing yang postable + aktif), bukan lagi hanya tiga akun yang
  // ditunjuk pemetaan cash/bank/qris. Saldo bertanda saldo normal per
  // akun dari total kumulatif yang sama seperti mappedBalance.
  const cashBankAccounts = await listCashBankAccounts(tx, companyId);
  const cashTotals = await cumulativeAccountTotals(tx, companyId, FAR_FUTURE_DATE);
  const cash = cashBankAccounts
    .reduce((acc, row) => {
      const totals = totalsOf(cashTotals, row.id);
      return acc.plus(signedBalance(row.type, totals.debit, totals.credit));
    }, d(0))
    .toNumber();

  return {
    todaySales: d(todayRow?.total ?? 0).toNumber(),
    todayTransactions: todayRow?.transactions ?? 0,
    monthSales: d(monthRow?.total ?? 0).toNumber(),
    monthTransactions: monthRow?.transactions ?? 0,
    inventoryValue,
    lowStockCount: lowStock?.value ?? 0,
    openSession: openSession ?? null,
    cashBalance: cash,
  };
}
