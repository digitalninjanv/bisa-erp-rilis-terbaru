import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  auditLog,
  cashSessions,
  companySettings,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  stockBatches,
  stockDocuments,
  stockOnHand,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap, postJournal } from "@/server/accounting";
import {
  createAdjustment,
  createReceipt,
  voidReceipt,
} from "@/server/inventory";
import { createSale, createSaleReturn, quoteCart } from "@/server/pos";
import { getBalanceSheet, getEquityStatement } from "@/server/reports";
import { d, type Decimal } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// FIX-P1 Tahap 2 (A-15) — Kelompok Angka Salah dari audit adversarial
// akuntansi (docs/akuntansi-audit/):
//   AK2-02 laporan perubahan ekuitas kehilangan laba akumulasi periode
//          sebelumnya (saldo awal/akhir tidak pernah sama dengan
//          ekuitas neraca untuk rentang yang tidak dimulai dari awal
//          waktu);
//   AK4-06 rekonsiliasi valuasi stok ↔ GL tidak dijamin desain:
//          (a) retur penjualan masuk pada biaya asal tanpa re-blend
//              AVCO, (b) void penerimaan tanpa hitung ulang AVCO,
//          (c) unitCost penyesuaian bebas ketik tanpa pagar.
// Semua skenario berjalan di perusahaan fixture KHUSUS berkas ini
// (f201) dalam transaksi rollback — perusahaan demo tidak pernah
// ditulis (pelajaran cemaran residu gerbang final SIM-2).

const ORG_ID = "01900000-0000-7000-8000-00000000f201";
const USER_ID = "user-uji-fix-p1-tahap-2";
const TODAY = todayISO();


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

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
      legalName: "Uji FIX-P1 Tahap 2",
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
      code: "GD-FIXP2",
      name: "Gudang Uji FIX-P1 Tahap 2",
      type: "warehouse",
      isDefault: true,
    });
    await tx.insert(paymentMethods).values([
      { companyId: ORG_ID, code: "CASH", name: "Tunai", type: "cash", accountId: acc.get("1000")!, sortOrder: 1 },
      { companyId: ORG_ID, code: "TRF", name: "Transfer Bank", type: "bank", accountId: acc.get("1100")!, sortOrder: 2 },
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

async function cashMethod(tx: Tx) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function makeSupplier(tx: Tx) {
  skuCounter += 1;
  const [supplier] = await tx
    .insert(suppliers)
    .values({
      companyId: ORG_ID,
      code: `SUP-FIXP2-${Date.now()}-${skuCounter}`,
      name: "Pemasok Uji FIX-P1 Tahap 2",
    })
    .returning();
  return supplier;
}

async function makeProduct(
  tx: Tx,
  input: { salePrice: string; costPrice: string; trackBatch?: boolean },
) {
  skuCounter += 1;
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `FIXP2-${String(skuCounter).padStart(3, "0")}-${Date.now()}`,
      name: `Produk Uji FIX-P1 Tahap 2 ${skuCounter}`,
      costPrice: input.costPrice,
      salePrice: input.salePrice,
      minStock: "0",
      trackStock: true,
      trackBatch: input.trackBatch ?? false,
      isActive: true,
    })
    .returning();
  return product;
}

async function productCost(tx: Tx, productId: string): Promise<Decimal> {
  const [row] = await tx
    .select({ costPrice: products.costPrice })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return d(row?.costPrice ?? 0);
}

async function globalQty(tx: Tx, productId: string): Promise<Decimal> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${stockOnHand.qty}), 0)` })
    .from(stockOnHand)
    .where(and(eq(stockOnHand.companyId, ORG_ID), eq(stockOnHand.productId, productId)));
  return d(row?.total ?? 0);
}

async function batchQty(tx: Tx, productId: string): Promise<Decimal> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${stockBatches.qty}), 0)` })
    .from(stockBatches)
    .where(and(eq(stockBatches.companyId, ORG_ID), eq(stockBatches.productId, productId)));
  return d(row?.total ?? 0);
}

/** Saldo GL satu akun dari SELURUH jurnal posted perusahaan (debit − kredit). */
async function glBalance(tx: Tx, accountId: string) {
  const [row] = await tx
    .select({
      value: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.status, "posted"),
        eq(journalLines.accountId, accountId),
      ),
    );
  return d(row?.value ?? "0");
}

