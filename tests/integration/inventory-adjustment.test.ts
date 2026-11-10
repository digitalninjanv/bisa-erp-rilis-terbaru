import { describe, expect, it } from "vitest";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  journalEntries,
  journalLines,
  products,
  stockOnHand,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { createAdjustment } from "@/server/inventory";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function pickStockedProduct(tx: Tx, warehouseId: string, minQty: number) {
  const [row] = await tx
    .select({
      productId: stockOnHand.productId,
      qty: stockOnHand.qty,
      costPrice: products.costPrice,
      name: products.name,
    })
    .from(stockOnHand)
    .innerJoin(products, eq(stockOnHand.productId, products.id))
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        gt(stockOnHand.qty, String(minQty)),
      ),
    )
    .orderBy(asc(products.sku))
    .limit(1);
  expect(row).toBeDefined();
  return row;
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
  return d(row?.qty ?? 0);
}

async function journalLinesFor(tx: Tx, sourceType: string, sourceId: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );
  expect(entry).toBeDefined();
  return tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id));
}

function accountTotals(
  lines: Awaited<ReturnType<typeof journalLinesFor>>,
  accountId: string,
) {
  const mine = lines.filter((line) => line.accountId === accountId);
  return {
    debit: mine.reduce((acc, line) => acc.plus(d(line.debit)), d(0)),
    credit: mine.reduce((acc, line) => acc.plus(d(line.credit)), d(0)),
  };
}

describe("createAdjustment sign convention (P0-1 / P1-3)", () => {
  it("damaged with a positive qty reduces stock and journals Dr damaged / Cr inventory", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await pickStockedProduct(tx, warehouse.id, 10);
      const before = await stockQty(tx, warehouse.id, product.productId);
      const map = await getAccountMap(tx, ORG_ID);

      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "damaged",
        reason: "Uji otomatis barang rusak",
        lines: [{ productId: product.productId, qty: 3 }],
      });

      const after = await stockQty(tx, warehouse.id, product.productId);
      const lines = await journalLinesFor(tx, "adjustment", doc.id);
      return { before, after, lines, map, costPrice: d(product.costPrice) };
    });

    // Positive input for an outbound type must REMOVE stock, not add it.
    expect(outcome.after.toFixed(4)).toBe(outcome.before.minus(3).toFixed(4));
    const expected = outcome.costPrice.mul(3);
    const damaged = accountTotals(outcome.lines, outcome.map.damaged);
    const inventory = accountTotals(outcome.lines, outcome.map.inventory);
    expect(damaged.debit.toFixed(4)).toBe(expected.toFixed(4));
    expect(damaged.credit.toFixed(4)).toBe("0.0000");
    expect(inventory.credit.toFixed(4)).toBe(expected.toFixed(4));
    expect(inventory.debit.toFixed(4)).toBe("0.0000");
  });

  it("rejects a negative qty for an outbound type (damaged)", async () => {
    const promise = rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await pickStockedProduct(tx, warehouse.id, 10);
      await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "damaged",
        reason: "Uji otomatis tanda qty",
        lines: [{ productId: product.productId, qty: -3 }],
      });
    });
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(promise).rejects.toThrow(/positif/);
  });

  it("mixed signed adjustment (+10 / -5) journals each direction at its own value", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await pickStockedProduct(tx, warehouse.id, 10);
      const before = await stockQty(tx, warehouse.id, product.productId);
      const map = await getAccountMap(tx, ORG_ID);

      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "adjustment",
        reason: "Uji otomatis koreksi campuran",
        // FIX-P1 (AK4-06c): unitCost 1000 di sini MENYIMPANG dari harga
        // berjalan produk contoh — memang disengaja agar jurnal dinilai
        // pada harga ketik per arah. Di bawah kontrak pagar harga pokok
        // yang baru, override seperti ini wajib diatestasi eksplisit
        // (izin + alasan); asersi jurnal di bawah tidak berubah.
        allowCostOverride: true,
        costOverrideReason: "Uji otomatis: jurnal dinilai pada harga ketik per arah",
        lines: [
          { productId: product.productId, qty: 10, unitCost: 1000 },
          { productId: product.productId, qty: -5, unitCost: 1000 },
        ],
      });

      const after = await stockQty(tx, warehouse.id, product.productId);
      const lines = await journalLinesFor(tx, "adjustment", doc.id);
      return { before, after, lines, map };
    });

    // Net stock change is +5.
    expect(outcome.after.toFixed(4)).toBe(outcome.before.plus(5).toFixed(4));
    // Journal must carry both directions: in 10 x 1000 and out 5 x 1000,
    // not a single 15-unit leg in one direction.
    const inventory = accountTotals(outcome.lines, outcome.map.inventory);
    const shrink = accountTotals(outcome.lines, outcome.map.inventory_shrink);
    expect(inventory.debit.toFixed(4)).toBe("10000.0000");
    expect(inventory.credit.toFixed(4)).toBe("5000.0000");
    expect(shrink.debit.toFixed(4)).toBe("5000.0000");
    expect(shrink.credit.toFixed(4)).toBe("10000.0000");
    const totalDebit = outcome.lines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
    const totalCredit = outcome.lines.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
    expect(totalDebit.toFixed(4)).toBe(totalCredit.toFixed(4));
  });

  it("purchase_return is rejected (FIX-P1 AK4-02): legacy adjustment path no longer journals Dr payable / Cr inventory", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await pickStockedProduct(tx, warehouse.id, 10);
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_ID))
        .limit(1);
      expect(supplier).toBeDefined();
      const before = await stockQty(tx, warehouse.id, product.productId);

      let error: unknown;
      try {
        await createAdjustment(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: todayISO(),
          type: "purchase_return",
          reason: "Uji otomatis retur pembelian",
          supplierId: supplier.id,
          refundMethod: "credit_note",
          lines: [{ productId: product.productId, qty: 2 }],
        });
      } catch (caught) {
        error = caught;
      }
      const after = await stockQty(tx, warehouse.id, product.productId);
      return { before, after, error };
    });

    // Retur pemasok hanya lewat modul Retur Pembelian (A-9/D-20);
    // jalur penyesuaian warisan ditutup agar tidak ada lagi jurnal
    // utang liar tanpa alokasi penerimaan.
    expect(outcome.error).toBeInstanceOf(AppError);
    expect((outcome.error as AppError).message).toMatch(/Retur Pembelian/);
    expect(outcome.after.toFixed(4)).toBe(outcome.before.toFixed(4));
  });
});
