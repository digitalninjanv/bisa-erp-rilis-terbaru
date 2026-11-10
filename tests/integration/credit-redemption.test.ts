import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  cashMovements,
  cashSessions,
  companySettings,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  saleReturns,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { createSale, createSaleReturn, getReturnCredit, quoteCart, voidSale } from "@/server/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";

// Tahap 4 batch T4-3: penebusan Kredit Pelanggan (D-12, menutup lingkaran
// D-8). Kredit dari retur exchange/store_credit ditebus berdasarkan nomor
// dokumen retur: createSale men-debit akun liabilitas 2300 lewat kaki
// pembayaran metode bertipe customer_credit, pemakaian dilacak di
// sale_returns.credit_used di bawah kunci baris retur, dan void penjualan
// penebus mengembalikannya. Skenario memakai transaksi commit di
// perusahaan uji tersendiri — kunci baris hanya terlihat antar-transaksi
// dan jurnal perusahaan demo tidak boleh tercemar.

const ORG = "01900000-0000-7000-8000-00000000aa07";
const DEMO_ORG = "01900000-0000-7000-8000-000000000001";
const USER_A = "user-uji-kredit-a";
const USER_B = "user-uji-kredit-b";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function orgTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG}, true)`);
    return fn(tx);
  });
}

class Rollback extends Error {}

async function demoRead<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let value: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${DEMO_ORG}, true)`);
      value = await fn(tx);
      throw new Rollback("rollback read");
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return value as T;
}

/** Fixture perusahaan uji: akun + pemetaan (termasuk customer_credit →
 * 2300), gudang, metode Tunai + Kredit Pelanggan, sesi terbuka dua kasir.
 * Idempoten antar-run. */
async function ensureCompany(tx: Tx) {
  const [existing] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, ORG))
    .limit(1);
  if (existing) return;

  await tx.insert(companySettings).values({ companyId: ORG, legalName: "Uji Penebusan Kredit" });

  const accountSeeds: Array<[string, string, string, "debit" | "credit"]> = [
    ["1000", "Kas", "asset", "debit"],
    ["1100", "Bank BCA", "asset", "debit"],
    ["1110", "QRIS Clearing", "asset", "debit"],
    ["1200", "Piutang Usaha", "asset", "debit"],
    ["1300", "Persediaan Barang Dagang", "asset", "debit"],
    ["2000", "Utang Usaha", "liability", "credit"],
    ["2100", "Utang Gaji", "liability", "credit"],
    ["2200", "PPN Keluaran", "liability", "credit"],
    ["2300", "Kredit Pelanggan", "liability", "credit"],
    ["3000", "Modal Pemilik", "equity", "credit"],
    ["4000", "Penjualan", "revenue", "credit"],
    ["4010", "Diskon Penjualan", "revenue", "debit"],
    ["4020", "Retur Penjualan", "revenue", "debit"],
    ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
    ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
    ["5010", "Selisih Persediaan", "cogs", "debit"],
    ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
    ["6000", "Beban Gaji Karyawan", "expense", "debit"],
    ["6060", "Beban Administrasi Bank", "expense", "debit"],
    ["8000", "Selisih Kas Kurang", "expense", "debit"],
    ["8001", "Selisih Kas Lebih", "revenue", "credit"],
    ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
    ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
  ];
  const accountRows = await tx
    .insert(accounts)
    .values(
      accountSeeds.map(([code, name, type, normalBalance]) => ({
        companyId: ORG,
        code,
        name,
        type,
        normalBalance,
      })),
    )
    .returning();
  const acc = new Map(accountRows.map((a) => [a.code, a.id]));
  const mapping: Record<string, string> = {
    cash: acc.get("1000")!,
    bank: acc.get("1100")!,
    qris: acc.get("1110")!,
    receivable: acc.get("1200")!,
    inventory: acc.get("1300")!,
    payable: acc.get("2000")!,
    revenue: acc.get("4000")!,
    sales_discount: acc.get("4010")!,
    sales_return: acc.get("4020")!,
    cogs: acc.get("5000")!,
    inventory_shrink: acc.get("5010")!,
    damaged: acc.get("5020")!,
    tax_output: acc.get("2200")!,
    rounding_gain: acc.get("9000")!,
    rounding_loss: acc.get("9001")!,
    cash_short: acc.get("8000")!,
    cash_over: acc.get("8001")!,
    salary_expense: acc.get("6000")!,
    salary_payable: acc.get("2100")!,
    bank_fee: acc.get("6060")!,
    equity: acc.get("3000")!,
    customer_credit: acc.get("2300")!,
  };
  await tx.insert(accountMappings).values(
    Object.entries(mapping).map(([key, accountId]) => ({ companyId: ORG, key, accountId })),
  );
  await tx.insert(warehouses).values({
    companyId: ORG,
    code: "GD-KREDIT",
    name: "Gudang Uji Kredit",
    type: "warehouse",
    isDefault: true,
  });
  await tx.insert(paymentMethods).values([
    {
      companyId: ORG,
      code: "CASH",
      name: "Tunai",
      type: "cash",
      accountId: acc.get("1000")!,
      sortOrder: 1,
    },
    {
      companyId: ORG,
      code: "CUSTCREDIT",
      name: "Kredit Pelanggan",
      type: "customer_credit",
      accountId: acc.get("2300")!,
      sortOrder: 5,
    },
  ]);
  await tx.insert(cashSessions).values([
    { companyId: ORG, userId: USER_A, openingCash: "0", status: "open" },
    { companyId: ORG, userId: USER_B, openingCash: "0", status: "open" },
  ]);
}

