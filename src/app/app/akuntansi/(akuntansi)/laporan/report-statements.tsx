import Link from "next/link";
import { formatIDRReport } from "@/lib/money";
import { journalSourceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { allStatementGroupsEmpty, visibleStatementLines } from "@/lib/report-visibility";
import type { getBalanceSheet, getCashFlow, getIncomeStatement } from "@/server/reports";

/**
 * Komponen pernyataan laporan keuangan (laba rugi, neraca, arus kas).
 *
 * Laporan mendukung kolom pembanding (periode sebelumnya / tahun lalu)
 * untuk laba rugi dan posisi keuangan. Perbandingan ini mengikuti
 * praktik PSAK 1/IAS 1: informasi periode sebelumnya disajikan
 * berdampingan, bukan menggantikan periode berjalan.
 */

type IncomeData = Awaited<ReturnType<typeof getIncomeStatement>>;
type BalanceData = Awaited<ReturnType<typeof getBalanceSheet>>;

function priorMap(rows: { accountId: string; amount: number }[] | undefined) {
  return new Map((rows ?? []).map((row) => [row.accountId, row.amount]));
}

function ReportAllEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-[13px] font-medium">Tidak ada mutasi pada periode ini.</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Semua kelompok laporan kosong untuk rentang ini.
      </p>
    </div>
  );
}

export function IncomeStatement({
  data,
  range,
  hideZero,
  prior = null,
  compareLabel,
}: {
  data: IncomeData;
  range: { from: string; to: string };
  hideZero: boolean;
  prior?: IncomeData | null;
  compareLabel?: string;
}) {
  if (
    allStatementGroupsEmpty(
      [
        { current: data.revenue, prior: prior?.revenue ?? [] },
        { current: data.cogs, prior: prior?.cogs ?? [] },
        { current: data.operatingExpense, prior: prior?.operatingExpense ?? [] },
        { current: data.otherIncome, prior: prior?.otherIncome ?? [] },
        { current: data.otherExpense, prior: prior?.otherExpense ?? [] },
      ],
      hideZero,
    )
  ) {
    return <ReportAllEmpty />;
  }
  return (
    <div className="space-y-5">
      <StatementGroup title="Pendapatan" rows={data.revenue} total={data.totalRevenue} range={range} hideZero={hideZero} priorRows={prior?.revenue} priorTotal={prior?.totalRevenue} compareLabel={compareLabel} />
      <StatementGroup title="Harga pokok penjualan" rows={data.cogs} total={data.totalCogs} range={range} hideZero={hideZero} priorRows={prior?.cogs} priorTotal={prior?.totalCogs} compareLabel={compareLabel} />
      <StatementRow label="Laba kotor" value={data.grossProfit} prior={prior?.grossProfit} compareLabel={compareLabel} strong />
      <StatementGroup title="Beban operasional" rows={data.operatingExpense} total={data.totalOperatingExpense} range={range} hideZero={hideZero} priorRows={prior?.operatingExpense} priorTotal={prior?.totalOperatingExpense} compareLabel={compareLabel} />
      <StatementRow label="Laba operasi" value={data.operatingProfit} prior={prior?.operatingProfit} compareLabel={compareLabel} strong />
      <StatementGroup title="Pendapatan lain-lain" rows={data.otherIncome} total={data.totalOtherIncome} range={range} hideZero={hideZero} priorRows={prior?.otherIncome} priorTotal={prior?.totalOtherIncome} compareLabel={compareLabel} />
      <StatementGroup title="Beban lain-lain" rows={data.otherExpense} total={data.totalOtherExpense} range={range} hideZero={hideZero} priorRows={prior?.otherExpense} priorTotal={prior?.totalOtherExpense} compareLabel={compareLabel} />
      <StatementRow label="Laba bersih" value={data.netProfit} prior={prior?.netProfit} compareLabel={compareLabel} strong final tone={data.netProfit >= 0 ? "green" : "red"} />
    </div>
  );
}

