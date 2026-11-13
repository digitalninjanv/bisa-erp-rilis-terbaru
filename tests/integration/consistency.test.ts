import { describe, expect, it } from "vitest";
import { and, eq, sql, type SQL } from "drizzle-orm";

import { accountMonthlyBalances, accounts, supplierReturnAllocations } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import { postJournal } from "@/server/accounting";
import {
  getBalanceSheet,
  getCashFlow,
  getCashSessionSummary,
  getEquityStatement,
  getIncomeStatement,
  getInventoryValuation,
  getPaymentBreakdown,
  getSalesByCashier,
  getSalesByCategory,
  getSalesByDay,
  getSalesSummary,
  getTopProducts,
  getTrialBalance,
  listPayables,
  listReceivables,
} from "@/server/reports";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";

// --- FIX-ARS Tahap 2 (ARS3-01): ringkasan saldo bulanan adalah turunan ---
// account_monthly_balances dipelihara postJournal + seed; sumber kebenaran
// tetap journal_lines. Pemeriksa ini umum per perusahaan: FULL JOIN dua
// arah antara agregat mentah jurnal POSTED per (akun, bulan tanggal
// jurnal) dan tabel ringkasan — menangkap baris ringkasan yang hilang
// (missing), yatim (orphan), dan total yang berbeda (amount), masing-
// masing menyebut akun & bulannya. Penjaga permanen di berkas ini
// menegaskan perusahaan demo, cakupan berkas konsistensi ini.
type MonthlyBalanceMismatch = {
  account_id: string;
  year_month: string;
  kind: "missing" | "orphan" | "amount";
  raw_debit: string | null;
  raw_credit: string | null;
  summary_debit: string | null;
  summary_credit: string | null;
};

async function findMonthlyBalanceMismatches(
  tx: { execute: (query: SQL) => Promise<unknown> },
  companyId: string,
): Promise<MonthlyBalanceMismatch[]> {
  const rows = (await tx.execute(sql`
    with raw as (
      select jl.account_id, to_char(je.date, 'YYYY-MM') as year_month,
             sum(jl.debit) as total_debit, sum(jl.credit) as total_credit
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      where jl.company_id = ${companyId} and je.status = 'posted'
      group by jl.account_id, to_char(je.date, 'YYYY-MM')
    ),
    summary as (
      select account_id, year_month, total_debit, total_credit
      from account_monthly_balances
      where company_id = ${companyId}
    )
    select coalesce(r.account_id, s.account_id) as account_id,
           coalesce(r.year_month, s.year_month) as year_month,
           case when r.account_id is null then 'orphan'
                when s.account_id is null then 'missing'
                else 'amount' end as kind,
           r.total_debit as raw_debit,
           r.total_credit as raw_credit,
           s.total_debit as summary_debit,
           s.total_credit as summary_credit
    from raw r
    full join summary s
      on s.account_id = r.account_id and s.year_month = r.year_month
    where r.account_id is null or s.account_id is null
       or s.total_debit <> r.total_debit
       or s.total_credit <> r.total_credit
    order by account_id, year_month
  `)) as unknown as MonthlyBalanceMismatch[];
  return rows;
}

