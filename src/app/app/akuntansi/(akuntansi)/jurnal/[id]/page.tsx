import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { getJournalDetail } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { DocumentMetaRows, DocumentPage } from "@/components/blocks/document-page";
import { journalFlowSteps } from "@/lib/document-flow";
import { JournalReverseButton } from "@/components/akuntansi/journal-reverse";

export const dynamic = "force-dynamic";

/** Label modul asal jurnal sistem, untuk penjelasan arah pembatalan. */
const SOURCE_MODULE_LABEL: Record<string, string> = {
  sale: "modul POS",
  sale_return: "modul POS",
  payment: "modul POS/Akuntansi",
  cash_session: "modul POS",
  cash_movement: "modul POS",
  purchase: "modul Gudang",
  purchase_return: "modul Gudang",
  adjustment: "modul Gudang",
  opname: "modul Gudang",
  opening: "modul Gudang",
  expense: "menu Beban di Akuntansi",
  payroll: "menu Payroll di Akuntansi",
  payroll_payment: "menu Payroll di Akuntansi",
  bank_transfer: "menu Bank di Akuntansi",
  capital: "menu Modal di Akuntansi",
};

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermissionPage("accounting.view");
  const data = await withCompanyReadOnly(ctx.company.id, (tx) => getJournalDetail(tx, ctx.company.id, id));
  if (!data) notFound();
  const { entry, lines, reversal, original, source } = data;
  const isManualJournal = entry.sourceType === "manual";
  const originLabel = SOURCE_MODULE_LABEL[entry.sourceType] ?? "modul asalnya";
  const debit = lines.reduce((acc, line) => acc + Number(line.debit), 0);
  const credit = lines.reduce((acc, line) => acc + Number(line.credit), 0);

  // A-25 U2: detail jurnal memakai DocumentPage bersama — kepala
  // berisi nomor + StatusSteps dari status nyata (Draf → Terposting,
  // ditutup tahap Sudah dibalik/Batal bila berlaku), rel aksi di
  // kanan, meta dokumen di rel kanan; menggantikan varian kartu
  // sempit di tengah halaman (POLA-15).
  return (
    <DocumentPage
      backHref="/app/akuntansi/jurnal"
      backLabel="Kembali ke jurnal"
      eyebrow="Jurnal umum"
      number={entry.number}
      title={entry.description}
      status={entry.status}
      steps={journalFlowSteps(entry.status, Boolean(reversal))}
      actions={
        <>
          {can(ctx, "accounting.post") ? (
            isManualJournal ? (
              <JournalReverseButton
                entryId={entry.id}
                number={entry.number}
                today={todayISO()}
                disabled={Boolean(reversal) || Boolean(entry.reversalOfId)}
              />
            ) : (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-[12px] text-muted-foreground">
                Jurnal sistem — batalkan dari modul asal
              </span>
            )
          ) : null}
          {/* CT-08: the old single "Cetak / CSV" button only downloaded
              a CSV. The two actions are now separate and honestly
              labelled: Unduh CSV downloads, Cetak opens the print view. */}
          <Link
            href={`/api/export/journal/${entry.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted"
          >
            <Download className="size-3.5" /> Unduh CSV
          </Link>
          <Link
            href={`/app/akuntansi/jurnal/${entry.id}/cetak`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted"
          >
            <Printer className="size-3.5" /> Cetak
          </Link>
        </>
      }
      banners={
        <>
          {!isManualJournal ? (
            <div className="no-print border-t border-border bg-muted/40 px-5 py-2 text-[11px] text-muted-foreground">
              Jurnal ini dibuat otomatis oleh {originLabel} dan tidak bisa dibalik dari halaman ini — pembalikan di
              sini hanya mengubah buku besar, sedangkan dokumen sumbernya tetap aktif. Untuk membatalkannya, void
              atau batalkan dokumen asalnya dari {originLabel} agar dokumen, stok, dan subledger ikut terkoreksi.
              {source.href ? (
                <>
                  {" "}
                  <Link href={source.href} className="font-medium text-foreground underline">
                    Buka dokumen asal
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}
          {reversal ? (
            <div className="border-t border-border bg-tone-amber-soft px-5 py-2 text-[11px] text-tone-amber">
              Jurnal ini sudah dibalik oleh{" "}
              <Link href={`/app/akuntansi/jurnal/${reversal.id}`} className="num font-semibold underline">
                {reversal.number}
              </Link>{" "}
              tanggal {formatDate(reversal.date)}.
            </div>
          ) : null}
          {original ? (
            <div className="border-t border-border bg-tone-plum-soft px-5 py-2 text-[11px] text-tone-plum">
              Ini adalah jurnal pembalik dari{" "}
              <Link href={`/app/akuntansi/jurnal/${original.id}`} className="num font-semibold underline">
                {original.number}
              </Link>.
            </div>
          ) : null}
        </>
      }
      meta={
        <DocumentMetaRows
          rows={[
            { label: "Tanggal", value: formatDate(entry.date) },
            {
              label: "Sumber",
              // CT-22: source as document number + Indonesian label —
              // never the raw UUID or the English system word.
              // FIX-P1 Tahap 5 (AK5-01c): bila dokumen sumber punya
              // halaman sendiri, label + nomornya menjadi tautan.
              value: source.href ? (
                <Link href={source.href} className="text-primary hover:underline">
                  {source.label}
                  {source.number ? ` · ${source.number}` : ""}
                </Link>
              ) : (
                <>
                  {source.label}
                  {source.number ? ` · ${source.number}` : ""}
                </>
              ),
            },
            { label: "Dibuat", value: formatDateTime(entry.createdAt) },
          ]}
        />
      }
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        {/* A-22 K6: tabel baris jurnal dibungkus overflow-x-auto —
            memo/akun panjang tidak boleh mendorong kartu dokumen. */}
        <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Akun</th>
              <th className="px-2 py-2 text-left">Memo</th>
              <th className="px-4 py-2 text-right">Debit</th>
              <th className="px-4 py-2 text-right">Kredit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-2">
                  <p className="font-medium">{line.accountName}</p>
                  <p className="num text-[11px] text-muted-foreground">{line.accountCode}</p>
                  {line.partyName ? (
                    <p className="text-[11px] text-muted-foreground">
                      Pihak: {line.partyName}
                      {line.partyType === "customer" ? " (pelanggan)" : line.partyType === "supplier" ? " (pemasok)" : ""}
                    </p>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-muted-foreground">{line.description ?? "—"}</td>
                <td className="num px-4 py-2 text-right">{Number(line.debit) > 0 ? formatIDR(line.debit) : ""}</td>
                <td className="num px-4 py-2 text-right">{Number(line.credit) > 0 ? formatIDR(line.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/40 font-semibold">
              <td colSpan={2} className="px-4 py-2 text-right text-[11px] uppercase tracking-wide text-muted-foreground">Total</td>
              <td className="num px-4 py-2 text-right">{formatIDR(debit)}</td>
              <td className={`num px-4 py-2 text-right ${Math.abs(debit - credit) > 0.01 ? "text-destructive" : ""}`}>{formatIDR(credit)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </section>
    </DocumentPage>
  );
}
