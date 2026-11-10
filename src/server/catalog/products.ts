/**
 * Agregat baca PRODUK (A-26 Q5, K-04) — pecahan src/server/catalog.ts:
 * filter bersama, daftar, ekspor, pencarian, dan detail produk.
 * Badan kueri dipindah apa adanya; mekanik paginasi kini lewat
 * lib/pagination (P-06).
 */
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, products, suppliers, units } from "@/db/schema";
import { descendantIds } from "@/lib/categories";
import { d } from "@/lib/money";
import {
  normalizePageParams,
  pageOffset,
  pageResult,
  type PageResult,
} from "@/lib/pagination";
import { lowStockCondition } from "@/lib/stock";
import { listPackagingsForProducts } from "./packaging";

export type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitCode: string | null;
  unitName: string | null;
  supplierName: string | null;
  costPrice: string;
  salePrice: string;
  minStock: string;
  stock: number;
  trackStock: boolean;
  isActive: boolean;
};

export type ProductFilter = {
  companyId: string;
  warehouseId: string;
  q?: string;
  categoryId?: string;
  lowStock?: boolean;
  activeOnly?: boolean;
};

/**
 * S3 (§18F/H): satu-satunya definisi filter daftar produk — halaman
 * daftar, ekspor master, dan pemilihan massal bulk-edit WAJIB memakai
 * kondisi yang sama persis agar "yang terlihat" selalu sama dengan
 * "yang terekspor / yang terubah massal".
 */
export async function buildProductWhere(tx: Tx, input: ProductFilter) {
  const q = input.q?.trim();
  const conditions = [eq(products.companyId, input.companyId)];
  if (input.activeOnly !== false) conditions.push(eq(products.isActive, true));
  if (input.categoryId) {
    // T5-3 (D-17): nested categories — filtering by a parent category
    // includes products filed under any of its descendants.
    const categoryRows = await tx
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.companyId, input.companyId));
    conditions.push(inArray(products.categoryId, [...descendantIds(categoryRows, input.categoryId)]));
  }
  if (q) {
    conditions.push(
      or(
        ilike(products.name, `%${q}%`),
        ilike(products.sku, `%${q}%`),
        ilike(products.barcode, `%${q}%`),
      )!,
    );
  }

  const stockSql = sql<string>`coalesce((
    select soh.qty from stock_on_hand soh
    where soh.company_id = ${products.companyId}
      and soh.product_id = ${products.id}
      and soh.warehouse_id = ${input.warehouseId}
  ), 0)`;

  if (input.lowStock) {
    // D-4 canonical rule (see src/lib/stock.ts): the list judges low stock
    // by the stock of the warehouse it displays.
    conditions.push(lowStockCondition(stockSql, products.minStock));
  }

  return and(...conditions);
}

export type ProductSortKey = "nama" | "harga" | "stok";

export async function listProducts(
  tx: Tx,
  input: ProductFilter & {
    page?: number;
    pageSize?: number;
    /**
     * G3 (TBL-02): urutan daftar produk — "nama" adalah bawaan historis
     * (asc nama); "harga" mengurutkan harga jual, "stok" mengurutkan
     * stok gudang terpilih (ekspresi SQL yang sama dengan kolom stok
     * yang ditampilkan). Ikatan sekunder selalu nama agar halaman
     * stabil.
     */
    sort?: ProductSortKey;
    dir?: "asc" | "desc";
  },
): Promise<PageResult<ProductRow>> {
  const { page, pageSize } = normalizePageParams(input, 25);

  const where = await buildProductWhere(tx, input);
  const stockSql = sql<string>`coalesce((
    select soh.qty from stock_on_hand soh
    where soh.company_id = ${products.companyId}
      and soh.product_id = ${products.id}
      and soh.warehouse_id = ${input.warehouseId}
  ), 0)`;

  const sortOrder =
    input.sort === "harga"
      ? input.dir === "desc"
        ? desc(products.salePrice)
        : asc(products.salePrice)
      : input.sort === "stok"
        ? input.dir === "desc"
          ? desc(stockSql)
          : asc(stockSql)
        : asc(products.name);

  const [totalRow] = await tx
    .select({ value: count() })
    .from(products)
    .where(where);

  const rows = await tx
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      unitCode: units.code,
      unitName: units.name,
      supplierName: suppliers.name,
      costPrice: products.costPrice,
      salePrice: products.salePrice,
      minStock: products.minStock,
      stock: stockSql,
      trackStock: products.trackStock,
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(where)
    .orderBy(sortOrder, asc(products.name))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));

  return pageResult(
    rows.map((row) => ({ ...row, stock: d(row.stock).toNumber() })),
    totalRow?.value ?? 0,
    page,
    pageSize,
  );
}

