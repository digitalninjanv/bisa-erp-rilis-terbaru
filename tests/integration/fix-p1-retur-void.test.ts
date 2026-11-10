import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
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
  partyPayments,
  paymentMethods,
  products,
  saleReturns,
  sales,
  stockDocuments,
  stockOnHand,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { applyStockMovement, createAdjustment, createReceipt, voidReceipt } from "@/server/inventory";
import { payPayableDocument } from "@/server/payables";
import { createSale, createSaleReturn, payReceivable, quoteCart, voidSale } from "@/server/pos";
import { listReceivables } from "@/server/reports";
import { AppError } from "@/lib/errors";
import { d, type Decimal } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// FIX-P1 Tahap 1 (A-15) — Kelompok Retur & Void dari audit adversarial
// akuntansi (docs/akuntansi-audit/):
//   AK4-01 retur atas penjualan ber-pembulatan selalu gagal (jurnal tak
//          seimbang sebesar porsi pembulatan);
//   AK2-01/AK4-03 retur atas penjualan utang tidak memotong piutang —
//          refund tunai keluar atas utang yang belum dibayar;
//   AK3-01 void penjualan tidak membalik pembayaran piutang dan
//          penjualan void tetap bisa dibayar;
//   AK3-02 penerimaan yang sudah di-void tetap bisa dibayar;
//   AK4-02 penyesuaian stok tipe purchase_return membuat jurnal utang/
//          piutang liar (digantikan modul Retur Pembelian A-9).
// Semua skenario berjalan di perusahaan fixture KHUSUS berkas ini
// (f101) dalam transaksi rollback — perusahaan demo tidak pernah
// ditulis (pelajaran cemaran residu gerbang final SIM-2).

const ORG_ID = "01900000-0000-7000-8000-00000000f101";
const USER_ID = "user-uji-fix-p1";
const TODAY = todayISO();


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

/** Fixture perusahaan uji: akun + pemetaan + gudang + metode bayar +
 * sesi kas terbuka. Ter-commit sekali, idempoten antar-run; semua
 * skenario uji sendiri berjalan rollback di atasnya. */
async function ensureFixtureCompany() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG_ID))
      .limit(1);
    if (existing) return;

    await tx.insert(companySettings).values({
      companyId: ORG_ID,
      legalName: "Uji FIX-P1 Retur Void",
      roundingMode: "none",
      taxRate: "0",
      taxEnabled: false,
    });

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
          companyId: ORG_ID,
          code,
          name,
          type,
          normalBalance,
          // AUD-001/A-27: kelas kas/bank eksplisit (validator membacanya);
          // fixture tidak boleh bergantung pada residu ter-backfill.
          cashBankKind:
            code === "1000" ? "cash" : code === "1100" ? "bank" : code === "1110" ? "clearing" : null,
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
      Object.entries(mapping).map(([key, accountId]) => ({ companyId: ORG_ID, key, accountId })),
    );
    await tx.insert(warehouses).values({
      companyId: ORG_ID,
      code: "GD-FIXP1",
      name: "Gudang Uji FIX-P1",
      type: "warehouse",
      isDefault: true,
    });
    await tx.insert(paymentMethods).values([
      { companyId: ORG_ID, code: "CASH", name: "Tunai", type: "cash", accountId: acc.get("1000")!, sortOrder: 1 },
      { companyId: ORG_ID, code: "TRF", name: "Transfer Bank", type: "bank", accountId: acc.get("1100")!, sortOrder: 2 },
      { companyId: ORG_ID, code: "UTANG", name: "Utang", type: "credit", accountId: acc.get("1200")!, sortOrder: 3 },
    ]);
    await tx.insert(cashSessions).values({
      companyId: ORG_ID,
      userId: USER_ID,
      openingCash: "0",
      status: "open",
    });
  });
}

beforeAll(async () => {
  await ensureFixtureCompany();
});

let skuCounter = 0;

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
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

