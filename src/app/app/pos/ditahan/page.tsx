import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listHeldSales } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR, formatNumber } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { HeldActions } from "@/components/pos/held-actions";
import { HeldAge } from "@/components/pos/held-age";

export const metadata = { title: "Pesanan ditahan" };
export const dynamic = "force-dynamic";

export default async function HeldPage() {
  const ctx = await requirePermissionPage("pos.sell");
  const rows = await withCompanyReadOnly(ctx.company.id, (tx) => listHeldSales(tx, ctx.company.id));

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Pesanan ditahan"
        description="Keranjang yang disimpan sementara. Stok belum berkurang sampai pembayaran diselesaikan."
        actions={
          <Link href="/app/pos" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90">
            Ke kasir
          </Link>
        }
      />

      {/* A-25 U8: daftar memakai DataList bersama. Aksi baris tetap
          HeldActions — "Lanjutkan" adalah aksi utama alur kasir yang
          harus selalu terlihat, bukan disembunyikan di menu ⋯. */}
      <DataList
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title="Tidak ada pesanan ditahan"
            description="Gunakan tombol Tahan di kasir untuk menyimpan keranjang yang belum dibayar."
            icon={<PauseCircle className="size-5" />}
          />
        }
      >
        <div className="hidden overflow-x-auto lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Nomor</th>
                <th>Waktu</th>
                <th>Pelanggan</th>
                <th className="text-right">Item</th>
                <th className="text-right">Nilai</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.heldLabel ?? "—"}</td>
                  <td className="num text-[12px] text-muted-foreground">{row.number}</td>
                  <td className="num text-[12px] text-muted-foreground">{formatDateTime(row.createdAt)}<HeldAge createdAt={row.createdAt} /></td>
                  <td className="text-[12px]">{row.customerName ?? "Umum"}</td>
                  <td className="num text-right text-[12px]">{formatNumber(Number(row.itemCount))}</td>
                  <td className="num text-right font-medium">{formatIDR(row.total)}</td>
                  <td>
                    <HeldActions
                      id={row.id}
                      label={row.heldLabel}
                      canDelete={row.cashierId === ctx.user.id || can(ctx, "pos.void")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border/70 lg:hidden">
          {rows.map((row) => (
            <div key={row.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-medium">{row.heldLabel ?? row.number}</span>
                <span className="num text-[12px] font-semibold">{formatIDR(row.total)}</span>
              </div>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">
                {row.number} · {formatDateTime(row.createdAt)}
                <HeldAge createdAt={row.createdAt} /> · {row.customerName ?? "Umum"} ·{" "}
                {formatNumber(Number(row.itemCount))} item
              </p>
              <div className="mt-1.5 flex justify-end">
                <HeldActions
                  id={row.id}
                  label={row.heldLabel}
                  canDelete={row.cashierId === ctx.user.id || can(ctx, "pos.void")}
                />
              </div>
            </div>
          ))}
        </div>
      </DataList>
    </div>
  );
}