/**
 * Header ekspor master produk (S3 §18H). Nama kolom sengaja identik
 * dengan alias pemetaan impor produk (`IMPORT_FIELDS` di
 * `src/lib/import-parse.ts`) supaya berkas hasil ekspor dapat diimpor
 * kembali tanpa pemetaan manual. Kolom stok SENGAJA tidak diekspor:
 * stok bukan master (sudah ada ekspor valuasi persediaan), dan header
 * apa pun yang terpetakan ke field impor `stock` akan memposting stok
 * awal saat impor ulang.
 */
export const PRODUCT_EXPORT_HEADERS = [
  "Kode Barang",
  "Nama Barang",
  "Barcode",
  "Kategori",
  "Satuan",
  "Pemasok",
  "Harga Beli",
  "Harga Jual",
  "Stok Minimum",
  "Lacak Persediaan",
  "Lacak Batch",
  "Status",
  "Keterangan",
  // S6: kolom kemasan di AKHIR (indeks kolom lama tidak bergeser) —
  // daftar paralel berpisah titik koma, format yang sama persis
  // dengan yang dibaca parser impor (parsePackagingCells).
  "Kemasan",
  "Isi Kemasan",
  "Harga Beli Kemasan",
  "Harga Jual Kemasan",
  "Barcode Kemasan",
  "Status Kemasan",
  "Kemasan Bawaan",
] as const;

/**
 * AUD-013 (Audit Produksi A4): kolom BIAYA pada ekspor produk. Harga
 * beli adalah data level-field `inventory.cost` — ditutupi di UI
 * daftar/detail dan di payload POS (POS3-10), jadi ekspor pun hanya
 * menyertakannya untuk pemegang izin itu. Tanpa izin, kolomnya tidak
 * disertakan sama sekali (bukan dikosongkan): berkas tetap dapat
 * diimpor kembali, kolom yang hilang memang tidak terpetakan.
 */
export const PRODUCT_EXPORT_COST_HEADERS: readonly string[] = [
  "Harga Beli",
  "Harga Beli Kemasan",
];

export function productExportHeaders(includeCost: boolean): string[] {
  return includeCost
    ? [...PRODUCT_EXPORT_HEADERS]
    : PRODUCT_EXPORT_HEADERS.filter(
        (header) => !PRODUCT_EXPORT_COST_HEADERS.includes(header),
      );
}

export type ProductExportPackaging = {
  name: string;
  isi: string;
  buyPrice: string | null;
  salePrice: string | null;
  barcode: string | null;
  isActive: boolean;
  isDefaultPurchase: boolean;
  isDefaultSale: boolean;
};

export type ProductExportRow = {
  sku: string;
  name: string;
  barcode: string | null;
  categoryName: string | null;
  unitName: string | null;
  supplierName: string | null;
  costPrice: string;
  salePrice: string;
  minStock: string;
  trackStock: boolean;
  trackBatch: boolean;
  isActive: boolean;
  notes: string | null;
  /** S6: SEMUA kemasan produk (aktif & nonaktif), urutan tampil. */
  packagings: ProductExportPackaging[];
};

/** Ekspor master produk TANPA paginasi, filter identik daftar produk. */
/**
 * Ringkasan margin katalog (harga jual vs harga pokok bergerak).
 * Agregasi satu tabel `products` — dipakai kartu overview halaman
 * Produk & harga. Margin hanya dihitung bila harga jual > 0.
 */
