import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Banknote, Boxes, ReceiptText, TriangleAlert, Wallet } from "lucide-react";
import { HomeTopbar } from "@/components/shell/module-shell";
import { StatCard } from "@/components/blocks/stat-card";
import { ForbiddenBanner } from "@/components/blocks/forbidden-banner";
import { MODULE_LIST, MODULES, type ModuleKey } from "@/lib/modules";
import { singleModuleLanding } from "@/lib/landing";
import { requireAuth } from "@/lib/session";
import { can } from "@/lib/permissions";
import { resolveHomeDashboardScope } from "@/lib/home-dashboard-scope";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getHomeSummary,
  getSalesByDay,
  getReceivablePayableQueues,
  getSalesSummary,
  getTopProducts,
  listSales,
} from "@/server/reports";
import { listEmployees } from "@/server/hr";
import { formatIDR, formatNumber, formatQty } from "@/lib/money";
import { formatDate, formatDateLong, formatDateTime, monthStartISO, todayISO } from "@/lib/format";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { DateRangeField } from "@/components/date-field";
import { SalesTrendChart } from "@/components/akuntansi/charts";
import { addDaysISO } from "@/lib/due-date";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";

export const dynamic = "force-dynamic";

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{
    denied?: string;
    disabled?: string;
    forbidden?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requireAuth();

  // A-23 SIS-06 (riset pola S1): pengguna dengan tepat satu modul
  // terjangkau mendarat langsung di modulnya sesudah login — kecuali
  // bila ia tiba dengan pemberitahuan penolakan (denied/disabled/
  // forbidden dari pantulan penjaga), yang harus tetap terbaca di
  // Beranda ini, bukan tertelan pantulan kedua.
  const hasNotice = Boolean(params.denied || params.disabled || params.forbidden);
  const single = singleModuleLanding(ctx.modules, ctx.enabledModules);
  if (single && !hasNotice) redirect(MODULES[single].href);

  const today = todayISO();
  const isoDate = (value: string | undefined) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  let from = isoDate(params.from) ?? addDaysISO(today, -6);
  let to = isoDate(params.to) ?? today;
  if (from > to) [from, to] = [to, from];
  // Batasi rentang kustom agar grafik harian tetap ringan.
  const spanDays = Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (spanDays > 366) from = addDaysISO(to, -365);
  const periodPresets = [
    { key: "7", label: "7 hari", from: addDaysISO(today, -6), to: today },
    { key: "30", label: "30 hari", from: addDaysISO(today, -29), to: today },
    { key: "month", label: "Bulan ini", from: monthStartISO(), to: today },
  ];
  const activePreset = periodPresets.find((preset) => preset.from === from && preset.to === to);
  const periodLabel = activePreset?.label ?? `${formatDate(from)} — ${formatDate(to)}`;
  const periodShortLabel = activePreset ? activePreset.label.toLowerCase() : "periode";

  const visibleModules = MODULE_LIST.filter(
    (module) => ctx.modules.includes(module.key) && ctx.enabledModules.includes(module.key),
  );
  // A-23 SIS-06: statistik, panel perhatian, dan pintasan hanya dari
  // modul yang benar-benar bisa diakses pengguna ini.
  const visibleKeys = new Set<ModuleKey>(visibleModules.map((module) => module.key));
  const canSeePos = visibleKeys.has("pos");
  const canSeeGudang = visibleKeys.has("gudang") && can(ctx, "inventory.view");
  const canSeeAkuntansi = visibleKeys.has("akuntansi") && can(ctx, "accounting.view");
  const canSeeHr = visibleKeys.has("hr");
  const canSeeCost = canSeeGudang && can(ctx, "inventory.cost");
  const canSeePosSales = canSeePos && can(ctx, "pos.sell");
  const summaryScope = resolveHomeDashboardScope({
    canSeePosSales,
    canSeeInventory: canSeeGudang,
    canSeeInventoryCost: canSeeCost,
    canSeeAccounting: canSeeAkuntansi,
    canSeePosSession: canSeePos && can(ctx, "pos.session"),
  });

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [summary, recent, trendRows, topProducts, periodSummary, staff, queues] = await Promise.all([
      getHomeSummary(tx, ctx.company.id, today, summaryScope),
      canSeePosSales ? listSales(tx, { companyId: ctx.company.id, pageSize: 6 }) : Promise.resolve(null),
      canSeePosSales
        ? getSalesByDay(tx, ctx.company.id, { from, to })
        : Promise.resolve([]),
      canSeePosSales
        ? getTopProducts(tx, ctx.company.id, { from, to }, 6)
        : Promise.resolve([]),
      canSeePosSales
        ? getSalesSummary(tx, ctx.company.id, { from, to })
        : Promise.resolve(null),
      // A-24 T2: statistik kartu HR hanya dibaca bila modul HR memang
      // terlihat pengguna ini (pola penyaringan SIS-06 yang sama).
      canSeeHr ? listEmployees(tx, ctx.company.id) : Promise.resolve([]),
      canSeeAkuntansi
        ? getReceivablePayableQueues(tx, ctx.company.id, today)
        : Promise.resolve(null),
    ]);
    const byDate = new Map(trendRows.map((row) => [row.date, row]));
    const trend: { date: string; label: string; total: number; transactions: number }[] = [];
    for (let date = from; date <= to; date = addDaysISO(date, 1)) {
      const row = byDate.get(date);
      trend.push({
        date,
        label: formatDate(date),
        total: row?.total ?? 0,
        transactions: row?.transactions ?? 0,
      });
    }
    return { summary, recent: recent?.rows ?? [], trend, topProducts, periodSummary, staff, queues };
  });

  const { summary } = data;

  return (
    <div className="theme-erp min-h-dvh overflow-x-hidden bg-background">
      <HomeTopbar ctx={ctx} />

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {/* UX4-06 (G2): eyebrow tanggal kapital 10px dihapus —
                arah desain §2.2 melarang eyebrow & teks di bawah
                11px; tanggal panjang tetap tampil sebagai teks
                konteks biasa di bawah judul. */}
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
              Selamat bekerja, {ctx.user.name.split(" ")[0]}.
            </h1>
            <p className="mt-1 text-[12px] text-muted-foreground">{formatDateLong(today)}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Ringkasan operasional toko: penjualan, stok, dan posisi keuangan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSeePosSales ? (
              <Link
                href="/app/pos"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Mulai kasir <ArrowUpRight className="size-3.5" />
              </Link>
            ) : null}
            {canSeeAkuntansi && can(ctx, "accounting.post") ? (
              <Link
                href="/app/akuntansi/jurnal/baru"
                className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                Jurnal baru
              </Link>
            ) : null}
            {canSeePos && can(ctx, "pos.session") ? (
              summary.openSession ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-tone-teal/25 bg-tone-teal-soft px-2.5 py-1.5 text-[11px] font-medium text-tone-teal">
                  <span className="size-1.5 rounded-full bg-tone-teal" /> Sesi kas terbuka
                </span>
              ) : (
                <Link
                  href="/app/pos/sesi"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#eddcc0] bg-[#fbf0dd] px-2.5 py-1.5 text-[11px] font-medium text-[#8a5a12] hover:bg-[#f6e8cf]"
                >
                  <Wallet className="size-3.5" /> Buka sesi kas
                </Link>
              )
            ) : null}
            {canSeeGudang && summary.lowStockCount > 0 ? (
              <Link
                href="/app/gudang/produk?lowStock=1"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#f0d5d1] bg-[#fbe9e7] px-2.5 py-1.5 text-[11px] font-medium text-[#a3362a] hover:bg-[#f7dedb]"
              >
                <TriangleAlert className="size-3.5" /> {summary.lowStockCount} stok menipis
              </Link>
            ) : null}
          </div>
        </div>

        {/* KPI band: penjualan, kas, dan posisi pihak — pola Odoo/Accurate
            (angka kerja dulu, dekorasi belakangan). */}
        <div className="kpi-band mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {canSeePosSales ? (
            <StatCard
              label="Penjualan hari ini"
              value={formatIDR(summary.todaySales)}
              hint={`${formatNumber(summary.todayTransactions)} transaksi`}
              icon={Banknote}
            />
          ) : null}
          {canSeePosSales ? (
            <StatCard
              label={`Penjualan ${periodShortLabel}`}
              value={formatIDR(data.periodSummary?.total ?? 0)}
              hint={`${formatNumber(data.periodSummary?.transactions ?? 0)} transaksi · rata-rata ${formatIDR(data.periodSummary?.average ?? 0)}`}
              icon={ReceiptText}
            />
          ) : null}
          {canSeeAkuntansi ? (
            <StatCard
              label="Kas, bank & QRIS"
              value={formatIDR(summary.cashBalance)}
              hint="Saldo buku saat ini"
              icon={Wallet}
            />
          ) : canSeeGudang && canSeeCost ? (
            <StatCard
              label="Nilai persediaan"
              value={formatIDR(summary.inventoryValue)}
              hint="Saldo buku persediaan"
              icon={Boxes}
            />
          ) : null}
          {canSeeAkuntansi && data.queues ? (
            <StatCard
              label="Piutang terbuka"
              value={formatIDR(data.queues.receivables.openTotal)}
              hint={
                data.queues.receivables.overdueCount > 0
                  ? `${data.queues.receivables.overdueCount} lewat jatuh tempo`
                  : `${data.queues.receivables.openCount} dokumen`
              }
              icon={ReceiptText}
              tone={data.queues.receivables.overdueCount > 0 ? "amber" : "neutral"}
            />
          ) : null}
          {canSeeAkuntansi && data.queues ? (
            <StatCard
              label="Utang terbuka"
              value={formatIDR(data.queues.payables.openTotal)}
              hint={
                data.queues.payables.overdueCount > 0
                  ? `${data.queues.payables.overdueCount} lewat jatuh tempo`
                  : `${data.queues.payables.openCount} dokumen`
              }
              icon={Wallet}
              tone={data.queues.payables.overdueCount > 0 ? "amber" : "neutral"}
            />
          ) : null}
        </div>

        {/* Antrean tindakan: hanya hal yang butuh keputusan hari ini. */}
        <div className="mt-3 rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <h2 className="text-[12px] font-semibold">Perlu tindakan</h2>
            <span className="text-[11px] text-muted-foreground">Klik untuk membuka daftar kerja</span>
          </div>
          <ul className="grid gap-x-6 gap-y-2.5 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
            {canSeeGudang ? (
              <Attention
                label="Stok menipis"
                value={`${summary.lowStockCount} produk`}
                href="/app/gudang/produk?lowStock=1"
                tone={summary.lowStockCount > 0 ? "red" : "neutral"}
              />
            ) : null}
            {canSeePos && can(ctx, "pos.session") ? (
              <Attention
                label="Sesi kas"
                value={summary.openSession ? "Sedang berjalan" : "Belum dibuka"}
                href="/app/pos/sesi"
                tone={summary.openSession ? "green" : "amber"}
              />
            ) : null}
            {canSeeAkuntansi && data.queues && data.queues.receivables.overdueCount > 0 ? (
              <Attention
                label="Piutang terlambat"
                value={`${data.queues.receivables.overdueCount} nota · ${formatIDR(data.queues.receivables.overdueTotal)}`}
                href="/app/akuntansi/piutang-utang?status=terlambat"
                tone="red"
              />
            ) : null}
            {canSeeAkuntansi && data.queues && data.queues.payables.overdueCount > 0 ? (
              <Attention
                label="Utang jatuh tempo"
                value={`${data.queues.payables.overdueCount} tagihan · ${formatIDR(data.queues.payables.overdueTotal)}`}
                href="/app/akuntansi/piutang-utang?tab=utang&status=jatuh-tempo"
                tone="amber"
              />
            ) : null}
            {canSeePosSales ? (
              <Attention label="Pesanan ditahan" value="Lihat daftar" href="/app/pos/ditahan" />
            ) : null}
            {canSeeGudang ? (
              <Attention label="Migrasi data" value="Impor produk" href="/app/gudang/impor" />
            ) : null}
          </ul>
        </div>

        {params.denied ? (
          <div className="mt-4 rounded-lg border border-[#f0d5d1] bg-[#fbe9e7] px-4 py-2.5 text-[12px] text-[#a3362a]">
            Akun ini tidak punya akses ke modul tersebut. Hubungi admin untuk mengubah peran.
          </div>
        ) : null}

        {params.disabled ? (
          <div className="mt-4 rounded-lg border border-[#eddcc0] bg-[#fbf0dd] px-4 py-2.5 text-[12px] text-[#8a5a12]">
            Modul tersebut sedang dinonaktifkan untuk perusahaan ini. Admin dapat mengaktifkannya
            kembali di Pengaturan → Modul.
          </div>
        ) : null}

        {params.forbidden ? (
          <div className="mt-4">
            <ForbiddenBanner permission={params.forbidden} />
          </div>
        ) : null}

        {canSeePosSales ? (
          <>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-medium text-muted-foreground">Periode</span>
                {periodPresets.map((preset) => (
                  <Link
                    key={preset.key}
                    href={`/app?from=${preset.from}&to=${preset.to}`}
                    className={
                      activePreset?.key === preset.key
                        ? "inline-flex h-11 items-center rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background lg:h-8"
                        : "inline-flex h-11 items-center rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:h-8"
                    }
                  >
                    {preset.label}
                  </Link>
                ))}
              </div>
              <AutoFilterForm action="/app" className="flex flex-wrap items-center gap-1.5">
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
              </AutoFilterForm>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <section className="rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div>
                    <h2 className="text-[13px] font-semibold">Tren penjualan</h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDate(from)} — {formatDate(to)}
                    </p>
                  </div>
                  <span className="num rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {formatIDR(data.periodSummary?.total ?? 0)}
                  </span>
                </div>
                <div className="p-3">
                  {(data.periodSummary?.total ?? 0) > 0 ? (
                    <SalesTrendChart data={data.trend} />
                  ) : (
                    <EmptyState size="compact" title="Belum ada penjualan pada periode ini." />
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <h2 className="text-[13px] font-semibold">Produk terlaris</h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{periodLabel}</p>
                  </div>
                  <Link
                    href={`/app/akuntansi/laporan?tab=penjualan&from=${from}&to=${to}`}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    Lihat laporan
                  </Link>
                </div>
                {data.topProducts.length === 0 ? (
                  <div className="p-3">
                    <EmptyState size="compact" title="Belum ada produk terjual pada periode ini." />
                  </div>
                ) : (
                  <ol className="divide-y divide-border/70">
                    {data.topProducts.map((row, index) => (
                      <li key={row.productId} className="flex items-center gap-2.5 px-4 py-2.5">
                        <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium" title={row.name}>
                            {row.name}
                          </p>
                          <p className="num text-[10px] text-muted-foreground">{row.sku}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="num text-[12px] font-semibold">{formatIDR(row.total)}</p>
                          <p className="num text-[10px] text-muted-foreground">
                            {formatQty(row.qty)} terjual
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </>
        ) : null}

        <div className="mt-6 flex items-end justify-between">
          <div>
            <h2 className="text-[14px] font-semibold">Ruang kerja</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">Akses cepat ke modul yang tersedia untuk akun ini.</p>
          </div>
        </div>

        {visibleModules.length === 0 ? (
          <div className="mt-3">
            {/* G3 (UX4-07): keadaan kosong kini EmptyState bersama —
                sebelumnya kartu dashed racikan tangan di halaman ini
                saja (dialek ketiga di luar komponen bersama). */}
            <EmptyState
              size="compact"
              title="Belum ada modul yang bisa diakses."
              description="Minta admin memberikan akses modul dan izin pada peran akun Anda."
            />
          </div>
        ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {visibleModules.map((module) => {
            const Icon = module.icon;
            const meta = moduleStats(module.key, summary, data.staff, canSeeCost);
            return (
              <Link
                key={module.key}
                href={module.href}
                className="group flex flex-col rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted text-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[14px] font-semibold tracking-tight">{module.name}</h3>
                    <p className="truncate text-[11px] text-muted-foreground">{module.tagline}</p>
                  </div>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-2.5">
                  {meta.map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="num mt-0.5 truncate text-[12px] font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
        )}

        {canSeePosSales || canSeeGudang || canSeeAkuntansi ? (
        <div
          className={
            canSeePosSales
              ? "mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]"
              : "mt-6 grid gap-3 lg:max-w-[420px]"
          }
        >
          {canSeePosSales ? (
          <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold">Transaksi terakhir</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Penjualan terbaru dari semua kasir</p>
              </div>
              <Link href="/app/pos/riwayat" className="text-[11px] font-medium text-primary hover:underline">
                Lihat semua
              </Link>
            </div>
            {data.recent.length === 0 ? (
              <div className="p-3">
                {/* G3 (UX4-07): teks polos dalam kartu → EmptyState
                    compact, dialek yang sama dengan panel Beranda
                    Akuntansi. */}
                <EmptyState size="compact" title="Belum ada transaksi." description="Mulai dari modul POS." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nomor</th>
                      <th className="hidden sm:table-cell">Waktu</th>
                      <th className="hidden md:table-cell">Kasir</th>
                      <th className="text-right">Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((sale) => (
                      <tr key={sale.id}>
                        <td>
                          <Link href={`/app/pos/nota/${sale.id}?salinan=1`} className="num font-medium hover:underline">
                            {sale.number}
                          </Link>
                        </td>
                        <td className="num hidden whitespace-nowrap text-[12px] text-muted-foreground sm:table-cell">
                          {formatDateTime(sale.createdAt)}
                        </td>
                        <td className="hidden text-[12px] md:table-cell">{sale.cashierName ?? "—"}</td>
                        <td className="num text-right font-medium">{formatIDR(sale.total)}</td>
                        <td>
                          <StatusBadge status={sale.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          ) : null}

          <aside className="space-y-3">
            <div className="rounded-lg border border-dashed border-border bg-card/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pintasan</p>
              <div className="mt-2 grid gap-1.5">
                {(
                  [
                    ["Mulai transaksi kasir", "/app/pos", canSeePos && ctx.permissions.includes("pos.sell")],
                    ["Terima barang masuk", "/app/gudang/penerimaan", canSeeGudang && can(ctx, "inventory.manage")],
                    ["Catat beban / jurnal", "/app/akuntansi/jurnal/baru", ctx.permissions.includes("accounting.post")],
                    ["Lihat laporan keuangan", "/app/akuntansi/laporan", canSeeAkuntansi],
                    // A-24 T1 (SIS-11): Pengaturan kini dunia sendiri —
                    // pintasan dari beranda untuk pemegang izinnya.
                    ["Pengaturan perusahaan", "/app/pengaturan", ctx.permissions.includes("settings.manage")],
                  ] as [string, string, boolean][]
                )
                  .filter(([, , visible]) => visible)
                  .map(([label, href]) => (
                    <Link
                      key={href}
                      href={href}
                      className="flex min-h-11 items-center justify-between rounded-md px-2 py-1.5 text-[12px] hover:bg-muted lg:min-h-0"
                    >
                      {label}
                      <ArrowUpRight className="size-3.5 text-muted-foreground" />
                    </Link>
                  ))}
              </div>
            </div>
          </aside>
        </div>
        ) : null}

        <p className="mt-8 text-center text-[10px] text-muted-foreground">
          {visibleModules.map((module) => module.name).join(" · ")} — Bisa ERP
        </p>
      </main>
    </div>
  );
}

function Attention({
  label,
  value,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string;
  href: string;
  tone?: "neutral" | "red" | "amber" | "green";
}) {
  const dot =
    tone === "red" ? "bg-tone-red" : tone === "amber" ? "bg-chart-3" : tone === "green" ? "bg-tone-green" : "bg-muted-foreground/40";
  return (
    <li>
      <Link href={href} className="group flex min-h-11 items-center justify-between gap-2 rounded-md px-1 py-1 text-[12px] hover:bg-muted/40 sm:min-h-0 sm:px-0 sm:py-0 sm:hover:bg-transparent">
        <span className="flex items-center gap-2 text-muted-foreground">
          <span className={`size-1.5 rounded-full ${dot}`} />
          {label}
        </span>
        <span className="font-medium group-hover:underline">{value}</span>
      </Link>
    </li>
  );
}

function moduleStats(
  key: ModuleKey,
  summary: Awaited<ReturnType<typeof getHomeSummary>>,
  staff: Awaited<ReturnType<typeof listEmployees>> = [],
  canSeeCost = false,
) {
  if (key === "pos") {
    return [
      { label: "Penjualan", value: formatIDR(summary.todaySales) },
      { label: "Transaksi", value: formatNumber(summary.todayTransactions) },
    ];
  }
  if (key === "gudang") {
    return [
      ...(canSeeCost ? [{ label: "Persediaan (GL)", value: formatIDR(summary.inventoryValue) }] : []),
      { label: "Stok tipis", value: `${summary.lowStockCount} SKU` },
    ];
  }
  if (key === "hr") {
    const active = staff.filter((row) => row.isActive).length;
    return [
      { label: "Karyawan aktif", value: formatNumber(active) },
      { label: "Total karyawan", value: formatNumber(staff.length) },
    ];
  }
  return [
    { label: "Omzet bulan", value: formatIDR(summary.monthSales) },
    { label: "Kas & bank", value: formatIDR(summary.cashBalance) },
  ];
}
