import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import {
  accountMappings,
  accounts,
  bankTransfers,
  companySettings,
  customers,
  expenses,
  journalEntries,
  journalLines,
  partyOpeningBalances,
  partyPayments,
  products,
  quickEntryDrafts,
  quickEntrySubmissions,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { ensureFiscalPeriods, getAccountMap } from "@/server/accounting";
import { createReceipt } from "@/server/inventory";
import { createOpeningBalance } from "@/server/opening-balances";
import {
  listOpenReceivableDocs,
  payPayableFifo,
  postQuickCashSale,
  receiveReceivableFifo,
} from "@/server/quick-entry";
import { createSupplierReturn, postSupplierReturn } from "@/server/supplier-returns";
import {
  deleteQuickEntryDraftAction,
  listQuickEntryDraftsAction,
  postQuickEntryAction,
  saveQuickEntryDraftAction,
} from "@/server/actions/quick-entry";
import { d } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-12 (D-23): modal Catat Transaksi.
// Domain diuji dalam transaksi rollback; aksi (posting + draf +
// idempotensi) diuji ter-commit dengan sesi mock — keduanya di
// perusahaan uji tersendiri aa54 yang di-bootstrap sekali.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000aa54" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  });
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

const ORG = "01900000-0000-7000-8000-00000000aa54";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const RUN = `${Date.now()}`;


const rollbackTransaction = makeRollbackTransaction(ORG);

const acc: Record<string, string> = {};
let warehouseId = "";
let supplierId = "";
let customerId = "";
let customerBId = "";
let productId = "";

async function bootstrap() {
  await withCompany(ORG, async (tx) => {
    // FIX-P1 Tahap 3 (AK1-01): test ini memposting pada tanggal 2099;
    // periode tanpa baris kini berarti tertutup, jadi tahunnya
    // dimaterialisasi eksplisit di setup (setara jalur owner di UI).
    await ensureFiscalPeriods(tx, ORG, 2099);
    const [settings] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (!settings) {
      await tx.insert(companySettings).values({ companyId: ORG, legalName: "Uji Catat Transaksi", taxRate: "11" });
      const rows = await tx
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
          { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", cashBankKind: "bank" },
          { companyId: ORG, code: "1110", name: "QRIS", type: "asset", normalBalance: "debit", cashBankKind: "clearing" },
          { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "2200", name: "PPN Keluaran", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "2300", name: "Kredit Pelanggan", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: ORG, code: "6060", name: "Biaya Administrasi Bank", type: "expense", normalBalance: "debit" },
          { companyId: ORG, code: "6100", name: "Beban Listrik", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "qris", accountId: byCode.get("1110")! },
        { companyId: ORG, key: "receivable", accountId: byCode.get("1200")! },
        { companyId: ORG, key: "supplier_credit", accountId: byCode.get("1210")! },
        { companyId: ORG, key: "customer_credit", accountId: byCode.get("2300")! },
        { companyId: ORG, key: "inventory", accountId: byCode.get("1300")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "tax_output", accountId: byCode.get("2200")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: ORG, key: "revenue", accountId: byCode.get("4000")! },
        { companyId: ORG, key: "bank_fee", accountId: byCode.get("6060")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-QE", name: "Gudang Uji QE", type: "warehouse", isDefault: true })
        .returning({ id: warehouses.id });
      warehouseId = warehouse.id;
      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId: ORG, code: "SUP-QE-A", name: "Pemasok QE A" })
        .returning({ id: suppliers.id });
      supplierId = supplier.id;
      const [product] = await tx
        .insert(products)
        .values({ companyId: ORG, sku: "QE-P1", name: "Produk QE Satu", costPrice: "0", salePrice: "8000" })
        .returning({ id: products.id });
      productId = product.id;
    }
    // A-27 B2: perusahaan fixture yang lahir sebelum B1 belum punya
    // kelas kas/bank — samakan dengan hasil migrasi 0055 (backfill
    // dari pemetaan, preseden cash→bank→clearing) secara idempoten.
    for (const [key, kind] of [["cash", "cash"], ["bank", "bank"], ["qris", "clearing"]] as const) {
      await tx.execute(
        sql`update "accounts" set "cash_bank_kind" = ${kind} where "company_id" = ${ORG} and "cash_bank_kind" is null and "id" in (select "account_id" from "account_mappings" where "company_id" = ${ORG} and "key" = ${key})`,
      );
    }
    const accountRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, ORG));
    for (const row of accountRows) acc[row.code] = row.id;
    // A-21 (R3-02): perusahaan fixture yang sudah terlanjur dibuat
    // sebelum tahap ini belum punya akun kredit pelanggan — lengkapi
    // secara idempoten (di basis data segar akunnya lahir dari
    // daftar bootstrap di atas).
    if (!acc["2300"]) {
      const [created] = await tx
        .insert(accounts)
        .values({ companyId: ORG, code: "2300", name: "Kredit Pelanggan", type: "liability", normalBalance: "credit" })
        .returning({ id: accounts.id });
      await tx
        .insert(accountMappings)
        .values({ companyId: ORG, key: "customer_credit", accountId: created.id });
      acc["2300"] = created.id;
    }
    if (!warehouseId) {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      warehouseId = warehouse.id;
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG))
        .limit(1);
      supplierId = supplier.id;
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, ORG))
        .limit(1);
      productId = product.id;
    }
    const [customer] = await tx
      .insert(customers)
      .values({ companyId: ORG, code: `CUST-QE-${RUN}`, name: "Pelanggan QE" })
      .returning({ id: customers.id });
    customerId = customer.id;
    const [customerB] = await tx
      .insert(customers)
      .values({ companyId: ORG, code: `CUST-QEB-${RUN}`, name: "Pelanggan QE B" })
      .returning({ id: customers.id });
    customerBId = customerB.id;
    // Draf & submisi sisa run sebelumnya tidak boleh mengotori asersi daftar.
    await tx.delete(quickEntryDrafts).where(eq(quickEntryDrafts.companyId, ORG));
    await tx.delete(quickEntrySubmissions).where(eq(quickEntrySubmissions.companyId, ORG));
  });
}

