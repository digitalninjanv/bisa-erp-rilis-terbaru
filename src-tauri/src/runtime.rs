//! Glue runtime Tauri untuk mesin sinkron (Langkah 4, D7) dan
//! pekerja cetak ESC/POS (Langkah 5, D6).
//!
//! Logika murni hidup di `syncengine`/`posdb`/`printing`; modul
//! ini hanya menyambung dunia Tauri: state aplikasi, thread latar
//! drain + cetak (blocking — ureq + rusqlite + TCP memang
//! blocking; thread khusus agar webview tidak pernah menunggu
//! jaringan), dan pancaran event `pos-engine`/`pos-print` ke UI.
//!
//! Single-flight: satu putaran drain pada satu waktu
//! (`SyncState.running`); pemicu bersamaan (tombol UI, penjualan
//! baru, jadwal latar) digabung lewat `kick`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use argon2::password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

use crate::device::{self, DeviceConfig, PrinterConfig, PrinterTransportType, TokenStorage};
use crate::displaymap::{self, DisplayInput, DisplayPayload};
use crate::keychain::SecretStore;
use crate::posdb;
use crate::printing::{
    self, CupsPrintTransport, FileDevicePrintTransport, PrintEvent, PrintSummary, PrintTransport,
    TcpPrintTransport,
};
use crate::syncengine::{self, DrainSummary, EngineEvent, RefreshSummary};
use crate::transport::{self, DesktopCashier, DesktopCompany, DesktopLoginStep, HttpTransport};
use crate::updater::{self, InstallDecision, UpdateStatusView, UpdateTracker};

pub struct DbState(pub Mutex<Connection>);

pub struct DeviceState {
    pub dir: PathBuf,
    pub installation_id: String,
    pub config: Mutex<Option<DeviceConfig>>,
    /// Vault rahasia OS (keychain) — token TIDAK di berkas kecuali
    /// fallback terlihat-UI (Langkah 6, D5).
    pub store: Arc<dyn SecretStore>,
    pub storage: Mutex<TokenStorage>,
    pub pending_login: Mutex<Option<PendingDesktopLogin>>,
}

#[derive(Debug, Clone)]
pub struct PendingDesktopLogin {
    pub server_url: String,
    pub cookies: Vec<String>,
    pub cashier: Option<DesktopCashier>,
    pub companies: Vec<DesktopCompany>,
    /// PHC password verifier derived after successful server authentication;
    /// never the raw password, and retained only until terminal enrollment.
    password_hash: String,
    requires_two_factor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineCashierCredential {
    server_url: String,
    email: String,
    password_hash: String,
    cashier: DesktopCashier,
    company: DesktopCompany,
    authorized_at: i64,
    /// Password-only local login must not downgrade an account that was
    /// authenticated with a second factor online. Older credentials default
    /// to false so they require a fresh online authorization.
    #[serde(default)]
    offline_login_allowed: bool,
}

const OFFLINE_CASHIER_MAX_AGE_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "step", rename_all = "camelCase")]
pub enum CashierLoginView {
    TwoFactor { methods: Vec<String> },
    Authenticated {
        cashier: DesktopCashier,
        companies: Vec<DesktopCompany>,
        selected_company_id: Option<String>,
    },
    OfflineAuthenticated {
        cashier: DesktopCashier,
        company: DesktopCompany,
    },
}

pub struct SyncState {
    pub running: AtomicBool,
    pub kick: AtomicBool,
    pub auth_error: Mutex<Option<String>>,
}

impl SyncState {
    pub fn new() -> Self {
        SyncState {
            running: AtomicBool::new(false),
            kick: AtomicBool::new(false),
            auth_error: Mutex::new(None),
        }
    }
}

/// Status gabungan untuk panel pengaturan desktop — nilai token
/// TIDAK pernah termasuk di dalamnya; yang tampil: apakah token
/// ada, DI MANA ia tersimpan (keychain vs fallback berkas), dan
/// identitas terminal dari snapshot/pairing (Langkah 6).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRuntimeStatus {
    pub server_url: String,
    pub token_configured: bool,
    pub token_storage: TokenStorage,
    pub paired: bool,
    pub terminal_name: Option<String>,
    pub company_name: Option<String>,
    pub warehouse_name: Option<String>,
    pub terminal_id: Option<String>,
    pub cashier_id: Option<String>,
    pub cashier_name: Option<String>,
    pub offline_login_ready: bool,
    pub auth_failed: Option<String>,
    pub pending_count: i64,
    pub syncing: bool,
}

pub fn device_status(app: &AppHandle) -> DeviceRuntimeStatus {
    let device_state = app.state::<DeviceState>();
    let config = device_state
        .config
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or(None);
    let storage = device_state
        .storage
        .lock()
        .map(|guard| *guard)
        .unwrap_or(TokenStorage::None);
    let sync_state = app.state::<SyncState>();
    let (pending_count, identity) = app
        .state::<DbState>()
        .0
        .lock()
        .ok()
        .map(|conn| {
            let pending = posdb::count_outbox(&conn, "pending").unwrap_or(0);
            let identity = posdb::terminal_identity(&conn).ok().flatten().map(|view| {
                device::TerminalIdentityView {
                    terminal_name: view.name,
                    company_name: view.company_name,
                    warehouse_name: view.warehouse_name,
                }
            });
            (pending, identity)
        })
        .unwrap_or((0, None));
    let view = device::status(&config, storage, identity.as_ref());
    DeviceRuntimeStatus {
        server_url: view.server_url,
        token_configured: view.token_configured,
        token_storage: view.token_storage,
        paired: view.paired,
        terminal_name: view.terminal_name,
        company_name: view.company_name,
        warehouse_name: view.warehouse_name,
        terminal_id: view.terminal_id,
        cashier_id: view.cashier_id,
        cashier_name: view.cashier_name,
        offline_login_ready: config
            .as_ref()
            .is_some_and(|config| offline_credential_is_ready(&device_state, config)),
        auth_failed: sync_state
            .auth_error
            .lock()
            .ok()
            .and_then(|guard| guard.clone()),
        pending_count,
        syncing: sync_state.running.load(Ordering::SeqCst),
    }
}

