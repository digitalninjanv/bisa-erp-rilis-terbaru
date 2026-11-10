//! Transport HTTP produksi untuk mesin sinkron (Langkah 4).
//!
//! Satu-satunya tempat token perangkat meninggalkan proses: header
//! `Authorization: Bearer` ke server ERP milik perusahaan sendiri,
//! dari Rust — tidak pernah dari webview/JS (D7). Memakai `ureq`
//! (blocking, rustls) karena drain berjalan di thread latar khusus;
//! tanpa runtime async di jalur uang.

use std::time::Duration;

use serde::Deserialize;

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
