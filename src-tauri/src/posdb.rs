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

pub type DbResult<T> = Result<T, String>;

fn db_err(error: rusqlite::Error) -> String {
    error.to_string()
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS snapshot_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_products (
  product_id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
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
  type TEXT NOT NULL
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
  created_at TEXT NOT NULL
);
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
  tax_rate TEXT NOT NULL DEFAULT '0'
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
  PRIMARY KEY (kind, id)
);
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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotWarehouseInput {
    pub id: String,
    pub code: String,
    pub name: String,
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
    pub payment_methods: Vec<SnapshotMethodInput>,
    pub products: Vec<SnapshotProductInput>,
    /// Blok cetak (Langkah 5); snapshot lama tidak memilikinya.
    #[serde(default)]
    pub receipt: Option<ReceiptSettings>,
    /// Identitas terminal (Langkah 6); snapshot lama tidak memilikinya.
    #[serde(default)]
    pub terminal: Option<TerminalIdentityInput>,
    /// Direktori nama kasir & pelanggan (Langkah 6).
    #[serde(default)]
    pub names: Option<SnapshotNamesInput>,
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
    pub payment_methods: Vec<SnapshotMethodInput>,
    pub products: Vec<SnapshotProductInput>,
    pub removed_product_ids: Vec<String>,
    /// Blok cetak (Langkah 5) — selalu utuh juga di delta.
    #[serde(default)]
    pub receipt: Option<ReceiptSettings>,
    /// Identitas terminal (Langkah 6) — selalu utuh juga di delta.
    #[serde(default)]
    pub terminal: Option<TerminalIdentityInput>,
    /// Direktori nama (Langkah 6) — selalu utuh juga di delta.
    #[serde(default)]
    pub names: Option<SnapshotNamesInput>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_total: Option<f64>,
    pub lines: Vec<SaleLineInput>,
    pub payments: Vec<SalePaymentInput>,
    pub queued_at: String,
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
    tx.execute("DELETE FROM snapshot_packagings", []).map_err(db_err)?;
    tx.execute("DELETE FROM snapshot_payment_methods", []).map_err(db_err)?;
    let warehouse_id = snapshot
        .warehouse
        .as_ref()
        .map(|w| w.id.clone())
        .unwrap_or_default();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_products
                   (product_id, warehouse_id, sku, barcode, name, sale_price, stock, track_stock, track_serial, unit_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(db_err)?;
        for product in &snapshot.products {
            stmt.execute(params![
                product.id,
                warehouse_id,
                product.sku,
                product.barcode,
                product.name,
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
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_payment_methods (method_id, code, name, type)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(db_err)?;
        for method in &snapshot.payment_methods {
            stmt.execute(params![method.id, method.code, method.name, method.method_type])
                .map_err(db_err)?;
        }
    }
    set_meta(&tx, "version", &snapshot.version)?;
    set_meta(&tx, "generated_at", &snapshot.generated_at)?;
    set_meta(&tx, "warehouse_id", &warehouse_id)?;
    set_meta(&tx, "product_count", &snapshot.products.len().to_string())?;
    if let Some(cursor) = &snapshot.cursor {
        set_meta(&tx, "cursor", cursor)?;
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
            receipt_paper, tax_enabled, tax_rate)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
           tax_rate = excluded.tax_rate",
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

/// Simpan direktori nama snapshot (diganti utuh dalam transaksi
/// pemanggil — direktori selalu cermin server terbaru).
fn store_names(tx: &rusqlite::Transaction<'_>, names: &SnapshotNamesInput) -> DbResult<()> {
    tx.execute("DELETE FROM snapshot_names", []).map_err(db_err)?;
    let mut stmt = tx
        .prepare("INSERT INTO snapshot_names (kind, id, name) VALUES (?1, ?2, ?3)")
        .map_err(db_err)?;
    for cashier in &names.cashiers {
        stmt.execute(params!["cashier", cashier.id, cashier.name])
            .map_err(db_err)?;
    }
    for customer in &names.customers {
        stmt.execute(params!["customer", customer.id, customer.name])
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
                receipt_paper, tax_enabled, tax_rate
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
                   (product_id, warehouse_id, sku, barcode, name, sale_price, stock, track_stock, track_serial, unit_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(product_id) DO UPDATE SET
                   warehouse_id = excluded.warehouse_id,
                   sku = excluded.sku,
                   barcode = excluded.barcode,
                   name = excluded.name,
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
    tx.execute("DELETE FROM snapshot_payment_methods", []).map_err(db_err)?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO snapshot_payment_methods (method_id, code, name, type)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(db_err)?;
        for method in &delta.payment_methods {
            stmt.execute(params![method.id, method.code, method.name, method.method_type])
                .map_err(db_err)?;
        }
    }
    set_meta(&tx, "version", &delta.version)?;
    set_meta(&tx, "generated_at", &delta.generated_at)?;
    set_meta(&tx, "warehouse_id", &warehouse_id)?;
    set_meta(&tx, "cursor", &delta.cursor)?;
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
    Ok(SnapshotInfo {
        version: meta("version")?,
        cursor: meta("cursor")?,
        generated_at: meta("generated_at")?,
        warehouse_id: meta("warehouse_id")?,
        product_count,
        payment_method_count,
        terminal: terminal_identity(conn)?,
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
            "SELECT product_id, sku, barcode, name, sale_price, stock, track_stock, track_serial, unit_code
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
    let search = search.trim();
    let escaped = search
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_");
    let pattern = format!("%{escaped}%");
    let total = if search.is_empty() {
        snapshot_product_count(conn)?
    } else {
        conn.query_row(
            r#"SELECT count(*)
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
                 ))"#,
            params![search, pattern],
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
               SELECT p.product_id, p.sku, p.barcode, p.name, p.sale_price,
                      p.stock, p.track_stock, p.track_serial, p.unit_code,
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
        .query_map(params![search, pattern, page_size as i64, offset], |row| {
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
                packagings: Vec::new(),
            };
            let packaging_id: Option<String> = row.get(9)?;
            let packaging = match packaging_id {
                Some(packaging_id) => Some(SnapshotPackaging {
                    packaging_id,
                    name: row.get(10)?,
                    isi: row.get(11)?,
                    sale_price: row.get(12)?,
                    barcode: row.get(13)?,
                    is_active: row.get::<_, i64>(14)? != 0,
                    is_default_sale: row.get::<_, i64>(15)? != 0,
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
                    track_stock, track_serial, unit_code
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
        .prepare("SELECT method_id, code, name, type FROM snapshot_payment_methods ORDER BY name")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnapshotPaymentMethod {
                method_id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                method_type: row.get(3)?,
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
    if sale.lines.is_empty() {
        return Err("Penjualan tanpa baris tidak dapat dicatat.".to_string());
    }
    let payload_json = serde_json::to_string(sale).map_err(|error| error.to_string())?;
    let expected_total = sale
        .expected_total
        .unwrap_or_else(|| sale.payments.iter().map(|p| p.amount).sum());
    let tx = conn.transaction().map_err(db_err)?;
    tx.execute(
        "INSERT INTO local_sales (client_key, warehouse_id, sale_date, expected_total, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            sale.client_key,
            sale.warehouse_id,
            sale.date,
            expected_total.to_string(),
            payload_json,
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
    tx.commit().map_err(db_err)?;
    get_outbox_by_key(conn, &sale.client_key)?
        .ok_or_else(|| "Baris outbox tidak ditemukan sesudah pencatatan.".to_string())
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

// ---------------------------------------------------------------------------
// Penjualan lokal tersimpan & peristiwa lokal (Langkah 5)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct LocalSaleRecord {
    pub client_key: String,
    pub sale: SaleInput,
}

/// Baca penjualan lokal tersimpan (muatan di-parse dari JSON yang
/// sama dengan yang dikirim ke server) — sumber cetak & cetak ulang.
pub fn get_local_sale(conn: &Connection, client_key: &str) -> DbResult<Option<LocalSaleRecord>> {
    let payload_text: Option<String> = conn
        .query_row(
            "SELECT payload_json FROM local_sales WHERE client_key = ?1",
            params![client_key],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(db_err(other)),
        })?;
    match payload_text {
        None => Ok(None),
        Some(text) => {
            let sale: SaleInput =
                serde_json::from_str(&text).map_err(|error| error.to_string())?;
            Ok(Some(LocalSaleRecord {
                client_key: client_key.to_string(),
                sale,
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
    parse_money(&input.opening_cash, "modal awal")?;
    let existing: i64 = conn
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
    conn.execute(
        "INSERT INTO cash_sessions (id, warehouse_id, opened_at, opened_by, opening_cash, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open')",
        params![id, input.warehouse_id, input.opened_at, input.opened_by, input.opening_cash],
    )
    .map_err(db_err)?;
    get_cash_session(conn, &id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan sesudah dibuka.".to_string())
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

/// Periksa gerbang updater tanpa memuat seluruh histori sesi kas.
pub fn has_open_cash_session(conn: &Connection) -> DbResult<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM cash_sessions WHERE status = 'open')",
        [],
        |row| row.get(0),
    )
    .map_err(db_err)
}

/// Tutup sesi secara BUTA dalam satu transaksi: hitungan fisik
/// kasir (denominasi) diterima apa adanya; harapan lokal dihitung
/// dari modal awal + pembayaran TUNAI penjualan lokal sesi ini —
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
    let mut counted_total = 0.0_f64;
    for entry in counted {
        if entry.count < 0 {
            return Err("Jumlah lembar denominasi tidak boleh negatif.".to_string());
        }
        counted_total += parse_money(&entry.denomination, "denominasi")? * entry.count as f64;
    }

    let tx = conn.transaction().map_err(db_err)?;
    let session = get_cash_session(&tx, session_id)?
        .ok_or_else(|| "Sesi kas tidak ditemukan.".to_string())?;
    if session.status != "open" {
        return Err("Sesi kas ini sudah tertutup.".to_string());
    }
    let opening = parse_money(&session.opening_cash, "modal awal")?;
    let cash_sales: f64 = tx
        .query_row(
            "SELECT coalesce(sum(cast(json_extract(pay.value, '$.amount') as real)), 0)
             FROM local_sales s
             JOIN json_each(s.payload_json, '$.payments') pay
             JOIN snapshot_payment_methods m
               ON m.method_id = json_extract(pay.value, '$.methodId')
             WHERE m.type = 'cash'
               AND (
                 json_extract(s.payload_json, '$.originSessionId') = ?1
                 OR (
                   json_extract(s.payload_json, '$.originSessionId') IS NULL
                   AND s.warehouse_id = ?2
                   AND s.created_at >= ?3
                   AND s.created_at <= ?4
                 )
               )",
            params![session.id, session.warehouse_id, session.opened_at, closed_at],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    let expected = opening + cash_sales;
    let difference = counted_total - expected;
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
            "SELECT id, kind, payload_json, status, created_at FROM local_intents
             WHERE status = 'pending' ORDER BY created_at LIMIT ?1",
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
            version: "v1".to_string(),
            cursor: None,
            generated_at: "2026-11-07T00:00:00.000Z".to_string(),
            warehouse: Some(SnapshotWarehouseInput {
                id: "wh-1".to_string(),
                code: "GDG".to_string(),
                name: "Gudang Utama".to_string(),
            }),
            payment_methods: vec![SnapshotMethodInput {
                id: "pm-1".to_string(),
                code: "CASH".to_string(),
                name: "Tunai".to_string(),
                method_type: "cash".to_string(),
            }],
            products: vec![
                SnapshotProductInput {
                    id: "prod-1".to_string(),
                    sku: "SKU-1".to_string(),
                    barcode: Some("8990001".to_string()),
                    name: "Aqua 600ml".to_string(),
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
                    sale_price: "66000.0000".to_string(),
                    stock: 28.0,
                    track_stock: true,
                    track_serial: false,
                    unit_code: Some("PACK".to_string()),
                    packagings: vec![],
                },
            ],
            receipt: None,
            terminal: None,
            names: None,
        }
    }

    fn sample_sale(client_key: &str, product_id: &str) -> SaleInput {
        SaleInput {
            client_key: client_key.to_string(),
            warehouse_id: "wh-1".to_string(),
            group_id: None,
            customer_id: None,
            due_date: None,
            date: "2026-11-07".to_string(),
            cashier_id: Some("user-1".to_string()),
            origin_session_id: None,
            device_id: Some("desktop-dev".to_string()),
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
    fn duplicate_client_key_is_rejected_without_doubling() {
        let mut conn = memory_db();
        apply_snapshot(&mut conn, &sample_snapshot()).expect("snapshot");
        record_sale(&mut conn, &sample_sale("key-dup", "prod-1")).expect("first");
        let result = record_sale(&mut conn, &sample_sale("key-dup", "prod-1"));
        assert!(result.is_err());
        assert_eq!(count(&conn, "local_sales"), 1);
        assert_eq!(count(&conn, "outbox"), 1);
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
            version: "2026-11-07T01:00:00.000Z".to_string(),
            cursor: "2026-11-07T01:00:00.000Z".to_string(),
            base_cursor: "2026-11-07T00:00:00.000Z".to_string(),
            generated_at: "2026-11-07T01:00:00.000Z".to_string(),
            warehouse: Some(SnapshotWarehouseInput {
                id: "wh-1".to_string(),
                code: "GDG".to_string(),
                name: "Gudang Utama".to_string(),
            }),
            payment_methods: vec![SnapshotMethodInput {
                id: "pm-2".to_string(),
                code: "QRIS".to_string(),
                name: "QRIS".to_string(),
                method_type: "qris".to_string(),
            }],
            products: vec![changed],
            removed_product_ids: vec!["prod-2".to_string()],
            receipt: None,
            terminal: None,
            names: None,
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
            },
        });
        snapshot.names = Some(SnapshotNamesInput {
            cashiers: vec![NameEntryInput {
                id: "kasir-1".to_string(),
                name: "Sari Kasir".to_string(),
            }],
            customers: vec![NameEntryInput {
                id: "cust-1".to_string(),
                name: "Budi Pelanggan".to_string(),
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
        close_cash_session(&mut conn, &session.id, &[], "2026-11-07T09:00:00.000Z").expect("close");
        let intents = pending_intents(&conn, 10).expect("pending");
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0].payload["terminalId"], "term-9");
        assert_eq!(intents[0].payload["terminalName"], "Kasir 9");
        mark_intents_synced(&conn, &[intents[0].id.clone()]).expect("mark");
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
        let closed = close_cash_session(
            &mut conn,
            &session.id,
            &[
                DenominationInput { denomination: "100000".to_string(), count: 1 },
                DenominationInput { denomination: "5000".to_string(), count: 1 },
            ],
            "2026-11-07T09:00:00.000Z",
        )
        .expect("close");
        assert!(!has_open_cash_session(&conn).expect("closed session check"));
        assert_eq!(closed.status, "closed");
        assert_eq!(closed.counted_total.as_deref(), Some("105000"));
        assert_eq!(closed.expected_total.as_deref(), Some("108000"));
        assert_eq!(closed.difference_total.as_deref(), Some("-3000"));
        let intents = list_local_intents(&conn).expect("intents");
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0].kind, "cash_session_close");
        assert_eq!(intents[0].status, "pending");
        assert_eq!(intents[0].payload["differenceTotal"], "-3000");
        // Menutup dua kali ditolak.
        assert!(close_cash_session(&mut conn, &session.id, &[], "2026-11-07T10:00:00.000Z").is_err());
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
