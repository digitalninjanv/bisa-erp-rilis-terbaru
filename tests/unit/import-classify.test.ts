import { describe, expect, it } from "vitest";
import {
  classifyProductImportRows,
  countProductImportRows,
  productCatalogLookupKeys,
  productRowMatchesFilter,
  type ClassifiableProductRow,
  type ProductCatalogIndex,
} from "@/lib/import-classify";
import type { MappedProduct } from "@/lib/import-parse";

function value(partial: Partial<MappedProduct>): MappedProduct {
  return {
    sku: "SKU-1",
    name: "Produk Uji",
    barcode: null,
    category: null,
    unit: "PCS",
    supplier: null,
    costPrice: 1000,
    salePrice: 2000,
    minStock: 0,
    stock: 0,
    notes: null,
    trackStock: true,
    isActive: true,
    trackSerial: false,
    trackBatch: false,
    packagings: [],
    ...partial,
  };
}

function row(partial: Partial<ClassifiableProductRow> & { rowNumber: number }): ClassifiableProductRow {
  // Barcode default unik per baris agar tes duplikat tidak saling
  // mencemari; tes yang memang menguji barcode kosong/konflik meng-
  // override `mapped`/`barcodeRaw`.
  const defaultBarcode = `899${String(partial.rowNumber).padStart(10, "0")}`;
  return {
    status: "pending",
    storedIssue: null,
    mapped: { value: value({ sku: `SKU-${partial.rowNumber}`, barcode: defaultBarcode }) },
    rawSku: `SKU-${partial.rowNumber}`,
    barcodeRaw: defaultBarcode,
    salePriceEmpty: false,
    costPriceEmpty: false,
    salePriceZero: false,
    costPriceZero: false,
    ...partial,
  };
}

const EMPTY_CATALOG: ProductCatalogIndex = {
  skuKeys: new Set<string>(),
  barcodeToSkuKey: new Map<string, string>(),
};

describe("kunci lookup katalog impor", () => {
  it("menghasilkan SKU efektif dan barcode unik sesuai pemetaan/fallback", () => {
    const keys = productCatalogLookupKeys([
      row({
        rowNumber: 1,
        rawSku: "SKU-1",
        mapped: { value: value({ sku: "SKU-1", barcode: "8990001" }) },
        barcodeRaw: "8990001",
      }),
      row({
        rowNumber: 2,
        rawSku: "SKU-1",
        mapped: { value: value({ sku: "SKU-1", barcode: "8990001" }) },
        barcodeRaw: "8990001",
      }),
      row({
        rowNumber: 3,
        rawSku: "RAW-3",
        mapped: { error: "Harga jual tidak terbaca" },
        barcodeRaw: "8990003",
      }),
      row({
        rowNumber: 4,
        rawSku: "",
        mapped: { error: "Nama barang kosong" },
        barcodeRaw: "",
      }),
    ]);

    expect(keys).toEqual({
      skuKeys: ["sku-1", "raw-3", "imp-000004"],
      barcodes: ["8990001", "8990003"],
    });
  });
});

