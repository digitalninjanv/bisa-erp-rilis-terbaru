import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankStatementLines, journalEntries, journalLines } from "@/db/schema";
import { postJournal } from "@/server/accounting";
import {
  autoMatch,
  createJournalFromLine,
  deleteStatementImport,
  getBookBalanceAsOf,
  getReconciliationFormData,
  getReconciliationSummary,
  importStatement,
  listBookLines,
  listReconciliationAccounts,
  listStatementImports,
  listStatementLines,
  markStatementImportReconciled,
  matchLine,
  unmatchLine,
} from "@/server/bank-reconciliation";
import { d } from "@/lib/money";
import { addDaysISO } from "@/lib/due-date";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// T4-2 / D-11: bank reconciliation. All writes happen inside rollback
// transactions against the seeded demo company so the dev DB stays clean.
// Amounts are deliberately distinctive so auto-match candidates never
// collide with seeded journals on the bank account.
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function accountByCode(tx: Tx, code: string) {
  const [row] = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  if (!row) throw new Error(`Akun ${code} tidak ada di fixture`);
  return row;
}

function idDate(iso: string): string {
  const [y, m, dd] = iso.split("-");
  return `${dd}/${m}/${y}`;
}

const today = todayISO();

describe("rekonsiliasi bank (D-11)", () => {
  it("akun yang bisa direkonsiliasi hanya kas/bank hasil pemetaan & metode pembayaran", async () => {
    await rollbackTransaction(async (tx) => {
      const eligible = await listReconciliationAccounts(tx, ORG_ID);
      const codes = new Set<string>();
      for (const row of eligible) {
        const [acc] = await tx
          .select({ code: accounts.code })
          .from(accounts)
          .where(eq(accounts.id, row.id))
          .limit(1);
        if (acc) codes.add(acc.code);
      }
      expect(codes.has("11010201")).toBe(true); // Bank BCA (pemetaan bank)
      expect(codes.has("110107")).toBe(true); // Kas (pemetaan cash)
      expect(codes.has("400001")).toBe(false); // Pendapatan bukan kas/bank
    });
  });

  it("impor CSV: baris rusak dilaporkan per baris, impor ulang melewati duplikat", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const csv = [
        "Tanggal;Keterangan;Debit;Kredit",
        `${idDate(today)};Setoran tunai uji rekonsiliasi;7.770.010;`,
        `${idDate(today)};Biaya admin uji rekonsiliasi;;25.010`,
        `32/13/2026;Baris rusak uji;1.000;`,
      ].join("\n");

      const first = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi-uji.csv",
        csvText: csv,
      });
      expect(first.insertedRows).toBe(2);
      expect(first.skippedRows).toBe(0);
      expect(first.errors).toHaveLength(1);
      expect(first.errors[0].row).toBe(4);

      const second = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi-uji.csv",
        csvText: csv,
      });
      expect(second.insertedRows).toBe(0);
      expect(second.skippedRows).toBe(2);

      const lines = await listStatementLines(tx, ORG_ID, bank.id, {});
      expect(lines.total).toBe(2);
      const debitLine = lines.rows.find((row) => d(row.debit).gt(0));
      expect(debitLine).toBeDefined();
      expect(d(debitLine!.debit).toFixed(2)).toBe("7770010.00");
      return first;
    });
    expect(result.importId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("impor menyimpan saldo akhir rekening koran dan status rekonsiliasi", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const csv = `Tanggal;Keterangan;Debit;Kredit\n${idDate(today)};Saldo akhir uji;12.345;`;
      const imported = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi-saldo-uji.csv",
        csvText: csv,
        statementEndingBalance: "12345",
        statementEndDate: today,
      });

      const imports = await listStatementImports(tx, ORG_ID, bank.id);
      const row = imports.find((item) => item.id === imported.importId);
      expect(row).toBeDefined();
      expect(Number(row!.statementEndingBalance)).toBe(12345);
      expect(row!.statementEndDate).toBe(today);
      expect(row!.unmatchedCount).toBe(1);
      expect(row!.matchedCount).toBe(0);
    });
  });

  it("tanda selesai menolak mutasi yang belum tertaut, lalu berhasil setelah semua tertaut", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const revenue = await accountByCode(tx, "400001");
      const amount = "77.770,01";
      const csv = `Tanggal;Keterangan;Debit;Kredit\n${idDate(today)};Setoran tanda selesai;${amount};`;
      const imported = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi-selesai-uji.csv",
        csvText: csv,
        statementEndingBalance: "77770.01",
        statementEndDate: today,
      });

      await expect(
        markStatementImportReconciled(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          importId: imported.importId,
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });

      const statement = (await listStatementLines(tx, ORG_ID, bank.id, { status: "unmatched" }))
        .rows.find((row) => row.description === "Setoran tanda selesai");
      expect(statement).toBeDefined();

      const entry = await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Lawan mutasi tanda selesai",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "77770.01", description: "Bank" },
          { accountId: revenue.id, credit: "77770.01", description: "Pendapatan" },
        ],
      });
      const [bookLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, entry.id), eq(journalLines.accountId, bank.id)))
        .limit(1);
      expect(bookLine).toBeDefined();

      await matchLine(tx, {
        companyId: ORG_ID,
        statementLineId: statement!.id,
        journalLineId: bookLine!.id,
      });
      await markStatementImportReconciled(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        importId: imported.importId,
      });

      const imports = await listStatementImports(tx, ORG_ID, bank.id);
      const row = imports.find((item) => item.id === imported.importId);
      expect(row!.reconciledAt).not.toBeNull();
      expect(row!.reconciledBy).toBe(USER_ID);
    });
  });

  it("impor bersih bisa dihapus", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const csv = `Tanggal;Keterangan;Debit;Kredit\n${idDate(today)};Baris hapus impor;1.234;`;
      const imported = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi-hapus-uji.csv",
        csvText: csv,
      });

      await deleteStatementImport(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        importId: imported.importId,
      });
      const imports = await listStatementImports(tx, ORG_ID, bank.id);
      expect(imports.some((item) => item.id === imported.importId)).toBe(false);
    });
  });

  it("saldo buku per tanggal koran dapat dihitung", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const revenue = await accountByCode(tx, "400001");
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Saldo buku per tanggal uji",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "4321.09", description: "Bank" },
          { accountId: revenue.id, credit: "4321.09", description: "Pendapatan" },
        ],
      });
      const before = await getBookBalanceAsOf(tx, ORG_ID, bank.id, addDaysISO(today, -1));
      const after = await getBookBalanceAsOf(tx, ORG_ID, bank.id, today);
      expect(Number(after) - Number(before)).toBeCloseTo(4321.09, 2);
    });
  });

  it("impor ke akun non-bank ditolak", async () => {
    await expect(
      rollbackTransaction(async (tx) => {
        const revenue = await accountByCode(tx, "400001");
        await importStatement(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          accountId: revenue.id,
          fileName: "mutasi.csv",
          csvText: `Tanggal,Keterangan,Debit,Kredit\n${today},Apa pun,1000,`,
        });
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("auto-match menautkan kandidat tunggal dan melewati kandidat ganda", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const revenue = await accountByCode(tx, "400001");

      // Satu jurnal unik 7.770.010 dan dua jurnal kembar 5.550.020.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Setoran unik uji rekonsiliasi",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "7770010" },
          { accountId: revenue.id, credit: "7770010" },
        ],
      });
      for (let i = 0; i < 2; i += 1) {
        await postJournal(tx, {
          companyId: ORG_ID,
          date: today,
          description: `Setoran kembar uji rekonsiliasi ${i}`,
          sourceType: "manual",
          createdBy: USER_ID,
          lines: [
            { accountId: bank.id, debit: "5550020" },
            { accountId: revenue.id, credit: "5550020" },
          ],
        });
      }

      const csv = [
        "Tanggal;Keterangan;Debit;Kredit",
        `${idDate(today)};Setoran unik uji;7.770.010;`,
        `${idDate(today)};Setoran kembar uji;5.550.020;`,
      ].join("\n");
      await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi.csv",
        csvText: csv,
      });

      const outcome = await autoMatch(tx, { companyId: ORG_ID, accountId: bank.id });
      expect(outcome.matchedCount).toBe(1);
      expect(outcome.ambiguousCount).toBe(1);

      const lines = await listStatementLines(tx, ORG_ID, bank.id, {});
      const unique = lines.rows.find((row) => d(row.debit).eq("7770010"));
      const twin = lines.rows.find((row) => d(row.debit).eq("5550020"));
      expect(unique?.matchedJournalLineId).toBeTruthy();
      expect(twin?.matchedJournalLineId).toBeNull();
    });
  });

  it("match manual menolak nominal berbeda; unmatch mengembalikan status", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const revenue = await accountByCode(tx, "400001");

      const entry = await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Setoran manual uji rekonsiliasi",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "9990031" },
          { accountId: revenue.id, credit: "9990031" },
        ],
      });
      const [bankLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, entry.id), eq(journalLines.accountId, bank.id)))
        .limit(1);

      const csv = [
        "Tanggal;Keterangan;Debit;Kredit",
        `${idDate(today)};Setoran manual uji;9.990.030;`,
      ].join("\n");
      await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi.csv",
        csvText: csv,
      });
      const [statement] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.companyId, ORG_ID));

      // Beda 1 rupiah → ditolak.
      await expect(
        matchLine(tx, { companyId: ORG_ID, statementLineId: statement.id, journalLineId: bankLine.id }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      // Jurnal dengan nominal persis → diterima.
      const entry2 = await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Setoran manual pas uji rekonsiliasi",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "9990030" },
          { accountId: revenue.id, credit: "9990030" },
        ],
      });
      const [bankLine2] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, entry2.id), eq(journalLines.accountId, bank.id)))
        .limit(1);
      await matchLine(tx, {
        companyId: ORG_ID,
        statementLineId: statement.id,
        journalLineId: bankLine2.id,
      });
      const [matched] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.id, statement.id));
      expect(matched.matchedJournalLineId).toBe(bankLine2.id);

      await unmatchLine(tx, { companyId: ORG_ID, statementLineId: statement.id });
      const [unmatched] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.id, statement.id));
      expect(unmatched.matchedJournalLineId).toBeNull();

      const book = await listBookLines(tx, ORG_ID, bank.id, { status: "unmatched" });
      expect(book.rows.some((row) => row.id === bankLine2.id && !row.matched)).toBe(true);
    });
  });

  it("buat jurnal dari mutasi biaya bank: seimbang, tertaut, saldo buku berubah", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const fee = await accountByCode(tx, "720002");

      const before = await getReconciliationSummary(tx, ORG_ID, bank.id);

      const csv = [
        "Tanggal;Keterangan;Debit;Kredit",
        `${idDate(today)};Biaya administrasi bank uji;;25.010`,
      ].join("\n");
      await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi.csv",
        csvText: csv,
      });
      const [statement] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.companyId, ORG_ID));

      const journal = await createJournalFromLine(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        statementLineId: statement.id,
        contraAccountId: fee.id,
      });

      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, journal.id));
      expect(entry.status).toBe("posted");
      const lines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, entry.id));
      const totalDebit = lines.reduce((acc, row) => acc.plus(d(row.debit)), d(0));
      const totalCredit = lines.reduce((acc, row) => acc.plus(d(row.credit)), d(0));
      expect(totalDebit.toFixed(2)).toBe("25010.00");
      expect(totalDebit.toFixed(4)).toBe(totalCredit.toFixed(4));
      const bankLeg = lines.find((row) => row.accountId === bank.id);
      expect(d(bankLeg!.credit).toFixed(2)).toBe("25010.00");

      const [after] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.id, statement.id));
      expect(after.matchedJournalLineId).toBe(bankLeg!.id);

      const summary = await getReconciliationSummary(tx, ORG_ID, bank.id);
      expect(d(summary.bookBalance).toFixed(2)).toBe(
        d(before.bookBalance).minus("25010").toFixed(2),
      );
      expect(d(summary.reconciledTotal).toFixed(2)).toBe(
        d(before.reconciledTotal).minus("25010").toFixed(2),
      );
    });
  });

  it("ringkasan empat angka konsisten: buku = tertaut + belum tertaut", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const revenue = await accountByCode(tx, "400001");

      await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: "Setoran ringkasan uji rekonsiliasi",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "3330040" },
          { accountId: revenue.id, credit: "3330040" },
        ],
      });
      const csv = [
        "Tanggal;Keterangan;Debit;Kredit",
        `${idDate(today)};Setoran ringkasan uji;3.330.040;`,
        `${idDate(today)};Mutasi yatim uji;;111.005`,
      ].join("\n");
      await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi.csv",
        csvText: csv,
      });
      await autoMatch(tx, { companyId: ORG_ID, accountId: bank.id });

      const summary = await getReconciliationSummary(tx, ORG_ID, bank.id);
      expect(d(summary.bookBalance).toFixed(4)).toBe(
        d(summary.reconciledTotal).plus(summary.unreconciledTotal).toFixed(4),
      );
      // Mutasi yatim kredit 111.005 belum tertaut → neto negatif.
      expect(d(summary.unmatchedStatementTotal).toFixed(2)).toBe("-111005.00");
    });
  });
});

