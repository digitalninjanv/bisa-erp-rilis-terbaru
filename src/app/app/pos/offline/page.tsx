import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  OFFLINE_REVIEW_KIND_LABELS,
  OFFLINE_SYNC_STATUS_LABELS,
  getOfflineReviewQueueSummary,
  listOfflineReviewQueuePage,
  parseOfflineReviewCursor,
} from "@/server/pos-offline";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { OfflineResolveButtons } from "@/components/pos/offline-review-panel";

export const metadata = { title: "Peninjauan Offline POS" };
export const dynamic = "force-dynamic";

export default async function PosOfflinePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; direction?: string }>;
}) {
  const ctx = await requirePermissionPage("pos.sell");
  const params = await searchParams;
  const cursor = parseOfflineReviewCursor(params.cursor);
  const direction = params.direction === "newer" ? "newer" : "older";
  // FIX-POS Tahap 2 (POS3-06): mengelola peninjauan (posting
  // penyelesaian, tandai selesai, buang) adalah tindakan supervisor —
  // kasir biasa hanya melihat status antrean. Muatan lengkap hanya
  // dikirim ke pemegang pos.void; UI yang menyembunyikan detail bukan
  // batas keamanan.
  const canManage = can(ctx, "pos.void");
  const { queue, summary } = await withCompanyReadOnly(ctx.company.id, async (tx) => ({
    queue: await listOfflineReviewQueuePage(tx, ctx.company.id, {
      includePayload: canManage,
      cursor,
      direction,
    }),
    summary: await getOfflineReviewQueueSummary(tx, ctx.company.id),
  }));

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Peninjauan Sinkronisasi Offline"
        description="Penjualan offline yang tidak dapat disinkronkan otomatis — konflik stok tidak dipaksakan masuk. Supervisor dapat memposting ulang, menyelesaikan pada harga struk offline / ke sesi asal yang tertutup, menandai selesai, atau membuang dengan catatan; semua tindakan teraudit. Antrean lokal terminal web hanya mencakup produk yang sudah dimuat; katalog penuh offline ada di aplikasi desktop POS."
      />

      {/* A-25 U8: daftar memakai DataList bersama (KPI di slot
          kpis; kepala seksi "Daftar peninjauan" dibuang — judul
          halaman sudah menyebut peninjauan). Aksi baris tetap
          OfflineResolveButtons (aksi supervisor berdialog sendiri). */}
      <DataList
        kpis={
          <SummaryStrip
            items={[
              {
                label: "Menunggu peninjauan",
                value: String(summary.total),
                hint: "Antrean belum tuntas",
                tone: summary.total > 0 ? "amber" : "default",
              },
              {
                label: "Konflik stok",
                value: String(summary.conflicts),
                hint: "Stok habis saat sinkron",
                tone: summary.conflicts > 0 ? "red" : "default",
              },
              {
                label: "Gagal lain",
                value: String(summary.failed),
                hint: "Dapat dicoba lagi dari terminal",
                tone: summary.failed > 0 ? "amber" : "default",
              },
            ]}
          />
        }
        isEmpty={summary.total === 0}
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
              {queue.items.map((row) => (
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
                    <span className="block">{row.payload.message ?? "—"}</span>
                    {canManage && row.payload.sale ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer font-medium">Rincian struk dan satuan</summary>
                        <ul className="mt-1 space-y-1">
                          {row.payload.sale.lines.map((line, index) => (
                            <li key={index}>
                              Produk {line.productId}: {line.qty} × isi {line.isiSnapshot ?? 1}
                              {" = "}{line.qty * (line.isiSnapshot ?? 1)} satuan dasar
                              {line.unitPrice != null ? ` · harga ${formatIDR(line.unitPrice)}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
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
        {(queue.newerCursor || queue.olderCursor) ? (
          <nav aria-label="Halaman peninjauan offline" className="mt-4 flex justify-between gap-3">
            {queue.newerCursor ? (
              <a
                className="rounded border border-border px-3 py-2 text-sm hover:bg-muted"
                href={`?direction=newer&cursor=${encodeURIComponent(queue.newerCursor)}`}
              >
                Lebih baru
              </a>
            ) : <span />}
            {queue.olderCursor ? (
              <a
                className="rounded border border-border px-3 py-2 text-sm hover:bg-muted"
                href={`?direction=older&cursor=${encodeURIComponent(queue.olderCursor)}`}
              >
                Lebih lama
              </a>
            ) : null}
          </nav>
        ) : null}
      </DataList>
    </div>
  );
}
