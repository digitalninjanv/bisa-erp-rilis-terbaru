import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { importJobs, importRows } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { listImportRowsAction } from "@/server/actions/import/rows";

// Pola yang sama dengan inventory-void-import.test.ts: sesi & cache Next
// diganti agar kode action asli berjalan terhadap database dev asli.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const mod = {
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  };
  return { ...mod, requirePermissionInModule: mod.requirePermission };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

describe("GD-P2-7 review impor: isu per baris tersimpan, filter problem, pagination", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const skuA = `TST-REV-${suffix}-A`;
  const skuB = `TST-REV-${suffix}-B`;
  const skuC = `TST-REV-${suffix}-C`;
  let jobId = "";

  afterAll(async () => {
    if (!jobId) return;
    await withCompany(ORG_ID, async (tx) => {
      await tx.delete(importRows).where(eq(importRows.jobId, jobId));
      await tx.delete(importJobs).where(eq(importJobs.id, jobId));
    });
  });

  it("analisis menyimpan issue per baris dan listImportRowsAction menyaringnya dengan tepat", async () => {
    const mapping = {
      name: "Nama",
      sku: "SKU",
      costPrice: "Harga Beli",
      salePrice: "Harga Jual",
    };

    await withCompany(ORG_ID, async (tx) => {
      const [job] = await tx
        .insert(importJobs)
        .values({
          companyId: ORG_ID,
          entity: "products",
          fileName: "uji-review-impor.csv",
          status: "preview",
          totalRows: 12,
          mapping,
          createdBy: USER_ID,
        })
        .returning({ id: importJobs.id });
      jobId = job.id;

      // 8 baris valid tambahan agar pagination teruji pada pageSize sah
      // (skema action membatasi pageSize >= 10).
      const extraValid = Array.from({ length: 8 }, (_, i) => ({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: 5 + i,
        status: "pending",
        data: {
          Nama: `Produk Tambahan ${i + 1}`,
          SKU: `TST-REV-${suffix}-X${i + 1}`,
          "Harga Beli": "1000",
          "Harga Jual": "2000",
        },
      }));

      await tx.insert(importRows).values([
        {
          companyId: ORG_ID,
          jobId: job.id,
          rowNumber: 1,
          status: "pending",
          data: { Nama: "Produk A", SKU: skuA, "Harga Beli": "5000", "Harga Jual": "15000" },
        },
        {
          companyId: ORG_ID,
          jobId: job.id,
          rowNumber: 2,
          status: "pending",
          // SKU sama dengan baris 1 — duplikat di dalam file.
          data: { Nama: "Produk A Lagi", SKU: skuA, "Harga Beli": "6000", "Harga Jual": "16000" },
        },
        {
          companyId: ORG_ID,
          jobId: job.id,
          rowNumber: 3,
          status: "pending",
          // Harga jual terisi tetapi tidak bisa diurai sebagai angka.
          data: { Nama: "Produk B", SKU: skuB, "Harga Beli": "7000", "Harga Jual": "hubungi kami" },
        },
        {
          companyId: ORG_ID,
          jobId: job.id,
          rowNumber: 4,
          status: "pending",
          // Format ribuan id-ID yang sah — harus terbaca sebagai 20000.
          data: { Nama: "Produk C", SKU: skuC, "Harga Beli": "9000", "Harga Jual": "20.000" },
        },
        ...extraValid,
      ]);
    });

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.data.summary.duplicateInFile).toBe(1);
      expect(analysis.data.summary.invalidPrice).toBe(1);
    }

    // Issue benar-benar tersimpan di baris, bukan hanya di pratinjau analisis.
    const stored = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select({ rowNumber: importRows.rowNumber, error: importRows.error })
        .from(importRows)
        .where(eq(importRows.jobId, jobId))
        .orderBy(asc(importRows.rowNumber)),
    );
    expect(stored).toHaveLength(12);
    expect(stored[0].error).toBeNull();
    expect(stored[1].error).toContain("duplikat");
    expect(stored[2].error).toContain("tidak terbaca");
    expect(stored[3].error).toBeNull();
    expect(stored.slice(4).every((row) => row.error === null)).toBe(true);

    // Filter "problem" mengembalikan tepat baris bermasalah itu.
    const problem = await listImportRowsAction({ jobId, filter: "problem", page: 1, pageSize: 50 });
    expect(problem.ok).toBe(true);
    if (problem.ok) {
      expect(problem.data.total).toBe(2);
      expect(problem.data.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
      expect(problem.data.rows[0].error).toContain("duplikat");
      expect(problem.data.rows[1].error).toContain("tidak terbaca");
    }

    // Filter "valid" mengembalikan tepat baris yang siap.
    const valid = await listImportRowsAction({ jobId, filter: "valid", page: 1, pageSize: 50 });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data.total).toBe(10);
      expect(valid.data.rows.map((row) => row.rowNumber)).toEqual([1, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }

    // Pagination menjangkau semua baris, bukan halaman pertama saja.
    const page2 = await listImportRowsAction({ jobId, filter: "all", page: 2, pageSize: 10 });
    expect(page2.ok).toBe(true);
    if (page2.ok) {
      expect(page2.data.total).toBe(12);
      expect(page2.data.rows.map((row) => row.rowNumber)).toEqual([11, 12]);
    }
  });
});
