//! Konfigurasi perangkat POS — DIMILIKI RUST (Langkah 4; keychain
//! OS Langkah 6 menutup D5).
//!
//! Token perangkat adalah milik Rust dan tidak pernah menyeberang
//! ke webview: JS hanya menyerahkan KODE PASANGAN satu kali
//! (command pair), Rust menukarnya menjadi token lewat
//! POST /api/pos/pair, dan command status hanya mengembalikan
//! `token_configured: bool` + JENIS penyimpanannya.
//!
//! Penyimpanan token (D5, keputusan Langkah 6):
//! - UTAMA: keychain OS lewat crate `keyring` (Windows Credential
//!   Manager / Linux Secret Service) — lihat `keychain.rs`;
//! - MIGRASI: token warisan di `device.json` (Langkah 1–5, berkas
//!   0600) dipindah ke keychain saat muat pertama, lalu berkas
//!   ditulis ulang TANPA nilai token;
//! - FALLBACK TERTULIS: bila vault OS tidak tersedia (mis. sesi
//!   Linux tanpa secret-service), token kembali ke berkas 0600 dan
//!   statusnya TERLIHAT di UI (`tokenStorage: "file"` + peringatan)
//!   — terminal tetap bisa dipasangkan & beroperasi, tidak buntu.
//!
//! `device.json` kini hanya menyimpan URL server (+ token semata
//! dalam mode fallback). Semua HTTP ke `/api/pos/*` berangkat dari
//! Rust (syncengine + transport).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::keychain::{SecretStore, KEYRING_ACCOUNT, KEYRING_SERVICE};

pub const DEVICE_CONFIG_FILE: &str = "device.json";

/// Konfigurasi efektif di memori (token dari vault atau fallback).
#[derive(Debug, Clone)]
pub struct DeviceConfig {
    pub server_url: String,
    pub device_token: String,
}

/// Bentuk `device.json` di disk. `device_token` hanya terisi pada
/// mode fallback berkas; pada mode keychain selalu None.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceFile {
    server_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_token: Option<String>,
}

/// Di mana token perangkat saat ini tersimpan — tampil di UI agar
/// fallback tidak pernah diam-diam.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TokenStorage {
    Keychain,
    File,
    None,
}

/// Identitas terminal untuk status UI (dari snapshot terakhir —
/// diisi pemanggil dari `posdb`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalIdentityView {
    pub terminal_name: String,
    pub company_name: String,
    pub warehouse_name: Option<String>,
}

/// Pandangan aman konfigurasi untuk UI — TANPA nilai token, selamanya.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatusView {
    pub server_url: String,
    pub token_configured: bool,
    pub token_storage: TokenStorage,
    pub paired: bool,
    pub terminal_name: Option<String>,
    pub company_name: Option<String>,
    pub warehouse_name: Option<String>,
}

pub fn config_path(dir: &Path) -> PathBuf {
    dir.join(DEVICE_CONFIG_FILE)
}

fn read_device_file(dir: &Path) -> Option<DeviceFile> {
    let text = std::fs::read_to_string(config_path(dir)).ok()?;
    let parsed = serde_json::from_str::<DeviceFile>(&text).ok()?;
    if parsed.server_url.trim().is_empty() {
        return None;
    }
    Some(parsed)
}

fn write_device_file(dir: &Path, file: &DeviceFile) -> Result<(), String> {
    let text = serde_json::to_string_pretty(file).map_err(|error| error.to_string())?;
    write_atomic(dir, DEVICE_CONFIG_FILE, &text)
}

