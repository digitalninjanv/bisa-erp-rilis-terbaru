# Laporan Tahap 4 — Integrasi Lintas-Modul & UI/UX Global

Pemimpin: sesi utama Muse · Status: **SELESAI** · Suite akhir: **355 test hijau (44 berkas)**, typecheck & lint bersih, build sukses. Gerbang tahap sesudah reseed: demo 65 produk, nilai persediaan Rp28.349.600, consistency 11/11.

## 1. Temuan yang ditangani tahap ini

Tahap 4 menutup sisa lintas-tahap (GD-P2-5, GD-P2-6, AK-P3-04, AK-P3-05, AK-P3-07, LINTAS-01, SET-RCPT-01) dan membangun fitur universal spek pengguna yang belum ada: rekonsiliasi bank, penebusan kredit pelanggan, Print Engine, perluasan impor + dokumen saldo awal. Dua temuan besar lahir *selama* tahap ini:

| ID | Prioritas | Temuan | Status |
|---|---|---|---|
| **D-15** | P1 | **Instalasi ke database baru selalu gagal** — migrasi 0000 memakai indeks trigram `pg_trgm` yang tidak pernah dibuat migrasinya; DB dev selamat hanya karena ekstensi sudah ada dari penyiapan awal | ✅ Diperbaiki (pengecualian tercatat pada aturan migrasi) & dibuktikan dari DB kosong |
| **T4R-1** | P1 (review) | Void penjualan sesudah retur parsial posted menggandakan restore stok & reversal GL; kredit retur penjualan void tetap bisa ditebus | ✅ Void ditolak selama ada retur posted |
| **T4R-2** | P1 (review) | Impor saldo awal meninggalkan dokumen yatim tanpa jurnal (periode closed = kasus utama cutover) yang tampil & bisa dibayar | ✅ Susunan ulang: validasi → jurnal → dokumen |
| T4R-3 | P2 (review) | Jurnal tertaut yang dibalik meninggalkan tautan basi; ringkasan rekonsiliasi menghitung jurnal mati | ✅ Reversal jurnal tertaut ditolak di domain; ringkasan hanya jurnal live ≤ hari ini |
| T4R-4 | P2 (review) | Penautan tanpa kunci baris/indeks unik — klaim ganda konkuren terbukti nyata saat test balapan dijalankan | ✅ FOR UPDATE + indeks unik parsial (migrasi 0018) |
| T4R-5 | P2 (review) | Impor ulang berkas saldo awal/stok awal dari job baru menggandakan dokumen & stok | ✅ Deteksi duplikat antar-job |
| T4M-01 | P3 (matriks) | `matchLine` manual menerima jurnal yang sudah dibalik | ✅ Predikat live disamakan, diperbaiki Pemimpin via TDD |

## 2. Perbaikan & fitur per batch

- **T4-1** (`ea4889d`) — Kartu stok wajib per gudang dengan saldo awal halaman benar; valuasi persediaan Decimal end-to-end + agregat SQL (presisi terbukti di atas batas aman float); buku besar berpaginasi tanpa baris hilang; akumulasi Number() → Decimal di seluruh reports.ts.
- **T4-2** (`0e90da8`) — **Rekonsiliasi Bank** (D-11): impor mutasi CSV format Indonesia, sidik jari anti-duplikat per baris, auto-match kandidat tunggal ±3 hari, tautan manual nominal persis, jurnal dari mutasi yatim, ringkasan empat angka.
- **T4-3** (`91634b9`) — **Penebusan kredit pelanggan** (D-12): kredit retur `store_credit` ditebus di terminal berdasarkan nomor dokumen retur; akun liabilitas 2300 wajib terpetakan; kunci baris terurut; test balapan dua kasir — tepat satu lolos.
- **T4-4** (`41d6061`) — **Print Engine** (D-13): pengaturan cetak per perusahaan (3 template, logo, warna aksen, font, kop/kaki, tanda tangan, QR nomor dokumen, kertas thermal 58/80, A5, A4) diterapkan ke nota POS, GRN, dan PO; halaman Pengaturan memakai komponen yang sama untuk pratinjau.
- **T4-5a** (`facb0c1`) — Impor master diperluas: supplier, pelanggan, akun, stok awal (satu penerimaan `opening` berjurnal), contoh CSV per entitas, ekspor CSV padanan.
- **T4-5b** (`5b8157d`) — **Dokumen saldo awal hutang/piutang** (D-14): dokumen tersendiri ber Seri OPB/OPR dengan jurnal pembuka bertag pihak, masuk daftar & aging, dibayar/void lewat dialog yang sama, impor massal.
- **T4-6a** (`ce56f0d`) — **Pemilih perusahaan** (LINTAS-01): cookie hanya memilih di antara membership pengguna, peran selalu dibaca ulang di server; **penomoran dokumen kustom** (AK-P3-07) untuk 15 jenis dokumen (awalan + lebar digit; penghitung tidak pernah mundur).
- **T4-6b** (`e7981fa`) — **AK-P3-05**: pemilih akun bisa dicari, input nominal berformat id-ID yang menolak ketikan tak terbaca dengan pesan (Decimal, bukan NaN), beban berpaginasi dengan total agregat server, CSV tab catatan tidak lagi mengunduh laba rugi; rasio margin terhadap penjualan neto; `loading.tsx` lima segmen; perbaikan WCAG statis (audit axe penuh → Tahap 5); bukti performa terdokumentasi.
- **Matriks + tindak lanjut review** (`5d9a4b0`, `ec7c7f1`, `a512b24`) — lihat bagian 5.

