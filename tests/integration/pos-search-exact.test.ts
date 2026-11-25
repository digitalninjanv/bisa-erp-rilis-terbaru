import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { categories, productPackagings, products, warehouses } from "@/db/schema";
import { searchProducts } from "@/server/catalog/products";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * POS scan path — exactCode lookup. The barcode/SKU/packaging-barcode
 * resolver must keep the historical priority (product barcode →
 * packaging barcode → SKU) while using the unique indexes instead of
 * scanning the whole catalog (S4 measured 185 ms p50 at 100k products).
 */
const ORG = "01900000-0000-7000-8000-000000000001";
const rollback = makeRollbackTransaction(ORG);

async function warehouseId(tx: Tx) {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(row).toBeDefined();
  return row.id;
}

async function seededProduct(tx: Tx) {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.companyId, ORG), eq(products.name, "Indomie Goreng")))
    .limit(1);
  expect(product).toBeDefined();
  const [dus] = await tx
    .select()
    .from(productPackagings)
    .where(
      and(
        eq(productPackagings.companyId, ORG),
        eq(productPackagings.productId, product.id),
        eq(productPackagings.name, "Dus"),
      ),
    )
    .limit(1);
  expect(dus).toBeDefined();
  return { product, dus };
}

async function makeProduct(
  tx: Tx,
  input: { sku: string; barcode?: string | null; name: string; categoryId?: string | null },
) {
  const [row] = await tx
    .insert(products)
    .values({
      companyId: ORG,
      sku: input.sku,
      barcode: input.barcode ?? null,
      name: input.name,
      categoryId: input.categoryId ?? null,
      costPrice: "1000",
      salePrice: "2000",
      trackStock: true,
    })
    .returning({ id: products.id });
  return row;
}

describe("katalog POS — pencarian kode persis", () => {
  it("menemukan produk lewat barcode, SKU, dan barcode kemasan", async () => {
    await rollback(async (tx) => {
      const warehouse = await warehouseId(tx);
      const { product, dus } = await seededProduct(tx);

      const byBarcode = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: product.barcode!,
        exactCode: true,
        limit: 1,
      });
      expect(byBarcode.map((row) => row.id)).toEqual([product.id]);
      expect(byBarcode[0].matchedPackagingId).toBeNull();

      const bySku = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: product.sku,
        exactCode: true,
        limit: 1,
      });
      expect(bySku.map((row) => row.id)).toEqual([product.id]);

      const byPackaging = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: dus.barcode!,
        exactCode: true,
        limit: 1,
      });
      expect(byPackaging.map((row) => row.id)).toEqual([product.id]);
      expect(byPackaging[0].matchedPackagingId).toBe(dus.id);
    });
  });

  it("tidak menemukan kemasan nonaktif walau barkodenya diketik", async () => {
    await rollback(async (tx) => {
      const warehouse = await warehouseId(tx);
      const { dus } = await seededProduct(tx);
      await tx
        .update(productPackagings)
        .set({ isActive: false })
        .where(eq(productPackagings.id, dus.id));

      const rows = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: dus.barcode!,
        exactCode: true,
        limit: 1,
      });
      expect(rows).toEqual([]);
    });
  });

  it("mempertahankan prioritas barcode produk di atas SKU produk lain", async () => {
    await rollback(async (tx) => {
      const warehouse = await warehouseId(tx);
      const code = `TST-EXACT-${crypto.randomUUID().slice(0, 8)}`;
      const byBarcode = await makeProduct(tx, {
        sku: `${code}-A`,
        barcode: code,
        name: "Produk Barcode Prioritas",
      });
      const bySku = await makeProduct(tx, {
        sku: code,
        barcode: null,
        name: "Produk SKU Prioritas",
      });

      const rows = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: code,
        exactCode: true,
        limit: 1,
      });
      expect(rows.map((row) => row.id)).toEqual([byBarcode.id]);
      expect(rows.map((row) => row.id)).not.toContain(bySku.id);
    });
  });

  it("mempertahankan prioritas barcode kemasan di atas SKU produk lain", async () => {
    await rollback(async (tx) => {
      const warehouse = await warehouseId(tx);
      const code = `TST-PACK-${crypto.randomUUID().slice(0, 8)}`;
      const packaged = await makeProduct(tx, {
        sku: `${code}-A`,
        name: "Produk Kemasan Prioritas",
      });
      const bySku = await makeProduct(tx, {
        sku: code,
        name: "Produk SKU Prioritas Kemasan",
      });
      const [pack] = await tx
        .insert(productPackagings)
        .values({
          companyId: ORG,
          productId: packaged.id,
          name: "Dus Uji",
          isi: "12",
          barcode: code,
          salePrice: "24000",
          isActive: true,
        })
        .returning({ id: productPackagings.id });

      const rows = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: code,
        exactCode: true,
        limit: 1,
      });
      expect(rows.map((row) => row.id)).toEqual([packaged.id]);
      expect(rows[0].matchedPackagingId).toBe(pack.id);
      expect(rows.map((row) => row.id)).not.toContain(bySku.id);
    });
  });

  it("tetap menghormati filter kategori pada pencarian kode persis", async () => {
    await rollback(async (tx) => {
      const warehouse = await warehouseId(tx);
      const code = `TST-CAT-${crypto.randomUUID().slice(0, 8)}`;
      const product = await makeProduct(tx, {
        sku: `${code}-A`,
        barcode: code,
        name: "Produk Tanpa Kategori",
      });
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.companyId, ORG))
        .limit(1);
      expect(category).toBeDefined();

      const rows = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: code,
        exactCode: true,
        limit: 1,
        categoryId: category.id,
      });
      expect(rows).toEqual([]);
      expect(rows.map((row) => row.id)).not.toContain(product.id);
    });
  });

  it("menemukan produk yang berada di kategori yang diminta", async () => {
    await rollback(async (tx) => {
      const warehouse = await warehouseId(tx);
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.companyId, ORG))
        .limit(1);
      expect(category).toBeDefined();
      const code = `TST-CATIN-${crypto.randomUUID().slice(0, 8)}`;
      const product = await makeProduct(tx, {
        sku: `${code}-A`,
        barcode: code,
        name: "Produk Kategori Diminta",
        categoryId: category.id,
      });

      const rows = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: code,
        exactCode: true,
        limit: 1,
        categoryId: category.id,
      });
      expect(rows.map((row) => row.id)).toEqual([product.id]);
    });
  });

  it("kata kunci kosong pada jalur pindai tidak menjalankan pencarian", async () => {
    await rollback(async (tx) => {
      const warehouse = await warehouseId(tx);
      const rows = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse,
        q: "   ",
        exactCode: true,
      });
      expect(rows).toEqual([]);
    });
  });
});