beforeAll(bootstrap);

afterAll(async () => {
  await withCompany(ORG, async (tx) => {
    await tx.delete(quickEntryDrafts).where(eq(quickEntryDrafts.companyId, ORG));
    await tx.delete(quickEntrySubmissions).where(eq(quickEntrySubmissions.companyId, ORG));
  });
});

async function journalLinesByAccount(entryId: string) {
  return withCompanyReadOnly(ORG, async (tx) => {
    const rows = await tx
      .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .where(and(eq(journalLines.companyId, ORG), eq(journalLines.entryId, entryId)));
    const byAccount = new Map<string, { debit: string; credit: string }>();
    for (const row of rows) byAccount.set(row.accountId, { debit: row.debit, credit: row.credit });
    return byAccount;
  });
}

/* ------------------------------------------------------------------ */
/* Domain (rollback)                                                   */
/* ------------------------------------------------------------------ */

describe("domain quick-entry (rollback)", () => {
  it("penjualan tunai termasuk pajak: jurnal persis seperti pratinjau (Dr kas bruto, Cr pendapatan bersih, Cr PPN)", async () => {
    await rollbackTransaction(async (tx) => {
      const entry = await postQuickCashSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-02-01",
        amount: "111000",
        accountId: acc["1000"],
        revenueAccountId: acc["4000"],
        taxIncluded: true,
        taxRate: "11",
      });
      const rows = await tx
        .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ORG), eq(journalLines.entryId, entry.journalId)));
      const byAccount = new Map(rows.map((row) => [row.accountId, row]));
      expect(d(byAccount.get(acc["1000"])!.debit).toFixed(0)).toBe("111000");
      expect(d(byAccount.get(acc["4000"])!.credit).toFixed(0)).toBe("100000");
      expect(d(byAccount.get(acc["2200"])!.credit).toFixed(0)).toBe("11000");

      const noTax = await postQuickCashSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-02-01",
        amount: "75000",
        accountId: acc["1100"],
        revenueAccountId: acc["4000"],
        taxIncluded: false,
        taxRate: "11",
      });
      const rows2 = await tx
        .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ORG), eq(journalLines.entryId, noTax.journalId)));
      expect(rows2).toHaveLength(2);
    });
  });

  it("penjualan tunai menolak akun pendapatan non-pendapatan dan akun kas tak berkelas", async () => {
    await rollbackTransaction(async (tx) => {
      await expect(
        postQuickCashSale(tx, {
          companyId: ORG,
          userId: USER_ID,
          date: "2099-02-01",
          amount: "10000",
          accountId: acc["1000"],
          revenueAccountId: acc["6100"], // akun beban, bukan pendapatan
          taxIncluded: false,
          taxRate: "11",
        }),
      ).rejects.toThrow(/bukan akun pendapatan/);
      await expect(
        postQuickCashSale(tx, {
          companyId: ORG,
          userId: USER_ID,
          date: "2099-02-01",
          amount: "10000",
          accountId: acc["1300"], // persediaan, bukan akun berkelas kas/bank
          revenueAccountId: acc["4000"],
          taxIncluded: false,
          taxRate: "11",
        }),
      ).rejects.toThrow(/bukan akun berkelas kas, bank, atau kliring/);
    });
  });

  it("terima piutang FIFO melunasi dua dokumen tertua dan menolak kelebihan", async () => {
    await rollbackTransaction(async (tx) => {
      const older = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerId,
        date: "2099-01-05",
        amount: "50000",
        reference: "QE-FIFO-1",
      });
      const newer = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerId,
        date: "2099-01-10",
        amount: "30000",
        reference: "QE-FIFO-2",
      });

      const result = await receiveReceivableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        customerId,
        date: "2099-02-01",
        amount: "65000",
        accountId: acc["1000"],
      });
      expect(result.numbers).toHaveLength(2);
      expect(result.allocations.map((row) => [row.number, d(row.amount).toFixed(0)])).toEqual([
        [older.number, "50000"],
        [newer.number, "15000"],
      ]);

      const docs = await listOpenReceivableDocs(tx, ORG, customerId);
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe(newer.id);
      expect(docs[0].outstanding.toFixed(0)).toBe("15000");

      // A-21 (R3-02): penerimaan melebihi total piutang terbuka
      // TIDAK lagi ditolak — alokasi menutup sisa 15000 dan
      // kelebihannya (1) menjadi kredit pelanggan.
      const over = await receiveReceivableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        customerId,
        date: "2099-02-01",
        amount: "15001",
        accountId: acc["1000"],
      });
      expect(over.allocations.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(15000);
      expect(over.creditNumber).toBeTruthy();
      expect(d(over.creditAmount ?? "0").eq(1)).toBe(true);
    });
  });

  it("bayar utang FIFO menghormati alokasi retur pemasok", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await createReceipt(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date: "2099-01-03",
        lines: [{ productId, qty: "10", unitCost: "5000" }],
      });
      // Retur 4 unit @ AVCO 5.000 = 20.000 menyelesaikan sebagian utang
      // tanpa kas (alokasi A-9) — sisa utang kas tinggal 30.000.
      const ret = await createSupplierReturn(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId,
        warehouseId,
        date: "2099-01-04",
        reasonCategory: "damaged",
        reasonDetail: "Kemasan rusak saat tiba",
        resolutionType: "refund",
        lines: [{ productId, qty: "4" }],
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });

      const result = await payPayableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId,
        date: "2099-02-01",
        amount: "30000",
        accountId: acc["1000"],
      });
      expect(result.allocations.map((row) => d(row.amount).toFixed(0))).toEqual(["30000"]);

      const [receiptAfter] = await tx
        .select({ paidAmount: stockReceipts.paidAmount, paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts)
        .where(and(eq(stockReceipts.companyId, ORG), eq(stockReceipts.id, receipt.id)));
      expect(d(receiptAfter.paidAmount).toFixed(0)).toBe("30000");
      expect(receiptAfter.paymentStatus).toBe("paid");

      const payments = await tx
        .select({ amount: partyPayments.amount })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.receiptId, receipt.id)));
      expect(payments.reduce((sum, row) => sum.plus(d(row.amount)), d(0)).toFixed(0)).toBe("30000");

      // A-21 (R3-02): pembayaran sesudah utang lunas TIDAK lagi
      // ditolak — seluruhnya menjadi kredit pemasok (uang muka).
      const over = await payPayableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId,
        date: "2099-02-01",
        amount: "1",
        accountId: acc["1000"],
      });
      expect(over.allocations).toHaveLength(0);
      expect(over.creditNumber).toBeTruthy();
      expect(d(over.creditAmount ?? "0").eq(1)).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Aksi (ter-commit di perusahaan uji, sesi mock)                      */
