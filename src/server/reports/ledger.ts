// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  asc,
  count,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { d } from "@/lib/money";
import {
  accounts,
  journalEntries,
  journalLines,
} from "@/db/schema";
import { accountTotalsInRange, cumulativeAccountTotals, previousDay, totalsOf } from "./shared";

export async function getLedger(tx: Tx, input: {
  companyId: string;
  accountId: string;
  from: string;
  to: string;
  page?: number;
  pageSize?: number;
}) {
  // AK-P2-09: the running balance follows the account's own normal balance
  // (the same "saldo normal" the ledger page prints next to the account), so
  // credit-normal accounts (liabilities, equity, revenue) accumulate as
  // credit − debit instead of showing an ever-growing negative figure.
  // Only posted journals count (AK-P2-02). The page renders opening /
  // balance / closing verbatim, so the sign is corrected here, server-side.
  //
  // AK-P3-04: paginated like every other list (the CSV export omits
  // page/pageSize and receives the full range). Balances accumulate in
  // Decimal; a page's starting balance is the opening balance plus an
  // ordered-subquery sum of the lines before the page window, so no page
  // ever needs the full history loaded. `closing`, `totalDebit`, and
  // `totalCredit` always describe the whole range, not the page.
  const [account] = await tx
    .select({ normalBalance: accounts.normalBalance })
    .from(accounts)
    .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, input.accountId)))
    .limit(1);
  const sign = account?.normalBalance === "credit" ? -1 : 1;

  const rangeWhere = and(
    eq(journalLines.companyId, input.companyId),
    eq(journalLines.accountId, input.accountId),
    eq(journalEntries.status, "posted"),
    gte(journalEntries.date, input.from),
    lte(journalEntries.date, input.to),
  );
  const order = [
    asc(journalEntries.date),
    asc(journalEntries.number),
    asc(journalLines.lineNo),
    asc(journalLines.id),
  ];
  const linesQuery = () =>
    tx
      .select({
        id: journalLines.id,
        // FIX-P1 Tahap 5 (AK5-01b): baris buku besar menaut ke detail
        // jurnal — entryId dibawa eksplisit agar halaman tidak menebak.
        entryId: journalEntries.id,
        date: journalEntries.date,
        number: journalEntries.number,
        description: journalLines.description,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id));
  // FIX-ARS Tahap 2: saldo awal & total rentang akun ini diturunkan
  // dari total kumulatif hibrida (ringkasan bulanan + bulan parsial),
  // bukan dua agregasi atas seluruh riwayat akun. Kueri baris buku
  // besar & paginasinya di bawah tidak berubah.
  const beforeTotals = await cumulativeAccountTotals(tx, input.companyId, previousDay(input.from));
  const throughTotals = await cumulativeAccountTotals(tx, input.companyId, input.to);
  const beforeAccount = totalsOf(beforeTotals, input.accountId);
  const throughAccount = totalsOf(throughTotals, input.accountId);
  const opening = beforeAccount.debit.minus(beforeAccount.credit).mul(sign);

  const totalDebit = throughAccount.debit.minus(beforeAccount.debit);
  const totalCredit = throughAccount.credit.minus(beforeAccount.credit);
  const closing = opening.plus(totalDebit.minus(totalCredit).mul(sign));

  const [totalRow] = await tx
    .select({ value: count() })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(rangeWhere);
  const total = totalRow?.value ?? 0;

  const paginated = input.page !== undefined || input.pageSize !== undefined;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = paginated
    ? Math.min(200, Math.max(1, input.pageSize ?? 50))
    : Math.max(1, total);
  const offset = (page - 1) * pageSize;

  let balance = opening;
  if (offset > 0) {
    const prior = linesQuery().where(rangeWhere).orderBy(...order).limit(offset).as("ledger_prior");
    const [priorRow] = await tx
      .select({
        debit: sql<string>`coalesce(sum(${prior.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${prior.credit}), 0)`,
      })
      .from(prior);
    balance = opening.plus(
      d(priorRow?.debit ?? 0).minus(priorRow?.credit ?? 0).mul(sign),
    );
  }

  const rows = await (paginated
    ? linesQuery().where(rangeWhere).orderBy(...order).limit(pageSize).offset(offset)
    : linesQuery().where(rangeWhere).orderBy(...order));

  const items = rows.map((row) => {
    balance = balance.plus(d(row.debit).minus(row.credit).mul(sign));
    return {
      ...row,
      debit: d(row.debit).toNumber(),
      credit: d(row.credit).toNumber(),
      balance: balance.toNumber(),
    };
  });

  return {
    opening: opening.toNumber(),
    items,
    closing: closing.toNumber(),
    totalDebit: totalDebit.toNumber(),
    totalCredit: totalCredit.toNumber(),
    total,
    page,
    pageSize,
  };
}

export async function listAccounts(tx: Tx, companyId: string) {
  return tx.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.code));
}

/**
 * A-28 UI-3 (sisa AKT-08): akun bawaan buku besar. Sebelumnya halaman
 * membuka pada akun pertama menurut kode — akun HEADER 10000 (tidak
 * postable, saldo Rp0, tanpa satu pun baris) — sehingga kesan pertama
 * buku besar selalu kosong. Bawaan kini, menurut urutan kode di antara
 * akun POSTABLE saja:
 *   1. akun pertama yang BERAKTIVITAS pada rentang terpilih
 *      (debit/kredit terposting dalam rentang bukan nol);
 *   2. bila rentang hampa, akun pertama dengan saldo kumulatif
 *      bukan nol sampai akhir rentang;
 *   3. bila tidak ada juga, akun postable pertama;
 *   4. tanpa akun postable, akun pertama apa pun (keadaan tepi).
 * `accounts` harus sudah terurut kode (listAccounts /
 * listAccountBalances memenuhi ini) dan sudah tersaring tipe bila
 * pemanggil menyaring — bawaan menghormati saringan yang aktif.
 */
export async function resolveDefaultLedgerAccountId(
  tx: Tx,
  companyId: string,
  accountList: { id: string; isPostable: boolean }[],
  range: { from: string; to: string },
): Promise<string> {
  const postable = accountList.filter((row) => row.isPostable);
  if (postable.length === 0) return accountList[0]?.id ?? "";
  const inRange = await accountTotalsInRange(tx, companyId, range.from, range.to);
  const active = postable.find((row) => {
    const totals = totalsOf(inRange, row.id);
    return !totals.debit.isZero() || !totals.credit.isZero();
  });
  if (active) return active.id;
  const through = await cumulativeAccountTotals(tx, companyId, range.to);
  const withBalance = postable.find((row) => {
    const totals = totalsOf(through, row.id);
    return !totals.debit.minus(totals.credit).isZero();
  });
  return withBalance?.id ?? postable[0].id;
}
