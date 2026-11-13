import "./financial-report.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PrintHeader, PrintShell } from "@/components/print/print-shell";
import { paperSpec, type PrintSettings } from "@/components/print/types";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { formatDateTime } from "@/lib/format";
import { formatIDRReport } from "@/lib/money";

/**
 * FIX-R2 Tahap 1 (RD2-01/RD2-02) — kerangka dokumen resmi laporan
 * keuangan. Sebelumnya laporan hanya dicetak dari halaman layar
 * (kop tipis ReportPrintHeader, tanpa tanda tangan/satuan/template);
 * kini setiap laporan resmi adalah dokumen PrintShell yang sama
 * standarnya dengan slip gaji & dokumen transaksi: kop perusahaan
 * lengkap (nama legal, alamat, telepon, NPWP), judul resmi di tengah,
 * rumusan periode per jenis laporan, pernyataan "(Dalam Rupiah
 * penuh)", referensi dokumen + waktu cetak, nomor halaman dari
 * aturan @page PrintShell, serta kaki dokumen khusus laporan: tiga
 * kolom tanda tangan (Disusun / Diperiksa / Disetujui), catatan
 * kerahasiaan, dan QR verifikasi. Footer nota penjualan ("Terima
 * kasih…") sengaja TIDAK dipakai di laporan keuangan.
 *
 * Komponen di berkas ini presentasional murni — tidak menghitung
 * ulang satu pun angka laporan.
 */

export interface ReportCompanyIdentity {
  legalName: string;
  address?: string | null;
  phone?: string | null;
  taxId?: string | null;
}

