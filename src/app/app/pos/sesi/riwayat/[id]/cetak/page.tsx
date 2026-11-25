import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withCompany } from "@/db/tenant";
import { getCashSessionHistoryDetail } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/server/audit";
import { d, formatIDR } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Laporan Tutup Sesi" };
export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-black/10 py-1">
      <span>{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}

export default async function SessionZReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string; x?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const isX = query.x === "1";
  const ctx = await requirePermissionPage("pos.session");
  const data = await withCompany(ctx.company.id, async (tx) => {
    const detail = await getCashSessionHistoryDetail(tx, ctx.company.id, id);
    if (!detail) return null;
    // Laporan X untuk sesi terbuka memuat angka rekonsiliasi; hanya
    // supervisor yang boleh melihatnya agar hitung kas tetap buta.
    if (detail.session.status !== "closed" && !can(ctx, "pos.void")) return null;
    const settings = await getSettings(tx, ctx.company.id);
    await writeAudit(tx, {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: isX ? "pos.session.x_report" : "pos.session.z_report",
      entityType: "cash_session",
      entityId: id,
      after: { number: detail.session.id.slice(0, 8).toUpperCase() },
    });
    return { detail, settings };
  });
  if (!data) notFound();

  const { detail, settings } = data;
  const { session, totals } = detail;
  const printSettings = toPrintSettings(settings, "z_report");
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(`SESI-${session.id.slice(0, 8)}`) : null;
  const closed = session.status === "closed";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/app/pos/sesi/riwayat/${session.id}`}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Kembali ke rincian sesi
        </Link>
        <ReceiptPrint auto={query.autoprint === "1"} />
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
          <PrintHeader
            settings={printSettings}
            companyName={settings?.legalName ?? "Bisa Minimarket"}
            address={settings?.address}
            phone={settings?.phone}
            taxId={settings?.taxId}
            variant="document"
            title={isX ? "Laporan Sementara (X)" : "Laporan Tutup Sesi (Z)"}
            number={session.id.slice(0, 8).toUpperCase()}
            dateLabel={formatDateTime(session.closedAt ?? session.openedAt)}
          />

          {!closed ? (
            <p className="my-2 border-y-2 border-double border-black py-1 text-center text-[12px] font-bold uppercase tracking-widest">
              Sesi belum ditutup — laporan sementara
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
            <div>
              <p className="text-black/60">Kasir</p>
              <p className="font-medium">{session.userName ?? "—"}</p>
              <p className="mt-2 text-black/60">Cabang</p>
              <p className="font-medium">{session.branchName ?? "—"}</p>
            </div>
            <div>
              <p className="text-black/60">Dibuka</p>
              <p className="font-medium">{formatDateTime(session.openedAt)}</p>
              <p className="mt-2 text-black/60">Ditutup</p>
              <p className="font-medium">{session.closedAt ? formatDateTime(session.closedAt) : "—"}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <section>
              <h2 className="border-b border-black/60 pb-1 text-[12px] font-semibold uppercase tracking-wide">
                Ringkasan penjualan
              </h2>
              <div className="mt-1.5 text-[12px]">
                <Row label="Transaksi selesai" value={`${detail.transactionCount}`} />
                <Row label="Total penjualan" value={formatIDR(detail.grossSales)} />
                <Row label="Penjualan tunai" value={formatIDR(totals.salesTotal)} />
                <Row label="Penerimaan piutang" value={formatIDR(totals.receivableTotal)} />
                <Row label="Refund tunai" value={formatIDR(totals.refundsTotal)} />
              </div>
            </section>

            <section>
              <h2 className="border-b border-black/60 pb-1 text-[12px] font-semibold uppercase tracking-wide">
                Rekonsiliasi kas
              </h2>
              <div className="mt-1.5 text-[12px]">
                <Row label="Modal awal" value={formatIDR(session.openingCash)} />
                <Row label="Tarik dari bank" value={formatIDR(totals.withdrawalsTotal)} />
                <Row label="Setor ke bank" value={formatIDR(totals.depositsTotal)} />
                <Row label="Kas seharusnya" value={formatIDR(totals.expectedCash)} />
                <Row
                  label="Uang dihitung"
                  value={session.countedCash != null ? formatIDR(session.countedCash) : "—"}
                />
                <Row
                  label="Selisih"
                  value={
                    session.difference != null
                      ? `${d(session.difference).isNegative() ? "−" : ""}${formatIDR(d(session.difference).abs())}`
                      : "—"
                  }
                />
              </div>
            </section>
          </div>

          {detail.paymentBreakdown.length > 0 ? (
            <section className="mt-4">
              <h2 className="border-b border-black/60 pb-1 text-[12px] font-semibold uppercase tracking-wide">
                Rincian metode pembayaran
              </h2>
              <table className="mt-1.5 w-full text-[12px]">
                <thead>
                  <tr className="border-b border-black/30 text-left">
                    <th className="py-1 pr-2 font-semibold">Metode</th>
                    <th className="py-1 pr-2 font-semibold">Tipe</th>
                    <th className="py-1 pr-2 text-right font-semibold">Jumlah</th>
                    <th className="py-1 text-right font-semibold">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.paymentBreakdown.map((row) => (
                    <tr key={`${row.methodType}-${row.methodName}`} className="border-b border-black/10">
                      <td className="py-1 pr-2">{row.methodName}</td>
                      <td className="py-1 pr-2 uppercase">{row.methodType}</td>
                      <td className="num py-1 pr-2 text-right">{formatIDR(row.amount)}</td>
                      <td className="num py-1 text-right">{formatIDR(row.fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="mt-4">
            <h2 className="border-b border-black/60 pb-1 text-[12px] font-semibold uppercase tracking-wide">
              Mutasi kas
            </h2>
            {detail.movements.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-black/60">Tidak ada mutasi kas.</p>
            ) : (
              <table className="mt-1.5 w-full text-[11px]">
                <thead>
                  <tr className="border-b border-black/30 text-left">
                    <th className="py-1 pr-2 font-semibold">Waktu</th>
                    <th className="py-1 pr-2 font-semibold">Jenis</th>
                    <th className="py-1 pr-2 font-semibold">Keterangan</th>
                    <th className="py-1 text-right font-semibold">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.movements.map((movement) => (
                    <tr key={movement.id} className="border-b border-black/10">
                      <td className="num py-1 pr-2 whitespace-nowrap">{formatDateTime(movement.createdAt)}</td>
                      <td className="py-1 pr-2">{movement.type}</td>
                      <td className="py-1 pr-2">{movement.notes ?? "—"}</td>
                      <td className="num py-1 text-right">{formatIDR(movement.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {session.notes ? (
            <p className="mt-3 text-[11px]">
              <span className="text-black/60">Catatan: </span>
              {session.notes}
            </p>
          ) : null}
          <p className="mt-2 text-[10px] text-black/50">Dicetak {formatDate(new Date())}</p>

          <PrintFooter
            settings={printSettings}
            documentNumber={`SESI-${session.id.slice(0, 8).toUpperCase()}`}
            variant="document"
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
            signatures={[
              { label: "Kasir", name: session.userName ?? undefined },
              { label: "Diperiksa oleh" },
            ]}
          />
        </PrintShell>
      </div>
    </div>
  );
}