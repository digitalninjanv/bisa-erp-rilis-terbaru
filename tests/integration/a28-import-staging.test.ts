import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, count, eq } from "drizzle-orm";
import {
  accounts,
  categories,
  customerGroups,
  customers,
  importJobs,
  importRows,
  journalEntries,
  products,
  stockMovements,
  stockOnHand,
  suppliers,
  units,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";

// A-28 Tahap 6 (H-X-02) — karakterisasi kontrak impor yang dinyatakan
// eksplisit di docs/KONTRAK-IMPOR.md:
//   "dry-run" impor = tahap ANALISIS menulis STAGING saja
//   (import_jobs/import_rows milik job itu sendiri). NOL baris data
//   master berubah sebelum commit — termasuk kategori/satuan/pemasok
//   baru yang baru DICIPTAKAN pada tahap commit.
// Test ini membuktikan kontraknya: snapshot hitungan seluruh tabel
// master yang disentuh jalur produk & master identik sebelum/sesudah
// analyze, sementara baris staging terbukti berubah (isu per baris
// tertulis) dan status job tetap "preview".
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
}));

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);

const createdJobIds: string[] = [];

const MASTER_TABLES = {
  products,
  categories,
  units,
  suppliers,
  customers,
  customerGroups,
  accounts,
  stockOnHand,
  stockMovements,
  journalEntries,
} as const;

type MasterSnapshot = Record<keyof typeof MASTER_TABLES, number>;

async function snapshotMaster(): Promise<MasterSnapshot> {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const entries = await Promise.all(
      Object.entries(MASTER_TABLES).map(async ([name, table]) => {
        const [row] = await tx
          .select({ c: count() })
          .from(table)
          .where(eq(table.companyId, ORG_ID));
        return [name, row.c] as const;
      }),
    );
    return Object.fromEntries(entries) as MasterSnapshot;
  });
}

async function stagingCounts() {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [jobs] = await tx
      .select({ c: count() })
      .from(importJobs)
      .where(eq(importJobs.companyId, ORG_ID));
    const [rows] = await tx
      .select({ c: count() })
      .from(importRows)
      .where(eq(importRows.companyId, ORG_ID));
    return { jobs: jobs.c, rows: rows.c };
  });
}

async function makeJob(
  entity: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
): Promise<string> {
  const jobId = await withCompany(ORG_ID, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_ID,
        entity,
        fileName: `uji-staging-a28-${entity}-${suffix}.csv`,
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
  return jobId;
}

async function storedRows(jobId: string) {
  return withCompanyReadOnly(ORG_ID, (tx) =>
    tx
      .select()
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .orderBy(asc(importRows.rowNumber)),
  );
}

async function jobStatus(jobId: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    return job.status;
  });
}

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    for (const jobId of createdJobIds) {
      await tx.delete(importRows).where(eq(importRows.jobId, jobId));
      await tx.delete(importJobs).where(eq(importJobs.id, jobId));
    }
  });
});

describe("A-28 Tahap 6 (H-X-02) — analyze impor menulis staging saja", () => {
  it("jalur produk: hitungan master identik sesudah analyze; kategori baru hanya dilaporkan, tidak dibuat", async () => {
    const before = await snapshotMaster();
    const stagingBefore = await stagingCounts();

    const newCategory = `Kategori Staging A28 ${suffix}`;
    const mapping = {
      sku: "SKU",
      name: "Nama",
      category: "Kategori",
      costPrice: "Harga Beli",
      salePrice: "Harga Jual",
      stock: "Stok",
      minStock: "Stok Minimum",
    };
    const jobId = await makeJob(
      "products",
      [
        // Baris valid dengan kategori & satuan yang BELUM ada: analyze
        // boleh melaporkannya sebagai "baru", tidak boleh membuatnya.
        {
          SKU: `A28-STG-${suffix}`,
          Nama: "Produk Staging A28",
          Kategori: newCategory,
          "Harga Beli": "1000",
          "Harga Jual": "2000",
          Stok: "10",
          "Stok Minimum": "1",
        },
        // Duplikat SKU di dalam berkas yang sama.
        {
          SKU: `A28-STG-${suffix}`,
          Nama: "Produk Duplikat A28",
          Kategori: newCategory,
          "Harga Beli": "1000",
          "Harga Jual": "2000",
          Stok: "5",
          "Stok Minimum": "1",
        },
        // Baris rusak: nama kosong.
        {
          SKU: `A28-BAD-${suffix}`,
          Nama: "",
          Kategori: "",
          "Harga Beli": "1000",
          "Harga Jual": "2000",
          Stok: "5",
          "Stok Minimum": "1",
        },
      ],
      mapping,
    );

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.newCategories).toContain(newCategory);

    // Kontrak inti: NOL perubahan pada seluruh tabel master.
    expect(await snapshotMaster()).toEqual(before);

    // …tetapi staging terbukti bekerja: job & barisnya bertambah,
    // isu per baris tertulis di staging, status job tetap preview
    // (belum ada commit apa pun).
    const stagingAfter = await stagingCounts();
    expect(stagingAfter.jobs).toBe(stagingBefore.jobs + 1);
    expect(stagingAfter.rows).toBe(stagingBefore.rows + 3);
    const rows = await storedRows(jobId);
    expect(rows[0].error).toBeNull();
    expect(rows[1].error).toBeTruthy();
    expect(rows[2].error).toBeTruthy();
    expect(await jobStatus(jobId)).toBe("preview");
  });

  it("jalur master (pemasok): hitungan master identik sesudah analyze; isu baris hanya di staging", async () => {
    const before = await snapshotMaster();

    const mapping = { code: "Kode", name: "Nama", phone: "Telepon" };
    const jobId = await makeJob(
      "suppliers",
      [
        { Kode: `SUP-STG-${suffix}`, Nama: `Pemasok Staging A28 ${suffix}`, Telepon: "0812" },
        { Kode: "", Nama: "", Telepon: "" },
      ],
      mapping,
    );

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);

    expect(await snapshotMaster()).toEqual(before);
    const rows = await storedRows(jobId);
    expect(rows[0].error).toBeNull();
    expect(rows[1].error).toBeTruthy();
    expect(await jobStatus(jobId)).toBe("preview");
  });
});
