import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  journalEntries,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { applyStockMovement, createReceipt } from "@/server/inventory";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createPurchaseOrdersFromRecommendations,
  listPurchaseRecommendations,
  sendPurchaseOrder,
} from "@/server/purchasing";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID, { before: alignSequences });

/**
 * Isolasi penomoran: perusahaan demo bersama `…0001` menyimpan dokumen
 * ter-commit dari seed/program terdahulu (mis. PO-2026-00001) sementara
 * baris `document_sequences` untuk serinya tidak ada/tertinggal, sehingga
 * penerbitan nomor di dalam transaksi rollback mulai lagi dari 1 dan
 * menabrak unique constraint nomor dokumen. Di dalam transaksi uji (ikut
 * ter-rollback), samakan penomoran seri yang dipakai berkas ini ke
 * max(nomor ter-commit)+1 agar test deterministik di keadaan awal apa pun
 * (pola yang sama dengan rem-name-snapshot.test.ts).
 */
async function alignSequences(tx: Tx) {
  const year = new Date().getUTCFullYear();
  const series: [string, string, string][] = [
    ["PURCHASE_ORDER", "purchase_orders", "PO"],
    ["RECEIPT", "stock_receipts", "RCV"],
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

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function twoSuppliers(tx: Tx) {
  const rows = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(2);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  return rows;
}

let skuCounter = 0;

async function makeProduct(
  tx: Tx,
  input: {
    supplierId?: string | null;
    minStock?: string;
    costPrice?: string;
  } = {},
) {
  skuCounter += 1;
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TEST-PO-${String(skuCounter).padStart(3, "0")}`,
      name: `Produk Uji PO ${skuCounter}`,
      supplierId: input.supplierId ?? null,
      costPrice: input.costPrice ?? "2500",
      salePrice: "3000",
      minStock: input.minStock ?? "0",
      trackStock: true,
      isActive: true,
    })
    .returning();
  return product;
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

async function getOrderLines(tx: Tx, orderId: string) {
  return tx
    .select()
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.companyId, ORG_ID),
        eq(purchaseOrderLines.orderId, orderId),
      ),
    );
}

describe("purchase order (G7/D-6)", () => {
  it("(a) PO dibuat sebagai draft lalu bisa dikirim", async () => {
    await rollbackTransaction(async (tx) => {
      const [supplier] = await twoSuppliers(tx);
      const product = await makeProduct(tx, { supplierId: supplier.id });

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "10", unitCost: "2500" }],
      });

      expect(order.number).toMatch(/^PO-\d{4}-/);
      const created = await getOrder(tx, order.id);
      expect(created.status).toBe("draft");
      expect(d(created.total ?? "0").toNumber()).toBe(25000);

      const lines = await getOrderLines(tx, order.id);
      expect(lines).toHaveLength(1);
      expect(d(lines[0].receivedQty).toNumber()).toBe(0);

      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });
      const sent = await getOrder(tx, order.id);
      expect(sent.status).toBe("sent");
    });
  });

  it("(b/c) penerimaan sebagian lalu penuh memperbarui received_qty dan status PO", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const [supplier] = await twoSuppliers(tx);
      const product = await makeProduct(tx, { supplierId: supplier.id });

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "10", unitCost: "2500" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });

      // (b) Terima sebagian: 4 dari 10.
      const receipt1 = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        purchaseOrderId: order.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "4", unitCost: "2500" }],
      });

      const [receiptRow] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt1.id))
        .limit(1);
      expect(receiptRow.purchaseOrderId).toBe(order.id);

      let lines = await getOrderLines(tx, order.id);
      expect(d(lines[0].receivedQty).toNumber()).toBe(4);
      expect((await getOrder(tx, order.id)).status).toBe("partial");

      // Jurnal penerimaan seperti biasa (Dr Persediaan / Cr Utang).
      const [journal] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "purchase"),
            eq(journalEntries.sourceId, receipt1.id),
          ),
        )
        .limit(1);
      expect(journal).toBeDefined();

      // (c) Terima sisanya: 6 — PO menjadi received.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        purchaseOrderId: order.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "6", unitCost: "2500" }],
      });

      lines = await getOrderLines(tx, order.id);
      expect(d(lines[0].receivedQty).toNumber()).toBe(10);
      expect((await getOrder(tx, order.id)).status).toBe("received");
    });
  });

  it("(d) penerimaan melebihi sisa PO ditolak tanpa mengubah stok maupun PO", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const [supplier] = await twoSuppliers(tx);
      const product = await makeProduct(tx, { supplierId: supplier.id });

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "5", unitCost: "2500" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });

      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          purchaseOrderId: order.id,
          date: todayISO(),
          lines: [{ productId: product.id, qty: "6", unitCost: "2500" }],
        }),
      ).rejects.toThrow(/melebihi|PO/);

      // Tidak ada penerimaan tercatat dan received_qty tetap 0.
      const receipts = await tx
        .select()
        .from(stockReceipts)
        .where(
          and(
            eq(stockReceipts.companyId, ORG_ID),
            eq(stockReceipts.purchaseOrderId, order.id),
          ),
        );
      expect(receipts).toHaveLength(0);
      const lines = await getOrderLines(tx, order.id);
      expect(d(lines[0].receivedQty).toNumber()).toBe(0);
      expect((await getOrder(tx, order.id)).status).toBe("sent");
    });
  });

  it("(d2) penerimaan tertaut PO menolak pemasok berbeda dan produk di luar PO", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const [supplierA, supplierB] = await twoSuppliers(tx);
      const product = await makeProduct(tx, { supplierId: supplierA.id });
      const otherProduct = await makeProduct(tx, { supplierId: supplierA.id });

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplierA.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "5", unitCost: "2500" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });

      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplierB.id,
          source: "purchase",
          purchaseOrderId: order.id,
          date: todayISO(),
          lines: [{ productId: product.id, qty: "1", unitCost: "2500" }],
        }),
      ).rejects.toThrow(/pemasok/);

      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplierA.id,
          source: "purchase",
          purchaseOrderId: order.id,
          date: todayISO(),
          lines: [{ productId: otherProduct.id, qty: "1", unitCost: "2500" }],
        }),
      ).rejects.toThrow(/tidak ada di pesanan|PO/);
    });
  });

  it("(e) batal PO tanpa penerimaan berhasil; dengan penerimaan ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const [supplier] = await twoSuppliers(tx);
      const product = await makeProduct(tx, { supplierId: supplier.id });

      const empty = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "5", unitCost: "2500" }],
      });
      await cancelPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: empty.id });
      expect((await getOrder(tx, empty.id)).status).toBe("cancelled");

      const used = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "5", unitCost: "2500" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: used.id });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        purchaseOrderId: used.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "1", unitCost: "2500" }],
      });

      await expect(
        cancelPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: used.id }),
      ).rejects.toThrow(/sudah memiliki penerimaan|tidak dapat dibatalkan/);
      expect((await getOrder(tx, used.id)).status).toBe("partial");
    });
  });

  it("(f) rekomendasi: qty saran = 2× minimum − stok; buat PO mengelompokkan per pemasok", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const [supplierA, supplierB] = await twoSuppliers(tx);

      const lowA = await makeProduct(tx, { supplierId: supplierA.id, minStock: "10" });
      await applyStockMovement(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: lowA.id,
        delta: "3",
        unitCost: "2500",
        movementType: "opening",
        userId: USER_ID,
      });

      const lowB = await makeProduct(tx, { supplierId: supplierB.id, minStock: "5" });
      await applyStockMovement(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: lowB.id,
        delta: "5",
        unitCost: "2500",
        movementType: "opening",
        userId: USER_ID,
      });

      const noSupplier = await makeProduct(tx, { supplierId: null, minStock: "8" });

      const healthy = await makeProduct(tx, { supplierId: supplierA.id, minStock: "10" });
      await applyStockMovement(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: healthy.id,
        delta: "50",
        unitCost: "2500",
        movementType: "opening",
        userId: USER_ID,
      });

      const recommendations = await listPurchaseRecommendations(tx, ORG_ID);
      const byId = new Map(recommendations.map((row) => [row.productId, row]));

      // Produk menipis muncul dengan saran yang benar; yang sehat tidak.
      expect(byId.get(lowA.id)).toBeDefined();
      expect(d(byId.get(lowA.id)!.suggestedQty).toNumber()).toBe(17); // 2×10 − 3
      expect(d(byId.get(lowA.id)!.totalStock).toNumber()).toBe(3);
      expect(byId.get(lowA.id)!.supplierId).toBe(supplierA.id);
      expect(byId.get(lowB.id)).toBeDefined();
      expect(d(byId.get(lowB.id)!.suggestedQty).toNumber()).toBe(5); // 2×5 − 5
      expect(byId.get(noSupplier.id)).toBeDefined();
      expect(d(byId.get(noSupplier.id)!.suggestedQty).toNumber()).toBe(16); // 2×8 − 0
      expect(byId.get(healthy.id)).toBeUndefined();

      const result = await createPurchaseOrdersFromRecommendations(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: todayISO(),
        productIds: [lowA.id, lowB.id, noSupplier.id],
      });

      // Dua pemasok → dua PO draft; produk tanpa pemasok utama terpisah.
      expect(result.orders).toHaveLength(2);
      expect(result.skipped.map((row) => row.productId)).toEqual([noSupplier.id]);

      const supplierIds = new Set<string>();
      for (const created of result.orders) {
        const order = await getOrder(tx, created.id);
        expect(order.status).toBe("draft");
        supplierIds.add(order.supplierId);
        const lines = await getOrderLines(tx, created.id);
        expect(lines).toHaveLength(1);
        if (order.supplierId === supplierA.id) {
          expect(lines[0].productId).toBe(lowA.id);
          expect(d(lines[0].qty).toNumber()).toBe(17);
        } else {
          expect(lines[0].productId).toBe(lowB.id);
          expect(d(lines[0].qty).toNumber()).toBe(5);
        }
      }
      expect(supplierIds).toEqual(new Set([supplierA.id, supplierB.id]));
    });
  });
});
