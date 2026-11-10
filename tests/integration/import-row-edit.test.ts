import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { importJobs, importRows, products } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import {
  listImportRowsAction,
  skipImportRowsAction,
  updateImportRowAction,
} from "@/server/actions/import/rows";
import { commitImportBatchAction } from "@/server/actions/import/commit";

// Pola yang sama dengan import-hardening.test.ts: sesi & cache Next
// diganti agar kode action asli berjalan terhadap database dev asli.
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

type ListedRow = {
  rowNumber: number;
  edited?: boolean;
  flags?: {
    barcodeKosong: boolean;
    hargaJualKosong: boolean;
    hargaBeliKosong: boolean;
    duplikatDalamBerkas: boolean;
    duplikatKatalog: boolean;
    bermasalah: boolean;
    siap: boolean;
    lengkap: boolean;
    belumLengkap: boolean;
  };
};

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

const MAPPING = {
  name: "Nama",
  sku: "SKU",
  barcode: "Barcode",
  unit: "Satuan",
  costPrice: "Harga Beli",
  salePrice: "Harga Jual",
};

const suffix = crypto.randomUUID().slice(0, 8);
const SKU = (n: number) => `EDT-${suffix}-${n}`;
const CATALOG_SKU = `EDT-${suffix}-CAT`;
const CATALOG_BARCODE = "8992220001";

const createdJobIds: string[] = [];
const createdProductSkus: string[] = [CATALOG_SKU];

async function createJob(
  rows: { rowNumber: number; data: Record<string, unknown> }[],
  mapping: Record<string, string> = MAPPING,
): Promise<string> {
  let jobId = "";
  await withCompany(ORG_ID, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_ID,
        entity: "products",
        fileName: "uji-edit-baris-impor.csv",
        status: "preview",
        totalRows: rows.length,
        mapping,
        createdBy: USER_ID,
      })
      .returning({ id: importJobs.id });
    jobId = job.id;
    await tx.insert(importRows).values(
      rows.map((row) => ({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: row.rowNumber,
        status: "pending",
        data: row.data,
      })),
    );
  });
  createdJobIds.push(jobId);
  return jobId;
}

async function readRows(jobId: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) =>
    tx
      .select()
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .orderBy(asc(importRows.rowNumber)),
  );
}

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    const imported = await tx
      .select({ sku: products.sku })
      .from(products)
      .where(eq(products.companyId, ORG_ID));
    const mine = imported
      .map((row) => row.sku)
      .filter((sku) => sku.startsWith(`EDT-${suffix}`) || createdProductSkus.includes(sku));
    if (mine.length > 0) {
      await tx.delete(products).where(inArray(products.sku, mine));
    }
    for (const jobId of createdJobIds) {
      await tx.delete(importRows).where(eq(importRows.jobId, jobId));
      await tx.delete(importJobs).where(eq(importJobs.id, jobId));
    }
  });
});

