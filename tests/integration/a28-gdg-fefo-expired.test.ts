import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  paymentMethods,
  products,
  stockBatches,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { listExpiringBatches } from "@/server/batches";
import { createAdjustment, createOpname, createReceipt } from "@/server/inventory";
import { applyDocumentMovement } from "@/server/inventory/movements";
import { createSale } from "@/server/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * A-28 Tahap 2 (H-GDG-01/02) — batch kedaluwarsa TIDAK teralokasi ke
 * penjualan/keluar produktif; jalur koreksi (dokumen `expired`,
 * opname) tetap bisa mengeluarkannya.
 *
 * Semantik yang dikunci di sini:
 * - Kedaluwarsa dinilai pada TANGGAL DOKUMEN transaksi: expiry <
 *   tanggal dokumen = kedaluwarsa; expiry == tanggal dokumen masih
 *   layak jual (batas inklusif).
 * - Penjualan yang hanya menyisakan batch kedaluwarsa ditolak
 *   INSUFFICIENT_STOCK dengan pesan menyebut kedaluwarsa — perilaku
 *   kekurangan stok biasa, bukan pengambilan diam-diam.
 * - `applyDocumentMovement` membedakan jalur lewat `purpose`:
 *   "sale" melewati batch kedaluwarsa; bawaan "correction"
 *   memasukkannya (penyesuaian/opname adalah jalan keluarnya).
 */

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

