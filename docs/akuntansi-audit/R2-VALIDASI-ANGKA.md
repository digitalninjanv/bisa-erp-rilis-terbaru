# R2-VALIDASI-ANGKA — Audit Ronde 2 Bagian 3: Validasi Ulang Kebenaran Sesudah FIX-P1

Tanggal: 2026-11-04 · Sifat: **baca-saja** (produksi tidak diubah; skenario berjalan di
perusahaan fixture khusus `…b201/b202/b204/b205` — rollback atau diwipe total sesudah lari;
perusahaan demo hanya dibaca dan utuh: 65 produk, 1 jurnal posted).
Metode: berkas validasi sementara 14 test (dihapus sesudah lari, pola A6) menjalankan fungsi
domain & laporan ASLI dengan **angka skenario baru** — bukan menyalin test agen tahap 1–5.
Hasil lari: **14/14 lulus**.

## Ringkasan vonis 6 uji ulang perbaikan kunci

| # | Perbaikan | Vonis | Bukti angka inti |
|---|---|---|---|
| 1a | Retur ber-pembulatan + utang (AK4-01/AK2-01/AK4-03) | **TERBUKTI-BENAR** | Lihat §1a — potong piutang persis, kas keluar 0 |
| 1b | Perubahan ekuitas rentang tengah (AK2-02) | **TERBUKTI-BENAR** | Opening/closing = neraca di 3 tanggal uji |
| 1c | Cuti tak berbayar di payroll (AK4-05) | **TERBUKTI-BENAR** | Beban & utang potongan tidak menggelembung |
| 1d | Tutup buku tahunan (AK5-04/AK1-05) | **TERBUKTI-BENAR** | P&L tertutup nol; T+1 bersih; tanpa hitung ganda |
| 1e | PPN Masukan (AK1-06/AK4-04) | **TERBUKTI-BENAR** | Saldo 1180 & sisa utang persis hitung tangan |
| 1f | Gerbang periode & race (AK1-01/AK6-02) | **TERBUKTI-BENAR** | 2023 & 2029 ditolak; race 12 poster bersih |

## §1a — Retur kombinasi: pembulatan + penjualan utang + terbayar sebagian

Skenario baru: produk Rp6.300 × 2 = Rp12.600, `nearest_500` → total Rp12.500 (penyesuaian
**−100**, arah rugi). Bayar campuran: tunai 2.500 + utang 10.000; cicilan piutang 3.750 →
`paidTotal` 6.250, sisa piutang 6.250. Retur 1 unit (nilai 6.300; porsi pembulatan −50 →
hak retur **6.250** = persis sisa piutang).

Hasil terukur:
- Jurnal retur **seimbang**; kredit akun piutang **6.250,00**; kredit kas **0,00** dan
  **nol** baris `cash_movements` refund — tidak ada kas keluar atas utang belum lunas.
- Reversi pembulatan benar arah & porsi: kredit 9001 (rugi pembulatan) **50,00**;
  Dr 4020 **6.300,00**; kredit HPP **4.000,00** (biaya asal 1 unit).
- Sesudah retur: `paidTotal` 12.500, status `paid`, dokumen retur total 6.250,
  **saldo GL piutang 0,00**, penjualan hilang dari `listReceivables`, stok kembali 9,
  dan `payReceivable` susulan **ditolak** (`AppError`).

## §1b — Perubahan ekuitas vs neraca (dua rentang, tiga tanggal)

Fixture: 2025 modal 80 jt + laba 15 jt; 2026 laba 12 jt (Feb–Mar).
- Rentang 2026 penuh: `totalOpening` **95.000.000** = neraca 2025-12-31 `totalEquity`;
  `totalClosing` **107.000.000** = neraca 2026-12-31.
- Rentang tengah tahun (Jul–Des 2026): `totalOpening` **107.000.000** = neraca 2026-06-30 —
  laba H1 ikut terbawa sebagai akumulasi, persis perbaikan AK2-02.

## §1c — Payroll cuti tak berbayar, angka baru

Karyawan A: gaji 6.600.000, potongan reguler 275.000, cuti disetujui **3 hari kerja**
(9–11 Nov 2026) × tarif harian 300.000 (6.600.000 ÷ 22) = 900.000. Karyawan B: 3.300.000 penuh.
- Item A: potongan 1.175.000, **bersih 5.425.000** (sama dengan aritmetika slip lama).
- Jurnal run: Dr Beban Gaji **9.000.000** (= bruto 9.900.000 − 900.000, bukan bruto penuh);
  kredit Utang Potongan **275.000 saja** (bukan 1.175.000); kredit Utang Gaji **8.725.000**;
  jurnal seimbang. Residu permanen di akun potongan yang dulu dikeluhkan: tidak terbentuk.

## §1d — Tutup buku tahunan & tahun berikutnya

