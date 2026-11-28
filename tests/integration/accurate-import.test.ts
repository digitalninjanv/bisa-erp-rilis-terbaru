import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  fiscalPeriods,
  importJobs,
  importRows,
  productPackagings,
  products,
  stockMovements,
  stockReceipts,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { commitOpeningStockImport } from "@/server/import-masters";
import { suggestMapping } from "@/lib/import-parse";
import { rollbackTransaction } from "../helpers/rollback-transaction";

// Sesi & cache Next diganti; kode action asli berjalan terhadap DB dev.
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

const ACCURATE_HEADERS = [
  "Kode Barang",
  "Nama Barang",
  "Satuan",
  "Harga Beli",
  "UPC/Barcode",
  "Pemasok Utama",
  "Batas Minimum Stok",
  "Kuantitas Saldo Awal",
  "Harga dari rincian grup",
  "Def. Hrg. Jual Satuan #1",
  "Jenis Barang",
  "Non Aktif",
  "Menggunakan No. Seri",
  "Pakai tanggal kadaluarsa",
  "Satuan #2",
  "Rasio Satuan #2",
  "Def. Hrg. Jual Satuan #2",
  "Satuan Beli",
];

const createdJobIds: string[] = [];
const createdProductIds: string[] = [];

async function createJob(rows: { rowNumber: number; data: Record<string, unknown> }[]) {
  const mapping = suggestMapping(ACCURATE_HEADERS);
  let jobId = "";
  await withCompany(ORG_ID, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_ID,
        entity: "products",
        fileName: "accurate-integration.xlsx",
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
        jobId,
        rowNumber: row.rowNumber,
        status: "pending",
        data: row.data,
      })),
    );
  });
  createdJobIds.push(jobId);
  return jobId;
}

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    for (const productId of createdProductIds) {
      await tx.delete(productPackagings).where(eq(productPackagings.productId, productId));
      await tx.delete(products).where(eq(products.id, productId));
    }
    for (const jobId of createdJobIds) {
      await tx.delete(importRows).where(eq(importRows.jobId, jobId));
      await tx.delete(importJobs).where(eq(importJobs.id, jobId));
    }
  });
});

