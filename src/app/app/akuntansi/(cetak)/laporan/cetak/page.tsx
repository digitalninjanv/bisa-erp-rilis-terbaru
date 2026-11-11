import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getBalanceSheet,
  getCashFlow,
  getEquityStatement,
  getIncomeStatement,
  getPaymentBreakdown,
  getSalesByCashier,
  getSalesByCategory,
  getSalesByDay,
  getSalesSummary,
  getTopProducts,
  getTrialBalance,
} from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { formatDate, formatDateReport, journalSourceLabel, monthStartISO, paymentMethodTypeLabel, todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/due-date";
import { formatIDRReport, formatNumber } from "@/lib/money";
import { allStatementGroupsEmpty, visibleEquityRows, visibleStatementLines, visibleTrialRows } from "@/lib/report-visibility";
import { toPrintSettings } from "@/components/print/types";
import { documentQrDataUrl } from "@/components/print/qr";
import {
  PrintAmount,
  PrintGroupSection,
  PrintSummaryLine,
  ReportDocument,
  ReportPrintPageShell,
  type PrintStatementRow,
} from "@/components/akuntansi/report-document";

import { getCompanySettingsRow } from "@/server/settings";
export const metadata = { title: "Cetak laporan keuangan" };
export const dynamic = "force-dynamic";

/**
 * FIX-R2 Tahap 1 (RD2-01/02/07) — halaman cetak resmi laporan
 * keuangan. Setiap laporan kini dicetak sebagai dokumen PrintShell
 * (kop lengkap + NPWP + pernyataan satuan + tanda tangan + nomor
 * halaman), bukan lagi mencetak halaman layar apa adanya. Angka
 * dibaca dari fungsi laporan yang sama dengan layar — halaman ini
 * murni presentasi dan tidak mengubah satu pun nilai.
 */

const TITLES: Record<string, string> = {
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

type Range = { from: string; to: string };

export default async function ReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; autoprint?: string; nol?: string; compare?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab && TITLES[params.tab] ? params.tab : null;
  if (!tab) notFound();
  // A-28 UI-3 (AKT-09): keadaan saklar akun nol yang sama dengan layar diteruskan ke cetak.
  const hideZero = params.nol !== "1";
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();
  const range: Range = { from: `${from}T00:00:00`, to: `${to}T23:59:59` };
  const canCompare = tab === "laba-rugi" || tab === "neraca";
  const compareMode =
    canCompare && (params.compare === "prev" || params.compare === "yoy")
      ? params.compare
      : null;
  const compareLabel = compareMode === "prev" ? "Periode sebelumnya" : compareMode === "yoy" ? "Tahun lalu" : null;
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
    const settings = await getSettings(tx, ctx.company.id);
    if (tab === "laba-rugi") {
      const current = await getIncomeStatement(tx, ctx.company.id, range, { excludeClosing: true });
      const prior = priorDates
        ? await getIncomeStatement(tx, ctx.company.id, {
            from: `${priorDates.from}T00:00:00`,
            to: `${priorDates.to}T23:59:59`,
          }, { excludeClosing: true })
        : null;
      return { settings, kind: "income" as const, current, prior };
    }
    if (tab === "neraca") {
      const current = await getBalanceSheet(tx, ctx.company.id, to);
      const prior = priorDates ? await getBalanceSheet(tx, ctx.company.id, priorDates.to) : null;
      return { settings, kind: "balance" as const, current, prior };
    }
    if (tab === "arus-kas") {
      return { settings, kind: "cashflow" as const, current: await getCashFlow(tx, ctx.company.id, range) };
    }
    if (tab === "ekuitas") {
      return { settings, kind: "equity" as const, current: await getEquityStatement(tx, ctx.company.id, range) };
    }
    if (tab === "neraca-saldo") {
      return { settings, kind: "trial" as const, current: await getTrialBalance(tx, ctx.company.id, range) };
    }
    if (tab === "catatan") {
      const row = await getCompanySettingsRow(tx, ctx.company.id);
      return { settings, kind: "notes" as const, notes: row?.reportNotes ?? "" };
    }
    const [summary, byDay, byCashier, byCategory, top, payments] = await Promise.all([
      getSalesSummary(tx, ctx.company.id, range),
      getSalesByDay(tx, ctx.company.id, range),
      getSalesByCashier(tx, ctx.company.id, range),
      getSalesByCategory(tx, ctx.company.id, range),
      getTopProducts(tx, ctx.company.id, range, 10),
      getPaymentBreakdown(tx, ctx.company.id, range),
    ]);
    return { settings, kind: "sales" as const, summary, byDay, byCashier, byCategory, top, payments };
  });

  const printSettings = toPrintSettings(data.settings);
  const company = {
    legalName: data.settings?.legalName ?? ctx.company.name,
    address: data.settings?.address,
    phone: data.settings?.phone,
    taxId: data.settings?.taxId,
  };
  const reference = `${REFERENCES[tab]}-${to}`;
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(reference) : null;

  const periodStatement =
    tab === "neraca"
      ? `Per ${formatDateReport(to)}`
      : tab === "neraca-saldo" || tab === "penjualan" || tab === "catatan"
        ? `Periode ${formatDateReport(from)} — ${formatDateReport(to)}`
        : `Untuk periode yang berakhir pada ${formatDateReport(to)}`;
  const comparisonStatement = compareLabel ? ` · Pembanding: ${compareLabel}` : "";
  return (
    <ReportPrintPageShell
      backHref={`/app/akuntansi/laporan?tab=${tab}&from=${from}&to=${to}`}
      backLabel="Laporan keuangan"
      eyebrow="Laporan keuangan · Cetak resmi"
      heading={TITLES[tab]}
      auto={params.autoprint === "1"}
    >
      <ReportDocument
        settings={printSettings}
        company={company}
        title={TITLES[tab]}
        periodStatement={`${periodStatement}${comparisonStatement}`}
        reference={reference}
        printedByName={ctx.user.name}
        qrDataUrl={qrDataUrl}
      >
        {data.kind === "income" ? <IncomePrint current={data.current} prior={"prior" in data ? data.prior : null} hideZero={hideZero} /> : null}
        {data.kind === "balance" ? <BalancePrint current={data.current} prior={"prior" in data ? data.prior : null} hideZero={hideZero} /> : null}
        {data.kind === "cashflow" ? <CashFlowPrint current={data.current} /> : null}
        {data.kind === "equity" ? <EquityPrint current={data.current} hideZero={hideZero} /> : null}
        {data.kind === "trial" ? <TrialPrint current={data.current} hideZero={hideZero} /> : null}
        {data.kind === "sales" ? (
          <SalesPrint
            summary={data.summary}
            byDay={data.byDay}
            byCashier={data.byCashier}
            byCategory={data.byCategory}
            top={data.top}
            payments={data.payments}
          />
        ) : null}
        {data.kind === "notes" ? <NotesPrint notes={data.notes} /> : null}
      </ReportDocument>
    </ReportPrintPageShell>
  );
}