async function warehouse(tx: Tx) {
  const [row] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function methodByType(tx: Tx, type: string) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG), eq(paymentMethods.type, type)))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function accountByCode(tx: Tx, code: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  expect(account).toBeDefined();
  return account;
}

async function makeProduct(
  tx: Tx,
  warehouseId: string,
  input: { price: string; cost: string; stock: string },
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG,
      sku: `TST-KREDIT-${suffix}`,
      name: "Produk Uji Penebusan Kredit",
      costPrice: input.cost,
      salePrice: input.price,
    })
    .returning({ id: products.id });
  await tx.insert(stockMovements).values({
    companyId: ORG,
    warehouseId,
    productId: product.id,
    movementType: "opening",
    qty: input.stock,
    unitCost: input.cost,
    referenceType: "opening",
    createdBy: USER_A,
  });
  await tx.insert(stockOnHand).values({
    companyId: ORG,
    warehouseId,
    productId: product.id,
    qty: input.stock,
  });
  return product.id;
}

async function buyWithPayments(
  tx: Tx,
  input: {
    userId: string;
    warehouseId: string;
    productId: string;
    qty: number;
    payments: { methodId: string; amount: number; tendered?: number; reference?: string }[];
  },
) {
  const lines = [{ productId: input.productId, qty: input.qty }];
  return createSale(tx, {
    companyId: ORG,
    userId: input.userId,
    warehouseId: input.warehouseId,
    date: todayISO(),
    lines,
    payments: input.payments,
    idempotencyKey: crypto.randomUUID(),
  });
}

/** Jual tunai lalu retur seluruhnya — menghasilkan dokumen retur dengan
 * metode penyelesaian yang diminta. */
async function makeReturnFull(
  tx: Tx,
  input: {
    warehouseId: string;
    productId: string;
    qty: number;
    refundMethod: "cash" | "transfer" | "store_credit" | "exchange";
    type: "return" | "exchange";
  },
) {
  const cash = await methodByType(tx, "cash");
  const lines = [{ productId: input.productId, qty: input.qty }];
  const quote = await quoteCart(tx, { companyId: ORG, warehouseId: input.warehouseId, lines });
  const sale = await createSale(tx, {
    companyId: ORG,
    userId: USER_A,
    warehouseId: input.warehouseId,
    date: todayISO(),
    lines,
    payments: [{ methodId: cash.id, amount: quote.total, tendered: quote.total }],
    idempotencyKey: crypto.randomUUID(),
  });
  const ret = await createSaleReturn(tx, {
    companyId: ORG,
    userId: USER_A,
    saleId: sale.id,
    date: todayISO(),
    reason: "Uji penebusan kredit",
    refundMethod: input.refundMethod,
    type: input.type,
    lines: [{ productId: input.productId, qty: input.qty }],
  });
  return { sale, ret };
}

async function returnRow(tx: Tx, returnId: string) {
  const [row] = await tx
    .select()
    .from(saleReturns)
    .where(and(eq(saleReturns.companyId, ORG), eq(saleReturns.id, returnId)))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function journalLinesFor(tx: Tx, sourceType: string, sourceId: string) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );
  expect(entries).toHaveLength(1);
  return tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entries[0].id));
}

function debitOn(lines: Awaited<ReturnType<typeof journalLinesFor>>, accountId: string) {
  return lines
    .filter((line) => line.accountId === accountId)
    .reduce((acc, line) => acc.plus(d(line.debit)), d(0));
}