export function BalanceSheet({
  data,
  range,
  hideZero,
  prior = null,
  compareLabel,
}: {
  data: BalanceData;
  range: { from: string; to: string };
  hideZero: boolean;
  prior?: BalanceData | null;
  compareLabel?: string;
}) {
  // Laba periode berjalan menjadi baris di dalam kelompok Ekuitas
  // sehingga "Total ekuitas" adalah total yang sesungguhnya.
  const equity = [
    ...data.equity,
    { accountId: "net-profit", code: "", name: "Laba periode berjalan", amount: data.netProfit },
  ];
  const priorEquity = prior
    ? [
        ...prior.equity,
        {
          accountId: "net-profit",
          code: "",
          name: "Laba periode berjalan",
          amount: prior.netProfit,
        },
      ]
    : [];
  if (
    allStatementGroupsEmpty(
      [
        { current: data.currentAssets, prior: prior?.currentAssets ?? [] },
        { current: data.nonCurrentAssets, prior: prior?.nonCurrentAssets ?? [] },
        { current: data.currentLiabilities, prior: prior?.currentLiabilities ?? [] },
        { current: data.nonCurrentLiabilities, prior: prior?.nonCurrentLiabilities ?? [] },
        { current: equity, prior: priorEquity },
      ],
      hideZero,
    )
  ) {
    return <ReportAllEmpty />;
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Aset</h3>
        <StatementGroup title="Aset lancar" rows={data.currentAssets} total={data.totalCurrentAssets} range={range} hideZero={hideZero} priorRows={prior?.currentAssets} priorTotal={prior?.totalCurrentAssets} compareLabel={compareLabel} />
        <StatementGroup title="Aset tidak lancar" rows={data.nonCurrentAssets} total={data.totalNonCurrentAssets} range={range} hideZero={hideZero} priorRows={prior?.nonCurrentAssets} priorTotal={prior?.totalNonCurrentAssets} compareLabel={compareLabel} />
        <StatementRow label="Total aset" value={data.totalAssets} prior={prior?.totalAssets} compareLabel={compareLabel} strong final />
      </div>
      <div className="space-y-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Liabilitas & ekuitas
        </h3>
        <StatementGroup title="Liabilitas jangka pendek" rows={data.currentLiabilities} total={data.totalCurrentLiabilities} range={range} hideZero={hideZero} priorRows={prior?.currentLiabilities} priorTotal={prior?.totalCurrentLiabilities} compareLabel={compareLabel} />
        <StatementGroup title="Liabilitas jangka panjang" rows={data.nonCurrentLiabilities} total={data.totalNonCurrentLiabilities} range={range} hideZero={hideZero} priorRows={prior?.nonCurrentLiabilities} priorTotal={prior?.totalNonCurrentLiabilities} compareLabel={compareLabel} />
        <StatementRow label="Total liabilitas" value={data.totalLiabilities} prior={prior?.totalLiabilities} compareLabel={compareLabel} strong />
        <StatementGroup title="Ekuitas" rows={equity} total={data.totalEquity} range={range} hideZero={hideZero} priorRows={priorEquity} priorTotal={prior?.totalEquity} compareLabel={compareLabel} />
        <StatementRow label="Total liabilitas + ekuitas" value={data.totalLiabilities + data.totalEquity} prior={prior ? prior.totalLiabilities + prior.totalEquity : undefined} compareLabel={compareLabel} strong final />
        <p data-tone={data.balanced ? "ok" : "alert"} className={`text-[11px] ${data.balanced ? "text-tone-green" : "text-destructive"}`}>
          {data.balanced ? "Neraca seimbang." : "Selisih terdeteksi — periksa jurnal."}
        </p>
      </div>
    </div>
  );
}

