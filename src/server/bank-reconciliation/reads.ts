// A-26 Q8 (K-10): pecahan src/server/bank-reconciliation.ts per
// concern (akun / baris buku / mutasi / pencocokan / baca). Perilaku
// tidak berubah; jalur impor publik tetap lewat
// src/server/bank-reconciliation.ts (barrel).

import { and, asc, count, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, bankStatementLines, journalEntries, journalLines } from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import type { ContraAccountOption, ContraModels, ModelAccount } from "@/lib/reconciliation-form";
import { normalizePageParams, pageOffset, pageResult } from "@/lib/pagination";
import { d, toDb } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { listReconciliationAccounts, requireReconciliationAccount } from "./accounts";
import { claimedJournalLineIds, loadBookLines } from "./book-lines";

/* ------------------------------------------------------------------ */

export async function getReconciliationSummary(
  tx: Tx,
  companyId: string,
  accountId: string,
): Promise<{
  bookBalance: string;
  reconciledTotal: string;
  unreconciledTotal: string;
  unmatchedStatementTotal: string;
}> {
  const account = await requireReconciliationAccount(tx, companyId, accountId);
  const sign = account.normalBalance === "debit" ? 1 : -1;
  const signed = (debit: string | number | null | undefined, credit: string | number | null | undefined) =>
    d(debit).minus(d(credit)).mul(sign);

  const [book] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.status, "posted"),
        lte(journalEntries.date, todayISO()),
      ),
    );

  // T4R-3b: the matched total must use the same "live" predicate and the
  // same <= today bound as the book balance above. A linked journal that
  // was later reversed (or a reversal line, or a future-dated entry) has
  // zero net effect on the book, so counting it here would shrink the
  // unexplained difference fictitiously — it could even go negative.
  const [matched] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(bankStatementLines, eq(bankStatementLines.matchedJournalLineId, journalLines.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.accountId, accountId),
        eq(bankStatementLines.companyId, companyId),
        eq(journalEntries.status, "posted"),
        isNull(journalEntries.reversalOfId),
        sql`not exists (select 1 from journal_entries rev where rev.reversal_of_id = ${journalEntries.id} and rev.status = 'posted')`,
        lte(journalEntries.date, todayISO()),
      ),
    );

  const [unmatchedStatement] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${bankStatementLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${bankStatementLines.credit}), 0)`,
    })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.companyId, companyId),
        eq(bankStatementLines.accountId, accountId),
        isNull(bankStatementLines.matchedJournalLineId),
      ),
    );

  const bookBalance = signed(book?.debit, book?.credit);
  const reconciledTotal = signed(matched?.debit, matched?.credit);
  return {
    bookBalance: toDb(bookBalance),
    reconciledTotal: toDb(reconciledTotal),
    unreconciledTotal: toDb(bookBalance.minus(reconciledTotal)),
    // Statement-side net: debit (money in) positive, credit negative.
    unmatchedStatementTotal: toDb(d(unmatchedStatement?.debit).minus(unmatchedStatement?.credit)),
  };
}

/** Saldo buku satu akun per tanggal tertentu — pembanding saldo akhir koran. */
export async function getBookBalanceAsOf(
  tx: Tx,
  companyId: string,
  accountId: string,
  asOf: string,
): Promise<string> {
  const account = await requireReconciliationAccount(tx, companyId, accountId);
  const sign = account.normalBalance === "debit" ? 1 : -1;
  const [book] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.status, "posted"),
        lte(journalEntries.date, asOf),
      ),
    );
  return toDb(d(book?.debit).minus(book?.credit).mul(sign));
}

/**
 * A-22 Tahap K5: antrean rekonsiliasi untuk kartu dashboard — jumlah
 * baris mutasi yang belum terpasangkan di SEMUA rekening rekonsiliasi
 * perusahaan beserta neto bertandanya (debit masuk positif, kredit
 * keluar negatif; pola unmatchedStatementTotal di atas). Fungsi baca
 * bernama agar halaman dashboard tidak mengagregasi sendiri (ARS1-01).
 */
export async function countUnmatchedStatementLines(
  tx: Tx,
  companyId: string,
): Promise<{ count: number; netTotal: string }> {
  const [row] = await tx
    .select({
      total: count(),
      debit: sql<string>`coalesce(sum(${bankStatementLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${bankStatementLines.credit}), 0)`,
    })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.companyId, companyId),
        isNull(bankStatementLines.matchedJournalLineId),
      ),
    );
  return {
    count: row?.total ?? 0,
    netTotal: toDb(d(row?.debit).minus(d(row?.credit))),
  };
}

export async function listBookLines(
  tx: Tx,
  companyId: string,
  accountId: string,
  opts: { status?: "all" | "matched" | "unmatched"; page?: number; pageSize?: number } = {},
) {
  const { page, pageSize } = normalizePageParams(opts, 50);
  const status = opts.status ?? "all";
  const all = await loadBookLines(tx, companyId, accountId);
  const claimed = await claimedJournalLineIds(tx, companyId, accountId);
  const statementByJournalLine = new Map<string, string>();
  const links = await tx
    .select({ id: bankStatementLines.id, journalLineId: bankStatementLines.matchedJournalLineId })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.companyId, companyId),
        eq(bankStatementLines.accountId, accountId),
        isNotNull(bankStatementLines.matchedJournalLineId),
      ),
    );
  for (const link of links) {
    if (link.journalLineId) statementByJournalLine.set(link.journalLineId, link.id);
  }

  const decorated = all
    .map((row) => ({
      ...row,
      matched: claimed.has(row.id),
      statementLineId: statementByJournalLine.get(row.id) ?? null,
    }))
    .filter((row) =>
      status === "matched" ? row.matched : status === "unmatched" ? !row.matched : true,
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));

  const total = decorated.length;
  const start = pageOffset(page, pageSize);
  const rows = decorated.slice(start, start + pageSize);
  return pageResult(rows, total, page, pageSize);
}

/**
 * Satu-satunya sumber data form jurnal-dari-mutasi: halaman tidak lagi
 * mengueri tabel akun sendiri (ARS1-01 — pemetaan tinggal di tabel
 * lain, jadi resolusi model memang pekerjaan modul pemilik).
 *
 * Resolusi model:
 * - Biaya admin bank → pemetaan `bank_fee`.
 * - Bunga bank → pemetaan `other_income`; bila belum dipetakan, akun
 *   pendapatan ber-seksi laporan `other_income` berkode terkecil
 *   (pada templat 5 digit: 71001 Pendapatan Operasional Lainnya);
 *   terakhir fallback pemetaan `revenue` (pola
 *   party-writeoffs/createReceipt).
 * - PPh atas bunga → TIDAK ada pemetaan khusus; dicari akun beban/aset
 *   aktif bernama mengandung "pph"/"pajak" (diutamakan yang menyebut
 *   "bunga"). Akun liabilitas seperti Utang PPh SENGAJA dikecualikan:
 *   itu utang atas potongan yang KITA lakukan ke pihak lain, bukan
 *   potongan bank atas bunga kita. Bila tak ada kandidat, null.
 */
/* ------------------------------------------------------------------ */
/* Form data untuk panel jurnal-dari-mutasi (A-22 K3)                  */
/* ------------------------------------------------------------------ */

export type ReconciliationFormData = {
  /** Semua akun postable aktif selain akun bank terpilih, ditandai
   * tipe & keanggotaan kas/bank agar UI mengelompokkannya (K3 butir 3). */
  contraAccounts: ContraAccountOption[];
  /** Akun hasil resolusi untuk tombol model lawan cepat (K3 butir 4). */
  models: ContraModels;
};

export async function getReconciliationFormData(
  tx: Tx,
  companyId: string,
  accountId: string,
): Promise<ReconciliationFormData> {
  const [map, eligible, rows] = await Promise.all([
    getAccountMap(tx, companyId),
    listReconciliationAccounts(tx, companyId),
    tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        section: accounts.section,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.companyId, companyId),
          eq(accounts.isPostable, true),
          eq(accounts.isActive, true),
        ),
      )
      .orderBy(asc(accounts.code)),
  ]);

  const cashBankIds = new Set(eligible.map((row) => row.id));
  const contraAccounts: ContraAccountOption[] = rows
    .filter((row) => row.id !== accountId)
    .map((row) => ({ ...row, isCashBank: cashBankIds.has(row.id) }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolveMapped = (id: string | undefined): ModelAccount | null => {
    if (!id) return null;
    const row = byId.get(id);
    return row ? { id: row.id, code: row.code, name: row.name } : null;
  };

  const taxCandidates = rows.filter(
    (row) =>
      (row.type === "expense" || row.type === "asset") &&
      /pph|pajak/i.test(row.name),
  );
  const taxRow =
    taxCandidates.find((row) => /bunga/i.test(row.name)) ?? taxCandidates[0] ?? null;

  // rows terurut kode menaik, jadi temuan pertama adalah kode terkecil.
  const otherIncomeRow =
    resolveMapped(map.other_income) ??
    (() => {
      const sectionRow = rows.find(
        (row) => row.type === "revenue" && row.section === "other_income",
      );
      return sectionRow
        ? { id: sectionRow.id, code: sectionRow.code, name: sectionRow.name }
        : resolveMapped(map.revenue);
    })();

  return {
    contraAccounts,
    models: {
      bankFee: resolveMapped(map.bank_fee),
      otherIncome: otherIncomeRow,
      taxDeduction: taxRow ? { id: taxRow.id, code: taxRow.code, name: taxRow.name } : null,
    },
  };
}
