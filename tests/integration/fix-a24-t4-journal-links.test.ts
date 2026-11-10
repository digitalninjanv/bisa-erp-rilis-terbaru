import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  bankTransfers,
  expenses,
  fiscalPeriods,
  fixedAssetDepreciationRuns,
  fixedAssets,
  journalEntries,
  partyCredits,
  partyOpeningBalances,
  partyPayments,
} from "@/db/schema";
import {
  listLinkedJournals,
  listLinkedJournalsBySourceIds,
  listJournalNumbersById,
} from "@/server/catalog";
import {
  getFixedAssetBookValues,
} from "@/server/fixed-assets";
import { countBankTransfers, listBankTransfers } from "@/server/bank-transfers";
import { listPartyCredits } from "@/server/party-credits";
import {
  getMonthEndChecklist,
  listExpenses,
  listPayables,
  listReceivables,
  listRecentPartyPayments,
} from "@/server/reports";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

let seq = 0;
function uniq(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}-${Math.floor(Math.random() * 1e9)}`;
}

async function insertJournal(
  tx: Tx,
  input: {
    number: string;
    sourceType: string;
    sourceId?: string | null;
    idempotencyKey?: string | null;
    reversalOfId?: string | null;
    status?: string;
    date?: string;
    createdAt?: Date;
  },
) {
  const [row] = await tx
    .insert(journalEntries)
    .values({
      companyId: ORG_ID,
      number: input.number,
      date: input.date ?? "2020-03-10",
      description: `Jurnal uji T4 ${input.number}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      reversalOfId: input.reversalOfId ?? null,
      status: input.status ?? "posted",
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: journalEntries.id });
  return row.id;
}

/**
 * A-24 T4 (pola Accurate "Rincian Jurnal"): setiap dokumen terposting
 * non-POS membuka jurnal terbentuknya dari halaman dokumennya, memakai
 * mekanisme sumber-jurnal yang sudah ada — fungsi baca bersama
 * listLinkedJournals (katalog) + penempelan jurnal pada fungsi baca
 * daftar (beban, transfer bank, pembayaran pihak, saldo awal, kredit
 * pihak, aset). Test ini mengunci perilaku fungsi baca itu.
 */