/// Muat konfigurasi efektif: baca URL dari berkas, token dari
/// keychain; migrasikan token warisan berkas → keychain bila vault
/// sehat. Mengembalikan konfigurasi + jenis penyimpanan tokennya.
pub fn load_config(
    dir: &Path,
    store: &dyn SecretStore,
) -> (Option<DeviceConfig>, TokenStorage) {
    let Some(file) = read_device_file(dir) else {
        return (None, TokenStorage::None);
    };
    let legacy_token = file
        .device_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string);
    match store.get(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(Some(vault_token)) if !vault_token.trim().is_empty() => {
            // Token sudah di vault. Bersihkan sisa nilai di berkas.
            if legacy_token.is_some() {
                let _ = write_device_file(
                    dir,
                    &DeviceFile {
                        server_url: file.server_url.clone(),
                        device_token: None,
                    },
                );
            }
            (
                Some(DeviceConfig {
                    server_url: file.server_url,
                    device_token: vault_token,
                }),
                TokenStorage::Keychain,
            )
        }
        Ok(_) => match legacy_token {
            // Vault sehat tapi kosong + ada token warisan → migrasi.
            Some(token) => match store.set(KEYRING_SERVICE, KEYRING_ACCOUNT, &token) {
                Ok(()) => {
                    let _ = write_device_file(
                        dir,
                        &DeviceFile {
                            server_url: file.server_url.clone(),
                            device_token: None,
                        },
                    );
                    (
                        Some(DeviceConfig {
                            server_url: file.server_url,
                            device_token: token,
                        }),
                        TokenStorage::Keychain,
                    )
                }
                Err(_) => (
                    Some(DeviceConfig {
                        server_url: file.server_url,
                        device_token: token,
                    }),
                    TokenStorage::File,
                ),
            },
            None => (None, TokenStorage::None),
        },
        // Vault tidak tersedia → fallback berkas 0600 (terlihat UI).
        Err(_) => match legacy_token {
            Some(token) => (
                Some(DeviceConfig {
                    server_url: file.server_url,
                    device_token: token,
                }),
                TokenStorage::File,
            ),
            None => (None, TokenStorage::None),
        },
    }
}

/// Simpan konfigurasi (sesudah pairing): token diutamakan masuk
/// keychain; bila vault gagal, jatuh ke berkas 0600 dan jenis
/// penyimpanannya dikembalikan agar UI menampilkannya.
pub fn save_config(
    dir: &Path,
    store: &dyn SecretStore,
    config: &DeviceConfig,
) -> Result<TokenStorage, String> {
    match store.set(KEYRING_SERVICE, KEYRING_ACCOUNT, &config.device_token) {
        Ok(()) => {
            write_device_file(
                dir,
                &DeviceFile {
                    server_url: config.server_url.clone(),
                    device_token: None,
                },
            )?;
            Ok(TokenStorage::Keychain)
        }
        Err(_) => {
            write_device_file(
                dir,
                &DeviceFile {
                    server_url: config.server_url.clone(),
                    device_token: Some(config.device_token.clone()),
                },
            )?;
            Ok(TokenStorage::File)
        }
    }
}

/// Lepas pasangan (unpair): hapus entri vault (best-effort) + berkas.
pub fn clear_config(dir: &Path, store: &dyn SecretStore) {
    let _ = store.delete(KEYRING_SERVICE, KEYRING_ACCOUNT);
    let _ = std::fs::remove_file(config_path(dir));
}

/// Tulis berkas konfigurasi secara atomik (berkas sementara lalu
/// rename) dengan izin 0600 di Unix — isi konfigurasi perangkat
/// tidak boleh terbaca pengguna lain di mesin kasir bersama.
fn write_atomic(dir: &Path, file_name: &str, text: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let tmp_path = dir.join(format!("{file_name}.tmp"));
    std::fs::write(&tmp_path, text).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    std::fs::rename(&tmp_path, dir.join(file_name)).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn status(
    config: &Option<DeviceConfig>,
    storage: TokenStorage,
    identity: Option<&TerminalIdentityView>,
) -> DeviceStatusView {
    DeviceStatusView {
        server_url: config
            .as_ref()
            .map(|config| config.server_url.clone())
            .unwrap_or_default(),
        token_configured: config.is_some(),
        token_storage: if config.is_some() {
            storage
        } else {
            TokenStorage::None
        },
        paired: config.is_some(),
        terminal_name: identity.map(|view| view.terminal_name.clone()),
        company_name: identity.map(|view| view.company_name.clone()),
        warehouse_name: identity.and_then(|view| view.warehouse_name.clone()),
    }
}

// ---------------------------------------------------------------------------
// Konfigurasi printer ESC/POS (Langkah 5, D6) — berkas terpisah
// `printer.json` milik Rust dengan pola tulis yang sama. Printer
// diatur per TERMINAL (bukan per perusahaan): host printer jaringan
// + lebar kertas terminal ini menang atas kertas nota perusahaan
// pada snapshot untuk keperluan kolom byte ESC/POS.
// ---------------------------------------------------------------------------

pub const PRINTER_CONFIG_FILE: &str = "printer.json";
pub const DEFAULT_PRINTER_PORT: u16 = 9100;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterConfig {
    pub host: String,
    pub port: u16,
    /// Lebar kertas terminal: 58 atau 80 (mm).
    pub paper_width_mm: u16,
}

impl PrinterConfig {
    /// Jumlah kolom Font A ESC/POS untuk lebar kertas ini.
    pub fn columns(&self) -> usize {
        if self.paper_width_mm <= 58 {
            32
        } else {
            48
        }
    }
}

/// Pandangan konfigurasi printer untuk UI (bukan rahasia).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatusView {
    pub configured: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub paper_width_mm: Option<u16>,
}