async function sellCash(
  tx: Tx,
  input: { productId: string; warehouseId: string; qty: number },
) {
  const cash = await cashMethod(tx);
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

/* ------------------------------------------------------------------ */
/* AK2-02 — perubahan ekuitas memuat laba akumulasi sebelumnya         */
/* ------------------------------------------------------------------ */

describe("AK2-02 — laporan perubahan ekuitas vs neraca", () => {
  it("rentang B saja: saldo awal memuat laba periode A dan cocok dengan neraca di kedua tanggal", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      // Periode awal: setoran modal.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2026-01-10",
        description: "Setoran modal awal (uji AK2-02)",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: map.cash, debit: "5000000", description: "Kas masuk" },
          { accountId: map.equity, credit: "5000000", description: "Modal pemilik" },
        ],
      });
      // Periode A: laba Rp1.000.000.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2026-03-15",
        description: "Penjualan periode A (uji AK2-02)",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: map.cash, debit: "1000000", description: "Kas masuk" },
          { accountId: map.revenue, credit: "1000000", description: "Penjualan" },
        ],
      });
      // Periode B: rugi Rp250.000.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2026-07-10",
        description: "Beban periode B (uji AK2-02)",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: map.salary_expense, debit: "250000", description: "Beban" },
          { accountId: map.cash, credit: "250000", description: "Kas keluar" },
        ],
      });

      const equity = await getEquityStatement(tx, ORG_ID, { from: "2026-07-01", to: "2026-07-31" });
      const bsOpening = await getBalanceSheet(tx, ORG_ID, "2026-06-30");
      const bsClosing = await getBalanceSheet(tx, ORG_ID, "2026-07-31");
      return { equity, bsOpening, bsClosing };
    });

    // Saldo awal perubahan ekuitas = modal 5.000.000 + laba akumulasi
    // periode A 1.000.000 — dan HARUS sama dengan ekuitas neraca per
    // hari sebelum rentang.
    expect(outcome.equity.totalOpening).toBe(6000000);
    expect(outcome.equity.totalOpening).toBe(outcome.bsOpening.totalEquity);
    // Baris laba ditahan tersendiri memuat akumulasi sebelum rentang.
    const retained = outcome.equity.rows.find((row) => row.accountId === "retained-earnings");
    expect(retained).toBeDefined();
    expect(retained?.opening).toBe(1000000);
    expect(retained?.closing).toBe(1000000);
    // Saldo akhir = awal + laba rentang (−250.000) = ekuitas neraca
    // per akhir rentang.
    expect(outcome.equity.netProfit).toBe(-250000);
    expect(outcome.equity.totalClosing).toBe(5750000);
    expect(outcome.equity.totalClosing).toBe(outcome.bsClosing.totalEquity);
  });
});

/* ------------------------------------------------------------------ */
/* AK4-06a — retur penjualan mencampur ulang AVCO                      */
/* ------------------------------------------------------------------ */

describe("AK4-06a — retur penjualan re-blend AVCO pada biaya asal", () => {
  it("beli 10 @1000 → jual 5 → beli 5 @2000 → retur 2: AVCO = (10×1500 + 2×1000)/12 dan valuasi = GL", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const warehouse = await defaultWarehouse(tx);
      const supplier = await makeSupplier(tx);
      const product = await makeProduct(tx, { salePrice: "3000", costPrice: "0" });

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: TODAY,
        lines: [{ productId: product.id, qty: 10, unitCost: 1000 }],
      });
      expect((await productCost(tx, product.id)).toFixed(4)).toBe("1000.0000");

      const { sale } = await sellCash(tx, { productId: product.id, warehouseId: warehouse.id, qty: 5 });

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: TODAY,
        lines: [{ productId: product.id, qty: 5, unitCost: 2000 }],
      });
      // (5 × 1000 + 5 × 2000) / 10 = 1500.
      expect((await productCost(tx, product.id)).toFixed(4)).toBe("1500.0000");
      expect((await globalQty(tx, product.id)).toFixed(4)).toBe("10.0000");

      await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: TODAY,
        reason: "Uji AK4-06a retur penjualan",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 2 }],
      });

      const cost = await productCost(tx, product.id);
      const qty = await globalQty(tx, product.id);
      const gl = await glBalance(tx, map.inventory);
      return { cost, qty, gl };
    });

    expect(outcome.qty.toFixed(4)).toBe("12.0000");
    // (10 × 1500 + 2 × 1000) / 12 = 1416,6667.
    expect(outcome.cost.toFixed(4)).toBe("1416.6667");
    // GL persediaan: 10.000 + 10.000 − HPP 5.000 + retur 2.000 = 17.000,
    // dan valuasi laporan (qty × AVCO) harus menyamainya.
    expect(outcome.gl.toFixed(2)).toBe("17000.00");
    expect(outcome.qty.mul(outcome.cost).toFixed(2)).toBe(outcome.gl.toFixed(2));
  });
});