## 3. Fitur yang ditambahkan (ringkas)

Rekonsiliasi bank penuh · penebusan kredit pelanggan di POS · Print Engine dengan pratinjau · impor 5 entitas master/keuangan + ekspor padanan + contoh CSV · dokumen saldo awal hutang/piutang · pemilih perusahaan multi-entitas · penomoran dokumen kustom · pemilih akun yang bisa dicari · input nominal id-ID · status memuat antar-halaman.

## 4. Bukti performa (DB scratch 10.200 produk, `docs/reports/PERFORMA-BULK.md`)

| Fungsi | Median |
|---|---|
| Valuasi persediaan penuh (10.200 produk) | 197 ms |
| Kartu stok halaman 40 (2.501 gerakan) | 13 ms |
| Daftar jurnal 1 halaman (6.001 jurnal) | 6 ms |
| Laba rugi satu tahun (12.003 baris) | 41 ms |

Target misi (halaman < 2 detik, POS < 1 detik) terlampaui jauh di level fungsi data; pengukuran ujung-ke-ujung per halaman menjadi bagian gerbang e2e Tahap 5.

## 5. Hasil tes & verifikasi

- Suite bertumbuh 250 → **355 test** selama Tahap 4; setiap batch diverifikasi ulang Pemimpin secara mandiri (bukan klaim agen).
- **Matriks Verifikasi Fitur Tahap 4** (A-5): 66 fitur — 49 terbukti otomatis, 10 sebagian (axe penuh, e2e visual, dan bukti manual D-15 dinyatakan jujur), 7 antarmuka, 0 celah; 11 test penutup ditambahkan.
- **Review kode independen** (A-7) atas diff `0670510..HEAD`: 0 P0 / 2 P1 / 3 P2 / 4 P3 — semua P1 & P2 ditindaklanjuti dan terverifikasi; P3: T4R-7 (Decimal panel) & T4R-8 (cookie `secure` di produksi) ditambal; T4R-6 (sidik jari menelan transaksi identik sah dalam satu berkas — trade-off D-11) dan T4R-9 (risiko hash migrasi D-15 pada upgrade drizzle mendatang) **dicatat permanen untuk Tahap 5**.
- **Catatan rilis migrasi 0018**: bila database tujuan sudah memiliki tautan ganda nyata, pembuatan indeks unik akan gagal — lepas tautan ganda manual lebih dulu.
- Gerbang tahap sesudah reseed: 65 produk, Rp28.349.600, consistency 11/11.

## 6. Sisa masalah & rencana Tahap 5 (terakhir)

1. **Lapisan platform kustomisasi spek** (pekerjaan terbesar tersisa): custom fields, form builder, status kustom, approval workflow, modul on/off per tipe bisnis.
2. Sisa audit P3 Akuntansi (P3-01/02/03/06), test otomatis penjaga reset password owner (SEC-P0-01), test balapan konkurensi gudang, keputusan `finalizeImportAction` (hubungkan ke UI atau hapus).
3. Fitur matriks yang belum dibangun: kategori bertingkat, konversi multi-satuan, atribut produk kustom, edit baris impor di tempat, nonaktif satuan.
4. **Gerbang e2e Playwright**: perjalanan pengguna utama per modul + simulasi minimarket pengguna + audit axe WCAG (target 0 critical/serious per rute).
5. Regresi penuh, pemeriksaan keamanan & performa akhir, lalu paket rilis (ZIP) — hanya sesudah semua gerbang hijau.
