import Link from "next/link";
import {
  AlarmClock,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  ClipboardCheck,
  HandCoins,
} from "lucide-react";
import { withCompanyReadOnlySnapshot } from "@/db/tenant";
import {
  getAccountingOnboardingState,
  getAccountingSummary,
  getFiscalPeriodStatus,
  getIncomeStatement,
  getReceivablePayableQueues,
  getSalesByDay,
  listPayablesPage,
  listReceivablesPage,
} from "@/server/reports";
import { countUnmatchedStatementLines } from "@/server/bank-reconciliation";
import { getPartyCreditQueueSummary } from "@/server/party-credits";
import { countPendingReimbursementClaims } from "@/server/reimbursements";
import { listQuickEntryDrafts } from "@/server/quick-entry";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { resolveModuleAccess } from "@/lib/modules";
import { formatIDR } from "@/lib/money";
import { formatDate, formatMonth, todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/due-date";
import { PageHeader } from "@/components/blocks/page-header";
import { ForbiddenBanner } from "@/components/blocks/forbidden-banner";
import { StatusBadge } from "@/components/blocks/status-badge";
import { WorkQueue } from "@/components/blocks/work-queue";
import { EmptyState } from "@/components/blocks/empty-state";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { SalesTrendChart } from "@/components/akuntansi/charts";
import {
  ExpenseBreakdown,
  ProfitLossStatement,
  type ProfitLossRow,
} from "@/components/akuntansi/pl-summary";
import { QuickInputPanel } from "@/components/akuntansi/quick-input-panel";
import { QuickEntryButton, QuickEntryDraftsSection } from "@/components/akuntansi/quick-entry-trigger";
import { OnboardingCard } from "@/components/akuntansi/onboarding-card";

export const metadata = { title: "Ringkasan akuntansi" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { key: "this-month", label: "Bulan ini" },
  { key: "last-month", label: "Bulan lalu" },
  { key: "3m", label: "3 bulan" },
  { key: "ytd", label: "Tahun ini" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

const COMPARE_LABELS: Record<PeriodKey, string> = {
  "this-month": "vs periode sama bulan lalu",
  "last-month": "vs bulan sebelumnya",
  "3m": "vs periode sebelumnya",
  ytd: "vs tahun lalu",
};

function shiftMonth(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

function buildPeriod(key: PeriodKey, today: string) {
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  if (key === "last-month") {
    const to = addDaysISO(currentMonthStart, -1);
    const from = `${to.slice(0, 7)}-01`;
    const priorTo = addDaysISO(from, -1);
    const priorFrom = `${priorTo.slice(0, 7)}-01`;
    return { from, to, priorFrom, priorTo };
  }
  if (key === "3m") {
    const from = shiftMonth(currentMonthStart, -2);
    const to = today;
    const span = daysBetween(from, to) + 1;
    const priorTo = addDaysISO(from, -1);
    return { from, to, priorTo, priorFrom: addDaysISO(priorTo, -(span - 1)) };
  }
  if (key === "ytd") {
    const from = `${today.slice(0, 4)}-01-01`;
    return {
      from,
      to: today,
      priorFrom: shiftMonth(from, -12),
      priorTo: shiftMonth(today, -12),
    };
  }
  return {
    from: currentMonthStart,
    to: today,
    priorFrom: shiftMonth(currentMonthStart, -1),
    priorTo: shiftMonth(today, -1),
  };
}

function rangeLabel(from: string, to: string): string {
  const start = formatMonth(from.slice(0, 7));
  const end = formatMonth(to.slice(0, 7));
  return start === end ? start : `${start} – ${end}`;
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value)}%`;
}

function PositionCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "red" | "green" | "amber";
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={
          tone === "red"
            ? "num mt-1 text-[16px] font-semibold leading-none text-destructive"
            : tone === "green"
              ? "num mt-1 text-[16px] font-semibold leading-none text-tone-green"
              : tone === "amber"
                ? "num mt-1 text-[16px] font-semibold leading-none text-tone-amber"
                : "num mt-1 text-[16px] font-semibold leading-none"
        }
      >
        {value}
      </p>
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  );
}

export default async function AccountingDashboard({
  searchParams,
}: {
  searchParams: Promise<{ forbidden?: string; period?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const today = todayISO();
  const periodKey: PeriodKey = PERIODS.some((row) => row.key === params.period)
    ? (params.period as PeriodKey)
    : "this-month";
  const { from, to, priorFrom, priorTo } = buildPeriod(periodKey, today);
  const range = { from: `${from}T00:00:00`, to: `${to}T23:59:59` };

  const data = await withCompanyReadOnlySnapshot(ctx.company.id, async (tx) => {
    const [
      summary,
      prior,
      byDay,
      receivablesPage,
      payablesPage,
      period,
      drafts,
      unmatchedBank,
      credits,
      pendingClaims,
      onboarding,
    ] = await Promise.all([
      getAccountingSummary(tx, ctx.company.id, range),
      getIncomeStatement(tx, ctx.company.id, {
        from: `${priorFrom}T00:00:00`,
        to: `${priorTo}T23:59:59`,
      }, { excludeClosing: true }),
      getSalesByDay(tx, ctx.company.id, range),
      listReceivablesPage(tx, ctx.company.id, {
        page: 1,
        pageSize: 5,
        status: "",
        q: "",
        today,
      }),
      listPayablesPage(tx, ctx.company.id, {
        page: 1,
        pageSize: 5,
        status: "",
        q: "",
        today,
      }),
      getFiscalPeriodStatus(tx, ctx.company.id, Number(to.slice(0, 4)), Number(to.slice(5, 7))),
      listQuickEntryDrafts(tx, ctx.company.id, ctx.user.id),
      countUnmatchedStatementLines(tx, ctx.company.id),
      getPartyCreditQueueSummary(tx, ctx.company.id),
      countPendingReimbursementClaims(tx, ctx.company.id),
      getAccountingOnboardingState(tx, ctx.company.id),
    ]);
    const queues = await getReceivablePayableQueues(tx, ctx.company.id, today, undefined, {
      receivables: receivablesPage,
      payables: payablesPage,
    });
    return {
      summary,
      prior,
      byDay,
      // Dashboard previews and queue totals come from the same paged SQL
      // read model; open documents are never loaded as full Node arrays.
      receivables: receivablesPage.rows,
      payables: payablesPage.rows,
      period,
      drafts,
      queues,
      unmatchedBank,
      credits,
      pendingClaims,
      onboarding,
    };
  });

  const { summary } = data;
  const canPost = can(ctx, "accounting.post");
  const quickInputVisibility = {
    canPost,
    canPay: canPost || can(ctx, "pos.sell"),
    canPayroll: can(ctx, "payroll.manage"),
    showPosSession: resolveModuleAccess(ctx.modules, ctx.enabledModules, "pos") === "ok",
  };

  const priorHasData =
    Math.abs(data.prior.totalRevenue) +
      Math.abs(data.prior.totalExpense) +
      Math.abs(data.prior.netProfit) >
    0.005;
  const periodLabel = rangeLabel(from, to);
  const compareLabel = COMPARE_LABELS[periodKey];
  const reportHref = `/app/akuntansi/laporan?tab=laba-rugi&from=${from}&to=${to}`;

  const percentOfRevenue = (amount: number) =>
    summary.netSales !== 0 ? (amount / summary.netSales) * 100 : null;
  const netMargin = percentOfRevenue(summary.netProfit);
  const grossMargin = percentOfRevenue(summary.grossProfit);
  const abnormalExpense = summary.totalOperatingExpense < -0.005;

  const plRows: ProfitLossRow[] = [
    {
      key: "revenue",
      label: "Pendapatan",
      hint: "Penjualan neto setelah diskon & retur",
      amount: summary.netSales,
      percent: percentOfRevenue(summary.netSales),
      priorAmount: data.prior.totalRevenue,
    },
    {
      key: "cogs",
      label: "Harga pokok penjualan",
      amount: -summary.cogs,
      percent: percentOfRevenue(-summary.cogs),
      priorAmount: -data.prior.totalCogs,
      indent: true,
      increaseIsGood: false,
    },
    {
      key: "gross",
      label: "Laba kotor",
      amount: summary.grossProfit,
      percent: percentOfRevenue(summary.grossProfit),
      priorAmount: data.prior.grossProfit,
      emphasis: true,
    },
    {
      key: "expense",
      label: "Beban operasional",
      hint: abnormalExpense ? "Saldo negatif — lihat peringatan di atas" : undefined,
      amount: -summary.totalOperatingExpense,
      percent: percentOfRevenue(-summary.totalOperatingExpense),
      priorAmount: -data.prior.totalOperatingExpense,
      indent: true,
      tone: abnormalExpense ? "amber" : undefined,
      increaseIsGood: false,
    },
    {
      key: "operating",
      label: "Laba operasi",
      amount: summary.operatingProfit,
      percent: percentOfRevenue(summary.operatingProfit),
      priorAmount: data.prior.operatingProfit,
      emphasis: true,
    },
    ...(Math.abs(summary.totalOtherIncome) > 0.005
      ? [
          {
            key: "other-income",
            label: "Pendapatan lain-lain",
            amount: summary.totalOtherIncome,
            percent: percentOfRevenue(summary.totalOtherIncome),
            priorAmount: data.prior.totalOtherIncome,
            indent: true,
          } satisfies ProfitLossRow,
        ]
      : []),
    ...(Math.abs(summary.totalOtherExpense) > 0.005
      ? [
          {
            key: "other-expense",
            label: "Beban lain-lain",
            amount: -summary.totalOtherExpense,
            percent: percentOfRevenue(-summary.totalOtherExpense),
            priorAmount: -data.prior.totalOtherExpense,
            indent: true,
            increaseIsGood: false,
          } satisfies ProfitLossRow,
        ]
      : []),
    {
      key: "net",
      label: "Laba bersih",
      hint: `Margin ${pct(netMargin)}`,
      amount: summary.netProfit,
      percent: netMargin,
      priorAmount: data.prior.netProfit,
      emphasis: true,
      tone: summary.netProfit < 0 ? "red" : "green",
    },
  ];

  const trend = data.byDay;
  const trendTotal = data.byDay.reduce((acc, row) => acc + row.total, 0);
  const receivableTotal = data.queues.receivables.openTotal;
  const payableTotal = data.queues.payables.openTotal;
  const cashBank = summary.cash + summary.bank;

  return (
    <div>
      <PageHeader
        title="Ringkasan keuangan"
        description="Laba rugi, beban, kas, piutang, utang, dan posisi keuangan — dibaca langsung dari jurnal yang sudah diposting."
        actions={
          <span className="flex items-center gap-1.5">
            {canPost ? <QuickEntryButton /> : null}
            <Link
              href="/app/akuntansi/laporan"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Lihat laporan <ArrowRight className="size-3.5" />
            </Link>
          </span>
        }
      />

      {params.forbidden ? (
        <div className="mb-4">
          <ForbiddenBanner permission={params.forbidden} />
        </div>
      ) : null}

      {!data.onboarding.hasPostedJournal && !data.onboarding.hasBankMapping ? (
        <div className="mb-4">
          <OnboardingCard companyId={ctx.company.id} userId={ctx.user.id} />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">Periode</span>
          {PERIODS.map((preset) => (
            <Link
              key={preset.key}
              href={`/app/akuntansi?period=${preset.key}`}
              className={
                periodKey === preset.key
                  ? "inline-flex h-7 items-center rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background"
                  : "inline-flex h-7 items-center rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              }
            >
              {preset.label}
            </Link>
          ))}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {periodLabel} · {compareLabel}
          </span>
        </div>
        <span className="num text-[11px] text-muted-foreground">s.d. {formatDate(to)}</span>
      </div>

      <SummaryStrip
        columns={5}
        items={[
          {
            label: "Pendapatan",
            value: formatIDR(summary.netSales),
            hint: "Penjualan neto periode ini",
          },
          {
            label: "HPP",
            value: formatIDR(summary.cogs),
            hint: summary.netSales > 0 ? `${pct((summary.cogs / summary.netSales) * 100)} dari pendapatan` : "Belum ada penjualan",
          },
          {
            label: "Laba kotor",
            value: formatIDR(summary.grossProfit),
            hint: `Margin ${pct(grossMargin)}`,
            tone:
              summary.grossProfit === 0
                ? "muted"
                : summary.grossProfit < 0
                  ? "red"
                  : "green",
          },
          {
            label: "Beban",
            value: formatIDR(summary.expenses),
            hint: `Operasional ${formatIDR(summary.totalOperatingExpense)} · lain ${formatIDR(summary.totalOtherExpense)}`,
            tone: abnormalExpense ? "amber" : "default",
          },
          {
            label: "Laba bersih",
            value: formatIDR(summary.netProfit),
            hint: `Margin ${pct(netMargin)}`,
            tone:
              summary.netProfit === 0
                ? "muted"
                : summary.netProfit < 0
                  ? "red"
                  : "green",
          },
        ]}
      />

      <WorkQueue
        className="mt-5"
        title="Perlu tindakan"
        items={[
          {
            key: "piutang-terlambat",
            label: "Piutang terlambat",
            count: data.queues.receivables.overdueCount,
            headline: `${data.queues.receivables.overdueCount} nota · ${formatIDR(data.queues.receivables.overdueTotal)}`,
            detail: `${data.queues.receivables.openCount} nota belum lunas · total ${formatIDR(data.queues.receivables.openTotal)}`,
            href: "/app/akuntansi/piutang-utang?status=terlambat",
            actionLabel: "Buka piutang",
            tone: "red",
            icon: <AlarmClock className="size-4" />,
          },
          {
            key: "utang-jatuh-tempo",
            label: "Utang jatuh tempo",
            count: data.queues.payables.overdueCount + data.queues.payables.dueSoonCount,
            headline: `${data.queues.payables.overdueCount + data.queues.payables.dueSoonCount} tagihan · ${formatIDR(data.queues.payables.overdueTotal + data.queues.payables.dueSoonTotal)}`,
            detail: [
              data.queues.payables.overdueCount > 0
                ? `${data.queues.payables.overdueCount} terlambat · ${formatIDR(data.queues.payables.overdueTotal)}`
                : null,
              data.queues.payables.dueSoonCount > 0
                ? `${data.queues.payables.dueSoonCount} jatuh tempo ≤ 7 hari · ${formatIDR(data.queues.payables.dueSoonTotal)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
            href: "/app/akuntansi/piutang-utang?tab=utang&status=jatuh-tempo",
            actionLabel: "Buka utang",
            tone: data.queues.payables.overdueCount > 0 ? "red" : "amber",
            icon: <Banknote className="size-4" />,
          },
          {
            key: "mutasi-bank",
            label: "Mutasi bank belum cocok",
            count: data.unmatchedBank.count,
            headline: `${data.unmatchedBank.count} baris · neto ${formatIDR(data.unmatchedBank.netTotal)}`,
            detail: "Mutasi rekening koran yang belum terpasangkan ke jurnal",
            href: "/app/akuntansi/rekonsiliasi",
            actionLabel: "Rekonsiliasi sekarang",
            tone: "teal",
            icon: <ArrowLeftRight className="size-4" />,
          },
          {
            key: "klaim",
            label: "Klaim menunggu persetujuan",
            count: data.pendingClaims.count,
            headline: `${data.pendingClaims.count} klaim · ${formatIDR(data.pendingClaims.total)}`,
            detail: "Klaim reimbursement yang menunggu keputusan penyetuju",
            href: "/app/akuntansi/klaim",
            actionLabel: "Tinjau klaim",
            tone: "amber",
            icon: <ClipboardCheck className="size-4" />,
          },
          {
            key: "kredit-pihak",
            label: "Kredit pihak tersedia",
            count: data.credits.count,
            headline: `${data.credits.count} dokumen · ${formatIDR(data.credits.totalRemaining)}`,
            detail: [
              data.credits.customer.count > 0
                ? `Pelanggan ${data.credits.customer.count} · ${formatIDR(data.credits.customer.totalRemaining)}`
                : null,
              data.credits.supplier.count > 0
                ? `Pemasok ${data.credits.supplier.count} · ${formatIDR(data.credits.supplier.totalRemaining)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
            href: "/app/akuntansi/piutang-utang",
            actionLabel: "Pakai kredit",
            tone: "plum",
            icon: <HandCoins className="size-4" />,
          },
        ]}
      />

      <div className="mt-3 grid items-start gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <ProfitLossStatement
          periodLabel={periodLabel}
          compareLabel={compareLabel}
          rows={plRows}
          showComparison={priorHasData}
          warning={
            abnormalExpense
              ? `Saldo beban operasional negatif (${formatIDR(summary.totalOperatingExpense)}). Laba bersih bisa terlihat lebih besar dari pendapatan; periksa jurnal beban atau saldo awal akun beban.`
              : null
          }
          reportHref={reportHref}
        />
        <ExpenseBreakdown
          rows={summary.expenseLines}
          periodLabel={periodLabel}
          reportHref={reportHref}
        />
      </div>

      <div className="mt-3 grid items-start gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Tren penjualan</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Per hari · {periodLabel}
              </p>
            </div>
            <span className="num rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {formatIDR(trendTotal)}
            </span>
          </div>
          <div className="p-3">
            {trend.length === 0 ? (
              <EmptyState size="compact" title="Belum ada penjualan pada periode ini." />
            ) : (
              <SalesTrendChart data={trend} />
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Posisi keuangan</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Per {formatDate(to)}</p>
            </div>
            <Link
              href={`/app/akuntansi/laporan?tab=neraca&from=${from}&to=${to}`}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline"
            >
              Posisi keuangan <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border">
            <PositionCell
              label="Kas & bank"
              value={formatIDR(cashBank)}
              hint={`Kas ${formatIDR(summary.cash)} · Bank ${formatIDR(summary.bank)}`}
              tone={cashBank < 0 ? "red" : undefined}
            />
            <PositionCell
              label="Piutang"
              value={formatIDR(summary.receivable)}
              hint={`${data.queues.receivables.openCount} nota terbuka`}
            />
            <PositionCell
              label="Utang"
              value={formatIDR(summary.payable)}
              hint={`${data.queues.payables.openCount} tagihan terbuka`}
              tone={data.queues.payables.overdueCount > 0 ? "amber" : undefined}
            />
            <PositionCell
              label="Persediaan (GL)"
              value={formatIDR(summary.inventoryValue)}
              hint="Saldo buku persediaan"
            />
          </div>
          <div className="border-t border-border px-4 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              Aset {formatIDR(summary.totalAssets)} · Liabilitas {formatIDR(summary.totalLiabilities)} · Ekuitas{" "}
              {formatIDR(summary.totalEquity)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
            <span
              className={
                summary.balanced
                  ? "inline-flex items-center gap-1.5 text-[11px] font-medium text-tone-green"
                  : "inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive"
              }
            >
              <span className={`size-1.5 rounded-full ${summary.balanced ? "bg-tone-green" : "bg-tone-red"}`} />
              {summary.balanced ? "Neraca seimbang" : "Neraca tidak seimbang"}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge
                status={data.period?.status ?? "draft"}
                label={`Periode ${to.slice(0, 7)}: ${
                  data.period
                    ? data.period.status === "open"
                      ? "terbuka"
                      : data.period.status === "locked"
                        ? "dikunci"
                        : "ditutup"
                    : "belum dibuat"
                }`}
              />
              <Link
                href="/app/akuntansi/periode"
                className="text-[11px] font-medium text-primary transition-colors hover:underline"
              >
                Kelola
              </Link>
            </span>
          </div>
        </section>
      </div>

      <div className="mt-4">
        <QuickInputPanel {...quickInputVisibility} />
      </div>

      {canPost ? (
        <QuickEntryDraftsSection
          drafts={data.drafts.map((draft) => ({
            id: draft.id,
            kind: draft.kind,
            payload: draft.payload,
            updatedAt: draft.updatedAt.toISOString(),
          }))}
        />
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Piutang terbuka</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {data.queues.receivables.openCount} nota · {formatIDR(receivableTotal)}
              </p>
            </div>
            <Link href="/app/akuntansi/piutang-utang" className="inline-flex h-8 items-center text-[11px] font-medium text-primary transition-colors hover:underline">
              Lihat semua
            </Link>
          </div>
          {data.queues.receivables.openCount === 0 ? (
            <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">Tidak ada piutang.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nota</th>
                    <th>Pelanggan</th>
                    <th className="hidden sm:table-cell">Jatuh tempo</th>
                    <th className="text-right">Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.receivables.map((row) => (
                    <tr key={row.id}>
                      <td className="num text-[11px]">{row.number}</td>
                      <td className="text-[11px]">{row.partyName ?? "Umum"}</td>
                      <td className="num hidden text-[11px] text-muted-foreground sm:table-cell">
                        {row.dueDate ? formatDate(row.dueDate) : "—"}
                      </td>
                      <td className="num text-right text-[11px] font-medium">{formatIDR(row.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Utang pemasok</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {data.queues.payables.openCount} tagihan · {formatIDR(payableTotal)}
              </p>
            </div>
            <Link href="/app/akuntansi/piutang-utang?tab=utang" className="inline-flex h-8 items-center text-[11px] font-medium text-primary transition-colors hover:underline">
              Lihat semua
            </Link>
          </div>
          {data.queues.payables.openCount === 0 ? (
            <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">Tidak ada utang.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Penerimaan</th>
                    <th>Pemasok</th>
                    <th className="hidden sm:table-cell">Jatuh tempo</th>
                    <th className="text-right">Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payables.map((row) => (
                    <tr key={row.id}>
                      <td className="num text-[11px]">{row.number}</td>
                      <td className="text-[11px]">{row.partyName ?? "—"}</td>
                      <td className="num hidden text-[11px] text-muted-foreground sm:table-cell">
                        {row.dueDate ? formatDate(row.dueDate) : "—"}
                      </td>
                      <td className="num text-right text-[11px] font-medium">{formatIDR(row.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
