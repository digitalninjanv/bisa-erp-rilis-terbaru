// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  d,
  toDb,
  Decimal,
} from "@/lib/money";
import { listLinkedJournalsBySourceIds } from "@/server/catalog";
import {
  accountMappings,
  accounts,
  expenses,
  journalEntries,
  partyPayments,
  suppliers,
} from "@/db/schema";
import { getSystemAccountIds } from "@/server/account-impact";
import { listCashBankAccounts, signedBalance } from "@/server/accounting";
import { listAccounts } from "./ledger";
import { FAR_FUTURE_DATE, cumulativeAccountTotals, mappedBalance, totalsOf } from "./shared";
import type { Range } from "./shared";
import { getBalanceSheet, getIncomeStatement } from "./statements";

export type AccountingOnboardingState = {
  /** Jumlah jurnal berstatus posted — nol berarti belum ada aktivitas. */
  journalCount: number;
  hasPostedJournal: boolean;
  /** Akun bank sudah terpeta (pemetaan "bank" terisi). */
  hasBankMapping: boolean;
};

/**
 * A-22 Tahap K5 (pola onboarding Odoo): keadaan awal modul akuntansi
 * untuk kartu langkah di dashboard. Kartu hanya tampil bila perusahaan
 * belum punya jurnal posted DAN belum punya akun bank terpeta — dua
 * data yang benar-benar bisa dibaca; perusahaan berjalan tidak pernah
 * melihatnya.
 */
export async function getAccountingOnboardingState(
  tx: Tx,
  companyId: string,
): Promise<AccountingOnboardingState> {
  const [journalRow] = await tx
    .select({ total: count() })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")));
  const [bankRow] = await tx
    .select({ key: accountMappings.key })
    .from(accountMappings)
    .where(and(eq(accountMappings.companyId, companyId), eq(accountMappings.key, "bank")))
    .limit(1);
  const journalCount = journalRow?.total ?? 0;
  return { journalCount, hasPostedJournal: journalCount > 0, hasBankMapping: Boolean(bankRow) };
}

/**
 * AK-P3-05(c): expense list with server pagination. `total` counts every row
 * in range (void rows are still displayed, struck through) while the money
 * aggregates exclude void rows — the page header cards must reflect the
 * whole filter, not just the loaded page.
 */
