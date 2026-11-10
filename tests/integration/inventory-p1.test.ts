import { afterAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  cashSessions,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  saleReturns,
  sales,
  stockMovements,
  stockOnHand,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { getAccountMap } from "@/server/accounting";
import { createReceipt } from "@/server/inventory";
import { createSale, createSaleReturn, quoteCart, voidSale } from "@/server/pos";
import { receiveStockAction } from "@/server/actions/inventory/penerimaan";
import { saveProductAction } from "@/server/actions/inventory/produk";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Action-level tests need an authenticated company context and Next's cache
// revalidation; both are replaced so the real action code (Zod validation,
// guard) runs against the real database, following payments-void-p2.test.ts.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  });
  // T5R-2: fixture sesi ini mewakili perusahaan dengan semua modul
  // aktif, jadi gerbang modul di lapisan action lolos persis seperti
  // requirePermission (gerbang sungguhannya diuji di review-fixes-t5r).
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

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

async function anySupplier(tx: Tx) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(1);
  expect(supplier).toBeDefined();
  return supplier;
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
  return d(row?.qty ?? 0);
}

async function movementCount(tx: Tx, productId: string) {
  const rows = await tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(and(eq(stockMovements.companyId, ORG_ID), eq(stockMovements.productId, productId)));
  return rows.length;
}

async function journalAccountTotals(tx: Tx, sourceType: string, sourceId: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );
  expect(entry).toBeDefined();
  const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id));
  const totals = new Map<string, { debit: ReturnType<typeof d>; credit: ReturnType<typeof d> }>();
  for (const line of lines) {
    const current = totals.get(line.accountId) ?? { debit: d(0), credit: d(0) };
    current.debit = current.debit.plus(d(line.debit));
    current.credit = current.credit.plus(d(line.credit));
    totals.set(line.accountId, current);
  }
  const debit = lines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
  const credit = lines.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
  return { totals, debit, credit };
}

describe("GD-P1-2 moving average is global per product", () => {
  it("receiving into an empty second warehouse averages against stock in the first", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouseA = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const suffix = crypto.randomUUID().slice(0, 8);

      const [warehouseB] = await tx
        .insert(warehouses)
        .values({ companyId: ORG_ID, code: `WH-P1-${suffix}`, name: "Gudang Uji P1" })
        .returning({ id: warehouses.id });

      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `TST-P1-AVG-${suffix}`,
          name: "Produk Uji Rata-Rata P1",
          costPrice: "0",
          salePrice: "25000",
          trackStock: true,
        })
        .returning({ id: products.id });

      // 10 units @ 10.000 into warehouse A.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouseA.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 10000 }],
      });
      const [afterA] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, product.id));

      // 10 units @ 20.000 into the still-empty warehouse B.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouseB.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 20000 }],
      });

      const [afterB] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, product.id));
      const qtyA = await stockQty(tx, warehouseA.id, product.id);
      const qtyB = await stockQty(tx, warehouseB.id, product.id);
      return { afterA, afterB, qtyA, qtyB, costPrice: d(afterB.costPrice) };
    });

    expect(outcome.afterA.costPrice).toBe("10000.0000");
    expect(outcome.qtyA.toFixed(4)).toBe("10.0000");
    expect(outcome.qtyB.toFixed(4)).toBe("10.0000");
    // Global moving average: (10 x 10.000 + 10 x 20.000) / 20 = 15.000,
    // NOT the 20.000 a per-warehouse average would produce.
    expect(outcome.afterB.costPrice).toBe("15000.0000");
    // Total valuation across warehouses: 20 x 15.000.
    expect(outcome.qtyA.plus(outcome.qtyB).mul(outcome.costPrice).toFixed(2)).toBe("300000.00");
  });
});

