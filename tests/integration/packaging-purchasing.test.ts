import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockOnHand,
  stockReceiptLines,
  stockReceipts,
  supplierReturnLines,
  suppliers,
  warehouses,
} from "@/db/schema";
import { createReceipt } from "@/server/inventory";
import { createPurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import {
  findUsedPackagingIds,
  listProductPackagings,
  syncProductPackagings,
} from "@/server/catalog/packaging";
import {
  createSupplierReturn,
  postSupplierReturn,
} from "@/server/supplier-returns";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * Program Satuan Kemasan S2 — rantai pembelian berkemasan di level
 * domain: penerimaan dalam Dus menjadi stok & AVCO per pcs, PO ↔
 * penerimaan cocok lintas satuan dasar, retur pembelian memakai
 * CUPLIKAN baris asalnya (bukan isi master hari ini), dan penjaga
 * hapus kemasan terpakai kini nyata lewat findUsedPackagingIds.
 * Semua dalam transaksi rollback di perusahaan demo.
 */
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

const rollbackTransaction = makeRollbackTransaction(ORG_ID, { before: alignSequences });

/** Samakan penomoran seri dokumen ke max(ter-commit)+1 di dalam
 * transaksi uji (pola purchase-order.test.ts) agar penerbitan nomor
 * tidak menabrak dokumen demo yang sudah ter-commit. */
async function alignSequences(tx: Tx) {
  const year = new Date().getUTCFullYear();
  const series: [string, string, string][] = [
    ["PURCHASE_ORDER", "purchase_orders", "PO"],
    ["RECEIPT", "stock_receipts", "RCV"],
    ["SUPPLIER_RETURN", "supplier_returns", "RTB"],
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

async function makeProduct(tx: Tx, costPrice = "3100") {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-S2-${suffix}`,
      name: `Indomie Uji S2 ${suffix}`,
      costPrice,
      salePrice: "3800",
      trackStock: true,
    })
    .returning({ id: products.id });
  return product;
}

/** Tanam satu kemasan Dus isi 40 (harga beli per dus dapat diatur). */
async function addDus(
  tx: Tx,
  productId: string,
  overrides: { isi?: string; buyPrice?: string | null } = {},
) {
  await syncProductPackagings(
    tx,
    ORG_ID,
    productId,
    [
      {
        name: "Dus",
        isi: overrides.isi ?? "40",
        buyPrice: overrides.buyPrice === undefined ? "145000" : overrides.buyPrice,
        salePrice: null,
        barcode: null,
        isDefaultPurchase: true,
        isDefaultSale: false,
        isActive: true,
      },
    ],
    { priceGateSatisfied: true },
  );
  const [dus] = await listProductPackagings(tx, ORG_ID, productId);
  expect(dus).toBeDefined();
  return dus;
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

async function avco(tx: Tx, productId: string) {
  const [row] = await tx
    .select({ costPrice: products.costPrice })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return row.costPrice;
}

async function receiptLines(tx: Tx, receiptId: string) {
  return tx
    .select()
    .from(stockReceiptLines)
    .where(and(eq(stockReceiptLines.companyId, ORG_ID), eq(stockReceiptLines.receiptId, receiptId)));
}

describe("penerimaan berkemasan (S2)", () => {
  it("2 Dus isi 40 @Rp145.000 → stok +80 pcs, HPP per pcs tepat 3.625, cuplikan baris beku", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: "2", unitCost: "145000", packagingId: dus.id }],
      });

      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(80));
      expect(await avco(tx, product.id)).toBe("3625.0000");

      const [line] = await receiptLines(tx, receipt.id);
      expect(line.qty).toBe("80.0000");
      expect(line.unitCost).toBe("3625.0000");
      expect(line.lineTotal).toBe("290000.0000");
      expect(line.qtyInput).toBe("2.0000");
      expect(line.isiSnapshot).toBe("40.0000");
      expect(line.packagingId).toBe(dus.id);

      const [header] = await tx
        .select({ total: stockReceipts.total })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(header.total).toBe("290000.0000");
    });
  });

  it("pencampuran AVCO dengan stok awal terhitung persis: 40 pcs @3.100 + 2 Dus @145.000 → 3.450", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      // Stok awal dalam satuan dasar, seperti alur lama.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: "40", unitCost: "3100" }],
      });
      expect(await avco(tx, product.id)).toBe("3100.0000");

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: "2", unitCost: "145000", packagingId: dus.id }],
      });

      // (40 × 3.100 + 80 × 3.625) / 120 = 414.000 / 120 = 3.450 tepat.
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(120));
      expect(await avco(tx, product.id)).toBe("3450.0000");
    });
  });

  it("produk tanpa kemasan: baris lama persis — qtyInput = qty, isiSnapshot 1, packagingId null", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: "25", unitCost: "3100" }],
      });
      const [line] = await receiptLines(tx, receipt.id);
      expect(line.qty).toBe("25.0000");
      expect(line.qtyInput).toBe("25.0000");
      expect(line.isiSnapshot).toBe("1.0000");
      expect(line.packagingId).toBeNull();
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(25));
    });
  });

  it("kemasan produk lain / kemasan nonaktif ditolak sebelum stok bergerak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const other = await makeProduct(tx);
      const otherDus = await addDus(tx, other.id);
      const dus = await addDus(tx, product.id);
      // Nonaktifkan kemasan produk ini.
      await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [
          {
            id: dus.id,
            name: "Dus",
            isi: "40",
            buyPrice: "145000",
            salePrice: null,
            barcode: null,
            isDefaultPurchase: true,
            isDefaultSale: false,
            isActive: false,
          },
        ],
        { priceGateSatisfied: true },
      );

      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          date: todayISO(),
          lines: [{ productId: product.id, qty: "1", unitCost: "145000", packagingId: otherDus.id }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          date: todayISO(),
          lines: [{ productId: product.id, qty: "1", unitCost: "145000", packagingId: dus.id }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(0));
    });
  });
});

describe("PO berkemasan ↔ penerimaan (tiga arah lintas satuan dasar)", () => {
  it("PO 10 Dus tersimpan sebagai 400 pcs @3.625; penerimaan campuran dus + pcs menutup PO", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "10", unitCost: "145000", packagingId: dus.id }],
      });
      const [poLine] = await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderId, order.id));
      expect(poLine.qty).toBe("400.0000");
      expect(poLine.unitCost).toBe("3625.0000");
      expect(poLine.qtyInput).toBe("10.0000");
      expect(poLine.isiSnapshot).toBe("40.0000");
      expect(poLine.lineTotal).toBe("1450000.0000");
      const [poHeader] = await tx
        .select({ total: purchaseOrders.total })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, order.id));
      expect(poHeader.total).toBe("1450000.0000");

      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });

      // Terima sebagian dalam kemasan: 5 Dus = 200 pcs.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        purchaseOrderId: order.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "5", unitCost: "145000", packagingId: dus.id }],
      });
      const [afterFirst] = await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderId, order.id));
      expect(afterFirst.receivedQty).toBe("200.0000");
      const [poAfterFirst] = await tx
        .select({ status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, order.id));
      expect(poAfterFirst.status).toBe("partial");

      // Sisanya diterima dalam satuan dasar — tetap cocok.
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        purchaseOrderId: order.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "200", unitCost: "3625" }],
      });
      const [poFinal] = await tx
        .select({ status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, order.id));
      expect(poFinal.status).toBe("received");
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(400));
    });
  });

  it("penerimaan berkemasan melebihi sisa PO ditolak dalam satuan dasar", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "1", unitCost: "145000", packagingId: dus.id }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });

      // PO hanya 1 Dus = 40 pcs; terima 2 Dus = 80 pcs → ditolak.
      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          purchaseOrderId: order.id,
          date: todayISO(),
          lines: [{ productId: product.id, qty: "2", unitCost: "145000", packagingId: dus.id }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(0));
    });
  });
});

describe("retur pembelian memakai cuplikan asal (S2)", () => {
  it("isi master berubah 40 → 48: dokumen lama beku, retur dari baris asal tetap faktor 40", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: "2", unitCost: "145000", packagingId: dus.id }],
      });
      const [originLine] = await receiptLines(tx, receipt.id);

      // Pemasok mengganti isi dus secara permanen: master diedit.
      await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [
          {
            id: dus.id,
            name: "Dus",
            isi: "48",
            buyPrice: "145000",
            salePrice: null,
            barcode: null,
            isDefaultPurchase: true,
            isDefaultSale: false,
            isActive: true,
          },
        ],
        { priceGateSatisfied: true },
      );

      // Dokumen lama tidak berubah.
      const [frozenLine] = await receiptLines(tx, receipt.id);
      expect(frozenLine.isiSnapshot).toBe("40.0000");
      expect(frozenLine.qty).toBe("80.0000");

      // Retur 1 Dus dari baris asal itu: keluar 40 pcs (faktor asal),
      // BUKAN 48 pcs (isi master hari ini).
      const created = await createSupplierReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        date: todayISO(),
        reasonCategory: "damaged",
        reasonDetail: "Satu dus rusak saat dibongkar dari truk pemasok.",
        resolutionType: "refund",
        lines: [
          {
            productId: product.id,
            qty: "1",
            packagingId: dus.id,
            receiptLineId: originLine.id,
          },
        ],
      });
      const [returnLine] = await tx
        .select()
        .from(supplierReturnLines)
        .where(eq(supplierReturnLines.returnId, created.id));
      expect(returnLine.qty).toBe("40.0000");
      expect(returnLine.qtyInput).toBe("1.0000");
      expect(returnLine.isiSnapshot).toBe("40.0000");
      expect(returnLine.packagingId).toBe(dus.id);
      expect(returnLine.receiptLineId).toBe(originLine.id);

      await postSupplierReturn(tx, { companyId: ORG_ID, userId: USER_ID, returnId: created.id });
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(40));
    });
  });

  it("retur berkemasan eksplisit tanpa baris asal memakai isi master; qty dasar yang keluar", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: "100", unitCost: "3100" }],
      });

      const created = await createSupplierReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        date: todayISO(),
        reasonCategory: "over_delivery",
        reasonDetail: "Kelebihan kirim satu dus, dikembalikan utuh ke pemasok.",
        resolutionType: "next_purchase_credit",
        lines: [{ productId: product.id, qty: "1", packagingId: dus.id }],
      });
      const [returnLine] = await tx
        .select()
        .from(supplierReturnLines)
        .where(eq(supplierReturnLines.returnId, created.id));
      expect(returnLine.qty).toBe("40.0000");
      expect(returnLine.isiSnapshot).toBe("40.0000");

      await postSupplierReturn(tx, { companyId: ORG_ID, userId: USER_ID, returnId: created.id });
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(60));
    });
  });
});

describe("penjaga hapus kemasan terpakai kini nyata (S2)", () => {
  it("kemasan yang terpakai penerimaan tidak dapat dihapus — hanya dinonaktifkan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      // Belum terpakai: registrasi kosong.
      expect(await findUsedPackagingIds(tx, ORG_ID, [dus.id])).toEqual(new Set());

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: "1", unitCost: "145000", packagingId: dus.id }],
      });

      expect(await findUsedPackagingIds(tx, ORG_ID, [dus.id])).toEqual(new Set([dus.id]));
      await expect(
        syncProductPackagings(tx, ORG_ID, product.id, [], { priceGateSatisfied: true }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // Jalur sahnya: nonaktifkan.
      const off = await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [
          {
            id: dus.id,
            name: "Dus",
            isi: "40",
            buyPrice: "145000",
            salePrice: null,
            barcode: null,
            isDefaultPurchase: true,
            isDefaultSale: false,
            isActive: false,
          },
        ],
        { priceGateSatisfied: true },
      );
      expect(off.updated).toBe(1);
    });
  });

  it("kemasan yang hanya terpakai PO pun terdaftar terpakai", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const dus = await addDus(tx, product.id);

      await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "3", unitCost: "145000", packagingId: dus.id }],
      });
      expect(await findUsedPackagingIds(tx, ORG_ID, [dus.id])).toEqual(new Set([dus.id]));
    });
  });
});
