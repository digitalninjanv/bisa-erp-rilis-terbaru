import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  journalEntries,
  journalLines,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockBatches,
  stockDocumentLines,
  stockDocuments,
  stockMovements,
  stockOnHand,
  stockReceiptLines,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { getAccountMap } from "@/server/accounting";
import { listMovements } from "@/server/catalog";
import {
  applyStockMovement,
  createAdjustment,
  createOpname,
  createReceipt,
  createTransfer,
  voidReceipt,
} from "@/server/inventory";
import { createPurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import { AppError } from "@/lib/errors";
import {
  createTaxonomyAction,
  toggleCategoryAction,
} from "@/server/actions/inventory/taksonomi";
import {
  deleteSupplierAction,
  saveSupplierAction,
} from "@/server/actions/inventory/pihak";
import {
  saveProductAction,
  searchInventoryProductsAction,
  toggleProductAction,
} from "@/server/actions/inventory/produk";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Feature-matrix tests (A-5): each test closes one row of
// docs/reports/MATRIKS-FITUR-GUDANG.md that no earlier batch test proved.
// Domain tests run in rollback transactions; the action-level describe at
// the bottom mocks the session (master-crud.test.ts pattern) and cleans up
// its committed fixtures afterwards.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    // FIX-GDG Tahap 3: fixture sesi ini mewakili aktor berizin penuh
    // (owner perusahaan demo). Role dinyatakan eksplisit karena
    // saveProductAction kini menilai can(ctx, "inventory.price") untuk
    // perubahan harga (GDG3-11) — tanpa role, can() jatuh ke bawaan
    // viewer dan edit harga M-5 tertolak bukan karena asersinya salah,
    // melainkan karena fixture tidak pernah menyatakan perannya.
    role: "owner",
  });
  // T5R-2: fixture sesi ini mewakili perusahaan dengan semua modul
  // aktif, jadi gerbang modul di lapisan action lolos persis seperti
  // requirePermission (gerbang sungguhannya diuji di review-fixes-t5r).
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
  };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const GHOST_ID = "01900000-0000-7000-8000-00000000dead";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID, { before: alignSequences });

/**
 * Isolasi penomoran: perusahaan demo bersama `…0001` menyimpan dokumen
 * ter-commit dari seed/program terdahulu (mis. PO-2026-00001) sementara
 * baris `document_sequences` untuk serinya tidak ada/tertinggal, sehingga
 * penerbitan nomor di dalam transaksi rollback mulai lagi dari 1 dan
 * menabrak unique constraint nomor dokumen. Di dalam transaksi uji (ikut
 * ter-rollback), samakan penomoran semua seri yang diterbitkan berkas ini
 * ke max(nomor ter-commit)+1 agar test deterministik di keadaan awal apa
 * pun (pola yang sama dengan rem-name-snapshot.test.ts).
 */
