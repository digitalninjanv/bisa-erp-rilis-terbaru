import { afterAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  customers,
  importJobs,
  importRows,
  journalEntries,
  journalLines,
  partyOpeningBalances,
  partyPayments,
  suppliers,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { getAccountMap } from "@/server/accounting";
import {
  createOpeningBalance,
  payOpeningBalance,
  voidOpeningBalance,
  voidOpeningPayment,
} from "@/server/opening-balances";
import { listPayables, listReceivables } from "@/server/reports";
import {
  ENTITY_FIELDS,
  IMPORT_SAMPLES,
  suggestMappingFor,
  type ImportEntity,
} from "@/lib/import-parse";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Sesi & cache Next diganti agar kode action impor asli berjalan
// terhadap database dev asli (pola import-expansion.test.ts).
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const mod = {
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  };
  return { ...mod, requirePermissionInModule: mod.requirePermission };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

function daysAgo(days: number): string {
  const date = new Date(`${todayISO()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function makeSupplier(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], name: string) {
  const [row] = await tx
    .insert(suppliers)
    .values({ companyId: ORG_ID, code: `SUP-OPB-${suffix}-${name.length}`, name })
    .returning({ id: suppliers.id });
  return row;
}

async function makeCustomer(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], name: string) {
  const [row] = await tx
    .insert(customers)
    .values({ companyId: ORG_ID, code: `CST-OPB-${suffix}-${name.length}`, name })
    .returning({ id: customers.id });
  return row;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function journalLinesOf(tx: Tx, entryId: string) {
  return tx
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .where(eq(journalLines.entryId, entryId))
    .orderBy(asc(journalLines.lineNo));
}

describe("T4-5b — dokumen saldo awal hutang/piutang (D-14)", () => {
  it("AP: buat → jurnal bertag pihak → tampil di daftar utang → bayar sebagian → lunas → hilang dari daftar", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx, `Pemasok Saldo Awal ${suffix}`);
      const map = await getAccountMap(tx, ORG_ID);
      // Periode seed yang terbuka hanya Nov–Des 2026 — tanggal dokumen
      // harus di bulan berjalan agar jurnal pembuka boleh diposting.
      const docDate = daysAgo(3);
      const dueDate = daysAgo(1);

      const doc = await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: docDate,
        dueDate,
        amount: "1000000",
        reference: `INV-LAMA-${suffix}`,
      });
      expect(doc.number).toMatch(/^OPB-\d{4}-/);
      expect(doc.status).toBe("open");

      // Jurnal pembuka: Dr ekuitas / Cr utang bertag pemasok.
      const lines = await journalLinesOf(tx, doc.journalId!);
      expect(lines).toHaveLength(2);
      const debitLine = lines.find((line) => d(line.debit).gt(0))!;
      const creditLine = lines.find((line) => d(line.credit).gt(0))!;
      expect(debitLine.accountId).toBe(map.equity);
      expect(d(debitLine.debit).toFixed(2)).toBe("1000000.00");
      expect(creditLine.accountId).toBe(map.payable);
      expect(creditLine.partyType).toBe("supplier");
      expect(creditLine.partyId).toBe(supplier.id);

      // Tampil di daftar utang sebagai baris saldo awal.
      const listed = (await listPayables(tx, ORG_ID)).find((row) => row.id === doc.id);
      expect(listed).toBeDefined();
      expect(listed!.source).toBe("opening");
      expect(listed!.outstanding).toBe(1000000);
      expect(listed!.date).toBe(docDate);
      expect(listed!.dueDate).toBe(dueDate);

      // Bayar sebagian lewat akun kas pemetaan.
      const first = await payOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: doc.id,
        date: todayISO(),
        amount: "400000",
        accountId: map.cash,
      });
      expect(first.doc.paidAmount).toBe("400000.0000");
      expect(first.doc.status).toBe("open");

      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(eq(partyPayments.id, first.paymentId));
      expect(payment.openingId).toBe(doc.id);
      expect(payment.saleId).toBeNull();
      expect(payment.receiptId).toBeNull();
      expect(payment.type).toBe("payable");
      expect(payment.partyId).toBe(supplier.id);

      const payLines = await journalLinesOf(tx, first.journalId);
      const payDebit = payLines.find((line) => d(line.debit).gt(0))!;
      const payCredit = payLines.find((line) => d(line.credit).gt(0))!;
      expect(payDebit.accountId).toBe(map.payable);
      expect(payDebit.partyType).toBe("supplier");
      expect(payDebit.partyId).toBe(supplier.id);
      expect(payCredit.accountId).toBe(map.cash);
      expect(d(payDebit.debit).toFixed(2)).toBe("400000.00");

      const afterPartial = (await listPayables(tx, ORG_ID)).find((row) => row.id === doc.id);
      expect(afterPartial!.outstanding).toBe(600000);
      expect(afterPartial!.paymentStatus).toBe("partial");

      // Bayar lunas → settled dan hilang dari daftar terbuka.
      const second = await payOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: doc.id,
        date: todayISO(),
        amount: "600000",
        accountId: map.cash,
      });
      expect(second.doc.status).toBe("settled");
      const afterSettled = (await listPayables(tx, ORG_ID)).find((row) => row.id === doc.id);
      expect(afterSettled).toBeUndefined();

      return { number: doc.number };
    });
    expect(outcome.number).toMatch(/^OPB-/);
  });

  it("AR: simetris — jurnal Dr piutang bertag / Cr ekuitas, tampil di daftar piutang, void pembayaran mengembalikan sisa", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, `Pelanggan Saldo Awal ${suffix}`);
      const map = await getAccountMap(tx, ORG_ID);

      const doc = await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "receivable",
        partyId: customer.id,
        date: daysAgo(2),
        dueDate: daysAgo(1),
        amount: "500000",
      });
      expect(doc.number).toMatch(/^OPR-\d{4}-/);

      const lines = await journalLinesOf(tx, doc.journalId!);
      const debitLine = lines.find((line) => d(line.debit).gt(0))!;
      const creditLine = lines.find((line) => d(line.credit).gt(0))!;
      expect(debitLine.accountId).toBe(map.receivable);
      expect(debitLine.partyType).toBe("customer");
      expect(debitLine.partyId).toBe(customer.id);
      expect(creditLine.accountId).toBe(map.equity);

      const listed = (await listReceivables(tx, ORG_ID)).find((row) => row.id === doc.id);
      expect(listed).toBeDefined();
      expect(listed!.source).toBe("opening");
      expect(listed!.outstanding).toBe(500000);

      const paid = await payOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: doc.id,
        date: todayISO(),
        amount: "200000",
        accountId: map.bank,
      });
      expect(paid.doc.paidAmount).toBe("200000.0000");
      const payLines = await journalLinesOf(tx, paid.journalId);
      expect(payLines.find((line) => d(line.debit).gt(0))!.accountId).toBe(map.bank);
      const payCredit = payLines.find((line) => d(line.credit).gt(0))!;
      expect(payCredit.accountId).toBe(map.receivable);
      expect(payCredit.partyId).toBe(customer.id);

      // Void pembayaran: jurnal dibalik, terbayar mundur ke nol.
      await voidOpeningPayment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        paymentId: paid.paymentId,
        reason: "Salah nominal uji",
        date: todayISO(),
      });
      const [afterVoid] = await tx
        .select()
        .from(partyOpeningBalances)
        .where(eq(partyOpeningBalances.id, doc.id));
      expect(afterVoid.paidAmount).toBe("0.0000");
      expect(afterVoid.status).toBe("open");
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(eq(partyPayments.id, paid.paymentId));
      expect(payment.status).toBe("void");
      const [reversal] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.reversalOfId, paid.journalId));
      expect(reversal).toBeDefined();
    });
  });

  it("void dokumen: yang sudah terbayar ditolak; yang belum terbayar berhasil dan jurnalnya terbalik", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx, `Pemasok Void Saldo ${suffix}`);
      const map = await getAccountMap(tx, ORG_ID);

      const paid = await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: todayISO(),
        amount: "100000",
      });
      await payOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: paid.id,
        date: todayISO(),
        amount: "10000",
        accountId: map.cash,
      });
      await expect(
        voidOpeningBalance(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          openingId: paid.id,
          reason: "Tidak seharusnya bisa",
          date: todayISO(),
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/VALIDATION|INVALID_STATE/) });

      const fresh = await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: todayISO(),
        amount: "75000",
      });
      const voided = await voidOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: fresh.id,
        reason: "Salah input uji",
        date: todayISO(),
      });
      expect(voided.status).toBe("void");
      const [reversal] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.reversalOfId, fresh.journalId!));
      expect(reversal).toBeDefined();
      const listed = (await listPayables(tx, ORG_ID)).find((row) => row.id === fresh.id);
      expect(listed).toBeUndefined();
    });
  });

  it("validasi: jenis/pihak tak cocok, nominal nol, dan akun sembarang ditolak; bayar melebihi sisa menjadi kredit pihak (R3-02)", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx, `Pemasok Validasi ${suffix}`);
      const customer = await makeCustomer(tx, `Pelanggan Validasi ${suffix}`);
      const map = await getAccountMap(tx, ORG_ID);
      const [revenue] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "400001")))
        .limit(1);

      await expect(
        createOpeningBalance(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          kind: "payable",
          partyId: customer.id,
          date: todayISO(),
          amount: "1000",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      await expect(
        createOpeningBalance(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          kind: "payable",
          partyId: supplier.id,
          date: todayISO(),
          amount: "0",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const doc = await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: todayISO(),
        amount: "50000",
      });
      // Akun pendapatan bukan akun pembayaran yang sah (pola POS-PAY-01).
      await expect(
        payOpeningBalance(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          openingId: doc.id,
          date: todayISO(),
          amount: "1000",
          accountId: revenue.id,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      // A-21 (R3-02): bayar 60000 atas saldo awal 50000 TIDAK lagi
      // ditolak — 50000 melunasi dokumen, 10000 menjadi kredit
      // pemasok. Terbukti dari hasil domain & status dokumen.
      const overpaid = await payOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: doc.id,
        date: todayISO(),
        amount: "60000",
        accountId: map.cash,
      });
      expect(overpaid.creditNumber).toBeTruthy();
      expect(d(overpaid.creditAmount ?? "0").eq(10000)).toBe(true);
      expect(d(overpaid.doc.paidAmount).eq(50000)).toBe(true);
      expect(overpaid.doc.status).toBe("settled");
    });
  });

  it("contoh CSV saldo awal ter-parse bersih lewat rantai impor", () => {
    for (const entity of ["opening_payables", "opening_receivables"] as ImportEntity[]) {
      const sample = IMPORT_SAMPLES[entity];
      const [headerLine, ...lines] = sample.csv.split("\n");
      const headers = headerLine.split(",").map((h) => h.trim());
      const mapping = suggestMappingFor(ENTITY_FIELDS[entity], headers);
      expect(mapping.party).toBeTruthy();
      expect(mapping.amount).toBeTruthy();
      expect(lines.length).toBeGreaterThan(0);
    }
  });
});

describe("T4-5b — impor saldo awal hutang", () => {
  const supplierName = `PT Saldo Impor ${suffix}`;
  const supplierCode = `SUP-IMP-${suffix}`;
  let supplierId = "";
  let jobId = "";
  const createdOpeningIds: string[] = [];

  afterAll(async () => {
    await withCompany(ORG_ID, async (tx) => {
      for (const id of createdOpeningIds) {
        await tx
          .update(partyOpeningBalances)
          .set({ journalId: null })
          .where(eq(partyOpeningBalances.id, id));
      }
      if (createdOpeningIds.length) {
        await tx.delete(partyPayments).where(eq(partyPayments.openingId, createdOpeningIds[0]));
        for (const id of createdOpeningIds) {
          await tx.delete(partyOpeningBalances).where(eq(partyOpeningBalances.id, id));
        }
      }
      if (jobId) {
        await tx.delete(importRows).where(eq(importRows.jobId, jobId));
        await tx.delete(importJobs).where(eq(importJobs.id, jobId));
      }
      if (supplierId) {
        await tx.delete(suppliers).where(eq(suppliers.id, supplierId));
      }
    });
  });

  it("dua baris: satu pihak dikenal menjadi dokumen saldo awal, satu pihak tak dikenal menjadi error baris", async () => {
    supplierId = await withCompany(ORG_ID, async (tx) => {
      const [row] = await tx
        .insert(suppliers)
        .values({ companyId: ORG_ID, code: supplierCode, name: supplierName })
        .returning({ id: suppliers.id });
      return row.id;
    });

    const headers = ["Nama Pemasok", "Tanggal", "Jatuh Tempo", "Jumlah", "Referensi"];
    const mapping = suggestMappingFor(ENTITY_FIELDS.opening_payables, headers);
    const rows: Record<string, string>[] = [
      {
        "Nama Pemasok": supplierName,
        Tanggal: daysAgo(3),
        "Jatuh Tempo": daysAgo(1),
        Jumlah: "250000",
        Referensi: `FAKTUR-LAMA-${suffix}`,
      },
      {
        "Nama Pemasok": `PT Tidak Dikenal ${suffix}`,
        Tanggal: daysAgo(3),
        "Jatuh Tempo": "",
        Jumlah: "99000",
        Referensi: "",
      },
    ];

    jobId = await withCompany(ORG_ID, async (tx) => {
      const [job] = await tx
        .insert(importJobs)
        .values({
          companyId: ORG_ID,
          entity: "opening_payables",
          fileName: `uji-saldo-awal-${suffix}.csv`,
          status: "preview",
          totalRows: rows.length,
          mapping,
          createdBy: USER_ID,
        })
        .returning({ id: importJobs.id });
      await tx.insert(importRows).values(
        rows.map((data, index) => ({
          companyId: ORG_ID,
          jobId: job.id,
          rowNumber: index + 1,
          data,
          status: "pending",
        })),
      );
      return job.id;
    });

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);

    let last: { done: boolean; imported: number; failed: number } = { done: false, imported: 0, failed: 0 };
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await commitImportBatchAction({ jobId, mapping, limit: 200 });
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      last = result.data;
      if (result.data.done || result.data.processed === 0) break;
    }
    expect(last.imported).toBe(1);
    expect(last.failed).toBe(1);

    const stored = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ rowNumber: importRows.rowNumber, status: importRows.status, error: importRows.error, entityId: importRows.entityId })
        .from(importRows)
        .where(eq(importRows.jobId, jobId))
        .orderBy(asc(importRows.rowNumber)),
    );
    expect(stored[0].status).toBe("imported");
    expect(stored[1].status).toBe("error");
    expect(stored[1].error).toMatch(/tidak ditemukan/);
    if (stored[0].entityId) createdOpeningIds.push(stored[0].entityId);

    const docs = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select()
        .from(partyOpeningBalances)
        .where(and(eq(partyOpeningBalances.companyId, ORG_ID), eq(partyOpeningBalances.partyId, supplierId))),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("payable");
    expect(docs[0].amount).toBe("250000.0000");
    expect(docs[0].reference).toBe(`FAKTUR-LAMA-${suffix}`);
    expect(docs[0].journalId).toBeTruthy();
  });
});
