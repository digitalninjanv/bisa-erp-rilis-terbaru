# Spek Fitur Inti — Acuan Kelengkapan Program (dari pengguna, 2026-11-03)

Prinsip yang ditetapkan pengguna: fokusnya **bukan daftar fitur sebanyak mungkin**, melainkan fitur wajib yang **benar-benar berfungsi**, workflow mudah, saling terintegrasi, dan fleksibel dikonfigurasi. Jangan mengorbankan validitas akuntansi dan stok demi fleksibilitas: pengguna bebas mengatur konfigurasi bisnis, sistem tetap menjaga aturan transaksi dan integritas data. Transaksi yang sudah diposting tidak boleh diedit/dihapus diam-diam — koreksi hanya lewat pembatalan, reversal, atau dokumen penyesuaian yang tercatat. Acuan workflow: dokumentasi Odoo 19 dan ERPNext.

Status di bawah adalah pemetaan jujur terhadap kode saat spek diterima (awal Tahap 2), diverifikasi dari audit + kode, bukan klaim fitur.

## 1. POS — Penjualan

| Fitur spek | Status | Catatan / rencana |
|---|---|---|
| Transaksi penjualan (barcode, cari produk, keranjang, qty, harga) | ✅ Ada | Balapan scanner & kartu stok awal termasuk temuan audit — Tahap 3 |
| Pembayaran (tunai, QRIS, transfer, debit, kredit, split) | 🟡 Sebagian | Metode bayar terhubung akun penampung (bisa dikonfigurasi per metode — sesuai spek). Kredit disembunyikan di POS per aturan proyek. Split payment dibuktikan/dilengkapi di Matriks Verifikasi Tahap 3 |
| Diskon (produk, transaksi, harga khusus kelompok) | ✅ Ada | Harga khusus per kelompok pelanggan lengkap; diskon manual kasir perlu batas/izin — Tahap 3 |
| Hold transaction | ✅ Ada, cacat | Kelompok harga hilang saat hold/resume (POS-HOLD-01) — Tahap 3 |
| Retur penjualan (sebagian/penuh, refund, tukar) | ✅ Ada, cacat | Kunci baris anti-kelebihan retur + jurnal tukar barang (POS-RET-01/02) — Tahap 3 |
| Nota penjualan (cetak, invoice, PDF) | 🟡 Sebagian | Cetak nota ada (tampilan pajak ganda POS-RCPT-01 diperbaiki Tahap 3); PDF & template cetak → Print Engine Tahap 4 |
| Manajemen kasir (shift, saldo awal, kas masuk/keluar) | ✅ Ada, cacat | Semantik setoran/penarikan terbalik antar UI/server/laporan (POS-CASH-01) — Tahap 3 |
| Closing kasir (hitung fisik, cocokkan, catat selisih) | ✅ Ada | Selisih kas berjurnal (cash_short/cash_over) |
| Riwayat penjualan (cari, filter, detail, cetak ulang) | ✅ Ada | |
| Offline POS + sinkronisasi otomatis | ❌ Belum ada | Keputusan arsitektur A-2 — Tahap 3 |

Workflow baku: Buka kasir → produk → diskon → pembayaran → cetak nota → stok berkurang → jurnal otomatis. Jurnal POS sudah otomatis dari pemetaan akun (tunai→Kas, QRIS→akun penampung QRIS, dst.).

## 2. Akuntansi — Keuangan

| Fitur spek | Status | Catatan / rencana |
|---|---|---|
| Dashboard keuangan | ✅ Ada | Nilai persediaan kini dari GL (Tahap 1) |
| Chart of Accounts bisa dikustomisasi penuh | ✅ Ada | CRUD + penjaga (Tahap 1); perusahaan bisa punya Kas Utama, Kas Kecil, Bank BCA/BRI, penampung QRIS sebagai akun biasa |
| Jurnal umum (otomatis & manual) | ✅ Ada | Otomatis dari POS/gudang/pembayaran berdasarkan pemetaan akun — sesuai spek, tanpa jurnal manual untuk transaksi operasional |
| Kas & bank (masuk, keluar, transfer, saldo) | ✅ Ada | Transfer + void transfer (Tahap 1) |
| Pendapatan & pengeluaran | ✅ Ada | Beban operasional dengan kategori akun beban; workflow bukti pengeluaran ada |
| Hutang & piutang (parsial/penuh, cicilan) | ✅ Ada | Pembayaran parsial + tanggal pilihan + void pembayaran (Tahap 1) |
| Rekonsiliasi kas/bank | ❌ Belum ada | Impor mutasi + pencocokan — dijadwalkan Tahap 4 |
| Laba rugi, neraca, arus kas, buku besar | ✅ Ada | Dibereskan total di Tahap 1 (filter posted, pembanding, cash_flow_group, saldo normal) |
| Tutup periode | ✅ Ada | Tutup/kunci bertingkat + buka kunci hanya owner beralasan (Tahap 1) |

