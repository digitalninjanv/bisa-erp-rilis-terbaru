import { and, asc, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { fiscalPeriods } from "@/db/schema";
import { getMonthEndChecklist, getPeriodJournalSummaries, listAccounts } from "@/server/reports";
import { previewYearEndClosing } from "@/server/year-end-closing";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/blocks/page-header";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { MonthEndChecklist } from "@/components/akuntansi/month-end-checklist";
import { PeriodManager } from "@/components/akuntansi/period-manager";
import { YearEndClosingPanel } from "@/components/akuntansi/year-end-closing-panel";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";

export const metadata = { title: "Periode fiskal" };
export const dynamic = "force-dynamic";

export default async function FiscalPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; bulan?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const now = new Date();
  const currentYear = now.getFullYear();
  const year = Math.min(2100, Math.max(2000, Number(params.year) || currentYear));
  const canManage = can(ctx, "accounting.manage");
  // A-24 T4: bulan daftar periksa akhir bulan — bawaan bulan lalu
  // (bulan yang lazim sedang ditutup), dapat diganti lewat ?bulan=.
  const prevMonth = new Date(Date.UTC(currentYear, now.getMonth() - 1, 1));
  const bulanMatch = /^(\d{4})-(\d{2})$/.exec(params.bulan ?? "");
  const checklistYear = bulanMatch ? Number(bulanMatch[1]) : prevMonth.getUTCFullYear();
  const checklistMonth = bulanMatch
    ? Math.min(12, Math.max(1, Number(bulanMatch[2])))
    : prevMonth.getUTCMonth() + 1;

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const periods = await tx
      .select({ id: fiscalPeriods.id, month: fiscalPeriods.month, status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.companyId, ctx.company.id), eq(fiscalPeriods.year, year)))
      .orderBy(asc(fiscalPeriods.month));

    const summaries = await getPeriodJournalSummaries(tx, ctx.company.id, year);

    const [closingPreview, accounts, checklist] = await Promise.all([
      previewYearEndClosing(tx, ctx.company.id, year),
      listAccounts(tx, ctx.company.id),
      getMonthEndChecklist(tx, ctx.company.id, checklistYear, checklistMonth),
    ]);
    const equityAccounts = accounts
      .filter((row) => row.type === "equity" && row.isPostable && row.isActive)
      .map((row) => ({ id: row.id, code: row.code, name: row.name }));

    return { periods, summaries, closingPreview, equityAccounts, checklist };
  });

  const allLocked =
    data.periods.length === 12 && data.periods.every((row) => row.status === "locked");

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi"
        title="Periode fiskal"
        description="Buka, tutup, atau kunci periode pembukuan. Posting jurnal ditolak pada periode yang ditutup atau dikunci."
      />

      <AutoFilterForm className="mb-3 flex items-end gap-2" action="/app/akuntansi/periode">
        <label className="space-y-1">
          {/* A-22 K6: label & kontrol memakai kelas form bersama
              (sebelumnya label 11px + input tanpa ring fokus). */}
          <span className={labelClass}>Tahun</span>
          <span className="block w-28">
            <input
              type="number"
              name="year"
              min={2000}
              max={2100}
              defaultValue={year}
              className={fieldClass}
            />
          </span>
        </label>
        <button type="submit" className="h-8 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted">
          Tampilkan
        </button>
      </AutoFilterForm>

      <div className="mb-3 rounded-lg border border-border bg-card px-4 py-3 text-[12px] leading-5 text-muted-foreground">
        <p className="font-semibold text-foreground">Urutan tutup periode</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Selesaikan rekonsiliasi kas, bank, piutang, utang, dan persediaan.</li>
          <li>Pastikan jurnal periode sudah final, lalu tutup periode.</li>
          <li>Kunci setelah pemeriksaan internal selesai; pembukaan kembali perlu persetujuan.</li>
          <li>Akhir tahun, posting jurnal penutup lalu kunci seluruh 12 periode secara terpisah.</li>
        </ol>
      </div>

      <MonthEndChecklist
        year={checklistYear}
        month={checklistMonth}
        pageYear={year}
        steps={data.checklist.steps}
      />

      <PeriodManager
        periods={data.periods}
        year={year}
        canManage={canManage}
        canUnlockLocked={ctx.role === "owner"}
        summaries={data.summaries}
      />

      <YearEndClosingPanel
        year={year}
        canManage={canManage}
        allLocked={allLocked}
        hasPeriods={data.periods.length > 0}
        equityAccounts={data.equityAccounts}
        preview={{
          totalRevenue: data.closingPreview.totalRevenue,
          totalExpense: data.closingPreview.totalExpense,
          netProfit: data.closingPreview.netProfit,
          alreadyClosed: data.closingPreview.alreadyClosed,
          closingJournal: data.closingPreview.closingJournal,
          retainedEarningsAccountId: data.closingPreview.retainedEarningsAccountId,
          accounts: data.closingPreview.accounts,
        }}
      />
    </div>
  );
}