describe("A-10/D-21: filter kategori, edit di tempat, dan commit selektif impor produk", () => {
  let jobId = "";

  it("menyiapkan katalog dan job dengan baris beragam masalah", async () => {
    await withCompany(ORG_ID, async (tx) => {
      await tx.insert(products).values({
        companyId: ORG_ID,
        sku: CATALOG_SKU,
        barcode: CATALOG_BARCODE,
        name: "Produk Katalog Lama",
        costPrice: "1000",
        salePrice: "2000",
      });
    });

    jobId = await createJob([
      // 1: barcode kosong, selain itu siap.
      { rowNumber: 1, data: { Nama: "Produk Satu", SKU: SKU(1), Barcode: "", Satuan: "PCS", "Harga Beli": "5000", "Harga Jual": "15000" } },
      // 2: harga beli & jual kosong, barcode terisi.
      { rowNumber: 2, data: { Nama: "Produk Dua", SKU: SKU(2), Barcode: "8991110002", Satuan: "PCS", "Harga Beli": "", "Harga Jual": "" } },
      // 3: SKU duplikat dari baris 1.
      { rowNumber: 3, data: { Nama: "Produk Tiga", SKU: SKU(1), Barcode: "", Satuan: "PCS", "Harga Beli": "6000", "Harga Jual": "16000" } },
      // 4: barcode milik produk katalog lain.
      { rowNumber: 4, data: { Nama: "Produk Empat", SKU: SKU(4), Barcode: CATALOG_BARCODE, Satuan: "PCS", "Harga Beli": "7000", "Harga Jual": "17000" } },
      // 5: bersih.
      { rowNumber: 5, data: { Nama: "Produk Lima", SKU: SKU(5), Barcode: "8993330005", Satuan: "PCS", "Harga Beli": "8000", "Harga Jual": "18000" } },
    ]);

    const analysis = await analyzeImportAction({ jobId, mapping: MAPPING });
    expect(analysis.ok).toBe(true);
  });

  it("filter kategori dan hitungan klasifikasi tepat", async () => {
    const all = await listImportRowsAction({ jobId, filter: "all", page: 1, pageSize: 50 });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.data.counts).toMatchObject({
      total: 5,
      siap: 3,
      lengkap: 1,
      belumLengkap: 2,
      bermasalah: 2,
      barcodeKosong: 2,
      hargaJualKosong: 1,
      hargaBeliKosong: 1,
      duplikat: 3,
    });
    expect(all.data.problemRowNumbers).toEqual([3, 4]);
    expect(all.data.incompleteRowNumbers).toEqual([1, 2]);
    // Hanya baris 5 yang lengkap (SKU, Nama, Barcode, Satuan, harga > 0).
    expect(all.data.selectableRowNumbers).toEqual([5]);

    const byFilter = async (
      filter:
        | "barcode_empty"
        | "sale_price_empty"
        | "cost_price_empty"
        | "duplicate"
        | "problem"
        | "valid"
        | "complete"
        | "incomplete",
    ) => {
      const result = await listImportRowsAction({ jobId, filter, page: 1, pageSize: 50 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("list gagal");
      return result.data.rows.map((row) => row.rowNumber);
    };
    await expect(byFilter("barcode_empty")).resolves.toEqual([1, 3]);
    await expect(byFilter("sale_price_empty")).resolves.toEqual([2]);
    await expect(byFilter("cost_price_empty")).resolves.toEqual([2]);
    await expect(byFilter("duplicate")).resolves.toEqual([1, 3, 4]);
    await expect(byFilter("problem")).resolves.toEqual([3, 4]);
    await expect(byFilter("valid")).resolves.toEqual([1, 2, 5]);
    await expect(byFilter("complete")).resolves.toEqual([5]);
    await expect(byFilter("incomplete")).resolves.toEqual([1, 2]);
  });

  it("edit barcode kosong tersimpan, terklasifikasi ulang, dan tertandai diubah", async () => {
    const result = await updateImportRowAction({
      jobId,
      rowNumber: 1,
      fields: { barcode: "8995550001" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.counts.barcodeKosong).toBe(1);
    expect(result.data.row.flags.barcodeKosong).toBe(false);
    expect(result.data.row.edited).toBe(true);

    const stored = await readRows(jobId);
    expect(String((stored[0].data as Record<string, unknown>)["Barcode"])).toBe("8995550001");

    const list = await listImportRowsAction({ jobId, filter: "all", page: 1, pageSize: 50 });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const first = list.data.rows[0] as ListedRow;
      expect(first.edited).toBe(true);
      expect(first.flags?.barcodeKosong).toBe(false);
    }
  });

  it("edit yang menyamakan barcode menandai kedua baris, dan mengembalikannya membersihkan lagi", async () => {
    const clash = await updateImportRowAction({
      jobId,
      rowNumber: 5,
      fields: { barcode: "8991110002" },
    });
    expect(clash.ok).toBe(true);

    const list = await listImportRowsAction({ jobId, filter: "duplicate", page: 1, pageSize: 50 });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const numbers = list.data.rows.map((row) => row.rowNumber);
    expect(numbers).toContain(2);
    expect(numbers).toContain(5);
    const listed = list.data.rows as ListedRow[];
    const row5 = listed.find((row) => row.rowNumber === 5);
    const row2 = listed.find((row) => row.rowNumber === 2);
    expect(row5?.flags?.bermasalah).toBe(true);
    expect(row2?.flags?.bermasalah).toBe(false);

    // Isu duplikat barcode juga tersimpan oleh analisis ulang di server.
    const stored = await readRows(jobId);
    expect(stored[4].error).toContain("Barcode duplikat");

    const fixed = await updateImportRowAction({
      jobId,
      rowNumber: 5,
      fields: { barcode: "8993330005" },
    });
    expect(fixed.ok).toBe(true);
    const after = await readRows(jobId);
    expect(after[4].error).toBeNull();
  });

  it("edit SKU duplikat menjadi unik membuat baris siap dan isu tersimpan bersih", async () => {
    const result = await updateImportRowAction({
      jobId,
      rowNumber: 3,
      fields: { sku: SKU(3) },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.row.flags.siap).toBe(true);
    const stored = await readRows(jobId);
    expect(stored[2].error).toBeNull();
  });

  it("commit hanya menerapkan baris valid terpilih; baris bermasalah dilewati dengan alasannya utuh", async () => {
    // Baris 4 masih bermasalah (konflik barcode katalog): wizard
    // melewatinya lewat skip dengan keepError agar alasan aslinya awet.
    const skip = await skipImportRowsAction({ jobId, rowNumbers: [4], keepError: true });
    expect(skip.ok).toBe(true);
    if (skip.ok) expect(skip.data.skipped).toBe(1);

    for (let guard = 0; guard < 10; guard += 1) {
      const batch = await commitImportBatchAction({
        jobId,
        mapping: MAPPING,
        limit: 250,
        updateExisting: false,
        importStock: false,
      });
      expect(batch.ok).toBe(true);
      if (!batch.ok) return;
      if (batch.data.done || batch.data.processed === 0) break;
    }

    const stored = await readRows(jobId);
    expect(stored.map((row) => row.status)).toEqual([
      "imported",
      "imported",
      "imported",
      "skipped",
      "imported",
    ]);
    expect(stored[3].error).toContain("Barcode sudah dipakai");

    const created = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select({ sku: products.sku, barcode: products.barcode, salePrice: products.salePrice })
        .from(products)
        .where(inArray(products.sku, [SKU(1), SKU(2), SKU(3), SKU(5)])),
    );
    expect(created).toHaveLength(4);
    // Nilai hasil edit yang terimpor, bukan nilai berkas asal.
    expect(created.find((row) => row.sku === SKU(1))?.barcode).toBe("8995550001");
    expect(created.find((row) => row.sku === SKU(3))).toBeTruthy();
  });

  it("edit pada baris yang sudah diproses ditolak", async () => {
    const result = await updateImportRowAction({
      jobId,
      rowNumber: 1,
      fields: { name: "Tidak Boleh" },
    });
    expect(result.ok).toBe(false);
  });

  it("server menolak baris tidak valid yang ditulis paksa ke data baris saat commit", async () => {
    const forcedJobId = await createJob([
      // Harga tak terbaca — seolah klien jahat melewati pratinjau.
      { rowNumber: 1, data: { Nama: "Paksa Rusak", SKU: SKU(91), Barcode: "", "Harga Beli": "5000", "Harga Jual": "hubungi kami" } },
      // Barcode konflik katalog ditulis langsung.
      { rowNumber: 2, data: { Nama: "Paksa Konflik", SKU: SKU(92), Barcode: CATALOG_BARCODE, "Harga Beli": "5000", "Harga Jual": "15000" } },
      // Satu baris sah sebagai pembanding.
      { rowNumber: 3, data: { Nama: "Paksa Sah", SKU: SKU(93), Barcode: "", "Harga Beli": "5000", "Harga Jual": "15000" } },
    ]);

    const batch = await commitImportBatchAction({
      jobId: forcedJobId,
      mapping: MAPPING,
      limit: 250,
      updateExisting: false,
      importStock: false,
    });
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.data.imported).toBe(1);
    expect(batch.data.failed).toBe(2);

    const stored = await readRows(forcedJobId);
    expect(stored[0].status).toBe("error");
    expect(stored[0].error).toContain("tidak terbaca");
    expect(stored[1].status).toBe("error");
    expect(stored[1].error).toContain("Barcode dipakai produk");
    expect(stored[2].status).toBe("imported");

    const created = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select({ sku: products.sku })
        .from(products)
        .where(inArray(products.sku, [SKU(91), SKU(92), SKU(93)])),
    );
    expect(created.map((row) => row.sku)).toEqual([SKU(93)]);
  });
});