describe("database reconciliation", () => {
  it("has a balanced ledger across all posted journal lines", async () => {
    const result = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = (await tx.execute(sql`
        select coalesce(sum(jl.debit), 0) as debit,
               coalesce(sum(jl.credit), 0) as credit
        from journal_lines jl
        join journal_entries je on je.id = jl.entry_id
        where jl.company_id = ${ORG_ID} and je.status = 'posted'
      `)) as unknown as { debit: string; credit: string }[];
      return { debit: Number(row.debit), credit: Number(row.credit) };
    });
    expect(result.debit).toBeGreaterThan(0);
    expect(result.credit).toBeCloseTo(result.debit, 4);
  });

  it("keeps account_monthly_balances equal to the posted journal aggregate", async () => {
    const mismatches = await withCompanyReadOnly(ORG_ID, (tx) =>
      findMonthlyBalanceMismatches(tx, ORG_ID),
    );
    expect(
      mismatches,
      `Ringkasan saldo bulanan menyimpang dari agregat jurnal: ${JSON.stringify(mismatches)}`,
    ).toEqual([]);
  });

  it("keeps stock_on_hand equal to the movement ledger", async () => {
    const mismatches = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = (await tx.execute(sql`
        select m.product_id, m.warehouse_id, m.qty as ledger_qty, s.qty as cached_qty
        from (
          select product_id, warehouse_id, sum(qty) as qty
          from stock_movements
          where company_id = ${ORG_ID}
          group by product_id, warehouse_id
        ) m
        full join stock_on_hand s
          on s.company_id = ${ORG_ID}
         and s.product_id = m.product_id
         and s.warehouse_id = m.warehouse_id
        where coalesce(m.qty, 0) <> coalesce(s.qty, 0)
      `)) as unknown as {
        product_id: string;
        warehouse_id: string;
        ledger_qty: string;
        cached_qty: string;
      }[];
      return rows;
    });
    expect(mismatches).toEqual([]);
  });

  it("reports the same inventory value as SQL", async () => {
    const result = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const valuation = await getInventoryValuation(tx, ORG_ID);
      const [row] = (await tx.execute(sql`
        select coalesce(sum(s.qty * p.cost_price), 0) as value
        from stock_on_hand s
        join products p on p.id = s.product_id
        where s.company_id = ${ORG_ID}
          -- Owned inventory includes inactive product masters.
      `)) as unknown as { value: string }[];
      return { report: valuation.totalValue, sql: Number(row.value) };
    });
    expect(result.report).toBeCloseTo(result.sql, 2);
  });

  it("produces a balanced balance sheet and trial balance", async () => {
    const result = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const sheet = await getBalanceSheet(tx, ORG_ID, todayISO());
      const trial = await getTrialBalance(tx, ORG_ID, {
        from: `${todayISO().slice(0, 4)}-01-01T00:00:00`,
        to: `${todayISO()}T23:59:59`,
      });
      return { sheet, trial };
    });
    expect(result.sheet.balanced).toBe(true);
    expect(result.sheet.totalAssets).toBeCloseTo(
      result.sheet.totalLiabilities + result.sheet.totalEquity,
      2,
    );
    expect(result.sheet.totalAssets).toBeCloseTo(
      result.sheet.totalCurrentAssets + result.sheet.totalNonCurrentAssets,
      2,
    );
    expect(result.sheet.totalLiabilities).toBeCloseTo(
      result.sheet.totalCurrentLiabilities + result.sheet.totalNonCurrentLiabilities,
      2,
    );
    const debit = result.trial.reduce((acc, row) => acc + row.debit, 0);
    const credit = result.trial.reduce((acc, row) => acc + row.credit, 0);
    expect(credit).toBeCloseTo(debit, 4);
  });

  it("computes open session cash from its movements, including opening cash", async () => {
    const result = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [session] = (await tx.execute(sql`
        select id from cash_sessions
        where company_id = ${ORG_ID} and status = 'open'
        order by opened_at desc limit 1
      `)) as unknown as { id: string }[];
      if (!session) return null;
      const summary = await getCashSessionSummary(tx, ORG_ID, session.id);
      const [row] = (await tx.execute(sql`
        select coalesce(sum(amount), 0) as total from cash_movements
        where company_id = ${ORG_ID} and session_id = ${session.id}
      `)) as unknown as { total: string }[];
      return { summary, movementTotal: Number(row.total) };
    });
    expect(result).not.toBeNull();
    expect(result!.summary!.expected).toBeCloseTo(result!.movementTotal, 4);
    const opening = result!.summary!.movements.find((row) => row.type === "opening");
    expect(opening).toBeDefined();
    expect(Number(opening!.amount)).toBeCloseTo(Number(result!.summary!.session.openingCash), 4);
  });

  it("keeps receivable and payable outstanding values non-negative", async () => {
    const result = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [payables, allocationRows] = await Promise.all([
        listPayables(tx, ORG_ID),
        tx
          .select({
            receiptId: supplierReturnAllocations.receiptId,
            openingId: supplierReturnAllocations.openingId,
            total: sql<string>`coalesce(sum(${supplierReturnAllocations.amount}), 0)`,
          })
          .from(supplierReturnAllocations)
          .where(eq(supplierReturnAllocations.companyId, ORG_ID))
          .groupBy(supplierReturnAllocations.receiptId, supplierReturnAllocations.openingId),
      ]);
      const allocatedByDoc = new Map<string, number>();
      for (const row of allocationRows) {
        if (row.receiptId) allocatedByDoc.set(row.receiptId, Number(row.total));
        if (row.openingId) allocatedByDoc.set(row.openingId, Number(row.total));
      }
      return {
        receivables: await listReceivables(tx, ORG_ID),
        payables,
        allocatedByDoc,
      };
    });
    for (const row of result.receivables) {
      expect(row.outstanding).toBeCloseTo(Number(row.total) - Number(row.paidTotal), 4);
      expect(row.outstanding).toBeGreaterThanOrEqual(0);
    }
    for (const row of result.payables) {
      // Retur pembelian yang terposting melunasi utang tanpa kas, jadi
      // outstanding = total − dibayar − alokasi retur (sama seperti listPayables).
      const allocated = result.allocatedByDoc.get(row.id) ?? 0;
      expect(row.outstanding).toBeCloseTo(Number(row.total) - Number(row.paidAmount) - allocated, 4);
      expect(row.outstanding).toBeGreaterThanOrEqual(0);
    }
  });

  it("builds every financial statement from an ISO timestamp range", async () => {
    const from = `${todayISO()}T00:00:00`;
    const to = `${todayISO()}T23:59:59`;
    const result = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const range = { from, to };
      const [income, cash, equity, sales, payments, byDay, byCashier, byCategory, top] =
        await Promise.all([
          getIncomeStatement(tx, ORG_ID, range),
          getCashFlow(tx, ORG_ID, range),
          getEquityStatement(tx, ORG_ID, range),
          getSalesSummary(tx, ORG_ID, range),
          getPaymentBreakdown(tx, ORG_ID, range),
          getSalesByDay(tx, ORG_ID, range),
          getSalesByCashier(tx, ORG_ID, range),
          getSalesByCategory(tx, ORG_ID, range),
          getTopProducts(tx, ORG_ID, range, 5),
        ]);
      return { income, cash, equity, sales, payments, byDay, byCashier, byCategory, top };
    });

    expect(Number.isFinite(result.income.netProfit)).toBe(true);
    expect(result.income.netProfit).toBeCloseTo(
      result.income.totalRevenue -
        result.income.totalCogs -
        result.income.totalOperatingExpense +
        result.income.totalOtherIncome -
        result.income.totalOtherExpense,
      2,
    );
    expect(result.income.totalRevenue).toBeCloseTo(
      result.income.revenue.reduce((acc, row) => acc + row.amount, 0),
      2,
    );
    expect(result.cash.closing).toBeCloseTo(result.cash.opening + result.cash.net, 4);
    expect(Array.isArray(result.equity.rows)).toBe(true);
    expect(result.sales.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.payments)).toBe(true);
    expect(Array.isArray(result.byDay)).toBe(true);
    expect(Array.isArray(result.byCashier)).toBe(true);
    expect(Array.isArray(result.byCategory)).toBe(true);
    expect(Array.isArray(result.top)).toBe(true);
  });
});