/// Pasangkan terminal ini (Langkah 6): tukar kode sekali pakai di
/// server → token per-terminal masuk keychain OS (atau fallback
/// berkas terlihat-UI) → identitas terminal dicatat lokal agar UI
/// langsung menampilkan nama terminal sebelum snapshot pertama.
pub fn pair_device(app: &AppHandle, server_url: &str, code: &str) -> Result<DeviceRuntimeStatus, String> {
    let server_url = server_url.trim().trim_end_matches('/').to_string();
    if server_url.is_empty() {
        return Err("URL server ERP belum diisi.".to_string());
    }
    let code = code.trim().to_uppercase();
    if code.is_empty() {
        return Err("Kode pasangan belum diisi.".to_string());
    }
    let outcome = transport::pair_request(&server_url, &code).map_err(|error| error.to_string())?;
    let device_state = app.state::<DeviceState>();
    let config = DeviceConfig {
        server_url,
        device_token: outcome.token,
        terminal_id: Some(outcome.terminal.id.clone()),
        cashier_id: outcome.terminal.user_id.clone(),
        cashier_name: None,
        company_id: Some(outcome.terminal.company_id.clone()),
    };
    let storage = device::save_config(&device_state.dir, device_state.store.as_ref(), &config)?;
    {
        let mut guard = device_state
            .config
            .lock()
            .map_err(|_| "Kunci konfigurasi perangkat rusak (poisoned).".to_string())?;
        *guard = Some(config);
    }
    if let Ok(mut guard) = device_state.storage.lock() {
        *guard = storage;
    }
    if let Ok(conn) = app.state::<DbState>().0.lock() {
        let _ = posdb::store_terminal_identity(&conn, &outcome.terminal.id, &outcome.terminal.name);
    }
    // Pasangan baru mencabut blokir 401 lama dan memicu drain.
    set_auth_error(app, None);
    kick_sync(app);
    Ok(device_status(app))
}

fn login_view_and_store(
    app: &AppHandle,
    server_url: &str,
    step: DesktopLoginStep,
    password_hash: String,
    two_factor_verified: bool,
) -> Result<CashierLoginView, String> {
    let state = app.state::<DeviceState>();
    let (view, pending) = match step {
        DesktopLoginStep::TwoFactor { methods, cookies } => (
            CashierLoginView::TwoFactor { methods },
            PendingDesktopLogin {
                server_url: server_url.to_string(),
                cookies,
                cashier: None,
                companies: Vec::new(),
                password_hash: password_hash.clone(),
                requires_two_factor: true,
            },
        ),
        DesktopLoginStep::Authenticated {
            cashier,
            companies,
            selected_company_id,
            cookies,
        } => (
            CashierLoginView::Authenticated {
                cashier: cashier.clone(),
                companies: companies.clone(),
                selected_company_id,
            },
            PendingDesktopLogin {
                server_url: server_url.to_string(),
                cookies,
                cashier: Some(cashier),
                companies,
                password_hash,
                requires_two_factor: two_factor_verified,
            },
        ),
    };
    *state
        .pending_login
        .lock()
        .map_err(|_| "Keadaan login kasir rusak (poisoned).".to_string())? = Some(pending);
    Ok(view)
}

pub fn begin_cashier_login(
    app: &AppHandle,
    server_url: &str,
    email: &str,
    password: &str,
) -> Result<CashierLoginView, String> {
    let server_url = server_url.trim().trim_end_matches('/');
    if server_url.is_empty() {
        return Err("URL server ERP wajib diisi.".to_string());
    }
    let step = match transport::desktop_login_request(
        server_url,
        Some(email),
        Some(password),
        None,
        None,
        &[],
    ) {
        Ok(step) => step,
        Err(error @ (syncengine::TransportError::Network(_) | syncengine::TransportError::Http(500..=599, _))) => {
            return offline_cashier_login(app, server_url, email, password).ok_or_else(|| {
                format!("Server tidak terjangkau. Login offline tidak tersedia atau email/kata sandi tidak cocok dengan akses kasir terminal ini. ({error})")
            });
        }
        Err(error) => return Err(error.to_string()),
    };
    let password_hash = Argon2::default()
        .hash_password(password.as_bytes())
        .map_err(|error| format!("Verifikasi lokal tidak dapat disiapkan: {error}"))?
        .to_string();
    login_view_and_store(app, server_url, step, password_hash, false)
}

fn offline_credential_account(device_state: &DeviceState) -> String {
    format!("offline-cashier:{}", device_state.installation_id)
}

fn current_offline_credential(
    device_state: &DeviceState,
    config: &DeviceConfig,
) -> Option<OfflineCashierCredential> {
    let raw = device_state
        .store
        .get(crate::keychain::KEYRING_SERVICE, &offline_credential_account(device_state))
        .ok()??;
    let credential: OfflineCashierCredential = serde_json::from_str(&raw).ok()?;
    let now = now_unix();
    let age = now.saturating_sub(credential.authorized_at);
    let valid_age = credential.authorized_at <= now.saturating_add(60)
        && (0..=OFFLINE_CASHIER_MAX_AGE_SECS).contains(&age);
    let same_terminal_identity = config.company_id.as_deref() == Some(credential.company.id.as_str())
        && config.cashier_id.as_deref() == Some(credential.cashier.id.as_str())
        && config.server_url.trim_end_matches('/') == credential.server_url.trim_end_matches('/');
    (valid_age && same_terminal_identity && credential.offline_login_allowed).then_some(credential)
}

fn offline_credential_is_ready(device_state: &DeviceState, config: &DeviceConfig) -> bool {
    current_offline_credential(device_state, config).is_some()
}

