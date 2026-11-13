import { withCompanyReadOnly } from "@/db/tenant";
import { getVatReport } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { formatDate, journalSourceLabel, todayISO, monthStartISO } from "@/lib/format";
import { formatIDRReport } from "@/lib/money";
import { toPrintSettings } from "@/components/print/types";
import { documentQrDataUrl } from "@/components/print/qr";
import {
  PrintAmount,
  ReportDocument,
  ReportPrintPageShell,
  type ReportCompanyIdentity,
} from "@/components/akuntansi/report-document";

export const metadata = { title: "Cetak buku PPN" };
export const dynamic = "force-dynamic";

export default async function VatPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; autoprint?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [settings, vat] = await Promise.all([
      getSettings(tx, ctx.company.id),
      getVatReport(tx, ctx.company.id, { from, to }),
    ]);
    return { settings, vat };
  });

  const printSettings = toPrintSettings(data.settings, "pajak");
  const company: ReportCompanyIdentity = {
    legalName: data.settings.legalName ?? ctx.company.name,
    address: data.settings.address,
    phone: data.settings.phone,
    taxId: data.settings.taxId,
  };
  const reference = `PPN-${from}-${to}`;
  const qrDataUrl = printSettings.showQr
    ? await documentQrDataUrl(`${company.legalName} | ${reference} | ${ctx.company.id}`).catch(() => null)
    : null;
  const cell = "num min-w-[105px] py-1.5 text-right whitespace-nowrap";

  return (
    <ReportPrintPageShell
      backHref={`/app/akuntansi/pajak?from=${from}&to=${to}`}
      backLabel="Pajak (PPN)"
      eyebrow="Pajak · Cetak resmi"
      heading="Buku PPN"
      auto={params.autoprint === "1"}
    >
      <ReportDocument
        settings={printSettings}
        company={company}
        title="Buku PPN"
        periodStatement={`Periode ${formatDate(from)} — ${formatDate(to)}`}
        reference={reference}
        printedByName={ctx.user.name}
        qrDataUrl={qrDataUrl}
      >
        <div className="mb-4 border-y border-black/40 py-2 break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-[11px]">
            <p className="text-[9px] font-semibold uppercase tracking-wide opacity-60">Masa Pajak</p>
            <p className="num font-semibold">
              {formatDate(from)} — {formatDate(to)}
            </p>
          </div>
          <p className="mt-1 text-[10px] opacity-70">
            {data.vat.lines.length} baris PPN dari {data.vat.entryCount} jurnal terposting pada periode ini.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-4 text-[11px]">
            <div>
              <p className="opacity-60">PPN Keluaran</p>
              <p className="num mt-1 text-[14px] font-semibold">{formatIDRReport(data.vat.output)}</p>
            </div>
            <div>
              <p className="opacity-60">PPN Masukan</p>
              <p className="num mt-1 text-[14px] font-semibold">{formatIDRReport(data.vat.input)}</p>
            </div>
            <div>
              <p className="opacity-60">
                {data.vat.net > 0 ? "PPN kurang bayar" : data.vat.net < 0 ? "PPN lebih bayar" : "PPN neto"}
              </p>
              <p className="num mt-1 text-[14px] font-semibold">
                {formatIDRReport(Math.abs(data.vat.net))}
              </p>
            </div>
          </div>
        </div>

        <table className="w-full text-[12px]">
          <thead className="text-[10px] uppercase tracking-wide opacity-60">
            <tr>
              <th className="py-1.5 text-left font-medium">Tanggal</th>
              <th className="py-1.5 text-left font-medium">Jurnal</th>
              <th className="py-1.5 text-left font-medium">Sumber</th>
              <th className="py-1.5 text-left font-medium">Keterangan</th>
              <th className="py-1.5 text-right font-medium">PPN Masukan</th>
              <th className="py-1.5 text-right font-medium">PPN Keluaran</th>
            </tr>
          </thead>
          <tbody>
            {data.vat.lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-2 opacity-60">
                  Tidak ada mutasi PPN pada periode ini.
                </td>
              </tr>
            ) : (
              data.vat.lines.map((row) => (
                <tr key={row.id} className="border-b border-black/10">
                  <td className="num py-1.5">{formatDate(row.date)}</td>
                  <td className="num py-1.5">{row.number}</td>
                  <td className="py-1.5">{journalSourceLabel(row.sourceType)}</td>
                  <td className="py-1.5">{row.description || "—"}</td>
                  <td className={cell}>
                    {row.direction === "input" ? <PrintAmount value={row.amount} symbol={false} /> : "—"}
                  </td>
                  <td className={cell}>
                    {row.direction === "output" ? <PrintAmount value={row.amount} symbol={false} /> : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="rule-total font-semibold">
              <td className="py-1.5" colSpan={4}>
                Total
              </td>
              <td className={cell}>
                <PrintAmount value={data.vat.input} />
              </td>
              <td className={cell}>
                <PrintAmount value={data.vat.output} />
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-[10px] leading-4 opacity-70">
          Buku PPN disusun dari jurnal terposting pada akun pemetaan PPN Keluaran dan PPN Masukan.
          DPP dan faktur pajak tetap berada di dokumen sumber; laporan ini tidak menghitung ulang tarif.
        </p>
      </ReportDocument>
    </ReportPrintPageShell>
  );
}
