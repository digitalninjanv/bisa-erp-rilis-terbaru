import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { csvRow, moneyCsv } from "@/lib/csv";
import { d } from "@/lib/money";
import {
  getLedgerSummary,
  ledgerLineOrder,
  ledgerLineQuery,
  ledgerRangeWhere,
  listAccounts,
  resolveDefaultLedgerAccountId,
  type LedgerInput,
} from "./ledger";

const FETCH_SIZE = 500;
const OUTPUT_BATCH_ROWS = 128;
const CURSOR_NAME = "ledger_csv_cursor";

type LedgerCursorRow = {
  date: string | Date;
  number: string;
  description: string | null;
  debit: string | number;
  credit: string | number;
};

export type LedgerCsvPart = {
  accountCode: string;
  bytes: Uint8Array;
};

/**
 * Yield a ledger CSV in bounded chunks while reading the report rows through
 * a server-side cursor. The caller must keep `tx` open until iteration ends.
 */
export async function* ledgerCsvChunks(
  tx: Tx,
  company: { id: string; name: string },
  input: Omit<LedgerInput, "companyId" | "accountId"> & { accountId: string | null },
): AsyncGenerator<LedgerCsvPart> {
  const accounts = await listAccounts(tx, company.id);
  const accountId =
    input.accountId ||
    (await resolveDefaultLedgerAccountId(tx, company.id, accounts, {
      from: input.from,
      to: input.to,
    }));
  const account = accounts.find((row) => row.id === accountId);
  if (!account) return;

  const ledgerInput = { ...input, companyId: company.id, accountId };
  const summary = await getLedgerSummary(tx, ledgerInput);
  const query = ledgerLineQuery(tx)
    .where(ledgerRangeWhere(ledgerInput))
    .orderBy(...ledgerLineOrder());
  await tx.execute(sql`DECLARE ledger_csv_cursor NO SCROLL CURSOR FOR ${query}`);

  const encoder = new TextEncoder();
  const heading = `Buku besar ${account.code} · ${account.name}`;
  const period = `Periode ${input.from} s/d ${input.to}`;
  let balance = summary.opening;
  let outputRows: string[] = [];
  const flush = () => {
    const bytes = encoder.encode(outputRows.join(""));
    outputRows = [];
    return bytes;
  };
  const appendRow = (values: (string | number | null | undefined)[], first = false) => {
    outputRows.push(`${first ? "\uFEFF" : "\r\n"}${csvRow(values)}`);
  };

  try {
    appendRow([heading, period, "", "", "", ""], true);
    appendRow([
      "Saldo awal",
      "",
      "",
      "",
      "",
      moneyCsv(summary.opening.toNumber()),
    ]);
    yield { accountCode: account.code, bytes: flush() };

    while (true) {
      const fetched = await tx.execute(sql.raw(`FETCH FORWARD ${FETCH_SIZE} FROM ${CURSOR_NAME}`));
      const rows = Array.from(fetched) as unknown as LedgerCursorRow[];
      if (rows.length === 0) break;

      for (const row of rows) {
        const debit = d(row.debit);
        const credit = d(row.credit);
        balance = balance.plus(debit.minus(credit).mul(summary.sign));
        const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date);
        appendRow([
          date,
          row.number,
          row.description ?? "",
          moneyCsv(debit.toNumber()),
          moneyCsv(credit.toNumber()),
          moneyCsv(balance.toNumber()),
        ]);

        if (outputRows.length >= OUTPUT_BATCH_ROWS) {
          yield { accountCode: account.code, bytes: flush() };
        }
      }
    }

    if (!balance.eq(summary.closing)) {
      throw new Error("Saldo buku besar dari baris tidak sama dengan saldo penutupan.");
    }
    appendRow([
      "Saldo akhir",
      "",
      "",
      "",
      "",
      moneyCsv(summary.closing.toNumber()),
    ]);
    if (outputRows.length > 0) {
      yield { accountCode: account.code, bytes: flush() };
    }
  } finally {
    await tx.execute(sql`CLOSE ledger_csv_cursor`);
  }
}
