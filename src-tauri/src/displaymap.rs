//! Pemetaan MURNI keadaan keranjang jendela utama → muatan layar
//! pelanggan (Langkah 8 — nice-to-have terakhir RENCANA-TAURI).
//!
//! Jendela layar pelanggan tidak memegang token, tidak memanggil
//! HTTP, dan tidak membaca database lokal: ia hanya menerima
//! muatan siap-tampil ini lewat event Tauri `pos-display` (dan
//! command `get_customer_display` saat jendela baru dibuka, agar
//! isinya langsung benar). Semua keputusan isi — mode
//! idle/cart/thanks, baris yang tampil, total — hidup di fungsi
//! murni `map_display` di sini supaya teruji harness tanpa GTK.
//!
//! Aritmetika memakai pembantu skala 10^4 milik `printing`
//! (cermin numeric(19,4) + `formatIDR`/`formatQty` web) — struk
//! dan layar pelanggan tidak boleh berbeda format uang.

use serde::{Deserialize, Serialize};

use crate::printing::{f64_scaled, format_qty, format_rp, mul_div_round, parse_scaled, SCALE};

/// Jumlah baris maksimum yang dikirim ke layar; sisanya diringkas
/// sebagai `more_lines` (layar pelanggan membaca sekilas, bukan
/// daftar audit — struk tetap sumber rincian penuh).
pub const MAX_DISPLAY_LINES: usize = 8;

const FALLBACK_STORE_NAME: &str = "Bisa POS";

// ---------------------------------------------------------------------------
// Masukan (dari jendela utama lewat command `update_customer_display`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCartLine {
    pub name: String,
    pub qty: f64,
    /// Harga satuan sebagai string desimal — persis representasi
    /// snapshot (`LocalProduct.salePrice`), tanpa lewat float.
    pub unit_price: String,
}

/// Fase yang dilaporkan jendela utama: keranjang sedang dirakit
/// (`Cart`) atau penjualan baru saja tuntas dibayar (`Paid`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayPhase {
    Cart,
    Paid,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInput {
    pub store_name: Option<String>,
    pub phase: DisplayPhase,
    pub lines: Vec<DisplayCartLine>,
    /// Total terbayar (string desimal) — hanya dipakai fase Paid.
    pub paid_total: Option<String>,
}

