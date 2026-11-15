import { describe, expect, it } from "vitest";
import type { Tx } from "@/db";
import {
  accountMonthlyBalances,
  accounts,
  journalEntries,
  journalLines,
} from "@/db/schema";
import { buildLedgerExportTable } from "@/server/reports/export-builders";
import { reportTableToCsv } from "@/server/reports/export-table";
import { ledgerCsvChunks } from "@/server/reports/ledger-csv-generator";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const COMPANY_ID = "01900000-0000-7000-8000-000000000901";
const FROM = "2026-01-01";
const TO = "2026-12-31";
const ROW_COUNT = 1_001;
const rollback = makeRollbackTransaction(COMPANY_ID);

async function seedLedger(tx: Tx) {
  const [cash, equity] = await tx
    .insert(accounts)
    .values([
      {
        companyId: COMPANY_ID,
        code: "10001",
        name: "Kas Uji Streaming",
        type: "asset",
        normalBalance: "debit",
      },
      {
        companyId: COMPANY_ID,
        code: "30001",
        name: "Ekuitas Uji Streaming",
        type: "equity",
        normalBalance: "credit",
      },
    ])
    .returning({ id: accounts.id });

  const entries = await tx
    .insert(journalEntries)
    .values(
      Array.from({ length: ROW_COUNT }, (_, index) => ({
        companyId: COMPANY_ID,
        number: `PERF-${String(index + 1).padStart(6, "0")}`,
        date: "2026-01-15",
        description: `Transaksi uji ${index + 1}`,
        status: "posted",
        sourceType: "manual",
      })),
    )
    .returning({ id: journalEntries.id, number: journalEntries.number });
  const entryByNumber = new Map(entries.map((entry) => [entry.number, entry.id]));

  const lines = Array.from({ length: ROW_COUNT }, (_, index) => {
    const number = `PERF-${String(index + 1).padStart(6, "0")}`;
    const entryId = entryByNumber.get(number);
    if (!entryId) throw new Error(`Jurnal ${number} tidak ditemukan`);
    return [
      {
        companyId: COMPANY_ID,
        entryId,
        accountId: cash.id,
        debit: "10.0000",
        credit: "0",
        description: `Transaksi uji ${index + 1}`,
        lineNo: 1,
      },
      {
        companyId: COMPANY_ID,
        entryId,
        accountId: equity.id,
        debit: "0",
        credit: "10.0000",
        description: `Transaksi uji ${index + 1}`,
        lineNo: 2,
      },
    ];
  }).flat();

  await tx.insert(journalLines).values(lines);
  await tx.insert(accountMonthlyBalances).values([
    {
      companyId: COMPANY_ID,
      accountId: cash.id,
      yearMonth: "2026-01",
      totalDebit: String(ROW_COUNT * 10),
      totalCredit: "0",
    },
    {
      companyId: COMPANY_ID,
      accountId: equity.id,
      yearMonth: "2026-01",
      totalDebit: "0",
      totalCredit: String(ROW_COUNT * 10),
    },
  ]);

  return cash.id;
}

describe("ledger CSV cursor export", () => {
  it("matches the existing CSV bytes while reading more than two database fetch pages", async () => {
    await rollback(async (tx) => {
      const accountId = await seedLedger(tx);
      const company = { id: COMPANY_ID, name: "Perusahaan Uji" };
      const input = { accountId, from: FROM, to: TO };
      const built = await buildLedgerExportTable(tx, company, input);
      expect(built).not.toBeNull();
      if (!built) throw new Error("Laporan buku besar tidak terbentuk");

      const expected = `\uFEFF${reportTableToCsv(built.table)}`;
      const chunks: Uint8Array[] = [];
      for await (const part of ledgerCsvChunks(tx, company, input)) {
        chunks.push(part.bytes);
      }
      const actual = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");

      expect(actual).toBe(expected);
      expect(actual.split("\r\n")).toHaveLength(ROW_COUNT + 3);
      expect(actual).toContain("Saldo akhir,,,,,10010.00");
    });
  });
});