/** Produk berstok di gudang fixture, dibuat di dalam transaksi uji. */
async function makeProduct(
  tx: Tx,
  input: { salePrice: string; costPrice: string; qty: number },
) {
  skuCounter += 1;
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `FIXP1-${String(skuCounter).padStart(3, "0")}-${Date.now()}`,
      name: `Produk Uji FIX-P1 ${skuCounter}`,
      costPrice: input.costPrice,
      salePrice: input.salePrice,
      minStock: "0",
      trackStock: true,
      trackBatch: false,
      isActive: true,
    })
    .returning();
  const warehouse = await defaultWarehouse(tx);
  if (input.qty > 0) {
    await applyStockMovement(tx, {
      companyId: ORG_ID,
      warehouseId: warehouse.id,
      productId: product.id,
      delta: String(input.qty),
      unitCost: input.costPrice,
      movementType: "opening",
      userId: USER_ID,
    });
  }
  return { product, warehouse };
}

async function makeCustomer(tx: Tx) {
  const [customer] = await tx
    .insert(customers)
    .values({
      companyId: ORG_ID,
      code: `CUST-FIXP1-${Date.now()}-${skuCounter}`,
      name: "Pelanggan Uji FIX-P1",
      creditLimit: "0",
    })
    .returning();
  return customer;
}

async function makeSupplier(tx: Tx) {
  const [supplier] = await tx
    .insert(suppliers)
    .values({
      companyId: ORG_ID,
      code: `SUP-FIXP1-${Date.now()}-${skuCounter}`,
      name: "Pemasok Uji FIX-P1",
    })
    .returning();
  return supplier;
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

/** Semua baris jurnal posted untuk satu dokumen sumber. */
async function journalLinesFor(tx: Tx, sourceType: string, sourceId: string) {
  const entries = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
      ),
    );
  const lines: (typeof journalLines.$inferSelect)[] = [];
  for (const entry of entries) {
    const rows = await tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id));
    lines.push(...rows);
  }
  return lines;
}

function accountTotals(lines: (typeof journalLines.$inferSelect)[], accountId: string) {
  let debit: Decimal = d(0);
  let credit: Decimal = d(0);
  for (const line of lines) {
    if (line.accountId !== accountId) continue;
    debit = debit.plus(d(line.debit));
    credit = credit.plus(d(line.credit));
  }
  return { debit, credit };
}

function expectBalanced(lines: (typeof journalLines.$inferSelect)[]) {
  const debit = lines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
  const credit = lines.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
  expect(debit.toFixed(4)).toBe(credit.toFixed(4));
}

/** Saldo GL satu akun dari SELURUH jurnal posted perusahaan (debit − kredit). */
async function glBalance(tx: Tx, accountId: string) {
  const [row] = await tx
    .select({
      value: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalLines.accountId, accountId)));
  return d(row?.value ?? "0");
}

async function setRoundingMode(tx: Tx, mode: string) {
  await tx
    .update(companySettings)
    .set({ roundingMode: mode })
    .where(eq(companySettings.companyId, ORG_ID));
}

async function sellCash(
  tx: Tx,
  input: { productId: string; warehouseId: string; qty: number },
) {
  const cash = await methodByType(tx, "cash");
  const lines = [{ productId: input.productId, qty: input.qty }];
  const quote = await quoteCart(tx, {
    companyId: ORG_ID,
    warehouseId: input.warehouseId,
    lines,
  });
  const sale = await createSale(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId: input.warehouseId,
    date: TODAY,
    dueDate: TODAY,
    lines,
    payments: [{ methodId: cash.id, amount: quote.total, tendered: quote.total }],
    idempotencyKey: crypto.randomUUID(),
  });
  return { sale, quote };
}

async function sellCredit(
  tx: Tx,
  input: {
    productId: string;
    warehouseId: string;
    qty: number;
    customerId: string;
    cashPart?: number;
  },
) {
  const credit = await methodByType(tx, "credit");
  const cash = await methodByType(tx, "cash");
  const lines = [{ productId: input.productId, qty: input.qty }];
  const quote = await quoteCart(tx, {
    companyId: ORG_ID,
    warehouseId: input.warehouseId,
    customerId: input.customerId,
    lines,
  });
  const payments = input.cashPart
    ? [
        { methodId: cash.id, amount: input.cashPart, tendered: input.cashPart },
        { methodId: credit.id, amount: quote.total - input.cashPart, tendered: quote.total - input.cashPart },
      ]
    : [{ methodId: credit.id, amount: quote.total, tendered: quote.total }];
  const sale = await createSale(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId: input.warehouseId,
    customerId: input.customerId,
    date: TODAY,
    dueDate: TODAY,
    lines,
    payments,
    idempotencyKey: crypto.randomUUID(),
  });
  return { sale, quote };
}

