import Link from "next/link";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";
import { HandCoins } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listPaymentAccounts } from "@/server/accounting";
import { listSuppliers } from "@/server/catalog";
import { listPurchaseAdvances } from "@/server/purchase-advances";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  LIST_PAGE_SIZE,
  normalizePageParams,
  pageOffset,
  parsePageParam,
} from "@/lib/pagination";
import { formatIDR } from "@/lib/money";
import { formatDate, monthStartISO, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { StatusBadge } from "@/components/blocks/status-badge";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { DateRangeField } from "@/components/date-field";
import {
  PurchaseAdvanceForm,
  PurchaseAdvanceVoidButton,
} from "@/components/gudang/purchase-advance-form";

export const metadata = { title: "Uang muka pembelian" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  open: "Terbuka",
  partial: "Dipakai sebagian",
  used: "Terpakai",
  void: "Dibatalkan",
};

export default async function PurchaseAdvancesPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    supplier?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();
  const { page, pageSize } = normalizePageParams(
    { page: parsePageParam(params.page), pageSize: LIST_PAGE_SIZE },
    LIST_PAGE_SIZE,
  );

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [suppliers, paymentAccounts, advances] = await Promise.all([
      listSuppliers(tx, ctx.company.id),
      listPaymentAccounts(tx, ctx.company.id),
      listPurchaseAdvances(tx, ctx.company.id, {
        from,
        to,
        supplierId: params.supplier,
        status: params.status,
        page,
        pageSize,
        offset: pageOffset(page, pageSize),
      }),
    ]);
    return { suppliers, paymentAccounts, ...advances };
  });

  const canPost = can(ctx, "accounting.post");
  const hasFilters = Boolean(params.supplier || params.status || params.from || params.to);

  return (
    <div>
      <PageHeader
        title="Uang muka pembelian"
        description="Dana yang dibayar ke pemasok sebelum barang diterima. Saldo dipotong otomatis saat penerimaan barang."
      />

      {canPost ? (
        <div className="mb-3">
          <PurchaseAdvanceForm
            suppliers={data.suppliers}
            paymentAccounts={data.paymentAccounts}
            today={todayISO()}
          />
        </div>
      ) : (
        <div className="mb-3">
          <GateNotice>{viewModeText("uang muka pembelian")}</GateNotice>
        </div>
      )}

      <DataList
        density="compact"
        toolbar={
          <AutoFilterForm action="/app/gudang/uang-muka" className="flex flex-wrap items-center gap-1.5">
            <DateRangeField from={{ name: "from", defaultValue: from }} to={{ name: "to", defaultValue: to }} />
            <select
              name="supplier"
              defaultValue={params.supplier ?? ""}
              aria-label="Pemasok"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua pemasok</option>
              {data.suppliers.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={params.status ?? ""}
              aria-label="Status"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua status</option>
              <option value="open">Terbuka</option>
              <option value="partial">Dipakai sebagian</option>
              <option value="used">Terpakai</option>
              <option value="void">Dibatalkan</option>
            </select>
            <button
              type="submit"
              className="h-9 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Terapkan
            </button>
            {hasFilters ? (
              <Link
                href="/app/gudang/uang-muka"
                className="inline-flex h-9 items-center px-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Atur ulang
              </Link>
            ) : null}
          </AutoFilterForm>
        }
        isEmpty={data.rows.length === 0}
        empty={
          <EmptyState
            title="Belum ada uang muka"
            description="Uang muka/DP yang dibayarkan ke pemasok sebelum barang datang akan tampil di sini."
            icon={<HandCoins className="size-5" />}
          />
        }
        pagination={
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            basePath="/app/gudang/uang-muka"
            params={{ from, to, supplier: params.supplier, status: params.status }}
          />
        }
      >
        <div className="overflow-x-auto contain-paint">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Tanggal</th>
                <th>Sumber</th>
                <th>Pemasok</th>
                <th className="text-right">Nominal</th>
                <th className="text-right">Sisa</th>
                <th>Faktur uang muka</th>
                <th>Status</th>
                <th>Jurnal</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const isVoid = row.status === "void";
                return (
                  <tr key={row.id} className={isVoid ? "opacity-60" : undefined}>
                    <td className="num font-medium">{row.number}</td>
                    <td className="num whitespace-nowrap text-[11px] text-muted-foreground">
                      {formatDate(row.date)}
                    </td>
                    <td className="text-[11px]">
                      {row.originType === "return" ? (
                        <span className="inline-flex flex-col">
                          <span className="w-fit rounded-full bg-tone-plum-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-tone-plum">
                            Retur
                          </span>
                          {row.originReturnNumber ? (
                            <span className="num mt-0.5 text-[10px] text-muted-foreground">
                              {row.originReturnNumber}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Manual</span>
                      )}
                    </td>
                    <td className="text-[12px]">{row.supplierName}</td>
                    <td className={`num text-right font-medium ${isVoid ? "line-through" : ""}`}>
                      {formatIDR(row.amount)}
                    </td>
                    <td className="num text-right text-[12px]">{formatIDR(row.remainingAmount)}</td>
                    <td className="num text-[11px] text-muted-foreground">
                      {row.taxInvoiceNumber ?? "—"}
                    </td>
                    <td>
                      <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} />
                    </td>
                    <td>
                      {row.journalId ? (
                        <Link
                          href={`/app/akuntansi/jurnal/${row.journalId}`}
                          className="num text-[11px] font-medium text-primary transition-colors hover:underline"
                        >
                          {row.journalNumber ?? "Lihat jurnal"}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      {row.status === "open" && canPost && row.originType !== "return" ? (
                        <PurchaseAdvanceVoidButton id={row.id} number={row.number} today={todayISO()} />
                      ) : null}
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
