/** Helpers for importing Accurate.id exports (XLSX/CSV) without duplicates. */

import { ACCOUNT_SECTIONS, isAccountSectionAllowed, type AccountSection } from "@/lib/accounting";
import {
  cellText,
  normalizeHeader,
  numericCell,
  termDaysCell,
  type ImportFieldDef,
} from "./import-cells";
import {
  ACCOUNT_MAPPING_FIELDS,
  CATEGORY_FIELDS,
  UNIT_FIELDS,
} from "./import-taxonomy";
import { BRANCH_FIELDS, WAREHOUSE_FIELDS } from "./import-locations";
import {
  CUSTOMER_GROUP_FIELDS,
  PAYMENT_METHOD_FIELDS,
} from "./import-commerce";
import { EMPLOYEE_FIELDS, FIXED_ASSET_FIELDS } from "./import-hr-assets";

export * from "./import-taxonomy";
import { IMPORT_FIELDS } from "./import-products";

// Fasad kompatibilitas: permukaan produk tetap diekspor dari sini
// (pola yang sama dengan folder-folder domain lain di repo ini).
export {
  IMPORT_FIELDS,
  importFallbackSku,
  mapProductRow,
  slugSku,
  suggestMapping,
} from "./import-products";
export type { MappedProduct, MapRowErrorKind } from "./import-products";
export { parseAccuratePackagings, parseProductAttributes } from "./import-accurate";
export { parsePackagingCells } from "./import-packaging";
export { normalizeBarcode, normalizeHeader, parseNumber, suggestMappingFor } from "./import-cells";
export {
  BRANCH_FIELDS,
  WAREHOUSE_FIELDS,
  mapBranchRow,
  mapWarehouseRow,
} from "./import-locations";
export type { MappedBranch, MappedWarehouse } from "./import-locations";
export {
  CUSTOMER_GROUP_FIELDS,
  PAYMENT_METHOD_FIELDS,
  mapCustomerGroupRow,
  mapPaymentMethodRow,
} from "./import-commerce";
export type { MappedCustomerGroup, MappedPaymentMethod } from "./import-commerce";
export {
  EMPLOYEE_FIELDS,
  FIXED_ASSET_FIELDS,
  mapEmployeeRow,
  mapFixedAssetRow,
} from "./import-hr-assets";
export type { MappedEmployee, MappedFixedAsset } from "./import-hr-assets";
export type { ImportField, ImportFieldDef } from "./import-cells";

export type { ImportEntity } from "./import-entities";
export { IMPORT_ENTITIES, IMPORT_ENTITY_LABELS, isImportEntity } from "./import-entities";
import type { ImportEntity } from "./import-entities";

export const SUPPLIER_FIELDS: ImportFieldDef[] = [
  { key: "code", label: "Kode pemasok", aliases: ["kode pemasok", "kode", "code", "supplier code", "no pemasok", "nomor pemasok"] },
  { key: "name", label: "Nama pemasok", required: true, aliases: ["nama pemasok", "nama", "name", "supplier name"] },
  { key: "phone", label: "Telepon", aliases: ["telepon", "telp", "phone", "hp", "no hp", "kontak"] },
  { key: "email", label: "Email", aliases: ["email", "surel"] },
  { key: "address", label: "Alamat", aliases: ["alamat", "address"] },
  { key: "notes", label: "Catatan", aliases: ["catatan", "keterangan", "notes", "memo"] },
  // S3 (§18D): field pihak baru ikut round-trip ekspor→impor.
  { key: "taxId", label: "NPWP", aliases: ["npwp", "nomor npwp", "tax id", "nik"] },
  { key: "bankName", label: "Bank", aliases: ["bank", "nama bank"] },
  { key: "bankAccountNumber", label: "No. Rekening", aliases: ["no rekening", "nomor rekening", "rekening", "bank account"] },
  { key: "bankAccountName", label: "Atas Nama", aliases: ["atas nama", "nama rekening", "account name"] },
  {
    key: "paymentTermDays",
    label: "Termin (hari)",
    aliases: ["termin hari", "termin", "termin pembayaran", "payment term", "syarat", "syarat pembayaran"],
  },
];