export async function getProductMarginSummary(tx: Tx, companyId: string) {
  const marginExpr = sql<string>`case when ${products.salePrice} > 0 then (${products.salePrice} - ${products.costPrice}) / ${products.salePrice} * 100 else null end`;
  const [row] = await tx
    .select({
      total: count(),
      avg: sql<string>`coalesce(avg(${marginExpr}), 0)`,
      max: sql<string>`coalesce(max(${marginExpr}), 0)`,
      min: sql<string>`coalesce(min(${marginExpr}), 0)`,
      negative: sql<number>`count(*) filter (where ${products.salePrice} > 0 and ${products.costPrice} > ${products.salePrice})`,
      priced: sql<number>`count(*) filter (where ${products.salePrice} > 0)`,
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.isActive, true)));
  return {
    total: row?.total ?? 0,
    priced: Number(row?.priced ?? 0),
    average: d(row?.avg ?? 0).toNumber(),
    highest: d(row?.max ?? 0).toNumber(),
    lowest: d(row?.min ?? 0).toNumber(),
    negative: Number(row?.negative ?? 0),
  };
}

export async function listProductsForExport(
  tx: Tx,
  input: ProductFilter,
): Promise<ProductExportRow[]> {
  const where = await buildProductWhere(tx, input);
  const rows = await tx
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      barcode: products.barcode,
      categoryName: categories.name,
      unitName: units.name,
      supplierName: suppliers.name,
      costPrice: products.costPrice,
      salePrice: products.salePrice,
      minStock: products.minStock,
      trackStock: products.trackStock,
      trackBatch: products.trackBatch,
      isActive: products.isActive,
      notes: products.notes,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(where)
    .orderBy(asc(products.name));
  const packagings = await listPackagingsForProducts(
    tx,
    input.companyId,
    rows.map((row) => row.id),
  );
  return rows.map(({ id, ...row }) => ({
    ...row,
    packagings: (packagings.get(id) ?? []).map((pack) => ({
      name: pack.name,
      isi: pack.isi,
      buyPrice: pack.buyPrice,
      salePrice: pack.salePrice,
      barcode: pack.barcode,
      isActive: pack.isActive,
      isDefaultPurchase: pack.isDefaultPurchase,
      isDefaultSale: pack.isDefaultSale,
    })),
  }));
}

export function toProductExportRow(
  row: ProductExportRow,
  opts?: { includeCost?: boolean },
): (string | null)[] {
  const packs = row.packagings;
  const join = (pick: (pack: ProductExportPackaging) => string) =>
    packs.length > 0 ? packs.map(pick).join("; ") : null;
  const cells: (string | null)[] = [
    row.sku,
    row.name,
    row.barcode,
    row.categoryName,
    row.unitName,
    row.supplierName,
    d(row.costPrice).toFixed(2),
    d(row.salePrice).toFixed(2),
    d(row.minStock).toString(),
    row.trackStock ? "Ya" : "Tidak",
    row.trackBatch ? "Ya" : "Tidak",
    row.isActive ? "Aktif" : "Nonaktif",
    row.notes,
    join((pack) => pack.name),
    join((pack) => d(pack.isi).toString()),
    join((pack) => (pack.buyPrice !== null ? d(pack.buyPrice).toFixed(2) : "")),
    join((pack) => (pack.salePrice !== null ? d(pack.salePrice).toFixed(2) : "")),
    join((pack) => pack.barcode ?? ""),
    join((pack) => (pack.isActive ? "Aktif" : "Nonaktif")),
    join((pack) =>
      pack.isDefaultPurchase && pack.isDefaultSale
        ? "Beli+Jual"
        : pack.isDefaultPurchase
          ? "Beli"
          : pack.isDefaultSale
            ? "Jual"
            : "",
    ),
  ];
  // AUD-013: tanpa izin `inventory.cost`, sel biaya dibuang mengikuti
  // indeks headernya (productExportHeaders memakai saringan yang sama).
  if (opts?.includeCost === false) {
    return cells.filter(
      (_, index) =>
        !PRODUCT_EXPORT_COST_HEADERS.includes(PRODUCT_EXPORT_HEADERS[index]),
    );
  }
  return cells;
}

