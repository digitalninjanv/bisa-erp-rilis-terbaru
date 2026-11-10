import { describe, expect, it } from "vitest";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  cashMovements,
  cashSessions,
  companySettings,
  customers,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  saleReturns,
  sales,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  closeCashSession,
  createSale,
  createSaleReturn,
  openCashSession,
  payReceivable,
  quoteCart,
} from "@/server/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Tahap 3 POS batch P3-1: POS-RET-01 (kunci baris penjualan saat retur),
// POS-RET-02 (tukar/kredit toko ke liabilitas Kredit pelanggan, refund tunai
// ke sesi pemroses — keputusan D-8), POS-PAY-01 (validasi akun pembayaran
// piutang). Pola rollback disalin dari tests/integration/sale-flow.test.ts;
// khusus uji konkurensi memakai transaksi yang benar-benar commit (kunci
// baris hanya terlihat antar-transaksi) di perusahaan uji tersendiri.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

// Perusahaan uji khusus skenario commit (konkurensi): terpisah dari
// perusahaan demo agar jurnal terpostingnya tidak pernah masuk rekonsiliasi
// suite lain.
const RACE_ORG = "01900000-0000-7000-8000-00000000aa01";
const RACE_USER = "user-uji-konkuren-retur";

async function raceTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${RACE_ORG}, true)`);
    return fn(tx);
  });
}

/** Buat fixture minimum perusahaan uji (akun + pemetaan + gudang + metode
 * bayar + sesi kas terbuka) bila belum ada; idempoten antar-run. */
async function ensureRaceCompany(tx: Tx) {
  const [existing] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, RACE_ORG))
    .limit(1);
  if (existing) return;

  await tx.insert(companySettings).values({ companyId: RACE_ORG, legalName: "Uji Konkurensi Retur" });

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
        companyId: RACE_ORG,
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
    Object.entries(mapping).map(([key, accountId]) => ({ companyId: RACE_ORG, key, accountId })),
  );
  await tx.insert(warehouses).values({
    companyId: RACE_ORG,
    code: "GD-UJI",
    name: "Gudang Uji",
    type: "warehouse",
    isDefault: true,
  });
  await tx.insert(paymentMethods).values({
    companyId: RACE_ORG,
    code: "CASH",
    name: "Tunai",
    type: "cash",
    accountId: acc.get("1000")!,
    sortOrder: 1,
  });
  await tx.insert(cashSessions).values({
    companyId: RACE_ORG,
    userId: RACE_USER,
    openingCash: "0",
    status: "open",
  });
}

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function stockedProduct(tx: Tx, warehouseId: string, minQty: number) {
  const [row] = await tx
    .select({ productId: stockOnHand.productId, qty: stockOnHand.qty })
    .from(stockOnHand)
    .innerJoin(products, eq(stockOnHand.productId, products.id))
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        gt(stockOnHand.qty, String(minQty)),
        eq(products.trackBatch, false),
      ),
    )
    .orderBy(asc(products.sku))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function methodByType(tx: Tx, type: string) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, type)))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function accountByCode(tx: Tx, code: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  expect(account).toBeDefined();
  return account;
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? "0");
}

async function makeSale(
  tx: Tx,
  input: {
    warehouseId: string;
    productId: string;
    qty: number;
    methodId: string;
    customerId?: string | null;
  },
) {
  const lines = [{ productId: input.productId, qty: input.qty }];
  const quote = await quoteCart(tx, {
    companyId: ORG_ID,
    warehouseId: input.warehouseId,
    customerId: input.customerId ?? null,
    lines,
  });
  const sale = await createSale(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId: input.warehouseId,
    customerId: input.customerId ?? null,
    // POS-1 (D-19): penjualan kredit kini wajib membawa jatuh tempo;
    // untuk metode lunas nilai ini diabaikan domain.
    dueDate: todayISO(),
    date: todayISO(),
    lines,
    payments: [{ methodId: input.methodId, amount: quote.total, tendered: quote.total }],
    idempotencyKey: crypto.randomUUID(),
  });
  return { sale, quote };
}

async function returnJournal(tx: Tx, returnId: string) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, "sale_return"),
        eq(journalEntries.sourceId, returnId),
      ),
    );
  expect(entries).toHaveLength(1);
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entries[0].id));
  return lines;
}

/** Credit-normal balance (credit − debit) of posted journal lines. */
async function creditBalance(tx: Tx, accountId: string) {
  const [row] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.status, "posted")));
  return d(row?.credit ?? "0").minus(d(row?.debit ?? "0"));
}

describe("POS-RET-01 — createSaleReturn mengunci penjualan asal", () => {
  it("retur parsial berurutan: panggilan kedua yang melebihi sisa ditolak, sisa terakhir menutup penjualan", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 5);
      const cash = await methodByType(tx, "cash");
      const before = await stockQty(tx, warehouse.id, product.productId);

      const { sale } = await makeSale(tx, {
        warehouseId: warehouse.id,
        productId: product.productId,
        qty: 5,
        methodId: cash.id,
      });

      const first = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji retur parsial pertama",
        refundMethod: "transfer",
        type: "return",
        lines: [{ productId: product.productId, qty: 3 }],
      });
      expect(first.total).toBeGreaterThan(0);

      let error: unknown;
      try {
        await createSaleReturn(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: todayISO(),
          reason: "Uji retur melebihi sisa",
          refundMethod: "transfer",
          type: "return",
          lines: [{ productId: product.productId, qty: 3 }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as { message: string }).message).toMatch(/melebihi sisa/);

      await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji retur sisa terakhir",
        refundMethod: "transfer",
        type: "return",
        lines: [{ productId: product.productId, qty: 2 }],
      });

      const [stored] = await tx
        .select({ status: sales.status })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const after = await stockQty(tx, warehouse.id, product.productId);
      return { status: stored.status, before, after };
    });

    expect(outcome.status).toBe("returned");
    expect(outcome.after.toFixed(4)).toBe(outcome.before.toFixed(4));
  });

  it("dua retur bersamaan untuk nota yang sama: tepat satu yang lolos (kunci FOR UPDATE)", async () => {
    // Kunci baris hanya terlihat ANTAR transaksi, jadi skenario ini memakai
    // transaksi yang benar-benar commit — di perusahaan uji tersendiri
    // (RACE_ORG) agar jurnal terpostingnya tidak mencemari pembukuan
    // perusahaan demo yang direkonsiliasi suite lain. Kedua retur memakai
    // tanggal di tahun fiskal berbeda agar tidak terserialisasi oleh kunci
    // baris urutan nomor dokumen SALE_RETURN — penjaga yang diuji di sini
    // adalah kunci baris penjualan itu sendiri.
    const today = todayISO();
    const lastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

    const setup = await raceTransaction(async (tx) => {
      await ensureRaceCompany(tx);
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, RACE_ORG), eq(warehouses.isDefault, true)))
        .limit(1);
      const [method] = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, RACE_ORG), eq(paymentMethods.type, "cash")))
        .limit(1);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: RACE_ORG,
          sku: `TST-RACE-${suffix}`,
          name: "Produk Uji Konkurensi Retur",
          costPrice: "2500",
          salePrice: "4000",
        })
        .returning({ id: products.id });
      await tx.insert(stockMovements).values({
        companyId: RACE_ORG,
        warehouseId: warehouse.id,
        productId: product.id,
        movementType: "opening",
        qty: "5",
        unitCost: "2500",
        referenceType: "opening",
        createdBy: RACE_USER,
      });
      await tx.insert(stockOnHand).values({
        companyId: RACE_ORG,
        warehouseId: warehouse.id,
        productId: product.id,
        qty: "5",
      });

      const lines = [{ productId: product.id, qty: 5 }];
      const quote = await quoteCart(tx, {
        companyId: RACE_ORG,
        warehouseId: warehouse.id,
        lines,
      });
      const sale = await createSale(tx, {
        companyId: RACE_ORG,
        userId: RACE_USER,
        warehouseId: warehouse.id,
        date: today,
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });
      return { saleId: sale.id, warehouseId: warehouse.id, productId: product.id };
    });

    const attempt = (date: string, reason: string) =>
      raceTransaction((tx) =>
        createSaleReturn(tx, {
          companyId: RACE_ORG,
          userId: RACE_USER,
          saleId: setup.saleId,
          date,
          reason,
          refundMethod: "transfer",
          type: "return",
          lines: [{ productId: setup.productId, qty: 4 }],
        }),
      );

    const results = await Promise.allSettled([
      attempt(today, "Uji konkurensi retur A"),
      attempt(lastYear, "Uji konkurensi retur B"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string; message?: string };
    expect(reason.code).toBe("VALIDATION");
    expect(reason.message ?? "").toMatch(/melebihi sisa/);

    // Retur sisa 1: seluruh 5 unit kembali, stok perusahaan uji utuh lagi.
    await raceTransaction(async (tx) => {
      await createSaleReturn(tx, {
        companyId: RACE_ORG,
        userId: RACE_USER,
        saleId: setup.saleId,
        date: today,
        reason: "Uji konkurensi retur penutup",
        refundMethod: "transfer",
        type: "return",
        lines: [{ productId: setup.productId, qty: 1 }],
      });
    });

    const check = await raceTransaction(async (tx) => {
      const [onHand] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, RACE_ORG),
            eq(stockOnHand.warehouseId, setup.warehouseId),
            eq(stockOnHand.productId, setup.productId),
          ),
        );
      const after = d(onHand?.qty ?? "0");
      const returns = await tx
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.companyId, RACE_ORG), eq(saleReturns.saleId, setup.saleId)));
      const [stored] = await tx
        .select({ status: sales.status })
        .from(sales)
        .where(and(eq(sales.companyId, RACE_ORG), eq(sales.id, setup.saleId)));
      return { after, returnCount: returns.length, status: stored.status };
    });
    expect(check.after.toFixed(4)).toBe("5.0000");
    // Satu pemenang balapan + satu retur penutup; transaksi yang kalah
    // ter-rollback penuh tanpa dokumen yatim.
    expect(check.returnCount).toBe(2);
    expect(check.status).toBe("returned");
  });
});

describe("POS-RET-02 — penyelesaian retur mengikuti D-8", () => {
  it("exchange: jurnal mengkredit Kredit pelanggan (21033), tanpa kaki kas dan tanpa mutasi sesi; saldo liabilitas naik", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 2);
      const cash = await methodByType(tx, "cash");
      const creditAccount = await accountByCode(tx, "210205");
      const cashAccount = await accountByCode(tx, "110107");
      const receivableAccount = await accountByCode(tx, "110301");
      const before = await stockQty(tx, warehouse.id, product.productId);
      const balanceBefore = await creditBalance(tx, creditAccount.id);

      const { sale } = await makeSale(tx, {
        warehouseId: warehouse.id,
        productId: product.productId,
        qty: 2,
        methodId: cash.id,
      });

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji tukar barang",
        refundMethod: "exchange",
        type: "exchange",
        lines: [{ productId: product.productId, qty: 2 }],
      });

      const lines = await returnJournal(tx, ret.id);
      const settle = lines.filter((line) => line.accountId === creditAccount.id);
      const balanceAfter = await creditBalance(tx, creditAccount.id);
      const movements = await tx
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.companyId, ORG_ID), eq(cashMovements.referenceId, ret.id)));
      const after = await stockQty(tx, warehouse.id, product.productId);
      return {
        ret,
        settleCount: settle.length,
        settleCredit: settle.length ? d(settle[0].credit).toNumber() : 0,
        cashLegs: lines.filter((line) => line.accountId === cashAccount.id).length,
        receivableLegs: lines.filter((line) => line.accountId === receivableAccount.id).length,
        balanceDelta: balanceAfter.minus(balanceBefore).toNumber(),
        movementCount: movements.length,
        before,
        after,
      };
    });

    expect(outcome.settleCount).toBe(1);
    expect(outcome.settleCredit).toBeCloseTo(outcome.ret.total, 4);
    expect(outcome.cashLegs).toBe(0);
    expect(outcome.receivableLegs).toBe(0);
    expect(outcome.balanceDelta).toBeCloseTo(outcome.ret.total, 4);
    expect(outcome.movementCount).toBe(0);
    expect(outcome.after.toFixed(4)).toBe(outcome.before.toFixed(4));
  });

  it("store_credit pada penjualan tunai: masuk Kredit pelanggan, akun piutang tidak bergerak", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 2);
      const cash = await methodByType(tx, "cash");
      const creditAccount = await accountByCode(tx, "210205");
      const cashAccount = await accountByCode(tx, "110107");
      const receivableAccount = await accountByCode(tx, "110301");

      const { sale } = await makeSale(tx, {
        warehouseId: warehouse.id,
        productId: product.productId,
        qty: 2,
        methodId: cash.id,
      });
      const receivableBefore = await creditBalance(tx, receivableAccount.id);

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji kredit toko",
        refundMethod: "store_credit",
        type: "return",
        lines: [{ productId: product.productId, qty: 1 }],
      });

      const lines = await returnJournal(tx, ret.id);
      const receivableAfter = await creditBalance(tx, receivableAccount.id);
      const movements = await tx
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.companyId, ORG_ID), eq(cashMovements.referenceId, ret.id)));
      return {
        ret,
        settle: lines.filter((line) => line.accountId === creditAccount.id),
        cashLegs: lines.filter((line) => line.accountId === cashAccount.id).length,
        receivableLegs: lines.filter((line) => line.accountId === receivableAccount.id).length,
        receivableDelta: receivableAfter.minus(receivableBefore).toNumber(),
        movementCount: movements.length,
      };
    });

    expect(outcome.settle).toHaveLength(1);
    expect(d(outcome.settle[0].credit).toNumber()).toBeCloseTo(outcome.ret.total, 4);
    expect(outcome.cashLegs).toBe(0);
    expect(outcome.receivableLegs).toBe(0);
    expect(outcome.receivableDelta).toBe(0);
    expect(outcome.movementCount).toBe(0);
  });

  it("exchange tanpa pemetaan customer_credit ditolak dengan pesan mengatur pemetaan, tanpa dokumen retur tertulis", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await tx
        .delete(accountMappings)
        .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, "customer_credit")));

      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 1);
      const cash = await methodByType(tx, "cash");
      const { sale } = await makeSale(tx, {
        warehouseId: warehouse.id,
        productId: product.productId,
        qty: 1,
        methodId: cash.id,
      });

      let error: unknown;
      try {
        await createSaleReturn(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: todayISO(),
          reason: "Uji tukar tanpa pemetaan",
          refundMethod: "exchange",
          type: "exchange",
          lines: [{ productId: product.productId, qty: 1 }],
        });
      } catch (caught) {
        error = caught;
      }

      const returns = await tx
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.companyId, ORG_ID), eq(saleReturns.saleId, sale.id)));
      return { error, returnCount: returns.length };
    });

    expect(outcome.error).toMatchObject({ code: "VALIDATION" });
    expect((outcome.error as { message: string }).message).toMatch(/customer_credit/);
    expect((outcome.error as { message: string }).message).toMatch(/belum dipetakan/);
    expect(outcome.returnCount).toBe(0);
  });

  it("refund tunai: ditolak tanpa sesi terbuka; dengan sesi baru tercatat di sesi pemroses, bukan sesi asal yang sudah ditutup", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 2);
      const cash = await methodByType(tx, "cash");

      const [originSession] = await tx
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.companyId, ORG_ID),
            eq(cashSessions.userId, USER_ID),
            eq(cashSessions.status, "open"),
          ),
        )
        .orderBy(desc(cashSessions.openedAt))
        .limit(1);
      expect(originSession).toBeDefined();

      const { sale } = await makeSale(tx, {
        warehouseId: warehouse.id,
        productId: product.productId,
        qty: 2,
        methodId: cash.id,
      });
      const [storedSale] = await tx
        .select({ sessionId: sales.sessionId })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      expect(storedSale.sessionId).toBe(originSession.id);

      // Tutup sesi asal dengan hitungan pas agar tidak ada jurnal selisih.
      const [movementSum] = await tx
        .select({ total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)` })
        .from(cashMovements)
        .where(eq(cashMovements.sessionId, originSession.id));
      await closeCashSession(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        sessionId: originSession.id,
        countedCash: movementSum.total,
      });

      let error: unknown;
      try {
        await createSaleReturn(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: todayISO(),
          reason: "Uji refund tanpa sesi",
          refundMethod: "cash",
          type: "return",
          lines: [{ productId: product.productId, qty: 1 }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as { message: string }).message).toBe(
        "Buka sesi kasir terlebih dahulu untuk memproses refund tunai.",
      );

      const newSession = await openCashSession(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingCash: "0",
      });

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji refund ke sesi berjalan",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.productId, qty: 1 }],
      });

      const movements = await tx
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.companyId, ORG_ID), eq(cashMovements.referenceId, ret.id)));
      return {
        ret,
        originSessionId: originSession.id,
        newSessionId: newSession.id,
        movements: movements.map((m) => ({
          sessionId: m.sessionId,
          type: m.type,
          amount: d(m.amount).toNumber(),
        })),
      };
    });

    expect(outcome.movements).toHaveLength(1);
    expect(outcome.movements[0].sessionId).toBe(outcome.newSessionId);
    expect(outcome.movements[0].sessionId).not.toBe(outcome.originSessionId);
    expect(outcome.movements[0].type).toBe("refund");
    expect(outcome.movements[0].amount).toBeCloseTo(-outcome.ret.total, 4);
  });
});