export const CUSTOMER_FIELDS: ImportFieldDef[] = [
  { key: "code", label: "Kode pelanggan", aliases: ["kode pelanggan", "kode", "code", "customer code", "no pelanggan", "nomor pelanggan"] },
  { key: "name", label: "Nama pelanggan", required: true, aliases: ["nama pelanggan", "nama", "name", "customer name"] },
  { key: "phone", label: "Telepon", aliases: ["telepon", "telp", "phone", "hp", "no hp", "kontak"] },
  { key: "email", label: "Email", aliases: ["email", "surel"] },
  { key: "address", label: "Alamat", aliases: ["alamat", "address"] },
  {
    key: "group",
    label: "Kelompok harga",
    aliases: ["kelompok harga", "kelompok", "grup harga", "grup", "customer group", "group", "kategori harga", "kategori pelanggan"],
  },
  {
    key: "creditLimit",
    label: "Batas kredit",
    aliases: ["batas kredit", "limit kredit", "credit limit", "plafon", "batas piutang", "limit piutang"],
  },
  { key: "notes", label: "Catatan", aliases: ["catatan", "keterangan", "notes", "memo"] },
  // S3 (§18D): field pihak baru ikut round-trip ekspor→impor.
  { key: "taxId", label: "NPWP", aliases: ["npwp", "nomor npwp", "tax id", "nik"] },
  {
    key: "paymentTermDays",
    label: "Termin (hari)",
    aliases: ["termin hari", "termin", "termin pembayaran", "payment term", "syarat", "syarat pembayaran"],
  },
];

export const ACCOUNT_FIELDS: ImportFieldDef[] = [
  { key: "code", label: "Kode akun", required: true, aliases: ["kode akun", "kode", "code", "account code", "no akun", "nomor akun"] },
  { key: "name", label: "Nama akun", required: true, aliases: ["nama akun", "nama", "name", "account name", "nama perkiraan"] },
  {
    key: "type",
    label: "Tipe akun",
    required: true,
    aliases: ["tipe akun", "tipe", "jenis akun", "jenis", "type", "account type", "tipe perkiraan"],
  },
  { key: "normalBalance", label: "Saldo normal", aliases: ["saldo normal", "normal balance", "posisi normal"] },
  { key: "section", label: "Bagian laporan", aliases: ["bagian laporan", "bagian", "section", "kelompok laporan"] },
  { key: "description", label: "Keterangan", aliases: ["keterangan", "deskripsi", "description", "catatan"] },
];

export const OPENING_STOCK_FIELDS: ImportFieldDef[] = [
  { key: "sku", label: "SKU", aliases: ["sku", "kode barang", "kode", "item code", "no barang"] },
  { key: "name", label: "Nama produk", aliases: ["nama produk", "nama barang", "nama", "item name", "produk"] },
  {
    key: "qty",
    label: "Qty",
    required: true,
    aliases: ["qty", "jumlah", "kuantitas", "quantity", "stok", "stok awal", "kuantitas saldo awal"],
    exclude: ["minimum", "maksimum", "min stok", "stok min", "max stock", "min stock"],
  },
  {
    key: "unitCost",
    label: "Biaya satuan",
    required: true,
    aliases: ["biaya satuan", "harga beli", "harga pokok", "hpp", "cost", "unit cost", "biaya", "nilai satuan"],
    exclude: ["total", "jumlah biaya", "jumlah nilai"],
  },
  // Tanggal cut-off & gudang asal baris. Bila tidak dipetakan, wizard
  // memakai tanggal/gudang yang dipilih di layar.
  {
    key: "date",
    label: "Tanggal",
    aliases: ["tanggal", "tanggal saldo awal", "per tanggal", "date", "tanggal cut off", "tanggal cut-off"],
  },
  { key: "warehouse", label: "Gudang", aliases: ["gudang", "gudang saldo awal", "warehouse", "lokasi"] },
];

