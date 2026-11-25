/**
 * Skema domain: penjualan & POS (penjualan, retur penjualan, sesi kas).
 * A-26 Q2: pecahan src/db/schema.ts — definisi dipindah utuh, tanpa perubahan.
 * Impor publik tetap lewat barrel "@/db/schema" (src/db/schema.ts).
 */
import { sql, desc } from "drizzle-orm";
import {
  date,
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
} from "drizzle-orm/pg-core";
import { customers, productPackagings, products } from "./catalog";

/* ------------------------------------------------------------------ */
/* Sales / POS                                                         */
/* ------------------------------------------------------------------ */

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    branchId: uuid("branch_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    number: text("number").notNull(),
    date: date("date").notNull(),
    // POS-1 (D-19): jatuh tempo penjualan utang — wajib terisi bila
    // penjualan melahirkan piutang; null untuk penjualan lunas.
    dueDate: date("due_date"),
    cashierId: text("cashier_id").notNull(),
    sessionId: uuid("session_id"),
    customerId: uuid("customer_id").references(() => customers.id),
    customerGroupId: uuid("customer_group_id"),
    status: text("status").notNull().default("completed"), // held | completed | void | returned
    subtotal: numeric("subtotal", { precision: 19, scale: 4 }).notNull().default("0"),
    discountTotal: numeric("discount_total", { precision: 19, scale: 4 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 19, scale: 4 }).notNull().default("0"),
    roundingAdjustment: numeric("rounding_adjustment", { precision: 19, scale: 4 }).notNull().default("0"),
    roundingMode: text("rounding_mode").notNull().default("none"),
    total: numeric("total", { precision: 19, scale: 4 }).notNull().default("0"),
    costTotal: numeric("cost_total", { precision: 19, scale: 4 }).notNull().default("0"),
    paidTotal: numeric("paid_total", { precision: 19, scale: 4 }).notNull().default("0"),
    changeTotal: numeric("change_total", { precision: 19, scale: 4 }).notNull().default("0"),
    paymentStatus: text("payment_status").notNull().default("paid"), // paid | partial | unpaid
    heldLabel: text("held_label"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("sales_company_id_id_uq").on(t.companyId, t.id),
    uniqueIndex("sales_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("sales_company_idem_uq").on(t.companyId, t.idempotencyKey),
    index("sales_company_date_idx").on(t.companyId, t.date),
    // SIM-2 S4 (PERF-03): riwayat penjualan diurutkan created_at desc
    // (reports.ts listSales) — sebelumnya seq scan + sort penuh
    // (terukur 23,6 ms SQL pada 40 rb penjualan, EXPLAIN di S4).
    index("sales_company_created_idx").on(t.companyId, desc(t.createdAt)),
    index("sales_company_status_idx").on(t.companyId, t.status),
    index("sales_company_customer_idx").on(t.companyId, t.customerId),
  ],
);
export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    productId: uuid("product_id").notNull(),
    lineNo: integer("line_no").notNull().default(0),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 4 }).notNull(),
    discountType: text("discount_type"), // percent | nominal
    discountValue: numeric("discount_value", { precision: 19, scale: 4 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 4 }).notNull().default("0"),
    taxRate: numeric("tax_rate", { precision: 7, scale: 4 }).notNull().default("0"),
    productName: text("product_name").notNull(),
    productSku: text("product_sku").notNull(),
    // Program Satuan Kemasan S4: cuplikan kemasan baris (pola S2/S3).
    // packagingId null = satuan dasar; qtyInput = qty sebagaimana
    // dimasukkan ("1" untuk 1 Dus); isiSnapshot = faktor cuplikan
    // saat baris diposting. Kolom qty/unitPrice yang tersimpan tetap
    // SATUAN DASAR (qty = qtyInput × isiSnapshot, unitPrice = harga
    // kemasan ÷ isi) sehingga ledger, AVCO, dan laporan tak berubah.
    packagingId: uuid("packaging_id"),
    qtyInput: numeric("qty_input", { precision: 19, scale: 4 }).notNull(),
    isiSnapshot: numeric("isi_snapshot", { precision: 19, scale: 4 }).notNull().default("1"),
    /** Seri yang dipilih saat transaksi/hold; kosong untuk non-serial. */
    serialNumbers: jsonb("serial_numbers").$type<string[]>().notNull().default([]),
  },
  (t) => [
    foreignKey({
      name: "sale_lines_company_sale_fk",
      columns: [t.companyId, t.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sale_lines_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }),
    foreignKey({
      name: "sale_lines_company_packaging_fk",
      columns: [t.companyId, t.packagingId],
      foreignColumns: [productPackagings.companyId, productPackagings.id],
    }),
    uniqueIndex("sale_lines_company_id_id_uq").on(t.companyId, t.id),
    index("sale_lines_sale_idx").on(t.saleId),
    index("sale_lines_company_product_idx").on(t.companyId, t.productId),
  ],
);
export const salePayments = pgTable(
  "sale_payments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    methodId: uuid("method_id").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    // A-21 Tahap R3-A (R3-01): fee/MDR yang benar-benar dipotong dari
    // pembayaran ini (0 = tanpa fee). amount tetap bruto (yang dibayar
    // pelanggan); yang masuk akun metode & mutasi bank adalah
    // amount − fee_amount.
    feeAmount: numeric("fee_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    tendered: numeric("tendered", { precision: 19, scale: 4 }).notNull().default("0"),
    reference: text("reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "sale_payments_company_sale_fk",
      columns: [t.companyId, t.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }).onDelete("cascade"),
    index("sale_payments_sale_idx").on(t.saleId),
  ],
);
export const saleReturns = pgTable(
  "sale_returns",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    number: text("number").notNull(),
    date: date("date").notNull(),
    type: text("type").notNull().default("return"), // return | exchange
    status: text("status").notNull().default("posted"),
    idempotencyKey: text("idempotency_key"),
    disposition: text("disposition").notNull().default("sellable"),
    refundMethod: text("refund_method").notNull().default("cash"), // cash | store_credit | exchange
    total: numeric("total", { precision: 19, scale: 4 }).notNull().default("0"),
    /**
     * Nilai barang yang diretur (refundDue: nilai neto termasuk PPN +
     * pembulatan), terpisah dari `total` yang untuk store_credit/exchange
     * adalah nilai voucher kredit. Null untuk baris lama; laporan
     * memakai fallback `total`.
     */
    goodsTotal: numeric("goods_total", { precision: 19, scale: 4 }),
    // D-12: for exchange/store_credit returns this document IS the credit
    // voucher — creditUsed tracks how much of `total` has already been
    // redeemed as a POS payment (methods of type customer_credit).
    creditUsed: numeric("credit_used", { precision: 19, scale: 4 }).notNull().default("0"),
    costTotal: numeric("cost_total", { precision: 19, scale: 4 }).notNull().default("0"),
    reason: text("reason").notNull(),
    createdBy: text("created_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "sale_returns_company_sale_fk",
      columns: [t.companyId, t.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }),
    uniqueIndex("sale_returns_company_id_id_uq").on(t.companyId, t.id),
    uniqueIndex("sale_returns_company_idem_uq").on(t.companyId, t.idempotencyKey),
    uniqueIndex("sale_returns_company_number_uq").on(t.companyId, t.number),
    index("sale_returns_company_date_idx").on(t.companyId, t.date),
    index("sale_returns_company_sale_created_idx").on(t.companyId, t.saleId, t.createdAt),
  ],
);
export const saleReturnLines = pgTable(
  "sale_return_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    returnId: uuid("return_id").notNull(),
    productId: uuid("product_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 4 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }).notNull(),
    productName: text("product_name").notNull(),
    // Program Satuan Kemasan S4: baris retur mewarisi CUPLIKAN baris
    // penjualan asal — saleLineId menunjuk baris asal (pola
    // receipt_line_id retur pembelian S2), packagingId/isiSnapshot
    // disalin dari baris itu (bukan master hari ini), dan qtyInput
    // adalah jumlah retur dalam bentuk masukan baris asal ("1" untuk
    // 1 Dus) sementara qty tetap satuan dasar (qtyInput × isiSnapshot).
    // unitPrice tetap per satuan dasar, disalin dari baris asal.
    // Baris warisan (pra-S4) saleLineId-nya null.
    saleLineId: uuid("sale_line_id"),
    packagingId: uuid("packaging_id"),
    qtyInput: numeric("qty_input", { precision: 19, scale: 4 }).notNull(),
    isiSnapshot: numeric("isi_snapshot", { precision: 19, scale: 4 }).notNull().default("1"),
    /** Seri aktual yang dikembalikan pelanggan (kosong = non-serial). */
    serialNumbers: jsonb("serial_numbers").$type<string[]>().notNull().default([]),
  },
  (t) => [
    foreignKey({
      name: "sale_return_lines_company_return_fk",
      columns: [t.companyId, t.returnId],
      foreignColumns: [saleReturns.companyId, saleReturns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sale_return_lines_company_sale_line_fk",
      columns: [t.companyId, t.saleLineId],
      foreignColumns: [saleLines.companyId, saleLines.id],
    }),
    foreignKey({
      name: "sale_return_lines_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }),
    foreignKey({
      name: "sale_return_lines_company_packaging_fk",
      columns: [t.companyId, t.packagingId],
      foreignColumns: [productPackagings.companyId, productPackagings.id],
    }),
    index("sale_return_lines_return_idx").on(t.returnId),
    index("sale_return_lines_company_product_idx").on(t.companyId, t.productId),
  ],
);
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    branchId: uuid("branch_id"),
    userId: text("user_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    openingCash: numeric("opening_cash", { precision: 19, scale: 4 }).notNull().default("0"),
    expectedCash: numeric("expected_cash", { precision: 19, scale: 4 }),
    countedCash: numeric("counted_cash", { precision: 19, scale: 4 }),
    difference: numeric("difference", { precision: 19, scale: 4 }),
    status: text("status").notNull().default("open"), // open | closed
    notes: text("notes"),
    // A-28 Tahap 1 (H-POS-02): alasan selisih kas saat tutup sesi —
    // wajib terisi bila |selisih| melewati toleransi perusahaan
    // (company_settings.pos_session_difference_tolerance), opsional
    // di dalam toleransi. Terpisah dari `notes` (catatan penutupan
    // umum) agar alasan selisih dapat diaudit & ditampilkan sendiri.
    differenceReason: text("difference_reason"),
  },
  (t) => [
    index("cash_sessions_company_status_idx").on(t.companyId, t.status),
    // POS-SES-01: at most one open session per cashier per company,
    // enforced by the database (the domain check alone races).
    uniqueIndex("cash_sessions_one_open_per_user_uq")
      .on(t.companyId, t.userId)
      .where(sql`status = 'open'`),
  ],
);
export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    type: text("type").notNull(), // opening | sale | refund | deposit | withdrawal | adjustment
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cash_movements_session_idx").on(t.sessionId)],
);

/* ------------------------------------------------------------------ */
/* Terminal POS desktop (POS Native Tauri Langkah 6, RENCANA-TAURI   */
/* D5/D7): registry terminal per perusahaan, kode pasangan sekali    */
/* pakai, dan catatan peninjauan tutup sesi terminal. Token          */
/* perangkat adalah rahasia per-terminal — yang tersimpan di server  */
/* hanya digest SHA-256-nya. Resolusi token terjadi SEBELUM konteks  */
/* tenant dikenal; migrasi 0060 memberi kebijakan RLS tambahan yang  */
/* sempit untuk pencarian berdasarkan digest (lihat                 */
/* server/pos/terminals.ts). Catatan tutup sesi terminal adalah      */
/* FAKTA untuk ditinjau admin — BUKAN sesi kas server: tidak ada     */
/* jurnal yang diposting darinya (sesi web tetap pemilik posting).   */
/* ------------------------------------------------------------------ */

export const posTerminals = pgTable(
  "pos_terminals",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    /** Gudang/cabang tempat terminal menjual; null = gudang bawaan perusahaan. */
    warehouseId: uuid("warehouse_id"),
    name: text("name").notNull(),
    /** Anggota perusahaan yang menjadi aktor penyinkron terminal ini. */
    userId: text("user_id").notNull(),
    /** Digest SHA-256 (hex) token perangkat; null sampai terminal dipasangkan. */
    tokenDigest: text("token_digest"),
    status: text("status").notNull().default("active"), // active | revoked
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pos_terminals_company_status_idx").on(t.companyId, t.status),
    uniqueIndex("pos_terminals_token_digest_uq").on(t.tokenDigest),
  ],
);

