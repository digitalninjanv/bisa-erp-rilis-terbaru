/**
 * Audit-only probe: how the opening-stock wizard behaves at row counts
 * well below the 25k file cap. Rolls back all writes.
 */
import { and, eq } from "drizzle-orm";
import { withCompany } from "../../src/db/tenant";
import { importJobs, importRows, products, warehouses } from "../../src/db/schema";
import { analyzeMasterImport } from "../../src/server/import/analyze";
import { commitOpeningStockImport } from "../../src/server/import/opening";
import { todayISO } from "../../src/lib/format";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const COUNT = Number(process.env.OPENING_ROWS ?? 1000);
const mapping = { sku: "SKU", qty: "Qty", unitCost: "Biaya Satuan" };

async function main() {
  const started = performance.now();
  let result: Record<string, unknown> = {};
  await withCompany(ORG, async (tx) => {
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
      .limit(1);
    if (!warehouse) throw new Error("warehouse missing");

    const suffix = crypto.randomUUID().slice(0, 8);
    const productValues = Array.from({ length: COUNT }, (_, index) => ({
      companyId: ORG,
      sku: `OPEN-${suffix}-${index}`,
      name: `Stok Awal Probe ${suffix} ${index}`,
      costPrice: "1000",
      salePrice: "1500",
      trackStock: true,
    }));
    const inserted: { id: string; sku: string }[] = [];
    for (let start = 0; start < productValues.length; start += 500) {
      const batch = await tx
        .insert(products)
        .values(productValues.slice(start, start + 500))
        .returning({ id: products.id, sku: products.sku });
      inserted.push(...batch);
    }

    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG,
        entity: "opening_stock",
        fileName: `probe-${COUNT}.xlsx`,
        status: "preview",
        totalRows: COUNT,
        mapping,
        createdBy: USER,
      })
      .returning();
    const rowValues = inserted.map((product, index) => ({
      companyId: ORG,
      jobId: job.id,
      rowNumber: index + 1,
      status: "pending" as const,
      data: { SKU: product.sku, Qty: "10", "Biaya Satuan": "1000" },
    }));
    for (let start = 0; start < rowValues.length; start += 500) {
      await tx.insert(importRows).values(rowValues.slice(start, start + 500));
    }

    const analysisStarted = performance.now();
    const analysis = await analyzeMasterImport(tx, {
      companyId: ORG,
      job,
      mapping,
      warehouseId: warehouse.id,
      date: todayISO(),
    });
    const analysisMs = performance.now() - analysisStarted;

    const commitStarted = performance.now();
    const commit = await commitOpeningStockImport(tx, {
      companyId: ORG,
      userId: USER,
      job,
      mapping,
      warehouseId: warehouse.id,
      date: todayISO(),
    });
    const commitMs = performance.now() - commitStarted;

    result = {
      rows: COUNT,
      analysisMs: Math.round(analysisMs),
      analysisValid: analysis.summary.valid,
      commitMs: Math.round(commitMs),
      imported: commit.imported,
      failed: commit.failed,
      receiptCount: (commit as { receiptNumber?: string | null }).receiptNumber ? 1 : 0,
    };
    throw new Error("__ROLLBACK__");
  }).catch((error) => {
    if (!(error instanceof Error) || error.message !== "__ROLLBACK__") throw error;
  });
  result.totalMs = Math.round(performance.now() - started);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