type IncomeData = Awaited<ReturnType<typeof getIncomeStatement>>;
type BalanceData = Awaited<ReturnType<typeof getBalanceSheet>>;
type CashFlowData = Awaited<ReturnType<typeof getCashFlow>>;
type EquityData = Awaited<ReturnType<typeof getEquityStatement>>;
type TrialData = Awaited<ReturnType<typeof getTrialBalance>>;

function toRows(
  current: { accountId: string; code: string; name: string; amount: number }[],
  hideZero: boolean,
  prior?: { accountId: string; code: string; name: string; amount: number }[],
): PrintStatementRow[] {
  const priorByAccount = new Map((prior ?? []).map((row) => [row.accountId, row.amount]));
  return visibleStatementLines(current, prior ?? [], hideZero).map((row) => ({
    key: row.accountId,
    code: row.code,
    name: row.name,
    amount: row.amount,
    prior: priorByAccount.get(row.accountId),
  }));
}

function IncomePrint({
  current,
  prior,
  hideZero,
}: {
  current: IncomeData;
  prior?: IncomeData | null;
  hideZero: boolean;
}) {
  if (
    allStatementGroupsEmpty(
      [
        { current: current.revenue, prior: prior?.revenue ?? [] },
        { current: current.cogs, prior: prior?.cogs ?? [] },
        { current: current.operatingExpense, prior: prior?.operatingExpense ?? [] },
        { current: current.otherIncome, prior: prior?.otherIncome ?? [] },
        { current: current.otherExpense, prior: prior?.otherExpense ?? [] },
      ],
      hideZero,
    )
  ) {
    return (
      <div>
        <p className="py-3 text-[12px] opacity-70">
          Tidak ada mutasi pada periode ini — semua kelompok laporan kosong untuk rentang ini.
        </p>
        <PrintSummaryLine label="Laba (rugi) bersih" amount={current.netProfit} prior={prior?.netProfit} final />
      </div>
    );
  }
  return (
    <div>
      <PrintGroupSection title="Pendapatan" rows={toRows(current.revenue, hideZero, prior?.revenue)} totalLabel="Total pendapatan" total={current.totalRevenue} totalPrior={prior?.totalRevenue} />
      <PrintGroupSection title="Harga pokok penjualan" rows={toRows(current.cogs, hideZero, prior?.cogs)} totalLabel="Total harga pokok penjualan" total={current.totalCogs} totalPrior={prior?.totalCogs} />
      <PrintSummaryLine label="Laba kotor" amount={current.grossProfit} prior={prior?.grossProfit} strong band />
      <PrintGroupSection title="Beban operasional" rows={toRows(current.operatingExpense, hideZero, prior?.operatingExpense)} totalLabel="Total beban operasional" total={current.totalOperatingExpense} totalPrior={prior?.totalOperatingExpense} />
      <PrintSummaryLine label="Laba operasi" amount={current.operatingProfit} prior={prior?.operatingProfit} strong band />
      <PrintGroupSection title="Pendapatan lain-lain" rows={toRows(current.otherIncome, hideZero, prior?.otherIncome)} totalLabel="Total pendapatan lain-lain" total={current.totalOtherIncome} totalPrior={prior?.totalOtherIncome} />
      <PrintGroupSection title="Beban lain-lain" rows={toRows(current.otherExpense, hideZero, prior?.otherExpense)} totalLabel="Total beban lain-lain" total={current.totalOtherExpense} totalPrior={prior?.totalOtherExpense} />
      <PrintSummaryLine label="Laba (rugi) bersih" amount={current.netProfit} prior={prior?.netProfit} final band />
    </div>
  );
}

