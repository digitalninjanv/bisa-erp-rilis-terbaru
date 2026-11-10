import { and, eq, sql } from "drizzle-orm";
import {
  accounts,
  cashMovements,
  cashSessions,
  paymentMethods,
  products,
  sales,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { d } from "@/lib/money";
import { getAccountMap } from "@/server/accounting";
import { createExpense } from "@/server/expenses";
import { closeCashSession, createSale, openCashSession, quoteCart } from "@/server/pos";
import { getIncomeStatement } from "@/server/reports/statements";

/**
 * Mengisi data demo laba rugi (12 penjualan + 5 beban) untuk perusahaan
 * demo. Dijalankan SESUDAH `pnpm db:seed -- --force`. Idempoten: bila
 * sudah ada penjualan, skrip berhenti tanpa menulis apa pun.
 *
 * Kode akun mengikuti bagan referensi IFI MART (cutover 2026-11-09).
 */
const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const OPENING_CASH = 500_000;
const PERIOD = { from: "2026-11-01", to: "2026-11-30" };

const EXPENSES = [
  { date: "2026-11-02", code: "600019", amount: 800_000, description: "Sewa gudang November 2026" },
  { date: "2026-11-03", code: "600011", amount: 250_000, description: "Listrik dan air November 2026" },
  { date: "2026-11-04", code: "600013", amount: 200_000, description: "Internet dan telepon November 2026" },
  { date: "2026-11-05", code: "600004", amount: 1_000_000, description: "Gaji staf toko November 2026" },
  { date: "2026-11-06", code: "600016", amount: 150_000, description: "Perlengkapan toko November 2026" },
];

function saleDate(index: number): string {
  const day = 1 + Math.floor((index * 8) / 12);
  return `2026-11-${String(Math.min(day, 8)).padStart(2, "0")}`;
}

void (async () => {
  try {
    await withCompany(ORG, async (tx) => {
      const [existing] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.companyId, ORG))
        .limit(1);
      if (existing) throw new Error("Sudah ada penjualan — skrip dibatalkan agar data tidak dobel.");

      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG), eq(warehouses.name, "Gudang Utama")))
        .limit(1);
      if (!warehouse) throw new Error("Gudang Utama tidak ditemukan.");

      const [cashMethod] = await tx
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG), eq(paymentMethods.type, "cash")))
        .limit(1);
      if (!cashMethod) throw new Error("Metode pembayaran Tunai tidak ditemukan.");

      const stockRows = await tx
        .select({
          id: products.id,
          sku: products.sku,
          salePrice: products.salePrice,
          trackSerial: products.trackSerial,
          trackBatch: products.trackBatch,
          qty: sql<string>`coalesce((select sum(stock_on_hand.qty) from stock_on_hand where stock_on_hand.product_id = ${products.id} and stock_on_hand.company_id = ${ORG}), 0)`,
        })
        .from(products)
        .where(eq(products.companyId, ORG))
        .orderBy(products.sku);

      const selected = stockRows
        .filter((row) => !row.trackSerial && !row.trackBatch && d(row.qty).gte(2) && d(row.salePrice).gt(0))
        .slice(0, 60);
      if (selected.length < 10) throw new Error("Produk demo tidak cukup untuk transaksi contoh.");

      const [existingSession] = await tx
        .select({ id: cashSessions.id, openingCash: cashSessions.openingCash })
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.companyId, ORG),
            eq(cashSessions.userId, USER),
            eq(cashSessions.status, "open"),
          ),
        )
        .limit(1);
      const session = existingSession
        ? { id: existingSession.id, openingCash: d(existingSession.openingCash) }
        : await openCashSession(tx, {
            companyId: ORG,
            userId: USER,
            openingCash: OPENING_CASH,
          }).then((row) => ({ id: row.id, openingCash: d(OPENING_CASH) }));

      let saleTotal = 0;
      let saleCount = 0;
      for (let index = 0; index < selected.length; index += 5) {
        const chunk = selected.slice(index, index + 5);
        const lines = chunk.map((row) => ({
          productId: row.id,
          qty: Math.max(1, Math.floor(d(row.qty).div(2).toNumber())),
        }));
        const date = saleDate(saleCount);
        const quote = await quoteCart(tx, { companyId: ORG, warehouseId: warehouse.id, lines });
        await createSale(tx, {
          companyId: ORG,
          userId: USER,
          warehouseId: warehouse.id,
          date,
          lines,
          payments: [{ methodId: cashMethod.id, amount: quote.total, tendered: quote.total }],
          idempotencyKey: crypto.randomUUID(),
        });
        saleTotal += quote.total;
        saleCount += 1;
      }

      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG));
      const accountByCode = new Map(accountRows.map((row) => [row.code, row.id]));
      const map = await getAccountMap(tx, ORG);
      if (!map.cash) throw new Error('Akun "cash" belum dipetakan.');

      let expenseTotal = 0;
      for (const expense of EXPENSES) {
        const accountId = accountByCode.get(expense.code);
        if (!accountId) throw new Error(`Akun beban ${expense.code} tidak ditemukan.`);
        await createExpense(tx, {
          companyId: ORG,
          userId: USER,
          date: expense.date,
          expenseAccountId: accountId,
          paymentAccountId: map.cash,
          amount: expense.amount,
          description: expense.description,
          idempotencyKey: crypto.randomUUID(),
        });
        expenseTotal += expense.amount;
      }

      const [movement] = await tx
        .select({ total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)` })
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG),
            eq(cashMovements.sessionId, session.id),
            eq(cashMovements.type, "sale"),
          ),
        );
      const counted = session.openingCash.plus(d(movement?.total ?? 0));
      await closeCashSession(tx, {
        companyId: ORG,
        userId: USER,
        sessionId: session.id,
        countedCash: counted.toFixed(2),
      });
      // Kembalikan baseline seed: satu sesi kas terbuka untuk kasir demo.
      await openCashSession(tx, {
        companyId: ORG,
        userId: USER,
        openingCash: OPENING_CASH,
      });

      const pl = await getIncomeStatement(tx, ORG, PERIOD);
      console.log(JSON.stringify({
        transaksi: saleCount,
        penjualan: saleTotal,
        beban: expenseTotal,
        labaRugi: {
          pendapatan: pl.totalRevenue,
          hpp: pl.totalCogs,
          labaKotor: pl.grossProfit,
          bebanOperasional: pl.totalOperatingExpense,
          labaBersih: pl.netProfit,
        },
      }, null, 1));
    });
  } catch (error) {
    console.error("GAGAL:", (error as Error).message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
})();
