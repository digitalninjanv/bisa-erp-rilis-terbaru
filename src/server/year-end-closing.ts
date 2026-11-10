import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, fiscalPeriods, journalEntries, journalLines } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, type Decimal } from "@/lib/money";
import { getAccountId, postJournal, signedBalance } from "@/server/accounting";
import { writeAudit } from "@/server/audit";

/**
 * FIX-P1 Tahap 5 (AK5-04 + AK1-05): tutup buku tahunan.
 *
 * Sebelumnya tidak ada jurnal penutup sama sekali — akuntan menyusunnya
 * manual dari nol. Domain ini menyediakan alurnya:
 *
 * - `previewYearEndClosing` — angka tahun berjalan (pendapatan, beban,
 *   laba bersih) + akun per baris yang akan ditutup, tanpa menulis apa pun.
 * - `postYearEndClosing` — SATU jurnal penutup bertanggal 31 Des tahun
 *   itu (sourceType `year_end_closing`): setiap akun pendapatan/HPP/beban
 *   dinolkan, selisihnya (laba/rugi bersih) pindah ke akun laba ditahan
 *   yang dipilih (bawaan: pemetaan `equity`). Idempoten per tahun —
 *   tahun yang sudah ditutup (dan belum dibalik) ditolak CONFLICT.
 * - Jurnal penutup adalah jurnal biasa: membatalkannya memakai
 *   mekanisme reversal standar (`reverseJournalEntry`); sesudah dibalik,
 *   tahun dapat ditutup ulang (kunci idempotensi membedakan percobaan).
 * - `lockYearPeriods` — aksi TERPISAH dan eksplisit: mengunci ke-12
 *   periode tahun itu. Tidak pernah berjalan otomatis dari penutupan.
 */

export const YEAR_END_CLOSING_SOURCE = "year_end_closing";

type ClosingAccountBalance = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  /** Saldo bertanda menurut saldo normal tipe akun (Decimal). */
  signed: Decimal;
};

async function pnlBalances(
  tx: Tx,
  companyId: string,
  year: number,
): Promise<ClosingAccountBalance[]> {
  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(accounts)
    .innerJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .innerJoin(
      journalEntries,
      and(eq(journalLines.entryId, journalEntries.id), eq(journalEntries.status, "posted")),
    )
    .where(
      and(
        eq(accounts.companyId, companyId),
        inArray(accounts.type, ["revenue", "cogs", "expense"]),
        gte(journalEntries.date, `${year}-01-01`),
        lte(journalEntries.date, `${year}-12-31`),
      ),
    )
    .orderBy(asc(accounts.code));

  const byAccount = new Map<string, ClosingAccountBalance & { debit: Decimal; credit: Decimal }>();
  for (const row of rows) {
    const current = byAccount.get(row.accountId) ?? {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      signed: d(0),
      debit: d(0),
      credit: d(0),
    };
    current.debit = current.debit.plus(row.debit);
    current.credit = current.credit.plus(row.credit);
    byAccount.set(row.accountId, current);
  }
  return [...byAccount.values()].map((row) => ({
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    type: row.type,
    signed: signedBalance(row.type, row.debit, row.credit),
  }));
}

/** Jurnal penutup tahun itu yang masih berlaku (posted & belum dibalik). */
async function findActiveClosing(
  tx: Tx,
  companyId: string,
  year: number,
): Promise<{ id: string; number: string } | null> {
  const closings = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.sourceType, YEAR_END_CLOSING_SOURCE),
        eq(journalEntries.date, `${year}-12-31`),
        eq(journalEntries.status, "posted"),
      ),
    );
  for (const closing of closings) {
    const [reversal] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(eq(journalEntries.companyId, companyId), eq(journalEntries.reversalOfId, closing.id)),
      )
      .limit(1);
    if (!reversal) return closing;
  }
  return null;
}

async function countClosings(tx: Tx, companyId: string, year: number): Promise<number> {
  const rows = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.sourceType, YEAR_END_CLOSING_SOURCE),
        eq(journalEntries.date, `${year}-12-31`),
      ),
    );
  return rows.length;
}

export async function previewYearEndClosing(tx: Tx, companyId: string, year: number) {
  const balances = await pnlBalances(tx, companyId, year);
  const revenue = balances.filter((row) => row.type === "revenue");
  const expense = balances.filter((row) => row.type === "cogs" || row.type === "expense");
  const totalRevenue = revenue.reduce((acc, row) => acc.plus(row.signed), d(0));
  const totalExpense = expense.reduce((acc, row) => acc.plus(row.signed), d(0));
  const netProfit = totalRevenue.minus(totalExpense);
  const [activeClosing, mappedRetained] = await Promise.all([
    findActiveClosing(tx, companyId, year),
    getAccountId(tx, companyId, "equity").catch(() => null),
  ]);
  return {
    year,
    totalRevenue: totalRevenue.toNumber(),
    totalExpense: totalExpense.toNumber(),
    netProfit: netProfit.toNumber(),
    retainedEarningsAccountId: mappedRetained,
    alreadyClosed: Boolean(activeClosing),
    closingJournal: activeClosing,
    accounts: balances
      .filter((row) => !row.signed.isZero())
      .map((row) => ({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        type: row.type,
        balance: row.signed.toNumber(),
      })),
  };
}

