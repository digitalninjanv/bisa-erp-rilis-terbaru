import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { categories, products, warehouses } from "@/db/schema";
import { searchProducts } from "@/server/catalog";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG = "01900000-0000-7000-8000-000000000001";
const rollback = makeRollbackTransaction(ORG);

describe("katalog POS — filter kategori", () => {
  it("hanya mengembalikan produk kategori aktif dan menghormati gudang", async () => {
    const result = await rollback(async (tx) => {
      const [category] = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(
          and(
            eq(categories.companyId, ORG),
            eq(categories.isActive, true),
            sql`exists (select 1 from products p where p.company_id = ${ORG} and p.category_id = ${categories.id} and p.is_active = true)`,
          ),
        )
        .limit(1);
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      const rows = await searchProducts(tx, {
        companyId: ORG,
        warehouseId: warehouse.id,
        q: "",
        limit: 100,
        categoryId: category.id,
      });
      const outside = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(products)
        .where(
          and(
            eq(products.companyId, ORG),
            eq(products.isActive, true),
            sql`${products.categoryId} is distinct from ${category.id}`,
          ),
        );
      return { rows, category, outside: outside[0]?.value ?? 0 };
    });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.categoryId === result.category.id)).toBe(true);
    expect(result.outside).toBeGreaterThan(0);
  });
});
