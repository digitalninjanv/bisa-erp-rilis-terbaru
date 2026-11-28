/**
 * Skema domain: akuntansi (akun, jurnal, buku besar, bank, aset tetap, piutang/utang).
 * A-26 Q2: pecahan src/db/schema.ts — definisi dipindah utuh, tanpa perubahan.
 * Impor publik tetap lewat barrel "@/db/schema" (src/db/schema.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
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
import type { QuickEntryPayload, QuickEntryPostResult } from "@/lib/quick-entry";
import { suppliers } from "./catalog";

/* ------------------------------------------------------------------ */
/* Chart of accounts and ledger                                        */
/* ------------------------------------------------------------------ */

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // asset | liability | equity | revenue | expense | cogs
    normalBalance: text("normal_balance").notNull(), // debit | credit
    parentId: uuid("parent_id"),
    section: text("section"), // current_asset | non_current_asset | current_liability | non_current_liability | equity | revenue | other_income | cogs | operating_expense | other_expense
    cashFlowGroup: text("cash_flow_group"), // operating | investing | financing
    // A-27 B1: kelas kas/bank adalah SIFAT akun (bukan slot pemetaan) —
    // keanggotaan kas/bank diturunkan dari kelas ini (B2). null = bukan
    // akun kas/bank. Pemetaan cash/bank/qris tetap ada sebagai penunjuk
    // akun BAWAAN (sesi POS dsb.), bukan penentu keanggotaan.
    cashBankKind: text("cash_bank_kind"), // cash | bank | clearing
    // Rincian bank — hanya bermakna untuk cashBankKind = 'bank' (pola
    // Accurate: kondisional per kelas). Nomor rekening tersimpan penuh,
    // ditampilkan termasker di UI (B3).
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankBranch: text("bank_branch"),
    bankAccountHolder: text("bank_account_holder"),
    // Mata uang akun (rincian bank); bawaan IDR. Multi-mata-uang penuh
    // (saldo/jurnal valas) di luar cakupan A-27 — ini data rincian.
    currency: text("currency").notNull().default("IDR"),
    // A-27 B5: tagging PSAK 118 (kesiapan data — penulis laporan TIDAK
    // membaca kolom ini di A-27). Kategori presentasi laba rugi:
    // operating | investing | financing | income_tax | discontinued;
    // null untuk akun neraca. Bawaan deterministik dari tipe/section
    // hidup di src/lib/akuntansi/psak118.ts (defaultPsak118Tags).
    psak118Category: text("psak118_category"),
    // Sifat & fungsi beban (hanya akun cogs/expense): daftar nilai
    // terkendali di lib/akuntansi/psak118.ts (EXPENSE_NATURES /
    // EXPENSE_FUNCTIONS).
    expenseNature: text("expense_nature"),
    expenseFunction: text("expense_function"), // cogs | selling | admin
    // Penanda kontra (audit §5.8): status kontra dibaca dari DATA —
    // flag ini + tautan akun induk yang dikontra (contraOf, uuid tanpa
    // FK seperti parentId; keabsahan sekantor ditegakkan aksi simpan).
    isContra: boolean("is_contra").notNull().default(false),
    contraOf: uuid("contra_of"),
    description: text("description"),
    isPostable: boolean("is_postable").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_company_code_uq").on(t.companyId, t.code),
    uniqueIndex("accounts_company_id_id_uq").on(t.companyId, t.id),
  ],
);
export const accountMappings = pgTable(
  "account_mappings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    key: text("key").notNull(),
    accountId: uuid("account_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("account_mappings_company_key_uq").on(t.companyId, t.key)],
);
export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: text("status").notNull().default("open"), // open | closed | locked
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
  },
  (t) => [uniqueIndex("fiscal_periods_company_period_uq").on(t.companyId, t.year, t.month)],
);
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    date: date("date").notNull(),
    description: text("description").notNull(),
    sourceType: text("source_type").notNull().default("manual"), // manual | sale | sale_return | purchase | adjustment | expense | bank_transfer | payroll | payment | opening
    sourceId: uuid("source_id"),
    status: text("status").notNull().default("posted"), // draft | posted | void
    reversalOfId: uuid("reversal_of_id"),
    idempotencyKey: text("idempotency_key"),
    createdBy: text("created_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_entries_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("journal_entries_company_idem_uq").on(t.companyId, t.idempotencyKey),
    uniqueIndex("journal_entries_company_id_id_uq").on(t.companyId, t.id),
    index("journal_entries_company_date_idx").on(t.companyId, t.date),
    index("journal_entries_company_source_idx").on(t.companyId, t.sourceType, t.sourceId),
    // SIM-2 S4 (PERF-03): indeks trigram untuk pencarian ilike jurnal
    // SENGAJA tidak dipasang. Bukti EXPLAIN (docs/sim2/S4-BENCHMARK.md):
    // operator LIKE/ILIKE tidak leakproof, sehingga di bawah FORCE RLS
    // planner tidak boleh memakainya sebagai index qual untuk peran
    // aplikasi — indeks GIN trigram terbukti tidak pernah terpilih
    // (yang terpilih justru awalan b-tree company_id). Indeks trigram
    // di sini hanya akan memajaki setiap insert tanpa pernah terbaca.
  ],
);
export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    accountId: uuid("account_id").notNull(),
    debit: numeric("debit", { precision: 19, scale: 4 }).notNull().default("0"),
    credit: numeric("credit", { precision: 19, scale: 4 }).notNull().default("0"),
    description: text("description"),
    partyType: text("party_type"), // customer | supplier | employee
    partyId: uuid("party_id"),
    lineNo: integer("line_no").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "journal_lines_company_entry_fk",
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "journal_lines_company_account_fk",
      columns: [t.companyId, t.accountId],
      foreignColumns: [accounts.companyId, accounts.id],
    }),
    index("journal_lines_entry_idx").on(t.entryId),
    index("journal_lines_company_account_idx").on(t.companyId, t.accountId),
  ],
);
/**
 * FIX-ARS Tahap 2 (ARS3-01 / requirement R-4): ringkasan saldo bulanan
 * per akun — total debit & kredit jurnal POSTED per (company, account,
 * bulan tanggal jurnal). Dipelihara HANYA oleh postJournal dalam
 * transaksi posting yang sama (jurnal pembalik adalah jurnal baru
 * bertanggal sendiri, jadi ikut terhitung dengan benar), dan di-backfill
 * oleh migrasi 0046 untuk jurnal lama. Laporan membaca hibrida:
 * bulan-bulan penuh dari tabel ini, bulan parsial berjalan dari agregat
 * mentah journal_lines — hasil identik dengan agregat penuh, tanpa
 * memindai seluruh riwayat. Baris di tabel ini adalah turunan murni:
 * sumber kebenaran tetap journal_entries/journal_lines.
 */
