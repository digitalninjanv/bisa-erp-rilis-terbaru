import { MonitorSmartphone } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { listWarehouses } from "@/server/catalog";
import {
  getDesktopReleaseSettings,
  listPosTerminals,
  listTerminalActorOptions,
  listTerminalSessionReviews,
} from "@/server/pos";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import {
  DesktopReleaseForm,
  TerminalCreateForm,
  TerminalRowActions,
} from "@/components/pos/terminal-admin-panel";

export const metadata = { title: "Terminal Desktop POS" };
export const dynamic = "force-dynamic";

/**
 * POS Native Langkah 6 — administrasi terminal POS desktop.
 * Melihat daftar = pemegang `pos.session`; membuat/memasangkan/
 * mencabut = supervisor `pos.void` (gerbang di aksi server;
 * panelnya hanya dirender untuk supervisor, sejajar pola
 * Peninjauan offline). Di bawahnya: catatan tutup sesi terminal
 * yang dikirim aplikasi desktop — bahan peninjauan, BUKAN sesi
 * server (tidak ada jurnal yang diposting darinya).
 */
export default async function PosTerminalPage() {
  const ctx = await requirePermissionPage("pos.session");
  const canManage = can(ctx, "pos.void");
  const { terminals, reviews, warehouses, actors, release } = await withCompanyReadOnly(
    ctx.company.id,
    async (tx) => ({
      terminals: await listPosTerminals(tx, ctx.company.id),
      reviews: await listTerminalSessionReviews(tx, ctx.company.id),
      warehouses: await listWarehouses(tx, ctx.company.id),
      actors: await listTerminalActorOptions(tx, ctx.company.id),
      release: await getDesktopReleaseSettings(tx, ctx.company.id),
    }),
  );
  const actorName = new Map(actors.map((actor) => [actor.userId, actor.name]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Terminal Desktop POS"
        description="Komputer kasir yang menjalankan aplikasi Bisa POS desktop (Tauri). Pasangkan terminal dengan kode sekali pakai dari supervisor; token perangkat tersimpan di keychain OS terminal dan dapat dicabut kapan pun dari sini."
      />

      {canManage ? (
        <TerminalCreateForm
          warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
          actors={actors}
        />
      ) : null}

      {canManage ? (
        <DesktopReleaseForm
          current={
            release
              ? {
                  version: release.version,
                  rolloutPercent: release.rolloutPercent,
                  minVersion: release.minVersion,
                  notes: release.notes,
                  publishedAt: release.publishedAt.toISOString(),
                }
              : null
          }
        />
      ) : null}

      {terminals.length === 0 ? (
        <EmptyState
          size="compact"
          title="Belum ada terminal"
          description="Buat terminal pertama, terbitkan kode pasangan, lalu ketik kode itu di aplikasi desktop pada komputer kasir."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="data-table">
            <thead>
              <tr>
                <th>Terminal</th>
                <th>Gudang</th>
                <th>Kasir / aktor</th>
                <th>Status</th>
                <th>Terpasang</th>
                <th>Terakhir terlihat</th>
                {canManage ? <th className="text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {terminals.map((terminal) => (
                <tr key={terminal.id}>
                  <td className="font-medium">{terminal.name}</td>
                  <td>{terminal.warehouseName ?? "Gudang bawaan"}</td>
                  <td>{actorName.get(terminal.userId) ?? terminal.userId}</td>
                  <td>
                    <StatusBadge
                      status={terminal.status === "revoked" ? "inactive" : "active"}
                      label={terminal.status === "revoked" ? "Dicabut" : "Aktif"}
                    />{" "}
                    <span className="text-muted-foreground">
                      {terminal.paired ? "· terpasang" : "· belum dipasangkan"}
                    </span>
                  </td>
                  <td>{terminal.pairedAt ? formatDateTime(terminal.pairedAt) : "—"}</td>
                  <td>{terminal.lastSeenAt ? formatDateTime(terminal.lastSeenAt) : "—"}</td>
                  {canManage ? (
                    <td>
                      <TerminalRowActions
                        terminalId={terminal.id}
                        terminalName={terminal.name}
                        status={terminal.status}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <MonitorSmartphone className="size-4" /> Tutup sesi dari terminal
        </h3>
        <p className="text-[12px] text-muted-foreground">
          Fakta tutup sesi buta yang dikirim terminal desktop (modal awal, hitungan fisik,
          harapan lokal, selisih). Catatan peninjauan saja — posting sesi &amp; jurnal tetap
          milik sesi POS web.
        </p>
        {reviews.length === 0 ? (
          <EmptyState
            size="compact"
            title="Belum ada tutup sesi terminal"
            description="Tutup sesi pertama dari aplikasi desktop akan tercatat di sini sesudah tersinkron."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Diterima</th>
                  <th>Terminal</th>
                  <th>Kasir</th>
                  <th>Ditutup</th>
                  <th className="text-right">Modal awal</th>
                  <th className="text-right">Harapan</th>
                  <th className="text-right">Fisik</th>
                  <th className="text-right">Selisih</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id}>
                    <td>{formatDateTime(review.receivedAt)}</td>
                    <td className="font-medium">{review.terminalName}</td>
                    <td>
                      {review.cashierId
                        ? (actorName.get(review.cashierId) ?? review.cashierId)
                        : "—"}
                    </td>
                    <td>{formatDateTime(review.closedAt)}</td>
                    <td className="num text-right">{formatIDR(Number(review.openingCash))}</td>
                    <td className="num text-right">{formatIDR(Number(review.expectedCash))}</td>
                    <td className="num text-right">{formatIDR(Number(review.countedCash))}</td>
                    <td className="num text-right">{formatIDR(Number(review.difference))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
