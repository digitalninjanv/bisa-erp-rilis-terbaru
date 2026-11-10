import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accountMappings,
  accounts,
  customerGroups,
  journalEntries,
  journalLines,
  paymentMethods,
} from "@/db/schema";
import { MAPPING_LABELS } from "@/lib/account-mappings";
import { d, toDb } from "@/lib/money";

// ---------------------------------------------------------------------------
// A-27 B4: pratinjau dampak akun & penanda akun sistem (F-05/F-07).
// "Akun sistem" adalah sifat TURUNAN dari ikatan nyata — akun yang
// dirujuk pemetaan (account_mappings) atau metode pembayaran
// (payment_methods) — bukan kolom bendera yang bisa basi: ikatan
// berubah, tandanya ikut berubah. getAccountImpact adalah
// SATU-SATUNYA sumber jawaban "akun ini dipakai oleh apa" — dipakai
// penjaga tulis di actions/accounting/akun-pemetaan.ts (nonaktif
// setara hapus) dan panel dampak di halaman detail/formulir akun.
//
// Penempatan: modul daun tersendiri (bukan di server/accounting.ts)
// karena accounting.ts sudah 723 baris — menambahkannya di sana
// menembus ratchet ukuran 800 (A-26 Q1) dan mendaftarkan plafon baru
// dilarang. Pemanggil mengimpor langsung dari modul ini.
// ---------------------------------------------------------------------------

/** Id akun yang dirujuk pemetaan atau metode pembayaran perusahaan. */
export async function getSystemAccountIds(tx: Tx, companyId: string): Promise<Set<string>> {
  const [mapped, methodBound] = await Promise.all([
    tx
      .select({ accountId: accountMappings.accountId })
      .from(accountMappings)
      .where(eq(accountMappings.companyId, companyId)),
    tx
      .select({ accountId: paymentMethods.accountId })
      .from(paymentMethods)
      .where(eq(paymentMethods.companyId, companyId)),
  ]);
  const ids = new Set<string>();
  for (const row of mapped) ids.add(row.accountId);
  for (const row of methodBound) if (row.accountId) ids.add(row.accountId);
  return ids;
}

export type AccountImpact = {
  accountId: string;
  code: string;
  name: string;
  /** Turunan ikatan: terpetakan ATAU terikat metode pembayaran. */
  isSystem: boolean;
  mappingKeys: { key: string; label: string }[];
  paymentMethods: { id: string; code: string; name: string; isActive: boolean }[];
  discountGroups: { id: string; name: string }[];
  children: { id: string; code: string; name: string }[];
  /** Baris jurnal pada jurnal POSTED (sumber saldo yang sama). */
  journalLineCount: number;
  /** Saldo berjalan bertanda saldo normal, format string numeric(19,4). */
  balance: string;
};

export async function getAccountImpact(
  tx: Tx,
  companyId: string,
  accountId: string,
): Promise<AccountImpact | null> {
  const [account] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      normalBalance: accounts.normalBalance,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) return null;

  const [mappingRows, methodRows, groupRows, childRows, totals] = await Promise.all([
    tx
      .select({ key: accountMappings.key })
      .from(accountMappings)
      .where(and(eq(accountMappings.companyId, companyId), eq(accountMappings.accountId, accountId)))
      .orderBy(asc(accountMappings.key)),
    tx
      .select({
        id: paymentMethods.id,
        code: paymentMethods.code,
        name: paymentMethods.name,
        isActive: paymentMethods.isActive,
      })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.accountId, accountId)))
      .orderBy(asc(paymentMethods.code)),
    tx
      .select({ id: customerGroups.id, name: customerGroups.name })
      .from(customerGroups)
      .where(
        and(eq(customerGroups.companyId, companyId), eq(customerGroups.discountAccountId, accountId)),
      )
      .orderBy(asc(customerGroups.name)),
    tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.parentId, accountId)))
      .orderBy(asc(accounts.code)),
    tx
      .select({
        lineCount: sql<number>`count(*)::int`,
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
        ),
      ),
  ]);

  const total = totals[0];
  const delta = d(total?.debit ?? 0).minus(total?.credit ?? 0);
  const signed = account.normalBalance === "credit" ? delta.neg() : delta;

  return {
    accountId: account.id,
    code: account.code,
    name: account.name,
    isSystem: mappingRows.length > 0 || methodRows.length > 0,
    mappingKeys: mappingRows.map((row) => ({
      key: row.key,
      label: MAPPING_LABELS[row.key] ?? row.key,
    })),
    paymentMethods: methodRows,
    discountGroups: groupRows,
    children: childRows,
    journalLineCount: total?.lineCount ?? 0,
    balance: toDb(signed),
  };
}
