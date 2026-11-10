// A-26 Q8 (K-10): pecahan src/server/bank-reconciliation.ts per
// concern (akun / baris buku / mutasi / pencocokan / baca). Perilaku
// tidak berubah; jalur impor publik tetap lewat
// src/server/bank-reconciliation.ts (barrel).

import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts } from "@/db/schema";
import { listCashBankAccounts } from "@/server/accounting";
import { AppError } from "@/lib/errors";

/* ------------------------------------------------------------------ */

export type ReconciliationAccount = { id: string; code: string; name: string };

/**
 * A-27 B2 (menutup F-04 sisi baca): himpunan yang dapat direkonsiliasi
 * adalah himpunan kelas kas/bank MURNI — akun berkelas cash|bank|
 * clearing yang postable + aktif (listCashBankAccounts, definisi
 * tunggal di server/accounting). Aturan gabungan lama (pemetaan ∪ akun
 * di balik semua metode pembayaran aktif) DIHAPUS: aturan itu memasukkan
 * akun kontrol seperti Piutang Usaha & Kredit Pelanggan ke daftar
 * rekonsiliasi hanya karena ada metode yang menunjuknya.
 */
export async function listReconciliationAccounts(
  tx: Tx,
  companyId: string,
): Promise<ReconciliationAccount[]> {
  const rows = await listCashBankAccounts(tx, companyId);
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
}

export async function requireReconciliationAccount(tx: Tx, companyId: string, accountId: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) throw new AppError("NOT_FOUND", "Akun tidak ditemukan di perusahaan ini.");
  const eligible = await listReconciliationAccounts(tx, companyId);
  if (!eligible.some((row) => row.id === accountId)) {
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} ${account.name} bukan akun kas/bank yang dapat direkonsiliasi. Pilih akun berkelas kas, bank, atau kliring/settlement yang aktif dan dapat diposting.`,
    );
  }
  return account;
}

/* ------------------------------------------------------------------ */
/* CSV parsing — logika murni tinggal di lib/statement-csv (A-22 K3)  */
/* ------------------------------------------------------------------ */

export { parseStatementAmount, parseStatementDate } from "@/lib/statement-csv";
export type { StatementRowError } from "@/lib/statement-csv";
