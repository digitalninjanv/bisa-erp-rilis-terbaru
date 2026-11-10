import Link from "next/link";
import { Plus, Undo2 } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  SUPPLIER_RETURN_REASON_LABELS,
  listSupplierReturnsPage,
} from "@/server/supplier-returns";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { d, formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";

export const metadata = { title: "Retur Pembelian" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Semua status" },
  { value: "draft", label: "Draf" },
  { value: "posted", label: "Terposting" },
  { value: "partially_resolved", label: "Sebagian selesai" },
  { value: "resolved", label: "Selesai" },
  { value: "void", label: "Batal" },
];

export default async function SupplierReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");
  const status = STATUS_FILTERS.some((row) => row.value === params.status && row.value !== "")
    ? params.status
    : undefined;

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const history = await listSupplierReturnsPage(tx, ctx.company.id, {
      status,
      page: Number(params.page ?? 1),
      pageSize: PAGE_SIZE,
    });
    return { rows: history.rows, history };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Retur Pembelian"
        description="Kembalikan barang rusak, kedaluwarsa, salah kirim, atau tidak sesuai ke pemasok. Nilai retur memotong utang pemasok lebih dulu; kelebihannya menjadi Kredit Pemasok yang diselesaikan lewat penggantian barang, potongan pembelian berikutnya, atau refund."
        actions={
          can(ctx, "inventory.manage") ? (
            <Link
              href="/app/gudang/retur-pembelian/baru"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-3.5" /> Retur Baru
            </Link>
          ) : undefined
        }
      />

      {/* A-25 U3: daftar retur memakai DataList bersama — judul kartu
          "Dokumen retur (RTB)" yang mengulang judul halaman ditutup,
          bar filter menjadi DataListToolbar tunggal (tombol selalu
          "Cari", bukan lagi "Saring"). Bentuk pengambilan data tidak
          berubah (ARS1-01): filter yang didukung fungsi baca tetap
          hanya status; kata kunci q dari toolbar dipertahankan di URL
          tetapi belum menyaring sampai fungsi baca mendukungnya. */}
      <DataList
        toolbar={
          <DataListToolbar
            action="/app/gudang/retur-pembelian"
            q={params.q}
            placeholder="Cari nomor atau pemasok…"
            resetHref={status ? "/app/gudang/retur-pembelian" : undefined}
          >
            <select
              name="status"
              defaultValue={status ?? ""}
              className={dataListFilterClass}
              aria-label="Saring status retur"
            >
              {STATUS_FILTERS.map((row) => (
                <option key={row.value} value={row.value}>{row.label}</option>
              ))}
            </select>
          </DataListToolbar>
        }
        isEmpty={data.rows.length === 0}
        empty={
          <EmptyState
            title="Belum ada retur pembelian"
            description={can(ctx, "inventory.manage")
              ? "Ada barang rusak, kedaluwarsa, atau salah kirim dari pemasok? Buat dokumen retur lewat tombol Retur Baru — stok keluar tercatat dan nilainya memotong utang atau menjadi kredit pemasok."
              : "Dokumen retur pembelian yang dibuat akan tampil di sini. Peran Anda dapat melihat; retur dibuat oleh Staf Gudang, Manager, atau Pemilik."}
            icon={<Undo2 className="size-5" />}
          />
        }
        pagination={
          <Pagination
            page={data.history.page}
            pageSize={data.history.pageSize}
            total={data.history.total}
            basePath="/app/gudang/retur-pembelian"
            params={{ status }}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Tanggal</th>
                <th>Pemasok</th>
                <th>Gudang</th>
                <th>Kategori alasan</th>
                <th className="text-right">Nilai retur</th>
                <th className="text-right">Sisa klaim</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const remaining = d(row.creditAmount).minus(d(row.resolvedAmount));
                const showClaim = row.status === "posted" || row.status === "partially_resolved";
                return (
                  <tr key={row.id}>
                    <td className="num font-medium">
                      <Link href={`/app/gudang/retur-pembelian/${row.id}`} className="text-primary hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                    <td className="text-[12px]">{row.supplierName ?? "—"}</td>
                    <td className="text-[11px]">{row.warehouseName ?? "—"}</td>
                    <td className="text-[12px]">
                      {SUPPLIER_RETURN_REASON_LABELS[row.reasonCategory] ?? row.reasonCategory}
                    </td>
                    <td className="num text-right font-medium">
                      {row.status === "draft" ? (
                        <span className="text-muted-foreground" title="Nilai dibekukan saat posting pada harga pokok rata-rata (AVCO)">
                          belum dinilai
                        </span>
                      ) : (
                        formatIDR(row.totalValue)
                      )}
                    </td>
                    <td className="num text-right">
                      {showClaim ? (
                        <span className={remaining.gt(0) ? "font-semibold text-tone-amber" : "text-muted-foreground"}>
                          {formatIDR(remaining)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataList>
    </div>
  );
}
