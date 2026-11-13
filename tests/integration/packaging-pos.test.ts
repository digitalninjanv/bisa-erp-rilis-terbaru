import { outbox } from "@/db/schema";
import { describe, expect, it } from "vitest";
import { and, sql, eq } from "drizzle-orm";
import {
  accountMappings,
  cashSessions,
  journalEntries,
  journalLines,
  paymentMethods,
  productPackagings,
  products,
  saleLines,
  saleReturnLines,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  createSale,
  createSaleReturn,
  getReturnedQtyBySaleLine,
  quoteCart,
} from "@/server/pos";
import { processOfflineSaleItem, postOfflineReviewItem } from "@/server/pos-offline";
import {
  findProductByAnyBarcode,
  listProductPackagings,
  syncProductPackagings,
} from "@/server/catalog/packaging";
import { searchProducts } from "@/server/catalog/products";
import { applyStockMovement } from "@/server/inventory";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * Program Satuan Kemasan S4 — penjualan & POS + retur penjualan:
 * jual per kemasan memakai harga jual kemasan INDEPENDEN dan stok
 * terpotong dalam satuan dasar; barcode kemasan menyelesaikan ke
 * baris kemasan (bukan 1 Pcs); retur memakai CUPLIKAN baris asal
 * walau master sudah berubah; penjualan offline berkemasan
 * tersinkron dengan cuplikan muatannya; produk tanpa kemasan
 * berperilaku persis seperti sebelum program. Semua dalam transaksi
 * rollback di perusahaan demo (Indomie Goreng seed: Dus isi 40,
 * harga jual dus Rp145.000 — sengaja ≠ 40 × Rp3.800).
 */
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

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

async function cashMethod(tx: Tx) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
    .limit(1);
  expect(method).toBeDefined();
  return method;
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

async function indomie(tx: Tx) {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.companyId, ORG_ID), eq(products.name, "Indomie Goreng")))
    .limit(1);
  expect(product).toBeDefined();
  const packs = await listProductPackagings(tx, ORG_ID, product.id);
  const dus = packs.find((pack) => pack.name === "Dus");
  expect(dus).toBeDefined();
  return { product, dus: dus! };
}

