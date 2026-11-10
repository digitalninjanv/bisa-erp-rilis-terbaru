import { describe, expect, it } from "vitest";
import { products } from "@/db/schema";
import {
  assertBarcodeAvailable,
  findProductByAnyBarcode,
  listProductPackagings,
  syncProductPackagings,
} from "@/server/catalog/packaging";
import { AppError } from "@/lib/errors";
import type { PackagingInput } from "@/lib/packaging";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * Program Satuan Kemasan S1 — penjaga di level database untuk domain
 * server/catalog/packaging: sinkronisasi master, keunikan barcode
 * LINTAS produk & kemasan (satu ruang nama pindai), resolusi barcode,
 * dan gerbang izin harga kemasan. Semua dalam transaksi rollback di
 * perusahaan demo; aturan rencana murninya teruji di
 * tests/unit/packaging.test.ts.
 */
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const rollbackTransaction = makeRollbackTransaction(ORG_ID);

function packagingRow(overrides: Partial<PackagingInput> = {}): PackagingInput {
  return {
    name: "Dus",
    isi: "40",
    buyPrice: "124000",
    salePrice: "145000",
    barcode: null,
    isDefaultPurchase: true,
    isDefaultSale: false,
    isActive: true,
    ...overrides,
  };
}

async function makeProduct(tx: Tx, overrides: { barcode?: string | null } = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-PKG-${suffix}`,
      name: `Produk Uji Kemasan ${suffix}`,
      barcode: overrides.barcode ?? null,
      costPrice: "3100",
      salePrice: "3800",
      trackStock: true,
    })
    .returning({ id: products.id });
  return product;
}

describe("syncProductPackagings", () => {
  it("membuat kemasan dan membacanya kembali terurut dengan bendera bawaan", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx);
      const result = await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [
          packagingRow(),
          packagingRow({ name: "Pak", isi: "10", isDefaultPurchase: false, isDefaultSale: true }),
        ],
        { priceGateSatisfied: true },
      );
      expect(result).toEqual({ created: 2, updated: 0, deleted: 0 });

      const rows = await listProductPackagings(tx, ORG_ID, product.id);
      expect(rows.map((r) => r.name)).toEqual(["Dus", "Pak"]);
      expect(rows[0].isi).toBe("40.0000");
      expect(rows[0].isDefaultPurchase).toBe(true);
      expect(rows[1].isDefaultSale).toBe(true);
    });
  });

  it("produk tanpa kemasan tetap kosong — perilaku lama tidak berubah", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx);
      expect(await listProductPackagings(tx, ORG_ID, product.id)).toEqual([]);
    });
  });

  it("kemasan belum terpakai dapat dihapus; yang tersimpan dapat dinonaktifkan", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx);
      await syncProductPackagings(tx, ORG_ID, product.id, [packagingRow()], {
        priceGateSatisfied: true,
      });
      const [created] = await listProductPackagings(tx, ORG_ID, product.id);

      const off = await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [{ ...packagingRow(), id: created.id, isActive: false }],
        { priceGateSatisfied: true },
      );
      expect(off.updated).toBe(1);
      expect((await listProductPackagings(tx, ORG_ID, product.id))[0].isActive).toBe(false);

      const gone = await syncProductPackagings(tx, ORG_ID, product.id, [], {
        priceGateSatisfied: true,
      });
      expect(gone.deleted).toBe(1);
      expect(await listProductPackagings(tx, ORG_ID, product.id)).toEqual([]);
    });
  });

  it("perubahan harga kemasan tersimpan wajib izin harga (gerbang GDG3-11)", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx);
      await syncProductPackagings(tx, ORG_ID, product.id, [packagingRow()], {
        priceGateSatisfied: false, // harga awal produk baru tidak digerbang
      });
      const [created] = await listProductPackagings(tx, ORG_ID, product.id);

      await expect(
        syncProductPackagings(
          tx,
          ORG_ID,
          product.id,
          [{ ...packagingRow(), id: created.id, salePrice: "150000" }],
          { priceGateSatisfied: false },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // Perubahan non-harga tetap boleh tanpa izin harga:
      const renamed = await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [{ ...packagingRow(), id: created.id, name: "Karton" }],
        { priceGateSatisfied: false },
      );
      expect(renamed.updated).toBe(1);
    });
  });
});

describe("keunikan barcode lintas produk & kemasan", () => {
  it("barcode kemasan tidak boleh menabrak barcode dasar produk lain", async () => {
    await rollbackTransaction(async (tx) => {
      const other = await makeProduct(tx, { barcode: "8997000000011" });
      void other;
      const product = await makeProduct(tx);
      await expect(
        syncProductPackagings(
          tx,
          ORG_ID,
          product.id,
          [packagingRow({ barcode: "8997000000011" })],
          { priceGateSatisfied: true },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("barcode kemasan tidak boleh menabrak kemasan produk lain; barcode dasar produk juga dijaga dari kemasan", async () => {
    await rollbackTransaction(async (tx) => {
      const first = await makeProduct(tx);
      await syncProductPackagings(
        tx,
        ORG_ID,
        first.id,
        [packagingRow({ barcode: "8997000000028" })],
        { priceGateSatisfied: true },
      );

      const second = await makeProduct(tx);
      await expect(
        syncProductPackagings(
          tx,
          ORG_ID,
          second.id,
          [packagingRow({ barcode: "8997000000028" })],
          { priceGateSatisfied: true },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // Arah sebaliknya (jalur simpan barcode dasar produk):
      await expect(
        assertBarcodeAvailable(tx, ORG_ID, "8997000000028", { productId: second.id }),
      ).rejects.toBeInstanceOf(AppError);

      // Barcode yang sama pada kemasan yang sama (ubah field lain) sah:
      const [created] = await listProductPackagings(tx, ORG_ID, first.id);
      const ok = await syncProductPackagings(
        tx,
        ORG_ID,
        first.id,
        [{ ...packagingRow({ barcode: "8997000000028" }), id: created.id, isi: "48" }],
        { priceGateSatisfied: true },
      );
      expect(ok.updated).toBe(1);
    });
  });
});

describe("findProductByAnyBarcode", () => {
  it("barcode dasar → kemasan null; barcode kemasan → teresolusi; nonaktif & tak dikenal → null", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, { barcode: "8997000000035" });
      await syncProductPackagings(
        tx,
        ORG_ID,
        product.id,
        [
          packagingRow({ barcode: "8997000000042" }),
          packagingRow({ name: "Pak", isi: "10", barcode: "8997000000059", isActive: false }),
        ],
        { priceGateSatisfied: true },
      );

      const base = await findProductByAnyBarcode(tx, ORG_ID, "8997000000035");
      expect(base?.productId).toBe(product.id);
      expect(base?.packaging).toBeNull();

      const dus = await findProductByAnyBarcode(tx, ORG_ID, "8997000000042");
      expect(dus?.productId).toBe(product.id);
      expect(dus?.packaging?.name).toBe("Dus");
      expect(dus?.packaging?.isi).toBe("40.0000");

      expect(await findProductByAnyBarcode(tx, ORG_ID, "8997000000059")).toBeNull();
      expect(await findProductByAnyBarcode(tx, ORG_ID, "0000000000000")).toBeNull();
    });
  });
});