async function saleRow(tx: Tx, saleId: string) {
  const [row] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  expect(row).toBeDefined();
  return row;
}

/* ------------------------------------------------------------------ */
/* AK4-01 — retur atas penjualan ber-pembulatan                        */
/* ------------------------------------------------------------------ */

describe("AK4-01 — retur penjualan dengan penyesuaian pembulatan", () => {
  it("retur penuh, pembulatan naik (+200): jurnal seimbang, refund = total terbulatkan", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setRoundingMode(tx, "nearest_500");
      const map = await getAccountMap(tx, ORG_ID);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "3300",
        costPrice: "2500",
        qty: 10,
      });
      const { sale, quote } = await sellCash(tx, { productId: product.id, warehouseId: warehouse.id, qty: 1 });
      // 3.300 dibulatkan ke 3.500: penyesuaian +200.
      expect(quote.roundingAdjustment).toBe(200);
      expect(quote.total).toBe(3500);

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK4-01 retur penuh ber-pembulatan",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 1 }],
      });

      const lines = await journalLinesFor(tx, "sale_return", ret.id);
      const [retRow] = await tx.select().from(saleReturns).where(eq(saleReturns.id, ret.id));
      const refundMovements = await tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG_ID),
            eq(cashMovements.referenceType, "sale_return"),
            eq(cashMovements.referenceId, ret.id),
          ),
        );
      return { lines, map, ret, retRow, refundMovements };
    });

    expectBalanced(outcome.lines);
    // Penyelesaian mengkredit kas sebesar yang benar-benar dibayar
    // pelanggan (total terbulatkan), bukan nilai barang sebelum bulat.
    const cash = accountTotals(outcome.lines, outcome.map.cash);
    expect(cash.credit.toFixed(2)).toBe("3500.00");
    // Porsi pembulatan direversi penuh dari akun laba pembulatan.
    const gain = accountTotals(outcome.lines, outcome.map.rounding_gain);
    expect(gain.debit.toFixed(2)).toBe("200.00");
    expect(d(outcome.retRow.total).toFixed(2)).toBe("3500.00");
    expect(outcome.refundMovements).toHaveLength(1);
    expect(d(outcome.refundMovements[0].amount).toFixed(2)).toBe("-3500.00");
  });

  it("retur sebagian, pembulatan naik (+200 atas 2 unit): porsi proporsional 100", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setRoundingMode(tx, "nearest_500");
      const map = await getAccountMap(tx, ORG_ID);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "3400",
        costPrice: "2000",
        qty: 10,
      });
      const { sale, quote } = await sellCash(tx, { productId: product.id, warehouseId: warehouse.id, qty: 2 });
      // 6.800 dibulatkan ke 7.000: penyesuaian +200.
      expect(quote.roundingAdjustment).toBe(200);
      expect(quote.total).toBe(7000);

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK4-01 retur sebagian ber-pembulatan",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 1 }],
      });
      const lines = await journalLinesFor(tx, "sale_return", ret.id);
      return { lines, map };
    });

    expectBalanced(outcome.lines);
    const cash = accountTotals(outcome.lines, outcome.map.cash);
    expect(cash.credit.toFixed(2)).toBe("3500.00");
    const gain = accountTotals(outcome.lines, outcome.map.rounding_gain);
    expect(gain.debit.toFixed(2)).toBe("100.00");
  });

  it("retur sebagian, pembulatan turun (−100 atas 2 unit): refund 3.250, rugi pembulatan dikredit 50", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setRoundingMode(tx, "nearest_500");
      const map = await getAccountMap(tx, ORG_ID);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "3300",
        costPrice: "2500",
        qty: 10,
      });
      const { sale, quote } = await sellCash(tx, { productId: product.id, warehouseId: warehouse.id, qty: 2 });
      // 6.600 dibulatkan ke 6.500: penyesuaian −100.
      expect(quote.roundingAdjustment).toBe(-100);
      expect(quote.total).toBe(6500);

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK4-01 pembulatan turun",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 1 }],
      });
      const lines = await journalLinesFor(tx, "sale_return", ret.id);
      return { lines, map };
    });

    expectBalanced(outcome.lines);
    const cash = accountTotals(outcome.lines, outcome.map.cash);
    expect(cash.credit.toFixed(2)).toBe("3250.00");
    const loss = accountTotals(outcome.lines, outcome.map.rounding_loss);
    expect(loss.credit.toFixed(2)).toBe("50.00");
  });
});

