/**
 * Skema domain: persediaan & pembelian (stok, PO, penerimaan, retur pemasok, dokumen gudang).
 * A-26 Q2: pecahan src/db/schema.ts — definisi dipindah utuh, tanpa perubahan.
 * Impor publik tetap lewat barrel "@/db/schema" (src/db/schema.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CountBreakdownComponent } from "@/lib/packaging";
import { accounts, journalEntries, partyOpeningBalances } from "./accounting";
import { categories, productPackagings, products, suppliers } from "./catalog";
import { departments, employees } from "./hr";
import { warehouses } from "./platform";

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export const stockOnHand = pgTable(
  "stock_on_hand",
  {
    companyId: text("company_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    productId: uuid("product_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "stock_on_hand_company_warehouse_fk",
      columns: [t.companyId, t.warehouseId],
      foreignColumns: [warehouses.companyId, warehouses.id],
    }),
    foreignKey({
      name: "stock_on_hand_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }),
    primaryKey({ columns: [t.companyId, t.warehouseId, t.productId] }),
    index("stock_on_hand_company_product_idx").on(t.companyId, t.productId),
  ],
);
/**
 * Per-batch stock for products with `trackBatch` (G8/D-7). One row per
 * (product × warehouse × batch identity); the row with batch_number and
 * expiry_date both NULL is the "Tanpa batch" remainder that lazily absorbs
 * stock received before tracking was switched on. Invariant: for tracked
 * products, Σ qty over a product+warehouse equals stock_on_hand.
 *
 * The unique index is built on COALESCE expressions because Postgres treats
 * NULLs as distinct in plain unique indexes — without it, the batch-null
 * remainder row (and any number+dateless batch) could be inserted twice.
 * 'infinity' is the sentinel for "no expiry": it sorts after every real
 * date, which is also the FEFO order (no-expiry stock is used last).
 */
