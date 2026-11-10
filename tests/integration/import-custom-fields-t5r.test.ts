import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { importJobs, importRows, products, suppliers } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { saveCustomFieldsAction } from "@/server/actions/settings/kolom-kustom";
import {
  ENTITY_FIELDS,
  IMPORT_FIELDS,
  suggestMappingFor,
  type ImportEntity,
} from "@/lib/import-parse";

// T5R-3 (P2): jalur impor tidak boleh melewati kolom kustom wajib
// diam-diam. Impor tidak membawa nilai kustom (tidak ada kolom CSV-nya),
// jadi baris yang terimpor diberi catatan hasil yang terlihat — entitas
// tetap terimpor, pengguna melengkapi lewat form edit. Tanpa definisi
// required, tidak ada catatan apa pun.
// Sesi statis perusahaan demo (pola platform-t5.test.ts); definisi kolom
// kustom yang dipasang selama test dipulihkan di afterAll.

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
}));

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);
const createdJobIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdProductIds: string[] = [];

type Mapping = Partial<Record<string, string>>;

async function makeJob(
  entity: ImportEntity,
  headers: string[],
  rows: Record<string, string>[],
): Promise<{ jobId: string; mapping: Mapping }> {
  const fields = entity === "products" ? IMPORT_FIELDS : ENTITY_FIELDS[entity];
  const mapping = suggestMappingFor(fields, headers) as Mapping;
  const jobId = await withCompany(ORG_ID, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_ID,
        entity,
        fileName: `uji-t5r3-${entity}-${suffix}.csv`,
        status: "preview",
        totalRows: rows.length,
        mapping,
        createdBy: USER_ID,
      })
      .returning({ id: importJobs.id });
    await tx.insert(importRows).values(
      rows.map((data, index) => ({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: index + 1,
        data,
        status: "pending",
      })),
    );
    return job.id;
  });
  createdJobIds.push(jobId);
  return { jobId, mapping };
}

async function readRows(jobId: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) =>
    tx
      .select({ status: importRows.status, error: importRows.error, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .orderBy(asc(importRows.rowNumber)),
  );
}

afterAll(async () => {
  await saveCustomFieldsAction({ definitions: {} });
  await withCompany(ORG_ID, async (tx) => {
    for (const id of createdSupplierIds) await tx.delete(suppliers).where(eq(suppliers.id, id));
    for (const id of createdProductIds) await tx.delete(products).where(eq(products.id, id));
    for (const id of createdJobIds) {
      await tx.delete(importRows).where(eq(importRows.jobId, id));
      await tx.delete(importJobs).where(eq(importJobs.id, id));
    }
  });
});

describe("T5R-3 impor master menghormati kolom kustom wajib", () => {
  it("tanpa definisi required: pemasok terimpor tanpa catatan", async () => {
    const { jobId, mapping } = await makeJob("suppliers", ["Nama pemasok"], [
      { "Nama pemasok": `PT T5R Polos ${suffix}` },
    ]);
    const analyzed = await analyzeImportAction({ jobId });
    expect(analyzed.ok).toBe(true);
    const committed = await commitImportBatchAction({ jobId, mapping, limit: 10 });
    expect(committed.ok).toBe(true);

    const rows = await readRows(jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("imported");
    expect(rows[0].error).toBeNull();
    expect(rows[0].entityId).toBeTruthy();
    createdSupplierIds.push(rows[0].entityId!);
  });

  it("dengan definisi required: pemasok tetap terimpor, hasil baris memuat catatan kolom wajib", async () => {
    const saved = await saveCustomFieldsAction({
      definitions: {
        supplier: [{ key: "npwp", label: "NPWP", type: "text", required: true }],
      },
    });
    expect(saved.ok).toBe(true);

    const { jobId, mapping } = await makeJob("suppliers", ["Nama pemasok"], [
      { "Nama pemasok": `PT T5R Wajib ${suffix}` },
    ]);
    const analyzed = await analyzeImportAction({ jobId });
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) {
      const first = analyzed.data.preview[0];
      expect(first?.issue).toContain("NPWP");
    }
    const committed = await commitImportBatchAction({ jobId, mapping, limit: 10 });
    expect(committed.ok).toBe(true);

    const rows = await readRows(jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("imported");
    expect(rows[0].error).toBe(
      "Terimpor tanpa kolom wajib kustom terisi: NPWP — lengkapi lewat form edit.",
    );
    expect(rows[0].entityId).toBeTruthy();
    createdSupplierIds.push(rows[0].entityId!);

    const stored = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.id, rows[0].entityId!))
        .limit(1);
      return row;
    });
    expect(stored).toBeDefined();
  });
});

describe("T5R-3 impor produk menghormati kolom kustom wajib", () => {
  it("produk terimpor memuat catatan kolom wajib produk pada hasil barisnya", async () => {
    const saved = await saveCustomFieldsAction({
      definitions: {
        product: [{ key: "merek", label: "Merek", type: "text", required: true }],
      },
    });
    expect(saved.ok).toBe(true);

    const sku = `T5R3-${suffix}`.toUpperCase();
    const { jobId, mapping } = await makeJob("products", ["Kode / SKU", "Nama barang", "Harga jual"], [
      { "Kode / SKU": sku, "Nama barang": `Produk T5R ${suffix}`, "Harga jual": "10000" },
    ]);
    const analyzed = await analyzeImportAction({ jobId });
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) {
      expect(analyzed.data.preview[0]?.issue).toContain("Merek");
    }
    const committed = await commitImportBatchAction({ jobId, mapping, limit: 10 });
    expect(committed.ok).toBe(true);

    const rows = await readRows(jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("imported");
    expect(rows[0].error).toBe(
      "Terimpor tanpa kolom wajib kustom terisi: Merek — lengkapi lewat form edit.",
    );
    expect(rows[0].entityId).toBeTruthy();
    createdProductIds.push(rows[0].entityId!);
  });
});