describe("impor produk ekspor Accurate (end-to-end domain)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const sku = `ACC-TST-${suffix}`;

  it("menyimpan harga, stok, atribut, dan kemasan multi-satuan", async () => {
    const jobId = await createJob([
      {
        rowNumber: 1,
        data: {
          "Kode Barang": sku,
          "Nama Barang": "Produk Uji Accurate",
          Satuan: "PCS",
          "Harga Beli": "1900.000000",
          "UPC/Barcode": `899${suffix.replace(/\D/g, "").padEnd(10, "0")}`,
          "Batas Minimum Stok": "5.000000",
          "Kuantitas Saldo Awal": "24.000000",
          "Harga dari rincian grup": "TIDAK",
          "Def. Hrg. Jual Satuan #1": "2500.000000",
          "Jenis Barang": "INV",
          "Non Aktif": "TIDAK",
          "Menggunakan No. Seri": "TIDAK",
          "Pakai tanggal kadaluarsa": "TIDAK",
          "Satuan #2": "Renceng",
          "Rasio Satuan #2": "10.000000",
          "Def. Hrg. Jual Satuan #2": "19000.000000",
          "Satuan Beli": "Renceng",
        },
      },
    ]);

    const commit = await commitImportBatchAction({
      jobId,
      mapping: suggestMapping(ACCURATE_HEADERS),
      limit: 10,
      updateExisting: false,
      // Fokus atribut & kemasan; stok diuji terpisah di tab Stok Awal.
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.data.imported).toBe(1);

    const [product] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(products).where(eq(products.sku, sku)).limit(1),
    );
    expect(product).toBeDefined();
    if (!product) return;
    createdProductIds.push(product.id);

    expect(product).toMatchObject({
      name: "Produk Uji Accurate",
      costPrice: "1900.0000",
      salePrice: "2500.0000",
      minStock: "5.0000",
      trackStock: true,
      trackSerial: false,
      trackBatch: false,
      isActive: true,
    });

    const packs = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select()
        .from(productPackagings)
        .where(eq(productPackagings.productId, product.id)),
    );
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      name: "Renceng",
      isi: "10.0000",
      salePrice: "19000.0000",
      isDefaultPurchase: true,
      isDefaultSale: false,
      isActive: true,
    });
  });

  it("stok awal memakai tanggal cut-off dan gudang dari baris Accurate", async () => {
    await rollbackTransaction(ORG_ID, async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      expect(warehouse).toBeDefined();
      if (!warehouse) return;

      // Pakai periode yang benar-benar terbuka di DB dev; periode tutup
      // akan ditolak postJournal (dan itu bukan yang diuji di sini).
      const [openPeriod] = await tx
        .select()
        .from(fiscalPeriods)
        .where(and(eq(fiscalPeriods.companyId, ORG_ID), eq(fiscalPeriods.status, "open")))
        .limit(1);
      expect(openPeriod).toBeDefined();
      if (!openPeriod) return;
      const rowDate = `${openPeriod.year}-${String(openPeriod.month).padStart(2, "0")}-15`;

      const sku = `ACC-OPEN-${crypto.randomUUID().slice(0, 8)}`;
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku,
          name: "Produk Stok Awal Accurate",
          costPrice: "5795",
          salePrice: "7000",
          trackStock: true,
        })
        .returning({ id: products.id });

      const [job] = await tx
        .insert(importJobs)
        .values({
          companyId: ORG_ID,
          entity: "opening_stock",
          fileName: "saldo-awal-accurate.xlsx",
          status: "preview",
          totalRows: 1,
          createdBy: USER_ID,
        })
        .returning();
      await tx.insert(importRows).values({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: 1,
        status: "pending",
        data: {
          "Kode Barang": sku,
          "Nama Barang": "Produk Stok Awal Accurate",
          "Gudang Saldo Awal": warehouse.name,
          "Kuantitas Saldo Awal": "24.000000",
          "Nilai Satuan": "5795.000000",
          "Per Tanggal": rowDate,
        },
      });

      const result = await commitOpeningStockImport(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        job,
        mapping: {
          sku: "Kode Barang",
          name: "Nama Barang",
          warehouse: "Gudang Saldo Awal",
          qty: "Kuantitas Saldo Awal",
          unitCost: "Nilai Satuan",
          date: "Per Tanggal",
        },
        warehouseId: warehouse.id,
        // Tanggal wizard berbeda dari baris: baris harus menang.
        date: "2000-01-01",
      });
      expect(result.imported).toBe(1);

      const [receipt] = await tx
        .select()
        .from(stockReceipts)
        .where(
          and(
            eq(stockReceipts.companyId, ORG_ID),
            eq(stockReceipts.number, result.receiptNumber ?? ""),
          ),
        );
      expect(receipt).toBeDefined();
      expect(receipt?.date).toBe(rowDate);
      expect(receipt?.warehouseId).toBe(warehouse.id);

      const [movement] = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.productId, product.id),
          ),
        )
        .limit(1);
      expect(movement).toBeDefined();
      expect(movement?.date).toBe(rowDate);
      expect(movement?.qty).toBe("24.0000");
    });
  });

  it("produk Jasa + nonaktif tidak dipaksa menjadi stok aktif", async () => {
    const serviceSku = `ACC-SVC-${suffix}`;
    const jobId = await createJob([
      {
        rowNumber: 1,
        data: {
          "Kode Barang": serviceSku,
          "Nama Barang": "Jasa Uji Accurate",
          Satuan: "Jasa",
          "Harga Beli": "0",
          "Def. Hrg. Jual Satuan #1": "50000",
          "Jenis Barang": "Jasa",
          "Non Aktif": "YA",
          "Menggunakan No. Seri": "TIDAK",
          "Pakai tanggal kadaluarsa": "TIDAK",
        },
      },
    ]);

    const commit = await commitImportBatchAction({
      jobId,
      mapping: suggestMapping(ACCURATE_HEADERS),
      limit: 10,
      updateExisting: false,
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.data.imported).toBe(1);

    const [product] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(products).where(eq(products.sku, serviceSku)).limit(1),
    );
    expect(product).toBeDefined();
    if (!product) return;
    createdProductIds.push(product.id);
    expect(product).toMatchObject({
      trackStock: false,
      isActive: false,
      trackSerial: false,
      trackBatch: false,
    });
  });
});
