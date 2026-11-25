/** Audit-only probe: the shipped opening-stock template sample. */
import { eq } from "drizzle-orm";
import { withCompany } from "../../src/db/tenant";
import { importJobs, importRows } from "../../src/db/schema";
import { analyzeMasterImport } from "../../src/server/import/analyze";
import { ENTITY_FIELDS, IMPORT_SAMPLES, suggestMappingFor } from "../../src/lib/import-parse";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";

async function main() {
  let result: Record<string, unknown> = {};
  await withCompany(ORG, async (tx) => {
    const [headerLine, ...lines] = IMPORT_SAMPLES.opening_stock.csv.split("\n");
    const headers = headerLine.split(",").map((cell) => cell.trim());
    const mapping = suggestMappingFor(ENTITY_FIELDS.opening_stock, headers);
    const rows = lines.filter(Boolean).map((line) => {
      const cells = line.split(",");
      return Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()]));
    });
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG,
        entity: "opening_stock",
        fileName: "contoh-impor-stok-awal.csv",
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
        data,
        status: "pending",
      })),
    );
    const analysis = await analyzeMasterImport(tx, { companyId: ORG, job, mapping });
    result = {
      headers,
      mapping,
      rows,
      valid: analysis.summary.valid,
      invalid: analysis.summary.invalidRows,
      unknownProducts: analysis.summary.unknownProducts,
      issue: analysis.preview[0]?.issue ?? null,
    };
    await tx.delete(importRows).where(eq(importRows.jobId, job.id));
    await tx.delete(importJobs).where(eq(importJobs.id, job.id));
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
