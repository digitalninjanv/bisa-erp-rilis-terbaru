// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  asc,
  count,
  eq,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { stockTransitSql } from "@/server/inventory";
import { isLowStock } from "@/lib/stock";
import {
  d,
  toDb,
} from "@/lib/money";
import {
  categories,
  products,
  stockMovements,
  stockOnHand,
  units,
  warehouses,
} from "@/db/schema";

export async function getInventoryValuation(
  tx: Tx,
  companyId: string,
  warehouseId?: string,
  opts?: { page?: number; pageSize?: number; skipLowStock?: boolean },
) {
  // GD-P2-6: server-side pagination + Decimal everywhere. All money/qty
  // fields are canonical Decimal strings; totals are SQL aggregates over
  // the WHOLE filtered set, never sums of the rendered page. Callers that
  // need every row (CSV export, warehouse dashboard) omit `opts`.
  const where = and(
    eq(products.companyId, companyId),
    ...(warehouseId ? [eq(stockOnHand.warehouseId, warehouseId)] : []),
  );
  const ownedQty = sql<string>`coalesce(sum(${stockOnHand.qty}), 0) + ${warehouseId ? sql`0` : stockTransitSql(companyId, products.id, "qty")}`;
  const baseQuery = () =>
    tx
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        category: categories.name,
        unit: units.code,
        qty: ownedQty.as("owned_qty"),
        cost: products.costPrice,
        salePrice: products.salePrice,
        minStock: products.minStock,
      })
      .from(products)
      .leftJoin(stockOnHand, eq(stockOnHand.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(units, eq(products.unitId, units.id))
      .where(where)
      .groupBy(products.id, products.sku, products.name, categories.name, units.code, products.costPrice, products.salePrice, products.minStock);

  const grouped = baseQuery().as("valuation_totals");
  const [totalsRow] = await tx.select({
    productCount: sql<string>`count(*)`,
    qty: sql<string>`coalesce(sum(${grouped.qty}), 0)`,
    value: sql<string>`coalesce(sum(${grouped.qty} * ${grouped.cost}), 0)`,
    potential: sql<string>`coalesce(sum(${grouped.qty} * ${grouped.salePrice}), 0)`,
  }).from(grouped);

  const total = Number(totalsRow?.productCount ?? 0);
  const paginated = opts?.page !== undefined || opts?.pageSize !== undefined;
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = paginated
    ? Math.min(200, Math.max(1, opts?.pageSize ?? 50))
    : Math.max(1, total);

  const order = [asc(products.name), asc(products.id)];
  const rows = await (paginated
    ? baseQuery().orderBy(...order).limit(pageSize).offset((page - 1) * pageSize)
    : baseQuery().orderBy(...order));

  // Low-stock rows are fetched as their own filtered set (HAVING on the
  // grouped qty) so pagination of the main list can never hide them.
  // SIM-2 S4 (PERF-02): pemanggil yang tidak menampilkan stok menipis
  // (ekspor CSV valuasi) boleh melewati agregasi penuh kedua ini —
  // pada 100 rb produk agregasi ini ±⅓ waktu muat valuasi penuh dan
  // hasilnya dibuang pemanggil. Bawaan tetap menghitung (halaman nilai
  // persediaan & dashboard gudang menampilkan stok menipis).
  const lowRows = opts?.skipLowStock
    ? []
    : await baseQuery()
        .having(sql`${ownedQty} <= ${products.minStock}`)
        .orderBy(asc(products.name), asc(products.id));

  const toItem = (r: (typeof rows)[number]) => ({
    productId: r.productId,
    sku: r.sku,
    name: r.name,
    category: r.category ?? "Tanpa kategori",
    unit: r.unit ?? "PCS",
    qty: toDb(r.qty),
    cost: toDb(r.cost),
    salePrice: toDb(r.salePrice),
    minStock: toDb(r.minStock),
    value: toDb(d(r.qty).mul(r.cost)),
    potential: toDb(d(r.qty).mul(r.salePrice)),
  });
  const items = rows.map(toItem);
  // D-4 canonical rule (see src/lib/stock.ts): judged by the qty this
  // valuation displays — the selected warehouse's, or the all-warehouse
  // total when no warehouse is selected.
  const lowStock = lowRows.map(toItem).filter((r) => isLowStock(r.qty, r.minStock));

  return {
    items,
    total,
    page,
    pageSize,
    totalQty: toDb(totalsRow?.qty ?? 0),
    totalValue: toDb(totalsRow?.value ?? 0),
    totalPotential: toDb(totalsRow?.potential ?? 0),
    lowStock,
    lowStockCount: lowStock.length,
  };
}

export async function getStockCard(
  tx: Tx,
  companyId: string,
  productId: string,
  opts: { warehouseId: string; page?: number; pageSize?: number },
) {
  // GD-P2-5: the card is per warehouse — warehouseId is required, the
  // running balance only ever accumulates that warehouse's movements, and
  // the result is paginated. The opening balance of a page is the Decimal
  // sum of every movement before the page window (an ordered subquery),
  // so page 2+ balances stay exact without loading the full history.
  // All qty fields are canonical Decimal strings.
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const where = and(
    eq(stockMovements.companyId, companyId),
    eq(stockMovements.productId, productId),
    eq(stockMovements.warehouseId, opts.warehouseId),
  );
  const order = [asc(stockMovements.createdAt), asc(stockMovements.id)];

  const [totalRow] = await tx.select({ value: count() }).from(stockMovements).where(where);

  const prior = tx
    .select({ qty: stockMovements.qty })
    .from(stockMovements)
    .where(where)
    .orderBy(...order)
    .limit(offset)
    .as("stock_card_prior");
  const [priorRow] = await tx
    .select({ total: sql<string>`coalesce(sum(${prior.qty}), 0)` })
    .from(prior);
  const opening = d(priorRow?.total ?? 0);

  const rows = await tx
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      movementType: stockMovements.movementType,
      qty: stockMovements.qty,
      unitCost: stockMovements.unitCost,
      referenceNumber: stockMovements.referenceNumber,
      reason: stockMovements.reason,
      warehouseName: warehouses.name,
    })
    .from(stockMovements)
    .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset(offset);

  let running = opening;
  const items = rows.map((row) => {
    running = running.plus(row.qty);
    return {
      ...row,
      qty: toDb(row.qty),
      unitCost: toDb(row.unitCost),
      balance: toDb(running),
    };
  });

  return {
    rows: items,
    total: totalRow?.value ?? 0,
    page,
    pageSize,
    openingBalance: toDb(opening),
  };
}
