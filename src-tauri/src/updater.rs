//! Logika keputusan updater aplikasi desktop (Langkah 7, D4) —
//! MURNI, tanpa Tauri dan tanpa plugin.
//!
//! Pemisahan ini disengaja (pola yang sama dengan syncengine vs
//! runtime): plugin resmi `tauri-plugin-updater` hanya dipakai
//! glue `runtime.rs` untuk pemeriksaan/unduh/pasang yang
//! sebenarnya, sedangkan SEMUA keputusan — URL pemeriksaan yang
//! dibangun runtime, kapan memeriksa lagi, apakah tawaran lebih
//! baru, dan terutama KAPAN paket yang sudah terunduh boleh
//! dipasang (gerbang sesi kas) — hidup di sini dan teruji harness
//! tanpa GTK.
//!
//! Kontrak server: GET /api/pos/update/:target/:arch/:version
//! menjawab 204 (tidak ada penawaran) atau dokumen JSON updater
//! { version, notes, pub_date, url, signature, mandatory }.
//! `parse_offer` adalah cermin kontrak itu di sisi klien: bentuk
//! dokumen yang sama diuji di sini dan di test HTTP server.

use serde::Serialize;

/// Jeda pemeriksaan berkala latar: 6 jam. Pemeriksaan juga selalu
/// berjalan sekali saat aplikasi mulai (last_check kosong).
pub const CHECK_INTERVAL_SECS: i64 = 6 * 60 * 60;

/// Pasangan (target, arch) kontrak updater untuk platform ini —
/// nama mengikuti konvensi Tauri (`linux`/`windows`, `x86_64`).
pub fn platform_target() -> (&'static str, &'static str) {
    let target = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "darwin",
        _ => "linux",
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        _ => "x86_64",
    };
    (target, arch)
}

/// URL endpoint dinamis untuk versi yang sedang berjalan. Dibangun
/// saat runtime (BUKAN statis di tauri.conf.json) karena keputusan
/// server bersifat per terminal — klien juga memasang header
/// Authorization token perangkat lewat updater_builder (glue).
pub fn build_check_url(
    server_url: &str,
    target: &str,
    arch: &str,
    current_version: &str,
) -> String {
    format!(
        "{}/api/pos/update/{}/{}/{}",
        server_url.trim_end_matches('/'),
        target,
        arch,
        current_version,
    )
}

/// Bandingkan versi semver inti (cermin `compareVersions` server):
/// -1 | 0 | 1, atau None bila salah satu tidak terbaca.
pub fn compare_versions(a: &str, b: &str) -> Option<i32> {
    fn parse(value: &str) -> Option<Vec<i64>> {
        let core = value.trim().trim_start_matches(['v', 'V']);
        let core = core.split(['-', '+']).next().unwrap_or("");
        let parts: Vec<&str> = core.split('.').collect();
        if parts.is_empty() || parts.len() > 4 {
            return None;
        }
        let mut numbers = Vec::new();
        for part in parts {
            if part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            numbers.push(part.parse::<i64>().ok()?);
        }
        while numbers.len() < 3 {
            numbers.push(0);
        }
        Some(numbers)
    }
    let left = parse(a)?;
    let right = parse(b)?;
    for i in 0..left.len().max(right.len()) {
        let diff = left.get(i).copied().unwrap_or(0) - right.get(i).copied().unwrap_or(0);
        if diff != 0 {
            return Some(if diff < 0 { -1 } else { 1 });
        }
    }
    Some(0)
}

/// Tawaran pembaruan hasil parse dokumen JSON server.
#[derive(Debug, Clone, PartialEq)]
pub struct UpdateOffer {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub url: String,
    pub signature: String,
    /// Di bawah versi minimum server: pemasangan tidak boleh
    /// ditunda gelombang rollout (keputusan server; klien menampilkannya).
    pub mandatory: bool,
}