Fixture 2025: modal 50 jt; penjualan 24 jt; HPP 9,6 jt; beban 4,4 jt → laba 10 jt.
- `previewYearEndClosing(2025).netProfit` = **10.000.000**; sesudah `postYearEndClosing`:
  laba rugi 2025 = **0,00**; neraca 2025-12-31 `totalEquity` **60.000.000**, `balanced: true`.
- Laba rugi 2026 (satu jurnal penjualan 3 jt) = **3.000.000 persis** — tidak ada sisa bocor.
- **Uji silang perbaikan Tahap 2 × Tahap 5**: perubahan ekuitas 2026 `totalOpening`
  **60.000.000** = neraca akhir 2025 — laba yang sudah ditutup ke Laba Ditahan **tidak
  terhitung dua kali** lewat baris "laba akumulasi" baru; `totalClosing` 63.000.000.

## §1e — PPN Masukan gabungan (beli + beban + retur sebagian)

Angka baru: beli kredit 10 × Rp222.000 bruto = 2.220.000 (DPP 2.000.000, PPN 220.000);
beban sewa 3.330.000 termasuk PPN (DPP 3.000.000, PPN 330.000); retur pemasok 4 unit.
- Jurnal penerimaan: Dr Persediaan 2.000.000 + Dr 1180 220.000 / Cr Utang 2.220.000;
  AVCO produk menjadi **200.000** (DPP saja).
- Jurnal retur: Dr Utang **888.000** / Cr Persediaan 800.000 / Cr 1180 **88.000**;
  `supplier_returns.tax_amount` 88.000.
- **Saldo GL 1180 akhir = 462.000** (220.000 + 330.000 − 88.000); sisa utang terbuka
  pemasok **1.332.000**; stok sisa 6 unit. Semua jurnal seimbang.

## §1f — Periode belum termaterialisasi & race penutupan

- `postJournal` bertanggal **2023-05-10** (lampau, tanpa baris) dan **2029-05-10** (di luar
  jendela otomatis) sama-sama ditolak `PERIOD_CLOSED`; `assertPeriodOpen` langsung juga menolak.
- Race: 12 posting paralel vs penutupan periode Aug 2026 pada ±30 ms — **setiap posting
  sukses commit sebelum penutupan selesai** (invariant waktu per poster terpenuhi),
  jumlah jurnal tersimpan = jumlah sukses, dan posting berikutnya ditolak `PERIOD_CLOSED`.
  (Probe ronde 1: 30/36 lolos sesudah tutup; kini 0.)

## §2 — Perburuan sisa di wilayah lemah ronde 1

### AK2-03 (arus kas per jurnal) — MASIH BERLAKU, bukti angka baru tiga lapis
1. **Data demo nyata**: satu-satunya jurnal demo (pembuka, 2026-01-01) menghasilkan laporan
   arus kas Jan 2026: **pendanaan +50.000.000, operasi 0** — saldo awal pembukuan tampil
   sebagai arus pendanaan periode berjalan (bucket `opening|financing` terukur dari
   `getCashFlow` asli).
2. **Jurnal majemuk**: satu jurnal Dr Beban 10 jt + Dr Peralatan 90 jt / Cr Kas 100 jt →
   arus kas Maret: **investasi −100.000.000, operasi 0** — porsi beban operasi 10 jt lenyap
   seluruhnya ke investasi karena kelompok dipilih dari akun lawan berbobot terbesar.
3. Berpadu AK2-04 di skenario yang sama (di bawah): kelompok operasi bulan itu justru
   terisi +120 jt yang bukan operasi — kedua arah salah saji terjadi serentak.

### AK2-04 (fallback kelompok dari rentang kode) — MASIH BERLAKU, terbukti di laporan
Akun wajar **2400 "Utang Bank Jangka Panjang"** tanpa `section`/`cash_flow_group` manual:
pinjaman 5 tahun Rp120 jt diterima tunai →
- Neraca: `totalCurrentLiabilities` **120.000.000**, `totalNonCurrentLiabilities` **0**
  (utang jangka panjang tampil sebagai jangka pendek).
- Arus kas: penerimaan pinjaman masuk **operasi +120.000.000**, pendanaan **0**.
- Fungsi murni: `defaultSection("liability","2400") = current_liability`;
  `resolveCashFlowGroup(2400) = operating`; perbandingan string juga rapuh —
  aset berkode `"999"` terklasifikasi `non_current_asset` ("999" > "1500" leksikografis),
  dan pendapatan bunga berkode 4050 jatuh ke pendapatan operasional.

