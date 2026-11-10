# LAPORAN AKHIR — Program SIM-2 (Mandat A-14)

**Full ERP Business Simulation, Comprehensive Audit & Remediation + Master Data Management (§18)**

- **Tanggal laporan:** 2026-11-04 · **Peran penulis:** Report Lead (Fase S8) ·
  **HEAD repo saat laporan ditulis:** `b86d976` (S7B-2) · **Migrasi terakhir:** 0038.
- **Sumber bukti:** laporan fase `docs/sim2/S0-A…S7B2` + regresi akhir yang
  dijalankan ulang penulis pada pohon final (§2). Tidak ada angka atau status
  di laporan ini yang tidak menunjuk laporan fase atau berkas test sebagai
  buktinya. Status memakai label mandat: **PASS / PARTIAL / FAIL /
  NOT IMPLEMENTED / NOT TESTED**.
- **Catatan kejujuran metodologis:** daftar kata-per-kata 18 syarat §17 tidak
  tersimpan di repo (PROGRESS.md hanya memuat ringkasan mandat A-14, baris
  log 2026-11-04 09:28). Penilaian §19 karena itu disusun satu per satu
  mengikuti butir-butir mandat §1–§18 sebagaimana tercatat pada A-14, dan
  setiap syarat ditelusur ke bukti fasenya. Ini dinyatakan terbuka agar
  tidak terkesan mengutip teks yang tidak ada.

---

## 1. Ringkasan eksekutif

Program SIM-2 menjalankan audit menyeluruh, simulasi bisnis nyata,
pembangunan fitur yang hilang, dan remediasi atas Bisa ERP dalam fase
S0–S7B. Vonis keseluruhan: **inti transaksi sistem terbukti benar secara
angka; tidak ada fitur palsu (mock) yang ditemukan di titik mana pun;
yang membedakan "siap" dari "belum siap penuh" adalah daftar fitur yang
memang belum dibangun dan dua keterbatasan terukur — semuanya tertulis
di laporan ini, bukan disembunyikan.**

Angka kunci program:

| Ukuran | Awal (S0) | Akhir (S8) |
|---|---:|---:|
| Suite test (Vitest) | 590/590 (69 berkas) | **881/881 (101 berkas)** |
| Migrasi | s.d. 0026 | s.d. **0038** |
| E2E Playwright | 15/15 | **15/15** (dijalankan ulang di S8) |

Temuan terpenting program, ringkas:

1. **Simulasi bisnis ujung-ke-ujung cocok persis.** Simulasi minimarket
   "SimMart" (S1): 36/36 langkah PASS, neraca seimbang persis
   (Aset 38.041.800 = Utang 75.000 + Ekuitas 37.966.800), subledger =
   akun kontrol, stok = Σ pergerakan. Tidak ditemukan satu pun bug
   produksi pada fase simulasi.
2. **Payroll Indonesia dibangun dari nol sebagai konfigurasi** (S2):
   engine PPh 21 TER + hitung ulang Pasal 17, BPJS enam program, THR,
   lembur, cek UMP — seluruh tarif/batas berupa baris konfigurasi
   bertanggal efektif per perusahaan dengan saklar per komponen (D-25).
   12 test case regulasi dari sumber resmi lulus, termasuk kasus kanonis
   Desember Rp620.000.
3. **HR lanjutan & bangunan besar D-24 selesai dibangun** (S7B-1/S7B-2):
   organisasi & riwayat karyawan, absensi/shift, cuti, lembur+THR
   terhubung payroll, terminasi & final pay, pinjaman karyawan,
   reimbursement berpersetujuan, aset tetap & penyusutan, Purchase
   Request, reservasi stok, transfer dua tahap (in-transit), nomor seri,
   dan offline POS di atas tabel `outbox`.
4. **Keamanan: temuan tertinggi tertutup.** SEC-01 (data gaji terbaca
   semua pemegang `accounting.view`) ditutup dengan izin `payroll.view`
   + 34 test permusuhan; matriks RBAC 15 aksi × 7 peran diuji lewat aksi
   server sungguhan dengan nol ketidakcocokan (S6).
5. **Backup terbukti, bukan diklaim.** Restore DB ke database baru
   identik penuh pada ±80 tabel dan fungsi laporan aplikasi; backup
   terenkripsi lulus; round-trip tingkat aplikasi PASS untuk master +
   stok awal + saldo awal AR/AP — dan **NOT IMPLEMENTED by design**
   untuk riwayat transaksi/jurnal (RT-04, §14).
6. **Performa terukur apa adanya** (S4): pada 100 rb produk / 1 jt baris
   jurnal, operasi harian cepat (daftar penjualan 354→39 ms; N+1 payroll
   11–14× lebih cepat), tetapi agregasi laporan tahunan tetap di kelas
   2–5 detik dan ekspor besar menahan ±200 MB heap — keduanya menjadi
   requirement bernomor, bukan klaim selesai.
7. **Satu gerbang akhir berwarna merah — dicatat apa adanya.** Pada
   regresi S8, `pnpm lint` berakhir **exit 1**: 1 error
   `react-hooks/set-state-in-effect` di
   `src/components/pos/pos-terminal.tsx:656` (efek penahan quote untuk
   produk serial dari S7B-2) + 6 warning. S7B-1/S7B-2 tidak menjalankan
   lint pada gerbang mereka sehingga ini lolos; test/build/typecheck/e2e
   semuanya hijau. Perbaikannya kecil dan terlokalisasi, tetapi di luar
   lingkup fase dokumen ini — tercatat sebagai temuan terbuka **S8-LINT**
   di §17 untuk ditutup Pemimpin.

Penilaian acceptance §17 (rincian §19): **4 TERPENUHI · 14 SEBAGIAN ·
0 TIDAK** dari 18. Tidak ada syarat yang gagal total; tidak ada pula
dasar jujur untuk menyatakan 18/18 terpenuhi.

## 2. Metodologi & gerbang regresi akhir

**Metodologi program.** Setiap fase bekerja dengan pola yang sama:
audit/inventaris berbasis bukti kode lebih dulu (S0), lalu pembangunan
dengan TDD (test gagal → perbaikan → hijau), gerbang suite penuh per
fase, dan status fitur hanya naik kelas bila ada test yang
membuktikannya. Fitur yang membutuhkan kebijakan bisnis/regulasi yang
tidak dapat disimpulkan ditulis sebagai requirement + acceptance
criteria, tidak disimulasikan. Angka regulasi hanya disemai dari sumber
resmi yang terverifikasi penuh (S0-C); yang terverifikasi sebagian
sengaja tidak disemai (§8).

**Regresi akhir S8** — dijalankan penulis pada pohon final
(HEAD `b86d976`), angka mentah:

| Pemeriksaan | Perintah | Hasil mentah |
|---|---|---|
| Suite test | `pnpm test` | **881/881 lulus, 101 berkas**, durasi 143,13 dtk, exit 0 |
| Build produksi | `pnpm build` | **exit 0** (tanpa pipa penutup exit code) |
| Typecheck | `pnpm typecheck` | **exit 0** |
| Lint | `pnpm lint` | **exit 1** — 1 error (`react-hooks/set-state-in-effect`, `src/components/pos/pos-terminal.tsx:656`) + 6 warning (impor tak terpakai di `karyawan/[id]/page.tsx`, `tests/sim2/hr-org-history.test.ts`, `hr-overtime-thr.test.ts`, `purchase-requests.test.ts`, `s5-roundtrip.test.ts`; `exhaustive-deps` di `pos-terminal.tsx:712`) |
| E2E | `pnpm test:e2e` | **15/15 lulus** (40,5 dtk), exit 0 — termasuk axe WCAG 0 pelanggaran pada 5 rute dan simulasi minimarket lewat UI |
| Reseed demo | `pnpm db:seed -- --force` | 65 produk, nilai persediaan **Rp28.349.600** — identik baseline pra-SIM-2 (skenario demo tidak berubah oleh fitur baru) |
| Konsistensi DB | `vitest run tests/integration/consistency.test.ts` | **11/11 lulus** di atas seed bersih |

## 3. Inventaris & status fitur per modul (tabel induk)

Sumber status awal: inventaris S0-A/S0-B/S0-C/S0-D. Kenaikan status
hanya dari fase yang membuktikannya (kolom Bukti). Tabel ini adalah
satu-satunya tabel induk status fitur program.

### 3.1 Beranda, platform & pengaturan

| Fitur | Status | Bukti |
|---|---|---|
| Dashboard ringkasan & panel perhatian | PASS | S0-A §1.1; S1 |
| Pemilih perusahaan (multi-perusahaan) | PASS | S0-A §1.1 |
| Saklar modul per perusahaan | PASS | S0-A §1.1; e2e pengaturan S8 |
| Custom fields produk & pihak | PASS | S0-A §1.6 (keputusan D-16) |
| Penomoran dokumen kustom (15 jenis) | PASS | S0-A §1.6; e2e S8 |
| Pengguna & peran (bawaan + kustom), penjaga owner | PASS | S0-A §1.6; S6 matriks |
| Undangan pengguna (invitation UI) | NOT IMPLEMENTED | S0-A §1.6 |
| 2FA — UI pengelolaan pengguna | NOT IMPLEMENTED | Plugin `twoFactor` dorman; S6 §4 sisa risiko #3 |
| Status dokumen kustom & form builder generik | NOT IMPLEMENTED | Keputusan D-16 (ditolak sadar: penjaga integritas) |
| Tarif pajak bertanggal efektif / multi-tarif per produk | NOT IMPLEMENTED | S2 R-2; S0-A §1.6 |

### 3.2 POS & kasir

