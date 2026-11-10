import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMonthlyBalances,
  accounts,
  journalEntries,
  journalLines,
  products,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { getInventoryValuation, getLedger, getStockCard, listJournalEntries } from "@/server/reports";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function insertWarehouse(tx: Tx, suffix: string) {
  const [warehouse] = await tx
    .insert(warehouses)
    .values({ companyId: ORG_ID, code: `WH-T41-${suffix}`, name: `Gudang Uji T4-1 ${suffix}` })
    .returning({ id: warehouses.id });
  return warehouse;
}

async function insertProduct(
  tx: Tx,
  suffix: string,
  values: Partial<{ name: string; costPrice: string; salePrice: string; minStock: string }> = {},
) {
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-T41-${suffix}`,
      name: values.name ?? `Produk Uji T4-1 ${suffix}`,
      costPrice: values.costPrice ?? "1000",
      salePrice: values.salePrice ?? "2000",
      minStock: values.minStock ?? "0",
      trackStock: true,
    })
    .returning({ id: products.id });
  return product;
}

const BASE_TIME = new Date("2026-01-05T08:00:00+07:00").getTime();

async function insertMovement(
  tx: Tx,
  input: { warehouseId: string; productId: string; qty: string; step: number },
) {
  await tx.insert(stockMovements).values({
    companyId: ORG_ID,
    warehouseId: input.warehouseId,
    productId: input.productId,
    movementType: "purchase",
    qty: input.qty,
    unitCost: "1000",
    createdAt: new Date(BASE_TIME + input.step * 60_000),
  });
}

describe("GD-P2-5 kartu stok per gudang", () => {
  it("saldo berjalan hanya dari gerakan gudang terpilih, bukan campuran semua gudang", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const warehouseA = await defaultWarehouse(tx);
      const warehouseB = await insertWarehouse(tx, suffix);
      const product = await insertProduct(tx, suffix);

      // Interleaved in time on purpose: the old mixed card would read
      // 10, 15, 12, 14 — no warehouse ever held those balances.
      await insertMovement(tx, { warehouseId: warehouseA.id, productId: product.id, qty: "10", step: 1 });
      await insertMovement(tx, { warehouseId: warehouseB.id, productId: product.id, qty: "5", step: 2 });
      await insertMovement(tx, { warehouseId: warehouseA.id, productId: product.id, qty: "-3", step: 3 });
      await insertMovement(tx, { warehouseId: warehouseB.id, productId: product.id, qty: "2", step: 4 });

      const cardA = await getStockCard(tx, ORG_ID, product.id, { warehouseId: warehouseA.id });
      const cardB = await getStockCard(tx, ORG_ID, product.id, { warehouseId: warehouseB.id });
      return { cardA, cardB };
    });

    expect(outcome.cardA.total).toBe(2);
    expect(outcome.cardA.openingBalance).toBe("0.0000");
    expect(outcome.cardA.rows.map((r) => r.qty)).toEqual(["10.0000", "-3.0000"]);
    expect(outcome.cardA.rows.map((r) => r.balance)).toEqual(["10.0000", "7.0000"]);

    expect(outcome.cardB.total).toBe(2);
    expect(outcome.cardB.rows.map((r) => r.balance)).toEqual(["5.0000", "7.0000"]);
  });

  it("pagination: saldo awal halaman berikutnya = saldo akhir halaman sebelumnya", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const warehouse = await defaultWarehouse(tx);
      const product = await insertProduct(tx, suffix);
      const qtys = ["5", "3", "-2", "1.5", "-0.5", "2", "1"];
      for (const [index, qty] of qtys.entries()) {
        await insertMovement(tx, { warehouseId: warehouse.id, productId: product.id, qty, step: index + 1 });
      }

      const page1 = await getStockCard(tx, ORG_ID, product.id, { warehouseId: warehouse.id, page: 1, pageSize: 3 });
      const page2 = await getStockCard(tx, ORG_ID, product.id, { warehouseId: warehouse.id, page: 2, pageSize: 3 });
      const page3 = await getStockCard(tx, ORG_ID, product.id, { warehouseId: warehouse.id, page: 3, pageSize: 3 });
      return { page1, page2, page3 };
    });

    expect(outcome.page1.total).toBe(7);
    expect(outcome.page1.openingBalance).toBe("0.0000");
    expect(outcome.page1.rows.map((r) => r.balance)).toEqual(["5.0000", "8.0000", "6.0000"]);

    expect(outcome.page2.openingBalance).toBe("6.0000");
    expect(outcome.page2.rows.map((r) => r.balance)).toEqual(["7.5000", "7.0000", "9.0000"]);

    expect(outcome.page3.openingBalance).toBe("9.0000");
    expect(outcome.page3.rows.map((r) => r.balance)).toEqual(["10.0000"]);
  });

  it("volume: halaman terakhir dari 2.000 gerakan tetap tepat tanpa memuat semua baris", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const warehouse = await defaultWarehouse(tx);
      const product = await insertProduct(tx, suffix);
      const values = Array.from({ length: 2000 }, (_, i) => ({
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: product.id,
        movementType: "purchase",
        qty: "1.0001",
        unitCost: "1000",
        createdAt: new Date(BASE_TIME + (i + 1) * 1000),
      }));
      await tx.insert(stockMovements).values(values);

      const lastPage = await getStockCard(tx, ORG_ID, product.id, {
        warehouseId: warehouse.id,
        page: 40,
        pageSize: 50,
      });
      return lastPage;
    });

    expect(outcome.total).toBe(2000);
    expect(outcome.rows).toHaveLength(50);
    // 1950 × 1.0001 before the page; 2000 × 1.0001 after its last row.
    expect(outcome.openingBalance).toBe("1950.1950");
    expect(outcome.rows.at(-1)?.balance).toBe("2000.2000");
  });

  it("saldo berjalan Decimal eksak untuk qty pecahan 4 desimal (float akan meleset)", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const warehouse = await defaultWarehouse(tx);
      const product = await insertProduct(tx, suffix);
      for (let i = 1; i <= 10; i++) {
        await insertMovement(tx, { warehouseId: warehouse.id, productId: product.id, qty: "0.0001", step: i });
      }
      return getStockCard(tx, ORG_ID, product.id, { warehouseId: warehouse.id });
    });

    const last = outcome.rows.at(-1);
    expect(typeof last?.balance).toBe("string");
    // 10 × 0.0001 in JS floats is 0.0010000000000000002…; Decimal is exact.
    expect(last?.balance).toBe("0.0010");
    expect(outcome.rows.map((r) => r.balance)).toEqual([
      "0.0001", "0.0002", "0.0003", "0.0004", "0.0005",
      "0.0006", "0.0007", "0.0008", "0.0009", "0.0010",
    ]);
  });
});

describe("GD-P2-6 valuasi Decimal berpaginasi", () => {
  async function seedValuationFixture(tx: Tx) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const warehouse = await insertWarehouse(tx, suffix);
    // 900719925474.0993 × 10000 = 9007199254740993 exactly — one past
    // Number.MAX_SAFE_INTEGER (2^53 − 1 = 9007199254740991); any Number()
    // in the chain rounds it to …992 or …994, Decimal keeps it exact.
    const precision = await insertProduct(tx, `${suffix}-P`, {
      name: `Uji Valuasi Presisi ${suffix}`,
      costPrice: "900719925474.0993",
      salePrice: "1000000000000.0001",
      minStock: "20000",
    });
    const second = await insertProduct(tx, `${suffix}-B`, {
      name: `Uji Valuasi B ${suffix}`,
      costPrice: "3333.3333",
      salePrice: "5000.0005",
    });
    const third = await insertProduct(tx, `${suffix}-C`, {
      name: `Uji Valuasi C ${suffix}`,
      costPrice: "10000",
      salePrice: "12000",
    });
    await tx.insert(stockOnHand).values([
      { companyId: ORG_ID, warehouseId: warehouse.id, productId: precision.id, qty: "10000" },
      { companyId: ORG_ID, warehouseId: warehouse.id, productId: second.id, qty: "3" },
      { companyId: ORG_ID, warehouseId: warehouse.id, productId: third.id, qty: "2" },
    ]);
    return { warehouse, precision, second, third };
  }

  it("nilai per produk dan total persis Decimal, bukan Number", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const fixture = await seedValuationFixture(tx);
      const valuation = await getInventoryValuation(tx, ORG_ID, fixture.warehouse.id);
      return { fixture, valuation };
    });

    expect(outcome.valuation.total).toBe(3);
    const precision = outcome.valuation.items.find((r) => r.productId === outcome.fixture.precision.id);
    expect(typeof precision?.value).toBe("string");
    expect(precision?.qty).toBe("10000.0000");
    expect(precision?.value).toBe("9007199254740993.0000");
    expect(precision?.potential).toBe("10000000000000001.0000");

    // 9007199254740993 + 9999.9999 + 20000, summed in Decimal.
    expect(outcome.valuation.totalValue).toBe("9007199254770992.9999");
    // 10000000000000001 + 15000.0015 + 24000, summed in Decimal.
    expect(outcome.valuation.totalPotential).toBe("10000000000039001.0015");
    expect(outcome.valuation.totalQty).toBe("10005.0000");
    expect(outcome.valuation.lowStock.map((r) => r.productId)).toContain(outcome.fixture.precision.id);
  });

  it("pagination membatasi baris tetapi total tetap agregat seluruh hasil", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const fixture = await seedValuationFixture(tx);
      const page1 = await getInventoryValuation(tx, ORG_ID, fixture.warehouse.id, { page: 1, pageSize: 2 });
      const page2 = await getInventoryValuation(tx, ORG_ID, fixture.warehouse.id, { page: 2, pageSize: 2 });
      return { page1, page2 };
    });

    expect(outcome.page1.items).toHaveLength(2);
    expect(outcome.page2.items).toHaveLength(1);
    expect(outcome.page1.total).toBe(3);
    expect(outcome.page2.total).toBe(3);
    const ids = [...outcome.page1.items, ...outcome.page2.items].map((r) => r.productId);
    expect(new Set(ids).size).toBe(3);
    expect(outcome.page1.totalValue).toBe("9007199254770992.9999");
    expect(outcome.page2.totalValue).toBe(outcome.page1.totalValue);
    expect(outcome.page2.totalQty).toBe("10005.0000");
  });
});

/** Raw posted-journal insert (bypasses period guards — the seed closes
 * past periods, and the ledger only reads posted rows). Numbers are
 * zero-padded so the ledger's (date, number) order is deterministic. */
async function insertPostedJournal(
  tx: Tx,
  input: {
    seq: number;
    date: string;
    description: string;
    lines: { accountId: string; debit?: number; credit?: number }[];
  },
) {
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId: ORG_ID,
      number: `JU-T41-${String(input.seq).padStart(4, "0")}`,
      date: input.date,
      description: input.description,
      sourceType: "manual",
      status: "posted",
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
      description: input.description,
      lineNo: index + 1,
    })),
  );
  // FIX-ARS Tahap 2: helper ini meniru sebuah posting, jadi ia wajib
  // memelihara ringkasan saldo bulanan persis seperti postJournal —
  // bila tidak, pembacaan hibrida getLedger tidak melihat jurnal-jurnal
  // ini pada bulan-bulan penuh sebelum rentang yang dibaca.
  const yearMonth = input.date.slice(0, 7);
  const perAccount = new Map<string, { debit: number; credit: number }>();
  for (const line of input.lines) {
    const acc = perAccount.get(line.accountId) ?? { debit: 0, credit: 0 };
    acc.debit += line.debit ?? 0;
    acc.credit += line.credit ?? 0;
    perAccount.set(line.accountId, acc);
  }
  await tx
    .insert(accountMonthlyBalances)
    .values(
      [...perAccount].map(([accountId, totals]) => ({
        companyId: ORG_ID,
        accountId,
        yearMonth,
        totalDebit: String(totals.debit),
        totalCredit: String(totals.credit),
      })),
    )
    .onConflictDoUpdate({
      target: [
        accountMonthlyBalances.companyId,
        accountMonthlyBalances.accountId,
        accountMonthlyBalances.yearMonth,
      ],
      set: {
        totalDebit: sql`${accountMonthlyBalances.totalDebit} + excluded.total_debit`,
        totalCredit: sql`${accountMonthlyBalances.totalCredit} + excluded.total_credit`,
        updatedAt: new Date(),
      },
    });
  return entry;
}

describe("AK-P3-04 buku besar berpaginasi", () => {
  it("tidak kehilangan baris di semua halaman dan saldo berjalan berkesinambungan", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      // Fresh accounts: the seeded COA already carries journals, which
      // would pollute the absolute counts this test asserts.
      const suffix = crypto.randomUUID().slice(0, 8);
      const [cash] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: `1999-T41-${suffix}`,
          name: "Kas Uji T4-1",
          type: "asset",
          normalBalance: "debit",
        })
        .returning({ id: accounts.id });
      const [revenue] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: `4999-T41-${suffix}`,
          name: "Pendapatan Uji T4-1",
          type: "revenue",
          normalBalance: "credit",
        })
        .returning({ id: accounts.id });

      const today = todayISO();
      const dayMs = 86_400_000;
      const from = new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * dayMs).toISOString().slice(0, 10);
      const before = new Date(new Date(`${today}T00:00:00Z`).getTime() - 40 * dayMs).toISOString().slice(0, 10);

      // Pre-range journal: lands in the opening balance, not in the items.
      await insertPostedJournal(tx, {
        seq: 0,
        date: before,
        description: "Uji Ledger T4-1 saldo awal",
        lines: [
          { accountId: cash!.id, debit: 5000 },
          { accountId: revenue!.id, credit: 5000 },
        ],
      });

      for (let i = 1; i <= 12; i++) {
        await insertPostedJournal(tx, {
          seq: i,
          date: today,
          description: `Uji Ledger T4-1 penjualan ${i}`,
          lines: [
            { accountId: cash!.id, debit: 1000 * i },
            { accountId: revenue!.id, credit: 1000 * i },
          ],
        });
      }

      const input = { companyId: ORG_ID, accountId: revenue!.id, from, to: today };
      const full = await getLedger(tx, input);
      const page1 = await getLedger(tx, { ...input, page: 1, pageSize: 5 });
      const page2 = await getLedger(tx, { ...input, page: 2, pageSize: 5 });
      const page3 = await getLedger(tx, { ...input, page: 3, pageSize: 5 });
      const journalList = await listJournalEntries(tx, {
        companyId: ORG_ID,
        q: "Uji Ledger T4-1 penjualan",
        page: 1,
        pageSize: 30,
      });
      return { full, page1, page2, page3, journalList };
    });

    // Revenue is credit-normal: balances accumulate credit − debit.
    expect(outcome.full.opening).toBeCloseTo(5000, 4);
    expect(outcome.full.items).toHaveLength(12);
    expect(outcome.full.total).toBe(12);
    expect(outcome.full.closing).toBeCloseTo(83000, 4);
    expect(outcome.full.totalDebit).toBeCloseTo(0, 4);
    expect(outcome.full.totalCredit).toBeCloseTo(78000, 4);

    const paged = [...outcome.page1.items, ...outcome.page2.items, ...outcome.page3.items];
    expect(outcome.page1.items).toHaveLength(5);
    expect(outcome.page2.items).toHaveLength(5);
    expect(outcome.page3.items).toHaveLength(2);
    expect(paged.map((r) => r.id)).toEqual(outcome.full.items.map((r) => r.id));

    // Continuity across page seams: each balance is the previous balance
    // plus that row's signed movement (credit-normal account).
    let previous = outcome.full.opening;
    for (const row of paged) {
      expect(row.balance).toBeCloseTo(previous + (row.credit - row.debit), 4);
      previous = row.balance;
    }
    expect(previous).toBeCloseTo(outcome.full.closing, 4);
    expect(outcome.page2.opening).toBeCloseTo(outcome.full.opening, 4);
    expect(outcome.page2.closing).toBeCloseTo(outcome.full.closing, 4);

    // Journal list amounts come from one batched aggregate now; the twelve
    // entries total 1000+2000+…+12000 = 78000.
    expect(outcome.journalList.total).toBe(12);
    const listed = outcome.journalList.rows.reduce((acc, r) => acc.plus(r.amount), d(0));
    expect(listed.toFixed(4)).toBe("78000.0000");
  });
});
