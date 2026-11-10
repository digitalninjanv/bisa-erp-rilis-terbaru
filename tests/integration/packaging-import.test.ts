import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { importJobs, importRows, products } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import {
  findProductByAnyBarcode,
  listProductPackagings,
  syncProductPackagings,
} from "@/server/catalog/packaging";
import {
  applyBulkEditProducts,
  previewBulkEditProducts,
} from "@/server/master-data/bulk-edit";
import { listPurchaseRecommendations } from "@/server/purchasing";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

// Pola sesi tiruan yang sama dengan import-hardening.test.ts agar
// kode action asli berjalan terhadap database dev asli.
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

/**
 * Program Satuan Kemasan S6 — impor produk berkemasan ujung ke ujung:
 * commit menerapkan kemasan lewat domain yang sama dengan formulir
 * produk, konflik barcode kemasan menjadi error baris (produk tidak
 * lahir), pembaruan mencocokkan kemasan lewat nama, edit massal tidak
 * menyentuh kemasan, dan saran pesan-ulang membawa petunjuk Dus.
 */
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const rollbackTransaction = makeRollbackTransaction(ORG_ID);

const MAPPING = {
  name: "Nama Barang",
  sku: "Kode Barang",
  barcode: "Barcode",
  costPrice: "Harga Beli",
  salePrice: "Harga Jual",
  packagingNames: "Kemasan",
  packagingIsi: "Isi Kemasan",
  packagingBuyPrices: "Harga Beli Kemasan",
  packagingSalePrices: "Harga Jual Kemasan",
  packagingBarcodes: "Barcode Kemasan",
  packagingStatuses: "Status Kemasan",
  packagingDefaults: "Kemasan Bawaan",
};

const createdJobIds: string[] = [];
const createdProductIds: string[] = [];

async function createJob(rows: Record<string, unknown>[]): Promise<string> {
  let jobId = "";
  await withCompany(ORG_ID, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_ID,
        entity: "products",
        fileName: "uji-satuan-impor.csv",
        status: "preview",
        totalRows: rows.length,
        mapping: MAPPING,
        createdBy: USER_ID,
      })
      .returning({ id: importJobs.id });
    jobId = job.id;
    await tx.insert(importRows).values(
      rows.map((data, index) => ({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: index + 1,
        status: "pending",
        data,
      })),
    );
  });
  createdJobIds.push(jobId);
  return jobId;
}

async function readJob(jobId: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const rows = await tx
      .select()
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .orderBy(asc(importRows.rowNumber));
    return rows;
  });
}

async function findProductBySku(sku: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.sku, sku));
    return row ?? null;
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