async function alignSequences(tx: Tx) {
  const year = new Date().getUTCFullYear();
  const series: [string, string, string][] = [
    ["PURCHASE_ORDER", "purchase_orders", "PO"],
    ["RECEIPT", "stock_receipts", "RCV"],
    ["ADJUSTMENT", "stock_documents", "ADJ"],
    ["TRANSFER", "stock_documents", "TRF"],
    ["OPNAME", "stock_documents", "OPN"],
  ];
  for (const [docType, table, prefix] of series) {
    await tx.execute(sql`
      insert into document_sequences (company_id, doc_type, fiscal_year, prefix, next_number)
      select ${ORG_ID}, ${docType}, ${year}, ${prefix},
             coalesce(max(cast(substring(number from '[0-9]+$') as integer)), 0) + 1
        from ${sql.raw(table)}
       where company_id = ${ORG_ID} and number like ${`${prefix}-${year}-%`}
      on conflict (company_id, doc_type, fiscal_year)
      do update set next_number = greatest(document_sequences.next_number, excluded.next_number)
    `);
  }
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

async function otherWarehouse(tx: Tx, excludeId: string) {
  const rows = await tx
    .select()
    .from(warehouses)
    .where(eq(warehouses.companyId, ORG_ID));
  const found = rows.find((row) => row.id !== excludeId && row.isActive);
  expect(found).toBeDefined();
  return found!;
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

let skuCounter = 0;

async function makeProduct(
  tx: Tx,
  input: {
    supplierId?: string | null;
    costPrice?: string;
    trackBatch?: boolean;
  } = {},
) {
  skuCounter += 1;
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TEST-MTRX-${String(skuCounter).padStart(3, "0")}`,
      name: `Produk Matriks ${skuCounter}`,
      supplierId: input.supplierId ?? null,
      costPrice: input.costPrice ?? "2500",
      salePrice: "3000",
      minStock: "0",
      trackStock: true,
      trackBatch: input.trackBatch ?? false,
      isActive: true,
    })
    .returning();
  return product;
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

async function movementSum(tx: Tx, warehouseId: string, productId: string) {
  const rows = await tx
    .select({ qty: stockMovements.qty })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, ORG_ID),
        eq(stockMovements.warehouseId, warehouseId),
        eq(stockMovements.productId, productId),
      ),
    );
  return rows.reduce((acc, row) => acc.plus(d(row.qty)), d(0));
}

async function getOrder(tx: Tx, orderId: string) {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.companyId, ORG_ID), eq(purchaseOrders.id, orderId)))
    .limit(1);
  expect(order).toBeDefined();
  return order;
}

async function getOrderLine(tx: Tx, orderId: string, productId: string) {
  const [line] = await tx
    .select()
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.companyId, ORG_ID),
        eq(purchaseOrderLines.orderId, orderId),
        eq(purchaseOrderLines.productId, productId),
      ),
    )
    .limit(1);
  expect(line).toBeDefined();
  return line;
}

async function makeSentOrder(
  tx: Tx,
  supplierId: string,
  productId: string,
  qty: string,
  unitCost = "2500",
) {
  const order = await createPurchaseOrder(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    supplierId,
    date: todayISO(),
    lines: [{ productId, qty, unitCost }],
  });
  await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });
  return order;
}

async function receiveAgainstOrder(
  tx: Tx,
  input: {
    warehouseId: string;
    supplierId: string;
    orderId: string;
    productId: string;
    qty: string | number;
    unitCost?: string | number;
    batchNumber?: string;
    expiryDate?: string;
  },
) {
  return createReceipt(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId: input.warehouseId,
    supplierId: input.supplierId,
    source: "purchase",
    purchaseOrderId: input.orderId,
    date: todayISO(),
    lines: [
      {
        productId: input.productId,
        qty: input.qty,
        unitCost: input.unitCost ?? "2500",
        ...(input.batchNumber ? { batchNumber: input.batchNumber } : {}),
        ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
      },
    ],
  });
}

/** Posted journal lines for one account of one journal entry. */
async function journalAccountTotals(
  tx: Tx,
  sourceType: string,
  sourceId: string,
  accountId: string,
) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  expect(entry).toBeDefined();
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id));
  const mine = lines.filter((line) => line.accountId === accountId);
  return {
    entry,
    debit: mine.reduce((acc, line) => acc.plus(d(line.debit)), d(0)),
    credit: mine.reduce((acc, line) => acc.plus(d(line.credit)), d(0)),
  };
}

describe("Matriks Gudang — void penerimaan tertaut PO (G7 × void)", () => {
  it("(M-1a) void penerimaan penuh: receivedQty kembali 0, status PO received → sent, stok nol", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, { supplierId: supplier.id });
      const order = await makeSentOrder(tx, supplier.id, product.id, "10");

      const receipt = await receiveAgainstOrder(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        orderId: order.id,
        productId: product.id,
        qty: "10",
      });
      expect(d((await getOrderLine(tx, order.id, product.id)).receivedQty).toNumber()).toBe(10);
      expect((await getOrder(tx, order.id)).status).toBe("received");
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(10);

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: receipt.id,
        reason: "Matriks: penerimaan PO salah input",
        date: todayISO(),
      });

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(stored.status).toBe("void");
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(0);
      expect(d((await getOrderLine(tx, order.id, product.id)).receivedQty).toNumber()).toBe(0);
      expect((await getOrder(tx, order.id)).status).toBe("sent");
    });
  });

  it("(M-1b) void penerimaan kedua: status PO received → partial, receivedQty tinggal penerimaan pertama", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, { supplierId: supplier.id });
      const order = await makeSentOrder(tx, supplier.id, product.id, "10");

      await receiveAgainstOrder(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        orderId: order.id,
        productId: product.id,
        qty: "4",
      });
      const second = await receiveAgainstOrder(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        orderId: order.id,
        productId: product.id,
        qty: "6",
      });
      expect((await getOrder(tx, order.id)).status).toBe("received");

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: second.id,
        reason: "Matriks: penerimaan kedua duplikat",
        date: todayISO(),
      });

      expect(d((await getOrderLine(tx, order.id, product.id)).receivedQty).toNumber()).toBe(4);
      expect((await getOrder(tx, order.id)).status).toBe("partial");
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(4);
    });
  });
});

describe("Matriks Gudang — penerimaan terhadap PO untuk produk track_batch (G7 × G8)", () => {
  it("(M-2) terima sebagian lalu penuh: progres PO maju, batch tercatat, invariant Σ batch = stok", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, {
        supplierId: supplier.id,
        costPrice: "1000",
        trackBatch: true,
      });
      const order = await makeSentOrder(tx, supplier.id, product.id, "10", "1000");

      const first = await receiveAgainstOrder(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        orderId: order.id,
        productId: product.id,
        qty: "6",
        unitCost: "1000",
        batchNumber: "LOT-PO-A",
        expiryDate: addDays(todayISO(), 200),
      });

      expect(d((await getOrderLine(tx, order.id, product.id)).receivedQty).toNumber()).toBe(6);
      expect((await getOrder(tx, order.id)).status).toBe("partial");

      const [receiptLine] = await tx
        .select()
        .from(stockReceiptLines)
        .where(eq(stockReceiptLines.receiptId, first.id));
      expect(receiptLine.batchNumber).toBe("LOT-PO-A");
      expect(receiptLine.expiryDate).toBe(addDays(todayISO(), 200));

      const batchRows = await tx
        .select()
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.companyId, ORG_ID),
            eq(stockBatches.warehouseId, warehouse.id),
            eq(stockBatches.productId, product.id),
          ),
        );
      expect(batchRows).toHaveLength(1);
      expect(batchRows[0].batchNumber).toBe("LOT-PO-A");
      expect(d(batchRows[0].qty).toNumber()).toBe(6);
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(6);

      await receiveAgainstOrder(tx, {
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        orderId: order.id,
        productId: product.id,
        qty: "4",
        unitCost: "1000",
        batchNumber: "LOT-PO-B",
        expiryDate: addDays(todayISO(), 300),
      });

      expect(d((await getOrderLine(tx, order.id, product.id)).receivedQty).toNumber()).toBe(10);
      expect((await getOrder(tx, order.id)).status).toBe("received");
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(10);

      // D-7 invariant across both PO batches.
      const allBatches = await tx
        .select({ qty: stockBatches.qty })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.companyId, ORG_ID),
            eq(stockBatches.warehouseId, warehouse.id),
            eq(stockBatches.productId, product.id),
          ),
        );
      const batchSum = allBatches.reduce((acc, row) => acc.plus(d(row.qty)), d(0));
      expect(batchSum.toFixed(4)).toBe("10.0000");
    });
  });

  it("(M-2b) penerimaan tertaut PO untuk produk batch tanpa nomor batch ditolak; PO dan stok tidak berubah", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, {
        supplierId: supplier.id,
        costPrice: "1000",
        trackBatch: true,
      });
      const order = await makeSentOrder(tx, supplier.id, product.id, "5", "1000");

      let error: unknown;
      try {
        await receiveAgainstOrder(tx, {
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          orderId: order.id,
          productId: product.id,
          qty: "5",
          unitCost: "1000",
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as Error).message).toMatch(/batch/i);

      expect(d((await getOrderLine(tx, order.id, product.id)).receivedQty).toNumber()).toBe(0);
      expect((await getOrder(tx, order.id)).status).toBe("sent");
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(0);
    });
  });
});

describe("Matriks Gudang — transfer antargudang end-to-end", () => {
  it("(M-3) transfer memindahkan stok kedua sisi lewat dua gerakan tertaut; on_hand = Σ gerakan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const target = await otherWarehouse(tx, warehouse.id);
      const product = await makeProduct(tx, { costPrice: "5000" });
      await applyStockMovement(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: product.id,
        delta: "10",
        unitCost: "5000",
        movementType: "opening",
        userId: USER_ID,
      });

      const doc = await createTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        fromWarehouseId: warehouse.id,
        toWarehouseId: target.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 4 }],
      });

      const [stored] = await tx
        .select()
        .from(stockDocuments)
        .where(eq(stockDocuments.id, doc.id));
      expect(stored.type).toBe("transfer");
      expect(stored.status).toBe("posted");
      expect(d(stored.total ?? "0").toFixed(2)).toBe("20000.00");

      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(6);
      expect((await stockQty(tx, target.id, product.id)).toNumber()).toBe(4);

      const movements = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceId, doc.id),
          ),
        );
      expect(movements).toHaveLength(2);
      const out = movements.find((row) => row.movementType === "transfer_out");
      const into = movements.find((row) => row.movementType === "transfer_in");
      expect(out?.warehouseId).toBe(warehouse.id);
      expect(d(out!.qty).toNumber()).toBe(-4);
      expect(into?.warehouseId).toBe(target.id);
      expect(d(into!.qty).toNumber()).toBe(4);

      // Ledger and cache agree on both sides after the transfer.
      expect((await movementSum(tx, warehouse.id, product.id)).toNumber()).toBe(6);
      expect((await movementSum(tx, target.id, product.id)).toNumber()).toBe(4);
    });
  });

  it("(M-3b) transfer melebihi stok asal ditolak (penjaga stok negatif) dan kedua gudang tidak berubah", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const target = await otherWarehouse(tx, warehouse.id);
      const product = await makeProduct(tx, { costPrice: "5000" });
      await applyStockMovement(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: product.id,
        delta: "3",
        unitCost: "5000",
        movementType: "opening",
        userId: USER_ID,
      });

      let error: unknown;
      try {
        await createTransfer(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          fromWarehouseId: warehouse.id,
          toWarehouseId: target.id,
          date: todayISO(),
          lines: [{ productId: product.id, qty: 5 }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "INSUFFICIENT_STOCK" });
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(3);
      expect((await stockQty(tx, target.id, product.id)).toNumber()).toBe(0);
    });
  });
});

describe("Matriks Gudang — opname end-to-end (selisih + jurnal)", () => {
  it("(M-4) opname kurang menjurnal selisih kurang, opname lebih membalik arah; stok mengikuti hasil hitung", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await makeProduct(tx, { costPrice: "5000" });
      await applyStockMovement(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: product.id,
        delta: "10",
        unitCost: "5000",
        movementType: "opening",
        userId: USER_ID,
      });
      const map = await getAccountMap(tx, ORG_ID);

      // Counted 7 against a system qty of 10: shortage of 3 × Rp5.000.
      const shortage = await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.id, countedQty: 7 }],
      });
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(7);

      const [shortageLine] = await tx
        .select()
        .from(stockDocumentLines)
        .where(eq(stockDocumentLines.documentId, shortage.id));
      expect(d(shortageLine.systemQty ?? "0").toNumber()).toBe(10);
      expect(d(shortageLine.qty).toNumber()).toBe(-3);

      const shrink = await journalAccountTotals(tx, "opname", shortage.id, map.inventory_shrink);
      expect(shrink.debit.toFixed(2)).toBe("15000.00");
      expect(shrink.credit.toFixed(2)).toBe("0.00");
      const inventory = await journalAccountTotals(tx, "opname", shortage.id, map.inventory);
      expect(inventory.credit.toFixed(2)).toBe("15000.00");

      // Counted 9 against the new system qty of 7: surplus of 2 × Rp5.000.
      const surplus = await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.id, countedQty: 9 }],
      });
      expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(9);

      const inventoryUp = await journalAccountTotals(tx, "opname", surplus.id, map.inventory);
      expect(inventoryUp.debit.toFixed(2)).toBe("10000.00");
      const shrinkDown = await journalAccountTotals(tx, "opname", surplus.id, map.inventory_shrink);
      expect(shrinkDown.credit.toFixed(2)).toBe("10000.00");

      // The ledger still explains the physical stock exactly.
      expect((await movementSum(tx, warehouse.id, product.id)).toNumber()).toBe(9);
    });
  });
});

describe("Matriks Gudang — retur pemasok TIDAK lagi lewat penyesuaian (FIX-P1 AK4-02)", () => {
  async function stockedForReturn(tx: Tx) {
    const warehouse = await defaultWarehouse(tx);
    const supplier = await anySupplier(tx);
    const product = await makeProduct(tx, { costPrice: "5000" });
    await applyStockMovement(tx, {
      companyId: ORG_ID,
      warehouseId: warehouse.id,
      productId: product.id,
      delta: "10",
      unitCost: "5000",
      movementType: "opening",
      userId: USER_ID,
    });
    return { warehouse, supplier, product };
  }

  // M-11 lama menegaskan jurnal Dr kas / Dr utang dari dokumen
  // penyesuaian bertipe purchase_return. Audit adversarial (AK4-02)
  // menyatakan jalur itu salah: debit utang tanpa alokasi penerimaan
  // (risiko bayar ganda). Matriks kini menegaskan PENOLAKANNYA; retur
  // pemasok yang benar diuji di tests/integration/supplier-returns.test.ts.
  it.each(["cash", "deduction"] as const)(
    "(M-11) refundMethod %s ditolak: stok tetap, tidak ada dokumen maupun jurnal",
    async (refundMethod) => {
      await rollbackTransaction(async (tx) => {
        const { warehouse, supplier, product } = await stockedForReturn(tx);

        let error: unknown;
        try {
          await createAdjustment(tx, {
            companyId: ORG_ID,
            userId: USER_ID,
            warehouseId: warehouse.id,
            date: todayISO(),
            type: "purchase_return",
            reason: "Matriks: retur ke pemasok jalur warisan",
            supplierId: supplier.id,
            refundMethod,
            lines: [{ productId: product.id, qty: 2 }],
          });
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toMatch(/Retur Pembelian/);
        expect((await stockQty(tx, warehouse.id, product.id)).toNumber()).toBe(10);
        const docs = await tx
          .select()
          .from(stockDocuments)
          .where(
            and(eq(stockDocuments.companyId, ORG_ID), eq(stockDocuments.type, "purchase_return")),
          );
        expect(docs).toHaveLength(0);
      });
    },
  );
});

describe("Matriks Gudang — daftar pergerakan terpaginasi (listMovements)", () => {
  it("(M-8) pagination per produk: total konsisten antar halaman dan baris tidak tumpang tindih", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await makeProduct(tx, {});
      for (const qty of ["1", "2", "3"]) {
        await applyStockMovement(tx, {
          companyId: ORG_ID,
          warehouseId: warehouse.id,
          productId: product.id,
          delta: qty,
          unitCost: "2500",
          movementType: "opening",
          userId: USER_ID,
        });
      }

      const page1 = await listMovements(tx, {
        companyId: ORG_ID,
        productId: product.id,
        page: 1,
        pageSize: 2,
      });
      const page2 = await listMovements(tx, {
        companyId: ORG_ID,
        productId: product.id,
        page: 2,
        pageSize: 2,
      });

      expect(page1.total).toBe(3);
      expect(page2.total).toBe(3);
      expect(page1.rows).toHaveLength(2);
      expect(page2.rows).toHaveLength(1);
      const page1Ids = new Set(page1.rows.map((row) => row.id));
      expect(page2.rows.every((row) => !page1Ids.has(row.id))).toBe(true);
      // listMovements rows are display-shaped (no productId); the exact
      // total of 3 in a database full of other products' movements already
      // proves the product filter, and every row carries this product's SKU.
      expect(
        [...page1.rows, ...page2.rows].every((row) => row.sku === product.sku),
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Action-level rows: product edit / activation toggle / product picker.
// Fixtures are committed through the real actions, so they use unique
// MTRX-ACT SKUs and are removed afterwards (audit rows are append-only and
// stay, exactly like master-crud.test.ts).
// ---------------------------------------------------------------------------

const SKU_EDIT = "MTRX-ACT-EDIT";
const SKU_TOGGLE = "MTRX-ACT-TOGGLE";
const SKU_SEARCH = "MTRX-ACT-CARI";
const SKU_SUPPLIER_PRODUCT = "MTRX-ACT-SUPPROD";
const ACTION_SKUS = [SKU_EDIT, SKU_TOGGLE, SKU_SEARCH, SKU_SUPPLIER_PRODUCT];
const SUPPLIER_CODE = "SUP-MTRX";
const CATEGORY_NAME = "Kategori Matriks Toggle";

async function cleanupActionFixtures() {
  await withCompany(ORG_ID, async (tx) => {
    for (const sku of ACTION_SKUS) {
      await tx
        .delete(products)
        .where(and(eq(products.companyId, ORG_ID), eq(products.sku, sku)));
    }
    await tx
      .delete(suppliers)
      .where(and(eq(suppliers.companyId, ORG_ID), eq(suppliers.code, SUPPLIER_CODE)));
    await tx
      .delete(categories)
      .where(and(eq(categories.companyId, ORG_ID), eq(categories.name, CATEGORY_NAME)));
  });
}

async function productBySku(sku: string) {
  const rows = await withCompany(ORG_ID, async (tx) =>
    tx
      .select()
      .from(products)
      .where(and(eq(products.companyId, ORG_ID), eq(products.sku, sku)))
      .limit(1),
  );
  return rows[0];
}

describe("Matriks Gudang — produk lewat action: edit, nonaktif, pemilih produk", () => {
  beforeAll(cleanupActionFixtures);
  afterAll(cleanupActionFixtures);

  it("(M-5) saveProductAction dengan id mengubah nama & harga; id hantu ditolak NOT_FOUND", async () => {
    const created = await saveProductAction({
      name: "Produk Matriks Edit",
      sku: SKU_EDIT,
      costPrice: "1000",
      salePrice: "2000",
      minStock: "0",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;

    const edited = await saveProductAction({
      id,
      name: "Produk Matriks Edit Revisi",
      sku: SKU_EDIT,
      costPrice: "1500",
      salePrice: "2750",
      minStock: "1",
    });
    expect(edited.ok).toBe(true);

    const row = await productBySku(SKU_EDIT);
    expect(row?.name).toBe("Produk Matriks Edit Revisi");
    expect(d(row!.costPrice).toFixed(2)).toBe("1500.00");
    expect(d(row!.salePrice).toFixed(2)).toBe("2750.00");
    expect(d(row!.minStock).toFixed(2)).toBe("1.00");

    const ghost = await saveProductAction({
      id: GHOST_ID,
      name: "Produk Hantu Matriks",
      sku: "MTRX-ACT-HANTU",
      costPrice: "1000",
      salePrice: "2000",
      minStock: "0",
    });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");
  });

  it("(M-5b) toggleProductAction menonaktifkan lalu mengaktifkan kembali produk", async () => {
    const created = await saveProductAction({
      name: "Produk Matriks Toggle",
      sku: SKU_TOGGLE,
      costPrice: "1000",
      salePrice: "2000",
      minStock: "0",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const off = await toggleProductAction({ id: created.data.id, isActive: false });
    expect(off.ok).toBe(true);
    expect((await productBySku(SKU_TOGGLE))?.isActive).toBe(false);

    const on = await toggleProductAction({ id: created.data.id, isActive: true });
    expect(on.ok).toBe(true);
    expect((await productBySku(SKU_TOGGLE))?.isActive).toBe(true);
  });

  it("(M-5c) toggleProductAction menolak id hantu dengan NOT_FOUND (temuan matriks T-1)", async () => {
    const ghost = await toggleProductAction({
      id: "01900000-0000-7000-8000-00000000dead",
      isActive: false,
    });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");
  });

  it("(M-6) searchInventoryProductsAction menemukan produk aktif dari nama & SKU; yang nonaktif tidak tampil", async () => {
    const created = await saveProductAction({
      name: "MatriksKopiSusu Spesial",
      sku: SKU_SEARCH,
      costPrice: "1000",
      salePrice: "2000",
      minStock: "0",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;

    const byName = await searchInventoryProductsAction("MatriksKopi");
    expect(byName.ok).toBe(true);
    if (byName.ok) {
      expect(byName.data.some((row) => row.id === id)).toBe(true);
    }

    const bySku = await searchInventoryProductsAction(SKU_SEARCH);
    expect(bySku.ok).toBe(true);
    if (bySku.ok) {
      expect(bySku.data.some((row) => row.id === id)).toBe(true);
    }

    await toggleProductAction({ id, isActive: false });
    const hidden = await searchInventoryProductsAction("MatriksKopi");
    expect(hidden.ok).toBe(true);
    if (hidden.ok) {
      expect(hidden.data.some((row) => row.id === id)).toBe(false);
    }
  });

  it("(M-9) toggleCategoryAction menonaktifkan lalu mengaktifkan kembali kategori", async () => {
    const created = await createTaxonomyAction({ kind: "category", name: CATEGORY_NAME });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;

    const off = await toggleCategoryAction({ id, isActive: false });
    expect(off.ok).toBe(true);
    const [offRow] = await withCompany(ORG_ID, (tx) =>
      tx
        .select({ isActive: categories.isActive })
        .from(categories)
        .where(and(eq(categories.companyId, ORG_ID), eq(categories.id, id)))
        .limit(1),
    );
    expect(offRow?.isActive).toBe(false);

    const on = await toggleCategoryAction({ id, isActive: true });
    expect(on.ok).toBe(true);
    const [onRow] = await withCompany(ORG_ID, (tx) =>
      tx
        .select({ isActive: categories.isActive })
        .from(categories)
        .where(and(eq(categories.companyId, ORG_ID), eq(categories.id, id)))
        .limit(1),
    );
    expect(onRow?.isActive).toBe(true);
  });

  it("(M-10) deleteSupplierAction menolak pemasok yang masih menjadi pemasok utama produk", async () => {
    const supplier = await saveSupplierAction({ code: SUPPLIER_CODE, name: "Pemasok Matriks" });
    expect(supplier.ok).toBe(true);
    if (!supplier.ok) return;

    const product = await saveProductAction({
      name: "Produk Matriks Pemasok",
      sku: SKU_SUPPLIER_PRODUCT,
      supplierId: supplier.data.id,
      costPrice: "1000",
      salePrice: "2000",
      minStock: "0",
    });
    expect(product.ok).toBe(true);

    const blocked = await deleteSupplierAction(supplier.data.id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("CONFLICT");
  });
});
