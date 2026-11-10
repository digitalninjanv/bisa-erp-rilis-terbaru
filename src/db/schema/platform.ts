/**
 * Skema domain: platform perusahaan (cabang, gudang, pengaturan, metode bayar, plumbing).
 * A-26 Q2: pecahan src/db/schema.ts — definisi dipindah utuh, tanpa perubahan.
 * Impor publik tetap lewat barrel "@/db/schema" (src/db/schema.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounting";
import type { DocumentNumbering } from "@/lib/document-numbering";
import type { ModuleEnabledMap } from "@/lib/modules";
import type { OpnameCycleConfig } from "@/lib/opname-cycle";
import type { CustomFieldDefinitions } from "@/lib/custom-fields";

/* ------------------------------------------------------------------ */
/* Company configuration                                               */
/* ------------------------------------------------------------------ */

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("branches_company_code_uq").on(t.companyId, t.code)],
);
export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    branchId: uuid("branch_id").references(() => branches.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("warehouse"), // store | warehouse | quarantine
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("warehouses_company_code_uq").on(t.companyId, t.code)],
);
export const companySettings = pgTable("company_settings", {
  companyId: text("company_id").primaryKey(),
  legalName: text("legal_name").notNull(),
  taxId: text("tax_id"),
  address: text("address"),
  phone: text("phone"),
  currency: text("currency").notNull().default("IDR"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  locale: text("locale").notNull().default("id-ID"),
  defaultWarehouseId: uuid("default_warehouse_id"),
  roundingMode: text("rounding_mode").notNull().default("none"), // none | nearest_100 | nearest_500 | nearest_1000 | up_500 | up_1000
  // A-28 UI-2 (UX-D01): kolom warisan nota (receipt_header,
  // receipt_footer, receipt_show_logo, receipt_show_cashier,
  // receipt_show_tax) DIHAPUS di migrasi 0059 — tab "Nota & printer"
  // dilebur ke mesin cetak. Header nota & saklar Logo warisan mati
  // (tidak pernah dibaca halaman nota); nilai Footer nota lama
  // dimigrasikan menjadi print_footer_text; saklar Kasir & Pajak
  // yang hidup dimigrasikan menjadi print_show_cashier/print_show_tax.
  // Print Engine (T4-4, D-13): shared print layout for receipt (POS),
  // GRN, and PO documents. Templates change typography/accent only,
  // never document data.
  printTemplate: text("print_template").notNull().default("modern"), // modern | minimal | classic
  printLogoUrl: text("print_logo_url"),
  printAccentColor: text("print_accent_color").notNull().default("#111827"),
  printFont: text("print_font").notNull().default("sans"), // sans | serif | mono
  printHeaderText: text("print_header_text"),
  printFooterText: text("print_footer_text"),
  printShowSignature: boolean("print_show_signature").notNull().default(true),
  printShowQr: boolean("print_show_qr").notNull().default(true),
  printReceiptPaper: text("print_receipt_paper").notNull().default("thermal80"), // thermal58 | thermal80 | a5 | a4
  printDocumentPaper: text("print_document_paper").notNull().default("a4"), // a4 | a5
  // A-28 UI-2 (UX-D01/D03): saklar elemen nota di mesin cetak —
  // tampil kasir & tampil PPN adalah migrasi dari saklar warisan
  // yang hidup; tampil pelanggan, tampil sesi, dan baris merek
  // "Dicetak dari Bisa ERP" menyusul pola yang sama. Semua bawaan
  // menyala = perilaku cetak sebelum UI-2.
  printShowCashier: boolean("print_show_cashier").notNull().default(true),
  printShowTax: boolean("print_show_tax").notNull().default(true),
  printShowCustomer: boolean("print_show_customer").notNull().default(true),
  printShowSession: boolean("print_show_session").notNull().default(true),
  printShowBranding: boolean("print_show_branding").notNull().default(true),
  // A-28 UI-2 (UX-D05): label blok tanda tangan per jenis dokumen
  // ({ [docType]: string[] }); null = semua label bawaan. Bentuk
  // divalidasi sebelum tulis & disanitasi saat baca oleh
  // src/components/print/types.ts (sanitizePrintSignatureLabels).
  printSignatureLabels: jsonb("print_signature_labels").$type<Record<string, string[]>>(),
  qrisImage: text("qris_image"),
  // AK-P3-07: per-document-type numbering overrides
  // ({ [docType]: { prefix?, padding? } }); null = every type uses the
  // built-in default prefix and padding. Shape is validated by
  // src/lib/document-numbering.ts before every write and sanitized on
  // every read in src/server/sequences.ts.
  documentNumbering: jsonb("document_numbering").$type<DocumentNumbering>(),
  // T5-2 (D-16): per-company module switch ({ pos/gudang/akuntansi:
  // boolean }); null = every module enabled. Only an explicit false
  // disables a module; sanitized on read by src/lib/modules.ts.
  enabledModules: jsonb("enabled_modules").$type<ModuleEnabledMap>(),
  // T5-2 (D-16): custom field definitions per entity
  // ({ product|supplier|customer: [{key,label,type,options?,required?}] });
  // null = no custom fields. Validated before write and sanitized on
  // read by src/lib/custom-fields.ts; values live on each row's
  // `attributes` jsonb.
  customFields: jsonb("custom_fields").$type<CustomFieldDefinitions>(),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  // FIX-GDG Tahap 2 (GDG1-09): bawaan kedaluwarsa reservasi stok
  // (hari) bila pembuat reservasi tidak menyebut expiresAt eksplisit.
  // Tanpa bawaan ini reservasi yatim mengunci stok selamanya.
  reservationDefaultExpiryDays: integer("reservation_default_expiry_days").notNull().default(7),
  // A-28 Tahap 2 (H-GDG-02): jendela peringatan "mendekati kedaluwarsa"
  // (hari) untuk daftar kerja di beranda Gudang — batch yang berakhir
  // dalam jendela ini (atau sudah lewat) tampil bertingkat di antrean
  // kerja. Bawaan 30 = angka yang sebelumnya mati di halaman gudang.
  expiryWarningDays: integer("expiry_warning_days").notNull().default(30),
  // A-24 T3 (pola G4): daftar alasan penyesuaian stok yang dapat
  // dikonfigurasi per perusahaan (array label; null = bawaan
  // src/lib/adjustment-reasons.ts). Alasan final yang tersimpan pada
  // dokumen tetap teks bebas hasil komposisi kategori + rincian,
  // sehingga histori lama tidak berubah maknanya.
  adjustmentReasons: jsonb("adjustment_reasons").$type<string[]>(),
  // A-24 T3 (pola G3): frekuensi hitung opname (hari) per gudang /
  // kategori untuk pengingat jatuh tempo di dashboard Gudang
  // (null = tanpa pengingat). Bentuk & sanitasi:
  // src/lib/opname-cycle.ts. Bukan mesin penjadwalan — tidak ada
  // dokumen yang dibuat otomatis dari konfigurasi ini.
  opnameCycle: jsonb("opname_cycle").$type<OpnameCycleConfig>(),
  // T5-3 (D-17): maker-checker for stock adjustments. When set, an
  // adjustment whose impact value (Σ |qty delta| × running cost) exceeds
  // this amount is stored as `pending` — no movements, no journal —
  // until a different user with inventory.manage approves it. Null =
  // approval not required (adjustments post immediately, as before).
  // FIX-GDG Tahap 3 (GDG3-10, D-25): gerbang ini sebelumnya mati secara
  // bawaan (null) sehingga penghapusan stok bernilai berapa pun
  // terposting oleh pembuatnya sendiri. Kini baris pengaturan BARU
  // menerima bawaan aktif Rp1.000.000 lewat DEFAULT basis data —
  // penyesuaian rutin minimarket jauh di bawah angka ini sehingga
  // tetap satu langkah, sedangkan penghapusan material selalu
  // tertangkap checker. Migrasi 0045 hanya memasang DEFAULT: baris
  // LAMA yang sudah bernilai null TIDAK diubah (keputusan sadar
  // pemilik, bukan kejutan migrasi) — UI menampilkan peringatan
  // konfigurasi di Pengaturan & halaman Penyesuaian sampai pemilik
  // mengisi atau membiarkannya dengan sadar. Pemilik tetap bebas
  // menaikkan/menurunkan/mengosongkan ambang di Pengaturan.
  adjustmentApprovalThreshold: numeric("adjustment_approval_threshold", {
    precision: 19,
    scale: 4,
  }).default("1000000"),
  // POS-DISC-01 (D-10): manual line discounts above this percent of the
  // line gross require the `pos.discount` permission.
  posDiscountThresholdPercent: numeric("pos_discount_threshold_percent", { precision: 5, scale: 2 }).notNull().default("10"),
  // A-28 Tahap 1 (H-POS-02): toleransi selisih kas tutup sesi (Rupiah).
  // Selisih tutup sesi dengan nilai mutlak MELEWATI angka ini wajib
  // disertai alasan tertulis (ditegakkan server di closeCashSession);
  // di dalam toleransi alasan opsional. Bawaan 0 = setiap selisih
  // wajib alasan (pola ambang konfigurabel D-25: fitur disiplin aktif
  // penuh sampai pemilik melonggarkannya di Pengaturan).
  posSessionDifferenceTolerance: numeric("pos_session_difference_tolerance", {
    precision: 19,
    scale: 4,
  }).notNull().default("0"),
  // SIM-2 S7B-2 (§12, D-24): saklar mode offline POS per perusahaan.
  // Mati (bawaan) = terminal tidak pernah mengantre penjualan; menyala =
  // penjualan saat koneksi putus masuk antrean lokal dan disinkronkan
  // lewat jalur checkout normal dengan kunci idempotensi per transaksi.
  posOfflineEnabled: boolean("pos_offline_enabled").notNull().default(false),
  // SIM-2 S7B-2 (§4): saklar transfer antar-gudang dua tahap. Mati
  // (bawaan) = transfer satu tahap seperti sebelumnya; menyala = kirim
  // dulu (stok masuk in-transit), tujuan menerima lewat langkah terima.
  transferTwoStepEnabled: boolean("transfer_two_step_enabled").notNull().default(false),
  // SIM-2 S7B-2 (§3): ambang persetujuan Purchase Request. Bila terisi,
  // PR dengan total perkiraan di atas ambang hanya boleh disahkan peran
  // senior (owner/admin/manager); kosong = setiap pemegang izin
  // inventory.manage yang bukan pembuat boleh mengesahkan (pola
  // maker-checker T5-3 yang sama seperti penyesuaian stok).
  prApprovalThreshold: numeric("pr_approval_threshold", { precision: 19, scale: 4 }),
  taxRate: numeric("tax_rate", { precision: 7, scale: 4 }).notNull().default("0"),
  // SIM-2 S2 (audit PPN): saklar eksplisit PPN per perusahaan. Sebelumnya
  // PPN hanya bisa dimatikan implisit dengan meng-nol-kan tarif; kini
  // tarif boleh tetap tersimpan sementara PPN nonaktif. Migrasi 0027
  // mengisi kolom ini dari keadaan lama (tax_rate > 0) agar perilaku
  // setiap perusahaan persis sama seperti sebelum kolom ini ada.
  taxEnabled: boolean("tax_enabled").notNull().default(true),
  // FIX-P1 Tahap 5 (AK3-07): termin bawaan bila pihak tidak memiliki
  // termin sendiri (suppliers/customers.payment_term_days). Utang
  // pembelian: jatuh tempo = tanggal penerimaan + termin pemasok, atau
  // angka ini bila termin pemasok kosong. Piutang POS: bawaan tanggal
  // tempo penjualan utang di terminal (menggantikan +7 hari hardcoded).
  payableDefaultTermDays: integer("payable_default_term_days").notNull().default(30),
  receivableDefaultTermDays: integer("receivable_default_term_days").notNull().default(7),
  // A-21 Tahap R3-A (R3-06): saklar potongan pajak (withholding PPh)
  // pada pembayaran keluar — pola D-25: komponen fiskal per perusahaan
  // dengan saklar sendiri. Bawaan NONAKTIF: pembayaran keluar tidak
  // menampilkan / tidak menjurnal potongan apa pun sampai pemilik
  // mengaktifkannya di Pengaturan.
  withholdingEnabled: boolean("withholding_enabled").notNull().default(false),
  // A-21 Tahap R3-A (R3-07): ambang maksimum write-off sisa pelunasan
  // per perusahaan (Rupiah). Bawaan 0 = fitur MATI sampai pemilik
  // mengisi ambang di Pengaturan (pola ambang konfigurabel D-25);
  // sisa di atas angka ini tidak dapat ditutup sebagai write-off.
  writeoffMaxAmount: numeric("writeoff_max_amount", { precision: 19, scale: 4 }).notNull().default("0"),
  // FIX-R2 Tahap 3 (RV2-01/AK3-11): kebijakan saldo kas/bank negatif per
  // perusahaan — allow (perilaku lama: bebas) | warn (posting jalan,
  // peringatan dikembalikan aksi & tampil di UI) | block (posting
  // ditolak). Bawaan "warn": audit R2 membuktikan saldo bank −Rp4 jt
  // terbentuk diam-diam lewat jalur sah, tetapi bawaan "block" berisiko
  // mematahkan operasi sah yang pencatatannya memang mendahului
  // setoran (kasir/buku bank belum mutakhir) — perusahaan memilih
  // sendiri naik ke block. Dievaluasi di postJournal (satu-satunya
  // titik bersama semua jalur pengeluaran); jurnal pembalik dikecualikan.
  cashNegativePolicy: text("cash_negative_policy").notNull().default("warn"), // allow | warn | block
  reportNotes: text("report_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("cash"), // cash | bank | qris | credit | customer_credit
    // A-27 B1 (F-09): FK sungguhan ke accounts — sebelumnya kolom bebas
    // tanpa FK sehingga referensi yatim mungkin lewat pemanggilan di
    // luar UI. Validasi sekantor/postable/aktif/kelas ada di B3.
    accountId: uuid("account_id").references(() => accounts.id),
    // A-21 Tahap R3-A (R3-01, sisa AK3-04): tarif fee/MDR per metode
    // sebagai konfigurasi per perusahaan (pola D-25). Bawaan mati
    // (fee_enabled=false, fee_type='none') = perilaku persis sebelum
    // kolom ini ada. fee_type: none | fixed (Rp per transaksi) |
    // percent (% dari nominal pembayaran). Nilai konfigurasi hanya
    // NILAI AWAL: nominal fee final diputuskan pengguna di form
    // pembayaran dan dibekukan di baris pembayaran (fee_amount).
    feeEnabled: boolean("fee_enabled").notNull().default(false),
    feeType: text("fee_type").notNull().default("none"), // none | fixed | percent
    feeValue: numeric("fee_value", { precision: 19, scale: 4 }).notNull().default("0"),
    instructions: text("instructions"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_methods_company_code_uq").on(t.companyId, t.code)],
);
/* ------------------------------------------------------------------ */
/* Infrastructure                                                      */
/* ------------------------------------------------------------------ */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    userId: text("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_company_created_idx").on(t.companyId, t.createdAt),
    index("audit_log_company_entity_idx").on(t.companyId, t.entityType, t.entityId),
  ],
);
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    resultRef: text("result_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_keys_company_scope_key_uq").on(t.companyId, t.scope, t.key)],
);
export const documentSequences = pgTable(
  "document_sequences",
  {
    companyId: text("company_id").notNull(),
    docType: text("doc_type").notNull(),
    fiscalYear: integer("fiscal_year").notNull(),
    prefix: text("prefix").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.docType, t.fiscalYear] })],
);
/**
 * SIM-2 S7 (REM-06): tabel ini SENGAJA dipertahankan tanpa pemakai
 * runtime saat ini. Ia adalah rumah antrean sinkronisasi untuk offline
 * POS yang diputuskan dibangun pada D-24 (lingkup S7B) — jangan dihapus
 * sebagai "dead code"; status ambigu yang dikeluhkan S0-A ditutup oleh
 * komentar keputusan ini.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outbox_pending_idx").on(t.processedAt, t.createdAt)],
);
