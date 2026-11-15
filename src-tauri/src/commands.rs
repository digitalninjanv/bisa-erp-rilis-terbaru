//! Command Tauri POS — lapisan invoke tipis.
//!
//! Langkah 4 mengubah peta command secara mendasar (D7):
//! - TIDAK ada lagi command yang menerima snapshot/hasil sinkron
//!   dari JS: HTTP ke `/api/pos/*` kini seluruhnya milik Rust
//!   (`runtime` + `syncengine` + `transport`), dipicu lewat
//!   `refresh_snapshot` / `sync_now` / thread latar;
//! - Langkah 6: token tidak lagi diserahkan sebagai teks — JS
//!   menyerahkan KODE PASANGAN sekali pakai lewat `pair_device`,
//!   Rust menukarnya menjadi token per-terminal dan menyimpannya
//!   di keychain OS; token tidak pernah keluar lagi —
//!   `get_device_status` mengembalikan status tanpa token;
//! - command data tetap satu operasi `posdb` per invoke (satu
//!   transaksi untuk yang menulis).

use rusqlite::Connection;
use tauri::{AppHandle, State};

use crate::device::{self, PrinterConfig};
use crate::displaymap::{DisplayInput, DisplayPayload};
use crate::posdb;
use crate::runtime::{self, DbState, PrinterState};
use crate::syncengine;

fn lock<'a>(
    state: &'a State<'_, DbState>,
) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(|_| "Kunci database lokal rusak (poisoned).".to_string())
}

// ---------------------------------------------------------------------------
// Data lokal (snapshot & outbox — baca/tulis posdb)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn snapshot_info(state: State<'_, DbState>) -> Result<posdb::SnapshotInfo, String> {
    let conn = lock(&state)?;
    posdb::snapshot_info(&conn)
}

#[tauri::command]
pub fn list_snapshot_products_page(
    state: State<'_, DbState>,
    search: String,
    page: u32,
    page_size: u32,
) -> Result<posdb::SnapshotProductPage, String> {
    let conn = lock(&state)?;
    posdb::list_products_page(&conn, &search, page, page_size)
}

#[tauri::command]
pub fn find_snapshot_product_by_code(
    state: State<'_, DbState>,
    code: String,
) -> Result<Option<posdb::SnapshotProductMatch>, String> {
    let conn = lock(&state)?;
    posdb::find_product_by_code(&conn, &code)
}

#[tauri::command]
pub fn list_snapshot_payment_methods(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotPaymentMethod>, String> {
    let conn = lock(&state)?;
    posdb::list_payment_methods(&conn)
}

#[tauri::command]
pub fn record_local_sale(
    app: AppHandle,
    state: State<'_, DbState>,
    sale: posdb::SaleInput,
) -> Result<posdb::OutboxItem, String> {
    let item = {
        let mut conn = lock(&state)?;
        posdb::record_sale(&mut conn, &sale)?
    };
    // Penjualan baru memicu drain latar segera (bila online, antrean
    // tidak menunggu jadwal berkala) dan pekerja cetak segera
    // (tugas cetak sudah tercatat di transaksi yang sama).
    runtime::kick_sync(&app);
    runtime::kick_print(&app);
    Ok(item)
}

#[tauri::command]
pub fn list_outbox(
    state: State<'_, DbState>,
    status: Option<String>,
) -> Result<Vec<posdb::OutboxItem>, String> {
    let conn = lock(&state)?;
    posdb::list_outbox(&conn, status.as_deref())
}

#[tauri::command]
pub fn list_outbox_page(
    state: State<'_, DbState>,
    page: u32,
    page_size: u32,
) -> Result<posdb::OutboxPage, String> {
    let conn = lock(&state)?;
    posdb::list_outbox_page(&conn, page, page_size)
}

// ---------------------------------------------------------------------------
// Konfigurasi perangkat & mesin sinkron (Rust)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_device_status(app: AppHandle) -> runtime::DeviceRuntimeStatus {
    runtime::device_status(&app)
}

/// Pasangkan terminal (Langkah 6): JS menyerahkan URL server +
/// kode pasangan sekali pakai dari admin web; Rust menukarnya
/// menjadi token per-terminal (transport::pair_request) dan
/// menyimpannya di keychain OS. Berjalan di thread blocking —
/// ada panggilan jaringan di dalamnya.
#[tauri::command]
pub async fn pair_device(
    app: AppHandle,
    server_url: String,
    code: String,
) -> Result<runtime::DeviceRuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::pair_device(&app, &server_url, &code))
        .await
        .map_err(|error| error.to_string())?
}

/// Lepas pasangan terminal: token dihapus dari keychain & berkas.
#[tauri::command]
pub fn unpair_device(app: AppHandle) -> runtime::DeviceRuntimeStatus {
    runtime::unpair_device(&app)
}

#[tauri::command]
pub async fn refresh_snapshot(
    app: AppHandle,
) -> Result<syncengine::RefreshSummary, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::run_snapshot_refresh(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<Option<syncengine::DrainSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::run_sync_pass(&app))
        .await
        .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// Updater aplikasi (Langkah 7, D4) — keputusan di modul `updater`,
// glue plugin di runtime. Status tidak membawa rahasia apa pun.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_update_status(app: AppHandle) -> crate::updater::UpdateStatusView {
    runtime::update_status(&app)
}

/// Paksa periksa sekarang (mengabaikan jadwal berkala), unduh di
/// latar, dan pasang bila gerbang sesi mengizinkan.
#[tauri::command]
pub async fn check_update_now(app: AppHandle) -> Result<crate::updater::UpdateStatusView, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::run_update_check(&app, true))
        .await
        .map_err(|error| error.to_string())
}