export const OPENING_PAYABLE_FIELDS: ImportFieldDef[] = [
  { key: "party", label: "Nama/kode pemasok", required: true, aliases: ["nama pemasok", "kode pemasok", "pemasok", "supplier", "vendor", "nama", "kode", "name", "code"] },
  { key: "date", label: "Tanggal", required: true, aliases: ["tanggal", "tanggal dokumen", "date", "tgl"] },
  { key: "dueDate", label: "Jatuh tempo", aliases: ["jatuh tempo", "tanggal jatuh tempo", "due date", "tempo"] },
  {
    key: "amount",
    label: "Jumlah",
    required: true,
    aliases: ["jumlah", "nominal", "amount", "total", "saldo", "utang", "saldo utang", "saldo hutang"],
  },
  { key: "reference", label: "Referensi", aliases: ["referensi", "no faktur", "nomor faktur", "no dokumen", "reference", "invoice", "nomor invoice"] },
];

export const OPENING_RECEIVABLE_FIELDS: ImportFieldDef[] = [
  { key: "party", label: "Nama/kode pelanggan", required: true, aliases: ["nama pelanggan", "kode pelanggan", "pelanggan", "customer", "nama", "kode", "name", "code"] },
  { key: "date", label: "Tanggal", required: true, aliases: ["tanggal", "tanggal dokumen", "date", "tgl"] },
  { key: "dueDate", label: "Jatuh tempo", aliases: ["jatuh tempo", "tanggal jatuh tempo", "due date", "tempo"] },
  {
    key: "amount",
    label: "Jumlah",
    required: true,
    aliases: ["jumlah", "nominal", "amount", "total", "saldo", "piutang", "saldo piutang"],
  },
  { key: "reference", label: "Referensi", aliases: ["referensi", "no faktur", "nomor faktur", "no dokumen", "reference", "invoice", "nomor invoice"] },
];

export const ENTITY_FIELDS: Record<ImportEntity, ImportFieldDef[]> = {
  products: IMPORT_FIELDS,
  suppliers: SUPPLIER_FIELDS,
  customers: CUSTOMER_FIELDS,
  accounts: ACCOUNT_FIELDS,
  categories: CATEGORY_FIELDS,
  units: UNIT_FIELDS,
  account_mappings: ACCOUNT_MAPPING_FIELDS,
  branches: BRANCH_FIELDS,
  warehouses: WAREHOUSE_FIELDS,
  payment_methods: PAYMENT_METHOD_FIELDS,
  customer_groups: CUSTOMER_GROUP_FIELDS,
  employees: EMPLOYEE_FIELDS,
  fixed_assets: FIXED_ASSET_FIELDS,
  opening_stock: OPENING_STOCK_FIELDS,
  opening_payables: OPENING_PAYABLE_FIELDS,
  opening_receivables: OPENING_RECEIVABLE_FIELDS,
};

export type MappedSupplier = {
  code: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  taxId: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  paymentTermDays: number | null;
};

export function mapSupplierRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedSupplier; error?: string } {
  const name = cellText(row, mapping, "name", 160);
  if (!name) return { error: "Nama pemasok kosong" };
  const term = termDaysCell(row, mapping);
  if ("error" in term) return { error: term.error };
  return {
    value: {
      code: cellText(row, mapping, "code", 40),
      name,
      phone: cellText(row, mapping, "phone", 40),
      email: cellText(row, mapping, "email", 160),
      address: cellText(row, mapping, "address", 300),
      notes: cellText(row, mapping, "notes", 500),
      taxId: cellText(row, mapping, "taxId", 40),
      bankName: cellText(row, mapping, "bankName", 80),
      bankAccountNumber: cellText(row, mapping, "bankAccountNumber", 40),
      bankAccountName: cellText(row, mapping, "bankAccountName", 120),
      paymentTermDays: term.value,
    },
  };
}