## 3. Gudang — Inventory

| Fitur spek | Status | Catatan / rencana |
|---|---|---|
| Data produk (SKU, barcode, kategori, harga, satuan) | ✅ Ada | CRUD master lengkap Tahap 2 |
| **Terima barang — skenario A: kredit dari supplier** | ✅ Ada | Stok+, utang+ (jurnal Dr Persediaan/Cr Utang) |
| **Terima barang — skenario B: bayar tunai sekaligus** | ❌ **Belum ada** | **Gap inti spek**: penerimaan saat ini selalu menciptakan utang, termasuk untuk pembelian tunai — persis yang dilarang spek ("tidak menciptakan hutang yang sebenarnya tidak ada"). → Batch G6 Tahap 2: penerimaan dengan pilihan sumber & cara bayar; tunai memilih akun Kas/Bank, jurnal Dr Persediaan/Cr Kas-Bank, tanpa utang |
| **Terima barang — skenario C: tanpa pembelian** (stok awal, bonus, retur pelanggan, penyesuaian) | 🟡 Sebagian | Stok awal lewat impor & penyesuaian ada; penerimaan sebagai dokumen bersumber alasan dengan akun lawan per sumber belum satu alur. → Batch G6: jenis sumber penerimaan (pembelian/stok awal/bonus/retur pelanggan/lainnya), supplier tidak wajib untuk non-pembelian, akun lawan ditentukan sumber (modal persediaan awal untuk stok awal, dst.) |
| Cetak Bukti Penerimaan Barang (GRN) | ❌ Belum ada | → Batch G6 (cetak dokumen penerimaan; template penuh menyusul Print Engine Tahap 4) |
| Field penerimaan lengkap (tanggal, no dokumen, no invoice supplier, jumlah rusak, catatan) | 🟡 Sebagian | Tanggal/no dokumen/catatan ada; nomor invoice supplier & jumlah rusak per baris → G6 |
| Pembelian — Purchase Order | ❌ Belum ada | → Batch G7 Tahap 2: PO dasar (buat PO → terima barang terhadap PO sebagian/penuh → status PO) |
| Supplier (data, riwayat, hutang) | ✅ Ada | |
| Pengeluaran barang beralasan | ✅ Ada | Penyesuaian keluar (rusak/hilang/kedaluwarsa/karantina) |
| Transfer stok antargudang/cabang | ✅ Ada | |
| Penyesuaian stok beralasan & berotorisasi | ✅ Ada | Alasan wajib + izin + audit; void tersedia |
| Stock opname | ✅ Ada | Terkunci anti-race (Tahap 2) |
| Stok rusak/hilang/karantina | ✅ Ada | Karantina = pindah ke gudang karantina (Tahap 2) |
| Retur ke supplier (ganti barang / diskon pembelian berikutnya / refund uang / potong utang) | ✅ Ada | Metode: cash, credit_note, deduction, replacement (jurnal klaim piutang — D-3) |
| Batch & kedaluwarsa + FEFO | ❌ Belum ada | → Batch G8 Tahap 2: dimensi batch pada stok & gerakan, blokir jual kedaluwarsa, FEFO saat penjualan |
| Stok minimum + rekomendasi pembelian | 🟡 Sebagian | Peringatan menipis kanonis ada (D-4); rekomendasi qty pembelian → G7 bersama PO |
| Kartu stok | ✅ Ada | Perbaikan saldo per gudang & pagination → Tahap 4 (P2-5) |
| Laporan stok & nilai persediaan | ✅ Ada | Pagination & Decimal → Tahap 4 (P2-6) |

## 4. Universal

