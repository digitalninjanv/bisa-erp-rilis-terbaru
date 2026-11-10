import { describe, expect, it } from "vitest";
import {
  mapProductRow,
  suggestMapping,
  type ImportField,
} from "@/lib/import-parse";
import { suggestedPackagingLabel } from "@/lib/packaging";
import { d } from "@/lib/money";
import {
  PRODUCT_EXPORT_HEADERS,
  toProductExportRow,
  type ProductExportRow,
} from "@/server/catalog/products";

/**
 * Program Satuan Kemasan S6 — kolom kemasan opsional impor produk:
 * daftar paralel berpisah titik koma, validasi domain yang sama
 * (validatePackagingInput), dan paritas pulang-pergi ekspor→impor.
 */

const MAPPING: Partial<Record<ImportField, string>> = {
  sku: "Kode Barang",
  name: "Nama Barang",
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

function baseRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Kode Barang": "UJI-KMS-001",
    "Nama Barang": "Produk Uji Kemasan Impor",
    Barcode: "8990001112223",
    "Harga Beli": "3100",
    "Harga Jual": "3800",
    ...extra,
  };
}

describe("pemetaan kolom kemasan", () => {
  it("header ekspor terpetakan ke field kemasan yang benar, stok tetap tak terpetakan", () => {
    const mapping = suggestMapping([...PRODUCT_EXPORT_HEADERS]);
    expect(mapping.packagingNames).toBe("Kemasan");
    expect(mapping.packagingIsi).toBe("Isi Kemasan");
    expect(mapping.packagingBuyPrices).toBe("Harga Beli Kemasan");
    expect(mapping.packagingSalePrices).toBe("Harga Jual Kemasan");
    expect(mapping.packagingBarcodes).toBe("Barcode Kemasan");
    expect(mapping.packagingStatuses).toBe("Status Kemasan");
    expect(mapping.packagingDefaults).toBe("Kemasan Bawaan");
    expect(mapping.barcode).toBe("Barcode");
    expect(mapping.stock).toBeUndefined();
  });
});

describe("parsePackagingCells lewat mapProductRow", () => {
  it("dua kemasan paralel terbaca utuh (nama, isi, harga, barcode, status, bawaan)", () => {
    const mapped = mapProductRow(
      baseRow({
        Kemasan: "Dus;Pak",
        "Isi Kemasan": "40;10",
        "Harga Beli Kemasan": "124000;32000",
        "Harga Jual Kemasan": "145000;36000",
        "Barcode Kemasan": "8990001112224;",
        "Status Kemasan": "Aktif;Nonaktif",
        "Kemasan Bawaan": "Beli+Jual;Jual",
      }),
      MAPPING,
      "IMP-000001",
    );
    expect(mapped.error).toBeUndefined();
    expect(mapped.value?.packagings).toHaveLength(2);
    const [dus, pak] = mapped.value!.packagings;
    expect(dus).toMatchObject({
      name: "Dus",
      isi: "40",
      buyPrice: "124000",
      salePrice: "145000",
      barcode: "8990001112224",
      isActive: true,
      isDefaultPurchase: true,
      isDefaultSale: true,
    });
    expect(pak).toMatchObject({
      name: "Pak",
      isi: "10",
      buyPrice: "32000",
      salePrice: "36000",
      barcode: null,
      isActive: false,
      isDefaultPurchase: false,
      isDefaultSale: true,
    });
  });

  it("baris tanpa kolom kemasan menghasilkan daftar kosong (bukan error)", () => {
    const mapped = mapProductRow(baseRow(), MAPPING, "IMP-000002");
    expect(mapped.error).toBeUndefined();
    expect(mapped.value?.packagings).toEqual([]);
  });

  it("isi 1 / pecahan ditolak dengan errorKind packaging (aturan domain yang sama)", () => {
    for (const isi of ["1", "2.5", "0"]) {
      const mapped = mapProductRow(
        baseRow({ Kemasan: "Dus", "Isi Kemasan": isi }),
        MAPPING,
        "IMP-000003",
      );
      expect(mapped.errorKind).toBe("packaging");
      expect(mapped.error).toContain("bilangan bulat");
    }
  });

  it("daftar lebih panjang dari daftar nama ditolak", () => {
    const mapped = mapProductRow(
      baseRow({ Kemasan: "Dus", "Isi Kemasan": "40;10" }),
      MAPPING,
      "IMP-000004",
    );
    expect(mapped.errorKind).toBe("packaging");
    expect(mapped.error).toContain("melebihi jumlah kemasan");
  });

  it("kolom kemasan lain terisi tanpa nama kemasan ditolak", () => {
    const mapped = mapProductRow(baseRow({ "Isi Kemasan": "40" }), MAPPING, "IMP-000005");
    expect(mapped.errorKind).toBe("packaging");
    expect(mapped.error).toContain("nama kemasan");
  });

  it("isi kosong untuk kemasan bernama ditolak; status tak dikenal ditolak", () => {
    const noIsi = mapProductRow(baseRow({ Kemasan: "Dus" }), MAPPING, "IMP-000006");
    expect(noIsi.error).toContain("wajib diisi");
    const badStatus = mapProductRow(
      baseRow({ Kemasan: "Dus", "Isi Kemasan": "40", "Status Kemasan": "Kadang" }),
      MAPPING,
      "IMP-000007",
    );
    expect(badStatus.error).toContain("tidak dikenal");
  });

  it("harga kemasan tak terbaca / negatif ditolak", () => {
    const bad = mapProductRow(
      baseRow({ Kemasan: "Dus", "Isi Kemasan": "40", "Harga Jual Kemasan": "abc" }),
      MAPPING,
      "IMP-000008",
    );
    expect(bad.errorKind).toBe("packaging");
    const negative = mapProductRow(
      baseRow({ Kemasan: "Dus", "Isi Kemasan": "40", "Harga Beli Kemasan": "-100" }),
      MAPPING,
      "IMP-000009",
    );
    expect(negative.errorKind).toBe("packaging");
  });
});