export const posPairingCodes = pgTable(
  "pos_pairing_codes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    terminalId: uuid("terminal_id")
      .notNull()
      .references(() => posTerminals.id),
    /** Digest SHA-256 (hex) kode pasangan; kode teks hanya tampil sekali ke admin. */
    codeDigest: text("code_digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pos_pairing_codes_terminal_idx").on(t.terminalId),
    index("pos_pairing_codes_digest_idx").on(t.codeDigest),
  ],
);

/* ------------------------------------------------------------------ */
/* Pengaturan rilis aplikasi desktop POS (POS Native Tauri Langkah   */
/* 7, RENCANA-TAURI D4): SATU baris per perusahaan — versi yang      */
/* ditawarkan endpoint dinamis `/api/pos/update`, persen rollout     */
/* bertahap (bucket deterministik per terminal di domain), dan       */
/* versi minimum shell (di bawahnya pembaruan WAJIB). Artefaknya     */
/* sendiri TIDAK di database: berkas bundel + .sig tinggal di        */
/* direktori rilis server (env BISA_POS_RELEASE_DIR). Pemilik        */
/* tunggal tabel: src/server/pos/releases.ts.                        */
/* ------------------------------------------------------------------ */

export const posDesktopReleaseSettings = pgTable(
  "pos_desktop_release_settings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    /** Versi aplikasi desktop yang ditawarkan ke terminal perusahaan ini. */
    version: text("version").notNull(),
    /** Persen rollout bertahap 0..100 — bucket deterministik per (perusahaan, terminal, versi). */
    rolloutPercent: integer("rollout_percent").notNull().default(0),
    /** Versi minimum shell yang didukung; terminal di bawahnya menerima tawaran WAJIB. */
    minVersion: text("min_version"),
    /** Catatan rilis yang tampil di klien (boleh kosong). */
    notes: text("notes"),
    /** Kapan `version` ini pertama kali ditetapkan (pub_date kontrak updater). */
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pos_desktop_release_settings_company_uq").on(t.companyId)],
);

export const posTerminalSessionReviews = pgTable(
  "pos_terminal_session_reviews",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    terminalId: uuid("terminal_id")
      .notNull()
      .references(() => posTerminals.id),
    /** Kunci idempotensi intent dari terminal (= id intent lokal). */
    clientKey: text("client_key").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    cashierId: text("cashier_id"),
    /** Id sesi kas LOKAL di terminal (bukan cash_sessions server). */
    localSessionId: text("local_session_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    openingCash: numeric("opening_cash", { precision: 19, scale: 4 }).notNull(),
    expectedCash: numeric("expected_cash", { precision: 19, scale: 4 }).notNull(),
    countedCash: numeric("counted_cash", { precision: 19, scale: 4 }).notNull(),
    difference: numeric("difference", { precision: 19, scale: 4 }).notNull(),
    denominations: jsonb("denominations"),
    differenceReason: text("difference_reason"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_terminal_session_reviews_client_key_uq").on(
      t.companyId,
      t.terminalId,
      t.clientKey,
    ),
    index("pos_terminal_session_reviews_company_idx").on(t.companyId, t.receivedAt),
  ],
);