function BalancePrint({
  current,
  prior,
  hideZero,
}: {
  current: BalanceData;
  prior?: BalanceData | null;
  hideZero: boolean;
}) {
  const equityRows: PrintStatementRow[] = [
    ...toRows(current.equity, hideZero, prior?.equity),
    {
      key: "net-profit",
      name: "Laba (rugi) periode berjalan",
      amount: current.netProfit,
      prior: prior?.netProfit,
    },
  ];
  if (
    allStatementGroupsEmpty(
      [
        { current: current.currentAssets, prior: prior?.currentAssets ?? [] },
        { current: current.nonCurrentAssets, prior: prior?.nonCurrentAssets ?? [] },
        { current: current.currentLiabilities, prior: prior?.currentLiabilities ?? [] },
        { current: current.nonCurrentLiabilities, prior: prior?.nonCurrentLiabilities ?? [] },
        {
          current: [
            ...current.equity,
            { accountId: "net-profit", amount: current.netProfit },
          ],
          prior: prior
            ? [
                ...prior.equity,
                { accountId: "net-profit", amount: prior.netProfit },
              ]
            : [],
        },
      ],
      hideZero,
    )
  ) {
    return (
      <div>
        <p className="py-3 text-[12px] opacity-70">
          Tidak ada mutasi pada periode ini — semua kelompok laporan kosong untuk rentang ini.
        </p>
        <PrintSummaryLine
          label="Total liabilitas dan ekuitas"
          amount={current.totalLiabilities + current.totalEquity}
          prior={prior ? prior.totalLiabilities + prior.totalEquity : undefined}
          final
        />
        <p className="mt-3 text-[11px]">
          {current.balanced
            ? "Laporan seimbang: total aset sama dengan total liabilitas dan ekuitas."
            : "PERHATIAN: total aset tidak sama dengan total liabilitas dan ekuitas — periksa jurnal sebelum dokumen ini diserahkan."}
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <h2 className="border-b border-black/60 pb-1 text-[11px] font-semibold uppercase tracking-wide">
            Aset
          </h2>
          <PrintGroupSection title="Aset lancar" rows={toRows(current.currentAssets, hideZero, prior?.currentAssets)} totalLabel="Total aset lancar" total={current.totalCurrentAssets} totalPrior={prior?.totalCurrentAssets} />
          <PrintGroupSection title="Aset tidak lancar" rows={toRows(current.nonCurrentAssets, hideZero, prior?.nonCurrentAssets)} totalLabel="Total aset tidak lancar" total={current.totalNonCurrentAssets} totalPrior={prior?.totalNonCurrentAssets} />
          <PrintSummaryLine label="Total aset" amount={current.totalAssets} prior={prior?.totalAssets} strong final />
        </div>
        <div>
          <h2 className="border-b border-black/60 pb-1 text-[11px] font-semibold uppercase tracking-wide">
            Liabilitas & ekuitas
          </h2>
          <PrintGroupSection title="Liabilitas jangka pendek" rows={toRows(current.currentLiabilities, hideZero, prior?.currentLiabilities)} totalLabel="Total liabilitas jangka pendek" total={current.totalCurrentLiabilities} totalPrior={prior?.totalCurrentLiabilities} />
          <PrintGroupSection title="Liabilitas jangka panjang" rows={toRows(current.nonCurrentLiabilities, hideZero, prior?.nonCurrentLiabilities)} totalLabel="Total liabilitas jangka panjang" total={current.totalNonCurrentLiabilities} totalPrior={prior?.totalNonCurrentLiabilities} />
          <PrintSummaryLine label="Total liabilitas" amount={current.totalLiabilities} prior={prior?.totalLiabilities} strong />
          <PrintGroupSection title="Ekuitas" rows={equityRows} totalLabel="Total ekuitas" total={current.totalEquity} totalPrior={prior?.totalEquity} />
          <PrintSummaryLine label="Total liabilitas dan ekuitas" amount={current.totalLiabilities + current.totalEquity} prior={prior ? prior.totalLiabilities + prior.totalEquity : undefined} final />
        </div>
      </div>
      <p className="mt-4 text-[10px]">
        {current.balanced
          ? "Laporan seimbang: total aset sama dengan total liabilitas dan ekuitas."
          : "PERHATIAN: total aset tidak sama dengan total liabilitas dan ekuitas — periksa jurnal sebelum dokumen ini diserahkan."}
      </p>
    </div>
  );
}

function CashFlowPrint({ current }: { current: CashFlowData }) {
  const groupLabels: Record<keyof CashFlowData["groups"], string> = {
    operating: "Operasi",
    investing: "Investasi",
    financing: "Pendanaan",
    // FIX-R2 Tahap 3 (AK2-03): kelompok akun lawan belum terklasifikasi.
    unclassified: "Belum terklasifikasi",
  };
  const groups = (Object.keys(groupLabels) as (keyof CashFlowData["groups"])[]).filter((group) =>
    current.rows.some((row) => row.group === group),
  );
  return (
    <div>
      <p className="text-[11px] opacity-70">
        Disusun dari mutasi kas aktual yang dikelompokkan menurut akun lawan (metode langsung).
      </p>
      {/* Validasi 2 (V-06): tanpa baris arus kas, semua seksi diringkas
          satu catatan; baris saldo di bawah tetap tampil. */}
      {groups.length === 0 ? (
        <p className="py-3 text-[12px] opacity-70">Tidak ada mutasi arus kas pada periode ini.</p>
      ) : (
      groups.map((group) => {
        const rows = current.rows.filter((row) => row.group === group);
        return (
          <section key={group} className="mt-4">
            <h3 className="border-b border-black/60 pb-1 text-[11px] font-semibold uppercase tracking-wide">
              Arus kas {groupLabels[group].toLowerCase()}
            </h3>
            <table className="mt-1 w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wide opacity-60">
                <tr>
                  <th className="py-1 text-left font-medium">Sumber</th>
                  <th className="py-1 text-right font-medium">Masuk</th>
                  <th className="py-1 text-right font-medium">Keluar</th>
                  <th className="py-1 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.sourceType}-${row.group}`}>
                    <td className="py-1 pl-4">{journalSourceLabel(row.sourceType)}</td>
                    <td className="num min-w-[110px] py-1 text-right">
                      <PrintAmount value={row.inflow} symbol={index === 0} />
                    </td>
                    <td className="num min-w-[110px] py-1 text-right">
                      <PrintAmount value={row.outflow} symbol={false} />
                    </td>
                    <td className="num min-w-[110px] py-1 text-right">
                      <PrintAmount value={row.net} symbol={false} />
                    </td>
                  </tr>
                ))}
                <tr className="rule-total font-medium">
                  <td className="py-1.5">Total arus kas {groupLabels[group].toLowerCase()}</td>
                  <td />
                  <td />
                  <td className="num py-1.5 text-right">
                    <PrintAmount value={current.groups[group]} />
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })
      )}
      <div className="mt-4">
        <PrintSummaryLine label="Saldo kas awal" amount={current.opening} />
        <PrintSummaryLine label="Kenaikan (penurunan) kas" amount={current.net} />
        <PrintSummaryLine label="Saldo kas akhir" amount={current.closing} final band />
      </div>
    </div>
  );
}

