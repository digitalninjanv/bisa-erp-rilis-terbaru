import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { getCashSessionHistoryDetail } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import {
  DifferenceText,
  SessionStatusBadge,
  cashMovementLabel,
} from "@/components/pos/session-history-list";

export const metadata = { title: "Rincian sesi kas" };
export const dynamic = "force-dynamic";

function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 text-[13px] font-medium">{children}</dd>
    </div>
  );
}

export default async function SessionHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissionPage("pos.session");
  const detail = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    getCashSessionHistoryDetail(tx, ctx.company.id, id),
  );
  if (!detail) notFound();

  const { session, totals } = detail;
  const closed = session.status === "closed";

  return (
    <div>
      <Link
        href="/app/pos/sesi/riwayat"
        className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Kembali ke riwayat sesi
      </Link>
      <PageHeader
        eyebrow="POS"
        title="Rincian sesi kas"
        description={`${session.userName ?? "Kasir"}${session.branchName ? ` · ${session.branchName}` : ""} · dibuka ${formatDateTime(session.openedAt)}`}
        actions={
          <Link
            href={`/app/pos/sesi/riwayat/${session.id}/cetak`}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Cetak laporan Z
          </Link>
        }
      />

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Ringkasan sesi</h2>
          <SessionStatusBadge status={session.status} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 md:grid-cols-4">
          <SummaryItem label="Kasir">{session.userName ?? "—"}</SummaryItem>
          <SummaryItem label="Cabang">{session.branchName ?? "—"}</SummaryItem>
          <SummaryItem label="Dibuka">{formatDateTime(session.openedAt)}</SummaryItem>
          <SummaryItem label="Ditutup">
            {closed && session.closedAt ? formatDateTime(session.closedAt) : "Masih terbuka"}
          </SummaryItem>
          <SummaryItem label="Jumlah transaksi">{detail.transactionCount} penjualan</SummaryItem>
          <SummaryItem label="Modal awal">{formatIDR(session.openingCash)}</SummaryItem>
          <SummaryItem label="Penjualan tunai">{formatIDR(totals.salesTotal)}</SummaryItem>
          <SummaryItem label="Tarik dari bank">{formatIDR(totals.withdrawalsTotal)}</SummaryItem>
          <SummaryItem label="Total masuk">{formatIDR(totals.totalIn)}</SummaryItem>
          <SummaryItem label="Refund tunai">{formatIDR(totals.refundsTotal)}</SummaryItem>
          <SummaryItem label="Setor ke bank">{formatIDR(totals.depositsTotal)}</SummaryItem>
          <SummaryItem label="Total keluar">{formatIDR(totals.totalOut)}</SummaryItem>
          <SummaryItem label="Saldo seharusnya">{formatIDR(totals.expectedCash)}</SummaryItem>
          {closed ? (
            <>
              <SummaryItem label="Uang dihitung saat tutup">
                {session.countedCash != null ? formatIDR(session.countedCash) : "—"}
              </SummaryItem>
              <SummaryItem label="Selisih">
                <DifferenceText difference={session.difference} />
              </SummaryItem>
            </>
          ) : null}
        </dl>
        {session.notes ? (
          <p className="border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
            Catatan penutup: {session.notes}
          </p>
        ) : null}
      </section>

      {/* A-25 U8: tabel mutasi memakai DataList bersama; judul seksi
          berdiri di atas kartu (tidak mengulang judul halaman) dan
          penjelasan urutan pindah ke catatan kaki daftar. */}
      <div className="mt-4">
        <h2 className="mb-2 text-[13px] font-semibold">Mutasi kas sesi</h2>
        <DataList
          isEmpty={detail.movements.length === 0}
          empty={
            <EmptyState title="Belum ada mutasi" description="Mutasi kas sesi ini akan tampil di sini." />
          }
          footerNote="Semua pergerakan uang laci pada sesi ini, urut dari yang paling awal."
        >
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Jenis</th>
                  <th scope="col">Keterangan</th>
                  <th scope="col">Oleh</th>
                  <th scope="col" className="text-right">Nominal</th>
                </tr>
              </thead>
              <tbody>
                {detail.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="num text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(movement.createdAt)}
                    </td>
                    <td className="text-[12px] font-medium">{cashMovementLabel(movement.type)}</td>
                    <td className="max-w-[320px] truncate text-[12px] text-muted-foreground">
                      {movement.notes ?? "—"}
                    </td>
                    <td className="text-[12px]">{movement.createdByName ?? "—"}</td>
                    <td
                      className={`num text-right font-medium ${d(movement.amount).isNegative() ? "text-destructive" : ""}`}
                    >
                      {formatIDR(movement.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataList>
      </div>
    </div>
  );
}
