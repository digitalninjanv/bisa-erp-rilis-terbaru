import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { importJobs, importRows, products } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import {
  cancelImportAction,
  listImportRowsAction,
  skipImportRowsAction,
} from "@/server/actions/import/rows";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { mapProductRow } from "@/lib/import-parse";
import { POST as parseImportRoute } from "@/app/api/import/parse/route";

// Pola yang sama dengan import-review.test.ts: sesi & cache Next diganti
// agar kode action/rute asli berjalan terhadap database dev asli.
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

const MAPPING = {
  name: "Nama",
  sku: "SKU",
  costPrice: "Harga Beli",
  salePrice: "Harga Jual",
  stock: "Stok",
  minStock: "Stok Minimum",
};

const createdJobIds: string[] = [];
const createdProductIds: string[] = [];

async function createJob(
  rows: { rowNumber: number; status?: string; data: Record<string, unknown> }[],
  status = "preview",
): Promise<string> {
  let jobId = "";
  await withCompany(ORG_ID, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_ID,
        entity: "products",
        fileName: "uji-hardening-impor.csv",
        status,
        totalRows: rows.length,
        mapping: MAPPING,
        createdBy: USER_ID,
      })
      .returning({ id: importJobs.id });
    jobId = job.id;
    if (rows.length > 0) {
      await tx.insert(importRows).values(
        rows.map((row) => ({
          companyId: ORG_ID,
          jobId: job.id,
          rowNumber: row.rowNumber,
          status: row.status ?? "pending",
          data: row.data,
        })),
      );
    }
  });
  createdJobIds.push(jobId);
  return jobId;
}

async function readJob(jobId: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    const rows = await tx
      .select()
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .orderBy(asc(importRows.rowNumber));
    return { job, rows };
  });
}

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    for (const productId of createdProductIds) {
      await tx.delete(products).where(eq(products.id, productId));
    }
    for (const jobId of createdJobIds) {
      await tx.delete(importRows).where(eq(importRows.jobId, jobId));
      await tx.delete(importJobs).where(eq(importJobs.id, jobId));
    }
  });
});