describe("A-22 K3: data form jurnal-dari-mutasi (getReconciliationFormData)", () => {
  it("akun lawan: bank terpilih dikecualikan, kas/bank ditandai, tipe terbawa", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const form = await getReconciliationFormData(tx, ORG_ID, bank.id);
      const byCode = new Map(form.contraAccounts.map((row) => [row.code, row]));
      expect(byCode.has("11010201")).toBe(false); // akun bank itu sendiri
      expect(byCode.get("110107")?.isCashBank).toBe(true); // Kas hasil pemetaan
      expect(byCode.get("720002")?.type).toBe("expense");
      expect(byCode.get("720002")?.isCashBank).toBe(false);
      expect(byCode.get("710005")?.type).toBe("revenue");
    });
  });

  it("model cepat: bank_fee terpeta 62006; bunga ke 71001 (pemetaan other_income tertanam templat B6); PPh ke pajak dimuka terkecil", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      const form = await getReconciliationFormData(tx, ORG_ID, bank.id);
      expect(form.models.bankFee?.code).toBe("720002");
      // A-27 B6: other_income kini TERPETAKAN oleh templat (71001,
      // seksi other_income) — model cepat membacanya dari pemetaan,
      // bukan lagi fallback pencarian akun 4030 seperti sebelum B6.
      expect(form.models.otherIncome?.code).toBe("710005");
      // A-27 B6: templat menanam akun pajak dibayar dimuka & beban
      // pajak penghasilan, jadi heuristik PPh (beban/aset bernama
      // pph/pajak, tanpa kandidat menyebut "bunga") kini menemukan
      // kandidat berkode terkecil: 11502 PPh 22 Dibayar Dimuka.
      // Sebelum B6 demo tidak punya kandidat dan hasilnya null.
      // Akun liabilitas Utang PPh (21013/21016) tetap dikecualikan.
      expect(form.models.taxDeduction?.code).toBe("110505");
    });
  });

  it("model PPh terisi begitu ada akun beban pajak (dan liabilitas tetap dikecualikan)", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      await tx.insert(accounts).values({
        companyId: ORG_ID,
        code: "6999",
        name: "Beban Pajak atas Bunga Bank",
        type: "expense",
        normalBalance: "debit",
        section: "operating_expense",
      });
      const form = await getReconciliationFormData(tx, ORG_ID, bank.id);
      expect(form.models.taxDeduction?.code).toBe("6999");
    });
  });

  it("impor tanpa header lewat domain: baris data polos diterima (UX-05)", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, "11010201");
      return importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "tempel-tanpa-header.csv",
        csvText: `${idDate(today)};Biaya admin tempel uji;;25.011`,
      });
    });
    expect(result.insertedRows).toBe(1);
    expect(result.errors).toEqual([]);
  });
});