export type MappedCustomer = {
  code: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  group: string | null;
  creditLimit: number;
  notes: string | null;
  taxId: string | null;
  paymentTermDays: number | null;
};

export function mapCustomerRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedCustomer; error?: string } {
  const name = cellText(row, mapping, "name", 160);
  if (!name) return { error: "Nama pelanggan kosong" };
  const creditLimit = numericCell(
    mapping.creditLimit ? row[mapping.creditLimit] : undefined,
    "Batas kredit",
  );
  if ("error" in creditLimit) return { error: creditLimit.error };
  if (creditLimit.value < 0) return { error: "Batas kredit tidak boleh negatif" };
  const term = termDaysCell(row, mapping);
  if ("error" in term) return { error: term.error };
  return {
    value: {
      code: cellText(row, mapping, "code", 40),
      name,
      phone: cellText(row, mapping, "phone", 40),
      email: cellText(row, mapping, "email", 160),
      address: cellText(row, mapping, "address", 300),
      group: cellText(row, mapping, "group", 120),
      creditLimit: creditLimit.value,
      notes: cellText(row, mapping, "notes", 500),
      taxId: cellText(row, mapping, "taxId", 40),
      paymentTermDays: term.value,
    },
  };
}

export const ACCOUNT_TYPE_ALIASES: Record<string, string> = {
  asset: "asset",
  aset: "asset",
  aktiva: "asset",
  "aktiva lancar": "asset",
  "aktiva tetap": "asset",
  "aset lancar": "asset",
  "aset tetap": "asset",
  "cash bank": "asset",
  "account receivable": "asset",
  inventory: "asset",
  "fixed asset": "asset",
  "accumulated depreciation": "asset",
  liability: "liability",
  liabilitas: "liability",
  kewajiban: "liability",
  "kewajiban lancar": "liability",
  "kewajiban jangka panjang": "liability",
  "utang lancar": "liability",
  "utang jangka panjang": "liability",
  "account payable": "liability",
  "other current liability": "liability",
  "long term liability": "liability",
  equity: "equity",
  ekuitas: "equity",
  modal: "equity",
  revenue: "revenue",
  pendapatan: "revenue",
  "pendapatan lain": "revenue",
  "other income": "revenue",
  "other revenue": "revenue",
  expense: "expense",
  beban: "expense",
  "beban lain": "expense",
  "other expense": "expense",
  cogs: "cogs",
  hpp: "cogs",
  "harga pokok": "cogs",
  "harga pokok penjualan": "cogs",
  "cost of goods sold": "cogs",
};

/**
 * Tipe akun Accurate sangat beragam ("Aktiva Lancar", "Kewajiban
 * Jangka Panjang", "Cash/Bank", "Cost of Goods Sold", …). Exact alias
 * dulu, lalu fallback prefiks/keluarga; tidak pernah menebak dari kode
 * angka akun.
 */
/** Kelompok laporan dari istilah tipe Accurate saat kolom Bagian kosong. */
function inferSectionFromRawType(rawType: string, type: string): AccountSection | null {
  const normalized = normalizeHeader(rawType);
  if (type === "asset") {
    return normalized.includes("tetap") ||
      normalized.includes("fixed") ||
      normalized.includes("tidak lancar") ||
      normalized.includes("akumulasi") ||
      normalized.includes("accumulated")
      ? "non_current_asset"
      : "current_asset";
  }
  if (type === "liability") {
    return normalized.includes("jangka panjang") ||
      normalized.includes("long term") ||
      normalized.includes("tidak lancar")
      ? "non_current_liability"
      : "current_liability";
  }
  if (type === "equity") return "equity";
  if (type === "revenue") {
    return normalized.includes("lain") || normalized.includes("other")
      ? "other_income"
      : "revenue";
  }
  if (type === "cogs") return "cogs";
  if (type === "expense") {
    return normalized.includes("lain") || normalized.includes("other")
      ? "other_expense"
      : "operating_expense";
  }
  return null;
}

