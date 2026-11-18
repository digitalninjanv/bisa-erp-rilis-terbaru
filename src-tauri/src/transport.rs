//! Transport HTTP produksi untuk mesin sinkron (Langkah 4).
//!
//! Satu-satunya tempat token perangkat meninggalkan proses: header
//! `Authorization: Bearer` ke server ERP milik perusahaan sendiri,
//! dari Rust — tidak pernah dari webview/JS (D7). Memakai `ureq`
//! (blocking, rustls) karena drain berjalan di thread latar khusus;
//! tanpa runtime async di jalur uang.

use std::io::Read;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::device::DeviceConfig;
use crate::posdb;
use crate::syncengine::{SnapshotWire, SyncOutcome, SyncTransport, TransportError};

pub struct HttpTransport {
    agent: ureq::Agent,
}

impl HttpTransport {
    pub fn new() -> Self {
        HttpTransport {
            agent: ureq::AgentBuilder::new()
                .timeout_connect(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build(),
        }
    }
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpTransport {
    /// Baca riwayat transaksi dari domain server memakai token terminal
    /// yang hanya tersedia di Rust. Nilai pencarian di-encode sebagai
    /// query, tidak pernah digabung sebagai path.
    pub fn get_pos_transactions(
        &self,
        config: &DeviceConfig,
        page: u32,
        query: &str,
        status: Option<&str>,
        from: Option<&str>,
        to: Option<&str>,
        sale_id: Option<&str>,
    ) -> Result<serde_json::Value, TransportError> {
        let mut url = format!(
            "{}/api/pos/desktop/transactions?page={}&q={}",
            base_url(config),
            page.max(1),
            url_encode(query.trim()),
        );
        if let Some(status) = status.filter(|value| !value.is_empty()) {
            url.push_str("&status=");
            url.push_str(&url_encode(status));
        }
        if let Some(from) = from.filter(|value| !value.is_empty()) {
            url.push_str("&from=");
            url.push_str(&url_encode(from));
        }
        if let Some(to) = to.filter(|value| !value.is_empty()) {
            url.push_str("&to=");
            url.push_str(&url_encode(to));
        }
        if let Some(sale_id) = sale_id {
            url.push_str("&saleId=");
            url.push_str(&url_encode(sale_id));
        }
        let body = self
            .agent
            .get(&url)
            .set("Authorization", &format!("Bearer {}", config.device_token))
            .call()
            .map_err(map_error)?
            .into_json::<serde_json::Value>()
            .map_err(|error| TransportError::Network(error.to_string()))?;
        unwrap_envelope(body)
    }

    /// Baca saldo mutasi kas sesi dari server. Token terminal tetap berada
    /// di Rust dan ID sesi hanya dikirim sebagai parameter query.
    pub fn get_pos_cash_session_summary(
        &self,
        config: &DeviceConfig,
        session_id: &str,
    ) -> Result<serde_json::Value, TransportError> {
        let session_id = uuid::Uuid::parse_str(session_id)
            .map_err(|_| TransportError::Network("ID sesi kas tidak valid.".to_string()))?
            .to_string();
        let url = format!(
            "{}/api/pos/desktop/sessions?sessionId={}",
            base_url(config),
            url_encode(&session_id),
        );
        let body = self
            .agent
            .get(&url)
            .set("Authorization", &format!("Bearer {}", config.device_token))
            .call()
            .map_err(map_error)?
            .into_json::<serde_json::Value>()
            .map_err(|error| TransportError::Network(error.to_string()))?;
        unwrap_envelope(body)
    }

    /// Ambil bytes ESC/POS nota dari server setelah server memeriksa
    /// tenant, status transaksi, dan izin perangkat.
    pub fn get_pos_receipt_bytes(
        &self,
        config: &DeviceConfig,
        sale_id: &str,
        paper_width_mm: u16,
    ) -> Result<Vec<u8>, TransportError> {
        if sale_id.len() != 36
            || !sale_id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        {
            return Err(TransportError::Network("ID transaksi tidak valid.".to_string()));
        }
        if paper_width_mm != 58 && paper_width_mm != 80 {
            return Err(TransportError::Network("Lebar kertas printer tidak valid.".to_string()));
        }
        const MAX_RECEIPT_BYTES: usize = 1024 * 1024;
        let url = format!(
            "{}/api/pos/desktop/transactions/{}/receipt?paperWidth={}",
            base_url(config),
            url_encode(sale_id),
            paper_width_mm,
        );
        let response = self
            .agent
            .get(&url)
            .set("Authorization", &format!("Bearer {}", config.device_token))
            .call()
            .map_err(map_error)?;
        let mut reader = response.into_reader().take((MAX_RECEIPT_BYTES + 1) as u64);
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .map_err(|error| TransportError::Network(error.to_string()))?;
        if bytes.len() > MAX_RECEIPT_BYTES {
            return Err(TransportError::Network("Data nota melebihi batas ukuran.".to_string()));
        }
        if bytes.is_empty() {
            return Err(TransportError::Network("Server mengirim nota kosong.".to_string()));
        }
        Ok(bytes)
    }

    /// Jalankan aksi purna jual melalui route domain server. Payload
    /// divalidasi ulang di route; kredensial terminal tetap di Rust.
    pub fn post_pos_transaction(
        &self,
        config: &DeviceConfig,
        payload: &serde_json::Value,
    ) -> Result<serde_json::Value, TransportError> {
        let body = self
            .agent
            .post(&format!("{}/api/pos/desktop/transactions", base_url(config)))
            .set("Authorization", &format!("Bearer {}", config.device_token))
            .send_json(payload)
            .map_err(map_error)?
            .into_json::<serde_json::Value>()
            .map_err(|error| TransportError::Network(error.to_string()))?;
        unwrap_envelope(body)
    }
}

fn base_url(config: &DeviceConfig) -> String {
    config.server_url.trim_end_matches('/').to_string()
}

fn map_error(error: ureq::Error) -> TransportError {
    match error {
        ureq::Error::Status(401, response) => TransportError::Unauthorized(
            response
                .into_json::<serde_json::Value>()
                .ok()
                .and_then(|body| body["message"].as_str().map(|text| text.to_string()))
                .unwrap_or_else(|| "Token perangkat tidak dikenal.".to_string()),
        ),
        ureq::Error::Status(status, response) => {
            let message = response
                .into_string()
                .unwrap_or_else(|_| "tanpa rincian".to_string());
            TransportError::Http(status, message.chars().take(300).collect())
        }
        ureq::Error::Transport(transport) => TransportError::Network(transport.to_string()),
    }
}

/// Buka amplop `{ ok, data, message }` bersama semua /api/pos/*.
fn unwrap_envelope(body: serde_json::Value) -> Result<serde_json::Value, TransportError> {
    if body["ok"].as_bool() == Some(true) {
        Ok(body["data"].clone())
    } else {
        Err(TransportError::Http(
            200,
            body["message"]
                .as_str()
                .unwrap_or("Server menolak permintaan.")
                .to_string(),
        ))
    }
}

impl SyncTransport for HttpTransport {
    fn fetch_snapshot(
        &self,
        config: &DeviceConfig,
        cursor: Option<&str>,
    ) -> Result<SnapshotWire, TransportError> {
        let mut url = format!("{}/api/pos/snapshot", base_url(config));
        if let Some(cursor) = cursor {
            url.push_str(&format!("?cursor={}", url_encode(cursor)));
        }
        let body = self
            .agent
            .get(&url)
            .set("Authorization", &format!("Bearer {}", config.device_token))
            .call()
            .map_err(map_error)?
            .into_json::<serde_json::Value>()
            .map_err(|error| TransportError::Network(error.to_string()))?;
        let data = unwrap_envelope(body)?;
        let mode = data["mode"].as_str().unwrap_or("");
        match mode {
            "full" => serde_json::from_value::<posdb::SnapshotInput>(data)
                .map(SnapshotWire::Full)
                .map_err(|error| TransportError::Network(format!("Snapshot penuh tidak terbaca: {error}"))),
            "delta" => serde_json::from_value::<posdb::SnapshotDeltaInput>(data)
                .map(SnapshotWire::Delta)
                .map_err(|error| TransportError::Network(format!("Delta tidak terbaca: {error}"))),
            other => Err(TransportError::Network(format!(
                "Mode snapshot tidak dikenal: {other}"
            ))),
        }
    }

    fn post_sync(
        &self,
        config: &DeviceConfig,
        items: &[serde_json::Value],
        intents: &[serde_json::Value],
    ) -> Result<SyncOutcome, TransportError> {
        let body = self
            .agent
            .post(&format!("{}/api/pos/sync", base_url(config)))
            .set("Authorization", &format!("Bearer {}", config.device_token))
            .send_json(serde_json::json!({ "items": items, "sessionIntents": intents }))
            .map_err(map_error)?
            .into_json::<serde_json::Value>()
            .map_err(|error| TransportError::Network(error.to_string()))?;
        if body["ok"].as_bool() != Some(true) {
            return Err(TransportError::Http(
                200,
                body["message"]
                    .as_str()
                    .unwrap_or("Server menolak permintaan.")
                    .to_string(),
            ));
        }
        let results = serde_json::from_value::<Vec<posdb::SyncResultInput>>(body["data"].clone())
            .map_err(|error| {
                TransportError::Network(format!("Hasil sinkronisasi tidak terbaca: {error}"))
            })?;
        let intent_results = if body["intentResults"].is_null() {
            Vec::new()
        } else {
            serde_json::from_value::<Vec<posdb::IntentResultInput>>(body["intentResults"].clone())
                .map_err(|error| {
                    TransportError::Network(format!("Hasil intent tidak terbaca: {error}"))
                })?
        };
        Ok(SyncOutcome {
            results,
            intent_results,
        })
    }
}

/// Hasil penukaran kode pasangan (Langkah 6): token perangkat
/// per-terminal + identitas terminal dari registry server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairOutcome {
    pub token: String,
    pub terminal: PairedTerminal,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedTerminal {
    pub id: String,
    pub name: String,
    pub company_id: String,
    pub warehouse_id: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCashier {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DesktopCompany {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub enum DesktopLoginStep {
    TwoFactor { methods: Vec<String>, cookies: Vec<String> },
    Authenticated {
        cashier: DesktopCashier,
        companies: Vec<DesktopCompany>,
        selected_company_id: Option<String>,
        cookies: Vec<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEnrolledTerminal {
    pub id: String,
    pub name: String,
    pub company_id: String,
    pub company_name: String,
    pub warehouse_id: String,
    pub warehouse_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesktopEnrollment {
    pub token: String,
    pub terminal: DesktopEnrolledTerminal,
    pub cashier: DesktopCashier,
}

fn cookie_pair(header: &str) -> Option<String> {
    let pair = header.split(';').next()?.trim();
    let (name, value) = pair.split_once('=')?;
    if name.trim().is_empty() || value.trim().is_empty() {
        return None;
    }
    Some(format!("{}={}", name.trim(), value.trim()))
}

fn cookies_from_response(response: &ureq::Response) -> Vec<String> {
    response.all("set-cookie").into_iter().filter_map(cookie_pair).collect()
}

fn read_json_response(
    response: Result<ureq::Response, ureq::Error>,
) -> Result<(u16, serde_json::Value, Vec<String>), TransportError> {
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(error)) => {
            return Err(TransportError::Network(error.to_string()));
        }
    };
    let status = response.status();
    let cookies = cookies_from_response(&response);
    let body = response
        .into_json::<serde_json::Value>()
        .unwrap_or(serde_json::Value::Null);
    if !(200..300).contains(&status) || body["ok"].as_bool() == Some(false) {
        return Err(TransportError::Http(
            status,
            body["message"]
                .as_str()
                .unwrap_or("Server menolak permintaan POS.")
                .to_string(),
        ));
    }
    Ok((status, body["data"].clone(), cookies))
}

fn native_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        // Do not forward a cashier password or a session cookie to a
        // different host through an HTTP redirect.
        .redirects(0)
        .build()
}

fn validate_server_url(server_url: &str) -> Result<String, TransportError> {
    let base = server_url.trim().trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://"))
        || base.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(TransportError::Network(
            "Alamat server harus berupa URL HTTP(S) yang valid.".to_string(),
        ));
    }
    Ok(base.to_string())
}

/// Login email/password atau lanjutkan challenge 2FA/company selection.
/// Session cookie hanya dikembalikan ke runtime Rust untuk dipakai
/// selama enrollment, tidak pernah dikirim ke WebView.
pub fn desktop_login_request(
    server_url: &str,
    email: Option<&str>,
    password: Option<&str>,
    two_factor_code: Option<&str>,
    company_id: Option<&str>,
    cookies: &[String],
) -> Result<DesktopLoginStep, TransportError> {
    let base = validate_server_url(server_url)?;
    let agent = native_agent();
    let mut request = agent
        .post(&format!("{base}/api/pos/desktop/login"))
        .set("Accept", "application/json");
    let cookie_header = cookies.join("; ");
    if !cookie_header.is_empty() {
        request = request.set("Cookie", &cookie_header);
    }
    let response = request.send_json(serde_json::json!({
        "email": email,
        "password": password,
        "twoFactorCode": two_factor_code,
        "companyId": company_id,
    }));
    let (_, data, received_cookies) = read_json_response(response)?;
    let mut merged_cookies = cookies.to_vec();
    for cookie in received_cookies {
        let name = cookie.split('=').next().unwrap_or_default();
        merged_cookies.retain(|existing| existing.split('=').next() != Some(name));
        merged_cookies.push(cookie);
    }

    match data["step"].as_str().unwrap_or("") {
        "twoFactor" => {
            let methods = serde_json::from_value::<Vec<String>>(data["methods"].clone())
                .unwrap_or_else(|_| vec!["totp".to_string()]);
            Ok(DesktopLoginStep::TwoFactor { methods, cookies: merged_cookies })
        }
        "authenticated" => {
            let cashier = serde_json::from_value::<DesktopCashier>(data["cashier"].clone())
                .map_err(|error| TransportError::Network(format!("Identitas kasir tidak terbaca: {error}")))?;
            let companies = serde_json::from_value::<Vec<DesktopCompany>>(data["companies"].clone())
                .map_err(|error| TransportError::Network(format!("Daftar perusahaan tidak terbaca: {error}")))?;
            Ok(DesktopLoginStep::Authenticated {
                cashier,
                companies,
                selected_company_id: data["selectedCompanyId"].as_str().map(str::to_string),
                cookies: merged_cookies,
            })
        }
        other => Err(TransportError::Network(format!("Langkah login desktop tidak dikenal: {other}"))),
    }
}

/// Enroll after account authentication. The optional old device token
/// authenticates re-use of the same registered terminal on this install.
pub fn desktop_enroll_request(
    server_url: &str,
    cookies: &[String],
    current_device_token: Option<&str>,
    company_id: &str,
    installation_id: &str,
) -> Result<DesktopEnrollment, TransportError> {
    let base = validate_server_url(server_url)?;
    let agent = native_agent();
    let mut request = agent
        .post(&format!("{base}/api/pos/desktop/enroll"))
        .set("Accept", "application/json")
        .set("Cookie", &cookies.join("; "));
    if let Some(token) = current_device_token {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    let response = request.send_json(serde_json::json!({
        "companyId": company_id,
        "installationId": installation_id,
    }));
    let (_, data, _) = read_json_response(response)?;
    serde_json::from_value::<DesktopEnrollment>(data)
        .map_err(|error| TransportError::Network(format!("Respons enrollment tidak terbaca: {error}")))
}

/// Tukar kode pasangan sekali pakai → token perangkat
/// (POST /api/pos/pair). Kode salah/kedaluwarsa/terpakai → 401
/// seragam dari server, dipetakan Unauthorized agar UI dapat
/// menampilkannya sebagai "kode ditolak". Fungsi bebas (bukan
/// bagian trait SyncTransport): pairing terjadi SEBELUM ada
/// konfigurasi perangkat.
pub fn pair_request(server_url: &str, code: &str) -> Result<PairOutcome, TransportError> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build();
    let url = format!(
        "{}/api/pos/pair",
        server_url.trim_end_matches('/')
    );
    let body = agent
        .post(&url)
        .send_json(serde_json::json!({ "code": code }))
        .map_err(map_error)?
        .into_json::<serde_json::Value>()
        .map_err(|error| TransportError::Network(error.to_string()))?;
    let data = unwrap_envelope(body)?;
    serde_json::from_value::<PairOutcome>(data)
        .map_err(|error| TransportError::Network(format!("Respons pasangan tidak terbaca: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Server HTTP mentah satu permintaan: tangkap badan, balas
    /// respons yang disiapkan (pola listener palsu Langkah 5).
    fn serve_once(status: u16, body: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let body = body.to_string();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 4096];
            let mut content_length = 0usize;
            loop {
                let n = stream.read(&mut chunk).expect("read");
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf);
                if let Some(pos) = text.find("\r\n\r\n") {
                    for line in text[..pos].lines() {
                        if let Some((name, value)) = line.split_once(':') {
                            if name.trim().eq_ignore_ascii_case("content-length") {
                                content_length = value.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    if text.len() >= pos + 4 + content_length {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&buf).to_string();
            let reason = if status == 200 { "OK" } else { "Unauthorized" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).expect("write");
            request
        });
        (format!("http://{addr}"), handle)
    }

    #[test]
    fn pair_request_exchanges_code_for_token() {
        let (url, handle) = serve_once(
            200,
            r#"{"ok":true,"data":{"token":"token-terminal-rahasia","terminal":{"id":"term-1","name":"Kasir 1","companyId":"org-1","warehouseId":"wh-1"}}}"#,
        );
        let outcome = pair_request(&url, "ABCDE-12345").expect("pair");
        assert_eq!(outcome.token, "token-terminal-rahasia");
        assert_eq!(outcome.terminal.id, "term-1");
        assert_eq!(outcome.terminal.warehouse_id.as_deref(), Some("wh-1"));
        let request = handle.join().expect("server thread");
        assert!(request.starts_with("POST /api/pos/pair"), "{request}");
        assert!(request.contains(r#""code":"ABCDE-12345""#), "{request}");
        assert!(
            !request.contains("Authorization"),
            "pairing tidak membawa token lama: {request}"
        );
    }

    #[test]
    fn pair_request_rejected_code_is_unauthorized() {
        let (url, _handle) = serve_once(
            401,
            r#"{"ok":false,"code":"UNAUTHORIZED","message":"Kode pasangan tidak dikenal, sudah terpakai, atau kedaluwarsa."}"#,
        );
        let error = pair_request(&url, "SALAH-KODE1").expect_err("harus ditolak");
        assert!(
            matches!(error, TransportError::Unauthorized(_)),
            "kode hangus → Unauthorized: {error}"
        );
    }
}

/// Percent-encoding minimal untuk nilai kursor (ISO-8601: `:`, `+`).
fn url_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