fn offline_cashier_login(
    app: &AppHandle,
    server_url: &str,
    email: &str,
    password: &str,
) -> Option<CashierLoginView> {
    let device_state = app.state::<DeviceState>();
    let config = current_config(app)?;
    if config.server_url.trim_end_matches('/') != server_url.trim_end_matches('/') {
        return None;
    }
    let credential = current_offline_credential(&device_state, &config)?;
    if !credential.email.trim().eq_ignore_ascii_case(email.trim()) {
        return None;
    }
    let parsed = PasswordHash::new(&credential.password_hash).ok()?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .ok()?;
    Some(CashierLoginView::OfflineAuthenticated {
        cashier: credential.cashier,
        company: credential.company,
    })
}

pub fn continue_cashier_login(
    app: &AppHandle,
    two_factor_code: &str,
) -> Result<CashierLoginView, String> {
    let pending = app
        .state::<DeviceState>()
        .pending_login
        .lock()
        .map_err(|_| "Keadaan login kasir rusak (poisoned).".to_string())?
        .clone()
        .ok_or_else(|| "Proses masuk sudah berakhir. Masukkan email dan kata sandi lagi.".to_string())?;
    if pending.cashier.is_some() || pending.cookies.is_empty() {
        return Err("Tidak ada verifikasi dua langkah yang sedang menunggu.".to_string());
    }
    let step = transport::desktop_login_request(
        &pending.server_url,
        None,
        None,
        Some(two_factor_code),
        None,
        &pending.cookies,
    )
    .map_err(|error| error.to_string())?;
    let two_factor_verified = matches!(&step, DesktopLoginStep::Authenticated { .. });
    login_view_and_store(app, &pending.server_url, step, pending.password_hash, two_factor_verified)
}

pub fn enroll_cashier(
    app: &AppHandle,
    company_id: &str,
) -> Result<DeviceRuntimeStatus, String> {
    let device_state = app.state::<DeviceState>();
    let pending = device_state
        .pending_login
        .lock()
        .map_err(|_| "Keadaan login kasir rusak (poisoned).".to_string())?
        .clone()
        .ok_or_else(|| "Sesi masuk kasir sudah berakhir. Masuk kembali.".to_string())?;
    let cashier = pending
        .cashier
        .clone()
        .ok_or_else(|| "Verifikasi dua langkah harus diselesaikan terlebih dahulu.".to_string())?;
    if !pending.companies.iter().any(|company| company.id == company_id) {
        return Err("Perusahaan tidak tersedia untuk akun kasir ini.".to_string());
    }
    let company = pending
        .companies
        .iter()
        .find(|company| company.id == company_id)
        .cloned()
        .ok_or_else(|| "Perusahaan tidak tersedia untuk akun kasir ini.".to_string())?;

    let current = current_config(app);
    if let Some(config) = current.as_ref() {
        if config.company_id.as_deref().is_some_and(|current_company| current_company != company_id) {
            return Err("Terminal desktop hanya dapat terikat ke satu perusahaan. Hubungi supervisor untuk mengganti perusahaan.".to_string());
        }
        if config.cashier_id.as_deref().is_some_and(|current_cashier| current_cashier != cashier.id) {
            let db_state = app.state::<DbState>();
            let conn = db_state.0.lock().map_err(|_| "Kunci database lokal rusak (poisoned).".to_string())?;
            let has_pending = ["pending", "inflight", "held"]
                .iter()
                .any(|status| posdb::count_outbox(&conn, status).unwrap_or(0) > 0);
            let has_open_session = posdb::list_cash_sessions(&conn)
                .map(|sessions| sessions.iter().any(|session| session.status == "open"))
                .unwrap_or(true);
            if has_pending || has_open_session {
                return Err("Kasir berbeda tidak dapat masuk saat sesi kas masih terbuka atau transaksi belum tersinkron. Tutup sesi dan sinkronkan antrean terlebih dahulu.".to_string());
            }
        }
    }

    let prior_token = current.as_ref().and_then(|config| {
        (config.server_url == pending.server_url).then_some(config.device_token.as_str())
    });
    let enrollment = transport::desktop_enroll_request(
        &pending.server_url,
        &pending.cookies,
        prior_token,
        company_id,
        &device_state.installation_id,
    )
    .map_err(|error| error.to_string())?;
    let config = DeviceConfig {
        server_url: pending.server_url.clone(),
        device_token: enrollment.token,
        terminal_id: Some(enrollment.terminal.id.clone()),
        cashier_id: Some(enrollment.cashier.id.clone()),
        cashier_name: Some(enrollment.cashier.name.clone()),
        company_id: Some(enrollment.terminal.company_id.clone()),
    };
    let storage = device::save_config(&device_state.dir, device_state.store.as_ref(), &config)?;
    {
        let mut guard = device_state
            .config
            .lock()
            .map_err(|_| "Kunci konfigurasi perangkat rusak (poisoned).".to_string())?;
        *guard = Some(config);
    }
    if let Ok(mut guard) = device_state.storage.lock() {
        *guard = storage;
    }
    if let Ok(conn) = app.state::<DbState>().0.lock() {
        let _ = posdb::store_terminal_identity(
            &conn,
            &enrollment.terminal.id,
            &enrollment.terminal.name,
        );
    }
    let credential = OfflineCashierCredential {
        server_url: pending.server_url.clone(),
        email: cashier.email.trim().to_lowercase(),
        password_hash: pending.password_hash,
        cashier,
        company,
        authorized_at: now_unix(),
        offline_login_allowed: !pending.requires_two_factor,
    };
    if let Ok(serialized) = serde_json::to_string(&credential) {
        let _ = device_state.store.set(
            crate::keychain::KEYRING_SERVICE,
            &offline_credential_account(&device_state),
            &serialized,
        );
    }
    if let Ok(mut guard) = device_state.pending_login.lock() {
        *guard = None;
    }
    set_auth_error(app, None);
    // The sale screen can open immediately from the local snapshot; the
    // snapshot refresh and outbox drain happen on Rust's background path.
    let _ = run_snapshot_refresh(app);
    kick_sync(app);
    Ok(device_status(app))
}