/* ------------------------------------------------------------------ */
/* AK4-06b — void penerimaan menghitung ulang AVCO dari ledger         */
/* ------------------------------------------------------------------ */

describe("AK4-06b — void penerimaan menghitung ulang AVCO", () => {
  it("terima 10 @1000 + 10 @2000 → void penerimaan kedua → AVCO kembali 1000 dan valuasi = GL", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const warehouse = await defaultWarehouse(tx);
      const supplier = await makeSupplier(tx);
      const product = await makeProduct(tx, { salePrice: "3000", costPrice: "0" });

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: TODAY,
        lines: [{ productId: product.id, qty: 10, unitCost: 1000 }],
      });
      const second = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: TODAY,
        lines: [{ productId: product.id, qty: 10, unitCost: 2000 }],
      });
      expect((await productCost(tx, product.id)).toFixed(4)).toBe("1500.0000");

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: second.id,
        reason: "Uji AK4-06b void penerimaan kedua",
        date: TODAY,
      });

      const [row] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, second.id));
      expect(row.status).toBe("void");
      const cost = await productCost(tx, product.id);
      const qty = await globalQty(tx, product.id);
      const gl = await glBalance(tx, map.inventory);
      return { cost, qty, gl };
    });

    expect(outcome.qty.toFixed(4)).toBe("10.0000");
    expect(outcome.cost.toFixed(4)).toBe("1000.0000");
    expect(outcome.gl.toFixed(2)).toBe("10000.00");
    expect(outcome.qty.mul(outcome.cost).toFixed(2)).toBe(outcome.gl.toFixed(2));
  });

  it("produk batch: void penerimaan kedua menjaga invariant Σ batch = on-hand dan AVCO kembali 1000", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await makeSupplier(tx);
      const product = await makeProduct(tx, { salePrice: "3000", costPrice: "0", trackBatch: true });

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: TODAY,
        lines: [{ productId: product.id, qty: 10, unitCost: 1000, batchNumber: "B-UJI-1" }],
      });
      const second = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: TODAY,
        lines: [{ productId: product.id, qty: 10, unitCost: 2000, batchNumber: "B-UJI-2" }],
      });
      expect((await productCost(tx, product.id)).toFixed(4)).toBe("1500.0000");
      expect((await batchQty(tx, product.id)).toFixed(4)).toBe("20.0000");

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: second.id,
        reason: "Uji AK4-06b void batch",
        date: TODAY,
      });

      return {
        cost: await productCost(tx, product.id),
        qty: await globalQty(tx, product.id),
        batches: await batchQty(tx, product.id),
      };
    });

    expect(outcome.qty.toFixed(4)).toBe("10.0000");
    expect(outcome.batches.toFixed(4)).toBe(outcome.qty.toFixed(4));
    expect(outcome.cost.toFixed(4)).toBe("1000.0000");
  });
});

/* ------------------------------------------------------------------ */
/* AK4-06c — unitCost penyesuaian: pagar izin + alasan + audit         */
/* ------------------------------------------------------------------ */

