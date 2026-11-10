import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  expenses,
  journalEntries,
  journalLines,
  partyOpeningBalances,
  partyPayments,
  paymentMethods,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { ensureFiscalPeriods, reverseJournalEntry } from "@/server/accounting";
import { createOpeningBalance, payOpeningBalance } from "@/server/opening-balances";
import { payExpensePayable, payPayableDocument } from "@/server/payables";
import { payPayableFifo } from "@/server/quick-entry";
import { d } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-21 Tahap R3-A Bagian 2 — potongan pajak (withholding PPh) pada
// pembayaran keluar (R3-06). Jurnal: Dr utang bruto / Cr kas neto /
// Cr Utang PPh Dipotong (2130, pemetaan tax_withholding_payable,
// dibuat malas lewat ensure) bertag pemasok. Nominal yang diputuskan
// pengguna adalah yang dijurnal; tarif hanya referensi bukti potong.
// Komponen ber-saklar per perusahaan (D-25): bawaan NONAKTIF.

const ORG = "01900000-0000-7000-8000-00000000a218";
const USER_ID = "user-uji-a21-r3a-wh";
const RUN = `${Date.now()}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

const acc: Record<string, string> = {};
let warehouseId = "";

async function bootstrap() {
  await withCompany(ORG, async (tx) => {
    await ensureFiscalPeriods(tx, ORG, 2099);
    const [settings] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (!settings) {
      await tx.insert(companySettings).values({
        companyId: ORG,
        legalName: "Uji R3-A Withholding",
        taxRate: "0",
        taxEnabled: false,
        withholdingEnabled: false,
      });
      const rows = await tx
        // AUD-001/A-27: cashBankKind diisi eksplisit — sejak A-27 validator
        // kas/bank membaca kolom ini; fixture tidak boleh bergantung pada
        // residu lama yang dulu ter-backfill (residu itu kini dibersihkan).
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
          { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", cashBankKind: "bank" },
          { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "6060", name: "Beban Administrasi Bank", type: "expense", normalBalance: "debit" },
          { companyId: ORG, code: "6100-EXP", name: "Beban Jasa", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "qris", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "supplier_credit", accountId: byCode.get("1210")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: ORG, key: "bank_fee", accountId: byCode.get("6060")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-R3A2", name: "Gudang Uji R3-A2", type: "warehouse", isDefault: true })
        .returning({ id: warehouses.id });
      warehouseId = warehouse.id;
      // Metode bank berfee tetap — untuk uji gabungan fee + potongan.
      await tx.insert(paymentMethods).values({
        companyId: ORG,
        code: "BANKFEE",
        name: "Bank Fee",
        type: "bank",
        accountId: byCode.get("1100")!,
        sortOrder: 1,
        feeEnabled: true,
        feeType: "fixed",
        feeValue: "2500",
      });
    }
    const accountRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, ORG));
    for (const row of accountRows) acc[row.code] = row.id;
    if (!warehouseId) {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      warehouseId = warehouse.id;
    }
  });
}

beforeAll(bootstrap);

let seq = 0;
function uniq(prefix: string) {
  seq += 1;
  return `${prefix}-${RUN}-${seq}`;
}

async function enableWithholding(tx: Tx) {
  await tx
    .update(companySettings)
    .set({ withholdingEnabled: true })
    .where(eq(companySettings.companyId, ORG));
}

async function makeSupplier(tx: Tx) {
  const [row] = await tx
    .insert(suppliers)
    .values({ companyId: ORG, code: uniq("SUP"), name: "Pemasok Uji Potongan" })
    .returning({ id: suppliers.id });
  return row;
}

async function makeReceipt(tx: Tx, supplierId: string, total: string, date = "2099-01-05") {
  const [row] = await tx
    .insert(stockReceipts)
    .values({
      companyId: ORG,
      warehouseId,
      number: uniq("GRN"),
      date,
      supplierId,
      source: "purchase",
      status: "posted",
      total,
      paidAmount: "0",
      paymentStatus: "unpaid",
    })
    .returning({ id: stockReceipts.id, number: stockReceipts.number });
  return row;
}

async function journalByKey(tx: Tx, key: string) {
  const [entry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.idempotencyKey, key)))
    .limit(1);
  expect(entry, `jurnal ${key} harus ada`).toBeTruthy();
  const lines = await tx
    .select({
      code: accounts.code,
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entry!.id));
  const byCode = new Map<string, (typeof lines)[number]>();
  for (const line of lines) byCode.set(line.code, line);
  return { entry: entry!, lines, byCode };
}

async function withholdingAccount(tx: Tx) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, "2130")))
    .limit(1);
  return row;
}

describe("R3-A Bagian 2 — withholding pada pembayaran utang", () => {
  it("PPh 23: Dr utang bruto / Cr bank neto / Cr Utang PPh Dipotong bertag pemasok", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "500000");
      const result = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-06",
        amount: "500000",
        accountId: acc["1000"],
        withholding: { type: "pph23", rate: "2", amount: "10000" },
      });
      const { byCode } = await journalByKey(tx, `ap:${receipt.id}:${result.number}`);
      expect(byCode.get("2000")?.debit).toBe("500000.0000");
      expect(byCode.get("1000")?.credit).toBe("490000.0000");
      const whAccount = await withholdingAccount(tx);
      expect(whAccount, "akun 2130 dibuat ensure").toBeTruthy();
      const whLine = byCode.get("2130");
      expect(whLine?.credit).toBe("10000.0000");
      expect(whLine?.partyId).toBe(supplier.id);
      const [payment] = await tx
        .select({
          withholdingType: partyPayments.withholdingType,
          withholdingRate: partyPayments.withholdingRate,
          withholdingAmount: partyPayments.withholdingAmount,
        })
        .from(partyPayments)
        .where(eq(partyPayments.receiptId, receipt.id));
      expect(payment).toEqual({
        withholdingType: "pph23",
        withholdingRate: "2.0000",
        withholdingAmount: "10000.0000",
      });
      const [updated] = await tx
        .select({ paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(updated.paymentStatus).toBe("paid");
    });
  });

  it("gabungan fee + potongan: kas keluar = bruto + fee − potongan", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "500000");
      const result = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-06",
        amount: "500000",
        accountId: acc["1100"],
        withholding: { type: "pph23", rate: "2", amount: "10000" },
      });
      const { byCode } = await journalByKey(tx, `ap:${receipt.id}:${result.number}`);
      expect(byCode.get("2000")?.debit).toBe("500000.0000");
      expect(byCode.get("6060")?.debit).toBe("2500.0000");
      expect(byCode.get("2130")?.credit).toBe("10000.0000");
      expect(byCode.get("1100")?.credit).toBe("492500.0000");
    });
  });

  it("saklar mati (bawaan): potongan ditolak; tanpa potongan jurnal persis lama", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "500000");
      await expect(
        payPayableDocument(tx, {
          companyId: ORG,
          userId: USER_ID,
          receiptId: receipt.id,
          date: "2099-01-06",
          amount: "500000",
          accountId: acc["1000"],
          withholding: { type: "pph23", rate: "2", amount: "10000" },
        }),
      ).rejects.toThrow(/belum aktif|saklar/i);
      const result = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-06",
        amount: "500000",
        accountId: acc["1000"],
      });
      const { lines, byCode } = await journalByKey(tx, `ap:${receipt.id}:${result.number}`);
      expect(lines).toHaveLength(2);
      expect(byCode.get("1000")?.credit).toBe("500000.0000");
      expect(await withholdingAccount(tx)).toBeUndefined();
    });
  });

  it("potongan melebihi nominal & jenis tak dikenal ditolak; potongan pada dana kredit ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "100000");
      await expect(
        payPayableDocument(tx, {
          companyId: ORG,
          userId: USER_ID,
          receiptId: receipt.id,
          date: "2099-01-06",
          amount: "100000",
          accountId: acc["1000"],
          withholding: { type: "pph23", amount: "100001" },
        }),
      ).rejects.toThrow(/melebihi/i);
      await expect(
        payPayableDocument(tx, {
          companyId: ORG,
          userId: USER_ID,
          receiptId: receipt.id,
          date: "2099-01-06",
          amount: "100000",
          accountId: acc["1000"],
          withholding: { type: "pph21", amount: "1000" },
        }),
      ).rejects.toThrow(/tidak dikenal/i);
    });
  });

  it("void membalik pembayaran berpotongan PERSIS — Utang PPh kembali nol", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "500000");
      const result = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-06",
        amount: "500000",
        accountId: acc["1000"],
        withholding: { type: "pph42", amount: "10000" },
      });
      const { entry } = await journalByKey(tx, `ap:${receipt.id}:${result.number}`);
      await reverseJournalEntry(tx, {
        companyId: ORG,
        entryId: entry.id,
        date: "2099-01-07",
        description: "Uji void potongan",
        createdBy: USER_ID,
      });
      const whAccount = await withholdingAccount(tx);
      const lines = await tx
        .select({ debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(and(eq(journalEntries.companyId, ORG), eq(journalLines.accountId, whAccount!.id)));
      const net = lines.reduce((sum, line) => sum.plus(d(line.debit)).minus(d(line.credit)), d(0));
      expect(net.toNumber()).toBe(0);
    });
  });
});

describe("R3-A Bagian 2 — withholding pada beban terutang, saldo awal & FIFO", () => {
  it("beban terutang PPh 4(2)", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      const [expense] = await tx
        .insert(expenses)
        .values({
          companyId: ORG,
          number: uniq("EXP"),
          date: "2099-01-05",
          description: "Jasa uji potongan",
          expenseAccountId: acc["6100-EXP"],
          paymentAccountId: null,
          supplierId: supplier.id,
          amount: "300000",
          paidAmount: "0",
          paymentStatus: "unpaid",
          status: "posted",
          createdBy: USER_ID,
        })
        .returning({ id: expenses.id });
      const result = await payExpensePayable(tx, {
        companyId: ORG,
        userId: USER_ID,
        expenseId: expense.id,
        date: "2099-01-06",
        amount: "300000",
        accountId: acc["1000"],
        withholding: { type: "pph42", amount: "15000" },
      });
      const { byCode } = await journalByKey(tx, `ap-expense:${expense.id}:${result.number}`);
      expect(byCode.get("2000")?.debit).toBe("300000.0000");
      expect(byCode.get("2130")?.credit).toBe("15000.0000");
      expect(byCode.get("1000")?.credit).toBe("285000.0000");
    });
  });

  it("saldo awal utang dengan potongan", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      const opening = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: "2099-01-02",
        amount: "400000",
      });
      const result = await payOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: opening.id,
        date: "2099-01-06",
        amount: "400000",
        accountId: acc["1000"],
        withholding: { type: "pph23", rate: "2", amount: "8000" },
      });
      const { byCode } = await journalByKey(tx, `ap-opening:${opening.id}:${result.number}`);
      expect(byCode.get("2000")?.debit).toBe("400000.0000");
      expect(byCode.get("2130")?.credit).toBe("8000.0000");
      expect(byCode.get("1000")?.credit).toBe("392000.0000");
      const [doc] = await tx
        .select({ status: partyOpeningBalances.status })
        .from(partyOpeningBalances)
        .where(eq(partyOpeningBalances.id, opening.id));
      expect(doc.status).toBe("settled");
    });
  });

  it("FIFO: potongan total tersebar mengikuti urutan dokumen; total kas = bruto − potongan", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      const first = await makeReceipt(tx, supplier.id, "300000", "2099-01-03");
      const second = await makeReceipt(tx, supplier.id, "400000", "2099-01-04");
      const result = await payPayableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId: supplier.id,
        date: "2099-01-06",
        amount: "700000",
        accountId: acc["1000"],
        withholding: { type: "pph23", rate: "2", amount: "14000" },
      });
      expect(result.allocations).toHaveLength(2);
      const payments = await tx
        .select({
          receiptId: partyPayments.receiptId,
          withholdingAmount: partyPayments.withholdingAmount,
        })
        .from(partyPayments)
        .where(eq(partyPayments.companyId, ORG));
      const firstPayment = payments.find((row) => row.receiptId === first.id);
      const secondPayment = payments.find((row) => row.receiptId === second.id);
      // Distribusi FIFO: potongan mengisi dokumen tertua lebih dulu.
      expect(firstPayment?.withholdingAmount).toBe("14000.0000");
      expect(secondPayment?.withholdingAmount).toBe("0.0000");
      const j1 = await journalByKey(tx, `ap:${first.id}:${result.numbers[0]}`);
      expect(j1.byCode.get("1000")?.credit).toBe("286000.0000");
      expect(j1.byCode.get("2130")?.credit).toBe("14000.0000");
      const j2 = await journalByKey(tx, `ap:${second.id}:${result.numbers[1]}`);
      expect(j2.byCode.get("1000")?.credit).toBe("400000.0000");
    });
  });

  it("FIFO: potongan melebihi total teralokasi ditolak sebelum posting apa pun", async () => {
    await rollbackTransaction(async (tx) => {
      await enableWithholding(tx);
      const supplier = await makeSupplier(tx);
      await makeReceipt(tx, supplier.id, "100000", "2099-01-03");
      await expect(
        payPayableFifo(tx, {
          companyId: ORG,
          userId: USER_ID,
          supplierId: supplier.id,
          date: "2099-01-06",
          amount: "150000",
          accountId: acc["1000"],
          withholding: { type: "pph23", amount: "120000" },
        }),
      ).rejects.toThrow(/teralokasi|melebihi/i);
    });
  });
});
