import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { accounts, products, warehouses } from "@/db/schema";
import {
  buildAgingExportTable,
  buildLedgerExportTable,
  buildReportExportTable,
  countOpenPayables,
  countOpenReceivables,
  getAccountingOnboardingState,
  getAccountingSummary,
  getCashSessionHistoryDetail,
  getCashSessionSummary,
  getControlReconciliation,
  getInventoryValuation,
  getJournalDetail,
  getJournalSummary,
  getLedger,
  getReceivablePayableQueues,
  getSalesByCashier,
  getSalesByCategory,
  getSalesByDay,
  getSalesSummary,
  getStockCard,
  getTopProducts,
  getPaymentBreakdown,
  listAccountBalances,
  listAccounts,
  listCashSessionCashiers,
  listCashSessionHistory,
  listExpenseAccounts,
  listExpenses,
  listHeldSales,
  listInventoryValuationExportPage,
  listJournalActors,
  listJournalEntries,
  listJournalSourceTypes,
  listPayablesPage,
  listReceivablesPage,
  listRecentPartyPayments,
  listSales,
  resolveDefaultLedgerAccountId,
} from "@/server/reports";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * Matriks cabang laporan: setiap fungsi baca dipanggil pada rentang kosong
 * (2099) dan dengan kombinasi filter/pagination, sehingga sisi fallback
 * `?? 0`, filter opsional, dan clamp halaman ikut teruji tanpa menyentuh
 * data historis.
 */