describe("paritas pulang-pergi ekspor → impor", () => {
  it("baris ekspor berkemasan diparse kembali menjadi kemasan yang sama", () => {
    const source: ProductExportRow = {
      sku: "UJI-KMS-001",
      name: "Produk Uji Kemasan Impor",
      barcode: "8990001112223",
      categoryName: "Umum",
      unitName: "PCS",
      supplierName: null,
      costPrice: "3100.0000",
      salePrice: "3800.0000",
      minStock: "5.0000",
      trackStock: true,
      trackBatch: false,
      isActive: true,
      notes: null,
      packagings: [
        {
          name: "Dus",
          isi: "40.0000",
          buyPrice: "124000.0000",
          salePrice: "145000.0000",
          barcode: "8990001112224",
          isActive: true,
          isDefaultPurchase: true,
          isDefaultSale: true,
        },
        {
          name: "Pak",
          isi: "10.0000",
          buyPrice: null,
          salePrice: "36000.0000",
          barcode: null,
          isActive: false,
          isDefaultPurchase: false,
          isDefaultSale: false,
        },
      ],
    };
    const cells = toProductExportRow(source);
    const row: Record<string, unknown> = {};
    PRODUCT_EXPORT_HEADERS.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    const mapping = suggestMapping([...PRODUCT_EXPORT_HEADERS]);
    const mapped = mapProductRow(row, mapping, "IMP-000010");
    expect(mapped.error).toBeUndefined();
    const packs = mapped.value!.packagings;
    expect(packs).toHaveLength(2);
    expect(packs[0].name).toBe("Dus");
    expect(d(packs[0].isi).eq(40)).toBe(true);
    expect(d(packs[0].buyPrice!).eq(124000)).toBe(true);
    expect(d(packs[0].salePrice!).eq(145000)).toBe(true);
    expect(packs[0].barcode).toBe("8990001112224");
    expect(packs[0].isActive).toBe(true);
    expect(packs[0].isDefaultPurchase).toBe(true);
    expect(packs[0].isDefaultSale).toBe(true);
    expect(packs[1].name).toBe("Pak");
    expect(d(packs[1].isi).eq(10)).toBe(true);
    expect(packs[1].buyPrice).toBeNull();
    expect(d(packs[1].salePrice!).eq(36000)).toBe(true);
    expect(packs[1].isActive).toBe(false);
  });
});

describe("suggestedPackagingLabel (S6)", () => {
  it("membulatkan saran ke atas ke kemasan utuh", () => {
    expect(suggestedPackagingLabel("90", { name: "Dus", isi: "40" })).toBe("≈ 3 Dus");
    expect(suggestedPackagingLabel("80", { name: "Dus", isi: "40" })).toBe("≈ 2 Dus");
    expect(suggestedPackagingLabel("5", { name: "Dus", isi: "40" })).toBe("≈ 1 Dus");
  });
  it("null tanpa kemasan bawaan / saran tak positif", () => {
    expect(suggestedPackagingLabel("90", null)).toBeNull();
    expect(suggestedPackagingLabel("0", { name: "Dus", isi: "40" })).toBeNull();
  });
});