/* ------------------------------------------------------------------ */
/* AK2-01 / AK4-03 — retur atas penjualan utang memotong piutang       */
/* ------------------------------------------------------------------ */

describe("AK2-01/AK4-03 — retur atas penjualan utang memotong piutang lebih dulu", () => {
  it("utang belum dibayar sama sekali: retur penuh hanya memotong piutang, nol kas keluar", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const customer = await makeCustomer(tx);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "10000",
        costPrice: "7000",
        qty: 5,
      });
      const { sale } = await sellCredit(tx, {
        productId: product.id,
        warehouseId: warehouse.id,
        qty: 1,
        customerId: customer.id,
      });
      const before = await saleRow(tx, sale.id);
      expect(before.paymentStatus).toBe("unpaid");
      expect(d(before.paidTotal).toFixed(2)).toBe("0.00");

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK4-03 retur utang belum lunas",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 1 }],
      });

      const lines = await journalLinesFor(tx, "sale_return", ret.id);
      const after = await saleRow(tx, sale.id);
      const refundMovements = await tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG_ID),
            eq(cashMovements.referenceType, "sale_return"),
            eq(cashMovements.referenceId, ret.id),
          ),
        );
      const receivables = await listReceivables(tx, ORG_ID);
      const arBalance = await glBalance(tx, map.receivable);
      return { lines, map, after, refundMovements, receivables, saleId: sale.id, arBalance };
    });

    expectBalanced(outcome.lines);
    // Seluruh nilai retur memotong piutang — tidak ada kas yang keluar
    // untuk penjualan yang belum pernah dibayar.
    const receivable = accountTotals(outcome.lines, outcome.map.receivable);
    expect(receivable.credit.toFixed(2)).toBe("10000.00");
    const cash = accountTotals(outcome.lines, outcome.map.cash);
    expect(cash.credit.toFixed(2)).toBe("0.00");
    expect(outcome.refundMovements).toHaveLength(0);
    // Penjualan tertutup: sisa piutang nol dan status terbayar tuntas
    // oleh potongan retur; dokumen hilang dari daftar piutang.
    expect(outcome.after.status).toBe("returned");
    expect(d(outcome.after.total).minus(d(outcome.after.paidTotal)).toFixed(2)).toBe("0.00");
    expect(outcome.after.paymentStatus).toBe("paid");
    expect(outcome.receivables.find((row) => row.id === outcome.saleId)).toBeUndefined();
    expect(outcome.arBalance.toFixed(2)).toBe("0.00");
  });

  it("split tunai+utang: retur memotong piutang dulu, hanya kelebihannya direfund tunai", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const customer = await makeCustomer(tx);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "5000",
        costPrice: "3000",
        qty: 10,
      });
      // Total 10.000: tunai 6.000 + utang 4.000.
      const { sale } = await sellCredit(tx, {
        productId: product.id,
        warehouseId: warehouse.id,
        qty: 2,
        customerId: customer.id,
        cashPart: 6000,
      });
      const before = await saleRow(tx, sale.id);
      expect(before.paymentStatus).toBe("partial");
      expect(d(before.paidTotal).toFixed(2)).toBe("6000.00");

      // Retur 1 unit = 5.000 → potong piutang 4.000 + refund tunai 1.000.
      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK4-03 retur split",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 1 }],
      });

      const lines = await journalLinesFor(tx, "sale_return", ret.id);
      const after = await saleRow(tx, sale.id);
      const refundMovements = await tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG_ID),
            eq(cashMovements.referenceType, "sale_return"),
            eq(cashMovements.referenceId, ret.id),
          ),
        );
      const receivables = await listReceivables(tx, ORG_ID);
      return { lines, map, after, refundMovements, receivables, saleId: sale.id };
    });

    expectBalanced(outcome.lines);
    const receivable = accountTotals(outcome.lines, outcome.map.receivable);
    expect(receivable.credit.toFixed(2)).toBe("4000.00");
    const cash = accountTotals(outcome.lines, outcome.map.cash);
    expect(cash.credit.toFixed(2)).toBe("1000.00");
    expect(outcome.refundMovements).toHaveLength(1);
    expect(d(outcome.refundMovements[0].amount).toFixed(2)).toBe("-1000.00");
    expect(d(outcome.after.paidTotal).toFixed(2)).toBe("10000.00");
    expect(outcome.after.paymentStatus).toBe("paid");
    expect(outcome.receivables.find((row) => row.id === outcome.saleId)).toBeUndefined();
  });

  it("utang sudah dibayar sebagian lewat payReceivable: retur penuh memotong sisa, refund hanya sebesar yang sudah diterima", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const customer = await makeCustomer(tx);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "10000",
        costPrice: "7000",
        qty: 5,
      });
      const { sale } = await sellCredit(tx, {
        productId: product.id,
        warehouseId: warehouse.id,
        qty: 1,
        customerId: customer.id,
      });
      await payReceivable(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        amount: 4000,
        accountId: map.cash,
      });

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK4-03 retur sesudah bayar sebagian",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 1 }],
      });

      const lines = await journalLinesFor(tx, "sale_return", ret.id);
      const after = await saleRow(tx, sale.id);
      const arBalance = await glBalance(tx, map.receivable);
      // Sesudah retur penuh, penjualan tidak boleh bisa dibayar lagi.
      let payError: unknown;
      try {
        await payReceivable(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: TODAY,
          amount: 1000,
          accountId: map.cash,
        });
      } catch (error) {
        payError = error;
      }
      return { lines, map, after, arBalance, payError };
    });

    expectBalanced(outcome.lines);
    const receivable = accountTotals(outcome.lines, outcome.map.receivable);
    expect(receivable.credit.toFixed(2)).toBe("6000.00");
    const cash = accountTotals(outcome.lines, outcome.map.cash);
    expect(cash.credit.toFixed(2)).toBe("4000.00");
    expect(outcome.after.paymentStatus).toBe("paid");
    expect(outcome.arBalance.toFixed(2)).toBe("0.00");
    expect(outcome.payError).toBeInstanceOf(AppError);
  });
});