const ORG = "01900000-0000-7000-8000-000000000001";
const rollback = makeRollbackTransaction(ORG);
const EMPTY_RANGE = { from: "2999-01-01", to: "2999-12-31" };
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("matriks cabang laporan", () => {
  it("laporan penjualan: rentang kosong, filter, dan batas halaman", async () => {
    await rollback(async (tx) => {
      const summary = await getSalesSummary(tx, ORG, EMPTY_RANGE);
      expect(summary.transactions).toBe(0);
      expect(summary.average).toBe(0);
      expect(await getSalesByDay(tx, ORG, EMPTY_RANGE)).toEqual([]);
      expect(await getSalesByCashier(tx, ORG, EMPTY_RANGE)).toEqual([]);
      expect(await getSalesByCategory(tx, ORG, EMPTY_RANGE)).toEqual([]);
      expect(await getSalesByCategory(tx, ORG, EMPTY_RANGE, MISSING)).toEqual([]);
      expect(await getTopProducts(tx, ORG, EMPTY_RANGE)).toEqual([]);
      expect(await getTopProducts(tx, ORG, EMPTY_RANGE, 0)).toEqual([]);
      expect(await getPaymentBreakdown(tx, ORG, EMPTY_RANGE)).toEqual([]);

      const noFilter = await listSales(tx, { companyId: ORG });
      expect(noFilter.page).toBe(1);
      const narrow = await listSales(tx, {
        companyId: ORG,
        q: "  tidak-ada  ",
        status: "completed",
        from: "2999-01-01",
        to: "2999-12-31",
        page: 0,
        pageSize: 5000,
      });
      expect(narrow.page).toBe(1);
      expect(narrow.pageSize).toBe(100);
      expect(Array.isArray(await listHeldSales(tx, ORG))).toBe(true);
    });
  });

  it("jurnal: ringkasan kosong dan semua kombinasi filter", async () => {
    await rollback(async (tx) => {
      const summary = await getJournalSummary(tx, ORG, EMPTY_RANGE);
      expect(summary.entries).toBe(0);
      expect(summary.manual).toBe(0);
      expect(summary.debit).toBe(0);
      expect(summary.credit).toBe(0);

      const noFilter = await listJournalEntries(tx, { companyId: ORG });
      expect(noFilter.page).toBe(1);
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.companyId, ORG))
        .limit(1);
      const filtered = await listJournalEntries(tx, {
        companyId: ORG,
        from: "2999-01-01",
        to: "2999-12-31",
        sourceType: "manual",
        status: "posted",
        createdBy: MISSING,
        accountId: account?.id ?? MISSING,
        q: "  tidak-ada  ",
        page: 0,
        pageSize: 5000,
      });
      expect(filtered.page).toBe(1);
      expect(filtered.pageSize).toBe(100);
      expect(Array.isArray(await listJournalActors(tx, ORG))).toBe(true);
      expect(Array.isArray(await listJournalSourceTypes(tx, ORG))).toBe(true);
      expect(await getJournalDetail(tx, ORG, MISSING)).toBeNull();
    });
  });

  it("sesi kas: ringkasan hilang, filter riwayat, dan detail hilang", async () => {
    await rollback(async (tx) => {
      expect(await getCashSessionSummary(tx, ORG, MISSING)).toBeNull();
      expect(await getCashSessionHistoryDetail(tx, ORG, MISSING)).toBeNull();
      const empty = await listCashSessionHistory(tx, ORG);
      expect(empty.page).toBe(1);
      expect(empty.pageSize).toBe(20);
      const filtered = await listCashSessionHistory(tx, ORG, {
        status: "open",
        userId: MISSING,
        branchId: MISSING,
        from: "2999-01-01",
        to: "2999-12-31",
        page: 0,
        pageSize: 5000,
      });
      expect(filtered.page).toBe(1);
      expect(filtered.pageSize).toBe(100);
      const invalidStatus = await listCashSessionHistory(tx, ORG, {
        status: "bukan-status",
        page: 2,
        pageSize: 0,
      });
      expect(invalidStatus.page).toBe(2);
      expect(invalidStatus.pageSize).toBe(1);
      expect(Array.isArray(await listCashSessionCashiers(tx, ORG))).toBe(true);
    });
  });

  it("utang/piutang: halaman kosong, filter jatuh tempo, dan queue", async () => {
    await rollback(async (tx) => {
      expect(await countOpenReceivables(tx, ORG)).toBeGreaterThanOrEqual(0);
      expect(await countOpenPayables(tx, ORG)).toBeGreaterThanOrEqual(0);
      for (const status of ["", "terlambat", "segera", "jatuh-tempo"] as const) {
        const page = await listReceivablesPage(tx, ORG, {
          page: status === "" ? 0 : 1,
          pageSize: status === "" ? 5000 : 10,
          status,
          q: status === "" ? "" : "tidak-ada",
          today: "2999-12-31",
        });
        if (status) expect(page.rows).toEqual([]);
        expect(Array.isArray(page.rows)).toBe(true);
      }
      for (const status of ["", "terlambat", "segera", "jatuh-tempo"] as const) {
        const page = await listPayablesPage(tx, ORG, {
          page: 0,
          pageSize: 5000,
          status,
          q: "tidak-ada",
          today: "2999-12-31",
        });
        if (status) expect(page.rows).toEqual([]);
        expect(Array.isArray(page.rows)).toBe(true);
      }
      const queues = await getReceivablePayableQueues(tx, ORG, "2099-12-31");
      expect(queues).toBeTruthy();
      expect(Array.isArray(await listRecentPartyPayments(tx, ORG))).toBe(true);
      expect(await listRecentPartyPayments(tx, ORG, 0)).toEqual([]);
    });
  });

  it("buku besar & valuasi: akun default, cursor ekspor, dan kartu stok", async () => {
    await rollback(async (tx) => {
      const accountList = await listAccounts(tx, ORG);
      expect(accountList.length).toBeGreaterThan(0);
      const defaultId = await resolveDefaultLedgerAccountId(tx, ORG, accountList, EMPTY_RANGE);
      expect(defaultId).toBeTruthy();
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.companyId, ORG))
        .orderBy(asc(accounts.code))
        .limit(1);
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, ORG))
        .limit(1);
      const ledger = await getLedger(tx, {
        companyId: ORG,
        accountId: account?.id ?? MISSING,
        from: "2999-01-01",
        to: "2999-12-31",
        page: 0,
        pageSize: 5000,
      });
      expect(ledger.page).toBe(1);
      const fullLedger = await getLedger(tx, {
        companyId: ORG,
        accountId: account?.id ?? MISSING,
        from: "2999-01-01",
        to: "2999-12-31",
      });
      expect(fullLedger.items).toEqual([]);

      const valuation = await getInventoryValuation(tx, ORG);
      expect(valuation.items.length).toBeGreaterThanOrEqual(0);
      expect(
        await getInventoryValuation(tx, ORG, warehouse?.id, {
          page: 0,
          pageSize: 5000,
          skipLowStock: true,
          skipLowStockRows: true,
          q: "tidak-ada",
        }),
      ).toBeTruthy();
      expect(
        await getInventoryValuation(tx, ORG, MISSING, { page: 2, pageSize: 0 }),
      ).toBeTruthy();
      expect(await listInventoryValuationExportPage(tx, ORG)).toBeTruthy();
      expect(
        await listInventoryValuationExportPage(
          tx,
          ORG,
          warehouse?.id ?? MISSING,
          { name: "", id: MISSING },
          0,
          "tidak-ada",
        ),
      ).toBeTruthy();
      if (product && warehouse) {
        const card = await getStockCard(tx, ORG, product.id, {
          warehouseId: warehouse.id,
          page: 0,
          pageSize: 5000,
        });
        expect(Array.isArray(card.rows)).toBe(true);
      }
      expect(await getStockCard(tx, ORG, MISSING, { warehouseId: MISSING })).toBeTruthy();
    });
  });

  it("ikhtisar, kontrol, dan seluruh tipe ekspor laporan", async () => {
    await rollback(async (tx) => {
      const summary = await getAccountingSummary(tx, ORG, EMPTY_RANGE);
      expect(summary).toBeTruthy();
      expect(await listAccountBalances(tx, ORG)).toBeTruthy();
      expect(await listExpenseAccounts(tx, ORG)).toBeTruthy();
      expect(await getAccountingOnboardingState(tx, ORG)).toBeTruthy();
      expect(await listExpenses(tx, ORG)).toBeTruthy();
      expect(
        await listExpenses(tx, ORG, {
          from: "2999-01-01",
          to: "2999-12-31",
          month: "2999-01",
          page: 0,
          pageSize: 5000,
        }),
      ).toBeTruthy();
      const control = await getControlReconciliation(tx, ORG, "2099-12-31");
      expect(control.asOf).toBe("2099-12-31");
      for (const type of [
        "ppn",
        "neraca",
        "arus-kas",
        "ekuitas",
        "neraca-saldo",
        "penjualan",
        "laba-rugi",
      ]) {
        const table = await buildReportExportTable(
          tx,
          { id: ORG, name: "Uji" },
          type,
          "2999-01-01",
          "2999-12-31",
          { hideZero: false },
        );
        expect(table.rows.length).toBeGreaterThan(0);
      }
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.companyId, ORG))
        .limit(1);
      if (account) {
        const ledgerTable = await buildLedgerExportTable(tx, { id: ORG, name: "Uji" }, {
          accountId: account.id,
          from: "2999-01-01",
          to: "2999-12-31",
        });
        expect(ledgerTable?.table.rows.length).toBeGreaterThan(0);
      }
      const aging = await buildAgingExportTable(tx, { id: ORG, name: "Uji" }, "utang");
      expect(aging.rows.length).toBeGreaterThan(0);
      const receivableAging = await buildAgingExportTable(tx, { id: ORG, name: "Uji" }, "piutang");
      expect(receivableAging.rows.length).toBeGreaterThan(0);

      const defaultLedger = await buildLedgerExportTable(tx, { id: ORG, name: "Uji" }, {
        accountId: null,
        from: "2999-01-01",
        to: "2999-12-31",
      });
      expect(defaultLedger === null || defaultLedger.table.rows.length > 0).toBe(true);
      expect(
        await buildLedgerExportTable(tx, { id: ORG, name: "Uji" }, {
          accountId: MISSING,
          from: "2999-01-01",
          to: "2999-12-31",
        }),
      ).toBeNull();

      for (const type of ["ppn", "neraca", "arus-kas", "ekuitas", "neraca-saldo", "penjualan"]) {
        const table = await buildReportExportTable(
          tx,
          { id: ORG, name: "Uji" },
          type,
          "2999-01-01",
          "2999-12-31",
        );
        expect(table.rows.length).toBeGreaterThan(0);
      }
    });
  });
});
