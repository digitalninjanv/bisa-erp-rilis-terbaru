import { describe, expect, it } from "vitest";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  cashMovements,
  companySettings,
  customers,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  sales,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { createSale, payReceivable, quoteCart } from "@/server/pos";
import { listReceivables } from "@/server/reports";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// POS-1 (A-8, D-19) — penjualan utang di POS:
//  (a) utang penuh → jurnal Dr Piutang, stok berkurang, tampil di
//      listReceivables dengan sisa penuh & jatuh tempo; bayar sebagian
//      lewat payReceivable → sisa berkurang.
//  (b) split tunai + utang → kas sesi hanya bertambah porsi tunai.
//  (c) utang tanpa pelanggan → ditolak; utang tanpa jatuh tempo → ditolak.
//  (d) melewati batas kredit pelanggan → ditolak.
//  (e) checkout idempoten: retry kunci sama tidak menggandakan piutang.
//  (f) produk berstok 0 ditolak server dengan INSUFFICIENT_STOCK.
// Semua skenario memakai transaksi rollback di perusahaan demo, meniru
// pola tests/integration/feature-matrix-pos.test.ts.

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

async function stockedProduct(tx: Tx, warehouseId: string, minQty: string) {
  const [row] = await tx
    .select({ productId: stockOnHand.productId, qty: stockOnHand.qty })
    .from(stockOnHand)
    .innerJoin(products, eq(stockOnHand.productId, products.id))
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        gt(stockOnHand.qty, minQty),
        eq(products.trackBatch, false),
      ),
    )
    .orderBy(asc(products.sku))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function methodByType(tx: Tx, type: string) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, type)))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function accountByCode(tx: Tx, code: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  expect(account).toBeDefined();
  return account;
}

async function setPrice(tx: Tx, productId: string, salePrice: string) {
  await tx.update(products).set({ salePrice }).where(eq(products.id, productId));
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? "0");
}

/** Pelanggan uji baru agar piutang terbuka & batas kredit deterministik. */
async function freshCustomer(tx: Tx, creditLimit: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [customer] = await tx
    .insert(customers)
    .values({
      companyId: ORG_ID,
      code: `UT-${suffix}`,
      name: `Pelanggan Utang ${suffix}`,
      phone: "081200000000",
      creditLimit,
    })
    .returning();
  expect(customer).toBeDefined();
  return customer;
}

async function baseSettings(tx: Tx) {
  await tx
    .update(companySettings)
    .set({ roundingMode: "none", taxRate: "0", allowNegativeStock: false })
    .where(eq(companySettings.companyId, ORG_ID));
}

