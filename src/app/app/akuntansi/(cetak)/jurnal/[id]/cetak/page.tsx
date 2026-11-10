import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { user } from "@/db/schema";
import { getJournalDetail } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { applySignatureLabels, paperSpec, toPrintSettings } from "@/components/print/types";
import { statusLabel } from "@/components/blocks/status-badge";

export const metadata = { title: "Cetak Jurnal" };
export const dynamic = "force-dynamic";

/**
 * CT-08 — the journal's official print view (the detail page's old
 * "Cetak / CSV" button only downloaded a CSV). A formal A4 voucher on
 * the shared PrintShell: company head, journal number, balanced
 * debit/credit lines, and a foot that names the source as a DOCUMENT
 * NUMBER with a Bahasa Indonesia label (CT-22) plus the creator.
 */
export default async function JournalPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const detail = await getJournalDetail(tx, ctx.company.id, id);
    if (!detail) return null;
    const settings = await getSettings(tx, ctx.company.id);
    let creatorName: string | null = null;
    if (detail.entry.createdBy) {
      const [creator] = await tx
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, detail.entry.createdBy))
        .limit(1);
      creatorName = creator?.name ?? null;
    }
    return { ...detail, settings, creatorName };
  });

  if (!data) notFound();
  const { entry, lines, source, settings, creatorName } = data;
  const printSettings = toPrintSettings(settings);
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(entry.number) : null;
  const debit = lines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
  const credit = lines.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
  const balanced = debit.eq(credit);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Jurnal Umum
          </p>
          <h1 className="num mt-1 text-lg font-semibold">{entry.number}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/app/akuntansi/jurnal/${entry.id}`}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            Kembali ke detail
          </Link>
          <ReceiptPrint auto={query.autoprint === "1"} />
        </div>
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
          <PrintHeader
            settings={printSettings}
            companyName={settings?.legalName ?? "Bisa Minimarket"}
            address={settings?.address}
            phone={settings?.phone}
            variant="document"
            title="Jurnal Umum"
            number={entry.number}
            dateLabel={formatDate(entry.date)}
          />

          {entry.description ? <p className="text-[12px]">{entry.description}</p> : null}
          <p className="mt-1 text-[11px] text-black/60">
            Sumber {source.label}
            {source.number ? ` · ${source.number}` : ""} · Status {statusLabel(entry.status)}
          </p>

          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="border-y border-black/60 text-left">
                <th className="py-1.5 pr-2 font-semibold">Akun</th>
                <th className="py-1.5 pr-2 font-semibold">Memo</th>
                <th className="w-[140px] py-1.5 pr-2 text-right font-semibold">Debit</th>
                <th className="w-[140px] py-1.5 text-right font-semibold">Kredit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-black/15 align-top">
                  <td className="py-1.5 pr-2">
                    <p className="font-medium">{line.accountName}</p>
                    <p className="num text-[10px] text-black/60">{line.accountCode}</p>
                  </td>
                  <td className="py-1.5 pr-2 text-black/70">{line.description ?? "—"}</td>
                  <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                    {d(line.debit).gt(0) ? formatIDR(line.debit) : ""}
                  </td>
                  <td className="num py-1.5 text-right whitespace-nowrap">
                    {d(line.credit).gt(0) ? formatIDR(line.credit) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals live outside the table (same reasoning as CT-05):
              a repeated <tfoot> would restate them on every page. */}
          <div className="mt-2 flex items-baseline border-t-2 border-black pt-2 text-[12px] font-semibold break-inside-avoid">
            <span className="flex-1 text-right tracking-wide uppercase">Total</span>
            <span className="num w-[140px] pr-2 text-right whitespace-nowrap">{formatIDR(debit)}</span>
            <span className="num w-[140px] text-right whitespace-nowrap">{formatIDR(credit)}</span>
          </div>
          <p className="mt-1 text-right text-[11px]">
            {balanced ? "Debit dan kredit seimbang." : "Selisih terdeteksi — jurnal tidak seimbang."}
          </p>

          <div className="mt-4 text-[11px] text-black/70">
            <p>
              Sumber: {source.label}
              {source.number ? ` · ${source.number}` : ""}
            </p>
            <p>
              Dibuat oleh {creatorName ?? "—"} · {formatDateTime(entry.createdAt)}
            </p>
          </div>

          <PrintFooter
            settings={printSettings}
            documentNumber={entry.number}
            variant="document"
            printedByName={creatorName}
            signatures={applySignatureLabels(printSettings, "jurnal", [{ label: "Dibuat oleh", name: creatorName }])}
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
          />
        </PrintShell>
      </div>
    </div>
  );
}
