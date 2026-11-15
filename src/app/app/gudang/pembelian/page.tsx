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
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { formatIDR, formatQty } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { PurchaseOrderForm } from "@/components/gudang/purchase-order-form";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Pesanan pembelian" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

function validDateParam(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
    supplierId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [supplierRows, history] = await Promise.all([
      listSuppliers(tx, ctx.company.id),
      listPurchaseOrderHistory(tx, {
        companyId: ctx.company.id,
        page: parsePageParam(params.page),
        pageSize: PAGE_SIZE,
        q: params.q,
        status: Object.hasOwn(PURCHASE_ORDER_STATUS_LABELS, params.status ?? "") ? params.status : undefined,
        supplierId: params.supplierId,
        from: validDateParam(params.from),
        to: validDateParam(params.to),
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

      {/* Daftar PO memakai filter server-side agar status dan rentang tanggal
          tetap berlaku untuk seluruh hasil, bukan hanya halaman yang terbuka. */}
      <DataList
        className="mt-4"
        toolbar={
          <DataListToolbar
            action="/app/gudang/pembelian"
            q={params.q}
            placeholder="Cari nomor PO atau nama pemasok…"
            resetHref={params.q || params.status || params.supplierId || params.from || params.to ? "/app/gudang/pembelian" : undefined}
          >
            <select name="status" defaultValue={params.status ?? ""} aria-label="Filter status PO" className={dataListFilterClass}>
              <option value="">Semua status</option>
              {Object.entries(PURCHASE_ORDER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select name="supplierId" defaultValue={params.supplierId ?? ""} aria-label="Filter pemasok" className={dataListFilterClass}>
              <option value="">Semua pemasok</option>
              {data.supplierRows.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
            <DateRangeField
              from={{ name: "from", defaultValue: validDateParam(params.from) }}
              to={{ name: "to", defaultValue: validDateParam(params.to) }}
            />
          </DataListToolbar>
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
            params={{
              q: params.q,
              status: params.status,
              supplierId: params.supplierId,
              from: validDateParam(params.from),
              to: validDateParam(params.to),
            }}
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
                {canSeeCost ? <th className="text-right">Nilai</th> : null}
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
                    {canSeeCost ? <td className="num text-right font-medium">{formatIDR(row.total)}</td> : null}
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
