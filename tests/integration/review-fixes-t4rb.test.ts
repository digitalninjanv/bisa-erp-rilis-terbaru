import { describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  bankStatementImports,
  bankStatementLines,
  companySettings,
  importJobs,
  importRows,
  journalLines,
  partyOpeningBalances,
  products,
  stockOnHand,
  stockReceiptLines,
  suppliers,
  warehouses,
} from "@/db/schema";
import { postJournal, reverseJournalEntry, reverseSourceJournal } from "@/server/accounting";
import {
  createJournalFromLine,
  getReconciliationSummary,
  importStatement,
  matchLine,
  unmatchLine,
} from "@/server/bank-reconciliation";
import { createReceipt } from "@/server/inventory";
import {
  analyzeMasterImport,
  commitOpeningBalancesImport,
  commitOpeningStockImport,
} from "@/server/import-masters";
import { voidOpeningBalance } from "@/server/opening-balances";
import { ENTITY_FIELDS, suggestMappingFor } from "@/lib/import-parse";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Tindak lanjut review Tahap 4 batch T4R-B:
//   T4R-3a jurnal tertaut mutasi bank tidak boleh dibalik sebelum
//          tautannya dilepas (penjaga di domain accounting).
//   T4R-3b ringkasan rekonsiliasi hanya menghitung baris jurnal "live"
//          bertanggal <= hari ini pada total tertaut.
//   T4R-4  penautan memakai kunci baris + indeks unik parsial — dua
//          matchLine konkuren tidak boleh mengklaim baris yang sama.
//   T4R-5  impor ulang antar-job untuk saldo awal & stok awal yang sama
//          ditandai duplikat dan tidak menggandakan dokumen/stok.
// T4R-3/5 memakai transaksi rollback di perusahaan demo; T4R-4 memakai
// transaksi commit sungguhan di perusahaan uji tersendiri karena kunci
// baris hanya terlihat antar-transaksi.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const RACE_ORG = "01900000-0000-7000-8000-00000000aa21";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function orgTx<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${org}, true)`);
    return fn(tx);
  });
}

async function accountByCode(tx: Tx, org: string, code: string) {
  const [row] = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.companyId, org), eq(accounts.code, code)))
    .limit(1);
  if (!row) throw new Error(`Akun ${code} tidak ada di fixture`);
  return row;
}

