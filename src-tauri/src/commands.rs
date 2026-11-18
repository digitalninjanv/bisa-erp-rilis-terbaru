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

use crate::device::{self, PrinterConfig, PrinterTransportType};
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
    category_id: Option<String>,
) -> Result<posdb::SnapshotProductPage, String> {
    let conn = lock(&state)?;
    posdb::list_products_page_filtered(&conn, &search, category_id.as_deref(), page, page_size)
}

#[tauri::command]
pub fn list_snapshot_categories(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotCategory>, String> {
    let conn = lock(&state)?;
    posdb::list_snapshot_categories(&conn)
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
pub fn get_snapshot_products_by_ids(
    state: State<'_, DbState>,
    product_ids: Vec<String>,
) -> Result<Vec<posdb::SnapshotProduct>, String> {
    let conn = lock(&state)?;
    posdb::get_products_by_ids(&conn, &product_ids)
}

#[tauri::command]
pub fn list_snapshot_payment_methods(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotPaymentMethod>, String> {
    let conn = lock(&state)?;
    posdb::list_payment_methods(&conn)
}

#[tauri::command]
pub fn list_snapshot_names(
    state: State<'_, DbState>,
    kind: String,
) -> Result<Vec<posdb::NameEntryInput>, String> {
    if kind != "customer" && kind != "cashier" {
        return Err("Jenis direktori POS tidak valid.".to_string());
    }
    let conn = lock(&state)?;
    posdb::snapshot_name_entries(&conn, &kind)
}

#[tauri::command]
pub fn snapshot_group_pricing(
    state: State<'_, DbState>,
) -> Result<posdb::SnapshotGroupPricing, String> {
    let conn = lock(&state)?;
    posdb::snapshot_group_pricing(&conn)
}

#[tauri::command]
pub fn list_local_held_sales(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::LocalHeldSale>, String> {
    let conn = lock(&state)?;
    posdb::list_held_sales(&conn)
}

#[tauri::command]
pub fn save_local_held_sale(
    state: State<'_, DbState>,
    id: String,
    label: String,
    payload: serde_json::Value,
) -> Result<posdb::LocalHeldSale, String> {
    let conn = lock(&state)?;
    posdb::save_held_sale(&conn, &id, &label, &payload, &posdb::now_iso())
}

#[tauri::command]
pub fn delete_local_held_sale(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = lock(&state)?;
    posdb::delete_held_sale(&conn, &id)
}

#[tauri::command]
pub fn record_local_sale(
    app: AppHandle,
    state: State<'_, DbState>,
    sale: posdb::SaleInput,
    held_sale_id: Option<String>,
) -> Result<posdb::OutboxItem, String> {
    let item = {
        let mut conn = lock(&state)?;
        let receipt_context = crate::printing::load_receipt_context(&conn)?;
        posdb::record_sale_from_held_with_receipt_context(
            &mut conn,
            &sale,
            held_sale_id.as_deref(),
            &receipt_context,
        )?
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

#[tauri::command]
pub fn list_local_sales_page(
    state: State<'_, DbState>,
    page: u32,
    page_size: u32,
    query: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<posdb::LocalSalesPage, String> {
    let conn = lock(&state)?;
    posdb::list_local_sales_page(&conn, page, page_size, &query, from.as_deref(), to.as_deref())
}

// ---------------------------------------------------------------------------
// Konfigurasi perangkat & mesin sinkron (Rust)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_device_status(app: AppHandle) -> runtime::DeviceRuntimeStatus {
    runtime::device_status(&app)
}

#[tauri::command]
pub async fn fetch_server_pos_transactions(
    app: AppHandle,
    page: u32,
    query: String,
    status: Option<String>,
    from: Option<String>,
    to: Option<String>,
    sale_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime::fetch_pos_transactions(
            &app,
            page,
            &query,
            status.as_deref(),
            from.as_deref(),
            to.as_deref(),
            sale_id.as_deref(),
        )
    })
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fetch_server_pos_cash_session_summary(
    app: AppHandle,
    session_id: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime::fetch_pos_cash_session_summary(&app, &session_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn print_server_receipt(
    app: AppHandle,
    sale_id: String,
) -> Result<posdb::ServerReceiptPrintJob, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::print_server_receipt(&app, &sale_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn post_server_pos_transaction(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::post_pos_transaction(&app, &payload))
        .await
        .map_err(|error| error.to_string())?
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

/// Autentikasi kasir lewat server ERP. Password hanya melewati IPC ke
/// Rust dan tidak disimpan; cookie Better Auth tetap di memori Rust.
#[tauri::command]
pub async fn cashier_login(
    app: AppHandle,
    server_url: String,
    email: String,
    password: String,
) -> Result<runtime::CashierLoginView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime::begin_cashier_login(&app, &server_url, &email, &password)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cashier_login_continue(
    app: AppHandle,
    two_factor_code: String,
) -> Result<runtime::CashierLoginView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime::continue_cashier_login(&app, &two_factor_code)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cashier_enroll(
    app: AppHandle,
    company_id: String,
) -> Result<runtime::DeviceRuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || runtime::enroll_cashier(&app, &company_id))
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
    app: AppHandle,
    state: State<'_, DbState>,
    warehouse_id: String,
    opening_cash: String,
    opened_by: Option<String>,
) -> Result<posdb::CashSession, String> {
    let conn = lock(&state)?;
    let opened = posdb::open_cash_session(
        &conn,
        &posdb::CashSessionOpenInput {
            warehouse_id,
            opening_cash,
            opened_by,
            opened_at: posdb::now_iso(),
        },
    )?;
    drop(conn);
    runtime::kick_sync(&app);
    Ok(opened)
}

#[tauri::command]
pub fn close_cash_session(
    app: AppHandle,
    state: State<'_, DbState>,
    session_id: String,
    counted: Vec<posdb::DenominationInput>,
    difference_reason: Option<String>,
) -> Result<posdb::CashSession, String> {
    let mut conn = lock(&state)?;
    let closed = posdb::close_cash_session_with_reason(
        &mut conn,
        &session_id,
        &counted,
        &posdb::now_iso(),
        difference_reason.as_deref(),
    )?;
    drop(conn);
    runtime::kick_sync(&app);
    Ok(closed)
}

#[tauri::command]
pub fn preview_cash_session(
    state: State<'_, DbState>,
    session_id: String,
    counted: Vec<posdb::DenominationInput>,
) -> Result<posdb::CashSessionPreview, String> {
    let conn = lock(&state)?;
    posdb::preview_cash_session(&conn, &session_id, &counted)
}

#[tauri::command]
pub fn get_cash_session_sync_status(
    state: State<'_, DbState>,
    session_id: String,
) -> Result<posdb::CashSessionSyncStatus, String> {
    let conn = lock(&state)?;
    posdb::cash_session_sync_status(&conn, &session_id)
}

#[tauri::command]
pub fn record_cash_session_movement(
    app: AppHandle,
    state: State<'_, DbState>,
    movement: posdb::CashSessionMovementInput,
) -> Result<posdb::LocalIntent, String> {
    let mut conn = lock(&state)?;
    let intent = posdb::record_cash_session_movement(&mut conn, &movement)?;
    drop(conn);
    runtime::kick_sync(&app);
    Ok(intent)
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
pub fn list_session_sales_counts(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SessionSaleCount>, String> {
    let conn = lock(&state)?;
    posdb::list_session_sales_counts(&conn)
}

#[tauri::command]
pub fn list_session_payment_totals(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SessionPaymentTotal>, String> {
    let conn = lock(&state)?;
    posdb::list_session_payment_totals(&conn)
}

#[tauri::command]
pub fn list_payment_totals_in_range(
    state: State<'_, DbState>,
    from: String,
    to: String,
) -> Result<Vec<posdb::PaymentMethodTotal>, String> {
    let conn = lock(&state)?;
    posdb::list_payment_totals_in_range(&conn, &from, &to)
}

#[tauri::command]
pub fn list_local_intents(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::LocalIntent>, String> {
    let conn = lock(&state)?;
    posdb::list_local_intents(&conn)
}

#[tauri::command]
pub fn retry_cash_session_close(
    app: AppHandle,
    state: State<'_, DbState>,
    intent_id: String,
    difference_reason: Option<String>,
) -> Result<posdb::LocalIntent, String> {
    let conn = lock(&state)?;
    let intent = posdb::retry_cash_session_close(
        &conn,
        &intent_id,
        difference_reason.as_deref(),
    )?;
    drop(conn);
    runtime::kick_sync(&app);
    Ok(intent)
}

#[tauri::command]
pub fn retry_cash_session_open(
    app: AppHandle,
    state: State<'_, DbState>,
    intent_id: String,
) -> Result<posdb::LocalIntent, String> {
    let conn = lock(&state)?;
    let intent = posdb::retry_cash_session_open(&conn, &intent_id)?;
    drop(conn);
    runtime::kick_sync(&app);
    Ok(intent)
}

#[tauri::command]
pub fn retry_cash_session_movement(
    app: AppHandle,
    state: State<'_, DbState>,
    intent_id: String,
) -> Result<posdb::LocalIntent, String> {
    let conn = lock(&state)?;
    let intent = posdb::retry_cash_session_movement(&conn, &intent_id)?;
    drop(conn);
    runtime::kick_sync(&app);
    Ok(intent)
}

// ---------------------------------------------------------------------------
// Printer ESC/POS & antrean cetak (Langkah 5, D6)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_qris_image(state: State<'_, DbState>) -> Result<Option<String>, String> {
    let conn = lock(&state)?;
    let settings = posdb::receipt_settings(&conn)?;
    Ok(settings.and_then(|receipt| receipt.qris_image))
}

#[tauri::command]
pub fn list_snapshot_warehouses(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotWarehouseInput>, String> {
    let conn = lock(&state)?;
    posdb::list_snapshot_warehouses(&conn)
}

#[tauri::command]
pub fn list_snapshot_reservations(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotReservationInput>, String> {
    let conn = lock(&state)?;
    posdb::list_snapshot_reservations(&conn)
}

#[tauri::command]
pub fn get_printer_status(app: AppHandle) -> runtime::PrinterRuntimeStatus {
    runtime::printer_status(&app)
}

#[tauri::command]
pub fn list_snapshot_loyalty_balances(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotLoyaltyBalanceInput>, String> {
    let conn = lock(&state)?;
    posdb::list_snapshot_loyalty_balances(&conn)
}

#[tauri::command]
pub fn list_snapshot_promotions(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotPromotionInput>, String> {
    let conn = lock(&state)?;
    posdb::list_snapshot_promotions(&conn)
}

#[tauri::command]
pub fn list_snapshot_kitchen_tickets(
    state: State<'_, DbState>,
) -> Result<Vec<posdb::SnapshotKitchenTicketInput>, String> {
    let conn = lock(&state)?;
    posdb::list_snapshot_kitchen_tickets(&conn)
}

#[tauri::command]
pub async fn list_cups_printers() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(crate::printing::list_cups_printers)
        .await
        .map_err(|error| error.to_string())?
}

/// Simpan konfigurasi printer ke Rust (printer.json, pola
/// device.json). Lebar kertas hanya 58/80mm — divalidasi
/// `device::save_printer`.
#[tauri::command]
pub fn set_printer_config(
    app: AppHandle,
    state: State<'_, PrinterState>,
    transport: PrinterTransportType,
    host: String,
    port: u16,
    paper_width_mm: u16,
) -> Result<runtime::PrinterRuntimeStatus, String> {
    let config = PrinterConfig {
        transport,
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

#[tauri::command]
pub fn list_server_receipt_print_jobs(
    state: State<'_, DbState>,
    status: Option<String>,
) -> Result<Vec<posdb::ServerReceiptPrintJob>, String> {
    let conn = lock(&state)?;
    posdb::list_server_receipt_print_jobs(&conn, status.as_deref())
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
pub fn retry_print_job(
    app: AppHandle,
    state: State<'_, DbState>,
    job_id: String,
) -> Result<posdb::PrintJob, String> {
    let job = {
        let conn = lock(&state)?;
        posdb::retry_failed_print_job(&conn, &job_id, &posdb::now_iso())?
    };
    runtime::kick_print(&app);
    Ok(job)
}

#[tauri::command]
pub fn retry_server_receipt_print_job(
    app: AppHandle,
    state: State<'_, DbState>,
    job_id: String,
) -> Result<posdb::ServerReceiptPrintJob, String> {
    let job = {
        let conn = lock(&state)?;
        posdb::retry_server_receipt_print_job(&conn, &job_id, &posdb::now_iso())?
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