describe("impor produk berkemasan (S6)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const skuBaru = `TST-KMS-${suffix}-A`;
  const barcodeDus = `8991${suffix.replace(/\D/g, "0").slice(0, 8)}`;

  it("commit produk baru menerapkan kemasan persis seperti formulir produk", async () => {
    const jobId = await createJob([
      {
        "Kode Barang": skuBaru,
        "Nama Barang": `Produk Impor Kemasan ${suffix}`,
        Barcode: `8990${suffix.replace(/\D/g, "0").slice(0, 8)}`,
        "Harga Beli": "3100",
        "Harga Jual": "3800",
        Kemasan: "Dus;Pak",
        "Isi Kemasan": "40;10",
        "Harga Beli Kemasan": "124000;32000",
        "Harga Jual Kemasan": "145000;36000",
        "Barcode Kemasan": `${barcodeDus};`,
        "Status Kemasan": "Aktif;Aktif",
        "Kemasan Bawaan": "Beli;Jual",
      },
    ]);

    const commit = await commitImportBatchAction({
      jobId,
      mapping: MAPPING,
      limit: 10,
      updateExisting: false,
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.data.imported).toBe(1);

    const product = await findProductBySku(skuBaru);
    expect(product).not.toBeNull();
    createdProductIds.push(product!.id);

    const packs = await withCompanyReadOnly(ORG_ID, (tx) =>
      listProductPackagings(tx, ORG_ID, product!.id),
    );
    expect(packs.map((pack) => pack.name)).toEqual(["Dus", "Pak"]);
    expect(packs[0]).toMatchObject({
      isi: "40.0000",
      buyPrice: "124000.0000",
      salePrice: "145000.0000",
      barcode: barcodeDus,
      isDefaultPurchase: true,
      isDefaultSale: false,
    });
    expect(packs[1]).toMatchObject({ isi: "10.0000", isDefaultSale: true });

    // Barcode kemasan langsung teresolusi untuk pindai (S2+).
    const resolved = await withCompanyReadOnly(ORG_ID, (tx) =>
      findProductByAnyBarcode(tx, ORG_ID, barcodeDus),
    );
    expect(resolved?.productId).toBe(product!.id);
    expect(resolved?.packaging?.name).toBe("Dus");
  });

  it("pembaruan lewat impor mencocokkan kemasan lewat nama & menghapus yang tak terpakai", async () => {
    const product = await findProductBySku(skuBaru);
    expect(product).not.toBeNull();
    const before = await withCompanyReadOnly(ORG_ID, (tx) =>
      listProductPackagings(tx, ORG_ID, product!.id),
    );
    const dusId = before.find((pack) => pack.name === "Dus")!.id;

    const jobId = await createJob([
      {
        "Kode Barang": skuBaru,
        "Nama Barang": `Produk Impor Kemasan ${suffix}`,
        "Harga Beli": "3100",
        "Harga Jual": "3900",
        Kemasan: "Dus",
        "Isi Kemasan": "48",
        "Harga Beli Kemasan": "148800",
        "Harga Jual Kemasan": "168000",
        "Barcode Kemasan": barcodeDus,
        "Status Kemasan": "Aktif",
        "Kemasan Bawaan": "Beli+Jual",
      },
    ]);
    const commit = await commitImportBatchAction({
      jobId,
      mapping: MAPPING,
      limit: 10,
      updateExisting: true,
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.data.imported).toBe(1);

    const after = await withCompanyReadOnly(ORG_ID, (tx) =>
      listProductPackagings(tx, ORG_ID, product!.id),
    );
    // Pak hilang (belum terpakai → hapus fisik sah), Dus tetap baris
    // yang sama dengan isi baru — histori cuplikan tidak tersentuh.
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(dusId);
    expect(after[0].isi).toBe("48.0000");
    expect(after[0].salePrice).toBe("168000.0000");
    expect(after[0].isDefaultSale).toBe(true);
  });

  it("barcode kemasan bertabrakan barcode kemasan produk lain → error baris, produk tidak lahir", async () => {
    const skuKorban = `TST-KMS-${suffix}-B`;
    // Barcode kemasan Dus produk A di atas dipakai ulang di sini.
    const jobId2 = await createJob([
      {
        "Kode Barang": skuKorban,
        "Nama Barang": `Produk Konflik ${suffix}`,
        "Harga Beli": "1000",
        "Harga Jual": "1500",
        Kemasan: "Dus",
        "Isi Kemasan": "40",
        "Barcode Kemasan": barcodeDus,
      },
    ]);

    const analysis = await analyzeImportAction({ jobId: jobId2, mapping: MAPPING });
    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      const preview = (analysis.data as { preview: { issue: string | null }[] }).preview;
      expect(preview[0]?.issue).toContain("sudah dipakai");
    }

    const commit = await commitImportBatchAction({
      jobId: jobId2,
      mapping: MAPPING,
      limit: 10,
      updateExisting: false,
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (commit.ok) {
      expect(commit.data.imported).toBe(0);
      expect(commit.data.failed).toBe(1);
    }
    const rows = await readJob(jobId2);
    expect(rows[0].status).toBe("error");
    expect(rows[0].error).toContain("sudah dipakai");
    expect(await findProductBySku(skuKorban)).toBeNull();
  });

  it("isi kemasan tidak sah (pecahan) menjadi error baris dari mapper", async () => {
    const jobId = await createJob([
      {
        "Kode Barang": `TST-KMS-${suffix}-C`,
        "Nama Barang": `Produk Isi Pecahan ${suffix}`,
        "Harga Beli": "1000",
        "Harga Jual": "1500",
        Kemasan: "Dus",
        "Isi Kemasan": "2.5",
      },
    ]);
    const commit = await commitImportBatchAction({
      jobId,
      mapping: MAPPING,
      limit: 10,
      updateExisting: false,
      importStock: false,
    });
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.data.failed).toBe(1);
    expect(await findProductBySku(`TST-KMS-${suffix}-C`)).toBeNull();
  });
});

describe("aturan kemasan pada edit massal & saran pesan (S6)", () => {
  async function makePackagedProduct(tx: Tx) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [product] = await tx
      .insert(products)
      .values({
        companyId: ORG_ID,
        sku: `TST-KMS-BULK-${suffix}`,
        name: `Produk Massal Kemasan ${suffix}`,
        costPrice: "3100",
        salePrice: "3800",
        minStock: "100",
        trackStock: true,
      })
      .returning({ id: products.id });
    await syncProductPackagings(
      tx,
      ORG_ID,
      product.id,
      [
        {
          name: "Dus",
          isi: "40",
          buyPrice: "124000",
          salePrice: "145000",
          barcode: null,
          isDefaultPurchase: true,
          isDefaultSale: true,
          isActive: true,
        },
      ],
      { priceGateSatisfied: true },
    );
    return product;
  }

  it("pratinjau edit massal menyatakan kemasan tidak ikut berubah; penerapan membuktikannya", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makePackagedProduct(tx);
      const preview = await previewBulkEditProducts(tx, {
        companyId: ORG_ID,
        warehouseId: "01900000-0000-7000-8000-0000000000ff",
        selection: { mode: "ids", ids: [product.id] },
        operation: { kind: "price", target: "salePrice", mode: "percent", value: "10" },
      });
      expect(preview.packagingNote).toContain("kemasan TIDAK ikut berubah");

      const applied = await applyBulkEditProducts(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: "01900000-0000-7000-8000-0000000000ff",
        selection: { mode: "ids", ids: [product.id] },
        operation: { kind: "price", target: "salePrice", mode: "percent", value: "10" },
      });
      expect(applied.applied).toHaveLength(1);

      const [after] = await tx
        .select({ salePrice: products.salePrice })
        .from(products)
        .where(eq(products.id, product.id));
      expect(after.salePrice).toBe("4180.0000");
      const packs = await listProductPackagings(tx, ORG_ID, product.id);
      expect(packs[0].salePrice).toBe("145000.0000");
      expect(packs[0].isi).toBe("40.0000");
    });
  });

  it("saran pesan-ulang membawa petunjuk ≈ X Dus dari kemasan bawaan beli", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makePackagedProduct(tx);
      const rows = await listPurchaseRecommendations(tx, ORG_ID);
      const row = rows.find((item) => item.productId === product.id);
      // Stok 0, minimum 100 → saran 200 pcs → 5 Dus isi 40.
      expect(row).toBeDefined();
      expect(row!.suggestedQty).toBe("200.0000");
      expect(row!.suggestedPackaging).toBe("≈ 5 Dus");
    });
  });
});
