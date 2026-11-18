//! Lapisan database lokal POS (RENCANA-TAURI D3, Langkah 2).
//!
//! Dimiliki penuh oleh Rust di atas rusqlite — BUKAN plugin-sql dari
//! JS — karena kontraknya adalah: **satu command Tauri = satu
//! transaksi SQLite**. Penjualan lokal, baris-barisnya, dan baris
//! outbox-nya ditulis dalam satu transaksi; kegagalan di tengah
//! (mis. baris merujuk produk di luar snapshot → FK gagal) membatalkan
//! semuanya, tidak pernah ada penjualan setengah tercatat.
//!
//! Skema mencerminkan kontrak server yang sudah ada:
//! - `snapshot_*`  : hasil `GET /api/pos/snapshot` (katalog + harga +
//!   stok gudang bawaan + metode pembayaran), diganti utuh per
//!   penerapan snapshot.
//! - `local_sales` + `local_sale_lines`: penjualan yang terjadi di
//!   terminal ini, muatannya disimpan apa adanya sebagai JSON kontrak
//!   `OfflineSalePayload` (clientKey = kunci idempotensi server).
//! - `outbox`: antrean sinkronisasi per penjualan —
//!   pending → inflight → synced, atau held (konflik/gagal dari
//!   server, menunggu peninjauan; penjualan TIDAK pernah hilang
//!   senyap dari antrean).
//! - `cash_sessions` + `local_intents`: sesi kas lokal (Langkah 4)
//!   — buka/tutup BUTA dicatat sebagai fakta lokal; tutup sesi juga
//!   mengantrekan intent `cash_session_close` untuk disinkronkan
//!   kemudian (server belum punya kontrak intent sesi; sesi POS web
//!   tetap pemilik posting sesi — lihat RENCANA-TAURI Langkah 4).
//! - `snapshot_print` + `print_jobs` + `local_events`: cetak lokal
//!   (Langkah 5) — pengaturan cetak dari snapshot; antrean tugas
//!   cetak per penjualan (salinan ke-0 diantrekan transaksi
//!   pencatatan yang sama); peristiwa lokal teraudit seperti buka
//!   laci tanpa penjualan.
//!
//! Fungsi-fungsi di modul ini murni atas `rusqlite::Connection`
//! (tanpa runtime Tauri) agar dapat diuji `cargo test` secara
//! headless.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::printing::ReceiptContext;

pub type DbResult<T> = Result<T, String>;

fn db_err(error: rusqlite::Error) -> String {
    error.to_string()
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS snapshot_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_loyalty_balances (
  customer_id TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshot_promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  promo_type TEXT NOT NULL,
  value TEXT NOT NULL,
  min_subtotal TEXT NOT NULL,
  product_id TEXT
);
CREATE TABLE IF NOT EXISTS snapshot_kitchen_tickets (
  sale_id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  created_at TEXT NOT NULL,
  lines_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_reservations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty TEXT NOT NULL,
  expires_at TEXT,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS snapshot_warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshot_products (
  product_id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  category_id TEXT,
  category_name TEXT,
  sale_price TEXT NOT NULL,
  stock REAL NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 1,
  track_serial INTEGER NOT NULL DEFAULT 0,
  unit_code TEXT
);
CREATE INDEX IF NOT EXISTS snapshot_products_name_id_idx
  ON snapshot_products(name COLLATE NOCASE, product_id);
CREATE INDEX IF NOT EXISTS snapshot_products_sku_idx
  ON snapshot_products(sku);
CREATE INDEX IF NOT EXISTS snapshot_products_barcode_idx
  ON snapshot_products(barcode);
CREATE TABLE IF NOT EXISTS snapshot_payment_methods (
  method_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  fee_enabled INTEGER NOT NULL DEFAULT 0,
  fee_type TEXT NOT NULL DEFAULT 'none',
  fee_value TEXT NOT NULL DEFAULT '0'
);
-- Program Satuan Kemasan S5: kemasan per produk dari blok
-- `packagings` snapshot — faktor isi langsung ke satuan dasar
-- (string numeric server), harga jual PER KEMASAN, barcode
-- kemasan untuk resolusi pindai lokal. Diganti per produk saat
-- snapshot/delta diterapkan (baris produk induknya yang berubah).
-- Kemasan nonaktif tetap tersimpan (bertanda) agar struk &
-- histori lokal tetap bisa menyebut namanya; terminal tidak
-- menawarkannya untuk penjualan baru.
CREATE TABLE IF NOT EXISTS snapshot_packagings (
  packaging_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  isi TEXT NOT NULL,
  sale_price TEXT,
  barcode TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default_sale INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS snapshot_packagings_product_idx
  ON snapshot_packagings(product_id);
CREATE INDEX IF NOT EXISTS snapshot_packagings_barcode_idx
  ON snapshot_packagings(barcode);
CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opened_by TEXT,
  opening_cash TEXT NOT NULL DEFAULT '0',
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  counted_json TEXT,
  counted_total TEXT,
  expected_total TEXT,
  difference_total TEXT
);
CREATE TABLE IF NOT EXISTS local_sales (
  client_key TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  sale_date TEXT NOT NULL,
  expected_total TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  held_sale_id TEXT,
  receipt_context_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_held_sales (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_held_sales_updated_at
  ON local_held_sales(updated_at DESC, id);
CREATE TABLE IF NOT EXISTS local_sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_key TEXT NOT NULL REFERENCES local_sales(client_key),
  -- TANPA FK ke snapshot_products secara sengaja: integritas
  -- 'baris harus ada di snapshot' ditegakkan record_sale dengan
  -- pemeriksaan eksplisit di dalam transaksi yang sama (rollback
  -- atomik yang sama), sedangkan FK akan memblokir penerapan
  -- snapshot/delta yang membuang produk yang pernah terjual —
  -- baris penjualan lokal adalah audit terminal dan tidak boleh
  -- menghalangi katalog berganti. DB lama yang masih ber-FK
  -- dibangun ulang oleh migrate_schema().
  product_id TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_price TEXT,
  discount_type TEXT,
  discount_value REAL,
  -- S5: cuplikan kemasan baris (pola migrasi 0063–0065 server) —
  -- packaging_id null = satuan dasar; qty_input = qty sebagaimana
  -- dimasukkan dalam kemasan; isi_snapshot = faktor saat jual;
  -- unit_price di atas untuk baris berkemasan adalah harga PER
  -- KEMASAN. DB lama mendapat kolom ini lewat migrate_schema().
  packaging_id TEXT,
  qty_input REAL,
  isi_snapshot REAL
);
CREATE TABLE IF NOT EXISTS local_intents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'synced', 'held')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  client_key TEXT PRIMARY KEY REFERENCES local_sales(client_key),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'inflight', 'synced', 'held')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status_created_at
  ON outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_live_created_at
  ON outbox(created_at, client_key)
  WHERE status IN ('pending', 'inflight', 'held');
-- Langkah 5 (D6): pengaturan cetak dari snapshot (satu baris,
-- id = 1) — identitas toko + saklar elemen nota + tarif PPN,
-- dari pengaturan cetak perusahaan yang sama dengan nota web.
CREATE TABLE IF NOT EXISTS snapshot_print (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  tax_id TEXT,
  header_text TEXT,
  footer_text TEXT,
  show_cashier INTEGER NOT NULL DEFAULT 1,
  show_tax INTEGER NOT NULL DEFAULT 1,
  show_customer INTEGER NOT NULL DEFAULT 1,
  show_session INTEGER NOT NULL DEFAULT 1,
  show_branding INTEGER NOT NULL DEFAULT 1,
  receipt_paper TEXT NOT NULL DEFAULT 'thermal80',
  tax_enabled INTEGER NOT NULL DEFAULT 1,
  tax_rate TEXT NOT NULL DEFAULT '0',
  rounding_mode TEXT NOT NULL DEFAULT 'none',
  qris_image TEXT
);
-- Langkah 5 (D6): antrean cetak lokal. Setiap penjualan tercatat
-- mendapat tepat satu tugas salinan ke-0 dari transaksi pencatatan
-- yang sama; cetak ulang menambah tugas dengan copy_index
-- berikutnya (struknya berpita SALINAN). Kegagalan printer TIDAK
-- pernah memblokir penjualan — tugas tinggal failed & terlihat UI.
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  client_key TEXT NOT NULL REFERENCES local_sales(client_key),
  copy_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'printing', 'printed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  printed_at TEXT
);
-- Cetak ulang transaksi server memakai antrean durable yang sama
-- dengan pekerja printer, tetapi tanpa FK ke penjualan lokal.
CREATE TABLE IF NOT EXISTS server_receipt_print_jobs (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  receipt_bytes BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'printing', 'printed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  printed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_server_receipt_print_jobs_status_created
  ON server_receipt_print_jobs(status, created_at);
-- Langkah 5 (D6): peristiwa lokal terminal yang wajib teraudit
-- tetapi bukan intent sinkronisasi — mis. buka laci tanpa penjualan
-- (kind 'drawer_open', payload memuat alasan & hasil kirim).
CREATE TABLE IF NOT EXISTS local_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Langkah 6 (D5/D7): identitas terminal dari snapshot (satu baris,
-- id = 1) — nama terminal + perusahaan + gudang terminal ini,
-- sumber tampilan nama (bukan id) di UI & struk lokal. Baris dapat
-- dibuat lebih dulu oleh pairing (store_terminal_identity) lalu
-- dilengkapi snapshot.
CREATE TABLE IF NOT EXISTS snapshot_terminal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  terminal_id TEXT NOT NULL,
  name TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  warehouse_id TEXT,
  warehouse_name TEXT
);
-- Langkah 6: direktori nama dari snapshot (kasir & pelanggan) —
-- diganti utuh setiap snapshot agar struk/UI menyelesaikan id →
-- nama secara lokal tanpa server.
CREATE TABLE IF NOT EXISTS snapshot_names (
  kind TEXT NOT NULL CHECK (kind IN ('cashier', 'customer')),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  group_id TEXT,
  PRIMARY KEY (kind, id)
);
CREATE TABLE IF NOT EXISTS snapshot_customer_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rounding_step INTEGER NOT NULL DEFAULT 0,
  rounding_direction TEXT NOT NULL DEFAULT 'down',
  round_cash_total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshot_customer_group_prices (
  group_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (group_id, product_id)
);
CREATE INDEX IF NOT EXISTS snapshot_customer_group_prices_product_idx
  ON snapshot_customer_group_prices(product_id, group_id);
";

/// Buka (atau buat) database lokal dan terapkan pragmas + skema.
/// WAL agar pembaca tidak mengunci penulis; busy_timeout agar
/// tabrakan kunci sesaat menunggu, bukan gagal.
pub fn open(path: &std::path::Path) -> DbResult<Connection> {
    let conn = Connection::open(path).map_err(db_err)?;
    init(&conn)?;
    Ok(conn)
}

pub fn init(conn: &Connection) -> DbResult<()> {
    conn.pragma_update(None, "journal_mode", "WAL").map_err(db_err)?;
    conn.pragma_update(None, "busy_timeout", 5000).map_err(db_err)?;
    conn.execute_batch(SCHEMA).map_err(db_err)?;
    // Migrasi skema berjalan SEBELUM foreign_keys dinyalakan:
    // pembangunan ulang tabel tidak boleh dinilai FK di tengah jalan.
    migrate_schema(conn)?;
    let has_product_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM snapshot_meta WHERE key = 'product_count'",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if has_product_count == 0 {
        let product_count: i64 = conn
            .query_row("SELECT count(*) FROM snapshot_products", [], |row| row.get(0))
            .map_err(db_err)?;
        conn.execute(
            "INSERT INTO snapshot_meta (key, value) VALUES ('product_count', ?1)",
            params![product_count.to_string()],
        )
        .map_err(db_err)?;
    }
    conn.pragma_update(None, "foreign_keys", "ON").map_err(db_err)?;
    Ok(())
}

/// Migrasi aditif untuk DB lokal yang dibuat langkah sebelumnya:
/// (1) buang FK `local_sale_lines.product_id → snapshot_products`
/// lewat pembangunan ulang tabel (data disalin utuh); (2) tambahkan
/// kolom sesi kas yang menyusul di Langkah 4 bila belum ada;
/// (3) tambahkan kolom cuplikan kemasan S5 di baris penjualan.
fn migrate_schema(conn: &Connection) -> DbResult<()> {
    let fk_rows: i64 = conn
        .query_row(
            "SELECT count(*) FROM pragma_foreign_key_list('local_sale_lines')
             WHERE \"table\" = 'snapshot_products'",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if fk_rows > 0 {
        conn.execute_batch(
            "ALTER TABLE local_sale_lines RENAME TO local_sale_lines_legacy;
             CREATE TABLE local_sale_lines (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               client_key TEXT NOT NULL REFERENCES local_sales(client_key),
               product_id TEXT NOT NULL,
               qty REAL NOT NULL,
               unit_price TEXT,
               discount_type TEXT,
               discount_value REAL
             );
             INSERT INTO local_sale_lines
               (id, client_key, product_id, qty, unit_price, discount_type, discount_value)
             SELECT id, client_key, product_id, qty, unit_price, discount_type, discount_value
             FROM local_sale_lines_legacy;
             DROP TABLE local_sale_lines_legacy;",
        )
        .map_err(db_err)?;
    }
    for (column, ddl) in [
        ("category_id", "category_id TEXT"),
        ("category_name", "category_name TEXT"),
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('snapshot_products') WHERE name = ?1",
                params![column],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        if exists == 0 {
            conn.execute_batch(&format!("ALTER TABLE snapshot_products ADD COLUMN {ddl}"))
                .map_err(db_err)?;
        }
    }
    for (column, ddl) in [
        ("fee_enabled", "fee_enabled INTEGER NOT NULL DEFAULT 0"),
        ("fee_type", "fee_type TEXT NOT NULL DEFAULT 'none'"),
        ("fee_value", "fee_value TEXT NOT NULL DEFAULT '0'"),
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('snapshot_payment_methods') WHERE name = ?1",
                params![column],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        if exists == 0 {
            conn.execute_batch(&format!("ALTER TABLE snapshot_payment_methods ADD COLUMN {ddl}"))
                .map_err(db_err)?;
        }
    }
    let customer_group_column_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM pragma_table_info('snapshot_names') WHERE name = 'group_id'",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if customer_group_column_exists == 0 {
        conn.execute_batch("ALTER TABLE snapshot_names ADD COLUMN group_id TEXT")
            .map_err(db_err)?;
    }
    for (column, ddl) in [
        ("opened_by", "opened_by TEXT"),
        ("opening_cash", "opening_cash TEXT NOT NULL DEFAULT '0'"),
        ("counted_json", "counted_json TEXT"),
        ("counted_total", "counted_total TEXT"),
        ("expected_total", "expected_total TEXT"),
        ("difference_total", "difference_total TEXT"),
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('cash_sessions') WHERE name = ?1",
                params![column],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        if exists == 0 {
            conn.execute_batch(&format!("ALTER TABLE cash_sessions ADD COLUMN {ddl}"))
                .map_err(db_err)?;
        }
    }
    for (column, ddl) in [
        ("held_sale_id", "held_sale_id TEXT"),
        ("receipt_context_json", "receipt_context_json TEXT"),
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('local_sales') WHERE name = ?1",
                params![column],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        if exists == 0 {
            conn.execute_batch(&format!("ALTER TABLE local_sales ADD COLUMN {ddl}"))
                .map_err(db_err)?;
        }
    }
    // (3) S5: kolom cuplikan kemasan di baris penjualan lokal —
    // aditif, baris lama tetap utuh (NULL = satuan dasar). Berjalan
    // sesudah pembangunan ulang FK di atas agar tabel hasil bangun
    // ulang pun mendapat kolomnya.
    for (column, ddl) in [
        ("packaging_id", "packaging_id TEXT"),
        ("qty_input", "qty_input REAL"),
        ("isi_snapshot", "isi_snapshot REAL"),
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('local_sale_lines') WHERE name = ?1",
                params![column],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        if exists == 0 {
            conn.execute_batch(&format!("ALTER TABLE local_sale_lines ADD COLUMN {ddl}"))
                .map_err(db_err)?;
        }
    }
    let rounding_column_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM pragma_table_info('snapshot_print') WHERE name = 'rounding_mode'",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if rounding_column_exists == 0 {
        conn.execute_batch(
            "ALTER TABLE snapshot_print ADD COLUMN rounding_mode TEXT NOT NULL DEFAULT 'none'",
        )
        .map_err(db_err)?;
    }
    let qris_column_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM pragma_table_info('snapshot_print') WHERE name = 'qris_image'",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if qris_column_exists == 0 {
        conn.execute_batch("ALTER TABLE snapshot_print ADD COLUMN qris_image TEXT")
            .map_err(db_err)?;
    }
    Ok(())
}

/// Cap waktu ISO-8601 UTC tanpa dependensi chrono — cukup untuk cap
/// antrean/sesi lokal (bukan waktu dokumen; tanggal penjualan datang
/// dari muatan kasir). Algoritma kalender Howard Hinnant.
pub fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------------------
// Tipe kawat — cermin JSON server & payload kontrak sinkronisasi
// (camelCase, sejajar `OfflineSalePayload` di src/lib/pos/pos-offline.ts).
// ---------------------------------------------------------------------------

/// Satu kemasan produk pada snapshot (S5) — cermin blok
/// `packagings` server: isi langsung ke satuan dasar sebagai
/// string numeric, harga jual per kemasan (null = belum diatur),
/// barcode kemasan, bendera aktif & bawaan jual.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPackagingInput {
    pub id: String,
    pub name: String,
    pub isi: String,
    pub sale_price: Option<String>,
    pub barcode: Option<String>,
    pub is_active: bool,
    pub is_default_sale: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotProductInput {
    pub id: String,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    /// Kategori snapshot, opsional agar delta lama tetap dapat diterapkan.
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub category_name: Option<String>,
    pub sale_price: String,
    pub stock: f64,
    pub track_stock: bool,
    pub track_serial: bool,
    pub unit_code: Option<String>,
    /// Blok kemasan (S5); snapshot lama tidak memilikinya.
    #[serde(default)]
    pub packagings: Vec<SnapshotPackagingInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMethodInput {
    pub id: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "type")]
    pub method_type: String,
    #[serde(default)]
    pub fee_enabled: bool,
    #[serde(default = "default_fee_type")]
    pub fee_type: String,
    #[serde(default = "default_fee_value")]
    pub fee_value: String,
}

fn default_fee_type() -> String {
    "none".to_string()
}