describe("POS-PAY-01 — payReceivable memvalidasi akun penerimaan", () => {
  it("akun pendapatan & akun tak dikenal ditolak; akun metode pembayaran diterima dan jurnalnya benar", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 1);
      const credit = await methodByType(tx, "credit");
      const cashAccount = await accountByCode(tx, "110107");
      const qrisAccount = await accountByCode(tx, "110108");
      const revenueAccount = await accountByCode(tx, "400001");
      const receivableAccount = await accountByCode(tx, "110301");
      const [customer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.companyId, ORG_ID))
        .limit(1);
      expect(customer).toBeDefined();

      const { sale, quote } = await makeSale(tx, {
        warehouseId: warehouse.id,
        productId: product.productId,
        qty: 1,
        methodId: credit.id,
        customerId: customer.id,
      });
      const [stored] = await tx
        .select({ paymentStatus: sales.paymentStatus, paidTotal: sales.paidTotal })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      expect(stored.paymentStatus).toBe("unpaid");
      expect(d(stored.paidTotal).toNumber()).toBe(0);

      let revenueError: unknown;
      try {
        await payReceivable(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: todayISO(),
          amount: "1000",
          accountId: revenueAccount.id,
        });
      } catch (caught) {
        revenueError = caught;
      }
      expect(revenueError).toMatchObject({ code: "VALIDATION" });
      expect((revenueError as { message: string }).message).toMatch(/bukan akun metode pembayaran/);

      let ghostError: unknown;
      try {
        await payReceivable(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: todayISO(),
          amount: "1000",
          accountId: crypto.randomUUID(),
        });
      } catch (caught) {
        ghostError = caught;
      }
      expect(ghostError).toMatchObject({ code: "VALIDATION" });
      expect((ghostError as { message: string }).message).toMatch(/tidak ditemukan/);

      const firstAmount = Math.floor(quote.total / 2);
      const first = await payReceivable(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        amount: firstAmount,
        accountId: cashAccount.id,
      });

      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "payment"),
            eq(journalEntries.sourceId, sale.id),
            eq(journalEntries.idempotencyKey, `ar:${sale.id}:${first.number}`),
          ),
        );
      expect(entry).toBeDefined();
      const lines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, entry.id));
      const debitLine = lines.find((line) => d(line.debit).gt(0));
      const creditLine = lines.find((line) => d(line.credit).gt(0));

      const rest = quote.total - firstAmount;
      await payReceivable(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        amount: rest,
        accountId: qrisAccount.id,
      });

      const [after] = await tx
        .select({ paymentStatus: sales.paymentStatus, paidTotal: sales.paidTotal })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      return {
        debitAccount: debitLine?.accountId,
        creditAccount: creditLine?.accountId,
        debitAmount: debitLine ? d(debitLine.debit).toNumber() : 0,
        firstAmount,
        cashAccountId: cashAccount.id,
        receivableAccountId: receivableAccount.id,
        afterStatus: after.paymentStatus,
        afterPaid: d(after.paidTotal).toNumber(),
        total: quote.total,
      };
    });

    expect(outcome.debitAccount).toBe(outcome.cashAccountId);
    expect(outcome.creditAccount).toBe(outcome.receivableAccountId);
    expect(outcome.debitAmount).toBeCloseTo(outcome.firstAmount, 4);
    expect(outcome.afterStatus).toBe("paid");
    expect(outcome.afterPaid).toBeCloseTo(outcome.total, 4);
  });
});