export async function searchProducts(
  tx: Tx,
  // POS-1: offset mendukung pagination kisi produk terminal (halaman
  // tetap, diurutkan nama/barcode) tanpa memuat seluruh katalog.
  // POS3-10: includeCost adalah satu-satunya jalur harga pokok keluar
  // dari fungsi ini — bawaan false (aman). Pemanggil wajib menilainya
  // dari izin inventory.cost pemanggil; tanpa izin itu kolom biaya
  // tidak disertakan sama sekali di hasil (bukan sekadar disembunyikan
  // UI), karena hasil fungsi ini menyeberang ke klien sebagai payload.
  input: {
    companyId: string;
    warehouseId: string;
    q: string;
    limit?: number;
    offset?: number;
    includeCost?: boolean;
  },
) {
  const q = input.q.trim();

  // POS-SRCH-01: both branches project the stock of the requested
  // warehouse — the empty-query branch used to omit the column, so the
  // initial POS catalog cards all rendered stock 0.
  const stockSql = sql<string>`coalesce((
    select soh.qty from stock_on_hand soh
    where soh.company_id = ${products.companyId}
      and soh.product_id = ${products.id}
      and soh.warehouse_id = ${input.warehouseId}
  ), 0)`;

  const projection = {
    id: products.id,
    sku: products.sku,
    barcode: products.barcode,
    name: products.name,
    salePrice: products.salePrice,
    costPrice: products.costPrice,
    unitCode: units.code,
    // POS-1: terminal perlu tahu produk terlacak stok atau jasa
    // untuk memblokir penambahan produk berstok habis.
    trackStock: products.trackStock,
    trackSerial: products.trackSerial,
    stock: stockSql,
  };

  const rows = !q
    ? await tx
        .select(projection)
        .from(products)
        .leftJoin(units, eq(products.unitId, units.id))
        .where(and(eq(products.companyId, input.companyId), eq(products.isActive, true)))
        .orderBy(asc(products.name))
        .limit(input.limit ?? 20)
        .offset(input.offset ?? 0)
    : await tx
        .select(projection)
        .from(products)
        .leftJoin(units, eq(products.unitId, units.id))
        .where(
          and(
            eq(products.companyId, input.companyId),
            eq(products.isActive, true),
            or(
              eq(products.barcode, q),
              ilike(products.sku, `%${q}%`),
              ilike(products.name, `%${q}%`),
              // S4: barcode KEMASAN aktif juga menemukan produknya —
              // pindai dus di terminal harus sampai ke produk ini
              // (kemasan yang cocok ditandai lewat matchedPackagingId).
              sql`exists (
                select 1 from product_packagings pp
                 where pp.company_id = ${products.companyId}
                   and pp.product_id = ${products.id}
                   and pp.barcode = ${q}
                   and pp.is_active = true
              )`,
            ),
          ),
        )
        .orderBy(sql`case when ${products.barcode} = ${q} then 0 when ${products.sku} = ${q} then 1 else 2 end`, asc(products.name))
        .limit(input.limit ?? 20)
        .offset(input.offset ?? 0);

  // S4: kemasan aktif tiap baris hasil + kemasan yang cocok persis
  // dengan kata cari sebagai barcode (untuk jalur pindai terminal).
  const packagingsByProduct = await listPackagingsForProducts(
    tx,
    input.companyId,
    rows.map((row) => row.id),
  );
  const enriched = rows.map((row) => {
    const packagings = (packagingsByProduct.get(row.id) ?? [])
      .filter((pack) => pack.isActive)
      .map((pack) => ({
        id: pack.id,
        name: pack.name,
        isi: pack.isi,
        salePrice: pack.salePrice,
        buyPrice: pack.buyPrice,
        barcode: pack.barcode,
        isDefaultSale: pack.isDefaultSale,
      }));
    const matched = q
      ? (packagings.find((pack) => pack.barcode === q) ?? null)
      : null;
    return {
      ...row,
      packagings,
      matchedPackagingId: matched?.id ?? null,
    };
  });

  if (input.includeCost) return enriched;
  return enriched.map((row) => {
    const { costPrice: _costPrice, ...rest } = row;
    void _costPrice;
    return rest;
  });
}

export async function getProduct(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      categoryId: products.categoryId,
      unitId: products.unitId,
      supplierId: products.supplierId,
      costPrice: products.costPrice,
      salePrice: products.salePrice,
      minStock: products.minStock,
      trackStock: products.trackStock,
      trackBatch: products.trackBatch,
      trackSerial: products.trackSerial,
      attributes: products.attributes,
      isActive: products.isActive,
      notes: products.notes,
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listProductOptions(tx: Tx, companyId: string) {
  return tx
    .select({ id: products.id, sku: products.sku, name: products.name })
    .from(products)
    .where(eq(products.companyId, companyId))
    .orderBy(asc(products.name));
}