/* ------------------------------------------------------------------ */
/* AK3-01 — void penjualan membalik pembayaran piutang                 */
/* ------------------------------------------------------------------ */

describe("AK3-01 — void penjualan membalik pembayaran piutang", () => {
  it("jual utang → bayar sebagian → void: jurnal pembayaran dibalik, GL piutang nol, bayar lagi ditolak", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const customer = await makeCustomer(tx);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "10000",
        costPrice: "7000",
        qty: 5,
      });
      const { sale } = await sellCredit(tx, {
        productId: product.id,
        warehouseId: warehouse.id,
        qty: 1,
        customerId: customer.id,
      });
      await payReceivable(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        amount: 4000,
        accountId: map.cash,
      });
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.saleId, sale.id)));
      expect(payment).toBeDefined();
      const [paymentEntry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.idempotencyKey, `ar:${sale.id}:${payment!.number}`),
          ),
        );
      expect(paymentEntry).toBeDefined();

      await voidSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        reason: "Uji AK3-01 void penjualan berpiutang",
      });

      const [paymentAfter] = await tx
        .select()
        .from(partyPayments)
        .where(eq(partyPayments.id, payment!.id));
      const [reversal] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.reversalOfId, paymentEntry!.id),
          ),
        );
      const after = await saleRow(tx, sale.id);
      const arBalance = await glBalance(tx, map.receivable);
      const cashBalance = await glBalance(tx, map.cash);
      const receivables = await listReceivables(tx, ORG_ID);

      let payError: unknown;
      try {
        await payReceivable(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: TODAY,
          amount: 1000,
          accountId: map.cash,
        });
      } catch (error) {
        payError = error;
      }
      return {
        paymentAfter,
        reversal,
        after,
        arBalance,
        cashBalance,
        receivables,
        saleId: sale.id,
        payError,
      };
    });

    // Pembayaran piutang ikut batal dan jurnalnya dibalik per entri.
    expect(outcome.paymentAfter.status).toBe("void");
    expect(outcome.reversal).toBeDefined();
    expect(outcome.reversal.status).toBe("posted");
    // GL kembali bersih: piutang nol dan kas tidak menyimpan uang dari
    // penjualan yang sudah tidak ada.
    expect(outcome.arBalance.toFixed(2)).toBe("0.00");
    expect(outcome.cashBalance.toFixed(2)).toBe("0.00");
    // Bidang dokumen konsisten dengan pembatalan pembayaran.
    expect(outcome.after.status).toBe("void");
    expect(d(outcome.after.paidTotal).toFixed(2)).toBe("0.00");
    expect(outcome.after.paymentStatus).toBe("unpaid");
    expect(outcome.receivables.find((row) => row.id === outcome.saleId)).toBeUndefined();
    // Penjualan void tidak bisa menerima pembayaran lagi.
    expect(outcome.payError).toBeInstanceOf(AppError);
    expect((outcome.payError as AppError).code).toBe("INVALID_STATE");
  });

  it("payReceivable menolak penjualan berstatus returned", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const customer = await makeCustomer(tx);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "8000",
        costPrice: "5000",
        qty: 5,
      });
      const { sale } = await sellCredit(tx, {
        productId: product.id,
        warehouseId: warehouse.id,
        qty: 1,
        customerId: customer.id,
      });
      await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK3-01 retur penuh sebelum bayar",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 1 }],
      });
      const returned = await saleRow(tx, sale.id);
      let payError: unknown;
      try {
        await payReceivable(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: TODAY,
          amount: 1000,
          accountId: map.cash,
        });
      } catch (error) {
        payError = error;
      }
      return { returned, payError };
    });

    expect(outcome.returned.status).toBe("returned");
    expect(outcome.payError).toBeInstanceOf(AppError);
    expect((outcome.payError as AppError).code).toBe("INVALID_STATE");
  });
});