export async function listExpenses(
  tx: Tx,
  companyId: string,
  opts: { from?: string; to?: string; page?: number; pageSize?: number; month?: string } = {},
) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 25)));
  const month = opts.month ?? new Date().toISOString().slice(0, 7);
  const monthFrom = `${month}-01`;
  const [monthYear, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(monthYear, monthNumber, 1)).toISOString().slice(0, 10);

  const inRange = and(
    eq(expenses.companyId, companyId),
    opts.from ? gte(expenses.date, opts.from) : undefined,
    opts.to ? lte(expenses.date, opts.to) : undefined,
  );
  const activeInRange = and(inRange, sql`${expenses.status} <> 'void'`);
  const activeInMonth = and(
    eq(expenses.companyId, companyId),
    sql`${expenses.status} <> 'void'`,
    gte(expenses.date, monthFrom),
    sql`${expenses.date} < ${nextMonth}`,
  );

  const [rows, totalRows, sums] = await Promise.all([
    tx
      .select({
        id: expenses.id,
        number: expenses.number,
        date: expenses.date,
        amount: expenses.amount,
        description: expenses.description,
        status: expenses.status,
        expenseAccount: accounts.name,
        // A-21 (R3-11): penanda beban terutang di riwayat — mode &
        // status bayarnya, plus nama pemasok yang diutangi.
        paymentStatus: expenses.paymentStatus,
        supplierId: expenses.supplierId,
        supplierName: suppliers.name,
      })
      .from(expenses)
      .leftJoin(accounts, eq(expenses.expenseAccountId, accounts.id))
      .leftJoin(suppliers, eq(expenses.supplierId, suppliers.id))
      .where(inRange)
      .orderBy(desc(expenses.date), desc(expenses.createdAt), desc(expenses.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    tx.select({ value: count() }).from(expenses).where(inRange),
    tx
      .select({
        totalAmount: sql<string>`coalesce(sum(case when ${activeInRange} then ${expenses.amount} else 0 end), 0)`,
        monthAmount: sql<string>`coalesce(sum(case when ${activeInMonth} then ${expenses.amount} else 0 end), 0)`,
      })
      .from(expenses)
      .where(eq(expenses.companyId, companyId)),
  ]);

  // A-24 T4: setiap baris beban membawa jurnal pembentuknya (pola
  // "Rincian Jurnal" Accurate) — jurnal "expense" non-pembalik milik
  // dokumen ini; jurnal pembayaran & pembalik tetap terlihat dari
  // halaman jurnal itu sendiri.
  const journalsByExpense = await listLinkedJournalsBySourceIds(
    tx,
    companyId,
    rows.map((row) => row.id),
  );
  const rowsWithJournal = rows.map((row) => {
    const primary = (journalsByExpense.get(row.id) ?? []).find(
      (journal) => journal.sourceType === "expense" && !journal.reversalOfId,
    );
    return {
      ...row,
      journalId: primary?.id ?? null,
      journalNumber: primary?.number ?? null,
    };
  });

  return {
    rows: rowsWithJournal,
    total: totalRows[0]?.value ?? 0,
    page,
    pageSize,
    totalAmount: toDb(d(sums[0]?.totalAmount ?? "0")),
    monthAmount: toDb(d(sums[0]?.monthAmount ?? "0")),
  };
}

export async function getAccountingSummary(tx: Tx, companyId: string, range: Range) {
  // FIX-ARS Tahap 2 (ARS3-01): kelima mappedBalance kini berjalan
  // paralel dalam Promise.all yang sama (sebelumnya berurutan sesudah
  // Promise.all pertama) — dan masing-masing kini membaca hibrida.
  // AK-P2-11: inventory value is the posted GL balance of the mapped
  // inventory account, so the dashboard always agrees with the balance
  // sheet. (qty × current product cost remains available as the warehouse
  // valuation report, getInventoryValuation.)
  const [statement, balanceSheet, receivable, payable, inventoryValue] =
    await Promise.all([
      getIncomeStatement(tx, companyId, range, { excludeClosing: true }),
      getBalanceSheet(tx, companyId, range.to),
      mappedBalance(tx, companyId, ["receivable"]),
      mappedBalance(tx, companyId, ["payable"]),
      mappedBalance(tx, companyId, ["inventory"]),
    ]);

  // A-28 Tahap 3 (H-AKT-02): kartu Kas & Bank memakai definisi kas
  // yang SAMA dengan dashboard & laporan arus kas — himpunan KELAS
  // kas/bank (listCashBankAccounts): Kas = akun berkelas cash;
  // Bank = akun berkelas bank|clearing. Sebelumnya kartu ini hanya
  // menjumlah akun yang ditunjuk pemetaan cash/bank/qris, sehingga
  // bank kedua dst. tidak terhitung di sini walau tampil di Kas &
  // bank. Pemetaan kini hanya penunjuk akun bawaan operasional.
  const cashBankAccounts = await listCashBankAccounts(tx, companyId);
  const cashBankTotals = await cumulativeAccountTotals(tx, companyId, FAR_FUTURE_DATE);
  const sumKinds = (kinds: string[]) =>
    cashBankAccounts
      .filter((row) => kinds.includes(row.cashBankKind))
      .reduce((acc, row) => {
        const totals = totalsOf(cashBankTotals, row.id);
        return acc.plus(signedBalance(row.type, totals.debit, totals.credit));
      }, d(0))
      .toNumber();
  const cash = sumKinds(["cash"]);
  const bank = sumKinds(["bank", "clearing"]);

  // Contra-revenue lines (4010 diskon, 4020 retur) carry negative amounts
  // inside the statement's revenue section, so the statement total is
  // already net sales; gross revenue ("omzet bruto" on the dashboard) is
  // the total with the contra amounts added back.
  const contraRevenue = statement.revenue.reduce(
    (acc, line) => acc.plus(Decimal.min(d(line.amount), d(0))),
    d(0),
  );
  return {
    revenue: d(statement.totalRevenue).minus(contraRevenue).toNumber(),
    netSales: statement.totalRevenue,
    cogs: statement.totalCogs,
    grossProfit: statement.grossProfit,
    operatingProfit: statement.operatingProfit,
    totalOperatingExpense: statement.totalOperatingExpense,
    totalOtherIncome: statement.totalOtherIncome,
    totalOtherExpense: statement.totalOtherExpense,
    expenseLines: statement.expense,
    expenses: statement.totalExpense,
    netProfit: statement.netProfit,
    cash,
    bank,
    receivable,
    payable,
    inventoryValue,
    totalAssets: balanceSheet.totalAssets,
    totalLiabilities: balanceSheet.totalLiabilities,
    totalEquity: balanceSheet.totalEquity,
    balanced: balanceSheet.balanced,
  };
}

/** Current balance for every postable account, using normal balance sign. */
export async function listAccountBalances(tx: Tx, companyId: string) {
  // FIX-ARS Tahap 2: saldo berjalan per akun dari total kumulatif
  // hibrida (semua bulan penuh dari ringkasan), bukan agregasi atas
  // seluruh journal_lines.
  const totals = await cumulativeAccountTotals(tx, companyId, FAR_FUTURE_DATE);
  const map = new Map(
    [...totals].map(([accountId, t]) => [accountId, t.debit.minus(t.credit)] as const),
  );
  const accounts_ = await listAccounts(tx, companyId);
  // A-27 B4 (F-07): penanda akun sistem TURUNAN dari ikatan nyata
  // (pemetaan ∪ metode pembayaran) — satu definisi bersama
  // getSystemAccountIds, bukan kolom bendera yang bisa basi.
  const systemIds = await getSystemAccountIds(tx, companyId);
  return accounts_.map((account) => {
    const delta = map.get(account.id) ?? d(0);
    const balance = (account.normalBalance === "credit" ? delta.neg() : delta).toNumber();
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance,
      parentId: account.parentId,
      section: account.section,
      cashFlowGroup: account.cashFlowGroup,
      // A-27 B3: kelas + rincian bank ikut model baca daftar agar
      // formulir ubah akun terisi kelasnya dan daftar dapat
      // menampilkan nomor rekening termasker.
      cashBankKind: account.cashBankKind,
      bankName: account.bankName,
      bankAccountNumber: account.bankAccountNumber,
      bankBranch: account.bankBranch,
      bankAccountHolder: account.bankAccountHolder,
      currency: account.currency,
      // A-27 B5: tag PSAK 118 + penanda kontra ikut model baca daftar
      // agar formulir ubah akun terisi tag tersimpannya.
      psak118Category: account.psak118Category,
      expenseNature: account.expenseNature,
      expenseFunction: account.expenseFunction,
      isContra: account.isContra,
      contraOf: account.contraOf,
      description: account.description,
      isActive: account.isActive,
      isPostable: account.isPostable,
      isSystem: systemIds.has(account.id),
      balance,
    };
  });
}


