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
  partyCredits,
  partyPayments,
  paymentMethods,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { ensureFiscalPeriods } from "@/server/accounting";
import { payExpensePayable, payPayableDocument } from "@/server/payables";
import { payPayableFifo } from "@/server/quick-entry";
import { d } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-26 Q8 (P-04 / D-02) — TEST KARAKTERISASI payables, ditulis SEBELUM
// inti pembayaran bersama diekstrak. Mengunci perilaku dua jalur
// "bayar dokumen utang" — payPayableDocument (penerimaan barang) dan
// payExpensePayable (beban terutang) — atas fixture yang setara:
// baris party_payments, baris jurnal (akun/debit/kredit/tag pihak),
// status & terbayar dokumen, kredit pemasok dari kelebihan bayar,
// pembayaran bersumber kredit, fee, withholding, dan pesan penjaga.
//
// Perbedaan antar-jalur yang DISENGAJA dan dikunci apa adanya (bukan
// disamakan): awalan kunci idempotensi jurnal ("ap:" vs
// "ap-expense:"), deskripsi jurnal, entityType audit, kata pesan
// penjaga per jenis dokumen, dan sisa utang penerimaan yang dikurangi
// alokasi retur pemasok (jalur beban tidak punya konsep itu).
// Alokasi FIFO lintas dokumen dikunci juga di berkas ini (dan di
// fix-a21-r3e untuk campuran penerimaan+beban).

