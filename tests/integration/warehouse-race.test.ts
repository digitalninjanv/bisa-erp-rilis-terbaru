import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  cashSessions,
  companySettings,
  journalEntries,
  paymentMethods,
  products,
  sales,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { applyStockMovement, createOpname } from "@/server/inventory";
import { createSale, quoteCart } from "@/server/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";

// Utang Tahap 2 — test balapan konkurensi gudang/POS (pola T4R-4:
// transaksi commit sungguhan di perusahaan uji tersendiri, karena kunci
// baris hanya terlihat ANTAR transaksi):
//   (a) dua checkout POS konkuren memperebutkan stok terakhir — tepat
//       satu berhasil, stok tidak pernah negatif;
//   (b) dua penyelesaian opname untuk hitungan fisik yang sama — selisih
//       diterapkan tepat satu kali, jurnal tidak ganda.

const RACE_ORG = "01900000-0000-7000-8000-00000000aa32";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);
const today = todayISO();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function orgTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${RACE_ORG}, true)`);
    return fn(tx);
  });
}

let warehouseId = "";
let methodId = "";
let raceProductId = "";
let opnameProductId = "";
let saleTotal = 0;

beforeAll(async () => {
  await orgTx(async (tx) => {
    const [settings] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, RACE_ORG))
      .limit(1);
    if (settings) {
      // Fixture sudah pernah dibuat (file dijalankan ulang): ambil ulang id-nya.
      const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.companyId, RACE_ORG)).limit(1);
      const [method] = await tx.select({ id: paymentMethods.id }).from(paymentMethods).where(eq(paymentMethods.companyId, RACE_ORG)).limit(1);
      const rows = await tx.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.companyId, RACE_ORG));
      warehouseId = warehouse.id;
      methodId = method.id;
      raceProductId = rows.find((row) => row.sku.startsWith("T5-RACE-A-"))!.id;
      opnameProductId = rows.find((row) => row.sku.startsWith("T5-RACE-B-"))!.id;
      return;
    }

    await tx.insert(companySettings).values({
      companyId: RACE_ORG,
      legalName: "Perusahaan Uji Balapan Gudang",
      allowNegativeStock: false,
      taxRate: "0",
    });
    const accountRows = await tx
      .insert(accounts)
      .values([
        { companyId: RACE_ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "1200", name: "Persediaan", type: "asset", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
        { companyId: RACE_ORG, code: "2200", name: "PPN Keluaran", type: "liability", normalBalance: "credit" },
        { companyId: RACE_ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
        { companyId: RACE_ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "4020", name: "Retur Penjualan", type: "revenue", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "6020", name: "Selisih Stok", type: "expense", normalBalance: "debit" },
        { companyId: RACE_ORG, code: "9000", name: "Laba Pembulatan", type: "revenue", normalBalance: "credit" },
        { companyId: RACE_ORG, code: "9001", name: "Rugi Pembulatan", type: "expense", normalBalance: "debit" },
      ])
      .returning({ id: accounts.id, code: accounts.code });
    const byCode = new Map(accountRows.map((row) => [row.code, row.id]));
    await tx.insert(accountMappings).values([
      { companyId: RACE_ORG, key: "cash", accountId: byCode.get("1000")! },
      { companyId: RACE_ORG, key: "bank", accountId: byCode.get("1100")! },
      { companyId: RACE_ORG, key: "qris", accountId: byCode.get("1100")! },
      { companyId: RACE_ORG, key: "inventory", accountId: byCode.get("1200")! },
      { companyId: RACE_ORG, key: "payable", accountId: byCode.get("2000")! },
      { companyId: RACE_ORG, key: "tax_output", accountId: byCode.get("2200")! },
      { companyId: RACE_ORG, key: "revenue", accountId: byCode.get("4000")! },
      { companyId: RACE_ORG, key: "sales_discount", accountId: byCode.get("4010")! },
      { companyId: RACE_ORG, key: "sales_return", accountId: byCode.get("4020")! },
      { companyId: RACE_ORG, key: "cogs", accountId: byCode.get("5000")! },
      { companyId: RACE_ORG, key: "inventory_shrink", accountId: byCode.get("6020")! },
      { companyId: RACE_ORG, key: "rounding_gain", accountId: byCode.get("9000")! },
      { companyId: RACE_ORG, key: "rounding_loss", accountId: byCode.get("9001")! },
    ]);

    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId: RACE_ORG, code: "GDG-T5", name: "Gudang Balapan", isDefault: true })
      .returning({ id: warehouses.id });
    warehouseId = warehouse.id;

    const [method] = await tx
      .insert(paymentMethods)
      .values({ companyId: RACE_ORG, code: "CASH", name: "Tunai", type: "cash", accountId: byCode.get("1000")! })
      .returning({ id: paymentMethods.id });
    methodId = method.id;

    await tx.insert(cashSessions).values({
      companyId: RACE_ORG,
      userId: USER_ID,
      openingCash: "0",
      status: "open",
    });

    const [raceProduct] = await tx
      .insert(products)
      .values({
        companyId: RACE_ORG,
        sku: `T5-RACE-A-${suffix}`,
        name: "Produk Balapan Checkout",
        costPrice: "10000",
        salePrice: "15000",
        trackStock: true,
      })
      .returning({ id: products.id });
    raceProductId = raceProduct.id;

    const [opnameProduct] = await tx
      .insert(products)
      .values({
        companyId: RACE_ORG,
        sku: `T5-RACE-B-${suffix}`,
        name: "Produk Balapan Opname",
        costPrice: "10000",
        salePrice: "15000",
        trackStock: true,
      })
      .returning({ id: products.id });
    opnameProductId = opnameProduct.id;

    // Stok awal: produk balapan checkout tepat 1 unit (stok terakhir),
    // produk opname 5 unit. Lewat applyStockMovement agar invariant
    // stock_on_hand = Σ stock_movements tetap berlaku.
    await applyStockMovement(tx, {
      companyId: RACE_ORG,
      warehouseId,
      productId: raceProductId,
      delta: 1,
      unitCost: 10000,
      movementType: "opening",
      userId: USER_ID,
    });
    await applyStockMovement(tx, {
      companyId: RACE_ORG,
      warehouseId,
      productId: opnameProductId,
      delta: 5,
      unitCost: 10000,
      movementType: "opening",
      userId: USER_ID,
    });
  });

  saleTotal = await orgTx(async (tx) => {
    const quote = await quoteCart(tx, {
      companyId: RACE_ORG,
      warehouseId,
      customerId: null,
      lines: [{ productId: raceProductId, qty: 1 }],
    });
    return quote.total;
  });
});

/** Paksa stok ke jumlah tertentu lewat gerakan koreksi (file aman di-rerun). */
async function forceStock(productId: string, target: number) {
  await orgTx(async (tx) => {
    const [row] = await tx
      .select({ qty: stockOnHand.qty })
      .from(stockOnHand)
      .where(
        and(
          eq(stockOnHand.companyId, RACE_ORG),
          eq(stockOnHand.warehouseId, warehouseId),
          eq(stockOnHand.productId, productId),
        ),
      )
      .limit(1);
    const delta = d(target).minus(d(row?.qty ?? 0));
    if (delta.eq(0)) return;
    await applyStockMovement(tx, {
      companyId: RACE_ORG,
      warehouseId,
      productId,
      delta: delta.toNumber(),
      unitCost: 10000,
      movementType: "opening",
      userId: USER_ID,
    });
  });
}

async function finalState(productId: string) {
  return orgTx(async (tx) => {
    const [onHand] = await tx
      .select({ qty: stockOnHand.qty })
      .from(stockOnHand)
      .where(
        and(
          eq(stockOnHand.companyId, RACE_ORG),
          eq(stockOnHand.warehouseId, warehouseId),
          eq(stockOnHand.productId, productId),
        ),
      )
      .limit(1);
    const [movementSum] = await tx
      .select({ total: sql<string>`coalesce(sum(${stockMovements.qty}), 0)` })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, RACE_ORG), eq(stockMovements.productId, productId)));
    return { onHand: d(onHand?.qty ?? 0), movementSum: d(movementSum?.total ?? 0) };
  });
}

describe("Balapan gudang/POS (utang Tahap 2)", () => {
  it("(a) dua checkout konkuren memperebutkan stok terakhir: tepat satu berhasil, stok tidak negatif", async () => {
    await forceStock(raceProductId, 1);
    const salesBefore = await orgTx(async (tx) => {
      const rows = await tx.select({ id: sales.id }).from(sales).where(eq(sales.companyId, RACE_ORG));
      return rows.length;
    });
    const attempt = () =>
      orgTx((tx) =>
        createSale(tx, {
          companyId: RACE_ORG,
          userId: USER_ID,
          warehouseId,
          date: today,
          lines: [{ productId: raceProductId, qty: 1 }],
          payments: [{ methodId, amount: saleTotal, tendered: saleTotal }],
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ code: "INSUFFICIENT_STOCK" });
    }

    const state = await finalState(raceProductId);
    expect(state.onHand.toFixed(4)).toBe("0.0000");
    expect(state.movementSum.toFixed(4)).toBe(state.onHand.toFixed(4));

    const saleCount = await orgTx(async (tx) => {
      const rows = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.companyId, RACE_ORG));
      return rows.length;
    });
    expect(saleCount).toBe(salesBefore + 1);
  });

  it("(b) dua opname konkuren untuk hitungan yang sama: selisih diterapkan tepat satu kali", async () => {
    await forceStock(opnameProductId, 5);
    const attempt = () =>
      orgTx((tx) =>
        createOpname(tx, {
          companyId: RACE_ORG,
          userId: USER_ID,
          warehouseId,
          date: today,
          lines: [{ productId: opnameProductId, countedQty: 8 }],
        }),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const docIds = results.map((result) =>
      result.status === "fulfilled" ? result.value.id : "",
    );

    // Keadaan akhir konsisten: stok = hitungan fisik (8), bukan 11 (selisih
    // ganda) — yang kalah membaca stok sesudah pemenang commit sehingga
    // selisihnya nol dan tidak menulis gerakan/jurnal kedua.
    const state = await finalState(opnameProductId);
    expect(state.onHand.toFixed(4)).toBe("8.0000");
    expect(state.movementSum.toFixed(4)).toBe("8.0000");

    const journalCount = await orgTx(async (tx) => {
      const rows = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, RACE_ORG),
            eq(journalEntries.sourceType, "opname"),
            inArray(journalEntries.sourceId, docIds),
          ),
        );
      return rows.length;
    });
    expect(journalCount).toBe(1);
  });
});
