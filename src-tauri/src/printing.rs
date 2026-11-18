//! Cetak ESC/POS lokal (Langkah 5, RENCANA-TAURI D6).
//!
//! Byte struk dibangkitkan MURNI di Rust dari penjualan lokal
//! tersimpan (`local_sales`) + konteks snapshot (produk, metode,
//! pengaturan cetak) — di balik antarmuka `PrintTransport` milik
//! kita sendiri, TANPA plugin komunitas. Implementasi produksi
//! mengirim byte mentah lewat TCP ke printer jaringan (port 9100,
//! pola yang disarankan D6); test memakai listener TCP lokal palsu
//! dan transport memori.
//!
//! Semantik antrean (di `posdb`): satu tugas per penjualan dari
//! transaksi pencatatan yang sama (salinan ke-0) + tugas salinan
//! berikutnya per cetak ulang. Pekerja di modul ini mengklaim,
//! membangkitkan byte, mengirim, dan menandai printed/failed —
//! kegagalan printer TIDAK pernah memblokir atau mengubah
//! penjualan; tugas tinggal `failed` dan terlihat di UI.
//!
//! Perhitungan struk mencerminkan jalur web (quote harga beku +
//! halaman nota): harga satuan muatan adalah harga yang benar-benar
//! dibebankan; diskon baris = `lineDiscount` (persen dari bruto /
//! nominal × qty, dijepit [0, bruto]); PPN termasuk harga =
//! `lineTax` inklusif (net × tarif / (100 + tarif)) dengan tarif
//! efektif `taxEnabled ? taxRate : 0`; TOTAL memakai
//! `expectedTotal` muatan bila ada (selisihnya terhadap hitungan
//! baris tampil sebagai baris Pembulatan, persis nota web).
//! Aritmetika uang memakai bilangan bulat skala 10^4 (i128) dengan
//! pembulatan setengah-ke-atas — cermin Decimal.js repo, bukan
//! float.
//!
//! KEBIJAKAN CODEPAGE (tertulis): byte teks harus aman di semua
//! codepage ESC/POS umum, jadi teks DITRANSLITERASI ke ASCII
//! tercetak sebelum dibangkitkan: aksen Latin-1 menjadi huruf
//! dasarnya (é→e, ñ→n, ç→c, ß→ss), tanda × menjadi "x", minus
//! Unicode menjadi "-", elipsis menjadi "..", karakter lain di
//! luar ASCII tercetak menjadi "?". Nama produk Indonesia praktis
//! tidak kehilangan makna oleh kebijakan ini, dan struk tidak
//! pernah bergantung pada codepage yang kebetulan aktif di printer.

use std::collections::HashMap;
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::time::Duration;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::posdb::{
    self, PrintJob, ReceiptSettings, SaleInput,
};

// ---------------------------------------------------------------------------
// Aritmetika desimal skala 10^4 (cermin numeric(19,4) + Decimal.js)
// ---------------------------------------------------------------------------

pub(crate) const SCALE: i128 = 10_000;

/// Parse string desimal ("4000.0000", "11", "-5.5") ke skala 10^4,
/// setengah-ke-atas pada digit ke-5+. Gagal → 0 (pemanggil yang
/// memerlukan validasi memeriksa sumbernya sendiri).
/// `pub(crate)`: dipakai juga `displaymap` (Langkah 8) — satu
/// sumber aritmetika uang untuk struk & layar pelanggan.
pub(crate) fn parse_scaled(text: &str) -> i128 {
    let text = text.trim();
    if text.is_empty() {
        return 0;
    }
    let (sign, digits) = match text.strip_prefix('-') {
        Some(rest) => (-1i128, rest),
        None => (1i128, text.strip_prefix('+').unwrap_or(text)),
    };
    let (int_part, frac_part) = match digits.split_once('.') {
        Some((a, b)) => (a, b),
        None => (digits, ""),
    };
    let int_value: i128 = int_part.parse().unwrap_or(0);
    let mut frac_value: i128 = 0;
    let mut place = SCALE / 10;
    let mut chars = frac_part.chars();
    for _ in 0..4 {
        let digit = chars.next().and_then(|c| c.to_digit(10)).unwrap_or(0) as i128;
        frac_value += digit * place;
        place /= 10;
    }
    // Digit ke-5 menentukan pembulatan setengah-ke-atas.
    if let Some(c) = chars.next() {
        if c.to_digit(10).unwrap_or(0) >= 5 {
            frac_value += 1;
        }
    }
    sign * (int_value * SCALE + frac_value)
}

/// f64 muatan (harga/qty dari JS) ke skala 10^4 lewat representasi
/// 4 desimal — nilai muatan memang lahir dari angka JS.
pub(crate) fn f64_scaled(value: f64) -> i128 {
    if !value.is_finite() {
        return 0;
    }
    parse_scaled(&format!("{value:.4}"))
}

/// Perkalian-pembagian dengan pembulatan setengah-ke-atas
/// (simetris untuk nilai negatif).
pub(crate) fn mul_div_round(value: i128, multiplier: i128, divisor: i128) -> i128 {
    if divisor == 0 {
        return 0;
    }
    let product = value * multiplier;
    let half = divisor.abs() / 2;
    if product >= 0 {
        (product + half) / divisor
    } else {
        (product - half) / divisor
    }
}

/// Format uang cermin `formatIDR` web: bulat penuh setengah-ke-atas,
/// ribuan berpisah ".", awalan "Rp " (negatif "-Rp ").
pub(crate) fn format_rp(scaled: i128) -> String {
    let whole = mul_div_round(scaled, 1, SCALE);
    let negative = whole < 0;
    let digits = whole.abs().to_string();
    let mut grouped = String::new();
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    if negative {
        format!("-Rp {grouped}")
    } else {
        format!("Rp {grouped}")
    }
}

