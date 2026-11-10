import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { products, suppliers, warehouses } from "@/db/schema";
import {
  listCustomerGroups,
  listGroupProductPrices,
  listProducts,
  stockByProduct,
} from "@/server/catalog";
import { createReceipt } from "@/server/inventory";
import { todayISO } from "@/lib/format";
import { d } from "@/lib/money";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * A-26 Q5 (K-04/P-06) — paritas keluaran catalog sesudah dipecah per
 * agregat + paginasi terpusat. Test ini mengunci perilaku yang dulu
 * hanya tersirat di berkas raksasa catalog.ts: mekanik halaman
 * listProducts, peta stok massal stockByProduct, harga kelompok, dan
 * konsistensi valuasi antar dua jalur baca (daftar produk vs peta
 * stok) pada data yang sama.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

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

async function insertProduct(tx: Tx, sku: string, name: string, salePrice = "10000") {
  const [row] = await tx
    .insert(products)
    .values({ companyId: ORG_ID, sku, name, salePrice, costPrice: "8000" })
    .returning();
  expect(row).toBeDefined();
  return row;
}

describe("paritas catalog Q5", () => {
  it("listProducts: mekanik halaman stabil (total, totalPages, halaman tak tumpang tindih)", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      for (const [sku, name] of [
        ["Q5PAR-01", "Q5 Paritas Satu"],
        ["Q5PAR-02", "Q5 Paritas Dua"],
        ["Q5PAR-03", "Q5 Paritas Tiga"],
      ] as const) {
        await insertProduct(tx, sku, name);
      }

      const page1 = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        q: "Q5PAR",
        page: 1,
        pageSize: 2,
      });
      const page2 = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        q: "Q5PAR",
        page: 2,
        pageSize: 2,
      });

      expect(page1.total).toBe(3);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);
      expect(page1.totalPages).toBe(2);
      expect(page1.rows).toHaveLength(2);
      expect(page2.rows).toHaveLength(1);
      const skus = [...page1.rows, ...page2.rows].map((row) => row.sku).sort();
      expect(skus).toEqual(["Q5PAR-01", "Q5PAR-02", "Q5PAR-03"]);

      // Jepit parameter: page 0 → 1, pageSize raksasa → 200.
      const clamped = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        q: "Q5PAR",
        page: 0,
        pageSize: 999,
      });
      expect(clamped.page).toBe(1);
      expect(clamped.pageSize).toBe(200);
      expect(clamped.rows).toHaveLength(3);
    });
  });

  it("valuasi konsisten antar jalur: Σ stok×harga pokok listProducts = Σ stockByProduct×harga pokok", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const all = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        page: 1,
        pageSize: 200,
        activeOnly: false,
      });
      expect(all.total).toBeGreaterThanOrEqual(65);

      const stockMap = await stockByProduct(
        tx,
        ORG_ID,
        warehouse.id,
        all.rows.map((row) => row.id),
      );
      const viaList = all.rows.reduce(
        (acc, row) => acc.plus(d(row.stock).mul(d(row.costPrice))),
        d(0),
      );
      const viaMap = all.rows.reduce(
        (acc, row) => acc.plus(d(stockMap.get(row.id) ?? 0).mul(d(row.costPrice))),
        d(0),
      );
      expect(viaMap.toString()).toBe(viaList.toString());
      // Stok per baris daftar dan peta massal harus sama produk per produk.
      for (const row of all.rows) {
        expect(stockMap.get(row.id) ?? 0).toBe(row.stock);
      }
    });
  });

  it("stockByProduct: kosong untuk daftar id kosong; qty penerimaan terbaca persis", async () => {
    await rollbackTransaction(async (tx) => {
      expect((await stockByProduct(tx, ORG_ID, "x", [])).size).toBe(0);

      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await insertProduct(tx, "Q5PAR-STOK", "Q5 Paritas Stok");
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "3", unitCost: "1000" }],
      });
      const map = await stockByProduct(tx, ORG_ID, warehouse.id, [product.id]);
      expect(map.get(product.id)).toBe(3);
    });
  });

  it("listGroupProductPrices: produk tanpa aturan tampil normal dengan harga jual apa adanya", async () => {
    await rollbackTransaction(async (tx) => {
      const groups = await listCustomerGroups(tx, ORG_ID);
      const group = groups[0];
      expect(group).toBeDefined();
      await insertProduct(tx, "Q5PAR-GRP", "Q5 Paritas Grup", "10000");

      const result = await listGroupProductPrices(tx, {
        companyId: ORG_ID,
        groupId: group.id,
        roundingStep: group.roundingStep,
        roundingDirection: group.roundingDirection as "down" | "up" | "nearest",
        q: "Q5PAR-GRP",
        page: 1,
        pageSize: 25,
      });
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.rows[0]?.ruleType).toBe("normal");
      expect(result.rows[0]?.groupPrice).toBe(10000);
    });
  });
});
