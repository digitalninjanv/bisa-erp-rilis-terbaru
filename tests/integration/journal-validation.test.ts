import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { postJournal } from "@/server/accounting";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// AK-P1-02: postJournal must validate every line account (exists, belongs to
// the company, isPostable, isActive) before posting. Rollback write pattern
// copied from tests/integration/consistency.test.ts.
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_ORG_ID = "01900000-0000-7000-8000-000000000002";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const MISSING_ACCOUNT_ID = "01900000-0000-7000-8000-000000009999";

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seededAccount(tx: Tx, code: string) {
  const [found] = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.code, code));
  return found;
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

function journalInput(lines: { accountId: string; debit?: number; credit?: number }[]) {
  return {
    companyId: ORG_ID,
    date: todayISO(),
    description: "Uji AK-P1-02 validasi akun jurnal",
    sourceType: "manual",
    createdBy: USER_ID,
    lines,
  };
}

describe("postJournal account validation (AK-P1-02)", () => {
  it("accepts a valid balanced journal using active postable accounts", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cash = await seededAccount(tx, "110107");
      const equity = await seededAccount(tx, "300001");
      expect(cash).toBeDefined();
      expect(equity).toBeDefined();

      const entry = await postJournal(
        tx,
        journalInput([
          { accountId: cash!.id, debit: 1000 },
          { accountId: equity!.id, credit: 1000 },
        ]),
      );
      const lines = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.id, entry.id));
      return { entry, persisted: lines.length };
    });

    expect(result.entry.id).toBeTruthy();
    expect(result.entry.number).toMatch(/^JE-/);
    expect(result.persisted).toBe(1);
  });

  it("rejects a journal whose account does not exist", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cash = await seededAccount(tx, "110107");
      const error = await captureError(() =>
        postJournal(
          tx,
          journalInput([
            { accountId: cash!.id, debit: 1000 },
            { accountId: MISSING_ACCOUNT_ID, credit: 1000 },
          ]),
        ),
      );
      const leftovers = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.description, "Uji AK-P1-02 validasi akun jurnal"));
      return { error, leftovers: leftovers.length };
    });

    expect(result.error).toBeInstanceOf(AppError);
    expect((result.error as AppError).code).toBe("VALIDATION");
    expect((result.error as AppError).message).toMatch(/tidak ditemukan/i);
    expect(result.leftovers).toBe(0);
  });

  it("rejects a journal using an account owned by another company", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cash = await seededAccount(tx, "110107");

      // Seed an account for another tenant inside this transaction (RLS
      // follows app.company_id, so switch it just for the insert).
      await tx.execute(sql`select set_config('app.company_id', ${OTHER_ORG_ID}, true)`);
      const [foreign] = await tx
        .insert(accounts)
        .values({
          companyId: OTHER_ORG_ID,
          code: "9992",
          name: "Akun Perusahaan Lain",
          type: "asset",
          normalBalance: "debit",
        })
        .returning({ id: accounts.id });
      await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
      expect(foreign).toBeDefined();

      const error = await captureError(() =>
        postJournal(
          tx,
          journalInput([
            { accountId: cash!.id, debit: 1000 },
            { accountId: foreign!.id, credit: 1000 },
          ]),
        ),
      );
      return { error };
    });

    expect(result.error).toBeInstanceOf(AppError);
    expect((result.error as AppError).code).toBe("VALIDATION");
    expect((result.error as AppError).message).toMatch(/tidak ditemukan/i);
  });

  it("rejects a journal using a non-postable (header) account", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cash = await seededAccount(tx, "110107");
      const [header] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: "9990",
          name: "Akun Induk Uji",
          type: "asset",
          normalBalance: "debit",
          isPostable: false,
        })
        .returning({ id: accounts.id });
      expect(header).toBeDefined();

      const error = await captureError(() =>
        postJournal(
          tx,
          journalInput([
            { accountId: cash!.id, debit: 1000 },
            { accountId: header!.id, credit: 1000 },
          ]),
        ),
      );
      return { error };
    });

    expect(result.error).toBeInstanceOf(AppError);
    expect((result.error as AppError).code).toBe("VALIDATION");
    expect((result.error as AppError).message).toContain("9990");
    expect((result.error as AppError).message).toMatch(/induk|tidak dapat dipakai/i);
  });

  it("rejects a journal using an inactive account", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cash = await seededAccount(tx, "110107");
      const [inactive] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: "9991",
          name: "Akun Nonaktif Uji",
          type: "asset",
          normalBalance: "debit",
          isActive: false,
        })
        .returning({ id: accounts.id });
      expect(inactive).toBeDefined();

      const error = await captureError(() =>
        postJournal(
          tx,
          journalInput([
            { accountId: cash!.id, debit: 1000 },
            { accountId: inactive!.id, credit: 1000 },
          ]),
        ),
      );
      return { error };
    });

    expect(result.error).toBeInstanceOf(AppError);
    expect((result.error as AppError).code).toBe("VALIDATION");
    expect((result.error as AppError).message).toContain("9991");
    expect((result.error as AppError).message).toMatch(/tidak aktif/i);
  });

  it("allows a reversal posting to an account deactivated after the original posting (leader decision D-1)", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cash = await seededAccount(tx, "110107");
      const equity = await seededAccount(tx, "300001");
      const original = await postJournal(
        tx,
        journalInput([
          { accountId: cash!.id, debit: 1000 },
          { accountId: equity!.id, credit: 1000 },
        ]),
      );

      // The account is deactivated AFTER the original posting. The reversal
      // (the only correction path in an append-only ledger) must still post;
      // existence + company scope stay enforced for reversals.
      const [inactive] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: "9993",
          name: "Akun Dinonaktifkan Uji",
          type: "asset",
          normalBalance: "debit",
          isActive: false,
        })
        .returning({ id: accounts.id });
      expect(inactive).toBeDefined();

      const reversal = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: "Pembalik jurnal uji D-1",
        sourceType: "manual_reversal",
        createdBy: USER_ID,
        idempotencyKey: `reversal:${original.id}`,
        reversalOfId: original.id,
        lines: [
          { accountId: inactive!.id, debit: 1000 },
          { accountId: equity!.id, credit: 1000 },
        ],
      });
      return { reversal };
    });

    expect(result.reversal.id).toBeTruthy();
    expect(result.reversal.number).toMatch(/^JE-/);
  });

  it("replays an identical payload and rejects the same key with different lines", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cash = await seededAccount(tx, "110107");
      const equity = await seededAccount(tx, "300001");
      const key = "uji-ak-p1-02:replay";
      const lines = [
        { accountId: cash!.id, debit: 1000 },
        { accountId: equity!.id, credit: 1000 },
      ];

      const first = await postJournal(tx, {
        ...journalInput(lines),
        idempotencyKey: key,
      });
      const replay = await postJournal(tx, {
        ...journalInput(lines),
        idempotencyKey: key,
      });
      let conflict: unknown;
      try {
        await postJournal(tx, {
          ...journalInput([
            { accountId: cash!.id, debit: 2000 },
            { accountId: MISSING_ACCOUNT_ID, credit: 2000 },
          ]),
          idempotencyKey: key,
        });
      } catch (error) {
        conflict = error;
      }
      return { first, replay, conflict };
    });

    expect(result.replay.id).toBe(result.first.id);
    expect(result.replay.number).toBe(result.first.number);
    expect(result.conflict).toBeInstanceOf(AppError);
    if (result.conflict instanceof AppError) expect(result.conflict.code).toBe("CONFLICT");
  });
});
