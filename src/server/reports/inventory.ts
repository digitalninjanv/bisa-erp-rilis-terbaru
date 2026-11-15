// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  ilike,
  or,
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

export type InventoryValuationExportCursor = { name: string; id: string };

type InventoryValuationRawRow = {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string | null;
  qty: string;
  cost: string;
  salePrice: string;
  minStock: string;
};

function inventoryValuationSearch(q?: string) {
  const search = q?.trim();
  if (!search) return null;
  return or(
    ilike(products.name, `%${search}%`),
    ilike(products.sku, `%${search}%`),
    ilike(categories.name, `%${search}%`),
  )!;
}

function createInventoryValuationQuery(
  tx: Tx,
  companyId: string,
  warehouseId?: string,
  q?: string,
) {
  const ownedQty = sql<string>`coalesce(sum(${stockOnHand.qty}), 0) + ${warehouseId ? sql`0` : stockTransitSql(companyId, products.id, "qty")}`;
  const searchCondition = inventoryValuationSearch(q);
  const baseQuery = (cursor?: InventoryValuationExportCursor) => {
    const conditions = [eq(products.companyId, companyId)];
    if (warehouseId) conditions.push(eq(stockOnHand.warehouseId, warehouseId));
    if (searchCondition) conditions.push(searchCondition);
    if (cursor) {
      conditions.push(
        or(
          gt(products.name, cursor.name),
          and(eq(products.name, cursor.name), gt(products.id, cursor.id)),
        )!,
      );
    }

    return tx
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        category: sql<string | null>`${categories.name}`.as("category"),
        unit: sql<string | null>`${units.code}`.as("unit"),
        qty: ownedQty.as("owned_qty"),
        cost: products.costPrice,
        salePrice: products.salePrice,
        minStock: products.minStock,
      })
      .from(products)
      .leftJoin(stockOnHand, eq(stockOnHand.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(units, eq(products.unitId, units.id))
      .where(and(...conditions))
      .groupBy(products.id, products.sku, products.name, categories.name, units.code, products.costPrice, products.salePrice, products.minStock);
  };

  return { ownedQty, baseQuery };
}

function toInventoryValuationItem(r: InventoryValuationRawRow) {
  return {
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
  };
}

