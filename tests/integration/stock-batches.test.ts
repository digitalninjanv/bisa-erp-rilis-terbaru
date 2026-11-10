import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  paymentMethods,
  products,
  stockBatches,
  stockMovements,
  stockOnHand,
  stockReceiptLines,
  warehouses,
} from "@/db/schema";
import { listBatches, listExpiringBatches } from "@/server/batches";
import { createReceipt, createTransfer } from "@/server/inventory";
import { createSale, createSaleReturn, quoteCart } from "@/server/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function otherWarehouse(tx: Tx, excludeId: string) {
  const rows = await tx
    .select()
    .from(warehouses)
    .where(eq(warehouses.companyId, ORG_ID));
  const found = rows.find((row) => row.id !== excludeId && row.isActive);
  expect(found).toBeDefined();
  return found!;
}

async function batchProduct(
  tx: Tx,
  input: { name: string; costPrice?: string; salePrice?: string; trackBatch?: boolean },
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-BT-${suffix}`,
      name: input.name,
      costPrice: input.costPrice ?? "1000",
      salePrice: input.salePrice ?? "2000",
      trackBatch: input.trackBatch ?? true,
    })
    .returning({ id: products.id });
  return product;
}

async function receiveBatch(
  tx: Tx,
  warehouseId: string,
  productId: string,
  batchNumber: string,
  expiryDate: string,
  qty: number,
) {
  return createReceipt(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    source: "opening",
    date: todayISO(),
    lines: [{ productId, qty, unitCost: 1000, batchNumber, expiryDate }],
  });
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

async function batchQty(
  tx: Tx,
  warehouseId: string,
  productId: string,
  batchNumber: string | null,
) {
  const rows = await tx
    .select()
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.companyId, ORG_ID),
        eq(stockBatches.warehouseId, warehouseId),
        eq(stockBatches.productId, productId),
      ),
    );
  const row = rows.find((candidate) => candidate.batchNumber === batchNumber);
  return row ? d(row.qty) : null;
}

/** D-7 invariant: for batch-tracked products Σ batch qty === stock_on_hand. */
async function expectBatchInvariant(tx: Tx, warehouseId: string, productId: string) {
  const rows = await tx
    .select({ qty: stockBatches.qty })
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.companyId, ORG_ID),
        eq(stockBatches.warehouseId, warehouseId),
        eq(stockBatches.productId, productId),
      ),
    );
  const sum = rows.reduce((acc, row) => acc.plus(d(row.qty)), d(0));
  const onHand = await stockQty(tx, warehouseId, productId);
  expect(sum.toFixed(4)).toBe(onHand.toFixed(4));
}

async function cashMethod(tx: Tx) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function sell(
  tx: Tx,
  warehouseId: string,
  productId: string,
  qty: number,
  unitPrice = 2000,
) {
  const method = await cashMethod(tx);
  const total = qty * unitPrice;
  return createSale(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    date: todayISO(),
    lines: [{ productId, qty }],
    payments: [{ methodId: method.id, amount: total, tendered: total }],
    idempotencyKey: crypto.randomUUID(),
  });
}

describe("Batch & kedaluwarsa + FEFO (G8 / D-7)", () => {
  it("(a) penerimaan dua batch: baris batch tersimpan, invariant Σ batch = stok", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Susu Batch Uji" });

      // Later expiry received FIRST: FEFO order must follow expiry, not
      // insertion order.
      const receipt = await receiveBatch(tx, warehouse.id, product.id, "LOT-LAMBAT", "2027-09-01", 10);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-CEPAT", "2027-03-01", 10);

      const [line] = await tx
        .select()
        .from(stockReceiptLines)
        .where(eq(stockReceiptLines.receiptId, receipt.id));
      expect(line.batchNumber).toBe("LOT-LAMBAT");
      expect(line.expiryDate).toBe("2027-09-01");

      const batches = await listBatches(tx, ORG_ID, product.id, warehouse.id);
      expect(batches).toHaveLength(2);
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-CEPAT"))!.toFixed(4)).toBe("10.0000");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-LAMBAT"))!.toFixed(4)).toBe("10.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("20.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);
    });
  });

  it("(a2) penerimaan produk batch tanpa nomor batch ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Batch Wajib Uji" });

      let error: unknown;
      try {
        await createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "opening",
          date: todayISO(),
          lines: [{ productId: product.id, qty: 5, unitCost: 1000 }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as Error).message).toMatch(/batch/i);
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("0.0000");
    });
  });

  it("(b) penjualan mengambil FEFO: batch kedaluwarsa paling awal habis dulu, gerakan per irisan batch", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Yogurt FEFO Uji" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-LAMBAT", "2027-09-01", 10);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-CEPAT", "2027-03-01", 10);

      const sale = await sell(tx, warehouse.id, product.id, 12);

      expect((await batchQty(tx, warehouse.id, product.id, "LOT-CEPAT"))!.toFixed(4)).toBe("0.0000");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-LAMBAT"))!.toFixed(4)).toBe("8.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("8.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);

      const batches = await listBatches(tx, ORG_ID, product.id, warehouse.id);
      const cepat = batches.find((row) => row.batchNumber === "LOT-CEPAT")!;
      const lambat = batches.find((row) => row.batchNumber === "LOT-LAMBAT")!;
      const movements = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceType, "sale"),
            eq(stockMovements.referenceId, sale.id),
          ),
        );
      expect(movements).toHaveLength(2);
      const byBatch = new Map(movements.map((row) => [row.batchId, d(row.qty)]));
      expect(byBatch.get(cepat.id)!.toFixed(4)).toBe("-10.0000");
      expect(byBatch.get(lambat.id)!.toFixed(4)).toBe("-2.0000");
    });
  });

  it("(c) batch kedaluwarsa tidak terjual: semua kedaluwarsa → checkout ditolak menyebut kedaluwarsa", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Keju Lama Uji" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-MATI", "2026-01-10", 5);

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, qty: 1 }],
      });
      expect(quote.lines[0].stock).toBe(0);

      let error: unknown;
      try {
        await sell(tx, warehouse.id, product.id, 1);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "INSUFFICIENT_STOCK" });
      expect((error as Error).message).toMatch(/kedaluwarsa/i);
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("5.0000");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-MATI"))!.toFixed(4)).toBe("5.0000");
    });
  });

  it("(c2) sebagian kedaluwarsa: hanya stok segar yang terjual", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Roti Campur Uji" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-MATI", "2026-01-10", 5);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-SEGAR", "2027-12-01", 5);

      await sell(tx, warehouse.id, product.id, 5);
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-SEGAR"))!.toFixed(4)).toBe("0.0000");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-MATI"))!.toFixed(4)).toBe("5.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("5.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);

      let error: unknown;
      try {
        await sell(tx, warehouse.id, product.id, 1);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "INSUFFICIENT_STOCK" });
      expect((error as Error).message).toMatch(/kedaluwarsa/i);
    });
  });

  it("(d) retur penjualan mengembalikan qty ke batch asal penjualan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Sereal Retur Uji" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-LAMBAT", "2027-09-01", 10);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-CEPAT", "2027-03-01", 10);
      const sale = await sell(tx, warehouse.id, product.id, 12);
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-CEPAT"))!.toFixed(4)).toBe("0.0000");

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Kemasan rusak",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 4 }],
      });

      // The first 4 units sold came out of LOT-CEPAT, so the return lands
      // back there — not in the batch that still holds stock.
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-CEPAT"))!.toFixed(4)).toBe("4.0000");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-LAMBAT"))!.toFixed(4)).toBe("8.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("12.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);

      const batches = await listBatches(tx, ORG_ID, product.id, warehouse.id);
      const cepat = batches.find((row) => row.batchNumber === "LOT-CEPAT")!;
      const movements = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceType, "sale_return"),
            eq(stockMovements.referenceId, ret.id),
          ),
        );
      expect(movements).toHaveLength(1);
      expect(movements[0].batchId).toBe(cepat.id);
      expect(d(movements[0].qty).toFixed(4)).toBe("4.0000");
    });
  });

  it("(e) transfer memindahkan batch yang sama antargudang (FEFO dari gudang asal)", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const target = await otherWarehouse(tx, warehouse.id);
      const product = await batchProduct(tx, { name: "Madu Transfer Uji" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-LAMBAT", "2027-09-01", 10);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-CEPAT", "2027-03-01", 10);

      await createTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        fromWarehouseId: warehouse.id,
        toWarehouseId: target.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 6 }],
      });

      expect((await batchQty(tx, warehouse.id, product.id, "LOT-CEPAT"))!.toFixed(4)).toBe("4.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("14.0000");
      const dest = await batchQty(tx, target.id, product.id, "LOT-CEPAT");
      expect(dest).not.toBeNull();
      expect(dest!.toFixed(4)).toBe("6.0000");
      const destRow = (await listBatches(tx, ORG_ID, product.id, target.id)).find(
        (row) => row.batchNumber === "LOT-CEPAT",
      );
      expect(destRow?.expiryDate).toBe("2027-03-01");
      expect((await stockQty(tx, target.id, product.id)).toFixed(4)).toBe("6.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);
      await expectBatchInvariant(tx, target.id, product.id);
    });
  });

  it("(f) produk lama berstok yang baru dilacak batch: penjualan tetap bisa lewat batch sisa (Tanpa batch)", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Kopi Lama Uji", trackBatch: false });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        source: "opening",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 1000 }],
      });
      expect(
        await tx
          .select()
          .from(stockBatches)
          .where(eq(stockBatches.productId, product.id)),
      ).toHaveLength(0);

      // The flag is switched on only now; the pre-existing stock must be
      // absorbed by the lazy batch-null remainder, not lost or blocked.
      await tx
        .update(products)
        .set({ trackBatch: true })
        .where(eq(products.id, product.id));

      const sale = await sell(tx, warehouse.id, product.id, 3);
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("7.0000");
      const remainder = await batchQty(tx, warehouse.id, product.id, null);
      expect(remainder).not.toBeNull();
      expect(remainder!.toFixed(4)).toBe("7.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);

      const batches = await listBatches(tx, ORG_ID, product.id, warehouse.id);
      const nullRow = batches.find((row) => row.batchNumber === null)!;
      const movements = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceType, "sale"),
            eq(stockMovements.referenceId, sale.id),
          ),
        );
      expect(movements).toHaveLength(1);
      expect(movements[0].batchId).toBe(nullRow.id);
    });
  });

  it("(g) listExpiringBatches memuat yang kedaluwarsa & ≤30 hari, bukan yang jauh", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Keju Pantau Uji" });
      const today = todayISO();
      await receiveBatch(tx, warehouse.id, product.id, "LOT-MATI", "2026-01-10", 5);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-DEKAT", addDays(today, 10), 5);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-JAUH", addDays(today, 90), 5);

      const rows = await listExpiringBatches(tx, ORG_ID, 30);
      const mine = rows.filter((row) => row.productId === product.id);
      const numbers = mine.map((row) => row.batchNumber).sort();
      expect(numbers).toEqual(["LOT-DEKAT", "LOT-MATI"]);
      const mati = mine.find((row) => row.batchNumber === "LOT-MATI")!;
      expect(mati.productName).toBe("Keju Pantau Uji");
      expect(mati.warehouseName).toBe(warehouse.name);
    });
  });
});