async function makeProduct(tx: Tx) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-S4-${suffix}`,
      name: `Produk Uji S4 ${suffix}`,
      costPrice: "3100",
      salePrice: "3800",
      trackStock: true,
    })
    .returning({ id: products.id });
  return product;
}

async function addStock(tx: Tx, warehouseId: string, productId: string, qty: number) {
  await applyStockMovement(tx, {
    companyId: ORG_ID,
    warehouseId,
    productId,
    delta: qty,
    unitCost: "3100",
    movementType: "purchase",
    referenceType: "opening",
    userId: USER_ID,
  });
}

async function sellLines(
  tx: Tx,
  warehouseId: string,
  methodId: string,
  lines: Parameters<typeof quoteCart>[1]["lines"],
) {
  const quote = await quoteCart(tx, {
    companyId: ORG_ID,
    warehouseId,
    customerId: null,
    lines,
  });
  const sale = await createSale(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    customerId: null,
    dueDate: todayISO(),
    date: todayISO(),
    lines,
    payments: [{ methodId, amount: quote.total, tendered: quote.total }],
    idempotencyKey: crypto.randomUUID(),
  });
  return { quote, sale };
}

async function journalSum(
  tx: Tx,
  saleId: string,
  mappingKey: string,
  side: "debit" | "credit",
) {
  const [mapping] = await tx
    .select()
    .from(accountMappings)
    .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, mappingKey)))
    .limit(1);
  expect(mapping).toBeDefined();
  const lines = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, "sale"),
        eq(journalEntries.sourceId, saleId),
        eq(journalLines.accountId, mapping.accountId),
      ),
    );
  return lines.reduce((acc, line) => acc.plus(side === "debit" ? line.debit : line.credit), d(0));
}

describe("S4 — penjualan POS berkemasan", () => {
  it("(a) jual 1 Dus Indomie: pendapatan harga dus independen, stok −40, HPP per pcs AVCO", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const method = await cashMethod(tx);
      const { product, dus } = await indomie(tx);
      expect(d(dus.isi).toNumber()).toBe(40);
      expect(d(dus.salePrice!).toNumber()).toBe(145000);
      expect(dus.barcode).toBe("8992000000001");

      const before = await stockQty(tx, warehouse.id, product.id);
      const { quote, sale } = await sellLines(tx, warehouse.id, method.id, [
        { productId: product.id, packagingId: dus.id, qty: 1 },
      ]);

      // Quote: qty satuan dasar 40, harga per pcs turunan 145.000/40.
      expect(quote.lines).toHaveLength(1);
      expect(quote.lines[0].qty).toBe(40);
      expect(quote.lines[0].qtyInput).toBe(1);
      expect(quote.lines[0].isiSnapshot).toBe("40");
      expect(quote.lines[0].unitPrice).toBe(3625);
      expect(quote.total).toBeCloseTo(145000, 2);

      // Baris tersimpan: kolom lama tetap satuan dasar + cuplikan.
      const [line] = await tx
        .select()
        .from(saleLines)
        .where(eq(saleLines.saleId, sale.id));
      expect(line.packagingId).toBe(dus.id);
      expect(d(line.qty).toNumber()).toBe(40);
      expect(d(line.qtyInput).toNumber()).toBe(1);
      expect(d(line.isiSnapshot).toNumber()).toBe(40);
      expect(d(line.unitPrice).toNumber()).toBe(3625);

      // Stok terpotong isi × qty dalam pcs.
      const after = await stockQty(tx, warehouse.id, product.id);
      expect(before.minus(after).toNumber()).toBe(40);

      // Jurnal: pendapatan bruto = harga dus; HPP = 40 × AVCO 3.100.
      const revenue = await journalSum(tx, sale.id, "revenue", "credit");
      expect(revenue.toNumber()).toBe(145000);
      const cogs = await journalSum(tx, sale.id, "cogs", "debit");
      expect(cogs.toNumber()).toBe(124000);
    });
  });

  it("(b) barcode kemasan menyelesaikan ke baris Dus, bukan 1 Pcs", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const { product, dus } = await indomie(tx);

      const found = await findProductByAnyBarcode(tx, ORG_ID, "8992000000001");
      expect(found?.productId).toBe(product.id);
      expect(found?.packaging?.id).toBe(dus.id);
      expect(found?.packaging?.name).toBe("Dus");

      const own = await findProductByAnyBarcode(tx, ORG_ID, product.barcode!);
      expect(own?.productId).toBe(product.id);
      expect(own?.packaging).toBeNull();

      const rows = await searchProducts(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        q: "8992000000001",
      });
      const row = rows.find((entry) => entry.id === product.id);
      expect(row).toBeDefined();
      expect(row!.matchedPackagingId).toBe(dus.id);
      expect(row!.packagings.some((pack) => pack.id === dus.id)).toBe(true);
    });
  });

  it("(c) master berubah sesudah jual: retur tetap faktor & harga asal", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const method = await cashMethod(tx);
      const { product, dus } = await indomie(tx);

      const before = await stockQty(tx, warehouse.id, product.id);
      // Jual 2 Dus agar retur parsial 1 Dus menyisakan sisa baris —
      // penolakan "melebihi sisa" diuji pada baris yang sama.
      const { sale } = await sellLines(tx, warehouse.id, method.id, [
        { productId: product.id, packagingId: dus.id, qty: 2 },
      ]);
      const [originLine] = await tx
        .select()
        .from(saleLines)
        .where(eq(saleLines.saleId, sale.id));
      const originTotal = d(originLine.lineTotal).toNumber() / 2;

      // Master berubah total: isi 40 → 50, harga dus 145.000 → 160.000.
      await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [
          {
            id: dus.id,
            name: "Dus",
            isi: "50",
            buyPrice: dus.buyPrice,
            salePrice: "160000",
            barcode: dus.barcode,
            isDefaultPurchase: true,
            isDefaultSale: false,
            isActive: true,
          },
        ],
        { priceGateSatisfied: true },
      );

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji S4 retur cuplikan asal",
        refundMethod: "transfer",
        type: "return",
        lines: [{ saleLineId: originLine.id, productId: product.id, qty: 1 }],
      });
      // Nilai retur = nilai baris asal (harga dus asal), bukan master baru.
      expect(ret.total).toBeCloseTo(originTotal, 2);
      expect(ret.total).toBeCloseTo(145000, 2);

      const [returnLine] = await tx
        .select()
        .from(saleReturnLines)
        .where(eq(saleReturnLines.returnId, ret.id));
      expect(returnLine.saleLineId).toBe(originLine.id);
      expect(returnLine.packagingId).toBe(dus.id);
      expect(d(returnLine.qty).toNumber()).toBe(40);
      expect(d(returnLine.qtyInput).toNumber()).toBe(1);
      expect(d(returnLine.isiSnapshot).toNumber()).toBe(40);
      expect(d(returnLine.unitPrice).toNumber()).toBe(3625);

      // Stok kembali 40 pcs (faktor asal), bukan 50 (faktor master
      // baru): neto terhadap stok awal = −80 terjual + 40 kembali.
      const after = await stockQty(tx, warehouse.id, product.id);
      expect(before.minus(after).toNumber()).toBe(40);

      const returnedByLine = await getReturnedQtyBySaleLine(tx, ORG_ID, sale.id);
      expect(returnedByLine.get(originLine.id)).toBe(40);

      // Sisa baris asal tinggal 1 Dus: retur 2 Dus ditolak per baris.
      let error: unknown;
      try {
        await createSaleReturn(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          date: todayISO(),
          reason: "Uji S4 retur melebihi sisa baris",
          refundMethod: "transfer",
          type: "return",
          lines: [{ saleLineId: originLine.id, productId: product.id, qty: 2 }],
        });
      } catch (caught) {
        error = caught;
      }
      expect((error as { message?: string })?.message ?? "").toMatch(/melebihi sisa/);
    });
  });

  it("(d) faktor kemasan lama ditinjau supervisor sebelum snapshot historis diposting", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const method = await cashMethod(tx);
      const product = await makeProduct(tx);
      await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [
          {
            name: "Dus",
            isi: "40",
            buyPrice: "124000",
            salePrice: "145000",
            barcode: null,
            isDefaultPurchase: true,
            isDefaultSale: false,
            isActive: true,
          },
        ],
        { priceGateSatisfied: true },
      );
      const [pack] = await listProductPackagings(tx, ORG_ID, product.id);
      await addStock(tx, warehouse.id, product.id, 500);

      // Master berubah SEBELUM sinkronisasi tiba: isi kini 99.
      await tx
        .update(productPackagings)
        .set({ isi: "99" })
        .where(eq(productPackagings.id, pack.id));

      const [session] = await tx
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.companyId, ORG_ID),
            eq(cashSessions.userId, USER_ID),
            eq(cashSessions.status, "open"),
          ),
        )
        .limit(1);
      expect(session).toBeDefined();

      const result = await processOfflineSaleItem(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        item: {
          clientKey: crypto.randomUUID(),
          warehouseId: warehouse.id,
          cashierId: USER_ID,
          originSessionId: session.id,
          date: todayISO(),
          lines: [
            {
              productId: product.id,
              qty: 1,
              packagingId: pack.id,
              isiSnapshot: 40,
              unitPrice: 145000,
            },
          ],
          payments: [{ methodId: method.id, amount: 145000, tendered: 145000 }],
          expectedTotal: 145000,
          queuedAt: new Date().toISOString(),
        },
      });
      expect(result.status).toBe("failed");
      expect(result.message).toContain("Faktor kemasan");
      const [pending] = await tx.select().from(outbox).where(and(eq(outbox.companyId, ORG_ID), sql`${outbox.payload}->>'clientKey' = ${result.clientKey}`)).limit(1);
      const settled = await postOfflineReviewItem(tx, { companyId: ORG_ID, actorId: USER_ID, outboxId: pending.id, mode: "settle", originEntitlements: { [USER_ID]: { canSell: true, canDiscount: true } } });
      expect(settled.saleId).toBeDefined();

      const [line] = await tx
        .select()
        .from(saleLines)
        .where(eq(saleLines.saleId, settled.saleId!));
      expect(line.packagingId).toBe(pack.id);
      expect(d(line.isiSnapshot).toNumber()).toBe(40);
      expect(d(line.qty).toNumber()).toBe(40);

      const after = await stockQty(tx, warehouse.id, product.id);
      expect(after.toNumber()).toBe(460);
    });
  });

  it("(e) campuran 2 Dus + 3 Pcs satu produk dalam satu penjualan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const method = await cashMethod(tx);
      const { product, dus } = await indomie(tx);

      const before = await stockQty(tx, warehouse.id, product.id);
      const { quote, sale } = await sellLines(tx, warehouse.id, method.id, [
        { productId: product.id, packagingId: dus.id, qty: 2 },
        { productId: product.id, qty: 3 },
      ]);

      expect(quote.lines).toHaveLength(2);
      const dusLine = quote.lines.find((line) => line.packagingId === dus.id);
      const pcsLine = quote.lines.find((line) => line.packagingId === null);
      expect(dusLine?.qty).toBe(80);
      expect(dusLine?.lineTotal).toBe(290000);
      expect(pcsLine?.qty).toBe(3);
      expect(pcsLine?.lineTotal).toBe(11400);

      const rows = await tx
        .select()
        .from(saleLines)
        .where(eq(saleLines.saleId, sale.id));
      expect(rows).toHaveLength(2);

      const after = await stockQty(tx, warehouse.id, product.id);
      expect(before.minus(after).toNumber()).toBe(83);
    });
  });

  it("(f) produk tanpa kemasan: regresi nol (cuplikan bawaan 1, tanpa kemasan)", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const method = await cashMethod(tx);
      const product = await makeProduct(tx);
      await addStock(tx, warehouse.id, product.id, 100);

      const { sale } = await sellLines(tx, warehouse.id, method.id, [
        { productId: product.id, qty: 2 },
      ]);
      const [line] = await tx
        .select()
        .from(saleLines)
        .where(eq(saleLines.saleId, sale.id));
      expect(line.packagingId).toBeNull();
      expect(d(line.qty).toNumber()).toBe(2);
      expect(d(line.qtyInput).toNumber()).toBe(2);
      expect(d(line.isiSnapshot).toNumber()).toBe(1);
      expect(d(line.unitPrice).toNumber()).toBe(3800);

      const after = await stockQty(tx, warehouse.id, product.id);
      expect(after.toNumber()).toBe(98);
    });
  });

  it("(g) kemasan produk lain / nonaktif ditolak gerbang quote", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const { product, dus } = await indomie(tx);
      const other = await makeProduct(tx);

      let error: unknown;
      try {
        await quoteCart(tx, {
          companyId: ORG_ID,
          warehouseId: warehouse.id,
          customerId: null,
          lines: [{ productId: other.id, packagingId: dus.id, qty: 1 }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeDefined();

      // Kemasan dinonaktifkan → penjualan online dengan kemasan itu ditolak.
      await tx
        .update(productPackagings)
        .set({ isActive: false })
        .where(eq(productPackagings.id, dus.id));
      error = undefined;
      try {
        await quoteCart(tx, {
          companyId: ORG_ID,
          warehouseId: warehouse.id,
          customerId: null,
          lines: [{ productId: product.id, packagingId: dus.id, qty: 1 }],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeDefined();
    });
  });
});