describe("klasifikasi baris impor produk (A-10/D-21)", () => {
  it("barcode kosong adalah bendera informatif, tetapi belum lengkap", () => {
    const flags = classifyProductImportRows(
      [
        row({
          rowNumber: 1,
          barcodeRaw: "",
          mapped: { value: value({ sku: "SKU-1", barcode: null }) },
        }),
      ],
      EMPTY_CATALOG,
    ).get(1)!;
    expect(flags.barcodeKosong).toBe(true);
    expect(flags.bermasalah).toBe(false);
    expect(flags.siap).toBe(true);
    expect(flags.lengkap).toBe(false);
    expect(flags.belumLengkap).toBe(true);
  });

  it("harga jual/beli kosong bukan masalah, tetapi belum lengkap", () => {
    const flags = classifyProductImportRows(
      [
        row({
          rowNumber: 1,
          salePriceEmpty: true,
          costPriceEmpty: true,
          mapped: { value: value({ sku: "SKU-1", salePrice: 0, costPrice: 0 }) },
        }),
      ],
      EMPTY_CATALOG,
    ).get(1)!;
    expect(flags.hargaJualKosong).toBe(true);
    expect(flags.hargaBeliKosong).toBe(true);
    expect(flags.bermasalah).toBe(false);
    expect(flags.siap).toBe(true);
    expect(flags.lengkap).toBe(false);
    expect(flags.belumLengkap).toBe(true);
  });

  it("harga 0 (termasuk 0.000000 Accurate) masuk filter kosong/0", () => {
    const rows = [
      row({
        rowNumber: 1,
        mapped: { value: value({ sku: "NOL-1", costPrice: 0, salePrice: 0 }) },
        salePriceZero: true,
        costPriceZero: true,
      }),
      row({
        rowNumber: 2,
        mapped: { value: value({ sku: "ISI-2", costPrice: 1000, salePrice: 2000 }) },
      }),
    ];
    const flags = classifyProductImportRows(rows, EMPTY_CATALOG);
    expect(flags.get(1)!.hargaJualKosong).toBe(true);
    expect(flags.get(1)!.hargaBeliKosong).toBe(true);
    expect(flags.get(1)!.bermasalah).toBe(false);
    expect(flags.get(2)!.hargaJualKosong).toBe(false);
    expect(flags.get(2)!.hargaBeliKosong).toBe(false);
    expect(productRowMatchesFilter(flags.get(1)!, "sale_price_empty")).toBe(true);
    expect(productRowMatchesFilter(flags.get(1)!, "cost_price_empty")).toBe(true);
    expect(productRowMatchesFilter(flags.get(2)!, "sale_price_empty")).toBe(false);
  });

  it("duplikat SKU dalam berkas menandai semua anggota kelompok; hanya baris berikutnya yang bermasalah", () => {
    const rows = [
      row({ rowNumber: 1, rawSku: "DUP-1", mapped: { value: value({ sku: "DUP-1" }) } }),
      row({ rowNumber: 2, rawSku: "DUP-1", mapped: { value: value({ sku: "DUP-1" }) } }),
      row({ rowNumber: 3 }),
    ];
    const flags = classifyProductImportRows(rows, EMPTY_CATALOG);
    expect(flags.get(1)!.duplikatDalamBerkas).toBe(true);
    expect(flags.get(2)!.duplikatDalamBerkas).toBe(true);
    expect(flags.get(3)!.duplikatDalamBerkas).toBe(false);
    expect(flags.get(1)!.bermasalah).toBe(false);
    expect(flags.get(2)!.bermasalah).toBe(true);
    expect(flags.get(2)!.siap).toBe(false);
  });

  it("duplikat barcode dalam berkas (SKU berbeda) menandai kelompoknya; baris berikutnya bermasalah", () => {
    const rows = [
      row({ rowNumber: 1, barcodeRaw: "8990001", mapped: { value: value({ sku: "A-1", barcode: "8990001" }) } }),
      row({ rowNumber: 2, barcodeRaw: "8990001", mapped: { value: value({ sku: "A-2", barcode: "8990001" }) } }),
    ];
    const flags = classifyProductImportRows(rows, EMPTY_CATALOG);
    expect(flags.get(1)!.duplikatDalamBerkas).toBe(true);
    expect(flags.get(2)!.duplikatDalamBerkas).toBe(true);
    expect(flags.get(1)!.bermasalah).toBe(false);
    expect(flags.get(2)!.bermasalah).toBe(true);
  });

  it("SKU yang sudah ada di katalog adalah duplikat katalog informatif, bukan masalah", () => {
    const catalog: ProductCatalogIndex = {
      skuKeys: new Set(["sku-1"]),
      barcodeToSkuKey: new Map(),
    };
    const flags = classifyProductImportRows(
      [row({ rowNumber: 1, rawSku: "SKU-1", mapped: { value: value({ sku: "SKU-1" }) } })],
      catalog,
    ).get(1)!;
    expect(flags.duplikatKatalog).toBe(true);
    expect(flags.bermasalah).toBe(false);
    expect(flags.siap).toBe(true);
  });

  it("barcode milik produk katalog lain adalah konflik: duplikat katalog dan bermasalah", () => {
    const catalog: ProductCatalogIndex = {
      skuKeys: new Set(["pemilik-lama"]),
      barcodeToSkuKey: new Map([["8999999", "pemilik-lama"]]),
    };
    const flags = classifyProductImportRows(
      [row({ rowNumber: 1, barcodeRaw: "8999999", mapped: { value: value({ sku: "BARU-1", barcode: "8999999" }) } })],
      catalog,
    ).get(1)!;
    expect(flags.duplikatKatalog).toBe(true);
    expect(flags.bermasalah).toBe(true);
    expect(flags.siap).toBe(false);
  });

  it("barcode milik SKU yang sama di katalog bukan konflik", () => {
    const catalog: ProductCatalogIndex = {
      skuKeys: new Set(["sku-1"]),
      barcodeToSkuKey: new Map([["8990001", "sku-1"]]),
    };
    const flags = classifyProductImportRows(
      [row({ rowNumber: 1, rawSku: "SKU-1", barcodeRaw: "8990001", mapped: { value: value({ sku: "SKU-1", barcode: "8990001" }) } })],
      catalog,
    ).get(1)!;
    expect(flags.duplikatKatalog).toBe(true);
    expect(flags.bermasalah).toBe(false);
  });

  it("baris yang gagal dipetakan dan baris berstatus error adalah bermasalah", () => {
    const rows = [
      row({ rowNumber: 1, mapped: { error: "Harga jual tidak terbaca: \"hubungi kami\"" } }),
      row({ rowNumber: 2, status: "error", storedIssue: "SKU duplikat di file" }),
      row({ rowNumber: 3, status: "imported", storedIssue: "Diperbarui" }),
    ];
    const flags = classifyProductImportRows(rows, EMPTY_CATALOG);
    expect(flags.get(1)!.bermasalah).toBe(true);
    expect(flags.get(2)!.bermasalah).toBe(true);
    expect(flags.get(3)!.bermasalah).toBe(false);
    expect(flags.get(3)!.siap).toBe(false);
  });

  it("isu tersimpan pada baris pending membuat baris bermasalah walau data kini terbaca", () => {
    const flags = classifyProductImportRows(
      [row({ rowNumber: 1, storedIssue: "SKU duplikat di file (baris pertama dipakai)" })],
      EMPTY_CATALOG,
    ).get(1)!;
    expect(flags.bermasalah).toBe(true);
  });

  it("edit yang mengganti barcode membersihkan konflik pada klasifikasi ulang", () => {
    const catalog: ProductCatalogIndex = {
      skuKeys: new Set(["pemilik-lama"]),
      barcodeToSkuKey: new Map([["8999999", "pemilik-lama"]]),
    };
    const before = classifyProductImportRows(
      [row({ rowNumber: 1, barcodeRaw: "8999999", mapped: { value: value({ sku: "BARU-1", barcode: "8999999" }) } })],
      catalog,
    ).get(1)!;
    expect(before.bermasalah).toBe(true);

    const after = classifyProductImportRows(
      [row({ rowNumber: 1, barcodeRaw: "8995555", mapped: { value: value({ sku: "BARU-1", barcode: "8995555" }) } })],
      catalog,
    ).get(1)!;
    expect(after.duplikatKatalog).toBe(false);
    expect(after.bermasalah).toBe(false);
    expect(after.siap).toBe(true);
  });

  it("edit yang menyamakan barcode menimbulkan duplikat di kedua baris", () => {
    const base = [
      row({ rowNumber: 1, barcodeRaw: "111", mapped: { value: value({ sku: "A-1", barcode: "111" }) } }),
      row({ rowNumber: 2, barcodeRaw: "222", mapped: { value: value({ sku: "A-2", barcode: "222" }) } }),
    ];
    const clean = classifyProductImportRows(base, EMPTY_CATALOG);
    expect(clean.get(1)!.duplikatDalamBerkas).toBe(false);
    expect(clean.get(2)!.duplikatDalamBerkas).toBe(false);

    const edited = [
      base[0],
      row({ rowNumber: 2, barcodeRaw: "111", mapped: { value: value({ sku: "A-2", barcode: "111" }) } }),
    ];
    const flags = classifyProductImportRows(edited, EMPTY_CATALOG);
    expect(flags.get(1)!.duplikatDalamBerkas).toBe(true);
    expect(flags.get(2)!.duplikatDalamBerkas).toBe(true);
    expect(flags.get(2)!.bermasalah).toBe(true);
  });

  it("barcode milik baris duplikat SKU tidak mencemari baris berikutnya (selaras commit)", () => {
    // Baris 2 duplikat SKU dari baris 1 — ia tidak akan pernah terimpor,
    // jadi barcode-nya tidak boleh membuat baris 3 bermasalah.
    const rows = [
      row({ rowNumber: 1, rawSku: "A-1", barcodeRaw: "111", mapped: { value: value({ sku: "A-1", barcode: "111" }) } }),
      row({ rowNumber: 2, rawSku: "A-1", barcodeRaw: "222", mapped: { value: value({ sku: "A-1", barcode: "222" }) } }),
      row({ rowNumber: 3, rawSku: "B-1", barcodeRaw: "222", mapped: { value: value({ sku: "B-1", barcode: "222" }) } }),
    ];
    const flags = classifyProductImportRows(rows, EMPTY_CATALOG);
    expect(flags.get(2)!.bermasalah).toBe(true);
    expect(flags.get(3)!.duplikatDalamBerkas).toBe(false);
    expect(flags.get(3)!.bermasalah).toBe(false);
    expect(flags.get(3)!.siap).toBe(true);
  });

  it("hitungan kategori mencakup seluruh baris", () => {
    const rows = [
      row({ rowNumber: 1 }),
      row({
        rowNumber: 2,
        salePriceEmpty: true,
        mapped: { value: value({ sku: "SKU-2", salePrice: 0 }) },
      }),
      row({ rowNumber: 3, costPriceEmpty: true, mapped: { error: "Nama barang kosong" } }),
      row({ rowNumber: 4, rawSku: "LAMA-1", mapped: { value: value({ sku: "LAMA-1" }) } }),
    ];
    const catalog: ProductCatalogIndex = { skuKeys: new Set(["lama-1"]), barcodeToSkuKey: new Map() };
    const classified = classifyProductImportRows(rows, catalog);
    const counts = countProductImportRows(rows, classified);
    expect(counts.total).toBe(4);
    expect(counts.barcodeKosong).toBe(2);
    expect(counts.hargaJualKosong).toBe(1);
    expect(counts.hargaBeliKosong).toBe(1);
    expect(counts.duplikat).toBe(1);
    expect(counts.bermasalah).toBe(1);
    expect(counts.siap).toBe(3);
    expect(counts.lengkap).toBe(1);
    expect(counts.belumLengkap).toBe(2);
  });

  it("pencocokan filter mengikuti bendera baris", () => {
    const rows = [
      row({ rowNumber: 1 }),
      row({
        rowNumber: 2,
        salePriceEmpty: true,
        mapped: { value: value({ sku: "SKU-2", salePrice: 0 }) },
      }),
      row({ rowNumber: 3, mapped: { error: "Nama barang kosong" } }),
    ];
    const classified = classifyProductImportRows(rows, EMPTY_CATALOG);
    const f1 = classified.get(1)!;
    const f2 = classified.get(2)!;
    const f3 = classified.get(3)!;
    expect(productRowMatchesFilter(f1, "all")).toBe(true);
    expect(productRowMatchesFilter(f1, "valid")).toBe(true);
    expect(productRowMatchesFilter(f1, "complete")).toBe(true);
    expect(productRowMatchesFilter(f1, "incomplete")).toBe(false);
    expect(productRowMatchesFilter(f2, "complete")).toBe(false);
    expect(productRowMatchesFilter(f2, "incomplete")).toBe(true);
    expect(productRowMatchesFilter(f3, "complete")).toBe(false);
    expect(productRowMatchesFilter(f3, "incomplete")).toBe(false);
    expect(productRowMatchesFilter(f1, "problem")).toBe(false);
    expect(productRowMatchesFilter(f1, "barcode_empty")).toBe(false);
    expect(productRowMatchesFilter(f2, "sale_price_empty")).toBe(true);
    expect(productRowMatchesFilter(f2, "cost_price_empty")).toBe(false);
    expect(productRowMatchesFilter(f3, "problem")).toBe(true);
    expect(productRowMatchesFilter(f3, "valid")).toBe(false);
    expect(productRowMatchesFilter(f3, "duplicate")).toBe(false);
  });
});
