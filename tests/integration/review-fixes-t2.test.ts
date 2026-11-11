import { describe, expect, it } from "vitest";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  journalEntries,
  journalLines,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockBatches,
  stockOnHand,
  stockReceiptLines,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { createReceipt } from "@/server/inventory";
import { getBatchAvailability } from "@/server/batches";
import {
  createPurchaseOrder,
  createPurchaseOrdersFromRecommendations,
  releaseReceiptFromPurchaseOrder,
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

async function anySupplier(tx: Tx) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(1);
  expect(supplier).toBeDefined();
  return supplier;
}

async function newProduct(
  tx: Tx,
  input: {
    name: string;
    costPrice?: string;
    salePrice?: string;
    trackBatch?: boolean;
    supplierId?: string | null;
    minStock?: string;
  },
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-RF-${suffix}`,
      name: input.name,
      costPrice: input.costPrice ?? "1000",
      salePrice: input.salePrice ?? "2000",
      trackBatch: input.trackBatch ?? false,
      trackStock: true,
      isActive: true,
      supplierId: input.supplierId ?? null,
      minStock: input.minStock ?? "0",
    })
    .returning({ id: products.id });
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

async function batchQty(
  tx: Tx,
  warehouseId: string,
  productId: string,
  batchNumber: string,
) {
  const rows = await tx
    .select()
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.companyId, ORG_ID),
        eq(stockBatches.warehouseId, warehouseId),
        eq(stockBatches.productId, productId),
      ),
    );
  const row = rows.find((candidate) => candidate.batchNumber === batchNumber);
  return row ? d(row.qty) : null;
}

async function expectRejected(fn: () => Promise<unknown>, code = "VALIDATION") {
  let error: unknown;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code });
  return error as Error;
}

/** The receipt's own posted journal (never a payment journal or a reversal). */
async function receiptJournal(tx: Tx, receiptId: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceId, receiptId),
        eq(journalEntries.status, "posted"),
        isNull(journalEntries.reversalOfId),
        ne(journalEntries.sourceType, "payment"),
      ),
    )
    .limit(1);
  if (!entry) return null;
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id));
  return { entry, lines };
}

function accountTotal(
  lines: { accountId: string; debit: string; credit: string }[],
  accountId: string,
  side: "debit" | "credit",
) {
  return lines
    .filter((line) => line.accountId === accountId)
    .reduce((acc, line) => acc.plus(d(line[side])), d(0));
}

describe("Perbaikan review independen Tahap 2 (R-1 s.d. R-11, kecuali R-5)", () => {
  it("(a) R-1: paymentAccountId harus akun pemetaan kas/bank/qris — akun persediaan & pendapatan ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, { name: "Akun Bayar Uji" });
      const map = await getAccountMap(tx, ORG_ID);
      const lines = [{ productId: product.id, qty: 2, unitCost: 1000 }];
      const base = {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase" as const,
        date: todayISO(),
        lines,
      };

      for (const badAccountId of [map.inventory, map.revenue]) {
        const error = await expectRejected(() =>
          createReceipt(tx, { ...base, paymentAccountId: badAccountId }),
        );
        expect(error.message).toMatch(/akun pembayaran/i);
      }
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("0.0000");

      // The mapped cash account is accepted (existing behaviour, control).
      const receipt = await createReceipt(tx, { ...base, paymentAccountId: map.cash });
      expect(receipt.id).toBeDefined();
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("2.0000");
    });
  });

  it("(b) R-4: satu penerimaan boleh memuat produk sama dalam beberapa baris batch; non-batch tetap satu baris", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const batchProduct = await newProduct(tx, {
        name: "Dua Batch Uji",
        trackBatch: true,
      });
      const plainProduct = await newProduct(tx, { name: "Non Batch Uji" });

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        source: "opening",
        date: todayISO(),
        lines: [
          { productId: batchProduct.id, qty: 5, unitCost: 1000, batchNumber: "LOT-A", expiryDate: "2027-01-01" },
          { productId: batchProduct.id, qty: 7, unitCost: 1000, batchNumber: "LOT-B", expiryDate: "2027-06-01" },
        ],
      });
      expect(receipt.id).toBeDefined();
      expect((await stockQty(tx, warehouse.id, batchProduct.id)).toFixed(4)).toBe("12.0000");
      expect((await batchQty(tx, warehouse.id, batchProduct.id, "LOT-A"))!.toFixed(4)).toBe("5.0000");
      expect((await batchQty(tx, warehouse.id, batchProduct.id, "LOT-B"))!.toFixed(4)).toBe("7.0000");

      const storedLines = await tx
        .select()
        .from(stockReceiptLines)
        .where(eq(stockReceiptLines.receiptId, receipt.id));
      expect(storedLines).toHaveLength(2);

      // Same batch identity twice in one receipt is still a duplicate.
      await expectRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "opening",
          date: todayISO(),
          lines: [
            { productId: batchProduct.id, qty: 1, unitCost: 1000, batchNumber: "LOT-A", expiryDate: "2027-01-01" },
            { productId: batchProduct.id, qty: 2, unitCost: 1000, batchNumber: "LOT-A", expiryDate: "2027-01-01" },
          ],
        }),
      );

      // Non-batch products stay one line per product.
      await expectRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "opening",
          date: todayISO(),
          lines: [
            { productId: plainProduct.id, qty: 1, unitCost: 1000 },
            { productId: plainProduct.id, qty: 2, unitCost: 1000 },
          ],
        }),
      );
      expect((await stockQty(tx, warehouse.id, plainProduct.id)).toFixed(4)).toBe("0.0000");
    });
  });

  it("(c) R-4 jembatan PO: dua baris batch produk sama diagregasi terhadap sisa PO", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "PO Batch Uji",
        trackBatch: true,
        supplierId: supplier.id,
      });

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 1000 }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });

      const base = {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase" as const,
        purchaseOrderId: order.id,
        date: todayISO(),
      };

      // 6 + 5 = 11 exceeds the remaining 10 even though each line fits.
      await expectRejected(() =>
        createReceipt(tx, {
          ...base,
          lines: [
            { productId: product.id, qty: 6, unitCost: 1000, batchNumber: "LOT-A", expiryDate: "2027-01-01" },
            { productId: product.id, qty: 5, unitCost: 1000, batchNumber: "LOT-B", expiryDate: "2027-06-01" },
          ],
        }),
      );
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("0.0000");

      // 6 + 4 = 10 fits exactly; receivedQty must aggregate both lines.
      await createReceipt(tx, {
        ...base,
        lines: [
          { productId: product.id, qty: 6, unitCost: 1000, batchNumber: "LOT-A", expiryDate: "2027-01-01" },
          { productId: product.id, qty: 4, unitCost: 1000, batchNumber: "LOT-B", expiryDate: "2027-06-01" },
        ],
      });
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("10.0000");

      const [orderLine] = await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderId, order.id));
      expect(orderLine.receivedQty).toBe("10.0000");
      const [storedOrder] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, order.id));
      expect(storedOrder.status).toBe("received");
    });
  });

  it("(d) R-6: retur pelanggan memakai HPP berjalan, mengabaikan biaya ketikan pengguna", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await newProduct(tx, {
        name: "Retur Biaya Uji",
        costPrice: "3000",
        salePrice: "4500",
      });
      const map = await getAccountMap(tx, ORG_ID);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        source: "customer_return",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 4, unitCost: 9999 }],
      });

      const [storedReceipt] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(storedReceipt.total).toBe("12000.0000");
      const [storedLine] = await tx
        .select()
        .from(stockReceiptLines)
        .where(eq(stockReceiptLines.receiptId, receipt.id));
      expect(storedLine.unitCost).toBe("3000.0000");

      const journal = await receiptJournal(tx, receipt.id);
      expect(journal).not.toBeNull();
      expect(accountTotal(journal!.lines, map.inventory, "debit").toFixed(2)).toBe("12000.00");
      expect(accountTotal(journal!.lines, map.cogs, "credit").toFixed(2)).toBe("12000.00");
      // The journal memo states the cost basis honestly.
      expect(journal!.entry.description).toMatch(/HPP berjalan/i);
    });
  });

  it("(e) R-10: release melebihi receivedQty melempar VALIDATION menyebut nomor PO, bukan clamp diam-diam", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Release Uji",
        supplierId: supplier.id,
      });

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 1000 }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        purchaseOrderId: order.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 4, unitCost: 1000 }],
      });

      const error = await expectRejected(() =>
        releaseReceiptFromPurchaseOrder(tx, {
          companyId: ORG_ID,
          orderId: order.id,
          lines: [{ productId: product.id, qty: 6 }],
        }),
      );
      expect(error.message).toContain(order.number);

      const [orderLine] = await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderId, order.id));
      expect(orderLine.receivedQty).toBe("4.0000");
    });
  });

  it("(f) R-11: produk terpilih yang stoknya pulih masuk kategori noLongerLow, bukan error", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const recovered = await newProduct(tx, {
        name: "Pulih Uji",
        supplierId: supplier.id,
        minStock: "10",
      });
      const stillLow = await newProduct(tx, {
        name: "Masih Menipis Uji",
        supplierId: supplier.id,
        minStock: "10",
      });

      // Stock recovers after the recommendation list was seen.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        source: "opening",
        date: todayISO(),
        lines: [{ productId: recovered.id, qty: 25, unitCost: 1000 }],
      });

      const onlyRecovered = await createPurchaseOrdersFromRecommendations(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: todayISO(),
        productIds: [recovered.id],
      });
      expect(onlyRecovered.orders).toHaveLength(0);
      expect(onlyRecovered.skipped).toHaveLength(0);
      expect(onlyRecovered.noLongerLow.map((row) => row.productId)).toEqual([recovered.id]);

      const mixed = await createPurchaseOrdersFromRecommendations(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: todayISO(),
        productIds: [recovered.id, stillLow.id],
      });
      expect(mixed.orders).toHaveLength(1);
      expect(mixed.noLongerLow.map((row) => row.productId)).toEqual([recovered.id]);
    });
  });

  it("(g) R-9: domain createReceipt menolak qty 0 dan harga negatif dengan pesan menyebut produk", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await newProduct(tx, { name: "Validasi Domain Uji" });

      const zeroQty = await expectRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "opening",
          date: todayISO(),
          lines: [{ productId: product.id, qty: 0, unitCost: 1000 }],
        }),
      );
      expect(zeroQty.message).toContain("Validasi Domain Uji");

      const negativeCost = await expectRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "opening",
          date: todayISO(),
          lines: [{ productId: product.id, qty: 3, unitCost: -100 }],
        }),
      );
      expect(negativeCost.message).toContain("Validasi Domain Uji");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("0.0000");
    });
  });

  it("(h) R-7: getBatchAvailability men-netokan baris batch negatif — kuota tidak melebihi stok fisik", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await newProduct(tx, {
        name: "Ketersediaan Neto Uji",
        trackBatch: true,
      });

      // Physical stock is 10: a +15 fresh batch and a -5 batch row (the
      // shape negative-stock sales leave behind). Availability must net
      // to 10, not offer the gross 15.
      await tx.insert(stockOnHand).values({
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productId: product.id,
        qty: "10",
      });
      await tx.insert(stockBatches).values([
        {
          companyId: ORG_ID,
          productId: product.id,
          warehouseId: warehouse.id,
          batchNumber: "LOT-PLUS",
          expiryDate: "2027-01-01",
          qty: "15",
        },
        {
          companyId: ORG_ID,
          productId: product.id,
          warehouseId: warehouse.id,
          batchNumber: "LOT-MINUS",
          expiryDate: "2027-06-01",
          qty: "-5",
        },
      ]);

      const availability = await getBatchAvailability(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        productIds: [product.id],
        asOfDate: todayISO(),
      });
      const mine = availability.get(product.id);
      expect(mine).toBeDefined();
      expect(mine!.fresh.toFixed(2)).toBe("10.00");
      expect(mine!.expired.toFixed(2)).toBe("0.00");
      expect(mine!.total.toFixed(2)).toBe("10.00");
    });
  });
});