fn default_fee_value() -> String {
    "0".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotLoyaltyBalanceInput {
    pub customer_id: String,
    pub points: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPromotionInput {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub promo_type: String,
    pub value: String,
    pub min_subtotal: String,
    pub product_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotKitchenTicketLineInput {
    pub product_name: String,
    pub qty: String,
    pub unit_code: Option<String>,
    pub packaging_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotKitchenTicketInput {
    pub sale_id: String,
    pub number: String,
    pub created_at: String,
    pub lines: Vec<SnapshotKitchenTicketLineInput>,
}

/// Reservasi stok aktif dari server — dipilih kasir saat checkout.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotReservationInput {
    pub id: String,
    pub number: String,
    pub product_id: String,
    pub qty: String,
    pub expires_at: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotWarehouseInput {
    pub id: String,
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
}

/// Pengaturan cetak terminal (Langkah 5) — cermin blok `receipt`
/// snapshot server: identitas toko, teks kop/kaki, saklar elemen
/// nota, kertas nota, dan PPN (saklar + tarif persen string
/// desimal). Dipakai apa adanya untuk snapshot masuk DAN sebagai
/// model baca dari tabel `snapshot_print`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSettings {
    pub company_name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub tax_id: Option<String>,
    pub header_text: Option<String>,
    pub footer_text: Option<String>,
    pub show_cashier: bool,
    pub show_tax: bool,
    pub show_customer: bool,
    pub show_session: bool,
    pub show_branding: bool,
    /// thermal58 | thermal80 | a5 | a4 (server); thermal memakai 58/80.
    pub receipt_paper: String,
    pub tax_enabled: bool,
    /// Tarif PPN persen, string desimal ("11.0000"); efektif hanya
    /// bila `tax_enabled` — aturan yang sama dengan quote POS web.
    pub tax_rate: String,
    #[serde(default)]
    pub rounding_mode: String,
    /// Gambar QRIS statis dari pengaturan perusahaan (data URL raster).
    #[serde(default)]
    pub qris_image: Option<String>,
}

impl Default for ReceiptSettings {
    /// Keadaan sebelum snapshot pertama membawa blok cetak:
    /// mengikuti bawaan mesin cetak web (semua saklar menyala,
    /// kertas thermal 80, tanpa PPN) dengan nama bawaan nota web.
    fn default() -> Self {
        ReceiptSettings {
            company_name: "Bisa Minimarket".to_string(),
            address: None,
            phone: None,
            tax_id: None,
            header_text: None,
            footer_text: None,
            show_cashier: true,
            show_tax: true,
            show_customer: true,
            show_session: true,
            show_branding: true,
            receipt_paper: "thermal80".to_string(),
            tax_enabled: false,
            tax_rate: "0".to_string(),
            rounding_mode: "none".to_string(),
            qris_image: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInput {
    pub version: String,
    /// Kursor delta yang diterbitkan server bersama snapshot ini
    /// (Langkah 3); snapshot Langkah 1 tidak memilikinya.
    #[serde(default)]
    pub cursor: Option<String>,
    pub generated_at: String,
    pub warehouse: Option<SnapshotWarehouseInput>,
    /// Daftar gudang perusahaan untuk pemilih register saat buka shift.
    #[serde(default)]
    pub warehouses: Vec<SnapshotWarehouseInput>,
    #[serde(default)]
    pub reservations: Vec<SnapshotReservationInput>,
    #[serde(default)]
    pub kitchen_tickets: Vec<SnapshotKitchenTicketInput>,
    #[serde(default)]
    pub promotions: Vec<SnapshotPromotionInput>,
    #[serde(default)]
    pub loyalty_balances: Vec<SnapshotLoyaltyBalanceInput>,
    pub payment_methods: Vec<SnapshotMethodInput>,
    pub products: Vec<SnapshotProductInput>,
    #[serde(default)]
    pub customer_groups: Vec<SnapshotCustomerGroupInput>,
    #[serde(default)]
    pub group_prices: Vec<SnapshotGroupPriceInput>,
    #[serde(default)]
    pub replace_group_price_group_ids: Vec<String>,
    /// Blok cetak (Langkah 5); snapshot lama tidak memilikinya.
    #[serde(default)]
    pub receipt: Option<ReceiptSettings>,
    /// Identitas terminal (Langkah 6); snapshot lama tidak memilikinya.
    #[serde(default)]
    pub terminal: Option<TerminalIdentityInput>,
    /// Direktori nama kasir & pelanggan (Langkah 6).
    #[serde(default)]
    pub names: Option<SnapshotNamesInput>,
    /// Izin diskon kasir asal dari server; dibaca ulang saat sinkron.
    #[serde(default)]
    pub can_discount: bool,
    /// Saklar perusahaan untuk menerima penjualan melalui antrean offline.
    #[serde(default)]
    pub pos_offline_enabled: bool,
}

/// Identitas terminal sebagaimana dikirim server di snapshot
/// (blok `terminal`): registry server adalah sumber kebenarannya.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalIdentityInput {
    pub id: String,
    pub name: String,
    pub company_name: String,
    pub warehouse: SnapshotWarehouseInput,
}

/// Satu entri direktori nama (id → nama tampilan).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NameEntryInput {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCustomerGroupInput {
    pub id: String,
    pub name: String,
    pub rounding_step: i64,
    pub rounding_direction: String,
    pub round_cash_total: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGroupPriceInput {
    pub group_id: String,
    pub product_id: String,
    pub rule_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGroupPricing {
    pub groups: Vec<SnapshotCustomerGroupInput>,
    pub prices: Vec<SnapshotGroupPriceInput>,
}

/// Blok `names` snapshot: direktori kasir & pelanggan perusahaan.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotNamesInput {
    pub cashiers: Vec<NameEntryInput>,
    pub customers: Vec<NameEntryInput>,
}

/// Identitas terminal tersimpan lokal (baris tunggal
/// `snapshot_terminal`) — bentuk yang dibaca UI/struk/sesi.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalIdentity {
    pub terminal_id: String,
    pub name: String,
    pub company_name: String,
    pub warehouse_id: Option<String>,
    pub warehouse_name: Option<String>,
}

/// Delta snapshot (Langkah 3): hanya baris berubah sejak kursor
/// dasar + id yang harus dibuang. Metode pembayaran tetap daftar
/// utuh (diganti utuh saat penerapan).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDeltaInput {
    pub version: String,
    pub cursor: String,
    pub base_cursor: String,
    pub generated_at: String,
    pub warehouse: Option<SnapshotWarehouseInput>,
    /// Daftar gudang perusahaan untuk pemilih register saat buka shift.
    #[serde(default)]
    pub warehouses: Vec<SnapshotWarehouseInput>,
    #[serde(default)]
    pub reservations: Vec<SnapshotReservationInput>,
    #[serde(default)]
    pub kitchen_tickets: Vec<SnapshotKitchenTicketInput>,
    #[serde(default)]
    pub promotions: Vec<SnapshotPromotionInput>,
    #[serde(default)]
    pub loyalty_balances: Vec<SnapshotLoyaltyBalanceInput>,
    pub payment_methods: Vec<SnapshotMethodInput>,
    pub products: Vec<SnapshotProductInput>,
    pub removed_product_ids: Vec<String>,
    #[serde(default)]
    pub customer_groups: Vec<SnapshotCustomerGroupInput>,
    #[serde(default)]
    pub group_prices: Vec<SnapshotGroupPriceInput>,
    #[serde(default)]
    pub replace_group_price_group_ids: Vec<String>,
    /// Blok cetak (Langkah 5) — selalu utuh juga di delta.
    #[serde(default)]
    pub receipt: Option<ReceiptSettings>,
    /// Identitas terminal (Langkah 6) — selalu utuh juga di delta.
    #[serde(default)]
    pub terminal: Option<TerminalIdentityInput>,
    /// Direktori nama (Langkah 6) — selalu utuh juga di delta.
    #[serde(default)]
    pub names: Option<SnapshotNamesInput>,
    #[serde(default)]
    pub can_discount: bool,
    /// Saklar perusahaan untuk menerima penjualan melalui antrean offline.
    #[serde(default)]
    pub pos_offline_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStats {
    pub version: String,
    pub products: usize,
    pub payment_methods: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDeltaStats {
    pub cursor: String,
    pub changed: usize,
    pub removed: usize,
    pub payment_methods: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub version: Option<String>,
    pub cursor: Option<String>,
    pub generated_at: Option<String>,
    pub warehouse_id: Option<String>,
    pub product_count: i64,
    pub payment_method_count: i64,
    /// Identitas terminal (Langkah 6) — nama untuk header UI.
    pub terminal: Option<TerminalIdentity>,
    pub can_discount: bool,
    pub pos_offline_enabled: bool,
    pub tax_enabled: bool,
    pub tax_rate: String,
    pub rounding_mode: String,
}

/// Kemasan tersimpan lokal (baris `snapshot_packagings`) — bentuk
/// yang dibaca UI terminal dari DB lokal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPackaging {
    pub packaging_id: String,
    pub name: String,
    /// Isi ke satuan dasar, string numeric server apa adanya.
    pub isi: String,
    pub sale_price: Option<String>,
    pub barcode: Option<String>,
    pub is_active: bool,
    pub is_default_sale: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotProduct {
    pub product_id: String,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub sale_price: String,
    pub stock: f64,
    pub track_stock: bool,
    pub track_serial: bool,
    pub unit_code: Option<String>,
    /// Kemasan produk ini (S5), urutan tampil server.
    pub packagings: Vec<SnapshotPackaging>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotProductPage {
    pub products: Vec<SnapshotProduct>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub page_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotProductMatch {
    pub product: SnapshotProduct,
    pub packaging_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPaymentMethod {
    pub method_id: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "type")]
    pub method_type: String,
    pub fee_enabled: bool,
    pub fee_type: String,
    pub fee_value: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleLineInput {
    pub product_id: String,
    pub qty: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_numbers: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_price: Option<f64>,
    /// S5 (kontrak S4 yang sama dengan antrean web): baris
    /// berkemasan — `qty` adalah qty INPUT dalam kemasan ini,
    /// `unit_price` adalah harga PER KEMASAN yang dibebankan, dan
    /// `isi_snapshot` faktor cuplikannya saat transaksi. Server
    /// mengonversi dari cuplikan muatan ini, bukan master saat
    /// sinkron. Absen = baris satuan dasar (muatan lama sah).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packaging_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isi_snapshot: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalePaymentInput {
    pub method_id: String,
    pub amount: f64,
    pub tendered: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fee: Option<f64>,
}

/// Muatan penjualan — bentuknya persis `OfflineSalePayload` server,
/// sehingga JSON yang disimpan di outbox dapat dikirim apa adanya ke
/// `POST /api/pos/sync`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleInput {
    pub client_key: String,
    pub warehouse_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held_sale_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cashier_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    /// Reservasi stok yang dipenuhi transaksi ini (jika ada).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reservation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_total: Option<f64>,
    pub lines: Vec<SaleLineInput>,
    pub payments: Vec<SalePaymentInput>,
    pub queued_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHeldSale {
    pub id: String,
    pub label: String,
    pub payload: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub client_key: String,
    pub status: String,
    pub payload: serde_json::Value,
    pub attempts: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxSummary {
    pub client_key: String,
    pub status: String,
    pub expected_total: Option<String>,
    pub attempts: i64,
    pub last_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxPage {
    pub items: Vec<OutboxSummary>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub page_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSaleHistoryRow {
    pub client_key: String,
    pub sale_date: String,
    pub expected_total: String,
    pub status: String,
    pub last_message: Option<String>,
    pub line_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSalesPage {
    pub items: Vec<LocalSaleHistoryRow>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub page_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultInput {
    pub client_key: String,
    /// Status kontrak server: synced | duplicate | conflict | failed.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Hasil per intent sesi dari server (Langkah 6):
/// recorded | duplicate — keduanya berarti intent selesai.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentResultInput {
    pub client_key: String,
    pub status: String,
    #[serde(default)]
    pub message: Option<String>,
}

// ---------------------------------------------------------------------------
// Operasi
// ---------------------------------------------------------------------------

/// Ganti seluruh kemasan satu produk dalam transaksi pemanggil
/// (S5): blok kemasan selalu cermin utuh server untuk produk itu —
/// pola yang sama dengan metode pembayaran & direktori nama.
fn store_packagings(
    tx: &rusqlite::Transaction<'_>,
    product_id: &str,
    packagings: &[SnapshotPackagingInput],
) -> DbResult<()> {
    tx.execute(
        "DELETE FROM snapshot_packagings WHERE product_id = ?1",
        params![product_id],
    )
    .map_err(db_err)?;
    let mut stmt = tx
        .prepare(
            "INSERT INTO snapshot_packagings
               (packaging_id, product_id, name, isi, sale_price, barcode, is_active, is_default_sale, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .map_err(db_err)?;
    for (index, packaging) in packagings.iter().enumerate() {
        stmt.execute(params![
            packaging.id,
            product_id,
            packaging.name,
            packaging.isi,
            packaging.sale_price,
            packaging.barcode,
            packaging.is_active as i64,
            packaging.is_default_sale as i64,
            index as i64,
        ])
        .map_err(db_err)?;
    }
    Ok(())
}

/// Terapkan snapshot server secara utuh dalam SATU transaksi:
/// katalog & metode lama dibuang, yang baru dimasukkan, versi dicatat.
pub fn apply_snapshot(conn: &mut Connection, snapshot: &SnapshotInput) -> DbResult<SnapshotStats> {
    let tx = conn.transaction().map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_products", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_loyalty_balances", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_promotions", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_kitchen_tickets", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_reservations", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_warehouses", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_packagings", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_payment_methods", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_customer_group_prices", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_customer_groups", []).map_err(db_err)?;
    let warehouse_id = snapshot
        .warehouse
        .as_ref()
        .map(|w| w.id.clone())
        .unwrap_or_default();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_products
                   (product_id, warehouse_id, sku, barcode, name, category_id, category_name,
                    sale_price, stock, track_stock, track_serial, unit_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .map_err(db_err)?;
        for product in &snapshot.products {
            stmt.execute(params![
                product.id,
                warehouse_id,
                product.sku,
                product.barcode,
                product.name,
                product.category_id,
                product.category_name,
                product.sale_price,
                product.stock,
                product.track_stock as i64,
                product.track_serial as i64,
                product.unit_code,
            ])
            .map_err(db_err)?;
        }
    }
    for product in &snapshot.products {
        store_packagings(&tx, &product.id, &product.packagings)?;
    }
    store_customer_groups(&tx, &snapshot.customer_groups)?;
    store_group_prices(&tx, &snapshot.group_prices)?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_payment_methods
                   (method_id, code, name, type, fee_enabled, fee_type, fee_value)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(db_err)?;
        for method in &snapshot.payment_methods {
            stmt.execute(params![
                method.id,
                method.code,
                method.name,
                method.method_type,
                method.fee_enabled as i64,
                method.fee_type,
                method.fee_value,
            ])
                .map_err(db_err)?;
        }
    }
    set_meta(&tx, "version", &snapshot.version)?;
    set_meta(&tx, "generated_at", &snapshot.generated_at)?;
    set_meta(&tx, "warehouse_id", &warehouse_id)?;
    set_meta(&tx, "product_count", &snapshot.products.len().to_string())?;
    set_meta(&tx, "can_discount", &snapshot.can_discount.to_string())?;
    set_meta(
        &tx,
        "pos_offline_enabled",
        &snapshot.pos_offline_enabled.to_string(),
    )?;
    if let Some(cursor) = &snapshot.cursor {
        set_meta(&tx, "cursor", cursor)?;
    }
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_loyalty_balances (customer_id, points) VALUES (?1, ?2)
                 ON CONFLICT(customer_id) DO UPDATE SET points = excluded.points",
            )
            .map_err(db_err)?;
        for balance in &snapshot.loyalty_balances {
            stmt.execute(params![balance.customer_id, balance.points]).map_err(db_err)?;
        }
    }
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_promotions (id, name, promo_type, value, min_subtotal, product_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, promo_type = excluded.promo_type,
                   value = excluded.value, min_subtotal = excluded.min_subtotal, product_id = excluded.product_id",
            )
            .map_err(db_err)?;
        for promo in &snapshot.promotions {
            stmt.execute(params![
                promo.id, promo.name, promo.promo_type, promo.value, promo.min_subtotal, promo.product_id,
            ])
            .map_err(db_err)?;
        }
    }
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_kitchen_tickets (sale_id, number, created_at, lines_json)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(sale_id) DO UPDATE SET number = excluded.number,
                   created_at = excluded.created_at, lines_json = excluded.lines_json",
            )
            .map_err(db_err)?;
        for ticket in &snapshot.kitchen_tickets {
            let lines = serde_json::to_string(&ticket.lines).map_err(|error| error.to_string())?;
            stmt.execute(params![ticket.sale_id, ticket.number, ticket.created_at, lines])
                .map_err(db_err)?;
        }
    }
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_reservations (id, number, product_id, qty, expires_at, reason)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET number = excluded.number, product_id = excluded.product_id,
                   qty = excluded.qty, expires_at = excluded.expires_at, reason = excluded.reason",
            )
            .map_err(db_err)?;
        for reservation in &snapshot.reservations {
            stmt.execute(params![
                reservation.id,
                reservation.number,
                reservation.product_id,
                reservation.qty,
                reservation.expires_at,
                reservation.reason,
            ])
            .map_err(db_err)?;
        }
    }
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_warehouses (id, code, name, is_default)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, is_default = excluded.is_default",
            )
            .map_err(db_err)?;
        for warehouse in &snapshot.warehouses {
            stmt.execute(params![
                warehouse.id,
                warehouse.code,
                warehouse.name,
                warehouse.is_default as i64,
            ])
            .map_err(db_err)?;
        }
    }
    if let Some(receipt) = &snapshot.receipt {
        store_receipt(&tx, receipt)?;
    }
    if let Some(terminal) = &snapshot.terminal {
        store_terminal(&tx, terminal)?;
    }
    if let Some(names) = &snapshot.names {
        store_names(&tx, names)?;
    }
    tx.commit().map_err(db_err)?;
    Ok(SnapshotStats {
        version: snapshot.version.clone(),
        products: snapshot.products.len(),
        payment_methods: snapshot.payment_methods.len(),
    })
}

fn set_meta(tx: &rusqlite::Transaction<'_>, key: &str, value: &str) -> DbResult<()> {
    tx.execute(
        "INSERT INTO snapshot_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Simpan blok cetak snapshot sebagai baris tunggal `snapshot_print`
/// (diganti utuh — pola yang sama dengan metode pembayaran).
fn store_receipt(tx: &rusqlite::Transaction<'_>, receipt: &ReceiptSettings) -> DbResult<()> {
    tx.execute(
        "INSERT INTO snapshot_print
           (id, company_name, address, phone, tax_id, header_text, footer_text,
            show_cashier, show_tax, show_customer, show_session, show_branding,
            receipt_paper, tax_enabled, tax_rate, rounding_mode, qris_image)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(id) DO UPDATE SET
           company_name = excluded.company_name,
           address = excluded.address,
           phone = excluded.phone,
           tax_id = excluded.tax_id,
           header_text = excluded.header_text,
           footer_text = excluded.footer_text,
           show_cashier = excluded.show_cashier,
           show_tax = excluded.show_tax,
           show_customer = excluded.show_customer,
           show_session = excluded.show_session,
           show_branding = excluded.show_branding,
           receipt_paper = excluded.receipt_paper,
           tax_enabled = excluded.tax_enabled,
           tax_rate = excluded.tax_rate,
           rounding_mode = excluded.rounding_mode,
           qris_image = excluded.qris_image",
        params![
            receipt.company_name,
            receipt.address,
            receipt.phone,
            receipt.tax_id,
            receipt.header_text,
            receipt.footer_text,
            receipt.show_cashier as i64,
            receipt.show_tax as i64,
            receipt.show_customer as i64,
            receipt.show_session as i64,
            receipt.show_branding as i64,
            receipt.receipt_paper,
            receipt.tax_enabled as i64,
            receipt.tax_rate,
            receipt.rounding_mode,
            receipt.qris_image,
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Simpan identitas terminal snapshot sebagai baris tunggal
/// `snapshot_terminal` (diganti utuh — pola yang sama dengan
/// snapshot_print).
fn store_terminal(tx: &rusqlite::Transaction<'_>, terminal: &TerminalIdentityInput) -> DbResult<()> {
    tx.execute(
        "INSERT INTO snapshot_terminal (id, terminal_id, name, company_name, warehouse_id, warehouse_name)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           terminal_id = excluded.terminal_id,
           name = excluded.name,
           company_name = excluded.company_name,
           warehouse_id = excluded.warehouse_id,
           warehouse_name = excluded.warehouse_name",
        params![
            terminal.id,
            terminal.name,
            terminal.company_name,
            terminal.warehouse.id,
            terminal.warehouse.name,
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

fn store_customer_groups(
    tx: &rusqlite::Transaction<'_>,
    groups: &[SnapshotCustomerGroupInput],
) -> DbResult<()> {
    tx.execute("DELETE FROM snapshot_customer_groups", []).map_err(db_err)?;
    let mut stmt = tx
        .prepare(
            "INSERT INTO snapshot_customer_groups
               (group_id, name, rounding_step, rounding_direction, round_cash_total)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(db_err)?;
    for group in groups {
        stmt.execute(params![
            group.id,
            group.name,
            group.rounding_step,
            group.rounding_direction,
            group.round_cash_total as i64,
        ])
        .map_err(db_err)?;
    }
    Ok(())
}

fn store_group_prices(
    tx: &rusqlite::Transaction<'_>,
    prices: &[SnapshotGroupPriceInput],
) -> DbResult<()> {
    let mut stmt = tx
        .prepare(
            "INSERT INTO snapshot_customer_group_prices (group_id, product_id, rule_type, value)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .map_err(db_err)?;
    for price in prices {
        stmt.execute(params![price.group_id, price.product_id, price.rule_type, price.value])
            .map_err(db_err)?;
    }
    Ok(())
}

/// Simpan direktori nama snapshot (diganti utuh dalam transaksi
/// pemanggil — direktori selalu cermin server terbaru).
fn store_names(tx: &rusqlite::Transaction<'_>, names: &SnapshotNamesInput) -> DbResult<()> {
    tx.execute("DELETE FROM snapshot_names", []).map_err(db_err)?;
    let mut stmt = tx
        .prepare("INSERT INTO snapshot_names (kind, id, name, group_id) VALUES (?1, ?2, ?3, ?4)")
        .map_err(db_err)?;
    for cashier in &names.cashiers {
        stmt.execute(params!["cashier", cashier.id, cashier.name, Option::<String>::None])
            .map_err(db_err)?;
    }
    for customer in &names.customers {
        stmt.execute(params!["customer", customer.id, customer.name, customer.group_id])
            .map_err(db_err)?;
    }
    Ok(())
}

/// Catat identitas terminal dari PAIRING (belum ada snapshot):
/// nama terminal diketahui dari respons pair; perusahaan/gudang
/// dilengkapi snapshot pertama. Snapshot yang datang kemudian
/// menimpa baris ini utuh lewat store_terminal.
pub fn store_terminal_identity(
    conn: &Connection,
    terminal_id: &str,
    name: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO snapshot_terminal (id, terminal_id, name, company_name)
         VALUES (1, ?1, ?2, '')
         ON CONFLICT(id) DO UPDATE SET
           terminal_id = excluded.terminal_id,
           name = excluded.name",
        params![terminal_id, name],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Baca identitas terminal tersimpan; None sebelum pairing/snapshot.
pub fn terminal_identity(conn: &Connection) -> DbResult<Option<TerminalIdentity>> {
    conn.query_row(
        "SELECT terminal_id, name, company_name, warehouse_id, warehouse_name
         FROM snapshot_terminal WHERE id = 1",
        [],
        |row| {
            Ok(TerminalIdentity {
                terminal_id: row.get(0)?,
                name: row.get(1)?,
                company_name: row.get(2)?,
                warehouse_id: row.get(3)?,
                warehouse_name: row.get(4)?,
            })
        },
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(db_err(other)),
    })
}

/// Seluruh direktori nama satu jenis ("cashier" | "customer")
/// sebagai pasangan (id, nama) — untuk konteks cetak.
pub fn snapshot_names(conn: &Connection, kind: &str) -> DbResult<Vec<(String, String)>> {
    let mut stmt = conn
        .prepare("SELECT id, name FROM snapshot_names WHERE kind = ?1 ORDER BY name")
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![kind], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

pub fn snapshot_name_entries(conn: &Connection, kind: &str) -> DbResult<Vec<NameEntryInput>> {
    let mut stmt = conn
        .prepare("SELECT id, name, group_id FROM snapshot_names WHERE kind = ?1 ORDER BY name")
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![kind], |row| {
            Ok(NameEntryInput {
                id: row.get(0)?,
                name: row.get(1)?,
                group_id: row.get(2)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

pub fn snapshot_group_pricing(conn: &Connection) -> DbResult<SnapshotGroupPricing> {
    let mut group_stmt = conn
        .prepare(
            "SELECT group_id, name, rounding_step, rounding_direction, round_cash_total
             FROM snapshot_customer_groups ORDER BY name",
        )
        .map_err(db_err)?;
    let group_rows = group_stmt
        .query_map([], |row| {
            Ok(SnapshotCustomerGroupInput {
                id: row.get(0)?,
                name: row.get(1)?,
                rounding_step: row.get(2)?,
                rounding_direction: row.get(3)?,
                round_cash_total: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(db_err)?;
    let mut groups = Vec::new();
    for row in group_rows {
        groups.push(row.map_err(db_err)?);
    }

    let mut price_stmt = conn
        .prepare(
            "SELECT group_id, product_id, rule_type, value
             FROM snapshot_customer_group_prices ORDER BY group_id, product_id",
        )
        .map_err(db_err)?;
    let price_rows = price_stmt
        .query_map([], |row| {
            Ok(SnapshotGroupPriceInput {
                group_id: row.get(0)?,
                product_id: row.get(1)?,
                rule_type: row.get(2)?,
                value: row.get(3)?,
            })
        })
        .map_err(db_err)?;
    let mut prices = Vec::new();
    for row in price_rows {
        prices.push(row.map_err(db_err)?);
    }
    Ok(SnapshotGroupPricing { groups, prices })
}

/// Selesaikan id → nama dari direktori snapshot ("cashier" |
/// "customer"); None bila id tidak dikenal (pemanggil jatuh ke
/// tampilan id pendek — perilaku Langkah 5).
pub fn resolve_name(conn: &Connection, kind: &str, id: &str) -> DbResult<Option<String>> {
    conn.query_row(
        "SELECT name FROM snapshot_names WHERE kind = ?1 AND id = ?2",
        params![kind, id],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(db_err(other)),
    })
}

/// Baca pengaturan cetak tersimpan; None bila belum ada snapshot
/// yang membawa blok cetak (pemanggil memakai ReceiptSettings
/// bawaan).
pub fn receipt_settings(conn: &Connection) -> DbResult<Option<ReceiptSettings>> {
    conn.query_row(
        "SELECT company_name, address, phone, tax_id, header_text, footer_text,
                show_cashier, show_tax, show_customer, show_session, show_branding,
                receipt_paper, tax_enabled, tax_rate, rounding_mode, qris_image
         FROM snapshot_print WHERE id = 1",
        [],
        |row| {
            Ok(ReceiptSettings {
                company_name: row.get(0)?,
                address: row.get(1)?,
                phone: row.get(2)?,
                tax_id: row.get(3)?,
                header_text: row.get(4)?,
                footer_text: row.get(5)?,
                show_cashier: row.get::<_, i64>(6)? != 0,
                show_tax: row.get::<_, i64>(7)? != 0,
                show_customer: row.get::<_, i64>(8)? != 0,
                show_session: row.get::<_, i64>(9)? != 0,
                show_branding: row.get::<_, i64>(10)? != 0,
                receipt_paper: row.get(11)?,
                tax_enabled: row.get::<_, i64>(12)? != 0,
                tax_rate: row.get(13)?,
                rounding_mode: row.get(14)?,
                qris_image: row.get(15)?,
            })
        },
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(db_err(other)),
    })
}

fn upsert_product(
    stmt: &mut rusqlite::Statement<'_>,
    warehouse_id: &str,
    product: &SnapshotProductInput,
) -> DbResult<()> {
    stmt.execute(params![
        product.id,
        warehouse_id,
        product.sku,
        product.barcode,
        product.name,
        product.category_id,
        product.category_name,
        product.sale_price,
        product.stock,
        product.track_stock as i64,
        product.track_serial as i64,
        product.unit_code,
    ])
    .map_err(db_err)?;
    Ok(())
}

/// Terapkan DELTA snapshot dalam SATU transaksi (Langkah 3):
/// produk berubah di-upsert, id usang dibuang, metode pembayaran
/// diganti utuh, dan kursor meta HANYA maju di transaksi yang sama —
/// kegagalan di tengah membatalkan semuanya termasuk kursor, jadi
/// delta yang sama aman diminta ulang.
pub fn apply_snapshot_delta(
    conn: &mut Connection,
    delta: &SnapshotDeltaInput,
) -> DbResult<SnapshotDeltaStats> {
    let tx = conn.transaction().map_err(db_err)?;
    let warehouse_id = delta
        .warehouse
        .as_ref()
        .map(|w| w.id.clone())
        .unwrap_or_default();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_products
                   (product_id, warehouse_id, sku, barcode, name, category_id, category_name,
                    sale_price, stock, track_stock, track_serial, unit_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(product_id) DO UPDATE SET
                   warehouse_id = excluded.warehouse_id,
                   sku = excluded.sku,
                   barcode = excluded.barcode,
                   name = excluded.name,
                   category_id = excluded.category_id,
                   category_name = excluded.category_name,
                   sale_price = excluded.sale_price,
                   stock = excluded.stock,
                   track_stock = excluded.track_stock,
                   track_serial = excluded.track_serial,
                   unit_code = excluded.unit_code",
            )
            .map_err(db_err)?;
        for product in &delta.products {
            upsert_product(&mut stmt, &warehouse_id, product)?;
        }
    }
    // S5: blok kemasan produk berubah diganti utuh mengikuti
    // produk induknya; produk terbuang kehilangan kemasannya.
    for product in &delta.products {
        store_packagings(&tx, &product.id, &product.packagings)?;
    }
    {
        let mut stmt = tx
            .prepare("DELETE FROM snapshot_products WHERE product_id = ?1")
            .map_err(db_err)?;
        for removed_id in &delta.removed_product_ids {
            stmt.execute(params![removed_id]).map_err(db_err)?;
        }
    }
    {
        let mut stmt = tx
            .prepare("DELETE FROM snapshot_packagings WHERE product_id = ?1")
            .map_err(db_err)?;
        for removed_id in &delta.removed_product_ids {
            stmt.execute(params![removed_id]).map_err(db_err)?;
        }
    }
    let product_count: i64 = tx
        .query_row("SELECT count(*) FROM snapshot_products", [], |row| row.get(0))
        .map_err(db_err)?;
    set_meta(&tx, "product_count", &product_count.to_string())?;
    store_customer_groups(&tx, &delta.customer_groups)?;
    tx.execute(
        "DELETE FROM snapshot_customer_group_prices
         WHERE group_id NOT IN (SELECT group_id FROM snapshot_customer_groups)",
        [],
    )
    .map_err(db_err)?;
    {
        let mut stmt = tx
            .prepare("DELETE FROM snapshot_customer_group_prices WHERE group_id = ?1")
            .map_err(db_err)?;
        for group_id in &delta.replace_group_price_group_ids {
            stmt.execute(params![group_id]).map_err(db_err)?;
        }
    }
    store_group_prices(&tx, &delta.group_prices)?;
    tx.execute("DELETE FROM snapshot_payment_methods", []).map_err(db_err)?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_payment_methods
                   (method_id, code, name, type, fee_enabled, fee_type, fee_value)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(db_err)?;
        for method in &delta.payment_methods {
            stmt.execute(params![
                method.id,
                method.code,
                method.name,
                method.method_type,
                method.fee_enabled as i64,
                method.fee_type,
                method.fee_value,
            ])
                .map_err(db_err)?;
        }
    }
    set_meta(&tx, "version", &delta.version)?;
    set_meta(&tx, "generated_at", &delta.generated_at)?;
    set_meta(&tx, "warehouse_id", &warehouse_id)?;
    set_meta(&tx, "cursor", &delta.cursor)?;
    set_meta(&tx, "can_discount", &delta.can_discount.to_string())?;
    set_meta(
        &tx,
        "pos_offline_enabled",
        &delta.pos_offline_enabled.to_string(),
    )?;
    if let Some(receipt) = &delta.receipt {
        store_receipt(&tx, receipt)?;
    }
    if let Some(terminal) = &delta.terminal {
        store_terminal(&tx, terminal)?;
    }
    if let Some(names) = &delta.names {
        store_names(&tx, names)?;
    }
    tx.commit().map_err(db_err)?;
    Ok(SnapshotDeltaStats {
        cursor: delta.cursor.clone(),
        changed: delta.products.len(),
        removed: delta.removed_product_ids.len(),
        payment_methods: delta.payment_methods.len(),
    })
}

pub fn snapshot_info(conn: &Connection) -> DbResult<SnapshotInfo> {
    let meta = |key: &str| -> DbResult<Option<String>> {
        conn.query_row(
            "SELECT value FROM snapshot_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(db_err(other)),
        })
    };
    let product_count = snapshot_product_count(conn)?;
    let payment_method_count: i64 = conn
        .query_row("SELECT count(*) FROM snapshot_payment_methods", [], |row| {
            row.get(0)
        })
        .map_err(db_err)?;
    let receipt = receipt_settings(conn)?.unwrap_or_default();
    Ok(SnapshotInfo {
        version: meta("version")?,
        cursor: meta("cursor")?,
        generated_at: meta("generated_at")?,
        warehouse_id: meta("warehouse_id")?,
        product_count,
        payment_method_count,
        terminal: terminal_identity(conn)?,
        can_discount: meta("can_discount")?.as_deref() == Some("true"),
        pos_offline_enabled: meta("pos_offline_enabled")?.as_deref() == Some("true"),
        tax_enabled: receipt.tax_enabled,
        tax_rate: receipt.tax_rate,
        rounding_mode: receipt.rounding_mode,
    })
}

/// Seluruh kemasan tersimpan, dikelompokkan per produk (S5).
pub fn list_packagings_by_product(
    conn: &Connection,
) -> DbResult<std::collections::HashMap<String, Vec<SnapshotPackaging>>> {
    let mut stmt = conn
        .prepare(
            "SELECT packaging_id, product_id, name, isi, sale_price, barcode, is_active, is_default_sale
             FROM snapshot_packagings ORDER BY sort_order, name",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                SnapshotPackaging {
                    packaging_id: row.get(0)?,
                    name: row.get(2)?,
                    isi: row.get(3)?,
                    sale_price: row.get(4)?,
                    barcode: row.get(5)?,
                    is_active: row.get::<_, i64>(6)? != 0,
                    is_default_sale: row.get::<_, i64>(7)? != 0,
                },
            ))
        })
        .map_err(db_err)?;
    let mut out: std::collections::HashMap<String, Vec<SnapshotPackaging>> =
        std::collections::HashMap::new();
    for row in rows {
        let (product_id, packaging) = row.map_err(db_err)?;
        out.entry(product_id).or_default().push(packaging);
    }
    Ok(out)
}

pub fn list_products(conn: &Connection) -> DbResult<Vec<SnapshotProduct>> {
    let mut stmt = conn
        .prepare(
            "SELECT product_id, sku, barcode, name, sale_price, stock, track_stock, track_serial, unit_code,
                    category_id, category_name
             FROM snapshot_products ORDER BY name",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotProduct {
                product_id: row.get(0)?,
                sku: row.get(1)?,
                barcode: row.get(2)?,
                name: row.get(3)?,
                sale_price: row.get(4)?,
                stock: row.get(5)?,
                track_stock: row.get::<_, i64>(6)? != 0,
                track_serial: row.get::<_, i64>(7)? != 0,
                unit_code: row.get(8)?,
                category_id: row.get(9)?,
                category_name: row.get(10)?,
                packagings: Vec::new(),
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    let packagings = list_packagings_by_product(conn)?;
    for product in &mut out {
        if let Some(list) = packagings.get(&product.product_id) {
            product.packagings = list.clone();
        }
    }
    Ok(out)
}

fn snapshot_product_count(conn: &Connection) -> DbResult<i64> {
    let cached: Option<String> = conn
        .query_row(
            "SELECT value FROM snapshot_meta WHERE key = 'product_count'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?;
    if let Some(count) = cached.and_then(|value| value.parse::<i64>().ok()) {
        if count >= 0 {
            return Ok(count);
        }
    }
    conn.query_row("SELECT count(*) FROM snapshot_products", [], |row| {
        row.get(0)
    })
    .map_err(db_err)
}

/// Halaman katalog untuk WebView POS. Snapshot penuh tetap disimpan
/// di SQLite agar terminal tetap offline, sementara IPC hanya membawa
/// produk yang sedang tampil.
pub fn list_products_page(
    conn: &Connection,
    search: &str,
    requested_page: u32,
    requested_page_size: u32,
) -> DbResult<SnapshotProductPage> {
    list_products_page_filtered(conn, search, None, requested_page, requested_page_size)
}

pub fn list_products_page_filtered(
    conn: &Connection,
    search: &str,
    category_id: Option<&str>,
    requested_page: u32,
    requested_page_size: u32,
) -> DbResult<SnapshotProductPage> {
    let search = search.trim();
    let escaped = search
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_");
    let pattern = format!("%{escaped}%");
    let total = if search.is_empty() && category_id.is_none() {
        snapshot_product_count(conn)?
    } else {
        conn.query_row(
            r#"SELECT count(*)
               FROM snapshot_products AS p
               WHERE (?1 IS NULL OR p.category_id = ?1)
                 AND (?2 = ''
                   OR p.name LIKE ?3 ESCAPE '!'
                   OR p.sku LIKE ?3 ESCAPE '!'
                   OR p.barcode LIKE ?3 ESCAPE '!'
                   OR EXISTS (
                   SELECT 1 FROM snapshot_packagings AS sp
                   WHERE sp.product_id = p.product_id
                     AND (sp.name LIKE ?3 ESCAPE '!'
                       OR sp.barcode LIKE ?3 ESCAPE '!')
                 ))"#,
            params![category_id, search, pattern],
            |row| row.get(0),
        )
        .map_err(db_err)?
    };
    let total = total.max(0) as usize;
    let page_size = requested_page_size.clamp(1, 100) as usize;
    let page_count = total.div_ceil(page_size);
    let page = if page_count == 0 {
        1
    } else {
        (requested_page.max(1) as usize).min(page_count)
    };
    let offset = (page - 1).saturating_mul(page_size) as i64;
    let mut stmt = conn
        .prepare(
            r#"WITH page_ids AS (
                 SELECT p.product_id, p.name
                 FROM snapshot_products AS p
                 WHERE (?1 IS NULL OR p.category_id = ?1)
                   AND (?2 = ''
                     OR p.name LIKE ?3 ESCAPE '!'
                     OR p.sku LIKE ?3 ESCAPE '!'
                     OR p.barcode LIKE ?3 ESCAPE '!'
                     OR EXISTS (
                     SELECT 1 FROM snapshot_packagings AS sp
                     WHERE sp.product_id = p.product_id
                       AND (sp.name LIKE ?3 ESCAPE '!'
                         OR sp.barcode LIKE ?3 ESCAPE '!')
                   ))
                 ORDER BY p.name COLLATE NOCASE, p.product_id
                 LIMIT ?4 OFFSET ?5
               )
               SELECT p.product_id, p.sku, p.barcode, p.name, p.sale_price,
                      p.stock, p.track_stock, p.track_serial, p.unit_code,
                      p.category_id, p.category_name,
                      sp.packaging_id, sp.name, sp.isi, sp.sale_price,
                      sp.barcode, sp.is_active, sp.is_default_sale
               FROM page_ids AS ids
               JOIN snapshot_products AS p ON p.product_id = ids.product_id
               LEFT JOIN snapshot_packagings AS sp ON sp.product_id = p.product_id
               ORDER BY ids.name COLLATE NOCASE, ids.product_id,
                        sp.sort_order, sp.name, sp.packaging_id"#,
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![category_id, search, pattern, page_size as i64, offset], |row| {
            let product = SnapshotProduct {
                product_id: row.get(0)?,
                sku: row.get(1)?,
                barcode: row.get(2)?,
                name: row.get(3)?,
                sale_price: row.get(4)?,
                stock: row.get(5)?,
                track_stock: row.get::<_, i64>(6)? != 0,
                track_serial: row.get::<_, i64>(7)? != 0,
                unit_code: row.get(8)?,
                category_id: row.get(9)?,
                category_name: row.get(10)?,
                packagings: Vec::new(),
            };
            let packaging_id: Option<String> = row.get(11)?;
            let packaging = match packaging_id {
                Some(packaging_id) => Some(SnapshotPackaging {
                    packaging_id,
                    name: row.get(12)?,
                    isi: row.get(13)?,
                    sale_price: row.get(14)?,
                    barcode: row.get(15)?,
                    is_active: row.get::<_, i64>(16)? != 0,
                    is_default_sale: row.get::<_, i64>(17)? != 0,
                }),
                None => None,
            };
            Ok((product, packaging))
        })
        .map_err(db_err)?;
    let mut products: Vec<SnapshotProduct> = Vec::with_capacity(page_size.min(total));
    for row in rows {
        let (product, packaging) = row.map_err(db_err)?;
        if let Some(existing) = products.last_mut() {
            if existing.product_id == product.product_id {
                if let Some(packaging) = packaging {
                    existing.packagings.push(packaging);
                }
                continue;
            }
        }
        let mut product = product;
        if let Some(packaging) = packaging {
            product.packagings.push(packaging);
        }
        products.push(product);
    }
    Ok(SnapshotProductPage {
        products,
        total,
        page,
        page_size,
        page_count,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCategory {
    pub id: String,
    pub name: String,
    pub count: i64,
}

/// Saldo poin loyalitas pelanggan (dari snapshot server).
pub fn list_snapshot_loyalty_balances(
    conn: &Connection,
) -> DbResult<Vec<SnapshotLoyaltyBalanceInput>> {
    let mut stmt = conn
        .prepare("SELECT customer_id, points FROM snapshot_loyalty_balances ORDER BY customer_id")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotLoyaltyBalanceInput {
                customer_id: row.get(0)?,
                points: row.get(1)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Promosi aktif yang bisa diterapkan kasir (dari snapshot server).
pub fn list_snapshot_promotions(conn: &Connection) -> DbResult<Vec<SnapshotPromotionInput>> {
    let mut stmt = conn
        .prepare("SELECT id, name, promo_type, value, min_subtotal, product_id FROM snapshot_promotions ORDER BY name")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotPromotionInput {
                id: row.get(0)?,
                name: row.get(1)?,
                promo_type: row.get(2)?,
                value: row.get(3)?,
                min_subtotal: row.get(4)?,
                product_id: row.get(5)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Tiket preparation display yang tersimpan dari snapshot server.
pub fn list_snapshot_kitchen_tickets(conn: &Connection) -> DbResult<Vec<SnapshotKitchenTicketInput>> {
    let mut stmt = conn
        .prepare("SELECT sale_id, number, created_at, lines_json FROM snapshot_kitchen_tickets ORDER BY created_at")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            let lines_json: String = row.get(3)?;
            let lines: Vec<SnapshotKitchenTicketLineInput> =
                serde_json::from_str(&lines_json).unwrap_or_default();
            Ok(SnapshotKitchenTicketInput {
                sale_id: row.get(0)?,
                number: row.get(1)?,
                created_at: row.get(2)?,
                lines,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Reservasi stok aktif yang bisa dipilih saat checkout (dari snapshot server).
pub fn list_snapshot_reservations(conn: &Connection) -> DbResult<Vec<SnapshotReservationInput>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, number, product_id, qty, expires_at, reason
             FROM snapshot_reservations ORDER BY number",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotReservationInput {
                id: row.get(0)?,
                number: row.get(1)?,
                product_id: row.get(2)?,
                qty: row.get(3)?,
                expires_at: row.get(4)?,
                reason: row.get(5)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Gudang yang tersedia untuk pemilih register kasir (dari snapshot server).
pub fn list_snapshot_warehouses(conn: &Connection) -> DbResult<Vec<SnapshotWarehouseInput>> {
    let mut stmt = conn
        .prepare("SELECT id, code, name, is_default FROM snapshot_warehouses ORDER BY is_default DESC, name")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotWarehouseInput {
                id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                is_default: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

pub fn list_snapshot_categories(conn: &Connection) -> DbResult<Vec<SnapshotCategory>> {
    let mut stmt = conn
        .prepare(
            "SELECT category_id, max(category_name), count(*)
             FROM snapshot_products
             WHERE category_id IS NOT NULL AND trim(coalesce(category_name, '')) <> ''
             GROUP BY category_id
             ORDER BY max(category_name) COLLATE NOCASE, category_id",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(db_err)?;
    rows.map(|row| row.map_err(db_err)).collect()
}

fn list_packagings_for_product(
    conn: &Connection,
    product_id: &str,
) -> DbResult<Vec<SnapshotPackaging>> {
    let mut stmt = conn
        .prepare(
            "SELECT packaging_id, name, isi, sale_price, barcode, is_active, is_default_sale
             FROM snapshot_packagings WHERE product_id = ?1
             ORDER BY sort_order, name, packaging_id",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![product_id], |row| {
            Ok(SnapshotPackaging {
                packaging_id: row.get(0)?,
                name: row.get(1)?,
                isi: row.get(2)?,
                sale_price: row.get(3)?,
                barcode: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                is_default_sale: row.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(db_err)?;
    rows.map(|row| row.map_err(db_err)).collect()
}

fn get_product_by_id(conn: &Connection, product_id: &str) -> DbResult<Option<SnapshotProduct>> {
    let mut product = conn
        .query_row(
            "SELECT product_id, sku, barcode, name, sale_price, stock,
                    track_stock, track_serial, unit_code, category_id, category_name
             FROM snapshot_products WHERE product_id = ?1",
            params![product_id],
            |row| {
                Ok(SnapshotProduct {
                    product_id: row.get(0)?,
                    sku: row.get(1)?,
                    barcode: row.get(2)?,
                    name: row.get(3)?,
                    sale_price: row.get(4)?,
                    stock: row.get(5)?,
                    track_stock: row.get::<_, i64>(6)? != 0,
                    track_serial: row.get::<_, i64>(7)? != 0,
                    unit_code: row.get(8)?,
                    category_id: row.get(9)?,
                    category_name: row.get(10)?,
                    packagings: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(db_err)?;
    if let Some(product) = &mut product {
        product.packagings = list_packagings_for_product(conn, product_id)?;
    }
    Ok(product)
}

pub fn get_products_by_ids(conn: &Connection, product_ids: &[String]) -> DbResult<Vec<SnapshotProduct>> {
    if product_ids.len() > 200 {
        return Err("Maksimal 200 produk dapat dimuat untuk satu pesanan.".to_string());
    }
    let mut products = Vec::with_capacity(product_ids.len());
    for product_id in product_ids {
        uuid::Uuid::parse_str(product_id)
            .map_err(|_| "Identitas produk pada pesanan tidak valid.".to_string())?;
        if let Some(product) = get_product_by_id(conn, product_id)? {
            products.push(product);
        }
    }
    Ok(products)
}

/// Cari barcode/SKU dengan indeks SQLite. Barcode kemasan aktif
/// tetap diprioritaskan seperti pemindaian katalog di terminal lama.
pub fn find_product_by_code(
    conn: &Connection,
    raw_code: &str,
) -> DbResult<Option<SnapshotProductMatch>> {
    let code = raw_code.trim();
    if code.is_empty() {
        return Ok(None);
    }
    let packaging_match: Option<(String, String)> = conn
        .query_row(
            "SELECT p.product_id, sp.packaging_id
             FROM snapshot_packagings AS sp
             JOIN snapshot_products AS p ON p.product_id = sp.product_id
             WHERE sp.barcode = ?1 AND sp.is_active = 1
             ORDER BY p.name COLLATE NOCASE, p.product_id,
                      sp.sort_order, sp.name, sp.packaging_id
             LIMIT 1",
            params![code],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_err)?;
    if let Some((product_id, packaging_id)) = packaging_match {
        return Ok(
            get_product_by_id(conn, &product_id)?.map(|product| SnapshotProductMatch {
                product,
                packaging_id: Some(packaging_id),
            }),
        );
    }
    let product_id: Option<String> = conn
        .query_row(
            "SELECT product_id FROM snapshot_products
             WHERE barcode = ?1 OR sku = ?1
             ORDER BY name COLLATE NOCASE, product_id
             LIMIT 1",
            params![code],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?;
    match product_id {
        Some(product_id) => {
            Ok(
                get_product_by_id(conn, &product_id)?.map(|product| SnapshotProductMatch {
                    product,
                    packaging_id: None,
                }),
            )
        }
        None => Ok(None),
    }
}

pub fn list_payment_methods(conn: &Connection) -> DbResult<Vec<SnapshotPaymentMethod>> {
    let mut stmt = conn
        .prepare(
            "SELECT method_id, code, name, type, fee_enabled, fee_type, fee_value
             FROM snapshot_payment_methods ORDER BY name",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotPaymentMethod {
                method_id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                method_type: row.get(3)?,
                fee_enabled: row.get::<_, i64>(4)? != 0,
                fee_type: row.get(5)?,
                fee_value: row.get(6)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Catat penjualan lokal + baris + outbox dalam SATU transaksi.
/// clientKey duplikat atau baris di luar snapshot → seluruh
/// transaksi batal (tidak ada penjualan setengah tercatat).
pub fn record_sale(conn: &mut Connection, sale: &SaleInput) -> DbResult<OutboxItem> {
    record_sale_from_held(conn, sale, None)
}

/// Catat penjualan dan konsumsi pesanan tahan dalam satu transaksi
/// SQLite agar crash tidak menggandakan atau menghilangkan pesanan.
pub fn record_sale_from_held(
    conn: &mut Connection,
    sale: &SaleInput,
    held_sale_id: Option<&str>,
) -> DbResult<OutboxItem> {
    record_sale_inner(conn, sale, held_sale_id, None)
}

/// Jalur produksi desktop: simpan konteks cetak yang berlaku saat transaksi
/// dibuat bersama penjualan, agar nota asli dan cetak ulang tidak berubah
/// ketika katalog atau pengaturan perusahaan diperbarui.
pub fn record_sale_from_held_with_receipt_context(
    conn: &mut Connection,
    sale: &SaleInput,
    held_sale_id: Option<&str>,
    receipt_context: &ReceiptContext,
) -> DbResult<OutboxItem> {
    record_sale_inner(conn, sale, held_sale_id, Some(receipt_context))
}

fn record_sale_inner(
    conn: &mut Connection,
    sale: &SaleInput,
    held_sale_id: Option<&str>,
    receipt_context: Option<&ReceiptContext>,
) -> DbResult<OutboxItem> {
    if sale.lines.is_empty() {
        return Err("Penjualan tanpa baris tidak dapat dicatat.".to_string());
    }
    let payload_json = serde_json::to_string(sale).map_err(|error| error.to_string())?;
    let receipt_context_json = receipt_context
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| error.to_string())?;
    let expected_total = sale
        .expected_total
        .unwrap_or_else(|| sale.payments.iter().map(|p| p.amount).sum());
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(db_err)?;
    let existing: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT payload_json, held_sale_id FROM local_sales WHERE client_key = ?1",
            params![sale.client_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_err)?;
    if let Some((existing_payload, existing_held_sale_id)) = existing {
        let mut existing_value: serde_json::Value =
            serde_json::from_str(&existing_payload).map_err(|error| error.to_string())?;
        let mut requested_value =
            serde_json::to_value(sale).map_err(|error| error.to_string())?;
        // queuedAt is transport metadata. A retry can be constructed a few
        // seconds later, while every business field and the client key are
        // unchanged. Keep the first timestamp and return its saved outbox row.
        if let Some(object) = existing_value.as_object_mut() {
            object.remove("queuedAt");
        }
        if let Some(object) = requested_value.as_object_mut() {
            object.remove("queuedAt");
        }
        if existing_value == requested_value
            && existing_held_sale_id.as_deref() == held_sale_id
        {
            tx.commit().map_err(db_err)?;
            return get_outbox_by_key(conn, &sale.client_key)?
                .ok_or_else(|| "Penjualan terminal ditemukan tanpa baris antrean.".to_string());
        }
        return Err(
            "Kunci checkout ini sudah dipakai untuk transaksi lain. Periksa riwayat penjualan sebelum membuat transaksi baru."
                .to_string(),
        );
    }
    tx.execute(
        "INSERT INTO local_sales
           (client_key, warehouse_id, sale_date, expected_total, payload_json,
            held_sale_id, receipt_context_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            sale.client_key,
            sale.warehouse_id,
            sale.date,
            expected_total.to_string(),
            payload_json,
            held_sale_id,
            receipt_context_json,
            sale.queued_at,
        ],
    )
    .map_err(db_err)?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO local_sale_lines
                   (client_key, product_id, qty, unit_price, discount_type, discount_value,
                    packaging_id, qty_input, isi_snapshot)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )
            .map_err(db_err)?;
        for line in &sale.lines {
            // Integritas snapshot ditegakkan eksplisit DI DALAM
            // transaksi (pengganti FK yang sengaja dibuang — lihat
            // skema): baris di luar snapshot menggagalkan seluruh
            // pencatatan, termasuk baris yang sudah sempat tertulis.
            let product_row: Option<(f64, i64)> = tx
                .query_row(
                    "SELECT stock, track_stock FROM snapshot_products WHERE product_id = ?1",
                    params![line.product_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map(Some)
                .or_else(|error| match error {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(other),
                })
                .map_err(db_err)?;
            let (stock_now, track_stock) = match product_row {
                Some(row) => row,
                None => {
                    return Err(format!(
                        "Produk {} tidak ada di snapshot lokal; penjualan dibatalkan utuh.",
                        line.product_id
                    ));
                }
            };
            // S5: faktor konversi baris — cuplikan muatan untuk
            // baris berkemasan (kemasannya wajib dikenal snapshot
            // lokal produk ini & aktif; kemasan terarsip tidak
            // melahirkan penjualan baru, cermin aturan server),
            // 1 untuk baris satuan dasar.
            let isi = match &line.packaging_id {
                Some(packaging_id) => {
                    let known: i64 = tx
                        .query_row(
                            "SELECT count(*) FROM snapshot_packagings
                             WHERE packaging_id = ?1 AND product_id = ?2 AND is_active = 1",
                            params![packaging_id, line.product_id],
                            |row| row.get(0),
                        )
                        .map_err(db_err)?;
                    if known == 0 {
                        return Err(format!(
                            "Kemasan {packaging_id} tidak dikenal snapshot lokal untuk produk {}; penjualan dibatalkan utuh.",
                            line.product_id
                        ));
                    }
                    match line.isi_snapshot {
                        Some(value) if value > 0.0 => value,
                        _ => {
                            return Err(
                                "Baris berkemasan tanpa faktor cuplikan (isiSnapshot); penjualan dibatalkan utuh."
                                    .to_string(),
                            );
                        }
                    }
                }
                None => 1.0,
            };
            stmt.execute(params![
                sale.client_key,
                line.product_id,
                line.qty,
                line.unit_price.map(|value| value.to_string()),
                line.discount_type,
                line.discount_value,
                line.packaging_id,
                line.packaging_id.as_ref().map(|_| line.qty),
                line.packaging_id.as_ref().map(|_| isi),
            ])
            .map_err(db_err)?;
            // Stok lokal berkurang dalam SATUAN DASAR (qty input ×
            // isi cuplikan) pada transaksi yang sama, agar tampilan
            // stok terminal jujur di antara dua snapshot; snapshot
            // berikutnya menimpa angka ini dengan nilai server.
            // Produk tak terlacak stok tidak dikurangi (cermin
            // semantik track_stock server).
            if track_stock != 0 {
                tx.execute(
                    "UPDATE snapshot_products SET stock = ?2 WHERE product_id = ?1",
                    params![line.product_id, stock_now - line.qty * isi],
                )
                .map_err(db_err)?;
            }
        }
    }
    tx.execute(
        "INSERT INTO outbox (client_key, payload_json, status, attempts, created_at, updated_at)
         VALUES (?1, ?2, 'pending', 0, ?3, ?3)",
        params![sale.client_key, payload_json, sale.queued_at],
    )
    .map_err(db_err)?;
    // Langkah 5 (D6): tugas cetak salinan ke-0 diantrekan dalam
    // transaksi yang SAMA — dipilih atas "segera sesudahnya" agar
    // setiap penjualan tercatat dijamin memiliki tepat satu tugas
    // cetak walau proses mati sedetik sesudah pencatatan (filosofi
    // outbox yang sama). Mencetaknya sendiri terjadi belakangan
    // dari antrean; printer mati tidak pernah menggagalkan
    // penjualan ini.
    tx.execute(
        "INSERT INTO print_jobs (id, client_key, copy_index, status, attempts, created_at, updated_at)
         VALUES (?1, ?2, 0, 'pending', 0, ?3, ?3)",
        params![
            uuid::Uuid::new_v4().to_string(),
            sale.client_key,
            sale.queued_at,
        ],
    )
    .map_err(db_err)?;
    if let Some(held_id) = held_sale_id {
        let parsed_id = uuid::Uuid::parse_str(held_id)
            .map_err(|_| "Identitas pesanan tahan tidak valid.".to_string())?;
        let changed = tx
            .execute(
                "DELETE FROM local_held_sales WHERE id = ?1",
                params![parsed_id.to_string()],
            )
            .map_err(db_err)?;
        if changed != 1 {
            return Err("Pesanan tahan sudah tidak tersedia; transaksi belum dicatat.".to_string());
        }
    }
    tx.commit().map_err(db_err)?;
    get_outbox_by_key(conn, &sale.client_key)?
        .ok_or_else(|| "Baris outbox tidak ditemukan sesudah pencatatan.".to_string())
}

/// Simpan pesanan tahan terminal secara lokal. Ini tidak mengurangi stok,
/// tidak membuat jurnal, dan tidak mengirim pesanan ke server.
pub fn save_held_sale(
    conn: &Connection,
    id: &str,
    label: &str,
    payload: &serde_json::Value,
    now: &str,
) -> DbResult<LocalHeldSale> {
    let parsed_id = uuid::Uuid::parse_str(id)
        .map_err(|_| "Identitas pesanan tahan tidak valid.".to_string())?;
    let label = label.trim();
    if label.is_empty() || label.chars().count() > 100 {
        return Err("Nama pesanan tahan harus berisi 1–100 karakter.".to_string());
    }
    let lines = payload.get("cart").and_then(serde_json::Value::as_array);
    if !payload.is_object() || !matches!(lines, Some(rows) if !rows.is_empty() && rows.len() <= 200) {
        return Err("Isi pesanan tahan kosong atau tidak valid.".to_string());
    }
    let payload_json = serde_json::to_string(payload).map_err(|error| error.to_string())?;
    let id = parsed_id.to_string();
    conn.execute(
        "INSERT INTO local_held_sales (id, label, payload_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at",
        params![id, label, payload_json, now],
    )
    .map_err(db_err)?;
    conn.query_row(
        "SELECT id, label, payload_json, created_at, updated_at
         FROM local_held_sales WHERE id = ?1",
        params![id],
        |row| {
            let payload_text: String = row.get(2)?;
            let payload = serde_json::from_str(&payload_text).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    2,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(LocalHeldSale {
                id: row.get(0)?,
                label: row.get(1)?,
                payload,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(db_err)
}

pub fn list_held_sales(conn: &Connection) -> DbResult<Vec<LocalHeldSale>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, label, payload_json, created_at, updated_at
             FROM local_held_sales ORDER BY updated_at DESC, id",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            let payload_text: String = row.get(2)?;
            let payload = serde_json::from_str(&payload_text).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    2,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(LocalHeldSale {
                id: row.get(0)?,
                label: row.get(1)?,
                payload,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

pub fn delete_held_sale(conn: &Connection, id: &str) -> DbResult<()> {
    let changed = conn
        .execute("DELETE FROM local_held_sales WHERE id = ?1", params![id])
        .map_err(db_err)?;
    if changed == 0 {
        return Err("Pesanan tahan tidak ditemukan di perangkat ini.".to_string());
    }
    Ok(())
}

/// Baca satu penjualan antrean lewat primary key tanpa memuat seluruh outbox.
pub fn get_outbox_by_key(conn: &Connection, client_key: &str) -> DbResult<Option<OutboxItem>> {
    match conn.query_row(
        "SELECT client_key, status, payload_json, attempts, last_message, created_at, updated_at
         FROM outbox WHERE client_key = ?1",
        params![client_key],
        map_outbox_row,
    ) {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(db_err(error)),
    }
}

/// Hitung item outbox berdasarkan status tanpa membaca atau mendekode payload.
pub fn count_outbox(conn: &Connection, status: &str) -> DbResult<i64> {
    conn.query_row(
        "SELECT count(*) FROM outbox WHERE status = ?1",
        params![status],
        |row| row.get(0),
    )
    .map_err(db_err)
}

/// Baca antrean outbox. `status` kosong = antrean hidup
/// (pending + inflight + held) — yang synced hanya untuk audit lokal.
pub fn list_outbox(conn: &Connection, status: Option<&str>) -> DbResult<Vec<OutboxItem>> {
    let (sql, wanted): (&str, Vec<String>) = match status {
        Some(one) => (
            "SELECT client_key, status, payload_json, attempts, last_message, created_at, updated_at
             FROM outbox WHERE status = ?1 ORDER BY created_at",
            vec![one.to_string()],
        ),
        None => (
            "SELECT client_key, status, payload_json, attempts, last_message, created_at, updated_at
             FROM outbox WHERE status IN ('pending', 'inflight', 'held') ORDER BY created_at",
            Vec::new(),
        ),
    };
    let mut stmt = conn.prepare(sql).map_err(db_err)?;
    let rows = if wanted.is_empty() {
        stmt.query_map([], map_outbox_row).map_err(db_err)?
    } else {
        stmt.query_map(params![wanted[0]], map_outbox_row)
            .map_err(db_err)?
    };
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Halaman ringkasan outbox untuk UI. Payload penjualan penuh tetap
/// tersedia bagi mesin sinkron lewat `list_outbox`, tetapi tidak
/// dikirim ke WebView hanya untuk merender daftar antrean.
pub fn list_outbox_page(
    conn: &Connection,
    requested_page: u32,
    requested_page_size: u32,
) -> DbResult<OutboxPage> {
    let page_size = requested_page_size.clamp(1, 100) as usize;
    let total: i64 = conn
        .query_row(
            "SELECT count(*) FROM outbox
             WHERE status IN ('pending', 'inflight', 'held')",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    let total = total.max(0) as usize;
    let page_count = total.div_ceil(page_size);
    let page = if page_count == 0 {
        1
    } else {
        (requested_page.max(1) as usize).min(page_count)
    };
    let offset = (page - 1).saturating_mul(page_size) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT o.client_key, o.status, s.expected_total, o.attempts,
                    o.last_message, o.created_at, o.updated_at
             FROM outbox AS o INDEXED BY idx_outbox_live_created_at
             LEFT JOIN local_sales AS s ON s.client_key = o.client_key
             WHERE o.status IN ('pending', 'inflight', 'held')
             ORDER BY o.created_at, o.client_key
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![page_size as i64, offset], |row| {
            Ok(OutboxSummary {
                client_key: row.get(0)?,
                status: row.get(1)?,
                expected_total: row.get(2)?,
                attempts: row.get(3)?,
                last_message: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(db_err)?;
    let mut items = Vec::with_capacity(page_size.min(total));
    for row in rows {
        items.push(row.map_err(db_err)?);
    }
    Ok(OutboxPage {
        items,
        total,
        page,
        page_size,
        page_count,
    })
}

/// Riwayat penjualan lokal terminal, termasuk transaksi yang sudah
/// tersinkron. Data dibaca terhalaman agar tetap ringan saat terminal
/// menyimpan banyak transaksi.
pub fn list_local_sales_page(
    conn: &Connection,
    requested_page: u32,
    requested_page_size: u32,
    query: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> DbResult<LocalSalesPage> {
    let page_size = requested_page_size.clamp(1, 100) as usize;
    let query = query.trim();
    let total: i64 = conn
        .query_row(
            "SELECT count(*) FROM local_sales AS s
             WHERE (?1 = '' OR lower(s.client_key) LIKE '%' || lower(?1) || '%'
                    OR s.sale_date LIKE '%' || ?1 || '%')
               AND (?2 IS NULL OR s.sale_date >= ?2)
               AND (?3 IS NULL OR s.sale_date <= ?3)",
            params![query, from, to],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    let total = total.max(0) as usize;
    let page_count = total.div_ceil(page_size);
    let page = if page_count == 0 {
        1
    } else {
        (requested_page.max(1) as usize).min(page_count)
    };
    let offset = (page - 1).saturating_mul(page_size) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT s.client_key, s.sale_date, s.expected_total, s.created_at,
                    COALESCE(o.status, 'unknown'), o.last_message, count(l.id)
             FROM local_sales AS s
             LEFT JOIN outbox AS o ON o.client_key = s.client_key
             LEFT JOIN local_sale_lines AS l ON l.client_key = s.client_key
             WHERE (?1 = '' OR lower(s.client_key) LIKE '%' || lower(?1) || '%'
                    OR s.sale_date LIKE '%' || ?1 || '%')
               AND (?2 IS NULL OR s.sale_date >= ?2)
               AND (?3 IS NULL OR s.sale_date <= ?3)
             GROUP BY s.client_key
             ORDER BY s.created_at DESC, s.client_key DESC
             LIMIT ?4 OFFSET ?5",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![query, from, to, page_size as i64, offset], |row| {
            Ok(LocalSaleHistoryRow {
                client_key: row.get(0)?,
                sale_date: row.get(1)?,
                expected_total: row.get(2)?,
                created_at: row.get(3)?,
                status: row.get(4)?,
                last_message: row.get(5)?,
                line_count: row.get(6)?,
            })
        })
        .map_err(db_err)?;
    let mut items = Vec::with_capacity(page_size.min(total));
    for row in rows {
        items.push(row.map_err(db_err)?);
    }
    Ok(LocalSalesPage {
        items,
        total,
        page,
        page_size,
        page_count,
    })
}

fn map_outbox_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxItem> {
    let payload_text: String = row.get(2)?;
    Ok(OutboxItem {
        client_key: row.get(0)?,
        status: row.get(1)?,
        payload: serde_json::from_str(&payload_text)
            .unwrap_or(serde_json::Value::String(payload_text)),
        attempts: row.get(3)?,
        last_message: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

/// Terapkan hasil sinkronisasi server ke antrean lokal — cermin
/// semantik web (`applySyncResults`): synced/duplicate selesai
/// (baris lokal dipertahankan sebagai audit terminal dan ditandai
/// synced), conflict/failed menjadi held dengan pesan terakhirnya.
pub fn apply_sync_results(
    conn: &mut Connection,
    results: &[SyncResultInput],
    now_iso: &str,
) -> DbResult<()> {
    let tx = conn.transaction().map_err(db_err)?;
    for result in results {
        match result.status.as_str() {
            "synced" | "duplicate" => {
                tx.execute(
                    "UPDATE outbox SET status = 'synced', last_message = ?2, updated_at = ?3
                     WHERE client_key = ?1",
                    params![result.client_key, result.message, now_iso],
                )
                .map_err(db_err)?;
            }
            "conflict" | "failed" => {
                tx.execute(
                    "UPDATE outbox SET status = 'held', attempts = attempts + 1,
                       last_message = ?2, updated_at = ?3
                     WHERE client_key = ?1",
                    params![result.client_key, result.message, now_iso],
                )
                .map_err(db_err)?;
            }
            other => {
                return Err(format!("Status hasil sinkronisasi tidak dikenal: {other}"));
            }
        }
    }
    tx.commit().map_err(db_err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Klaim outbox untuk mesin sinkron Rust (Langkah 4, D7)
// ---------------------------------------------------------------------------

/// Kembalikan semua item `inflight` ke `pending`. Dijalankan saat
/// startup dan di awal setiap putaran drain: item yang tertinggal
/// inflight berarti proses mati di tengah pengiriman — aman
/// dikirim ulang karena server menolak duplikat per clientKey.
pub fn reset_inflight(conn: &Connection, now_iso: &str) -> DbResult<usize> {
    let changed = conn
        .execute(
            "UPDATE outbox SET status = 'pending', updated_at = ?1 WHERE status = 'inflight'",
            params![now_iso],
        )
        .map_err(db_err)?;
    Ok(changed)
}

/// Klaim hingga `limit` item pending tertua menjadi `inflight`
/// dalam satu transaksi, dan kembalikan isinya untuk dikirim.
/// Single-flight dijaga pemanggil (satu drain berjalan pada satu
/// waktu); klaim atomik ini memastikan item tidak terkirim ganda
/// walau dua pemicu drain tumpang-tindih.
pub fn claim_pending(
    conn: &mut Connection,
    limit: usize,
    now_iso: &str,
) -> DbResult<Vec<OutboxItem>> {
    let tx = conn.transaction().map_err(db_err)?;
    let mut ids = Vec::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT client_key FROM outbox WHERE status = 'pending'
                 ORDER BY created_at LIMIT ?1",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![limit as i64], |row| row.get::<_, String>(0))
            .map_err(db_err)?;
        for row in rows {
            ids.push(row.map_err(db_err)?);
        }
    }
    {
        let mut stmt = tx
            .prepare("UPDATE outbox SET status = 'inflight', updated_at = ?2 WHERE client_key = ?1")
            .map_err(db_err)?;
        for id in &ids {
            stmt.execute(params![id, now_iso]).map_err(db_err)?;
        }
    }
    tx.commit().map_err(db_err)?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let claimed = list_outbox(conn, Some("inflight"))?;
    Ok(claimed
        .into_iter()
        .filter(|item| ids.contains(&item.client_key))
        .collect())
}

/// Kembalikan item yang sudah diklaim ke `pending` (pengiriman
/// gagal total: jaringan putus / token ditolak). Item tidak hilang
/// dan tidak bertambah attempts — kegagalan prasyarat bukan
/// kegagalan item.
pub fn revert_claimed(conn: &Connection, client_keys: &[String], now_iso: &str) -> DbResult<()> {
    for key in client_keys {
        conn.execute(
            "UPDATE outbox SET status = 'pending', updated_at = ?2
             WHERE client_key = ?1 AND status = 'inflight'",
            params![key, now_iso],
        )
        .map_err(db_err)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Antrean cetak lokal (Langkah 5, D6) — pola yang sama dengan
// outbox sinkron: klaim atomik pending → printing, hasil diterapkan
// printed/failed, klaim yatim dipulihkan saat startup. Bedanya:
// kegagalan cetak bersifat informatif (struk bisa dicetak ulang),
// BUKAN keadaan tahan-review — penjualan tidak pernah terpengaruh.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    pub id: String,
    pub client_key: String,
    /// 0 = cetakan asli; ≥1 = cetak ulang (struk berpita SALINAN).
    pub copy_index: i64,
    pub status: String,
    pub attempts: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerReceiptPrintJob {
    pub id: String,
    pub sale_id: String,
    pub status: String,
    pub attempts: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printed_at: Option<String>,
}

/// Muatan privat pekerja cetak. Byte ESC/POS tidak pernah diserialisasi
/// ke webview atau dikembalikan oleh command Tauri.
#[derive(Debug, Clone)]
pub struct ServerReceiptPrintPayload {
    pub id: String,
    pub sale_id: String,
    pub receipt_bytes: Vec<u8>,
}

fn map_server_receipt_print_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<ServerReceiptPrintJob> {
    Ok(ServerReceiptPrintJob {
        id: row.get(0)?,
        sale_id: row.get(1)?,
        status: row.get(2)?,
        attempts: row.get(3)?,
        last_error: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        printed_at: row.get(7)?,
    })
}

const SERVER_RECEIPT_PRINT_JOB_COLUMNS: &str =
    "id, sale_id, status, attempts, last_error, created_at, updated_at, printed_at";

fn map_print_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<PrintJob> {
    Ok(PrintJob {
        id: row.get(0)?,
        client_key: row.get(1)?,
        copy_index: row.get(2)?,
        status: row.get(3)?,
        attempts: row.get(4)?,
        last_error: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        printed_at: row.get(8)?,
    })
}

const PRINT_JOB_COLUMNS: &str = "id, client_key, copy_index, status, attempts,
    last_error, created_at, updated_at, printed_at";

pub fn get_print_job(conn: &Connection, id: &str) -> DbResult<Option<PrintJob>> {
    conn.query_row(
        &format!("SELECT {PRINT_JOB_COLUMNS} FROM print_jobs WHERE id = ?1"),
        params![id],
        map_print_job,
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(db_err(other)),
    })
}

/// Antrekan tugas cetak untuk sebuah penjualan tercatat.
/// `copy_index` = jumlah tugas yang sudah ada untuk penjualan itu
/// (0 untuk cetakan asli dari `record_sale`, berikutnya untuk
/// cetak ulang dari riwayat).
pub fn enqueue_print_job(
    conn: &Connection,
    client_key: &str,
    now_iso: &str,
) -> DbResult<PrintJob> {
    let sale_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM local_sales WHERE client_key = ?1",
            params![client_key],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if sale_exists == 0 {
        return Err("Penjualan lokal tidak ditemukan untuk dicetak.".to_string());
    }
    let copy_index: i64 = conn
        .query_row(
            "SELECT coalesce(max(copy_index), -1) + 1 FROM print_jobs WHERE client_key = ?1",
            params![client_key],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO print_jobs (id, client_key, copy_index, status, attempts, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4)",
        params![id, client_key, copy_index, now_iso],
    )
    .map_err(db_err)?;
    get_print_job(conn, &id)?
        .ok_or_else(|| "Tugas cetak tidak ditemukan sesudah diantrekan.".to_string())
}

/// Daftar tugas cetak untuk UI: tanpa status = riwayat terbaru
/// dulu (antrean + hasil), dengan status = saringan persis.
pub fn list_print_jobs(conn: &Connection, status: Option<&str>) -> DbResult<Vec<PrintJob>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {PRINT_JOB_COLUMNS} FROM print_jobs
             WHERE (?1 IS NULL OR status = ?1)
             ORDER BY created_at DESC LIMIT 200"
        ))
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![status], map_print_job)
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Kembalikan tugas `printing` yatim ke `pending` (proses mati di
/// tengah kirim ke printer) — aman: struk yang mungkin sempat
/// tercetak separuh dicetak ulang utuh dari antrean.
pub fn reset_printing(conn: &Connection, now_iso: &str) -> DbResult<usize> {
    let changed = conn
        .execute(
            "UPDATE print_jobs SET status = 'pending', updated_at = ?1 WHERE status = 'printing'",
            params![now_iso],
        )
        .map_err(db_err)?;
    Ok(changed)
}

/// Klaim hingga `limit` tugas pending tertua menjadi `printing`
/// dalam satu transaksi (pola klaim outbox).
pub fn claim_print_jobs(
    conn: &mut Connection,
    limit: usize,
    now_iso: &str,
) -> DbResult<Vec<PrintJob>> {
    let tx = conn.transaction().map_err(db_err)?;
    let mut ids = Vec::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT id FROM print_jobs WHERE status = 'pending'
                 ORDER BY created_at LIMIT ?1",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![limit as i64], |row| row.get::<_, String>(0))
            .map_err(db_err)?;
        for row in rows {
            ids.push(row.map_err(db_err)?);
        }
    }
    {
        let mut stmt = tx
            .prepare("UPDATE print_jobs SET status = 'printing', updated_at = ?2 WHERE id = ?1")
            .map_err(db_err)?;
        for id in &ids {
            stmt.execute(params![id, now_iso]).map_err(db_err)?;
        }
    }
    tx.commit().map_err(db_err)?;
    let mut out = Vec::new();
    for id in &ids {
        if let Some(job) = get_print_job(conn, id)? {
            out.push(job);
        }
    }
    Ok(out)
}

pub fn mark_print_job_printed(conn: &Connection, id: &str, now_iso: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE print_jobs SET status = 'printed', printed_at = ?2, updated_at = ?2,
           last_error = NULL WHERE id = ?1",
        params![id, now_iso],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn mark_print_job_failed(
    conn: &Connection,
    id: &str,
    error: &str,
    now_iso: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE print_jobs SET status = 'failed', attempts = attempts + 1,
           last_error = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, error, now_iso],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Coba ulang tugas cetak yang gagal tanpa membuat nomor salinan baru.
/// Status bersyarat mencegah dua kasir mengantrekan ulang pekerjaan yang
/// sama setelah salah satunya sudah berhasil lebih dulu.
pub fn retry_failed_print_job(conn: &Connection, id: &str, now_iso: &str) -> DbResult<PrintJob> {
    let changed = conn
        .execute(
            "UPDATE print_jobs SET status = 'pending', last_error = NULL, updated_at = ?2
             WHERE id = ?1 AND status = 'failed'",
            params![id, now_iso],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err("Hanya tugas cetak yang gagal dapat dicoba ulang.".to_string());
    }
    get_print_job(conn, id)?.ok_or_else(|| "Tugas cetak tidak ditemukan sesudah dicoba ulang.".to_string())
}

fn get_server_receipt_print_job(
    conn: &Connection,
    id: &str,
) -> DbResult<Option<ServerReceiptPrintJob>> {
    conn.query_row(
        &format!("SELECT {SERVER_RECEIPT_PRINT_JOB_COLUMNS} FROM server_receipt_print_jobs WHERE id = ?1"),
        params![id],
        map_server_receipt_print_job,
    )
    .optional()
    .map_err(db_err)
}

pub fn enqueue_server_receipt_print_job(
    conn: &Connection,
    sale_id: &str,
    receipt_bytes: &[u8],
    now_iso: &str,
) -> DbResult<ServerReceiptPrintJob> {
    if sale_id.is_empty() || sale_id.len() > 64 {
        return Err("ID transaksi server tidak valid.".to_string());
    }
    if receipt_bytes.is_empty() || receipt_bytes.len() > 1024 * 1024 {
        return Err("Data nota kosong atau melebihi batas ukuran.".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO server_receipt_print_jobs
           (id, sale_id, receipt_bytes, status, attempts, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4)",
        params![id, sale_id, receipt_bytes, now_iso],
    )
    .map_err(db_err)?;
    get_server_receipt_print_job(conn, &id)?
        .ok_or_else(|| "Nota server tidak ditemukan sesudah masuk antrean.".to_string())
}

pub fn list_server_receipt_print_jobs(
    conn: &Connection,
    status: Option<&str>,
) -> DbResult<Vec<ServerReceiptPrintJob>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SERVER_RECEIPT_PRINT_JOB_COLUMNS} FROM server_receipt_print_jobs
             WHERE (?1 IS NULL OR status = ?1)
             ORDER BY created_at DESC LIMIT 200"
        ))
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![status], map_server_receipt_print_job)
        .map_err(db_err)?;
    rows.map(|row| row.map_err(db_err)).collect()
}

pub fn reset_server_receipt_printing(conn: &Connection, now_iso: &str) -> DbResult<usize> {
    conn.execute(
        "UPDATE server_receipt_print_jobs SET status = 'pending', updated_at = ?1
         WHERE status = 'printing'",
        params![now_iso],
    )
    .map_err(db_err)
}

pub fn claim_server_receipt_print_jobs(
    conn: &mut Connection,
    limit: usize,
    now_iso: &str,
) -> DbResult<Vec<ServerReceiptPrintPayload>> {
    let tx = conn.transaction().map_err(db_err)?;
    let mut ids = Vec::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT id FROM server_receipt_print_jobs WHERE status = 'pending'
                 ORDER BY created_at, id LIMIT ?1",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![limit as i64], |row| row.get::<_, String>(0))
            .map_err(db_err)?;
        for row in rows {
            ids.push(row.map_err(db_err)?);
        }
    }
    for id in &ids {
        tx.execute(
            "UPDATE server_receipt_print_jobs
             SET status = 'printing', attempts = attempts + 1, updated_at = ?2
             WHERE id = ?1 AND status = 'pending'",
            params![id, now_iso],
        )
        .map_err(db_err)?;
    }
    tx.commit().map_err(db_err)?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let item = conn
            .query_row(
                "SELECT id, sale_id, receipt_bytes FROM server_receipt_print_jobs
                 WHERE id = ?1 AND status = 'printing'",
                params![id],
                |row| {
                    Ok(ServerReceiptPrintPayload {
                        id: row.get(0)?,
                        sale_id: row.get(1)?,
                        receipt_bytes: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(db_err)?;
        if let Some(item) = item {
            out.push(item);
        }
    }
    Ok(out)
}

pub fn mark_server_receipt_printed(conn: &Connection, id: &str, now_iso: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE server_receipt_print_jobs
         SET status = 'printed', last_error = NULL, updated_at = ?2, printed_at = ?2
         WHERE id = ?1 AND status = 'printing'",
        params![id, now_iso],
    )
    .map(|_| ())
    .map_err(db_err)
}

pub fn mark_server_receipt_failed(
    conn: &Connection,
    id: &str,
    message: &str,
    now_iso: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE server_receipt_print_jobs
         SET status = 'failed', last_error = ?2, updated_at = ?3, printed_at = NULL
         WHERE id = ?1 AND status = 'printing'",
        params![id, message.chars().take(300).collect::<String>(), now_iso],
    )
    .map(|_| ())
    .map_err(db_err)
}

pub fn retry_server_receipt_print_job(
    conn: &Connection,
    id: &str,
    now_iso: &str,
) -> DbResult<ServerReceiptPrintJob> {
    let changed = conn
        .execute(
            "UPDATE server_receipt_print_jobs
             SET status = 'pending', last_error = NULL, updated_at = ?2
             WHERE id = ?1 AND status = 'failed'",
            params![id, now_iso],
        )
        .map_err(db_err)?;
    if changed != 1 {
        return Err("Hanya nota server yang gagal dapat dicoba ulang.".to_string());
    }
    get_server_receipt_print_job(conn, id)?
        .ok_or_else(|| "Tugas cetak nota server tidak ditemukan sesudah dicoba ulang.".to_string())
}

// ---------------------------------------------------------------------------
// Penjualan lokal tersimpan & peristiwa lokal (Langkah 5)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct LocalSaleRecord {
    pub client_key: String,
    pub sale: SaleInput,
    pub receipt_context: Option<ReceiptContext>,
}

/// Baca penjualan lokal tersimpan (muatan di-parse dari JSON yang
/// sama dengan yang dikirim ke server) — sumber cetak & cetak ulang.
pub fn get_local_sale(conn: &Connection, client_key: &str) -> DbResult<Option<LocalSaleRecord>> {
    let stored: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT payload_json, receipt_context_json FROM local_sales WHERE client_key = ?1",
            params![client_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(db_err(other)),
        })?;
    match stored {
        None => Ok(None),
        Some((text, receipt_context_text)) => {
            let sale: SaleInput =
                serde_json::from_str(&text).map_err(|error| error.to_string())?;
            let receipt_context = receipt_context_text
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|error| error.to_string())?;
            Ok(Some(LocalSaleRecord {
                client_key: client_key.to_string(),
                sale,
                receipt_context,
            }))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvent {
    pub id: String,
    pub kind: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

/// Catat peristiwa lokal teraudit (mis. buka laci tanpa penjualan —
/// alasan & hasil kirimnya di dalam payload).
pub fn record_local_event(
    conn: &Connection,
    kind: &str,
    payload: &serde_json::Value,
    now_iso: &str,
) -> DbResult<LocalEvent> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO local_events (id, kind, payload_json, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, kind, payload.to_string(), now_iso],
    )
    .map_err(db_err)?;
    Ok(LocalEvent {
        id,
        kind: kind.to_string(),
        payload: payload.clone(),
        created_at: now_iso.to_string(),
    })
}

pub fn list_local_events(conn: &Connection, kind: &str) -> DbResult<Vec<LocalEvent>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, payload_json, created_at FROM local_events
             WHERE kind = ?1 ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![kind], |row| {
            let payload_text: String = row.get(2)?;
            Ok(LocalEvent {
                id: row.get(0)?,
                kind: row.get(1)?,
                payload: serde_json::from_str(&payload_text)
                    .unwrap_or(serde_json::Value::String(payload_text)),
                created_at: row.get(3)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Sesi kas lokal (Langkah 4) — fakta lokal terminal; posting jurnal
// sesi tetap milik sesi POS web di server. Tutup sesi bersifat
// BUTA: kasir menyerahkan hitungan denominasi TANPA melihat angka
// harapan; harapan & selisih dihitung di sini, sesudah hitungan
// masuk, lalu dicatat sebagai fakta lokal + intent antrean.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashSessionOpenInput {
    pub warehouse_id: String,
    /// Modal awal laci, string desimal (konvensi uang repo).
    pub opening_cash: String,
    #[serde(default)]
    pub opened_by: Option<String>,
    pub opened_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenominationInput {
    /// Nilai nominal per lembar/keping, string desimal ("50000").
    pub denomination: String,
    pub count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashSessionMovementInput {
    /// Kunci UUID dari pemanggil agar pengulangan IPC aman.
    pub client_key: String,
    pub session_id: String,
    pub movement_type: String,
    pub amount: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashSession {
    pub id: String,
    pub warehouse_id: String,
    pub opened_at: String,
    pub opened_by: Option<String>,
    pub opening_cash: String,
    pub closed_at: Option<String>,
    pub status: String,
    pub counted: Option<Vec<DenominationInput>>,
    pub counted_total: Option<String>,
    pub expected_total: Option<String>,
    pub difference_total: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashSessionSyncStatus {
    pub pending_sales: i64,
    pub pending_intents: i64,
}

/// Jumlah transaksi lokal per sesi — dipakai riwayat kasir agar kasir
/// melihat "N transaksi" pada setiap shift, bukan hanya angka uang.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSaleCount {
    pub session_id: String,
    pub count: i64,
}

/// Total penjualan per metode bayar per sesi — cermin "expected amount
/// for each configured payment method" pada Close Register Odoo.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionPaymentTotal {
    pub session_id: String,
    pub method_id: String,
    pub total: f64,
}

/// Total & jumlah transaksi per metode bayar dalam rentang tanggal
/// (`sale_date`, format `YYYY-MM-DD`) — dasar Laporan Harian.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodTotal {
    pub method_id: String,
    pub count: i64,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashSessionPreview {
    pub counted_total: String,
    pub expected_total: String,
    pub difference_total: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIntent {
    pub id: String,
    pub kind: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub created_at: String,
}

/// Format angka uang lokal: bilangan bulat tanpa desimal,
/// pecahan hingga 4 desimal tanpa nol ekor (selaras numeric(19,4)).
fn money_string(value: f64) -> String {
    if (value - value.trunc()).abs() < 0.000_05 {
        format!("{}", value.trunc() as i64)
    } else {
        let text = format!("{value:.4}");
        text.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn parse_money(text: &str, field: &str) -> DbResult<f64> {
    text.parse::<f64>()
        .map_err(|_| format!("Nilai {field} tidak valid: {text}"))
}

fn map_cash_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<CashSession> {
    let counted_json: Option<String> = row.get(7)?;
    Ok(CashSession {
        id: row.get(0)?,
        warehouse_id: row.get(1)?,
        opened_at: row.get(2)?,
        opened_by: row.get(3)?,
        opening_cash: row.get(4)?,
        closed_at: row.get(5)?,
        status: row.get(6)?,
        counted: counted_json.and_then(|text| serde_json::from_str(&text).ok()),
        counted_total: row.get(8)?,
        expected_total: row.get(9)?,
        difference_total: row.get(10)?,
    })
}

const CASH_SESSION_COLUMNS: &str = "id, warehouse_id, opened_at, opened_by, opening_cash,
    closed_at, status, counted_json, counted_total, expected_total, difference_total";

/// Buka sesi kas lokal. Maksimal SATU sesi terbuka per gudang —
/// mencerminkan disiplin sesi server dan mencegah modal awal
/// tercatat ganda untuk laci yang sama.
pub fn open_cash_session(
    conn: &Connection,
    input: &CashSessionOpenInput,
) -> DbResult<CashSession> {
    let opening_cash = parse_money(&input.opening_cash, "modal awal")?;
    if !opening_cash.is_finite() || opening_cash < 0.0 || opening_cash > 999_999_999_999_999.0 {
        return Err("Modal awal harus bernilai antara Rp 0 dan Rp 999.999.999.999.999.".to_string());
    }
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    let existing: i64 = tx
        .query_row(
            "SELECT count(*) FROM cash_sessions WHERE warehouse_id = ?1 AND status = 'open'",
            params![input.warehouse_id],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if existing > 0 {
        return Err(
            "Masih ada sesi kas terbuka untuk gudang ini; tutup dulu sebelum membuka sesi baru."
                .to_string(),
        );
    }
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO cash_sessions (id, warehouse_id, opened_at, opened_by, opening_cash, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open')",
        params![id, input.warehouse_id, input.opened_at, input.opened_by, input.opening_cash],
    )
    .map_err(db_err)?;
    let identity = terminal_identity(&tx)?;
    let open_intent_id = uuid::Uuid::new_v4().to_string();
    let open_fact = serde_json::json!({
        "sessionId": id,
        "warehouseId": input.warehouse_id,
        "openedAt": input.opened_at,
        "openedBy": input.opened_by,
        "openingCash": input.opening_cash,
        "terminalId": identity.as_ref().map(|view| view.terminal_id.clone()),
        "terminalName": identity.as_ref().map(|view| view.name.clone()),
    });
    tx.execute(
        "INSERT INTO local_intents (id, kind, payload_json, status, created_at)
         VALUES (?1, 'cash_session_open', ?2, 'pending', ?3)",
        params![open_intent_id, open_fact.to_string(), input.opened_at],
    )
    .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    get_cash_session(conn, &id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan sesudah dibuka.".to_string())
}

fn local_cash_sales(conn: &Connection, session: &CashSession, through: &str) -> DbResult<f64> {
    conn.query_row(
        "SELECT coalesce(sum(cast(json_extract(pay.value, '$.amount') as real)), 0)
         FROM local_sales s
         JOIN json_each(s.payload_json, '$.payments') pay
         JOIN snapshot_payment_methods m
           ON m.method_id = json_extract(pay.value, '$.methodId')
         WHERE m.type = 'cash'
           AND s.created_at <= ?4
           AND (
             json_extract(s.payload_json, '$.originSessionId') = ?1
             OR (
               json_extract(s.payload_json, '$.originSessionId') IS NULL
               AND s.warehouse_id = ?2
               AND s.created_at >= ?3
             )
           )",
        params![session.id, session.warehouse_id, session.opened_at, through],
        |row| row.get(0),
    )
    .map_err(db_err)
}

/// Nilai bersih mutasi laci lokal. Setoran bernilai negatif karena uang
/// keluar dari laci; penarikan bernilai positif karena uang masuk ke laci.
fn local_cash_movement_net(conn: &Connection, session_id: &str) -> DbResult<f64> {
    conn.query_row(
        "SELECT coalesce(sum(
           CASE json_extract(payload_json, '$.movementType')
             WHEN 'deposit' THEN -cast(json_extract(payload_json, '$.amount') as real)
             WHEN 'withdrawal' THEN cast(json_extract(payload_json, '$.amount') as real)
             ELSE 0
           END
         ), 0)
         FROM local_intents
         WHERE kind = 'cash_session_movement'
           AND json_extract(payload_json, '$.sessionId') = ?1",
        params![session_id],
        |row| row.get(0),
    )
    .map_err(db_err)
}

fn local_cash_session_expected(
    conn: &Connection,
    session: &CashSession,
    through: &str,
) -> DbResult<f64> {
    Ok(parse_money(&session.opening_cash, "modal awal")?
        + local_cash_sales(conn, session, through)?
        + local_cash_movement_net(conn, &session.id)?)
}

/// Hitung hanya item antrean yang memengaruhi sesi ini. Antrean sesi lain
/// tidak mengubah saldo laci yang sedang dihitung.
pub fn cash_session_sync_status(
    conn: &Connection,
    session_id: &str,
) -> DbResult<CashSessionSyncStatus> {
    let session = get_cash_session(conn, session_id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan.".to_string())?;
    let through = now_iso();
    let pending_sales = conn
        .query_row(
            "SELECT count(*)
             FROM outbox AS o INDEXED BY idx_outbox_live_created_at
             JOIN local_sales AS s ON s.client_key = o.client_key
             WHERE o.status IN ('pending', 'inflight', 'held')
               AND s.created_at <= ?4
               AND (
                 json_extract(s.payload_json, '$.originSessionId') = ?1
                 OR (
                   json_extract(s.payload_json, '$.originSessionId') IS NULL
                   AND s.warehouse_id = ?2
                   AND s.created_at >= ?3
                 )
               )",
            params![session.id, session.warehouse_id, session.opened_at, through],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    let pending_intents = conn
        .query_row(
            "SELECT count(*) FROM local_intents
             WHERE kind IN ('cash_session_open', 'cash_session_movement', 'cash_session_close')
               AND status IN ('pending', 'held')
               AND json_extract(payload_json, '$.sessionId') = ?1",
            params![session.id],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    Ok(CashSessionSyncStatus {
        pending_sales,
        pending_intents,
    })
}

/// Catat setor/tarik kas secara atomik sebagai fakta terminal dan intent
/// sinkronisasi. Catatan lokal tetap tersedia bila koneksi terputus.
pub fn record_cash_session_movement(
    conn: &mut Connection,
    input: &CashSessionMovementInput,
) -> DbResult<LocalIntent> {
    let client_key = uuid::Uuid::parse_str(&input.client_key)
        .map_err(|_| "Kunci mutasi kas tidak valid.".to_string())?
        .to_string();
    let movement_type = input.movement_type.trim();
    if movement_type != "deposit" && movement_type != "withdrawal" {
        return Err("Jenis mutasi kas tidak valid.".to_string());
    }
    let amount = parse_money(&input.amount, "mutasi kas")?;
    if !amount.is_finite() || amount <= 0.0 || amount > 999_999_999_999_999.0 || amount.fract() != 0.0 {
        return Err("Nominal mutasi harus berupa rupiah bulat lebih dari Rp 0 dan maksimal Rp 999.999.999.999.999.".to_string());
    }
    let notes = input.notes.trim();
    if notes.chars().count() < 3 || notes.chars().count() > 200 {
        return Err("Alasan mutasi kas harus berisi 3–200 karakter.".to_string());
    }

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(db_err)?;
    // Retry IPC dengan kunci sama mengembalikan fakta awal, tanpa
    // menambahkan setoran/penarikan kedua kali.
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT kind, payload_json FROM local_intents WHERE id = ?1",
            params![client_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_err)?;
    if let Some((kind, payload_text)) = existing {
        if kind != "cash_session_movement" {
            return Err("Kunci ini sudah digunakan oleh catatan POS lain.".to_string());
        }
        let payload: serde_json::Value = serde_json::from_str(&payload_text)
            .map_err(|error| format!("Muatan mutasi kas rusak: {error}"))?;
        if payload.get("sessionId").and_then(|v| v.as_str()) != Some(input.session_id.as_str())
            || payload.get("movementType").and_then(|v| v.as_str()) != Some(movement_type)
            || payload.get("amount").and_then(|v| v.as_str()) != Some(input.amount.trim())
            || payload.get("notes").and_then(|v| v.as_str()) != Some(notes)
        {
            return Err("Kunci mutasi kas sudah digunakan untuk data yang berbeda.".to_string());
        }
        drop(tx);
        return list_local_intents(conn)?
            .into_iter()
            .find(|intent| intent.id == client_key)
            .ok_or_else(|| "Mutasi kas lokal tidak ditemukan sesudah dibaca.".to_string());
    }

    let session = get_cash_session(&tx, &input.session_id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan.".to_string())?;
    if session.status != "open" {
        return Err("Mutasi hanya dapat dicatat pada sesi kas yang masih berjalan.".to_string());
    }
    let created_at = now_iso();
    let expected_before = local_cash_session_expected(&tx, &session, &created_at)?;
    if movement_type == "deposit" && amount > expected_before {
        return Err(format!(
            "Setoran {} melebihi saldo kas lokal {}. Setor hanya uang yang benar-benar ada di laci.",
            money_string(amount),
            money_string(expected_before.max(0.0)),
        ));
    }
    let identity = terminal_identity(&tx)?;
    let fact = serde_json::json!({
        "sessionId": session.id,
        "warehouseId": session.warehouse_id,
        "openedBy": session.opened_by,
        "movementType": movement_type,
        "amount": input.amount.trim(),
        "notes": notes,
        "createdAt": created_at,
        "terminalId": identity.as_ref().map(|view| view.terminal_id.clone()),
        "terminalName": identity.as_ref().map(|view| view.name.clone()),
    });
    tx.execute(
        "INSERT INTO local_intents (id, kind, payload_json, status, created_at)
         VALUES (?1, 'cash_session_movement', ?2, 'pending', ?3)",
        params![client_key, fact.to_string(), created_at],
    )
    .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    list_local_intents(conn)?
        .into_iter()
        .find(|intent| intent.id == client_key)
        .ok_or_else(|| "Mutasi kas lokal tidak ditemukan sesudah dicatat.".to_string())
}

pub fn get_cash_session(conn: &Connection, id: &str) -> DbResult<Option<CashSession>> {
    conn.query_row(
        &format!("SELECT {CASH_SESSION_COLUMNS} FROM cash_sessions WHERE id = ?1"),
        params![id],
        map_cash_session,
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(db_err(other)),
    })
}

pub fn current_cash_session(
    conn: &Connection,
    warehouse_id: &str,
) -> DbResult<Option<CashSession>> {
    conn.query_row(
        &format!(
            "SELECT {CASH_SESSION_COLUMNS} FROM cash_sessions
             WHERE warehouse_id = ?1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1"
        ),
        params![warehouse_id],
        map_cash_session,
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(db_err(other)),
    })
}

pub fn list_cash_sessions(conn: &Connection) -> DbResult<Vec<CashSession>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CASH_SESSION_COLUMNS} FROM cash_sessions ORDER BY opened_at DESC"
        ))
        .map_err(db_err)?;
    let rows = stmt.query_map([], map_cash_session).map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

pub fn count_cash_sessions(conn: &Connection) -> DbResult<i64> {
    conn.query_row("SELECT count(*) FROM cash_sessions", [], |row| row.get(0))
        .map_err(db_err)
}

/// Agregasi jumlah penjualan lokal per `origin_session_id` dalam satu
/// query — menghindari N+1 invoke saat merender riwayat shift.
pub fn list_session_sales_counts(conn: &Connection) -> DbResult<Vec<SessionSaleCount>> {
    let mut stmt = conn
        .prepare(
            "SELECT json_extract(payload_json, '$.originSessionId') AS session_id, count(*)
             FROM local_sales
             WHERE json_extract(payload_json, '$.originSessionId') IS NOT NULL
             GROUP BY session_id ORDER BY session_id",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SessionSaleCount {
                session_id: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Agregasi total per metode pembayaran untuk setiap sesi. Satu query
/// memakai `json_each` atas `$.payments` di muatan penjualan lokal.
pub fn list_session_payment_totals(conn: &Connection) -> DbResult<Vec<SessionPaymentTotal>> {
    let mut stmt = conn
        .prepare(
            "SELECT json_extract(s.payload_json, '$.originSessionId') AS session_id,
                    json_extract(p.value, '$.methodId') AS method_id,
                    sum(json_extract(p.value, '$.amount')) AS total
             FROM local_sales AS s, json_each(s.payload_json, '$.payments') AS p
             WHERE json_extract(s.payload_json, '$.originSessionId') IS NOT NULL
               AND json_extract(p.value, '$.methodId') IS NOT NULL
             GROUP BY session_id, method_id
             ORDER BY session_id, method_id",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SessionPaymentTotal {
                session_id: row.get(0)?,
                method_id: row.get(1)?,
                total: row.get(2)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Agregasi Laporan Harian per metode pembayaran dalam rentang tanggal.
pub fn list_payment_totals_in_range(
    conn: &Connection,
    from: &str,
    to: &str,
) -> DbResult<Vec<PaymentMethodTotal>> {
    let mut stmt = conn
        .prepare(
            "SELECT json_extract(p.value, '$.methodId') AS method_id,
                    count(*) AS tx_count,
                    sum(json_extract(p.value, '$.amount')) AS total
             FROM local_sales AS s, json_each(s.payload_json, '$.payments') AS p
             WHERE s.sale_date >= ?1 AND s.sale_date <= ?2
               AND json_extract(p.value, '$.methodId') IS NOT NULL
             GROUP BY method_id ORDER BY method_id",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![from, to], |row| {
            Ok(PaymentMethodTotal {
                method_id: row.get(0)?,
                count: row.get(1)?,
                total: row.get(2)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Periksa gerbang updater tanpa memuat seluruh histori sesi kas.
pub fn has_open_cash_session(conn: &Connection) -> DbResult<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM cash_sessions WHERE status = 'open')",
        [],
        |row| row.get(0),
    )
    .map_err(db_err)
}

/// Hitung pratinjau tutup sesi tanpa mengubah sesi atau membuat intent.
pub fn preview_cash_session(
    conn: &Connection,
    session_id: &str,
    counted: &[DenominationInput],
) -> DbResult<CashSessionPreview> {
    let session = get_cash_session(conn, session_id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan.".to_string())?;
    if session.status != "open" {
        return Err("Sesi kas ini sudah tertutup.".to_string());
    }
    let mut counted_total = 0.0_f64;
    for entry in counted {
        if entry.count < 0 {
            return Err("Jumlah lembar denominasi tidak boleh negatif.".to_string());
        }
        counted_total += parse_money(&entry.denomination, "denominasi")? * entry.count as f64;
    }
    let expected_total = local_cash_session_expected(conn, &session, &now_iso())?;
    Ok(CashSessionPreview {
        counted_total: money_string(counted_total),
        expected_total: money_string(expected_total),
        difference_total: money_string(counted_total - expected_total),
    })
}

/// Tutup sesi secara BUTA dalam satu transaksi: hitungan fisik
/// kasir (denominasi) diterima apa adanya; harapan lokal dihitung
/// dari modal awal + pembayaran TUNAI penjualan lokal + mutasi laci —
/// penjualan bertanda `originSessionId` sesi ini, ditambah
/// penjualan tanpa tanda yang tercatat dalam jendela sesi di
/// gudang yang sama. Selisih = fisik − harapan. Hasilnya dicatat
/// sebagai fakta sesi DAN intent `cash_session_close` di antrean
/// lokal untuk disinkronkan kemudian (server belum menerima intent
/// sesi; tidak ada jurnal yang dibuat di sini).
pub fn close_cash_session(
    conn: &mut Connection,
    session_id: &str,
    counted: &[DenominationInput],
    closed_at: &str,
) -> DbResult<CashSession> {
    close_cash_session_with_reason(conn, session_id, counted, closed_at, None)
}

pub fn close_cash_session_with_reason(
    conn: &mut Connection,
    session_id: &str,
    counted: &[DenominationInput],
    closed_at: &str,
    difference_reason: Option<&str>,
) -> DbResult<CashSession> {
    let mut counted_total = 0.0_f64;
    for entry in counted {
        if entry.count < 0 {
            return Err("Jumlah lembar denominasi tidak boleh negatif.".to_string());
        }
        counted_total += parse_money(&entry.denomination, "denominasi")? * entry.count as f64;
    }
    let difference_reason = difference_reason.map(str::trim).filter(|value| !value.is_empty());
    if difference_reason.is_some_and(|value| value.chars().count() > 200) {
        return Err("Alasan selisih kas maksimal 200 karakter.".to_string());
    }

    let tx = conn.transaction().map_err(db_err)?;
    let session = get_cash_session(&tx, session_id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan.".to_string())?;
    if session.status != "open" {
        return Err("Sesi kas ini sudah tertutup.".to_string());
    }
    let expected = local_cash_session_expected(&tx, &session, closed_at)?;
    let difference = counted_total - expected;
    if difference.abs() >= 0.000_05
        && difference_reason.map_or(true, |reason| reason.chars().count() < 3)
    {
        return Err("Alasan minimal 3 karakter wajib diisi jika hitungan kas memiliki selisih.".to_string());
    }
    let counted_json = serde_json::to_string(counted).map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE cash_sessions
         SET status = 'closed', closed_at = ?2, counted_json = ?3,
             counted_total = ?4, expected_total = ?5, difference_total = ?6
         WHERE id = ?1",
        params![
            session.id,
            closed_at,
            counted_json,
            money_string(counted_total),
            money_string(expected),
            money_string(difference),
        ],
    )
    .map_err(db_err)?;
    // Langkah 6: sesi lokal mencap identitas terminal yang
    // menutupnya — cap ini ikut dalam intent ke server.
    let identity = terminal_identity(&tx)?;
    let fact = serde_json::json!({
        "sessionId": session.id,
        "warehouseId": session.warehouse_id,
        "openedAt": session.opened_at,
        "openedBy": session.opened_by,
        "closedAt": closed_at,
        "openingCash": session.opening_cash,
        "denominations": counted,
        "countedTotal": money_string(counted_total),
        "expectedTotal": money_string(expected),
        "differenceTotal": money_string(difference),
        "differenceReason": difference_reason,
        "terminalId": identity.as_ref().map(|view| view.terminal_id.clone()),
        "terminalName": identity.as_ref().map(|view| view.name.clone()),
    });
    tx.execute(
        "INSERT INTO local_intents (id, kind, payload_json, status, created_at)
         VALUES (?1, 'cash_session_close', ?2, 'pending', ?3)",
        params![
            uuid::Uuid::new_v4().to_string(),
            fact.to_string(),
            closed_at,
        ],
    )
    .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    get_cash_session(conn, session_id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan sesudah ditutup.".to_string())
}

/// Intent lokal yang masih menunggu transmisi (Langkah 6):
/// mesin sinkron mengambilnya bersama batch penjualan pertama.
pub fn pending_intents(conn: &Connection, limit: usize) -> DbResult<Vec<LocalIntent>> {
    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.kind, i.payload_json, i.status, i.created_at FROM local_intents i
             WHERE i.status = 'pending'
               AND (
                 i.kind <> 'cash_session_close'
                 OR NOT EXISTS (
                   SELECT 1
                   FROM local_sales s
                   JOIN outbox o ON o.client_key = s.client_key
                   JOIN cash_sessions cs
                     ON cs.id = json_extract(i.payload_json, '$.sessionId')
                   WHERE (
                     json_extract(s.payload_json, '$.originSessionId') = cs.id
                     OR (
                       json_extract(s.payload_json, '$.originSessionId') IS NULL
                       AND s.warehouse_id = cs.warehouse_id
                       AND s.created_at >= cs.opened_at
                       AND (
                         json_extract(i.payload_json, '$.closedAt') IS NULL
                         OR s.created_at <= json_extract(i.payload_json, '$.closedAt')
                       )
                     )
                   )
                     AND o.status <> 'synced'
                 )
               )
               AND (
                 i.kind <> 'cash_session_open'
                 OR NOT EXISTS (
                   SELECT 1 FROM local_intents prior
                   WHERE prior.kind = 'cash_session_close'
                     AND prior.status = 'pending'
                     AND prior.rowid < i.rowid
                 )
               )
               AND (
                 i.kind <> 'cash_session_close'
                 OR NOT EXISTS (
                   SELECT 1 FROM local_intents movement
                   WHERE movement.kind = 'cash_session_movement'
                     AND json_extract(movement.payload_json, '$.sessionId') =
                         json_extract(i.payload_json, '$.sessionId')
                     AND movement.status <> 'synced'
                     AND movement.rowid < i.rowid
                 )
               )
             ORDER BY i.rowid LIMIT ?1",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![limit as i64], |row| {
            let payload_text: String = row.get(2)?;
            Ok(LocalIntent {
                id: row.get(0)?,
                kind: row.get(1)?,
                payload: serde_json::from_str(&payload_text)
                    .unwrap_or(serde_json::Value::String(payload_text)),
                status: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

/// Tandai intent tersinkron (server menjawab recorded/duplicate) —
/// idempoten: intent yang sudah synced tidak berubah.
pub fn mark_intents_synced(conn: &Connection, ids: &[String]) -> DbResult<()> {
    let mut stmt = conn
        .prepare("UPDATE local_intents SET status = 'synced' WHERE id = ?1 AND status = 'pending'")
        .map_err(db_err)?;
    for id in ids {
        stmt.execute(params![id]).map_err(db_err)?;
    }
    Ok(())
}

/// Simpan penolakan bisnis sesi sebagai peninjauan lokal. Fakta kas
/// tetap utuh; hanya intent yang berhenti dicoba otomatis sampai kasir
/// meninjau penyebabnya dan meminta sinkronisasi ulang.
pub fn mark_intents_held(conn: &Connection, results: &[IntentResultInput]) -> DbResult<()> {
    for result in results.iter().filter(|result| result.status == "needsReview") {
        let payload_text: Option<String> = conn
            .query_row(
                "SELECT payload_json FROM local_intents WHERE id = ?1 AND status = 'pending'",
                params![result.client_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_err)?;
        let Some(payload_text) = payload_text else { continue };
        let mut payload: serde_json::Value = serde_json::from_str(&payload_text)
            .map_err(|error| format!("Intent sesi lokal rusak: {error}"))?;
        let Some(object) = payload.as_object_mut() else {
            return Err("Muatan intent sesi lokal bukan objek.".to_string());
        };
        object.insert(
            "syncMessage".to_string(),
            serde_json::Value::String(
                result
                    .message
                    .clone()
                    .unwrap_or_else(|| "Server meminta peninjauan sesi kas.".to_string()),
            ),
        );
        conn.execute(
            "UPDATE local_intents SET status = 'held', payload_json = ?2 WHERE id = ?1 AND status = 'pending'",
            params![result.client_key, payload.to_string()],
        )
        .map_err(db_err)?;
    }
    Ok(())
}

/// Kembalikan intent penutupan yang sudah ditinjau ke antrean. Kunci
/// client yang sama dipertahankan agar retry server tetap idempoten.
pub fn retry_cash_session_close(
    conn: &Connection,
    intent_id: &str,
    difference_reason: Option<&str>,
) -> DbResult<LocalIntent> {
    if let Some(reason) = difference_reason.map(str::trim).filter(|reason| !reason.is_empty()) {
        if reason.chars().count() < 3 || reason.chars().count() > 200 {
            return Err("Alasan selisih harus berisi 3–200 karakter.".to_string());
        }
    }
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT kind, status, payload_json FROM local_intents WHERE id = ?1",
            params![intent_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db_err)?;
    let Some((kind, status, payload_text)) = row else {
        return Err("Catatan penutupan shift tidak ditemukan.".to_string());
    };
    if kind != "cash_session_close" || status != "held" {
        return Err("Hanya penutupan shift yang perlu ditinjau dapat dikirim ulang.".to_string());
    }
    let mut payload: serde_json::Value = serde_json::from_str(&payload_text)
        .map_err(|error| format!("Intent sesi lokal rusak: {error}"))?;
    let Some(object) = payload.as_object_mut() else {
        return Err("Muatan intent sesi lokal bukan objek.".to_string());
    };
    object.remove("syncMessage");
    if let Some(reason) = difference_reason.map(str::trim).filter(|reason| !reason.is_empty()) {
        object.insert(
            "differenceReason".to_string(),
            serde_json::Value::String(reason.to_string()),
        );
    }
    let changed = conn
        .execute(
            "UPDATE local_intents SET status = 'pending', payload_json = ?2 WHERE id = ?1 AND status = 'held'",
            params![intent_id, payload.to_string()],
        )
        .map_err(db_err)?;
    if changed != 1 {
        return Err("Penutupan shift berubah saat sedang ditinjau. Muat ulang riwayat.".to_string());
    }
    list_local_intents(conn)?
        .into_iter()
        .find(|intent| intent.id == intent_id)
        .ok_or_else(|| "Catatan penutupan shift tidak ditemukan sesudah diperbarui.".to_string())
}

fn retry_held_cash_session_intent(
    conn: &Connection,
    intent_id: &str,
    expected_kind: &str,
    label: &str,
) -> DbResult<LocalIntent> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT kind, status FROM local_intents WHERE id = ?1",
            params![intent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_err)?;
    let Some((kind, status)) = row else {
        return Err(format!("Catatan {label} tidak ditemukan."));
    };
    if kind != expected_kind || status != "held" {
        return Err(format!("Hanya {label} yang perlu ditinjau dapat dikirim ulang."));
    }
    let payload_text: String = conn
        .query_row(
            "SELECT payload_json FROM local_intents WHERE id = ?1 AND status = 'held' AND kind = ?2",
            params![intent_id, expected_kind],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| format!("{label} berubah saat sedang ditinjau. Muat ulang riwayat."))?;
    let mut payload: serde_json::Value = serde_json::from_str(&payload_text)
        .map_err(|error| format!("Muatan {label} rusak: {error}"))?;
    let Some(object) = payload.as_object_mut() else {
        return Err(format!("Muatan {label} bukan objek."));
    };
    object.remove("syncMessage");
    let changed = conn
        .execute(
            "UPDATE local_intents SET status = 'pending', payload_json = ?2 WHERE id = ?1 AND status = 'held' AND kind = ?3",
            params![intent_id, payload.to_string(), expected_kind],
        )
        .map_err(db_err)?;
    if changed != 1 {
        return Err(format!("{label} berubah saat sedang ditinjau. Muat ulang riwayat."));
    }
    list_local_intents(conn)?
        .into_iter()
        .find(|intent| intent.id == intent_id)
        .ok_or_else(|| format!("{label} tidak ditemukan sesudah dikirim ulang."))
}

/// Kirim ulang pembukaan sesi yang server tandai perlu ditinjau.
pub fn retry_cash_session_open(conn: &Connection, intent_id: &str) -> DbResult<LocalIntent> {
    retry_held_cash_session_intent(conn, intent_id, "cash_session_open", "pembukaan sesi kas")
}

/// Kirim ulang mutasi yang server tandai perlu ditinjau. Fakta dan
/// clientKey dipertahankan agar pengulangan sinkron tetap idempoten.
pub fn retry_cash_session_movement(conn: &Connection, intent_id: &str) -> DbResult<LocalIntent> {
    retry_held_cash_session_intent(conn, intent_id, "cash_session_movement", "mutasi kas")
}

pub fn list_local_intents(conn: &Connection) -> DbResult<Vec<LocalIntent>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, payload_json, status, created_at FROM local_intents
             ORDER BY created_at",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            let payload_text: String = row.get(2)?;
            Ok(LocalIntent {
                id: row.get(0)?,
                kind: row.get(1)?,
                payload: serde_json::from_str(&payload_text)
                    .unwrap_or(serde_json::Value::String(payload_text)),
                status: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(db_err)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open memory db");
        init(&conn).expect("init schema");
        conn
    }

    #[test]
    fn init_backfills_cached_product_count_without_changing_catalog() {
        let conn = Connection::open_in_memory().expect("open legacy database");
        conn.execute_batch(SCHEMA).expect("legacy schema");
        conn.execute(
            "INSERT INTO snapshot_products
               (product_id, warehouse_id, sku, name, sale_price, stock)
             VALUES ('legacy-1', 'wh-1', 'SKU-LEGACY', 'Produk lama', '1000', 4)",
            [],
        )
        .expect("legacy product");

        init(&conn).expect("initialize legacy database");

        let count: String = conn
            .query_row(
                "SELECT value FROM snapshot_meta WHERE key = 'product_count'",
                [],
                |row| row.get(0),
            )
            .expect("cached product count");
        assert_eq!(count, "1");
        let page = list_products_page(&conn, "", 1, 50).expect("catalog page");
        assert_eq!(page.total, 1);
        assert_eq!(page.products[0].product_id, "legacy-1");
    }

    fn sample_snapshot() -> SnapshotInput {
        SnapshotInput {
        loyalty_balances: vec![],
        promotions: vec![],
        kitchen_tickets: vec![],
        reservations: vec![],
            warehouses: vec![],
            version: "v1".to_string(),
            cursor: None,
            generated_at: "2026-11-07T00:00:00.000Z".to_string(),
            warehouse: Some(SnapshotWarehouseInput {
                id: "wh-1".to_string(),
                code: "GDG".to_string(),
                name: "Gudang Utama".to_string(),
            is_default: true,
            }),
            payment_methods: vec![SnapshotMethodInput {
                id: "pm-1".to_string(),
                code: "CASH".to_string(),
                name: "Tunai".to_string(),
                method_type: "cash".to_string(),
                fee_enabled: false,
                fee_type: "none".to_string(),
                fee_value: "0".to_string(),
            }],
            products: vec![
                SnapshotProductInput {
                    id: "prod-1".to_string(),
                    sku: "SKU-1".to_string(),
                    barcode: Some("8990001".to_string()),
                    name: "Aqua 600ml".to_string(),
                    category_id: None,
                    category_name: None,
                    sale_price: "4000.0000".to_string(),
                    stock: 120.0,
                    track_stock: true,
                    track_serial: false,
                    unit_code: Some("BTL".to_string()),
                    // S5: satu kemasan Dus isi 40 — harga dus
                    // independen (bukan 40 × 4.000).
                    packagings: vec![SnapshotPackagingInput {
                        id: "pkg-dus-1".to_string(),
                        name: "Dus".to_string(),
                        isi: "40.0000".to_string(),
                        sale_price: Some("145000.0000".to_string()),
                        barcode: Some("8992000000040".to_string()),
                        is_active: true,
                        is_default_sale: true,
                    }],
                },
                SnapshotProductInput {
                    id: "prod-2".to_string(),
                    sku: "SKU-2".to_string(),
                    barcode: None,
                    name: "Beras 5kg".to_string(),
                    category_id: None,
                    category_name: None,
                    sale_price: "66000.0000".to_string(),
                    stock: 28.0,
                    track_stock: true,
                    track_serial: false,
                    unit_code: Some("PACK".to_string()),
                    packagings: vec![],
                },
            ],
            customer_groups: vec![],
            group_prices: vec![],
            replace_group_price_group_ids: vec![],
            receipt: None,
            terminal: None,
            names: None,
            can_discount: false,
            pos_offline_enabled: false,
        }
    }

    fn sample_sale(client_key: &str, product_id: &str) -> SaleInput {
        SaleInput {
            client_key: client_key.to_string(),
            warehouse_id: "wh-1".to_string(),
            held_sale_id: None,
            group_id: None,
            customer_id: None,
            due_date: None,
            date: "2026-11-07".to_string(),
            cashier_id: Some("user-1".to_string()),
            origin_session_id: None,
            device_id: Some("desktop-dev".to_string()),
            reservation_id: None,
            expected_total: Some(8000.0),
            lines: vec![SaleLineInput {
                product_id: product_id.to_string(),
                qty: 2.0,
                discount_type: None,
                discount_value: None,
                serial_numbers: None,
                unit_price: Some(4000.0),
                packaging_id: None,
                isi_snapshot: None,
            }],
            payments: vec![SalePaymentInput {
                method_id: "pm-1".to_string(),
                amount: 8000.0,
                tendered: 10000.0,
                reference: None,
                fee: None,
            }],
            queued_at: "2026-11-07T02:00:00.000Z".to_string(),
        }
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count")
    }

    #[test]
    fn record_sale_writes_sale_lines_and_outbox() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let item = record_sale(&mut conn, &sample_sale("key-0001", "prod-1")).expect("record");
        assert_eq!(item.status, "pending");
        assert_eq!(item.payload["clientKey"], "key-0001");
        assert_eq!(count(&conn, "local_sales"), 1);
        assert_eq!(count(&conn, "local_sale_lines"), 1);
        assert_eq!(count(&conn, "outbox"), 1);
        assert_eq!(count_outbox(&conn, "pending").expect("count pending"), 1);
        assert!(get_outbox_by_key(&conn, "missing").expect("missing lookup").is_none());
    }

    #[test]
    fn outbox_status_count_uses_covering_index() {
        let conn = memory_db();
        let query_plan: String = conn
            .query_row(
                "EXPLAIN QUERY PLAN SELECT count(*) FROM outbox WHERE status = 'pending'",
                [],
                |row| row.get(3),
            )
            .expect("explain outbox status count");
        assert!(
            query_plan.contains("idx_outbox_status_created_at"),
            "status count should use its covering index: {query_plan}"
        );
    }

    #[test]
    fn live_outbox_page_is_bounded_and_uses_order_index() {
        let mut conn = memory_db();
        let tx = conn.transaction().expect("transaction");
        {
            let mut sales = tx
                .prepare(
                    "INSERT INTO local_sales
                     (client_key, warehouse_id, sale_date, expected_total, payload_json, created_at)
                     VALUES (?1, 'wh-1', '2026-11-15', ?2, ?3, ?4)",
                )
                .expect("prepare sales");
            let mut outbox = tx
                .prepare(
                    "INSERT INTO outbox
                     (client_key, payload_json, status, attempts, created_at, updated_at)
                     VALUES (?1, ?2, ?3, 0, ?4, ?4)",
                )
                .expect("prepare outbox");
            let payload = format!("{{\"padding\":\"{}\"}}", "x".repeat(512));
            for index in 0..10_000 {
                let key = format!("sale-{index:05}");
                let created_at = format!("{index:08}");
                let status = match index % 4 {
                    0 => "pending",
                    1 => "inflight",
                    2 => "held",
                    _ => "synced",
                };
                sales
                    .execute(params![key, index.to_string(), payload, created_at])
                    .expect("insert sale");
                outbox
                    .execute(params![key, payload, status, created_at])
                    .expect("insert outbox");
            }
        }
        tx.commit().expect("commit fixtures");

        let first = list_outbox_page(&conn, 1, 50).expect("first page");
        assert_eq!(first.total, 7_500);
        assert_eq!(first.page, 1);
        assert_eq!(first.page_size, 50);
        assert_eq!(first.page_count, 150);
        assert_eq!(first.items.len(), 50);
        assert_eq!(first.items[0].client_key, "sale-00000");
        assert_eq!(first.items[3].client_key, "sale-00004");
        assert_eq!(first.items[0].expected_total.as_deref(), Some("0"));
        let page_bytes = serde_json::to_vec(&first).expect("serialize page").len();
        let full_bytes = serde_json::to_vec(&list_outbox(&conn, None).expect("full queue"))
            .expect("serialize full queue")
            .len();
        assert!(
            page_bytes * 20 < full_bytes,
            "paged summary should transfer far less than full payloads: page={page_bytes}, full={full_bytes}"
        );

        let last = list_outbox_page(&conn, 999, 50).expect("last page");
        assert_eq!(last.page, 150);
        assert_eq!(last.items.len(), 50);
        assert_eq!(last.items[49].client_key, "sale-09998");

        let capped = list_outbox_page(&conn, 1, u32::MAX).expect("capped page size");
        assert_eq!(capped.page_size, 100);
        assert_eq!(capped.items.len(), 100);

        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT o.client_key, s.expected_total
                 FROM outbox AS o INDEXED BY idx_outbox_live_created_at
                 LEFT JOIN local_sales AS s ON s.client_key = o.client_key
                 WHERE o.status IN ('pending', 'inflight', 'held')
                 ORDER BY o.created_at, o.client_key
                 LIMIT 50 OFFSET 0",
            )
            .expect("prepare query plan");
        let details = stmt
            .query_map([], |row| row.get::<_, String>(3))
            .expect("query plan")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("query plan rows")
            .join("; ");
        assert!(
            details.contains("idx_outbox_live_created_at"),
            "page should use the partial order index: {details}"
        );
        assert!(
            !details.contains("USE TEMP B-TREE"),
            "page should not sort the live queue into a temporary tree: {details}"
        );
    }

    #[test]
    fn cash_session_count_does_not_materialize_session_rows() {
        let conn = memory_db();
        conn.execute_batch(
            "INSERT INTO cash_sessions (id, warehouse_id, opened_at, status)
             VALUES ('session-1', 'wh-1', '2026-11-14T00:00:00Z', 'closed'),
                    ('session-2', 'wh-1', '2026-11-15T00:00:00Z', 'open')",
        )
        .expect("insert sessions");
        assert_eq!(count_cash_sessions(&conn).expect("count sessions"), 2);
    }

    #[test]
    fn record_sale_rolls_back_everything_when_a_line_fails() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        // Baris merujuk produk di luar snapshot → FK gagal DI TENGAH
        // transaksi, sesudah baris local_sales sempat ditulis.
        let result = record_sale(&mut conn, &sample_sale("key-bad", "prod-missing"));
        assert!(result.is_err(), "pencatatan harus gagal: {result:?}");
        assert_eq!(count(&conn, "local_sales"), 0, "penjualan tidak boleh setengah tercatat");
        assert_eq!(count(&conn, "local_sale_lines"), 0);
        assert_eq!(count(&conn, "outbox"), 0, "outbox tidak boleh yatim");
    }

    #[test]
    fn duplicate_client_key_retry_returns_the_original_without_doubling() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let first = record_sale(&mut conn, &sample_sale("key-dup", "prod-1")).expect("first");
        let mut retry = sample_sale("key-dup", "prod-1");
        retry.queued_at = "2026-11-07T02:05:00.000Z".to_string();
        let replay = record_sale(&mut conn, &retry).expect("idempotent retry");
        assert_eq!(replay.client_key, first.client_key);
        assert_eq!(replay.payload, first.payload);
        assert_eq!(count(&conn, "local_sales"), 1);
        assert_eq!(count(&conn, "outbox"), 1);
        assert_eq!(count(&conn, "print_jobs"), 1);

        let mut different = sample_sale("key-dup", "prod-1");
        different.lines[0].qty = 3.0;
        let conflict = record_sale(&mut conn, &different);
        assert!(conflict.is_err(), "payload berbeda harus ditolak tanpa penjualan kedua");
        assert_eq!(count(&conn, "local_sales"), 1);
        assert_eq!(count(&conn, "outbox"), 1);
        assert_eq!(count(&conn, "print_jobs"), 1);
    }

    #[test]
    fn sale_record_keeps_receipt_context_from_checkout_time() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let mut receipt_context = ReceiptContext::fallback();
        receipt_context.products.insert(
            "prod-1".to_string(),
            ("Nama pada waktu transaksi".to_string(), "4000".to_string(), Some("PCS".to_string())),
        );
        receipt_context.methods.insert(
            "pm-1".to_string(),
            ("Tunai outlet".to_string(), "cash".to_string()),
        );

        record_sale_from_held_with_receipt_context(
            &mut conn,
            &sample_sale("key-receipt-context", "prod-1"),
            None,
            &receipt_context,
        )
        .expect("sale");
        let saved = get_local_sale(&conn, "key-receipt-context")
            .expect("read sale")
            .expect("saved sale");
        let saved_context = saved.receipt_context.expect("receipt snapshot");
        assert_eq!(
            saved_context.products["prod-1"].0,
            "Nama pada waktu transaksi"
        );
        assert_eq!(saved_context.methods["pm-1"].0, "Tunai outlet");
    }

    #[test]
    fn snapshot_replaces_catalog_and_records_version() {
        let mut conn = memory_db();
        let stats = apply_snapshot(&mut conn, &sample_snapshot()).expect("v1");
        assert_eq!(stats.products, 2);
        let mut second = sample_snapshot();
        second.version = "v2".to_string();
        second.products.truncate(1);
        apply_snapshot(&mut conn, &second).expect("v2");
        let products = list_products(&conn).expect("list");
        assert_eq!(products.len(), 1);
        let info = snapshot_info(&conn).expect("info");
        assert_eq!(info.version.as_deref(), Some("v2"));
        assert_eq!(info.warehouse_id.as_deref(), Some("wh-1"));
        assert_eq!(info.product_count, 1);
    }

    #[test]
    fn offline_pos_switch_is_saved_and_refreshed_by_full_and_delta_snapshots() {
        let mut conn = memory_db();
        let mut full = sample_snapshot();
        full.pos_offline_enabled = true;
        apply_snapshot(&mut conn, &full).expect("full snapshot");
        assert!(snapshot_info(&conn).expect("enabled info").pos_offline_enabled);

        let mut delta = sample_delta();
        delta.pos_offline_enabled = false;
        apply_snapshot_delta(&mut conn, &delta).expect("disabled delta");
        assert!(!snapshot_info(&conn).expect("disabled info").pos_offline_enabled);
    }

    #[test]
    fn sync_results_move_items_to_synced_or_held() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        record_sale(&mut conn, &sample_sale("key-ok", "prod-1")).expect("sale ok");
        record_sale(&mut conn, &sample_sale("key-conflict", "prod-2")).expect("sale conflict");
        apply_sync_results(
            &mut conn,
            &[
                SyncResultInput {
                    client_key: "key-ok".to_string(),
                    status: "synced".to_string(),
                    message: None,
                },
                SyncResultInput {
                    client_key: "key-conflict".to_string(),
                    status: "conflict".to_string(),
                    message: Some("Stok tidak cukup".to_string()),
                },
            ],
            "2026-11-07T03:00:00.000Z",
        )
        .expect("apply results");
        // Antrean hidup hanya menyisakan yang held.
        let live = list_outbox(&conn, None).expect("live queue");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].client_key, "key-conflict");
        assert_eq!(live[0].status, "held");
        assert_eq!(live[0].attempts, 1);
        assert_eq!(live[0].last_message.as_deref(), Some("Stok tidak cukup"));
        let synced = list_outbox(&conn, Some("synced")).expect("synced");
        assert_eq!(synced.len(), 1);
        assert_eq!(count_outbox(&conn, "pending").expect("pending count"), 0);
        assert_eq!(count_outbox(&conn, "held").expect("held count"), 1);
        assert_eq!(count_outbox(&conn, "synced").expect("synced count"), 1);
    }

    fn sample_delta() -> SnapshotDeltaInput {
        let mut changed = sample_snapshot().products.remove(0);
        changed.sale_price = "4500.0000".to_string();
        changed.stock = 118.0;
        SnapshotDeltaInput {
        loyalty_balances: vec![],
        promotions: vec![],
        kitchen_tickets: vec![],
        reservations: vec![],
            warehouses: vec![],
            version: "2026-11-07T01:00:00.000Z".to_string(),
            cursor: "2026-11-07T01:00:00.000Z".to_string(),
            base_cursor: "2026-11-07T00:00:00.000Z".to_string(),
            generated_at: "2026-11-07T01:00:00.000Z".to_string(),
            warehouse: Some(SnapshotWarehouseInput {
                id: "wh-1".to_string(),
                code: "GDG".to_string(),
                name: "Gudang Utama".to_string(),
            is_default: true,
            }),
            payment_methods: vec![SnapshotMethodInput {
                id: "pm-2".to_string(),
                code: "QRIS".to_string(),
                name: "QRIS".to_string(),
                method_type: "qris".to_string(),
                fee_enabled: false,
                fee_type: "none".to_string(),
                fee_value: "0".to_string(),
            }],
            products: vec![changed],
            removed_product_ids: vec!["prod-2".to_string()],
            customer_groups: vec![],
            group_prices: vec![],
            replace_group_price_group_ids: vec![],
            receipt: None,
            terminal: None,
            names: None,
            can_discount: false,
            pos_offline_enabled: false,
        }
    }

    #[test]
    fn snapshot_stores_terminal_identity_and_name_directory() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        snapshot.terminal = Some(TerminalIdentityInput {
            id: "term-1".to_string(),
            name: "Kasir 1".to_string(),
            company_name: "PT Toko Uji".to_string(),
            warehouse: SnapshotWarehouseInput {
                id: "wh-1".to_string(),
                code: "GDG".to_string(),
                name: "Gudang Utama".to_string(),
            is_default: true,
            },
        });
        snapshot.names = Some(SnapshotNamesInput {
            cashiers: vec![NameEntryInput {
                id: "kasir-1".to_string(),
                name: "Sari Kasir".to_string(),
                group_id: None,
            }],
            customers: vec![NameEntryInput {
                id: "cust-1".to_string(),
                name: "Budi Pelanggan".to_string(),
                group_id: Some("group-1".to_string()),
            }],
        });
        apply_snapshot(&mut conn, &snapshot).expect("apply");
        let identity = terminal_identity(&conn).expect("identity").expect("ada");
        assert_eq!(identity.terminal_id, "term-1");
        assert_eq!(identity.name, "Kasir 1");
        assert_eq!(identity.company_name, "PT Toko Uji");
        assert_eq!(identity.warehouse_name.as_deref(), Some("Gudang Utama"));
        assert_eq!(
            resolve_name(&conn, "cashier", "kasir-1").expect("resolve").as_deref(),
            Some("Sari Kasir")
        );
        assert_eq!(
            resolve_name(&conn, "customer", "cust-1").expect("resolve").as_deref(),
            Some("Budi Pelanggan")
        );
        assert!(resolve_name(&conn, "customer", "asing").expect("resolve").is_none());
        let info = snapshot_info(&conn).expect("info");
        assert_eq!(info.terminal.expect("info terminal").name, "Kasir 1");

        // Delta membawa direktori baru: direktori lama diganti utuh.
        let mut delta = sample_delta();
        delta.names = Some(SnapshotNamesInput {
            cashiers: vec![],
            customers: vec![NameEntryInput {
                id: "cust-2".to_string(),
                name: "Citra Baru".to_string(),
                group_id: None,
            }],
        });
        apply_snapshot_delta(&mut conn, &delta).expect("delta");
        assert!(resolve_name(&conn, "customer", "cust-1").expect("r").is_none());
        assert_eq!(
            resolve_name(&conn, "customer", "cust-2").expect("r").as_deref(),
            Some("Citra Baru")
        );
    }

    #[test]
    fn pairing_identity_then_close_intent_carries_terminal_stamp() {
        let mut conn = memory_db();
        // Pairing mencatat identitas lebih dulu (belum ada snapshot).
        store_terminal_identity(&conn, "term-9", "Kasir 9").expect("pairing identity");
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let identity = terminal_identity(&conn).expect("i").expect("ada");
        assert_eq!(identity.terminal_id, "term-9", "snapshot tanpa blok terminal tidak menghapus identitas pairing");
        let session = open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "10000".to_string(),
                opened_by: Some("kasir-1".to_string()),
                opened_at: "2026-11-07T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        close_cash_session_with_reason(
            &mut conn,
            &session.id,
            &[],
            "2026-11-07T09:00:00.000Z",
            Some("kas kurang saat hitung fisik"),
        )
        .expect("close");
        let intents = pending_intents(&conn, 10).expect("pending");
        assert_eq!(intents.len(), 2, "buka dan tutup shift dikirim berurutan");
        let close_intent = intents
            .iter()
            .find(|intent| intent.kind == "cash_session_close")
            .expect("close intent");
        assert_eq!(close_intent.payload["terminalId"], "term-9");
        assert_eq!(close_intent.payload["terminalName"], "Kasir 9");
        let ids = intents.iter().map(|intent| intent.id.clone()).collect::<Vec<_>>();
        mark_intents_synced(&conn, &ids).expect("mark");
        assert!(pending_intents(&conn, 10).expect("pending2").is_empty());
    }

    fn packaging_sale(client_key: &str) -> SaleInput {
        let mut sale = sample_sale(client_key, "prod-1");
        sale.expected_total = Some(148000.0);
        sale.lines = vec![
            SaleLineInput {
                product_id: "prod-1".to_string(),
                qty: 1.0,
                discount_type: None,
                discount_value: None,
                serial_numbers: None,
                unit_price: Some(145000.0),
                packaging_id: Some("pkg-dus-1".to_string()),
                isi_snapshot: Some(40.0),
            },
            SaleLineInput {
                product_id: "prod-1".to_string(),
                qty: 3.0,
                discount_type: None,
                discount_value: None,
                serial_numbers: None,
                unit_price: Some(1000.0),
                packaging_id: None,
                isi_snapshot: None,
            },
        ];
        sale.payments[0].amount = 148000.0;
        sale.payments[0].tendered = 148000.0;
        sale
    }

    #[test]
    fn snapshot_stores_packagings_per_product() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let products = list_products(&conn).expect("list");
        let aqua = products.iter().find(|p| p.product_id == "prod-1").expect("prod-1");
        assert_eq!(aqua.packagings.len(), 1);
        let dus = &aqua.packagings[0];
        assert_eq!(dus.packaging_id, "pkg-dus-1");
        assert_eq!(dus.name, "Dus");
        assert_eq!(dus.isi, "40.0000");
        assert_eq!(dus.sale_price.as_deref(), Some("145000.0000"));
        assert_eq!(dus.barcode.as_deref(), Some("8992000000040"));
        assert!(dus.is_active && dus.is_default_sale);
        let beras = products.iter().find(|p| p.product_id == "prod-2").expect("prod-2");
        assert!(beras.packagings.is_empty(), "produk tanpa kemasan membawa daftar kosong");
        assert_eq!(count(&conn, "snapshot_packagings"), 1);
    }

    #[test]
    fn local_product_page_is_bounded_and_searches_product_and_packaging_fields() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");

        let first = list_products_page(&conn, "", 1, 1).expect("first page");
        assert_eq!(first.total, 2);
        assert_eq!(first.page, 1);
        assert_eq!(first.page_size, 1);
        assert_eq!(first.page_count, 2);
        assert_eq!(first.products.len(), 1);
        assert_eq!(first.products[0].product_id, "prod-1");
        assert_eq!(first.products[0].packagings.len(), 1);

        let second = list_products_page(&conn, "", 2, 1).expect("second page");
        assert_eq!(second.products[0].product_id, "prod-2");

        let package_name = list_products_page(&conn, "Dus", 1, 50).expect("package name");
        assert_eq!(package_name.total, 1);
        assert_eq!(package_name.products[0].product_id, "prod-1");
        let package_barcode =
            list_products_page(&conn, "8992000000040", 1, 50).expect("package barcode");
        assert_eq!(package_barcode.total, 1);
        assert_eq!(package_barcode.products[0].product_id, "prod-1");
        let sku = list_products_page(&conn, "SKU-2", 1, 50).expect("sku");
        assert_eq!(sku.products[0].product_id, "prod-2");

        let clamped = list_products_page(&conn, "", 99, 0).expect("clamped page");
        assert_eq!(clamped.page, 2);
        assert_eq!(clamped.page_size, 1);
    }

    #[test]
    fn local_product_barcode_lookup_prefers_active_packaging_then_product() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        // Collision is possible in an offline snapshot even though the
        // server normally prevents it across product/package barcodes.
        conn.execute(
            "UPDATE snapshot_products SET barcode = ?1 WHERE product_id = 'prod-2'",
            params!["8992000000040"],
        )
        .expect("set collision fixture");

        let packaging = find_product_by_code(&conn, "8992000000040")
            .expect("lookup")
            .expect("packaging match");
        assert_eq!(packaging.product.product_id, "prod-1");
        assert_eq!(packaging.packaging_id.as_deref(), Some("pkg-dus-1"));

        conn.execute(
            "UPDATE snapshot_packagings SET is_active = 0 WHERE packaging_id = 'pkg-dus-1'",
            [],
        )
        .expect("deactivate package");
        let product = find_product_by_code(&conn, "8992000000040")
            .expect("lookup")
            .expect("product match");
        assert_eq!(product.product.product_id, "prod-2");
        assert_eq!(product.packaging_id, None);
        assert!(product.product.packagings.is_empty());
        conn.execute(
            "UPDATE snapshot_products SET barcode = NULL WHERE product_id = 'prod-2'",
            [],
        )
        .expect("remove product collision");
        assert!(find_product_by_code(&conn, "8992000000040")
            .expect("inactive package lookup")
            .is_none());

        let by_sku = find_product_by_code(&conn, "SKU-1")
            .expect("sku lookup")
            .expect("sku match");
        assert_eq!(by_sku.product.product_id, "prod-1");
        assert!(find_product_by_code(&conn, "unknown")
            .expect("unknown lookup")
            .is_none());
    }

    #[test]
    fn local_product_page_handles_ten_thousand_rows_and_uses_order_index() {
        let mut conn = memory_db();
        {
            let tx = conn.transaction().expect("transaction");
            {
                let mut insert = tx
                    .prepare(
                        "INSERT INTO snapshot_products
                           (product_id, warehouse_id, sku, barcode, name, sale_price, stock,
                            track_stock, track_serial, unit_code)
                         VALUES (?1, 'wh-1', ?2, ?3, ?4, '1000.0000', 10, 1, 0, 'PCS')",
                    )
                    .expect("prepare bulk fixture");
                for index in 0..10_000 {
                    insert
                        .execute(params![
                            format!("product-{index:05}"),
                            format!("SKU-{index:05}"),
                            format!("BAR-{index:05}"),
                            format!("Produk {index:05}")
                        ])
                        .expect("insert product fixture");
                }
            }
            tx.commit().expect("commit fixture");
        }
        conn.execute(
            "INSERT INTO snapshot_meta (key, value) VALUES ('product_count', '10000')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        )
        .expect("update synthetic cached product count");

        let last_page = list_products_page(&conn, "", 200, 50).expect("last page");
        assert_eq!(last_page.total, 10_000);
        assert_eq!(last_page.page_count, 200);
        assert_eq!(last_page.products.len(), 50);
        assert_eq!(last_page.products[0].product_id, "product-09950");
        assert_eq!(last_page.products[49].product_id, "product-09999");
        let filtered = list_products_page(&conn, "SKU-09999", 1, 50).expect("filtered page");
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.products[0].product_id, "product-09999");
        let code = find_product_by_code(&conn, "BAR-09999")
            .expect("indexed barcode lookup")
            .expect("barcode match");
        assert_eq!(code.product.product_id, "product-09999");

        let mut plan_stmt = conn
            .prepare(
                r#"EXPLAIN QUERY PLAN
                   WITH page_ids AS (
                     SELECT p.product_id, p.name
                     FROM snapshot_products AS p
                     WHERE (?1 = ''
                       OR p.name LIKE ?2 ESCAPE '!'
                       OR p.sku LIKE ?2 ESCAPE '!'
                       OR p.barcode LIKE ?2 ESCAPE '!'
                       OR EXISTS (
                         SELECT 1 FROM snapshot_packagings AS sp
                         WHERE sp.product_id = p.product_id
                           AND (sp.name LIKE ?2 ESCAPE '!'
                             OR sp.barcode LIKE ?2 ESCAPE '!')
                       ))
                     ORDER BY p.name COLLATE NOCASE, p.product_id
                     LIMIT ?3 OFFSET ?4
                   )
                   SELECT p.product_id FROM page_ids AS ids
                   JOIN snapshot_products AS p ON p.product_id = ids.product_id
                   LEFT JOIN snapshot_packagings AS sp ON sp.product_id = p.product_id
                   ORDER BY ids.name COLLATE NOCASE, ids.product_id,
                            sp.sort_order, sp.name, sp.packaging_id"#,
            )
            .expect("prepare catalog page query plan");
        let plan_rows = plan_stmt
            .query_map(params!["", "%%", 50, 0], |row| row.get::<_, String>(3))
            .expect("catalog page query plan")
            .map(|row| row.expect("catalog page query plan row"))
            .collect::<Vec<_>>();
        let plan = plan_rows.join("\n");
        assert!(
            plan.contains("snapshot_products_name_id_idx"),
            "catalog order should use its index: {plan}"
        );

        let mut code_plan_stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT product_id FROM snapshot_products
                 WHERE barcode = 'BAR-09999' OR sku = 'BAR-09999'
                 ORDER BY name COLLATE NOCASE, product_id LIMIT 1",
            )
            .expect("prepare barcode query plan");
        let code_plan_rows = code_plan_stmt
            .query_map([], |row| row.get::<_, String>(3))
            .expect("barcode query plan")
            .map(|row| row.expect("barcode query plan row"))
            .collect::<Vec<_>>();
        let code_plan = code_plan_rows.join("\n");
        assert!(
            code_plan.contains("snapshot_products_barcode_idx")
                && code_plan.contains("snapshot_products_sku_idx"),
            "barcode/SKU lookup should use exact-match indexes: {code_plan}"
        );
    }

    #[test]
    fn record_sale_packaging_line_decrements_local_stock_in_base_units() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let item = record_sale(&mut conn, &packaging_sale("key-dus")).expect("record");
        // Muatan outbox membawa bidang kemasan kontrak S4 apa adanya.
        assert_eq!(item.payload["lines"][0]["packagingId"], "pkg-dus-1");
        assert_eq!(item.payload["lines"][0]["isiSnapshot"], 40.0);
        assert_eq!(item.payload["lines"][0]["qty"], 1.0);
        assert_eq!(item.payload["lines"][0]["unitPrice"], 145000.0);
        // Baris lokal menyimpan cuplikannya (kemasan + qty input +
        // faktor); baris satuan dasar tetap NULL.
        let rows: Vec<(Option<String>, Option<f64>, Option<f64>)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT packaging_id, qty_input, isi_snapshot FROM local_sale_lines ORDER BY id",
                )
                .expect("prepare");
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .expect("query")
                .map(|row| row.expect("row"))
                .collect()
        };
        assert_eq!(rows[0], (Some("pkg-dus-1".to_string()), Some(1.0), Some(40.0)));
        assert_eq!(rows[1], (None, None, None));
        // Stok lokal berkurang dalam pcs: 120 − (1 × 40) − 3 = 77.
        let products = list_products(&conn).expect("list");
        let aqua = products.iter().find(|p| p.product_id == "prod-1").expect("prod-1");
        assert_eq!(aqua.stock, 77.0);
    }

    #[test]
    fn record_sale_rejects_unknown_packaging_and_missing_factor() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let mut unknown = packaging_sale("key-unknown-pkg");
        unknown.lines[0].packaging_id = Some("pkg-tidak-ada".to_string());
        let result = record_sale(&mut conn, &unknown);
        assert!(result.is_err(), "kemasan di luar snapshot lokal harus ditolak: {result:?}");
        let mut no_factor = packaging_sale("key-no-factor");
        no_factor.lines[0].isi_snapshot = None;
        let result = record_sale(&mut conn, &no_factor);
        assert!(result.is_err(), "baris berkemasan tanpa isiSnapshot harus ditolak");
        assert_eq!(count(&conn, "local_sales"), 0, "penjualan gagal tidak setengah tercatat");
        assert_eq!(count(&conn, "outbox"), 0);
    }

    #[test]
    fn delta_replaces_packagings_of_changed_product_and_drops_removed() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("full");
        // Delta: prod-1 berubah — kemasannya kini isi 50 & bertambah
        // satu kemasan Pak; prod-2 (tanpa kemasan) terbuang.
        let mut delta = sample_delta();
        delta.products[0].packagings = vec![
            SnapshotPackagingInput {
                id: "pkg-dus-1".to_string(),
                name: "Dus".to_string(),
                isi: "50.0000".to_string(),
                sale_price: Some("150000.0000".to_string()),
                barcode: Some("8992000000040".to_string()),
                is_active: true,
                is_default_sale: true,
            },
            SnapshotPackagingInput {
                id: "pkg-pak-1".to_string(),
                name: "Pak".to_string(),
                isi: "10.0000".to_string(),
                sale_price: None,
                barcode: None,
                is_active: false,
                is_default_sale: false,
            },
        ];
        apply_snapshot_delta(&mut conn, &delta).expect("delta");
        let products = list_products(&conn).expect("list");
        assert_eq!(products.len(), 1);
        let packs = &products[0].packagings;
        assert_eq!(packs.len(), 2, "blok kemasan diganti utuh oleh delta");
        assert_eq!(packs[0].isi, "50.0000");
        assert_eq!(packs[1].packaging_id, "pkg-pak-1");
        assert!(!packs[1].is_active, "kemasan nonaktif tetap terkirim bertanda");
        assert_eq!(count(&conn, "snapshot_packagings"), 2);
    }

    #[test]
    fn delta_upserts_removes_and_advances_cursor() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        snapshot.cursor = Some("2026-11-07T00:00:00.000Z".to_string());
        apply_snapshot(&mut conn, &snapshot).expect("full");
        let stats = apply_snapshot_delta(&mut conn, &sample_delta()).expect("delta");
        assert_eq!(stats.changed, 1);
        assert_eq!(stats.removed, 1);
        let products = list_products(&conn).expect("list");
        assert_eq!(products.len(), 1, "prod-2 terbuang, prod-1 diperbarui");
        assert_eq!(products[0].sale_price, "4500.0000");
        assert_eq!(products[0].stock, 118.0);
        let methods = list_payment_methods(&conn).expect("methods");
        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].method_id, "pm-2", "metode diganti utuh oleh delta");
        let info = snapshot_info(&conn).expect("info");
        assert_eq!(info.cursor.as_deref(), Some("2026-11-07T01:00:00.000Z"));
        assert_eq!(info.product_count, 1);
    }

    #[test]
    fn delta_keeps_sales_audit_lines_of_removed_products() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("full");
        record_sale(&mut conn, &sample_sale("key-keep", "prod-2")).expect("sale");
        // prod-2 dibuang snapshot berikutnya — baris audit penjualan
        // lokal TIDAK boleh menghalangi (FK sengaja dibuang) dan
        // TIDAK boleh ikut terhapus.
        apply_snapshot_delta(&mut conn, &sample_delta()).expect("delta");
        assert_eq!(count(&conn, "snapshot_products"), 1);
        assert_eq!(count(&conn, "local_sale_lines"), 1);
        assert_eq!(count(&conn, "local_sales"), 1);
    }

    #[test]
    fn claim_reset_and_revert_cycle() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        record_sale(&mut conn, &sample_sale("key-claim", "prod-1")).expect("sale");
        // Startup: inflight yatim dikembalikan ke pending.
        let claimed = claim_pending(&mut conn, 10, "2026-11-07T04:00:00.000Z").expect("claim");
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].status, "inflight");
        let reset = reset_inflight(&conn, "2026-11-07T04:01:00.000Z").expect("reset");
        assert_eq!(reset, 1);
        let live = list_outbox(&conn, None).expect("live");
        assert_eq!(live[0].status, "pending");
        // Klaim ulang lalu gagal kirim → revert ke pending utuh.
        let claimed = claim_pending(&mut conn, 10, "2026-11-07T04:02:00.000Z").expect("claim2");
        revert_claimed(&conn, &["key-claim".to_string()], "2026-11-07T04:03:00.000Z")
            .expect("revert");
        assert_eq!(claimed.len(), 1);
        let live = list_outbox(&conn, None).expect("live2");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].status, "pending");
        assert_eq!(live[0].attempts, 0, "kegagalan prasyarat tidak menambah attempts");
    }

    #[test]
    fn cash_session_blind_close_computes_difference_and_queues_intent() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let session = open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "100000".to_string(),
                opened_by: Some("user-1".to_string()),
                opened_at: "2026-11-07T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        assert!(has_open_cash_session(&conn).expect("open session check"));
        // Sesi kedua untuk gudang sama ditolak selama yang pertama terbuka.
        assert!(open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "0".to_string(),
                opened_by: None,
                opened_at: "2026-11-07T01:05:00.000Z".to_string(),
            },
        )
        .is_err());
        // Penjualan tunai 2 × Rp4.000 bertanda sesi ini.
        let mut sale = sample_sale("key-session", "prod-1");
        sale.origin_session_id = Some(session.id.clone());
        record_sale(&mut conn, &sale).expect("sale");
        // Kasir menghitung fisik Rp105.000 (kurang Rp3.000 dari
        // harapan 100.000 + 8.000) — selisih dihitung server lokal
        // SESUDAH hitungan masuk (buta).
        let closed = close_cash_session_with_reason(
            &mut conn,
            &session.id,
            &[
                DenominationInput { denomination: "100000".to_string(), count: 1 },
                DenominationInput { denomination: "5000".to_string(), count: 1 },
            ],
            "2026-11-07T09:00:00.000Z",
            Some("uang kurang dari penjualan"),
        )
        .expect("close");
        assert!(!has_open_cash_session(&conn).expect("closed session check"));
        assert_eq!(closed.status, "closed");
        assert_eq!(closed.counted_total.as_deref(), Some("105000"));
        assert_eq!(closed.expected_total.as_deref(), Some("108000"));
        assert_eq!(closed.difference_total.as_deref(), Some("-3000"));
        let intents = list_local_intents(&conn).expect("intents");
        assert_eq!(intents.len(), 2, "intent buka dan tutup sesi tersimpan");
        let close_intent = intents
            .iter()
            .find(|intent| intent.kind == "cash_session_close")
            .expect("close intent");
        assert_eq!(close_intent.status, "pending");
        assert_eq!(close_intent.payload["differenceTotal"], "-3000");
        // Menutup dua kali ditolak.
        assert!(close_cash_session(&mut conn, &session.id, &[], "2026-11-07T10:00:00.000Z").is_err());
    }

    #[test]
    fn cash_session_sync_status_scopes_sales_to_current_session() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let session = open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "100000".to_string(),
                opened_by: Some("user-1".to_string()),
                opened_at: "2000-01-01T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        let open_intent = list_local_intents(&conn)
            .expect("intents")
            .into_iter()
            .find(|intent| intent.kind == "cash_session_open")
            .expect("open intent");
        mark_intents_synced(&conn, &[open_intent.id]).expect("sync open intent");

        let mut unrelated = sample_sale("key-other-session", "prod-1");
        unrelated.origin_session_id = Some("other-session".to_string());
        unrelated.queued_at = "2000-01-01T02:00:00.000Z".to_string();
        record_sale(&mut conn, &unrelated).expect("unrelated session sale");
        conn.execute(
            "UPDATE outbox SET status = 'held' WHERE client_key = 'key-other-session'",
            [],
        )
        .expect("hold unrelated sale");

        let status = cash_session_sync_status(&conn, &session.id).expect("sync status");
        assert_eq!(status.pending_sales, 0, "held sale from another session is unrelated");
        assert_eq!(status.pending_intents, 0);

        let mut current = sample_sale("key-current-session", "prod-1");
        current.origin_session_id = Some(session.id.clone());
        current.queued_at = "2000-01-01T03:00:00.000Z".to_string();
        record_sale(&mut conn, &current).expect("current session sale");
        assert_eq!(
            cash_session_sync_status(&conn, &session.id)
                .expect("pending session sale")
                .pending_sales,
            1,
        );

        conn.execute(
            "UPDATE outbox SET status = 'synced' WHERE client_key = 'key-current-session'",
            [],
        )
        .expect("sync current sale");
        let mut legacy = sample_sale("key-legacy-session", "prod-1");
        legacy.queued_at = "2000-01-01T04:00:00.000Z".to_string();
        record_sale(&mut conn, &legacy).expect("legacy session sale");
        assert_eq!(
            cash_session_sync_status(&conn, &session.id)
                .expect("pending legacy session sale")
                .pending_sales,
            1,
            "legacy sales without an origin session use the warehouse and session start",
        );
    }

    #[test]
    fn recorded_sale_preserves_reservation_id_in_outbox_payload() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let mut sale = sample_sale("key-reservation-sale", "prod-1");
        sale.reservation_id = Some("res-9".to_string());
        record_sale(&mut conn, &sale).expect("sale");
        let outbox = list_outbox(&conn, None).expect("outbox");
        let item = outbox.iter().find(|row| row.client_key == "key-reservation-sale").expect("item");
        assert_eq!(item.payload["reservationId"].as_str(), Some("res-9"));
    }

    #[test]
    fn snapshot_loyalty_balances_are_stored_for_customer_panel() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        snapshot.loyalty_balances = vec![SnapshotLoyaltyBalanceInput {
            customer_id: "cust-1".to_string(),
            points: 7,
        }];
        apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let rows = list_snapshot_loyalty_balances(&conn).expect("balances");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].customer_id, "cust-1");
        assert_eq!(rows[0].points, 7);
    }

    #[test]
    fn snapshot_promotions_are_stored_for_checkout() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        snapshot.promotions = vec![SnapshotPromotionInput {
            id: "promo-1".to_string(),
            name: "Diskon 10%".to_string(),
            promo_type: "percent".to_string(),
            value: "10".to_string(),
            min_subtotal: "50000".to_string(),
            product_id: None,
        }];
        apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let rows = list_snapshot_promotions(&conn).expect("promotions");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Diskon 10%");
        assert_eq!(rows[0].value, "10");
    }

    #[test]
    fn snapshot_kitchen_tickets_are_stored_for_preparation_display() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        snapshot.kitchen_tickets = vec![SnapshotKitchenTicketInput {
            sale_id: "sale-1".to_string(),
            number: "SALE-001".to_string(),
            created_at: "2026-11-18T01:00:00.000Z".to_string(),
            lines: vec![SnapshotKitchenTicketLineInput {
                product_name: "Kopi".to_string(),
                qty: "2".to_string(),
                unit_code: Some("Cup".to_string()),
                packaging_name: None,
            }],
        }];
        apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let tickets = list_snapshot_kitchen_tickets(&conn).expect("tickets");
        assert_eq!(tickets.len(), 1);
        assert_eq!(tickets[0].number, "SALE-001");
        assert_eq!(tickets[0].lines[0].product_name, "Kopi");
    }

    #[test]
    fn snapshot_reservations_are_stored_for_checkout_selection() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        snapshot.reservations = vec![SnapshotReservationInput {
            id: "res-1".to_string(),
            number: "RES-001".to_string(),
            product_id: "prod-1".to_string(),
            qty: "5".to_string(),
            expires_at: None,
            reason: Some("pesanan pelanggan".to_string()),
        }];
        apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let rows = list_snapshot_reservations(&conn).expect("reservations");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].number, "RES-001");
        assert_eq!(rows[0].product_id, "prod-1");
        assert_eq!(rows[0].qty, "5");
    }

    #[test]
    fn snapshot_warehouses_are_stored_for_register_selection() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        snapshot.warehouses = vec![
            SnapshotWarehouseInput { id: "wh-1".to_string(), code: "PUSAT".to_string(), name: "Gudang Pusat".to_string(), is_default: true },
            SnapshotWarehouseInput { id: "wh-2".to_string(), code: "CABANG".to_string(), name: "Gudang Cabang".to_string(), is_default: false },
        ];
        apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let rows = list_snapshot_warehouses(&conn).expect("warehouses");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "Gudang Pusat");
        assert!(rows[0].is_default);
    }

    #[test]
    fn snapshot_receipt_keeps_qris_image_for_payment_screen() {
        let mut conn = memory_db();
        let mut snapshot = sample_snapshot();
        let qris = "data:image/png;base64,iVBORw0KGgo=".to_string();
        let mut receipt = snapshot.receipt.clone().unwrap_or_default();
        receipt.qris_image = Some(qris.clone());
        snapshot.receipt = Some(receipt);
        apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let saved = receipt_settings(&conn).expect("read settings").expect("settings exist");
        assert_eq!(saved.qris_image.as_deref(), Some(qris.as_str()));
    }

    #[test]
    fn session_sale_counts_are_grouped_per_origin_session() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let mut a1 = sample_sale("key-count-a1", "prod-1");
        a1.origin_session_id = Some("session-a".to_string());
        record_sale(&mut conn, &a1).expect("sale a1");
        let mut a2 = sample_sale("key-count-a2", "prod-1");
        a2.origin_session_id = Some("session-a".to_string());
        record_sale(&mut conn, &a2).expect("sale a2");
        let mut b = sample_sale("key-count-b", "prod-1");
        b.origin_session_id = Some("session-b".to_string());
        record_sale(&mut conn, &b).expect("sale b");

        let counts = list_session_sales_counts(&conn).expect("counts");
        assert_eq!(counts.iter().find(|c| c.session_id == "session-a").map(|c| c.count), Some(2));
        assert_eq!(counts.iter().find(|c| c.session_id == "session-b").map(|c| c.count), Some(1));
    }

    #[test]
    fn session_payment_totals_group_by_method_and_session() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let mut first = sample_sale("key-pt-a1", "prod-1");
        first.origin_session_id = Some("session-a".to_string());
        first.payments = vec![
            SalePaymentInput { method_id: "pm-cash".to_string(), amount: 3000.0, tendered: 3000.0, reference: None, fee: None },
            SalePaymentInput { method_id: "pm-qris".to_string(), amount: 5000.0, tendered: 5000.0, reference: None, fee: None },
        ];
        record_sale(&mut conn, &first).expect("sale a1");
        let mut second = sample_sale("key-pt-a2", "prod-1");
        second.origin_session_id = Some("session-a".to_string());
        second.payments = vec![SalePaymentInput {
            method_id: "pm-cash".to_string(), amount: 8000.0, tendered: 8000.0, reference: None, fee: None,
        }];
        record_sale(&mut conn, &second).expect("sale a2");
        let mut other = sample_sale("key-pt-b", "prod-1");
        other.origin_session_id = Some("session-b".to_string());
        record_sale(&mut conn, &other).expect("sale b");

        let totals = list_session_payment_totals(&conn).expect("totals");
        let total = |session: &str, method: &str| -> f64 {
            totals.iter().find(|row| row.session_id == session && row.method_id == method).map(|row| row.total).unwrap_or(0.0)
        };
        assert_eq!(total("session-a", "pm-cash"), 11000.0);
        assert_eq!(total("session-a", "pm-qris"), 5000.0);
        assert_eq!(total("session-b", "pm-1"), 8000.0);
    }

    #[test]
    fn payment_totals_in_range_cover_only_selected_dates() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let mut inside = sample_sale("key-range-in", "prod-1");
        inside.date = "2026-11-17".to_string();
        inside.payments = vec![
            SalePaymentInput { method_id: "pm-cash".to_string(), amount: 25000.0, tendered: 25000.0, reference: None, fee: None },
            SalePaymentInput { method_id: "pm-qris".to_string(), amount: 10000.0, tendered: 10000.0, reference: None, fee: None },
        ];
        record_sale(&mut conn, &inside).expect("inside sale");
        let mut outside = sample_sale("key-range-out", "prod-1");
        outside.date = "2026-11-01".to_string();
        record_sale(&mut conn, &outside).expect("outside sale");

        let rows = list_payment_totals_in_range(&conn, "2026-11-17", "2026-11-17").expect("range totals");
        assert_eq!(rows.len(), 2);
        let cash = rows.iter().find(|row| row.method_id == "pm-cash").expect("cash row");
        assert_eq!(cash.count, 1);
        assert_eq!(cash.total, 25000.0);
        assert!(rows.iter().all(|row| row.method_id != "pm-1"));
    }

    #[test]
    fn cash_session_sync_status_counts_only_current_session_intents() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let session = open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "100000".to_string(),
                opened_by: Some("user-1".to_string()),
                opened_at: "2000-01-01T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        let open_intent = list_local_intents(&conn)
            .expect("intents")
            .into_iter()
            .find(|intent| intent.kind == "cash_session_open")
            .expect("open intent");
        mark_intents_synced(&conn, &[open_intent.id]).expect("sync open intent");
        conn.execute(
            "INSERT INTO local_intents (id, kind, payload_json, status, created_at)
             VALUES ('other-session-intent', 'cash_session_movement',
                     '{\"sessionId\":\"other-session\"}', 'held', '2000-01-01T02:00:00.000Z')",
            [],
        )
        .expect("insert unrelated intent");

        let movement = record_cash_session_movement(
            &mut conn,
            &CashSessionMovementInput {
                client_key: "01900000-0000-7000-8000-000000000011".to_string(),
                session_id: session.id.clone(),
                movement_type: "withdrawal".to_string(),
                amount: "1000".to_string(),
                notes: "Tambah uang kembalian".to_string(),
            },
        )
        .expect("movement");
        assert_eq!(
            cash_session_sync_status(&conn, &session.id)
                .expect("pending session intent")
                .pending_intents,
            1,
        );

        mark_intents_synced(&conn, &[movement.id]).expect("sync movement");
        assert_eq!(
            cash_session_sync_status(&conn, &session.id)
                .expect("synced session intent")
                .pending_intents,
            0,
            "held intent for another session does not block this session",
        );
    }

    #[test]
    fn pending_session_close_waits_for_legacy_session_sales() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let session = open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "100000".to_string(),
                opened_by: Some("user-1".to_string()),
                opened_at: "2000-01-01T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        let mut legacy = sample_sale("key-legacy-close", "prod-1");
        legacy.queued_at = "2000-01-01T02:00:00.000Z".to_string();
        record_sale(&mut conn, &legacy).expect("legacy session sale");
        close_cash_session(
            &mut conn,
            &session.id,
            &[DenominationInput {
                denomination: "1000".to_string(),
                count: 108,
            }],
            "2000-01-01T03:00:00.000Z",
        )
        .expect("close");

        let pending = pending_intents(&conn, 10).expect("pending close blocked");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].kind, "cash_session_open");

        conn.execute(
            "UPDATE outbox SET status = 'held' WHERE client_key = 'key-legacy-close'",
            [],
        )
        .expect("hold legacy sale");
        assert_eq!(
            pending_intents(&conn, 10)
                .expect("held sale still blocks close")
                .len(),
            1,
        );

        conn.execute(
            "UPDATE outbox SET status = 'synced' WHERE client_key = 'key-legacy-close'",
            [],
        )
        .expect("sync legacy sale");
        let pending = pending_intents(&conn, 10).expect("close released after sync");
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().any(|intent| intent.kind == "cash_session_close"));
    }

    #[test]
    fn rejected_cash_session_open_can_be_reviewed_and_retried_idempotently() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "100000".to_string(),
                opened_by: Some("user-1".to_string()),
                opened_at: "2026-11-17T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        let open_intent = list_local_intents(&conn)
            .expect("intents")
            .into_iter()
            .find(|intent| intent.kind == "cash_session_open")
            .expect("open intent");
        mark_intents_held(
            &conn,
            &[IntentResultInput {
                client_key: open_intent.id.clone(),
                status: "needsReview".to_string(),
                message: Some("Akun belum memiliki izin sesi kas.".to_string()),
            }],
        )
        .expect("hold open intent");

        let retried = retry_cash_session_open(&conn, &open_intent.id).expect("retry open");
        assert_eq!(retried.id, open_intent.id, "client key tetap stabil");
        assert_eq!(retried.kind, "cash_session_open");
        assert_eq!(retried.status, "pending");
        assert!(retried.payload.get("syncMessage").is_none());
        assert!(retry_cash_session_open(&conn, &open_intent.id).is_err());
    }

    #[test]
    fn cash_session_movements_are_idempotent_and_reconcile_with_close() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let session = open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "100000".to_string(),
                opened_by: Some("user-1".to_string()),
                opened_at: "2026-11-07T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");

        let deposit = CashSessionMovementInput {
            client_key: "01900000-0000-7000-8000-000000000001".to_string(),
            session_id: session.id.clone(),
            movement_type: "deposit".to_string(),
            amount: "40000".to_string(),
            notes: "Setoran pagi ke bank".to_string(),
        };
        let first = record_cash_session_movement(&mut conn, &deposit).expect("deposit");
        let replay = record_cash_session_movement(&mut conn, &deposit).expect("idempotent retry");
        assert_eq!(first.id, replay.id);
        assert_eq!(count(&conn, "local_intents"), 2, "replay tidak menggandakan mutasi");

        record_cash_session_movement(
            &mut conn,
            &CashSessionMovementInput {
                client_key: "01900000-0000-7000-8000-000000000002".to_string(),
                session_id: session.id.clone(),
                movement_type: "withdrawal".to_string(),
                amount: "5000".to_string(),
                notes: "Tambah uang kembalian".to_string(),
            },
        )
        .expect("withdrawal");
        assert!(record_cash_session_movement(
            &mut conn,
            &CashSessionMovementInput {
                client_key: "01900000-0000-7000-8000-000000000003".to_string(),
                session_id: session.id.clone(),
                movement_type: "deposit".to_string(),
                amount: "70000".to_string(),
                notes: "Setoran lebih dari saldo laci".to_string(),
            },
        )
        .is_err());

        let denominations = vec![
            DenominationInput { denomination: "50000".to_string(), count: 1 },
            DenominationInput { denomination: "10000".to_string(), count: 1 },
            DenominationInput { denomination: "5000".to_string(), count: 1 },
        ];
        let preview = preview_cash_session(&conn, &session.id, &denominations).expect("preview");
        assert_eq!(preview.expected_total, "65000");
        assert_eq!(preview.difference_total, "0");
        let closed = close_cash_session(&mut conn, &session.id, &denominations, "2026-11-07T09:00:00.000Z")
            .expect("close");
        assert_eq!(closed.expected_total.as_deref(), Some("65000"));
        assert_eq!(closed.difference_total.as_deref(), Some("0"));

        let pending = pending_intents(&conn, 10).expect("pending");
        assert_eq!(pending.len(), 3, "penutupan menunggu pembukaan dan dua mutasi tersinkron");
        let synced_ids = pending.iter().map(|intent| intent.id.clone()).collect::<Vec<_>>();
        mark_intents_synced(&conn, &synced_ids).expect("mark movements synced");
        let pending = pending_intents(&conn, 10).expect("pending after sync");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].kind, "cash_session_close");
    }

    #[test]
    fn rejected_cash_session_close_can_be_reviewed_and_retried_idempotently() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        let session = open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "100000".to_string(),
                opened_by: Some("user-1".to_string()),
                opened_at: "2026-11-07T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        close_cash_session_with_reason(
            &mut conn,
            &session.id,
            &[],
            "2026-11-07T09:00:00.000Z",
            Some("uang kurang saat hitung fisik"),
        )
        .expect("close");
        let close_intent = list_local_intents(&conn)
            .expect("intents")
            .into_iter()
            .find(|intent| intent.kind == "cash_session_close")
            .expect("close intent");

        mark_intents_held(
            &conn,
            &[IntentResultInput {
                client_key: close_intent.id.clone(),
                status: "needsReview".to_string(),
                message: Some("Kas server berbeda; periksa alasan selisih.".to_string()),
            }],
        )
        .expect("mark needs review");
        let held = list_local_intents(&conn)
            .expect("held intents")
            .into_iter()
            .find(|intent| intent.id == close_intent.id)
            .expect("held close intent");
        assert_eq!(held.status, "held");
        assert_eq!(
            held.payload["syncMessage"],
            "Kas server berbeda; periksa alasan selisih."
        );
        assert!(!pending_intents(&conn, 10)
            .expect("pending while held")
            .iter()
            .any(|intent| intent.id == close_intent.id));

        let retried = retry_cash_session_close(
            &conn,
            &close_intent.id,
            Some("kas dihitung ulang bersama supervisor"),
        )
        .expect("retry close intent");
        assert_eq!(retried.id, close_intent.id, "kunci idempotensi dipertahankan");
        assert_eq!(retried.status, "pending");
        assert_eq!(
            retried.payload["differenceReason"],
            "kas dihitung ulang bersama supervisor"
        );
        assert!(retried.payload.get("syncMessage").is_none());
    }

    #[test]
    fn record_sale_enqueues_original_print_job_in_same_transaction() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        record_sale(&mut conn, &sample_sale("key-print", "prod-1")).expect("record");
        let jobs = list_print_jobs(&conn, None).expect("jobs");
        assert_eq!(jobs.len(), 1, "tepat satu tugas cetak per penjualan tercatat");
        assert_eq!(jobs[0].client_key, "key-print");
        assert_eq!(jobs[0].copy_index, 0, "salinan ke-0 = cetakan asli");
        assert_eq!(jobs[0].status, "pending");
        // Pencatatan yang GAGAL (baris di luar snapshot) tidak
        // menyisakan tugas cetak yatim — satu transaksi yang sama.
        let failed = record_sale(&mut conn, &sample_sale("key-print-bad", "prod-missing"));
        assert!(failed.is_err());
        assert_eq!(list_print_jobs(&conn, None).expect("jobs").len(), 1);
        assert_eq!(count(&conn, "print_jobs"), 1);
    }

    #[test]
    fn print_job_claim_mark_and_reprint_cycle() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        record_sale(&mut conn, &sample_sale("key-cycle", "prod-1")).expect("record");
        // Klaim yatim dipulihkan: printing → pending.
        let claimed = claim_print_jobs(&mut conn, 10, "2026-11-07T03:00:00.000Z").expect("claim");
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].status, "printing");
        assert_eq!(reset_printing(&conn, "2026-11-07T03:01:00.000Z").expect("reset"), 1);
        let claimed = claim_print_jobs(&mut conn, 10, "2026-11-07T03:02:00.000Z").expect("claim2");
        mark_print_job_failed(&conn, &claimed[0].id, "printer mati", "2026-11-07T03:03:00.000Z")
            .expect("fail");
        let failed = list_print_jobs(&conn, Some("failed")).expect("failed list");
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].attempts, 1);
        assert_eq!(failed[0].last_error.as_deref(), Some("printer mati"));
        // Penjualan & outbox TIDAK terpengaruh kegagalan cetak.
        assert_eq!(count(&conn, "local_sales"), 1);
        assert_eq!(list_outbox(&conn, None).expect("outbox").len(), 1);
        // Cetak ulang dari riwayat: copy_index berikutnya (SALINAN).
        let reprint = enqueue_print_job(&conn, "key-cycle", "2026-11-07T03:04:00.000Z")
            .expect("reprint");
        assert_eq!(reprint.copy_index, 1);
        assert_eq!(reprint.status, "pending");
        let claimed = claim_print_jobs(&mut conn, 10, "2026-11-07T03:05:00.000Z").expect("claim3");
        assert_eq!(claimed.len(), 1);
        mark_print_job_printed(&conn, &claimed[0].id, "2026-11-07T03:06:00.000Z").expect("printed");
        let printed = list_print_jobs(&conn, Some("printed")).expect("printed list");
        assert_eq!(printed.len(), 1);
        assert!(printed[0].printed_at.is_some());
        // Penjualan tak dikenal ditolak.
        assert!(enqueue_print_job(&conn, "key-tidak-ada", "2026-11-07T03:07:00.000Z").is_err());
    }

    #[test]
    fn server_receipt_print_queue_persists_bytes_and_retries_the_same_job() {
        let mut conn = memory_db();
        let queued = enqueue_server_receipt_print_job(
            &conn,
            "sale-server-1",
            &[0x1b, b'@', 0x1d, b'V', 0x00],
            "2026-11-07T03:00:00.000Z",
        )
        .expect("queue server receipt");
        assert_eq!(queued.status, "pending");
        assert_eq!(queued.attempts, 0);

        let claimed = claim_server_receipt_print_jobs(&mut conn, 10, "2026-11-07T03:01:00.000Z")
            .expect("claim server receipt");
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].id, queued.id);
        assert_eq!(claimed[0].sale_id, "sale-server-1");
        assert_eq!(claimed[0].receipt_bytes, [0x1b, b'@', 0x1d, b'V', 0x00]);
        mark_server_receipt_failed(
            &conn,
            &queued.id,
            "printer tidak terjangkau",
            "2026-11-07T03:02:00.000Z",
        )
        .expect("mark failure");

        let retry = retry_server_receipt_print_job(&conn, &queued.id, "2026-11-07T03:03:00.000Z")
            .expect("retry same job");
        assert_eq!(retry.id, queued.id);
        assert_eq!(retry.status, "pending");
        assert_eq!(retry.last_error, None);
        let claimed_again = claim_server_receipt_print_jobs(&mut conn, 10, "2026-11-07T03:04:00.000Z")
            .expect("claim retry");
        assert_eq!(claimed_again.len(), 1);
        assert_eq!(claimed_again[0].id, queued.id);
        mark_server_receipt_printed(&conn, &queued.id, "2026-11-07T03:05:00.000Z")
            .expect("mark printed");
        let printed = list_server_receipt_print_jobs(&conn, Some("printed")).expect("printed jobs");
        assert_eq!(printed.len(), 1);
        assert_eq!(printed[0].id, queued.id);
        assert!(printed[0].printed_at.is_some());
        assert!(retry_server_receipt_print_job(&conn, &queued.id, "2026-11-07T03:06:00.000Z").is_err());
    }

    #[test]
    fn snapshot_stores_receipt_block_and_delta_replaces_it() {
        let mut conn = memory_db();
        assert!(receipt_settings(&conn).expect("receipt").is_none());
        let mut snapshot = sample_snapshot();
        snapshot.receipt = Some(ReceiptSettings {
            company_name: "Toko Uji".to_string(),
            address: Some("Jl. Merdeka 1".to_string()),
            phone: None,
            tax_id: None,
            header_text: None,
            footer_text: Some("Sampai jumpa".to_string()),
            show_cashier: true,
            show_tax: true,
            show_customer: false,
            show_session: true,
            show_branding: true,
            receipt_paper: "thermal58".to_string(),
            tax_enabled: true,
            tax_rate: "11.0000".to_string(),
            rounding_mode: "nearest_100".to_string(),
            qris_image: None,
        });
        apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let stored = receipt_settings(&conn).expect("receipt").expect("some");
        assert_eq!(stored.company_name, "Toko Uji");
        assert_eq!(stored.receipt_paper, "thermal58");
        assert_eq!(stored.tax_rate, "11.0000");
        assert!(!stored.show_customer);
        let mut delta = sample_delta();
        let mut replacement = stored.clone();
        replacement.company_name = "Toko Uji Baru".to_string();
        delta.receipt = Some(replacement);
        apply_snapshot_delta(&mut conn, &delta).expect("delta");
        let stored = receipt_settings(&conn).expect("receipt").expect("some2");
        assert_eq!(stored.company_name, "Toko Uji Baru");
    }

    #[test]
    fn file_database_uses_wal_and_busy_timeout() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = open(&dir.path().join("pos.db")).expect("open file db");
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal mode");
        assert_eq!(journal_mode.to_lowercase(), "wal");
        let busy_timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .expect("busy timeout");
        assert_eq!(busy_timeout, 5000);
    }
}
