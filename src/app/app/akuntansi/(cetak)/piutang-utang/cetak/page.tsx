import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { listPayables, listReceivables } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { formatDate, todayISO } from "@/lib/format";
import { toPrintSettings } from "@/components/print/types";
import { documentQrDataUrl } from "@/components/print/qr";
import {
  PrintAmount,
  ReportDocument,
  ReportPrintPageShell,
  type ReportCompanyIdentity,
} from "@/components/akuntansi/report-document";

export const metadata = { title: "Cetak laporan umur piutang/utang" };
export const dynamic = "force-dynamic";

// FIX-R2 (RD2-03): aging sebelumnya tidak punya jalur cetak resmi
// sama sekali — hanya layar dan CSV. Halaman ini mencetak matriks
// umur yang sama dengan layar dan ekspor aging (bucket umur dari
// tanggal dokumen: 0–30 / 31–60 / 61–90 / >90 hari) di dalam kerangka
// dokumen PrintShell, dengan total per kolom umur.

type AgingRow = {
  key: string;
  number: string;
  date: string;
  party: string;
  dueDate: string | null;
  outstanding: number;
};

function ageDays(asOf: string, date: string): number {
  const diff = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function bucketIndex(days: number): number {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  return 3;
}

export default async function AgingPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; autoprint?: string }>;
}) {
  const params = await searchParams;
  const kind = params.kind === "utang" ? "utang" : params.kind === "piutang" ? "piutang" : null;
  if (!kind) notFound();
  const ctx = await requirePermissionPage("accounting.view");
  const asOf = todayISO();
  const isReceivable = kind === "piutang";

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const settings = await getSettings(tx, ctx.company.id);
    const raw = isReceivable ? await listReceivables(tx, ctx.company.id) : await listPayables(tx, ctx.company.id);
    const rows: AgingRow[] = raw
      .filter((row) => row.outstanding > 0.004)
      .map((row) => ({
        key: row.id,
        number: row.number,
        date: row.date,
        party: ("customerName" in row ? row.customerName : row.supplierName) ?? "—",
        dueDate: row.dueDate,
        outstanding: row.outstanding,
      }));
    return { settings, rows };
  });

  const printSettings = toPrintSettings(data.settings);
  const company: ReportCompanyIdentity = {
    legalName: data.settings.legalName ?? ctx.company.name,
    address: data.settings.address,
    phone: data.settings.phone,
    taxId: data.settings.taxId,
  };
  const reference = `${isReceivable ? "LUP" : "LUU"}-${asOf}`;
  const qrDataUrl = printSettings.showQr
    ? await documentQrDataUrl(`${company.legalName} | ${reference} | ${ctx.company.id}`).catch(() => null)
    : null;

  const totals = [0, 0, 0, 0];
  let grandTotal = 0;
  for (const row of data.rows) {
    totals[bucketIndex(ageDays(asOf, row.dueDate ?? row.date))] += row.outstanding;
    grandTotal += row.outstanding;
  }
  const bucketHeaders = ["0–30 hari", "31–60 hari", "61–90 hari", ">90 hari"];
  const amountCell = "num min-w-[100px] py-1.5 text-right whitespace-nowrap";

  return (
    <ReportPrintPageShell
      backHref="/app/akuntansi/piutang-utang"
      backLabel="Piutang & utang"
      eyebrow={isReceivable ? "Piutang · Cetak resmi" : "Utang · Cetak resmi"}
      heading={isReceivable ? "Laporan Umur Piutang" : "Laporan Umur Utang"}
      auto={params.autoprint === "1"}
    >
      <ReportDocument
        company={company}
        settings={printSettings}
        title={isReceivable ? "Laporan Umur Piutang" : "Laporan Umur Utang"}
        periodStatement={`Per ${formatDate(asOf)}`}
        reference={reference}
        printedByName={ctx.user.name}
        qrDataUrl={qrDataUrl}
      >
        <table className="w-full text-[12px]">
          <thead className="text-[10px] uppercase tracking-wide opacity-60">
            <tr>
              <th className="py-1.5 text-left font-medium">Nomor</th>
              <th className="py-1.5 text-left font-medium">Tanggal</th>
              <th className="py-1.5 text-left font-medium">{isReceivable ? "Pelanggan" : "Pemasok"}</th>
              <th className="py-1.5 text-left font-medium">Jatuh tempo</th>
              {bucketHeaders.map((header) => (
                <th key={header} className="py-1.5 text-right font-medium">{header}</th>
              ))}
              <th className="py-1.5 text-right font-medium">Total sisa</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-2 opacity-60">
                  Tidak ada {isReceivable ? "piutang" : "utang"} terbuka per tanggal ini.
                </td>
              </tr>
            ) : (
              data.rows.map((row, index) => {
                const bucket = bucketIndex(ageDays(asOf, row.dueDate ?? row.date));
                return (
                  <tr key={row.key}>
                    <td className="num py-1.5">{row.number}</td>
                    <td className="py-1.5">{formatDate(row.date)}</td>
                    <td className="py-1.5">{row.party}</td>
                    <td className="py-1.5">{row.dueDate ? formatDate(row.dueDate) : "—"}</td>
                    {bucketHeaders.map((header, bucketIdx) => (
                      <td key={header} className={amountCell}>
                        <PrintAmount value={bucketIdx === bucket ? row.outstanding : 0} symbol={index === 0 && bucketIdx === bucket} />
                      </td>
                    ))}
                    <td className={amountCell}>
                      <PrintAmount value={row.outstanding} symbol={false} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="rule-final font-semibold">
              <td className="py-1.5" colSpan={4}>
                Total {isReceivable ? "piutang" : "utang"} terbuka
              </td>
              {totals.map((total, bucketIdx) => (
                <td key={bucketIdx} className={amountCell}>
                  <PrintAmount value={total} />
                </td>
              ))}
              <td className={amountCell}>
                <PrintAmount value={grandTotal} symbol={false} />
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-[11px] leading-5 opacity-70">
          Kelompok umur dihitung dari tanggal jatuh tempo; dokumen tanpa jatuh tempo memakai tanggal dokumen — sama dengan ekspor CSV/XLSX aging.
        </p>
        <p className="mt-1 text-[11px]">
          Kembali ke{" "}
          <Link href="/app/akuntansi/piutang-utang" className="underline print:hidden">
            piutang &amp; utang
          </Link>
          .
        </p>
      </ReportDocument>
    </ReportPrintPageShell>
  );
}