describe("GD-P1-4 POS does not move stock for trackStock=false products", () => {
  it("checkout and partial return of a service product create no stock movements and no COGS/inventory journal legs; void is rejected after a posted return (T4R-1) and moves nothing for an un-returned service sale", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [service] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `TST-P1-SVC-${suffix}`,
          name: "Jasa Uji P1",
          costPrice: "4000",
          salePrice: "10000",
          trackStock: false,
        })
        .returning({ id: products.id });

      const [method] = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
        .limit(1);
      expect(method).toBeDefined();
      const [session] = await tx
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.companyId, ORG_ID),
            eq(cashSessions.userId, USER_ID),
            eq(cashSessions.status, "open"),
          ),
        )
        .orderBy(asc(cashSessions.openedAt))
        .limit(1);
      expect(session).toBeDefined();

      const map = await getAccountMap(tx, ORG_ID);
      const lines = [{ productId: service.id, qty: 2 }];
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        customerId: null,
        lines,
      });
      expect(quote.total).toBeGreaterThan(0);

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });

      const [storedSale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const movementsAfterSale = await movementCount(tx, service.id);
      const onHandAfterSale = await stockQty(tx, warehouse.id, service.id);
      const saleJournal = await journalAccountTotals(tx, "sale", sale.id);

      // Partial return of 1 of 2 units.
      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji otomatis retur jasa",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: service.id, qty: 1 }],
      });
      const [storedReturn] = await tx
        .select()
        .from(saleReturns)
        .where(and(eq(saleReturns.companyId, ORG_ID), eq(saleReturns.id, ret.id)));
      const movementsAfterReturn = await movementCount(tx, service.id);
      const returnJournal = await journalAccountTotals(tx, "sale_return", ret.id);

      // T4R-1 (review Tahap 4): penjualan yang sudah memiliki retur
      // posted tidak boleh di-void — percobaan void di sini WAJIB
      // ditolak dan tidak mengubah apa pun. Cakupan "void penjualan
      // jasa tidak menulis gerakan" dipindah ke penjualan kedua tanpa
      // retur di bawah.
      let voidError: unknown;
      try {
        await voidSale(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          reason: "Uji otomatis void jasa sesudah retur",
        });
      } catch (caught) {
        voidError = caught;
      }
      const [afterRejectedVoid] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const movementsAfterRejectedVoid = await movementCount(tx, service.id);
      const onHandAfterRejectedVoid = await stockQty(tx, warehouse.id, service.id);

      // Penjualan jasa kedua, tanpa retur: void sah dan tetap tidak
      // menulis gerakan stok apa pun.
      const lines2 = [{ productId: service.id, qty: 1 }];
      const quote2 = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        customerId: null,
        lines: lines2,
      });
      const sale2 = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: lines2,
        payments: [{ methodId: method.id, amount: quote2.total, tendered: quote2.total }],
        idempotencyKey: crypto.randomUUID(),
      });
      await voidSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale2.id,
        reason: "Uji otomatis void jasa",
      });
      const [voided] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale2.id)));
      const movementsAfterVoid = await movementCount(tx, service.id);
      const onHandAfterVoid = await stockQty(tx, warehouse.id, service.id);

      return {
        storedSale,
        movementsAfterSale,
        movementsAfterReturn,
        movementsAfterVoid,
        movementsAfterRejectedVoid,
        onHandAfterSale,
        onHandAfterVoid,
        onHandAfterRejectedVoid,
        saleJournal,
        returnJournal,
        storedReturn,
        voidError,
        statusAfterRejectedVoid: afterRejectedVoid.status,
        voidedStatus: voided.status,
        inventoryAccount: map.inventory,
        cogsAccount: map.cogs,
      };
    });

    // The sale itself is recorded normally...
    expect(outcome.storedSale.status).toBe("completed");
    expect(d(outcome.storedSale.total).gt(0)).toBe(true);
    expect(outcome.saleJournal.debit.toFixed(4)).toBe(outcome.saleJournal.credit.toFixed(4));
    // ...but a service product never touches the stock ledger.
    expect(outcome.movementsAfterSale).toBe(0);
    expect(outcome.onHandAfterSale.toFixed(4)).toBe("0.0000");
    // No COGS is relieved against inventory for a non-stock line.
    expect(d(outcome.storedSale.costTotal).toFixed(4)).toBe("0.0000");
    const saleInventory = outcome.saleJournal.totals.get(outcome.inventoryAccount);
    expect((saleInventory?.credit ?? d(0)).toFixed(4)).toBe("0.0000");
    const saleCogs = outcome.saleJournal.totals.get(outcome.cogsAccount);
    expect((saleCogs?.debit ?? d(0)).toFixed(4)).toBe("0.0000");

    // Return: still no movement, and no inventory/COGS reversal legs.
    expect(outcome.movementsAfterReturn).toBe(0);
    expect(d(outcome.storedReturn.costTotal).toFixed(4)).toBe("0.0000");
    const returnInventory = outcome.returnJournal.totals.get(outcome.inventoryAccount);
    expect((returnInventory?.debit ?? d(0)).toFixed(4)).toBe("0.0000");
    const returnCogs = outcome.returnJournal.totals.get(outcome.cogsAccount);
    expect((returnCogs?.credit ?? d(0)).toFixed(4)).toBe("0.0000");

    // Void sesudah retur posted: ditolak (T4R-1), penjualan tetap
    // completed, dan tetap tidak ada gerakan stok.
    expect(outcome.voidError).toMatchObject({ code: "VALIDATION" });
    expect((outcome.voidError as { message: string }).message).toMatch(/retur/i);
    expect(outcome.statusAfterRejectedVoid).toBe("completed");
    expect(outcome.movementsAfterRejectedVoid).toBe(0);
    expect(outcome.onHandAfterRejectedVoid.toFixed(4)).toBe("0.0000");

    // Void penjualan jasa tanpa retur: sah, dan tetap tanpa gerakan;
    // on-hand stays exactly 0 (never negative).
    expect(outcome.voidedStatus).toBe("void");
    expect(outcome.movementsAfterVoid).toBe(0);
    expect(outcome.onHandAfterVoid.toFixed(4)).toBe("0.0000");
  });
});

