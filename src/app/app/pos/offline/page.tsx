import { CloudOff } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  OFFLINE_REVIEW_KIND_LABELS,
  OFFLINE_SYNC_STATUS_LABELS,
  listOfflineReviewQueue,
} from "@/server/pos-offline";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { StatCard } from "@/components/blocks/stat-card";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { OfflineResolveButtons } from "@/components/pos/offline-review-panel";

export const metadata = { title: "Peninjauan Offline POS" };
export const dynamic = "force-dynamic";

export default async function PosOfflinePage() {
  const ctx = await requirePermissionPage("pos.sell");
  const queue = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listOfflineReviewQueue(tx, ctx.company.id),
  );
  // FIX-POS Tahap 2 (POS3-06): mengelola peninjauan (posting
  // penyelesaian, tandai selesai, buang) adalah tindakan supervisor —
  // kasir biasa hanya melihat status antrean.
  const canManage = can(ctx, "pos.void");
  const conflicts = queue.filter((row) => row.payload.status === "conflict");
  const failed = queue.filter((row) => row.payload.status === "failed");

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Peninjauan Sinkronisasi Offline"
        description="Penjualan offline yang tidak dapat disinkronkan otomatis — konflik stok tidak dipaksakan masuk. Supervisor dapat memposting ulang, menyelesaikan pada harga struk offline / ke sesi asal yang tertutup, menandai selesai, atau membuang dengan catatan; semua tindakan teraudit."
      />

      {/* A-25 U8: daftar memakai DataList bersama (KPI di slot
          kpis; kepala seksi "Daftar peninjauan" dibuang — judul
          halaman sudah menyebut peninjauan). Aksi baris tetap
          OfflineResolveButtons (aksi supervisor berdialog sendiri). */}
      <DataList
        kpis={
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            <StatCard label="Menunggu peninjauan" value={String(queue.length)} hint="Antrean belum tuntas" icon={CloudOff} tone="amber" />
            <StatCard label="Konflik stok" value={String(conflicts.length)} hint="Stok habis saat sinkron" tone="plum" />
            <StatCard label="Gagal lain" value={String(failed.length)} hint="Dapat dicoba lagi dari terminal" tone="teal" />
          </div>
        }
        isEmpty={queue.length === 0}
        empty={
          <EmptyState title="Tidak ada antrean bermasalah" description="Semua penjualan offline berhasil disinkronkan atau belum ada penjualan offline." />
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Waktu sinkron</th>
                <th>Kunci klien</th>
                <th>Kasir asal</th>
                <th>Tanggal jual</th>
                <th className="text-right">Baris</th>
                <th className="text-right">Total bayar</th>
                <th>Status</th>
                <th>Pesan</th>
                {canManage ? <th className="text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <tr key={row.id}>
                  <td className="text-[11px] text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                  <td className="num max-w-[160px] truncate text-[11px] text-muted-foreground">{row.payload.clientKey}</td>
                  <td className="num max-w-[120px] truncate text-[11px] text-muted-foreground">
                    {row.payload.origin?.cashierId ?? "—"}
                  </td>
                  <td className="text-[12px]">{formatDate(row.payload.date)}</td>
                  <td className="num text-right text-[12px]">{row.payload.lineCount}</td>
                  <td className="num text-right text-[12px]">{formatIDR(row.payload.totalPayments)}</td>
                  <td>
                    <StatusBadge
                      status={row.payload.status}
                      label={
                        (row.payload.kind
                          ? OFFLINE_REVIEW_KIND_LABELS[row.payload.kind]
                          : undefined) ??
                        OFFLINE_SYNC_STATUS_LABELS[row.payload.status] ??
                        row.payload.status
                      }
                    />
                  </td>
                  <td className="max-w-[260px] text-[11px] text-muted-foreground">
                    <span className="block truncate">{row.payload.message ?? "—"}</span>
                    {row.payload.priceConflict ? (
                      <span className="block">
                        Struk {formatIDR(row.payload.priceConflict.expectedTotal)} · kini{" "}
                        {formatIDR(row.payload.priceConflict.currentTotal)} · selisih{" "}
                        {formatIDR(Math.abs(row.payload.priceConflict.difference))}
                      </span>
                    ) : null}
                  </td>
                  {canManage ? (
                    <td className="text-right">
                      <OfflineResolveButtons
                        id={row.id}
                        clientKey={row.payload.clientKey}
                        canPost={row.payload.canPost}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>
    </div>
  );
}
