import { sql, type Column, type SQL } from "drizzle-orm";
import { d, type MoneyInput } from "@/lib/money";

/**
 * Canonical low-stock definition (keputusan Pemimpin D-4): `minStock` stays a
 * single global threshold per product, and every screen judges "menipis"
 * (low) from the stock figure that screen itself displays — the warehouse
 * dashboard from the all-warehouse total, the product list from the stock of
 * the warehouse it lists, the valuation page from its selected warehouse.
 * One rule everywhere: displayed qty <= minStock.
 */
export function isLowStock(qty: MoneyInput, minStock: MoneyInput): boolean {
  return d(qty).lte(d(minStock));
}

/**
 * SQL twin of {@link isLowStock} for queries that must filter in the
 * database (paginated lists, counts): `qty <= minStock` with the qty given
 * as a SQL expression and minStock as the products.min_stock column.
 */
export function lowStockCondition(qty: SQL<string>, minStock: Column): SQL {
  return sql`${qty} <= ${minStock}`;
}