export const stockBatches = pgTable(
  "stock_batches",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    productId: uuid("product_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    batchNumber: text("batch_number"),
    expiryDate: date("expiry_date"),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "stock_batches_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }),
    foreignKey({
      name: "stock_batches_company_warehouse_fk",
      columns: [t.companyId, t.warehouseId],
      foreignColumns: [warehouses.companyId, warehouses.id],
    }),
    uniqueIndex("stock_batches_company_id_id_uq").on(t.companyId, t.id),
    uniqueIndex("stock_batches_identity_uq").on(
      t.companyId,
      t.productId,
      t.warehouseId,
      sql`coalesce(${t.batchNumber}, '')`,
      sql`coalesce(${t.expiryDate}, 'infinity'::date)`,
    ),
    index("stock_batches_company_product_idx").on(t.companyId, t.productId, t.warehouseId),
  ],
);
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    productId: uuid("product_id").notNull(),
    // Batch slice this movement belongs to (G8/D-7); null for products
    // without batch tracking and for movements predating migration 0011.
    batchId: uuid("batch_id"),
    movementType: text("movement_type").notNull(), // opening | purchase | sale | sale_return | purchase_return | adjustment | transfer_in | transfer_out | opname | damaged | expired | lost | quarantine
    // FIX-GDG Tahap 2 (GDG3-03): tanggal BISNIS gerakan = tanggal
    // dokumen sumbernya (bukan waktu posting created_at). Rekonsiliasi
    // kontrol persediaan & kartu stok berbasis tanggal menilai subledger
    // dari kolom ini pada unitCost gerakan itu sendiri, selaras dengan
    // kaki GL yang memakai tanggal jurnal. Baris lama di-backfill dari
    // created_at (WIB) oleh migrasi 0044 — pendekatan terdokumentasi di
    // sana; gerakan baru selalu diisi tanggal dokumen oleh domain.
    date: date("date")
      .notNull()
      .default(sql`(now() at time zone 'Asia/Jakarta')::date`),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(), // signed: + in, - out
    unitCost: numeric("unit_cost", { precision: 19, scale: 4 }).notNull().default("0"),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    referenceNumber: text("reference_number"),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "stock_movements_company_warehouse_fk",
      columns: [t.companyId, t.warehouseId],
      foreignColumns: [warehouses.companyId, warehouses.id],
    }),
    foreignKey({
      name: "stock_movements_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }),
    foreignKey({
      name: "stock_movements_company_batch_fk",
      columns: [t.companyId, t.batchId],
      foreignColumns: [stockBatches.companyId, stockBatches.id],
    }),
    index("stock_movements_company_product_idx").on(t.companyId, t.productId, t.createdAt),
    index("stock_movements_company_warehouse_idx").on(t.companyId, t.warehouseId, t.createdAt),
    index("stock_movements_company_ref_idx").on(t.companyId, t.referenceType, t.referenceId),
    index("stock_movements_company_date_idx").on(t.companyId, t.date),
  ],
);
/**
 * Purchase order (G7/D-6). A commitment document, not a stock/accounting
 * document: it moves nothing by itself. Receipts may link to an open order
 * of the same supplier; posting a receipt grows `receivedQty` per line and
 * the order status is derived from the lines (sent → partial → received).
 * Cancellation is only possible before any receipt exists.
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    date: date("date").notNull(),
    expectedDate: date("expected_date"),
    // draft | sent | partial | received | cancelled
    status: text("status").notNull().default("draft"),
    total: numeric("total", { precision: 19, scale: 4 }).notNull().default("0"),
    notes: text("notes"),
    createdBy: text("created_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "purchase_orders_company_supplier_fk",
      columns: [t.companyId, t.supplierId],
      foreignColumns: [suppliers.companyId, suppliers.id],
    }),
    uniqueIndex("purchase_orders_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("purchase_orders_company_id_id_uq").on(t.companyId, t.id),
    index("purchase_orders_company_supplier_idx").on(t.companyId, t.supplierId, t.status),
    index("purchase_orders_company_date_idx").on(t.companyId, t.date),
  ],
);
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id").notNull(),
    // SIM-2 S7 (REM-02): name/SKU snapshot frozen at creation, like
    // sale_lines — renaming the master must not rewrite history.
    productName: text("product_name"),
    productSku: text("product_sku"),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 4 }).notNull(),
    receivedQty: numeric("received_qty", { precision: 19, scale: 4 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }).notNull(),
    // Program Satuan Kemasan S2: cuplikan kemasan baris. packagingId
    // null = satuan dasar; qtyInput = qty sebagaimana dimasukkan
    // ("10" untuk 10 Dus); isiSnapshot = faktor cuplikan saat baris
    // dibuat. `qty`/`unitCost` di atas SELALU satuan dasar
    // (qty = qtyInput × isiSnapshot, unitCost = harga kemasan ÷ isi)
    // — ledger, AVCO & pencocokan tiga arah hanya membaca qty dasar.
    packagingId: uuid("packaging_id"),
    qtyInput: numeric("qty_input", { precision: 19, scale: 4 }).notNull(),
    isiSnapshot: numeric("isi_snapshot", { precision: 19, scale: 4 }).notNull().default("1"),
  },
  (t) => [
    foreignKey({
      name: "purchase_order_lines_company_order_fk",
      columns: [t.companyId, t.orderId],
      foreignColumns: [purchaseOrders.companyId, purchaseOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "purchase_order_lines_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }),
    foreignKey({
      name: "purchase_order_lines_company_packaging_fk",
      columns: [t.companyId, t.packagingId],
      foreignColumns: [productPackagings.companyId, productPackagings.id],
    }),
    index("purchase_order_lines_order_idx").on(t.orderId),
  ],
);
export const stockReceipts = pgTable(
  "stock_receipts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    // Optional link to the purchase order this receipt fulfils (G7/D-6).
    purchaseOrderId: uuid("purchase_order_id"),
    // Nullable since G6/D-5: only purchase receipts require a supplier.
    supplierId: uuid("supplier_id"),
    // purchase | opening | bonus | customer_return | other (D-5)
    source: text("source").notNull().default("purchase"),
    // Set only for cash purchases: the cash/bank account paid from, which
    // makes the receipt born fully paid instead of becoming a payable.
    paymentAccountId: uuid("payment_account_id"),
    supplierInvoiceNumber: text("supplier_invoice_number"),
    // GDG3-06: kunci idempotensi dari klien (pola POS) — submit ulang
    // berkunci sama mengembalikan penerimaan pertama, bukan dokumen baru.
    idempotencyKey: text("idempotency_key"),
    number: text("number").notNull(),
    date: date("date").notNull(),
    status: text("status").notNull().default("posted"), // draft | posted | void
    total: numeric("total", { precision: 19, scale: 4 }).notNull().default("0"),
    // FIX-P1 Tahap 4 (AK1-06/AK4-04): PPN Masukan atas pembelian. Bila
    // penerimaan ditandai "harga termasuk PPN" dan PPN perusahaan aktif,
    // `total` tetap total faktur bruto, `taxAmount` adalah porsi PPN
    // yang dipisah ke akun PPN Masukan (pemetaan `tax_input`), dan
    // persediaan masuk sebesar total − taxAmount (DPP). Tarif yang
    // berlaku saat posting dibekukan di `taxRate` (persen).
    taxRate: numeric("tax_rate", { precision: 7, scale: 4 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | partial | paid
    notes: text("notes"),
    createdBy: text("created_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "stock_receipts_company_warehouse_fk",
      columns: [t.companyId, t.warehouseId],
      foreignColumns: [warehouses.companyId, warehouses.id],
    }),
    foreignKey({
      name: "stock_receipts_company_purchase_order_fk",
      columns: [t.companyId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.companyId, purchaseOrders.id],
    }),
    foreignKey({
      name: "stock_receipts_company_supplier_fk",
      columns: [t.companyId, t.supplierId],
      foreignColumns: [suppliers.companyId, suppliers.id],
    }),
    foreignKey({
      name: "stock_receipts_company_payment_account_fk",
      columns: [t.companyId, t.paymentAccountId],
      foreignColumns: [accounts.companyId, accounts.id],
    }),
    uniqueIndex("stock_receipts_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("stock_receipts_company_id_id_uq").on(t.companyId, t.id),
    uniqueIndex("stock_receipts_company_idem_uq").on(t.companyId, t.idempotencyKey),
    index("stock_receipts_company_date_idx").on(t.companyId, t.date),
  ],
);
export const stockReceiptLines = pgTable(
  "stock_receipt_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    productId: uuid("product_id").notNull(),
    // SIM-2 S7 (REM-02): name/SKU snapshot frozen at posting.
    productName: text("product_name"),
    productSku: text("product_sku"),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 4 }).notNull(),
    /** Nilai baris SETELAH diskon (DPP bila PPN eksplisit). */
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }).notNull(),
    // Diskon baris penerimaan. Berbeda dari sale_lines: `discount_value`
    // nominal di sini adalah TOTAL potongan baris, bukan potongan per
    // unit — faktur pembelian mencantumkan potongan per baris.
    discountType: text("discount_type"), // percent | nominal
    discountValue: numeric("discount_value", { precision: 19, scale: 4 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    // Program Satuan Kemasan S2: cuplikan kemasan baris — semantik
    // sama seperti purchase_order_lines (qty/unitCost selalu satuan
    // dasar; qtyInput & isiSnapshot membekukan bentuk masukan).
    packagingId: uuid("packaging_id"),
    qtyInput: numeric("qty_input", { precision: 19, scale: 4 }).notNull(),
    isiSnapshot: numeric("isi_snapshot", { precision: 19, scale: 4 }).notNull().default("1"),
    // Batch identity received on this line (G8/D-7); batchNumber is
    // required by validation for batch-tracked products, expiry optional.
    batchNumber: text("batch_number"),
    expiryDate: date("expiry_date"),
  },
  (t) => [
    foreignKey({
      name: "stock_receipt_lines_company_receipt_fk",
      columns: [t.companyId, t.receiptId],
      foreignColumns: [stockReceipts.companyId, stockReceipts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_receipt_lines_company_product_fk",
      columns: [t.companyId, t.productId],
      foreignColumns: [products.companyId, products.id],
    }),
    foreignKey({
      name: "stock_receipt_lines_company_packaging_fk",
      columns: [t.companyId, t.packagingId],
      foreignColumns: [productPackagings.companyId, productPackagings.id],
    }),
    index("stock_receipt_lines_receipt_idx").on(t.receiptId),
  ],
);
/**
 * Uang muka / DP pembelian (Accurate-style purchase advance). Dana
 * dibayar ke pemasok SEBELUM barang diterima; sisa `remaining_amount`
 * dipotong FIFO saat penerimaan barang lewat purchase_advance_allocations.
 */
export const purchaseAdvances = pgTable(
  "purchase_advances",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    number: text("number").notNull(),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    remainingAmount: numeric("remaining_amount", { precision: 19, scale: 4 }).notNull(),
    // NULL = uang muka berasal dari kredit retur pembelian (tanpa kas keluar).
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id),
    /** No. faktur uang muka dari pemasok (opsional). */
    taxInvoiceNumber: text("tax_invoice_number"),
    notes: text("notes"),
    status: text("status").notNull().default("open"), // open | partial | used | void
    // manual = dibayar dari kas/bank; return = berasal dari kredit retur pembelian.
    originType: text("origin_type").notNull().default("manual"),
    originReturnId: uuid("origin_return_id").references(() => supplierReturns.id),
    idempotencyKey: text("idempotency_key"),
    createdBy: text("created_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("purchase_advances_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("purchase_advances_company_idem_uq").on(t.companyId, t.idempotencyKey),
    index("purchase_advances_company_supplier_status_idx").on(
      t.companyId,
      t.supplierId,
      t.status,
    ),
    index("purchase_advances_company_date_idx").on(t.companyId, t.date),
    uniqueIndex("purchase_advances_origin_return_uq").on(t.originReturnId),
  ],
);