export const accountMonthlyBalances = pgTable(
  "account_monthly_balances",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    accountId: uuid("account_id").notNull(),
    yearMonth: text("year_month").notNull(), // 'YYYY-MM' dari tanggal jurnal
    totalDebit: numeric("total_debit", { precision: 19, scale: 4 }).notNull().default("0"),
    totalCredit: numeric("total_credit", { precision: 19, scale: 4 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "account_monthly_balances_company_account_fk",
      columns: [t.companyId, t.accountId],
      foreignColumns: [accounts.companyId, accounts.id],
    }),
    uniqueIndex("account_monthly_balances_company_account_month_uq").on(
      t.companyId,
      t.accountId,
      t.yearMonth,
    ),
    index("account_monthly_balances_company_month_idx").on(t.companyId, t.yearMonth),
  ],
);
/* ------------------------------------------------------------------ */
/* Expenses, transfers, payroll, payments                              */
/* ------------------------------------------------------------------ */

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    date: date("date").notNull(),
    expenseAccountId: uuid("expense_account_id").notNull(),
    // A-21 (R3-11, migrasi 0049): beban terutang tidak punya akun
    // pembayaran saat dicatat — kolom ini kini nullable; mode dokumen
    // dibedakan oleh supplier_id: terisi = beban terutang ke pemasok
    // (dibayar belakangan lewat party_payments.expense_id), kosong =
    // beban tunai yang lahir terbayar seperti sebelumnya.
    paymentAccountId: uuid("payment_account_id"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    // Jumlah yang sudah dibayar lewat jalur utang (hanya bermakna
    // untuk beban terutang; beban tunai lahir dengan paid penuh).
    paidAmount: numeric("paid_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    // paid | unpaid | partial — pola payment_status penerimaan.
    paymentStatus: text("payment_status").notNull().default("paid"),
    // FIX-P1 Tahap 4 (AK1-06/AK4-04): opsi "Termasuk PPN" (A-12 yang
    // tertunda). `amount` tetap nominal bruto yang dibayar; bila opsi
    // aktif, `taxAmount` dipisah ke PPN Masukan dan akun beban hanya
    // dibebankan amount − taxAmount (DPP). `taxRate` = tarif saat posting.
    taxRate: numeric("tax_rate", { precision: 7, scale: 4 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    description: text("description").notNull(),
    status: text("status").notNull().default("posted"),
    // A-21 R3-04: kunci idempotensi dari klien (pola AK-P3-02/GDG3-06) —
    // submit ulang berkunci sama mengembalikan beban pertama, bukan
    // dokumen baru.
    idempotencyKey: text("idempotency_key"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("expenses_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("expenses_company_idem_uq").on(t.companyId, t.idempotencyKey),
    // SIM-2 S4 (PERF-03): listExpenses selalu menyaring perusahaan +
    // rentang tanggal; sebelumnya tabel ini tanpa indeks sekunder sama
    // sekali sehingga setiap daftar adalah seq scan.
    index("expenses_company_date_idx").on(t.companyId, t.date),
    // A-21 (R3-11): daftar utang & FIFO menyaring beban terutang per
    // pemasok + status bayar.
    index("expenses_company_supplier_idx").on(t.companyId, t.supplierId, t.paymentStatus),
  ],
);
export const bankTransfers = pgTable(
  "bank_transfers",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    date: date("date").notNull(),
    fromAccountId: uuid("from_account_id").notNull(),
    toAccountId: uuid("to_account_id").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    fee: numeric("fee", { precision: 19, scale: 4 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    status: text("status").notNull().default("posted"), // posted | void
    reference: text("reference"),
    description: text("description"),
    // A-21 R3-04: kunci idempotensi dari klien (pola AK-P3-02/GDG3-06) —
    // submit ulang berkunci sama mengembalikan transfer pertama, bukan
    // dokumen baru.
    idempotencyKey: text("idempotency_key"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bank_transfers_company_number_uq").on(t.companyId, t.number),
    uniqueIndex("bank_transfers_company_idem_uq").on(t.companyId, t.idempotencyKey),
  ],
);
/* Bank reconciliation (T4-2 / D-11): imported statement lines live outside
 * the ledger; each may be linked to exactly one journal line on the same
 * GL cash/bank account. The fingerprint deduplicates re-imports. */
export const bankStatementImports = pgTable(
  "bank_statement_imports",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    fileName: text("file_name").notNull(),
    importedBy: text("imported_by"),
    totalRows: integer("total_rows").notNull().default(0),
    insertedRows: integer("inserted_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    // Saldo akhir pada rekening koran + tanggal cut-off-nya. Diisi
    // operator saat impor agar rekonsiliasi punya titik selesai yang
    // bisa dibandingkan dengan saldo buku per tanggal yang sama.
    statementEndingBalance: numeric("statement_ending_balance", { precision: 19, scale: 4 }),
    statementEndDate: date("statement_end_date"),
    // Sign-off rekonsiliasi per berkas impor. Hanya boleh diisi bila
    // semua baris impor sudah tertaut ke jurnal.
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledBy: text("reconciled_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bank_statement_imports_company_account_idx").on(t.companyId, t.accountId)],
);
export const bankStatementLines = pgTable(
  "bank_statement_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    importId: uuid("import_id")
      .notNull()
      .references(() => bankStatementImports.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    date: date("date").notNull(),
    description: text("description").notNull(),
    debit: numeric("debit", { precision: 19, scale: 4 }).notNull().default("0"),
    credit: numeric("credit", { precision: 19, scale: 4 }).notNull().default("0"),
    fingerprint: text("fingerprint").notNull(),
    matchedJournalLineId: uuid("matched_journal_line_id").references(() => journalLines.id),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bank_statement_lines_company_fingerprint_uq").on(t.companyId, t.fingerprint),
    index("bank_statement_lines_company_account_idx").on(t.companyId, t.accountId, t.date),
    // T4R-4: satu baris jurnal hanya boleh diklaim satu baris mutasi —
    // ditegakkan database, bukan hanya pemeriksaan aplikasi.
    uniqueIndex("bank_statement_lines_matched_journal_line_uq")
      .on(t.matchedJournalLineId)
      .where(sql`${t.matchedJournalLineId} is not null`),
  ],
);
/* ------------------------------------------------------------------ */
/* SIM-2 S7B-2 (§8) — Aset tetap & penyusutan                           */
/*                                                                     */
/* Kategori aset adalah master terkonfigurasi: umur manfaat bawaan     */
/* dan akun per kategori (aset / akumulasi / beban penyusutan) hidup   */
/* di baris kategori; nilai kosong jatuh ke pemetaan perusahaan        */
/* (fixed_asset / accumulated_depreciation / depreciation_expense).    */
/* Penyusutan garis lurus: (harga perolehan − nilai residu) ÷ umur     */
/* manfaat bulan, mulai bulan perolehan, cicilan terakhir menyerap     */
/* sisa pembulatan. Satu run per periode untuk semua aset aktif —      */
/* keunikan periode dijaga indeks parsial pada tabel runs.             */
/* ------------------------------------------------------------------ */

export const fixedAssetCategories = pgTable(
  "fixed_asset_categories",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    defaultUsefulLifeMonths: integer("default_useful_life_months"),
    defaultResidualPercent: numeric("default_residual_percent", { precision: 7, scale: 4 }),
    assetAccountId: uuid("asset_account_id").references(() => accounts.id),
    accumulatedAccountId: uuid("accumulated_account_id").references(() => accounts.id),
    expenseAccountId: uuid("expense_account_id").references(() => accounts.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fixed_asset_categories_company_code_uq").on(t.companyId, t.code)],
);
export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => fixedAssetCategories.id),
    acquisitionDate: date("acquisition_date").notNull(),
    cost: numeric("cost", { precision: 19, scale: 4 }).notNull(),
    residualValue: numeric("residual_value", { precision: 19, scale: 4 }).notNull().default("0"),
    usefulLifeMonths: integer("useful_life_months").notNull(),
    method: text("method").notNull().default("straight_line"), // straight_line (satu-satunya metode saat ini)
    // Akun sumber perolehan (kas/bank untuk pembelian, ekuitas untuk
    // aset awal) dan jurnal perolehannya.
    sourceAccountId: uuid("source_account_id").references(() => accounts.id),
    journalId: uuid("journal_id"),
    // Pelepasan (penjualan/penghapusan): terisi sekali, menghentikan
    // penyusutan sejak bulan pelepasan.
    status: text("status").notNull().default("active"), // active | disposed
    disposalDate: date("disposal_date"),
    disposalProceeds: numeric("disposal_proceeds", { precision: 19, scale: 4 }),
    disposalAccountId: uuid("disposal_account_id").references(() => accounts.id),
    disposalJournalId: uuid("disposal_journal_id"),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fixed_assets_company_number_uq").on(t.companyId, t.number),
    index("fixed_assets_company_status_idx").on(t.companyId, t.status),
  ],
);
export const fixedAssetDepreciationRuns = pgTable(
  "fixed_asset_depreciation_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    period: text("period").notNull(), // YYYY-MM
    totalAmount: numeric("total_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    assetCount: integer("asset_count").notNull().default(0),
    journalId: uuid("journal_id"),
    status: text("status").notNull().default("posted"), // posted | void
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Satu run posted per periode — proses ulang periode yang sama
    // ditolak di database, bukan hanya di aplikasi.
    uniqueIndex("fixed_asset_depr_runs_company_period_uq")
      .on(t.companyId, t.period)
      .where(sql`${t.status} <> 'void'`),
  ],
);
export const fixedAssetDepreciations = pgTable(
  "fixed_asset_depreciations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => fixedAssetDepreciationRuns.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => fixedAssets.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // YYYY-MM
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    accumulatedAfter: numeric("accumulated_after", { precision: 19, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fixed_asset_depreciations_asset_period_uq").on(t.companyId, t.assetId, t.period),
    index("fixed_asset_depreciations_run_idx").on(t.runId),
  ],
);
/**
 * A-12 (D-23): draf modal Catat Transaksi — draf beneran di server,
 * milik satu pengguna dalam satu perusahaan. Payload adalah bentuk
 * formulir (src/lib/quick-entry.ts); payload draf TIDAK pernah
 * dipercaya saat posting — posting memvalidasi ulang dari nol lewat
 * jalur normal, jadi draf yang dirusak di DB tetap ditolak.
 */
export const quickEntryDrafts = pgTable(
  "quick_entry_drafts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(), // cash_sale | expense | receive | pay | transfer
    payload: jsonb("payload").$type<QuickEntryPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quick_entry_drafts_company_user_idx").on(t.companyId, t.userId, t.updatedAt)],
);
/**
 * A-12 (D-23): penanda idempotensi posting Catat Transaksi. Satu baris
 * per (perusahaan, kunci idempotensi sesi formulir); hasil posting
 * disimpan agar retry/klik ganda mengembalikan hasil yang sama tanpa
 * memposting dua kali — pola AK-P3-02 diperluas ke kelima jenis.
 */
export const quickEntrySubmissions = pgTable(
  "quick_entry_submissions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").notNull(),
    result: jsonb("result").$type<QuickEntryPostResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quick_entry_submissions_company_key_uq").on(t.companyId, t.idempotencyKey),
  ],
);
export const partyPayments = pgTable(
  "party_payments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    type: text("type").notNull(), // receivable | payable
    partyType: text("party_type").notNull(), // customer | supplier
    partyId: uuid("party_id").notNull(),
    saleId: uuid("sale_id"),
    receiptId: uuid("receipt_id"),
    // A-21 (R3-11, migrasi 0049): pembayaran yang melunasi beban
    // terutang menunjuk ke expenses; sale_id/receipt_id/opening_id
    // tetap null untuknya — pola kolom yang sama seperti opening_id.
    expenseId: uuid("expense_id").references(() => expenses.id),
    // T4-5b (D-14): pembayaran yang melunasi dokumen saldo awal menunjuk
    // ke party_opening_balances; sale_id/receipt_id tetap null untuknya.
    openingId: uuid("opening_id").references(() => partyOpeningBalances.id),
    // A-21 (R3-02, migrasi 0050): pembayaran yang didanai kredit pihak
    // menunjuk ke dokumen kreditnya di party_credits; account_id baris
    // ini adalah akun kredit terpeta (customer_credit/supplier_credit),
    // bukan akun kas/bank — jurnalnya tanpa baris kas.
    creditId: uuid("credit_id").references(() => partyCredits.id),
    number: text("number").notNull(),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    accountId: uuid("account_id").notNull(),
    status: text("status").notNull().default("posted"), // posted | void
    notes: text("notes"),
    // A-21 (R3-08): nomor referensi/bukti pembayaran (no. transfer,
    // cek, VA) — pola kolom yang sama seperti bank_transfers.reference
    // dan party_opening_balances.reference; sebelumnya pembayaran
    // pihak adalah satu-satunya dokumen uang tanpa rumah referensi.
    reference: text("reference"),
    // A-21 Tahap R3-A (R3-01): fee/MDR final pembayaran ini (0 = tanpa
    // fee), dibekukan dari konfigurasi metode + keputusan pengguna di
    // form. amount tetap nominal bruto yang dialokasikan ke dokumen;
    // jurnal memecah fee ke pemetaan bank_fee (6060) agar void
    // membalik persis dan laporan membaca angka yang sama.
    feeAmount: numeric("fee_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    // A-21 Tahap R3-A (R3-06): potongan pajak (withholding) pada
    // pembayaran KELUAR — jenis sederhana sebagai data pembayaran
    // (pph23 | pph42), tarif yang dipakai pengguna (referensi bukti
    // potong), dan nominal final yang diputuskan pengguna & dijurnal
    // ke pemetaan tax_withholding_payable. 0/null = tanpa potongan.
    withholdingType: text("withholding_type"),
    withholdingRate: numeric("withholding_rate", { precision: 7, scale: 4 }),
    withholdingAmount: numeric("withholding_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    // A-21 Tahap R3-A (R3-07): baris pembayaran yang merupakan
    // write-off sisa pelunasan menyimpan alasan wajibnya di sini
    // (null = pembayaran biasa). account_id baris write-off adalah
    // akun lawan penyelesaian (beban write-off / pendapatan lain) —
    // pola yang sama seperti baris bersumber kredit (R3-02).
    writeoffReason: text("writeoff_reason"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("party_payments_company_number_uq").on(t.companyId, t.number)],
);
/**
 * T4-5b (D-14): dokumen saldo awal hutang/piutang. Bukan penerimaan atau
 * penjualan samaran — stok tidak bergerak; setiap dokumen punya satu
 * jurnal pembuka (Dr/Cr ekuitas vs utang/piutang bertag pihak) dan
 * dilunasi lewat party_payments.opening_id. Status: open (belum lunas,
 * termasuk terbayar sebagian) | settled (lunas) | void (dibatalkan,
 * jurnal sudah dibalik).
 */
export const partyOpeningBalances = pgTable(
  "party_opening_balances",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    kind: text("kind").notNull(), // payable | receivable
    partyType: text("party_type").notNull(), // supplier | customer
    partyId: uuid("party_id").notNull(),
    date: date("date").notNull(),
    dueDate: date("due_date"),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    paidAmount: numeric("paid_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    status: text("status").notNull().default("open"), // open | settled | void
    journalId: uuid("journal_id").references(() => journalEntries.id),
    reference: text("reference"), // nomor dokumen asal, mis. nomor faktur lama
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("party_opening_balances_company_number_uq").on(t.companyId, t.number),
    index("party_opening_balances_company_kind_idx").on(t.companyId, t.kind, t.status),
  ],
);
/**
 * A-21 (R3-02, sisa AK3-05): dokumen kredit pihak — rumah pencatatan
 * kelebihan bayar & uang muka/DP. Lahir dari pembayaran yang melebihi
 * sisa tagihan (per dokumen, FIFO, atau saldo awal): porsi pembayaran
 * sampai sisa melunasi dokumen seperti biasa, kelebihannya menjadi
 * kredit di dokumen ini. Menggeneralisasi dua preseden repo: klaim
 * retur pemasok A-9 (dokumen retur memegang klaim + counter
 * terselesaikan, akun 1210 `supplier_credit`) dan kredit retur
 * pelanggan POS (dokumen retur memegang kredit + `creditUsed`, akun
 * 2300 `customer_credit`) — asal kredit di sini adalah pembayaran,
 * bukan retur, jadi klaimnya berdiri sebagai dokumen sendiri.
 *
 * Arah mengikuti pihak: pelanggan → kewajiban kredit pelanggan
 * (pemetaan `customer_credit`, liabilitas); pemasok → aset kredit
 * pemasok (pemetaan `supplier_credit`). Pemakaian dicatat sebagai
 * baris party_payments biasa dengan credit_id terisi dan menaikkan
 * used_amount di sini; status: open | settled (used == amount) |
 * void (dibatalkan mengikuti void pembayaran asal yang belum
 * terpakai). Invariant pembayaran asal: party_payments.amount hanya
 * memuat porsi teralokasi ke dokumen, jadi Σ pembayaran per dokumen
 * selalu sama dengan terbayar dokumen (dasar hitung ulang ketiga
 * jalur void pembayaran).
 */
export const partyCredits = pgTable(
  "party_credits",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    partyType: text("party_type").notNull(), // customer | supplier
    partyId: uuid("party_id").notNull(),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    usedAmount: numeric("used_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    status: text("status").notNull().default("open"), // open | settled | void
    // Pembayaran yang melahirkan kredit ini; null untuk kredit dari
    // sisa FIFO modal Catat Transaksi (banyak pembayaran per dokumen,
    // tidak ada satu baris asal) — asal-usulnya di origin_label.
    // Tanpa FK: penunjuk asal-usul saja (pola sale_id/receipt_id di
    // party_payments yang juga tanpa FK), dan FK dua arah
    // party_payments.credit_id ↔ tabel ini memecah inferensi tipe.
    originPaymentId: uuid("origin_payment_id"),
    originLabel: text("origin_label"),
    journalId: uuid("journal_id").references(() => journalEntries.id),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("party_credits_company_number_uq").on(t.companyId, t.number),
    index("party_credits_company_party_status_idx").on(t.companyId, t.partyType, t.partyId, t.status),
  ],
);
