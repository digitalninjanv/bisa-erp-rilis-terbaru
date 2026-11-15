import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  journalEntries,
  journalLines,
  products,
  stockDocuments,
  stockMovements,
  stockOnHand,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { listProducts } from "@/server/catalog";
import {
  createAdjustment,
  createOpname,
  createReceipt,
  createTransfer,
  voidStockDocument,
} from "@/server/inventory";
import { getInventoryValuation } from "@/server/reports";
import { AppError } from "@/lib/errors";
import { isLowStock } from "@/lib/stock";
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

async function anySupplier(tx: Tx) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(1);
  expect(supplier).toBeDefined();
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
  return d(row?.qty ?? 0);
}

/** Net (debit - credit) balance of one GL account across all company journals. */
async function accountBalance(tx: Tx, accountId: string) {
  const [row] = await tx
    .select({
      balance: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalLines.accountId, accountId)));
  return d(row?.balance ?? 0);
}

async function journalFor(tx: Tx, sourceType: string, sourceId: string) {
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
  return entry;
}

/** Fresh product stocked via a real receipt at a known unit cost. */
async function stockedProduct(
  tx: Tx,
  opts: { warehouseId: string; supplierId: string; qty: number; unitCost: number; minStock?: string },
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-P2-${suffix}`,
      name: `Produk Uji P2 ${suffix}`,
      costPrice: "0",
      salePrice: "9000",
      minStock: opts.minStock ?? "0",
      trackStock: true,
    })
    .returning({ id: products.id, sku: products.sku });
  await createReceipt(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId: opts.warehouseId,
    supplierId: opts.supplierId,
    date: todayISO(),
    lines: [{ productId: product.id, qty: opts.qty, unitCost: opts.unitCost }],
  });
  return product;
}

async function newWarehouse(tx: Tx, opts: { type?: string } = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [warehouse] = await tx
    .insert(warehouses)
    .values({
      companyId: ORG_ID,
      code: `WH-P2-${suffix}`,
      name: `Gudang Uji P2 ${suffix}`,
      type: opts.type ?? "warehouse",
    })
    .returning({ id: warehouses.id });
  return warehouse;
}

async function docRow(tx: Tx, docId: string) {
  const [doc] = await tx
    .select()
    .from(stockDocuments)
    .where(and(eq(stockDocuments.companyId, ORG_ID), eq(stockDocuments.id, docId)));
  expect(doc).toBeDefined();
  return doc;
}

describe("GD-P2-1 stock_documents.total is filled at posting", () => {
  it("adjustment document stores the absolute movement value", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "damaged",
        reason: "Uji P2 total dokumen",
        lines: [{ productId: product.id, qty: 3 }],
      });
      return docRow(tx, doc.id);
    });
    // 3 units out x Rp5.000 cost.
    expect(d(outcome.total).toFixed(2)).toBe("15000.00");
  });

  it("transfer document stores the moved value", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const target = await newWarehouse(tx);
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      const doc = await createTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        fromWarehouseId: warehouse.id,
        toWarehouseId: target.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 4 }],
      });
      return docRow(tx, doc.id);
    });
    expect(d(outcome.total).toFixed(2)).toBe("20000.00");
  });

  it("opname document stores the absolute difference value", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      const doc = await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.id, countedQty: 7 }],
      });
      return docRow(tx, doc.id);
    });
    // |7 counted - 10 system| x Rp5.000.
    expect(d(outcome.total).toFixed(2)).toBe("15000.00");
  });
});

describe("GD-P2-2 the original document type is stored on stock_documents", () => {
  it("a damaged document keeps type 'damaged' and can still be voided with its journal reversed", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "damaged",
        reason: "Uji P2 tipe dokumen rusak",
        lines: [{ productId: product.id, qty: 3 }],
      });
      const stored = await docRow(tx, doc.id);
      const afterAdjust = await stockQty(tx, warehouse.id, product.id);
      const original = await journalFor(tx, "adjustment", doc.id);
      expect(original).toBeDefined();

      await voidStockDocument(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        documentId: doc.id,
        reason: "Uji P2 batalkan dokumen rusak",
        date: todayISO(),
      });

      const afterVoid = await stockQty(tx, warehouse.id, product.id);
      const voided = await docRow(tx, doc.id);
      const [reversal] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.reversalOfId, original!.id),
          ),
        );
      return { stored, afterAdjust, afterVoid, voided, reversal };
    });

    expect(outcome.stored.type).toBe("damaged");
    expect(outcome.afterAdjust.toFixed(2)).toBe("7.00");
    expect(outcome.afterVoid.toFixed(2)).toBe("10.00");
    expect(outcome.voided.status).toBe("void");
    // The write-off journal of a 'damaged' document must be reversed on void,
    // not silently left standing.
    expect(outcome.reversal).toBeDefined();
  });
});

describe("GD-P2-3a quarantine moves goods to the quarantine warehouse", () => {
  it("stock leaves the source warehouse and lands in the quarantine warehouse, with no write-off journal and no GL inventory change", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const quarantine = await newWarehouse(tx, { type: "quarantine" });
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      const map = await getAccountMap(tx, ORG_ID);
      const inventoryBefore = await accountBalance(tx, map.inventory);

      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "quarantine",
        reason: "Uji P2 karantina",
        lines: [{ productId: product.id, qty: 4 }],
      });

      const sourceQty = await stockQty(tx, warehouse.id, product.id);
      const quarantineQty = await stockQty(tx, quarantine.id, product.id);
      const inventoryAfter = await accountBalance(tx, map.inventory);
      const journal = await journalFor(tx, "adjustment", doc.id);
      const movements = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceId, doc.id),
          ),
        );
      const stored = await docRow(tx, doc.id);
      return { sourceQty, quarantineQty, inventoryBefore, inventoryAfter, journal, movements, stored };
    });

    expect(outcome.sourceQty.toFixed(2)).toBe("6.00");
    expect(outcome.quarantineQty.toFixed(2)).toBe("4.00");
    // Goods still exist as inventory: no journal at all for the document and
    // the GL inventory balance is untouched.
    expect(outcome.journal).toBeUndefined();
    expect(outcome.inventoryAfter.minus(outcome.inventoryBefore).toFixed(2)).toBe("0.00");
    // Both legs are traceable to the document as quarantine movements.
    const legs = outcome.movements
      .map((m) => ({ warehouseId: m.warehouseId, qty: d(m.qty), type: m.movementType }))
      .sort((a, b) => a.qty.comparedTo(b.qty));
    expect(legs).toHaveLength(2);
    expect(legs[0].qty.toFixed(2)).toBe("-4.00");
    expect(legs[1].qty.toFixed(2)).toBe("4.00");
    expect(legs.every((leg) => leg.type === "quarantine")).toBe(true);
    expect(outcome.stored.type).toBe("quarantine");
    expect(d(outcome.stored.total).toFixed(2)).toBe("20000.00");
  });

  it("rejects quarantine when the company has no quarantine warehouse", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      let error: unknown;
      try {
        await createAdjustment(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: todayISO(),
          type: "quarantine",
          reason: "Uji P2 karantina tanpa gudang karantina",
          lines: [{ productId: product.id, qty: 2 }],
        });
      } catch (caught) {
        error = caught;
      }
      const qtyAfter = await stockQty(tx, warehouse.id, product.id);
      return { error: error as AppError | undefined, qtyAfter };
    });

    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error?.code).toBe("VALIDATION");
    expect(outcome.error?.message).toMatch(/karantina/i);
    expect(outcome.qtyAfter.toFixed(2)).toBe("10.00");
  });

  it("rejects quarantine out of the quarantine warehouse itself", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const supplier = await anySupplier(tx);
      const quarantine = await newWarehouse(tx, { type: "quarantine" });
      const product = await stockedProduct(tx, {
        warehouseId: quarantine.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      let error: unknown;
      try {
        await createAdjustment(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: quarantine.id,
          date: todayISO(),
          type: "quarantine",
          reason: "Uji P2 karantina dari gudang karantina",
          lines: [{ productId: product.id, qty: 2 }],
        });
      } catch (caught) {
        error = caught;
      }
      return { error: error as AppError | undefined };
    });

    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error?.code).toBe("VALIDATION");
    expect(outcome.error?.message).toMatch(/karantina/i);
  });
});

describe("GD-P2-3b ditutup oleh FIX-P1 (AK4-02): retur pemasok tidak lagi lewat penyesuaian stok", () => {
  // Keputusan D-3 lama (replacement → Dr Piutang Usaha; credit_note →
  // Dr Utang Usaha tanpa alokasi) dinyatakan SALAH oleh audit
  // adversarial: klaim penggantian bukan piutang pelanggan, dan debit
  // utang tanpa alokasi membuat utang terbayar dua kali. Retur pemasok
  // yang benar hanya modul Retur Pembelian (A-9/D-20).
  it.each(["replacement", "credit_note"] as const)(
    "metode %s ditolak; tidak ada jurnal purchase_return dan stok tidak bergerak",
    async (refundMethod) => {
      const outcome = await rollbackTransaction(async (tx) => {
        const warehouse = await defaultWarehouse(tx);
        const supplier = await anySupplier(tx);
        const product = await stockedProduct(tx, {
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          qty: 10,
          unitCost: 5000,
        });

        let error: unknown;
        try {
          await createAdjustment(tx, {
            companyId: ORG_ID,
            userId: USER_ID,
            warehouseId: warehouse.id,
            date: todayISO(),
            type: "purchase_return",
            reason: "Uji P2 retur jalur warisan",
            supplierId: supplier.id,
            refundMethod,
            lines: [{ productId: product.id, qty: 2 }],
          });
        } catch (caught) {
          error = caught;
        }
        const stockAfter = await stockQty(tx, warehouse.id, product.id);
        const entries = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.companyId, ORG_ID),
              eq(journalEntries.sourceType, "purchase_return"),
            ),
          );
        return { error, stockAfter, entries };
      });

      expect(outcome.error).toBeInstanceOf(AppError);
      expect((outcome.error as AppError).message).toMatch(/Retur Pembelian/);
      expect(outcome.stockAfter.toFixed(2)).toBe("10.00");
      expect(outcome.entries).toHaveLength(0);
    },
  );
});

describe("GD-P2-4 opname validates duplicate lines on the server", () => {
  it("rejects an opname document that lists the same product twice", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 10,
        unitCost: 5000,
      });
      let error: unknown;
      try {
        await createOpname(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: todayISO(),
          lines: [
            { productId: product.id, countedQty: 9 },
            { productId: product.id, countedQty: 8 },
          ],
        });
      } catch (caught) {
        error = caught;
      }
      const qtyAfter = await stockQty(tx, warehouse.id, product.id);
      return { error: error as AppError | undefined, qtyAfter };
    });

    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error?.code).toBe("VALIDATION");
    expect(outcome.error?.message).toMatch(/sama/i);
    // No double difference may leak through: stock is untouched because the
    // whole transaction rolls back on the domain error in real usage; here
    // the important part is the rejection itself.
    expect(outcome.qtyAfter.toFixed(2)).toBe("10.00");
  });
});

describe("GD-P2-10 / D-4 canonical low-stock definition", () => {
  it("isLowStock compares the displayed qty against the product minStock", () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock("5.0000", "5")).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
    expect(isLowStock(0, 0)).toBe(true);
    expect(isLowStock("3", "10")).toBe(true);
    expect(isLowStock("10.0001", "10")).toBe(false);
  });

  it("product list and valuation judge low stock by the warehouse figure they display", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const other = await newWarehouse(tx);
      const product = await stockedProduct(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        qty: 3,
        unitCost: 5000,
        minStock: "10",
      });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: other.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 20, unitCost: 5000 }],
      });

      const listDefault = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        q: product.sku,
        lowStock: true,
      });
      const listOther = await listProducts(tx, {
        companyId: ORG_ID,
        warehouseId: other.id,
        q: product.sku,
        lowStock: true,
      });
      const valuationDefault = await getInventoryValuation(tx, ORG_ID, warehouse.id);
      const valuationOther = await getInventoryValuation(tx, ORG_ID, other.id);
      const valuationPage = await getInventoryValuation(tx, ORG_ID, warehouse.id, {
        page: 1,
        pageSize: 1,
        skipLowStockRows: true,
      });
      expect(valuationDefault.lowStockCount).toBe(valuationDefault.lowStock.length);
      expect(valuationOther.lowStockCount).toBe(valuationOther.lowStock.length);
      expect(valuationPage.items).toEqual(valuationDefault.items.slice(0, 1));
      expect(valuationPage.lowStock).toEqual([]);
      expect(valuationPage.lowStockCount).toBe(valuationDefault.lowStock.length);
      expect(valuationPage.totalQty).toBe(valuationDefault.totalQty);
      expect(valuationPage.totalValue).toBe(valuationDefault.totalValue);
      expect(valuationPage.totalPotential).toBe(valuationDefault.totalPotential);
      return { product, listDefault, listOther, valuationDefault, valuationOther, valuationPage };
    });

    // Default warehouse displays 3 <= minStock 10: low there.
    expect(outcome.listDefault.rows.map((r) => r.id)).toContain(outcome.product.id);
    expect(
      outcome.valuationDefault.lowStock.map((r) => r.productId),
    ).toContain(outcome.product.id);
    // The other warehouse displays 20 > 10: not low there, even though the
    // product is low elsewhere. One canonical rule, applied per page figure.
    expect(outcome.listOther.rows.map((r) => r.id)).not.toContain(outcome.product.id);
    expect(
      outcome.valuationOther.lowStock.map((r) => r.productId),
    ).not.toContain(outcome.product.id);
  });
});
