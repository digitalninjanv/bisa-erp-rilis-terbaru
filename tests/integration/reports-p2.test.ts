import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, products } from "@/db/schema";
import { ensureFiscalPeriods, postJournal } from "@/server/accounting";
import {
  getAccountingSummary,
  getBalanceSheet,
  getCashFlow,
  getEquityStatement,
  getHomeSummary,
  getIncomeStatement,
  getJournalSummary,
  getLedger,
  getTrialBalance,
  mappedBalance,
} from "@/server/reports";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// AK-P2 regression suite for src/server/reports.ts:
//  AK-P2-02 only posted journals may feed any report aggregate
//  AK-P2-07 prior-year-only accounts must survive in comparison columns
//  AK-P2-08 cash flow groups come from accounts.cash_flow_group
//  AK-P2-09 ledger running balance follows the account's normal balance
//  AK-P2-11 dashboard inventory value equals the GL inventory balance
// Every write happens inside a rollback transaction (pattern copied from
// tests/integration/consistency.test.ts) so the dev database stays clean.
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

/** Inserts a journal entry with an arbitrary status, bypassing postJournal (which always posts). */
async function insertRawJournal(
  tx: Tx,
  input: {
    date: string;
    status: "draft" | "void";
    lines: { accountId: string; debit?: number; credit?: number }[];
  },
) {
  const number = `UJI-P2-${input.status.toUpperCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId: ORG_ID,
      number,
      date: input.date,
      description: `Jurnal uji reports P2 (${input.status})`,
      sourceType: "manual",
      status: input.status,
      createdBy: USER_ID,
    })
    .returning({ id: journalEntries.id });
  await tx.insert(journalLines).values(
    input.lines.map((line, index) => ({
      companyId: ORG_ID,
      entryId: entry.id,
      accountId: line.accountId,
      debit: String(line.debit ?? 0),
      credit: String(line.credit ?? 0),
      description: "Baris uji reports P2",
      lineNo: index + 1,
    })),
  );
  return entry;
}

const WIDE = { from: "2000-01-01", to: "2100-12-31" };

describe("AK-P2-02: reports only count posted journals", () => {
  it("draft and void journals change no report figure", async () => {
    const today = todayISO();
    const result = await rollbackTransaction(async (tx) => {
      const acc = await loadAccounts(tx);
      const cash = acc.get("110107")!;
      const revenue = acc.get("400001")!;
      const equity = acc.get("300001")!;
      const rent = acc.get("600019")!;

      const snapshot = async () => {
        const income = await getIncomeStatement(tx, ORG_ID, WIDE);
        const sheet = await getBalanceSheet(tx, ORG_ID, WIDE.to);
        const trial = await getTrialBalance(tx, ORG_ID, WIDE);
        const cashFlow = await getCashFlow(tx, ORG_ID, WIDE);
        const equityStatement = await getEquityStatement(tx, ORG_ID, WIDE);
        const summary = await getJournalSummary(tx, ORG_ID, WIDE);
        const ledger = await getLedger(tx, { companyId: ORG_ID, accountId: revenue.id, from: WIDE.from, to: WIDE.to });
        const accountSummary = await getAccountingSummary(tx, ORG_ID, WIDE);
        return {
          totalRevenue: income.totalRevenue,
          totalOperatingExpense: income.totalOperatingExpense,
          netProfit: income.netProfit,
          totalAssets: sheet.totalAssets,
          sheetTotalEquity: sheet.totalEquity,
          cashClosing: trial.find((row) => row.code === "110107")?.closing ?? 0,
          cashFlowNet: cashFlow.net,
          equityClosing: equityStatement.totalClosing,
          journalDebit: summary.debit,
          journalCredit: summary.credit,
          ledgerClosing: ledger.closing,
          summaryNetProfit: accountSummary.netProfit,
          summaryCash: accountSummary.cash,
        };
      };

      const before = await snapshot();

      // Draft: expense against cash. Void: cash against revenue. Void: cash against equity.
      await insertRawJournal(tx, {
        date: today,
        status: "draft",
        lines: [
          { accountId: rent.id, debit: 777000 },
          { accountId: cash.id, credit: 777000 },
        ],
      });
      await insertRawJournal(tx, {
        date: today,
        status: "void",
        lines: [
          { accountId: cash.id, debit: 555000 },
          { accountId: revenue.id, credit: 555000 },
        ],
      });
      await insertRawJournal(tx, {
        date: today,
        status: "void",
        lines: [
          { accountId: cash.id, debit: 333000 },
          { accountId: equity.id, credit: 333000 },
        ],
      });

      const after = await snapshot();
      return { before, after };
    });

    expect(result.after.totalRevenue).toBeCloseTo(result.before.totalRevenue, 2);
    expect(result.after.totalOperatingExpense).toBeCloseTo(result.before.totalOperatingExpense, 2);
    expect(result.after.netProfit).toBeCloseTo(result.before.netProfit, 2);
    expect(result.after.totalAssets).toBeCloseTo(result.before.totalAssets, 2);
    expect(result.after.sheetTotalEquity).toBeCloseTo(result.before.sheetTotalEquity, 2);
    expect(result.after.cashClosing).toBeCloseTo(result.before.cashClosing, 2);
    expect(result.after.cashFlowNet).toBeCloseTo(result.before.cashFlowNet, 2);
    expect(result.after.equityClosing).toBeCloseTo(result.before.equityClosing, 2);
    expect(result.after.journalDebit).toBeCloseTo(result.before.journalDebit, 2);
    expect(result.after.journalCredit).toBeCloseTo(result.before.journalCredit, 2);
    expect(result.after.ledgerClosing).toBeCloseTo(result.before.ledgerClosing, 2);
    expect(result.after.summaryNetProfit).toBeCloseTo(result.before.summaryNetProfit, 2);
    expect(result.after.summaryCash).toBeCloseTo(result.before.summaryCash, 2);
  });
});

describe("AK-P2-07: comparison columns keep prior-year-only accounts", () => {
  it("income statement lists a prior-year-only expense account with 0 in the current year", async () => {
    const today = todayISO();
    const year = Number(today.slice(0, 4));
    const currentRange = { from: `${year}-01-01`, to: `${year}-12-31` };
    const priorRange = { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };

    const result = await rollbackTransaction(async (tx) => {
      // FIX-P1 Tahap 3 (AK1-01): jurnal tahun lalu butuh periode tahun
      // lalu yang termaterialisasi — tanpa baris kini berarti tertutup.
      await ensureFiscalPeriods(tx, ORG_ID, year - 1);
      const acc = await loadAccounts(tx);
      const cash = acc.get("110107")!;
      const [created] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: "6990",
          name: "Beban Uji P2",
          type: "expense",
          normalBalance: "debit",
          isPostable: true,
          isActive: true,
        })
        .returning({ id: accounts.id });

      await postJournal(tx, {
        companyId: ORG_ID,
        date: `${year - 1}-06-15`,
        description: "Uji AK-P2-07 beban hanya tahun lalu",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: created.id, debit: 321000, description: "Beban uji" },
          { accountId: cash.id, credit: 321000, description: "Kas" },
        ],
      });

      const current = await getIncomeStatement(tx, ORG_ID, currentRange);
      const prior = await getIncomeStatement(tx, ORG_ID, priorRange);
      return {
        currentRow: current.operatingExpense.find((row) => row.code === "6990"),
        priorRow: prior.operatingExpense.find((row) => row.code === "6990"),
        priorDetailSum: prior.operatingExpense.reduce((acc2, row) => acc2 + row.amount, 0),
        priorTotal: prior.totalOperatingExpense,
      };
    });

    expect(result.priorRow?.amount).toBeCloseTo(321000, 2);
    expect(result.priorDetailSum).toBeCloseTo(result.priorTotal, 2);
    // The union requirement: the account must exist in the current-year
    // statement too, valued 0, so detail rows reconcile with both totals.
    expect(result.currentRow).toBeDefined();
    expect(result.currentRow?.amount).toBeCloseTo(0, 2);
  });

  it("balance sheet lists an account that settled to zero during the current year", async () => {
    const today = todayISO();
    const year = Number(today.slice(0, 4));
    const priorAsOf = `${year - 1}-12-31`;

    const result = await rollbackTransaction(async (tx) => {
      // FIX-P1 Tahap 3 (AK1-01): sama seperti test di atas — materialisasi
      // eksplisit tahun lalu di dalam transaksi rollback.
      await ensureFiscalPeriods(tx, ORG_ID, year - 1);
      const acc = await loadAccounts(tx);
      const equity = acc.get("300001")!;
      const [created] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: "1990",
          name: "Aset Uji P2",
          type: "asset",
          normalBalance: "debit",
          // FIX-R2 Tahap 3 (AK2-04): ekspektasi lama test ini (akun
          // tampil di nonCurrentAssets) adalah artefak fallback rentang
          // kode "1990" ≥ "1500" yang sudah dihapus — kelompok kini
          // dinyatakan eksplisit lewat section akun, seperti maksud
          // test ini sejak awal (aset tidak lancar).
          section: "non_current_asset",
          isPostable: true,
          isActive: true,
        })
        .returning({ id: accounts.id });

      await postJournal(tx, {
        companyId: ORG_ID,
        date: `${year - 1}-06-15`,
        description: "Uji AK-P2-07 aset dibuka tahun lalu",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: created.id, debit: 210000, description: "Aset uji" },
          { accountId: equity.id, credit: 210000, description: "Modal" },
        ],
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji AK-P2-07 aset dilunasi tahun ini",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: equity.id, debit: 210000, description: "Modal" },
          { accountId: created.id, credit: 210000, description: "Aset uji" },
        ],
      });

      const priorSheet = await getBalanceSheet(tx, ORG_ID, priorAsOf);
      const currentSheet = await getBalanceSheet(tx, ORG_ID, today);
      return {
        priorRow: priorSheet.nonCurrentAssets.find((row) => row.code === "1990"),
        currentRow: currentSheet.nonCurrentAssets.find((row) => row.code === "1990"),
        priorBalanced: priorSheet.balanced,
        currentBalanced: currentSheet.balanced,
      };
    });

    expect(result.priorRow?.amount).toBeCloseTo(210000, 2);
    expect(result.currentRow).toBeDefined();
    expect(result.currentRow?.amount).toBeCloseTo(0, 2);
    expect(result.priorBalanced).toBe(true);
    expect(result.currentBalanced).toBe(true);
  });
});

describe("AK-P2-08: cash flow follows accounts.cash_flow_group", () => {
  it("classifies by the counter-account group, not the journal sourceType string", async () => {
    const today = todayISO();
    const range = { from: today, to: today };

    const result = await rollbackTransaction(async (tx) => {
      const acc = await loadAccounts(tx);
      const cash = acc.get("110107")!;
      const equipment = acc.get("120004")!;
      const rent = acc.get("600019")!;

      const before = await getCashFlow(tx, ORG_ID, range);

      // Equipment normally falls back to investing; force it to operating.
      await tx.update(accounts).set({ cashFlowGroup: "operating" }).where(eq(accounts.id, equipment.id));
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji AK-P2-08 beli peralatan tunai",
        sourceType: "equipment_purchase",
        createdBy: USER_ID,
        lines: [
          { accountId: equipment.id, debit: 450000, description: "Peralatan" },
          { accountId: cash.id, credit: 450000, description: "Kas" },
        ],
      });

      // Rent normally falls back to operating; force it to financing.
      await tx.update(accounts).set({ cashFlowGroup: "financing" }).where(eq(accounts.id, rent.id));
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji AK-P2-08 beban sewa tunai",
        sourceType: "expense",
        createdBy: USER_ID,
        lines: [
          { accountId: rent.id, debit: 200000, description: "Sewa" },
          { accountId: cash.id, credit: 200000, description: "Kas" },
        ],
      });

      const after = await getCashFlow(tx, ORG_ID, range);
      return {
        operatingDelta: after.groups.operating - before.groups.operating,
        investingDelta: after.groups.investing - before.groups.investing,
        financingDelta: after.groups.financing - before.groups.financing,
        netDelta: after.net - before.net,
        closingOk: Math.abs(after.closing - (after.opening + after.net)) < 0.01,
        equipmentRow: after.rows.find((row) => row.sourceType === "equipment_purchase"),
        expenseRowGroup: after.rows.find((row) => row.sourceType === "expense")?.group,
      };
    });

    expect(result.operatingDelta).toBeCloseTo(-450000, 2);
    expect(result.financingDelta).toBeCloseTo(-200000, 2);
    expect(result.investingDelta).toBeCloseTo(0, 2);
    // Classification must never change the total cash movement.
    expect(result.netDelta).toBeCloseTo(-650000, 2);
    expect(result.closingOk).toBe(true);
    expect(result.equipmentRow?.group).toBe("operating");
    expect(result.equipmentRow?.net).toBeCloseTo(-450000, 2);
    expect(result.expenseRowGroup).toBe("financing");
  });
});

describe("AK-P2-09: ledger running balance follows normal balance", () => {
  it("a credit to a credit-normal revenue account increases its ledger balance", async () => {
    const today = todayISO();
    const range = { from: today, to: today };

    const result = await rollbackTransaction(async (tx) => {
      const acc = await loadAccounts(tx);
      const cash = acc.get("110107")!;
      const revenue = acc.get("400001")!;

      const revBefore = await getLedger(tx, { companyId: ORG_ID, accountId: revenue.id, ...range });
      const cashBefore = await getLedger(tx, { companyId: ORG_ID, accountId: cash.id, ...range });

      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji AK-P2-09 penjualan tunai",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash.id, debit: 250000, description: "Kas" },
          { accountId: revenue.id, credit: 250000, description: "Uji P2-09" },
        ],
      });

      const revAfter = await getLedger(tx, { companyId: ORG_ID, accountId: revenue.id, ...range });
      const cashAfter = await getLedger(tx, { companyId: ORG_ID, accountId: cash.id, ...range });
      const ownLine = revAfter.items.find((row) => row.description === "Uji P2-09");
      return { revBefore, revAfter, cashBefore, cashAfter, ownLine };
    });

    expect(result.revAfter.opening).toBeCloseTo(result.revBefore.opening, 2);
    expect(result.revAfter.closing).toBeCloseTo(result.revBefore.closing + 250000, 2);
    expect(result.ownLine?.balance).toBeCloseTo(result.revAfter.closing, 2);
    // Debit-normal accounts keep the debit-positive convention.
    expect(result.cashAfter.closing).toBeCloseTo(result.cashBefore.closing + 250000, 2);
  });
});

describe("AK-P2-11: dashboard inventory value equals the GL inventory balance", () => {
  it("getAccountingSummary and getHomeSummary read inventory from the ledger, not qty × current cost", async () => {
    const today = todayISO();

    const result = await rollbackTransaction(async (tx) => {
      const acc = await loadAccounts(tx);
      const cash = acc.get("110107")!;
      const inventoryAccount = acc.get("110401")!;

      const glBefore = await mappedBalance(tx, ORG_ID, ["inventory"]);

      // Changing a product's current cost price must not move the reported
      // inventory value: only journal movements may.
      const [product] = await tx
        .select({ id: products.id, costPrice: products.costPrice })
        .from(products)
        .where(eq(products.companyId, ORG_ID))
        .limit(1);
      await tx
        .update(products)
        .set({ costPrice: String(Number(product.costPrice) + 12345) })
        .where(eq(products.id, product.id));

      // A manual inventory journal moves the GL balance without any
      // stock_on_hand change; the dashboards must follow the GL.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Uji AK-P2-11 jurnal persediaan manual",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: inventoryAccount.id, debit: 99000, description: "Persediaan" },
          { accountId: cash.id, credit: 99000, description: "Kas" },
        ],
      });

      const glAfter = await mappedBalance(tx, ORG_ID, ["inventory"]);
      const summary = await getAccountingSummary(tx, ORG_ID, WIDE);
      const home = await getHomeSummary(tx, ORG_ID, today);
      return { glBefore, glAfter, summaryValue: summary.inventoryValue, homeValue: home.inventoryValue };
    });

    expect(result.glAfter).toBeCloseTo(result.glBefore + 99000, 2);
    expect(result.summaryValue).toBeCloseTo(result.glAfter, 2);
    expect(result.homeValue).toBeCloseTo(result.glAfter, 2);
  });
});
