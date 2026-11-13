import { Fragment } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { getBusinessAnalytics } from "@/server/analytics";
import { formatIDR, formatNumber, formatQty } from "@/lib/money";
import { formatMargin } from "@/lib/margin";
import { addDaysISO } from "@/lib/due-date";
import { formatDate, monthStartISO, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/blocks/page-header";
import { DateRangeField } from "@/components/date-field";
import { EmptyState } from "@/components/blocks/empty-state";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";

export const metadata = { title: "Analisa bisnis" };
export const dynamic = "force-dynamic";

type ProductView = "terlaris" | "kurang" | "tidak" | "habis";

const PRODUCT_VIEWS: { key: ProductView; label: string }[] = [
  { key: "terlaris", label: "Terlaris" },
  { key: "kurang", label: "Kurang laku" },
  { key: "tidak", label: "Tidak terjual" },
  { key: "habis", label: "Stok habis" },
];

function percent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(value)}%`;
}

function ratio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value)}×`;
}

function riskTone(value: number | null, good: number, warn: number) {
  if (value === null) return "text-muted-foreground";
  if (value <= good) return "text-tone-green";
  if (value <= warn) return "text-tone-amber";
  return "text-destructive";
}

function MetricCell({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 text-[18px] font-semibold leading-none", valueClass)}>{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default async function AnalisaPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; view?: string; q?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("analytics.view");
  const today = todayISO();
  const isoDate = (value: string | undefined) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  let from = isoDate(params.from) ?? addDaysISO(today, -29);
  let to = isoDate(params.to) ?? today;
  if (from > to) [from, to] = [to, from];
  const spanDays = Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (spanDays > 366) from = addDaysISO(to, -365);

  const presets = [
    { key: "30", label: "30 hari", from: addDaysISO(today, -29), to: today },
    { key: "90", label: "90 hari", from: addDaysISO(today, -89), to: today },
    { key: "month", label: "Bulan ini", from: monthStartISO(), to: today },
  ];
  const activePreset = presets.find((preset) => preset.from === from && preset.to === to);
  const periodLabel = activePreset?.label ?? `${formatDate(from)} — ${formatDate(to)}`;
  const view: ProductView = PRODUCT_VIEWS.some((item) => item.key === params.view)
    ? (params.view as ProductView)
    : "terlaris";
  const term = params.q?.trim().toLowerCase() ?? "";

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    getBusinessAnalytics(tx, ctx.company.id, from, to),
  );
  const { health, drivers, risk } = data;

  const slowRows = drivers.abcFsn
    .filter((row) => row.abc === "C" || row.fsn === "N")
    .sort((a, b) => a.revenue - b.revenue);
  const bestRows = drivers.abcFsn;
  const deadRows = risk.deadStock;
  const stockoutRows = risk.stockoutProducts;

  const matches = (row: { name: string; sku: string; category?: string }) =>
    !term ||
    row.name.toLowerCase().includes(term) ||
    row.sku.toLowerCase().includes(term) ||
    (row.category ?? "").toLowerCase().includes(term);

  const filteredBest = bestRows.filter(matches);
  const filteredSlow = slowRows.filter(matches);
  const filteredDead = deadRows.filter(matches);
  const filteredStockout = stockoutRows.filter(matches);
  const activeRows =
    view === "tidak"
      ? filteredDead
      : view === "habis"
        ? filteredStockout
        : view === "kurang"
          ? filteredSlow
          : filteredBest;
  const activeTotal =
    view === "tidak"
      ? deadRows.length
      : view === "habis"
        ? stockoutRows.length
        : view === "kurang"
          ? slowRows.length
          : bestRows.length;

  const abcMatrix = (["F", "S", "N"] as const).map((fsn) =>
    (["A", "B", "C"] as const).map(
      (abc) => drivers.abcFsn.filter((row) => row.fsn === fsn && row.abc === abc).length,
    ),
  );

  const tabHref = (next: ProductView) => {
    const query = new URLSearchParams({ view: next, from, to });
    if (params.q) query.set("q", params.q);
    return `/app/analisa?${query.toString()}`;
  };

  const counts: Record<ProductView, number> = {
    terlaris: bestRows.length,
    kurang: slowRows.length,
    tidak: deadRows.length,
    habis: stockoutRows.length,
  };
  const showSalesColumns = view === "terlaris" || view === "kurang";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analisa bisnis"
        description="Kesehatan bisnis, produk yang paling laku, produk yang berhenti bergerak, dan risiko stok dalam satu tampilan."
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">Periode</span>
          {presets.map((preset) => (
            <Link
              key={preset.key}
              href={`/app/analisa?from=${preset.from}&to=${preset.to}&view=${view}`}
              scroll={false}
              className={
                activePreset?.key === preset.key
                  ? "inline-flex h-7 items-center rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background"
                  : "inline-flex h-7 items-center rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              }
            >
              {preset.label}
            </Link>
          ))}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {periodLabel} · pembanding {formatDate(data.period.priorFrom)} — {formatDate(data.period.priorTo)}
          </span>
        </div>
        <AutoFilterForm action="/app/analisa" className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="view" value={view} />
          <DateRangeField from={{ name: "from", defaultValue: from }} to={{ name: "to", defaultValue: to }} />
          <button
            type="submit"
            className="h-9 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            Terapkan
          </button>
        </AutoFilterForm>
      </div>

      <div id="kesehatan" className="scroll-mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Kesehatan bisnis
        </p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          <MetricCell
            label="Omzet & growth"
            value={formatIDR(health.revenue)}
            hint={
              health.growth === null
                ? `${formatNumber(health.transactions)} transaksi`
                : `${health.growth >= 0 ? "Naik" : "Turun"} ${percent(Math.abs(health.growth))} vs periode sebelumnya`
            }
            valueClass={health.growth !== null && health.growth < 0 ? "text-destructive" : undefined}
          />
          <MetricCell
            label="Gross profit margin"
            value={formatMargin(health.grossMargin)}
            hint={`Laba kotor ${formatIDR(health.grossProfit)}`}
            valueClass={
              health.grossMargin === null
                ? undefined
                : health.grossMargin >= 20
                  ? "text-tone-green"
                  : health.grossMargin >= 10
                    ? "text-tone-amber"
                    : "text-destructive"
            }
          />
          <MetricCell
            label="Operating profit"
            value={formatIDR(health.operatingProfit)}
            hint={`Laba bersih ${formatIDR(health.netProfit)}`}
            valueClass={health.operatingProfit < 0 ? "text-destructive" : undefined}
          />
          <MetricCell
            label="Cash flow operasional"
            value={formatIDR(health.operatingCashFlow)}
            hint={`Saldo kas akhir ${formatIDR(health.cashClosing)}`}
            valueClass={health.operatingCashFlow < 0 ? "text-destructive" : undefined}
          />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_290px]">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="space-y-2.5 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-semibold">Kinerja produk</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  ABC dari kontribusi omzet, FSN dari frekuensi transaksi.
                </p>
              </div>
              <span className="num text-[11px] text-muted-foreground">
                {term
                  ? `${activeRows.length} hasil`
                  : activeTotal > 12
                    ? `12 dari ${activeTotal} produk`
                    : `${activeTotal} produk`}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {PRODUCT_VIEWS.map((item) => (
                  <Link
                    key={item.key}
                    href={tabHref(item.key)}
                    scroll={false}
                    className={
                      view === item.key
                        ? "inline-flex h-7 items-center gap-1 rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background"
                        : "inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    }
                  >
                    {item.label}
                    <span className="num opacity-70">{counts[item.key]}</span>
                  </Link>
                ))}
              </div>
              <AutoFilterForm action="/app/analisa" className="relative min-w-[180px]">
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder="Cari produk…"
                  aria-label="Cari produk dalam daftar"
                  className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-[11px] outline-none focus:border-ring"
                />
              </AutoFilterForm>
            </div>
          </div>

          {activeRows.length === 0 ? (
            <div className="p-3">
              <EmptyState
                size="compact"
                title={term ? "Tidak ada produk yang cocok." : "Belum ada produk pada daftar ini."}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produk</th>
                    {showSalesColumns ? (
                      <>
                        <th className="text-right">Terjual</th>
                        <th className="text-right">Omzet</th>
                        <th className="text-right">Margin</th>
                        <th className="text-center">ABC/FSN</th>
                        <th>Terakhir</th>
                      </>
                    ) : view === "tidak" ? (
                      <>
                        <th className="text-right">Stok</th>
                        <th className="text-right">Nilai stok</th>
                        <th>Status</th>
                      </>
                    ) : (
                      <>
                        <th className="text-right">Stok</th>
                        <th className="text-right">Min. stok</th>
                        <th>Status</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {activeRows.slice(0, 12).map((row, index) => {
                    if (view === "tidak") {
                      const item = row as (typeof deadRows)[number];
                      return (
                        <tr key={item.productId}>
                          <td>
                            <p className="text-[12px] font-medium">{item.name}</p>
                            <p className="num text-[10px] text-muted-foreground">
                              {item.sku} · {item.category}
                            </p>
                          </td>
                          <td className="num text-right text-[12px]">{formatQty(item.qty)}</td>
                          <td className="num text-right text-[12px]">{formatIDR(item.value)}</td>
                          <td className="text-[11px] text-muted-foreground">90+ hari tanpa penjualan</td>
                        </tr>
                      );
                    }
                    if (view === "habis") {
                      const item = row as (typeof stockoutRows)[number];
                      return (
                        <tr key={item.productId}>
                          <td>
                            <p className="text-[12px] font-medium">{item.name}</p>
                            <p className="num text-[10px] text-muted-foreground">
                              {item.sku} · {item.category}
                            </p>
                          </td>
                          <td className="num text-right text-[12px]">0</td>
                          <td className="num text-right text-[12px]">{formatQty(item.minStock)}</td>
                          <td>
                            <span className="rounded-full bg-tone-red-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-tone-red">
                              Stok habis
                            </span>
                          </td>
                        </tr>
                      );
                    }
                    const item = row as (typeof bestRows)[number];
                    return (
                      <tr key={`${item.productId}-${index}`}>
                        <td>
                          <p className="text-[12px] font-medium">{item.name}</p>
                          <p className="num text-[10px] text-muted-foreground">
                            {item.sku} · {item.category}
                          </p>
                        </td>
                        <td className="num text-right text-[12px]">{formatQty(item.qty)}</td>
                        <td className="num text-right text-[12px]">{formatIDR(item.revenue)}</td>
                        <td className="num text-right text-[12px]">{formatMargin(item.margin)}</td>
                        <td className="text-center">
                          <span className="inline-flex items-center gap-1">
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                item.abc === "A"
                                  ? "bg-tone-green-soft text-tone-green"
                                  : item.abc === "B"
                                    ? "bg-tone-amber-soft text-tone-amber"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {item.abc}
                            </span>
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {item.fsn}
                            </span>
                          </span>
                        </td>
                        <td className="num whitespace-nowrap text-[11px] text-muted-foreground">
                          {formatDate(item.lastSoldDate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Sebaran ABC-FSN</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Nilai (A/B/C) × frekuensi (F/S/N).
              </p>
            </div>
            <div className="grid grid-cols-4 gap-px bg-border text-[11px]">
              <div className="bg-card px-2 py-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                ABC / FSN
              </div>
              {(["A", "B", "C"] as const).map((abc) => (
                <div key={abc} className="bg-card px-2 py-2 text-center font-semibold">
                  {abc}
                </div>
              ))}
              {abcMatrix.map((row, rowIndex) => (
                <Fragment key={`fsn-${rowIndex}`}>
                  <div className="bg-card px-2 py-2 font-semibold text-muted-foreground">
                    {["F", "S", "N"][rowIndex]}
                  </div>
                  {row.map((count, colIndex) => (
                    <div
                      key={`cell-${rowIndex}-${colIndex}`}
                      className="num bg-card px-2 py-2 text-center"
                    >
                      {count}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
            <div className="border-t border-border px-4 py-2.5 text-[10px] leading-4 text-muted-foreground">
              A = 80% omzet pertama · B = 15% berikutnya · C = sisanya. F = sering terjual, S = lambat,
              N = tidak bergerak pada periode ini.
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card px-4 py-3">
            <h2 className="text-[13px] font-semibold">Ringkasan cepat</h2>
            <div className="mt-2 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Produk terjual</span>
                <span className="num font-semibold">{bestRows.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Tidak bergerak</span>
                <span className="num font-semibold">{deadRows.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Stok habis</span>
                <span className="num font-semibold">{stockoutRows.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Nilai stok mati</span>
                <span className="num font-semibold">{formatIDR(risk.deadValue)}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div id="kinerja" className="scroll-mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Penggerak kinerja
        </p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          <MetricCell
            label="Inventory turnover"
            value={ratio(drivers.inventoryTurnover)}
            hint={`Disetahunkan · HPP ${formatIDR(drivers.cogs)}`}
            valueClass={
              drivers.inventoryTurnover === null
                ? undefined
                : drivers.inventoryTurnover >= 4
                  ? "text-tone-green"
                  : drivers.inventoryTurnover >= 2
                    ? "text-tone-amber"
                    : "text-destructive"
            }
          />
          <MetricCell
            label="GMROI"
            value={ratio(drivers.gmroi)}
            hint={`Laba kotor ÷ rata-rata persediaan ${formatIDR(drivers.averageInventory)}`}
            valueClass={
              drivers.gmroi === null ? undefined : drivers.gmroi >= 2 ? "text-tone-green" : drivers.gmroi >= 1 ? "text-tone-amber" : "text-destructive"
            }
          />
          <MetricCell
            label="Rata-rata transaksi"
            value={formatIDR(health.averageTransaction)}
            hint={`Dari ${formatNumber(health.transactions)} transaksi`}
          />
          <MetricCell
            label="Kelas produk"
            value={`${drivers.abcCounts.A} A · ${drivers.abcCounts.B} B · ${drivers.abcCounts.C} C`}
            hint={`${drivers.abcCounts.F} cepat · ${drivers.abcCounts.S} lambat · ${drivers.abcCounts.N} diam`}
          />
        </div>
      </div>

      <div id="risiko" className="scroll-mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Risiko stok & data
        </p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          <MetricCell
            label="Stockout rate"
            value={percent(risk.stockoutRate)}
            hint={`${formatNumber(risk.stockoutCount)} dari ${formatNumber(risk.totalSkus)} SKU aktif`}
            valueClass={riskTone(risk.stockoutRate, 5, 15)}
          />
          <MetricCell
            label="Dead stock ratio"
            value={percent(risk.deadRatio)}
            hint={`Nilai ${formatIDR(risk.deadValue)} tanpa penjualan 90 hari`}
            valueClass={riskTone(risk.deadRatio, 10, 25)}
          />
          <MetricCell
            label="Shrinkage rate"
            value={percent(risk.shrinkageRate)}
            hint={`Nilai susut ${formatIDR(risk.shrinkValue)}`}
            valueClass={riskTone(risk.shrinkageRate, 0.5, 2)}
          />
          <MetricCell
            label="Inventory accuracy"
            value={risk.inventoryAccuracy === null ? "—" : percent(risk.inventoryAccuracy)}
            hint={risk.opnameDate ? `Opname terakhir ${formatDate(risk.opnameDate)}` : "Belum ada opname posted"}
            valueClass={
              risk.inventoryAccuracy === null
                ? undefined
                : risk.inventoryAccuracy >= 98
                  ? "text-tone-green"
                  : risk.inventoryAccuracy >= 95
                    ? "text-tone-amber"
                    : "text-destructive"
            }
          />
        </div>
      </div>

      <details className="rounded-lg border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          Cara membaca angka ini
        </summary>
        <p className="mt-2 max-w-4xl text-[11px] leading-5 text-muted-foreground">
          Turnover dan GMROI disetahunkan dari HPP/laba kotor dibagi rata-rata nilai persediaan awal–akhir
          periode. Dead stock = stok aktif tanpa penjualan dalam 90 hari terakhir. Shrinkage dihitung dari
          gerakan stok rusak, kedaluwarsa, hilang, penyesuaian, dan opname, dibandingkan omzet periode.
          Inventory accuracy hanya tersedia bila ada dokumen opname posted.
        </p>
      </details>
    </div>
  );
}
