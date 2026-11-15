/** Daftar entitas impor — sumber tunggal agar tidak ada siklus tipe. */
export type ImportEntity =
  | "products"
  | "suppliers"
  | "customers"
  | "accounts"
  | "categories"
  | "units"
  | "account_mappings"
  | "branches"
  | "warehouses"
  | "payment_methods"
  | "customer_groups"
  | "employees"
  | "fixed_assets"
  | "opening_stock"
  | "opening_payables"
  | "opening_receivables";

export const IMPORT_ENTITIES: ImportEntity[] = [
  "products",
  "suppliers",
  "customers",
  "accounts",
  "categories",
  "units",
  "account_mappings",
  "branches",
  "warehouses",
  "payment_methods",
  "customer_groups",
  "employees",
  "fixed_assets",
  "opening_stock",
  "opening_payables",
  "opening_receivables",
];

export function isImportEntity(value: string): value is ImportEntity {
  return (IMPORT_ENTITIES as string[]).includes(value);
}

export const IMPORT_ENTITY_LABELS: Record<ImportEntity, string> = {
  products: "Produk",
  suppliers: "Pemasok",
  customers: "Pelanggan",
  accounts: "Akun (Bagan Akun)",
  categories: "Kategori Produk",
  units: "Satuan",
  account_mappings: "Pemetaan Akun",
  branches: "Cabang",
  warehouses: "Gudang",
  payment_methods: "Metode Pembayaran",
  customer_groups: "Kelompok Harga",
  employees: "Karyawan",
  fixed_assets: "Aset Tetap",
  opening_stock: "Stok Awal",
  opening_payables: "Saldo Awal Utang",
  opening_receivables: "Saldo Awal Piutang",
};