/** Keyset page for large inventory exports; avoids totals/low-stock scans. */
export async function listInventoryValuationExportPage(
  tx: Tx,
  companyId: string,
  warehouseId?: string,
  cursor?: InventoryValuationExportCursor | null,
  limit = 500,
  q?: string,
) {
  const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 1_000);
  const conditions = [eq(products.companyId, companyId)];
  const searchCondition = inventoryValuationSearch(q);
  if (searchCondition) conditions.push(searchCondition);
  if (cursor) {
    conditions.push(
      or(
        gt(products.name, cursor.name),
        and(eq(products.name, cursor.name), gt(products.id, cursor.id)),
      )!,
    );
  }
  if (warehouseId) {
    conditions.push(
      exists(
        tx
          .select({ productId: stockOnHand.productId })
          .from(stockOnHand)
          .where(
            and(
              eq(stockOnHand.companyId, companyId),
              eq(stockOnHand.productId, products.id),
              eq(stockOnHand.warehouseId, warehouseId),
            ),
          ),
      ),
    );
  }

  // Limit the ordered product set before joining/aggregating stock. Applying
  // LIMIT after GROUP BY would rescan and aggregate the entire remaining
  // catalog for every export page.
  const productPage = tx
    .select({
      productId: products.id,
      sku: products.sku,
      name: products.name,
      category: sql<string | null>`${categories.name}`.as("category"),
      unit: sql<string | null>`${units.code}`.as("unit"),
      cost: products.costPrice,
      salePrice: products.salePrice,
      minStock: products.minStock,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .where(and(...conditions))
    .orderBy(asc(products.name), asc(products.id))
    .limit(pageSize + 1)
    .as("inventory_export_products");
  const ownedQty = sql<string>`coalesce(sum(${stockOnHand.qty}), 0) + ${warehouseId ? sql`0` : stockTransitSql(companyId, productPage.productId, "qty")}`;
  const stockJoin = and(
    eq(stockOnHand.companyId, companyId),
    eq(stockOnHand.productId, productPage.productId),
    ...(warehouseId ? [eq(stockOnHand.warehouseId, warehouseId)] : []),
  );
  const rows = await tx
    .select({
      productId: productPage.productId,
      sku: productPage.sku,
      name: productPage.name,
      category: productPage.category,
      unit: productPage.unit,
      qty: ownedQty.as("owned_qty"),
      cost: productPage.cost,
      salePrice: productPage.salePrice,
      minStock: productPage.minStock,
    })
    .from(productPage)
    .leftJoin(stockOnHand, stockJoin)
    .groupBy(
      productPage.productId,
      productPage.sku,
      productPage.name,
      productPage.category,
      productPage.unit,
      productPage.cost,
      productPage.salePrice,
      productPage.minStock,
    )
    .orderBy(asc(productPage.name), asc(productPage.productId));
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const last = pageRows.at(-1);

  return {
    rows: pageRows.map(toInventoryValuationItem),
    nextCursor: hasMore && last ? { name: last.name, id: last.productId } : null,
  };
}

export async function getInventoryValuation(
  tx: Tx,
  companyId: string,
  warehouseId?: string,
  opts?: {
    page?: number;
    pageSize?: number;
    skipLowStock?: boolean;
    skipLowStockRows?: boolean;
    /** Pencarian server-side: nama produk, SKU, atau kategori. */
    q?: string;
  },
) {
  // GD-P2-6: server-side pagination + Decimal everywhere. All money/qty
  // fields are canonical Decimal strings; totals are SQL aggregates over
  // the WHOLE filtered set, never sums of the rendered page. Callers that
  // need every row (such as a complete export) omit `opts`.
  const { ownedQty, baseQuery } = createInventoryValuationQuery(
    tx,
    companyId,
    warehouseId,
    opts?.q,
  );

  const grouped = baseQuery().as("valuation_totals");
  const [totalsRow] = await tx.select({
    productCount: sql<string>`count(*)`,
    qty: sql<string>`coalesce(sum(${grouped.qty}), 0)`,
    value: sql<string>`coalesce(sum(${grouped.qty} * ${grouped.cost}), 0)`,
    potential: sql<string>`coalesce(sum(${grouped.qty} * ${grouped.salePrice}), 0)`,
    lowStockCount: sql<string>`count(*) filter (where ${grouped.qty} <= ${grouped.minStock})`,
  }).from(grouped);

  const total = Number(totalsRow?.productCount ?? 0);
  const paginated = opts?.page !== undefined || opts?.pageSize !== undefined;
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = paginated
    ? Math.min(200, Math.max(1, opts?.pageSize ?? 50))
    : Math.max(1, total);

  const order = [asc(products.name), asc(products.id)];
  let rows: InventoryValuationRawRow[];
  if (!paginated) {
    rows = await baseQuery().orderBy(...order);
  } else {
    const productConditions = [eq(products.companyId, companyId)];
    const searchCondition = inventoryValuationSearch(opts?.q);
    if (searchCondition) productConditions.push(searchCondition);
    if (warehouseId) {
      productConditions.push(
        exists(
          tx
            .select({ productId: stockOnHand.productId })
            .from(stockOnHand)
            .where(
              and(
                eq(stockOnHand.companyId, companyId),
                eq(stockOnHand.productId, products.id),
                eq(stockOnHand.warehouseId, warehouseId),
              ),
            ),
        ),
      );
    }
    // Select the requested products before aggregating stock. LIMIT/OFFSET
    // after GROUP BY makes PostgreSQL aggregate the entire catalog per page.
    const productPage = tx
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        category: sql<string | null>`${categories.name}`.as("category"),
        unit: sql<string | null>`${units.code}`.as("unit"),
        cost: products.costPrice,
        salePrice: products.salePrice,
        minStock: products.minStock,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(units, eq(products.unitId, units.id))
      .where(and(...productConditions))
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .as("inventory_valuation_products");
    const pageOwnedQty = sql<string>`coalesce(sum(${stockOnHand.qty}), 0) + ${warehouseId ? sql`0` : stockTransitSql(companyId, productPage.productId, "qty")}`;
    const stockJoin = and(
      eq(stockOnHand.companyId, companyId),
      eq(stockOnHand.productId, productPage.productId),
      ...(warehouseId ? [eq(stockOnHand.warehouseId, warehouseId)] : []),
    );
    rows = await tx
      .select({
        productId: productPage.productId,
        sku: productPage.sku,
        name: productPage.name,
        category: productPage.category,
        unit: productPage.unit,
        qty: pageOwnedQty.as("owned_qty"),
        cost: productPage.cost,
        salePrice: productPage.salePrice,
        minStock: productPage.minStock,
      })
      .from(productPage)
      .leftJoin(stockOnHand, stockJoin)
      .groupBy(
        productPage.productId,
        productPage.sku,
        productPage.name,
        productPage.category,
        productPage.unit,
        productPage.cost,
        productPage.salePrice,
        productPage.minStock,
      )
      .orderBy(asc(productPage.name), asc(productPage.productId));
  }

  // Low-stock rows are fetched as their own filtered set (HAVING on the
  // grouped qty) so pagination of the main list can never hide them.
  // SIM-2 S4 (PERF-02): pemanggil yang tidak menampilkan stok menipis
  // (ekspor CSV valuasi) boleh melewati agregasi penuh kedua ini —
  // pada 100 rb produk agregasi ini ±⅓ waktu muat valuasi penuh dan
  // hasilnya dibuang pemanggil. Bawaan tetap menghitung (halaman nilai
  // persediaan & dashboard gudang menampilkan stok menipis).
  const lowRows = opts?.skipLowStock || opts?.skipLowStockRows
    ? []
    : await baseQuery()
        .having(sql`${ownedQty} <= ${products.minStock}`)
        .orderBy(asc(products.name), asc(products.id));

  const items = rows.map(toInventoryValuationItem);
  // D-4 canonical rule (see src/lib/stock.ts): judged by the qty this
  // valuation displays — the selected warehouse's, or the all-warehouse
  // total when no warehouse is selected.
  const lowStock = lowRows.map(toInventoryValuationItem).filter((r) => isLowStock(r.qty, r.minStock));

  return {
    items,
    total,
    page,
    pageSize,
    totalQty: toDb(totalsRow?.qty ?? 0),
    totalValue: toDb(totalsRow?.value ?? 0),
    totalPotential: toDb(totalsRow?.potential ?? 0),
    lowStock,
    lowStockCount: opts?.skipLowStock ? 0 : Number(totalsRow?.lowStockCount ?? 0),
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