| Fitur | Status | Bukti |
|---|---|---|
| Terminal kasir (cari server-paginated, barcode, keranjang; quote = checkout) | PASS | S0-A §1.2; S1 langkah 15–17 |
| Pembayaran tunai/QRIS/bank + split payment | PASS | S1 langkah 17 |
| Kartu debit/kredit (integrasi EDC/otorisasi) | PARTIAL | Hanya metode bertipe bank; tanpa integrasi EDC (S0-A §1.2) |
| Penjualan utang (D-19) + batas kredit ditegakkan | PASS | S1 langkah 18–19 |
| Diskon kelompok + diskon manual berjenjang izin | PASS | S0-A §1.2; S6 matriks |
| Promosi/kupon/voucher terjadwal | NOT IMPLEMENTED | S0-A §1.2 |
| Hold & resume (klaim atomik, hitung ulang harga + pemberitahuan) | PASS | S1 langkah 22 |
| Retur penjualan: refund/tukar/kredit toko + penebusan kredit | PASS | S0-A §1.2; S1 langkah 21 |
| Sesi kasir: buka/tutup, setor/tarik bank, hitung fisik, selisih berjurnal | PASS | S1 langkah 15, 24 |
| Cash drop khusus ke brankas | PARTIAL | Dipenuhi "Setor ke Bank"; tipe mutasi drop tersendiri tidak ada (S0-A §1.2) |
| Riwayat penjualan + detail + cetak ulang nota | PASS | S0-A §1.2 |
| Persistensi keranjang (localStorage) | PASS | S0-A §1.2 |
| Offline POS: antrean IndexedDB + sinkronisasi idempoten + daftar peninjauan konflik | PARTIAL | Domain/antrean/terminal terbukti Vitest (S7B-2 Batch 6: 3+4 test); **uji browser offline sungguhan NOT TESTED** — langkah acceptance manual tertulis di S7B-2 |

### 3.3 Gudang & procurement

| Fitur | Status | Bukti |
|---|---|---|
| Master produk (SKU, barcode tunggal, kategori bertingkat, satuan) | PASS | S0-A §1.3; S3 |
| Brand produk | NOT IMPLEMENTED | S3 sisa #2 (REM-19) |
| Variasi produk | NOT IMPLEMENTED | S3 sisa #2 (REM-19) |
| Multi-barcode per produk | NOT IMPLEMENTED | S3 sisa #2 (REM-19) |
| Multi-satuan & konversi | NOT IMPLEMENTED | Keputusan D-17 |
| Stok maksimum / reorder point mandiri | PARTIAL | Hanya `minStock` + rumus saran 2× min (S0-A §1.3) |
| Penerimaan 3 skenario (kredit/tunai/non-pembelian) + no. invoice pemasok + tautan PO | PASS | S0-A §1.3; S1 langkah 3–7 |
| Qty rusak/ditolak per baris penerimaan | NOT IMPLEMENTED | Keputusan sadar D-5; dialihkan ke penyesuaian/retur |
| Purchase Order (siklus penuh, anti-kelebihan) | PASS | S1 langkah 3–5 |
| Purchase Request formal (persetujuan berambang, konversi ke PO) | PASS | S7B-2 Batch 3 (6 test) |
| Banding harga antar-pemasok | NOT IMPLEMENTED | REM-24 terbuka |
| Diskon pembelian & biaya tambahan pada penerimaan | NOT IMPLEMENTED | REM-24 terbuka |
| Penjaga duplikat nomor invoice pemasok | PARTIAL | Nomor tersimpan & tampil; tanpa indeks unik/peringatan (S0-A §3; REM-24) |
| Retur pembelian RTB (alasan berkategori + bebas; penyelesaian campuran; Kredit Pemasok) | PASS | A-9/D-20; S1 langkah 8–13 |
| Penyesuaian stok beralasan + approval maker-checker berambang | PASS | S0-A §1.3 |
| Transfer stok satu tahap | PASS | S0-A §1.3; S1 langkah 25 |
| Transfer dua tahap (kirim → in-transit → terima) | PASS | S7B-2 Batch 4 (saklar, bawaan mati) |
| Reservasi stok (mengurangi ketersediaan POS, tanpa gerakan ledger) | PASS | S7B-2 Batch 4 (6 test) |
| Stock opname (kunci baris, anti-dobel) | PASS | S1 langkah 26 |
| Cycle counting terjadwal/rotasi | PARTIAL | Opname pilihan produk manual; tanpa jadwal (S0-A §1.3) |
| Kartu stok per gudang + paginasi | PASS | S0-A §1.3; S4 (5,6–6,5 ms di skala B) |
| Laporan nilai persediaan (qty × AVCO) | PASS | S1 §2; S4 |
| Stock aging | NOT IMPLEMENTED | REM-24 terbuka |
| Dead stock / fast–slow moving | NOT IMPLEMENTED | REM-24 terbuka |
| Batch & kedaluwarsa + FEFO + blokir jual kedaluwarsa | PASS | S1 langkah 7, 20 |
| Nomor seri per unit (terima/jual/transfer/retur/void) | PASS | S7B-2 Batch 5 (7 test; 2 caveat tertulis di laporan fase) |
| Rekomendasi pembelian + buat PO per pemasok | PASS | S0-A §1.3 |
| Void dokumen gudang terposting (berpenjaga) | PASS | S0-A §1.3 |

### 3.4 Akuntansi & keuangan

| Fitur | Status | Bukti |
|---|---|---|
| Bagan akun CRUD berpenjaga + halaman detail akun + riwayat perubahan | PASS | S0-A §1.4; S7 REM-03 |
| Pemetaan akun (mesin jurnal otomatis) | PASS | S0-A §1.4 |
| Jurnal manual (formulir penuh, pola cepat, idempoten) | PASS | S0-A §1.4 |
| Jurnal otomatis dari semua modul (sumber terlabel) | PASS | S0-A §2 peta dependensi |
| Balik jurnal berpenjaga sumber | PASS | S0-A §1.4 |
| Buku besar per akun + cetak | PASS | S0-A §1.4; S4 |
| Kas & bank: transfer (+fee) & void transfer | PASS | S0-A §1.4 |
| Beban operasional | PARTIAL | Tanpa lampiran bukti, tanpa persetujuan, tanpa PPN masukan terpisah (S0-A §1.4) |
| Piutang & utang: aging dari tanggal dokumen, bayar sebagian/penuh, void per pembayaran | PASS | S1 langkah 9, 14, 30 |
| Pagination server daftar piutang/utang | PARTIAL | Fungsi masih memuat seluruh dokumen terbuka (REM-07 terbuka; S4 R-5) |
| Saldo awal hutang/piutang sebagai dokumen tersendiri | PASS | S0-A §1.4 (D-14); S5 §2 |
| Rekonsiliasi bank (impor mutasi, auto-match ±3 hari, jurnal dari mutasi yatim) | PASS | S0-A §1.4; e2e S8 |
| Periode fiskal: tutup/kunci bertingkat, buka kunci owner beralasan | PASS | S1 langkah 36 |
| Jurnal penutup tahun buku eksplisit | PARTIAL | Mekanisme periode + laporan ekuitas berjalan; jurnal penutup eksplisit tidak ada (S0-A §1.4) |
| Catat Transaksi (modal 5 jenis, pratinjau jurnal = jurnal riil, draf server) | PASS | A-12/D-23; S1 langkah 28–29 |
| Laporan: Laba Rugi (+pembanding), Neraca, Arus Kas, Perubahan Ekuitas, Neraca Saldo, Penjualan, CALK | PASS | S0-A §1.4; S1 §2 |
| Laporan pajak (PPN/SPT) | NOT IMPLEMENTED | S0-A §1.4 |
| Budget vs Actual | NOT IMPLEMENTED | S0-A §1.4 |
| Aset tetap & penyusutan garis lurus (kategori terkonfigurasi, run idempoten, pelepasan gain/loss) | PASS | S7B-2 Batch 2 (5 test; akumulasi laporan = GL 1510) |
| Metode penyusutan selain garis lurus | NOT IMPLEMENTED | S7B-2 sisa jujur |
| Petty cash khusus (dana imprest, pengisian ulang, pertanggungjawaban) | NOT IMPLEMENTED | S0-A §8; kas kecil hanya akun GL biasa |
| Cetak bukti pembayaran hutang/piutang | NOT IMPLEMENTED | REM-22 terbuka |
| Faktur penjualan formal (di luar nota POS) | NOT IMPLEMENTED | REM-22 terbuka; S0-A §1.9 |

### 3.5 HR & payroll