describe("AK4-06c — override harga pokok penyesuaian stok", () => {
  async function receivedProduct(tx: Tx) {
    const warehouse = await defaultWarehouse(tx);
    const supplier = await makeSupplier(tx);
    const product = await makeProduct(tx, { salePrice: "3000", costPrice: "0" });
    await createReceipt(tx, {
      companyId: ORG_ID,
      userId: USER_ID,
      warehouseId: warehouse.id,
      supplierId: supplier.id,
      date: TODAY,
      lines: [{ productId: product.id, qty: 10, unitCost: 1000 }],
    });
    return { warehouse, product };
  }

  it("override tanpa alasan ditolak walau berizin", async () => {
    await rollbackTransaction(async (tx) => {
      const { warehouse, product } = await receivedProduct(tx);
      await expect(
        createAdjustment(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: TODAY,
          type: "adjustment",
          reason: "Koreksi stok uji AK4-06c",
          lines: [{ productId: product.id, qty: 2, unitCost: 500 }],
          allowCostOverride: true,
        }),
      ).rejects.toThrow(/alasan/i);
    });
  });

  it("override dengan alasan tetapi tanpa izin peran ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const { warehouse, product } = await receivedProduct(tx);
      await expect(
        createAdjustment(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: TODAY,
          type: "adjustment",
          reason: "Koreksi stok uji AK4-06c",
          lines: [{ productId: product.id, qty: 2, unitCost: 500 }],
          costOverrideReason: "Harga faktur koreksi dari pemasok",
          allowCostOverride: false,
        }),
      ).rejects.toThrow(/izin/i);
    });
  });

  it("override berizin + beralasan: jurnal memakai nilai override dan audit mencatat lama/baru + alasan", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const { warehouse, product } = await receivedProduct(tx);
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: TODAY,
        type: "adjustment",
        reason: "Koreksi stok uji AK4-06c",
        lines: [{ productId: product.id, qty: 2, unitCost: 500 }],
        costOverrideReason: "Harga faktur koreksi dari pemasok",
        allowCostOverride: true,
      });
      expect(doc.status).toBe("posted");

      const [stored] = await tx
        .select()
        .from(stockDocuments)
        .where(eq(stockDocuments.id, doc.id));
      // Jurnal penyesuaian masuk: Dr Persediaan / Cr Selisih sebesar
      // nilai override 2 × 500 = 1.000 (bukan 2 × 1.000 berjalan).
      const glInventory = await glBalance(tx, map.inventory);
      const glShrink = await glBalance(tx, map.inventory_shrink);
      const audits = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.entityId, doc.id),
            eq(auditLog.action, "inventory.adjust"),
          ),
        );
      return { stored, glInventory, glShrink, audits };
    });

    // GL persediaan total = penerimaan 10.000 + penyesuaian override 1.000.
    expect(outcome.glInventory.toFixed(2)).toBe("11000.00");
    expect(outcome.glShrink.toFixed(2)).toBe("-1000.00");
    expect(outcome.audits.length).toBeGreaterThan(0);
    const after = outcome.audits[0].after as {
      costOverrides?: Array<{ runningCost: string; overrideCost: string; reason: string }>;
    } | null;
    expect(after?.costOverrides).toHaveLength(1);
    expect(d(after?.costOverrides?.[0].runningCost ?? 0).toFixed(2)).toBe("1000.00");
    expect(d(after?.costOverrides?.[0].overrideCost ?? 0).toFixed(2)).toBe("500.00");
    expect(after?.costOverrides?.[0].reason).toBe("Harga faktur koreksi dari pemasok");
  });

  it("tanpa override (unitCost kosong): bawaan harga berjalan, tanpa izin/alasan khusus", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const { warehouse, product } = await receivedProduct(tx);
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: TODAY,
        type: "adjustment",
        reason: "Koreksi stok uji AK4-06c tanpa override",
        lines: [{ productId: product.id, qty: 2 }],
      });
      expect(doc.status).toBe("posted");
      const glInventory = await glBalance(tx, map.inventory);
      return { glInventory };
    });
    // 10.000 penerimaan + 2 × 1.000 harga berjalan.
    expect(outcome.glInventory.toFixed(2)).toBe("12000.00");
  });

  it("unitCost sama dengan harga berjalan bukan override: lolos tanpa alasan", async () => {
    await rollbackTransaction(async (tx) => {
      const { warehouse, product } = await receivedProduct(tx);
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: TODAY,
        type: "adjustment",
        reason: "Koreksi stok uji AK4-06c nilai sama",
        lines: [{ productId: product.id, qty: 1, unitCost: 1000 }],
      });
      expect(doc.status).toBe("posted");
    });
  });
});