/// Format qty cermin `formatQty` web (id-ID): maks 3 desimal,
/// nol ekor dibuang, koma sebagai pemisah desimal.
pub(crate) fn format_qty(qty: f64) -> String {
    let scaled3 = {
        let text = format!("{qty:.3}");
        parse_scaled(&text) / 10
    };
    let negative = scaled3 < 0;
    let absolute = scaled3.abs();
    let int_part = absolute / 1000;
    let frac_part = absolute % 1000;
    let int_digits = int_part.to_string();
    let mut grouped = String::new();
    for (index, ch) in int_digits.chars().enumerate() {
        if index > 0 && (int_digits.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    let mut out = if negative {
        format!("-{grouped}")
    } else {
        grouped
    };
    if frac_part > 0 {
        let frac = format!("{frac_part:03}");
        out.push(',');
        out.push_str(frac.trim_end_matches('0'));
    }
    out
}

/// "2026-11-07" → "07/11/2026" (format tanggal struk web);
/// bentuk lain diteruskan apa adanya.
fn format_date(iso_date: &str) -> String {
    let parts: Vec<&str> = iso_date.split('-').collect();
    if parts.len() == 3 && parts[0].len() == 4 {
        format!("{}/{}/{}", parts[2], parts[1], parts[0])
    } else {
        iso_date.to_string()
    }
}

// ---------------------------------------------------------------------------
// Transliterasi codepage (kebijakan tertulis di kepala modul)
// ---------------------------------------------------------------------------

fn transliterate(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            ' '..='~' => out.push(ch),
            '\t' => out.push(' '),
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => out.push('a'),
            'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => out.push('A'),
            'è' | 'é' | 'ê' | 'ë' => out.push('e'),
            'È' | 'É' | 'Ê' | 'Ë' => out.push('E'),
            'ì' | 'í' | 'î' | 'ï' => out.push('i'),
            'Ì' | 'Í' | 'Î' | 'Ï' => out.push('I'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => out.push('o'),
            'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => out.push('O'),
            'ù' | 'ú' | 'û' | 'ü' => out.push('u'),
            'Ù' | 'Ú' | 'Û' | 'Ü' => out.push('U'),
            'ý' | 'ÿ' => out.push('y'),
            'Ý' | 'Ÿ' => out.push('Y'),
            'ñ' => out.push('n'),
            'Ñ' => out.push('N'),
            'ç' => out.push('c'),
            'Ç' => out.push('C'),
            'ß' => out.push_str("ss"),
            '×' => out.push('x'),
            '−' | '–' | '—' => out.push('-'),
            '…' => out.push_str(".."),
            '“' | '”' => out.push('"'),
            '‘' | '’' => out.push('\''),
            '\n' | '\r' => out.push(' '),
            _ => out.push('?'),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Pembangun byte ESC/POS
// ---------------------------------------------------------------------------

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

struct EscPosBuilder {
    buf: Vec<u8>,
    cols: usize,
}

impl EscPosBuilder {
    fn new(columns: usize) -> Self {
        EscPosBuilder {
            buf: Vec::new(),
            cols: columns.max(16),
        }
    }

    fn raw(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    fn init(&mut self) {
        // ESC @ (inisialisasi) + ESC t 0 (codepage PC437 — teks
        // sudah ASCII oleh transliterasi, jadi pilihan ini hanya
        // penentu deterministik).
        self.raw(&[ESC, b'@', ESC, b't', 0]);
    }

    fn align(&mut self, mode: u8) {
        self.raw(&[ESC, b'a', mode]);
    }

    fn bold(&mut self, on: bool) {
        self.raw(&[ESC, b'E', if on { 1 } else { 0 }]);
    }

    fn double_size(&mut self, on: bool) {
        self.raw(&[GS, b'!', if on { 0x11 } else { 0x00 }]);
    }

    fn line(&mut self, text: &str) {
        self.buf.extend_from_slice(transliterate(text).as_bytes());
        self.buf.push(b'\n');
    }

    /// Bungkus kata pada lebar kolom; kata yang lebih panjang dari
    /// kolom dipecah keras (nama produk tidak pernah meluber).
    fn wrapped(&self, text: &str) -> Vec<String> {
        let clean = transliterate(text);
        let mut lines: Vec<String> = Vec::new();
        let mut current = String::new();
        for word in clean.split_whitespace() {
            let mut rest = word;
            loop {
                let room = self.cols - current.len();
                if current.is_empty() {
                    if rest.len() <= self.cols {
                        current = rest.to_string();
                        break;
                    }
                    lines.push(rest[..self.cols].to_string());
                    rest = &rest[self.cols..];
                } else if rest.len() + 1 <= room {
                    current.push(' ');
                    current.push_str(rest);
                    break;
                } else if rest.len() > self.cols {
                    // Kata raksasa: isi sisa baris lalu lanjut pecah.
                    let take = room.saturating_sub(1);
                    if take > 0 {
                        current.push(' ');
                        current.push_str(&rest[..take]);
                        rest = &rest[take..];
                    }
                    lines.push(std::mem::take(&mut current));
                } else {
                    lines.push(std::mem::take(&mut current));
                }
            }
        }
        if !current.is_empty() || lines.is_empty() {
            lines.push(current);
        }
        lines
    }

    fn centered(&mut self, text: &str) {
        for line in self.wrapped(text) {
            let pad = (self.cols - line.len()) / 2;
            let padded = format!("{}{}", " ".repeat(pad), line);
            self.line(&padded);
        }
    }

    fn separator(&mut self) {
        self.line(&"-".repeat(self.cols));
    }

    /// Baris label–nilai dua kolom (pola nota web): nilai rata
    /// kanan; bila tak muat sebaris, nilai turun ke baris berikut
    /// rata kanan.
    fn kv(&mut self, label: &str, value: &str) {
        let label = transliterate(label);
        let value = transliterate(value);
        if label.len() + 1 + value.len() <= self.cols {
            let spaces = self.cols - label.len() - value.len();
            self.line(&format!("{}{}{}", label, " ".repeat(spaces), value));
        } else {
            self.line(&label);
            let pad = self.cols.saturating_sub(value.len());
            self.line(&format!("{}{}", " ".repeat(pad), value));
        }
    }

    fn feed_and_cut(&mut self) {
        self.raw(&[ESC, b'd', 3]); // umpan 3 baris
        self.raw(&[GS, b'V', 1]); // potong sebagian
    }
}

/// Byte tendangan laci kas (ESC p 0, 25/250) — pin laci pada
/// konektor RJ11 printer; dikirim dalam aliran tugas yang sama
/// untuk penjualan tunai, atau berdiri sendiri untuk buka laci
/// beralasan.
pub fn drawer_kick_bytes() -> Vec<u8> {
    vec![ESC, b'p', 0, 25, 250]
}

// ---------------------------------------------------------------------------
// Konteks & perhitungan struk
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReceiptContext {
    pub settings: ReceiptSettings,
    /// product_id → (nama, harga jual string snapshot, kode satuan dasar)
    pub products: HashMap<String, (String, String, Option<String>)>,
    /// packaging_id → nama kemasan (S5) — untuk frasa satuan input
    /// struk; faktor & harga datang dari cuplikan muatan sendiri.
    pub packagings: HashMap<String, String>,
    /// method_id → (nama, tipe)
    pub methods: HashMap<String, (String, String)>,
    /// Direktori nama snapshot (Langkah 6): user_id → nama kasir.
    pub cashier_names: HashMap<String, String>,
    /// Direktori nama snapshot (Langkah 6): customer_id → nama.
    pub customer_names: HashMap<String, String>,
}

/// Muat konteks cetak dari DB lokal: pengaturan cetak snapshot
/// (atau bawaan bila belum ada) + katalog & metode snapshot.
impl ReceiptContext {
    /// Konteks cadangan bila snapshot belum pernah diterapkan:
    /// pengaturan bawaan; nama produk/metode jatuh ke id-nya.
    pub fn fallback() -> Self {
        ReceiptContext {
            settings: ReceiptSettings::default(),
            products: HashMap::new(),
            packagings: HashMap::new(),
            methods: HashMap::new(),
            cashier_names: HashMap::new(),
            customer_names: HashMap::new(),
        }
    }
}

pub fn load_receipt_context(conn: &Connection) -> posdb::DbResult<ReceiptContext> {
    let settings = posdb::receipt_settings(conn)?.unwrap_or_default();
    let mut products = HashMap::new();
    let mut packagings = HashMap::new();
    for product in posdb::list_products(conn)? {
        for packaging in &product.packagings {
            packagings.insert(packaging.packaging_id.clone(), packaging.name.clone());
        }
        products.insert(
            product.product_id,
            (product.name, product.sale_price, product.unit_code),
        );
    }
    let mut methods = HashMap::new();
    for method in posdb::list_payment_methods(conn)? {
        methods.insert(method.method_id, (method.name, method.method_type));
    }
    let cashier_names: HashMap<String, String> =
        posdb::snapshot_names(conn, "cashier")?.into_iter().collect();
    let customer_names: HashMap<String, String> =
        posdb::snapshot_names(conn, "customer")?.into_iter().collect();
    Ok(ReceiptContext {
        settings,
        products,
        packagings,
        methods,
        cashier_names,
        customer_names,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReceiptLineCalc {
    pub name: String,
    pub qty: f64,
    pub unit_price: i128,
    pub gross: i128,
    pub discount: i128,
    pub net: i128,
    /// S5: nama kemasan baris (None = satuan dasar) — frasa struk
    /// memakai bentuk input, bukan qty satuan dasar.
    pub packaging_name: Option<String>,
    /// S5: faktor cuplikan baris (isi per kemasan saat transaksi).
    pub isi_snapshot: Option<f64>,
    /// Kode satuan dasar produk (untuk "(= 40 Pcs)").
    pub unit_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReceiptCalc {
    pub lines: Vec<ReceiptLineCalc>,
    pub subtotal: i128,
    pub discount_total: i128,
    pub tax_total: i128,
    pub computed_total: i128,
    /// expectedTotal − hitungan baris (baris Pembulatan nota web).
    pub rounding: i128,
    pub total: i128,
    pub paid: i128,
    pub change: i128,
    pub debt: i128,
    pub has_cash: bool,
}

/// Hitung struk dari muatan + konteks — cermin quote harga beku
/// server (lihat kepala modul untuk rujukan rumusnya).
pub fn compute_receipt(sale: &SaleInput, ctx: &ReceiptContext) -> ReceiptCalc {
    let rate = if ctx.settings.tax_enabled {
        parse_scaled(&ctx.settings.tax_rate)
    } else {
        0
    };
    let mut lines = Vec::new();
    let mut subtotal: i128 = 0;
    let mut discount_total: i128 = 0;
    let mut tax_total: i128 = 0;
    for line in &sale.lines {
        let (name, snapshot_price, unit_code) = ctx
            .products
            .get(&line.product_id)
            .cloned()
            .unwrap_or_else(|| (line.product_id.clone(), "0".to_string(), None));
        let unit_price = match line.unit_price {
            Some(value) => f64_scaled(value),
            None => parse_scaled(&snapshot_price),
        };
        // S5: baris berkemasan — qty & unit_price muatan SUDAH
        // berbentuk per kemasan (qty input × harga per kemasan),
        // jadi aritmetika bruto di bawah tidak berubah sama sekali;
        // yang berbeda hanya frasa cetaknya. Nama kemasan dari
        // snapshot lokal; kemasan yang sudah tidak dikenal jatuh
        // ke label generik (faktornya tetap cuplikan muatan).
        let packaging_name = line.packaging_id.as_ref().map(|packaging_id| {
            ctx.packagings
                .get(packaging_id)
                .cloned()
                .unwrap_or_else(|| "Kemasan".to_string())
        });
        let qty3 = parse_scaled(&format!("{:.3}", line.qty)) / 10;
        let gross = mul_div_round(qty3, unit_price, 1000);
        let discount_raw = match line.discount_type.as_deref() {
            Some("percent") => {
                let value = f64_scaled(line.discount_value.unwrap_or(0.0));
                mul_div_round(gross, value, 100 * SCALE)
            }
            Some("nominal") => {
                let value = f64_scaled(line.discount_value.unwrap_or(0.0));
                mul_div_round(value, qty3, 1000)
            }
            _ => 0,
        };
        let discount = discount_raw.clamp(0, gross);
        let net = gross - discount;
        // lineTax inklusif: net × tarif / (100 + tarif).
        let tax = if rate > 0 {
            mul_div_round(net, rate, 100 * SCALE + rate)
        } else {
            0
        };
        subtotal += gross;
        discount_total += discount;
        tax_total += tax;
        lines.push(ReceiptLineCalc {
            name,
            qty: line.qty,
            unit_price,
            gross,
            discount,
            net,
            packaging_name,
            isi_snapshot: line.isi_snapshot,
            unit_code,
        });
    }
    let computed_total = subtotal - discount_total;
    let (total, rounding) = match sale.expected_total {
        Some(expected) => {
            let expected_scaled = f64_scaled(expected);
            (expected_scaled, expected_scaled - computed_total)
        }
        None => (computed_total, 0),
    };
    let mut paid: i128 = 0;
    let mut change: i128 = 0;
    let mut has_cash = false;
    for payment in &sale.payments {
        let amount = f64_scaled(payment.amount);
        paid += amount;
        let method_type = ctx
            .methods
            .get(&payment.method_id)
            .map(|(_, kind)| kind.as_str())
            .unwrap_or("");
        if method_type == "cash" {
            has_cash = true;
            let tendered = f64_scaled(payment.tendered);
            if tendered > amount {
                change += tendered - amount;
            }
        }
    }
    ReceiptCalc {
        lines,
        subtotal,
        discount_total,
        tax_total,
        computed_total,
        rounding,
        total,
        paid,
        change,
        debt: (total - paid).max(0),
        has_cash,
    }
}

// ---------------------------------------------------------------------------
// Pembangkitan byte struk
// ---------------------------------------------------------------------------

/// Bangun byte ESC/POS lengkap untuk satu penjualan lokal.
/// `copy_index` 0 = cetakan asli; ≥1 berpita SALINAN (cermin
/// parameter salinan=1 nota web). Tendangan laci menempel di akhir
/// aliran yang sama HANYA bila ada pembayaran tunai.
pub fn build_receipt_bytes(sale: &SaleInput, ctx: &ReceiptContext, copy_index: i64, columns: usize) -> Vec<u8> {
    let calc = compute_receipt(sale, ctx);
    let settings = &ctx.settings;
    let mut b = EscPosBuilder::new(columns);

    b.init();
    // Kop: nama toko menonjol, lalu teks kop/alamat/telepon terpusat
    // (PrintHeader varian receipt yang sama dengan nota web).
    b.align(1);
    b.bold(true);
    b.double_size(true);
    for line in b.wrapped(&settings.company_name) {
        let pad = (b.cols - line.len()) / 2;
        b.line(&format!("{}{}", " ".repeat(pad), line));
    }
    b.double_size(false);
    b.bold(false);
    if let Some(header) = settings.header_text.as_deref().filter(|t| !t.trim().is_empty()) {
        b.centered(header);
    }
    if let Some(address) = settings.address.as_deref().filter(|t| !t.trim().is_empty()) {
        b.centered(address);
    }
    if let Some(phone) = settings.phone.as_deref().filter(|t| !t.trim().is_empty()) {
        b.centered(phone);
    }
    b.align(0);
    b.separator();

    if copy_index > 0 {
        b.align(1);
        b.bold(true);
        b.line("SALINAN");
        b.bold(false);
        b.line("- BUKAN NOTA ASLI -");
        b.align(0);
        b.separator();
    }

    // Blok info nota (pola nota web): Ref lokal, Tanggal, Kasir,
    // Sesi (8 karakter awal id sesi — konvensi H-POS-05), NPWP,
    // Pelanggan, Jatuh tempo.
    let ref_short: String = sale.client_key.chars().take(8).collect();
    b.kv("Ref", &ref_short);
    b.kv("Tanggal", &format_date(&sale.date));
    if settings.show_cashier {
        if let Some(cashier) = sale.cashier_id.as_deref().filter(|v| !v.is_empty()) {
            // Langkah 6: nama kasir dari direktori snapshot; id
            // hanya cadangan bila direktori belum mengenalnya.
            let display = ctx
                .cashier_names
                .get(cashier)
                .map(String::as_str)
                .unwrap_or(cashier);
            b.kv("Kasir", display);
        }
    }
    if settings.show_session {
        if let Some(session) = sale.origin_session_id.as_deref().filter(|v| !v.is_empty()) {
            let short: String = session.chars().take(8).collect();
            b.kv("Sesi", &short);
        }
    }
    if let Some(tax_id) = settings.tax_id.as_deref().filter(|t| !t.trim().is_empty()) {
        b.kv("NPWP", tax_id);
    }
    if settings.show_customer {
        if let Some(customer) = sale.customer_id.as_deref().filter(|v| !v.is_empty()) {
            // Langkah 6: nama pelanggan dari direktori snapshot
            // (menutup catatan Langkah 5); id pendek hanya cadangan.
            match ctx.customer_names.get(customer) {
                Some(name) => b.kv("Pelanggan", name),
                None => {
                    let short: String = customer.chars().take(8).collect();
                    b.kv("Pelanggan", &short);
                }
            }
        }
    }
    if let Some(due) = sale.due_date.as_deref().filter(|v| !v.is_empty()) {
        b.kv("Jatuh tempo", &format_date(due));
    }
    b.separator();

    // Baris item: nama (dibungkus per lebar kertas), lalu frasa
    // qty × harga (− diskon) rata kiri dengan total baris rata
    // kanan — tata letak nota web. Baris berkemasan (S5) memakai
    // bentuk INPUT persis nota web: "1 Dus x Rp 145.000
    // (= 40 Pcs)" — qty dasar hasil konversi cuplikan muatan.
    for line in &calc.lines {
        for name_line in b.wrapped(&line.name) {
            b.line(&name_line);
        }
        let mut phrase = match (&line.packaging_name, line.isi_snapshot) {
            (Some(packaging_name), Some(isi)) => {
                let base_qty = format_qty(line.qty * isi);
                let unit = line
                    .unit_code
                    .as_deref()
                    .filter(|code| !code.trim().is_empty())
                    .map(|code| format!(" {code}"))
                    .unwrap_or_default();
                format!(
                    "  {} {} x {} (= {}{})",
                    format_qty(line.qty),
                    packaging_name,
                    format_rp(line.unit_price),
                    base_qty,
                    unit,
                )
            }
            _ => format!(
                "  {} x {}",
                format_qty(line.qty),
                format_rp(line.unit_price)
            ),
        };
        if line.discount > 0 {
            phrase.push_str(&format!(" -{}", format_rp(line.discount)));
        }
        b.kv(&phrase, &format_rp(line.net));
    }
    b.separator();

    b.kv("Subtotal", &format_rp(calc.subtotal));
    if calc.discount_total > 0 {
        b.kv("Diskon", &format!("-{}", format_rp(calc.discount_total)));
    }
    if settings.show_tax && calc.tax_total > 0 {
        b.kv("termasuk PPN", &format_rp(calc.tax_total));
    }
    if calc.rounding != 0 {
        let sign = if calc.rounding > 0 { "+" } else { "-" };
        b.kv("Pembulatan", &format!("{sign}{}", format_rp(calc.rounding.abs())));
    }
    b.bold(true);
    b.kv("TOTAL", &format_rp(calc.total));
    b.bold(false);

    for payment in &sale.payments {
        let (name, method_type) = ctx
            .methods
            .get(&payment.method_id)
            .cloned()
            .unwrap_or_else(|| ("Pembayaran".to_string(), String::new()));
        b.kv(&name, &format_rp(f64_scaled(payment.amount)));
        if method_type == "cash" && payment.tendered > payment.amount {
            b.kv("Diterima", &format_rp(f64_scaled(payment.tendered)));
        }
        if let Some(reference) = payment.reference.as_deref().filter(|v| !v.is_empty()) {
            b.kv("Ref.", reference);
        }
    }
    if calc.change > 0 {
        b.kv("Kembalian", &format_rp(calc.change));
    }
    if calc.debt > 0 {
        b.kv("Sisa utang", &format_rp(calc.debt));
    }
    b.separator();

    // Kaki nota (PrintFooter varian receipt): teks kaki perusahaan
    // atau bawaan web yang sama, baris merek bila saklarnya hidup,
    // dan referensi dokumen lokal.
    b.align(1);
    let footer = settings
        .footer_text
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or("Terima kasih telah berbelanja");
    b.centered(footer);
    if settings.show_branding {
        b.centered("Dicetak dari Bisa ERP");
    }
    b.centered(&format!("Ref: {}", sale.client_key));
    b.align(0);

    b.feed_and_cut();
    if calc.has_cash {
        b.raw(&drawer_kick_bytes());
    }
    b.buf
}

/// Byte struk TES untuk tombol "Tes cetak" pengaturan: kop toko +
/// penanda tes + waktu, tanpa data penjualan dan tanpa tendangan
/// laci.
pub fn build_test_bytes(settings: &ReceiptSettings, columns: usize, at_text: &str) -> Vec<u8> {
    let mut b = EscPosBuilder::new(columns);
    b.init();
    b.align(1);
    b.bold(true);
    b.double_size(true);
    for line in b.wrapped(&settings.company_name) {
        let pad = (b.cols - line.len()) / 2;
        b.line(&format!("{}{}", " ".repeat(pad), line));
    }
    b.double_size(false);
    b.bold(false);
    b.centered("TES CETAK");
    b.centered(at_text);
    b.align(0);
    b.separator();
    b.centered("Printer ESC/POS terhubung.");
    b.feed_and_cut();
    b.buf
}

// ---------------------------------------------------------------------------
// Transport cetak
// ---------------------------------------------------------------------------

/// Permukaan kirim byte cetak. Implementasi produksi TCP di bawah;
/// test memakai listener lokal / penangkap memori.
pub trait PrintTransport {
    fn send(&self, bytes: &[u8]) -> Result<(), String>;
}

/// Transport TCP mentah ke printer jaringan (port baku 9100) —
/// jalur utama D6: tanpa driver, byte ESC/POS apa adanya.
pub struct TcpPrintTransport {
    pub host: String,
    pub port: u16,
    pub connect_timeout: Duration,
    pub write_timeout: Duration,
}

/// Kirim ESC/POS melalui antrean lokal CUPS yang telah dikonfigurasi
/// oleh sistem (umumnya printer USB). Gunakan CUPS 2.x dengan antrean
/// raw; dukungan antrean raw di CUPS 3 telah dihapus.
pub struct CupsPrintTransport {
    pub queue: String,
}

/// Transport perangkat karakter (USB/Bluetooth) yang diekspos Sistem
/// Operasi sebagai node `/dev/usb/lp0`, `/dev/rfcomm0`, COM7, dll.
/// Byte ESC/POS ditulis apa adanya tanpa driver atau CUPS.
pub struct FileDevicePrintTransport {
    pub path: std::path::PathBuf,
}

impl FileDevicePrintTransport {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self { path }
    }
}

impl PrintTransport for FileDevicePrintTransport {
    fn send(&self, bytes: &[u8]) -> Result<(), String> {
        let raw = self.path.to_string_lossy().trim().to_string();
        if raw.is_empty() {
            return Err("Path perangkat printer kosong.".to_string());
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&self.path)
            .map_err(|error| format!("Gagal membuka perangkat printer {raw}: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("Gagal menulis ke perangkat printer {raw}: {error}"))?;
        file.flush()
            .map_err(|error| format!("Gagal menyiram perangkat printer {raw}: {error}"))
    }
}

impl CupsPrintTransport {
    pub fn new(queue: String) -> Self {
        CupsPrintTransport { queue }
    }
}

pub fn list_cups_printers() -> Result<Vec<String>, String> {
    let output = Command::new("lpstat")
        .args(["-p"])
        .output()
        .map_err(|error| format!("CUPS belum tersedia (lpstat): {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "CUPS tidak dapat membaca daftar antrean printer.".to_string()
        } else {
            message
        });
    }
    let printers = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix("printer "))
        .filter_map(|rest| rest.split_whitespace().next())
        .filter(|name| crate::device::valid_cups_queue_name(name))
        .map(str::to_string)
        .collect::<Vec<_>>();
    Ok(printers)
}

impl TcpPrintTransport {
    pub fn new(host: String, port: u16) -> Self {
        TcpPrintTransport {
            host,
            port,
            connect_timeout: Duration::from_secs(3),
            write_timeout: Duration::from_secs(5),
        }
    }
}

impl PrintTransport for TcpPrintTransport {
    fn send(&self, bytes: &[u8]) -> Result<(), String> {
        let address = (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|error| format!("Alamat printer tidak dikenal: {error}"))?
            .next()
            .ok_or_else(|| "Alamat printer tidak dikenal.".to_string())?;
        let mut stream = TcpStream::connect_timeout(&address, self.connect_timeout)
            .map_err(|error| format!("Printer tidak terjangkau di {}:{}: {error}", self.host, self.port))?;
        stream
            .set_write_timeout(Some(self.write_timeout))
            .map_err(|error| error.to_string())?;
        stream
            .write_all(bytes)
            .map_err(|error| format!("Gagal mengirim ke printer: {error}"))?;
        stream
            .flush()
            .map_err(|error| format!("Gagal mengirim ke printer: {error}"))?;
        // Tutup sisi tulis agar penerima (printer / listener uji)
        // tahu tugas selesai; koneksi lalu dilepas.
        let _ = stream.shutdown(std::net::Shutdown::Write);
        Ok(())
    }
}

impl PrintTransport for CupsPrintTransport {
    fn send(&self, bytes: &[u8]) -> Result<(), String> {
        if !crate::device::valid_cups_queue_name(&self.queue) {
            return Err("Nama antrean CUPS tidak valid.".to_string());
        }
        let mut child = Command::new("lp")
            .arg("-d")
            .arg(&self.queue)
            .args(["-o", "raw", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Perintah CUPS lp tidak tersedia: {error}"))?;
        let write_result = child
            .stdin
            .take()
            .ok_or_else(|| "Input antrean CUPS tidak tersedia.".to_string())?
            .write_all(bytes);
        if let Err(error) = write_result {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Gagal mengirim struk ke antrean CUPS: {error}"));
        }
        let output = child
            .wait_with_output()
            .map_err(|error| format!("Gagal menunggu antrean CUPS: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if message.is_empty() {
                format!("CUPS gagal menerima job untuk antrean {}.", self.queue)
            } else {
                format!("CUPS menolak job pada antrean {}: {message}", self.queue)
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Pekerja antrean cetak (pola syncengine: logika murni + event)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PrintEvent {
    JobPrinted {
        job_id: String,
        client_key: String,
        copy_index: i64,
    },
    JobFailed {
        job_id: String,
        client_key: String,
        message: String,
    },
    ServerJobPrinted {
        job_id: String,
        sale_id: String,
    },
    ServerJobFailed {
        job_id: String,
        sale_id: String,
        message: String,
    },
    PassFinished {
        printed: i64,
        failed: i64,
        pending: i64,
    },
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSummary {
    pub printed: usize,
    pub failed: usize,
    pub pending: i64,
    pub error: Option<String>,
}

const PRINT_BATCH: usize = 20;

/// Satu putaran pekerja cetak: pulihkan klaim yatim, klaim tugas
/// pending, bangun byte dari penjualan tersimpan + konteks
/// snapshot saat ini, kirim, tandai. Satu tugas gagal tidak
/// menghentikan tugas lain; penjualan tidak pernah disentuh.
pub fn run_print_pass(
    conn: &mut Connection,
    transport: &dyn PrintTransport,
    columns: usize,
    now_iso: &str,
    events: &mut dyn FnMut(PrintEvent),
) -> PrintSummary {
    let mut summary = PrintSummary::default();
    let _ = posdb::reset_printing(conn, now_iso);
    let _ = posdb::reset_server_receipt_printing(conn, now_iso);

    // Struk lokal perlu konteks snapshot. Nota server sudah berupa byte
    // ESC/POS otoritatif, jadi antreannya tetap bisa dicetak walau
    // snapshot lokal belum tersedia atau rusak.
    match load_receipt_context(conn) {
        Ok(ctx) => loop {
            let claimed = match posdb::claim_print_jobs(conn, PRINT_BATCH, now_iso) {
                Ok(jobs) => jobs,
                Err(message) => {
                    summary.error = Some(message);
                    break;
                }
            };
            if claimed.is_empty() {
                break;
            }
            for job in &claimed {
                match process_job(conn, &ctx, transport, columns, job, now_iso) {
                    Ok(()) => {
                        summary.printed += 1;
                        events(PrintEvent::JobPrinted {
                            job_id: job.id.clone(),
                            client_key: job.client_key.clone(),
                            copy_index: job.copy_index,
                        });
                    }
                    Err(message) => {
                        summary.failed += 1;
                        events(PrintEvent::JobFailed {
                            job_id: job.id.clone(),
                            client_key: job.client_key.clone(),
                            message,
                        });
                    }
                }
            }
            if claimed.len() < PRINT_BATCH {
                break;
            }
        },
        Err(message) => summary.error = Some(message),
    }

    loop {
        let claimed = match posdb::claim_server_receipt_print_jobs(conn, PRINT_BATCH, now_iso) {
            Ok(jobs) => jobs,
            Err(message) => {
                summary.error.get_or_insert(message);
                break;
            }
        };
        if claimed.is_empty() {
            break;
        }
        for job in &claimed {
            match transport.send(&job.receipt_bytes) {
                Ok(()) => {
                    if let Err(message) = posdb::mark_server_receipt_printed(conn, &job.id, now_iso) {
                        summary.error.get_or_insert(message);
                        summary.failed += 1;
                        continue;
                    }
                    summary.printed += 1;
                    events(PrintEvent::ServerJobPrinted {
                        job_id: job.id.clone(),
                        sale_id: job.sale_id.clone(),
                    });
                }
                Err(message) => {
                    if let Err(mark_error) =
                        posdb::mark_server_receipt_failed(conn, &job.id, &message, now_iso)
                    {
                        summary.error.get_or_insert(mark_error);
                    }
                    summary.failed += 1;
                    events(PrintEvent::ServerJobFailed {
                        job_id: job.id.clone(),
                        sale_id: job.sale_id.clone(),
                        message,
                    });
                }
            }
        }
        if claimed.len() < PRINT_BATCH {
            break;
        }
    }

    let local_pending = posdb::list_print_jobs(conn, None)
        .map(|jobs| {
            jobs.iter()
                .filter(|job| job.status == "pending" || job.status == "printing")
                .count() as i64
        })
        .unwrap_or(-1);
    let server_pending = posdb::list_server_receipt_print_jobs(conn, None)
        .map(|jobs| {
            jobs.iter()
                .filter(|job| job.status == "pending" || job.status == "printing")
                .count() as i64
        })
        .unwrap_or(-1);
    summary.pending = if local_pending < 0 || server_pending < 0 {
        -1
    } else {
        local_pending + server_pending
    };
    events(PrintEvent::PassFinished {
        printed: summary.printed as i64,
        failed: summary.failed as i64,
        pending: summary.pending.max(0),
    });
    summary
}

fn process_job(
    conn: &Connection,
    ctx: &ReceiptContext,
    transport: &dyn PrintTransport,
    columns: usize,
    job: &PrintJob,
    now_iso: &str,
) -> Result<(), String> {
    let record = posdb::get_local_sale(conn, &job.client_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Penjualan lokal tidak ditemukan.".to_string());
    let record = match record {
        Ok(record) => record,
        Err(message) => {
            let _ = posdb::mark_print_job_failed(conn, &job.id, &message, now_iso);
            return Err(message);
        }
    };
    let receipt_context = record.receipt_context.as_ref().unwrap_or(ctx);
    let bytes = build_receipt_bytes(&record.sale, receipt_context, job.copy_index, columns);
    match transport.send(&bytes) {
        Ok(()) => {
            posdb::mark_print_job_printed(conn, &job.id, now_iso)?;
            Ok(())
        }
        Err(message) => {
            let _ = posdb::mark_print_job_failed(conn, &job.id, &message, now_iso);
            Err(message)
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::posdb::{
        SnapshotInput, SnapshotMethodInput, SnapshotProductInput, SnapshotWarehouseInput,
    };
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::mpsc;

    #[test]
    fn file_device_transport_writes_raw_bytes_for_usb_or_bluetooth_node() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("lp0");
        FileDevicePrintTransport::new(path.clone()).send(&[0x1b, 0x40, 0x0a]).expect("send");
        let mut written = Vec::new();
        std::fs::File::open(&path).expect("open").read_to_end(&mut written).expect("read");
        assert_eq!(written, vec![0x1b, 0x40, 0x0a]);
    }

    #[test]
    fn device_path_transport_rejects_empty_path() {
        let err = FileDevicePrintTransport::new(std::path::PathBuf::from("  ")).send(&[1]).unwrap_err();
        assert!(err.to_lowercase().contains("perangkat"));
    }

    fn settings() -> ReceiptSettings {
        ReceiptSettings {
            company_name: "Bisa Minimarket".to_string(),
            address: Some("Jl. Melati No. 21".to_string()),
            phone: Some("021-555-0123".to_string()),
            tax_id: None,
            header_text: None,
            footer_text: None,
            show_cashier: true,
            show_tax: true,
            show_customer: true,
            show_session: true,
            show_branding: true,
            receipt_paper: "thermal80".to_string(),
            tax_enabled: true,
            tax_rate: "11.0000".to_string(),
            rounding_mode: "none".to_string(),
            qris_image: None,
        }
    }

    fn context() -> ReceiptContext {
        let mut products = HashMap::new();
        products.insert(
            "prod-1".to_string(),
            (
                "Aqua Air Mineral 600ml".to_string(),
                "4000.0000".to_string(),
                Some("PCS".to_string()),
            ),
        );
        products.insert(
            "prod-2".to_string(),
            (
                "Beras IR64 5kg".to_string(),
                "66000.0000".to_string(),
                Some("PACK".to_string()),
            ),
        );
        let mut packagings = HashMap::new();
        packagings.insert("pkg-dus-1".to_string(), "Dus".to_string());
        let mut methods = HashMap::new();
        methods.insert("pm-1".to_string(), ("Tunai".to_string(), "cash".to_string()));
        methods.insert("pm-2".to_string(), ("QRIS".to_string(), "qris".to_string()));
        ReceiptContext {
            settings: settings(),
            products,
            packagings,
            methods,
            cashier_names: HashMap::new(),
            customer_names: HashMap::new(),
        }
    }

    fn cash_sale() -> SaleInput {
        SaleInput {
            client_key: "12345678-1234-1234-1234-1234567890ab".to_string(),
            warehouse_id: "wh-1".to_string(),
            held_sale_id: None,
            group_id: None,
            customer_id: None,
            due_date: None,
            date: "2026-11-07".to_string(),
            cashier_id: Some("kasir-1".to_string()),
            origin_session_id: Some("abcdef12-3456-7890-abcd-ef1234567890".to_string()),
            device_id: Some("tauri-desktop".to_string()),
            reservation_id: None,
            expected_total: Some(8000.0),
            lines: vec![posdb::SaleLineInput {
                product_id: "prod-1".to_string(),
                qty: 2.0,
                discount_type: None,
                discount_value: None,
                serial_numbers: None,
                unit_price: Some(4000.0),
                packaging_id: None,
                isi_snapshot: None,
            }],
            payments: vec![posdb::SalePaymentInput {
                method_id: "pm-1".to_string(),
                amount: 8000.0,
                tendered: 10000.0,
                reference: None,
                fee: None,
            }],
            queued_at: "2026-11-07T02:00:00.000Z".to_string(),
        }
    }

    fn text_of(bytes: &[u8]) -> String {
        // Ekstrak teks tercetak dari aliran byte dengan menelan
        // urutan perintah ESC/GS beserta parameternya (jumlah
        // parameter per perintah sesuai yang dipakai pembangkit).
        let mut out = String::new();
        let mut i = 0;
        while i < bytes.len() {
            let b = bytes[i];
            if b == 0x1B && i + 1 < bytes.len() {
                let params = match bytes[i + 1] {
                    b'@' => 0,
                    b't' | b'a' | b'E' | b'd' => 1,
                    b'p' => 3,
                    _ => 0,
                };
                i += 2 + params;
            } else if b == 0x1D && i + 1 < bytes.len() {
                i += 3; // GS <cmd> <param>
            } else {
                if b == b'\n' || (0x20..=0x7E).contains(&b) {
                    out.push(b as char);
                }
                i += 1;
            }
        }
        out
    }

    #[test]
    fn golden_receipt_bytes_cash_80mm() {
        let bytes = build_receipt_bytes(&cash_sale(), &context(), 0, 48);
        let mut e: Vec<u8> = Vec::new();
        let mut text = |e: &mut Vec<u8>, s: &str| e.extend_from_slice(s.as_bytes());
        // Init + codepage.
        e.extend_from_slice(&[0x1B, 0x40, 0x1B, 0x74, 0x00]);
        // Kop terpusat; nama toko bold + ukuran ganda.
        e.extend_from_slice(&[0x1B, 0x61, 0x01]);
        e.extend_from_slice(&[0x1B, 0x45, 0x01, 0x1D, 0x21, 0x11]);
        text(&mut e, &format!("{}Bisa Minimarket\n", " ".repeat(16)));
        e.extend_from_slice(&[0x1D, 0x21, 0x00, 0x1B, 0x45, 0x00]);
        text(&mut e, &format!("{}Jl. Melati No. 21\n", " ".repeat(15)));
        text(&mut e, &format!("{}021-555-0123\n", " ".repeat(18)));
        e.extend_from_slice(&[0x1B, 0x61, 0x00]);
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        // Blok info.
        text(&mut e, &format!("Ref{}12345678\n", " ".repeat(37)));
        text(&mut e, &format!("Tanggal{}07/11/2026\n", " ".repeat(31)));
        text(&mut e, &format!("Kasir{}kasir-1\n", " ".repeat(36)));
        text(&mut e, &format!("Sesi{}abcdef12\n", " ".repeat(36)));
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        // Item.
        text(&mut e, "Aqua Air Mineral 600ml\n");
        text(&mut e, &format!("  2 x Rp 4.000{}Rp 8.000\n", " ".repeat(26)));
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        // Total: subtotal 8000; PPN termasuk 11% = 792,79 → Rp 793.
        text(&mut e, &format!("Subtotal{}Rp 8.000\n", " ".repeat(32)));
        text(&mut e, &format!("termasuk PPN{}Rp 793\n", " ".repeat(30)));
        e.extend_from_slice(&[0x1B, 0x45, 0x01]);
        text(&mut e, &format!("TOTAL{}Rp 8.000\n", " ".repeat(35)));
        e.extend_from_slice(&[0x1B, 0x45, 0x00]);
        text(&mut e, &format!("Tunai{}Rp 8.000\n", " ".repeat(35)));
        text(&mut e, &format!("Diterima{}Rp 10.000\n", " ".repeat(31)));
        text(&mut e, &format!("Kembalian{}Rp 2.000\n", " ".repeat(31)));
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        // Kaki terpusat.
        e.extend_from_slice(&[0x1B, 0x61, 0x01]);
        text(&mut e, &format!("{}Terima kasih telah berbelanja\n", " ".repeat(9)));
        text(&mut e, &format!("{}Dicetak dari Bisa ERP\n", " ".repeat(13)));
        text(&mut e, &format!("{}Ref: 12345678-1234-1234-1234-1234567890ab\n", " ".repeat(3)));
        e.extend_from_slice(&[0x1B, 0x61, 0x00]);
        // Umpan + potong, lalu tendangan laci (tunai).
        e.extend_from_slice(&[0x1B, 0x64, 0x03, 0x1D, 0x56, 0x01]);
        e.extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
        assert_eq!(bytes, e, "byte struk harus persis pola emas");
    }

    #[test]
    fn golden_receipt_bytes_packaging_line_80mm() {
        // S5: baris berkemasan — muatan membawa qty INPUT (1) &
        // harga PER KEMASAN (145.000) + cuplikan isi 40; struk
        // mencetak bentuk input "1 Dus x Rp 145.000 (= 40 PCS)"
        // persis nota web, total dari harga kemasan.
        let mut sale = cash_sale();
        sale.lines = vec![posdb::SaleLineInput {
            product_id: "prod-1".to_string(),
            qty: 1.0,
            discount_type: None,
            discount_value: None,
            serial_numbers: None,
            unit_price: Some(145000.0),
            packaging_id: Some("pkg-dus-1".to_string()),
            isi_snapshot: Some(40.0),
        }];
        sale.expected_total = Some(145000.0);
        sale.payments = vec![posdb::SalePaymentInput {
            method_id: "pm-1".to_string(),
            amount: 145000.0,
            tendered: 150000.0,
            reference: None,
            fee: None,
        }];
        let bytes = build_receipt_bytes(&sale, &context(), 0, 48);
        let mut e: Vec<u8> = Vec::new();
        let mut text = |e: &mut Vec<u8>, s: &str| e.extend_from_slice(s.as_bytes());
        e.extend_from_slice(&[0x1B, 0x40, 0x1B, 0x74, 0x00]);
        e.extend_from_slice(&[0x1B, 0x61, 0x01]);
        e.extend_from_slice(&[0x1B, 0x45, 0x01, 0x1D, 0x21, 0x11]);
        text(&mut e, &format!("{}Bisa Minimarket\n", " ".repeat(16)));
        e.extend_from_slice(&[0x1D, 0x21, 0x00, 0x1B, 0x45, 0x00]);
        text(&mut e, &format!("{}Jl. Melati No. 21\n", " ".repeat(15)));
        text(&mut e, &format!("{}021-555-0123\n", " ".repeat(18)));
        e.extend_from_slice(&[0x1B, 0x61, 0x00]);
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        text(&mut e, &format!("Ref{}12345678\n", " ".repeat(37)));
        text(&mut e, &format!("Tanggal{}07/11/2026\n", " ".repeat(31)));
        text(&mut e, &format!("Kasir{}kasir-1\n", " ".repeat(36)));
        text(&mut e, &format!("Sesi{}abcdef12\n", " ".repeat(36)));
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        // Item berkemasan: frasa bentuk input + total harga dus.
        text(&mut e, "Aqua Air Mineral 600ml\n");
        text(
            &mut e,
            &format!("  1 Dus x Rp 145.000 (= 40 PCS){}Rp 145.000\n", " ".repeat(7)),
        );
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        // Total: subtotal 145.000; PPN termasuk 11% = 14.369,37 → Rp 14.369.
        text(&mut e, &format!("Subtotal{}Rp 145.000\n", " ".repeat(30)));
        text(&mut e, &format!("termasuk PPN{}Rp 14.369\n", " ".repeat(27)));
        e.extend_from_slice(&[0x1B, 0x45, 0x01]);
        text(&mut e, &format!("TOTAL{}Rp 145.000\n", " ".repeat(33)));
        e.extend_from_slice(&[0x1B, 0x45, 0x00]);
        text(&mut e, &format!("Tunai{}Rp 145.000\n", " ".repeat(33)));
        text(&mut e, &format!("Diterima{}Rp 150.000\n", " ".repeat(30)));
        text(&mut e, &format!("Kembalian{}Rp 5.000\n", " ".repeat(31)));
        text(&mut e, &format!("{}\n", "-".repeat(48)));
        e.extend_from_slice(&[0x1B, 0x61, 0x01]);
        text(&mut e, &format!("{}Terima kasih telah berbelanja\n", " ".repeat(9)));
        text(&mut e, &format!("{}Dicetak dari Bisa ERP\n", " ".repeat(13)));
        text(&mut e, &format!("{}Ref: 12345678-1234-1234-1234-1234567890ab\n", " ".repeat(3)));
        e.extend_from_slice(&[0x1B, 0x61, 0x00]);
        e.extend_from_slice(&[0x1B, 0x64, 0x03, 0x1D, 0x56, 0x01]);
        e.extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
        assert_eq!(bytes, e, "byte struk berkemasan harus persis pola emas");

        // Kertas 58mm: frasa kemasan tak muat sebaris → nilai turun
        // ke baris berikut rata kanan (aturan kv yang sama).
        let narrow = text_of(&build_receipt_bytes(&sale, &context(), 0, 32));
        assert!(
            narrow.contains("1 Dus x Rp 145.000 (= 40 PCS)"),
            "frasa kemasan utuh di 58mm: {narrow}"
        );
    }

    #[test]
    fn non_cash_payment_has_no_drawer_kick_and_no_change() {
        let mut sale = cash_sale();
        sale.payments = vec![posdb::SalePaymentInput {
            method_id: "pm-2".to_string(),
            amount: 8000.0,
            tendered: 8000.0,
            reference: Some("QRIS-998877".to_string()),
            fee: None,
        }];
        let bytes = build_receipt_bytes(&sale, &context(), 0, 48);
        assert!(
            !bytes.ends_with(&drawer_kick_bytes()),
            "pembayaran non-tunai tidak boleh menendang laci"
        );
        let text = text_of(&bytes);
        assert!(text.contains("QRIS"), "nama metode dari snapshot: {text}");
        assert!(text.contains("QRIS-998877"), "referensi tercetak: {text}");
        assert!(!text.contains("Kembalian"), "tanpa tunai berlebih, tanpa kembalian");
    }

    #[test]
    fn copy_receipt_carries_salinan_ribbon() {
        let bytes = build_receipt_bytes(&cash_sale(), &context(), 2, 48);
        let text = text_of(&bytes);
        let salinan_at = text.find("SALINAN").expect("pita SALINAN ada");
        let item_at = text.find("Aqua").expect("item ada");
        assert!(salinan_at < item_at, "pita SALINAN sebelum daftar item");
        assert!(text.contains("BUKAN NOTA ASLI"));
        let original = text_of(&build_receipt_bytes(&cash_sale(), &context(), 0, 48));
        assert!(!original.contains("SALINAN"), "cetakan asli tanpa pita");
    }

    #[test]
    fn discount_debt_and_58mm_layout() {
        let mut sale = cash_sale();
        sale.expected_total = None;
        sale.lines = vec![posdb::SaleLineInput {
            product_id: "prod-2".to_string(),
            qty: 1.0,
            discount_type: Some("percent".to_string()),
            discount_value: Some(10.0),
            serial_numbers: None,
            unit_price: Some(66000.0),
            packaging_id: None,
            isi_snapshot: None,
        }];
        sale.payments = vec![posdb::SalePaymentInput {
            method_id: "pm-2".to_string(),
            amount: 50000.0,
            tendered: 50000.0,
            reference: None,
            fee: None,
        }];
        let calc = compute_receipt(&sale, &context());
        assert_eq!(calc.subtotal, 660_000_000);
        assert_eq!(calc.discount_total, 66_000_000);
        assert_eq!(calc.total, 594_000_000);
        assert_eq!(calc.debt, 94_000_000);
        let text = text_of(&build_receipt_bytes(&sale, &context(), 0, 32));
        assert!(text.contains("-Rp 6.600"), "diskon baris pada frasa: {text}");
        assert!(text.contains("Diskon"), "baris diskon total: {text}");
        assert!(text.contains("Sisa utang"), "sisa utang tercetak: {text}");
        assert!(text.contains("Rp 9.400"), "nominal sisa utang: {text}");
        for line in text.lines() {
            assert!(line.len() <= 32, "baris 58mm tidak boleh meluber: {line:?}");
        }
    }

    #[test]
    fn transliteration_keeps_bytes_ascii() {
        let mut ctx = context();
        ctx.products.insert(
            "prod-x".to_string(),
            (
                "Kopi Énak ×2 — 500ml…".to_string(),
                "15000.0000".to_string(),
                None,
            ),
        );
        let mut sale = cash_sale();
        sale.lines = vec![posdb::SaleLineInput {
            product_id: "prod-x".to_string(),
            qty: 1.0,
            discount_type: None,
            discount_value: None,
            serial_numbers: None,
            unit_price: Some(15000.0),
            packaging_id: None,
            isi_snapshot: None,
        }];
        sale.expected_total = Some(15000.0);
        sale.payments[0].amount = 15000.0;
        sale.payments[0].tendered = 15000.0;
        let bytes = build_receipt_bytes(&sale, &ctx, 0, 48);
        // Di luar parameter perintah biner (durasi tendangan laci
        // 0xFA), seluruh aliran adalah ASCII/kontrol — teks tidak
        // pernah membawa byte codepage mentah.
        assert!(bytes.ends_with(&drawer_kick_bytes()));
        let body = &bytes[..bytes.len() - drawer_kick_bytes().len()];
        assert!(
            body.iter().all(|b| *b < 0x80),
            "byte teks di luar tendangan harus ASCII/kontrol"
        );
        let text = text_of(&bytes);
        assert!(text.contains("Kopi Enak x2 - 500ml.."), "transliterasi terbaca: {text}");
    }

    fn snapshot_with_receipt() -> SnapshotInput {
        SnapshotInput {
        loyalty_balances: vec![],
        promotions: vec![],
        kitchen_tickets: vec![],
        reservations: vec![],
            warehouses: vec![],
            version: "v1".to_string(),
            cursor: None,
            generated_at: "2026-11-07T00:00:00.000Z".to_string(),
            warehouse: Some(SnapshotWarehouseInput {
                id: "wh-1".to_string(),
                code: "GDG".to_string(),
                name: "Gudang Utama".to_string(),
            is_default: true,
            }),
            payment_methods: vec![
                SnapshotMethodInput {
                    id: "pm-1".to_string(),
                    code: "CASH".to_string(),
                    name: "Tunai".to_string(),
                    method_type: "cash".to_string(),
                    fee_enabled: false,
                    fee_type: "none".to_string(),
                    fee_value: "0".to_string(),
                },
                SnapshotMethodInput {
                    id: "pm-2".to_string(),
                    code: "QRIS".to_string(),
                    name: "QRIS".to_string(),
                    method_type: "qris".to_string(),
                    fee_enabled: false,
                    fee_type: "none".to_string(),
                    fee_value: "0".to_string(),
                },
            ],
            products: vec![SnapshotProductInput {
                id: "prod-1".to_string(),
                sku: "SKU-1".to_string(),
                barcode: None,
                name: "Aqua Air Mineral 600ml".to_string(),
                category_id: None,
                category_name: None,
                sale_price: "4000.0000".to_string(),
                stock: 10.0,
                track_stock: true,
                track_serial: false,
                unit_code: None,
                packagings: vec![],
            }],
            customer_groups: vec![],
            group_prices: vec![],
            replace_group_price_group_ids: vec![],
            receipt: Some(settings()),
            terminal: None,
            names: None,
            can_discount: false,
            pos_offline_enabled: true,
        }
    }

    fn memory_db_with_sale() -> (Connection, SaleInput) {
        let mut conn = Connection::open_in_memory().expect("memory db");
        posdb::init(&conn).expect("init");
        posdb::apply_snapshot(&mut conn, &snapshot_with_receipt()).expect("snapshot");
        let sale = cash_sale();
        posdb::record_sale(&mut conn, &sale).expect("record");
        (conn, sale)
    }

    #[test]
    fn receipt_shows_names_from_directory_not_ids() {
        // Langkah 6 menutup catatan Langkah 5: struk menampilkan
        // NAMA kasir & pelanggan dari direktori snapshot.
        let mut conn = Connection::open_in_memory().expect("memory db");
        posdb::init(&conn).expect("init");
        let mut snapshot = snapshot_with_receipt();
        snapshot.names = Some(posdb::SnapshotNamesInput {
            cashiers: vec![posdb::NameEntryInput {
                id: "kasir-1".to_string(),
                name: "Sari Kasir".to_string(),
                group_id: None,
            }],
            customers: vec![posdb::NameEntryInput {
                id: "cust-1".to_string(),
                name: "Budi Pelanggan".to_string(),
                group_id: None,
            }],
        });
        posdb::apply_snapshot(&mut conn, &snapshot).expect("snapshot");
        let mut sale = cash_sale();
        sale.customer_id = Some("cust-1".to_string());
        posdb::record_sale(&mut conn, &sale).expect("record");
        let ctx = load_receipt_context(&conn).expect("ctx");
        let bytes = build_receipt_bytes(&sale, &ctx, 0, 48);
        let text = text_of(&bytes);
        assert!(text.contains("Sari Kasir"), "nama kasir tampil: {text}");
        assert!(text.contains("Budi Pelanggan"), "nama pelanggan tampil: {text}");
        assert!(!text.contains("kasir-1"), "id kasir tidak tampil: {text}");
    }

    #[test]
    fn print_pass_sends_bytes_to_tcp_listener_and_marks_printed() {
        let (mut conn, sale) = memory_db_with_sale();
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let port = listener.local_addr().expect("addr").port();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let reader = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut received = Vec::new();
            stream.read_to_end(&mut received).expect("read");
            tx.send(received).expect("send");
        });
        let transport = TcpPrintTransport::new("127.0.0.1".to_string(), port);
        let mut events = Vec::new();
        let summary = run_print_pass(
            &mut conn,
            &transport,
            48,
            "2026-11-07T04:00:00.000Z",
            &mut |event| events.push(event),
        );
        reader.join().expect("reader selesai");
        let received = rx.recv().expect("byte diterima listener");
        assert_eq!(summary.printed, 1);
        assert_eq!(summary.failed, 0);
        let jobs = posdb::list_print_jobs(&conn, Some("printed")).expect("jobs");
        assert_eq!(jobs.len(), 1);
        let ctx = load_receipt_context(&conn).expect("ctx");
        let expected = build_receipt_bytes(&sale, &ctx, 0, 48);
        assert_eq!(received, expected, "byte di kabel = byte pembangkit");
        assert!(
            events.iter().any(|e| matches!(e, PrintEvent::JobPrinted { .. })),
            "event JobPrinted terpancar"
        );
    }

    #[test]
    fn print_pass_dead_printer_marks_failed_and_sale_survives() {
        let (mut conn, _sale) = memory_db_with_sale();
        // Port mati: ikat lalu lepas agar tidak ada pendengar.
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            let port = listener.local_addr().expect("addr").port();
            drop(listener);
            port
        };
        let transport = TcpPrintTransport::new("127.0.0.1".to_string(), port);
        let summary = run_print_pass(
            &mut conn,
            &transport,
            48,
            "2026-11-07T04:00:00.000Z",
            &mut |_| {},
        );
        assert_eq!(summary.printed, 0);
        assert_eq!(summary.failed, 1);
        let failed = posdb::list_print_jobs(&conn, Some("failed")).expect("failed");
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].attempts, 1);
        assert!(
            failed[0]
                .last_error
                .as_deref()
                .unwrap_or("")
                .contains("tidak terjangkau"),
            "galat terakhir tercatat: {:?}",
            failed[0].last_error
        );
        // Penjualan & antrean sinkron TIDAK tersentuh kegagalan cetak.
        let record = posdb::get_local_sale(&conn, "12345678-1234-1234-1234-1234567890ab")
            .expect("sale")
            .expect("penjualan tetap ada");
        assert_eq!(record.sale.client_key, "12345678-1234-1234-1234-1234567890ab");
        assert_eq!(posdb::list_outbox(&conn, None).expect("outbox").len(), 1);
    }

    #[test]
    fn test_bytes_have_marker_and_no_kick() {
        let bytes = build_test_bytes(&settings(), 48, "2026-11-07 11:00");
        let text = text_of(&bytes);
        assert!(text.contains("TES CETAK"));
        assert!(text.contains("Bisa Minimarket"));
        assert!(!bytes.ends_with(&drawer_kick_bytes()));
    }
}