| Fitur | Status | Bukti |
|---|---|---|
| Master karyawan dasar (kode, nama, gaji, tanggal masuk, aktif/nonaktif) | PASS | S0-C §6A |
| Master karyawan diperluas: NIK, NPWP, status PTKP, kontrak, wilayah, kelas risiko JKK, kepesertaan per program | PASS | S2 Batch 2 |
| Departemen, jabatan (master), atasan, cabang karyawan | PASS | S7B-1 Batch 1 (8 test) |
| Riwayat perubahan jabatan/gaji/departemen/kontrak (otomatis, before/after) | PASS | S7B-1 Batch 1 |
| Peringatan kontrak PKWT akan berakhir (ambang terkonfigurasi) | PASS | S7B-1 Batch 1 |
| Dokumen/lampiran kontrak & identitas karyawan | NOT IMPLEMENTED | S7B-1 NOT IMPLEMENTED |
| Absensi & shift (master shift, penugasan bertanggal, input manual + impor CSV, rekap) | PASS | S7B-1 Batch 2 (6+5 test) |
| Integrasi perangkat absensi (fingerprint/geolocation) | NOT IMPLEMENTED | S7B-1 NOT IMPLEMENTED (requirement tertulis) |
| Cuti: jenis terkonfigurasi, saldo, carry-over bersaklar, persetujuan, potongan tak berbayar | PASS | S7B-1 Batch 4 (6 test) |
| Lembur berpersetujuan terhubung payroll (pengali konfigurasi) | PASS | S7B-1 Batch 3 (menutup R-6 S2) |
| THR: hitung prorata terkonfigurasi → draf → masuk run | PASS | S7B-1 Batch 3 |
| Run payroll bulanan (snapshot komponen, anti periode ganda 3 lapis) | PASS | S0-C §6D; S1 langkah 33 |
| Payroll mingguan / run per kelompok karyawan | NOT IMPLEMENTED | S7B-1 §6D; H-2 S2 |
| Pembayaran gaji: penuh per run; final pay per karyawan | PASS | S0-C §6D; S7B-1 Batch 5 |
| Pembayaran gaji sebagian (per karyawan dalam run reguler) | NOT IMPLEMENTED | S0-C §6D |
| Slip gaji cetak per karyawan (dari snapshot) | PASS | S2 Batch 4 |
| Slip mandiri karyawan (ESS) | NOT IMPLEMENTED | R-8 S2; S7B-1 NOT IMPLEMENTED |
| Ekspor rekap setoran PPh 21/BPJS (CSV) | PASS | S2 Batch 4 |
| Aksi bayar setoran utang PPh/BPJS dari payroll | NOT IMPLEMENTED | R-5 S2 (REM-15) |
| Ekspor pembayaran gaji format bank | NOT IMPLEMENTED | S0-C §6D |
| Kasbon karyawan (rencana full/fixed/percent, FIFO berplafon, pulih saat void) | PASS | A-11/D-22; S1 langkah 32–34 |
| Persetujuan atasan untuk kasbon | NOT IMPLEMENTED | S0-C §6F requirement |
| Pinjaman karyawan terpisah (seri PJM, tenor/fixed, terpotong di payroll, ditagih di final pay) | PASS | S7B-2 Batch 1 (9 test gabungan) |
| Reimbursement berpersetujuan maker-checker (dibayar tunai langsung, bukan via payroll) | PASS | S7B-2 Batch 1 |
| Lampiran berkas reimbursement | PARTIAL | Hanya nama berkas/catatan teks; unggahan berkas nyata belum ada (S7B-2) |
| Uang muka perjalanan dinas ber-pertanggungjawaban | PARTIAL | Mekanik piutang kasbon dapat dipakai; kategori & tenggat pertanggungjawaban tidak ada (S0-C §6F) |
| Terminasi terstruktur & final pay (prorata hari kerja, PPh masa terakhir, tagih kasbon+pinjaman) | PASS | S7B-1 Batch 5 (6 test); S7B-2 Batch 1 |
| Pesangon/UPMK/kompensasi PKWT otomatis (PP 35/2021) | NOT IMPLEMENTED | S7B-1 NOT IMPLEMENTED (requirement tertulis) |
| Penonaktifan akun login tertaut saat terminasi | NOT IMPLEMENTED | S0-C §6G (master karyawan tak terhubung akun login) |

### 3.6 Payroll Indonesia (statutory)

| Fitur | Status | Bukti |
|---|---|---|
| Engine PPh 21 TER bulanan (kategori A/B/C dari status PTKP) | PASS | S2; TC-01…TC-04 |
| Hitung ulang masa pajak terakhir (Pasal 17, biaya jabatan, PTKP) | PASS | S2; TC-05 persis Rp620.000 |
| BPJS Kesehatan 5% (4/1) dengan batas upah terkonfigurasi | PASS | S2; TC-06 |
| BPJS TK: JHT, JKK per kelas risiko, JKM, JP berbatas, JKP | PASS | S2; TC-07, TC-08 |
| THR (fungsi hitung prorata) & lembur (pengali) sebagai konfigurasi | PASS | S2; TC-09, TC-10; terhubung run di S7B-1 |
| Pemeriksaan upah minimum per wilayah (menolak run tanpa pengakuan) | PASS | S2; TC-12 |
| Surcharge non-NPWP +20% (tanpa NPWP & tanpa NIK) | PASS | S2 Batch 3 |
| TER harian untuk pegawai harian | NOT IMPLEMENTED | R-1 S2 (tabel belum terverifikasi penuh) |
| PPh 21 Ditanggung Pemerintah (DTP) | NOT IMPLEMENTED | R-4 S2 |
| Gross-up PPh (tunjangan pajak) | NOT IMPLEMENTED | R-7 S2 |

### 3.7 Master data (§18) — ringkas; rincian §11

