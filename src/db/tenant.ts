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

/**
 * Read-only tenant snapshot for work that runs across multiple queries and
 * must remain point-in-time consistent, such as a streamed ledger export.
 * Keep the transaction open only for the lifetime of that stream.
 */
export async function withCompanyReadOnlySnapshot<T>(
  companyId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}
