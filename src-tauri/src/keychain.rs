//! Penyimpanan rahasia perangkat POS (POS Native Langkah 6, D5).
//!
//! Token perangkat TIDAK lagi hidup di berkas JSON: ia disimpan di
//! keychain OS lewat crate `keyring` (Windows Credential Manager /
//! Linux Secret Service / macOS Keychain). Lapisan ini diabstraksi
//! trait `SecretStore` supaya teruji headless dengan `MemoryStore`;
//! pemanggil (`device.rs`) yang memutuskan fallback tertulis:
//! bila vault OS tidak tersedia, token kembali ke berkas 0600
//! DENGAN status yang terlihat di UI (`TokenStorage::File`).
//!
//! JS tidak pernah melihat nilai token — yang keluar ke UI hanya
//! status (`configured`, jenis penyimpanan).
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::Mutex;

/// Layanan & akun tetap untuk entri keychain aplikasi ini.
pub const KEYRING_SERVICE: &str = "id.bisa.pos";
pub const KEYRING_ACCOUNT: &str = "device-token";

/// Abstraksi vault rahasia. `get` mengembalikan Ok(None) bila entri
/// tidak ada; Err hanya untuk kegagalan vault sungguhan (layanan
/// mati, akses ditolak) — pemanggil membedakannya untuk fallback.
pub trait SecretStore: Send + Sync {
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, String>;
    fn set(&self, service: &str, account: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, service: &str, account: &str) -> Result<(), String>;
}

/// Vault OS sungguhan via crate `keyring`.
pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(service, account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, service: &str, account: &str, secret: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, account).map_err(|e| e.to_string())?;
        entry.set_password(secret).map_err(|e| e.to_string())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, account).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Vault dalam-memori untuk pengujian headless (harness) — pola
/// yang sama seperti listener TCP palsu pada modul cetak.
#[derive(Default)]
pub struct MemoryStore {
    entries: Mutex<HashMap<(String, String), String>>,
    /// Bila true, semua operasi gagal — meniru secret-service mati.
    pub fail: Mutex<bool>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_failing(&self, failing: bool) {
        *self.fail.lock().unwrap() = failing;
    }

    fn guard(&self) -> Result<(), String> {
        if *self.fail.lock().unwrap() {
            return Err("secret service tidak tersedia (simulasi)".to_string());
        }
        Ok(())
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        self.guard()?;
        Ok(self
            .entries
            .lock()
            .unwrap()
            .get(&(service.to_string(), account.to_string()))
            .cloned())
    }

    fn set(&self, service: &str, account: &str, secret: &str) -> Result<(), String> {
        self.guard()?;
        self.entries.lock().unwrap().insert(
            (service.to_string(), account.to_string()),
            secret.to_string(),
        );
        Ok(())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        self.guard()?;
        self.entries
            .lock()
            .unwrap()
            .remove(&(service.to_string(), account.to_string()));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_roundtrip_dan_hapus() {
        let store = MemoryStore::new();
        assert_eq!(store.get(KEYRING_SERVICE, KEYRING_ACCOUNT).unwrap(), None);
        store
            .set(KEYRING_SERVICE, KEYRING_ACCOUNT, "token-rahasia")
            .unwrap();
        assert_eq!(
            store.get(KEYRING_SERVICE, KEYRING_ACCOUNT).unwrap().as_deref(),
            Some("token-rahasia")
        );
        store.delete(KEYRING_SERVICE, KEYRING_ACCOUNT).unwrap();
        assert_eq!(store.get(KEYRING_SERVICE, KEYRING_ACCOUNT).unwrap(), None);
        // Hapus entri yang tidak ada bukan kesalahan.
        store.delete(KEYRING_SERVICE, KEYRING_ACCOUNT).unwrap();
    }

    #[test]
    fn memory_store_gagal_saat_disetel_mati() {
        let store = MemoryStore::new();
        store.set_failing(true);
        assert!(store.get(KEYRING_SERVICE, KEYRING_ACCOUNT).is_err());
        assert!(store.set(KEYRING_SERVICE, KEYRING_ACCOUNT, "x").is_err());
        assert!(store.delete(KEYRING_SERVICE, KEYRING_ACCOUNT).is_err());
    }
}
