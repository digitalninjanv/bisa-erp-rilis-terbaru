import Link from "next/link";
import { CheckSquare, Download, Printer, Square } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getBalanceSheet,
  getCashFlow,
  getEquityStatement,
  getIncomeStatement,
  getSalesByCashier,
  getSalesByCategory,
  getSalesByDay,
  getSalesSummary,
  getTopProducts,
  getPaymentBreakdown,
  getTrialBalance,
} from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDRReport, formatNumber } from "@/lib/money";
import { formatDate, formatDateReport, formatDateTime, paymentMethodTypeLabel, todayISO, monthStartISO } from "@/lib/format";
import { addDaysISO } from "@/lib/due-date";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { DateRangeField } from "@/components/date-field";
import { visibleEquityRows, visibleTrialRows } from "@/lib/report-visibility";
import { BalanceSheet, CashFlow, IncomeStatement } from "./report-statements";

import { getCompanySettingsRow } from "@/server/settings";
export const metadata = { title: "Laporan keuangan" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "laba-rugi", label: "Laba rugi" },
  { key: "neraca", label: "Posisi keuangan" },
  { key: "arus-kas", label: "Arus kas" },
  { key: "ekuitas", label: "Perubahan ekuitas" },
  { key: "neraca-saldo", label: "Neraca saldo" },
  { key: "penjualan", label: "Penjualan" },
  { key: "catatan", label: "Catatan" },
];

// CT-12 + FIX-R2 (RD2-08): judul dokumen resmi yang baku — semua
// berawalan "Laporan …" dan neraca memakai istilah SAK "Laporan
// Posisi Keuangan" (bukan "Neraca").
const REPORT_TITLES: Record<string, string> = {
  "laba-rugi": "Laporan Laba Rugi",
  neraca: "Laporan Posisi Keuangan",
  "arus-kas": "Laporan Arus Kas",
  ekuitas: "Laporan Perubahan Ekuitas",
  "neraca-saldo": "Laporan Neraca Saldo",
  penjualan: "Laporan Penjualan",
  catatan: "Catatan atas Laporan Keuangan",
};

