/**
 * Audit-only reproduction: prove the cash-negative guard serializes two
 * concurrent outflows for ONE freshly-created company whose only cash is
 * the seeded 1,000. This isolates the guard from the shared integration
 * fixture whose earlier sales add hundreds of thousands of cash.
 *
 * Run against the disposable test DB:
 *   DATABASE_URL=... DIRECT_URL=... pnpm exec tsx audit/repro/cash-guard-isolated.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { withCompany, withCompanyReadOnly } from "../../src/db/tenant";
import { seedChartOfAccounts, postJournal } from "../../src/server/accounting";
import { accounts, companySettings, journalEntries, journalLines } from "../../src/db/schema";
import { adminSql } from "../../src/db/admin";
import { wipeCompanyFixture } from "../../tests/helpers/wipe-company";
import { todayISO } from "../../src/lib/format";

const companyId = `audit-cash-${crypto.randomUUID()}`;
const date = todayISO();

async function main() {
try {
  const state = await withCompany(companyId, async (tx) => {
    const map = await seedChartOfAccounts(tx, companyId);
    await tx.insert(companySettings).values({
      companyId,
      legalName: "Audit cash guard isolated",
      taxEnabled: false,
      roundingMode: "none",
      cashNegativePolicy: "block",
    });
    await postJournal(tx, {
      companyId,
      date,
      description: "Seed cash 1000",
      sourceType: "manual",
      lines: [
        { accountId: map.cash, debit: 1_000 },
        { accountId: map.equity, credit: 1_000 },
      ],
    });
    const [expense] = await tx
      .insert(accounts)
      .values({
        companyId,
        code: `EXP-${crypto.randomUUID()}`,
        name: "Audit concurrent expense",
        type: "expense",
        normalBalance: "debit",
      })
      .returning({ id: accounts.id });
    return { cash: map.cash, expense: expense.id };
  });

  const attempt = (label: string) =>
    withCompany(companyId, (tx) =>
      postJournal(tx, {
        companyId,
        date,
        description: label,
        sourceType: "manual",
        lines: [
          { accountId: state.expense, debit: 700 },
          { accountId: state.cash, credit: 700 },
        ],
      }),
    );

  const results = await Promise.allSettled([
    attempt("Concurrent withdrawal A"),
    attempt("Concurrent withdrawal B"),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  const reasons = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  const balance = await withCompanyReadOnly(companyId, async (tx) => {
    const [row] = await tx
      .select({ value: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.accountId, state.cash),
        eq(journalEntries.status, "posted"),
      ));
    return Number(row?.value ?? 0);
  });

  console.log(JSON.stringify({ fulfilled, rejected, balance, reasons }, null, 2));
  if (fulfilled !== 1 || rejected !== 1 || Math.abs(balance - 300) > 0.001) {
    process.exitCode = 2;
  }
} finally {
  await wipeCompanyFixture(adminSql, companyId);
  await adminSql.end();
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