describe("A-24 T4 — tautan jurnal dokumen (fungsi baca)", () => {
  it("listLinkedJournals: semua jurnal satu dokumen, terurut waktu, tanpa dokumen lain", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const docId = crypto.randomUUID();
      const otherDocId = crypto.randomUUID();
      const first = await insertJournal(tx, {
        number: uniq("JU-T4T-A"),
        sourceType: "payroll",
        sourceId: docId,
        createdAt: new Date("2020-03-10T01:00:00Z"),
      });
      await insertJournal(tx, {
        number: uniq("JU-T4T-B"),
        sourceType: "payroll_payment",
        sourceId: docId,
        createdAt: new Date("2020-03-10T02:00:00Z"),
      });
      await insertJournal(tx, {
        number: uniq("JU-T4T-C"),
        sourceType: "payroll_reversal",
        sourceId: docId,
        reversalOfId: first,
        createdAt: new Date("2020-03-10T03:00:00Z"),
      });
      await insertJournal(tx, {
        number: uniq("JU-T4T-D"),
        sourceType: "payroll",
        sourceId: otherDocId,
      });
      const rows = await listLinkedJournals(tx, ORG_ID, docId);
      return rows.map((row) => ({ id: row.id, number: row.number, sourceType: row.sourceType }));
    });
    expect(result).toHaveLength(3);
    expect(result[0].sourceType).toBe("payroll");
    expect(result[1].sourceType).toBe("payroll_payment");
    expect(result[2].sourceType).toBe("payroll_reversal");
    expect(result[1].id).not.toBe(result[0].id);
  });

  it("listLinkedJournalsBySourceIds: mengelompokkan per dokumen & melewatkan yang kosong", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const docA = crypto.randomUUID();
      const docB = crypto.randomUUID();
      const docC = crypto.randomUUID();
      await insertJournal(tx, { number: uniq("JU-T4T-E"), sourceType: "expense", sourceId: docA });
      await insertJournal(tx, { number: uniq("JU-T4T-F"), sourceType: "payment", sourceId: docA });
      await insertJournal(tx, { number: uniq("JU-T4T-G"), sourceType: "bank_transfer", sourceId: docB });
      const map = await listLinkedJournalsBySourceIds(tx, ORG_ID, [docA, docB, docC]);
      return {
        a: map.get(docA)?.map((row) => row.sourceType),
        b: map.get(docB)?.map((row) => row.sourceType),
        c: map.get(docC),
      };
    });
    expect(result.a).toEqual(["expense", "payment"]);
    expect(result.b).toEqual(["bank_transfer"]);
    expect(result.c ?? []).toEqual([]);
  });

  it("listJournalNumbersById: nomor jurnal dari daftar id", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const number = uniq("JU-T4T-H");
      const id = await insertJournal(tx, { number, sourceType: "opening_balance" });
      const map = await listJournalNumbersById(tx, ORG_ID, [id, crypto.randomUUID()]);
      return map.get(id);
    });
    expect(result).toBeTruthy();
    expect(result).toContain("JU-T4T-H");
  });

  it("listExpenses: baris beban membawa jurnal pembentuknya (bukan jurnal pembayaran/pembalik)", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const [expenseAccount] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.type, "expense")))
        .limit(1);
      const [paymentAccount] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.type, "asset")))
        .limit(1);
      const [expense] = await tx
        .insert(expenses)
        .values({
          companyId: ORG_ID,
          number: uniq("EXP-T4T"),
          date: "2020-03-05",
          expenseAccountId: expenseAccount.id,
          paymentAccountId: paymentAccount.id,
          amount: "150000",
          description: "Beban uji tautan jurnal T4",
          status: "posted",
        })
        .returning({ id: expenses.id });
      const journalNumber = uniq("JU-T4T-EXP");
      await insertJournal(tx, { number: journalNumber, sourceType: "expense", sourceId: expense.id });
      await insertJournal(tx, { number: uniq("JU-T4T-PAY"), sourceType: "payment", sourceId: expense.id });
      const listed = await listExpenses(tx, ORG_ID, { from: "2020-03-01", to: "2020-03-31", page: 1, pageSize: 10, month: "2020-03" });
      return listed.rows.map((row) => ({
        number: row.number,
        journalNumber: (row as { journalNumber?: string | null }).journalNumber ?? null,
        journalId: (row as { journalId?: string | null }).journalId ?? null,
      }));
    });
    const mine = result.find((row) => row.number.startsWith("EXP-T4T"));
    expect(mine).toBeDefined();
    expect(mine?.journalNumber).toContain("JU-T4T-EXP");
    expect(mine?.journalId).toBeTruthy();
  });

  it("listBankTransfers: baris transfer membawa jurnalnya", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const [transfer] = await tx
        .insert(bankTransfers)
        .values({
          companyId: ORG_ID,
          number: uniq("TRF-T4T"),
          date: "2020-03-06",
          fromAccountId: crypto.randomUUID(),
          toAccountId: crypto.randomUUID(),
          amount: "500000",
          netAmount: "500000",
          status: "posted",
        })
        .returning({ id: bankTransfers.id });
      const journalNumber = uniq("JU-T4T-TRF");
      await insertJournal(tx, { number: journalNumber, sourceType: "bank_transfer", sourceId: transfer.id });
      const rows = await listBankTransfers(tx, ORG_ID, { from: "2020-03-01", to: "2020-03-31", limit: 60 });
      return rows.map((row) => ({
        number: row.number,
        journalNumber: (row as { journalNumber?: string | null }).journalNumber ?? null,
      }));
    });
    const mine = result.find((row) => row.number.startsWith("TRF-T4T"));
    expect(mine).toBeDefined();
    expect(mine?.journalNumber).toContain("JU-T4T-TRF");
  });

  it("listBankTransfers: count dan offset mengikuti filter yang sama", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const numbers = [uniq("TRF-T4T-P1"), uniq("TRF-T4T-P2")];
      await tx.insert(bankTransfers).values(
        numbers.map((number) => ({
          companyId: ORG_ID,
          number,
          date: "2019-12-15",
          fromAccountId: crypto.randomUUID(),
          toAccountId: crypto.randomUUID(),
          amount: "100000",
          netAmount: "100000",
          status: "posted",
        })),
      );
      const filters = { from: "2019-12-15", to: "2019-12-15" };
      const total = await countBankTransfers(tx, ORG_ID, filters);
      const first = await listBankTransfers(tx, ORG_ID, { ...filters, limit: 1, offset: 0 });
      const second = await listBankTransfers(tx, ORG_ID, { ...filters, limit: 1, offset: 1 });
      return { total, first: first[0]?.number, second: second[0]?.number };
    });
    expect(result.total).toBe(2);
    expect(result.first).toBeDefined();
    expect(result.second).toBeDefined();
    expect(result.first).not.toBe(result.second);
  });

  it("listRecentPartyPayments: jurnal pembayaran ditemukan lewat kunci idempotensi semua pola", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const cases: Array<{ kind: string; docField: "receiptId" | "saleId" | "expenseId" | "openingId"; type: string; keyPrefix: string }> = [
        { kind: "ap", docField: "receiptId", type: "payable", keyPrefix: "ap" },
        { kind: "ar", docField: "saleId", type: "receivable", keyPrefix: "ar" },
        { kind: "ap-expense", docField: "expenseId", type: "payable", keyPrefix: "ap-expense" },
        { kind: "ap-opening", docField: "openingId", type: "payable", keyPrefix: "ap-opening" },
      ];
      const expectations: Array<{ paymentNumber: string; journalNumber: string }> = [];
      // expense_id & opening_id ber-FK — dokumennya harus nyata.
      const [expenseAccount] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.type, "expense")))
        .limit(1);
      const [realExpense] = await tx
        .insert(expenses)
        .values({
          companyId: ORG_ID,
          number: uniq("EXP-T4T-PAY"),
          date: "2099-01-10",
          expenseAccountId: expenseAccount.id,
          paymentAccountId: expenseAccount.id,
          amount: "75000",
          description: "Beban uji pembayaran T4",
          status: "posted",
        })
        .returning({ id: expenses.id });
      const [realOpening] = await tx
        .insert(partyOpeningBalances)
        .values({
          companyId: ORG_ID,
          number: uniq("OP-T4T-PAY"),
          kind: "payable",
          partyType: "supplier",
          partyId: crypto.randomUUID(),
          date: "2099-01-10",
          amount: "75000",
          status: "open",
        })
        .returning({ id: partyOpeningBalances.id });
      for (const c of cases) {
        const docId =
          c.docField === "expenseId"
            ? realExpense.id
            : c.docField === "openingId"
              ? realOpening.id
              : crypto.randomUUID();
        const paymentNumber = uniq(`PAY-T4T-${c.kind}`);
        const journalNumber = uniq(`JU-T4T-${c.kind}`);
        await tx.insert(partyPayments).values({
          companyId: ORG_ID,
          type: c.type,
          partyType: c.type === "receivable" ? "customer" : "supplier",
          partyId: crypto.randomUUID(),
          [c.docField]: docId,
          number: paymentNumber,
          date: "2099-01-15",
          amount: "75000",
          accountId: crypto.randomUUID(),
          status: "posted",
        });
        await insertJournal(tx, {
          number: journalNumber,
          sourceType: "payment",
          sourceId: docId,
          idempotencyKey: `${c.keyPrefix}:${docId}:${paymentNumber}`,
          date: "2099-01-15",
        });
        expectations.push({ paymentNumber, journalNumber });
      }
      const rows = await listRecentPartyPayments(tx, ORG_ID);
      return expectations.map((exp) => {
        const row = rows.find((r) => r.number === exp.paymentNumber) as
          | { journalNumber?: string | null }
          | undefined;
        return { ...exp, found: row?.journalNumber ?? null };
      });
    });
    for (const exp of result) {
      expect(exp.found, `pembayaran ${exp.paymentNumber}`).toBe(exp.journalNumber);
    }
  });

  it("saldo awal: baris opening pada listPayables/listReceivables membawa jurnal pembentuknya", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const out: Record<string, { journalId: string | null; journalNumber: string | null }> = {};
      for (const kind of ["payable", "receivable"] as const) {
        const journalNumber = uniq(`JU-T4T-OP-${kind}`);
        const journalId = await insertJournal(tx, { number: journalNumber, sourceType: "opening_balance" });
        const [doc] = await tx
          .insert(partyOpeningBalances)
          .values({
            companyId: ORG_ID,
            number: uniq(`OP-T4T-${kind}`),
            kind,
            partyType: kind === "payable" ? "supplier" : "customer",
            partyId: crypto.randomUUID(),
            date: "2020-01-01",
            amount: "250000",
            journalId,
            status: "open",
          })
          .returning({ id: partyOpeningBalances.id });
        const rows = kind === "payable" ? await listPayables(tx, ORG_ID) : await listReceivables(tx, ORG_ID);
        const mine = rows.find((row) => row.id === doc.id) as
          | { journalId?: string | null; journalNumber?: string | null }
          | undefined;
        out[kind] = { journalId: mine?.journalId ?? null, journalNumber: mine?.journalNumber ?? null };
        expect(mine, `baris opening ${kind}`).toBeDefined();
      }
      return out;
    });
    expect(result.payable.journalNumber).toContain("JU-T4T-OP-payable");
    expect(result.receivable.journalNumber).toContain("JU-T4T-OP-receivable");
  });

  it("listPartyCredits: baris kredit membawa nomor jurnal penerbitannya", async () => {
    const partyId = crypto.randomUUID();
    const result = await rollbackTransaction(async (tx) => {
      const journalNumber = uniq("JU-T4T-KRD");
      const journalId = await insertJournal(tx, { number: journalNumber, sourceType: "party_credit" });
      await tx.insert(partyCredits).values({
        companyId: ORG_ID,
        number: uniq("KRD-T4T"),
        partyType: "supplier",
        partyId,
        date: "2020-03-07",
        amount: "90000",
        usedAmount: "0",
        status: "open",
        journalId,
      });
      const rows = await listPartyCredits(tx, ORG_ID, { partyType: "supplier", partyId });
      return rows.map((row) => ({
        journalId: (row as { journalId?: string | null }).journalId ?? null,
        journalNumber: (row as { journalNumber?: string | null }).journalNumber ?? null,
      }));
    });
    expect(result).toHaveLength(1);
    expect(result[0].journalNumber).toContain("JU-T4T-KRD");
    expect(result[0].journalId).toBeTruthy();
  });

  it("getFixedAssetBookValues: baris aset membawa jurnal perolehan & pelepasan", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const acqNumber = uniq("JU-T4T-AST1");
      const acqId = await insertJournal(tx, { number: acqNumber, sourceType: "fixed_asset_acquisition" });
      const disNumber = uniq("JU-T4T-AST2");
      const disId = await insertJournal(tx, { number: disNumber, sourceType: "fixed_asset_disposal" });
      const [asset] = await tx
        .insert(fixedAssets)
        .values({
          companyId: ORG_ID,
          number: uniq("AST-T4T"),
          name: "Aset uji T4",
          acquisitionDate: "2020-01-15",
          cost: "1200000",
          residualValue: "0",
          usefulLifeMonths: 48,
          status: "disposed",
          disposalDate: "2020-06-01",
          journalId: acqId,
          disposalJournalId: disId,
        })
        .returning({ id: fixedAssets.id });
      const report = await getFixedAssetBookValues(tx, ORG_ID);
      const mine = report.rows.find((row) => row.id === asset.id) as
        | { journalNumber?: string | null; disposalJournalNumber?: string | null }
        | undefined;
      return mine ?? null;
    });
    expect(result).not.toBeNull();
    expect(result?.journalNumber).toContain("JU-T4T-AST1");
    expect(result?.disposalJournalNumber).toContain("JU-T4T-AST2");
  });

  it("fixture sanity: tabel periode & run penyusutan dapat ditulis", async () => {
    await rollbackTransaction(async (tx) => {
      await tx.insert(fiscalPeriods).values({ companyId: ORG_ID, year: 2019, month: 3, status: "open" });
      await tx.insert(fixedAssetDepreciationRuns).values({
        companyId: ORG_ID,
        period: "2019-03",
        totalAmount: "0",
        assetCount: 0,
        status: "posted",
      });
    });
    expect(true).toBe(true);
  });
});