pub fn printer_path(dir: &Path) -> PathBuf {
    dir.join(PRINTER_CONFIG_FILE)
}

fn valid_printer(config: &PrinterConfig) -> bool {
    !config.host.trim().is_empty()
        && config.port > 0
        && (config.paper_width_mm == 58 || config.paper_width_mm == 80)
}

pub fn load_printer(dir: &Path) -> Option<PrinterConfig> {
    let text = std::fs::read_to_string(printer_path(dir)).ok()?;
    let parsed = serde_json::from_str::<PrinterConfig>(&text).ok()?;
    if !valid_printer(&parsed) {
        return None;
    }
    Some(parsed)
}

pub fn save_printer(dir: &Path, config: &PrinterConfig) -> Result<(), String> {
    if config.host.trim().is_empty() {
        return Err("Host printer belum diisi.".to_string());
    }
    if config.port == 0 {
        return Err("Port printer tidak valid.".to_string());
    }
    if config.paper_width_mm != 58 && config.paper_width_mm != 80 {
        return Err("Lebar kertas printer harus 58 atau 80 mm.".to_string());
    }
    let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    write_atomic(dir, PRINTER_CONFIG_FILE, &text)
}

pub fn printer_status(config: &Option<PrinterConfig>) -> PrinterStatusView {
    match config {
        Some(config) => PrinterStatusView {
            configured: true,
            host: Some(config.host.clone()),
            port: Some(config.port),
            paper_width_mm: Some(config.paper_width_mm),
        },
        None => PrinterStatusView {
            configured: false,
            host: None,
            port: None,
            paper_width_mm: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keychain::MemoryStore;

    fn sample() -> DeviceConfig {
        DeviceConfig {
            server_url: "http://localhost:3000".to_string(),
            device_token: "token-rahasia-123456".to_string(),
        }
    }

    fn file_text(dir: &Path) -> String {
        std::fs::read_to_string(config_path(dir)).expect("device.json terbaca")
    }

    #[test]
    fn save_goes_to_keychain_and_file_holds_no_token() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = MemoryStore::new();
        let storage = save_config(dir.path(), &store, &sample()).expect("save");
        assert_eq!(storage, TokenStorage::Keychain);
        assert!(
            !file_text(dir.path()).contains("token-rahasia"),
            "berkas tidak boleh memuat token pada mode keychain"
        );
        let (loaded, loaded_storage) = load_config(dir.path(), &store);
        let loaded = loaded.expect("konfigurasi termuat");
        assert_eq!(loaded.device_token, "token-rahasia-123456");
        assert_eq!(loaded_storage, TokenStorage::Keychain);
        let view = status(&Some(loaded), loaded_storage, None);
        assert!(view.token_configured && view.paired);
        let rendered = serde_json::to_string(&view).expect("render status");
        assert!(
            !rendered.contains("token-rahasia"),
            "status UI tidak boleh memuat nilai token: {rendered}"
        );
        assert!(rendered.contains("\"tokenStorage\":\"keychain\""), "{rendered}");
    }

    #[test]
    fn legacy_file_token_migrates_to_keychain_on_load() {
        let dir = tempfile::tempdir().expect("tempdir");
        // Berkas warisan Langkah 1–5: token di dalam device.json.
        std::fs::write(
            config_path(dir.path()),
            r#"{"serverUrl":"http://localhost:3000","deviceToken":"token-warisan-999"}"#,
        )
        .expect("tulis berkas warisan");
        let store = MemoryStore::new();
        let (loaded, storage) = load_config(dir.path(), &store);
        assert_eq!(storage, TokenStorage::Keychain);
        assert_eq!(
            loaded.expect("termigrasi").device_token,
            "token-warisan-999"
        );
        assert!(
            store
                .get(KEYRING_SERVICE, KEYRING_ACCOUNT)
                .unwrap()
                .is_some(),
            "token kini di vault"
        );
        assert!(
            !file_text(dir.path()).contains("token-warisan"),
            "berkas dibersihkan dari nilai token sesudah migrasi"
        );
    }

    #[test]
    fn vault_down_falls_back_to_file_with_visible_status() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = MemoryStore::new();
        store.set_failing(true);
        // Simpan saat vault mati → fallback berkas, status TERLIHAT.
        let storage = save_config(dir.path(), &store, &sample()).expect("save fallback");
        assert_eq!(storage, TokenStorage::File);
        assert!(file_text(dir.path()).contains("token-rahasia"));
        // Muat saat vault mati → token dari berkas, storage File.
        let (loaded, loaded_storage) = load_config(dir.path(), &store);
        assert_eq!(loaded_storage, TokenStorage::File);
        assert_eq!(
            loaded.expect("fallback termuat").device_token,
            "token-rahasia-123456"
        );
        // Vault pulih → muat berikutnya bermigrasi ke keychain.
        store.set_failing(false);
        let (_, migrated_storage) = load_config(dir.path(), &store);
        assert_eq!(migrated_storage, TokenStorage::Keychain);
        assert!(!file_text(dir.path()).contains("token-rahasia"));
    }

    #[test]
    fn missing_config_is_unconfigured() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = MemoryStore::new();
        let (loaded, storage) = load_config(dir.path(), &store);
        assert!(loaded.is_none());
        assert_eq!(storage, TokenStorage::None);
        let view = status(&None, storage, None);
        assert!(!view.token_configured && !view.paired);
    }

    #[test]
    fn clear_config_removes_vault_and_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = MemoryStore::new();
        save_config(dir.path(), &store, &sample()).expect("save");
        clear_config(dir.path(), &store);
        assert!(store.get(KEYRING_SERVICE, KEYRING_ACCOUNT).unwrap().is_none());
        assert!(!config_path(dir.path()).exists());
        let (loaded, _) = load_config(dir.path(), &store);
        assert!(loaded.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn saved_config_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("tempdir");
        let store = MemoryStore::new();
        store.set_failing(true);
        save_config(dir.path(), &store, &sample()).expect("save");
        let mode = std::fs::metadata(config_path(dir.path()))
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn printer_config_roundtrip_and_columns() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(load_printer(dir.path()).is_none());
        let config = PrinterConfig {
            host: "192.168.1.50".to_string(),
            port: 9100,
            paper_width_mm: 58,
        };
        save_printer(dir.path(), &config).expect("save printer");
        let loaded = load_printer(dir.path()).expect("load printer");
        assert_eq!(loaded.host, "192.168.1.50");
        assert_eq!(loaded.columns(), 32, "58mm = 32 kolom Font A");
        let view = printer_status(&Some(loaded));
        assert!(view.configured);
        assert_eq!(view.paper_width_mm, Some(58));
        // Lebar kertas di luar 58/80 ditolak saat simpan…
        let bad = PrinterConfig {
            host: "192.168.1.50".to_string(),
            port: 9100,
            paper_width_mm: 76,
        };
        assert!(save_printer(dir.path(), &bad).is_err());
        // …dan berkas rusak/di luar pola dibaca sebagai belum diatur.
        std::fs::write(
            printer_path(dir.path()),
            r#"{"host":"x","port":9100,"paperWidthMm":76}"#,
        )
        .expect("tulis berkas rusak");
        assert!(load_printer(dir.path()).is_none());
    }
}