describe("GD-P1-7 warehouse action validation", () => {
  const fixtureSkus: string[] = [];

  async function fixtureProduct(): Promise<{ productId: string; warehouseId: string; supplierId: string }> {
    return withCompany(ORG_ID, async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const suffix = crypto.randomUUID().slice(0, 8);
      const sku = `TST-P1-VAL-${suffix}`;
      fixtureSkus.push(sku);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku,
          name: "Produk Uji Validasi P1",
          costPrice: "5000",
          salePrice: "9000",
          trackStock: true,
        })
        .returning({ id: products.id });
      return { productId: product.id, warehouseId: warehouse.id, supplierId: supplier.id };
    });
  }

  afterAll(async () => {
    if (fixtureSkus.length === 0) return;
    await withCompany(ORG_ID, async (tx) => {
      for (const sku of fixtureSkus) {
        await tx
          .delete(products)
          .where(and(eq(products.companyId, ORG_ID), eq(products.sku, sku)));
      }
    });
  });

  it("rejects a receipt with a negative qty as VALIDATION naming the qty field, stock unchanged", async () => {
    const fixture = await fixtureProduct();
    const result = await receiveStockAction({
      warehouseId: fixture.warehouseId,
      supplierId: fixture.supplierId,
      date: todayISO(),
      lines: [{ productId: fixture.productId, qty: -5, unitCost: 5000 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toMatch(/Jumlah/);
      expect(result.message).not.toMatch(/Terjadi kesalahan pada server/);
    }
    const qty = await withCompany(ORG_ID, async (tx) => stockQty(tx, fixture.warehouseId, fixture.productId));
    expect(qty.toFixed(4)).toBe("0.0000");
  });

  it("rejects a receipt with a non-numeric qty as VALIDATION, not a generic server error", async () => {
    const fixture = await fixtureProduct();
    const result = await receiveStockAction({
      warehouseId: fixture.warehouseId,
      supplierId: fixture.supplierId,
      date: todayISO(),
      lines: [{ productId: fixture.productId, qty: "abc", unitCost: 5000 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toMatch(/Jumlah/);
      expect(result.message).not.toMatch(/Terjadi kesalahan pada server/);
    }
    const qty = await withCompany(ORG_ID, async (tx) => stockQty(tx, fixture.warehouseId, fixture.productId));
    expect(qty.toFixed(4)).toBe("0.0000");
  });

  it("rejects an invalid receipt date as VALIDATION naming the date field", async () => {
    const fixture = await fixtureProduct();
    const result = await receiveStockAction({
      warehouseId: fixture.warehouseId,
      supplierId: fixture.supplierId,
      date: "2026-13-45",
      lines: [{ productId: fixture.productId, qty: 1, unitCost: 5000 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toMatch(/Tanggal/);
      expect(result.message).not.toMatch(/Terjadi kesalahan pada server/);
    }
  });

  it("rejects a negative product cost price and creates nothing", async () => {
    const sku = `TST-P1-NEG-${crypto.randomUUID().slice(0, 8)}`;
    fixtureSkus.push(sku);
    const result = await saveProductAction({
      name: "Produk Harga Negatif P1",
      sku,
      costPrice: -1000,
      salePrice: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toMatch(/Harga pokok/);
      expect(result.message).not.toMatch(/Terjadi kesalahan pada server/);
    }
    const found = await withCompany(ORG_ID, async (tx) =>
      tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.companyId, ORG_ID), eq(products.sku, sku))),
    );
    expect(found).toHaveLength(0);
  });

  it("still accepts valid string amounts for a product (no contract break)", async () => {
    const sku = `TST-P1-OK-${crypto.randomUUID().slice(0, 8)}`;
    fixtureSkus.push(sku);
    const result = await saveProductAction({
      name: "Produk Valid P1",
      sku,
      costPrice: "15000",
      salePrice: "21000",
      minStock: "2",
    });
    expect(result.ok).toBe(true);
    const found = await withCompany(ORG_ID, async (tx) =>
      tx
        .select({ costPrice: products.costPrice, salePrice: products.salePrice })
        .from(products)
        .where(and(eq(products.companyId, ORG_ID), eq(products.sku, sku))),
    );
    expect(found).toHaveLength(1);
    expect(found[0].costPrice).toBe("15000.0000");
    expect(found[0].salePrice).toBe("21000.0000");
  });
});