/// Perintah eksplisit pengguna: pasang paket yang sudah terunduh
/// sekarang — jalan keluar sah dari gerbang sesi kas.
#[tauri::command]
pub async fn install_update_now(
    app: AppHandle,
) -> Result<crate::updater::UpdateStatusView, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::run_update_install(&app))
        .await
        .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// Sesi kas lokal
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_cash_session(
    state: State<'_, DbState>,
    warehouse_id: String,
    opening_cash: String,
    opened_by: Option<String>,
) -> Result<posdb::CashSession, String> {
    let conn = lock(&state)?;
    posdb::open_cash_session(
        &conn,
        &posdb::CashSessionOpenInput {
            warehouse_id,
            opening_cash,
            opened_by,
            opened_at: posdb::now_iso(),
        },
    )
}

#[tauri::command]
pub fn close_cash_session(
    state: State<'_, DbState>,
    session_id: String,
    counted: Vec<posdb::DenominationInput>,
) -> Result<posdb::CashSession, String> {
    let mut conn = lock(&state)?;
    posdb::close_cash_session(&mut conn, &session_id, &counted, &posdb::now_iso())
}

#[tauri::command]
pub fn current_cash_session(
    state: State<'_, DbState>,
    warehouse_id: String,
) -> Result<Option<posdb::CashSession>, String> {
    let conn = lock(&state)?;
    posdb::current_cash_session(&conn, &warehouse_id)
}

#[tauri::command]
pub fn list_cash_sessions(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::CashSession>, String> {
    let conn = lock(&state)?;
    posdb::list_cash_sessions(&conn)
}

#[tauri::command]
pub fn count_cash_sessions(state: State<'_, DbState>) -> Result<i64, String> {
    let conn = lock(&state)?;
    posdb::count_cash_sessions(&conn)
}

#[tauri::command]
pub fn list_local_intents(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::LocalIntent>, String> {
    let conn = lock(&state)?;
    posdb::list_local_intents(&conn)
}

// ---------------------------------------------------------------------------
// Printer ESC/POS & antrean cetak (Langkah 5, D6)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_printer_status(app: AppHandle) -> runtime::PrinterRuntimeStatus {
    runtime::printer_status(&app)
}

/// Simpan konfigurasi printer ke Rust (printer.json, pola
/// device.json). Lebar kertas hanya 58/80mm — divalidasi
/// `device::save_printer`.
#[tauri::command]
pub fn set_printer_config(
    app: AppHandle,
    state: State<'_, PrinterState>,
    host: String,
    port: u16,
    paper_width_mm: u16,
) -> Result<runtime::PrinterRuntimeStatus, String> {
    let config = PrinterConfig {
        host: host.trim().to_string(),
        port,
        paper_width_mm,
    };
    device::save_printer(&state.dir, &config)?;
    {
        let mut guard = state
            .config
            .lock()
            .map_err(|_| "Kunci konfigurasi printer rusak (poisoned).".to_string())?;
        *guard = Some(config);
    }
    // Konfigurasi baru: antrean tertunda layak dicoba lagi.
    runtime::kick_print(&app);
    Ok(runtime::printer_status(&app))
}

#[tauri::command]
pub fn list_print_jobs(
    state: State<'_, DbState>,
    status: Option<String>,
) -> Result<Vec<posdb::PrintJob>, String> {
    let conn = lock(&state)?;
    posdb::list_print_jobs(&conn, status.as_deref())
}

/// Cetak (ulang) struk penjualan lokal: tugas salinan berikutnya
/// masuk antrean dengan pita SALINAN; pekerja latar mengirimnya.
#[tauri::command]
pub fn print_receipt(
    app: AppHandle,
    state: State<'_, DbState>,
    client_key: String,
) -> Result<posdb::PrintJob, String> {
    let job = {
        let conn = lock(&state)?;
        posdb::enqueue_print_job(&conn, &client_key, &posdb::now_iso())?
    };
    runtime::kick_print(&app);
    Ok(job)
}

#[tauri::command]
pub async fn test_print(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || runtime::send_test_print(&app))
        .await
        .map_err(|error| error.to_string())?
}

/// Buka laci tanpa penjualan — beralasan & tercatat (event lokal
/// `drawer_open`); lihat `runtime::open_drawer`.
#[tauri::command]
pub async fn open_drawer(app: AppHandle, reason: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || runtime::open_drawer(&app, &reason))
        .await
        .map_err(|error| error.to_string())?
}

// ---------------------------------------------------------------------------
// Layar pelanggan (Langkah 8) — jendela kedua `display`.
//
// Jendela utama melaporkan keadaan keranjang; Rust memetakannya
// (murni, `displaymap`), menyimpannya, dan memancarkannya ke
// jendela display. Jendela display hanya memanggil
// `get_customer_display` — ia tidak pernah mengirim data keluar.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn update_customer_display(app: AppHandle, input: DisplayInput) -> DisplayPayload {
    runtime::update_customer_display(&app, input)
}

#[tauri::command]
pub fn get_customer_display(app: AppHandle) -> DisplayPayload {
    runtime::customer_display(&app)
}

#[tauri::command]
pub fn open_customer_display(app: AppHandle) -> Result<bool, String> {
    runtime::open_customer_display(&app)
}

#[tauri::command]
pub fn close_customer_display(app: AppHandle) -> bool {
    runtime::close_customer_display(&app)
}

#[tauri::command]
pub fn customer_display_open(app: AppHandle) -> bool {
    runtime::customer_display_open(&app)
}
