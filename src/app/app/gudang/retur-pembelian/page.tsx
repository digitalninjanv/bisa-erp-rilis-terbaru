import Link from "next/link";
import { redirect } from "next/navigation";
import { History, Plus } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { EmptyState } from "@/components/blocks/empty-state";
import { PageHeader } from "@/components/blocks/page-header";
import { SupplierReturnList } from "@/components/gudang/supplier-return-list";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { requirePermissionPage } from "@/lib/session";
import { listSupplierReturnWorkQueue } from "@/server/supplier-returns";

export const metadata = { title: "Retur Pembelian" };
export const dynamic = "force-dynamic";

export default async function SupplierReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const legacyQuery = new URLSearchParams();
  if (params.page) legacyQuery.set("page", params.page);
  if (params.status) legacyQuery.set("status", params.status);
  if (params.q) legacyQuery.set("q", params.q);
  if (legacyQuery.size > 0) {
    redirect(`/app/gudang/retur-pembelian/riwayat?${legacyQuery.toString()}`);
  }
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);
  const queue = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listSupplierReturnWorkQueue(tx, ctx.company.id),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Gudang · Pengadaan"
        title="Retur Pembelian"
        description="Pantau draf dan klaim pemasok yang masih perlu diselesaikan. Retur dapat dimulai dari penerimaan barang atau dibuat manual."
        actions={
          <>
            <Link
              href="/app/gudang/retur-pembelian/riwayat"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <History className="size-4" /> Riwayat
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

      <section className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Perlu ditindaklanjuti</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Draf retur dan klaim kredit pemasok yang belum selesai.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {queue.total > queue.rows.length
              ? `${queue.rows.length} dari ${queue.total} dokumen`
              : `${queue.total} dokumen`}
          </span>
        </header>
        {queue.rows.length === 0 ? (
          <EmptyState
            title="Tidak ada retur yang menunggu tindakan"
            description="Draf dan klaim pemasok yang belum selesai akan tampil di sini. Retur yang sudah selesai dapat dilihat melalui Riwayat."
          />
        ) : (
          <SupplierReturnList rows={queue.rows} canSeeCost={canSeeCost} compact />
        )}
      </section>
    </div>
  );
}
