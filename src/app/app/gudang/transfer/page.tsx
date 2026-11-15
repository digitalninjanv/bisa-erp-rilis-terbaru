import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getSettings,
  listDocumentHistory,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { formGateState } from "@/lib/form-gate";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { formatDate, todayISO } from "@/lib/format";
import { formatQty } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { StatusBadge } from "@/components/blocks/status-badge";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { TransferForm } from "@/components/gudang/transfer-form";
import { StockDocumentRowActions } from "@/components/gudang/void-buttons";
import { ReceiveTransferButton } from "@/components/gudang/reservation-panel";
import { FilterChips } from "@/components/blocks/search-form";

export const metadata = { title: "Transfer stok" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function TransferPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouseRows, settings, history] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      listDocumentHistory(tx, {
        companyId: ctx.company.id,
        types: ["transfer"],
        page: parsePageParam(params.page),
        pageSize: PAGE_SIZE,
        q: params.q,
        status: params.status,
      }),
    ]);
    return {
      warehouseRows,
      docs: history.rows,
      history,
      defaultWarehouseId: pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
    };
  });

  const gate = formGateState({
    canManage: can(ctx, "inventory.manage"),
    available: data.warehouseRows.length,
    minimum: 2,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Transfer stok"
        description="Pindahkan stok antar gudang atau toko dengan dokumen yang dapat ditelusuri."
      />

      {/* A-24 T1 (SIS-05): pola sama dengan penerimaan — pesan prasyarat
          "dua gudang" hanya benar untuk peran pembuat dokumen. */}
      {gate === "form" ? (
        <TransferForm warehouses={data.warehouseRows} defaultWarehouseId={data.defaultWarehouseId} today={todayISO()} />
      ) : gate === "missing" ? (
        <GateNotice>Butuh minimal dua gudang aktif untuk melakukan transfer.</GateNotice>
      ) : (
        <GateNotice>{viewModeText("transfer stok")}</GateNotice>
      )}

      {/* SAP Fiori list-report: filter status sebagai chip kerja, bukan
          dropdown tersembunyi — "Dalam perjalanan" adalah antrean aksi
          utama penerima gudang. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <FilterChips
          options={[
            { label: "Semua", value: "" },
            { label: "Dalam perjalanan", value: "in_transit" },
            { label: "Selesai", value: "posted" },
            { label: "Dibatalkan", value: "void" },
          ]}
          value={params.status ?? ""}
          basePath="/app/gudang/transfer"
          param="status"
          q={params.q}
        />
        {params.status === "in_transit" ? (
          <p className="text-[11px] text-muted-foreground">
            Antrean penerimaan gudang tujuan — buka <em>Terima</em> pada baris dokumen.
          </p>
        ) : null}
      </div>
      <div className="mt-3">
      <DataList
        toolbar={
          <DataListToolbar
            action="/app/gudang/transfer"
            q={params.q}
            placeholder="Cari nomor dokumen atau catatan…"
            resetHref={params.q ? "/app/gudang/transfer" : undefined}
          />
        }
        isEmpty={data.docs.length === 0}
        empty={
          <EmptyState title="Belum ada transfer" description="Dokumen transfer stok akan tampil di sini." />
        }
        pagination={
          <Pagination
            page={data.history.page}
            pageSize={data.history.pageSize}
            total={data.history.total}
            basePath="/app/gudang/transfer"
            params={{ q: params.q, status: params.status }}
          />
        }
      >
          <>
          {/* A-24 T3 (SIS-08): mode kartu di bawah lg, pola A-22. */}
<div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Dari</th>
                  <th>Ke</th>
                  <th className="text-right">Item</th>
                  <th className="text-right">Qty</th>
                  <th>Catatan</th>
                  <th>Status</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.docs.map((row) => (
                  <tr key={row.id}>
                    <td className="num font-medium">
                      <Link href={`/app/gudang/dokumen/${row.id}`} className="text-primary hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                    <td className="text-[12px]">{row.warehouseName ?? "—"}</td>
                    <td className="text-[12px]">{row.toWarehouseName ?? "—"}</td>
                    <td className="num text-right text-[11px]">{Number(row.itemCount)}</td>
                    <td className="num text-right text-[11px]">{formatQty(row.totalQty)}</td>
                    <td className="max-w-[220px] truncate text-[11px] text-muted-foreground">{row.notes ?? "—"}</td>
                    <td>
                      {row.status === "void" ? (
                        <StatusBadge status="void" label="Dibatalkan" />
                      ) : row.status === "in_transit" ? (
                        <StatusBadge status="in_transit" />
                      ) : (
                        <StatusBadge status={row.status} />
                      )}
                    </td>
                    <td>
                      {can(ctx, "inventory.manage") && row.status === "in_transit" ? (
                        <span className="inline-flex items-center gap-1">
                          <ReceiveTransferButton documentId={row.id} number={row.number} />
                          <StockDocumentRowActions id={row.id} number={row.number} />
                        </span>
                      ) : row.status === "posted" && can(ctx, "inventory.manage") ? (
                        <StockDocumentRowActions id={row.id} number={row.number} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border/70 lg:hidden">
            {data.docs.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/app/gudang/dokumen/${row.id}`} className="num text-[12px] font-medium text-primary hover:underline">
                    {row.number}
                  </Link>
                  <span className="num text-[11px] text-muted-foreground">
                    {Number(row.itemCount)} item · {formatQty(row.totalQty)} qty
                  </span>
                </div>
                <p className="mt-0.5 text-[12px]">
                  {row.warehouseName ?? "—"} <span className="text-muted-foreground">→</span> {row.toWarehouseName ?? "—"}
                </p>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(row.date)}
                  {row.notes ? ` · ${row.notes}` : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {row.status === "void" ? (
                    <StatusBadge status="void" label="Dibatalkan" />
                  ) : row.status === "in_transit" ? (
                    <StatusBadge status="in_transit" />
                  ) : (
                    <StatusBadge status={row.status} />
                  )}
                  <span className="ml-auto">
                    {can(ctx, "inventory.manage") && row.status === "in_transit" ? (
                      <span className="inline-flex items-center gap-1">
                        <ReceiveTransferButton documentId={row.id} number={row.number} />
                        <StockDocumentRowActions id={row.id} number={row.number} />
                      </span>
                    ) : row.status === "posted" && can(ctx, "inventory.manage") ? (
                      <StockDocumentRowActions id={row.id} number={row.number} />
                    ) : null}
                  </span>
                </div>
              </div>
            ))}
          </div>
          </>
      </DataList>
      </div>
    </div>
  );
}