/** Pemotongan uang muka pada satu penerimaan barang (FIFO saat posting). */
export const purchaseAdvanceAllocations = pgTable(
  "purchase_advance_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    advanceId: uuid("advance_id")
      .notNull()
      .references(() => purchaseAdvances.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => stockReceipts.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("purchase_advance_allocations_advance_receipt_uq").on(
      t.companyId,
      t.advanceId,
      t.receiptId,
    ),
    index("purchase_advance_allocations_receipt_idx").on(t.receiptId),
  ],
);

/**
 * Supplier returns / purchase returns (A-9, D-20). A dedicated document —
 * NOT the adjustment family — because a return toward a supplier is a
 * claim lifecycle, not a write-off: posting takes stock out at the
 * running AVCO and debits the supplier's open payable up to its balance;
 * any excess becomes the "Kredit Pemasok" asset claim (mapping
 * `supplier_credit`), which is then settled over time by resolutions
 * (apply to a later payable, cash refund, replacement goods, or an
 * "other" written close). Status: draft → posted → partially_resolved →
 * resolved, or void (drafts are deleted; posted returns are voided only
 * before any resolution exists, via stock-in + journal reversal).
 */
export const supplierReturns = pgTable(
  "supplier_returns",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
    date: date("date").notNull(),
    // damaged | expired | wrong_item | over_delivery | quality | other
    reasonCategory: text("reason_category").notNull(),
    // Free-text detail, mandatory (the category alone is never enough).
    reasonDetail: text("reason_detail").notNull(),
    // replacement | next_purchase_credit | purchase_advance | refund | other —
    // the declared settlement intent chosen when the return is made;
    // individual resolutions record what actually happened and may mix.
    resolutionType: text("resolution_type").notNull(),
    resolutionNote: text("resolution_note"),
    // draft | posted | partially_resolved | resolved | void
    status: text("status").notNull().default("draft"),
    // GDG3-06: kunci idempotensi dari klien (pola POS), seperti penerimaan.
    idempotencyKey: text("idempotency_key"),
    // Σ line qty × AVCO at posting; frozen by postSupplierReturn.
    totalValue: numeric("total_value", { precision: 19, scale: 4 }).notNull().default("0"),
    // FIX-P1 Tahap 4 (AK1-06/AK4-04): porsi PPN Masukan yang direversi
    // saat posting retur ini (Cr PPN Masukan, menambah debit utang),
    // dihitung proporsional dari penerimaan ber-PPN yang dialokasikan
    // FIFO. Nol untuk retur atas penerimaan tanpa PPN.
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    // Portion of totalValue settled against the supplier's open payable
    // at posting (Dr payable); the rest is the supplier-credit claim.
    payableAmount: numeric("payable_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    creditAmount: numeric("credit_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    // Σ resolutions consuming the claim; claim remaining = credit − this.
    resolvedAmount: numeric("resolved_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    // Set when an "other" close is forced with claim remaining: the
    // remainder STAYS on the books (no silent asset write-off) and the
    // note records who closed it and why.
    closedWithRemainder: boolean("closed_with_remainder").notNull().default(false),
    closeNote: text("close_note"),
    createdBy: text("created_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("supplier_returns_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("supplier_returns_company_idem_uq").on(t.companyId, t.idempotencyKey),
    index("supplier_returns_company_supplier_idx").on(t.companyId, t.supplierId, t.status),
    index("supplier_returns_company_date_idx").on(t.companyId, t.date),
  ],
);
export const supplierReturnLines = pgTable(
  "supplier_return_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => supplierReturns.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    // SIM-2 S7 (REM-02): name/SKU snapshot frozen at creation.
    productName: text("product_name"),
    productSku: text("product_sku"),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    // AVCO (products.costPrice) frozen at posting; drafts carry 0.
    unitCost: numeric("unit_cost", { precision: 19, scale: 4 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }).notNull().default("0"),
    // Batch the goods leave from, for batch-tracked products. Optional:
    // without it the outbound allocation follows the correction FEFO
    // pattern; with it, exactly that batch is debited.
    batchId: uuid("batch_id").references(() => stockBatches.id),
    // Optional traceability back to the receipt line the goods came in on.
    receiptLineId: uuid("receipt_line_id").references(() => stockReceiptLines.id),
    // Program Satuan Kemasan S2: cuplikan kemasan baris — semantik
    // sama seperti purchase_order_lines. Baris yang lahir dari
    // penerimaan berkemasan mewarisi packagingId & isiSnapshot BARIS
    // ASALNYA (bukan master hari ini), jadi faktor lama tetap berlaku
    // walau isi master sudah berubah.
    packagingId: uuid("packaging_id").references(() => productPackagings.id),
    qtyInput: numeric("qty_input", { precision: 19, scale: 4 }).notNull(),
    isiSnapshot: numeric("isi_snapshot", { precision: 19, scale: 4 }).notNull().default("1"),
    // Qty already replaced by replacement receipts (receiveReplacement).
    replacedQty: numeric("replaced_qty", { precision: 19, scale: 4 }).notNull().default("0"),
  },
  (t) => [index("supplier_return_lines_return_idx").on(t.returnId)],
);
/**
 * One settlement event against a return's supplier-credit claim. Every
 * kind except a zero-remainder "other" close posts its own journal
 * (sourceId = the return) and grows supplier_returns.resolved_amount.
 */
export const supplierReturnResolutions = pgTable(
  "supplier_return_resolutions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => supplierReturns.id, { onDelete: "cascade" }),
    // apply_credit | refund | replacement | other
    kind: text("kind").notNull(),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    // Refund: the cash/bank account the money came back into.
    accountId: uuid("account_id"),
    // Replacement: which return line was replaced, and how many units.
    returnLineId: uuid("return_line_id").references(() => supplierReturnLines.id),
    qty: numeric("qty", { precision: 19, scale: 4 }),
    note: text("note"),
    journalId: uuid("journal_id").references(() => journalEntries.id),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("supplier_return_resolutions_return_idx").on(t.returnId)],
);
/**
 * How much of a return's value was settled against each open payable
 * document (a credit purchase receipt or an opening-balance payable),
 * written at posting time and by applySupplierCredit, oldest first.
 * listPayables and the payment actions subtract these allocations so a
 * return can never be paid twice — once as a credit, once as cash.
 */