| Fitur spek | Status | Catatan / rencana |
|---|---|---|
| Print & PDF semua dokumen + cetak ulang dari riwayat | 🟡 Sebagian | Nota POS & laporan CSV ada; GRN G6; mesin PDF + pratinjau semua dokumen → Tahap 4 |
| Template cetak bisa dikustomisasi (logo, warna, font, header/footer, kolom, tanda tangan, QR, ukuran A4/A5/thermal 58/80mm, banyak template per dokumen, starter Modern/Minimal/Classic) | ❌ Belum ada | → Print Engine Tahap 4 |
| Import/export semua modul (CSV/XLSX, template unduhan, mapping kolom, pratinjau, validasi + laporan error, deteksi duplikat, update existing, export berfilter, bertahap) | 🟡 Sebagian | Impor produk XLSX/CSV dengan pratinjau/validasi/duplikat/update ada & sedang dibereskan (G4b); perluasan ke supplier/pelanggan/akun/saldo awal/stok awal/hutang/piutang → Tahap 4 |
| Kustomisasi: pemetaan akun default, pajak terkonfigurasi, satuan, nomor dokumen kustom, role & permission, pengaturan perusahaan/cabang | 🟡 Sebagian | Pemetaan akun ✅, pajak satu tarif ✅ (multi-tarif per produk belum), role & permission ✅, nomor dokumen kustom → Tahap 4 (AK-P3-07) |
| Kustomisasi platform: custom fields, form builder, visibilitas field, dropdown kustom, status kustom, approval workflow, modul bisa diaktifkan/dinonaktifkan per tipe bisnis | ❌ Belum ada | → Lapisan platform Tahap 5 (sesudah seluruh inti terbukti; dicatat jujur sebagai pekerjaan terbesar yang tersisa) |

## 5. Simulasi penerimaan pengguna — menjadi test penerimaan otomatis

Skenario pengguna (minimarket, tanpa pajak/diskon): terima 100 air mineral @Rp2.500 tunai → stok 100, jurnal Dr Persediaan 250.000 / Cr Kas 250.000 → POS jual 1 @Rp3.000 tunai → stok 99, jurnal Dr Kas 3.000 / Cr Penjualan 3.000 dan Dr HPP 2.500 / Cr Persediaan 2.500 → laba kotor Rp500. Skenario ini ditulis sebagai **test integrasi penerimaan** yang wajib hijau mulai Batch G6 (skenario B) dan diulang sebagai e2e Playwright di Tahap 5. Metode biaya: rata-rata tertimbang (moving average) — sesuai implementasi proyek (A-3).

## 6. Arsitektur yang diadopsi

Universal core bersama; domain modular POS/Akuntansi/Gudang di atas master data bersama (produk, akun, supplier, pelanggan tidak diduplikasi); Stock Ledger (`stock_movements` append-only) dan General Ledger (`journal_entries` posted append-only, koreksi via reversal) sebagai dua buku besar; pemetaan akun sebagai Configuration Engine untuk jurnal otomatis; Print Engine & Import/Export Engine sebagai layanan universal (Tahap 4); lapisan kustomisasi platform (Tahap 5). Urutan implementasi mengikuti saran pengguna sejauh selaras dengan tahap berjalan: Gudang → Akuntansi → POS → Universal.

## 7. Status akhir program (2026-11-04, sesudah Tahap 5)

Seluruh status "Belum ada/Sebagian" pada tabel di atas kini berstatus akhir sebagai berikut (bukti: laporan tahap 1–5 di `docs/reports/`, matriks verifikasi per modul, suite 442 test + 15 e2e):

- **POS**: semua fitur inti ✅ berfungsi & teruji, termasuk split payment, diskon berjenjang berizin, penebusan kredit pelanggan (Tahap 4), hold yang mengklaim atomik. **Offline POS ❌ tidak dibangun** (keputusan D-10 — hanya persistensi keranjang per pengguna).
- **Akuntansi**: rekonsiliasi bank ✅ (Tahap 4), dokumen saldo awal ✅, penomoran kustom ✅, pemilih perusahaan ✅, tarif pajak tervalidasi ✅.
- **Gudang**: terima barang 3 skenario + GRN ✅, Purchase Order ✅, batch & FEFO ✅, rekomendasi pembelian ✅, kartu stok per gudang & valuasi Decimal ✅, approval penyesuaian maker-checker ✅ (Tahap 5), kategori bertingkat ✅ (Tahap 5). **Konversi multi-satuan ❌ tidak dibangun** (keputusan D-17).
- **Universal**: Print Engine ✅ (3 template, logo/warna/font, QR, tanda tangan, thermal 58/80, A5/A4 — satu template aktif per perusahaan, bukan banyak template per dokumen); impor/ekspor ✅ untuk produk + supplier/pelanggan/akun/stok awal/saldo awal hutang/piutang (edit baris impor di tempat ❌ tidak dibangun — koreksi lewat unggah ulang); saklar modul ✅; custom fields produk & pihak ✅. **Status kustom & form builder generik ❌ tidak dibangun** (keputusan D-16 — status dokumen adalah penjaga integritas).
- **Simulasi §5**: hijau sebagai test integrasi sejak Tahap 2 dan sebagai **e2e Playwright lewat UI** di Tahap 5.

