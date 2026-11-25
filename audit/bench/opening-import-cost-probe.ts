/**
 * Audit-only probe: opening-stock file without a cost column maps to
 * unitCost 0 and commits a zero-value receipt. Rolls back all writes.
 */
import { and, eq } from "drizzle-orm";
import { withCompany } from "../../src/db/tenant";
import {
  importJobs,
  importRows,
  journalEntries,
  products,
  stockOnHand,
  stockReceipts,
  warehouses,
} from "../../src/db/schema";
import { analyzeMasterImport } from "../../src/server/import/analyze";
import { commitOpeningStockImport } from "../../src/server/import/opening";
import { todayISO } from "../../src/lib/format";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";

async function main() {
  let result: Record<string, unknown> = {};
  await withCompany(ORG, async (tx) => {
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
      .limit(1);
    if (!warehouse) throw new Error("warehouse missing");
    const suffix = crypto.randomUUID().slice(0, 8);
    const [product] = await tx
      .insert(products)
      .values({
        companyId: ORG,
        sku: `OPEN-COST-${suffix}`,
        name: `Produk Tanpa Kolom Biaya ${suffix}`,
        costPrice: "1500",
        salePrice: "2000",
        trackStock: true,
      })
      .returning({ id: products.id, sku: products.sku });

    const mapping = { sku: "SKU", qty: "Qty" }; // no unitCost mapping
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG,
        entity: "opening_stock",
        fileName: `probe-no-cost-${suffix}.xlsx`,
        status: "preview",
        totalRows: 1,
        mapping,
        createdBy: USER,
      })
      .returning();
    await tx.insert(importRows).values({
      companyId: ORG,
      jobId: job.id,
      rowNumber: 1,
      status: "pending",
      data: { SKU: product.sku, Qty: "10" },
    });

    const analysis = await analyzeMasterImport(tx, {
      companyId: ORG,
      job,
      mapping,
      warehouseId: warehouse.id,
      date: todayISO(),
    });
    const commit = await commitOpeningStockImport(tx, {
      companyId: ORG,
      userId: USER,
      job,
      mapping,
      warehouseId: warehouse.id,
      date: todayISO(),
    });
    const [receipt] = await tx
      .select({ id: stockReceipts.id, total: stockReceipts.total })
      .from(stockReceipts)
      .where(and(eq(stockReceipts.companyId, ORG), eq(stockReceipts.number, commit.receiptNumber!)));
    const [journal] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.sourceId, receipt.id)));
    const [onHand] = await tx
      .select({ qty: stockOnHand.qty })
      .from(stockOnHand)
      .where(and(eq(stockOnHand.companyId, ORG), eq(stockOnHand.warehouseId, warehouse.id), eq(stockOnHand.productId, product.id)));

    result = {
      analyzedValid: analysis.summary.valid,
      analyzedInvalid: analysis.summary.invalidRows,
      analyzedIssue: analysis.preview[0]?.issue ?? null,
      imported: commit.imported,
      failed: commit.failed,
      receiptTotal: receipt.total,
      journalCreated: Boolean(journal),
      stockQty: onHand?.qty ?? null,
      masterCost: (await tx.select({ cost: products.costPrice }).from(products).where(and(eq(products.companyId, ORG), eq(products.id, product.id))).limit(1))[0]?.cost ?? null,
    };
    throw new Error("__ROLLBACK__");
  }).catch((error) => {
    if (!(error instanceof Error) || error.message !== "__ROLLBACK__") throw error;
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
