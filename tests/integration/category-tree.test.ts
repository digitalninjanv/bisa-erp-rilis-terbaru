import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, products, warehouses } from "@/db/schema";
import {
  assertCategoryDeactivatable,
  assertCategoryParent,
  listProducts,
} from "@/server/catalog";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// T5-3 (D-17): kategori bertingkat.
// - Rantai induk → anak → cucu dapat dibuat dan divalidasi.
// - Siklus ditolak: kategori tidak boleh menjadi induk bagi dirinya
//   sendiri atau bagi leluhurnya (A tidak boleh berinduk ke C).
// - Induk harus milik perusahaan yang sama.
// - Filter daftar produk pada kategori induk memuat produk di anak &
//   cucu; filter pada cucu hanya memuat produk cucu.
// - Nonaktif kategori yang masih punya anak aktif ditolak; sesudah
//   anaknya dinonaktifkan, penolakan hilang.
// Semua dalam transaksi rollback di perusahaan demo.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const suffix = crypto.randomUUID().slice(0, 8);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function insertCategory(tx: Tx, name: string, parentId: string | null) {
  const [row] = await tx
    .insert(categories)
    .values({ companyId: ORG_ID, name, parentId })
    .returning({ id: categories.id });
  return row;
}

async function insertProduct(tx: Tx, sku: string, categoryId: string | null) {
  const [row] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku,
      name: `Produk Uji Kategori ${sku}`,
      costPrice: "1000",
      salePrice: "1500",
      categoryId,
      trackStock: true,
    })
    .returning({ id: products.id });
  return row;
}

describe("Kategori bertingkat (T5-3 / D-17)", () => {
  it("rantai induk-anak-cucu valid; siklus dan induk lintas perusahaan ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const a = await insertCategory(tx, `UjiKat A ${suffix}`, null);
      // Calon induk yang sah untuk kategori baru: kategori yang sudah ada.
      await assertCategoryParent(tx, ORG_ID, { categoryId: null, parentId: a.id });
      const b = await insertCategory(tx, `UjiKat B ${suffix}`, a.id);
      const c = await insertCategory(tx, `UjiKat C ${suffix}`, b.id);
      await assertCategoryParent(tx, ORG_ID, { categoryId: c.id, parentId: b.id });

      // Diri sendiri sebagai induk.
      await expect(
        assertCategoryParent(tx, ORG_ID, { categoryId: a.id, parentId: a.id }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      // Siklus: A (leluhur) diberi induk C (keturunannya sendiri).
      await expect(
        assertCategoryParent(tx, ORG_ID, { categoryId: a.id, parentId: c.id }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      // Siklus pendek: B diberi induk C.
      await expect(
        assertCategoryParent(tx, ORG_ID, { categoryId: b.id, parentId: c.id }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      // Induk tidak ditemukan / bukan milik perusahaan ini.
      await expect(
        assertCategoryParent(tx, ORG_ID, {
          categoryId: a.id,
          parentId: "01900000-0000-7000-8000-00000000ffff",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      // Tanpa induk selalu sah.
      await assertCategoryParent(tx, ORG_ID, { categoryId: a.id, parentId: null });
    });
  });

  it("filter produk pada kategori induk memuat produk anak dan cucu", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      expect(warehouse).toBeDefined();

      const a = await insertCategory(tx, `UjiKatF A ${suffix}`, null);
      const b = await insertCategory(tx, `UjiKatF B ${suffix}`, a.id);
      const c = await insertCategory(tx, `UjiKatF C ${suffix}`, b.id);
      const pA = await insertProduct(tx, `T5-KAT-A-${suffix}`, a.id);
      const pB = await insertProduct(tx, `T5-KAT-B-${suffix}`, b.id);
      const pC = await insertProduct(tx, `T5-KAT-C-${suffix}`, c.id);
      const pNone = await insertProduct(tx, `T5-KAT-N-${suffix}`, null);

      const fromRoot = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        categoryId: a.id,
        pageSize: 200,
      });
      const rootIds = fromRoot.rows.map((row) => row.id);
      expect(rootIds).toContain(pA.id);
      expect(rootIds).toContain(pB.id);
      expect(rootIds).toContain(pC.id);
      expect(rootIds).not.toContain(pNone.id);
      expect(fromRoot.total).toBe(3);

      const fromLeaf = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        categoryId: c.id,
        pageSize: 200,
      });
      expect(fromLeaf.rows.map((row) => row.id)).toEqual([pC.id]);
      expect(fromLeaf.total).toBe(1);
    });
  });

  it("nonaktif kategori beranak aktif ditolak; lolos sesudah anak dinonaktifkan", async () => {
    await rollbackTransaction(async (tx) => {
      const a = await insertCategory(tx, `UjiKatN A ${suffix}`, null);
      const b = await insertCategory(tx, `UjiKatN B ${suffix}`, a.id);
      const leaf = await insertCategory(tx, `UjiKatN L ${suffix}`, null);

      await expect(assertCategoryDeactivatable(tx, ORG_ID, a.id)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      // Kategori daun tanpa anak boleh dinonaktifkan.
      await assertCategoryDeactivatable(tx, ORG_ID, leaf.id);
      await assertCategoryDeactivatable(tx, ORG_ID, b.id);

      await tx
        .update(categories)
        .set({ isActive: false })
        .where(and(eq(categories.companyId, ORG_ID), eq(categories.id, b.id)));
      // Anak sudah nonaktif → induk kini boleh dinonaktifkan.
      await assertCategoryDeactivatable(tx, ORG_ID, a.id);
    });
  });
});