/// Lepas pasangan terminal ini: token dihapus dari vault & berkas;
/// penjualan lokal yang belum tersinkron TIDAK ikut terhapus
/// (mereka tetap menunggu pasangan berikutnya).
pub fn unpair_device(app: &AppHandle) -> DeviceRuntimeStatus {
    let device_state = app.state::<DeviceState>();
    device::clear_config(&device_state.dir, device_state.store.as_ref());
    let _ = device_state.store.delete(
        crate::keychain::KEYRING_SERVICE,
        &offline_credential_account(&device_state),
    );
    if let Ok(mut guard) = device_state.config.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = device_state.storage.lock() {
        *guard = TokenStorage::None;
    }
    set_auth_error(app, None);
    device_status(app)
}

fn emit_engine(app: &AppHandle, event: EngineEvent) {
    let _ = app.emit("pos-engine", event);
}

fn set_auth_error(app: &AppHandle, message: Option<String>) {
    if let Ok(mut guard) = app.state::<SyncState>().auth_error.lock() {
        *guard = message;
    }
}

fn current_config(app: &AppHandle) -> Option<DeviceConfig> {
    app.state::<DeviceState>()
        .config
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

pub fn fetch_pos_transactions(
    app: &AppHandle,
    page: u32,
    query: &str,
    status: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
    sale_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let config = current_config(app).ok_or_else(|| "Terminal belum terdaftar.".to_string())?;
    match HttpTransport::new().get_pos_transactions(&config, page, query, status, from, to, sale_id) {
        Ok(data) => Ok(data),
        Err(crate::syncengine::TransportError::Unauthorized(message)) => {
            set_auth_error(app, Some(message.clone()));
            Err(message)
        }
        Err(error) => Err(error.to_string()),
    }
}

pub fn fetch_pos_cash_session_summary(
    app: &AppHandle,
    session_id: &str,
) -> Result<serde_json::Value, String> {
    let config = current_config(app).ok_or_else(|| "Terminal belum terdaftar.".to_string())?;
    match HttpTransport::new().get_pos_cash_session_summary(&config, session_id) {
        Ok(data) => Ok(data),
        Err(crate::syncengine::TransportError::Unauthorized(message)) => {
            set_auth_error(app, Some(message.clone()));
            Err(message)
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Tarik nota server hanya saat online, simpan byte ESC/POS ke antrean
/// terminal, lalu cetak melalui pekerja tunggal yang juga mengirim
/// struk lokal. Token dan byte nota tidak pernah diteruskan ke webview.
pub fn print_server_receipt(
    app: &AppHandle,
    sale_id: &str,
) -> Result<posdb::ServerReceiptPrintJob, String> {
    if sale_id.len() > 64 {
        return Err("ID transaksi terlalu panjang.".to_string());
    }
    let outcome = (|| -> Result<posdb::ServerReceiptPrintJob, String> {
        let device_config = current_config(app)
            .ok_or_else(|| "Terminal belum terdaftar.".to_string())?;
        let printer_config = current_printer_config(app)
            .ok_or_else(|| "Printer belum diatur.".to_string())?;
        let receipt = match HttpTransport::new().get_pos_receipt_bytes(
            &device_config,
            sale_id,
            printer_config.paper_width_mm,
        ) {
            Ok(bytes) => bytes,
            Err(crate::syncengine::TransportError::Unauthorized(message)) => {
                set_auth_error(app, Some(message.clone()));
                return Err(message);
            }
            Err(error) => return Err(error.to_string()),
        };
        let job = {
            let db_state = app.state::<DbState>();
            let conn = db_state
                .0
                .lock()
                .map_err(|_| "Kunci database lokal rusak (poisoned).".to_string())?;
            posdb::enqueue_server_receipt_print_job(&conn, sale_id, &receipt, &posdb::now_iso())?
        };
        Ok(job)
    })();

    if let Ok(conn) = app.state::<DbState>().0.lock() {
        let payload = serde_json::json!({
            "saleId": sale_id,
            "jobId": outcome.as_ref().ok().map(|job| job.id.as_str()),
            "queued": outcome.is_ok(),
            "error": outcome.as_ref().err(),
        });
        let _ = posdb::record_local_event(
            &conn,
            "server_receipt_print",
            &payload,
            &posdb::now_iso(),
        );
    }
    if outcome.is_ok() {
        kick_print(app);
    }
    outcome
}

pub fn post_pos_transaction(
    app: &AppHandle,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let config = current_config(app).ok_or_else(|| "Terminal belum terdaftar.".to_string())?;
    match HttpTransport::new().post_pos_transaction(&config, payload) {
        Ok(data) => Ok(data),
        Err(crate::syncengine::TransportError::Unauthorized(message)) => {
            set_auth_error(app, Some(message.clone()));
            Err(message)
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Satu putaran drain sekarang. Mengembalikan None bila perangkat
/// belum dikonfigurasi atau putaran lain sedang berjalan.
pub fn run_sync_pass(app: &AppHandle) -> Option<DrainSummary> {
    let sync_state = app.state::<SyncState>();
    if sync_state.running.swap(true, Ordering::SeqCst) {
        return None;
    }
    let result = (|| {
        let config = current_config(app)?;
        let db_state = app.state::<DbState>();
        let mut conn = db_state.0.lock().ok()?;
        let now = posdb::now_iso();
        let transport = HttpTransport::new();
        let handle = app.clone();
        let summary = syncengine::drain_outbox(&mut conn, &config, &transport, &now, &mut |event| {
            emit_engine(&handle, event);
        });
        if summary.auth_failed {
            set_auth_error(app, summary.error.clone());
        } else if summary.error.is_none() {
            set_auth_error(app, None);
        }
        Some(summary)
    })();
    sync_state.running.store(false, Ordering::SeqCst);
    result
}

/// Segarkan snapshot lewat mesin (kursor/delta diurus syncengine).
pub fn run_snapshot_refresh(app: &AppHandle) -> Result<RefreshSummary, String> {
    let config = current_config(app).ok_or_else(|| {
        "Terminal belum dipasangkan — pasangkan dengan kode dari admin web dulu.".to_string()
    })?;
    let db_state = app.state::<DbState>();
    let mut conn = db_state
        .0
        .lock()
        .map_err(|_| "Kunci database lokal rusak (poisoned).".to_string())?;
    let transport = HttpTransport::new();
    let handle = app.clone();
    let result = syncengine::refresh_snapshot(&mut conn, &config, &transport, &mut |event| {
        emit_engine(&handle, event);
    });
    match &result {
        Ok(_) => set_auth_error(app, None),
        Err(syncengine::TransportError::Unauthorized(message)) => {
            set_auth_error(app, Some(message.clone()));
        }
        _ => {}
    }
    result.map_err(|error| error.to_string())
}

/// Minta thread latar segera berdrain (tanpa menunggu jadwalnya).
pub fn kick_sync(app: &AppHandle) {
    app.state::<SyncState>().kick.store(true, Ordering::SeqCst);
}

/// Thread latar drain: jadwal adaptif — 30 dtk saat sehat,
/// backoff 5→120 dtk saat gagal, dan segera saat di-kick
/// (penjualan baru / konfigurasi berubah). Sesudah 401 thread
/// berhenti mencoba sampai ada kick dari konfigurasi baru.
pub fn spawn_background(app: AppHandle) {
    std::thread::spawn(move || {
        let mut backoff = Duration::from_secs(5);
        let mut last_attempt: Option<Instant> = None;
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let sync_state = app.state::<SyncState>();
            let kicked = sync_state.kick.swap(false, Ordering::SeqCst);
            let auth_blocked = sync_state
                .auth_error
                .lock()
                .map(|guard| guard.is_some())
                .unwrap_or(false);
            if auth_blocked && !kicked {
                continue;
            }
            let due = last_attempt.map(|at| at.elapsed() >= backoff).unwrap_or(true);
            if !kicked && !due {
                continue;
            }
            last_attempt = Some(Instant::now());
            match run_sync_pass(&app) {
                Some(summary) if summary.error.is_none() && !summary.auth_failed => {
                    backoff = Duration::from_secs(30);
                }
                Some(_) => {
                    backoff = (backoff * 2).min(Duration::from_secs(120));
                }
                None => {}
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Pekerja cetak ESC/POS (Langkah 5, D6)
// ---------------------------------------------------------------------------

/// Konfigurasi printer milik Rust (printer.json di direktori
/// data aplikasi) — pola yang sama dengan DeviceState.
pub struct PrinterState {
    pub dir: PathBuf,
    pub config: Mutex<Option<PrinterConfig>>,
}

pub struct PrintState {
    pub running: AtomicBool,
    pub kick: AtomicBool,
}

impl PrintState {
    pub fn new() -> Self {
        PrintState {
            running: AtomicBool::new(false),
            kick: AtomicBool::new(false),
        }
    }
}

/// Status printer untuk panel desktop: konfigurasi + kedalaman
/// antrean cetak. Tidak ada kredensial apa pun di dalamnya.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterRuntimeStatus {
    pub configured: bool,
    pub transport: PrinterTransportType,
    pub host: String,
    pub port: u16,
    pub paper_width_mm: u16,
    pub pending_count: i64,
    pub failed_count: i64,
    pub printing: bool,
}

pub fn printer_status(app: &AppHandle) -> PrinterRuntimeStatus {
    let printer_state = app.state::<PrinterState>();
    let config = printer_state
        .config
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or(None);
    let view = device::printer_status(&config);
    let (mut pending_count, mut failed_count) = (0i64, 0i64);
    if let Ok(conn) = app.state::<DbState>().0.lock() {
        if let Ok(jobs) = posdb::list_print_jobs(&conn, None) {
            for job in &jobs {
                match job.status.as_str() {
                    "pending" | "printing" => pending_count += 1,
                    "failed" => failed_count += 1,
                    _ => {}
                }
            }
        }
        if let Ok(jobs) = posdb::list_server_receipt_print_jobs(&conn, None) {
            for job in &jobs {
                match job.status.as_str() {
                    "pending" | "printing" => pending_count += 1,
                    "failed" => failed_count += 1,
                    _ => {}
                }
            }
        }
    }
    PrinterRuntimeStatus {
        configured: view.configured,
        transport: view.transport,
        host: view.host.unwrap_or_default(),
        port: view.port.unwrap_or(9100),
        paper_width_mm: view.paper_width_mm.unwrap_or(80),
        pending_count,
        failed_count,
        printing: app.state::<PrintState>().running.load(Ordering::SeqCst),
    }
}

fn emit_print(app: &AppHandle, event: PrintEvent) {
    let _ = app.emit("pos-print", event);
}

pub fn current_printer_config(app: &AppHandle) -> Option<PrinterConfig> {
    app.state::<PrinterState>()
        .config
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn configured_print_transport(config: &PrinterConfig) -> Box<dyn PrintTransport> {
    match config.transport {
        PrinterTransportType::Tcp => Box::new(TcpPrintTransport::new(config.host.clone(), config.port)),
        PrinterTransportType::Cups => Box::new(CupsPrintTransport::new(config.host.clone())),
        PrinterTransportType::Device => Box::new(FileDevicePrintTransport::new(config.host.clone().into())),
    }
}

/// Satu putaran antrean cetak sekarang. Mengembalikan None bila
/// printer belum diatur atau putaran lain sedang berjalan.
/// Kegagalan printer tercatat per tugas (status failed) — tidak
/// pernah melempar galat yang bisa mengganggu penjualan.
pub fn run_print_pass(app: &AppHandle) -> Option<PrintSummary> {
    let print_state = app.state::<PrintState>();
    if print_state.running.swap(true, Ordering::SeqCst) {
        return None;
    }
    let result = (|| {
        let config = current_printer_config(app)?;
        let db_state = app.state::<DbState>();
        let mut conn = db_state.0.lock().ok()?;
        let now = posdb::now_iso();
        let transport = configured_print_transport(&config);
        let handle = app.clone();
        Some(printing::run_print_pass(
            &mut conn,
            transport.as_ref(),
            config.columns(),
            &now,
            &mut |event| emit_print(&handle, event),
        ))
    })();
    print_state.running.store(false, Ordering::SeqCst);
    result
}

/// Minta pekerja cetak segera berjalan (penjualan baru, cetak
/// ulang, konfigurasi printer berubah).
pub fn kick_print(app: &AppHandle) {
    app.state::<PrintState>().kick.store(true, Ordering::SeqCst);
}

/// Tes cetak langsung (tanpa antrean): membuktikan jangkauan TCP
/// + kertas dari panel pengaturan.
pub fn send_test_print(app: &AppHandle) -> Result<(), String> {
    let config = current_printer_config(app)
        .ok_or_else(|| "Printer belum diatur — isi host printer dulu.".to_string())?;
    let db_state = app.state::<DbState>();
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Kunci database lokal rusak (poisoned).".to_string())?;
    let context = printing::load_receipt_context(&conn)
        .unwrap_or_else(|_| printing::ReceiptContext::fallback());
    let bytes = printing::build_test_bytes(
        &context.settings,
        config.columns(),
        &posdb::now_iso(),
    );
    configured_print_transport(&config).send(&bytes)
}

/// Buka laci tanpa penjualan (command terpisah beralasan):
/// alasan wajib, percobaan selalu dicatat sebagai event lokal
/// `drawer_open` — berhasil maupun gagal — sebelum hasilnya
/// dikembalikan ke UI.
pub fn open_drawer(app: &AppHandle, reason: &str) -> Result<(), String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("Alasan membuka laci wajib diisi.".to_string());
    }
    let attempted = (|| -> Result<(), String> {
        let config = current_printer_config(app)
            .ok_or_else(|| "Printer belum diatur — isi host printer dulu.".to_string())?;
        let mut bytes = vec![0x1B, 0x40];
        bytes.extend_from_slice(&printing::drawer_kick_bytes());
        configured_print_transport(&config).send(&bytes)
    })();
    if let Ok(conn) = app.state::<DbState>().0.lock() {
        let payload = serde_json::json!({
            "reason": reason,
            "ok": attempted.is_ok(),
            "error": attempted.as_ref().err(),
        });
        let _ = posdb::record_local_event(
            &conn,
            "drawer_open",
            &payload,
            &posdb::now_iso(),
        );
    }
    attempted
}

/// Thread latar cetak: segera saat di-kick (penjualan baru/cetak
/// ulang), dan pemeriksaan berkala 15 dtk untuk tugas `pending`
/// yang tertinggal (mis. printer baru menyala sesudah gagal) —
/// pola yang sama dengan thread drain sinkron.
pub fn spawn_print_background(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_periodic: Option<Instant> = None;
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let print_state = app.state::<PrintState>();
            let kicked = print_state.kick.swap(false, Ordering::SeqCst);
            let periodic_due = last_periodic
                .map(|at| at.elapsed() >= Duration::from_secs(15))
                .unwrap_or(true);
            if !kicked && !periodic_due {
                continue;
            }
            if periodic_due {
                last_periodic = Some(Instant::now());
            }
            let _ = run_print_pass(&app);
        }
    });
}

// ---------------------------------------------------------------------------
// Updater aplikasi (Langkah 7, D4) — glue plugin resmi Tauri.
//
// SEMUA keputusan hidup di modul murni `updater` (URL runtime,
// jadwal periksa, gerbang sesi kas); di sini hanya: membangun
// Updater plugin dengan endpoint + header token perangkat,
// menjalankan check/download async plugin dari thread blocking,
// menyimpan paket terunduh, dan memasang pada saat keputusan
// mengizinkan. Token tidak pernah masuk webview — sama seperti
// jalur sinkron, ia hanya menjadi header dari Rust.
// ---------------------------------------------------------------------------

/// Paket pembaruan yang sudah terunduh utuh & terverifikasi plugin,
/// menunggu gerbang pemasangan (tutup sesi / perintah pengguna).
struct PendingInstall {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

pub struct UpdateState {
    pub tracker: Mutex<UpdateTracker>,
    pending: Mutex<Option<PendingInstall>>,
    checking: AtomicBool,
}

impl UpdateState {
    pub fn new(current_version: &str) -> Self {
        UpdateState {
            tracker: Mutex::new(UpdateTracker::new(current_version)),
            pending: Mutex::new(None),
            checking: AtomicBool::new(false),
        }
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

pub fn update_status(app: &AppHandle) -> UpdateStatusView {
    app.state::<UpdateState>()
        .tracker
        .lock()
        .map(|tracker| tracker.view())
        .unwrap_or(UpdateStatusView {
            phase: "failed".to_string(),
            current_version: String::new(),
            available_version: None,
            mandatory: false,
            notes: None,
            last_checked_at: None,
            message: Some("Kunci keadaan updater rusak (poisoned).".to_string()),
        })
}

fn emit_update(app: &AppHandle) {
    let _ = app.emit("pos-update", update_status(app));
}

fn with_tracker<T>(app: &AppHandle, f: impl FnOnce(&mut UpdateTracker) -> T) -> Option<T> {
    app.state::<UpdateState>()
        .tracker
        .lock()
        .ok()
        .map(|mut tracker| f(&mut tracker))
}

/// Apakah ada sesi kas lokal yang masih terbuka. Bila database
/// tidak terbaca, jawabannya "terbuka" — pemasangan otomatis tidak
/// boleh berjudi dengan sesi yang tidak terlihat.
fn any_open_session(app: &AppHandle) -> bool {
    let db_state = app.state::<DbState>();
    let Ok(conn) = db_state.0.lock() else {
        return true;
    };
    match posdb::has_open_cash_session(&conn) {
        Ok(is_open) => is_open,
        Err(_) => true,
    }
}

/// Bangun Updater plugin untuk terminal ini: endpoint dinamis
/// server (keputusan per terminal) + header Authorization token
/// perangkat. Pubkey verifikasi datang dari konfigurasi plugin
/// (tauri.conf.json) — penandatanganan tidak bisa dimatikan.
fn build_updater(
    app: &AppHandle,
    config: &DeviceConfig,
) -> Result<tauri_plugin_updater::Updater, String> {
    let (target, arch) = updater::platform_target();
    let current = app.package_info().version.to_string();
    let url = updater::build_check_url(&config.server_url, target, arch, &current);
    let url = tauri::Url::parse(&url).map_err(|error| error.to_string())?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|error| error.to_string())?
        .header("Authorization", format!("Bearer {}", config.device_token))
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())
}

/// Satu siklus pembaruan: periksa (bila jatuh tempo / dipaksa) →
/// unduh di latar → pasang bila gerbang sesi mengizinkan.
/// Dipanggil thread latar (berkala) dan command UI (paksa).
/// Kegagalan jaringan/server berakhir sebagai fase `failed` di
/// status — tidak pernah melempar ke penjualan.
pub fn run_update_check(app: &AppHandle, force: bool) -> UpdateStatusView {
    let state = app.state::<UpdateState>();
    if state.checking.swap(true, Ordering::SeqCst) {
        return update_status(app);
    }
    let result = update_check_inner(app, force);
    state.checking.store(false, Ordering::SeqCst);
    result
}

fn update_check_inner(app: &AppHandle, force: bool) -> UpdateStatusView {
    let Some(config) = current_config(app) else {
        return update_status(app);
    };
    let due = with_tracker(app, |tracker| tracker.should_check(now_unix(), force))
        .unwrap_or(false);
    if !due {
        return update_status(app);
    }
    with_tracker(app, |tracker| tracker.begin_check());
    emit_update(app);
    let now_iso = posdb::now_iso();
    let now = now_unix();
    let checked = (|| -> Result<Option<tauri_plugin_updater::Update>, String> {
        let updater = build_updater(app, &config)?;
        tauri::async_runtime::block_on(async move { updater.check().await })
            .map_err(|error| error.to_string())
    })();
    let update = match checked {
        Ok(Some(update)) => update,
        Ok(None) => {
            if let Ok(mut pending) = app.state::<UpdateState>().pending.lock() {
                *pending = None;
            }
            with_tracker(app, |tracker| tracker.on_up_to_date(now, &now_iso));
            emit_update(app);
            return update_status(app);
        }
        Err(message) => {
            with_tracker(app, |tracker| tracker.on_check_failed(&message, now, &now_iso));
            emit_update(app);
            return update_status(app);
        }
    };
    // Tawaran plugin selalu lebih baru dari versi berjalan menurut
    // pembandingnya; keputusan modul murni menegaskan lagi +
    // membaca bendera wajib dari dokumen server (raw_json).
    let offer = updater::UpdateOffer {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        pub_date: String::new(),
        url: update.download_url.to_string(),
        signature: update.signature.clone(),
        mandatory: update.raw_json["mandatory"].as_bool().unwrap_or(false),
    };
    if updater::decide_offer(&app.package_info().version.to_string(), &offer)
        == updater::OfferDecision::NotNewer
    {
        with_tracker(app, |tracker| tracker.on_up_to_date(now, &now_iso));
        emit_update(app);
        return update_status(app);
    }
    with_tracker(app, |tracker| tracker.on_available(&offer, now, &now_iso));
    emit_update(app);
    // Unduh di latar selama shift — pemasangan urusan gerbang sesi.
    with_tracker(app, |tracker| tracker.on_downloading());
    emit_update(app);
    let downloaded =
        tauri::async_runtime::block_on(async { update.download(|_, _| {}, || {}).await });
    match downloaded {
        Ok(bytes) => {
            if let Ok(mut pending) = app.state::<UpdateState>().pending.lock() {
                *pending = Some(PendingInstall { update, bytes });
            }
            let session_open = any_open_session(app);
            with_tracker(app, |tracker| tracker.on_downloaded(session_open));
            emit_update(app);
            maybe_install(app, false);
        }
        Err(error) => {
            let message = error.to_string();
            with_tracker(app, |tracker| tracker.on_download_failed(&message));
            emit_update(app);
        }
    }
    update_status(app)
}

/// Pasang paket terunduh bila keputusan modul murni mengizinkan.
/// `user_requested` = perintah eksplisit dari UI (jalan keluar sah
/// dari gerbang sesi). Mengembalikan true bila pemasangan dimulai
/// (proses biasanya berakhir/dimulai ulang oleh pemasang).
fn maybe_install(app: &AppHandle, user_requested: bool) -> bool {
    let session_open = any_open_session(app);
    let decision = with_tracker(app, |tracker| {
        tracker.install_decision(session_open, user_requested)
    })
    .unwrap_or(InstallDecision::NothingDownloaded);
    if decision != InstallDecision::InstallNow {
        return false;
    }
    with_tracker(app, |tracker| tracker.on_installing());
    emit_update(app);
    match install_pending(app) {
        Ok(()) => true,
        Err(message) => {
            with_tracker(app, |tracker| tracker.on_install_failed(&message));
            emit_update(app);
            false
        }
    }
}

fn install_pending(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let guard = state
        .pending
        .lock()
        .map_err(|_| "Kunci paket pembaruan rusak (poisoned).".to_string())?;
    let Some(pending) = guard.as_ref() else {
        return Err("Belum ada paket pembaruan terunduh.".to_string());
    };
    // install() memverifikasi byte terhadap tanda tangan tawaran
    // sebelum memasang; byte diklon sekali di sini agar tanda
    // tangan fungsi plugin (ambil-nilai / AsRef) sama-sama puas.
    pending
        .update
        .install(pending.bytes.clone())
        .map_err(|error| error.to_string())?;
    // Windows: install() menelurkan pemasang lalu keluar dari
    // proses sendiri. Platform lain: mulai ulang agar versi baru
    // yang berjalan.
    #[cfg(target_os = "windows")]
    return Ok(());
    #[cfg(not(target_os = "windows"))]
    app.restart();
}

/// Perintah eksplisit pengguna dari UI: paksa periksa bila belum
/// ada paket, lalu minta pasang sekarang.
pub fn run_update_install(app: &AppHandle) -> UpdateStatusView {
    let has_pending = app
        .state::<UpdateState>()
        .pending
        .lock()
        .map(|pending| pending.is_some())
        .unwrap_or(false);
    if !has_pending {
        let status = run_update_check(app, true);
        if app
            .state::<UpdateState>()
            .pending
            .lock()
            .map(|pending| pending.is_none())
            .unwrap_or(true)
        {
            return status;
        }
    }
    maybe_install(app, true);
    update_status(app)
}

/// Thread latar updater: periksa saat aplikasi mulai lalu berkala
/// (jadwal di tracker), dan — ini gerbang tutup-shift-nya —
/// pasang paket yang menunggu begitu sesi kas terakhir tertutup.
/// Pemeriksaan hanya berjalan sesudah terminal terpasang
/// (endpoint keputusan server butuh token perangkat).
pub fn spawn_update_background(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        if current_config(&app).is_none() {
            continue;
        }
        let downloaded_waiting = update_status(&app).phase == "waitingSession";
        if downloaded_waiting && !any_open_session(&app) {
            with_tracker(&app, |tracker| tracker.on_session_closed());
            emit_update(&app);
            maybe_install(&app, false);
            continue;
        }
        let due = with_tracker(&app, |tracker| tracker.should_check(now_unix(), false))
            .unwrap_or(false);
        if due {
            run_update_check(&app, false);
        }
    });
}

// ---------------------------------------------------------------------------
// Layar pelanggan (Langkah 8) — jendela kedua `display`
// ---------------------------------------------------------------------------

pub const DISPLAY_WINDOW_LABEL: &str = "display";
pub const DISPLAY_EVENT: &str = "pos-display";

/// Keadaan tampil terakhir layar pelanggan. Jendela utama adalah
/// satu-satunya penulis (lewat command `update_customer_display`);
/// jendela display menarik keadaan ini saat dibuka
/// (`get_customer_display`) lalu mengikuti event `pos-display`.
/// Jendela display sendiri TIDAK memegang token / HTTP / DB (D7)
/// — capability-nya hanya `core:default` + listen event ini.
pub struct DisplayState {
    pub payload: Mutex<DisplayPayload>,
}

impl DisplayState {
    pub fn new() -> Self {
        DisplayState {
            payload: Mutex::new(DisplayPayload::idle(None)),
        }
    }
}

/// Petakan + simpan + pancarkan keadaan keranjang terbaru.
/// Pancaran ditujukan hanya ke jendela `display` bila ia terbuka;
/// tanpa layar kedua, keadaan tetap tersimpan dan tidak ada
/// pekerjaan lain yang terjadi (fitur diam).
pub fn update_customer_display(app: &AppHandle, input: DisplayInput) -> DisplayPayload {
    let payload = displaymap::map_display(&input);
    if let Ok(mut guard) = app.state::<DisplayState>().payload.lock() {
        *guard = payload.clone();
    }
    if app.get_webview_window(DISPLAY_WINDOW_LABEL).is_some() {
        let _ = app.emit_to(DISPLAY_WINDOW_LABEL, DISPLAY_EVENT, payload.clone());
    }
    payload
}

pub fn customer_display(app: &AppHandle) -> DisplayPayload {
    app.state::<DisplayState>()
        .payload
        .lock()
        .map(|payload| payload.clone())
        .unwrap_or_else(|_| DisplayPayload::idle(None))
}

pub fn customer_display_open(app: &AppHandle) -> bool {
    app.get_webview_window(DISPLAY_WINDOW_LABEL).is_some()
}

/// Buka jendela layar pelanggan. Monitor dipilih oleh fungsi
/// murni `displaymap::choose_monitor_index`: monitor non-utama
/// pertama (layar kedua) → jendela fullscreen tanpa dekorasi di
/// monitor itu; selain itu fallback jendela biasa 1024×640.
/// Mengembalikan `true` bila jendela baru dibuat, `false` bila
/// sudah terbuka (difokuskan saja).
pub fn open_customer_display(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        let _ = window.set_focus();
        return Ok(false);
    }

    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let is_primary: Vec<bool> = monitors
        .iter()
        .map(|monitor| match &primary {
            Some(main) => {
                monitor.position() == main.position() && monitor.size() == main.size()
            }
            None => false,
        })
        .collect();
    let chosen = displaymap::choose_monitor_index(&is_primary)
        .and_then(|index| monitors.get(index).map(|monitor| (monitor, is_primary[index])));

    let mut builder = WebviewWindowBuilder::new(
        app,
        DISPLAY_WINDOW_LABEL,
        WebviewUrl::App("display/index.html".into()),
    )
    .title("Bisa POS — Layar Pelanggan");

    match chosen {
        Some((monitor, false)) => {
            // Layar kedua: penuhi monitor itu (posisi & ukuran
            // logis = fisik / faktor skala monitor).
            let scale = monitor.scale_factor();
            let position = monitor.position();
            let size = monitor.size();
            builder = builder
                .decorations(false)
                .position(position.x as f64 / scale, position.y as f64 / scale)
                .inner_size(size.width as f64 / scale, size.height as f64 / scale)
                .fullscreen(true);
        }
        _ => {
            builder = builder.inner_size(1024.0, 640.0);
        }
    }

    builder.build().map_err(|error| error.to_string())?;
    // Jendela baru juga menarik keadaan lewat get_customer_display
    // saat mount; pancaran ini menutup celah balapan mount.
    let _ = app.emit_to(
        DISPLAY_WINDOW_LABEL,
        DISPLAY_EVENT,
        customer_display(app),
    );
    Ok(true)
}

pub fn close_customer_display(app: &AppHandle) -> bool {
    match app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        Some(window) => window.close().is_ok(),
        None => false,
    }
}
