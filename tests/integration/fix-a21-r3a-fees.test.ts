import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  cashSessions,
  companySettings,
  customers,
  expenses,
  journalEntries,
  journalLines,
  partyPayments,
  paymentMethods,
  products,
  salePayments,
  sales,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { ensureFiscalPeriods, reverseJournalEntry } from "@/server/accounting";
import { payExpensePayable, payPayableDocument } from "@/server/payables";
import { computeConfiguredFee, resolvePaymentFee } from "@/server/payment-fees";
import { createSale } from "@/server/pos";
import { payReceivable } from "@/server/pos/receivables";
import { getPaymentBreakdown } from "@/server/reports";
import { d } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-21 Tahap R3-A Bagian 1 — fee/MDR per metode pembayaran (R3-01,
// sisa AK3-04). Tarif adalah konfigurasi per perusahaan di
// payment_methods (pola D-25: saklar + jenis + nilai; bawaan mati =
// perilaku lama persis). Konfigurasi memberi nilai AWAL; nominal fee
// final diputuskan pengguna di form dan dibekukan di baris pembayaran
// (party_payments.fee_amount / sale_payments.fee_amount). Jurnal:
// masuk model terpotong (Dr akun neto + Dr 6060 / Cr bruto), keluar
// model di atas nominal (Dr bruto + Dr 6060 / Cr bruto+fee) — fee
// selalu beban perusahaan, tidak mengurangi hak pihak.

const ORG = "01900000-0000-7000-8000-00000000a217";
const USER_ID = "user-uji-a21-r3a-fee";
const RUN = `${Date.now()}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

const acc: Record<string, string> = {};
const method: Record<string, string> = {};
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
        legalName: "Uji R3-A Fee",
        taxRate: "0",
        taxEnabled: false,
      });
      const rows = await tx
        // AUD-001/A-27: cashBankKind diisi eksplisit — sejak A-27 validator
        // kas/bank membaca kolom ini; fixture tidak boleh bergantung pada
        // residu lama yang dulu ter-backfill (residu itu kini dibersihkan).
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
          { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", cashBankKind: "bank" },
          { companyId: ORG, code: "1110", name: "QRIS", type: "asset", normalBalance: "debit", cashBankKind: "clearing" },
          { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "2300", name: "Kredit Pelanggan", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: ORG, code: "5000", name: "HPP", type: "cogs", normalBalance: "debit" },
          { companyId: ORG, code: "6060", name: "Beban Administrasi Bank", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "qris", accountId: byCode.get("1110")! },
        { companyId: ORG, key: "receivable", accountId: byCode.get("1200")! },
        { companyId: ORG, key: "supplier_credit", accountId: byCode.get("1210")! },
        { companyId: ORG, key: "inventory", accountId: byCode.get("1300")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "customer_credit", accountId: byCode.get("2300")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: ORG, key: "revenue", accountId: byCode.get("4000")! },
        { companyId: ORG, key: "cogs", accountId: byCode.get("5000")! },
        { companyId: ORG, key: "bank_fee", accountId: byCode.get("6060")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-R3A1", name: "Gudang Uji R3-A1", type: "warehouse", isDefault: true })
        .returning({ id: warehouses.id });
      warehouseId = warehouse.id;
      const methods = await tx
        .insert(paymentMethods)
        .values([
          { companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: byCode.get("1000")!, sortOrder: 1 },
          { companyId: ORG, code: "QRISFEE", name: "QRIS Fee", type: "qris", accountId: byCode.get("1110")!, sortOrder: 2, feeEnabled: true, feeType: "percent", feeValue: "1.5" },
          { companyId: ORG, code: "BANKFEE", name: "Bank Fee", type: "bank", accountId: byCode.get("1100")!, sortOrder: 3, feeEnabled: true, feeType: "fixed", feeValue: "2500" },
        ])
        .returning({ id: paymentMethods.id, code: paymentMethods.code });
      for (const row of methods) method[row.code] = row.id;
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
    if (!method.QRISFEE) {
      const methodRows = await tx
        .select({ id: paymentMethods.id, code: paymentMethods.code })
        .from(paymentMethods)
        .where(eq(paymentMethods.companyId, ORG));
      for (const row of methodRows) method[row.code] = row.id;
    }
  });
}

beforeAll(bootstrap);

let seq = 0;
function uniq(prefix: string) {
  seq += 1;
  return `${prefix}-${RUN}-${seq}`;
}

async function makeCustomer(tx: Tx) {
  const [row] = await tx
    .insert(customers)
    .values({ companyId: ORG, code: uniq("CST"), name: "Pelanggan Uji Fee" })
    .returning({ id: customers.id });
  return row;
}

async function makeSupplier(tx: Tx) {
  const [row] = await tx
    .insert(suppliers)
    .values({ companyId: ORG, code: uniq("SUP"), name: "Pemasok Uji Fee" })
    .returning({ id: suppliers.id });
  return row;
}

async function makeSale(tx: Tx, customerId: string, total: string) {
  const [row] = await tx
    .insert(sales)
    .values({
      companyId: ORG,
      warehouseId,
      number: uniq("INV"),
      date: "2099-01-05",
      cashierId: USER_ID,
      customerId,
      status: "completed",
      total,
      paidTotal: "0",
      paymentStatus: "unpaid",
    })
    .returning({ id: sales.id, number: sales.number });
  return row;
}

async function makeReceipt(tx: Tx, supplierId: string, total: string) {
  const [row] = await tx
    .insert(stockReceipts)
    .values({
      companyId: ORG,
      warehouseId,
      number: uniq("GRN"),
      date: "2099-01-05",
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

/** Saldo jurnal per kode akun untuk satu kunci idempotensi jurnal. */
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
      debit: journalLines.debit,
      credit: journalLines.credit,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entry!.id));
  const byCode = new Map<string, { debit: string; credit: string }>();
  for (const line of lines) {
    byCode.set(line.code, { debit: line.debit, credit: line.credit });
  }
  return { entry: entry!, lines, byCode };
}

describe("R3-A Bagian 1 — hitung fee konfigurasi", () => {
  it("persen, tetap, dan nonaktif", () => {
    expect(
      computeConfiguredFee({ feeEnabled: true, feeType: "percent", feeValue: "1.5" }, d(200000)).toFixed(2),
    ).toBe("3000.00");
    expect(
      computeConfiguredFee({ feeEnabled: true, feeType: "fixed", feeValue: "2500" }, d(200000)).toFixed(2),
    ).toBe("2500.00");
    expect(
      computeConfiguredFee({ feeEnabled: false, feeType: "percent", feeValue: "1.5" }, d(200000)).toFixed(2),
    ).toBe("0.00");
    expect(
      computeConfiguredFee({ feeEnabled: true, feeType: "none", feeValue: "1.5" }, d(200000)).toFixed(2),
    ).toBe("0.00");
    // Persen dibulatkan ke sen (2 desimal) — MDR riil memang disen.
    expect(
      computeConfiguredFee({ feeEnabled: true, feeType: "percent", feeValue: "0.7" }, d(33333)).toFixed(2),
    ).toBe("233.33");
  });
});

describe("R3-A Bagian 1 — fee pada pembayaran piutang", () => {
  it("bawaan dari konfigurasi QRIS 1,5%: jurnal terpotong neto + fee, hak pelanggan bruto", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "200000");
      const result = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-06",
        amount: "200000",
        accountId: acc["1110"],
      });
      const { byCode } = await journalByKey(tx, `ar:${sale.id}:${result.number}`);
      expect(byCode.get("1110")).toEqual({ debit: "197000.0000", credit: "0.0000" });
      expect(byCode.get("6060")).toEqual({ debit: "3000.0000", credit: "0.0000" });
      expect(byCode.get("1200")).toEqual({ debit: "0.0000", credit: "200000.0000" });
      const [payment] = await tx
        .select({ amount: partyPayments.amount, feeAmount: partyPayments.feeAmount })
        .from(partyPayments)
        .where(eq(partyPayments.saleId, sale.id));
      expect(payment).toEqual({ amount: "200000.0000", feeAmount: "3000.0000" });
      const [updated] = await tx.select({ paymentStatus: sales.paymentStatus }).from(sales).where(eq(sales.id, sale.id));
      expect(updated.paymentStatus).toBe("paid");
    });
  });

  it("fee final diputuskan pengguna (override lebih kecil dari bawaan konfigurasi)", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "100000");
      const result = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-06",
        amount: "100000",
        accountId: acc["1110"],
        fee: "500",
      });
      const { byCode } = await journalByKey(tx, `ar:${sale.id}:${result.number}`);
      expect(byCode.get("1110")?.debit).toBe("99500.0000");
      expect(byCode.get("6060")?.debit).toBe("500.0000");
      expect(byCode.get("1200")?.credit).toBe("100000.0000");
    });
  });

  it("kelebihan bayar dihitung dari bruto — fee bukan bagian alokasi (interaksi R3-B)", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "100000");
      const result = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-06",
        amount: "120000",
        accountId: acc["1110"],
      });
      // Fee 1,5% dari bruto diterima 120.000 = 1.800; kelebihan 20.000
      // tetap menjadi kredit pelanggan utuh.
      expect(result.creditAmount).toBe("20000.0000");
      const { byCode } = await journalByKey(tx, `ar:${sale.id}:${result.number}`);
      expect(byCode.get("1110")?.debit).toBe("118200.0000");
      expect(byCode.get("6060")?.debit).toBe("1800.0000");
      expect(byCode.get("1200")?.credit).toBe("100000.0000");
      expect(byCode.get("2300")?.credit).toBe("20000.0000");
    });
  });

  it("metode tanpa fee: jurnal persis lama; fee eksplisit pada metode nonaktif ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "75000");
      const result = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-06",
        amount: "75000",
        accountId: acc["1000"],
      });
      const { byCode, lines } = await journalByKey(tx, `ar:${sale.id}:${result.number}`);
      expect(lines).toHaveLength(2);
      expect(byCode.get("1000")?.debit).toBe("75000.0000");
      expect(byCode.get("1200")?.credit).toBe("75000.0000");

      const sale2 = await makeSale(tx, customer.id, "50000");
      await expect(
        payReceivable(tx, {
          companyId: ORG,
          userId: USER_ID,
          saleId: sale2.id,
          date: "2099-01-06",
          amount: "50000",
          accountId: acc["1000"],
          fee: "1000",
        }),
      ).rejects.toThrow(/fee/i);
    });
  });

  it("void (jurnal balik) membalik pembayaran berfee PERSIS — saldo ketiga akun nol", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "200000");
      const result = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-06",
        amount: "200000",
        accountId: acc["1110"],
      });
      const { entry } = await journalByKey(tx, `ar:${sale.id}:${result.number}`);
      await reverseJournalEntry(tx, {
        companyId: ORG,
        entryId: entry.id,
        date: "2099-01-07",
        description: "Uji void fee",
        createdBy: USER_ID,
      });
      const allLines = await tx
        .select({
          accountId: journalLines.accountId,
          debit: journalLines.debit,
          credit: journalLines.credit,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(eq(journalEntries.companyId, ORG));
      const netOf = (accountId: string) =>
        allLines
          .filter((line) => line.accountId === accountId)
          .reduce((sum, line) => sum.plus(d(line.debit)).minus(d(line.credit)), d(0));
      expect(netOf(acc["1110"]).toNumber()).toBe(0);
      expect(netOf(acc["6060"]).toNumber()).toBe(0);
      expect(netOf(acc["1200"]).toNumber()).toBe(0);
    });
  });
});

describe("R3-A Bagian 1 — fee pada pembayaran utang & beban terutang", () => {
  it("fee tetap bank di atas nominal: Dr utang bruto + Dr fee / Cr bank bruto+fee", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "500000");
      const result = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-06",
        amount: "500000",
        accountId: acc["1100"],
      });
      const { byCode } = await journalByKey(tx, `ap:${receipt.id}:${result.number}`);
      expect(byCode.get("2000")).toEqual({ debit: "500000.0000", credit: "0.0000" });
      expect(byCode.get("6060")).toEqual({ debit: "2500.0000", credit: "0.0000" });
      expect(byCode.get("1100")).toEqual({ debit: "0.0000", credit: "502500.0000" });
      const [payment] = await tx
        .select({ amount: partyPayments.amount, feeAmount: partyPayments.feeAmount })
        .from(partyPayments)
        .where(eq(partyPayments.receiptId, receipt.id));
      expect(payment).toEqual({ amount: "500000.0000", feeAmount: "2500.0000" });
    });
  });

  it("fee pada pembayaran beban terutang (persen QRIS)", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx);
      const [expense] = await tx
        .insert(expenses)
        .values({
          companyId: ORG,
          number: uniq("EXP"),
          date: "2099-01-05",
          description: "Jasa uji fee",
          expenseAccountId: acc["6060"],
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
        accountId: acc["1110"],
      });
      const { byCode } = await journalByKey(tx, `ap-expense:${expense.id}:${result.number}`);
      expect(byCode.get("2000")?.debit).toBe("300000.0000");
      expect(byCode.get("6060")?.debit).toBe("4500.0000");
      expect(byCode.get("1110")?.credit).toBe("304500.0000");
    });
  });

  it("pembayaran dari kredit pemasok tidak kena fee; fee eksplisit ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx);
      await makeReceipt(tx, supplier.id, "100000");
      await expect(
        resolvePaymentFee(tx, ORG, { accountId: acc["1000"], base: d(100000), explicitFee: "500" }),
      ).rejects.toThrow(/fee/i);
    });
  });
});

describe("R3-A Bagian 1 — fee pada penjualan POS & rekonsiliasi sesi", () => {
  async function makeServiceProduct(tx: Tx, price: string) {
    const [row] = await tx
      .insert(products)
      .values({
        companyId: ORG,
        sku: uniq("JASA"),
        name: "Jasa Uji Fee",
        trackStock: false,
        salePrice: price,
        costPrice: "0",
      })
      .returning({ id: products.id });
    return row;
  }

  async function openSession(tx: Tx) {
    const [row] = await tx
      .insert(cashSessions)
      .values({ companyId: ORG, userId: USER_ID, openingCash: "0", status: "open" })
      .returning({ id: cashSessions.id });
    return row;
  }

  it("penjualan QRIS berfee: akun QRIS terdebit NETO, fee ke 6060, ekspektasi sesi = neto", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeServiceProduct(tx, "100000");
      const session = await openSession(tx);
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId,
        date: "2099-01-06",
        lines: [{ productId: product.id, qty: 1 }],
        payments: [{ methodId: method.QRISFEE, amount: "100000" }],
        idempotencyKey: uniq("sale-fee"),
      });
      const [payment] = await tx
        .select({ amount: salePayments.amount, feeAmount: salePayments.feeAmount })
        .from(salePayments)
        .where(eq(salePayments.saleId, sale.id));
      expect(payment).toEqual({ amount: "100000.0000", feeAmount: "1500.0000" });

      const { byCode } = await journalByKey(tx, `sale:${sale.id}`);
      expect(byCode.get("1110")?.debit).toBe("98500.0000");
      expect(byCode.get("6060")?.debit).toBe("1500.0000");
      expect(byCode.get("4000")?.credit).toBe("100000.0000");

      // Rekonsiliasi sesi: tender QRIS yang diharapkan kasir adalah
      // NETO sesudah fee — persis yang masuk mutasi akun QRIS.
      const [expected] = await tx
        .select({
          net: sql<string>`coalesce(sum(${salePayments.amount} - ${salePayments.feeAmount}), 0)`,
        })
        .from(salePayments)
        .innerJoin(sales, eq(salePayments.saleId, sales.id))
        .where(and(eq(sales.companyId, ORG), eq(sales.sessionId, session.id)));
      expect(d(expected.net).toFixed(2)).toBe("98500.00");
      expect(d(expected.net).eq(d(byCode.get("1110")!.debit))).toBe(true);
    });
  });

  it("fee POS dapat diubah kasir dari bawaan konfigurasi; metode tunai tanpa fee persis lama", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeServiceProduct(tx, "100000");
      await openSession(tx);
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId,
        date: "2099-01-06",
        lines: [{ productId: product.id, qty: 1 }],
        payments: [{ methodId: method.QRISFEE, amount: "100000", fee: "2000" }],
        idempotencyKey: uniq("sale-fee-override"),
      });
      const { byCode } = await journalByKey(tx, `sale:${sale.id}`);
      expect(byCode.get("1110")?.debit).toBe("98000.0000");
      expect(byCode.get("6060")?.debit).toBe("2000.0000");

      const cashSale = await createSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId,
        date: "2099-01-06",
        lines: [{ productId: product.id, qty: 1 }],
        payments: [{ methodId: method.CASH, amount: "100000", tendered: "100000" }],
        idempotencyKey: uniq("sale-cash"),
      });
      const cashJournal = await journalByKey(tx, `sale:${cashSale.id}`);
      expect(cashJournal.byCode.get("1000")?.debit).toBe("100000.0000");
      expect(cashJournal.byCode.has("6060")).toBe(false);
    });
  });

  it("fee eksplisit pada metode POS berfee nonaktif ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeServiceProduct(tx, "100000");
      await openSession(tx);
      await expect(
        createSale(tx, {
          companyId: ORG,
          userId: USER_ID,
          warehouseId,
          date: "2099-01-06",
          lines: [{ productId: product.id, qty: 1 }],
          payments: [{ methodId: method.CASH, amount: "100000", tendered: "100000", fee: "1000" }],
          idempotencyKey: uniq("sale-cash-fee"),
        }),
      ).rejects.toThrow(/fee/i);
    });
  });

  it("laporan rincian pembayaran memuat fee & neto per metode", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeServiceProduct(tx, "100000");
      await openSession(tx);
      await createSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId,
        date: "2099-01-06",
        lines: [{ productId: product.id, qty: 1 }],
        payments: [{ methodId: method.QRISFEE, amount: "100000" }],
        idempotencyKey: uniq("sale-report"),
      });
      const rows = await getPaymentBreakdown(tx, ORG, { from: "2099-01-01", to: "2099-12-31" });
      const qris = rows.find((row) => row.methodId === method.QRISFEE);
      expect(qris).toBeTruthy();
      expect(qris!.amount).toBe(100000);
      expect(qris!.fee).toBe(1500);
      expect(qris!.net).toBe(98500);
    });
  });
});
