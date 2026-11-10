import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, suppliers, warehouses } from "@/db/schema";
import { listMovements, listReceiptHistory } from "@/server/catalog";
import { createReceipt } from "@/server/inventory";
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

async function anySupplier(tx: Tx) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(1);
  expect(supplier).toBeDefined();
  return supplier;
}

async function anyProduct(tx: Tx) {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.companyId, ORG_ID), eq(products.isActive, true)))
    .limit(1);
  expect(product).toBeDefined();
  return product;
}

describe("listMovements pencarian teks (GD-P3-7)", () => {
  it("q menemukan gerakan berdasarkan nomor referensi dokumen", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await anyProduct(tx);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "3", unitCost: "1000" }],
      });

      const found = await listMovements(tx, { companyId: ORG_ID, q: receipt.number });
      expect(found.total).toBeGreaterThanOrEqual(1);
      expect(found.rows.length).toBeGreaterThanOrEqual(1);
      expect(found.rows.every((row) => row.referenceNumber === receipt.number)).toBe(true);

      const nonsense = await listMovements(tx, {
        companyId: ORG_ID,
        q: "NOMOR-DOKUMEN-YANG-TIDAK-MUNGKIN-ADA-12345",
      });
      expect(nonsense.total).toBe(0);
      expect(nonsense.rows).toHaveLength(0);
    });
  });

  it("q menemukan gerakan berdasarkan nama produk; q kosong tidak mengubah hasil", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await anyProduct(tx);

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "2", unitCost: "1000" }],
      });

      // Potongan nama produk yang khas (kata pertama, cukup panjang untuk khas).
      const term = product.name.slice(0, 6);
      const byName = await listMovements(tx, { companyId: ORG_ID, q: term });
      expect(byName.total).toBeGreaterThanOrEqual(1);
      expect(
        byName.rows.every((row) => (row.productName ?? "").toLowerCase().includes(term.toLowerCase())),
      ).toBe(true);

      const unfiltered = await listMovements(tx, { companyId: ORG_ID });
      const emptyQ = await listMovements(tx, { companyId: ORG_ID, q: "" });
      const blankQ = await listMovements(tx, { companyId: ORG_ID, q: "   " });
      expect(emptyQ.total).toBe(unfiltered.total);
      expect(blankQ.total).toBe(unfiltered.total);
      expect(emptyQ.rows.map((row) => row.id)).toEqual(unfiltered.rows.map((row) => row.id));
    });
  });
});

describe("listReceiptHistory pagination (GD-P3-6)", () => {
  it("halaman 2 benar dan total konsisten antar halaman", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await anyProduct(tx);

      const before = await listReceiptHistory(tx, { companyId: ORG_ID, page: 1, pageSize: 2 });

      const created: string[] = [];
      for (let i = 0; i < 3; i++) {
        const receipt = await createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          date: todayISO(),
          lines: [{ productId: product.id, qty: "1", unitCost: "500" }],
        });
        created.push(receipt.number);
      }
      // Urutan tampil: terbaru dulu → penerimaan terakhir dibuat paling atas.
      const newestFirst = [...created].reverse();

      const page1 = await listReceiptHistory(tx, { companyId: ORG_ID, page: 1, pageSize: 2 });
      const page2 = await listReceiptHistory(tx, { companyId: ORG_ID, page: 2, pageSize: 2 });

      expect(page1.total).toBe(before.total + 3);
      expect(page2.total).toBe(page1.total);
      expect(page1.page).toBe(1);
      expect(page2.page).toBe(2);
      expect(page1.pageSize).toBe(2);

      expect(page1.rows).toHaveLength(2);
      expect(page1.rows.map((row) => row.number)).toEqual(newestFirst.slice(0, 2));
      expect(page2.rows.length).toBeGreaterThanOrEqual(1);
      expect(page2.rows[0]?.number).toBe(newestFirst[2]);

      // Tidak ada nomor yang muncul di dua halaman pertama.
      const seen = new Set(page1.rows.map((row) => row.id));
      expect(page2.rows.every((row) => !seen.has(row.id))).toBe(true);

      // Kolom riwayat yang dipakai halaman tetap terisi.
      const first = page1.rows[0];
      expect(first?.supplierName).toBe(supplier.name);
      expect(first?.warehouseName).toBe(warehouse.name);
      expect(Number(first?.itemCount)).toBe(1);
    });
  });
});