describe("row level security", () => {
  it("returns no tenant rows for another company id", async () => {
    const otherCompany = "01900000-0000-7000-8000-000000000002";
    const count = await withCompanyReadOnly(otherCompany, async (tx) => {
      const [row] = (await tx.execute(
        sql`select count(*)::int as total from products`,
      )) as unknown as { total: number }[];
      return Number(row.total);
    });
    expect(count).toBe(0);
  });

  it("returns tenant rows for the seeded company", async () => {
    const count = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = (await tx.execute(
        sql`select count(*)::int as total from products`,
      )) as unknown as { total: number }[];
      return Number(row.total);
    });
    expect(count).toBeGreaterThan(0);
  });
});

// --- AK-P1-01: dated balance sheet & equity opening must respect the date ---
// Rollback write pattern copied from tests/integration/sale-flow.test.ts.
const USER_ID = "01900000-0000-7000-8000-000000000010";

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("dated financial statements (AK-P1-01)", () => {
  it("balance sheet as of a past date excludes journals posted after that date", async () => {
    const today = todayISO();
    const asOfMid = addDaysISO(today, 20);
    const asOfLate = addDaysISO(today, 50);
    const futureDate = addDaysISO(today, 40);

    const result = await rollbackTransaction(async (tx) => {
      const rows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID));
      const cash = rows.find((row) => row.code === "110107");
      const equityAccount = rows.find((row) => row.code === "300001");
      expect(cash).toBeDefined();
      expect(equityAccount).toBeDefined();

      const cashAt = (sheet: Awaited<ReturnType<typeof getBalanceSheet>>) =>
        sheet.assets.find((row) => row.code === "110107")?.amount ?? 0;
      const equityAt = (sheet: Awaited<ReturnType<typeof getBalanceSheet>>) =>
        sheet.equity.find((row) => row.code === "300001")?.amount ?? 0;

      const baseMid = await getBalanceSheet(tx, ORG_ID, asOfMid);
      const baseLate = await getBalanceSheet(tx, ORG_ID, asOfLate);

      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji AK-P1-01 jurnal sebelum asOf",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 700, description: "Kas" },
          { accountId: equityAccount!.id, credit: 700, description: "Modal" },
        ],
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: futureDate,
        description: "Uji AK-P1-01 jurnal sesudah asOf",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 500, description: "Kas" },
          { accountId: equityAccount!.id, credit: 500, description: "Modal" },
        ],
      });

      const mid = await getBalanceSheet(tx, ORG_ID, asOfMid);
      const late = await getBalanceSheet(tx, ORG_ID, asOfLate);
      return {
        baseCashMid: cashAt(baseMid),
        baseEquityMid: equityAt(baseMid),
        baseCashLate: cashAt(baseLate),
        midCash: cashAt(mid),
        midEquity: equityAt(mid),
        lateCash: cashAt(late),
      };
    });

    // asOf between the two journals: only the first journal (700) may count.
    expect(result.midCash).toBeCloseTo(result.baseCashMid + 700, 2);
    expect(result.midEquity).toBeCloseTo(result.baseEquityMid + 700, 2);
    // asOf after both journals: both count (700 + 500).
    expect(result.lateCash).toBeCloseTo(result.baseCashLate + 1200, 2);
  });

  it("equity statement opening balance only includes journals before the period", async () => {
    const today = todayISO();
    const range = { from: addDaysISO(today, 10), to: addDaysISO(today, 20) };
    const futureDate = addDaysISO(today, 40);

    const result = await rollbackTransaction(async (tx) => {
      const rows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID));
      const cash = rows.find((row) => row.code === "110107");
      const equityAccount = rows.find((row) => row.code === "300001");
      expect(cash).toBeDefined();
      expect(equityAccount).toBeDefined();

      const openingAt = (statement: Awaited<ReturnType<typeof getEquityStatement>>) =>
        statement.rows.find((row) => row.code === "300001")?.opening ?? 0;

      const base = await getEquityStatement(tx, ORG_ID, range);

      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji AK-P1-01 jurnal sebelum periode ekuitas",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 700, description: "Kas" },
          { accountId: equityAccount!.id, credit: 700, description: "Modal" },
        ],
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: futureDate,
        description: "Uji AK-P1-01 jurnal sesudah periode ekuitas",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 500, description: "Kas" },
          { accountId: equityAccount!.id, credit: 500, description: "Modal" },
        ],
      });

      const after = await getEquityStatement(tx, ORG_ID, range);
      const row = after.rows.find((entry) => entry.code === "300001");
      return { baseOpening: openingAt(base), opening: openingAt(after), row };
    });

    // Only the pre-period journal (700) belongs in the opening balance; the
    // journal dated after the period (500) must not leak into it.
    expect(result.opening).toBeCloseTo(result.baseOpening + 700, 2);
    // Neither journal falls inside the period, so closing equals opening.
    expect(result.row?.closing).toBeCloseTo(result.opening, 2);
  });
});