export async function postYearEndClosing(
  tx: Tx,
  input: {
    companyId: string;
    year: number;
    retainedEarningsAccountId: string;
    createdBy?: string | null;
  },
): Promise<{ id: string; number: string }> {
  const year = input.year;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new AppError("VALIDATION", `Tahun buku ${year} tidak valid.`);
  }

  const active = await findActiveClosing(tx, input.companyId, year);
  if (active) {
    throw new AppError(
      "CONFLICT",
      `Buku tahun ${year} sudah ditutup oleh jurnal ${active.number}. Balik jurnal penutup itu terlebih dahulu bila tahun ini memang harus ditutup ulang.`,
    );
  }

  const [retained] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, input.retainedEarningsAccountId)))
    .limit(1);
  if (!retained) {
    throw new AppError("VALIDATION", "Akun laba ditahan tidak ditemukan untuk perusahaan ini.");
  }
  if (retained.type !== "equity") {
    throw new AppError(
      "VALIDATION",
      `Akun ${retained.code} (${retained.name}) bukan akun ekuitas — laba bersih hanya boleh dipindahkan ke akun ekuitas (laba ditahan).`,
    );
  }
  if (!retained.isPostable || !retained.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun ${retained.code} (${retained.name}) tidak dapat dipakai: akun harus aktif dan dapat diposting.`,
    );
  }

  // WF-002: Tutup buku tahunan mensyaratkan tidak ada periode bulanan yang masih open
  const openPeriods = await tx
    .select({ month: fiscalPeriods.month })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, input.companyId),
        eq(fiscalPeriods.year, year),
        eq(fiscalPeriods.status, "open"),
      ),
    );
  if (openPeriods.length > 0) {
    const months = openPeriods.map((p) => p.month).join(", ");
    throw new AppError(
      "CONFLICT",
      `Tutup buku tahun ${year} tidak dapat diposting karena masih ada periode bulanan yang berstatus open (Bulan: ${months}). Tutup atau kunci seluruh periode tersebut terlebih dahulu.`,
    );
  }

  const balances = (await pnlBalances(tx, input.companyId, year)).filter((row) => !row.signed.isZero());
  if (balances.length === 0) {
    throw new AppError(
      "VALIDATION",
      `Tidak ada saldo pendapatan atau beban pada tahun ${year} — tidak ada yang perlu ditutup.`,
    );
  }

  const totalRevenue = balances
    .filter((row) => row.type === "revenue")
    .reduce((acc, row) => acc.plus(row.signed), d(0));
  const totalExpense = balances
    .filter((row) => row.type !== "revenue")
    .reduce((acc, row) => acc.plus(row.signed), d(0));
  const netProfit = totalRevenue.minus(totalExpense);

  const lines = balances.map((row) => {
    // Akun pendapatan bersaldo kredit (signed > 0) didebit agar nol;
    // akun beban/HPP bersaldo debit (signed > 0) dikredit agar nol.
    // Saldo menyimpang (signed < 0) ditutup dari sisi sebaliknya.
    const amount = row.signed.abs();
    const debitSide = row.type === "revenue" ? row.signed.gte(0) : row.signed.lt(0);
    return {
      accountId: row.accountId,
      debit: debitSide ? amount : undefined,
      credit: debitSide ? undefined : amount,
      description: `Penutup ${row.code} ${row.name} tahun ${year}`,
    };
  });
  if (!netProfit.isZero()) {
    lines.push({
      accountId: retained.id,
      debit: netProfit.lt(0) ? netProfit.abs() : undefined,
      credit: netProfit.gt(0) ? netProfit : undefined,
      description: netProfit.gt(0)
        ? `Laba bersih tahun ${year} dipindahkan ke laba ditahan`
        : `Rugi bersih tahun ${year} dipindahkan ke laba ditahan`,
    });
  }

  const attempt = await countClosings(tx, input.companyId, year);
  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: `${year}-12-31`,
    description: `Tutup buku tahun ${year} — pendapatan dan beban dipindahkan ke laba ditahan`,
    sourceType: YEAR_END_CLOSING_SOURCE,
    createdBy: input.createdBy ?? null,
    idempotencyKey: `year-end-closing:${year}:${attempt}`,
    lines,
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.createdBy ?? null,
    action: "period.year_end_closing",
    entityType: "journal_entry",
    entityId: entry.id,
    after: {
      year,
      journalNumber: entry.number,
      totalRevenue: totalRevenue.toFixed(4),
      totalExpense: totalExpense.toFixed(4),
      netProfit: netProfit.toFixed(4),
      retainedEarningsAccountId: retained.id,
    },
  });

  return entry;
}

/**
 * Mengunci ke-12 periode tahun fiskal sekaligus. Sengaja terpisah dari
 * penutupan buku: mengunci adalah keputusan audit, bukan efek samping.
 */
export async function lockYearPeriods(
  tx: Tx,
  input: { companyId: string; year: number; userId?: string | null },
): Promise<{ locked: number; total: number }> {
  const rows = await tx
    .select({ id: fiscalPeriods.id, status: fiscalPeriods.status })
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.companyId, input.companyId), eq(fiscalPeriods.year, input.year)))
    .for("update");
  if (rows.length === 0) {
    throw new AppError(
      "NOT_FOUND",
      `Periode tahun ${input.year} belum dibuat. Buat dulu dari halaman Periode sebelum mengunci.`,
    );
  }
  const open = rows.filter((row) => row.status !== "locked");
  if (open.length > 0) {
    await tx
      .update(fiscalPeriods)
      .set({ status: "locked", closedAt: new Date(), closedBy: input.userId ?? null })
      .where(
        and(
          eq(fiscalPeriods.companyId, input.companyId),
          eq(fiscalPeriods.year, input.year),
        ),
      );
  }
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId ?? null,
    action: "period.lock_year",
    entityType: "fiscal_period",
    after: { year: input.year, locked: open.length, total: rows.length },
  });
  return { locked: open.length, total: rows.length };
}