export function CashFlow({
  data,
}: {
  data: Awaited<ReturnType<typeof getCashFlow>>;
}) {
  const groupLabels: Record<keyof typeof data.groups, string> = {
    operating: "Operasi",
    investing: "Investasi",
    financing: "Pendanaan",
    unclassified: "Belum terklasifikasi",
  };
  const groups = (Object.keys(groupLabels) as (keyof typeof groupLabels)[]).filter((group) =>
    data.rows.some((row) => row.group === group),
  );
  return (
    <div>
      <SummaryRow label="Saldo kas awal" value={data.opening} />
      {groups.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
          Tidak ada mutasi arus kas pada periode ini.
        </p>
      ) : (
        <>
          {groups.map((group) => {
            const rows = data.rows.filter((row) => row.group === group);
            return (
              <section key={group} className="mt-5">
                <h3 className="border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Arus kas {groupLabels[group].toLowerCase()}
                </h3>
                <div className="overflow-x-auto">
                  <table className="sticky-head mt-1 w-full text-[12px]">
                    <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-medium">Sumber</th>
                        <th className="py-1 text-right font-medium">Masuk</th>
                        <th className="py-1 text-right font-medium">Keluar</th>
                        <th className="py-1 text-right font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.sourceType}-${row.group}`} className="border-b border-border/40 last:border-0 even:bg-muted/25 print:bg-transparent">
                          <td className="py-1.5 pl-4 text-muted-foreground">{journalSourceLabel(row.sourceType)}</td>
                          <td className="num py-1.5 text-right whitespace-nowrap">{formatIDRReport(row.inflow)}</td>
                          <td className="num py-1.5 text-right whitespace-nowrap">{formatIDRReport(row.outflow)}</td>
                          <td className="num py-1.5 text-right whitespace-nowrap">{formatIDRReport(row.net)}</td>
                        </tr>
                      ))}
                      <tr className="rule-total font-medium">
                        <td className="py-1.5">Total arus kas {groupLabels[group].toLowerCase()}</td>
                        <td />
                        <td />
                        <td className="num py-1.5 text-right whitespace-nowrap">{formatIDRReport(data.groups[group])}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
      <div className="mt-4 space-y-1 text-[12px]">
        <StatementRow label="Kenaikan (penurunan) kas" value={data.net} />
        <StatementRow label="Saldo kas akhir" value={data.closing} strong final />
      </div>
    </div>
  );
}

function StatementGroup({
  title,
  rows,
  total,
  range,
  hideZero,
  priorRows,
  priorTotal,
  compareLabel,
}: {
  title: string;
  rows: { accountId: string; code: string; name: string; amount: number }[];
  total: number;
  range: { from: string; to: string };
  hideZero: boolean;
  priorRows?: { accountId: string; code: string; name: string; amount: number }[];
  priorTotal?: number;
  compareLabel?: string;
}) {
  const comparative = compareLabel !== undefined;
  const visible = visibleStatementLines(rows, priorRows ?? [], hideZero);
  if (visible.length === 0) return null;
  const priorByAccount = priorMap(priorRows);
  return (
    <section>
      <h3 className="border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full text-[12px]">
          {comparative ? (
            <thead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th />
                <th className="py-1 text-right font-medium">Periode ini</th>
                <th className="py-1 text-right font-medium">{compareLabel}</th>
              </tr>
            </thead>
          ) : null}
          <tbody>
            {visible.map((row) => (
              <tr key={row.accountId} className="border-b border-border/40 last:border-0 even:bg-muted/25 hover:bg-muted/40 print:bg-transparent print:hover:bg-transparent">
                <td className="py-1.5 pl-5">
                  <span className="num mr-2 text-[10px] text-muted-foreground">{row.code}</span>
                  {row.code ? (
                    <Link
                      href={`/app/akuntansi/buku-besar?account=${row.accountId}&from=${range.from}&to=${range.to}`}
                      className="transition-colors hover:underline"
                      title="Buka buku besar akun ini"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </td>
                <td className="num min-w-[7rem] whitespace-nowrap py-1.5 text-right sm:min-w-[130px]">
                  {formatIDRReport(row.amount)}
                </td>
                {comparative ? (
                  <td className="num min-w-[7rem] whitespace-nowrap py-1.5 text-right text-muted-foreground sm:min-w-[130px]">
                    {formatIDRReport(priorByAccount.get(row.accountId) ?? 0)}
                  </td>
                ) : null}
              </tr>
            ))}
            <tr className="rule-total font-medium">
              <td className="py-1.5">Total {title.toLowerCase()}</td>
              <td className="num whitespace-nowrap py-1.5 text-right">{formatIDRReport(total)}</td>
              {comparative ? (
                <td className="num whitespace-nowrap py-1.5 text-right">
                  {formatIDRReport(priorTotal ?? 0)}
                </td>
              ) : null}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatementRow({
  label,
  value,
  prior,
  compareLabel,
  strong,
  final,
  tone,
}: {
  label: string;
  value: number;
  prior?: number;
  compareLabel?: string;
  strong?: boolean;
  final?: boolean;
  tone?: "green" | "red";
}) {
  const comparative = compareLabel !== undefined;
  return (
    <div
      className={cn(
        "mt-2 items-center gap-3 px-3 text-[12px] print:bg-transparent",
        comparative ? "grid grid-cols-[1fr_90px_90px] sm:grid-cols-[1fr_130px_130px]" : "flex justify-between",
        final
          ? "border-y-2 border-foreground/70 bg-muted/40 py-2.5 font-semibold"
          : strong
            ? "border-y border-border bg-muted/30 py-2 font-semibold"
            : "border-t border-border py-2",
      )}
    >
      <span>{label}</span>
      <span
        data-tone={tone}
        className={`num text-right whitespace-nowrap ${tone === "green" ? "text-tone-green" : tone === "red" ? "text-destructive" : ""}`}
      >
        {formatIDRReport(value)}
      </span>
      {comparative ? (
        <span className="num text-right whitespace-nowrap text-muted-foreground">
          {formatIDRReport(prior ?? 0)}
        </span>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "green" | "red" }) {
  return (
    <div className={`flex items-center justify-between border-t border-border/60 pt-1.5 ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span data-tone={tone} className={`num ${tone === "green" ? "text-tone-green" : tone === "red" ? "text-destructive" : ""}`}>{formatIDRReport(value)}</span>
    </div>
  );
}