const ORG = "01900000-0000-7000-8000-00000000a268";
const USER_ID = "user-uji-a26-q8";
const RUN = `${Date.now()}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

const acc: Record<string, string> = {};
let warehouseId = "";
let supplierId = "";

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
        legalName: "Uji A-26 Q8 Payables",
        taxRate: "0",
        taxEnabled: false,
        withholdingEnabled: false,
      });
      const rows = await tx
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
          { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", cashBankKind: "bank" },
          { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
          { companyId: ORG, code: "6060", name: "Biaya Administrasi Bank", type: "expense", normalBalance: "debit" },
          { companyId: ORG, code: "6100", name: "Beban Jasa", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "qris", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "supplier_credit", accountId: byCode.get("1210")! },
        { companyId: ORG, key: "inventory", accountId: byCode.get("1300")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: ORG, key: "revenue", accountId: byCode.get("4000")! },
        { companyId: ORG, key: "cogs", accountId: byCode.get("5000")! },
        { companyId: ORG, key: "bank_fee", accountId: byCode.get("6060")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-Q8", name: "Gudang Uji Q8", type: "warehouse", isDefault: true })
        .returning({ id: warehouses.id });
      warehouseId = warehouse.id;
      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId: ORG, code: "SUP-Q8", name: "Pemasok Q8", paymentTermDays: 14 })
        .returning({ id: suppliers.id });
      supplierId = supplier.id;
    }
    const accountRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, ORG));
    for (const row of accountRows) acc[row.code] = row.id;
    // Metode bank berfee tetap — prasyarat fee eksplisit dicatat
    // (resolvePaymentFee menolak fee pada akun tanpa metode berfee).
    const [feeMethod] = await tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG), eq(paymentMethods.code, "BANKFEE")))
      .limit(1);
    if (!feeMethod) {
      await tx.insert(paymentMethods).values({
        companyId: ORG,
        code: "BANKFEE",
        name: "Bank Fee",
        type: "bank",
        accountId: acc["1100"],
        sortOrder: 1,
        feeEnabled: true,
        feeType: "fixed",
        feeValue: "2500",
      });
    }
    if (!warehouseId) {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      warehouseId = warehouse.id;
    }
    if (!supplierId) {
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG))
        .limit(1);
      supplierId = supplier.id;
    }
  });
}

beforeAll(bootstrap);

let seq = 0;
function uniq(prefix: string) {
  seq += 1;
  return `${prefix}-Q8-${RUN}-${seq}`;
}

async function makeReceipt(
  tx: Tx,
  total: string,
  opts: { date?: string; status?: string; paymentAccountId?: string } = {},
) {
  const [row] = await tx
    .insert(stockReceipts)
    .values({
      companyId: ORG,
      warehouseId,
      number: uniq("GRN"),
      date: opts.date ?? "2099-01-05",
      supplierId,
      source: "purchase",
      status: opts.status ?? "posted",
      total,
      paidAmount: "0",
      paymentStatus: "unpaid",
      paymentAccountId: opts.paymentAccountId ?? null,
    })
    .returning({ id: stockReceipts.id, number: stockReceipts.number });
  return row;
}

async function makeExpense(
  tx: Tx,
  amount: string,
  opts: { date?: string; status?: string; withSupplier?: boolean } = {},
) {
  const [row] = await tx
    .insert(expenses)
    .values({
      companyId: ORG,
      number: uniq("EXP"),
      date: opts.date ?? "2099-01-05",
      description: `Beban terutang uji Q8 ${RUN}`,
      expenseAccountId: acc["6100"],
      supplierId: opts.withSupplier === false ? null : supplierId,
      amount,
      paidAmount: "0",
      paymentStatus: "unpaid",
      status: opts.status ?? "posted",
      createdBy: USER_ID,
    })
    .returning({ id: expenses.id, number: expenses.number });
  return row;
}

/** Baris jurnal ternormalisasi: kode akun + sisi + nominal + tag pihak. */
async function journalShape(tx: Tx, idempotencyKey: string) {
  const [entry] = await tx
    .select({ id: journalEntries.id, description: journalEntries.description })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.idempotencyKey, idempotencyKey)))
    .limit(1);
  expect(entry, `jurnal ${idempotencyKey} harus ada`).toBeTruthy();
  const lines = await tx
    .select({
      code: accounts.code,
      debit: journalLines.debit,
      credit: journalLines.credit,
      partyId: journalLines.partyId,
      description: journalLines.description,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entry!.id));
  const sorted = [...lines].sort((a, b) =>
    a.code === b.code ? d(b.debit).cmp(d(a.debit)) : a.code < b.code ? -1 : 1,
  );
  return {
    description: entry!.description,
    lines: sorted.map((line) => ({
      code: line.code,
      debit: d(line.debit).toFixed(0),
      credit: d(line.credit).toFixed(0),
      party: line.partyId === supplierId ? "supplier" : line.partyId,
      description: line.description,
    })),
  };
}

async function paymentRow(tx: Tx, number: string) {
  const [row] = await tx
    .select()
    .from(partyPayments)
    .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.number, number)))
    .limit(1);
  expect(row, `party_payments ${number} harus ada`).toBeTruthy();
  return row!;
}

async function receiptState(tx: Tx, id: string) {
  const [row] = await tx
    .select({ paidAmount: stockReceipts.paidAmount, paymentStatus: stockReceipts.paymentStatus })
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, ORG), eq(stockReceipts.id, id)))
    .limit(1);
  return row!;
}

async function expenseState(tx: Tx, id: string) {
  const [row] = await tx
    .select({ paidAmount: expenses.paidAmount, paymentStatus: expenses.paymentStatus })
    .from(expenses)
    .where(and(eq(expenses.companyId, ORG), eq(expenses.id, id)))
    .limit(1);
  return row!;
}

type Path = "receipt" | "expense";
const PATHS: Path[] = ["receipt", "expense"];

async function pay(
  tx: Tx,
  path: Path,
  docId: string,
  input: { date: string; amount: string; accountId?: string; fee?: string; creditId?: string; withholding?: { type: string; rate?: string; amount: string } },
) {
  const base = { companyId: ORG, userId: USER_ID, ...input };
  return path === "receipt"
    ? payPayableDocument(tx, { ...base, receiptId: docId })
    : payExpensePayable(tx, { ...base, expenseId: docId });
}

describe("A-26 Q8 karakterisasi payables (P-04)", () => {
  it.each(PATHS)(
    "%s: pembayaran sebagian lalu lunas — baris pembayaran, jurnal, status dokumen terkunci",
    async (path) => {
      await rollbackTransaction(async (tx) => {
        const doc =
          path === "receipt" ? await makeReceipt(tx, "500000") : await makeExpense(tx, "500000");

        const first = await pay(tx, path, doc.id, {
          date: "2099-01-06",
          amount: "200000",
          accountId: acc["1000"],
        });
        expect(first.amount).toBe(200000);
        const payment = await paymentRow(tx, first.number);
        expect(payment.type).toBe("payable");
        expect(payment.partyType).toBe("supplier");
        expect(payment.partyId).toBe(supplierId);
        expect(payment.amount).toBe("200000.0000");
        expect(payment.feeAmount).toBe("0.0000");
        expect(payment.withholdingAmount).toBe("0.0000");
        expect(payment.withholdingType).toBeNull();
        expect(payment.accountId).toBe(acc["1000"]);
        expect(payment.creditId).toBeNull();
        expect(payment.status).toBe("posted");
        if (path === "receipt") {
          expect(payment.receiptId).toBe(doc.id);
          expect(payment.expenseId).toBeNull();
        } else {
          expect(payment.expenseId).toBe(doc.id);
          expect(payment.receiptId).toBeNull();
        }

        const key = `${path === "receipt" ? "ap" : "ap-expense"}:${doc.id}:${first.number}`;
        const journal = await journalShape(tx, key);
        expect(journal.description).toBe(
          path === "receipt" ? `Pembayaran utang ${doc.number}` : `Pembayaran utang beban ${doc.number}`,
        );
        expect(journal.lines).toEqual([
          { code: "1000", debit: "0", credit: "200000", party: null, description: "Kas/bank keluar" },
          { code: "2000", debit: "200000", credit: "0", party: "supplier", description: "Utang berkurang" },
        ]);

        const mid = path === "receipt" ? await receiptState(tx, doc.id) : await expenseState(tx, doc.id);
        expect(mid.paidAmount).toBe("200000.0000");
        expect(mid.paymentStatus).toBe("partial");

        const second = await pay(tx, path, doc.id, {
          date: "2099-01-07",
          amount: "300000",
          accountId: acc["1100"],
        });
        expect(second.amount).toBe(300000);
        const done = path === "receipt" ? await receiptState(tx, doc.id) : await expenseState(tx, doc.id);
        expect(done.paidAmount).toBe("500000.0000");
        expect(done.paymentStatus).toBe("paid");

        // Lunas → pembayaran berikutnya ditolak di kedua jalur.
        await expect(
          pay(tx, path, doc.id, { date: "2099-01-08", amount: "1000", accountId: acc["1000"] }),
        ).rejects.toThrow("Utang sudah lunas.");
      });
    },
  );

  it.each(PATHS)("%s: kelebihan bayar menjadi kredit pemasok", async (path) => {
    await rollbackTransaction(async (tx) => {
      const doc = path === "receipt" ? await makeReceipt(tx, "100000") : await makeExpense(tx, "100000");
      const result = await pay(tx, path, doc.id, {
        date: "2099-01-06",
        amount: "130000",
        accountId: acc["1000"],
      });
      // Baris pembayaran hanya mencatat porsi teralokasi.
      const payment = await paymentRow(tx, result.number);
      expect(payment.amount).toBe("100000.0000");
      expect(result.creditAmount).toBe("30000.0000");

      const key = `${path === "receipt" ? "ap" : "ap-expense"}:${doc.id}:${result.number}`;
      const journal = await journalShape(tx, key);
      expect(journal.lines).toEqual([
        { code: "1000", debit: "0", credit: "130000", party: null, description: "Kas/bank keluar" },
        {
          code: "1210",
          debit: "30000",
          credit: "0",
          party: "supplier",
          description: "Kelebihan bayar menjadi kredit pemasok",
        },
        { code: "2000", debit: "100000", credit: "0", party: "supplier", description: "Utang berkurang" },
      ]);

      const [credit] = await tx
        .select()
        .from(partyCredits)
        .where(and(eq(partyCredits.companyId, ORG), eq(partyCredits.originPaymentId, payment.id)))
        .limit(1);
      expect(credit).toBeTruthy();
      expect(credit!.amount).toBe("30000.0000");
      expect(credit!.usedAmount).toBe("0.0000");
      expect(credit!.status).toBe("open");
      expect(credit!.partyId).toBe(supplierId);
      expect(credit!.journalId).toBeTruthy();

      const state = path === "receipt" ? await receiptState(tx, doc.id) : await expenseState(tx, doc.id);
      expect(state.paymentStatus).toBe("paid");
    });
  });

  it.each(PATHS)("%s: fee eksplisit di atas nominal", async (path) => {
    await rollbackTransaction(async (tx) => {
      const doc = path === "receipt" ? await makeReceipt(tx, "100000") : await makeExpense(tx, "100000");
      const result = await pay(tx, path, doc.id, {
        date: "2099-01-06",
        amount: "100000",
        accountId: acc["1100"],
        fee: "2500",
      });
      const payment = await paymentRow(tx, result.number);
      expect(payment.feeAmount).toBe("2500.0000");
      const key = `${path === "receipt" ? "ap" : "ap-expense"}:${doc.id}:${result.number}`;
      const journal = await journalShape(tx, key);
      expect(journal.lines).toEqual([
        { code: "1100", debit: "0", credit: "102500", party: null, description: "Kas/bank keluar" },
        { code: "2000", debit: "100000", credit: "0", party: "supplier", description: "Utang berkurang" },
        {
          code: "6060",
          debit: "2500",
          credit: "0",
          party: null,
          description: "Biaya (fee/MDR) metode pembayaran",
        },
      ]);
    });
  });

  it.each(PATHS)("%s: withholding PPh 23 memotong kas keluar", async (path) => {
    await rollbackTransaction(async (tx) => {
      await tx
        .update(companySettings)
        .set({ withholdingEnabled: true })
        .where(eq(companySettings.companyId, ORG));
      const doc = path === "receipt" ? await makeReceipt(tx, "500000") : await makeExpense(tx, "500000");
      const result = await pay(tx, path, doc.id, {
        date: "2099-01-06",
        amount: "500000",
        accountId: acc["1000"],
        withholding: { type: "pph23", rate: "2", amount: "10000" },
      });
      const payment = await paymentRow(tx, result.number);
      expect(payment.withholdingType).toBe("pph23");
      expect(payment.withholdingRate).toBe("2.0000");
      expect(payment.withholdingAmount).toBe("10000.0000");
      const key = `${path === "receipt" ? "ap" : "ap-expense"}:${doc.id}:${result.number}`;
      const journal = await journalShape(tx, key);
      expect(journal.lines).toEqual([
        { code: "1000", debit: "0", credit: "490000", party: null, description: "Kas/bank keluar" },
        { code: "2000", debit: "500000", credit: "0", party: "supplier", description: "Utang berkurang" },
        {
          code: "2130",
          debit: "0",
          credit: "10000",
          party: "supplier",
          description: "Potongan PPh 23 atas pembayaran",
        },
      ]);
    });
  });

  it.each(PATHS)("%s: pembayaran bersumber kredit pemasok tanpa kas keluar", async (path) => {
    await rollbackTransaction(async (tx) => {
      // Lahirkan kredit lewat kelebihan bayar dokumen lain (jalur sama).
      const seedDoc = path === "receipt" ? await makeReceipt(tx, "50000") : await makeExpense(tx, "50000");
      const seedPay = await pay(tx, path, seedDoc.id, {
        date: "2099-01-06",
        amount: "150000",
        accountId: acc["1000"],
      });
      const seedPayment = await paymentRow(tx, seedPay.number);
      const [credit] = await tx
        .select()
        .from(partyCredits)
        .where(and(eq(partyCredits.companyId, ORG), eq(partyCredits.originPaymentId, seedPayment.id)))
        .limit(1);
      expect(credit).toBeTruthy();

      const doc = path === "receipt" ? await makeReceipt(tx, "40000") : await makeExpense(tx, "40000");
      // Kredit tidak boleh melebihi sisa utang.
      await expect(
        pay(tx, path, doc.id, { date: "2099-01-07", amount: "40001", creditId: credit!.id }),
      ).rejects.toThrow(/Pembayaran melebihi sisa utang/);
      // Kredit tidak dikenai fee.
      await expect(
        pay(tx, path, doc.id, { date: "2099-01-07", amount: "40000", creditId: credit!.id, fee: "1000" }),
      ).rejects.toThrow(/tidak dikenai fee/);

      const result = await pay(tx, path, doc.id, {
        date: "2099-01-07",
        amount: "40000",
        creditId: credit!.id,
      });
      const payment = await paymentRow(tx, result.number);
      expect(payment.creditId).toBe(credit!.id);
      expect(payment.accountId).toBe(acc["1210"]);
      expect(payment.amount).toBe("40000.0000");

      const key = `${path === "receipt" ? "ap" : "ap-expense"}:${doc.id}:${result.number}`;
      const journal = await journalShape(tx, key);
      expect(journal.lines).toEqual([
        {
          code: "1210",
          debit: "0",
          credit: "40000",
          party: "supplier",
          description: "Kredit pemasok terpakai",
        },
        {
          code: "2000",
          debit: "40000",
          credit: "0",
          party: "supplier",
          description: "Utang berkurang (kredit pemasok)",
        },
      ]);

      const [creditAfter] = await tx
        .select()
        .from(partyCredits)
        .where(and(eq(partyCredits.companyId, ORG), eq(partyCredits.id, credit!.id)))
        .limit(1);
      expect(creditAfter!.usedAmount).toBe("40000.0000");
      expect(creditAfter!.status).toBe("open");
      const state = path === "receipt" ? await receiptState(tx, doc.id) : await expenseState(tx, doc.id);
      expect(state.paymentStatus).toBe("paid");
    });
  });

  it.each(PATHS)("%s: penjaga nominal, tanggal, akun saluran, dokumen void", async (path) => {
    await rollbackTransaction(async (tx) => {
      const doc = path === "receipt" ? await makeReceipt(tx, "100000") : await makeExpense(tx, "100000");
      await expect(
        pay(tx, path, doc.id, { date: "2099-01-06", amount: "0", accountId: acc["1000"] }),
      ).rejects.toThrow("Nominal pembayaran harus lebih dari nol.");
      await expect(
        pay(tx, path, doc.id, { date: "2099-01-04", amount: "1000", accountId: acc["1000"] }),
      ).rejects.toThrow(
        path === "receipt" ? /lebih awal dari tanggal penerimaan/ : /lebih awal dari tanggal beban/,
      );
      // Akun pendapatan bukan akun saluran kas/bank.
      await expect(
        pay(tx, path, doc.id, { date: "2099-01-06", amount: "1000", accountId: acc["4000"] }),
      ).rejects.toThrow();
      // Tanpa akun & tanpa kredit.
      await expect(pay(tx, path, doc.id, { date: "2099-01-06", amount: "1000" })).rejects.toThrow(
        "Pilih akun kas/bank sumber pembayaran.",
      );

      const voidDoc =
        path === "receipt"
          ? await makeReceipt(tx, "100000", { status: "void" })
          : await makeExpense(tx, "100000", { status: "void" });
      await expect(
        pay(tx, path, voidDoc.id, { date: "2099-01-06", amount: "1000", accountId: acc["1000"] }),
      ).rejects.toThrow(/sudah dibatalkan \(void\)/);
    });
  });

  it("penerimaan: dokumen bukan utang kredit & tidak ditemukan ditolak dgn pesan khasnya", async () => {
    await rollbackTransaction(async (tx) => {
      const cashReceipt = await makeReceipt(tx, "100000", { paymentAccountId: acc["1000"] });
      await expect(
        payPayableDocument(tx, {
          companyId: ORG,
          userId: USER_ID,
          receiptId: cashReceipt.id,
          date: "2099-01-06",
          amount: "1000",
          accountId: acc["1000"],
        }),
      ).rejects.toThrow(/bukan utang pembelian kredit/);
      await expect(
        payPayableDocument(tx, {
          companyId: ORG,
          userId: USER_ID,
          receiptId: "01900000-0000-7000-8000-00000000ffff",
          date: "2099-01-06",
          amount: "1000",
          accountId: acc["1000"],
        }),
      ).rejects.toThrow("Penerimaan barang tidak ditemukan.");
    });
  });

  it("beban: beban tanpa pemasok & tidak ditemukan ditolak dgn pesan khasnya", async () => {
    await rollbackTransaction(async (tx) => {
      const cashExpense = await makeExpense(tx, "100000", { withSupplier: false });
      await expect(
        payExpensePayable(tx, {
          companyId: ORG,
          userId: USER_ID,
          expenseId: cashExpense.id,
          date: "2099-01-06",
          amount: "1000",
          accountId: acc["1000"],
        }),
      ).rejects.toThrow(/bukan beban terutang/);
      await expect(
        payExpensePayable(tx, {
          companyId: ORG,
          userId: USER_ID,
          expenseId: "01900000-0000-7000-8000-00000000ffff",
          date: "2099-01-06",
          amount: "1000",
          accountId: acc["1000"],
        }),
      ).rejects.toThrow("Beban tidak ditemukan.");
    });
  });

  it("FIFO penerimaan: melunasi tertua dulu, sisa ke dokumen berikutnya", async () => {
    await rollbackTransaction(async (tx) => {
      const older = await makeReceipt(tx, "50000", { date: "2099-01-03" });
      const newer = await makeReceipt(tx, "30000", { date: "2099-01-04" });
      const result = await payPayableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId,
        date: "2099-02-01",
        amount: "65000",
        accountId: acc["1100"],
      });
      expect(result.allocations).toHaveLength(2);
      expect(result.allocations[0].number).toBe(older.number);
      expect(d(result.allocations[0].amount).eq(50000)).toBe(true);
      expect(result.allocations[1].number).toBe(newer.number);
      expect(d(result.allocations[1].amount).eq(15000)).toBe(true);
      expect((await receiptState(tx, older.id)).paymentStatus).toBe("paid");
      const newerState = await receiptState(tx, newer.id);
      expect(newerState.paidAmount).toBe("15000.0000");
      expect(newerState.paymentStatus).toBe("partial");
    });
  });
});
