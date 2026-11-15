import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listReceiptHistory, listSuppliers, listWarehouses } from "@/server/catalog";
import { RECEIPT_SOURCE_LABELS } from "@/server/inventory";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { formatDate } from "@/lib/format";
import { formatIDR, formatNumber } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { ReceiptRowActions } from "@/components/gudang/void-buttons";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Riwayat penerimaan" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function ReceiptHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    from?: string;
    to?: string;
    supplier?: string;
    warehouse?: string;
    status?: string;
    source?: string;
  }>;
}) {
  const params = await searchParams;
  const sourceFilter = params.source ?? "purchase";
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [history, suppliers, warehouses] = await Promise.all([
      listReceiptHistory(tx, {
        companyId: ctx.company.id,
        page: parsePageParam(params.page),
        pageSize: PAGE_SIZE,
        q: params.q,
        from: params.from,
        to: params.to,
        supplierId: params.supplier,
        warehouseId: params.warehouse,
        status: params.status,
        source: sourceFilter,
      }),
      listSuppliers(tx, ctx.company.id),
      listWarehouses(tx, ctx.company.id),
    ]);
    return { history, suppliers, warehouses };
  });
  const hasFilters = Boolean(
    params.q || params.from || params.to || params.supplier || params.warehouse || params.status ||
    (params.source && params.source !== "purchase"),
  );
  const historyParams = {
    q: params.q,
    from: params.from,
    to: params.to,
    supplier: params.supplier,
    warehouse: params.warehouse,
    status: params.status,
    source: sourceFilter,
  };

  return (
    <div>
      <Link
        href="/app/gudang/penerimaan"
        className="mb-2 inline-flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Kembali ke penerimaan
      </Link>
      <PageHeader
        eyebrow="Gudang"
        title="Riwayat penerimaan"
        description="Penerimaan barang pembelian dan nomor faktur pemasok, termasuk status utangnya. Gunakan filter sumber untuk melihat penerimaan stok lain."
        actions={
          <Link
            href="/app/gudang/penerimaan"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-3.5" /> Penerimaan baru
          </Link>
        }
      />

      <DataList
        toolbar={
          <DataListToolbar
            action="/app/gudang/penerimaan/riwayat"
            q={params.q}
            placeholder="Cari nomor, no. invoice, atau nama pemasok…"
            resetHref={hasFilters ? "/app/gudang/penerimaan/riwayat" : undefined}
          >
            <DateRangeField
              from={{ name: "from", defaultValue: params.from ?? "" }}
              to={{ name: "to", defaultValue: params.to ?? "" }}
            />
            <select
              name="supplier"
              defaultValue={params.supplier ?? ""}
              className={dataListFilterClass}
              aria-label="Saring pemasok"
            >
              <option value="">Semua pemasok</option>
              {data.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
            <select
              name="warehouse"
              defaultValue={params.warehouse ?? ""}
              className={dataListFilterClass}
              aria-label="Saring gudang"
            >
              <option value="">Semua gudang</option>
              {data.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={params.status ?? ""}
              className={dataListFilterClass}
              aria-label="Saring status"
            >
              <option value="">Semua status</option>
              <option value="posted">Terposting</option>
              <option value="void">Dibatalkan</option>
              <option value="draft">Draf</option>
            </select>
            <select
              name="source"
              defaultValue={sourceFilter}
              className={dataListFilterClass}
              aria-label="Saring sumber"
            >
              <option value="">Semua sumber</option>
              <option value="purchase">Pembelian</option>
              <option value="opening">Stok awal</option>
              <option value="bonus">Bonus</option>
              <option value="customer_return">Retur pelanggan</option>
              <option value="other">Lainnya</option>
            </select>
          </DataListToolbar>
        }
        isEmpty={data.history.rows.length === 0}
        empty={
          <EmptyState
            title="Belum ada penerimaan"
            description="Dokumen penerimaan barang akan tampil di sini setelah dibuat."
          />
        }
        pagination={
          <Pagination
            page={data.history.page}
            pageSize={data.history.pageSize}
            total={data.history.total}
            basePath="/app/gudang/penerimaan/riwayat"
            params={historyParams}
          />
        }
      >
        <div className="hidden overflow-x-auto lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>No. faktur pemasok</th>
                <th>Tanggal</th>
                <th>Sumber</th>
                <th>Pemasok</th>
                <th>Gudang</th>
                <th className="text-right">Jumlah item</th>
                {canSeeCost ? <th className="text-right">Total</th> : null}
                {canSeeCost ? <th className="text-right">Dibayar</th> : null}
                <th>Status</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.history.rows.map((row) => {
                const isCreditPurchase = row.source === "purchase" && !row.paymentAccountId;
                return (
                  <tr key={row.id}>
                    <td className="num font-medium">
                      <Link href={`/app/gudang/penerimaan/${row.id}`} className="text-primary hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="num text-[12px]">
                      {row.source === "purchase" ? (
                        row.supplierInvoiceNumber || <span className="text-muted-foreground">Belum dicatat</span>
                      ) : "—"}
                    </td>
                    <td className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                    <td className="text-[12px]">
                      {RECEIPT_SOURCE_LABELS[row.source as keyof typeof RECEIPT_SOURCE_LABELS] ?? row.source}
                      {row.source === "purchase" && row.paymentAccountId ? (
                        <span className="text-muted-foreground"> · tunai</span>
                      ) : null}
                    </td>
                    <td className="text-[12px]">{row.supplierName ?? "—"}</td>
                    <td className="text-[11px]">{row.warehouseName ?? "—"}</td>
                    <td className="num text-right text-[11px]">{formatNumber(row.itemCount)}</td>
                    {canSeeCost ? <td className="num text-right font-medium">{formatIDR(row.total)}</td> : null}
                    {canSeeCost ? <td className="num text-right text-[11px] text-muted-foreground">{formatIDR(row.paidAmount)}</td> : null}
                    <td>
                      <div className="flex items-center gap-1">
                        {isCreditPurchase ? (
                          <StatusBadge status={row.paymentStatus} />
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {row.source === "purchase" ? "Lunas (tunai)" : "Tanpa utang"}
                          </span>
                        )}
                        {row.status === "void" ? (
                          <StatusBadge status={row.status} label="Dibatalkan" />
                        ) : row.status !== "posted" ? (
                          <StatusBadge status={row.status} />
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <ReceiptRowActions
                        id={row.id}
                        number={row.number}
                        canVoid={row.status === "posted" && can(ctx, "inventory.manage")}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-border/70 lg:hidden">
          {data.history.rows.map((row) => {
            const isCreditPurchase = row.source === "purchase" && !row.paymentAccountId;
            return (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/app/gudang/penerimaan/${row.id}`} className="num text-[12px] font-medium text-primary hover:underline">
                    {row.number}
                  </Link>
                  {canSeeCost ? <span className="num text-[12px] font-semibold">{formatIDR(row.total)}</span> : null}
                </div>
                <p className="mt-0.5 text-[12px]">
                  {row.supplierName ?? "—"}
                  <span className="text-muted-foreground">
                    {" · "}
                    {RECEIPT_SOURCE_LABELS[row.source as keyof typeof RECEIPT_SOURCE_LABELS] ?? row.source}
                    {row.source === "purchase" && row.paymentAccountId ? " · tunai" : ""}
                  </span>
                </p>
                {row.source === "purchase" ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Faktur pemasok: {row.supplierInvoiceNumber || "belum dicatat"}
                  </p>
                ) : null}
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(row.date)} · {row.warehouseName ?? "—"} · {formatNumber(row.itemCount)} item
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {isCreditPurchase ? (
                    <StatusBadge status={row.paymentStatus} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {row.source === "purchase" ? "Lunas (tunai)" : "Tanpa utang"}
                    </span>
                  )}
                  {row.status === "void" ? (
                    <StatusBadge status={row.status} label="Dibatalkan" />
                  ) : row.status !== "posted" ? (
                    <StatusBadge status={row.status} />
                  ) : null}
                  <div className="ml-auto">
                    <ReceiptRowActions
                      id={row.id}
                      number={row.number}
                      canVoid={row.status === "posted" && can(ctx, "inventory.manage")}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DataList>
    </div>
  );
}