/**
 * A-24 T4 (pola Accurate "Proses Akhir Bulan"): daftar periksa tutup
 * periode dihitung dari KEADAAN NYATA (run penyusutan, rekonsiliasi
 * kontrol, status periode fiskal, jurnal penutup tahun) — bukan
 * simulasi. Skenario memakai tahun 2019 agar tidak bertabrakan dengan
 * data demo (semua jurnal/dokumen demo bertanggal jauh sesudahnya,
 * sehingga kaki rekonsiliasi kontrol per 2019 seimbang nol).
 */
describe("A-24 T4 — daftar periksa akhir bulan dari keadaan nyata", () => {
  function stepOf(
    checklist: Awaited<ReturnType<typeof getMonthEndChecklist>>,
    key: string,
  ) {
    const step = checklist.steps.find((s) => s.key === key);
    if (!step) throw new Error(`langkah ${key} tidak ada`);
    return step;
  }

  it("bulan tertutup + run penyusutan terposting → langkah selesai; tutup tahun menunggu Desember", async () => {
    const checklist = await rollbackTransaction(async (tx) => {
      await tx.insert(fiscalPeriods).values({ companyId: ORG_ID, year: 2019, month: 1, status: "closed" });
      await tx.insert(fixedAssetDepreciationRuns).values({
        companyId: ORG_ID,
        period: "2019-01",
        totalAmount: "0",
        assetCount: 0,
        status: "posted",
      });
      return getMonthEndChecklist(tx, ORG_ID, 2019, 1);
    });
    expect(stepOf(checklist, "depreciation").status).toBe("done");
    expect(stepOf(checklist, "control").status).toBe("done");
    expect(stepOf(checklist, "period").status).toBe("done");
    expect(stepOf(checklist, "year_end").status).toBe("not_applicable");
    expect(checklist.endOfMonth).toBe("2019-01-31");
  });

  it("aset aktif tanpa run & periode terbuka → langkah penyusutan dan periode 'pending'", async () => {
    const checklist = await rollbackTransaction(async (tx) => {
      await tx.insert(fixedAssets).values({
        companyId: ORG_ID,
        number: uniq("AST-T4T-CL"),
        name: "Aset uji daftar periksa T4",
        acquisitionDate: "2018-06-15",
        cost: "12000000",
        residualValue: "0",
        usefulLifeMonths: 48,
        status: "active",
      });
      return getMonthEndChecklist(tx, ORG_ID, 2019, 2);
    });
    const depreciation = stepOf(checklist, "depreciation");
    expect(depreciation.status).toBe("pending");
    expect(depreciation.detail).toContain("1 aset aktif");
    expect(stepOf(checklist, "period").status).toBe("pending");
  });

  it("tanpa aset sama sekali → penyusutan 'not_applicable', bukan 'pending'", async () => {
    const checklist = await rollbackTransaction(async (tx) => getMonthEndChecklist(tx, ORG_ID, 2019, 4));
    expect(stepOf(checklist, "depreciation").status).toBe("not_applicable");
  });

  it("Desember: tutup buku 'pending' sampai jurnal penutup tahun terposting, lalu 'done'", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const before = await getMonthEndChecklist(tx, ORG_ID, 2019, 12);
      await insertJournal(tx, {
        number: uniq("JU-T4T-YE"),
        sourceType: "year_end_closing",
        date: "2019-12-31",
      });
      const after = await getMonthEndChecklist(tx, ORG_ID, 2019, 12);
      return { before: stepOf(before, "year_end"), after: stepOf(after, "year_end") };
    });
    expect(result.before.status).toBe("pending");
    expect(result.after.status).toBe("done");
    expect(result.after.detail).toContain("JU-T4T-YE");
  });
});