function EquityPrint({ current, hideZero }: { current: EquityData; hideZero: boolean }) {
  const visibleRows = visibleEquityRows(current.rows, [], hideZero);
  // RD2-10: baris laba mengisi kolom Penambahan dan baris total
  // mengisi SEMUA kolom — dokumen tidak menyisakan sel kosong yang
  // harus ditebak pembaca.
  const totalAddition = current.rows.reduce((acc, row) => acc + row.addition, 0) + current.netProfit;
  const totalReduction = current.rows.reduce((acc, row) => acc + row.reduction, 0);
  const cell = "num min-w-[110px] py-1.5 text-right";
  return (
    <table className="w-full text-[12px]">
      <thead className="text-[10px] uppercase tracking-wide opacity-60">
        <tr>
          <th className="py-1.5 text-left font-medium">Komponen ekuitas</th>
          <th className="py-1.5 text-right font-medium">Saldo awal</th>
          <th className="py-1.5 text-right font-medium">Penambahan</th>
          <th className="py-1.5 text-right font-medium">Pengurangan</th>
          <th className="py-1.5 text-right font-medium">Saldo akhir</th>
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((row, index) => (
          <tr key={row.accountId}>
            <td className="py-1.5 pl-4">
              {row.code ? <span className="num mr-2 text-[10px] opacity-60">{row.code}</span> : null}
              {row.name}
            </td>
            <td className={cell}>
              <PrintAmount value={row.opening} symbol={index === 0} />
            </td>
            <td className={cell}>
              <PrintAmount value={row.addition} symbol={false} />
            </td>
            <td className={cell}>
              <PrintAmount value={row.reduction} symbol={false} />
            </td>
            <td className={cell}>
              <PrintAmount value={row.closing} symbol={false} />
            </td>
          </tr>
        ))}
        <tr>
          <td className="py-1.5 pl-4">Laba (rugi) periode berjalan</td>
          <td className={cell}>
            <PrintAmount value={0} symbol={false} />
          </td>
          <td className={cell}>
            <PrintAmount value={current.netProfit} symbol={false} />
          </td>
          <td className={cell}>
            <PrintAmount value={0} symbol={false} />
          </td>
          <td className={cell}>
            <PrintAmount value={current.netProfit} symbol={false} />
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr className="rule-final font-semibold">
          <td className="py-1.5">Total ekuitas</td>
          <td className={cell}>
            <PrintAmount value={current.totalOpening} />
          </td>
          <td className={cell}>
            <PrintAmount value={totalAddition} />
          </td>
          <td className={cell}>
            <PrintAmount value={totalReduction} />
          </td>
          <td className={cell}>
            <PrintAmount value={current.totalClosing} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function TrialPrint({ current, hideZero }: { current: TrialData; hideZero: boolean }) {
  const rows = visibleTrialRows(current, [], hideZero);
  const debit = current.reduce((acc, row) => acc + row.debit, 0);
  const credit = current.reduce((acc, row) => acc + row.credit, 0);
  const cell = "num min-w-[110px] py-1.5 text-right";
  return (
    <div>
      <table className="w-full text-[12px]">
        <thead className="text-[10px] uppercase tracking-wide opacity-60">
          <tr>
            <th className="py-1.5 text-left font-medium">Akun</th>
            <th className="py-1.5 text-right font-medium">Awal</th>
            <th className="py-1.5 text-right font-medium">Debit</th>
            <th className="py-1.5 text-right font-medium">Kredit</th>
            <th className="py-1.5 text-right font-medium">Akhir</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.accountId}>
              <td className="py-1.5 pl-4">
                <span className="num mr-2 text-[10px] opacity-60">{row.code}</span>
                {row.name}
              </td>
              <td className={cell}>
                <PrintAmount value={row.opening} symbol={index === 0} />
              </td>
              <td className={cell}>
                <PrintAmount value={row.debit} symbol={false} />
              </td>
              <td className={cell}>
                <PrintAmount value={row.credit} symbol={false} />
              </td>
              <td className={cell}>
                <PrintAmount value={row.closing} symbol={false} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="rule-final font-semibold">
            <td className="py-1.5">Total</td>
            <td className={cell} />
            <td className={cell}>
              <PrintAmount value={debit} />
            </td>
            <td className={cell}>
              <PrintAmount value={credit} />
            </td>
            <td className={cell} />
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-[11px]">
        {Math.abs(debit - credit) < 0.01
          ? "Debit dan kredit seimbang."
          : `PERHATIAN: selisih debit–kredit ${formatIDRReport(debit - credit)} — periksa jurnal.`}
      </p>
    </div>
  );
}