/* ------------------------------------------------------------------ */
/* AK3-02 — penerimaan void tidak bisa dibayar                         */
/* ------------------------------------------------------------------ */

describe("AK3-02 — penerimaan yang sudah di-void tidak bisa dibayar", () => {
  async function creditReceipt(tx: Tx) {
    const supplier = await makeSupplier(tx);
    const { product, warehouse } = await makeProduct(tx, {
      salePrice: "9000",
      costPrice: "5000",
      qty: 0,
    });
    const receipt = await createReceipt(tx, {
      companyId: ORG_ID,
      userId: USER_ID,
      warehouseId: warehouse.id,
      supplierId: supplier.id,
      date: TODAY,
      lines: [{ productId: product.id, qty: 5, unitCost: 5000 }],
    });
    return { supplier, product, warehouse, receipt };
  }

  it("terima kredit → void → bayar ditolak dan tidak ada jurnal pembayaran", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const { receipt } = await creditReceipt(tx);
      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: receipt.id,
        reason: "Uji AK3-02 penerimaan salah input",
        date: TODAY,
      });
      const [voided] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(voided.status).toBe("void");

      let payError: unknown;
      try {
        await payPayableDocument(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          receiptId: receipt.id,
          date: TODAY,
          amount: 10000,
          accountId: map.cash,
        });
      } catch (error) {
        payError = error;
      }
      const payments = await tx
        .select()
        .from(partyPayments)
        .where(
          and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.receiptId, receipt.id)),
        );
      const paymentJournals = await journalLinesFor(tx, "payment", receipt.id);
      const payableBalance = await glBalance(tx, map.payable);
      return { payError, payments, paymentJournals, payableBalance };
    });

    expect(outcome.payError).toBeInstanceOf(AppError);
    expect((outcome.payError as AppError).code).toBe("INVALID_STATE");
    expect(outcome.payments).toHaveLength(0);
    expect(outcome.paymentJournals).toHaveLength(0);
    // Utang GL bersih nol: jurnal penerimaan sudah dibalik void dan
    // tidak ada pembayaran yatim yang menggerakkannya lagi.
    expect(outcome.payableBalance.toFixed(2)).toBe("0.00");
  });

  it("tidak regresi: terima → bayar sebagian → void tetap terblokir penjaga lama", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const { receipt } = await creditReceipt(tx);
      await payPayableDocument(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: receipt.id,
        date: TODAY,
        amount: 10000,
        accountId: map.cash,
      });
      const [paidReceipt] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(paidReceipt.paymentStatus).toBe("partial");

      let voidError: unknown;
      try {
        await voidReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          receiptId: receipt.id,
          reason: "Uji AK3-02 void sesudah bayar",
          date: TODAY,
        });
      } catch (error) {
        voidError = error;
      }
      const [after] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      const payableBalance = await glBalance(tx, map.payable);
      return { voidError, after, payableBalance };
    });

    expect(outcome.voidError).toBeInstanceOf(AppError);
    expect(outcome.after.status).toBe("posted");
    // Sisa utang 25.000 − 10.000 tetap tercatat sebagai kredit GL.
    expect(outcome.payableBalance.toFixed(2)).toBe("-15000.00");
  });
});