export function ReportDocument({
  settings,
  company,
  title,
  periodStatement,
  reference,
  printedByName,
  qrDataUrl,
  children,
  financial = false,
  comparative = false,
}: {
  settings: PrintSettings;
  company: ReportCompanyIdentity;
  /** Judul resmi, mis. "Laporan Posisi Keuangan". */
  title: string;
  /** Rumusan periode baku per jenis laporan (RD2-08): posisi =
   * "Per [tanggal]"; aliran = "Untuk periode yang berakhir pada …". */
  periodStatement: string;
  /** Referensi dokumen cetak (tercetak di kaki + dienkode QR). */
  reference: string;
  printedByName?: string | null;
  qrDataUrl?: string | null;
  children?: ReactNode;
  financial?: boolean;
  comparative?: boolean;
}) {
  return (
    <div className={financial ? "financial-report-document financial-report-print" : undefined} data-comparative={comparative}>
    <PrintShell settings={settings} paper={settings.documentPaper}>
      <PrintHeader
        settings={settings}
        companyName={company.legalName}
        address={company.address}
        phone={company.phone}
        taxId={company.taxId}
        variant="document"
      />
      <div className="mt-1 text-center">
        <h1 className="text-[16px] font-bold uppercase tracking-wide">{title}</h1>
        <p className="mt-0.5 text-[11px]">{periodStatement}</p>
        <p className="text-[11px]">(Dalam Rupiah penuh)</p>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[9px] opacity-60">
        <span>Ref. {reference}</span>
        <span>Dicetak {formatDateTime(new Date())}</span>
      </div>
      <div className="mt-3">{children}</div>
      <footer data-report-approvals={settings.showSignature || settings.showQr} className="mt-6 break-inside-avoid">
        <div className="border-t border-black/60 pt-3">
          <div className="flex items-start justify-between gap-6">
            {settings.showSignature ? (
              <div className="grid flex-1 grid-cols-3 gap-6 text-center text-[10px]">
                {[
                  { label: "Disusun oleh", name: printedByName ?? undefined },
                  { label: "Diperiksa oleh", name: undefined },
                  { label: "Disetujui oleh", name: undefined },
                ].map((row) => (
                  <div key={row.label}>
                    <p className="opacity-60">{row.label}</p>
                    <div className="mt-9 border-t border-black/50 pt-1">{row.name ?? ""}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1" />
            )}
            {settings.showQr ? (
              <div className="flex w-[18mm] shrink-0 flex-col items-center gap-1 text-center">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt={`QR ${reference}`}
                    style={{ width: `${Math.min(paperSpec(settings.documentPaper).qrMm, 16)}mm`, height: `${Math.min(paperSpec(settings.documentPaper).qrMm, 16)}mm` }}
                  />
                ) : (
                  <div
                    className="flex items-center justify-center border border-dashed border-black/40 text-[8px] uppercase tracking-wide opacity-60"
                    style={{ width: `${Math.min(paperSpec(settings.documentPaper).qrMm, 16)}mm`, height: `${Math.min(paperSpec(settings.documentPaper).qrMm, 16)}mm` }}
                  >
                    QR
                  </div>
                )}
                <p className="text-[7px] uppercase tracking-wide opacity-60">Verifikasi</p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex items-end justify-between gap-4 border-t border-black/30 pt-2">
            <p className="max-w-[135mm] text-[8px] leading-4 opacity-70">
              Laporan disusun dari jurnal double-entry yang telah diposting. Dokumen ini bersifat rahasia
              dan hanya untuk pihak yang berhak.
            </p>
            {settings.showBranding ? (
              <p className="text-right text-[8px] opacity-50">Dicetak dari Bisa ERP</p>
            ) : null}
          </div>
        </div>
      </footer>
    </PrintShell>
    </div>
  );
}

/** Chrome halaman cetak (tombol kembali + cetak) — pola slip gaji. */
export function ReportPrintPageShell({
  backHref,
  backLabel,
  eyebrow,
  heading,
  auto,
  children,
}: {
  backHref: string;
  backLabel: string;
  eyebrow: string;
  heading: string;
  auto?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-1 text-lg font-semibold">{heading}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={backHref}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted"
          >
            <ArrowLeft className="size-3.5" /> {backLabel}
          </Link>
          <ReceiptPrint auto={auto} />
        </div>
      </div>
      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">{children}</div>
    </div>
  );
}

/**
 * Sel angka dokumen cetak: kurung akuntansi untuk negatif, strip
 * untuk nihil (RD2-04/RD2-11). `symbol` ditekan pada baris rincian
 * selain baris pertama kelompok — "Rp" hanya di baris pertama & total.
 */
export function PrintAmount({
  value,
  symbol = true,
}: {
  value: number;
  symbol?: boolean;
}) {
  return (
    <span className="num whitespace-nowrap">
      {formatIDRReport(value, { symbol, zeroDash: true })}
    </span>
  );
}

export interface PrintStatementRow {
  key: string;
  code?: string;
  name: string;
  amount: number;
  prior?: number;
}

/**
 * Satu kelompok laporan perbandingan (judul + baris akun menjorok +
 * subtotal bergaris tunggal). Kelompok tanpa baris tidak dirender
 * sama sekali (RD2-11) — dokumen resmi tidak memuat kelompok kosong.
 * Kelompok dibungkus .report-keep agar tidak terpotong di tengah
 * halaman (RD2-07).
 */
export function PrintGroupSection({
  title,
  rows,
  totalLabel,
  total,
  totalPrior,
}: {
  title: string;
  rows: PrintStatementRow[];
  totalLabel: string;
  total: number;
  totalPrior?: number;
}) {
  if (rows.length === 0) return null;
  const comparative = totalPrior !== undefined;
  return (
    <section className="report-keep mt-4 first:mt-0">
      <h3 className="border-b border-black/60 pb-1 text-[11px] font-semibold uppercase tracking-wide">{title}</h3>
      <table className="mt-1 w-full text-[12px]">
        <colgroup><col style={{ width: "var(--label-width)" }} /><col style={{ width: "var(--amount-width)" }} />{comparative ? <col style={{ width: "var(--amount-width)" }} /> : null}</colgroup>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key}>
              <td className="py-1 pl-4">
                {row.code ? <span className="num mr-2 text-[10px] opacity-60">{row.code}</span> : null}
                {row.name}
              </td>
              <td className="num min-w-[130px] py-1 text-right">
                <PrintAmount value={row.amount} symbol={index === 0} />
              </td>
              {comparative ? (
                <td className="num min-w-[130px] py-1 text-right">
                  <PrintAmount value={row.prior ?? 0} symbol={index === 0} />
                </td>
              ) : null}
            </tr>
          ))}
          <tr className="rule-total font-medium">
            <td className="py-1.5">{totalLabel}</td>
            <td className="num py-1.5 text-right">
              <PrintAmount value={total} />
            </td>
            {comparative ? (
              <td className="num py-1.5 text-right">
                <PrintAmount value={totalPrior} />
              </td>
            ) : null}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/**
 * Baris subtotal/total mandiri (Laba kotor, Laba operasi, Total aset…).
 * `final` = total akhir dokumen: garis tunggal di atas + garis ganda
 * di bawah (RD2-04).
 */
export function PrintSummaryLine({
  label,
  amount,
  prior,
  strong,
  final,
  band,
}: {
  label: string;
  amount: number;
  prior?: number;
  strong?: boolean;
  final?: boolean;
  band?: boolean;
}) {
  const rule = final ? "rule-final" : band ? "border-y border-black/60" : "rule-total";
  const weight = strong || final ? "font-semibold" : "";
  const bandClass = band ? "bg-black/[0.035] px-2" : "";
  const spacing = band || final ? "py-2" : "pt-1.5";
  if (prior === undefined) {
    return (
      <div data-print-total className={`mt-3 flex items-baseline justify-between text-[12px] ${rule} ${weight} ${bandClass} ${spacing}`}>
        <span>{label}</span>
        <PrintAmount value={amount} />
      </div>
    );
  }
  return (
    <div data-print-total className={`mt-3 grid grid-cols-[1fr_130px_130px] text-[12px] ${rule} ${weight} ${bandClass} ${spacing}`}>
      <span>{label}</span>
      <span className="text-right">
        <PrintAmount value={amount} />
      </span>
      <span className="text-right">
        <PrintAmount value={prior} />
      </span>
    </div>
  );
}

/** Kepala kolom tahun perbandingan pada dokumen cetak. */
export function PrintCompareHeader({
  current,
  prior,
  firstColumnLabel,
}: {
  current: string;
  prior: string;
  firstColumnLabel?: string;
}) {
  return (
    <div data-print-columns className="grid grid-cols-[1fr_130px_130px] text-[10px] uppercase tracking-wide opacity-60">
      <span>{firstColumnLabel ?? ""}</span>
      <span className="text-right font-medium">{current}</span>
      <span className="text-right font-medium">{prior}</span>
    </div>
  );
}