/* ------------------------------------------------------------------ */
/* FIX-R2 Tahap 3 (AK2-07): rekonsiliasi akun kontrol vs subledger     */
/* ------------------------------------------------------------------ */

export async function listExpenseAccounts(tx: Tx, companyId: string) {
  return tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.type, "expense"),
        eq(accounts.isPostable, true),
        eq(accounts.isActive, true),
      ),
    )
    .orderBy(accounts.code);
}

/**
 * Kunci idempotensi jurnal pembayaran pihak — pola yang sama persis
 * dengan yang dipakai situs postingnya (payables `ap:`, receivables
 * `ar:`, beban terutang `ap-expense:`, saldo awal `*-opening:`) dan
 * yang ditargetkan pembatalan pembayaran (AK-P2-03). Dipakai untuk
 * menautkan baris pembayaran ke jurnalnya (A-24 T4) tanpa kolom baru.
 */
export function partyPaymentJournalKey(row: {
  type: string;
  number: string;
  saleId: string | null;
  receiptId: string | null;
  expenseId: string | null;
  openingId: string | null;
}): string | null {
  if (row.openingId) {
    return `${row.type === "payable" ? "ap" : "ar"}-opening:${row.openingId}:${row.number}`;
  }
  if (row.expenseId) return `ap-expense:${row.expenseId}:${row.number}`;
  if (row.receiptId) return `ap:${row.receiptId}:${row.number}`;
  if (row.saleId) return `ar:${row.saleId}:${row.number}`;
  return null;
}

export async function listRecentPartyPayments(tx: Tx, companyId: string, limit = 40) {
  const rows = await tx
    .select()
    .from(partyPayments)
    .where(eq(partyPayments.companyId, companyId))
    .orderBy(desc(partyPayments.date), desc(partyPayments.createdAt))
    .limit(limit);
  // A-24 T4: tautkan jurnal tiap pembayaran (satu kueri batch lewat
  // kunci idempotensi di atas).
  const keys = rows
    .map((row) => partyPaymentJournalKey(row))
    .filter((key): key is string => Boolean(key));
  const journalByKey = new Map<string, { id: string; number: string }>();
  if (keys.length > 0) {
    const journals = await tx
      .select({ id: journalEntries.id, number: journalEntries.number, idempotencyKey: journalEntries.idempotencyKey })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.idempotencyKey, keys)));
    for (const journal of journals) {
      if (journal.idempotencyKey) {
        journalByKey.set(journal.idempotencyKey, { id: journal.id, number: journal.number });
      }
    }
  }
  return rows.map((row) => {
    const key = partyPaymentJournalKey(row);
    const journal = key ? journalByKey.get(key) : undefined;
    return { ...row, journalId: journal?.id ?? null, journalNumber: journal?.number ?? null };
  });
}
