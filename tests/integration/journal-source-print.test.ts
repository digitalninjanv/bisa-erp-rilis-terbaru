import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses } from "@/db/schema";
import { postJournal, reverseJournalEntry } from "@/server/accounting";
import { getJournalDetail } from "@/server/reports";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// CT-08/CT-22: a printed journal voucher must name its source as a
// DOCUMENT NUMBER with a Bahasa Indonesia label — never a raw UUID and
// never an English system word. getJournalDetail resolves the source
// document through the same tables the posting modules wrote to.
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function accountByCode(tx: Tx, code: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  return row;
}

describe("getJournalDetail — resolusi sumber dokumen (CT-08/CT-22)", () => {
  it("jurnal beban menyelesaikan nomor dokumen EXP dan label Indonesia", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const expenseAccount = await accountByCode(tx, "600004");
      const suffix = crypto.randomUUID().slice(0, 8);
      const [expense] = await tx
        .insert(expenses)
        .values({
          companyId: ORG_ID,
          number: `EXP-UJI-${suffix}`,
          date: todayISO(),
          expenseAccountId: expenseAccount.id,
          paymentAccountId: bank.id,
          amount: "150000",
          description: "Beban uji resolusi sumber",
          createdBy: USER_ID,
        })
        .returning({ id: expenses.id, number: expenses.number });

      const entry = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: `Beban ${expense.number}`,
        sourceType: "expense",
        sourceId: expense.id,
        createdBy: USER_ID,
        lines: [
          { accountId: expenseAccount.id, debit: "150000" },
          { accountId: bank.id, credit: "150000" },
        ],
      });
      return getJournalDetail(tx, ORG_ID, entry.id);
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.source.label).toBe("Beban");
    expect(outcome!.source.number).toMatch(/^EXP-UJI-/);
    expect(outcome!.source.number).not.toContain(outcome!.entry.sourceId!);
  });

  it("jurnal manual: label 'Jurnal manual' tanpa nomor dokumen", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const revenue = await accountByCode(tx, "400001");
      const entry = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: "Jurnal manual uji resolusi sumber",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "5000" },
          { accountId: revenue.id, credit: "5000" },
        ],
      });
      return getJournalDetail(tx, ORG_ID, entry.id);
    });

    expect(outcome!.source.label).toBe("Jurnal manual");
    expect(outcome!.source.number).toBeNull();
  });

  it("jurnal pembalik beban: label pembalikan dan nomor dokumen yang sama", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const expenseAccount = await accountByCode(tx, "600004");
      const suffix = crypto.randomUUID().slice(0, 8);
      const [expense] = await tx
        .insert(expenses)
        .values({
          companyId: ORG_ID,
          number: `EXP-BALIK-${suffix}`,
          date: todayISO(),
          expenseAccountId: expenseAccount.id,
          paymentAccountId: bank.id,
          amount: "75000",
          description: "Beban uji pembalik",
          createdBy: USER_ID,
        })
        .returning({ id: expenses.id, number: expenses.number });
      const entry = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: `Beban ${expense.number}`,
        sourceType: "expense",
        sourceId: expense.id,
        createdBy: USER_ID,
        lines: [
          { accountId: expenseAccount.id, debit: "75000" },
          { accountId: bank.id, credit: "75000" },
        ],
      });
      const { reversal } = await reverseJournalEntry(tx, {
        companyId: ORG_ID,
        entryId: entry.id,
        date: todayISO(),
        createdBy: USER_ID,
      });
      return getJournalDetail(tx, ORG_ID, reversal.id);
    });

    expect(outcome!.source.label).toBe("Pembalikan beban");
    expect(outcome!.source.number).toMatch(/^EXP-BALIK-/);
  });
});