function dueIn7Days(): string {
  const date = new Date(`${todayISO()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

type JournalLineRow = typeof journalLines.$inferSelect;

function sumsByAccount(lines: JournalLineRow[]) {
  const map = new Map<string, { debit: ReturnType<typeof d>; credit: ReturnType<typeof d> }>();
  for (const line of lines) {
    const current = map.get(line.accountId) ?? { debit: d(0), credit: d(0) };
    current.debit = current.debit.plus(d(line.debit));
    current.credit = current.credit.plus(d(line.credit));
    map.set(line.accountId, current);
  }
  return map;
}

async function journalOf(tx: Tx, sourceType: string, sourceId: string) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );
  expect(entries).toHaveLength(1);
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entries[0].id));
  return { entry: entries[0], lines, sums: sumsByAccount(lines) };
}

/* ------------------------------------------------------------------ */
/* (a) utang penuh + pembayaran sebagian                               */
/* ------------------------------------------------------------------ */

describe("POS-1 (D-19) — penjualan utang penuh di POS (rollback)", () => {
  it("Dr Piutang sebesar total, stok berkurang, dueDate tersimpan, tampil di listReceivables; bayar sebagian mengurangi sisa", async () => {
    const dueDate = dueIn7Days();
    const outcome = await rollbackTransaction(async (tx) => {
      await baseSettings(tx);
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const credit = await methodByType(tx, "credit");
      const cashAccount = await accountByCode(tx, "110107");
      const receivable = await accountByCode(tx, "110301");
      const customer = await freshCustomer(tx, "0");
      const stockBefore = await stockQty(tx, warehouse.id, product.productId);

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        customerId: customer.id,
        dueDate,
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 1 }],
        payments: [{ methodId: credit.id, amount: 10000, tendered: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      });

      const [stored] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const { sums } = await journalOf(tx, "sale", sale.id);
      const stockAfter = await stockQty(tx, warehouse.id, product.productId);
      const receivablesAfterSale = await listReceivables(tx, ORG_ID);
      const listedAfterSale = receivablesAfterSale.find((row) => row.id === sale.id);

      const cashAccount2 = await accountByCode(tx, "110107");
      await payReceivable(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        amount: 4000,
        accountId: cashAccount2.id,
      });
      const receivablesAfterPay = await listReceivables(tx, ORG_ID);
      const listedAfterPay = receivablesAfterPay.find((row) => row.id === sale.id);

      return {
        storedStatus: stored.paymentStatus,
        storedPaid: d(stored.paidTotal).toNumber(),
        storedCustomerId: stored.customerId,
        storedDueDate: stored.dueDate,
        receivableDebit: sums.get(receivable.id)?.debit.toNumber() ?? 0,
        cashDebit: sums.get(cashAccount.id)?.debit.toNumber() ?? 0,
        stockDelta: stockAfter.minus(stockBefore).toNumber(),
        listedOutstanding: listedAfterSale?.outstanding,
        listedDueDate: listedAfterSale?.dueDate,
        listedCustomerName: listedAfterSale?.customerName,
        outstandingAfterPay: listedAfterPay?.outstanding,
      };
    });

    expect(outcome.storedStatus).toBe("unpaid");
    expect(outcome.storedPaid).toBe(0);
    expect(outcome.storedCustomerId).toBeTruthy();
    // Jatuh tempo tersimpan pada penjualan & terbaca di daftar piutang.
    expect(outcome.storedDueDate).toBe(dueDate);
    expect(outcome.listedDueDate).toBe(dueDate);
    // Jurnal: Dr Piutang penuh, tanpa Dr Kas.
    expect(outcome.receivableDebit).toBeCloseTo(10000, 2);
    expect(outcome.cashDebit).toBe(0);
    // Stok berkurang 1.
    expect(outcome.stockDelta).toBeCloseTo(-1, 4);
    // Daftar piutang: sisa penuh atas nama pelanggan yang benar.
    expect(outcome.listedOutstanding).toBeCloseTo(10000, 2);
    expect(outcome.listedCustomerName).toContain("Pelanggan Utang");
    // Bayar sebagian lewat jalur party payments → sisa berkurang.
    expect(outcome.outstandingAfterPay).toBeCloseTo(6000, 2);
  });
});

/* ------------------------------------------------------------------ */
/* (b) split tunai + utang                                             */
/* ------------------------------------------------------------------ */

describe("POS-1 (D-19) — split tunai + utang (rollback)", () => {
  it("kas sesi hanya bertambah porsi tunai; piutang sebesar sisa tagihan", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await baseSettings(tx);
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const cash = await methodByType(tx, "cash");
      const credit = await methodByType(tx, "credit");
      const cashAccount = await accountByCode(tx, "110107");
      const receivable = await accountByCode(tx, "110301");
      const customer = await freshCustomer(tx, "0");

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        customerId: customer.id,
        dueDate: dueIn7Days(),
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 1 }],
        payments: [
          { methodId: cash.id, amount: 4000, tendered: 4000 },
          { methodId: credit.id, amount: 6000, tendered: 6000 },
        ],
        idempotencyKey: crypto.randomUUID(),
      });

      const [stored] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const { sums } = await journalOf(tx, "sale", sale.id);
      const movements = await tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG_ID),
            eq(cashMovements.referenceId, sale.id),
            eq(cashMovements.type, "sale"),
          ),
        );

      return {
        storedStatus: stored.paymentStatus,
        storedPaid: d(stored.paidTotal).toNumber(),
        cashDebit: sums.get(cashAccount.id)?.debit.toNumber() ?? 0,
        receivableDebit: sums.get(receivable.id)?.debit.toNumber() ?? 0,
        movements: movements.map((m) => d(m.amount).toNumber()),
      };
    });

    expect(outcome.storedStatus).toBe("partial");
    expect(outcome.storedPaid).toBeCloseTo(4000, 2);
    expect(outcome.cashDebit).toBeCloseTo(4000, 2);
    expect(outcome.receivableDebit).toBeCloseTo(6000, 2);
    // Mutasi laci hanya porsi tunai.
    expect(outcome.movements).toEqual([4000]);
  });
});

/* ------------------------------------------------------------------ */
/* (c) penolakan: tanpa pelanggan / tanpa jatuh tempo                  */
/* ------------------------------------------------------------------ */

describe("POS-1 (D-19) — penolakan penjualan utang tidak lengkap (rollback)", () => {
  it("utang tanpa pelanggan ditolak VALIDATION; utang tanpa jatuh tempo ditolak VALIDATION", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await baseSettings(tx);
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const credit = await methodByType(tx, "credit");
      const customer = await freshCustomer(tx, "0");

      let noCustomerError: unknown = null;
      try {
        await createSale(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          dueDate: dueIn7Days(),
          date: todayISO(),
          lines: [{ productId: product.productId, qty: 1 }],
          payments: [{ methodId: credit.id, amount: 10000, tendered: 10000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        noCustomerError = error;
      }

      let noDueDateError: unknown = null;
      try {
        await createSale(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          customerId: customer.id,
          date: todayISO(),
          lines: [{ productId: product.productId, qty: 1 }],
          payments: [{ methodId: credit.id, amount: 10000, tendered: 10000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        noDueDateError = error;
      }

      return {
        noCustomer: noCustomerError as { code?: string; message?: string } | null,
        noDueDate: noDueDateError as { code?: string; message?: string } | null,
      };
    });

    expect(outcome.noCustomer?.code).toBe("VALIDATION");
    expect(outcome.noCustomer?.message).toMatch(/pelanggan/i);
    expect(outcome.noDueDate?.code).toBe("VALIDATION");
    expect(outcome.noDueDate?.message).toMatch(/jatuh tempo/i);
  });
});

/* ------------------------------------------------------------------ */
/* (d) batas kredit                                                    */
/* ------------------------------------------------------------------ */

describe("POS-1 (D-19) — batas kredit pelanggan (rollback)", () => {
  it("piutang terbuka + penjualan baru melewati batas kredit → ditolak; di bawah batas → diterima", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await baseSettings(tx);
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const credit = await methodByType(tx, "credit");
      // Batas 15.000: penjualan pertama 10.000 lolos, kedua 10.000
      // (total terbuka 20.000) harus ditolak.
      const customer = await freshCustomer(tx, "15000");

      const first = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        customerId: customer.id,
        dueDate: dueIn7Days(),
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 1 }],
        payments: [{ methodId: credit.id, amount: 10000, tendered: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      });

      let overLimitError: unknown = null;
      try {
        await createSale(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          customerId: customer.id,
          dueDate: dueIn7Days(),
          date: todayISO(),
          lines: [{ productId: product.productId, qty: 1 }],
          payments: [{ methodId: credit.id, amount: 10000, tendered: 10000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        overLimitError = error;
      }

      return {
        firstId: first.id,
        overLimit: overLimitError as { code?: string; message?: string } | null,
      };
    });

    expect(outcome.firstId).toBeTruthy();
    expect(outcome.overLimit?.code).toBe("VALIDATION");
    expect(outcome.overLimit?.message).toMatch(/batas kredit/i);
  });
});

/* ------------------------------------------------------------------ */
/* (e) idempotensi penjualan utang                                     */
/* ------------------------------------------------------------------ */

describe("POS-1 (D-19) — checkout utang idempoten (rollback)", () => {
  it("retry dengan kunci sama mengembalikan penjualan yang sama; piutang tidak ganda", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await baseSettings(tx);
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const credit = await methodByType(tx, "credit");
      const receivable = await accountByCode(tx, "110301");
      const customer = await freshCustomer(tx, "0");
      const key = crypto.randomUUID();

      const input = {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        customerId: customer.id,
        dueDate: dueIn7Days(),
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 1 }],
        payments: [{ methodId: credit.id, amount: 10000, tendered: 10000 }],
        idempotencyKey: key,
      };
      const first = await createSale(tx, input);
      const retry = await createSale(tx, input);

      const saleRows = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.idempotencyKey, key)));
      const receivables = await listReceivables(tx, ORG_ID);
      const listed = receivables.filter((row) => row.id === first.id);
      const { sums } = await journalOf(tx, "sale", first.id);

      return {
        sameId: retry.id === first.id,
        sameNumber: retry.number === first.number,
        saleRowCount: saleRows.length,
        listedCount: listed.length,
        listedOutstanding: listed[0]?.outstanding,
        receivableDebit: sums.get(receivable.id)?.debit.toNumber() ?? 0,
      };
    });

    expect(outcome.sameId).toBe(true);
    expect(outcome.sameNumber).toBe(true);
    expect(outcome.saleRowCount).toBe(1);
    expect(outcome.listedCount).toBe(1);
    expect(outcome.listedOutstanding).toBeCloseTo(10000, 2);
    expect(outcome.receivableDebit).toBeCloseTo(10000, 2);
  });
});

/* ------------------------------------------------------------------ */
/* (f) stok 0 ditolak server                                           */
/* ------------------------------------------------------------------ */

describe("POS-1 — produk berstok 0 tidak dapat dijual (rollback)", () => {
  it("createSale atas produk trackStock tanpa stok menolak INSUFFICIENT_STOCK (quote melaporkan stok 0)", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await baseSettings(tx);
      const warehouse = await defaultWarehouse(tx);
      const cash = await methodByType(tx, "cash");
      const suffix = crypto.randomUUID().slice(0, 8);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `HABIS-${suffix}`,
          name: `Produk Habis ${suffix}`,
          salePrice: "5000",
          costPrice: "3000",
          trackStock: true,
        })
        .returning();
      expect(product).toBeDefined();

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, qty: 1 }],
      });

      let saleError: unknown = null;
      try {
        await createSale(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: todayISO(),
          lines: [{ productId: product.id, qty: 1 }],
          payments: [{ methodId: cash.id, amount: 5000, tendered: 5000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        saleError = error;
      }

      return {
        quoteStock: quote.lines[0]?.stock,
        saleError: saleError as { code?: string; message?: string } | null,
      };
    });

    expect(outcome.quoteStock).toBe(0);
    expect(outcome.saleError?.code).toBe("INSUFFICIENT_STOCK");
    expect(outcome.saleError?.message).toMatch(/tidak cukup/i);
  });
});
