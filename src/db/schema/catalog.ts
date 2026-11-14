/**
 * Skema domain: katalog & pihak (grup, pelanggan, pemasok, produk).
 * A-26 Q2: pecahan src/db/schema.ts — definisi dipindah utuh, tanpa perubahan.
 * Impor publik tetap lewat barrel "@/db/schema" (src/db/schema.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { CustomFieldValues } from "@/lib/custom-fields";

/* ------------------------------------------------------------------ */
/* Parties and catalog                                                 */
/* ------------------------------------------------------------------ */

export const customerGroups = pgTable(
  "customer_groups",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
    // Legacy general discount; group pricing now uses per-product rules.
    discountType: text("discount_type").notNull().default("percent"),
    discountValue: numeric("discount_value", { precision: 19, scale: 4 }).notNull().default("0"),
    // Group pricing: per-product rules are rounded to roundingStep in
    // roundingDirection. "Pembulatan total tunai" is optional.
    roundingStep: integer("rounding_step").notNull().default(0),
    roundingDirection: text("rounding_direction").notNull().default("down"), // down | up | nearest
    roundCashTotal: boolean("round_cash_total").notNull().default(false),
    discountAccountId: uuid("discount_account_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_groups_company_name_uq").on(t.companyId, t.name)],
);
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    groupId: uuid("group_id").references(() => customerGroups.id),
    creditLimit: numeric("credit_limit", { precision: 19, scale: 4 }).notNull().default("0"),
    // S3 (§18D): NPWP/NIK pihak untuk dokumen pajak & deteksi duplikat.
    taxId: text("tax_id"),
    // S3 (§18D): termin pembayaran bawaan (hari) — dipakai sebagai
    // bawaan jatuh tempo dokumen saldo awal pihak ini.
    paymentTermDays: integer("payment_term_days"),
    notes: text("notes"),
    // T5-2 (D-16): values of company-defined custom fields
    // (company_settings.custom_fields), key → normalized string.
    attributes: jsonb("attributes").$type<CustomFieldValues>(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_company_code_uq").on(t.companyId, t.code),
    index("customers_company_name_idx").on(t.companyId, t.name),
  ],
);
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    // S3 (§18D): NPWP pemasok untuk dokumen pajak & deteksi duplikat.
    taxId: text("tax_id"),
    // S3 (§18D): rekening pembayaran pemasok (untuk pembayaran utang).
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankAccountName: text("bank_account_name"),
    // S3 (§18D): termin pembayaran bawaan (hari) — dipakai sebagai
    // bawaan jatuh tempo dokumen saldo awal pihak ini.
    paymentTermDays: integer("payment_term_days"),
    notes: text("notes"),
    // T5-2 (D-16): values of company-defined custom fields
    // (company_settings.custom_fields), key → normalized string.
    attributes: jsonb("attributes").$type<CustomFieldValues>(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("suppliers_company_code_uq").on(t.companyId, t.code),
    uniqueIndex("suppliers_company_id_id_uq").on(t.companyId, t.id),
    index("suppliers_company_name_idx").on(t.companyId, t.name),
  ],
);
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
    // T5-3 (D-17): nested categories. The column has existed since the
    // baseline schema; the self-FK lands in migration 0021. Cycle
    // prevention lives in the domain (catalog.ts assertCategoryParent).
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("categories_company_name_uq").on(t.companyId, t.name),
    uniqueIndex("categories_company_id_id_uq").on(t.companyId, t.id),
  ],
);
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // T5-2: units can be deactivated like other masters; inactive units
    // are not offered in pickers but stay resolvable on existing rows.
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("units_company_code_uq").on(t.companyId, t.code),
    uniqueIndex("units_company_id_id_uq").on(t.companyId, t.id),
  ],
);
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    // SIM-2 S7 (REM-01): master references are real database FKs since
    // migration 0031 — before that they were bare uuids guarded only by
    // the application, which let test fixtures orphan stock rows (RT-07).
    categoryId: uuid("category_id"),
    unitId: uuid("unit_id"),
    supplierId: uuid("supplier_id"),
    costPrice: numeric("cost_price", { precision: 19, scale: 4 }).notNull().default("0"),
    salePrice: numeric("sale_price", { precision: 19, scale: 4 }).notNull().default("0"),
    minStock: numeric("min_stock", { precision: 19, scale: 4 }).notNull().default("0"),
    trackStock: boolean("track_stock").notNull().default(true),
    // Opt-in lot tracking (G8/D-7): batch-tracked products keep per-batch
    // quantities in stock_batches and sell FEFO; see src/server/batches.ts.
    trackBatch: boolean("track_batch").notNull().default(false),
    // SIM-2 S7B-2 (§4 lanjutan): opt-in per-unit serial tracking. Every
    // unit of a serial-tracked product carries an identity row in
    // stock_serials; receipts must name the serials, POS sales must pick
    // them. See src/server/serials.ts.
    trackSerial: boolean("track_serial").notNull().default(false),
    // T5-2 (D-16): values of company-defined custom fields
    // (company_settings.custom_fields), key → normalized string.
    attributes: jsonb("attributes").$type<CustomFieldValues>(),
    isActive: boolean("is_active").notNull().default(true),
    imageUrl: text("image_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "products_company_category_fk",
      columns: [t.companyId, t.categoryId],
      foreignColumns: [categories.companyId, categories.id],
    }),
    foreignKey({
      name: "products_company_unit_fk",
      columns: [t.companyId, t.unitId],
      foreignColumns: [units.companyId, units.id],
    }),
    foreignKey({
      name: "products_company_supplier_fk",
      columns: [t.companyId, t.supplierId],
      foreignColumns: [suppliers.companyId, suppliers.id],
    }),
    uniqueIndex("products_company_sku_uq").on(t.companyId, t.sku),
    index("products_company_sku_lower_idx").on(t.companyId, sql`lower(${t.sku})`),
    uniqueIndex("products_company_barcode_uq").on(t.companyId, t.barcode),
    index("products_company_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    // SIM-2 S4 (PERF-03): trigram untuk sku/barcode SENGAJA tidak
    // dipasang — alasan leakproof/RLS yang sama seperti journal_entries
    // (lihat komentar di sana); pencarian ilike dilayani awalan b-tree
    // company_id + filter, terukur membaik lewat indeks nama di bawah.
    // SIM-2 S4: daftar produk & kisi POS mengurutkan nama dalam
    // perusahaan — GIN trigram tidak melayani ORDER BY, jadi tanpa
    // b-tree ini 100 rb produk diurutkan penuh setiap halaman
    // (terukur: daftar 134 ms & cari-kosong POS 76 ms pada 100 rb produk).
    index("products_company_name_idx").on(t.companyId, t.name),
    index("products_company_active_idx").on(t.companyId, t.isActive),
    uniqueIndex("products_company_id_id_uq").on(t.companyId, t.id),
  ],
);
/**
 * Program Satuan Kemasan S1 (membuka lagi D-17, persetujuan pemilik
 * 2026-11-08; model: docs/satuan/RENCANA-SATUAN.md): kemasan per produk —
 * baris konversi tetap yang menyatakan isinya LANGSUNG ke satuan dasar
 * produk (products.unitId). Stok tidak pernah disimpan dalam kemasan;
 * konversi hanya terjadi di pinggir transaksi dan baris transaksi
 * menyimpan faktor cuplikannya (mulai S2). `isi` numeric demi konsistensi
 * kolom qty repo; domain (src/lib/packaging.ts) menegakkan bilangan
 * bulat ≥ 2 untuk barang terhitung. Harga jual per kemasan INDEPENDEN
 * dari harga satuan dasar — tidak pernah diturunkan mekanis.
 * Barcode unik per perusahaan ditegakkan indeks di sini + penjaga
 * domain satu sumber lintas products.barcode (server/catalog/packaging).
 */
