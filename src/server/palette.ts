import { desc, ilike, or } from "drizzle-orm";
import type { Tx } from "@/db";
import { products, sales, stockDocuments } from "@/db/schema";
import { formatIDR } from "@/lib/money";
import { formatDate, journalSourceLabel } from "@/lib/format";

/**
 * A-24 T1 (SIS-12) — pencarian entitas untuk palet perintah.
 *
 * Satu-satunya fungsi baca palet: tiga kueri satu-tabel `ilike`
 * (pola jalur baca yang sama seperti katalog), masing-masing
 * dibatasi 5 hasil. Cakupan grup DITENTUKAN pemanggil (aksi)
 * berdasarkan modul terjangkau + izin peran — fungsi ini tidak
 * menebak izin; grup di luar cakupan tidak pernah dikueri.
 */
export type PaletteEntity = {
  id: string;
  label: string;
  sub: string;
  href: string;
};

export type PaletteEntityResults = {
  products: PaletteEntity[];
  sales: PaletteEntity[];
  documents: PaletteEntity[];
};

const GROUP_LIMIT = 5;

export async function searchPaletteEntities(
  tx: Tx,
  companyId: string,
  query: string,
  scope: { products: boolean; sales: boolean; documents: boolean },
): Promise<PaletteEntityResults> {
  const like = `%${query}%`;
  const empty: PaletteEntityResults = { products: [], sales: [], documents: [] };

  const [productRows, saleRows, documentRows] = await Promise.all([
    scope.products
      ? tx
          .select({ id: products.id, name: products.name, sku: products.sku })
          .from(products)
          .where(or(ilike(products.name, like), ilike(products.sku, like), ilike(products.barcode, like)))
          .orderBy(products.name)
          .limit(GROUP_LIMIT)
      : Promise.resolve([] as { id: string; name: string; sku: string }[]),
    scope.sales
      ? tx
          .select({ id: sales.id, number: sales.number, total: sales.total, date: sales.date })
          .from(sales)
          .where(ilike(sales.number, like))
          .orderBy(desc(sales.date), desc(sales.number))
          .limit(GROUP_LIMIT)
      : Promise.resolve([] as { id: string; number: string; total: string; date: string }[]),
    scope.documents
      ? tx
          .select({ id: stockDocuments.id, number: stockDocuments.number, type: stockDocuments.type, date: stockDocuments.date })
          .from(stockDocuments)
          .where(ilike(stockDocuments.number, like))
          .orderBy(desc(stockDocuments.date), desc(stockDocuments.number))
          .limit(GROUP_LIMIT)
      : Promise.resolve([] as { id: string; number: string; type: string; date: string }[]),
  ]);

  return {
    ...empty,
    products: productRows.map((row) => ({
      id: row.id,
      label: row.name,
      sub: row.sku,
      href: `/app/gudang/produk?q=${encodeURIComponent(row.sku)}`,
    })),
    sales: saleRows.map((row) => ({
      id: row.id,
      label: row.number,
      sub: `${formatDate(row.date)} · ${formatIDR(row.total)}`,
      href: `/app/pos/riwayat?q=${encodeURIComponent(row.number)}`,
    })),
    documents: documentRows.map((row) => ({
      id: row.id,
      label: row.number,
      sub: `${journalSourceLabel(row.type)} · ${formatDate(row.date)}`,
      href: `/app/gudang/dokumen/${row.id}`,
    })),
  };
}
