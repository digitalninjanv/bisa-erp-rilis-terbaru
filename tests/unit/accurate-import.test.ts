import { describe, expect, it } from "vitest";
import {
  ACCOUNT_FIELDS,
  CUSTOMER_FIELDS,
  OPENING_STOCK_FIELDS,
  SUPPLIER_FIELDS,
  mapAccountRow,
  mapCustomerRow,
  mapOpeningStockRow,
  mapProductRow,
  mapSupplierRow,
  suggestMapping,
  suggestMappingFor,
} from "@/lib/import-parse";

/**
 * Regresi migrasi Accurate: header yang dipakai file nyata
 * `daftar-barang.xlsx` (75 kolom) harus dipetakan ke kolom yang benar.
 * Sebelum perbaikan, "Harga dari rincian grup" (boolean TIDAK) menangkap
 * harga jual dan seluruh 1.000 baris gagal.
 */
const ACCURATE_PRODUCT_HEADERS = [
  "No.",
  "PPN",
  "PPNBM",
  "Satuan",
  "Catatan",
  "Non Aktif",
  "Satuan #2",
  "Satuan #3",
  "Satuan #4",
  "Satuan #5",
  "Berat (gr)",
  "Harga Beli",
  "Kode Barang",
  "Nama Barang",
  "Satuan Beli",
  "UPC/Barcode",
  "Jenis Barang",
  "Merek Barang",
  "Minimum Beli",
  "Nilai Satuan",
  "Pemasok Utama",
  "Kategori Barang",
  "Rasio Satuan #2",
  "Rasio Satuan #3",
  "Rasio Satuan #4",
  "Rasio Satuan #5",
  "Tipe Nomor Seri",
  "Gudang Saldo Awal",
  "Satuan Saldo Awal",
  "Substitusi dengan",
  "Batas Minimum Stok",
  "Default Diskon (%)",
  "Kuantitas Saldo Awal",
  "Menggunakan No. Seri",
  "Dasar Pengenaan PPN(%)",
  "Harga dari rincian grup",
  "Def. Hrg. Jual Satuan #1",
  "Def. Hrg. Jual Satuan #2",
  "Def. Hrg. Jual Satuan #3",
  "Def. Hrg. Jual Satuan #4",
  "Def. Hrg. Jual Satuan #5",
  "Pakai tanggal kadaluarsa",
];

const PRODUCT_MAPPING = suggestMapping(ACCURATE_PRODUCT_HEADERS);

function accurateProductRow(overrides: Record<string, unknown> = {}) {
  return {
    "Kode Barang": "109487",
    "Nama Barang": "ABC Es Kopi Gula Aren 22g",
    Satuan: "Pcs",
    "UPC/Barcode": "8995231900699",
    "Kategori Barang": "Minuman",
    "Pemasok Utama": "PT Sumber",
    "Harga Beli": "1900.000000",
    "Batas Minimum Stok": "5.000000",
    "Kuantitas Saldo Awal": "24.000000",
    "Gudang Saldo Awal": "Gudang Utama",
    "Harga dari rincian grup": "TIDAK",
    "Def. Hrg. Jual Satuan #1": "2500.000000",
    "Jenis Barang": "INV",
    "Non Aktif": "TIDAK",
    "Menggunakan No. Seri": "TIDAK",
    "Pakai tanggal kadaluarsa": "TIDAK",
    ...overrides,
  };
}

