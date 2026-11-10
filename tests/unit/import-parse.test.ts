import { describe, expect, it } from "vitest";
import {
  mapProductRow,
  normalizeBarcode,
  normalizeHeader,
  parseNumber,
  slugSku,
  suggestMapping,
} from "@/lib/import-parse";

describe("normalizeHeader", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeHeader("Kode Barang (Accurate)")).toBe("kode barang accurate");
    expect(normalizeHeader("  Harga_Jual  ")).toBe("harga jual");
  });
});

describe("suggestMapping", () => {
  it("maps a typical Accurate.id export", () => {
    const mapping = suggestMapping([
      "Kode Barang",
      "Nama Barang",
      "Barcode",
      "Kategori",
      "Satuan",
      "Pemasok",
      "Harga Beli",
      "Harga Jual",
      "Stok",
      "Stok Minimum",
    ]);
    expect(mapping).toMatchObject({
      sku: "Kode Barang",
      name: "Nama Barang",
      barcode: "Barcode",
      category: "Kategori",
      unit: "Satuan",
      supplier: "Pemasok",
      costPrice: "Harga Beli",
      salePrice: "Harga Jual",
      stock: "Stok",
      minStock: "Stok Minimum",
    });
  });

  it("falls back to partial matches and never reuses a column", () => {
    const mapping = suggestMapping(["Kode Barang Accurate", "Nama Barang", "Harga Jual Rp"]);
    expect(mapping.sku).toBe("Kode Barang Accurate");
    expect(mapping.salePrice).toBe("Harga Jual Rp");
    expect(new Set(Object.values(mapping)).size).toBe(Object.keys(mapping).length);
  });
});

describe("parseNumber", () => {
  it.each([
    ["1.500", 1500],
    ["12,5", 12.5],
    ["1.234,56", 1234.56],
    ["Rp 12.000", 12000],
    ["1,234.56", 1234.56],
    ["-250", -250],
    ["", null],
    [null, null],
    ["abc", null],
    [42, 42],
  ])("parses %s", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
});

describe("normalizeBarcode", () => {
  it("keeps leading-zero strings intact", () => {
    expect(normalizeBarcode("001234567890")).toBe("001234567890");
  });

  it("removes spaces and separators", () => {
    expect(normalizeBarcode("899 1234-567")).toBe("8991234567");
  });

  it("expands scientific notation from Excel", () => {
    expect(normalizeBarcode("4.5E+12")).toBe("4500000000000");
  });

  it("returns null for empty values", () => {
    expect(normalizeBarcode("")).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
  });
});

describe("slugSku", () => {
  it("pads the sequence", () => {
    expect(slugSku("SKU", 7)).toBe("SKU-00007");
  });
});

describe("mapProductRow", () => {
  const mapping = suggestMapping([
    "Kode Barang",
    "Nama Barang",
    "Barcode",
    "Kategori",
    "Satuan",
    "Pemasok",
    "Harga Beli",
    "Harga Jual",
    "Stok",
    "Stok Minimum",
  ]);

  it("maps a full Accurate row", () => {
    const result = mapProductRow(
      {
        "Kode Barang": "ACC-01",
        "Nama Barang": "Kopi Bubuk",
        Barcode: "8990001",
        Kategori: "Minuman",
        Satuan: "PCS",
        Pemasok: "PT Sumber",
        "Harga Beli": "12.500",
        "Harga Jual": "15.000",
        Stok: "24",
        "Stok Minimum": "5",
      },
      mapping,
      "SKU-00001",
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      sku: "ACC-01",
      name: "Kopi Bubuk",
      barcode: "8990001",
      category: "Minuman",
      costPrice: 12500,
      salePrice: 15000,
      stock: 24,
      minStock: 5,
    });
  });

  it("uses a fallback SKU when the row has none", () => {
    const result = mapProductRow({ "Nama Barang": "Tanpa Kode" }, mapping, "SKU-00042");
    expect(result.value?.sku).toBe("SKU-00042");
  });

  it("rejects rows without a name", () => {
    expect(mapProductRow({ "Kode Barang": "X" }, mapping, "SKU-1").error).toMatch(/Nama/);
  });

  it("rejects negative stock and minimum stock instead of clamping them (GD-P3-2)", () => {
    const negativeStock = mapProductRow(
      { "Nama Barang": "Minus", Stok: "-5" },
      mapping,
      "SKU-2",
    );
    expect(negativeStock.value).toBeUndefined();
    expect(negativeStock.error).toMatch(/Stok awal tidak boleh negatif/);
    expect(negativeStock.errorKind).toBe("stock");

    const negativeMin = mapProductRow(
      { "Nama Barang": "Minus", "Stok Minimum": "-2" },
      mapping,
      "SKU-2",
    );
    expect(negativeMin.value).toBeUndefined();
    expect(negativeMin.error).toMatch(/Stok minimum tidak boleh negatif/);
  });

  it("rejects a filled-in price that cannot be parsed instead of importing 0 (GD-P3-2)", () => {
    const result = mapProductRow(
      { "Nama Barang": "Harga Aneh", "Harga Jual": "hubungi kami" },
      mapping,
      "SKU-3",
    );
    expect(result.value).toBeUndefined();
    expect(result.error).toMatch(/Harga jual tidak terbaca/);
    expect(result.errorKind).toBe("price");
  });
});
