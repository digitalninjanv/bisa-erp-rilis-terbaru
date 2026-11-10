//! Mesin sinkron POS (Langkah 4, RENCANA-TAURI D7).
//!
//! Logika drain outbox + penyegaran snapshot hidup di sini — murni
//! atas `posdb` + trait `SyncTransport`, TANPA Tauri dan TANPA
//! pustaka HTTP — agar terbukti lewat `cargo test` headless dengan
//! transport palsu. Lapisan Tauri (runtime.rs) hanya menyambung:
//! transport HTTP sungguhan (transport.rs, ureq), penjadwalan task
//! latar, dan pancaran event ke UI.
//!
//! Semantik drain:
//! - single-flight & berurutan dijaga pemanggil + klaim atomik
//!   `claim_pending` (pending → inflight dalam satu transaksi);
//! - item `inflight` yatim (proses mati di tengah kirim) dikembalikan
//!   ke `pending` di awal putaran — aman karena server menolak
//!   duplikat per clientKey (kontrak idempoten yang sudah ada);
//! - hasil per item diterapkan persis seperti web: synced/duplicate
//!   selesai, conflict/failed → held untuk peninjauan manusia;
//! - kegagalan prasyarat (jaringan putus, HTTP error, token ditolak
//!   401) mengembalikan klaim ke `pending` TANPA menghukum item:
//!   401 menghentikan drain dengan status terlihat UI sampai token
//!   diperbarui.

use rusqlite::Connection;
use serde::Serialize;

use crate::device::DeviceConfig;
use crate::posdb;

#[derive(Debug, Clone)]
pub enum TransportError {
    /// Server menolak token perangkat (HTTP 401) — drain berhenti.
    Unauthorized(String),
    /// Jaringan tidak terjangkau / waktu habis.
    Network(String),
    /// Server menjawab status tak terduga.
    Http(u16, String),
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransportError::Unauthorized(message) => write!(f, "Token ditolak server: {message}"),
            TransportError::Network(message) => write!(f, "Jaringan: {message}"),
            TransportError::Http(status, message) => write!(f, "HTTP {status}: {message}"),
        }
    }
}

/// Hasil snapshot dari kawat — server memutuskan penuh vs delta.
#[derive(Debug, Clone)]
pub enum SnapshotWire {
    Full(posdb::SnapshotInput),
    Delta(posdb::SnapshotDeltaInput),
}

/// Hasil satu panggilan sinkron: hasil per item penjualan +
/// hasil per intent sesi (Langkah 6 — intent tercatat sekali di
/// server sebagai peninjauan; recorded/duplicate = selesai).
#[derive(Debug, Default)]
pub struct SyncOutcome {
    pub results: Vec<posdb::SyncResultInput>,
    pub intent_results: Vec<posdb::IntentResultInput>,
}

/// Permukaan HTTP yang dibutuhkan mesin. Implementasi produksi di
/// transport.rs; test memakai palsu di modul ini.
pub trait SyncTransport {
    fn fetch_snapshot(
        &self,
        config: &DeviceConfig,
        cursor: Option<&str>,
    ) -> Result<SnapshotWire, TransportError>;

    fn post_sync(
        &self,
        config: &DeviceConfig,
        items: &[serde_json::Value],
        intents: &[serde_json::Value],
    ) -> Result<SyncOutcome, TransportError>;
}