describe("pemetaan ekspor Accurate", () => {
  it("harga jual memakai Def. Hrg. Jual Satuan #1, bukan Harga dari rincian grup", () => {
    expect(PRODUCT_MAPPING.salePrice).toBe("Def. Hrg. Jual Satuan #1");
    expect(PRODUCT_MAPPING.salePrice).not.toBe("Harga dari rincian grup");
  });

  it("stok awal memakai Kuantitas Saldo Awal, bukan Batas Minimum Stok", () => {
    expect(PRODUCT_MAPPING.stock).toBe("Kuantitas Saldo Awal");
    expect(PRODUCT_MAPPING.minStock).toBe("Batas Minimum Stok");
  });

  it("atribut produk Accurate ikut dipetakan", () => {
    expect(PRODUCT_MAPPING.itemType).toBe("Jenis Barang");
    expect(PRODUCT_MAPPING.activeStatus).toBe("Non Aktif");
    expect(PRODUCT_MAPPING.serialTracked).toBe("Menggunakan No. Seri");
    expect(PRODUCT_MAPPING.batchTracked).toBe("Pakai tanggal kadaluarsa");
  });

  it("baris produk nyata menghasilkan harga, stok, dan kemasan yang benar", () => {
    const result = mapProductRow(
      accurateProductRow({
        "Satuan #2": "Renceng",
        "Rasio Satuan #2": "10.000000",
        "Def. Hrg. Jual Satuan #2": "19000.000000",
        "Satuan Beli": "Renceng",
      }),
      PRODUCT_MAPPING,
      "IMP-000001",
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      sku: "109487",
      name: "ABC Es Kopi Gula Aren 22g",
      barcode: "8995231900699",
      category: "Minuman",
      unit: "Pcs",
      supplier: "PT Sumber",
      costPrice: 1900,
      salePrice: 2500,
      minStock: 5,
      stock: 24,
      trackStock: true,
      isActive: true,
      trackSerial: false,
      trackBatch: false,
    });
    expect(result.value?.packagings).toHaveLength(1);
    expect(result.value?.packagings[0]).toMatchObject({
      name: "Renceng",
      isi: "10",
      salePrice: "19000",
      isDefaultPurchase: true,
      isDefaultSale: false,
    });
  });

  it("produk Jasa/nonaktif tidak dipaksa menjadi produk stok aktif", () => {
    const result = mapProductRow(
      accurateProductRow({
        "Jenis Barang": "Jasa",
        "Non Aktif": "YA",
        "Menggunakan No. Seri": "YA",
        "Pakai tanggal kadaluarsa": "YA",
      }),
      PRODUCT_MAPPING,
      "IMP-000002",
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      trackStock: false,
      isActive: false,
      trackSerial: false,
      trackBatch: false,
      packagings: [],
    });
  });

  it("kolom kemasan menggantung tanpa kolom Kemasan tidak menggagalkan baris", () => {
    const mapping = {
      ...PRODUCT_MAPPING,
      packagingSalePrices: "Def. Hrg. Jual Satuan #1",
    };
    const result = mapProductRow(accurateProductRow(), mapping, "IMP-000003");
    expect(result.error).toBeUndefined();
    expect(result.value?.packagings).toEqual([]);
  });

  it("kolom kemasan ERP tetap dipakai bila kolom Kemasan dipetakan", () => {
    const mapping = {
      ...PRODUCT_MAPPING,
      packagingNames: "Kemasan",
      packagingIsi: "Isi Kemasan",
      packagingSalePrices: "Harga Jual Kemasan",
    };
    const result = mapProductRow(
      accurateProductRow({
        Kemasan: "Dus",
        "Isi Kemasan": "40",
        "Harga Jual Kemasan": "145000",
      }),
      mapping,
      "IMP-000004",
    );
    expect(result.error).toBeUndefined();
    expect(result.value?.packagings[0]).toMatchObject({
      name: "Dus",
      isi: "40",
      salePrice: "145000",
    });
  });

  it("rasio multi-satuan tidak valid ditolak dengan pesan jelas", () => {
    const result = mapProductRow(
      accurateProductRow({
        "Satuan #2": "Renceng",
        "Rasio Satuan #2": "1",
      }),
      PRODUCT_MAPPING,
      "IMP-000005",
    );
    expect(result.errorKind).toBe("packaging");
    expect(result.error).toMatch(/Rasio Satuan #2/);
  });

  it("ekspor ERP sendiri (Lacak Persediaan/Lacak Batch/Status) terbaca", () => {
    const mapping = suggestMapping([
      "Kode Barang",
      "Nama Barang",
      "Harga Beli",
      "Harga Jual",
      "Lacak Persediaan",
      "Lacak Batch",
      "Status",
    ]);
    expect(mapping.itemType).toBe("Lacak Persediaan");
    expect(mapping.batchTracked).toBe("Lacak Batch");
    expect(mapping.activeStatus).toBe("Status");
    const result = mapProductRow(
      {
        "Kode Barang": "ERP-1",
        "Nama Barang": "Produk ERP",
        "Harga Beli": "1000",
        "Harga Jual": "1500",
        "Lacak Persediaan": "Ya",
        "Lacak Batch": "Ya",
        Status: "Nonaktif",
      },
      mapping,
      "IMP-000006",
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      trackStock: true,
      trackBatch: true,
      isActive: false,
    });
  });
});