function resolveAccountType(rawType: string): string | null {
  const normalized = normalizeHeader(rawType);
  const exact = ACCOUNT_TYPE_ALIASES[normalized];
  if (exact) return exact;

  if (
    normalized.startsWith("aktiva") ||
    normalized.startsWith("aset") ||
    normalized.startsWith("asset") ||
    normalized.startsWith("akumulasi") ||
    normalized.startsWith("piutang") ||
    normalized.startsWith("persediaan") ||
    normalized.includes("cash") ||
    normalized.includes("bank") ||
    normalized.includes("inventory") ||
    normalized.includes("fixed asset") ||
    normalized.includes("accumulated")
  ) {
    return "asset";
  }
  if (
    normalized.startsWith("kewajiban") ||
    normalized.startsWith("utang") ||
    normalized.startsWith("hutang") ||
    normalized.startsWith("liabilit") ||
    normalized.includes("payable") ||
    normalized.includes("long term liab")
  ) {
    return "liability";
  }
  if (
    normalized.startsWith("ekuitas") ||
    normalized.startsWith("modal") ||
    normalized.startsWith("prive") ||
    normalized.includes("equity")
  ) {
    return "equity";
  }
  if (
    normalized.startsWith("pendapatan") ||
    normalized.includes("revenue") ||
    normalized.includes("income")
  ) {
    return "revenue";
  }
  if (
    normalized.startsWith("beban") ||
    normalized.startsWith("biaya") ||
    normalized.includes("expense")
  ) {
    return "expense";
  }
  if (
    normalized.includes("hpp") ||
    normalized.includes("cogs") ||
    normalized.includes("harga pokok") ||
    normalized.includes("cost of goods")
  ) {
    return "cogs";
  }
  return null;
}

/** Saldo normal bawaan per tipe akun — sama dengan konvensi bagan akun manual. */
export function defaultNormalBalance(type: string): "debit" | "credit" {
  return type === "asset" || type === "expense" || type === "cogs" ? "debit" : "credit";
}

const SECTION_BY_LABEL = new Map(
  Object.entries(ACCOUNT_SECTIONS).map(([key, label]) => [normalizeHeader(label), key]),
);

export function normalizeAccountSection(raw: string): AccountSection | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key in ACCOUNT_SECTIONS) return key as AccountSection;
  return (SECTION_BY_LABEL.get(normalizeHeader(raw)) as AccountSection | undefined) ?? null;
}

export type MappedAccount = {
  code: string;
  name: string;
  type: string;
  normalBalance: "debit" | "credit";
  section: AccountSection | null;
  description: string | null;
  /** Kelas kas/bank/kliring yang diinferensikan dari nama akun aset lancar. */
  cashBankKind: "cash" | "bank" | "clearing" | null;
};

/**
 * Impor COA dari Accurate/Excel umumnya tidak membawa kolom kelas
 * kas/bank. Tanpa inferensi, akun "Bank BCA" hasil impor tidak muncul di
 * halaman Kas & bank, rekonsiliasi, atau pemilih akun metode pembayaran.
 */
function inferCashBankKind(input: {
  type: string;
  section: AccountSection | null;
  name: string;
}): MappedAccount["cashBankKind"] {
  if (input.type !== "asset") return null;
  if (input.section !== null && input.section !== "current_asset") return null;
  const name = input.name.toLowerCase();
  if (/(^|\s)(kas|cash)(\s|$)/.test(name) || /kas kecil|petty cash/.test(name)) return "cash";
  if (/kliring|clearing/.test(name)) return "clearing";
  if (/\bbank\b/.test(name)) return "bank";
  return null;
}