### Addendum SIM-2 (2026-11-04, sesudah Fase S8 — laporan akhir: `docs/sim2/LAPORAN-AKHIR.md`)

Program SIM-2 (mandat A-14) mengubah status berikut dari keadaan di atas; yang tidak disebut di sini tidak berubah:

- **Offline POS**: kini **DIBANGUN** (keputusan D-24 mencabut penundaan D-10 untuk lingkup ini) — antrean IndexedDB + sinkronisasi idempoten di atas tabel `outbox` + daftar peninjauan konflik, di balik saklar per perusahaan. Status **PARTIAL**: terbukti di level domain/antrean (Vitest); uji browser offline sungguhan masih NOT TESTED (langkah acceptance manual di laporan S7B-2).
- **HR & Payroll Indonesia (baru)**: engine PPh 21 TER + hitung ulang Pasal 17 dan BPJS enam program sebagai **konfigurasi bertanggal efektif per perusahaan dengan saklar per komponen** (D-25), slip gaji cetak, ekspor rekap setoran; master karyawan diperluas (NIK/NPWP/PTKP/kontrak/wilayah); departemen/jabatan/atasan + riwayat perubahan otomatis; absensi & shift (manual/CSV); cuti & saldo; lembur & THR terhubung payroll; terminasi & final pay; pinjaman karyawan terpisah dari kasbon; reimbursement berpersetujuan. Belum: TER harian, DTP, ESS/slip mandiri, pesangon otomatis, payroll mingguan. Angka yang belum terverifikasi penuh (batas JP 2026, TER harian, DTP 2026) sengaja tidak disemai.
- **Gudang**: Purchase Request formal ✅, reservasi stok ✅, transfer dua tahap/in-transit ✅ (saklar), nomor seri per unit ✅. Tetap belum: stock aging, dead/fast-slow moving, banding harga pemasok, diskon/biaya penerimaan, varian/brand/multi-barcode, konversi multi-satuan (D-17).
- **Akuntansi**: aset tetap & penyusutan garis lurus ✅ (tie-out GL); integritas referensial kini ditegakkan 27 FK database; snapshot nama+SKU kini juga di baris PO/penerimaan/dokumen stok/retur. Tetap belum: laporan pajak, Budget vs Actual, petty cash khusus, cetak bukti pembayaran & faktur formal, impor jurnal/round-trip transaksi tingkat aplikasi (by design — jalur sah backup/restore DB, terbukti identik penuh).
- **Master data**: ekspor berfilter ✅, bulk edit produk berpreview ✅, deteksi duplikat pihak ✅, merge pihak dengan assert saldo ✅, halaman detail pihak ✅, field NPWP/rekening/termin ✅, penampil riwayat perubahan per record ✅. Tetap belum: saved views, impor master update-existing + rollback batch, status archived/draft terpisah.
- **Keamanan**: temuan SEC-01 (data gaji terbaca pemegang `accounting.view`) **tertutup** lewat izin `payroll.view`; matriks RBAC 15 aksi × 7 peran teruji aksi sungguhan tanpa cacat.
- **Gerbang akhir SIM-2**: suite 881/881 (101 berkas), build & typecheck exit 0, e2e 15/15, reseed demo identik baseline (65 produk, Rp28.349.600, consistency 11/11); **lint exit 1** (1 error react-hooks di terminal POS dari pembangunan nomor seri + 6 warning) — tercatat sebagai temuan terbuka S8-LINT di laporan akhir. Acceptance mandat §17: 4 TERPENUHI · 14 SEBAGIAN · 0 TIDAK dari 18.
