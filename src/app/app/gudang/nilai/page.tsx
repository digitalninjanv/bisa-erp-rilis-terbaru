import Link from "next/link";
import { Boxes, Download } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listPackagingsForProducts, listWarehouses } from "@/server/catalog";
import { getInventoryValuation } from "@/server/reports";
import { packagingBreakdownLabel } from "@/lib/packaging";
import { LIST_PAGE_SIZE } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR, formatNumber, formatQty } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { StatCard } from "@/components/blocks/stat-card";
import { Pagination } from "@/components/blocks/pagination";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";

export const metadata = { title: "Nilai persediaan" };
export const dynamic = "force-dynamic";

export default async function InventoryValuePage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string; page?: string; q?: string; rincian?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");
  // AUD-013: HPP, nilai persediaan (kolom & kartu total), dan nilai per
  // baris adalah data biaya level-field `inventory.cost` — pola yang
  // sama dengan halaman daftar/detail produk. Tanpa izin itu halaman
  // tetap berguna (stok & potensi jual), biaya tidak dirender.
  const canSeeCost = can(ctx, "inventory.cost");
  // S6: rincian "Dus + Pcs" adalah OPSI tampil (display-only) — angka
  // stok selalu satuan dasar; saklar hanya menghidupkan/mematikan
  // label pecahan kemasan di kolom Stok dan di ekspor CSV. Bawaan
  // NYALA (perilaku S3 yang sudah terverifikasi); `rincian=0`
  // mematikannya untuk tampilan ringkas.
  const showBreakdown = params.rincian !== "0";

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const warehouses = await listWarehouses(tx, ctx.company.id);
    const valuation = await getInventoryValuation(tx, ctx.company.id, params.warehouse, {
      page: Number(params.page ?? 1),
      // G3 (TBL-01): ukuran halaman baku repo (sebelumnya 50).
      pageSize: LIST_PAGE_SIZE,
    });
    // S3: kemasan aktif per produk halaman ini — label pecahan
    // "≈ X Dus Y Pcs" di kolom Stok (display-only, angka dasar utuh).
    const packagings = await listPackagingsForProducts(
      tx,
      ctx.company.id,
      valuation.items.map((row) => row.productId),
    );
    return { warehouses, valuation, packagings };
  });

  // A-25 U3 (GDG-05): halaman ini kini punya kotak pencarian. Fungsi
  // baca getInventoryValuation belum menerima parameter q, jadi kata
  // kunci menyaring baris yang SUDAH diambil halaman ini di sisi
  // render (penyajian, bukan kueri baru — ARS1-01; fungsi server
  // tidak diubah). Catatan jujur: valuasi berpaginasi server (50
  // baris/halaman), sehingga penyaringan berlaku atas baris halaman
  // tampil dan total paginasi tetap total server — dukungan q penuh
  // memerlukan parameter baru di fungsi baca (di luar berkas ini).
  const q = params.q?.trim().toLowerCase() ?? "";
  const visibleItems = q
    ? data.valuation.items.filter((row) =>
        [row.name, row.sku, row.category].some((value) =>
          (value ?? "").toLowerCase().includes(q),
        ),
      )
    : data.valuation.items;

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Nilai persediaan"
        description="Nilai stok berdasarkan harga pokok rata-rata, lengkap dengan potensi penjualan dan barang menipis."
        actions={
          <>
            <Link
              href={{
                pathname: "/app/gudang/nilai",
                query: {
                  ...(params.warehouse ? { warehouse: params.warehouse } : {}),
                  ...(params.q ? { q: params.q } : {}),
                  rincian: showBreakdown ? "0" : "1",
                },
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              Rincian Dus + Pcs: {showBreakdown ? "Nyala" : "Mati"}
            </Link>
            <Link
              href={`/api/export/inventory?${new URLSearchParams({
                ...(params.warehouse ? { warehouse: params.warehouse } : {}),
                ...(showBreakdown ? { rincian: "1" } : {}),
              }).toString()}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              <Download className="size-3.5" /> Unduh CSV
            </Link>
          </>
        }
      />

      {/* A-25 U3: daftar nilai memakai DataList bersama — ringkasan
          valuasi (agregat SQL atas seluruh set tersaring gudang,
          bukan angka halaman) mengisi slot KPI; chip pill gudang
          diganti select di DataListToolbar, pola yang sama dengan
          halaman Produk (GDG-05 / POLA-06). */}
      <DataList density="compact"
        kpis={
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {/* UX4-05 (G2): cip ikon dekoratif dinetralkan; Stok
                menipis PERTAHAN red/green karena warnanya bermakna. */}
            {canSeeCost ? (
              <StatCard size="compact" label="Nilai persediaan" value={formatIDR(data.valuation.totalValue)} hint="HPP rata-rata" icon={Boxes} />
            ) : null}
            <StatCard size="compact" label="Potensi jual" value={formatIDR(data.valuation.totalPotential)} hint="Pada harga jual" />
            <StatCard size="compact" label="Total unit" value={formatQty(data.valuation.totalQty)} hint={`${formatNumber(data.valuation.total)} SKU`} />
            <StatCard size="compact" label="Stok menipis" value={formatNumber(data.valuation.lowStock.length)} hint="Di bawah minimum" tone={data.valuation.lowStock.length ? "red" : "green"} />
          </div>
        }
        toolbar={
          /* A-22 K1 (UX-01): warehouse TIDAK diteruskan sebagai
             hidden — ia sudah menjadi <select> anak di bawah. */
          <DataListToolbar
            action="/app/gudang/nilai"
            q={params.q}
            placeholder="Cari nama produk, SKU, atau kategori…"
            resetHref={params.q || params.warehouse ? "/app/gudang/nilai" : undefined}
          >
            <select
              name="warehouse"
              defaultValue={params.warehouse ?? ""}
              className={dataListFilterClass}
              aria-label="Gudang"
            >
              <option value="">Semua gudang</option>
              {data.warehouses.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </DataListToolbar>
        }
        isEmpty={visibleItems.length === 0}
        empty={
          <EmptyState
            title="Produk tidak ditemukan"
            description="Ubah kata kunci pencarian atau pilihan gudang."
            icon={<Boxes className="size-5" />}
          />
        }
        pagination={
          <Pagination
            page={data.valuation.page}
            pageSize={data.valuation.pageSize}
            total={data.valuation.total}
            basePath="/app/gudang/nilai"
            params={{ warehouse: params.warehouse, q: params.q }}
          />
        }
        footerNote={
          q ? (
            <>
              Penyaringan “{params.q}” diterapkan pada baris yang tampil di halaman ini; total
              paginasi tetap total seluruh gudang terpilih.
            </>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Kategori</th>
                <th>Satuan</th>
                <th className="text-right">Stok</th>
                {canSeeCost ? <th className="text-right">HPP</th> : null}
                {canSeeCost ? <th className="text-right">Nilai</th> : null}
                <th className="text-right">Potensi</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((row) => (
                <tr key={row.productId}>
                  <td>
                    <Link href={`/app/gudang/produk/${row.productId}`} className="text-[12px] font-medium hover:underline">
                      {row.name}
                    </Link>
                    <p className="num text-[10px] text-muted-foreground">{row.sku}</p>
                  </td>
                  <td className="text-[11px]">{row.category}</td>
                  <td className="text-[11px]">{row.unit}</td>
                  <td className={`num text-right ${d(row.qty).lte(row.minStock) ? "text-destructive" : ""}`}>
                    {formatQty(row.qty)}
                    {showBreakdown
                      ? (() => {
                          const label = packagingBreakdownLabel(
                            row.qty,
                            (data.packagings.get(row.productId) ?? []).filter((pack) => pack.isActive),
                            row.unit ?? "Pcs",
                          );
                          return label ? (
                            <span className="block text-[10px] font-normal text-muted-foreground">{label}</span>
                          ) : null;
                        })()
                      : null}
                  </td>
                  {canSeeCost ? <td className="num text-right text-[11px]">{formatIDR(row.cost)}</td> : null}
                  {canSeeCost ? <td className="num text-right font-medium">{formatIDR(row.value)}</td> : null}
                  <td className="num text-right text-[11px] text-muted-foreground">{formatIDR(row.potential)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>
    </div>
  );
}
