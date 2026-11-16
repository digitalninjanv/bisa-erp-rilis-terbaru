import Link from "next/link";
import { Building2 } from "lucide-react";
import { and, eq, inArray } from "drizzle-orm";
import { withCompany } from "@/db/tenant";
import { accounts } from "@/db/schema";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { getAccountMap, listCashBankIds } from "@/server/accounting";
import {
  FIXED_ASSET_STATUS_LABELS,
  getAccumulatedDepreciationGlBalance,
  getFixedAssetBookValues,
  listDepreciationRuns,
  listFixedAssetCategories,
} from "@/server/fixed-assets";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { FilterChips } from "@/components/blocks/search-form";
import { StatusBadge } from "@/components/blocks/status-badge";
import {
  AssetForm,
  CategoryForm,
  DepreciationRunner,
  DisposeAssetButton,
  VoidRunButton,
} from "@/components/akuntansi/fixed-asset-panel";

export const metadata = { title: "Aset Tetap" };
export const dynamic = "force-dynamic";

export default async function AsetTetapPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");

  // A-22 K6: BUKAN withCompanyReadOnly — getAccumulatedDepreciationGlBalance
  // memanggil ensureFixedAssetAccounts (pola ensure D-25: melengkapi
  // akun & pemetaan aset tetap yang belum ada). Di transaksi read-only
  // ensure itu melempar "cannot execute INSERT in a read-only
  // transaction" sehingga halaman ini ERROR untuk perusahaan yang
  // pemetaan aset tetapnya belum pernah dilengkapi (terbukti pada
  // pengukuran K6 di perusahaan demo). withCompany memberi semantik
  // yang memang dirancang untuk jalur ensure; angka tidak berubah.
  const data = await withCompany(ctx.company.id, async (tx) => {
    const report = await getFixedAssetBookValues(tx, ctx.company.id);
    const categories = await listFixedAssetCategories(tx, ctx.company.id);
    const runs = await listDepreciationRuns(tx, ctx.company.id);
    const glAccumulated = await getAccumulatedDepreciationGlBalance(tx, ctx.company.id);
    const map = await getAccountMap(tx, ctx.company.id);
    // A-27 B2: sumber dana kas/bank dari himpunan kelas (listCashBankIds);
    // akun modal tetap penunjuk pemetaan `equity` (satu akun bawaan).
    const cashBankIds = await listCashBankIds(tx, ctx.company.id);
    const cashIds = [...cashBankIds, map.equity].filter(Boolean);
    const sourceAccounts =
      cashIds.length === 0
        ? []
        : await tx
            .select({ id: accounts.id, code: accounts.code, name: accounts.name })
            .from(accounts)
            .where(and(eq(accounts.companyId, ctx.company.id), inArray(accounts.id, cashIds)));
    const postableAccounts = await tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.companyId, ctx.company.id),
          eq(accounts.isPostable, true),
          eq(accounts.isActive, true),
        ),
      )
      .orderBy(accounts.code);
    return { report, categories, runs, glAccumulated, sourceAccounts, postableAccounts };
  });

  const canManage = can(ctx, "accounting.manage");
  const activeAssets = data.report.rows.filter((row) => row.status === "active");
  // Fiori list report: pencarian + filter status aset di server render.
  const q = params.q?.trim().toLowerCase() ?? "";
  const status = params.status === "active" || params.status === "disposed" ? params.status : "";
  const visibleAssets = data.report.rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (!q) return true;
    return `${row.number} ${row.name} ${row.categoryName ?? ""}`.toLowerCase().includes(q);
  });
  const visibleTotals = visibleAssets.reduce(
    (acc, row) => ({
      cost: acc.cost + Number(row.cost),
      accumulated: acc.accumulated + Number(row.accumulated),
      bookValue: acc.bookValue + Number(row.bookValue),
    }),
    { cost: 0, accumulated: 0, bookValue: 0 },
  );
  const glMatches = Number(data.glAccumulated) === Number(data.report.totals.accumulated);

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi"
        title="Aset Tetap & Penyusutan"
        description="Registrasi aset, penyusutan garis lurus bulanan (satu jurnal per periode, idempoten), dan pelepasan. Akun aset, akumulasi, dan beban penyusutan mengikuti pemetaan akun atau akun per kategori."
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <CategoryForm
                accounts={data.postableAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
              />
              <AssetForm
                categories={data.categories
                  .filter((category) => category.isActive)
                  .map((category) => ({
                    id: category.id,
                    code: category.code,
                    name: category.name,
                    defaultUsefulLifeMonths: category.defaultUsefulLifeMonths,
                  }))}
                sourceAccounts={data.sourceAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
              />
            </div>
          ) : null
        }
      />

      <div className="mb-3">
        <SummaryStrip
          items={[
            { label: "Nilai buku total", value: formatIDR(data.report.totals.bookValue), hint: `${activeAssets.length} aset aktif` },
            { label: "Harga perolehan", value: formatIDR(data.report.totals.cost), hint: "Semua aset terdaftar" },
            { label: "Akumulasi penyusutan", value: formatIDR(data.report.totals.accumulated), hint: "Menurut rincian per aset" },
            {
              label: "Saldo GL akumulasi",
              value: formatIDR(data.glAccumulated),
              hint: glMatches ? "Cocok dengan laporan ✓" : "SELISIH dengan laporan — periksa!",
              tone: glMatches ? ("green" as const) : ("red" as const),
            },
          ]}
        />
      </div>

      {canManage ? (
        <section className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Proses penyusutan bulanan</h2>
            <p className="text-[11px] text-muted-foreground">
              Satu jurnal agregat per periode untuk semua aset aktif. Periode yang sudah diproses ditolak bila diproses ulang.
            </p>
          </div>
          <DepreciationRunner />
        </section>
      ) : null}

      {/* A-25 U4: daftar aset memakai DataList bersama (judul seksi di
          luar bingkai); panel riwayat & kategori menyusul di bawah. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="px-0.5 text-[13px] font-semibold">Daftar aset & nilai buku</h2>
        <FilterChips
          options={[
            { label: "Semua", value: "" },
            { label: "Aktif", value: "active" },
            { label: "Dilepas", value: "disposed" },
          ]}
          value={status}
          basePath="/app/akuntansi/aset"
          param="status"
          q={params.q}
        />
      </div>
      <DataList
        className="mb-3"
        toolbar={
          <DataListToolbar
            action="/app/akuntansi/aset"
            q={params.q}
            placeholder="Cari nomor, nama, atau kategori aset…"
            resetHref={params.q || status ? "/app/akuntansi/aset" : undefined}
          />
        }
        isEmpty={visibleAssets.length === 0}
        empty={
          <EmptyState
            title={data.report.rows.length === 0 ? "Belum ada aset tetap" : "Tidak ada aset yang cocok"}
            description={
              data.report.rows.length === 0
                ? "Daftarkan aset pertama lewat tombol Daftarkan Aset."
                : "Ubah kata kunci atau filter status untuk melihat aset lain."
            }
            icon={<Building2 className="size-5" />}
          />
        }
      >
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Aset</th>
                  <th>Kategori</th>
                  <th aria-sort="descending">Perolehan</th>
                  <th className="text-right">Harga</th>
                  <th className="text-right">Akumulasi</th>
                  <th className="text-right">Nilai buku</th>
                  <th>Status</th>
                  {canManage ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleAssets.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[11px] text-muted-foreground">
                      {row.number}
                      {/* A-24 T4: jurnal perolehan & pelepasan aset ini,
                          satu klik dari baris dokumennya. */}
                      {row.journalId ? (
                        <span className="block">
                          Perolehan:{" "}
                          <Link href={`/app/akuntansi/jurnal/${row.journalId}`} className="font-medium text-primary transition-colors hover:underline">
                            {row.journalNumber ?? "Lihat jurnal"}
                          </Link>
                        </span>
                      ) : null}
                      {row.disposalJournalId ? (
                        <span className="block">
                          Pelepasan:{" "}
                          <Link href={`/app/akuntansi/jurnal/${row.disposalJournalId}`} className="font-medium text-primary transition-colors hover:underline">
                            {row.disposalJournalNumber ?? "Lihat jurnal"}
                          </Link>
                        </span>
                      ) : null}
                    </td>
                    <td className="text-[12px] font-medium">
                      {row.name}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        Umur {row.usefulLifeMonths} bln · residu {formatIDR(row.residualValue)}
                      </span>
                    </td>
                    <td className="text-[11px] text-muted-foreground">{row.categoryName ?? "—"}</td>
                    <td className="text-[12px]">{formatDate(row.acquisitionDate)}</td>
                    <td className="num text-right text-[12px]">{formatIDR(row.cost)}</td>
                    <td className="num text-right text-[12px]">{formatIDR(row.accumulated)}</td>
                    <td className="num text-right text-[12px] font-semibold">{formatIDR(row.bookValue)}</td>
                    <td>
                      <StatusBadge status={row.status} label={FIXED_ASSET_STATUS_LABELS[row.status]} />
                      {row.disposalDate ? (
                        <span className="block text-[11px] text-muted-foreground">{formatDate(row.disposalDate)}</span>
                      ) : null}
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        {row.status === "active" ? (
                          <DisposeAssetButton
                            assetId={row.id}
                            number={row.number}
                            accounts={data.sourceAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
                          />
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-[12px] font-semibold">Total</td>
                  <td className="num text-right text-[12px] font-semibold">{formatIDR(visibleTotals.cost)}</td>
                  <td className="num text-right text-[12px] font-semibold">{formatIDR(visibleTotals.accumulated)}</td>
                  <td className="num text-right text-[12px] font-semibold">{formatIDR(visibleTotals.bookValue)}</td>
                  <td colSpan={canManage ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="divide-y divide-border/70 lg:hidden">
            {visibleAssets.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <span className="num text-[11px] text-muted-foreground">{row.number}</span>
                    <h3 className="text-[13px] font-semibold text-foreground">{row.name}</h3>
                  </div>
                  <StatusBadge status={row.status} label={FIXED_ASSET_STATUS_LABELS[row.status]} />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {row.categoryName ?? "—"} · Perolehan {formatDate(row.acquisitionDate)} · Umur {row.usefulLifeMonths} bln
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 rounded border border-border/60 bg-muted/20 p-2 text-[11px]">
                  <div>
                    <span className="block text-[10px] text-muted-foreground">Harga</span>
                    <span className="num font-medium">{formatIDR(row.cost)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-muted-foreground">Akumulasi</span>
                    <span className="num font-medium">{formatIDR(row.accumulated)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-muted-foreground">Nilai Buku</span>
                    <span className="num font-semibold text-primary">{formatIDR(row.bookValue)}</span>
                  </div>
                </div>
                {canManage && row.status === "active" ? (
                  <div className="mt-2 flex justify-end">
                    <DisposeAssetButton
                      assetId={row.id}
                      number={row.number}
                      accounts={data.sourceAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
      </DataList>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 px-0.5 text-[13px] font-semibold">Riwayat proses penyusutan</h2>
          <DataList
            isEmpty={data.runs.length === 0}
            empty={
              <EmptyState title="Belum ada proses penyusutan" description="Periode yang sudah diproses lewat Proses Penyusutan Bulanan akan tercatat di sini." />
            }
          >
            <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Periode</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  {canManage ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {[...data.runs].reverse().map((run) => (
                  <tr key={run.id}>
                    <td className="num text-[12px]">
                      {run.journalId ? (
                        <Link href={`/app/akuntansi/jurnal/${run.journalId}`} className="transition-colors hover:underline">
                          {run.period}
                        </Link>
                      ) : (
                        run.period
                      )}
                    </td>
                    <td className="num text-right text-[12px]">{formatIDR(run.totalAmount)}</td>
                    <td>
                      <StatusBadge status={run.status} label={run.status === "void" ? "Dibatalkan" : "Terposting"} />
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        {run.status !== "void" ? <VoidRunButton runId={run.id} period={run.period} /> : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </DataList>
        </div>

        <div>
          <h2 className="mb-2 px-0.5 text-[13px] font-semibold">Kategori aset</h2>
          <DataList
            isEmpty={data.categories.length === 0}
            empty={
              <EmptyState title="Belum ada kategori" description="Aset tetap bisa didaftarkan tanpa kategori; kategori memberi bawaan umur manfaat, persen residu, dan akun (D-25: semua terkonfigurasi)." />
            }
          >
            <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th className="text-right">Umur bawaan</th>
                  <th className="text-right">Residu bawaan</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((category) => (
                  <tr key={category.id}>
                    <td className="num text-[11px] text-muted-foreground">{category.code}</td>
                    <td className="text-[12px] font-medium">{category.name}</td>
                    <td className="num text-right text-[12px]">{category.defaultUsefulLifeMonths ? `${category.defaultUsefulLifeMonths} bln` : "—"}</td>
                    <td className="num text-right text-[12px]">{category.defaultResidualPercent ? `${category.defaultResidualPercent}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </DataList>
        </div>
      </div>
    </div>
  );
}