export const productPackagings = pgTable(
  "product_packagings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    isi: numeric("isi", { precision: 19, scale: 4 }).notNull(),
    buyPrice: numeric("buy_price", { precision: 19, scale: 4 }),
    salePrice: numeric("sale_price", { precision: 19, scale: 4 }),
    barcode: text("barcode"),
    isDefaultPurchase: boolean("is_default_purchase").notNull().default(false),
    isDefaultSale: boolean("is_default_sale").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "product_packagings_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }).onDelete("cascade"),
    uniqueIndex("product_packagings_company_id_id_uq").on(t.companyId, t.id),
    uniqueIndex("product_packagings_company_product_name_uq").on(t.companyId, t.productId, t.name),
    uniqueIndex("product_packagings_company_barcode_uq").on(t.companyId, t.barcode),
    index("product_packagings_company_product_idx").on(t.companyId, t.productId),
  ],
);

/**
 * Price rule for one product inside a customer group. A missing row means the
 * product is sold at its normal price. `percent` stores a percentage, `fixed`
 * stores an absolute group price.
 */
export const customerGroupPrices = pgTable(
  "customer_group_discounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => customerGroups.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ruleType: text("discount_type").notNull().default("percent"), // percent | fixed
    value: numeric("discount_value", { precision: 19, scale: 4 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_group_discounts_uq").on(t.companyId, t.groupId, t.productId),
    index("customer_group_discounts_group_idx").on(t.companyId, t.groupId),
  ],
);