### AK2-07 (rekonsiliasi kontrol vs subledger) — angka cocok; fungsi bawaan tetap tidak ada
- **Perusahaan demo**: pasca-reseed demo tidak memiliki dokumen piutang/utang sama sekali
  (1 jurnal posted = jurnal pembuka; 0 penjualan, 0 penerimaan, 0 saldo awal pihak), sehingga
  GL piutang = subledger = **0** secara trivial — demo tidak bisa memperagakan rekonsiliasi.
- **Fixture terkendali (skenario §3)**: GL piutang **650.000** = subledger dokumen 650.000;
  GL utang **800.000** = subledger penerimaan terbuka 800.000 = `getSupplierOpenPayable`.
  Pada data yang seluruhnya lewat jalur aplikasi, kontrol dan subledger **konsisten persis**.
- Tetapi produk tetap **tidak memiliki** laporan/penanda rekonsiliasi kontrol-vs-subledger
  bawaan: penyimpangan seperti kasus residu Rp100.000 pada data audit ronde 1 tetap tidak
  akan tertangkap oleh sistem sendiri. Status: celah fungsi P2 ronde 1 **belum tertutup**.

### RV2-01 (P2, BARU — bukti baru AK3-11) — Saldo kas/bank negatif bebas lewat jalur sah
- Bank bersaldo Rp1.000.000 dibebani beban Rp5.000.000 dari akun bank itu: **terposting
  tanpa penolakan/peringatan**, saldo GL bank menjadi **−4.000.000**.
- Pembayaran utang Rp70.000 dari bank **kosong**: terposting, saldo bank **−70.000**.
Tidak ada penjaga saldo, peringatan, maupun saklar konfigurasi untuk perilaku ini di jalur
beban maupun pembayaran utang.

### RV2-02 (P3, BARU — observasi data demo) — Demo pasca-reseed steril untuk akuntansi pihak
Perusahaan demo hasil seed hanya memuat jurnal pembuka (kas 50 jt + persediaan
28.349.600 / modal) tanpa satu pun dokumen penjualan/penerimaan/saldo awal pihak, sehingga
alur piutang/utang/aging/rekonsiliasi tidak dapat didemokan atau diuji-terima dari data
demo bawaan. Bukan cacat hitung — keterbatasan isi demo.

## §3 — Regresi silang: skenario mini setara SIM-2 (fixture terkendali)

Rantai: modal 60 jt → beli kredit 50 × 40.000 → beli tunai 20 × 40.000 → jual tunai
30 × 65.000 → jual utang 10 × 65.000 → retur tunai 2 unit → bayar utang 1.200.000 →
beban gaji manual 3.000.000. Perbandingan dengan hitung tangan:

| Ukuran | Hitung tangan | Sistem | Cocok |
|---|---|---|---|
| Laba bersih Jan 2026 | −2.050.000 | −2.050.000 | ✓ |
| Kas (GL) | 56.820.000 | 56.820.000 | ✓ |
| Persediaan (GL) / stok | 1.280.000 / 32 unit | 1.280.000 / 32 | ✓ |
| Piutang (GL = subledger) | 650.000 | 650.000 | ✓ |
| Utang (GL = subledger) | 800.000 | 800.000 | ✓ |
| Total aset / utang+ekuitas | 58.750.000 / 58.750.000 | sama, `balanced: true` | ✓ |
| Neraca saldo | debit = kredit | debit = kredit | ✓ |

**Vonis: TIDAK ADA REGRESI** dari perbaikan tahap 1–5 pada rantai bisnis inti; retur di
tengah rantai (jalur yang diubah Tahap 1 & 2) menghasilkan angka yang sama dengan
perhitungan manual termasuk reversi HPP pada biaya asal dan re-blend AVCO (40.000 tetap).

## Daftar sisa ronde 1 yang TERKONFIRMASI masih berlaku (dengan bukti ronde ini)
- **AK2-03** (P2) — klasifikasi arus kas satu jurnal satu kelompok: bukti §2 lapis 1–3.
- **AK2-04** (P2) — fallback rentang kode string: bukti laporan + fungsi murni §2.
- **AK2-07** (P2) — rekonsiliasi kontrol vs subledger tidak ada sebagai fungsi produk
  (angka pada data terkendali cocok; deteksi penyimpangan tetap manual).
- **AK3-11** (→ RV2-01, P2) — saldo kas/bank negatif tak dicegah di jalur beban & bayar utang.

## Yang TIDAK diuji ulang ronde ini (tidak diklaim apa pun)
AK3-04 (fee/MDR), AK3-05 (uang muka/DP), AK3-06 (kredit pelanggan tak tampil), AK3-08 s.d.
AK3-10, AK3-12, AK4-07 (retur pelanggan via gudang), AK4-08 (pesangon final pay),
AK4-09 (alur bayar setoran PPh 21/BPJS), AK4-10 (akrual/prepaid), dan seluruh kelompok
P2/P3 UI/UX (AK5) di luar yang sudah diperbaiki sebagai P1.