describe("GD-P2-8/P3 hardening impor", () => {
  const suffix = crypto.randomUUID().slice(0, 8);

  it("(a) cancel job yang belum ter-commit menandai batal tanpa menghapus baris", async () => {
    const jobId = await createJob([
      { rowNumber: 1, data: { Nama: "Batal Satu", SKU: `TST-HARD-${suffix}-C1` } },
      { rowNumber: 2, data: { Nama: "Batal Dua", SKU: `TST-HARD-${suffix}-C2` } },
    ]);

    const result = await cancelImportAction(jobId);
    expect(result.ok).toBe(true);

    const { job, rows } = await readJob(jobId);
    // Jejak audit tetap ada: job dan barisnya tidak dihapus dari database.
    expect(job).toBeDefined();
    expect(job?.status).toBe("cancelled");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "cancelled")).toBe(true);

    // Membatalkan dua kali ditolak.
    const again = await cancelImportAction(jobId);
    expect(again.ok).toBe(false);
  });

  it("(b) cancel job yang sudah ter-commit ditolak dengan ringkasan dampak", async () => {
    const jobId = await createJob([
      { rowNumber: 1, data: { Nama: "Sudah Masuk", SKU: `TST-HARD-${suffix}-K1`, "Harga Jual": "1000" } },
      { rowNumber: 2, data: { Nama: "Belum Masuk", SKU: `TST-HARD-${suffix}-K2`, "Harga Jual": "2000" } },
    ]);

    // Commit hanya baris pertama (limit 1): job tetap "preview" tetapi
    // sudah punya baris ter-commit — persis kasus berbahaya P2-8.
    const commit = await commitImportBatchAction({
      jobId,
      mapping: MAPPING,
      limit: 1,
      updateExisting: false,
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.data.imported).toBe(1);

    const before = await readJob(jobId);
    expect(before.job?.status).toBe("preview");
    expect(before.rows[0].status).toBe("imported");
    if (before.rows[0].entityId) createdProductIds.push(before.rows[0].entityId);

    const result = await cancelImportAction(jobId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ter-commit");
      expect(result.message).toContain("1 baris");
    }

    // Tidak ada yang terhapus/diubah oleh percobaan batal itu.
    const after = await readJob(jobId);
    expect(after.job?.status).toBe("preview");
    expect(after.rows).toHaveLength(2);
    expect(after.rows[0].status).toBe("imported");
  });

  it("(c) penyelesaian job berjalan lewat commit batch: baris pending menahan status preview, batch terakhir menandainya completed", async () => {
    // T5-2: finalizeImportAction dihapus (action yatim — tidak ada UI
    // yang memanggilnya). Kekhawatiran GD-P2-8 yang dulu dijaganya —
    // "selesai" tidak boleh mengubur baris pending — kini struktural:
    // satu-satunya jalan menuju status completed adalah
    // commitImportBatchAction, yang hanya menandainya ketika hitungan
    // baris pending mencapai nol. Test ini membuktikan persis itu.
    const jobId = await createJob([
      { rowNumber: 1, data: { Nama: "Tunda Satu", SKU: `TST-HARD-${suffix}-F1`, "Harga Jual": "1000" } },
      { rowNumber: 2, data: { Nama: "Tunda Dua", SKU: `TST-HARD-${suffix}-F2`, "Harga Jual": "2000" } },
    ]);

    // Batch pertama hanya memproses satu baris: satu baris pending
    // tersisa, jadi job TIDAK boleh berstatus completed.
    const first = await commitImportBatchAction({
      jobId,
      mapping: MAPPING,
      limit: 1,
      updateExisting: false,
      importStock: false,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.data.done).toBe(false);
      expect(first.data.remaining).toBe(1);
    }
    const midway = await readJob(jobId);
    expect(midway.job?.status).toBe("preview");
    expect(midway.rows[0].status).toBe("imported");
    if (midway.rows[0].entityId) createdProductIds.push(midway.rows[0].entityId);

    // Batch terakhir menghabiskan baris pending: job selesai di dalam
    // jalur batch yang sama.
    const last = await commitImportBatchAction({
      jobId,
      mapping: MAPPING,
      limit: 10,
      updateExisting: false,
      importStock: false,
    });
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.data.done).toBe(true);
    const done = await readJob(jobId);
    expect(done.job?.status).toBe("completed");
    expect(done.rows.every((row) => row.status === "imported")).toBe(true);
    for (const row of done.rows) {
      if (row.entityId) createdProductIds.push(row.entityId);
    }
  });

  it("(e) filter harga kosong/0 menangkap sel kosong DAN 0.000000", async () => {
    const jobId = await createJob([
      { rowNumber: 1, data: { Nama: "Harga Nol", SKU: `TST-HARD-${suffix}-Z1`, "Harga Beli": "0.000000", "Harga Jual": "5000" } },
      { rowNumber: 2, data: { Nama: "Harga Kosong", SKU: `TST-HARD-${suffix}-Z2`, "Harga Beli": "", "Harga Jual": "0.000000" } },
      { rowNumber: 3, data: { Nama: "Harga Isi", SKU: `TST-HARD-${suffix}-Z3`, "Harga Beli": "1000", "Harga Jual": "2000" } },
    ]);

    const analysis = await analyzeImportAction({ jobId, mapping: MAPPING });
    expect(analysis.ok).toBe(true);

    const cost = await listImportRowsAction({
      jobId,
      page: 1,
      pageSize: 10,
      filter: "cost_price_empty",
    });
    expect(cost.ok).toBe(true);
    if (cost.ok) {
      expect(cost.data.counts?.hargaBeliKosong).toBe(2);
      expect(cost.data.total).toBe(2);
      expect(cost.data.rows.map((row) => row.rowNumber)).toEqual([1, 2]);
    }

    const sale = await listImportRowsAction({
      jobId,
      page: 1,
      pageSize: 10,
      filter: "sale_price_empty",
    });
    expect(sale.ok).toBe(true);
    if (sale.ok) {
      expect(sale.data.counts?.hargaJualKosong).toBe(1);
      expect(sale.data.total).toBe(1);
      expect(sale.data.rows[0]?.rowNumber).toBe(2);
    }
  });

  it("(d) fallback SKU identik di analisis, daftar baris, dan commit", async () => {
    const jobId = await createJob([
      { rowNumber: 1, data: { Nama: "Produk Tanpa SKU", SKU: "", "Harga Jual": "5000", Stok: "0" } },
    ]);

    const analysis = await analyzeImportAction({ jobId, mapping: MAPPING });
    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.data.preview[0]?.sku).toBe("IMP-000001");
    }

    const list = await listImportRowsAction({ jobId, page: 1, pageSize: 10 });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.rows[0]?.preview?.sku).toBe("IMP-000001");
    }

    const commit = await commitImportBatchAction({
      jobId,
      mapping: MAPPING,
      limit: 10,
      updateExisting: false,
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.data.imported).toBe(1);

    const created = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx.select().from(products).where(eq(products.sku, "IMP-000001")),
    );
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe("Produk Tanpa SKU");
    createdProductIds.push(created[0].id);
  });

  it("(e) harga tak terbaca dan stok/minimum negatif menjadi error baris", () => {
    const badPrice = mapProductRow(
      { Nama: "Harga Aneh", SKU: "X-1", "Harga Jual": "abc" },
      MAPPING,
      "IMP-000001",
    );
    expect(badPrice.value).toBeUndefined();
    expect(badPrice.error).toContain("tidak terbaca");

    const negativeStock = mapProductRow(
      { Nama: "Stok Minus", SKU: "X-2", Stok: "-5" },
      MAPPING,
      "IMP-000002",
    );
    expect(negativeStock.value).toBeUndefined();
    expect(negativeStock.error).toContain("negatif");

    const negativeMin = mapProductRow(
      { Nama: "Minimum Minus", SKU: "X-3", "Stok Minimum": "-2" },
      MAPPING,
      "IMP-000003",
    );
    expect(negativeMin.value).toBeUndefined();
    expect(negativeMin.error).toContain("negatif");

    // Kontrol: harga negatif memang sudah error sejak sebelumnya.
    const negativePrice = mapProductRow(
      { Nama: "Harga Minus", SKU: "X-4", "Harga Beli": "-100" },
      MAPPING,
      "IMP-000004",
    );
    expect(negativePrice.value).toBeUndefined();
    expect(negativePrice.error).toContain("negatif");
  });

  it("(e2) analisis menyimpan stok negatif sebagai isu baris", async () => {
    const jobId = await createJob([
      { rowNumber: 1, data: { Nama: "Stok Negatif", SKU: `TST-HARD-${suffix}-N1`, Stok: "-3" } },
    ]);

    const analysis = await analyzeImportAction({ jobId, mapping: MAPPING });
    expect(analysis.ok).toBe(true);

    const { rows } = await readJob(jobId);
    expect(rows[0].error).toContain("negatif");
  });

  it("(f) skipImportRowsAction mengembalikan jumlah yang benar-benar ter-update", async () => {
    const jobId = await createJob([
      { rowNumber: 1, data: { Nama: "Lewat Satu", SKU: `TST-HARD-${suffix}-S1` } },
      { rowNumber: 2, data: { Nama: "Lewat Dua", SKU: `TST-HARD-${suffix}-S2` } },
      { rowNumber: 3, data: { Nama: "Lewat Tiga", SKU: `TST-HARD-${suffix}-S3` } },
    ]);

    // Baris 999 tidak ada — tidak boleh ikut terhitung.
    const first = await skipImportRowsAction({ jobId, rowNumbers: [1, 2, 999] });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.skipped).toBe(2);

    // Baris 1 sudah skipped — tidak terhitung lagi.
    const second = await skipImportRowsAction({ jobId, rowNumbers: [1] });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.skipped).toBe(0);
  });

  it("(g) rute parse membaca nilai mentah dan memperingatkan sheet lain", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Nama Barang", "Harga Jual"],
      ["Produk Akuntansi", -2500],
    ]);
    // Format akuntansi menampilkan angka negatif sebagai (2,500) — dengan
    // nilai terformat, sel ini terbaca sebagai teks "(2,500)".
    sheet["B2"].z = '_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)';
    XLSX.utils.book_append_sheet(workbook, sheet, "Data");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Lainnya"], [1]]), "Sheet Lain");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(buffer)], "uji-multi-sheet.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const response = await parseImportRoute(
      new Request("http://localhost/api/import/parse", { method: "POST", body: form }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      jobId: string;
      ignoredSheets?: string[];
    };
    createdJobIds.push(payload.jobId);

    expect(payload.ignoredSheets).toEqual(["Sheet Lain"]);

    const { rows } = await readJob(payload.jobId);
    expect(rows).toHaveLength(1);
    const data = rows[0].data as Record<string, unknown>;
    expect(data["Harga Jual"]).toBe("-2500");
  });
});
