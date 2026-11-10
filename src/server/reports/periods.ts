// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  count,
  eq,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { formatIDR } from "@/lib/money";
import { previewYearEndClosing } from "@/server/year-end-closing";
import {
  fiscalPeriods,
  fixedAssetDepreciationRuns,
  fixedAssets,
} from "@/db/schema";
import { getControlReconciliation } from "./control";

export async function getFiscalPeriodStatus(tx: Tx, companyId: string, year: number, month: number) {
  const [row] = await tx
    .select({ month: fiscalPeriods.month, status: fiscalPeriods.status })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, companyId),
        eq(fiscalPeriods.year, year),
        eq(fiscalPeriods.month, month),
      ),
    )
    .limit(1);
  return row ?? null;
}

// FIX-P1 Tahap 5 (AK5-04): ringkasan isi per bulan (jumlah jurnal
// posted & total debit) agar dialog konfirmasi tutup/kunci
// menampilkan apa yang sebenarnya dikunci — bukan klik buta.
export async function getPeriodJournalSummaries(tx: Tx, companyId: string, year: number) {
  const summaryRows = (await tx.execute(sql`
    select extract(month from e.date)::int as month,
           count(distinct e.id)::int as entries,
           coalesce(sum(l.debit), 0)::text as debit
    from journal_entries e
    left join journal_lines l on l.entry_id = e.id and l.company_id = ${companyId}
    where e.company_id = ${companyId}
      and e.status = 'posted'
      and extract(year from e.date) = ${year}
    group by 1
  `)) as unknown as { month: number; entries: number; debit: string }[];
  const summaries: Record<number, { entries: number; debit: number }> = {};
  for (const row of summaryRows) {
    summaries[row.month] = { entries: row.entries, debit: Number(row.debit) };
  }
  return summaries;
}

export type MonthEndChecklistStepStatus = "done" | "pending" | "not_applicable";

export type MonthEndChecklistStep = {
  key: "depreciation" | "control" | "period" | "year_end";
  title: string;
  status: MonthEndChecklistStepStatus;
  detail: string;
  href: string;
};

/**
 * A-24 T4 (pola Accurate "Proses Akhir Bulan") — daftar periksa tutup
 * periode yang dihitung dari KEADAAN NYATA bulan itu: run penyusutan
 * terposting, selisih rekonsiliasi kontrol per akhir bulan, status
 * periode fiskal, dan (khusus Desember) jurnal penutup tahun. Tidak
 * ada langkah simulasi: setiap status menunjuk data sungguhan dan
 * tautan menuju halaman pemilik langkahnya.
 */
export async function getMonthEndChecklist(
  tx: Tx,
  companyId: string,
  year: number,
  month: number,
): Promise<{ year: number; month: number; endOfMonth: string; steps: MonthEndChecklistStep[] }> {
  const mm = String(month).padStart(2, "0");
  const periodKey = `${year}-${mm}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endOfMonth = `${periodKey}-${String(lastDay).padStart(2, "0")}`;

  const [postedRun] = await tx
    .select({ id: fixedAssetDepreciationRuns.id, assetCount: fixedAssetDepreciationRuns.assetCount })
    .from(fixedAssetDepreciationRuns)
    .where(
      and(
        eq(fixedAssetDepreciationRuns.companyId, companyId),
        eq(fixedAssetDepreciationRuns.period, periodKey),
        eq(fixedAssetDepreciationRuns.status, "posted"),
      ),
    )
    .limit(1);
  let depreciation: MonthEndChecklistStep;
  if (postedRun) {
    depreciation = {
      key: "depreciation",
      title: "Jalankan penyusutan aset tetap",
      status: "done",
      detail: `Penyusutan periode ${periodKey} sudah dijalankan (${postedRun.assetCount} aset).`,
      href: "/app/akuntansi/aset",
    };
  } else {
    const [assetCountRow] = await tx
      .select({ total: count() })
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.companyId, companyId),
          eq(fixedAssets.status, "active"),
          lte(fixedAssets.acquisitionDate, endOfMonth),
        ),
      );
    const activeAssets = assetCountRow?.total ?? 0;
    depreciation =
      activeAssets === 0
        ? {
            key: "depreciation",
            title: "Jalankan penyusutan aset tetap",
            status: "not_applicable",
            detail: "Tidak ada aset aktif yang diperoleh s.d. akhir bulan ini, jadi tidak ada penyusutan yang perlu dijalankan.",
            href: "/app/akuntansi/aset",
          }
        : {
            key: "depreciation",
            title: "Jalankan penyusutan aset tetap",
            status: "pending",
            detail: `Ada ${activeAssets} aset aktif dan penyusutan periode ${periodKey} belum dijalankan.`,
            href: "/app/akuntansi/aset",
          };
  }

  const control = await getControlReconciliation(tx, companyId, endOfMonth);
  const offLegs = control.legs.filter((leg) => leg.difference !== 0);
  const controlStep: MonthEndChecklistStep = {
    key: "control",
    title: "Rekonsiliasi akun kontrol seimbang",
    status: offLegs.length === 0 ? "done" : "pending",
    detail:
      offLegs.length === 0
        ? `Piutang, utang, dan persediaan selaras dengan subledgernya per ${endOfMonth}.`
        : `Masih berselisih per ${endOfMonth}: ${offLegs.map((leg) => `${leg.label} ${formatIDR(leg.difference)}`).join(", ")}. Telusur di Rekonsiliasi kontrol sebelum menutup periode.`,
    href: "/app/akuntansi/rekonsiliasi-kontrol",
  };

  const [periodStatus, summaries] = await Promise.all([
    getFiscalPeriodStatus(tx, companyId, year, month),
    getPeriodJournalSummaries(tx, companyId, year),
  ]);
  const entryCount = summaries[month]?.entries ?? 0;
  const periodClosed = periodStatus?.status === "closed" || periodStatus?.status === "locked";
  const periodStep: MonthEndChecklistStep = {
    key: "period",
    title: "Tutup periode bulan ini",
    status: periodClosed ? "done" : "pending",
    detail: periodClosed
      ? `Periode ${periodKey} sudah ${periodStatus?.status === "locked" ? "dikunci" : "ditutup"} (${entryCount} jurnal terposting).`
      : `Periode ${periodKey} masih terbuka dengan ${entryCount} jurnal terposting. Tutup sesudah langkah di atas selesai.`,
    href: "/app/akuntansi/periode",
  };

  let yearEndStep: MonthEndChecklistStep;
  if (month !== 12) {
    yearEndStep = {
      key: "year_end",
      title: "Tutup buku tahunan",
      status: "not_applicable",
      detail: "Tutup buku tahunan hanya dilakukan pada akhir Desember.",
      href: "/app/akuntansi/periode",
    };
  } else {
    const preview = await previewYearEndClosing(tx, companyId, year);
    yearEndStep = preview.alreadyClosed
      ? {
          key: "year_end",
          title: "Tutup buku tahunan",
          status: "done",
          detail: `Buku tahun ${year} sudah ditutup oleh jurnal ${preview.closingJournal?.number ?? ""}.`,
          href: "/app/akuntansi/periode",
        }
      : {
          key: "year_end",
          title: "Tutup buku tahunan",
          status: "pending",
          detail: `Buku tahun ${year} belum ditutup (laba bersih sementara ${formatIDR(preview.netProfit)}).`,
          href: "/app/akuntansi/periode",
        };
  }

  return { year, month, endOfMonth, steps: [depreciation, controlStep, periodStep, yearEndStep] };
}