// --- FIX-ARS Tahap 2: pemeriksa ringkasan bulanan harus hidup ---
// Di dalam transaksi rollback: jurnal yang diposting lewat postJournal
// lolos pemeriksaan (ringkasan dipelihara), lalu tiga mutasi manual atas
// tabel ringkasan harus tertangkap satu per satu arahnya — amount,
// missing, orphan. Semua dibuang oleh rollback; data nyata tak berubah.
describe("monthly balance summary checker (FIX-ARS T2)", () => {
  it("catches amount drift, missing rows, and orphan rows in the summary", async () => {
    const today = todayISO();
    const month = today.slice(0, 7);

    const result = await rollbackTransaction(async (tx) => {
      const rows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID));
      const cash = rows.find((row) => row.code === "110107");
      const bank = rows.find((row) => row.code === "110101");
      const equityAccount = rows.find((row) => row.code === "300001");
      expect(cash).toBeDefined();
      expect(bank).toBeDefined();
      expect(equityAccount).toBeDefined();

      // Data ter-commit bersih, dan jurnal baru lewat postJournal tetap
      // bersih — ringkasannya dipelihara dalam transaksi yang sama.
      expect(await findMonthlyBalanceMismatches(tx, ORG_ID)).toEqual([]);
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji pemeriksa ringkasan bulanan",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 123456, description: "Kas" },
          { accountId: equityAccount!.id, credit: 123456, description: "Modal" },
        ],
      });
      expect(await findMonthlyBalanceMismatches(tx, ORG_ID)).toEqual([]);

      // Mutasi 1 (amount): geser total_debit ringkasan kas bulan ini.
      await tx
        .update(accountMonthlyBalances)
        .set({ totalDebit: sql`${accountMonthlyBalances.totalDebit} + 777` })
        .where(
          and(
            eq(accountMonthlyBalances.companyId, ORG_ID),
            eq(accountMonthlyBalances.accountId, cash!.id),
            eq(accountMonthlyBalances.yearMonth, month),
          ),
        );
      // Mutasi 2 (missing): hapus baris ringkasan modal bulan ini.
      await tx
        .delete(accountMonthlyBalances)
        .where(
          and(
            eq(accountMonthlyBalances.companyId, ORG_ID),
            eq(accountMonthlyBalances.accountId, equityAccount!.id),
            eq(accountMonthlyBalances.yearMonth, month),
          ),
        );
      // Mutasi 3 (orphan): baris ringkasan tanpa jurnal apa pun.
      await tx.insert(accountMonthlyBalances).values({
        companyId: ORG_ID,
        accountId: bank!.id,
        yearMonth: "1999-01",
        totalDebit: "5000",
        totalCredit: "0",
      });

      const mismatches = await findMonthlyBalanceMismatches(tx, ORG_ID);
      return { mismatches, cashId: cash!.id, bankId: bank!.id, equityId: equityAccount!.id, month };
    });

    expect(result.mismatches).toHaveLength(3);
    const byAccount = new Map(result.mismatches.map((row) => [row.account_id, row]));

    const amount = byAccount.get(result.cashId);
    expect(amount?.kind).toBe("amount");
    expect(amount?.year_month).toBe(result.month);
    expect(Number(amount!.summary_debit) - Number(amount!.raw_debit)).toBeCloseTo(777, 4);

    const missing = byAccount.get(result.equityId);
    expect(missing?.kind).toBe("missing");
    expect(missing?.year_month).toBe(result.month);
    expect(missing?.summary_debit).toBeNull();

    const orphan = byAccount.get(result.bankId);
    expect(orphan?.kind).toBe("orphan");
    expect(orphan?.year_month).toBe("1999-01");
    expect(orphan?.raw_debit).toBeNull();
  });
});