export const supplierReturnAllocations = pgTable(
  "supplier_return_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => supplierReturns.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id"),
    openingId: uuid("opening_id").references(() => partyOpeningBalances.id),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("supplier_return_allocations_return_idx").on(t.returnId),
    index("supplier_return_allocations_receipt_idx").on(t.receiptId),
    index("supplier_return_allocations_opening_idx").on(t.openingId),
  ],
);
export const stockDocuments = pgTable(
  "stock_documents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    type: text("type").notNull(), // adjustment | opname | transfer | purchase_return
    number: text("number").notNull(),
    date: date("date").notNull(),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    toWarehouseId: uuid("to_warehouse_id").references(() => warehouses.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    status: text("status").notNull().default("draft"), // draft | pending | posted | rejected | void
    // GDG3-06: kunci idempotensi dari klien (pola POS) untuk penyesuaian,
    // transfer, dan opname — satu kolom untuk seluruh keluarga dokumen stok.
    idempotencyKey: text("idempotency_key"),
    reason: text("reason"),
    refundMethod: text("refund_method"), // cash | credit_note | replacement | deduction
    total: numeric("total", { precision: 19, scale: 4 }).notNull().default("0"),
    notes: text("notes"),
    createdBy: text("created_by"),
    // T5-3 (D-17): approval trail for adjustments that waited for a
    // checker (status pending → posted/rejected). Rejection keeps its
    // reason next to the document so the maker can see why.
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    // SIM-2 S7B-2 (§4): transfer dua tahap — dokumen berstatus
    // `in_transit` sesudah kirim; kolom ini terisi saat gudang tujuan
    // menerima (status menjadi `posted`). Transfer satu tahap dan
    // dokumen lain membiarkannya null.
    receivedBy: text("received_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    // FIX-GDG Tahap 2 (GDG1-07): alasan wajib saat sisa kirim transfer
    // dua tahap ditutup sebagai selisih perjalanan (barang hilang/
    // rusak di jalan). Null = tidak ada selisih yang ditutup.
    differenceReason: text("difference_reason"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_documents_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("stock_documents_company_idem_uq").on(t.companyId, t.idempotencyKey),
    index("stock_documents_company_type_date_idx").on(t.companyId, t.type, t.date),
  ],
);
export const stockDocumentLines = pgTable(
  "stock_document_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => stockDocuments.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    // SIM-2 S7 (REM-02): name/SKU snapshot frozen at creation.
    productName: text("product_name"),
    productSku: text("product_sku"),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    // Program Satuan Kemasan S3: cuplikan kemasan baris, pola S2.
    // Transfer & penyesuaian: packagingId terisi ⇒ qtyInput adalah qty
    // sebagaimana dimasukkan dalam kemasan itu dan qty (satuan dasar)
    // = qtyInput × isiSnapshot. Opname berbeda makna secara sadar:
    // qty tetap SELISIH terhadap sistem, qtyInput adalah HASIL HITUNG
    // fisik dalam satuan dasar, isiSnapshot 1, packagingId null —
    // bentuk masukan campurannya hidup di countBreakdown.
    packagingId: uuid("packaging_id").references(() => productPackagings.id),
    qtyInput: numeric("qty_input", { precision: 19, scale: 4 }).notNull(),
    isiSnapshot: numeric("isi_snapshot", { precision: 19, scale: 4 }).notNull().default("1"),
    // S3: rincian komponen hitungan campuran opname (dus utuh + pak
    // utuh + pcs lepas), cuplikan nama & faktor per komponen —
    // dapat diaudit persis sebagaimana dihitung. Null untuk baris
    // non-opname dan opname hitungan satuan dasar murni.
    countBreakdown: jsonb("count_breakdown").$type<CountBreakdownComponent[]>(),
    // FIX-GDG Tahap 2 (GDG1-07): qty yang sudah benar-benar diterima
    // gudang tujuan pada transfer dua tahap. Baris non-transfer selalu
    // 0. Sisa kirim = qty − received_qty; sisa itu dapat diterima lagi
    // pada penerimaan berikutnya atau ditutup sebagai selisih
    // perjalanan (stock_documents.difference_reason).
    receivedQty: numeric("received_qty", { precision: 19, scale: 4 }).notNull().default("0"),
    systemQty: numeric("system_qty", { precision: 19, scale: 4 }),
    unitCost: numeric("unit_cost", { precision: 19, scale: 4 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }).notNull().default("0"),
    reason: text("reason"),
  },
  (t) => [index("stock_document_lines_doc_idx").on(t.documentId)],
);
/**
 * A-24 T3 (pola G3): tugas opname — lapisan penugasan DI ATAS domain
 * opname yang sudah ada, bukan status dokumen baru. Opname tetap
 * dibuat & terposting lewat createOpname seperti sebelumnya; tabel
 * ini hanya mencatat siapa ditugasi menghitung gudang/kategori apa,
 * dan tugas berstatus `open` selesai otomatis saat yang ditugasi
 * memposting opname untuk gudang tugasnya (atau ditandai selesai /
 * dibatalkan manual). Tidak ada baris stok/jurnal yang bergantung
 * pada tabel ini.
 */
export const opnameTasks = pgTable(
  "opname_tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    categoryId: uuid("category_id").references(() => categories.id),
    /** Pengguna (member perusahaan) yang ditugasi menghitung. */
    assigneeId: text("assignee_id").notNull(),
    dueDate: date("due_date"),
    status: text("status").notNull().default("open"), // open | done | cancelled
    /** Dokumen opname yang menyelesaikan tugas (terisi saat selesai). */
    documentId: uuid("document_id").references(() => stockDocuments.id),
    notes: text("notes"),
    createdBy: text("created_by"),
    completedBy: text("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("opname_tasks_company_status_idx").on(t.companyId, t.status),
    index("opname_tasks_company_assignee_idx").on(t.companyId, t.assigneeId, t.status),
  ],
);
/* ------------------------------------------------------------------ */
/* SIM-2 S7B-2 (§3) — Purchase Request                                 */
/*                                                                     */
/* PR adalah dokumen permintaan internal: peminta + departemen +       */
/* baris produk/jasa dengan perkiraan harga & alasan. Ia tidak         */
/* menggerakkan stok maupun jurnal. Siklus: submitted → approved /     */
/* rejected; PR approved dikonversi menjadi SATU PO (tautan            */
/* converted_po_id) dan berstatus converted — konversi kedua ditolak.  */
/* ------------------------------------------------------------------ */

export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    requesterEmployeeId: uuid("requester_employee_id").references(() => employees.id),
    departmentId: uuid("department_id").references(() => departments.id),
    date: date("date").notNull(),
    // submitted | approved | rejected | converted
    status: text("status").notNull().default("submitted"),
    totalEstimate: numeric("total_estimate", { precision: 19, scale: 4 }).notNull().default("0"),
    notes: text("notes"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    convertedPoId: uuid("converted_po_id").references(() => purchaseOrders.id),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("purchase_requests_company_number_uq").on(t.companyId, t.number),
    index("purchase_requests_company_status_idx").on(t.companyId, t.status, t.date),
  ],
);
export const purchaseRequestLines = pgTable(
  "purchase_request_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    productName: text("product_name"),
    productSku: text("product_sku"),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    estimatedPrice: numeric("estimated_price", { precision: 19, scale: 4 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 19, scale: 4 }).notNull().default("0"),
    reason: text("reason"),
  },
  (t) => [index("purchase_request_lines_request_idx").on(t.requestId)],
);
/* ------------------------------------------------------------------ */
/* SIM-2 S7B-2 (§4) — Reservasi stok                                   */
/*                                                                     */
/* Reservasi adalah janji ketersediaan, BUKAN gerakan stok: ia tidak   */
/* menyentuh stock_on_hand maupun stock_movements (invariant ledger    */
/* utuh), tetapi mengurangi stok TERSEDIA (on hand − reserved aktif)   */
/* pada pemeriksaan ketersediaan POS/penjualan. Kedaluwarsa dinilai    */
/* saat dibaca (expires_at lewat = tidak aktif) tanpa butuh cron.      */
/* ------------------------------------------------------------------ */

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    qty: numeric("qty", { precision: 19, scale: 4 }).notNull(),
    date: date("date").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reason: text("reason"),
    // active | released | expired | cancelled — expired dinilai saat
    // dibaca; status tersimpan hanya berubah lewat rilis/batal eksplisit.
    status: text("status").notNull().default("active"),
    releasedBy: text("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_reservations_company_number_uq").on(t.companyId, t.number),
    index("stock_reservations_company_avail_idx").on(t.companyId, t.warehouseId, t.productId, t.status),
  ],
);
/* ------------------------------------------------------------------ */
/* SIM-2 S7B-2 (§4) — Nomor seri                                       */
/*                                                                     */
/* Satu baris per unit fisik produk track_serial. Status berjalan:     */
/* in_stock (di gudang pada warehouse_id) | in_transit (transfer dua   */
/* tahap sedang berjalan) | out (sudah keluar: terjual/retur ke        */
/* pemasok/penyesuaian keluar) | void (penerimaannya dibatalkan).      */
/* Setiap perubahan status dicatat di stock_serial_movements dengan    */
/* dokumen sumbernya — itulah kartu seri per produk.                   */
/* ------------------------------------------------------------------ */

export const stockSerials = pgTable(
  "stock_serials",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    serialNumber: text("serial_number").notNull(),
    // in_stock | in_transit | out | void
    status: text("status").notNull().default("in_stock"),
    receiptId: uuid("receipt_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Nomor seri unik per produk dalam perusahaan — unit yang sama
    // tidak dapat diterima dua kali.
    uniqueIndex("stock_serials_company_product_serial_uq").on(t.companyId, t.productId, t.serialNumber),
    index("stock_serials_company_product_status_idx").on(t.companyId, t.productId, t.status),
    index("stock_serials_company_warehouse_idx").on(t.companyId, t.warehouseId, t.status),
  ],
);
export const stockSerialMovements = pgTable(
  "stock_serial_movements",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    serialId: uuid("serial_id")
      .notNull()
      .references(() => stockSerials.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    // in | out | restore | transfer_out | transfer_in | void
    kind: text("kind").notNull(),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    referenceNumber: text("reference_number"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_serial_movements_serial_idx").on(t.serialId, t.createdAt),
    index("stock_serial_movements_company_product_idx").on(t.companyId, t.productId, t.createdAt),
  ],
);