const REFERENCES: Record<string, string> = {
  "laba-rugi": "LLR",
  neraca: "LPK",
  "arus-kas": "LAK",
  ekuitas: "LPE",
  "neraca-saldo": "LNS",
  penjualan: "LPJ",
  catatan: "CLK",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; nol?: string; compare?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.some((row) => row.key === params.tab) ? params.tab! : "laba-rugi";
  /* A-28 UI-3 (AKT-09): akun nol (kedua periode) tersembunyi bawaan di layar/cetak/ekspor; `nol=1` menampilkan. */
  const showZero = params.nol === "1";
  const hideZero = !showZero;
  const zeroSuffix = showZero ? "&nol=1" : "";
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();
  const range = { from: `${from}T00:00:00`, to: `${to}T23:59:59` };
  const canCompare = tab === "laba-rugi" || tab === "neraca";
  const compareMode =
    canCompare && (params.compare === "prev" || params.compare === "yoy")
      ? params.compare
      : null;
  const compareLabel = compareMode === "prev" ? "Periode sebelumnya" : compareMode === "yoy" ? "Tahun lalu" : null;
  const compareSuffix = compareMode ? `&compare=${compareMode}` : "";
  const priorDates = (() => {
    if (!compareMode) return null;
    if (compareMode === "yoy") {
      const shiftYear = (date: string) => `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
      return { from: shiftYear(from), to: shiftYear(to) };
    }
    const span = Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
    ) + 1;
    const priorTo = addDaysISO(from, -1);
    return { from: addDaysISO(priorTo, -(span - 1)), to: priorTo };
  })();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    if (tab === "laba-rugi") {
      const value = await getIncomeStatement(tx, ctx.company.id, range, { excludeClosing: true });
      const prior = priorDates
        ? await getIncomeStatement(tx, ctx.company.id, {
            from: `${priorDates.from}T00:00:00`,
            to: `${priorDates.to}T23:59:59`,
          }, { excludeClosing: true })
        : null;
      return { kind: "income" as const, value, prior };
    }
    if (tab === "neraca") {
      const value = await getBalanceSheet(tx, ctx.company.id, to);
      const priorAsOf = priorDates ? priorDates.to : null;
      const prior = priorAsOf ? await getBalanceSheet(tx, ctx.company.id, priorAsOf) : null;
      return { kind: "balance" as const, value, prior };
    }
    if (tab === "arus-kas") {
      return { kind: "cashflow" as const, value: await getCashFlow(tx, ctx.company.id, range) };
    }
    if (tab === "ekuitas") {
      return { kind: "equity" as const, value: await getEquityStatement(tx, ctx.company.id, range) };
    }
    if (tab === "neraca-saldo") {
      return { kind: "trial" as const, value: await getTrialBalance(tx, ctx.company.id, range) };
    }
    if (tab === "catatan") {
      const settings = await getCompanySettingsRow(tx, ctx.company.id);
      return { kind: "notes" as const, value: { notes: settings?.reportNotes ?? "", legalName: settings?.legalName ?? ctx.company.name } };
    }
    const [summary, byDay, byCashier, byCategory, top, payments] = await Promise.all([
      getSalesSummary(tx, ctx.company.id, range),
      getSalesByDay(tx, ctx.company.id, range),
      getSalesByCashier(tx, ctx.company.id, range),
      getSalesByCategory(tx, ctx.company.id, range),
      getTopProducts(tx, ctx.company.id, range, 10),
      getPaymentBreakdown(tx, ctx.company.id, range),
    ]);
    return { kind: "sales" as const, value: { summary, byDay, byCashier, byCategory, top, payments } };
  });

  // CT-12: the printed head carries the company's legal name.
  const legalName = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const row = await getCompanySettingsRow(tx, ctx.company.id);
    return row?.legalName ?? ctx.company.name;
  });
  const periodLabel = tab === "neraca" ? `Per ${formatDateReport(to)}` : `Periode ${formatDateReport(from)} — ${formatDateReport(to)}`;
  const reference = `${REFERENCES[tab]}-${to}`;

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi"
        title="Laporan keuangan"
        description="Laporan laba rugi, posisi keuangan, arus kas, perubahan ekuitas, neraca saldo, dan penjualan — siap dibaca di layar, diunduh, atau dicetak resmi."
        actions={
          <>
            {/* AK-P3-05(d): tab "catatan" berisi teks bebas (reportNotes),
                bukan tabel — opsi ekspor disembunyikan khusus tab ini. */}
            {tab !== "catatan" ? (
              <details className="relative">
                <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
                  <Download className="size-3.5" /> Unduh
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg">
                  <Link
                    href={`/api/export/report?type=${tab}&from=${from}&to=${to}${zeroSuffix}`}
                    className="block px-3 py-2 text-[12px] transition-colors hover:bg-muted"
                  >
                    CSV (.csv)
                  </Link>
                  <Link
                    href={`/api/export/report?type=${tab}&from=${from}&to=${to}&format=xlsx${zeroSuffix}`}
                    className="block px-3 py-2 text-[12px] transition-colors hover:bg-muted"
                  >
                    Excel (.xlsx)
                  </Link>
                </div>
              </details>
            ) : null}
            {/* FIX-R2 (RD2-01): pencetakan resmi berjalan lewat halaman
                cetak khusus berkerangka PrintShell (kop lengkap, satuan,
                tanda tangan) — bukan lagi mencetak halaman layar. */}
            <Link
              href={`/app/akuntansi/laporan/cetak?tab=${tab}&from=${from}&to=${to}${zeroSuffix}${compareSuffix}&autoprint=1`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Printer className="size-3.5" /> Cetak
            </Link>
          </>
        }
      />

      <div className="no-print mx-auto mb-3 max-w-5xl overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-nowrap overflow-x-auto border-b border-border px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((row) => (
            <Link
              key={row.key}
              href={`/app/akuntansi/laporan?tab=${row.key}&from=${from}&to=${to}${zeroSuffix}${compareSuffix}`}
              className={
                tab === row.key
                  ? "whitespace-nowrap border-b-2 border-foreground px-3 py-2.5 text-[12px] font-semibold text-foreground"
                  : "whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {row.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-muted-foreground">Periode</span>
            {presets().map((preset) => (
              <Link
                key={preset.label}
                href={`/app/akuntansi/laporan?tab=${tab}&from=${preset.from}&to=${preset.to}${zeroSuffix}${compareSuffix}`}
                className={
                  from === preset.from && to === preset.to
                    ? "inline-flex h-7 items-center rounded-md bg-muted px-2 text-[11px] font-medium text-foreground"
                    : "inline-flex h-7 items-center rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                }
              >
                {preset.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* A-28 UI-3 (POLA-03): filter tanggal = DateField bersama
                (dd/mm/yyyy), bukan input native berformat AS. */}
            <form action="/app/akuntansi/laporan" className="flex flex-wrap items-center gap-1.5">
              <input type="hidden" name="tab" value={tab} />
              {showZero ? <input type="hidden" name="nol" value="1" /> : null}
              {canCompare ? (
                <select
                  name="compare"
                  defaultValue={compareMode ?? ""}
                  aria-label="Pembanding"
                  className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
                >
                  <option value="">Tanpa pembanding</option>
                  <option value="prev">Periode sebelumnya</option>
                  <option value="yoy">Tahun lalu</option>
                </select>
              ) : null}
              <DateRangeField
                from={{ name: "from", defaultValue: from }}
                to={{ name: "to", defaultValue: to }}
              />
              <button
                type="submit"
                className="h-9 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                Terapkan
              </button>
            </form>
            <Link
              href={`/app/akuntansi/laporan?tab=${tab}&from=${from}&to=${to}${showZero ? "" : "&nol=1"}${compareSuffix}`}
              aria-pressed={showZero}
              className="inline-flex h-8 items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {showZero ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
              Akun nol
            </Link>
          </div>
        </div>
      </div>

      {compareMode ? (
        <p className="no-print mx-auto mb-2 max-w-5xl text-[10px] text-muted-foreground">
          Pembanding ditampilkan di layar dan cetak. Ekspor CSV/Excel mengikuti periode aktif.
        </p>
      ) : null}

      <div className="report-print mx-auto max-w-5xl overflow-hidden rounded-lg border border-border bg-card">
        <div className="p-4 sm:p-6">
          <ReportScreenHeader
            companyName={legalName}
            title={REPORT_TITLES[tab]}
            periodLabel={periodLabel}
            reference={reference}
          />
          {data.kind === "income" ? <IncomeStatement data={data.value} range={{ from, to }} hideZero={hideZero} prior={"prior" in data ? data.prior : null} compareLabel={compareLabel ?? undefined} /> : null}
          {data.kind === "balance" ? <BalanceSheet data={data.value} range={{ from, to }} hideZero={hideZero} prior={"prior" in data ? data.prior : null} compareLabel={compareLabel ?? undefined} /> : null}
          {data.kind === "cashflow" ? <CashFlow data={data.value} /> : null}
          {data.kind === "equity" ? <EquityStatement data={data.value} hideZero={hideZero} /> : null}
          {data.kind === "trial" ? <TrialBalance data={data.value} range={{ from, to }} hideZero={hideZero} /> : null}
          {data.kind === "notes" ? <ReportNotes data={data.value} from={from} to={to} canManageSettings={can(ctx, "settings.manage")} /> : null}
          {data.kind === "sales" ? <SalesReport data={data.value} /> : null}
        </div>
        <div className="border-t border-border px-4 py-2.5 text-[10px] text-muted-foreground sm:px-6">
          Sumber: jurnal yang telah diposting · Mata uang: Rupiah (IDR) · Ref. {reference}
        </div>
      </div>
    </div>
  );
}

function ReportScreenHeader({
  companyName,
  title,
  periodLabel,
  reference,
}: {
  companyName: string;
  title: string;
  periodLabel: string;
  reference: string;
}) {
  return (
    <header className="mb-5 border-b border-border pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {companyName}
          </p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {periodLabel} · Dalam Rupiah penuh
          </p>
        </div>
        <div className="text-left text-[10px] leading-4 text-muted-foreground sm:w-auto sm:text-right">
          <p className="num">Ref. {reference}</p>
          <p>Dicetak {formatDateTime(new Date())}</p>
        </div>
      </div>
    </header>
  );
}

function EquityStatement({
  data,
  hideZero,
}: {
  data: Awaited<ReturnType<typeof getEquityStatement>>;
  hideZero: boolean;
}) {
  const current = data;
  const visibleRows = visibleEquityRows(current.rows, [], hideZero);
  // FIX-R2 (RD2-10): baris laba mengisi kolom Penambahan dan baris
  // total mengisi semua kolom geraknya — tidak ada lagi sel kosong
  // yang harus ditebak pembaca.
  const totalAddition = current.rows.reduce((acc, row) => acc + row.addition, 0) + current.netProfit;
  const totalReduction = current.rows.reduce((acc, row) => acc + row.reduction, 0);
  return (
    <div className="overflow-x-auto">
      {/* A-22 K2 (UX-04): enam kolom angka tidak muat di layar kecil —
          min-width menjaga kepala kolom & nominal tidak bertabrakan;
          geser horizontal terjadi di dalam pembungkus ini saja. */}
      <table className="sticky-head zebra-rows w-full min-w-[560px] text-[12px]">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1.5 text-left">Akun</th>
            <th className="py-1.5 text-right">Saldo awal</th>
            <th className="py-1.5 text-right">Penambahan</th>
            <th className="py-1.5 text-right">Pengurangan</th>
            <th className="py-1.5 text-right">Saldo akhir</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {visibleRows.map((row) => (
            <tr key={row.accountId}>
              <td className="py-1.5 pl-4"><span className="num mr-2 text-[11px] text-muted-foreground">{row.code}</span>{row.name}</td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.opening)}</td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.addition)}</td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.reduction)}</td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.closing)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 pl-4">Laba (rugi) periode berjalan</td>
            <td className="num py-1.5 text-right">{formatIDRReport(0)}</td>
            <td className="num py-1.5 text-right">{formatIDRReport(current.netProfit)}</td>
            <td className="num py-1.5 text-right">{formatIDRReport(0)}</td>
            <td className="num py-1.5 text-right">{formatIDRReport(current.netProfit)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="rule-final font-semibold">
            <td className="py-1.5">Total ekuitas</td>
            <td className="num py-1.5 text-right">{formatIDRReport(current.totalOpening)}</td>
            <td className="num py-1.5 text-right">{formatIDRReport(totalAddition)}</td>
            <td className="num py-1.5 text-right">{formatIDRReport(totalReduction)}</td>
            <td className="num py-1.5 text-right">{formatIDRReport(current.totalClosing)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TrialBalance({
  data,
  range,
  hideZero,
}: {
  data: Awaited<ReturnType<typeof getTrialBalance>>;
  range: { from: string; to: string };
  hideZero: boolean;
}) {
  // A-28 UI-3 (AKT-09): total dari himpunan PENUH; yang disaring hanya baris render.
  const rows = visibleTrialRows(data, [], hideZero);
  const debit = data.reduce((acc, row) => acc + row.debit, 0);
  const credit = data.reduce((acc, row) => acc + row.credit, 0);
  return (
    <div className="overflow-x-auto">
      {/* A-22 K2 (UX-04): min-width anti-sesak untuk layar kecil,
          pola yang sama dengan tabel Perubahan ekuitas di atas. */}
      <table className="sticky-head zebra-rows w-full min-w-[560px] text-[12px]">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1.5 text-left">Akun</th>
            <th className="py-1.5 text-right">Awal</th>
            <th className="py-1.5 text-right">Debit</th>
            <th className="py-1.5 text-right">Kredit</th>
            <th className="py-1.5 text-right">Akhir</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row) => (
            <tr key={row.accountId}>
              <td className="py-1.5 pl-4">
                <span className="num mr-2 text-[11px] text-muted-foreground">{row.code}</span>
                <Link
                  href={`/app/akuntansi/buku-besar?account=${row.accountId}&from=${range.from}&to=${range.to}`}
                  className="transition-colors hover:underline"
                  title="Buka buku besar akun ini"
                >
                  {row.name}
                </Link>
              </td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.opening)}</td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.debit)}</td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.credit)}</td>
              <td className="num py-1.5 text-right">{formatIDRReport(row.closing)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="rule-total font-semibold">
            <td className="py-1.5">Total</td><td />
            <td className="num py-1.5 text-right">{formatIDRReport(debit)}</td>
            <td className="num py-1.5 text-right">{formatIDRReport(credit)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p data-tone={Math.abs(debit - credit) < 0.01 ? "ok" : "alert"} className={`mt-2 text-[11px] ${Math.abs(debit - credit) < 0.01 ? "text-tone-green" : "text-destructive"}`}>
        {Math.abs(debit - credit) < 0.01 ? "Debit dan kredit seimbang." : `Selisih ${formatIDRReport(debit - credit)}.`}
      </p>
    </div>
  );
}

function SalesReport({ data }: { data: { summary: Awaited<ReturnType<typeof getSalesSummary>>; byDay: Awaited<ReturnType<typeof getSalesByDay>>; byCashier: Awaited<ReturnType<typeof getSalesByCashier>>; byCategory: Awaited<ReturnType<typeof getSalesByCategory>>; top: Awaited<ReturnType<typeof getTopProducts>>; payments: Awaited<ReturnType<typeof getPaymentBreakdown>> } }) {
  return (
    <div className="space-y-5">
      <SummaryStrip
        items={[
          {
            label: "Transaksi",
            value: formatNumber(data.summary.transactions),
            hint: "Nota penjualan periode ini",
          },
          {
            label: "Penjualan",
            value: formatIDRReport(data.summary.total),
            hint: "Total nilai penjualan",
          },
          {
            label: "Laba kotor",
            value: formatIDRReport(data.summary.profit),
            hint:
              data.summary.total > 0
                ? `Margin ${formatNumber((data.summary.profit / data.summary.total) * 100, 1)}%`
                : "Belum ada penjualan",
            tone: data.summary.profit < 0 ? "red" : "green",
          },
          {
            label: "Rata-rata nota",
            value: formatIDRReport(data.summary.average),
            hint: "Nilai rata-rata per transaksi",
          },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Penjualan per hari</h3>
          {/* CT-21: daily dates use the same id-ID formatter as every
              other surface — never the raw ISO string. */}
          <MiniTable headers={["Tanggal", "Transaksi", "Total"]} rows={data.byDay.map((row) => [formatDate(row.date), formatNumber(row.transactions), formatIDRReport(row.total)])} />
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Per kasir</h3>
          <MiniTable headers={["Kasir", "Transaksi", "Total"]} rows={data.byCashier.map((row) => [row.name, formatNumber(row.transactions), formatIDRReport(row.total)])} />
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Produk terlaris</h3>
          <MiniTable headers={["Produk", "Qty", "Total"]} rows={data.top.map((row) => [row.name, formatNumber(row.qty), formatIDRReport(row.total)])} />
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Per kategori</h3>
          <MiniTable headers={["Kategori", "Qty", "Total"]} rows={data.byCategory.map((row) => [row.name, formatNumber(row.qty), formatIDRReport(row.total)])} />
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Metode pembayaran</h3>
        {/* FIX-R2 (RD2-08): kolom Jenis memakai label Indonesia, bukan
            kode tipe mentah (cash/bank/qris/…). */}
        <MiniTable headers={["Metode", "Jenis", "Total"]} rows={data.payments.map((row) => [row.name, paymentMethodTypeLabel(row.type), formatIDRReport(row.amount)])} />
      </div>
    </div>
  );
}

function ReportNotes({ data, from, to, canManageSettings }: { data: { notes: string; legalName: string }; from: string; to: string; canManageSettings: boolean }) {
  return (
    <div className="space-y-4 text-[12px] leading-6">
      {data.notes.trim() ? (
        <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3">{data.notes}</div>
      ) : (
        <>
          {/* CT-23: the empty-state guidance is screen chrome — on
              paper the notes document states the neutral fact instead. */}
          <div className="no-print whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3">
            {canManageSettings
              ? "Belum ada catatan. Isi di Pengaturan → Umum → Catatan atas laporan keuangan."
              : "Belum ada catatan. Catatan diatur oleh pemilik/admin di Pengaturan → Umum."}
          </div>
          <p className="print-only">Tidak ada catatan tambahan.</p>
        </>
      )}
      <div className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground">
        <p className="font-semibold text-foreground">Dasar penyusunan</p>
        <p className="mt-1">
          Laporan disusun dari jurnal double-entry yang telah diposting. Kebijakan akuntansi, estimasi, dan
          pengungkapan tambahan dapat diisi pada kolom catatan di atas agar sesuai kebutuhan entitas.
        </p>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Periode {formatDateReport(from)} — {formatDateReport(to)}.
      </p>
    </div>
  );
}

function MiniTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="mt-1.5 w-full text-[12px]">
      <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr>{headers.map((header, index) => <th key={header} className={`border-b border-border py-1.5 font-medium ${index === 0 ? "text-left" : "text-right"}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={headers.length} className="py-3 text-center text-muted-foreground">Tidak ada data.</td></tr>
        ) : (
          rows.map((row, index) => (
            <tr key={index} className="border-b border-border/40 last:border-0 even:bg-muted/25 print:bg-transparent">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`py-1.5 ${cellIndex === 0 ? "max-w-[220px] truncate" : "num text-right"}`}>{cell}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function presets(): { label: string; from: string; to: string }[] {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const thisMonthFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const prevMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const prevMonthFrom = prevMonthDate.toISOString().slice(0, 10);
  const prevMonthTo = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
  return [
    { label: "Bulan ini", from: thisMonthFrom, to: today },
    { label: "Bulan lalu", from: prevMonthFrom, to: prevMonthTo },
    { label: "Tahun ini", from: `${year}-01-01`, to: today },
    { label: "Tahun lalu", from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
}