/// Bentuk kawat intent tutup sesi dari fakta lokal (Langkah 6):
/// angka lokal tersimpan sebagai string uang di payload intent —
/// di sini diubah ke angka JSON kontrak server, dan identitas
/// terminal dicap (cap fakta saat tutup menang; identitas kini
/// menjadi cadangan). None untuk kind selain cash_session_close.
pub fn session_intent_wire(
    intent: &posdb::LocalIntent,
    identity: Option<&posdb::TerminalIdentity>,
) -> Option<serde_json::Value> {
    if intent.kind != "cash_session_close" {
        return None;
    }
    let fact = &intent.payload;
    let number = |key: &str| -> f64 {
        match fact.get(key) {
            Some(serde_json::Value::String(text)) => text.parse().unwrap_or(0.0),
            Some(serde_json::Value::Number(value)) => value.as_f64().unwrap_or(0.0),
            _ => 0.0,
        }
    };
    let text = |key: &str| fact.get(key).and_then(|value| value.as_str());
    Some(serde_json::json!({
        "clientKey": intent.id,
        "warehouseId": text("warehouseId")?,
        "cashierId": text("openedBy"),
        "localSessionId": text("sessionId")?,
        "openedAt": text("openedAt"),
        "closedAt": text("closedAt")?,
        "openingCash": number("openingCash"),
        "expectedCash": number("expectedTotal"),
        "countedCash": number("countedTotal"),
        "difference": number("differenceTotal"),
        "denominations": fact.get("denominations").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "terminalId": text("terminalId").map(str::to_string)
            .or_else(|| identity.map(|view| view.terminal_id.clone())),
        "terminalName": text("terminalName").map(str::to_string)
            .or_else(|| identity.map(|view| view.name.clone())),
    }))
}

/// Peristiwa mesin untuk UI (dipancarkan runtime lewat event Tauri).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum EngineEvent {
    PassStarted,
    Item { client_key: String, status: String },
    PassFinished { pending: i64, synced: i64, held: i64 },
    AuthFailed { message: String },
    Offline { message: String },
    SnapshotApplied { mode: String, products: usize, removed: usize },
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainSummary {
    pub attempted: usize,
    pub synced: usize,
    pub held: usize,
    pub remaining: i64,
    pub auth_failed: bool,
    pub error: Option<String>,
}

const DRAIN_BATCH: usize = 50; // selaras batas skema server (maks 50 item/panggil)

/// Satu putaran drain penuh: klaim per batch → kirim → terapkan
/// hasil, sampai antrean pending habis atau prasyarat gagal.
pub fn drain_outbox<T: SyncTransport>(
    conn: &mut Connection,
    config: &DeviceConfig,
    transport: &T,
    now_iso: &str,
    events: &mut dyn FnMut(EngineEvent),
) -> DrainSummary {
    let mut summary = DrainSummary::default();
    events(EngineEvent::PassStarted);
    // Pemulihan startup berlaku juga per putaran: murah dan membuat
    // drain kebal terhadap klaim yatim dari proses sebelumnya.
    let _ = posdb::reset_inflight(conn, now_iso);

    // Intent sesi pending ikut batch PERTAMA putaran ini (Langkah
    // 6) — termasuk putaran tanpa penjualan sama sekali, agar
    // tutup sesi tetap terkirim saat tidak ada antrean jualan.
    let identity = posdb::terminal_identity(conn).ok().flatten();
    let intent_batch: Vec<serde_json::Value> = posdb::pending_intents(conn, 50)
        .unwrap_or_default()
        .iter()
        .filter_map(|intent| session_intent_wire(intent, identity.as_ref()))
        .collect();
    let mut intents_pending_send = !intent_batch.is_empty();

    loop {
        let claimed = match posdb::claim_pending(conn, DRAIN_BATCH, now_iso) {
            Ok(items) => items,
            Err(message) => {
                summary.error = Some(message);
                break;
            }
        };
        let intents: &[serde_json::Value] = if intents_pending_send {
            &intent_batch
        } else {
            &[]
        };
        if claimed.is_empty() && intents.is_empty() {
            break;
        }
        let keys: Vec<String> = claimed.iter().map(|item| item.client_key.clone()).collect();
        let payloads: Vec<serde_json::Value> =
            claimed.iter().map(|item| item.payload.clone()).collect();
        summary.attempted += claimed.len();
        match transport.post_sync(config, &payloads, intents) {
            Ok(outcome) => {
                intents_pending_send = false;
                if !outcome.intent_results.is_empty() {
                    let done: Vec<String> = outcome
                        .intent_results
                        .iter()
                        .filter(|result| {
                            result.status == "recorded" || result.status == "duplicate"
                        })
                        .map(|result| result.client_key.clone())
                        .collect();
                    let _ = posdb::mark_intents_synced(conn, &done);
                }
                let results = outcome.results;
                if let Err(message) = posdb::apply_sync_results(conn, &results, now_iso) {
                    let _ = posdb::revert_claimed(conn, &keys, now_iso);
                    summary.error = Some(message);
                    break;
                }
                for result in &results {
                    match result.status.as_str() {
                        "synced" | "duplicate" => summary.synced += 1,
                        _ => summary.held += 1,
                    }
                    events(EngineEvent::Item {
                        client_key: result.client_key.clone(),
                        status: result.status.clone(),
                    });
                }
                if claimed.len() < DRAIN_BATCH {
                    break;
                }
            }
            Err(TransportError::Unauthorized(message)) => {
                let _ = posdb::revert_claimed(conn, &keys, now_iso);
                summary.auth_failed = true;
                summary.error = Some(message.clone());
                events(EngineEvent::AuthFailed { message });
                break;
            }
            Err(error) => {
                let _ = posdb::revert_claimed(conn, &keys, now_iso);
                let message = error.to_string();
                summary.error = Some(message.clone());
                events(EngineEvent::Offline { message });
                break;
            }
        }
    }

    summary.remaining = posdb::list_outbox(conn, None)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.status == "pending" || item.status == "inflight")
                .count() as i64
        })
        .unwrap_or(-1);
    let held_total = posdb::list_outbox(conn, Some("held"))
        .map(|items| items.len() as i64)
        .unwrap_or(0);
    events(EngineEvent::PassFinished {
        pending: summary.remaining.max(0),
        synced: summary.synced as i64,
        held: held_total,
    });
    summary
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSummary {
    /// "full" | "delta"
    pub mode: String,
    pub products: usize,
    pub removed: usize,
    pub cursor: Option<String>,
}

