/**
 * Agregat baca HARGA KELOMPOK (A-26 Q5, K-04) — pecahan
 * src/server/catalog.ts: daftar produk dengan aturan harga satu
 * kelompok pelanggan. Badan kueri dipindah apa adanya; mekanik
 * paginasi kini lewat lib/pagination (P-06).
 */
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, customerGroupPrices, products } from "@/db/schema";
import { d, roundTo, type RoundDirection } from "@/lib/money";
import {
  normalizePageParams,
  pageOffset,
  pageResult,
  type PageResult,
} from "@/lib/pagination";

export type GroupPriceRow = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  categoryName: string | null;
  salePrice: string;
  ruleType: "normal" | "percent" | "fixed";
  ruleValue: string;
  groupPrice: number;
};

/**
 * Product list with the price rule for one customer group. Missing rules are
 * shown as "normal"; the computed group price applies the group's rounding.
 */
export async function listGroupProductPrices(
  tx: Tx,
  input: {
    companyId: string;
    groupId: string;
    roundingStep: number;
    roundingDirection: RoundDirection;
    q?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<PageResult<GroupPriceRow>> {
  const { page, pageSize } = normalizePageParams(input, 25);
  const q = input.q?.trim();

  const conditions = [eq(products.companyId, input.companyId), eq(products.isActive, true)];
  if (q) {
    conditions.push(
      or(
        ilike(products.name, `%${q}%`),
        ilike(products.sku, `%${q}%`),
        ilike(products.barcode, `%${q}%`),
      )!,
    );
  }

  const [countRow] = await tx
    .select({ value: count() })
    .from(products)
    .where(and(...conditions));

  const rows = await tx
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      barcode: products.barcode,
      categoryName: categories.name,
      salePrice: products.salePrice,
      ruleType: customerGroupPrices.ruleType,
      ruleValue: customerGroupPrices.value,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(
      customerGroupPrices,
      and(
        eq(customerGroupPrices.companyId, input.companyId),
        eq(customerGroupPrices.groupId, input.groupId),
        eq(customerGroupPrices.productId, products.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(products.name))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));

  return pageResult(
    rows.map((row) => {
      const normal = d(row.salePrice);
      let groupPrice = normal;
      if (row.ruleType) {
        const raw =
          row.ruleType === "percent"
            ? normal.mul(d(100).minus(d(row.ruleValue))).div(100)
            : d(row.ruleValue);
        const bounded = d(Math.min(Math.max(raw.toNumber(), 0), normal.toNumber()));
        groupPrice = d(roundTo(bounded, input.roundingStep, input.roundingDirection));
      }
      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        barcode: row.barcode,
        categoryName: row.categoryName,
        salePrice: row.salePrice,
        ruleType: (row.ruleType as GroupPriceRow["ruleType"] | null) ?? "normal",
        ruleValue: row.ruleValue ?? "0",
        groupPrice: groupPrice.toNumber(),
      };
    }),
    countRow?.value ?? 0,
    page,
    pageSize,
  );
}