// ---------------------------------------------------------------------------
// Muatan siap-tampil (event `pos-display` / `get_customer_display`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayMode {
    /// Keranjang kosong: sapaan + nama toko.
    Idle,
    /// Keranjang berjalan: baris + total besar.
    Cart,
    /// Penjualan tuntas: ucapan terima kasih + total terbayar.
    Thanks,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayLineView {
    pub name: String,
    pub qty_text: String,
    pub unit_price_text: String,
    pub line_total_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPayload {
    pub mode: DisplayMode,
    pub store_name: String,
    /// Baris sapaan: "Selamat datang" (idle) / "Terima kasih
    /// telah berbelanja" (thanks) / kosong (cart).
    pub headline: String,
    pub lines: Vec<DisplayLineView>,
    /// Baris keranjang yang TIDAK ikut tampil (diringkas).
    pub more_lines: usize,
    /// Total jumlah barang terbaca, mis. "3" / "2,5".
    pub total_qty_text: String,
    pub total_text: String,
}

impl DisplayPayload {
    /// Keadaan awal sebelum jendela utama melaporkan apa pun.
    pub fn idle(store_name: Option<&str>) -> Self {
        DisplayPayload {
            mode: DisplayMode::Idle,
            store_name: clean_store_name(store_name),
            headline: "Selamat datang".to_string(),
            lines: Vec::new(),
            more_lines: 0,
            total_qty_text: "0".to_string(),
            total_text: format_rp(0),
        }
    }
}

fn clean_store_name(store_name: Option<&str>) -> String {
    match store_name.map(str::trim) {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => FALLBACK_STORE_NAME.to_string(),
    }
}

/// Petakan masukan jendela utama menjadi muatan layar pelanggan.
///
/// Aturan:
/// - fase `Paid` selalu menang → mode thanks; baris diabaikan;
///   total = `paid_total` (hilang/tak valid → Rp 0);
/// - fase `Cart` dengan ≥1 baris qty > 0 → mode cart; total per
///   baris dibulatkan dulu (skala 10^4, setengah-ke-atas) lalu
///   dijumlahkan — cermin urutan pembulatan struk;
/// - selain itu → idle.
pub fn map_display(input: &DisplayInput) -> DisplayPayload {
    let store_name = clean_store_name(input.store_name.as_deref());

    if input.phase == DisplayPhase::Paid {
        let total_scaled = input
            .paid_total
            .as_deref()
            .map(parse_scaled)
            .unwrap_or(0);
        return DisplayPayload {
            mode: DisplayMode::Thanks,
            store_name,
            headline: "Terima kasih telah berbelanja".to_string(),
            lines: Vec::new(),
            more_lines: 0,
            total_qty_text: "0".to_string(),
            total_text: format_rp(total_scaled),
        };
    }

    let effective: Vec<&DisplayCartLine> = input
        .lines
        .iter()
        .filter(|line| line.qty.is_finite() && line.qty > 0.0)
        .collect();
    if effective.is_empty() {
        return DisplayPayload::idle(Some(&store_name));
    }

    let mut total_scaled: i128 = 0;
    let mut total_qty: f64 = 0.0;
    let mut views: Vec<DisplayLineView> = Vec::new();
    for line in &effective {
        let unit_scaled = parse_scaled(&line.unit_price);
        let line_total = mul_div_round(unit_scaled * f64_scaled(line.qty), 1, SCALE);
        total_scaled += line_total;
        total_qty += line.qty;
        if views.len() < MAX_DISPLAY_LINES {
            views.push(DisplayLineView {
                name: line.name.trim().to_string(),
                qty_text: format_qty(line.qty),
                unit_price_text: format_rp(unit_scaled),
                line_total_text: format_rp(line_total),
            });
        }
    }

    DisplayPayload {
        mode: DisplayMode::Cart,
        store_name,
        headline: String::new(),
        more_lines: effective.len() - views.len(),
        lines: views,
        total_qty_text: format_qty(total_qty),
        total_text: format_rp(total_scaled),
    }
}

/// Pilih indeks monitor untuk jendela layar pelanggan dari
/// penanda `is_primary` per monitor (glue Tauri yang mengisi):
/// monitor NON-utama pertama bila ada — layar pelanggan memang
/// untuk layar kedua; selain itu monitor pertama (fallback
/// jendela biasa). Daftar kosong → `None` (jangan buka).
pub fn choose_monitor_index(is_primary: &[bool]) -> Option<usize> {
    if is_primary.is_empty() {
        return None;
    }
    is_primary
        .iter()
        .position(|primary| !primary)
        .or(Some(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(name: &str, qty: f64, unit_price: &str) -> DisplayCartLine {
        DisplayCartLine {
            name: name.to_string(),
            qty,
            unit_price: unit_price.to_string(),
        }
    }

    fn cart_input(lines: Vec<DisplayCartLine>) -> DisplayInput {
        DisplayInput {
            store_name: Some("Bisa Minimarket".to_string()),
            phase: DisplayPhase::Cart,
            lines,
            paid_total: None,
        }
    }

    #[test]
    fn empty_cart_maps_to_idle_with_store_greeting() {
        let payload = map_display(&cart_input(vec![]));
        assert_eq!(payload.mode, DisplayMode::Idle);
        assert_eq!(payload.store_name, "Bisa Minimarket");
        assert_eq!(payload.headline, "Selamat datang");
        assert_eq!(payload.total_text, "Rp 0");
        assert!(payload.lines.is_empty());
    }

    #[test]
    fn missing_store_name_falls_back() {
        let mut input = cart_input(vec![]);
        input.store_name = Some("   ".to_string());
        assert_eq!(map_display(&input).store_name, "Bisa POS");
        input.store_name = None;
        assert_eq!(map_display(&input).store_name, "Bisa POS");
    }

    #[test]
    fn cart_lines_and_total_are_computed_per_line() {
        let payload = map_display(&cart_input(vec![
            line("Aqua 600ml", 2.0, "4000.0000"),
            line("Beras 5kg", 1.0, "68500"),
        ]));
        assert_eq!(payload.mode, DisplayMode::Cart);
        assert_eq!(payload.lines.len(), 2);
        assert_eq!(payload.lines[0].qty_text, "2");
        assert_eq!(payload.lines[0].unit_price_text, "Rp 4.000");
        assert_eq!(payload.lines[0].line_total_text, "Rp 8.000");
        assert_eq!(payload.lines[1].line_total_text, "Rp 68.500");
        assert_eq!(payload.total_text, "Rp 76.500");
        assert_eq!(payload.total_qty_text, "3");
        assert_eq!(payload.more_lines, 0);
    }

    #[test]
    fn fractional_qty_uses_decimal_scale_not_float() {
        // 0,5 kg × Rp 40.000 = Rp 20.000 persis — lewat skala 10^4,
        // bukan aritmetika float.
        let payload = map_display(&cart_input(vec![line("Gula curah", 0.5, "40000")]));
        assert_eq!(payload.lines[0].qty_text, "0,5");
        assert_eq!(payload.lines[0].line_total_text, "Rp 20.000");
        assert_eq!(payload.total_qty_text, "0,5");
    }

    #[test]
    fn zero_and_invalid_qty_lines_are_skipped_to_idle() {
        let payload = map_display(&cart_input(vec![
            line("Hantu", 0.0, "1000"),
            line("Negatif", -1.0, "1000"),
            line("NaN", f64::NAN, "1000"),
        ]));
        assert_eq!(payload.mode, DisplayMode::Idle);
    }

    #[test]
    fn lines_beyond_cap_are_summarised_not_dropped_from_total() {
        let lines: Vec<DisplayCartLine> = (0..11)
            .map(|i| line(&format!("Produk {i}"), 1.0, "1000"))
            .collect();
        let payload = map_display(&cart_input(lines));
        assert_eq!(payload.lines.len(), MAX_DISPLAY_LINES);
        assert_eq!(payload.more_lines, 3);
        // Total tetap menghitung SEMUA baris.
        assert_eq!(payload.total_text, "Rp 11.000");
    }

    #[test]
    fn paid_phase_wins_over_lines_and_uses_paid_total() {
        let mut input = cart_input(vec![line("Aqua 600ml", 1.0, "4000")]);
        input.phase = DisplayPhase::Paid;
        input.paid_total = Some("76500.0000".to_string());
        let payload = map_display(&input);
        assert_eq!(payload.mode, DisplayMode::Thanks);
        assert_eq!(payload.headline, "Terima kasih telah berbelanja");
        assert_eq!(payload.total_text, "Rp 76.500");
        assert!(payload.lines.is_empty());
    }

    #[test]
    fn paid_without_total_still_thanks_with_zero() {
        let mut input = cart_input(vec![]);
        input.phase = DisplayPhase::Paid;
        let payload = map_display(&input);
        assert_eq!(payload.mode, DisplayMode::Thanks);
        assert_eq!(payload.total_text, "Rp 0");
    }

    #[test]
    fn monitor_choice_prefers_first_non_primary() {
        assert_eq!(choose_monitor_index(&[]), None);
        assert_eq!(choose_monitor_index(&[true]), Some(0));
        assert_eq!(choose_monitor_index(&[false]), Some(0));
        assert_eq!(choose_monitor_index(&[true, false]), Some(1));
        assert_eq!(choose_monitor_index(&[true, false, false]), Some(1));
        assert_eq!(choose_monitor_index(&[true, true]), Some(0));
    }

    #[test]
    fn payload_serialises_camel_case_for_the_bridge() {
        let payload = map_display(&cart_input(vec![line("Aqua", 1.0, "4000")]));
        let json = serde_json::to_value(&payload).expect("serialise");
        assert_eq!(json["mode"], "cart");
        assert_eq!(json["storeName"], "Bisa Minimarket");
        assert_eq!(json["lines"][0]["lineTotalText"], "Rp 4.000");
        assert_eq!(json["totalText"], "Rp 4.000");
    }
}