export function mapAccountRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedAccount; error?: string } {
  const code = cellText(row, mapping, "code", 20);
  if (!code) return { error: "Kode akun kosong" };
  const name = cellText(row, mapping, "name", 120);
  if (!name) return { error: "Nama akun kosong" };

  const rawType = cellText(row, mapping, "type", 60);
  if (!rawType) return { error: "Tipe akun kosong" };
  const type = resolveAccountType(rawType);
  if (!type) {
    return {
      error: `Tipe akun tidak dikenal: "${rawType.slice(0, 40)}" (pakai asset/liability/equity/revenue/expense/cogs)`,
    };
  }

  const rawBalance = cellText(row, mapping, "normalBalance", 20);
  let normalBalance: "debit" | "credit";
  if (!rawBalance) {
    normalBalance = defaultNormalBalance(type);
  } else if (normalizeHeader(rawBalance) === "debit") {
    normalBalance = "debit";
  } else if (["kredit", "credit"].includes(normalizeHeader(rawBalance))) {
    normalBalance = "credit";
  } else {
    return { error: `Saldo normal tidak dikenal: "${rawBalance.slice(0, 40)}" (pakai debit/kredit)` };
  }

  const rawSection = cellText(row, mapping, "section", 60);
  let section: AccountSection | null = null;
  if (rawSection) {
    section = normalizeAccountSection(rawSection);
    if (!section) return { error: `Bagian laporan tidak dikenal: "${rawSection.slice(0, 40)}"` };
  } else if (!mapping.section) {
    // Ekspor Accurate tidak punya kolom "Bagian"; pakai istilah tipenya
    // agar aset tetap/liabilitas jangka panjang tidak jatuh ke kelompok
    // lancar hanya karena defaultSection(type).
    section = inferSectionFromRawType(rawType, type);
  }
  if (section && !isAccountSectionAllowed(type, section)) {
    return {
      error: `Bagian laporan "${section}" tidak sesuai untuk akun bertipe ${type}; pilih kelompok yang sesuai tipe akun`,
    };
  }

  return {
    value: {
      code,
      name,
      type,
      normalBalance,
      section,
      description: cellText(row, mapping, "description", 300),
      cashBankKind: inferCashBankKind({ type, section, name }),
    },
  };
}

export type MappedOpeningStock = {
  sku: string | null;
  name: string | null;
  qty: number;
  unitCost: number;
  /** Tanggal cut-off baris; null = pakai tanggal wizard. */
  date: string | null;
  /** Gudang asal baris; null = pakai gudang wizard. */
  warehouse: string | null;
  /** true bila kolom biaya tidak dipetakan (peringatan, bukan error). */
  costUnmapped: boolean;
};

function openingStockNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  const accountingNegative = value.startsWith("(") && value.endsWith(")");
  if (accountingNegative) value = value.slice(1, -1).trim();
  value = value.replace(/^(-?)Rp\s*/i, "$1");
  if (accountingNegative && value.startsWith("-")) return null;

  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(value)) {
    value = value.replaceAll(".", "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(value)) {
    value = value.replaceAll(",", "");
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(value)) {
    value = value.replaceAll(".", "");
  } else if (/^-?[1-9]\d{0,2}(,\d{3})+$/.test(value)) {
    value = value.replaceAll(",", "");
  } else {
    if (!/^-?\d+(?:[.,]\d+)?$/.test(value)) return null;
    value = value.replace(",", ".");
  }
  const result = Number(value);
  return Number.isFinite(result) ? (accountingNegative ? -result : result) : null;
}

