import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { withCompany, withCompanyReadOnly, withCompanyReadOnlySnapshot } from "@/db/tenant";
import { companySettings, journalEntries, journalLines } from "@/db/schema";
import { postJournal, seedChartOfAccounts } from "@/server/accounting";
import { adminSql } from "@/db/admin";
import { wipeCompanyFixture } from "../helpers/wipe-company";
import { todayISO } from "@/lib/format";

const COMPANY_ID = `audit-snapshot-${crypto.randomUUID()}`;
const date = todayISO();
let cashAccountId = "";
let equityAccountId = "";

async function cashBalance(tx: Tx) {
  const [row] = await tx
    .select({ value: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(
      eq(journalLines.companyId, COMPANY_ID),
      eq(journalLines.accountId, cashAccountId),
      eq(journalEntries.status, "posted"),
    ));
  return Number(row?.value ?? 0);
}

async function postCash(delta: number, description: string) {
  await withCompany(COMPANY_ID, (tx) =>
    postJournal(tx, {
      companyId: COMPANY_ID,
      date,
      description,
      sourceType: "manual",
      lines: [
        { accountId: cashAccountId, debit: delta },
        { accountId: equityAccountId, credit: delta },
      ],
    }),
  );
}

beforeAll(async () => {
  await withCompany(COMPANY_ID, async (tx) => {
    const map = await seedChartOfAccounts(tx, COMPANY_ID);
    cashAccountId = map.cash;
    equityAccountId = map.equity;
    await tx.insert(companySettings).values({
      companyId: COMPANY_ID,
      legalName: "Audit snapshot consistency",
      taxEnabled: false,
      roundingMode: "none",
    });
    await postJournal(tx, {
      companyId: COMPANY_ID,
      date,
      description: "Opening cash",
      sourceType: "manual",
      lines: [
        { accountId: cashAccountId, debit: 100 },
        { accountId: equityAccountId, credit: 100 },
      ],
    });
  });
});

afterAll(async () => {
  await wipeCompanyFixture(adminSql, COMPANY_ID);
});

describe("financial report snapshot consistency", () => {
  it("READ COMMITTED sees a later commit between statements; snapshot does not", async () => {
    const readCommitted = await withCompanyReadOnly(COMPANY_ID, async (tx) => {
      const first = await cashBalance(tx);
      await postCash(50, "Concurrent commit under read committed");
      const second = await cashBalance(tx);
      return [first, second];
    });
    expect(readCommitted).toEqual([100, 150]);

    const snapshot = await withCompanyReadOnlySnapshot(COMPANY_ID, async (tx) => {
      const first = await cashBalance(tx);
      await postCash(25, "Concurrent commit under repeatable read");
      const second = await cashBalance(tx);
      return [first, second];
    });
    expect(snapshot).toEqual([150, 150]);
  });
});