/// Segarkan snapshot lokal: kirim kursor tersimpan; terapkan delta
/// secara atomik, atau penuh. Bila gudang terminal BERUBAH di
/// server, delta tidak aman (stok seluruh katalog milik gudang
/// lain) — mesin meminta snapshot penuh dan menerapkannya.
pub fn refresh_snapshot<T: SyncTransport>(
    conn: &mut Connection,
    config: &DeviceConfig,
    transport: &T,
    events: &mut dyn FnMut(EngineEvent),
) -> Result<RefreshSummary, TransportError> {
    let info = posdb::snapshot_info(conn).map_err(TransportError::Network)?;
    let cursor = info.cursor.as_deref();
    match transport.fetch_snapshot(config, cursor)? {
        SnapshotWire::Full(snapshot) => {
            let cursor = snapshot.cursor.clone();
            let stats = posdb::apply_snapshot(conn, &snapshot).map_err(TransportError::Network)?;
            events(EngineEvent::SnapshotApplied {
                mode: "full".to_string(),
                products: stats.products,
                removed: 0,
            });
            Ok(RefreshSummary {
                mode: "full".to_string(),
                products: stats.products,
                removed: 0,
                cursor,
            })
        }
        SnapshotWire::Delta(delta) => {
            let stored_warehouse = info.warehouse_id.clone().unwrap_or_default();
            let delta_warehouse = delta
                .warehouse
                .as_ref()
                .map(|w| w.id.clone())
                .unwrap_or_default();
            if !stored_warehouse.is_empty() && stored_warehouse != delta_warehouse {
                // Gudang bawaan berubah: delta stok tidak berlaku.
                return match transport.fetch_snapshot(config, None)? {
                    SnapshotWire::Full(snapshot) => {
                        let cursor = snapshot.cursor.clone();
                        let stats = posdb::apply_snapshot(conn, &snapshot)
                            .map_err(TransportError::Network)?;
                        events(EngineEvent::SnapshotApplied {
                            mode: "full".to_string(),
                            products: stats.products,
                            removed: 0,
                        });
                        Ok(RefreshSummary {
                            mode: "full".to_string(),
                            products: stats.products,
                            removed: 0,
                            cursor,
                        })
                    }
                    SnapshotWire::Delta(_) => Err(TransportError::Network(
                        "Server menjawab delta untuk permintaan snapshot penuh.".to_string(),
                    )),
                };
            }
            let stats =
                posdb::apply_snapshot_delta(conn, &delta).map_err(TransportError::Network)?;
            events(EngineEvent::SnapshotApplied {
                mode: "delta".to_string(),
                products: stats.changed,
                removed: stats.removed,
            });
            Ok(RefreshSummary {
                mode: "delta".to_string(),
                products: stats.changed,
                removed: stats.removed,
                cursor: Some(stats.cursor),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::posdb::{
        CashSessionOpenInput, SnapshotInput, SnapshotMethodInput, SnapshotProductInput,
        SnapshotWarehouseInput,
    };
    use std::cell::RefCell;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open memory db");
        posdb::init(&conn).expect("init schema");
        conn
    }

    fn config() -> DeviceConfig {
        DeviceConfig {
            server_url: "http://localhost:3000".to_string(),
            device_token: "token-uji".to_string(),
        }
    }

    fn snapshot_fixture() -> SnapshotInput {
        SnapshotInput {
            version: "v1".to_string(),
            cursor: Some("2026-11-07T00:00:00.000Z".to_string()),
            generated_at: "2026-11-07T00:00:00.000Z".to_string(),
            warehouse: Some(SnapshotWarehouseInput {
                id: "wh-1".to_string(),
                code: "GDG".to_string(),
                name: "Gudang".to_string(),
            }),
            payment_methods: vec![SnapshotMethodInput {
                id: "pm-1".to_string(),
                code: "CASH".to_string(),
                name: "Tunai".to_string(),
                method_type: "cash".to_string(),
            }],
            products: vec![SnapshotProductInput {
                id: "prod-1".to_string(),
                sku: "SKU-1".to_string(),
                barcode: None,
                name: "Aqua".to_string(),
                sale_price: "4000.0000".to_string(),
                stock: 10.0,
                track_stock: true,
                track_serial: false,
                unit_code: None,
                packagings: vec![],
            }],
            receipt: None,
            terminal: None,
            names: None,
        }
    }

    fn seed_sale(conn: &mut Connection, key: &str) {
        posdb::apply_snapshot(conn, &snapshot_fixture()).expect("snapshot");
        let sale = posdb::SaleInput {
            client_key: key.to_string(),
            warehouse_id: "wh-1".to_string(),
            group_id: None,
            customer_id: None,
            due_date: None,
            date: "2026-11-07".to_string(),
            cashier_id: None,
            origin_session_id: None,
            device_id: None,
            expected_total: Some(4000.0),
            lines: vec![posdb::SaleLineInput {
                product_id: "prod-1".to_string(),
                qty: 1.0,
                discount_type: None,
                discount_value: None,
                serial_numbers: None,
                unit_price: Some(4000.0),
                packaging_id: None,
                isi_snapshot: None,
            }],
            payments: vec![posdb::SalePaymentInput {
                method_id: "pm-1".to_string(),
                amount: 4000.0,
                tendered: 4000.0,
                reference: None,
                fee: None,
            }],
            queued_at: "2026-11-07T02:00:00.000Z".to_string(),
        };
        posdb::record_sale(conn, &sale).expect("record sale");
    }

    fn outcome(results: Vec<posdb::SyncResultInput>) -> SyncOutcome {
        SyncOutcome {
            results,
            intent_results: vec![],
        }
    }

    struct FakeTransport {
        sync_behavior: RefCell<Vec<Result<SyncOutcome, TransportError>>>,
        snapshot: RefCell<Option<Result<SnapshotWire, TransportError>>>,
        seen_cursors: RefCell<Vec<Option<String>>>,
        seen_intents: RefCell<Vec<Vec<serde_json::Value>>>,
    }

    impl FakeTransport {
        fn new() -> Self {
            FakeTransport {
                sync_behavior: RefCell::new(Vec::new()),
                snapshot: RefCell::new(None),
                seen_cursors: RefCell::new(Vec::new()),
                seen_intents: RefCell::new(Vec::new()),
            }
        }
    }

    impl SyncTransport for FakeTransport {
        fn fetch_snapshot(
            &self,
            _config: &DeviceConfig,
            cursor: Option<&str>,
        ) -> Result<SnapshotWire, TransportError> {
            self.seen_cursors
                .borrow_mut()
                .push(cursor.map(|value| value.to_string()));
            self.snapshot
                .borrow_mut()
                .take()
                .expect("snapshot fixture dipasang")
        }

        fn post_sync(
            &self,
            _config: &DeviceConfig,
            _items: &[serde_json::Value],
            intents: &[serde_json::Value],
        ) -> Result<SyncOutcome, TransportError> {
            self.seen_intents.borrow_mut().push(intents.to_vec());
            self.sync_behavior.borrow_mut().remove(0)
        }
    }

    const NOW: &str = "2026-11-07T05:00:00.000Z";

    #[test]
    fn drain_applies_synced_and_held_results() {
        let mut conn = memory_db();
        seed_sale(&mut conn, "key-a");
        seed_sale(&mut conn, "key-b");
        let transport = FakeTransport::new();
        transport.sync_behavior.borrow_mut().push(Ok(outcome(vec![
            posdb::SyncResultInput {
                client_key: "key-a".to_string(),
                status: "synced".to_string(),
                message: None,
            },
            posdb::SyncResultInput {
                client_key: "key-b".to_string(),
                status: "conflict".to_string(),
                message: Some("Stok berubah".to_string()),
            },
        ])));
        let mut events = Vec::new();
        let summary = drain_outbox(&mut conn, &config(), &transport, NOW, &mut |event| {
            events.push(event)
        });
        assert_eq!(summary.synced, 1);
        assert_eq!(summary.held, 1);
        assert_eq!(summary.remaining, 0);
        let live = posdb::list_outbox(&conn, None).expect("live");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].client_key, "key-b");
        assert!(events.iter().any(|e| matches!(e, EngineEvent::PassFinished { .. })));
    }

    #[test]
    fn drain_recovers_orphaned_inflight_before_sending() {
        let mut conn = memory_db();
        seed_sale(&mut conn, "key-orphan");
        // Simulasikan proses mati sesudah klaim: item tertinggal inflight.
        let claimed = posdb::claim_pending(&mut conn, 10, NOW).expect("claim");
        assert_eq!(claimed.len(), 1);
        let transport = FakeTransport::new();
        transport.sync_behavior.borrow_mut().push(Ok(outcome(vec![
            posdb::SyncResultInput {
                client_key: "key-orphan".to_string(),
                status: "duplicate".to_string(),
                message: None,
            },
        ])));
        let summary = drain_outbox(&mut conn, &config(), &transport, NOW, &mut |_| {});
        assert_eq!(summary.synced, 1, "duplicate dihitung selesai");
        assert_eq!(summary.remaining, 0);
    }

    #[test]
    fn drain_stops_on_unauthorized_and_reverts_claim() {
        let mut conn = memory_db();
        seed_sale(&mut conn, "key-auth");
        let transport = FakeTransport::new();
        transport
            .sync_behavior
            .borrow_mut()
            .push(Err(TransportError::Unauthorized("tidak dikenal".to_string())));
        let mut auth_event = false;
        let summary = drain_outbox(&mut conn, &config(), &transport, NOW, &mut |event| {
            if matches!(event, EngineEvent::AuthFailed { .. }) {
                auth_event = true;
            }
        });
        assert!(summary.auth_failed);
        assert!(auth_event);
        let live = posdb::list_outbox(&conn, None).expect("live");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].status, "pending", "klaim dikembalikan, item tidak hilang");
        assert_eq!(live[0].attempts, 0);
    }

    #[test]
    fn refresh_applies_delta_with_stored_cursor() {
        let mut conn = memory_db();
        posdb::apply_snapshot(&mut conn, &snapshot_fixture()).expect("seed snapshot");
        let transport = FakeTransport::new();
        *transport.snapshot.borrow_mut() = Some(Ok(SnapshotWire::Delta(
            posdb::SnapshotDeltaInput {
                version: "2026-11-07T01:00:00.000Z".to_string(),
                cursor: "2026-11-07T01:00:00.000Z".to_string(),
                base_cursor: "2026-11-07T00:00:00.000Z".to_string(),
                generated_at: "2026-11-07T01:00:00.000Z".to_string(),
                warehouse: Some(SnapshotWarehouseInput {
                    id: "wh-1".to_string(),
                    code: "GDG".to_string(),
                    name: "Gudang".to_string(),
                }),
                payment_methods: vec![],
                products: vec![],
                removed_product_ids: vec!["prod-1".to_string()],
                receipt: None,
                terminal: None,
                names: None,
            },
        )));
        let summary = refresh_snapshot(&mut conn, &config(), &transport, &mut |_| {})
            .expect("refresh");
        assert_eq!(summary.mode, "delta");
        assert_eq!(summary.removed, 1);
        assert_eq!(
            transport.seen_cursors.borrow()[0].as_deref(),
            Some("2026-11-07T00:00:00.000Z"),
            "kursor tersimpan dikirim ke server"
        );
        assert_eq!(posdb::list_products(&conn).expect("products").len(), 0);
    }

    #[test]
    fn drain_sends_session_close_intent_once_and_marks_synced() {
        let mut conn = memory_db();
        posdb::apply_snapshot(&mut conn, &snapshot_fixture()).expect("snapshot");
        posdb::store_terminal_identity(&conn, "term-1", "Kasir 1").expect("identity");
        let session = posdb::open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "50000".to_string(),
                opened_by: Some("kasir-1".to_string()),
                opened_at: "2026-11-07T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        posdb::close_cash_session(&mut conn, &session.id, &[], NOW).expect("close");
        let pending = posdb::pending_intents(&conn, 10).expect("pending");
        assert_eq!(pending.len(), 1);
        let intent_id = pending[0].id.clone();

        let transport = FakeTransport::new();
        transport.sync_behavior.borrow_mut().push(Ok(SyncOutcome {
            results: vec![],
            intent_results: vec![posdb::IntentResultInput {
                client_key: intent_id.clone(),
                status: "recorded".to_string(),
            }],
        }));
        let summary = drain_outbox(&mut conn, &config(), &transport, NOW, &mut |_| {});
        assert_eq!(summary.remaining, 0);
        assert!(!summary.auth_failed);

        // Bentuk kawat: angka menjadi number, identitas terminal tercap.
        let sent = transport.seen_intents.borrow();
        assert_eq!(sent.len(), 1);
        let wire = &sent[0][0];
        assert_eq!(wire["clientKey"], intent_id);
        assert_eq!(wire["openingCash"], 50000.0);
        assert_eq!(wire["expectedCash"], 50000.0);
        assert_eq!(wire["countedCash"], 0.0);
        assert_eq!(wire["terminalId"], "term-1");
        assert_eq!(wire["terminalName"], "Kasir 1");
        assert_eq!(wire["localSessionId"], session.id);

        // Intent selesai lokal — putaran berikutnya tidak mengirim ulang.
        assert!(posdb::pending_intents(&conn, 10).expect("pending2").is_empty());
        let intents = posdb::list_local_intents(&conn).expect("intents");
        assert_eq!(intents[0].status, "synced");
    }

    #[test]
    fn session_open_close_roundtrip_types_align() {
        // Penjaga tipe bersama: sesi dari posdb terbuka/tertutup lewat
        // API yang dipakai command (test penuh perilaku di posdb).
        let mut conn = memory_db();
        posdb::apply_snapshot(&mut conn, &snapshot_fixture()).expect("snapshot");
        let session = posdb::open_cash_session(
            &conn,
            &CashSessionOpenInput {
                warehouse_id: "wh-1".to_string(),
                opening_cash: "50000".to_string(),
                opened_by: None,
                opened_at: "2026-11-07T01:00:00.000Z".to_string(),
            },
        )
        .expect("open");
        let closed = posdb::close_cash_session(&mut conn, &session.id, &[], NOW).expect("close");
        assert_eq!(closed.expected_total.as_deref(), Some("50000"));
    }
}
