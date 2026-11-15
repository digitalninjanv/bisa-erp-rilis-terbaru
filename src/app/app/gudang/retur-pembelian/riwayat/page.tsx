import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { PageHeader } from "@/components/blocks/page-header";
import { Pagination } from "@/components/blocks/pagination";
import { SupplierReturnList } from "@/components/gudang/supplier-return-list";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { requirePermissionPage } from "@/lib/session";
import { listSupplierReturnsPage } from "@/server/supplier-returns";

export const metadata = { title: "Riwayat Retur Pembelian" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
const STATUS_FILTERS = [
  { value: "", label: "Semua status" },
  { value: "draft", label: "Draf" },
  { value: "posted", label: "Terposting" },
  { value: "partially_resolved", label: "Sebagian selesai" },
  { value: "resolved", label: "Selesai" },
  { value: "void", label: "Batal" },
];

export default async function SupplierReturnHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = STATUS_FILTERS.some((row) => row.value !== "" && row.value === params.status)
    ? params.status
    : undefined;
  const q = params.q?.trim() || undefined;
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);

  const history = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listSupplierReturnsPage(tx, ctx.company.id, {
      status,
      q,
      page: parsePageParam(params.page),
      pageSize: PAGE_SIZE,
    }),
  );
  const hasFilters = Boolean(q || status);

  return (
    <div>
      <PageHeader
        eyebrow="Gudang · Retur Pembelian"
        title="Riwayat retur"
        description="Cari dan telusuri dokumen retur pemasok berdasarkan nomor, pemasok, atau status."
        actions={
          <>
            <Link
              href="/app/gudang/retur-pembelian"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <ArrowLeft className="size-4" /> Retur pembelian
            </Link>
            {can(ctx, "inventory.manage") ? (
              <Link
                href="/app/gudang/retur-pembelian/baru"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="size-4" /> Retur baru
              </Link>
            ) : null}
          </>
        }
      />

      <DataList
        toolbar={
          <DataListToolbar
            action="/app/gudang/retur-pembelian/riwayat"
            q={params.q}
            placeholder="Cari nomor retur atau pemasok…"
            resetHref={hasFilters ? "/app/gudang/retur-pembelian/riwayat" : undefined}
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
        isEmpty={history.rows.length === 0}
        empty={
          <EmptyState
            title={hasFilters ? "Tidak ada retur yang cocok" : "Belum ada retur pembelian"}
            description={hasFilters
              ? "Ubah kata kunci atau status, lalu coba lagi."
              : "Dokumen retur pembelian akan tampil di sini setelah dibuat."}
          />
        }
        pagination={
          <Pagination
            page={history.page}
            pageSize={history.pageSize}
            total={history.total}
            basePath="/app/gudang/retur-pembelian/riwayat"
            params={{ q, status }}
          />
        }
      >
        <SupplierReturnList rows={history.rows} canSeeCost={canSeeCost} />
      </DataList>
    </div>
  );
}
