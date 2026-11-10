import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  listPurchaseOrderHistory,
  listSuppliers,
} from "@/server/catalog";
import { PURCHASE_ORDER_STATUS_LABELS } from "@/server/purchasing";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { formatIDR, formatQty } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { PurchaseOrderForm } from "@/components/gudang/purchase-order-form";

export const metadata = { title: "Pesanan pembelian" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [supplierRows, history] = await Promise.all([
      listSuppliers(tx, ctx.company.id),
      listPurchaseOrderHistory(tx, {
        companyId: ctx.company.id,
        page: parsePageParam(params.page),
        pageSize: PAGE_SIZE,
        q: params.q,
      }),
    ]);
    return { supplierRows, orders: history.rows, history };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Pesanan pembelian (PO)"
        description="Pesan barang ke pemasok sebagai dokumen komitmen. Stok dan utang baru tercatat saat barang diterima terhadap PO dari halaman Penerimaan."
      />

      {/* A-24 T1 (SIS-05): cabang prasyarat di sini sudah benar (hanya
          untuk pembuat); peran lihat-saja kini mendapat pemberitahuan
          mode-lihat, bukan kekosongan tanpa penjelasan. */}
      {can(ctx, "inventory.manage") && data.supplierRows.length > 0 ? (
        <PurchaseOrderForm suppliers={data.supplierRows} today={todayISO()} />
      ) : can(ctx, "inventory.manage") ? (
        <GateNotice>Tambahkan pemasok terlebih dahulu di menu Pemasok.</GateNotice>
      ) : (
        <GateNotice>{viewModeText("pesanan pembelian")}</GateNotice>
      )}

      {/* A-25 U3 (DAFTAR-1): daftar PO memakai DataList bersama —
          judul kartu ganda "Daftar pesanan pembelian" ditutup, satu
          bar pencarian DataListToolbar, tanpa slot KPI. Filter yang
          didukung fungsi baca yang ada hanya q (ARS1-01: filter
          status/gudang/tanggal tidak ditambah tanpa parameter baca). */}
      <DataList
        className="mt-4"
        toolbar={
          <DataListToolbar
            action="/app/gudang/pembelian"
            q={params.q}
            placeholder="Cari nomor PO atau nama pemasok…"
            resetHref={params.q ? "/app/gudang/pembelian" : undefined}
          />
        }
        isEmpty={data.orders.length === 0}
        empty={
          <EmptyState title="Belum ada pesanan pembelian" description="PO yang dibuat akan tampil di sini beserta progres penerimaannya." />
        }
        pagination={
          <Pagination
            page={data.history.page}
            pageSize={data.history.pageSize}
            total={data.history.total}
            basePath="/app/gudang/pembelian"
            params={{ q: params.q }}
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
                <th className="text-right">Jumlah dipesan</th>
                <th className="text-right">Jumlah diterima</th>
                <th>Progres</th>
                <th className="text-right">Nilai</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((row) => {
                const ordered = Number(row.orderedQty);
                const received = Number(row.receivedQty);
                const progress = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
                return (
                  <tr key={row.id}>
                    <td className="num font-medium">
                      <Link href={`/app/gudang/pembelian/${row.id}`} className="text-primary hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="num text-[12px] text-muted-foreground">
                      {formatDate(row.date)}
                      {row.expectedDate ? (
                        <span className="block text-[10px]">perkiraan tiba {formatDate(row.expectedDate)}</span>
                      ) : null}
                    </td>
                    <td className="text-[12px]">{row.supplierName ?? "—"}</td>
                    <td className="num text-right">{formatQty(row.orderedQty)}</td>
                    <td className="num text-right">{formatQty(row.receivedQty)}</td>
                    <td className="min-w-[110px]">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="num text-[10px] text-muted-foreground">{progress}%</span>
                    </td>
                    <td className="num text-right font-medium">{formatIDR(row.total)}</td>
                    <td>
                      <StatusBadge
                        status={row.status}
                        label={PURCHASE_ORDER_STATUS_LABELS[row.status] ?? row.status}
                      />
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
