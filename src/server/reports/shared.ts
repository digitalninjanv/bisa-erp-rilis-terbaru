// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  eq,
  gte,
  inArray,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { type CashFlowGroup } from "@/lib/accounting";
import {
  d,
  Decimal,
} from "@/lib/money";
import {
  accountMappings,
  accountMonthlyBalances,
  accounts,
  journalEntries,
  journalLines,
} from "@/db/schema";

export type Range = { from: string; to: string };

/**
 * Kelompok arus kas pada laporan: tiga kelompok baku PSAK 207 ditambah
 * ember eksplisit "unclassified" (Belum terklasifikasi) untuk akun lawan
 * yang kelompoknya tidak ter-resolusi — tampil sebagai kelompok
 * tersendiri, tidak disembunyikan ke operasi (FIX-R2 Tahap 3, AK2-03).
 */
export type CashFlowBucket = CashFlowGroup | "unclassified";

/* ------------------------------------------------------------------ */
/* FIX-ARS Tahap 2 (ARS3-01 / R-4): pembacaan saldo hibrida            */
/*                                                                     */
/* account_monthly_balances menyimpan total debit/kredit jurnal POSTED */
/* per (akun, bulan tanggal jurnal), dipelihara postJournal dalam      */
/* transaksi posting dan di-backfill migrasi 0046. Fungsi saldo inti   */
/* di berkas ini tidak lagi mengagregasi seluruh riwayat journal_lines */
/* untuk setiap permintaan: bulan-bulan PENUH sebelum bulan tanggal    */
/* acuan dibaca dari ringkasan, dan hanya bulan parsial yang memuat    */
/* tanggal acuan yang diagregasi mentah dari journal_lines. Hasilnya  */
/* identik dengan agregat mentah penuh (dibuktikan test kesetaraan     */
/* tests/integration/fix-ars-tahap2-monthly-balances.test.ts).        */
/* ------------------------------------------------------------------ */

type AccountTotals = { debit: Decimal; credit: Decimal };

export const FAR_FUTURE_DATE = "9999-12-31";

export function totalsOf(map: Map<string, AccountTotals>, accountId: string): AccountTotals {
  return map.get(accountId) ?? { debit: d(0), credit: d(0) };
}

/**
 * Total debit/kredit kumulatif per akun atas jurnal POSTED bertanggal
 * <= `through`. Bulan-bulan < bulan(through) berasal dari ringkasan
 * bulanan; bulan(through) sendiri diagregasi mentah dari journal_lines
 * (agar jurnal bulan berjalan — termasuk yang baru diposting dan belum
 * tercermin bila ada jalur tulis lain — selalu terhitung persis).
 */
export async function cumulativeAccountTotals(
  tx: Tx,
  companyId: string,
  through: string,
): Promise<Map<string, AccountTotals>> {
  const month = through.slice(0, 7);
  const monthStart = `${month}-01`;
  const totals = new Map<string, AccountTotals>();
  const add = (accountId: string, debit: string, credit: string) => {
    const current = totalsOf(totals, accountId);
    totals.set(accountId, {
      debit: current.debit.plus(debit),
      credit: current.credit.plus(credit),
    });
  };

  const summaryRows = await tx
    .select({
      accountId: accountMonthlyBalances.accountId,
      debit: sql<string>`coalesce(sum(${accountMonthlyBalances.totalDebit}), 0)`,
      credit: sql<string>`coalesce(sum(${accountMonthlyBalances.totalCredit}), 0)`,
    })
    .from(accountMonthlyBalances)
    .where(
      and(
        eq(accountMonthlyBalances.companyId, companyId),
        lt(accountMonthlyBalances.yearMonth, month),
      ),
    )
    .groupBy(accountMonthlyBalances.accountId);
  for (const row of summaryRows) add(row.accountId, row.debit, row.credit);

  const rawRows = await tx
    .select({
      accountId: journalLines.accountId,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.date, monthStart),
        lte(journalEntries.date, through),
      ),
    )
    .groupBy(journalLines.accountId);
  for (const row of rawRows) add(row.accountId, row.debit, row.credit);

  return totals;
}

/** Total per akun di dalam rentang [from, to] = kumulatif(to) − kumulatif(sebelum from). */
export async function accountTotalsInRange(
  tx: Tx,
  companyId: string,
  from: string,
  to: string,
): Promise<Map<string, AccountTotals>> {
  const before = await cumulativeAccountTotals(tx, companyId, previousDay(from));
  const through = await cumulativeAccountTotals(tx, companyId, to);
  const result = new Map<string, AccountTotals>();
  for (const [accountId, totals] of through) {
    const base = totalsOf(before, accountId);
    result.set(accountId, {
      debit: totals.debit.minus(base.debit),
      credit: totals.credit.minus(base.credit),
    });
  }
  return result;
}

/**
 * Mutasi per akun dalam rentang, dengan sumber jurnal tertentu
 * dikecualikan. Dipakai laporan laba rugi periode agar jurnal tutup
 * buku (`year_end_closing`) tidak menghapus aktivitas tahun yang sudah
 * ditutup. Agregasi mentah dipakai karena ringkasan bulanan tidak
 * menyimpan source_type.
 */
export async function accountTotalsInRangeExcludingSources(
  tx: Tx,
  companyId: string,
  from: string,
  to: string,
  excludedSourceTypes: string[],
): Promise<Map<string, AccountTotals>> {
  if (excludedSourceTypes.length === 0) {
    return accountTotalsInRange(tx, companyId, from, to);
  }
  const rows = await tx
    .select({
      accountId: journalLines.accountId,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.date, from),
        lte(journalEntries.date, to),
        notInArray(journalEntries.sourceType, excludedSourceTypes),
      ),
    )
    .groupBy(journalLines.accountId);
  return new Map(
    rows.map((row) => [row.accountId, { debit: d(row.debit), credit: d(row.credit) }]),
  );
}

/** Sum of signed account movements for a set of account keys. */
export async function mappedBalance(
  tx: Tx,
  companyId: string,
  keys: string[],
  opts?: { to?: string },
): Promise<number> {
  const mappingRows = await tx
    .select({ accountId: accountMappings.accountId, type: accounts.type })
    .from(accountMappings)
    .innerJoin(accounts, eq(accountMappings.accountId, accounts.id))
    .where(
      and(eq(accountMappings.companyId, companyId), inArray(accountMappings.key, keys)),
    );
  if (mappingRows.length === 0) return 0;

  const totals = await cumulativeAccountTotals(tx, companyId, opts?.to ?? FAR_FUTURE_DATE);

  // AK-P3-04: accumulate in Decimal; the single toNumber() at the boundary
  // converts an exact result instead of summing per-row float error.
  // Akumulasi per BARIS pemetaan (bukan per akun unik) mempertahankan
  // semantik join lama persis: akun yang terpetakan ke dua kunci yang
  // diminta terhitung dua kali, sama seperti join sebelumnya.
  return mappingRows
    .reduce((acc, row) => {
      const sign = row.type === "asset" || row.type === "expense" || row.type === "cogs" ? 1 : -1;
      const accountTotals = totalsOf(totals, row.accountId);
      return acc.plus(accountTotals.debit.minus(accountTotals.credit).mul(sign));
    }, d(0))
    .toNumber();
}

export function previousDay(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
