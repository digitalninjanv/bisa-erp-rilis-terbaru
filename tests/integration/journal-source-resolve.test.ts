import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, customers, journalEntries, journalLines, suppliers } from "@/db/schema";
import {
  getJournalDetail,
  resolveJournalSourceHref,
  resolveJournalSourceNumber,
} from "@/server/reports/journal";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * Menutup cabang resolver sumber jurnal: setiap tipe sumber, sufiks
 * `_reversal`, sumber tanpa dokumen, dan rantai `payment` yang ambigu.
 * Tidak perlu dokumen nyata — yang diuji adalah pemetaan tipe → tabel →
 * URL, bukan isi dokumen.
 */
const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const rollback = makeRollbackTransaction(ORG);

const NUMBER_TYPES = [
  "sale",
  "sale_return",
  "purchase",
  "receipt_opening",
  "receipt_bonus",
  "receipt_customer_return",
  "receipt_other",
  "purchase_return",
  "adjustment",
  "opname",
  "expense",
  "bank_transfer",
  "purchase_advance",
  "payroll",
  "payroll_payment",
  "opening_balance",
  "payment",
  "manual",
  "cash_session",
  "sale_reversal",
];

describe("resolver sumber jurnal — nomor dokumen", () => {
  it("setiap tipe sumber dipetakan ke tabelnya; id asing menghasilkan null", async () => {
    const missing = crypto.randomUUID();
    const results = await rollback(async (tx) => {
      const output: Record<string, string | null> = {};
      for (const type of NUMBER_TYPES) {
        output[type] = await resolveJournalSourceNumber(tx, ORG, type, missing);
      }
      output["sale_reversal_missing"] = await resolveJournalSourceNumber(
        tx,
        ORG,
        "sale_reversal",
        missing,
      );
      output["without_source"] = await resolveJournalSourceNumber(tx, ORG, "sale", null);
      return output;
    });
    for (const type of NUMBER_TYPES) {
      expect(results[type], type).toBeNull();
    }
    expect(results["without_source"]).toBeNull();
  });

  it("mengembalikan nomor dokumen nyata untuk sumber yang ada", async () => {
    const number = await rollback(async (tx) => {
      const [entry] = await tx
        .select({ id: journalEntries.id, number: journalEntries.number })
        .from(journalEntries)
        .where(eq(journalEntries.companyId, ORG))
        .limit(1);
      if (!entry) return null;
      return resolveJournalSourceNumber(tx, ORG, "manual", entry.id);
    });
    expect(number).toBeNull();
  });
});

describe("resolver sumber jurnal — tautan halaman", () => {
  it("memetakan tipe berhalaman dan menolak tipe tanpa rute", async () => {
    const id = crypto.randomUUID();
    const hrefs = await rollback(async (tx) => {
      const output: Record<string, string | null> = {};
      const types = [
        "sale",
        "purchase",
        "receipt_opening",
        "receipt_bonus",
        "receipt_customer_return",
        "receipt_other",
        "supplier_return",
        "supplier_return_refund",
        "supplier_return_credit_apply",
        "supplier_return_replacement",
        "payroll",
        "payroll_payment",
        "cash_session",
        "purchase_advance",
        "opening_balance",
        "employee_advance",
        "employee_advance_repayment",
        "employee_loan",
        "employee_loan_repayment",
        "payment",
        "sale_reversal",
        "manual",
      ];
      for (const type of types) {
        output[type] = await resolveJournalSourceHref(tx, ORG, type, id);
      }
      output["opening_without_source"] = await resolveJournalSourceHref(
        tx,
        ORG,
        "opening_balance",
        null,
      );
      output["sale_without_source"] = await resolveJournalSourceHref(tx, ORG, "sale", null);
      return output;
    });
    expect(hrefs.sale).toBe(`/app/pos/nota/${id}`);
    expect(hrefs.purchase).toBe(`/app/gudang/penerimaan/${id}/cetak`);
    expect(hrefs.supplier_return).toBe(`/app/gudang/retur-pembelian/${id}`);
    expect(hrefs.payroll).toBe(`/app/akuntansi/payroll/${id}`);
    expect(hrefs.cash_session).toBe(`/app/pos/sesi/riwayat/${id}`);
    expect(hrefs.purchase_advance).toBe("/app/gudang/uang-muka");
    expect(hrefs.opening_balance).toBe("/app/akuntansi/piutang-utang");
    expect(hrefs.employee_advance).toBeNull();
    expect(hrefs.employee_loan).toBeNull();
    expect(hrefs.payment).toBe("/app/akuntansi/piutang-utang");
    expect(hrefs.sale_reversal).toBe(`/app/pos/nota/${id}`);
    expect(hrefs.manual).toBeNull();
    expect(hrefs.opening_without_source).toBe("/app/akuntansi/piutang-utang");
    expect(hrefs.sale_without_source).toBeNull();
  });
});