async function batchProduct(tx: Tx, input: { name: string }) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-A28-${suffix}`,
      name: input.name,
      costPrice: "1000",
      salePrice: "2000",
      trackBatch: true,
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
  unitCost = 1000,
) {
  return createReceipt(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    source: "opening",
    date: todayISO(),
    lines: [{ productId, qty, unitCost, batchNumber, expiryDate }],
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

async function batchQty(tx: Tx, warehouseId: string, productId: string, batchNumber: string) {
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

/** D-7 invariant: Σ batch qty === stock_on_hand untuk produk ber-batch. */
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
  expect(sum.toFixed(4)).toBe((await stockQty(tx, warehouseId, productId)).toFixed(4));
}

async function sell(tx: Tx, warehouseId: string, productId: string, qty: number, date: string) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
    .limit(1);
  expect(method).toBeDefined();
  const total = qty * 2000;
  return createSale(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    date,
    lines: [{ productId, qty }],
    payments: [{ methodId: method.id, amount: total, tendered: total }],
    idempotencyKey: crypto.randomUUID(),
  });
}

describe("A-28 Tahap 2 — FEFO melewati batch kedaluwarsa (H-GDG-01)", () => {
  it("(1) penjualan mengambil batch segar & melewati batch kedaluwarsa walau expiry-nya paling awal", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Susu A28-1" });
      // Batch kedaluwarsa diterima lebih dulu & expiry-nya paling awal:
      // FEFO lama akan menghabiskannya pertama.
      await receiveBatch(tx, warehouse.id, product.id, "LOT-MATI", addDays(today, -1), 5);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-SEGAR", addDays(today, 90), 5);

      const sale = await sell(tx, warehouse.id, product.id, 5, today);

      expect((await batchQty(tx, warehouse.id, product.id, "LOT-SEGAR"))!.toFixed(4)).toBe("0.0000");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-MATI"))!.toFixed(4)).toBe("5.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("5.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);

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
      expect(movements.length).toBeGreaterThan(0);
      const batches = await tx
        .select()
        .from(stockBatches)
        .where(and(eq(stockBatches.companyId, ORG_ID), eq(stockBatches.productId, product.id)));
      const mati = batches.find((row) => row.batchNumber === "LOT-MATI")!;
      // Tidak satu pun gerakan penjualan menyentuh batch kedaluwarsa.
      expect(movements.every((row) => row.batchId !== mati.id)).toBe(true);
    });
  });

  it("(2) hanya batch kedaluwarsa tersedia → penjualan ditolak sebagai stok tidak cukup, stok utuh", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Keju A28-2" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-MATI", addDays(today, -1), 5);

      let error: unknown;
      try {
        await sell(tx, warehouse.id, product.id, 1, today);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "INSUFFICIENT_STOCK" });
      expect((error as Error).message).toMatch(/kedaluwarsa/i);
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-MATI"))!.toFixed(4)).toBe("5.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("5.0000");
    });
  });

  it("(3) batas inklusif: batch berakhir TEPAT pada tanggal penjualan masih layak jual", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Roti A28-3" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-PAS", today, 4);

      await sell(tx, warehouse.id, product.id, 4, today);

      expect((await batchQty(tx, warehouse.id, product.id, "LOT-PAS"))!.toFixed(4)).toBe("0.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("0.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);
    });
  });

  it("(4) tanggal acuan = tanggal dokumen: penjualan bertanggal sebelum expiry tetap mengambil batch itu", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Yogurt A28-4" });
      // Kemarin batch ini sudah kedaluwarsa menurut hari ini, tetapi
      // dokumen penjualan bertanggal 4 hari lalu — saat batch masih
      // layak. Alokasi harus menilai pada tanggal dokumen.
      await receiveBatch(tx, warehouse.id, product.id, "LOT-LALU", addDays(today, -1), 5);

      await sell(tx, warehouse.id, product.id, 3, addDays(today, -4));

      expect((await batchQty(tx, warehouse.id, product.id, "LOT-LALU"))!.toFixed(4)).toBe("2.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("2.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);
    });
  });

  it("(5) applyDocumentMovement purpose 'sale': melewati kedaluwarsa; hanya kedaluwarsa → ditolak; tanggal dokumen menentukan", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Sereal A28-5" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-MATI", addDays(today, -1), 5);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-SEGAR", addDays(today, 30), 5);

      const slices = await applyDocumentMovement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        productId: product.id,
        delta: d(-5),
        unitCost: 1000,
        movementType: "sale",
        date: today,
        purpose: "sale",
      });
      expect(slices).toHaveLength(1);
      expect(slices[0].batchNumber).toBe("LOT-SEGAR");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-MATI"))!.toFixed(4)).toBe("5.0000");

      // Sisa stok fisik hanya yang kedaluwarsa → penolakan bernama.
      let error: unknown;
      try {
        await applyDocumentMovement(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          productId: product.id,
          delta: d(-1),
          unitCost: 1000,
          movementType: "sale",
          date: today,
          purpose: "sale",
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "INSUFFICIENT_STOCK" });
      expect((error as Error).message).toMatch(/kedaluwarsa/i);

      // Tetapi dokumen bertanggal sebelum expiry batch itu tetap sah.
      const backdated = await applyDocumentMovement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        productId: product.id,
        delta: d(-2),
        unitCost: 1000,
        movementType: "sale",
        date: addDays(today, -4),
        purpose: "sale",
      });
      expect(backdated).toHaveLength(1);
      expect(backdated[0].batchNumber).toBe("LOT-MATI");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-MATI"))!.toFixed(4)).toBe("3.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);
    });
  });

  it("(6) jalur koreksi tetap bisa mengeluarkan batch kedaluwarsa: bawaan applyDocumentMovement, dokumen expired, opname susut", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);

      // (a) Bawaan (tanpa purpose) = correction: mengambil yang
      // kedaluwarsa lebih dulu, persis perilaku penyesuaian/opname.
      const p1 = await batchProduct(tx, { name: "Susu A28-6a" });
      await receiveBatch(tx, warehouse.id, p1.id, "LOT-MATI", addDays(today, -1), 5);
      await receiveBatch(tx, warehouse.id, p1.id, "LOT-SEGAR", addDays(today, 30), 5);
      const slices = await applyDocumentMovement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        productId: p1.id,
        delta: d(-3),
        unitCost: 1000,
        movementType: "expired",
        date: today,
      });
      expect(slices).toHaveLength(1);
      expect(slices[0].batchNumber).toBe("LOT-MATI");
      expect((await batchQty(tx, warehouse.id, p1.id, "LOT-MATI"))!.toFixed(4)).toBe("2.0000");

      // (b) Dokumen penyesuaian tipe expired ujung-ke-ujung: yang
      // kedaluwarsa habis, yang segar tidak tersentuh.
      const p2 = await batchProduct(tx, { name: "Keju A28-6b" });
      await receiveBatch(tx, warehouse.id, p2.id, "LOT-MATI", addDays(today, -1), 5);
      await receiveBatch(tx, warehouse.id, p2.id, "LOT-SEGAR", addDays(today, 30), 5);
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: today,
        type: "expired",
        reason: "Kedaluwarsa — dimusnahkan",
        lines: [{ productId: p2.id, qty: 5 }],
      });
      expect(doc.status).toBe("posted");
      expect((await batchQty(tx, warehouse.id, p2.id, "LOT-MATI"))!.toFixed(4)).toBe("0.0000");
      expect((await batchQty(tx, warehouse.id, p2.id, "LOT-SEGAR"))!.toFixed(4)).toBe("5.0000");
      await expectBatchInvariant(tx, warehouse.id, p2.id);

      // (c) Opname susut: hitungan fisik lebih kecil — selisih keluar
      // FEFO koreksi, batch kedaluwarsa ikut terambil.
      const p3 = await batchProduct(tx, { name: "Roti A28-6c" });
      await receiveBatch(tx, warehouse.id, p3.id, "LOT-MATI", addDays(today, -1), 5);
      await receiveBatch(tx, warehouse.id, p3.id, "LOT-SEGAR", addDays(today, 30), 5);
      await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: today,
        lines: [{ productId: p3.id, countedQty: 5 }],
      });
      expect((await batchQty(tx, warehouse.id, p3.id, "LOT-MATI"))!.toFixed(4)).toBe("0.0000");
      expect((await batchQty(tx, warehouse.id, p3.id, "LOT-SEGAR"))!.toFixed(4)).toBe("5.0000");
      await expectBatchInvariant(tx, warehouse.id, p3.id);
    });
  });

  it("(7) regresi: FEFO antar batch segar tidak berubah & AVCO tidak terpengaruh alokasi batch", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Kopi A28-7" });
      // Dua batch segar, biaya berbeda → AVCO tercampur 1.500.
      await receiveBatch(tx, warehouse.id, product.id, "LOT-A", addDays(today, 30), 10, 1000);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-B", addDays(today, 60), 10, 2000);
      const [before] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, product.id));
      expect(d(before.costPrice).toFixed(4)).toBe("1500.0000");

      await sell(tx, warehouse.id, product.id, 12, today);

      // FEFO segar: LOT-A (expiry lebih awal) habis dulu, LOT-B sisa 8.
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-A"))!.toFixed(4)).toBe("0.0000");
      expect((await batchQty(tx, warehouse.id, product.id, "LOT-B"))!.toFixed(4)).toBe("8.0000");
      // Batch tidak pernah mengubah biaya: AVCO tetap 1.500 dan nilai
      // sisa = 8 × 1.500.
      const [after] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, product.id));
      expect(d(after.costPrice).toFixed(4)).toBe("1500.0000");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("8.0000");
      await expectBatchInvariant(tx, warehouse.id, product.id);
    });
  });

  it("(8) jendela peringatan kedaluwarsa mengikuti ambang hari yang diberikan (H-GDG-02)", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const warehouse = await defaultWarehouse(tx);
      const product = await batchProduct(tx, { name: "Teh A28-8" });
      await receiveBatch(tx, warehouse.id, product.id, "LOT-MATI", addDays(today, -1), 2);
      await receiveBatch(tx, warehouse.id, product.id, "LOT-45", addDays(today, 45), 2);

      const within30 = await listExpiringBatches(tx, ORG_ID, 30);
      const mine30 = within30.filter((row) => row.productId === product.id);
      expect(mine30.map((row) => row.batchNumber)).toEqual(["LOT-MATI"]);

      const within60 = await listExpiringBatches(tx, ORG_ID, 60);
      const mine60 = within60.filter((row) => row.productId === product.id);
      expect(mine60.map((row) => row.batchNumber).sort()).toEqual(["LOT-45", "LOT-MATI"]);
    });
  });
});
