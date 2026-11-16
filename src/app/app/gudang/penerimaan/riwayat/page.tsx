import Link from "next/link";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listReceiptHistory, listSuppliers, listWarehouses } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { formatDate } from "@/lib/format";
import { formatIDR, formatNumber } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { ReceiptRowActions } from "@/components/gudang/void-buttons";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Riwayat penerimaan" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

const SHORT_SOURCE_LABELS: Record<string, string> = {
  purchase: "Pembelian",
  opening: "Stok awal",
  bonus: "Bonus",
  customer_return: "Retur pelanggan",
  other: "Lainnya",
};

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
    returnStatus?: string;
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
        returnStatus: params.returnStatus,
      }),
      listSuppliers(tx, ctx.company.id),
      listWarehouses(tx, ctx.company.id),
    ]);
    return { history, suppliers, warehouses };
  });

  const hasFilters = Boolean(
    params.q ||
      params.from ||
      params.to ||
      params.supplier ||
      params.warehouse ||
      params.status ||
      params.returnStatus ||
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
    returnStatus: params.returnStatus,
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
        description="Arsip dan status penerimaan barang gudang, faktur pemasok, dan penyelesaian retur."
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
        density="compact"
        toolbar={
          <AutoFilterForm action="/app/gudang/penerimaan/riwayat" className="space-y-2">
            {/* Baris 1: Pencarian teks utama + rentang tanggal + aksi submit/reset */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  defaultValue={params.q}
                  placeholder="Cari nomor, no. invoice, atau pemasok…"
                  aria-label="Kata kunci pencarian"
                  className="field-control h-8.5 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <DateRangeField
                from={{ name: "from", defaultValue: params.from ?? "" }}
                to={{ name: "to", defaultValue: params.to ?? "" }}
              />
              <button
                type="submit"
                className="inline-flex h-8.5 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Cari
              </button>
              {hasFilters ? (
                <Link
                  href="/app/gudang/penerimaan/riwayat"
                  className="inline-flex h-8.5 items-center px-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Atur ulang
                </Link>
              ) : null}
            </div>

            {/* Baris 2: Filter facet terstruktur tanpa wrap liar */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-1">
              <select
                name="status"
                defaultValue={params.status ?? ""}
                className="field-control h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                aria-label="Saring status penerimaan"
              >
                <option value="">Semua status</option>
                <option value="posted">Terposting</option>
                <option value="void">Dibatalkan</option>
                <option value="draft">Draf</option>
              </select>
              <select
                name="returnStatus"
                defaultValue={params.returnStatus ?? ""}
                className="field-control h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                aria-label="Saring status retur"
              >
                <option value="">Semua status retur</option>
                <option value="none">Belum diretur</option>
                <option value="returned">Diretur (sebagian / penuh)</option>
                <option value="full">Diretur penuh</option>
                <option value="has_draft">Ada draf retur</option>
              </select>
              <select
                name="source"
                defaultValue={sourceFilter}
                className="field-control h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                aria-label="Saring sumber"
              >
                <option value="">Semua sumber</option>
                <option value="purchase">Pembelian</option>
                <option value="opening">Stok awal</option>
                <option value="bonus">Bonus</option>
                <option value="customer_return">Retur pelanggan</option>
                <option value="other">Lainnya</option>
              </select>
              <select
                name="supplier"
                defaultValue={params.supplier ?? ""}
                className="field-control h-8 max-w-[200px] truncate rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                aria-label="Saring pemasok"
              >
                <option value="">Semua pemasok</option>
                {data.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              <select
                name="warehouse"
                defaultValue={params.warehouse ?? ""}
                className="field-control h-8 max-w-[170px] truncate rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                aria-label="Saring gudang"
              >
                <option value="">Semua gudang</option>
                {data.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </div>
          </AutoFilterForm>
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
        {/* Tampilan Tabel Desktop */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>No. faktur</th>
                <th>Tanggal</th>
                <th>Sumber</th>
                <th>Pemasok</th>
                <th>Gudang</th>
                <th className="text-right">Item</th>
                {canSeeCost ? <th className="text-right">Total</th> : null}
                {canSeeCost ? <th className="text-right">Dibayar</th> : null}
                <th>Status</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.history.rows.map((row) => {
                const isCreditPurchase = row.source === "purchase" && !row.paymentAccountId;
                const canManage = can(ctx, "inventory.manage");
                const hasReturnDoc = Boolean(row.latestReturn);

                const extraActionItems =
                  row.source === "purchase" && row.status === "posted" && row.supplierName && canManage
                    ? [
                        ...(hasReturnDoc && row.latestReturn
                          ? [
                              {
                                key: "view_return",
                                label: `Lihat retur (${row.latestReturn.number})`,
                                href: `/app/gudang/retur-pembelian/${row.latestReturn.id}`,
                              },
                            ]
                          : []),
                        ...(row.returnStatus !== "full"
                          ? [
                              {
                                key: "create_return",
                                label:
                                  row.returnStatus === "has_draft" && row.latestReturn
                                    ? "Buka draf retur"
                                    : "Buat retur pembelian",
                                href:
                                  row.returnStatus === "has_draft" && row.latestReturn
                                    ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                                    : `/app/gudang/retur-pembelian/baru?receiptId=${row.id}`,
                              },
                            ]
                          : []),
                      ]
                    : undefined;

                return (
                  <tr key={row.id}>
                    <td className="num font-semibold">
                      <Link
                        href={`/app/gudang/penerimaan/${row.id}`}
                        className="text-primary hover:underline"
                      >
                        {row.number}
                      </Link>
                    </td>
                    <td className="num text-[12px]">
                      {row.source === "purchase" && row.supplierInvoiceNumber ? (
                        <span className="font-mono">{row.supplierInvoiceNumber}</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="num whitespace-nowrap text-[12px] text-muted-foreground">
                      {formatDate(row.date)}
                    </td>
                    <td className="whitespace-nowrap text-[12px]">
                      <span>{SHORT_SOURCE_LABELS[row.source] ?? row.source}</span>
                      {row.source === "purchase" && row.paymentAccountId ? (
                        <span className="text-[10px] text-muted-foreground"> · tunai</span>
                      ) : null}
                    </td>
                    <td
                      className="max-w-[180px] truncate text-[12px] font-medium"
                      title={row.supplierName ?? undefined}
                    >
                      {row.supplierName ?? "—"}
                    </td>
                    <td
                      className="max-w-[130px] truncate text-[11px] text-muted-foreground"
                      title={row.warehouseName ?? undefined}
                    >
                      {row.warehouseName ?? "—"}
                    </td>
                    <td className="num text-right text-[12px]">
                      {formatNumber(row.itemCount)}
                    </td>
                    {canSeeCost ? (
                      <td className="num text-right font-medium">{formatIDR(row.total)}</td>
                    ) : null}
                    {canSeeCost ? (
                      <td className="num text-right text-[11px] text-muted-foreground">
                        {formatIDR(row.paidAmount)}
                      </td>
                    ) : null}
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.status === "void" ? (
                          <StatusBadge status="void" label="Dibatalkan" />
                        ) : isCreditPurchase ? (
                          <StatusBadge status={row.paymentStatus} />
                        ) : (
                          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {row.source === "purchase" ? "Lunas" : "Tanpa utang"}
                          </span>
                        )}
                        {row.returnStatus === "full" ? (
                          <Link
                            href={
                              row.latestReturn
                                ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                                : "#"
                            }
                            title={`Diretur penuh${row.latestReturn ? `: ${row.latestReturn.number}` : ""}`}
                            className="inline-flex items-center rounded bg-tone-red-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-red transition-opacity hover:opacity-80"
                          >
                            Diretur penuh
                          </Link>
                        ) : row.returnStatus === "partial" ? (
                          <Link
                            href={
                              row.latestReturn
                                ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                                : "#"
                            }
                            title={`Diretur sebagian${row.latestReturn ? `: ${row.latestReturn.number}` : ""}`}
                            className="inline-flex items-center rounded bg-tone-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-amber transition-opacity hover:opacity-80"
                          >
                            Diretur sebagian
                          </Link>
                        ) : row.returnStatus === "has_draft" ? (
                          <Link
                            href={
                              row.latestReturn
                                ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                                : "#"
                            }
                            title={`Ada draf retur${row.latestReturn ? `: ${row.latestReturn.number}` : ""}`}
                            className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary transition-opacity hover:opacity-80"
                          >
                            Draf retur
                          </Link>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-right">
                      <ReceiptRowActions
                        id={row.id}
                        number={row.number}
                        canVoid={
                          row.status === "posted" && canManage && row.returnStatus === "none"
                        }
                        extraItems={extraActionItems}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Tampilan Kartu Mobile */}
        <div className="divide-y divide-border/70 lg:hidden">
          {data.history.rows.map((row) => {
            const isCreditPurchase = row.source === "purchase" && !row.paymentAccountId;
            const canManage = can(ctx, "inventory.manage");
            const hasReturnDoc = Boolean(row.latestReturn);

            const extraActionItems =
              row.source === "purchase" && row.status === "posted" && row.supplierName && canManage
                ? [
                    ...(hasReturnDoc && row.latestReturn
                      ? [
                          {
                            key: "view_return",
                            label: `Lihat retur (${row.latestReturn.number})`,
                            href: `/app/gudang/retur-pembelian/${row.latestReturn.id}`,
                          },
                        ]
                      : []),
                    ...(row.returnStatus !== "full"
                      ? [
                          {
                            key: "create_return",
                            label:
                              row.returnStatus === "has_draft" && row.latestReturn
                                ? "Buka draf retur"
                                : "Buat retur pembelian",
                            href:
                              row.returnStatus === "has_draft" && row.latestReturn
                                ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                                : `/app/gudang/retur-pembelian/baru?receiptId=${row.id}`,
                          },
                        ]
                      : []),
                  ]
                : undefined;

            return (
              <div key={row.id} className="space-y-2 p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/app/gudang/penerimaan/${row.id}`}
                      className="num text-[13px] font-semibold text-primary hover:underline"
                    >
                      {row.number}
                    </Link>
                    {row.supplierInvoiceNumber ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        ({row.supplierInvoiceNumber})
                      </span>
                    ) : null}
                  </div>
                  {canSeeCost ? (
                    <span className="num text-[13px] font-semibold">{formatIDR(row.total)}</span>
                  ) : null}
                </div>

                <div className="text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground">{row.supplierName ?? "—"}</span>
                  {" · "}
                  <span>{SHORT_SOURCE_LABELS[row.source] ?? row.source}</span>
                  {row.source === "purchase" && row.paymentAccountId ? " (tunai)" : ""}
                  {" · "}
                  <span>{row.warehouseName ?? "—"}</span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {formatDate(row.date)} · {formatNumber(row.itemCount)} item
                  </span>
                  {canSeeCost && isCreditPurchase && row.paidAmount ? (
                    <span>Dibayar: {formatIDR(row.paidAmount)}</span>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.status === "void" ? (
                      <StatusBadge status="void" label="Dibatalkan" />
                    ) : isCreditPurchase ? (
                      <StatusBadge status={row.paymentStatus} />
                    ) : (
                      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {row.source === "purchase" ? "Lunas" : "Tanpa utang"}
                      </span>
                    )}
                    {row.returnStatus === "full" ? (
                      <Link
                        href={
                          row.latestReturn
                            ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                            : "#"
                        }
                        className="inline-flex items-center rounded bg-tone-red-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-red"
                      >
                        Diretur penuh
                      </Link>
                    ) : row.returnStatus === "partial" ? (
                      <Link
                        href={
                          row.latestReturn
                            ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                            : "#"
                        }
                        className="inline-flex items-center rounded bg-tone-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-amber"
                      >
                        Diretur sebagian
                      </Link>
                    ) : row.returnStatus === "has_draft" ? (
                      <Link
                        href={
                          row.latestReturn
                            ? `/app/gudang/retur-pembelian/${row.latestReturn.id}`
                            : "#"
                        }
                        className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                      >
                        Draf retur
                      </Link>
                    ) : null}
                  </div>

                  <ReceiptRowActions
                    id={row.id}
                    number={row.number}
                    canVoid={
                      row.status === "posted" && canManage && row.returnStatus === "none"
                    }
                    extraItems={extraActionItems}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </DataList>
    </div>
  );
}