describe("getJournalDetail — pihak, pembalik, dan jurnal asal", () => {
  it("mengisi nama pihak, menautkan pembalik, dan mengembalikan asal", async () => {
    const result = await rollback(async (tx) => {
      const [debit] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.companyId, ORG))
        .limit(1);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [customer] = await tx
        .insert(customers)
        .values({ companyId: ORG, code: `CUST-DET-${suffix}`, name: `Pelanggan Detail ${suffix}` })
        .returning({ id: customers.id, name: customers.name });
      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId: ORG, code: `SUP-DET-${suffix}`, name: `Pemasok Detail ${suffix}` })
        .returning({ id: suppliers.id, name: suppliers.name });
      const [original] = await tx
        .insert(journalEntries)
        .values({
          companyId: ORG,
          number: `JU-DET-${suffix}`,
          date: "2026-11-01",
          description: "Jurnal asal",
          sourceType: "manual",
          status: "posted",
          createdBy: USER,
        })
        .returning({ id: journalEntries.id });
      const [reversal] = await tx
        .insert(journalEntries)
        .values({
          companyId: ORG,
          number: `JU-DET-R-${suffix}`,
          date: "2026-11-02",
          description: "Pembalik",
          sourceType: "manual",
          status: "posted",
          reversalOfId: original.id,
          createdBy: USER,
        })
        .returning({ id: journalEntries.id });
      await tx.insert(journalLines).values([
        {
          companyId: ORG,
          entryId: original.id,
          accountId: debit.id,
          debit: "1000",
          credit: "0",
          partyType: "customer",
          partyId: customer.id,
          lineNo: 0,
        },
        {
          companyId: ORG,
          entryId: original.id,
          accountId: debit.id,
          debit: "0",
          credit: "1000",
          partyType: "supplier",
          partyId: supplier.id,
          lineNo: 1,
        },
        {
          companyId: ORG,
          entryId: reversal.id,
          accountId: debit.id,
          debit: "1000",
          credit: "0",
          lineNo: 0,
        },
      ]);
      const detail = await getJournalDetail(tx, ORG, reversal.id);
      const detailOriginal = await getJournalDetail(tx, ORG, original.id);
      const missing = await getJournalDetail(tx, ORG, crypto.randomUUID());
      return {
        detail,
        detailOriginal,
        missing,
        customerName: customer.name,
        supplierName: supplier.name,
        reversalId: reversal.id,
      };
    });
    expect(result.missing).toBeNull();
    expect(result.detail?.original?.id).toBeTruthy();
    expect(result.detail?.reversal).toBeNull();
    expect(result.detailOriginal?.reversal?.id).toBe(result.reversalId);
    expect(result.detailOriginal?.original).toBeNull();
    const names = result.detailOriginal?.lines.map((line) => line.partyName) ?? [];
    expect(names).toContain(result.customerName);
    expect(names).toContain(result.supplierName);
    expect(result.detailOriginal?.source).toMatchObject({ number: null, href: null });
  });
});