function SalesPrint({
  summary,
  byDay,
  byCashier,
  byCategory,
  top,
  payments,
}: {
  summary: Awaited<ReturnType<typeof getSalesSummary>>;
  byDay: Awaited<ReturnType<typeof getSalesByDay>>;
  byCashier: Awaited<ReturnType<typeof getSalesByCashier>>;
  byCategory: Awaited<ReturnType<typeof getSalesByCategory>>;
  top: Awaited<ReturnType<typeof getTopProducts>>;
  payments: Awaited<ReturnType<typeof getPaymentBreakdown>>;
}) {
  return (
    <div>
      <table className="w-full max-w-[420px] text-[12px]">
        <tbody>
          <tr>
            <td className="py-1">Transaksi</td>
            <td className="num py-1 text-right">{formatNumber(summary.transactions)}</td>
          </tr>
          <tr>
            <td className="py-1">Penjualan</td>
            <td className="num py-1 text-right">
              <PrintAmount value={summary.total} />
            </td>
          </tr>
          <tr>
            <td className="py-1">Laba kotor</td>
            <td className="num py-1 text-right">
              <PrintAmount value={summary.profit} symbol={false} />
            </td>
          </tr>
          <tr>
            <td className="py-1">Rata-rata nota</td>
            <td className="num py-1 text-right">
              <PrintAmount value={summary.average} symbol={false} />
            </td>
          </tr>
        </tbody>
      </table>

      <PrintMiniTable title="Penjualan per hari" headers={["Tanggal", "Transaksi", "Total"]} rows={byDay.map((row) => [formatDate(row.date), formatNumber(row.transactions), row.total])} />
      <PrintMiniTable title="Per kasir" headers={["Kasir", "Transaksi", "Total"]} rows={byCashier.map((row) => [row.name, formatNumber(row.transactions), row.total])} />
      <PrintMiniTable title="Produk terlaris" headers={["Produk", "Qty", "Total"]} rows={top.map((row) => [row.name, formatNumber(row.qty), row.total])} />
      <PrintMiniTable title="Per kategori" headers={["Kategori", "Qty", "Total"]} rows={byCategory.map((row) => [row.name, formatNumber(row.qty), row.total])} />
      <PrintMiniTable
        title="Metode pembayaran"
        headers={["Metode", "Jenis", "Total"]}
        rows={payments.map((row) => [row.name, paymentMethodTypeLabel(row.type), row.amount])}
      />
    </div>
  );
}

function PrintMiniTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <section className="mt-5">
      <h3 className="border-b border-black/60 pb-1 text-[11px] font-semibold uppercase tracking-wide">{title}</h3>
      <table className="mt-1 w-full text-[12px]">
        <thead className="text-[10px] uppercase tracking-wide opacity-60">
          <tr>
            {headers.map((header, index) => (
              <th key={header} className={`py-1 font-medium ${index === 0 ? "text-left" : "text-right"}`}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="py-2 pl-4 opacity-60">
                Tidak ada data.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`py-1 ${cellIndex === 0 ? "pl-4" : "num text-right"}`}>
                    {typeof cell === "number" ? <PrintAmount value={cell} symbol={rowIndex === 0 && cellIndex === row.length - 1} /> : cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function NotesPrint({ notes }: { notes: string }) {
  return (
    <div className="text-[12px] leading-6">
      {notes.trim() ? (
        <div className="whitespace-pre-wrap">{notes}</div>
      ) : (
        <p>Tidak ada catatan tambahan.</p>
      )}
      <div className="mt-5 border-t border-black/40 pt-3">
        <p className="font-semibold">Dasar penyusunan</p>
        <p className="mt-1">
          Laporan disusun dari jurnal double-entry yang telah diposting. Kebijakan akuntansi, estimasi, dan
          pengungkapan tambahan dapat diisi pada kolom catatan di atas agar sesuai kebutuhan entitas.
        </p>
      </div>
    </div>
  );
}