/* ------------------------------------------------------------------ */
/* AK4-02 — jalur retur pemasok warisan Gudang ditutup                 */
/* ------------------------------------------------------------------ */

describe("AK4-02 — penyesuaian stok tidak lagi membuat retur pemasok", () => {
  it.each(["credit_note", "deduction", "replacement", "cash"] as const)(
    "createAdjustment type purchase_return (metode %s) ditolak; stok & jurnal tidak berubah",
    async (refundMethod) => {
      const outcome = await rollbackTransaction(async (tx) => {
        const supplier = await makeSupplier(tx);
        const { product, warehouse } = await makeProduct(tx, {
          salePrice: "9000",
          costPrice: "5000",
          qty: 10,
        });
        const stockBefore = await stockQty(tx, warehouse.id, product.id);

        let error: unknown;
        try {
          await createAdjustment(tx, {
            companyId: ORG_ID,
            userId: USER_ID,
            warehouseId: warehouse.id,
            date: TODAY,
            type: "purchase_return",
            reason: "Uji AK4-02 jalur warisan",
            supplierId: supplier.id,
            refundMethod,
            lines: [{ productId: product.id, qty: 2 }],
          });
        } catch (caught) {
          error = caught;
        }

        const stockAfter = await stockQty(tx, warehouse.id, product.id);
        const docs = await tx
          .select()
          .from(stockDocuments)
          .where(
            and(
              eq(stockDocuments.companyId, ORG_ID),
              eq(stockDocuments.type, "purchase_return"),
            ),
          );
        const wildJournals = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.companyId, ORG_ID),
              eq(journalEntries.sourceType, "purchase_return"),
            ),
          );
        return { error, stockBefore, stockAfter, docs, wildJournals };
      });

      expect(outcome.error).toBeInstanceOf(AppError);
      expect((outcome.error as AppError).code).toBe("VALIDATION");
      expect((outcome.error as AppError).message).toMatch(/Retur Pembelian/);
      expect(outcome.stockAfter.toFixed(4)).toBe(outcome.stockBefore.toFixed(4));
      expect(outcome.docs).toHaveLength(0);
      expect(outcome.wildJournals).toHaveLength(0);
    },
  );

  it("keluarga penyesuaian lain tidak ikut rusak: damaged tetap terposting dengan jurnal yang benar", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const { product, warehouse } = await makeProduct(tx, {
        salePrice: "9000",
        costPrice: "5000",
        qty: 10,
      });
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: TODAY,
        type: "damaged",
        reason: "Uji AK4-02 kontrol keluarga penyesuaian",
        lines: [{ productId: product.id, qty: 2 }],
      });
      const lines = await journalLinesFor(tx, "adjustment", doc.id);
      const stockAfter = await stockQty(tx, warehouse.id, product.id);
      return { doc, lines, map, stockAfter };
    });

    expect(outcome.doc.status).toBe("posted");
    expectBalanced(outcome.lines);
    const damaged = accountTotals(outcome.lines, outcome.map.damaged);
    expect(damaged.debit.toFixed(2)).toBe("10000.00");
    const inventory = accountTotals(outcome.lines, outcome.map.inventory);
    expect(inventory.credit.toFixed(2)).toBe("10000.00");
    expect(outcome.stockAfter.toFixed(2)).toBe("8.00");
  });
});