describe("T4-3 / D-12 — penebusan Kredit Pelanggan di POS", () => {
  it("retur exchange → kredit ditebus sebagian, sisanya tunai: jurnal Dr 2300 & Dr Kas benar, credit_used naik", async () => {
    const ctx = await orgTx(async (tx) => {
      await ensureCompany(tx);
      const wh = await warehouse(tx);
      const cash = await methodByType(tx, "cash");
      const credit = await methodByType(tx, "customer_credit");
      const kas = await accountByCode(tx, "1000");
      const liabilitas = await accountByCode(tx, "2300");

      const returnedProduct = await makeProduct(tx, wh.id, { price: "10000", cost: "6000", stock: "10" });
      const { ret } = await makeReturnFull(tx, {
        warehouseId: wh.id,
        productId: returnedProduct,
        qty: 3,
        refundMethod: "exchange",
        type: "exchange",
      });
      expect(ret.total).toBe(30000);

      const info = await getReturnCredit(tx, ORG, ret.number);
      expect(info).not.toBeNull();
      expect(info!.total).toBe(30000);
      expect(info!.used).toBe(0);
      expect(info!.available).toBe(30000);

      const boughtProduct = await makeProduct(tx, wh.id, { price: "50000", cost: "30000", stock: "5" });
      const sale = await buyWithPayments(tx, {
        userId: USER_A,
        warehouseId: wh.id,
        productId: boughtProduct,
        qty: 1,
        payments: [
          { methodId: credit.id, amount: 30000, reference: ret.number },
          { methodId: cash.id, amount: 20000, tendered: 20000 },
        ],
      });
      expect(sale.total).toBe(50000);

      const lines = await journalLinesFor(tx, "sale", sale.id);
      expect(debitOn(lines, liabilitas.id).toFixed(4)).toBe("30000.0000");
      expect(debitOn(lines, kas.id).toFixed(4)).toBe("20000.0000");
      const totalDebit = lines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
      const totalCredit = lines.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
      expect(totalDebit.toFixed(4)).toBe(totalCredit.toFixed(4));

      // Mutasi laci hanya memuat porsi tunai; kredit bukan uang laci.
      const movements = await tx
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.companyId, ORG), eq(cashMovements.referenceId, sale.id)));
      expect(movements).toHaveLength(1);
      expect(d(movements[0].amount).toFixed(4)).toBe("20000.0000");

      const row = await returnRow(tx, ret.id);
      expect(d(row.creditUsed).toFixed(4)).toBe("30000.0000");
      const after = await getReturnCredit(tx, ORG, ret.number);
      expect(after!.available).toBe(0);
      return { retNumber: ret.number };
    });
    expect(ctx.retNumber).toMatch(/^RTN-/);
  });

  it("pemakaian melebihi sisa kredit ditolak; sisa parsial tetap bisa dipakai persis sebesar sisa", async () => {
    await orgTx(async (tx) => {
      await ensureCompany(tx);
      const wh = await warehouse(tx);
      const credit = await methodByType(tx, "customer_credit");

      const returnedProduct = await makeProduct(tx, wh.id, { price: "10000", cost: "6000", stock: "10" });
      const { ret } = await makeReturnFull(tx, {
        warehouseId: wh.id,
        productId: returnedProduct,
        qty: 1,
        refundMethod: "store_credit",
        type: "return",
      });
      expect(ret.total).toBe(10000);

      const boughtProduct = await makeProduct(tx, wh.id, { price: "20000", cost: "12000", stock: "5" });
      // Tagihan 20.000, kredit hanya 10.000: membayar 15.000 dari kredit
      // lolos cek sisa tagihan tetapi melebihi sisa kredit → ditolak.
      let error: unknown;
      try {
        await buyWithPayments(tx, {
          userId: USER_A,
          warehouseId: wh.id,
          productId: boughtProduct,
          qty: 1,
          payments: [{ methodId: credit.id, amount: 15000, reference: ret.number }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as { message?: string }).message ?? "").toMatch(/kredit/i);

      const row = await returnRow(tx, ret.id);
      expect(d(row.creditUsed).toFixed(4)).toBe("0.0000");
    });
  });

  it("dua checkout bersamaan memperebutkan kredit yang sama: tepat satu yang lolos sebesar sisa", async () => {
    const setup = await orgTx(async (tx) => {
      await ensureCompany(tx);
      const wh = await warehouse(tx);
      const credit = await methodByType(tx, "customer_credit");
      const returnedProduct = await makeProduct(tx, wh.id, { price: "25000", cost: "15000", stock: "10" });
      const { ret } = await makeReturnFull(tx, {
        warehouseId: wh.id,
        productId: returnedProduct,
        qty: 1,
        refundMethod: "exchange",
        type: "exchange",
      });
      const boughtProduct = await makeProduct(tx, wh.id, { price: "25000", cost: "15000", stock: "10" });
      return { warehouseId: wh.id, creditMethodId: credit.id, retId: ret.id, retNumber: ret.number, boughtProduct };
    });

    const attempt = (userId: string) =>
      orgTx((tx) =>
        buyWithPayments(tx, {
          userId,
          warehouseId: setup.warehouseId,
          productId: setup.boughtProduct,
          qty: 1,
          payments: [{ methodId: setup.creditMethodId, amount: 25000, reference: setup.retNumber }],
        }),
      );

    const results = await Promise.allSettled([attempt(USER_A), attempt(USER_B)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string; message?: string };
    expect(reason.code).toBe("VALIDATION");
    expect(reason.message ?? "").toMatch(/kredit/i);

    await orgTx(async (tx) => {
      const row = await returnRow(tx, setup.retId);
      // Tepat satu pemakaian penuh — bukan dua kali lipat.
      expect(d(row.creditUsed).toFixed(4)).toBe("25000.0000");
    });
  });

  it("void penjualan penebus mengembalikan credit_used dan sisa kredit pulih", async () => {
    await orgTx(async (tx) => {
      await ensureCompany(tx);
      const wh = await warehouse(tx);
      const cash = await methodByType(tx, "cash");
      const credit = await methodByType(tx, "customer_credit");

      const returnedProduct = await makeProduct(tx, wh.id, { price: "10000", cost: "6000", stock: "10" });
      const { ret } = await makeReturnFull(tx, {
        warehouseId: wh.id,
        productId: returnedProduct,
        qty: 2,
        refundMethod: "store_credit",
        type: "return",
      });
      expect(ret.total).toBe(20000);

      const boughtProduct = await makeProduct(tx, wh.id, { price: "20000", cost: "12000", stock: "5" });
      const sale = await buyWithPayments(tx, {
        userId: USER_A,
        warehouseId: wh.id,
        productId: boughtProduct,
        qty: 1,
        payments: [
          { methodId: credit.id, amount: 12000, reference: ret.number },
          { methodId: cash.id, amount: 8000, tendered: 8000 },
        ],
      });
      expect(d((await returnRow(tx, ret.id)).creditUsed).toFixed(4)).toBe("12000.0000");

      await voidSale(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        reason: "Uji void penebusan kredit",
      });

      expect(d((await returnRow(tx, ret.id)).creditUsed).toFixed(4)).toBe("0.0000");
      const info = await getReturnCredit(tx, ORG, ret.number);
      expect(info!.available).toBe(20000);
    });
  });

  it("retur refund tunai tidak memiliki kredit: getReturnCredit null dan penebusan atas nomornya ditolak", async () => {
    await orgTx(async (tx) => {
      await ensureCompany(tx);
      const wh = await warehouse(tx);
      const credit = await methodByType(tx, "customer_credit");

      const returnedProduct = await makeProduct(tx, wh.id, { price: "10000", cost: "6000", stock: "10" });
      const { ret } = await makeReturnFull(tx, {
        warehouseId: wh.id,
        productId: returnedProduct,
        qty: 1,
        refundMethod: "cash",
        type: "return",
      });

      expect(await getReturnCredit(tx, ORG, ret.number)).toBeNull();

      const boughtProduct = await makeProduct(tx, wh.id, { price: "10000", cost: "6000", stock: "5" });
      let error: unknown;
      try {
        await buyWithPayments(tx, {
          userId: USER_A,
          warehouseId: wh.id,
          productId: boughtProduct,
          qty: 1,
          payments: [{ methodId: credit.id, amount: 10000, reference: ret.number }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
    });
  });

  it("nomor retur perusahaan lain tidak terlihat, dan nomor acak ditolak saat checkout", async () => {
    const { retNumber } = await orgTx(async (tx) => {
      await ensureCompany(tx);
      const wh = await warehouse(tx);
      const returnedProduct = await makeProduct(tx, wh.id, { price: "10000", cost: "6000", stock: "10" });
      const { ret } = await makeReturnFull(tx, {
        warehouseId: wh.id,
        productId: returnedProduct,
        qty: 1,
        refundMethod: "exchange",
        type: "exchange",
      });
      return { retNumber: ret.number };
    });

    // Dari konteks perusahaan demo, dokumen retur perusahaan uji tidak ada.
    const seen = await demoRead((tx) => getReturnCredit(tx, DEMO_ORG, retNumber));
    expect(seen).toBeNull();

    await orgTx(async (tx) => {
      const wh = await warehouse(tx);
      const credit = await methodByType(tx, "customer_credit");
      const boughtProduct = await makeProduct(tx, wh.id, { price: "10000", cost: "6000", stock: "5" });
      let error: unknown;
      try {
        await buyWithPayments(tx, {
          userId: USER_A,
          warehouseId: wh.id,
          productId: boughtProduct,
          qty: 1,
          payments: [{ methodId: credit.id, amount: 5000, reference: "RTN-1999-99999" }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as { message?: string }).message ?? "").toMatch(/tidak ditemukan/);
    });
  });
});