export function mapOpeningStockRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedOpeningStock; error?: string } {
  const sku = cellText(row, mapping, "sku", 60);
  const name = cellText(row, mapping, "name", 180);
  if (!sku && !name) return { error: "SKU atau nama produk wajib diisi" };
  const rawQty = mapping.qty ? row[mapping.qty] : undefined;
  if (rawQty == null || String(rawQty).trim() === "") {
    return { error: "Kuantitas belum diisi. Masukkan angka 0 untuk stok nol." };
  }
  const qty = openingStockNumber(rawQty);
  if (qty === null) {
    return { error: `Qty tidak terbaca: "${String(rawQty).trim().slice(0, 40)}". Gunakan sel angka Excel.` };
  }
  const rawCost = mapping.unitCost ? row[mapping.unitCost] : undefined;
  const costBlank = rawCost == null || String(rawCost).trim() === "";
  if (qty < 0 && costBlank) return { error: "Biaya satuan wajib diisi untuk stok minus." };
  const unitCost = costBlank ? 0 : openingStockNumber(rawCost);
  if (unitCost === null) {
    return { error: `Biaya satuan tidak terbaca: "${String(rawCost).trim().slice(0, 40)}". Gunakan sel angka Excel.` };
  }
  if (unitCost < 0) return { error: "Biaya satuan tidak boleh negatif" };
  if (Math.abs(qty) >= 1e15 || unitCost >= 1e15 ||
      Number(qty.toFixed(4)) !== qty || Number(unitCost.toFixed(4)) !== unitCost) {
    return { error: "Qty dan biaya satuan harus muat dalam 15 digit bulat dan 4 digit desimal." };
  }

  const rawDate = mapping.date ? row[mapping.date] : undefined;
  let date: string | null = null;
  if (rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== "") {
    date = normalizeImportDate(rawDate);
    if (!date) {
      return { error: `Tanggal tidak terbaca: "${String(rawDate).trim().slice(0, 40)}"` };
    }
  }

  return {
    value: {
      sku,
      name,
      qty,
      unitCost,
      date,
      warehouse: cellText(row, mapping, "warehouse", 120),
      costUnmapped: !mapping.unitCost,
    },
  };
}

/**
 * Normalisasi tanggal sel impor ke ISO (YYYY-MM-DD). Menerima ISO,
 * DD/MM/YYYY, dan DD-MM-YYYY; tanggal kalender yang tidak nyata
 * (mis. 31/02/2026) ditolak. Mengembalikan null bila tak terbaca.
 */
export function normalizeImportDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else {
    return null;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type MappedOpeningBalance = {
  party: string;
  date: string;
  dueDate: string | null;
  amount: number;
  reference: string | null;
};

/**
 * Baris saldo awal hutang/piutang (T4-5b). Pihak ditulis dengan nama
 * ATAU kode master yang sudah ada — pencocokannya terjadi di analisis/
 * commit (import-masters), mapper ini hanya memvalidasi bentuk baris.
 */
export function mapOpeningBalanceRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
  partyLabel: string,
): { value?: MappedOpeningBalance; error?: string } {
  const party = cellText(row, mapping, "party", 160);
  if (!party) return { error: `${partyLabel} kosong` };

  const rawDate = mapping.date ? row[mapping.date] : undefined;
  if (rawDate === null || rawDate === undefined || String(rawDate).trim() === "") {
    return { error: "Tanggal kosong" };
  }
  const date = normalizeImportDate(rawDate);
  if (!date) return { error: `Tanggal tidak terbaca: "${String(rawDate).trim().slice(0, 40)}"` };

  const rawDue = mapping.dueDate ? row[mapping.dueDate] : undefined;
  let dueDate: string | null = null;
  if (rawDue !== null && rawDue !== undefined && String(rawDue).trim() !== "") {
    dueDate = normalizeImportDate(rawDue);
    if (!dueDate) {
      return { error: `Tanggal jatuh tempo tidak terbaca: "${String(rawDue).trim().slice(0, 40)}"` };
    }
  }

  const amount = numericCell(mapping.amount ? row[mapping.amount] : undefined, "Jumlah");
  if ("error" in amount) return { error: amount.error };
  if (amount.value <= 0) return { error: "Jumlah harus lebih dari 0" };

  return {
    value: {
      party,
      date,
      dueDate,
      amount: amount.value,
      reference: cellText(row, mapping, "reference", 120),
    },
  };
}

export { IMPORT_SAMPLES } from "./import-samples";
