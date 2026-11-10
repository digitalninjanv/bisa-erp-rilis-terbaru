import { sql } from "drizzle-orm";
import { db } from "@/db";

// Helper bersama suite integrasi & sim2 (A-24 T4B / CB-D1): menjalankan
// fn di dalam transaksi yang SELALU di-rollback, dengan konteks
// perusahaan RLS terpasang. Pola ini sebelumnya tersalin sebagai
// definisi lokal di 58 berkas test; semantiknya dipertahankan persis:
//
//   1. set_config('app.company_id', companyId, true) di dalam transaksi
//   2. langkah `before` opsional (mis. alignSequences pada test gudang)
//   3. value = await fn(tx)
//   4. transaksi dibatalkan via sinyal internal; nilai fn dikembalikan
//
// Kesalahan dari fn yang bukan sinyal rollback diteruskan apa adanya.

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class RollbackSignal extends Error {}

export interface RollbackTransactionOptions {
  before?: (tx: Tx) => Promise<void>;
}

export async function rollbackTransaction<T>(
  companyId: string,
  fn: (tx: Tx) => Promise<T>,
  options?: RollbackTransactionOptions,
): Promise<T> {
  let value: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
      if (options?.before) await options.before(tx);
      value = await fn(tx);
      throw new RollbackSignal("rollback test transaction");
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
  return value as T;
}

/** Mengikat companyId (dan opsi) menjadi bentuk klasik
 * `rollbackTransaction(fn)` yang dipakai mayoritas berkas test. */
export function makeRollbackTransaction(
  companyId: string,
  options?: RollbackTransactionOptions,
) {
  return <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    rollbackTransaction(companyId, fn, options);
}

/** Varian untuk berkas yang sesekali menjalankan transaksi di perusahaan
 * lain: `rollbackTransaction(fn, companyId?)` dengan perusahaan bawaan
 * bila argumen kedua tidak diberikan. */
export function makeFlexibleRollbackTransaction(defaultCompanyId: string) {
  return <T>(
    fn: (tx: Tx) => Promise<T>,
    companyId: string = defaultCompanyId,
  ): Promise<T> => rollbackTransaction(companyId, fn);
}