/// Parse dokumen updater server. Dokumen tanpa version/url/
/// signature yang terisi BUKAN tawaran yang sah → None (plugin
/// akan menolaknya juga; di sini ditolak lebih awal & teruji).
pub fn parse_offer(body: &serde_json::Value) -> Option<UpdateOffer> {
    let version = body["version"].as_str()?.trim().to_string();
    let url = body["url"].as_str()?.trim().to_string();
    let signature = body["signature"].as_str()?.trim().to_string();
    if version.is_empty() || url.is_empty() || signature.is_empty() {
        return None;
    }
    Some(UpdateOffer {
        version,
        notes: body["notes"].as_str().unwrap_or("").to_string(),
        pub_date: body["pub_date"].as_str().unwrap_or("").to_string(),
        url,
        signature,
        mandatory: body["mandatory"].as_bool().unwrap_or(false),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfferDecision {
    /// Tawaran tidak lebih baru dari yang berjalan — abaikan.
    NotNewer,
    /// Tawaran sah dan lebih baru.
    Offer { mandatory: bool },
}

pub fn decide_offer(current_version: &str, offer: &UpdateOffer) -> OfferDecision {
    match compare_versions(current_version, &offer.version) {
        Some(order) if order < 0 => OfferDecision::Offer {
            mandatory: offer.mandatory,
        },
        _ => OfferDecision::NotNewer,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallDecision {
    /// Pasang sekarang (dan mulai ulang aplikasi).
    InstallNow,
    /// Paket siap, tetapi sesi kas masih terbuka — tunggu tutup sesi.
    WaitForSessionClose,
    /// Belum ada paket terunduh utuh.
    NothingDownloaded,
}

/// Gerbang pemasangan (D4: unduh saat shift, pasang saat tutup
/// shift). Sesi kas terbuka menahan pemasangan OTOMATIS; perintah
/// eksplisit pengguna dari UI adalah jalan keluar yang sah
/// (kasir memutuskan menutup aplikasi di tengah sesi dengan sadar).
pub fn decide_install(
    downloaded: bool,
    session_open: bool,
    user_requested: bool,
) -> InstallDecision {
    if !downloaded {
        return InstallDecision::NothingDownloaded;
    }
    if session_open && !user_requested {
        return InstallDecision::WaitForSessionClose;
    }
    InstallDecision::InstallNow
}

/// Apakah pemeriksaan berkala sudah jatuh tempo.
pub fn should_check(last_check_unix: Option<i64>, now_unix: i64, force: bool) -> bool {
    if force {
        return true;
    }
    match last_check_unix {
        None => true,
        Some(last) => now_unix.saturating_sub(last) >= CHECK_INTERVAL_SECS,
    }
}

// ---------------------------------------------------------------------------
// Pelacak keadaan untuk UI (mesin keadaan murni di atas keputusan)
// ---------------------------------------------------------------------------

/// Keadaan pembaruan yang tampil di UI desktop, dikirim glue
/// sebagai status command + event `pos-update`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusView {
    /// idle | checking | upToDate | available | downloading |
    /// downloaded | waitingSession | installing | failed
    pub phase: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub mandatory: bool,
    pub notes: Option<String>,
    pub last_checked_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateTracker {
    current_version: String,
    phase: String,
    available_version: Option<String>,
    mandatory: bool,
    notes: Option<String>,
    last_checked_at: Option<String>,
    last_check_unix: Option<i64>,
    message: Option<String>,
    downloaded: bool,
}

impl UpdateTracker {
    pub fn new(current_version: &str) -> Self {
        UpdateTracker {
            current_version: current_version.to_string(),
            phase: "idle".to_string(),
            available_version: None,
            mandatory: false,
            notes: None,
            last_checked_at: None,
            last_check_unix: None,
            message: None,
            downloaded: false,
        }
    }

    pub fn view(&self) -> UpdateStatusView {
        UpdateStatusView {
            phase: self.phase.clone(),
            current_version: self.current_version.clone(),
            available_version: self.available_version.clone(),
            mandatory: self.mandatory,
            notes: self.notes.clone(),
            last_checked_at: self.last_checked_at.clone(),
            message: self.message.clone(),
        }
    }

    pub fn should_check(&self, now_unix: i64, force: bool) -> bool {
        should_check(self.last_check_unix, now_unix, force)
    }

    pub fn begin_check(&mut self) {
        self.phase = "checking".to_string();
        self.message = None;
    }

    pub fn on_up_to_date(&mut self, now_unix: i64, now_iso: &str) {
        self.phase = "upToDate".to_string();
        self.available_version = None;
        self.mandatory = false;
        self.notes = None;
        self.downloaded = false;
        self.last_check_unix = Some(now_unix);
        self.last_checked_at = Some(now_iso.to_string());
    }

    pub fn on_available(&mut self, offer: &UpdateOffer, now_unix: i64, now_iso: &str) {
        self.phase = "available".to_string();
        self.available_version = Some(offer.version.clone());
        self.mandatory = offer.mandatory;
        self.notes = if offer.notes.is_empty() {
            None
        } else {
            Some(offer.notes.clone())
        };
        self.downloaded = false;
        self.last_check_unix = Some(now_unix);
        self.last_checked_at = Some(now_iso.to_string());
    }

    pub fn on_downloading(&mut self) {
        self.phase = "downloading".to_string();
    }

    /// Unduhan selesai: fase berikutnya ditentukan gerbang sesi.
    pub fn on_downloaded(&mut self, session_open: bool) {
        self.downloaded = true;
        self.phase = if session_open {
            "waitingSession".to_string()
        } else {
            "downloaded".to_string()
        };
    }

    pub fn on_check_failed(&mut self, message: &str, now_unix: i64, now_iso: &str) {
        self.phase = "failed".to_string();
        self.message = Some(message.to_string());
        self.last_check_unix = Some(now_unix);
        self.last_checked_at = Some(now_iso.to_string());
    }

    pub fn on_download_failed(&mut self, message: &str) {
        self.phase = "failed".to_string();
        self.message = Some(message.to_string());
        self.downloaded = false;
    }

    pub fn install_decision(&self, session_open: bool, user_requested: bool) -> InstallDecision {
        decide_install(self.downloaded, session_open, user_requested)
    }

    pub fn on_session_closed(&mut self) {
        if self.downloaded && self.phase == "waitingSession" {
            self.phase = "downloaded".to_string();
        }
    }

    pub fn on_installing(&mut self) {
        self.phase = "installing".to_string();
    }

    pub fn on_install_failed(&mut self, message: &str) {
        self.phase = "failed".to_string();
        self.message = Some(message.to_string());
    }

    pub fn downloaded_version(&self) -> Option<&str> {
        if self.downloaded {
            self.available_version.as_deref()
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offer(version: &str, mandatory: bool) -> UpdateOffer {
        UpdateOffer {
            version: version.to_string(),
            notes: "catatan".to_string(),
            pub_date: "2026-11-07T00:00:00Z".to_string(),
            url: "http://server/api/pos/update/download/linux/x86_64".to_string(),
            signature: "c2ln".to_string(),
            mandatory,
        }
    }

    #[test]
    fn check_url_uses_runtime_endpoint_shape() {
        assert_eq!(
            build_check_url("http://192.168.1.10:3000/", "linux", "x86_64", "1.2.3"),
            "http://192.168.1.10:3000/api/pos/update/linux/x86_64/1.2.3"
        );
        let (target, arch) = platform_target();
        assert!(["linux", "windows", "darwin"].contains(&target));
        assert!(["x86_64", "aarch64"].contains(&arch));
    }

    #[test]
    fn version_comparison_matches_server_rules() {
        assert_eq!(compare_versions("1.2.3", "1.2.4"), Some(-1));
        assert_eq!(compare_versions("1.10.0", "1.9.9"), Some(1));
        assert_eq!(compare_versions("v1.2.0", "1.2.0"), Some(0));
        assert_eq!(compare_versions("1.2", "1.2.0"), Some(0));
        assert_eq!(compare_versions("2.0.0", "1.9.9"), Some(1));
        assert_eq!(compare_versions("bukan-versi", "1.0.0"), None);
        assert_eq!(compare_versions("1.0.0", ""), None);
    }

    #[test]
    fn offer_parsing_requires_version_url_signature() {
        let good = serde_json::json!({
            "version": "1.3.0", "notes": "n", "pub_date": "2026-11-07T00:00:00Z",
            "url": "http://x/y", "signature": "c2ln", "mandatory": true
        });
        let parsed = parse_offer(&good).expect("tawaran sah");
        assert_eq!(parsed.version, "1.3.0");
        assert!(parsed.mandatory);
        let missing_sig = serde_json::json!({ "version": "1.3.0", "url": "http://x/y" });
        assert!(parse_offer(&missing_sig).is_none());
        let empty = serde_json::json!({});
        assert!(parse_offer(&empty).is_none());
        // mandatory absen = false (rilis biasa).
        let plain = serde_json::json!({
            "version": "1.3.0", "url": "http://x/y", "signature": "c2ln"
        });
        assert!(!parse_offer(&plain).expect("sah").mandatory);
    }

    #[test]
    fn offer_decision_only_for_newer() {
        assert_eq!(
            decide_offer("1.2.3", &offer("1.2.4", false)),
            OfferDecision::Offer { mandatory: false }
        );
        assert_eq!(
            decide_offer("1.2.3", &offer("2.0.0", true)),
            OfferDecision::Offer { mandatory: true }
        );
        assert_eq!(decide_offer("1.2.3", &offer("1.2.3", false)), OfferDecision::NotNewer);
        assert_eq!(decide_offer("1.2.3", &offer("1.2.2", true)), OfferDecision::NotNewer);
    }

    #[test]
    fn install_gate_holds_while_session_open_unless_user_asks() {
        // Belum terunduh: tidak ada yang bisa dipasang.
        assert_eq!(decide_install(false, false, false), InstallDecision::NothingDownloaded);
        assert_eq!(decide_install(false, true, true), InstallDecision::NothingDownloaded);
        // Terunduh + sesi terbuka + otomatis → tahan sampai tutup sesi.
        assert_eq!(
            decide_install(true, true, false),
            InstallDecision::WaitForSessionClose
        );
        // Terunduh + sesi terbuka + perintah eksplisit pengguna → pasang.
        assert_eq!(decide_install(true, true, true), InstallDecision::InstallNow);
        // Terunduh + sesi tertutup → pasang (otomatis maupun manual).
        assert_eq!(decide_install(true, false, false), InstallDecision::InstallNow);
        assert_eq!(decide_install(true, false, true), InstallDecision::InstallNow);
    }

    #[test]
    fn check_schedule_first_run_then_interval() {
        assert!(should_check(None, 1_000, false), "belum pernah = periksa");
        assert!(!should_check(Some(1_000), 1_000 + CHECK_INTERVAL_SECS - 1, false));
        assert!(should_check(Some(1_000), 1_000 + CHECK_INTERVAL_SECS, false));
        assert!(should_check(Some(1_000), 1_001, true), "paksa selalu periksa");
    }

    #[test]
    fn tracker_flows_available_download_wait_install() {
        let mut tracker = UpdateTracker::new("1.2.3");
        assert_eq!(tracker.view().phase, "idle");
        assert!(tracker.should_check(5_000, false));
        tracker.begin_check();
        tracker.on_available(&offer("1.3.0", false), 5_000, "2026-11-07T00:00:00Z");
        let view = tracker.view();
        assert_eq!(view.phase, "available");
        assert_eq!(view.available_version.as_deref(), Some("1.3.0"));
        assert!(!view.mandatory);
        tracker.on_downloading();
        // Sesi masih terbuka saat unduhan selesai → menunggu tutup.
        tracker.on_downloaded(true);
        assert_eq!(tracker.view().phase, "waitingSession");
        assert_eq!(
            tracker.install_decision(true, false),
            InstallDecision::WaitForSessionClose
        );
        // Sesi ditutup → siap pasang otomatis.
        tracker.on_session_closed();
        assert_eq!(tracker.view().phase, "downloaded");
        assert_eq!(tracker.install_decision(false, false), InstallDecision::InstallNow);
        tracker.on_installing();
        assert_eq!(tracker.view().phase, "installing");
    }

    #[test]
    fn tracker_up_to_date_and_failure_stamp_last_check() {
        let mut tracker = UpdateTracker::new("1.2.3");
        tracker.on_up_to_date(9_000, "2026-11-07T01:00:00Z");
        assert_eq!(tracker.view().phase, "upToDate");
        assert!(!tracker.should_check(9_100, false));
        assert!(tracker.should_check(9_100, true));
        tracker.on_check_failed("server tak terjangkau", 9_200, "2026-11-07T01:05:00Z");
        let view = tracker.view();
        assert_eq!(view.phase, "failed");
        assert_eq!(view.message.as_deref(), Some("server tak terjangkau"));
        assert_eq!(view.last_checked_at.as_deref(), Some("2026-11-07T01:05:00Z"));
        // JSON status untuk UI tidak pernah membawa rahasia apa pun.
        let rendered = serde_json::to_string(&view).expect("render");
        assert!(rendered.contains("\"currentVersion\":\"1.2.3\""), "{rendered}");
    }
}
