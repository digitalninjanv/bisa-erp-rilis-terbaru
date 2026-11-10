import { sql } from "drizzle-orm";
import { db, type Tx } from "./index";

/**
 * Runs every business query inside a transaction with `app.company_id` set.
 * RLS policies read that setting; a query outside this wrapper must not touch
 * company-scoped tables.
 */
export async function withCompany<T>(
  companyId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}

export async function withCompanyReadOnly<T>(
  companyId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}
