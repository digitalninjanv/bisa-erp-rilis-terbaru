import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  importJobs,
  importRows,
  products,
  stockOnHand,
  stockReceiptLines,
  stockReceipts,
  warehouses,
} from "@/db/schema";
import { ENTITY_FIELDS } from "@/lib/import-parse";
import { todayISO } from "@/lib/format";
import { analyzeMasterImport } from "@/server/import/analyze";
import { commitOpeningStockImport } from "@/server/import/opening";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const rollback = makeRollbackTransaction(ORG);

async function defaultWarehouse(tx: Tx) {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(row).toBeDefined();
  return row.id;
}

async function makeJob(
  tx: Tx,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [job] = await tx
    .insert(importJobs)
    .values({
      companyId: ORG,
      entity: "opening_stock",
      fileName: `uji-stok-awal-${suffix}.xlsx`,
      status: "preview",
      totalRows: rows.length,
      mapping,
      createdBy: USER,
    })
    .returning();
  await tx.insert(importRows).values(
    rows.map((data, index) => ({
      companyId: ORG,
      jobId: job.id,
      rowNumber: index + 1,
      status: "pending",
      data,
    })),
  );
  return job;
}

describe("impor stok awal — penjaga biaya", () => {
  it("menolak qty positif tanpa biaya satuan dan tidak menyentuh stok/harga pokok", async () => {
    await rollback(async (tx) => {
      const warehouseId = await defaultWarehouse(tx);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG,
          sku: `OPEN-NOCOST-${suffix}`,
          name: `Produk Tanpa Biaya ${suffix}`,
          costPrice: "1500",
          salePrice: "2000",
          trackStock: true,
        })
        .returning({ id: products.id, sku: products.sku });
      const mapping = { sku: "SKU", qty: "Qty" };
      const job = await makeJob(tx, [{ SKU: product.sku, Qty: "10" }], mapping);

      const analysis = await analyzeMasterImport(tx, {
        companyId: ORG,
        job,
        mapping,
        warehouseId,
        date: todayISO(),
      });
      expect(analysis.summary.invalidRows).toBe(1);
      expect(analysis.preview[0]?.issue).toMatch(/Biaya satuan/i);

      const commit = await commitOpeningStockImport(tx, {
        companyId: ORG,
        userId: USER,
        job,
        mapping,
        warehouseId,
        date: todayISO(),
      });
      expect(commit.imported).toBe(0);
      expect(commit.failed).toBe(1);

      const [freshProduct] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(and(eq(products.companyId, ORG), eq(products.id, product.id)));
      expect(freshProduct.costPrice).toBe("1500.0000");
      const [onHand] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG),
            eq(stockOnHand.warehouseId, warehouseId),
            eq(stockOnHand.productId, product.id),
          ),
        );
      expect(onHand).toBeUndefined();
    });
  });

  it("mengizinkan biaya 0 hanya bila dikonfirmasi eksplisit", async () => {
    await rollback(async (tx) => {
      const warehouseId = await defaultWarehouse(tx);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG,
          sku: `OPEN-ZEROCOST-${suffix}`,
          name: `Produk Stok Gratis ${suffix}`,
          costPrice: "0",
          salePrice: "2000",
          trackStock: true,
        })
        .returning({ id: products.id, sku: products.sku });
      const mapping = { sku: "SKU", qty: "Qty" };
      const job = await makeJob(tx, [{ SKU: product.sku, Qty: "10" }], mapping);

      const blocked = await analyzeMasterImport(tx, {
        companyId: ORG,
        job,
        mapping,
        warehouseId,
        date: todayISO(),
      });
      expect(blocked.summary.invalidRows).toBe(1);

      const analysis = await analyzeMasterImport(tx, {
        companyId: ORG,
        job,
        mapping,
        warehouseId,
        date: todayISO(),
        allowZeroCost: true,
      });
      expect(analysis.summary.valid).toBe(1);
      expect(analysis.summary.invalidRows).toBe(0);

      const commit = await commitOpeningStockImport(tx, {
        companyId: ORG,
        userId: USER,
        job,
        mapping,
        warehouseId,
        date: todayISO(),
        allowZeroCost: true,
      });
      expect(commit.imported).toBe(1);
      expect(commit.failed).toBe(0);
    });
  });
});

describe("impor stok awal — batas parameter", () => {
  it("mengimpor 4.000 baris saldo nol tanpa MAX_PARAMETERS_EXCEEDED", async () => {
    await rollback(async (tx) => {
      const warehouseId = await defaultWarehouse(tx);
      const suffix = crypto.randomUUID().slice(0, 8);
      const count = 4_000;
      const values = Array.from({ length: count }, (_, index) => ({
        companyId: ORG,
        sku: `OPEN-BULK-${suffix}-${index}`,
        name: `Produk Stok Nol ${suffix} ${index}`,
        costPrice: "1000",
        salePrice: "1500",
        trackStock: true,
      }));
      const inserted: { id: string; sku: string }[] = [];
      for (let start = 0; start < values.length; start += 500) {
        inserted.push(
          ...(await tx
            .insert(products)
            .values(values.slice(start, start + 500))
            .returning({ id: products.id, sku: products.sku })),
        );
      }

      const mapping = { sku: "SKU", qty: "Qty" };
      const job = await makeJob(
        tx,
        inserted.map((row) => ({ SKU: row.sku, Qty: "0" })),
        mapping,
      );
      const analysis = await analyzeMasterImport(tx, {
        companyId: ORG,
        job,
        mapping,
        warehouseId,
        date: todayISO(),
      });
      expect(analysis.summary.valid).toBe(count);

      const commit = await commitOpeningStockImport(tx, {
        companyId: ORG,
        userId: USER,
        job,
        mapping,
        warehouseId,
        date: todayISO(),
      });
      expect(commit.imported).toBe(count);
      expect(commit.failed).toBe(0);
      expect(commit.receiptNumber).toBeTruthy();

      const [receipt] = await tx
        .select({ id: stockReceipts.id })
        .from(stockReceipts)
        .where(
          and(
            eq(stockReceipts.companyId, ORG),
            eq(stockReceipts.number, commit.receiptNumber!),
          ),
        );
      const [{ lines }] = await tx
        .select({ lines: sql<number>`count(*)::int` })
        .from(stockReceiptLines)
        .where(
          and(
            eq(stockReceiptLines.companyId, ORG),
            eq(stockReceiptLines.receiptId, receipt.id),
          ),
        );
      expect(lines).toBe(count);
    });
  }, 60_000);
});

describe("template stok awal", () => {
  it("menandai biaya satuan sebagai kolom wajib di template", () => {
    const field = ENTITY_FIELDS.opening_stock.find((row) => row.key === "unitCost");
    expect(field?.required).toBe(true);
  });
});