| Kemampuan | Status | Bukti |
|---|---|---|
| Produk: CRUD + export berfilter + bulk edit berpreview | PASS | S3 Batch 1, 3 |
| Produk: bulk delete massal | NOT IMPLEMENTED | Disengaja (hapus per baris berpenjaga) — S3 |
| Produk: duplicate (copy) record | NOT IMPLEMENTED | S3 sisa #8 (REM-20) |
| Produk & akun: penampil riwayat perubahan per record | PASS | S7 REM-03 |
| Pihak: halaman detail + saldo subledger + riwayat | PASS | S3 Batch 4 |
| Pihak: audit create/update/delete (termasuk batas kredit) | PASS | S3 Batch 2 |
| Pihak: deteksi duplikat (nama trigram/telepon/NPWP) + peringatan form | PASS | S3 Batch 4 |
| Pihak: merge dengan assert saldo + audit dua sisi | PASS | S3 Batch 5 |
| Pihak: field NPWP, rekening (pemasok), termin pembayaran | PASS | S3 Batch 6 (migrasi 0028) |
| Termin → bawaan jatuh tempo dokumen pembelian/POS | PARTIAL | Baru berlaku untuk dokumen saldo awal; `due_date` dokumen belum ada (S3 Batch 6) |
| Saved views, kolom tampil/sembunyi, filter multi-kondisi | NOT IMPLEMENTED | S3 sisa #4 (REM-20) |
| Impor master update-existing + rollback batch impor | NOT IMPLEMENTED | S3 sisa #5 (REM-20) |
| Panel kualitas data umum | PARTIAL | Panel duplikat pihak ada; cek harga 0/barcode kosong belum (S3 sisa #6); yatim referensial kini dicegah FK (S7 REM-01) |
| Status archived terpisah & status draft master | NOT IMPLEMENTED | Nonaktif = arsip de facto (S3 sisa #7) |

### 3.8 Impor, ekspor, backup

| Fitur | Status | Bukti |
|---|---|---|
| Impor produk (pemetaan, pratinjau server, edit baris, deteksi duplikat, update-existing) | PASS | S0-A §1.8 |
| Impor supplier/customer/akun + stok awal + saldo awal AR/AP + template unduhan | PASS | S0-A §1.8; S5 §2 |
| Ekspor CSV master mengikuti filter halaman | PASS | S3 Batch 1 |
| Ekspor CSV besar streaming | PARTIAL | Bekerja tetapi memuat di memori (±200 MB heap/100 rb baris) — R-2 S4 (REM-10) |
| Backup DB manual (pg_dump) | PASS | S5 §1.2 (prasyarat client PG ≥ server) |
| Backup terenkripsi (opt-in, AES-256) | PASS | S5 Langkah 3 |
| Restore teruji ke DB baru — identik penuh | PASS | S5 §1.2–1.3 |
| Round-trip aplikasi: master + stok + saldo awal AR/AP | PASS | S5 §2.1 (12 test permanen) |
| Round-trip aplikasi: riwayat transaksi & jurnal penuh | NOT IMPLEMENTED | RT-04 S5 — by design; jalur sah = backup/restore DB |
| Backup terjadwal, retensi, off-site, uji restore berkala otomatis | NOT IMPLEMENTED | S5 requirement runbook (REM-18) |

### 3.9 Keamanan & cetak

| Fitur | Status | Bukti |
|---|---|---|
| RBAC server-side semua aksi tulis (140+ aksi terpindai, nol tanpa gerbang) | PASS | S6 §3 |
| Matriks RBAC 15 aksi × 7 peran teruji aksi sungguhan | PASS | S6 §3 (nol ketidakcocokan) |
| Gerbang data gaji `payroll.view` (SEC-01) | PASS | S6 Batch 1 (34 test permusuhan) |
| Isolasi tenant RLS (ENABLE+FORCE, koneksi non-pemilik) | PASS | S0-D; S6 §3 |
| Rate limit login | PARTIAL | Eksplisit & aktif semua lingkungan; penyimpanan in-memory per instance (SEC-04 sisa; REM-16) |
| Penampil audit log global | PARTIAL | Per-record PASS (REM-03); halaman global belum (SEC-09) |
| Kredensial bawaan docker | PARTIAL | Nilai dev tetap; peringatan deploy tertulis di compose/init.sql/README (SEC-03) |
| Cetak: nota POS, GRN, PO, RTB, voucher jurnal, laporan berkop + nomor halaman | PASS | S0-A §1.9; program cetak 26/26 |
| Template cetak terkonfigurasi (logo/warna/font/kop/kaki/QR/tanda tangan, thermal 58/80, A5/A4) | PARTIAL | Satu template aktif per perusahaan; banyak template per jenis dokumen belum (S0-A §1.9) |
| Slip gaji tercetak | PASS | S2 Batch 4 |
| Aksesibilitas rute utama (axe WCAG 2 A/AA) | PASS | E2E S8: 0 pelanggaran, 5 rute |

---

## 4. Hasil simulasi bisnis (S1)

Simulasi perusahaan minimarket fiktif "SimMart" dijalankan sebagai test
integrasi permanen (`tests/sim2/sim-bisnis.test.ts`, 37 test) pada
perusahaan fixture khusus, seluruh transaksi lewat domain & server
action yang sesungguhnya, dengan ekspektasi nominal **dihitung tangan
dari skenario** sebelum test ditulis.

- **36/36 langkah PASS · 0 FAIL · 0 NOT IMPLEMENTED**, mencakup:
  procurement (terima penuh/parsial, kelebihan ditolak, retur rusak
  FEFO, penyelesaian retur campuran potong utang + Kredit Pemasok +
  refund, pembayaran ganda ditolak di dua jalur), POS (tunai+kembalian,
  QRIS, split, utang dalam batas kredit, lampaui batas ditolak, FEFO per
  lot, retur sebagian, hold→resume→checkout, **konkurensi 2 penjualan
  atas stok 5: tepat 1 berhasil, stok akhir 1 — tanpa oversell**,
  tutup sesi selisih −2.000 terjurnal), gudang (transfer, opname selisih
  45.000, peringatan stok minimum), akuntansi (beban & entri cepat,
  terima piutang sebagian, tutup periode → posting ditolak
  `PERIOD_CLOSED`), dan HR ringkas (kasbon 500 rb → payroll memotong
  200 rb sesuai rencana).
- **Rekonsiliasi cocok persis:** neraca saldo debit = kredit; 20 saldo
  akun GL sama dengan hitungan tangan (Kas 31.549.500, Persediaan
  1.717.300, dst.); neraca `balanced` (Aset 38.041.800 = Utang 75.000 +
  Ekuitas 37.966.800); valuasi persediaan = saldo GL persediaan;
  subledger AR 190.000 & AP 75.000 = akun kontrol; invariant
  `stock_on_hand` = Σ `stock_movements` tanpa simpangan.
- **Tidak ditemukan bug produksi** pada fase ini (tidak ada test
  `TEMUAN`). Dua observasi informasi tercatat (definisi menipis D-4
  mencakup produk minStock 0; tanggal jurnal payroll — yang kedua
  kemudian ditutup REM-04 di S7).

## 5. Procurement & gudang — status rinci (§3–§4)

Kaki procurement dan gudang adalah yang paling lengkap di sistem.
Seluruh alur mandat §3 teruji: PO bersiklus dengan anti-kelebihan,
penerimaan tiga skenario (kredit / tunai tanpa utang fiktif / non-
pembelian), penerimaan tanpa PO, barang bonus, retur pembelian dengan
empat jalur penyelesaian, dan pembayaran utang parsial/FIFO dengan
penjaga pembayaran ganda (S1; A-9; S7B-2 untuk Purchase Request).
Kaki §4 teruji: AVCO global, batch/FEFO dengan blokir kedaluwarsa,
opname terkunci, karantina semantik, dan — baru di S7B — reservasi yang
mengurangi ketersediaan tanpa menulis ledger, transfer dua tahap
dengan status in-transit yang konservasi qty-nya terassert, dan nomor
seri ujung-ke-ujung.

Yang **belum** ada pada kaki ini (semua tercatat sebagai REM-24 atau
keputusan sadar): banding harga antar-pemasok, diskon pembelian &
biaya tambahan pada penerimaan, penjaga duplikat nomor invoice pemasok
(nomor tersimpan tetapi tidak unik), stock aging, dead/fast/slow
moving, qty rusak/ditolak per baris penerimaan (D-5: dialihkan ke
penyesuaian/retur), multi-satuan & konversi (D-17), varian, brand, dan
multi-barcode (REM-19).

## 6. POS & kasir — status rinci (§5, §12)

Seluruh skenario §5 yang diamanatkan terbukti di S1: semua metode bayar
yang didukung desain (tunai, QRIS, transfer/bank, utang), split
payment, diskon berjenjang izin, hold/resume, retur/refund/tukar
barang/kredit toko beserta penebusannya, sesi buka/tutup dengan kas
masuk/keluar dan selisih terjurnal, cetak & cetak ulang nota, dan dua
kasir bersamaan atas produk yang sama tanpa oversell. Batas yang
jujur: pembayaran kartu adalah metode bertipe bank tanpa integrasi
EDC; cash drop khusus ke brankas tidak punya tipe mutasi tersendiri;
promosi/kupon terjadwal tidak ada.

**Offline POS (§12)** dibangun di S7B-2 sesuai keputusan D-24: antrean
IndexedDB di terminal (dedupe per `clientKey`), sinkronisasi server
lewat jalur checkout normal dengan kunci idempotensi = `clientKey`
(status per item `synced`/`duplicate`/`conflict`/`failed`), konflik
tidak dipaksakan dan masuk daftar peninjauan `/app/pos/offline`,
seluruhnya di balik saklar per perusahaan. Bukti Vitest: 3 test
integrasi sinkronisasi + 4 test unit antrean. **Batas yang tidak boleh
dikaburkan: uji browser offline sungguhan (DevTools offline →
penjualan → sinkron otomatis) belum dijalankan otomatis maupun manual
pada program ini — statusnya NOT TESTED**, dengan langkah acceptance
manual 4 butir tertulis di laporan S7B-2 Batch 6. Kendala desain yang
disadari: sinkronisasi menuntut sesi kas terbuka milik penyinkron
(kegagalan = status `failed`, dapat dicoba lagi), dan antrean hanya
mencakup penjualan checkout biasa (bukan retur/tahanan).

## 7. HR & organisasi (§6A–§6D, §6G)

Dari keadaan embrio di S0 (master 8 kolom, tanpa absensi/cuti/riwayat),
kaki HR kini terimplementasi luas:

- **§6A PASS (dengan sisa):** master departemen & jabatan, atasan,
  cabang, kontrak PKWT bertanggal + peringatan berakhir, dan riwayat
  perubahan otomatis (jabatan, departemen, gaji pokok, kontrak, cabang,
  atasan, status) dengan snapshot before/after — S7B-1 Batch 1, 8 test.
  Sisa: dokumen/lampiran kontrak belum ada.
- **§6B PASS (manual/CSV):** master shift (lintas tengah malam,
  pola hari kerja), penugasan bertanggal efektif, catatan harian dengan
  menit terlambat terhitung, impor CSV dengan error per baris, rekap
  periode, isolasi antar-perusahaan teruji. Integrasi perangkat
  (fingerprint/geolocation) NOT IMPLEMENTED dengan requirement
  tertulis.
- **§6C PASS:** jenis cuti terkonfigurasi (jatah, berbayar/tidak,
  aktif/tidak), saldo = jatah − terpakai + carry-over bersaklar,
  pengajuan melebihi saldo & tumpang tindih ditolak, pengesahan menulis
  absensi otomatis, cuti tak berbayar menjadi potongan bernama di run
  (2 hari × 4.400.000/22 = Rp400.000 teruji).
- **§6D diperluas:** lembur berpersetujuan dan THR kini terhubung ke
  run sebagai komponen bernama (menutup R-6 S2); final pay per karyawan
  adalah satu-satunya run per karyawan. Yang tetap NOT IMPLEMENTED:
  payroll mingguan, run per kelompok, pembayaran sebagian dalam run
  reguler, dan pemisahan tunjangan tetap/tidak tetap di master (H-3 —
  dasar BPJS/UMP masih pokok + tunjangan gabungan).
- **§6G PASS (dengan sisa):** terminasi terstruktur — prorata hari
  kerja terpakai, PPh 21 mode masa terakhir (terbukti hitung ulang:
  potongan final Rp360.000, bukan TER Rp200.000), kasbon **dan**
  pinjaman ditagih dari pembayaran akhir dengan penjaga penegasan
  kekurangan, karyawan hilang dari run reguler, histori abadi, tidak
  bisa dihapus. Sisa: pesangon/UPMK/kompensasi PKWT otomatis belum
  dimodelkan (requirement tertulis), dan penonaktifan akun login
  tertaut belum terhubung.

## 8. Payroll Indonesia & verifikasi regulasi (§6E–§6F)

**Yang dibangun (S2, diperluas S7B-1):** konfigurasi regulasi per
perusahaan dalam 10 tabel bertanggal efektif (PTKP, lapisan TER A/B/C,
lapisan Pasal 17, program BPJS, parameter, pengali lembur, upah minimum
per wilayah); engine murni tanpa satu pun angka regulasi di kode;
snapshot komponen per item run (`payroll_item_lines`) sehingga slip &
rekap dibaca dari snapshot, bukan dari konfigurasi berjalan; jurnal
terpisah Dr beban BPJS perusahaan / Cr utang BPJS / Cr utang PPh 21
lewat pemetaan akun; slip gaji cetak; ekspor CSV rekap setoran.

**Hasil test case regulasi:** TC-01…TC-12 lulus pada level unit
(20 test) dan integrasi (13 test), termasuk TC-05 kanonis (Desember
TK/0 bruto Rp10 jt/bln → potongan masa terakhir **Rp620.000** persis),
TC-11 (kasbon tidak mengurangi bruto pajak), TC-12 (run di bawah UMP
ditolak tanpa pengakuan eksplisit). Bukti bukan-hardcode: mengubah
baris TER efektif mengubah hasil periode berikutnya (PPh 200.000 →
500.000) tanpa menyentuh snapshot periode sebelumnya.

**Status verifikasi regulasi — dinyatakan persis:**

| Angka | Status verifikasi | Disemai? |
|---|---|---|
| PTKP TK/0…K/3 (PMK 101/PMK.010/2016) | Terverifikasi penuh | Ya |
| Lapisan TER A/B/C (Lampiran PP 58/2023; PMK 168/2023) | Terverifikasi & diverifikasi silang 2026-11-04 (S2 §3); riset S0-C mencatat cuplikan awal riset hanya memverifikasi lapisan awal A + ambang 0% B/C baris demi baris | Ya (125 lapisan × perusahaan) |
| Pasal 17 (UU 7/2021 HPP), biaya jabatan 5% maks 500 rb/6 jt, surcharge non-NPWP 20% | Terverifikasi penuh | Ya |
| BPJS Kesehatan 5% (4/1), batas dasar Rp12.000.000 (Perpres 64/2020) | Terverifikasi penuh | Ya |
| JHT 5,7% (3,7/2); JKK 0,24–1,74% per kelas; JKM 0,30% | Terverifikasi penuh | Ya |
| JP 3% (2/1), batas upah **Rp10.547.400 efektif 2025-03-01** | Terverifikasi penuh | Ya |
| JKP 0,36% sejak PP 6/2025, batas dasar Rp5.000.000 | Terverifikasi penuh | Ya |
| THR prorata (Permenaker 6/2016); pengali lembur & upah sejam 1/173 (PP 35/2021) | Terverifikasi penuh | Ya (sebagai konfigurasi & fungsi) |
| UMP contoh 2026: DKI Jakarta Rp5.729.876; Jawa Barat Rp2.317.601 | Terverifikasi (Kepgub/SK Gubernur via sumber S0-C) | Ya, sebagai contoh wilayah; wilayah lain ditambah admin |
| **Batas upah JP 2026 Rp11.086.300** | **Terverifikasi sebagian** — dari surat BPJS yang dikutip sumber sekunder; belum dikonfirmasi ke pengumuman resmi BPJS | **Tidak** — struktur bertanggal siap; admin menambah baris efektif bila resmi |
| **Lapisan TER harian** | **Tidak terverifikasi** baris demi baris dalam riset | **Tidak** — pegawai harian memakai TER bulanan; R-1 terbuka |
| **Status PPh 21 DTP 2026** (mis. PMK 105/2025) | **Tidak terverifikasi** cakupan/statusnya untuk 2026 | **Tidak** — belum ada flag DTP; R-4 terbuka |
| Nomor SE Menaker THR 2026 | Terverifikasi sebagian (disebut sumber sekunder) | Tidak relevan ke hitungan (rumus dari Permenaker) |

**§6F sesudah S7B-2:** kasbon PASS sejak A-11; pinjaman karyawan
terpisah kini PASS (seri PJM, cicilan tenor/fixed sebagai baris
tersendiri di payroll, pulih saat void, ditagih di final pay);
reimbursement PASS sebagai klaim berpersetujuan maker-checker yang
**dibayar tunai langsung** (keputusan arsitektur tercatat: bukan
penghasilan karyawan, tidak mencemari komponen pajak; akun piutang
karyawan terbukti tidak tersentuh). Sisa: persetujuan atasan untuk
kasbon belum ada; lampiran reimbursement baru nama berkas teks;
uang muka dinas ber-pertanggungjawaban belum termodelkan.

## 9. Akuntansi & laporan keuangan (§7)

Invariant mandat §7 teruji berlapis: keseimbangan debit = kredit
dipaksakan di gerbang jurnal tunggal `postJournal`; neraca seimbang
pada simulasi (S1 §2) dan pada data benchmark 1 jt baris jurnal
(sidik jari neraca saldo Dr = Cr identik sebelum/sesudah optimasi,
S4 §5); laporan yang ada (Laba Rugi dengan pembanding tahun lalu,
Neraca, Arus Kas, Perubahan Ekuitas, Neraca Saldo, Penjualan, CALK,
Buku Besar, Jurnal, AR/AP aging dari tanggal dokumen, Valuasi,
Pergerakan Stok) divalidasi sampai cocok ke transaksi sumber di S1 &
matriks program sebelumnya; periode terkunci menolak posting
(`PERIOD_CLOSED` teruji di S1 langkah 36 dan jalur penerimaan).

Yang belum ada pada kaki ini: **laporan pajak khusus (PPN/SPT)** dan
**Budget vs Actual** (keduanya NOT IMPLEMENTED sejak S0, tidak dibangun
pada program ini), jurnal penutup tahun buku eksplisit, cetak bukti
pembayaran hutang/piutang dan faktur penjualan formal (REM-22), serta
pagination daftar piutang/utang (REM-07). Beban operasional berfungsi
tetapi tanpa lampiran, persetujuan, dan pemisahan PPN masukan —
keterbatasan yang sudah diakui sejak A-12 dan belum berubah.

## 10. Expense, petty cash & aset tetap (§8)

- **Expense:** pencatatan beban operasional berfungsi (akun beban ×
  akun pembayaran, void beralasan); kategori beban adalah pilihan akun
  COA, bukan master terpisah; laporan beban = daftar berpaginasi +
  Laba Rugi. Lampiran & persetujuan: NOT IMPLEMENTED.
- **Petty cash:** modul khusus (dana tetap/imprest, pengisian ulang,
  pertanggungjawaban) **NOT IMPLEMENTED** — kas kecil tetap akun GL
  biasa (1010). Tidak ada fase SIM-2 yang membangunnya; requirement
  mandat §8 untuk butir ini belum tertutup.
- **Aset tetap:** dibangun penuh untuk garis lurus di S7B-2 — kategori
  terkonfigurasi (umur manfaat, residu, akun per kategori dengan
  resolusi kategori > pemetaan), registrasi seri AST, run bulanan satu
  jurnal agregat **idempoten** (proses ulang ditolak + indeks unik
  parsial), nilai buku & akumulasi laporan **tie-out ke GL 1510**
  teruji, pelepasan dengan gain/loss terpisah, void run membalik jurnal
  (rincian run dihapus agar periode dapat diproses ulang — keputusan
  tercatat). Metode selain garis lurus: NOT IMPLEMENTED.

---

## 11. Master Data Management (§18)

Dibanding matriks audit S0-B, kenaikan kelas yang terbukti di S3 & S7:

- **Ekspor mengikuti filter** untuk produk (baru), pemasok, pelanggan,
  dan akun — satu definisi kondisi filter bersama antara daftar,
  ekspor, dan pemilihan bulk edit, sehingga "yang terlihat" tidak bisa
  berbeda dari "yang terekspor". Ekspor produk round-trip ke impor
  terbukti (10 field terpetakan; kolom stok awal sengaja tidak
  terpetakan agar impor ulang tidak memposting stok).
- **Bulk edit produk berpreview**: pemilihan per baris atau semua hasil
  filter; pratinjau server (sampel 50 + total + daftar bermasalah)
  terbukti tidak mengubah data; penerapan satu transaksi dengan
  konfirmasi literal di server, baris bermasalah dilewati & dilaporkan
  per baris, satu baris audit per batch. Bukti: 200 produk naik 5%
  cocok hitungan persis.
- **Audit trail pihak tertutup**: create/update supplier & customer
  (termasuk perubahan batas kredit, before/after) dan cabang kini
  teraudit; penampil riwayat perubahan per record tersedia untuk
  pihak (S3), produk, dan akun (S7 REM-03).
- **Deteksi duplikat & merge**: panel duplikat (trigram nama ≥ 0,45,
  telepon ternormalisasi, NPWP sama) + peringatan lembut di formulir;
  merge memetakan ulang seluruh referensi operasional dalam satu
  transaksi dengan **assert saldo pasca-merge = jumlah saldo sebelum**
  (ketidakcocokan = rollback), duplikat dinonaktifkan bercatatan,
  audit dua sisi. Tag pihak pada baris jurnal terposting sengaja tidak
  dipetakan ulang (append-only) — tidak memengaruhi saldo karena
  subledger dihitung dari dokumen operasional.
- **Halaman detail pihak**: profil §18D, saldo dari fungsi subledger
  yang sama dengan daftar global, riwayat dokumen & pembayaran, sisa
  Kredit Pemasok, riwayat perubahan.
- **Field §18D** (migrasi 0028): NPWP kedua pihak, rekening bank
  pemasok, termin pembayaran — tersimpan, tampil, teraudit, ikut
  impor/ekspor; termin menjadi bawaan jatuh tempo dokumen saldo awal.

Yang tetap NOT IMPLEMENTED (§3.7): bulk delete massal (disengaja),
duplicate record, saved views & kolom kustom, impor update-existing
untuk master pihak/akun + rollback batch, status archived/draft
terpisah, panel kualitas data umum (duplikat pihak tertutup; harga 0 /
barcode kosong belum), varian/multi-barcode/brand/kode produk
supplier/stok maksimum/lokasi default, dan termin → jatuh tempo
dokumen pembelian (menunggu kolom `due_date`).

## 12. Konfigurasi & saklar (D-25) yang kini tersedia

Prinsip D-25 — semua parameter fiskal/regulasi berupa konfigurasi per
perusahaan bertanggal efektif + saklar per komponen — terdaftar
sebagai berikut (lokasi persis di laporan fase terkait):

**Payroll Indonesia (S2, C-1…C-18):** saklar engine; saklar PPh 21;
saklar + tarif pekerja/perusahaan + cap/floor per program BPJS
(Kes/JHT/JKK/JKM/JP/JKP); kelas risiko JKK per karyawan; flag perilaku
program (menambah bruto pajak / pengurang tahunan / beban kas);
PTKP per status + pemetaan kategori TER; seluruh lapisan TER & Pasal
17; biaya jabatan, surcharge non-NPWP, ambang THR, pembagi lembur;
pengali lembur per skenario; upah minimum per wilayah + tahun;
kepesertaan per karyawan per program; pemetaan akun 2110/2120/6080.

**HR (S7B-1):** tabel `hr_parameters` — `working_days_per_month`,
`default_work_days`, `overtime_payroll_enabled`,
`unpaid_leave_payroll_enabled`, `leave_carry_over_enabled`,
`contract_expiry_warning_days`, daftar alasan terminasi; master
departemen/jabatan/shift/jenis cuti yang dapat dikelola admin.

**Transaksi & dokumen (S7B-2 + yang sudah ada):** saklar offline POS
(`pos_offline_enabled`, bawaan mati), saklar transfer dua tahap
(`transfer_two_step_enabled`, bawaan mati), ambang persetujuan PR
(`pr_approval_threshold`), pemetaan akun pinjaman karyawan & lima kunci
aset tetap + akun per kategori aset, saklar PPN (`tax_enabled`) +
tarif PPN per perusahaan, ambang approval penyesuaian stok, ambang
diskon POS, saklar modul, penomoran dokumen kustom, pengaturan cetak,
pemetaan akun menyeluruh, custom fields.

**Yang masih ter-hardcode / belum terkonfigurasi** (daftar jujur S2
H-2…H-7, sebagian tertutup): format periode payroll hanya bulanan;
dasar BPJS & cek UMP = pokok + tunjangan gabungan; bawaan PTKP TK/0
bila status kosong (tercatat `ptkpAssumed` di snapshot); kode program
statutory adalah kosakata skema (program regulasi baru di luar enam
membutuhkan perubahan kode); tarif PPN belum bertanggal efektif.
H-1 (tanggal jurnal payroll `‹periode›-28`) **tertutup** di S7 REM-04 —
run baru bertanggal akhir bulan kalender sebenarnya.

## 13. Performa & skala (§10, S4)

Pengukuran nyata pada DB dev (PostgreSQL 18.6) atas dua perusahaan
benchmark sintetis — Skala A: 10 rb produk, 100 rb baris penjualan,
45 rb entri jurnal; Skala B: 100 rb produk, 1 jt baris penjualan,
5,1 jt pergerakan stok, 500 rb entri / 1 jt baris jurnal. Data volume
dimasukkan via SQL `generate_series` (bukan domain — tujuannya volume;
kebenaran domain dibuktikan S1), invariant dijaga (0 jurnal tak
seimbang, stok = Σ gerakan), dan dataset dihapus bersih sesudahnya.

Hasil terpilih (p50, sebelum → final):

| Operasi | Skala A | Skala B |
|---|---:|---:|
| Daftar produk hal. 1 | 18,0 → 6,1 ms | 134,6 → 15,1 ms |
| Daftar penjualan | 63,4 → 6,9 ms | 354,2 → 38,9 ms |
| Data halaman Payroll (N+1 → batch) | 238,7 → 16,5 ms | 210,7 → 18,8 ms |
| Valuasi persediaan (halaman) | 85,9 → 81,1 ms | 809,2 → 821,6 ms |
| Neraca saldo 12 bulan | 191,5 → 404,5 ms † | 4.597,3 → 5.061,3 ms † |
| Laba rugi 12 bulan | 152,6 → 155,2 ms | 2.030,8 → 2.325,7 ms |
| Ringkasan beranda | 214,4 → 234,9 ms | 4.607,8 → 4.684,5 ms |
| Pencarian teks jurnal | 80,9 → 81,8 ms | 839,6 → 845,4 ms |

† S4 mencatat secara eksplisit: angka final agregasi tahunan tampak
lebih lambat karena sesi sesudah berjalan dengan dataset gabungan
3,1 GB & cache berbagi (variansi antar-sesi terukur hingga ±2×);
rencana query & sidik jari hasil identik — bukan regresi perubahan S4.
**Seluruh 48 pasang sidik jari hasil (24 operasi × 2 skala) identik
sebelum vs sesudah optimasi** — optimasi tidak mengubah satu pun angka
laporan.

Temuan indeks yang menentukan: 4 indeks dipertahankan (penjualan per
waktu, produk per nama, beban per tanggal, item payroll per karyawan);
4 indeks trigram **dibatalkan dengan bukti** — operator LIKE/ILIKE
tidak leakproof sehingga di bawah FORCE RLS planner tidak pernah
memilih GIN trigram untuk peran aplikasi (dampak lanjut: pencarian
teks jurnal tetap ±0,85 dtk di skala B; R-3).

Uji beban ringan: 10 worker campuran 30 detik — Skala A 1.416 operasi,
0 error, p95 703 ms; Skala B 173 operasi, 0 error, p95 6.793 ms
(ditahan operasi valuasi). Ini uji stabilitas satu node sandbox, bukan
klaim kapasitas produksi.

**Batas yang tersisa (requirement S4):** R-1 beranda 4,6 dtk di skala
B (agregasi materialized), R-2 streaming ekspor (heap ±200 MB pada
100 rb baris), R-4 ringkasan saldo bulanan untuk agregasi tahunan
2–5 dtk, R-5 pagination AR/AP (REM-07).

## 14. Backup, restore & round-trip (§11, S5)

| Butir §11 | Status | Bukti |
|---|---|---|
| Backup DB manual | PASS (prasyarat client PG ≥ versi server) | Dump 2.699.103 byte, sha256 tercatat, isi terbaca penuh |
| Backup terenkripsi (opt-in) | PASS | Restore identik; frasa sandi salah ditolak |
| Restore ke DB baru | PASS | 3× restore, **identik pada ±80 tabel**, neraca saldo, valuasi, subledger |
| Verifikasi aplikasi sesudah restore | PASS | Keluaran 5 fungsi laporan identik byte-per-byte (108.383 byte) |
| Round-trip aplikasi: master (produk/pihak/akun) | PASS | Test permanen 12 test; field §18D utuh berpindah |
| Round-trip aplikasi: stok & nilai persediaan | PASS | 95/10 qty; Rp337.500 = Rp337.500 |
| Round-trip aplikasi: saldo awal AR/AP | PASS | Rp525.000 & Rp245.000 per dokumen, aging utuh |
| Round-trip aplikasi: transaksi & jurnal penuh | **NOT IMPLEMENTED** | RT-04 — tidak ada impor jurnal; migrasi antar-sistem = saldo awal; pemindahan utuh via backup/restore DB |
| Backup terjadwal + retensi + off-site | NOT IMPLEMENTED | Requirement di runbook (REM-18) |
| Uji restore berkala otomatis | NOT IMPLEMENTED | Requirement di runbook (REM-18) |

Dua temuan prosedural penting dari S5: (RT-01) prosedur backup
terdokumentasi semula **gagal total** di lingkungan ini karena client
sistem PG16 vs server PG18 — runbook kini menyatakan prasyarat versi
secara eksplisit dan target rilis wajib menyediakan client PG18;
(RT-02) kegagalan dump sempat meninggalkan berkas 0 byte yang tampak
seperti backup — skrip kini menulis `.tmp` dan hanya mengganti nama
saat sukses. (RT-03) Restore ke database **baru** menghasilkan 0 grant
untuk `app_user` (dump `--no-privileges`) — runbook memuat langkah
wajib penerapan ulang grant; tanpa langkah itu aplikasi hasil restore
mati total.

## 15. Keamanan (§13, S6 + verifikasi S0-D)

- **SEC-01 (TINGGI) TERTUTUP:** izin baca baru `payroll.view`; enam
  permukaan gaji/kasbon digerbang ulang; accountant & viewer tidak lagi
  membaca gaji; 34 test permusuhan membuktikan penolakan per peran.
- **Matriks RBAC teruji:** 15 aksi × 7 peran dipanggil sebagai aksi
  server sungguhan — nol ketidakcocokan dengan `permissions.ts`;
  diskriminator terbukti (kasir menjual tetapi tidak void; manager
  posting jurnal tetapi tidak tutup periode; akuntan tutup periode
  tetapi tidak menyentuh payroll).
- **Temuan S0-D lain:** plugin Better Auth dorman `admin()`/
  `organization()` dicabut (endpoint 404, login terbukti hidup);
  sign-up publik dimatikan; `xlsx` 0.18.5 → 0.20.3 dari CDN resmi
  SheetJS (dua CVE tertambal); validasi QRIS disatukan; injeksi formula
  CSV dinetralkan; rate limit login dibuat eksplisit.
- **Terverifikasi baik dan tetap berlaku:** 140+ ekspor aksi tanpa satu
  pun tanpa gerbang izin; semua rute API bergerbang; RLS ENABLE+FORCE;
  nol SQL tak terparameterisasi; nol `dangerouslySetInnerHTML` atas
  data pengguna; isolasi lintas perusahaan terkunci test.
- **Sisa risiko yang diterima sadar:** rate limit in-memory per
  instance (REM-16); plugin `twoFactor` dorman tanpa UI; penampil
  audit log global belum ada (per-record sudah, REM-03); kredensial
  dev docker tetap terpublikasi untuk lokal dengan peringatan deploy
  tertulis (wajib diganti — Lampiran A).

---

## 16. UI/UX & cetak (§14)

Permukaan cetak yang teruji: nota POS (thermal 58/80 mm terukur
MediaBox, A5, A4), GRN, PO, dokumen retur pembelian (RTB), voucher
jurnal, slip gaji per karyawan (baru di S2, dari snapshot run), dan
semua laporan keuangan berkop formal dengan nomor halaman — program
perbaikan cetak sebelumnya menutup 26/26 temuan CT, dan SIM-2 tidak
menemukan regresi cetak (e2e S8 hijau; rute cetak baru ikut ter-build).
Kustomisasi template (3 gaya, logo, warna aksen, font, teks kop/kaki,
tanda tangan, QR nomor dokumen, ukuran kertas per jenis dokumen)
berfungsi dengan batas **satu template aktif per perusahaan**.
Aksesibilitas: axe WCAG 2 A/AA = 0 pelanggaran pada 5 rute utama
(e2e S8).

Yang belum: bukti pembayaran hutang/piutang tercetak dan faktur
penjualan formal di luar nota (REM-22); bukti mutasi kas sesi sebagai
dokumen Print Engine khusus; laporan gudang (kartu stok/valuasi)
tercetak lewat kerangka aplikasi, bukan dokumen Print Engine khusus
(PARTIAL, S0-A §14).

## 17. Remediasi — tertutup vs terbuka

**Tertutup dengan bukti test (S6/S7/S7B):** SEC-01…SEC-03, SEC-05…
SEC-08, SEC-10 (S6); REM-01 integritas referensial — 27 FK database +
pembersihan yatim fixture tercatat di migrasi 0031 (S7); REM-02
snapshot nama+SKU pada baris PO/penerimaan/dokumen stok/retur (0032);
REM-03 penampil riwayat perubahan per record; REM-04 tanggal jurnal
payroll akhir bulan; REM-05 dead code `listCashSessions`; REM-06 status
tabel `outbox` diputuskan (kemudian benar-benar dipakai S7B-2);
REM-23 HR lanjutan (S7B-1 + S7B-2, dengan sisa tertulis di §7–§8);
REM-24 sebagian (Purchase Request, reservasi, in-transit, serial —
S7B-2); R-6 S2 (THR/lembur terhubung run — S7B-1).

**Terbuka dengan requirement + acceptance criteria tertulis:**

| ID | Isi | Sumber requirement |
|---|---|---|
| REM-07 | Pagination server daftar piutang/utang (`listPayablesPage`/`listReceivablesPage`) | S7 §3 |
| REM-08 | Indeks unik kategori bertingkat (diblokir asumsi impor berbasis nama) | S7 §3 |
| REM-09/10/12 | Agregasi beranda materialized; streaming ekspor ≥100 rb baris; ringkasan saldo bulanan | S4 R-1/R-2/R-4; S7 §3 |
| REM-11 | Pencarian teks jurnal (keputusan produk; trigram terbukti tak terpakai di bawah RLS) | S4 R-3 |
| REM-13 | Indeks trigram nama produk warisan — keputusan: pertahankan | S7 §3 |
| REM-14 | `VACUUM FULL` berkas DB dev 3,1 GB — operasional, jendela pemeliharaan | S4 R-7 |
| REM-15 | Sisa payroll Indonesia per butir: H-2, H-3/H-5, H-4, H-6, R-1 TER harian, R-2 PPN bertanggal, R-3 toggle PPN per transaksi, R-4 DTP, R-5 bayar setoran, R-7 gross-up, R-8 ESS | S2 §6–§7 |
| REM-16 | Rate limit storage database / di reverse proxy untuk multi-instance | S6 §4 |
| REM-17 | Round-trip transaksi & jurnal penuh tingkat aplikasi (NOT IMPLEMENTED by design, RT-04) | S5 §2.2 |
| REM-18 | Backup terjadwal + retensi + off-site + uji restore berkala otomatis | Runbook S5 |
| REM-19/20 | Fitur master: varian, multi-barcode, brand, kode produk supplier, stok maks, lokasi default; saved views; impor update-existing + rollback batch; panel kualitas data umum; duplicate record; status archived/draft | S3 sisa |
| REM-21 | Refactor: gabung dua wizard impor; pecah berkas domain raksasa (`pos.ts`, `reports.ts`, `inventory.ts`, `actions/accounting.ts`) | S0-A §4 |
| REM-22 | Cetak bukti pembayaran hutang/piutang & faktur penjualan formal | S0-A §5 #9 |
| REM-24 sisa | Banding harga pemasok; diskon/biaya penerimaan; penjaga invoice duplikat; stock aging; dead/fast/slow moving | S0-A §3–§4 |
| **S8-LINT** (baru) | Lint exit 1: error `react-hooks/set-state-in-effect` di `pos-terminal.tsx:656` + 6 warning — perbaiki efek penahan quote produk serial (pola: turunkan state, bukan setState sinkron dalam effect) dan bersihkan impor tak terpakai; gerbang S7B tidak menjalankan lint sehingga lolos | Regresi S8 §2 |

## 18. Utang teknis tersisa

1. **Dua wizard impor paralel** (901 vs 610 baris) berbagi backend
   tetapi mengimplementasikan ulang pratinjau/seleksi — perilaku bisa
   menyimpang diam-diam (REM-21).
2. **Berkas domain raksasa:** `pos.ts` ±2.100 baris, `reports.ts`
   ±2.080, `inventory.ts` ±1.889, `supplier-returns.ts` ±1.652,
   `actions/accounting.ts` ±1.544 (S0-A §4) — biaya perubahan & review
   naik; ekstraksi per subdomain sudah dimulai sebagai pola.
3. **Satu error lint aktif** (S8-LINT, §17) — satu-satunya gerbang
   merah pada pohon final.
4. **Indeks kategori datar** `(company_id, name)` bertabrakan dengan
   model kategori bertingkat (REM-08, diblokir asumsi impor).
5. **Ketergantungan install pada `cdn.sheetjs.com`** untuk paket
   `xlsx` (integrity terkunci di lockfile) — konsekuensi penutupan
   SEC-05.
6. **Rate limit in-memory** dan **plugin twoFactor dorman** (REM-16,
   S6 §4).
7. Berkas DB dev 3,1 GB pasca-benchmark (tuple mati; ruang dapat
   dipakai ulang internal; `VACUUM FULL` belum dijalankan — REM-14).

## 19. Penilaian 18 syarat acceptance §17

Rumusan syarat mengikuti butir mandat §1–§18 sebagaimana tercatat pada
A-14 (lihat catatan metodologis di kepala laporan). Penilaian:
**TERPENUHI / SEBAGIAN / TIDAK**.

| # | Syarat (butir mandat) | Nilai | Alasan ringkas |
|---|---|---|---|
| 1 | §1 Inventaris fitur & peta dependensi sebelum perubahan | **TERPENUHI** | S0-A…S0-D lengkap berbasis bukti kode; nol fitur mock ditemukan; baseline 590/590 tercatat |
| 2 | §2 Simulasi perusahaan dari nol di DB aktual | **TERPENUHI** | S1 SimMart 36/36 PASS dengan rekonsiliasi persis (§4) |
| 3 | §3 Procurement lengkap tervalidasi per langkah | SEBAGIAN | Alur inti + PR PASS; banding harga, diskon/biaya penerimaan, penjaga invoice duplikat belum ada (REM-24) |
| 4 | §4 Gudang lengkap; cegah overselling & stok negatif tanpa kebijakan | SEBAGIAN | Penjaga terbukti (konkurensi S1); reservasi/in-transit/serial PASS; aging & dead/fast-slow belum ada; multi-satuan ditolak sadar (D-17) |
| 5 | §5 POS lengkap (metode, split, hold, retur, sesi, kasir bersamaan) | SEBAGIAN | Semua skenario inti PASS di S1; cash drop khusus & promosi/kupon belum ada; kartu tanpa integrasi EDC |
| 6 | §6 HR lengkap (§6A–G) | SEBAGIAN | 6A/6B/6C/6G terimplementasi & teruji; ESS, perangkat absensi, pesangon otomatis, persetujuan kasbon belum |
| 7 | §6E Payroll Indonesia tervalidasi regulasi resmi & configurable | SEBAGIAN | Engine + TC-01…12 PASS dan terbukti bukan-hardcode; batas JP 2026 & TER harian & DTP belum terverifikasi penuh sehingga sengaja tidak disemai |
| 8 | §7 Akuntansi: jurnal & laporan cocok ke sumber; debit = kredit; neraca balance; periode terkunci | SEBAGIAN | Invariant & laporan yang ada teruji cocok (S1, S4); laporan pajak & Budget vs Actual tidak ada; jurnal penutup tahun eksplisit tidak ada |
| 9 | §8 Expense, petty cash, aset tetap & penyusutan | SEBAGIAN | Aset tetap garis lurus PASS & tie-out GL; petty cash khusus tidak ada; expense tanpa lampiran/persetujuan |
| 10 | §9 Siklus harian/mingguan/bulanan/tahunan berjalan | SEBAGIAN | Harian & bulanan teruji ujung-ke-ujung (S1); tahunan parsial (rekap pajak tahunan & jurnal penutup belum) |
| 11 | §10 Data besar & benchmark terukur; pagination & agregasi server-side | SEBAGIAN | Benchmark nyata dua skala + invariansi angka; agregasi tahunan tetap 2–5 dtk, pagination AR/AP & streaming ekspor terbuka (R-1/R-2/R-4/R-5) |
| 12 | §11 Import/export/backup: round-trip terverifikasi; backup valid hanya sesudah restore berhasil | SEBAGIAN | Restore DB identik penuh PASS; round-trip aplikasi parsial by design (RT-04); penjadwalan & uji berkala belum |
| 13 | §12 Offline POS tidak kehilangan transaksi | SEBAGIAN | Domain terbukti: sinkron idempoten, duplikat tidak dobel, konflik masuk peninjauan (tidak hilang diam-diam); **uji browser offline sungguhan NOT TESTED** — syarat belum boleh dinyatakan terpenuhi sebelum acceptance manual S7B-2 dijalankan |
| 14 | §13 Keamanan OWASP; RBAC teruji via UI & request langsung | **TERPENUHI** | Matriks aksi sungguhan nol cacat; SEC-01 tertutup; sisa risiko terdokumentasi & diterima sadar (bukan lubang tak tercatat) |
| 15 | §14 UI/UX & cetak lengkap termasuk slip gaji | SEBAGIAN | Slip gaji PASS; bukti pembayaran & faktur formal belum (REM-22); satu template per perusahaan |
| 16 | §15 Kualitas kode: tanpa overengineering/rewrite tanpa bukti | **TERPENUHI** | Tidak ada rewrite; fondasi dipertahankan; dead code & yatim ditutup berdasar bukti. Catatan terbuka: satu error lint S8-LINT (§17) — cacat kecil terdokumentasi, bukan pelanggaran proses |
| 17 | §16 Remediasi per temuan: reproduksi → root cause → perbaiki → test → rerun | SEBAGIAN | Proses diikuti semua fase; REM-01…06 & temuan S6 tertutup ber-TDD, S7B menutup pembangunan besar; REM-07…REM-24 sisa berrequirement (§17 laporan ini) |
| 18 | §18 Master data: CRUD, bulk, merge, lifecycle, audit trail | SEBAGIAN | Bulk edit/merge/duplikat/detail/audit PASS; saved views, impor update-existing, archived/draft terpisah, varian/multi-barcode belum |

**Rekap: 4 TERPENUHI · 14 SEBAGIAN · 0 TIDAK.**

Dua syarat yang paling menahan vonis "siap penuh", dinyatakan terus
terang: **#13 (offline POS)** — fitur terbangun dan terbukti di level
domain/antrean, tetapi bukti browser offline sungguhan belum ada; dan
**#12/#17 (impor jurnal / RT-04)** — round-trip transaksi penuh tingkat
aplikasi adalah NOT IMPLEMENTED by design, sehingga migrasi
antar-sistem hanya sah lewat saldo awal atau backup/restore database.

## 20. Rekomendasi prioritas lanjutan

1. **Tutup S8-LINT sekarang** (usaha kecil): perbaiki efek
   `pos-terminal.tsx:656` + bersihkan 6 warning, lalu jadikan lint
   bagian wajib gerbang setiap fase (S7B lolos karena tidak
   menjalankannya).
2. **Jalankan acceptance manual offline POS** (4 langkah di S7B-2
   Batch 6) pada perusahaan uji, dan pertimbangkan e2e Playwright
   dengan konteks offline agar syarat #13 punya bukti otomatis.
3. **Verifikasi resmi tiga angka regulasi** ke sumber primer (batas JP
   2026 ke pengumuman BPJS Ketenagakerjaan; lapisan TER harian ke
   Lampiran PP 58/2023; status DTP 2026 ke PMK terkait) — sesudah itu
   penyemaian tinggal menambah baris konfigurasi bertanggal.
4. **REM-07 + R-4/R-1 (performa produksi):** pagination AR/AP, lalu
   tabel ringkasan saldo bulanan & agregasi beranda materialized bila
   target produksi menuntut laporan tahunan < 1 detik di skala ≥ 1 jt
   baris jurnal.
5. **REM-22 (cetak bukti pembayaran & faktur formal)** — permukaan
   cetak murah di atas Print Engine yang sudah matang, berdampak
   langsung ke operasional.
6. **REM-18 (operasional backup):** penjadwalan + retensi + off-site +
   uji restore berkala otomatis mengikuti runbook S5; sertakan
   `scripts/post-restore-grants.sql` resmi (rekomendasi RT-03).
7. **Keputusan pemilik yang masih terbuka:** petty cash khusus,
   pesangon/UPMK otomatis, ESS karyawan, laporan pajak (SPT), Budget
   vs Actual, dan impor jurnal antar-sistem — semuanya sudah
   berrequirement; bangun hanya atas keputusan eksplisit, jangan
   disimulasikan.

---

## Lampiran A — Catatan deploy

1. **Migrasi:** target rilis wajib `pnpm db:migrate` sampai **0038**.
   Jalankan dari folder db dengan env dimuat
   (`set -a; . ./.env.local; set +a`) karena drizzle-kit tidak membaca
   `.env.local`.
2. **Catatan khusus per migrasi:**
   - **0018** (program sebelumnya): tautan rekonsiliasi ganda harus
     dibersihkan manual sebelum indeks unik teraplikasi.
   - **0022**: `DROP COLUMN receipt_width_mm` — destruktif-semu, aman
     (nol konsumen).
   - **0027**: backfill akun 2110/2120/6080 + konfigurasi payroll
     Indonesia untuk semua perusahaan, engine tersemai **nonaktif** —
     tidak ada perubahan perilaku saat upgrade.
   - **0031**: memasang 27 FK dan **menghapus baris stok yatim** pada
     perusahaan fixture (anti-join ke produk yang sudah tidak ada);
     pada instalasi bersih DELETE ini no-op. Rollback = drop 27
     constraint (nama ada di berkas migrasi).
   - **0032**: 8 kolom snapshot nama/SKU + backfill dari master.
   - **0038**: 12 tabel baru S7B-2 + kolom `track_serial`.
3. **Backup/restore:** client PostgreSQL di mesin target **wajib ≥
   versi server (18)** — client PG16 gagal total terhadap server PG18
   (RT-01). Ikuti `docs/RUNBOOK-BACKUP-RESTORE.md`, termasuk langkah
   wajib penerapan ulang grant `app_user` sesudah restore ke database
   baru (RT-03).
4. **Install:** `pnpm install` membutuhkan akses ke
   **cdn.sheetjs.com** (tarball `xlsx` 0.20.3, integrity terkunci di
   lockfile).
5. **Kredensial:** ganti semua kredensial bawaan sebelum produksi —
   sandi database & MinIO di `docker-compose.yml`/`docker/init.sql`,
   `BETTER_AUTH_SECRET`, dan kata sandi akun demo
   (`owner@bisa.id`) — peringatan yang sama tertulis di README repo
   (SEC-03).
6. **Aktivasi fitur baru bersifat opt-in:** engine Payroll Indonesia,
   offline POS, dan transfer dua tahap semuanya tersemai **nonaktif**;
   aktifkan per perusahaan lewat Pengaturan sesudah konfigurasi
   ditinjau.

## Lampiran B — Indeks bukti

**Laporan fase SIM-2** (semua di `docs/sim2/`): `S0-A-ARSITEKTUR.md`,
`S0-B-MASTER-DATA.md`, `S0-C-HR-PAYROLL.md`,
`S0-D-KEAMANAN-PERFORMA.md`, `S1-SIMULASI.md`, `S2-PAYROLL-ID.md`,
`S3-MASTER-DATA.md`, `S4-BENCHMARK.md` (+ hasil mentah
`scripts/sim2-gen/results/*.json`), `S5-BACKUP-ROUNDTRIP.md` (+ artefak
`~/workspace/bukti-sim2/` + `docs/RUNBOOK-BACKUP-RESTORE.md`),
`S6-KEAMANAN.md`, `S7-REMEDIASI.md`, `S7B1-HR.md`, `S7B2-BANGUNAN.md`.

**Berkas test kunci per klaim:** simulasi bisnis
`tests/sim2/sim-bisnis.test.ts`; payroll Indonesia
`tests/unit/payroll-indonesia.test.ts`,
`tests/sim2/payroll-indonesia.test.ts`,
`tests/sim2/payroll-indonesia-desember.test.ts`,
`tests/sim2/ppn-toggle.test.ts`; master data
`tests/sim2/master-data.test.ts`; keamanan
`tests/sim2/payroll-access.test.ts`, `tests/sim2/rbac-matrix.test.ts`;
round-trip `tests/sim2/s5-roundtrip.test.ts`; HR
`tests/sim2/hr-org-history.test.ts`, `hr-attendance.test.ts`,
`hr-overtime-thr.test.ts`, `hr-leave.test.ts`, `hr-termination.test.ts`;
bangunan S7B-2 `tests/sim2/hr-loans-reimbursement.test.ts`,
`fixed-assets.test.ts`, `purchase-requests.test.ts`,
`reservations-transfers.test.ts`, `serial-numbers.test.ts`,
`pos-offline-sync.test.ts`, `tests/unit/pos-offline-queue.test.ts`;
remediasi `tests/sim2/rem-referential-integrity.test.ts`,
`rem-name-snapshot.test.ts`, `rem-audit-viewer.test.ts`; konsistensi
`tests/integration/consistency.test.ts`; e2e `e2e/` (15 test).

**Commit fase:** S0 `f47b0e8` · S1 `a43c21d` · S2 `a6c169b` · S3
`29720e7` · S4 `8e356f9` · S5 `bb89fa1` · S6 `9c7f928` · S7 `ae2101a` ·
S7B-1 `bf83bd1` · S7B-2 `b86d976`.

## Lampiran C — Usulan ringkasan 3 baris untuk PROGRESS.md (milik Pemimpin)

> - **S8 SELESAI (2026-11-04):** regresi akhir — test 881/881 (101 berkas), build exit 0, typecheck exit 0, e2e 15/15, reseed demo identik baseline (65 produk, Rp28.349.600, consistency 11/11); **lint exit 1** (1 error react-hooks di `pos-terminal.tsx:656` dari S7B-2 + 6 warning) — satu-satunya gerbang merah, tercatat sebagai temuan terbuka S8-LINT.
> - Laporan akhir SIM-2 terbit: `docs/sim2/LAPORAN-AKHIR.md` (20 bagian + lampiran). Acceptance §17: **4 TERPENUHI · 14 SEBAGIAN · 0 TIDAK** dari 18; penahan utama vonis siap-penuh: uji browser offline POS belum dijalankan (domain terbukti, NOT TESTED di browser) dan round-trip transaksi/jurnal tingkat aplikasi NOT IMPLEMENTED by design (RT-04).
> - Status fitur akhir per modul diselaraskan pada addendum SIM-2 di `docs/SPEK-FITUR-INTI.md` §7; sisa pekerjaan seluruhnya berrequirement (REM-07…REM-24, R-1…R-8 S2, S8-LINT).
