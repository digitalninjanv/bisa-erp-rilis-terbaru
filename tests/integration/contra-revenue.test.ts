import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { postJournal } from "@/server/accounting";
import {
  getAccountingSummary,
  getBalanceSheet,
  getEquityStatement,
  getIncomeStatement,
  getTrialBalance,
} from "@/server/reports";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Regression suite for the contra-revenue sign bug in src/server/reports.ts:
// accounts 4010 (Diskon Penjualan) and 4020 (Retur Penjualan) are revenue
// accounts whose normal balance is DEBIT. getIncomeStatement used to value
// every account by its own normalBalance, so inside the revenue section the
// contra accounts were ADDED to revenue instead of subtracted — any posted
// discount/return journal inflated revenue and net profit and broke the
// balance-sheet identity. The correct convention is per SECTION: revenue /
// other_income amounts are credit − debit, cogs / expense amounts are
// debit − credit, so contra accounts fall out negative automatically.
// All writes happen inside a rollback transaction (pattern copied from
// tests/integration/reports-p2.test.ts) so the dev database stays clean.
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function loadAccounts(tx: Tx) {
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code, type: accounts.type, normalBalance: accounts.normalBalance })
    .from(accounts)
    .where(eq(accounts.companyId, ORG_ID));
  return new Map(rows.map((row) => [row.code, row]));
}

const WIDE = { from: "2000-01-01", to: "2100-12-31" };

describe("contra-revenue: diskon & retur penjualan mengurangi pendapatan", () => {
  it("income statement nets contra accounts, balance sheet stays balanced, summary agrees", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const acc = await loadAccounts(tx);
      const cash = acc.get("110107")!;
      const revenue = acc.get("400001")!;
      const discount = acc.get("440101")!;
      const salesReturn = acc.get("400003")!;
      const rent = acc.get("600019")!;
      const today = todayISO();

      const snapshot = async () => {
        const income = await getIncomeStatement(tx, ORG_ID, WIDE);
        const sheet = await getBalanceSheet(tx, ORG_ID, today);
        const summary = await getAccountingSummary(tx, ORG_ID, WIDE);
        const equity = await getEquityStatement(tx, ORG_ID, WIDE);
        const trial = await getTrialBalance(tx, ORG_ID, WIDE);
        const line = (code: string) => income.revenue.find((row) => row.code === code)?.amount ?? 0;
        const closing = (code: string) => trial.find((row) => row.code === code)?.closing ?? 0;
        return {
          grossLine: line("400001"),
          discountLine: line("440101"),
          returnLine: line("400003"),
          totalRevenue: income.totalRevenue,
          totalOperatingExpense: income.totalOperatingExpense,
          operatingProfit: income.operatingProfit,
          netProfit: income.netProfit,
          sheetNetProfit: sheet.netProfit,
          sheetBalanced: sheet.balanced,
          sheetAssets: sheet.totalAssets,
          sheetLiabilitiesEquity: sheet.totalLiabilities + sheet.totalEquity,
          summaryRevenue: summary.revenue,
          summaryNetSales: summary.netSales,
          summaryNetProfit: summary.netProfit,
          summaryOperatingProfit: summary.operatingProfit,
          summaryOperatingExpense: summary.totalOperatingExpense,
          equityNetProfit: equity.netProfit,
          discountClosing: closing("440101"),
          returnClosing: closing("400003"),
        };
      };

      const before = await snapshot();

      // Penjualan tunai bruto 300.000 dengan diskon 30.000 (kas diterima 270.000):
      // Dr Kas 270.000, Dr Diskon Penjualan 30.000, Cr Penjualan 300.000.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji kontra: penjualan tunai dengan diskon",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash.id, debit: 270_000, description: "Kas" },
          { accountId: discount.id, debit: 30_000, description: "Diskon penjualan" },
          { accountId: revenue.id, credit: 300_000, description: "Penjualan bruto" },
        ],
      });
      // Retur penjualan tunai 20.000: Dr Retur Penjualan, Cr Kas.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji kontra: retur penjualan tunai",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: salesReturn.id, debit: 20_000, description: "Retur penjualan" },
          { accountId: cash.id, credit: 20_000, description: "Kas" },
        ],
      });
      // Beban sewa tunai 50.000 agar laba bersih tidak trivial.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji kontra: beban sewa tunai",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: rent.id, debit: 50_000, description: "Beban sewa" },
          { accountId: cash.id, credit: 50_000, description: "Kas" },
        ],
      });

      const after = await snapshot();
      return { before, after };
    });

    const d = (key: keyof typeof result.after) =>
      (result.after[key] as number) - (result.before[key] as number);

    // Baris per akun: bruto positif, kontra tampil sebagai pengurang (negatif).
    expect(d("grossLine")).toBeCloseTo(300_000, 2);
    expect(d("discountLine")).toBeCloseTo(-30_000, 2);
    expect(d("returnLine")).toBeCloseTo(-20_000, 2);
    // Total pendapatan = bruto − diskon − retur.
    expect(d("totalRevenue")).toBeCloseTo(250_000, 2);
    expect(d("totalOperatingExpense")).toBeCloseTo(50_000, 2);
    // Laba bersih = 250.000 − 50.000.
    expect(d("netProfit")).toBeCloseTo(200_000, 2);
    // Neraca: laba berjalan sama dengan laba-rugi dan identitas tetap seimbang
    // (kas neto hanya bergerak +200.000: 270.000 − 20.000 − 50.000).
    expect(d("sheetNetProfit")).toBeCloseTo(200_000, 2);
    expect(d("sheetAssets")).toBeCloseTo(200_000, 2);
    expect(result.after.sheetBalanced).toBe(true);
    expect(result.after.sheetAssets).toBeCloseTo(result.after.sheetLiabilitiesEquity, 2);
    // Ringkasan dashboard: omzet bruto 300.000, penjualan bersih 250.000.
    expect(d("summaryRevenue")).toBeCloseTo(300_000, 2);
    expect(d("summaryNetSales")).toBeCloseTo(250_000, 2);
    expect(d("summaryNetProfit")).toBeCloseTo(200_000, 2);
    // Rincian P&L untuk dashboard ikut terbawa di ringkasan yang sama.
    expect(result.after.summaryOperatingProfit).toBeCloseTo(result.after.operatingProfit, 2);
    expect(result.after.summaryOperatingExpense).toBeCloseTo(
      result.after.totalOperatingExpense,
      2,
    );
    // Laporan perubahan ekuitas mewarisi laba bersih yang sama.
    expect(d("equityNetProfit")).toBeCloseTo(200_000, 2);
    // Neraca saldo: saldo akhir akun kontra searah saldo normalnya (debit),
    // konsisten dengan saldo awalnya — bukan dibalik oleh tipe akun.
    expect(d("discountClosing")).toBeCloseTo(30_000, 2);
    expect(d("returnClosing")).toBeCloseTo(20_000, 2);
  });
});