describe("pelanggan/pemasok Accurate", () => {
  it("Kategori Harga, Batas Piutang, dan Syarat Net 30 terbaca", () => {
    const mapping = suggestMappingFor(CUSTOMER_FIELDS, [
      "Kode Pelanggan",
      "Nama Pelanggan",
      "Kategori Harga",
      "Batas Piutang",
      "Syarat",
      "NPWP",
    ]);
    expect(mapping).toMatchObject({
      code: "Kode Pelanggan",
      name: "Nama Pelanggan",
      group: "Kategori Harga",
      creditLimit: "Batas Piutang",
      paymentTermDays: "Syarat",
    });
    const result = mapCustomerRow(
      {
        "Kode Pelanggan": "C-1",
        "Nama Pelanggan": "Toko Berkah",
        "Kategori Harga": "Grosir",
        "Batas Piutang": "5.000.000",
        Syarat: "Net 30",
        NPWP: "012345",
      },
      mapping,
    );
    expect(result.value).toMatchObject({
      code: "C-1",
      name: "Toko Berkah",
      group: "Grosir",
      creditLimit: 5_000_000,
      paymentTermDays: 30,
    });
  });

  it("No. Pemasok dan termin COD terbaca", () => {
    const mapping = suggestMappingFor(SUPPLIER_FIELDS, [
      "No. Pemasok",
      "Nama Pemasok",
      "Syarat",
    ]);
    expect(mapping.code).toBe("No. Pemasok");
    const result = mapSupplierRow(
      { "No. Pemasok": "S-1", "Nama Pemasok": "PT Sumber", Syarat: "COD" },
      mapping,
    );
    expect(result.value).toMatchObject({
      code: "S-1",
      name: "PT Sumber",
      paymentTermDays: 0,
    });
  });
});

describe("bagan akun Accurate", () => {
  const mapping = suggestMappingFor(ACCOUNT_FIELDS, [
    "Kode Akun",
    "Nama Akun",
    "Tipe Akun",
    "Saldo Normal",
    "Keterangan",
  ]);

  it("section diturunkan dari istilah tipe Accurate bila kolom Bagian kosong", () => {
    const cases: [string, string][] = [
      ["Aktiva Tetap", "non_current_asset"],
      ["Fixed Asset", "non_current_asset"],
      ["Kewajiban Jangka Panjang", "non_current_liability"],
      ["Long Term Liability", "non_current_liability"],
      ["Other Income", "other_income"],
      ["Beban Lain", "other_expense"],
      ["Harga Pokok Penjualan", "cogs"],
    ];
    for (const [rawType, expected] of cases) {
      const result = mapAccountRow(
        {
          "Kode Akun": "1",
          "Nama Akun": "Akun Uji",
          "Tipe Akun": rawType,
          "Saldo Normal": "",
          Keterangan: "",
        },
        mapping,
      );
      expect(result.value?.section, rawType).toBe(expected);
    }
  });

  it.each([
    ["Aktiva", "asset"],
    ["Aktiva Lancar", "asset"],
    ["Aktiva Tetap", "asset"],
    ["Kewajiban Lancar", "liability"],
    ["Kewajiban Jangka Panjang", "liability"],
    ["Ekuitas", "equity"],
    ["Pendapatan", "revenue"],
    ["Beban", "expense"],
    ["Harga Pokok Penjualan", "cogs"],
    ["Cash/Bank", "asset"],
    ["Account Receivable", "asset"],
    ["Inventory", "asset"],
    ["Fixed Asset", "asset"],
    ["Account Payable", "liability"],
    ["Cost of Goods Sold", "cogs"],
  ])("tipe %s menjadi %s", (rawType, expected) => {
    const result = mapAccountRow(
      {
        "Kode Akun": "1",
        "Nama Akun": "Akun Uji",
        "Tipe Akun": rawType,
        "Saldo Normal": "",
        Keterangan: "",
      },
      mapping,
    );
    expect(result.value?.type).toBe(expected);
  });
});

describe("stok awal Accurate", () => {
  it("Nilai Satuan, Per Tanggal, dan Gudang Saldo Awal terbaca", () => {
    const mapping = suggestMappingFor(OPENING_STOCK_FIELDS, [
      "Kode Barang",
      "Nama Barang",
      "Gudang Saldo Awal",
      "Kuantitas Saldo Awal",
      "Nilai Satuan",
      "Per Tanggal",
    ]);
    expect(mapping).toMatchObject({
      sku: "Kode Barang",
      name: "Nama Barang",
      qty: "Kuantitas Saldo Awal",
      unitCost: "Nilai Satuan",
      warehouse: "Gudang Saldo Awal",
      date: "Per Tanggal",
    });
    const result = mapOpeningStockRow(
      {
        "Kode Barang": "100001",
        "Nama Barang": "Jelly",
        "Gudang Saldo Awal": "Gudang Utama",
        "Kuantitas Saldo Awal": "24",
        "Nilai Satuan": "5795",
        "Per Tanggal": "2026-10-31",
      },
      mapping,
    );
    expect(result.value).toMatchObject({
      qty: 24,
      unitCost: 5795,
      warehouse: "Gudang Utama",
      date: "2026-10-31",
      costUnmapped: false,
    });
  });

  it("biaya yang tidak dipetakan ditandai, bukan diam-diam 0", () => {
    const result = mapOpeningStockRow(
      { "Kode Barang": "100001", "Kuantitas Saldo Awal": "24" },
      { sku: "Kode Barang", qty: "Kuantitas Saldo Awal" },
    );
    expect(result.value).toMatchObject({ unitCost: 0, costUnmapped: true });
  });
});