function idDate(iso: string): string {
  const [y, m, dd] = iso.split("-");
  return `${dd}/${m}/${y}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const today = todayISO();

/* ------------------------------------------------------------------ */
/* T4R-3a — jurnal tertaut tidak boleh dibalik                         */
/* ------------------------------------------------------------------ */

describe("T4R-3a jurnal tertaut mutasi bank tidak bisa dibalik", () => {
  it("reverseJournalEntry menolak jurnal manual yang tertaut; sesudah unmatch berhasil", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, ORG_ID, "11010201");
      const revenue = await accountByCode(tx, ORG_ID, "400001");
      const entry = await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: `Setoran tertaut uji T4R-3a ${suffix}`,
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "7311001" },
          { accountId: revenue.id, credit: "7311001" },
        ],
      });
      const [bankLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, entry.id), eq(journalLines.accountId, bank.id)))
        .limit(1);

      const imported = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: `uji-t4r3a-${suffix}.csv`,
        csvText: [
          "Tanggal;Keterangan;Debit;Kredit",
          `${idDate(today)};Setoran tertaut uji T4R-3a ${suffix};7.311.001;`,
        ].join("\n"),
      });
      const [statement] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.importId, imported.importId));
      await matchLine(tx, { companyId: ORG_ID, statementLineId: statement.id, journalLineId: bankLine.id });

      const error = await reverseJournalEntry(tx, {
        companyId: ORG_ID,
        entryId: entry.id,
        date: today,
        createdBy: USER_ID,
      }).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as Error).message).toContain(entry.number);
      expect((error as Error).message).toContain("Rekonsiliasi");

      await unmatchLine(tx, { companyId: ORG_ID, statementLineId: statement.id });
      const { reversal } = await reverseJournalEntry(tx, {
        companyId: ORG_ID,
        entryId: entry.id,
        date: today,
        createdBy: USER_ID,
      });
      expect(reversal.id).toBeTruthy();
    });
  });

  it("reverseSourceJournal juga menolak jurnal bank_statement yang lahir tertaut", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, ORG_ID, "11010201");
      const fee = await accountByCode(tx, ORG_ID, "720002");
      const imported = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: `uji-t4r3a-sumber-${suffix}.csv`,
        csvText: [
          "Tanggal;Keterangan;Debit;Kredit",
          `${idDate(today)};Biaya admin uji T4R-3a ${suffix};;4.321`,
        ].join("\n"),
      });
      const [statement] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.importId, imported.importId));
      const created = await createJournalFromLine(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        statementLineId: statement.id,
        contraAccountId: fee.id,
      });
      expect(created.id).toBeTruthy();

      const error = await reverseSourceJournal(tx, {
        companyId: ORG_ID,
        sourceType: "bank_statement",
        sourceId: statement.id,
        date: today,
        description: "Uji balik jurnal tertaut",
        createdBy: USER_ID,
      }).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as Error).message).toContain("Rekonsiliasi");
    });
  });
});

/* ------------------------------------------------------------------ */
/* T4R-3b — ringkasan hanya menghitung jurnal live <= hari ini         */
/* ------------------------------------------------------------------ */

describe("T4R-3b ringkasan rekonsiliasi memakai predikat live + batas tanggal", () => {
  it("jurnal tertaut bertanggal masa depan tidak menggelembungkan reconciledTotal", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountByCode(tx, ORG_ID, "11010201");
      const revenue = await accountByCode(tx, ORG_ID, "400001");
      const future = addDays(today, 10);

      const before = await getReconciliationSummary(tx, ORG_ID, bank.id);

      // Jurnal masa depan + mutasi masa depan, ditautkan manual.
      const futureEntry = await postJournal(tx, {
        companyId: ORG_ID,
        date: future,
        description: `Setoran masa depan uji T4R-3b ${suffix}`,
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "7411002" },
          { accountId: revenue.id, credit: "7411002" },
        ],
      });
      const [futureBankLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, futureEntry.id), eq(journalLines.accountId, bank.id)))
        .limit(1);
      const futureImport = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: `uji-t4r3b-depan-${suffix}.csv`,
        csvText: [
          "Tanggal;Keterangan;Debit;Kredit",
          `${idDate(future)};Setoran masa depan uji T4R-3b ${suffix};7.411.002;`,
        ].join("\n"),
      });
      const [futureStatement] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.importId, futureImport.importId));
      await matchLine(tx, {
        companyId: ORG_ID,
        statementLineId: futureStatement.id,
        journalLineId: futureBankLine.id,
      });

      const afterFuture = await getReconciliationSummary(tx, ORG_ID, bank.id);
      // Jurnal masa depan belum masuk saldo buku (batas <= hari ini), jadi
      // tautannya juga tidak boleh masuk total terrekon — kalau masuk,
      // unreconciledTotal menyusut semu dan bisa negatif.
      expect(d(afterFuture.reconciledTotal).toFixed(4)).toBe(d(before.reconciledTotal).toFixed(4));
      expect(d(afterFuture.unreconciledTotal).toFixed(4)).toBe(d(before.unreconciledTotal).toFixed(4));
      expect(d(afterFuture.unreconciledTotal).gte(d(before.unreconciledTotal))).toBe(true);

      // Kontrol: jurnal hari ini yang tertaut menaikkan reconciledTotal
      // persis sebesar nominalnya.
      const todayEntry = await postJournal(tx, {
        companyId: ORG_ID,
        date: today,
        description: `Setoran hari ini uji T4R-3b ${suffix}`,
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "7411003" },
          { accountId: revenue.id, credit: "7411003" },
        ],
      });
      const [todayBankLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, todayEntry.id), eq(journalLines.accountId, bank.id)))
        .limit(1);
      const todayImport = await importStatement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        accountId: bank.id,
        fileName: `uji-t4r3b-kini-${suffix}.csv`,
        csvText: [
          "Tanggal;Keterangan;Debit;Kredit",
          `${idDate(today)};Setoran hari ini uji T4R-3b ${suffix};7.411.003;`,
        ].join("\n"),
      });
      const [todayStatement] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.importId, todayImport.importId));
      await matchLine(tx, {
        companyId: ORG_ID,
        statementLineId: todayStatement.id,
        journalLineId: todayBankLine.id,
      });

      const afterToday = await getReconciliationSummary(tx, ORG_ID, bank.id);
      expect(d(afterToday.reconciledTotal).minus(d(before.reconciledTotal)).toFixed(4)).toBe("7411003.0000");
      expect(d(afterToday.unreconciledTotal).toFixed(4)).toBe(d(before.unreconciledTotal).toFixed(4));
    });
  });
});

/* ------------------------------------------------------------------ */
/* T4R-4 — balapan matchLine                                           */
/* ------------------------------------------------------------------ */

async function ensureRaceCompany() {
  await orgTx(RACE_ORG, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, RACE_ORG))
      .limit(1);
    if (existing) return;
    await tx.insert(companySettings).values({ companyId: RACE_ORG, legalName: "Uji Balapan Rekonsiliasi" });
    const rows = await tx
      .insert(accounts)
      .values([
        { companyId: RACE_ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "1100", name: "Bank Uji", type: "asset", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
      ])
      .returning({ id: accounts.id, code: accounts.code });
    const byCode = new Map(rows.map((row) => [row.code, row.id]));
    await tx.insert(accountMappings).values([
      { companyId: RACE_ORG, key: "cash", accountId: byCode.get("1000")! },
      { companyId: RACE_ORG, key: "bank", accountId: byCode.get("1100")! },
      { companyId: RACE_ORG, key: "qris", accountId: byCode.get("1100")! },
    ]);
  });
}

/** Membuat satu jurnal Dr Bank + satu batch impor berisi baris-baris mutasi. */
async function raceFixture(input: {
  journalCount: number;
  statementCount: number;
  amount: string;
  tag: string;
}): Promise<{ journalLineIds: string[]; statementLineIds: string[] }> {
  return orgTx(RACE_ORG, async (tx) => {
    const bank = await accountByCode(tx, RACE_ORG, "1100");
    const revenue = await accountByCode(tx, RACE_ORG, "4000");
    const journalLineIds: string[] = [];
    for (let i = 0; i < input.journalCount; i += 1) {
      const entry = await postJournal(tx, {
        companyId: RACE_ORG,
        date: today,
        description: `Jurnal balapan ${input.tag} ${i} ${suffix}`,
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: input.amount },
          { accountId: revenue.id, credit: input.amount },
        ],
      });
      const [line] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, entry.id), eq(journalLines.accountId, bank.id)))
        .limit(1);
      journalLineIds.push(line.id);
    }
    const [batch] = await tx
      .insert(bankStatementImports)
      .values({
        companyId: RACE_ORG,
        accountId: bank.id,
        fileName: `balapan-${input.tag}-${suffix}.csv`,
        importedBy: USER_ID,
        totalRows: input.statementCount,
        insertedRows: input.statementCount,
        skippedRows: 0,
      })
      .returning({ id: bankStatementImports.id });
    const statementLineIds: string[] = [];
    for (let i = 0; i < input.statementCount; i += 1) {
      const [line] = await tx
        .insert(bankStatementLines)
        .values({
          companyId: RACE_ORG,
          importId: batch.id,
          accountId: bank.id,
          date: today,
          description: `Mutasi balapan ${input.tag} ${i} ${suffix}`,
          debit: input.amount,
          credit: "0",
          fingerprint: `balapan-${input.tag}-${i}-${suffix}-${crypto.randomUUID()}`,
          createdBy: USER_ID,
        })
        .returning({ id: bankStatementLines.id });
      statementLineIds.push(line.id);
    }
    return { journalLineIds, statementLineIds };
  });
}

describe("T4R-4 penautan konkuren tidak bisa mengklaim dua kali", () => {
  it("dua matchLine atas baris jurnal yang sama dari dua mutasi berbeda: tepat satu berhasil", async () => {
    await ensureRaceCompany();
    const amount = String(8_800_000 + Math.floor(Math.random() * 90_000));
    const fixture = await raceFixture({ journalCount: 1, statementCount: 2, amount, tag: "A" });

    const attempt = (statementLineId: string) =>
      orgTx(RACE_ORG, (tx) =>
        matchLine(tx, {
          companyId: RACE_ORG,
          statementLineId,
          journalLineId: fixture.journalLineIds[0],
        }),
      );
    const results = await Promise.allSettled([
      attempt(fixture.statementLineIds[0]),
      attempt(fixture.statementLineIds[1]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const matched = await orgTx(RACE_ORG, (tx) =>
      tx
        .select({ id: bankStatementLines.id })
        .from(bankStatementLines)
        .where(
          and(
            eq(bankStatementLines.companyId, RACE_ORG),
            eq(bankStatementLines.matchedJournalLineId, fixture.journalLineIds[0]),
          ),
        ),
    );
    expect(matched).toHaveLength(1);
  });

  it("dua matchLine atas mutasi yang sama untuk dua jurnal berbeda: tepat satu berhasil", async () => {
    await ensureRaceCompany();
    const amount = String(9_900_000 + Math.floor(Math.random() * 90_000));
    const fixture = await raceFixture({ journalCount: 2, statementCount: 1, amount, tag: "B" });

    const attempt = (journalLineId: string) =>
      orgTx(RACE_ORG, (tx) =>
        matchLine(tx, {
          companyId: RACE_ORG,
          statementLineId: fixture.statementLineIds[0],
          journalLineId,
        }),
      );
    const results = await Promise.allSettled([
      attempt(fixture.journalLineIds[0]),
      attempt(fixture.journalLineIds[1]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const [statement] = await orgTx(RACE_ORG, (tx) =>
      tx
        .select({ matchedJournalLineId: bankStatementLines.matchedJournalLineId })
        .from(bankStatementLines)
        .where(eq(bankStatementLines.id, fixture.statementLineIds[0])),
    );
    expect(fixture.journalLineIds).toContain(statement.matchedJournalLineId);
  });
});

/* ------------------------------------------------------------------ */
/* T4R-5 — impor antar-job anti-duplikat                               */
/* ------------------------------------------------------------------ */

type JobRow = typeof importJobs.$inferSelect;

async function makeMasterJob(
  tx: Tx,
  entity: "opening_payables" | "opening_stock",
  rows: Record<string, string>[],
  mapping: Partial<Record<string, string>>,
): Promise<JobRow> {
  const [job] = await tx
    .insert(importJobs)
    .values({
      companyId: ORG_ID,
      entity,
      fileName: `uji-t4r5-${entity}-${suffix}.csv`,
      status: "preview",
      totalRows: rows.length,
      mapping,
      createdBy: USER_ID,
    })
    .returning();
  await tx.insert(importRows).values(
    rows.map((data, index) => ({
      companyId: ORG_ID,
      jobId: job.id,
      rowNumber: index + 1,
      data,
      status: "pending",
    })),
  );
  return job;
}

async function reloadJob(tx: Tx, jobId: string): Promise<JobRow> {
  const [job] = await tx
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, ORG_ID), eq(importJobs.id, jobId)))
    .limit(1);
  return job;
}

async function storedRows(tx: Tx, jobId: string) {
  return tx
    .select({ rowNumber: importRows.rowNumber, status: importRows.status, error: importRows.error })
    .from(importRows)
    .where(eq(importRows.jobId, jobId))
    .orderBy(asc(importRows.rowNumber));
}

describe("T4R-5 impor ulang antar-job ditandai duplikat", () => {
  it("saldo awal utang: job kedua 0 terimpor; dokumen yang di-void tidak lagi menghalangi", async () => {
    await rollbackTransaction(async (tx) => {
      const supplierName = `Pemasok T4R5 ${suffix}`;
      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId: ORG_ID, code: `SUP-T4R5-${suffix}`, name: supplierName })
        .returning({ id: suppliers.id });

      const headers = ["Nama Pemasok", "Tanggal", "Jatuh Tempo", "Jumlah", "Referensi"];
      const mapping = suggestMappingFor(ENTITY_FIELDS.opening_payables, headers);
      const rows: Record<string, string>[] = [
        {
          "Nama Pemasok": supplierName,
          Tanggal: today,
          "Jatuh Tempo": "",
          Jumlah: "150000",
          Referensi: `REF-T4R5-${suffix}`,
        },
        {
          "Nama Pemasok": supplierName,
          Tanggal: today,
          "Jatuh Tempo": "",
          Jumlah: "275000",
          Referensi: "",
        },
      ];

      const job1 = await makeMasterJob(tx, "opening_payables", rows, mapping);
      await analyzeMasterImport(tx, { companyId: ORG_ID, job: job1, mapping });
      const commit1 = await commitOpeningBalancesImport(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        job: await reloadJob(tx, job1.id),
        mapping,
        limit: 200,
      });
      expect(commit1.imported).toBe(2);
      expect(commit1.failed).toBe(0);

      // Job kedua dengan berkas yang sama persis.
      const job2 = await makeMasterJob(tx, "opening_payables", rows, mapping);
      const analysis2 = await analyzeMasterImport(tx, { companyId: ORG_ID, job: job2, mapping });
      expect(analysis2.summary.existingCount).toBe(2);
      expect(analysis2.preview).toHaveLength(2);
      expect(
        analysis2.preview.every(
          (item) => item.action === "skip" && (item.issue ?? "").includes("Duplikat"),
        ),
      ).toBe(true);

      const commit2 = await commitOpeningBalancesImport(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        job: await reloadJob(tx, job2.id),
        mapping,
        limit: 200,
      });
      expect(commit2.imported).toBe(0);
      expect(commit2.skipped).toBe(2);
      const stored2 = await storedRows(tx, job2.id);
      expect(stored2.every((row) => row.status === "skipped")).toBe(true);

      const docs = await tx
        .select()
        .from(partyOpeningBalances)
        .where(and(eq(partyOpeningBalances.companyId, ORG_ID), eq(partyOpeningBalances.partyId, supplier.id)));
      expect(docs).toHaveLength(2);

      // Dokumen yang sudah di-void tidak menghalangi impor ulang barisnya.
      const refDoc = docs.find((doc) => doc.reference === `REF-T4R5-${suffix}`);
      expect(refDoc).toBeTruthy();
      await voidOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: refDoc!.id,
        reason: "Uji T4R-5",
        date: today,
      });
      const job3 = await makeMasterJob(tx, "opening_payables", [rows[0]], mapping);
      const analysis3 = await analyzeMasterImport(tx, { companyId: ORG_ID, job: job3, mapping });
      expect(analysis3.summary.existingCount).toBe(0);
      const commit3 = await commitOpeningBalancesImport(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        job: await reloadJob(tx, job3.id),
        mapping,
        limit: 200,
      });
      expect(commit3.imported).toBe(1);
    });
  });

  it("stok awal: job kedua dilewati; penerimaan opening manual dari UI tidak menghalangi impor pertama", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      const [productA] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `T4R5-A-${suffix}`,
          name: `Produk A T4R5 ${suffix}`,
          costPrice: "2000",
          salePrice: "3000",
        })
        .returning({ id: products.id });
      const [productB] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `T4R5-B-${suffix}`,
          name: `Produk B T4R5 ${suffix}`,
          costPrice: "1000",
          salePrice: "1500",
        })
        .returning({ id: products.id });

      // Penerimaan opening MANUAL (jalur UI) untuk produk B lebih dulu —
      // bukan hasil impor, jadi tidak boleh menandai B sebagai duplikat.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        source: "opening",
        date: today,
        notes: "Stok awal manual uji T4R-5",
        lines: [{ productId: productB.id, qty: 5, unitCost: 1000 }],
      });

      const headers = ["SKU", "Nama Produk", "Qty", "Biaya Satuan"];
      const mapping = suggestMappingFor(ENTITY_FIELDS.opening_stock, headers);
      const rows: Record<string, string>[] = [
        { SKU: `T4R5-A-${suffix}`, "Nama Produk": "", Qty: "10", "Biaya Satuan": "2000" },
        { SKU: `T4R5-B-${suffix}`, "Nama Produk": "", Qty: "7", "Biaya Satuan": "1000" },
      ];

      const job1 = await makeMasterJob(tx, "opening_stock", rows, mapping);
      const analysis1 = await analyzeMasterImport(tx, { companyId: ORG_ID, job: job1, mapping });
      expect(analysis1.summary.existingCount).toBe(0);
      const commit1 = await commitOpeningStockImport(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        job: await reloadJob(tx, job1.id),
        mapping,
        warehouseId: warehouse.id,
      });
      expect(commit1.imported).toBe(2);

      const qtyOf = async (productId: string) => {
        const [row] = await tx
          .select({ qty: stockOnHand.qty })
          .from(stockOnHand)
          .where(
            and(
              eq(stockOnHand.companyId, ORG_ID),
              eq(stockOnHand.warehouseId, warehouse.id),
              eq(stockOnHand.productId, productId),
            ),
          )
          .limit(1);
        return row ? d(row.qty).toFixed(4) : "0.0000";
      };
      expect(await qtyOf(productA.id)).toBe("10.0000");
      expect(await qtyOf(productB.id)).toBe("12.0000"); // 5 manual + 7 impor

      // Job kedua, berkas sama: semua baris duplikat, stok tidak bertambah.
      const job2 = await makeMasterJob(tx, "opening_stock", rows, mapping);
      const analysis2 = await analyzeMasterImport(tx, { companyId: ORG_ID, job: job2, mapping });
      expect(analysis2.summary.existingCount).toBe(2);
      expect(analysis2.preview).toHaveLength(2);
      expect(
        analysis2.preview.every(
          (item) => item.action === "skip" && (item.issue ?? "").includes("Duplikat"),
        ),
      ).toBe(true);

      const commit2 = await commitOpeningStockImport(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        job: await reloadJob(tx, job2.id),
        mapping,
        warehouseId: warehouse.id,
      });
      expect(commit2.imported).toBe(0);
      expect(commit2.skipped).toBe(2);
      expect(commit2.receiptNumber ?? null).toBeNull();
      expect(await qtyOf(productA.id)).toBe("10.0000");
      expect(await qtyOf(productB.id)).toBe("12.0000");

      // Penerimaan yang memuat produk A hanya dokumen impor job pertama;
      // produk B termuat di penerimaan manual + dokumen impor job pertama.
      // Job kedua tidak menambah dokumen apa pun.
      const receiptsOf = async (productId: string) => {
        const lines = await tx
          .select({ receiptId: stockReceiptLines.receiptId })
          .from(stockReceiptLines)
          .where(
            and(eq(stockReceiptLines.companyId, ORG_ID), eq(stockReceiptLines.productId, productId)),
          );
        return new Set(lines.map((line) => line.receiptId)).size;
      };
      expect(await receiptsOf(productA.id)).toBe(1);
      expect(await receiptsOf(productB.id)).toBe(2);
    });
  });
});
