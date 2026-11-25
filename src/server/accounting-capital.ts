import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type MoneyInput } from "@/lib/money";
import { getAccountMap, postJournal } from "./accounting";
import { assertCashLikeAccount } from "./employee-advances";
import { writeAudit } from "./audit";

/** Validated owner capital injection: debit cash/bank, credit postable equity account. */
export async function postOwnerCapital(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    date: string;
    accountId: string;
    equityAccountId?: string;
    amount: MoneyInput;
    description: string;
    idempotencyKey?: string;
  },
) {
  const amount = d(input.amount);
  if (amount.lte(0)) throw new AppError("VALIDATION", "Nominal modal harus lebih dari nol.");

  await assertCashLikeAccount(tx, input.companyId, input.accountId);
  const map = await getAccountMap(tx, input.companyId);
  const equityAccountId = input.equityAccountId ?? map.equity;
  if (!equityAccountId) {
    throw new AppError("VALIDATION", "Akun ekuitas belum dipetakan di Pengaturan.");
  }
  const [equityAcc] = await tx
    .select({
      id: accounts.id,
      type: accounts.type,
      isActive: accounts.isActive,
      isPostable: accounts.isPostable,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, equityAccountId)))
    .limit(1);
  if (!equityAcc || equityAcc.type !== "equity" || !equityAcc.isActive || !equityAcc.isPostable) {
    throw new AppError("VALIDATION", "Akun ekuitas tidak valid, nonaktif, atau bukan akun ekuitas yang dapat diposting.");
  }

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Setoran modal — ${input.description}`,
    sourceType: "capital",
    idempotencyKey: input.idempotencyKey ? `capital:${input.idempotencyKey}` : undefined,
    createdBy: input.userId,
    lines: [
      { accountId: input.accountId, debit: amount, description: input.description },
      { accountId: equityAccountId, credit: amount, description: "Setoran modal pemilik" },
    ],
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "capital.create",
    entityType: "journal_entry",
    entityId: entry.id,
    after: { number: entry.number, amount: toDb(amount) },
  });
  return entry;
}