/* ------------------------------------------------------------------ */

describe("aksi quick-entry", () => {
  it("posting penjualan tunai tanpa pajak + replay idempoten mengembalikan hasil yang sama", async () => {
    const key = `qe-sale-${RUN}`;
    const payload = {
      kind: "cash_sale" as const,
      date: "2099-02-02",
      amount: "75000",
      accountId: acc["1000"],
      counterAccountId: acc["4000"],
      taxIncluded: false,
      notes: "Penjualan jasa QE",
    };
    const first = await postQuickEntryAction({ payload, idempotencyKey: key });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    expect(first.data.numbers).toHaveLength(1);

    const replay = await postQuickEntryAction({ payload, idempotencyKey: key });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.message);
    expect(replay.data.numbers).toEqual(first.data.numbers);

    const journalCount = await withCompanyReadOnly(ORG, async (tx) => {
      const rows = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.idempotencyKey, `quick_entry:${key}`),
          ),
        );
      return rows.length;
    });
    expect(journalCount).toBe(1);

    const [entry] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: journalEntries.id, sourceType: journalEntries.sourceType })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.idempotencyKey, `quick_entry:${key}`),
          ),
        )
        .limit(1),
    );
    expect(entry.sourceType).toBe("quick_cash_sale");
    const lines = await journalLinesByAccount(entry.id);
    expect(d(lines.get(acc["1000"])!.debit).toFixed(0)).toBe("75000");
    expect(d(lines.get(acc["4000"])!.credit).toFixed(0)).toBe("75000");
  });

  it("posting penjualan tunai termasuk pajak 11% perusahaan: Cr pendapatan bersih + Cr PPN", async () => {
    const result = await postQuickEntryAction({
      payload: {
        kind: "cash_sale",
        date: "2099-02-02",
        amount: "111000",
        accountId: acc["1100"],
        counterAccountId: acc["4000"],
        taxIncluded: true,
      },
      idempotencyKey: `qe-tax-${RUN}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const [entry] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.number, result.data.numbers[0])))
        .limit(1),
    );
    const lines = await journalLinesByAccount(entry.id);
    expect(d(lines.get(acc["1100"])!.debit).toFixed(0)).toBe("111000");
    expect(d(lines.get(acc["4000"])!.credit).toFixed(0)).toBe("100000");
    expect(d(lines.get(acc["2200"])!.credit).toFixed(0)).toBe("11000");
  });

  it("posting beban lewat modal menjadi dokumen beban beneran", async () => {
    const result = await postQuickEntryAction({
      payload: {
        kind: "expense",
        date: "2099-02-02",
        amount: "250000",
        accountId: acc["1000"],
        counterAccountId: acc["6100"],
        notes: "Listrik toko QE",
      },
      idempotencyKey: `qe-exp-${RUN}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const [expense] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: expenses.id, number: expenses.number, amount: expenses.amount })
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.number, result.data.numbers[0])))
        .limit(1),
    );
    expect(expense.number).toMatch(/^EXP-/);
    expect(d(expense.amount).toFixed(0)).toBe("250000");
  });

  it("posting transfer lewat modal memakai domain transfer bank yang ada", async () => {
    const result = await postQuickEntryAction({
      payload: {
        kind: "transfer",
        date: "2099-02-02",
        amount: "25000",
        fromAccountId: acc["1000"],
        toAccountId: acc["1100"],
        notes: "Setoran harian QE",
      },
      idempotencyKey: `qe-trf-${RUN}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const [transfer] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: bankTransfers.id, number: bankTransfers.number, amount: bankTransfers.amount })
        .from(bankTransfers)
        .where(and(eq(bankTransfers.companyId, ORG), eq(bankTransfers.number, result.data.numbers[0])))
        .limit(1),
    );
    expect(d(transfer.amount).toFixed(0)).toBe("25000");
  });

  it("posting transfer dengan biaya admin: jurnal persis jalur khusus + replay idempoten", async () => {
    const key = `qe-trf-fee-${RUN}`;
    const payload = {
      kind: "transfer" as const,
      date: "2099-02-02",
      amount: "100000",
      fee: "6500",
      fromAccountId: acc["1000"],
      toAccountId: acc["1100"],
      notes: "Setoran QE berbiaya",
    };
    const first = await postQuickEntryAction({ payload, idempotencyKey: key });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    expect(first.data.numbers).toHaveLength(1);

    const [transfer] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({
          id: bankTransfers.id,
          number: bankTransfers.number,
          amount: bankTransfers.amount,
          fee: bankTransfers.fee,
        })
        .from(bankTransfers)
        .where(and(eq(bankTransfers.companyId, ORG), eq(bankTransfers.number, first.data.numbers[0])))
        .limit(1),
    );
    expect(d(transfer.amount).toFixed(0)).toBe("100000");
    expect(d(transfer.fee).toFixed(0)).toBe("6500");

    // Jurnal sumber transfer: urutan & deskripsi PERSIS createBankTransfer —
    // Dr tujuan "Dana diterima", Dr 6060 (pemetaan bank_fee) "Biaya
    // administrasi bank", Cr asal sebesar nominal+biaya "Dana keluar".
    const [entry] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "bank_transfer"),
            eq(journalEntries.sourceId, transfer.id),
          ),
        )
        .limit(1),
    );
    const lines = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({
          accountId: journalLines.accountId,
          debit: journalLines.debit,
          credit: journalLines.credit,
          description: journalLines.description,
        })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ORG), eq(journalLines.entryId, entry.id)))
        .orderBy(journalLines.lineNo),
    );
    expect(lines.map((line) => [line.accountId, d(line.debit).toFixed(0), d(line.credit).toFixed(0), line.description])).toEqual([
      [acc["1100"], "100000", "0", "Dana diterima"],
      [acc["6060"], "6500", "0", "Biaya administrasi bank"],
      [acc["1000"], "0", "106500", "Dana keluar"],
    ]);

    // Replay dengan kunci yang sama: hasil sama, tidak ada transfer/jurnal ganda.
    const replay = await postQuickEntryAction({ payload, idempotencyKey: key });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.message);
    expect(replay.data.numbers).toEqual(first.data.numbers);
    const counts = await withCompanyReadOnly(ORG, async (tx) => {
      const transferRows = await tx
        .select({ id: bankTransfers.id })
        .from(bankTransfers)
        .where(and(eq(bankTransfers.companyId, ORG), eq(bankTransfers.number, first.data.numbers[0])));
      const entryRows = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.companyId, ORG), eq(journalEntries.idempotencyKey, `bank_transfer:${transfer.id}`)),
        );
      return { transfers: transferRows.length, entries: entryRows.length };
    });
    expect(counts).toEqual({ transfers: 1, entries: 1 });
  });

  it("draf transfer lama tanpa field biaya tetap terposting sebagai biaya 0", async () => {
    // Payload berbentuk pra-fitur (tanpa fee sama sekali), seperti draf
    // yang tersimpan sebelum kolom biaya ada.
    const saved = await saveQuickEntryDraftAction({
      payload: {
        kind: "transfer",
        date: "2099-02-02",
        amount: "40000",
        fromAccountId: acc["1000"],
        toAccountId: acc["1100"],
      },
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.message);
    const draftId = saved.data.id;
    const listed = await listQuickEntryDraftsAction();
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.message);
    const draft = listed.data.find((row) => row.id === draftId)!;
    expect("fee" in draft.payload).toBe(false);

    const posted = await postQuickEntryAction({
      payload: draft.payload as never,
      idempotencyKey: `qe-trf-legacy-${RUN}`,
      draftId,
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) throw new Error(posted.message);
    const [transfer] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: bankTransfers.id, fee: bankTransfers.fee })
        .from(bankTransfers)
        .where(and(eq(bankTransfers.companyId, ORG), eq(bankTransfers.number, posted.data.numbers[0])))
        .limit(1),
    );
    expect(d(transfer.fee).toFixed(0)).toBe("0");
    const [entry] = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "bank_transfer"),
            eq(journalEntries.sourceId, transfer.id),
          ),
        )
        .limit(1),
    );
    const lineCount = await withCompanyReadOnly(ORG, async (tx) => {
      const rows = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ORG), eq(journalLines.entryId, entry.id)));
      return rows.length;
    });
    expect(lineCount).toBe(2);
  });

  it("posting transfer menolak biaya negatif dan rekening asal = tujuan", async () => {
    const negative = await postQuickEntryAction({
      payload: {
        kind: "transfer",
        date: "2099-02-02",
        amount: "10000",
        fee: "-100",
        fromAccountId: acc["1000"],
        toAccountId: acc["1100"],
      },
      idempotencyKey: `qe-trf-neg-${RUN}`,
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.message).toMatch(/tidak boleh negatif/);

    const sameAccount = await postQuickEntryAction({
      payload: {
        kind: "transfer",
        date: "2099-02-02",
        amount: "10000",
        fee: "1000",
        fromAccountId: acc["1000"],
        toAccountId: acc["1000"],
      },
      idempotencyKey: `qe-trf-same-${RUN}`,
    });
    expect(sameAccount.ok).toBe(false);
    if (!sameAccount.ok) expect(sameAccount.message).toMatch(/harus berbeda/);
  });

  it("posting terima piutang FIFO lewat aksi melunasi dokumen tertua dulu", async () => {
    const openings = await withCompany(ORG, async (tx) => {
      const older = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerBId,
        date: "2099-01-05",
        amount: "50000",
        reference: "QE-AKSI-1",
      });
      const newer = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerBId,
        date: "2099-01-10",
        amount: "30000",
        reference: "QE-AKSI-2",
      });
      return { older, newer };
    });

    const result = await postQuickEntryAction({
      payload: {
        kind: "receive",
        date: "2099-02-02",
        amount: "65000",
        accountId: acc["1000"],
        partyId: customerBId,
      },
      idempotencyKey: `qe-recv-${RUN}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.allocations?.map((row) => d(row.amount).toFixed(0))).toEqual(["50000", "15000"]);

    const docs = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ id: partyOpeningBalances.id, status: partyOpeningBalances.status, paidAmount: partyOpeningBalances.paidAmount })
        .from(partyOpeningBalances)
        .where(eq(partyOpeningBalances.companyId, ORG)),
    );
    const olderAfter = docs.find((doc) => doc.id === openings.older.id)!;
    const newerAfter = docs.find((doc) => doc.id === openings.newer.id)!;
    expect(olderAfter.status).toBe("settled");
    expect(newerAfter.status).toBe("open");
    expect(d(newerAfter.paidAmount).toFixed(0)).toBe("15000");
  });

  it("draf: simpan → muat → posting → draf hilang; payload rusak ditolak validasi normal", async () => {
    // Simpan draf setengah terisi (sah untuk draf).
    const saved = await saveQuickEntryDraftAction({
      payload: { kind: "receive", date: "2099-02-03", amount: "", partyId: customerBId, accountId: acc["1000"] },
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.message);
    const draftId = saved.data.id;

    const listed = await listQuickEntryDraftsAction();
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.message);
    const mine = listed.data.find((row) => row.id === draftId);
    expect(mine?.payload.partyId).toBe(customerBId);

    // Posting dari draf dengan payload lengkap (sisa piutang pelanggan B
    // tinggal 15.000 dari test FIFO sebelumnya) → draf ikut terhapus.
    const posted = await postQuickEntryAction({
      payload: {
        kind: "receive",
        date: "2099-02-03",
        amount: "15000",
        accountId: acc["1000"],
        partyId: customerBId,
      },
      idempotencyKey: `qe-draft-post-${RUN}`,
      draftId,
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) throw new Error(posted.message);
    const afterPost = await listQuickEntryDraftsAction();
    expect(afterPost.ok).toBe(true);
    if (!afterPost.ok) throw new Error(afterPost.message);
    expect(afterPost.data.some((row) => row.id === draftId)).toBe(false);

    // Draf yang payload-nya dirusak di DB: dimuat apa adanya, tetapi
    // posting menolaknya lewat validasi normal.
    const saved2 = await saveQuickEntryDraftAction({
      payload: { kind: "receive", date: "2099-02-03", amount: "1000", partyId: customerBId, accountId: acc["1000"] },
    });
    expect(saved2.ok).toBe(true);
    if (!saved2.ok) throw new Error(saved2.message);
    const tamperedId = saved2.data.id;
    await withCompany(ORG, (tx) =>
      tx
        .update(quickEntryDrafts)
        .set({
          payload: {
            kind: "receive",
            date: "2099-02-03",
            amount: "-100",
            partyId: customerBId,
            accountId: acc["1000"],
          },
        })
        .where(and(eq(quickEntryDrafts.companyId, ORG), eq(quickEntryDrafts.id, tamperedId))),
    );
    const tamperedList = await listQuickEntryDraftsAction();
    expect(tamperedList.ok).toBe(true);
    if (!tamperedList.ok) throw new Error(tamperedList.message);
    const tampered = tamperedList.data.find((row) => row.id === tamperedId)!;
    const rejected = await postQuickEntryAction({
      payload: tampered.payload as never,
      idempotencyKey: `qe-tamper-${RUN}`,
      draftId: tamperedId,
    });
    expect(rejected.ok).toBe(false);
    // Draf tetap ada karena postingnya gagal.
    const stillThere = await listQuickEntryDraftsAction();
    expect(stillThere.ok).toBe(true);
    if (!stillThere.ok) throw new Error(stillThere.message);
    expect(stillThere.data.some((row) => row.id === tamperedId)).toBe(true);

    const cleaned = await deleteQuickEntryDraftAction({ id: tamperedId });
    expect(cleaned.ok).toBe(true);
  });

  it("getAccountMap perusahaan uji memuat tax_output (sanity bootstrap)", async () => {
    const map = await withCompanyReadOnly(ORG, (tx) => getAccountMap(tx, ORG));
    expect(map.tax_output).toBe(acc["2200"]);
    expect(map.revenue).toBe(acc["4000"]);
  });
});
