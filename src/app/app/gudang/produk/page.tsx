import Link from "next/link";
import { AlertTriangle, Download, Package, Percent, TrendingDown, TrendingUp, Upload } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getSettings,
  listAllCategories,
  listAllUnits,
  listCategories,
  listPackagingsForProducts,
  getProductMarginSummary,
  listProducts,
  listSuppliers,
  listUnits,
  listWarehouses,
} from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { LIST_PAGE_SIZE, parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { formatNumber } from "@/lib/money";
import { formatMargin, marginToneClass } from "@/lib/margin";
import { PageHeader } from "@/components/blocks/page-header";
import { StatCard } from "@/components/blocks/stat-card";
import { Pagination } from "@/components/blocks/pagination";
import { FilterChips } from "@/components/blocks/search-form";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import { sortCategoryTree } from "@/lib/categories";
import { ProductForm } from "@/components/gudang/product-form";
import { ProductBulkTable } from "@/components/gudang/product-bulk-table";
import { TaxonomySheet } from "@/components/gudang/taxonomy-sheet";

export const metadata = { title: "Produk" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; lowStock?: string; page?: string; warehouse?: string; urut?: string; arah?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");
  const canManage = can(ctx, "inventory.manage");
  const canSeeCost = can(ctx, "inventory.cost");
  // G3 (TBL-02): urutan daftar — nama (bawaan) / harga jual / stok.
  const sort = params.urut === "harga" || params.urut === "stok" ? params.urut : "nama";
  const dir: "asc" | "desc" = params.arah === "desc" ? "desc" : "asc";

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [settings, warehouses, categories, units, suppliers, allCategories, allUnits] = await Promise.all([
      getSettings(tx, ctx.company.id),
      listWarehouses(tx, ctx.company.id),
      listCategories(tx, ctx.company.id),
      listUnits(tx, ctx.company.id),
      listSuppliers(tx, ctx.company.id),
      listAllCategories(tx, ctx.company.id),
      listAllUnits(tx, ctx.company.id),
    ]);
    // FIX-GDG Tahap 4 (GDG2-12): stok yang ditampilkan mengikuti
    // gudang pilihan (?warehouse=) — sebelumnya halaman ini selalu
    // terkunci ke gudang bawaan sehingga stok cabang lain hanya bisa
    // dilihat lewat pindah-pindah halaman dokumen.
    const warehouseId =
      warehouses.find((w) => w.id === params.warehouse)?.id ??
      warehouses.find((w) => w.id === settings?.defaultWarehouseId)?.id ??
      warehouses.find((w) => w.isDefault)?.id ??
      warehouses[0]?.id ??
      "";
    const [marginSummary, list] = await Promise.all([
      getProductMarginSummary(tx, ctx.company.id),
      listProducts(tx, {
        companyId: ctx.company.id,
        warehouseId,
        q: params.q,
        categoryId: params.category,
        lowStock: params.lowStock === "1",
        page: parsePageParam(params.page),
        // G3 (TBL-01): ukuran halaman baku repo (sebelumnya 30).
        pageSize: LIST_PAGE_SIZE,
        sort,
        dir,
        activeOnly: false,
      }),
    ]);
    // Satuan Kemasan S1: ringkasan kemasan aktif per produk halaman ini
    // untuk kolom Satuan daftar (domain catalog/packaging).
    const packagingsByProduct = await listPackagingsForProducts(
      tx,
      ctx.company.id,
      list.rows.map((row) => row.id),
    );
    const rows = list.rows.map((row) => ({
      ...row,
      packagings: (packagingsByProduct.get(row.id) ?? [])
        .filter((packaging) => packaging.isActive)
        .map((packaging) => ({ name: packaging.name, isi: packaging.isi })),
    }));
    return { settings, warehouses, categories, units, suppliers, allCategories, allUnits, warehouseId, marginSummary, list: { ...list, rows } };
  });

  /** TBL-02: href pengalih urutan per kolom — filter & gudang
   * dipertahankan, halaman kembali ke 1. */
  function productSortHref(key: "nama" | "harga" | "stok") {
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.category) search.set("category", params.category);
    if (params.lowStock) search.set("lowStock", params.lowStock);
    search.set("warehouse", data.warehouseId);
    search.set("urut", key);
    search.set("arah", nextDir);
    return `/app/gudang/produk?${search.toString()}`;
  }
  const sortHrefs = {
    nama: productSortHref("nama"),
    harga: productSortHref("harga"),
    stok: productSortHref("stok"),
  };

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Produk & harga"
        description="Master produk, SKU, barcode, harga pokok, harga jual, dan stok minimum per gudang."
        actions={
          <>
            <Link
              href={`/api/export/products?${new URLSearchParams({
                ...(params.q ? { q: params.q } : {}),
                ...(params.category ? { category: params.category } : {}),
                ...(params.lowStock === "1" ? { lowStock: "1" } : {}),
                format: "xlsx",
              }).toString()}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              <Download className="size-3.5" /> Unduh Excel
            </Link>
            <Link
              href="/app/gudang/impor"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              <Upload className="size-3.5" /> Impor Excel
            </Link>
            {/* A-25 U2: kategori & satuan menjadi pengelolaan terpisah
                lewat drawer — bukan lagi dua panel bertumpuk di bawah
                daftar (POLA-01). */}
            {canManage ? (
              <TaxonomySheet categories={data.allCategories} units={data.allUnits} />
            ) : null}
            {canManage ? (
              <ProductForm
                categories={data.categories}
                units={data.units}
                suppliers={data.suppliers}
                allowCost={canSeeCost}
                allowPrice={can(ctx, "inventory.price")}
                customFields={customFieldDefinitionsFor(data.settings?.customFields, "product")}
              />
            ) : null}
          </>
        }
      />

      {/* Overview margin katalog: harga pokok adalah moving average
          yang diperbarui setiap penerimaan, jadi margin di sini
          mencerminkan biaya terkini — bukan harga beli lama. */}
      {canSeeCost ? (
      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Margin rata-rata"
          value={formatMargin(data.marginSummary.average)}
          hint={`${formatNumber(data.marginSummary.priced)} produk berharga jual`}
          icon={Percent}
          tone="teal"
          valueClassName={marginToneClass(data.marginSummary.average)}
        />
        <StatCard
          label="Margin tertinggi"
          value={formatMargin(data.marginSummary.highest)}
          hint="Harga jual vs HPP bergerak"
          icon={TrendingUp}
          tone="green"
          valueClassName={marginToneClass(data.marginSummary.highest)}
        />
        <StatCard
          label="Margin terendah"
          value={formatMargin(data.marginSummary.lowest)}
          hint="Periksa produk dengan margin tipis"
          icon={TrendingDown}
          tone="amber"
          valueClassName={marginToneClass(data.marginSummary.lowest)}
        />
        <StatCard
          label="Margin negatif"
          value={formatNumber(data.marginSummary.negative)}
          hint={`Dari ${formatNumber(data.marginSummary.total)} produk aktif`}
          icon={AlertTriangle}
          tone={data.marginSummary.negative > 0 ? "red" : "neutral"}
          valueClassName={data.marginSummary.negative > 0 ? "text-destructive" : undefined}
        />
      </div>
      ) : null}

      {/* A-25 U2: daftar produk memakai DataList bersama — kepala
          kartu tanpa judul ganda (SectionTitle bare membawa chip
          filter stok), satu bar pencarian+filter DataListToolbar,
          dan tanpa slot KPI (daftar tidak membuka dengan angka). */}
      <DataList
        density="compact"
        headerActions={
          <FilterChips
            basePath="/app/gudang/produk"
            param="lowStock"
            q={params.q}
            params={{ urut: sort, arah: dir }}
            value={params.lowStock}
            options={[
              { label: "Semua", value: "" },
              { label: "Stok menipis", value: "1" },
            ]}
          />
        }
        toolbar={
          /* A-22 K1 (UX-01): category TIDAK diteruskan sebagai hidden —
             ia sudah menjadi <select> anak di bawah; hidden + anak
             bernama sama mengirim parameter dua kali dan mengerror
             halaman (searchParams menjadi array). */
          <DataListToolbar
            action="/app/gudang/produk"
            q={params.q}
            placeholder="Cari nama, SKU, atau barcode…"
            hidden={{ lowStock: params.lowStock, urut: sort, arah: dir }}
            resetHref={params.q || params.category || params.lowStock ? "/app/gudang/produk" : undefined}
          >
            <select
              name="category"
              defaultValue={params.category ?? ""}
              className={dataListFilterClass}
              aria-label="Kategori"
            >
              <option value="">Semua kategori</option>
              {sortCategoryTree(data.categories).map((row) => (
                <option key={row.id} value={row.id}>
                  {"— ".repeat(row.depth)}
                  {row.name}
                </option>
              ))}
            </select>
            <select
              name="warehouse"
              defaultValue={data.warehouseId}
              className={dataListFilterClass}
              aria-label="Gudang"
            >
              {data.warehouses.map((row) => (
                <option key={row.id} value={row.id}>
                  Stok: {row.name}
                </option>
              ))}
            </select>
          </DataListToolbar>
        }
        isEmpty={data.list.rows.length === 0}
        empty={
          <EmptyState
            title="Produk tidak ditemukan"
            description={canManage ? "Ubah kata kunci atau tambahkan produk baru untuk mulai." : "Ubah kata kunci pencarian."}
            icon={<Package className="size-5" />}
          />
        }
        pagination={
          <Pagination
            page={data.list.page}
            pageSize={data.list.pageSize}
            total={data.list.total}
            basePath="/app/gudang/produk"
            params={{ q: params.q, category: params.category, lowStock: params.lowStock, warehouse: params.warehouse, urut: sort, arah: dir }}
          />
        }
        footerNote={
          <>
            Menampilkan stok gudang {data.warehouses.find((w) => w.id === data.warehouseId)?.name ?? "—"}. Total {formatNumber(data.list.total)} produk.
          </>
        }
      >
        <ProductBulkTable
          rows={data.list.rows}
          canManage={canManage}
          canSeeCost={canSeeCost}
          sort={{ key: sort, dir }}
          sortHrefs={sortHrefs}
          categories={sortCategoryTree(data.categories).map((row) => ({
            id: row.id,
            label: `${"— ".repeat(row.depth)}${row.name}`,
          }))}
          units={data.units}
          filter={{
            q: params.q,
            categoryId: params.category,
            lowStock: params.lowStock === "1",
          }}
          totalFiltered={data.list.total}
        />
      </DataList>
    </div>
  );
}
