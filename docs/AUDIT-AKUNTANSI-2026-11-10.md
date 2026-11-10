# Audit Fitur Akuntansi — 10 November 2026

Dokumen ini menilai **setiap fitur modul Akuntansi** yang ada di aplikasi:
apa yang sudah kuat, apa yang masih kurang dibanding ERP profesional, dan
mana yang perlu diprioritaskan. Fokusnya akuntansi, bukan HR/POS/Gudang.

## 1. Ringkasan eksekutif

Inti pembukuan Bisa ERP **sudah kuat dan lebih terkontrol dari banyak ERP
kecil**: semua uang lewat satu gerbang jurnal, tenant terisolasi, periode
dikunci, jurnal sistem tidak bisa dibalik sembarangan, dan ada rekonsiliasi
akun kontrol vs subledger.

Yang belum selevel ERP profesional bukan fondasi pembukuannya, melainkan
**lapisan analisis, kepatuhan pajak, dan audit**:

1. Laporan keuangan belum punya **periode pembanding** (bulan lalu/tahun
   lalu) — QuickBooks/Xero menyediakannya.
2. Belum ada **laporan PPN/Pajak** sebagai laporan tersendiri.
3. Belum ada **audit trail global**; halaman "Riwayat" masih duplikat daftar
   jurnal, bukan log aktivitas.
4. **Aging piutang/utang** dihitung dari tanggal dokumen, bukan tanggal jatuh
   tempo.
5. Jurnal manual belum punya **lampiran, draft, atau alur persetujuan**.
6. Belum ada **budget vs actual, analytic dimension, dan multi-currency
   conversion** — belum wajib untuk minimarket, tapi penting bila naik kelas.

**Vonis:** untuk minimarket satu entitas, modul Akuntansi sudah **layak
operasional (8,5/10)**. Setelah perbaikan 10 November, gap P1 yang tersisa
adalah lampiran/approval jurnal dan perluasan pembanding ke seluruh laporan.

## Status implementasi 10 November 2026

Sudah dieksekusi:
- Laporan laba rugi & posisi keuangan memiliki **pembanding periode
  sebelumnya/tahun lalu** di layar dan cetak.
- **Laporan PPN** baru: rekap PPN Keluaran/Masukan dari jurnal + cetak + CSV/XLSX.
- **Audit trail** menggantikan daftar jurnal duplikat: aktor, aksi, entitas,
  perubahan, IP, filter, pagination.
- **Aging piutang/utang** memakai tanggal jatuh tempo (fallback tanggal dokumen)
  di layar, cetak, dan ekspor.

Belum dieksekusi (P2/P3): lampiran & approval jurnal, jurnal berulang, aturan
pencocokan bank, budget/analytic dimension, pembanding untuk arus kas/ekuitas,
dan pembanding pada ekspor CSV/XLSX.

## 2. Metode

- Membaca kode 18 halaman Akuntansi + komponen/aksi/server terkait.
- Menjalankan aplikasi dan memeriksa tiap layar pada 1440px (dan audit
  otomatis 390px): tidak ada error JS/overflow pada halaman akuntansi.
- Membandingkan fitur dengan Xero, QuickBooks Online, Odoo Accounting,
  Accurate Online, dan pola SAP Fiori *List Report → Object Page*.
- Memeriksa bukti cetak PDF laporan.

## 3. Scorecard per fitur

| Fitur | Status | Nilai | Catatan singkat |
|---|---|---:|---|
| Dashboard Akuntansi | Kuat | 8,5 | Laba rugi, beban, kas, posisi, antrean kerja, filter periode |
| Bagan akun | Sangat kuat | 9 | Hierarki, tipe, saldo normal, kelas kas/bank, PSAK 118, dampak perubahan, audit per akun |
| Jurnal umum (daftar/form/detail) | Kuat | 8 | Filter lengkap, rincian inline, pembalik terkontrol, cetak/CSV; belum ada draft/approval/lampiran |
| Buku besar | Kuat | 8,5 | Saldo awal–mutasi–saldo akhir, saldo berjalan, CSV/Excel/cetak |
| Kas & bank | Kuat | 8 | Saldo per rekening, transfer + biaya, setoran modal, riwayat, rekonsiliasi |
| Rekonsiliasi bank | Kuat | 8 | Impor CSV, cocok otomatis ±3 hari nominal sama, pencocokan manual, buat jurnal |
| Piutang & utang | Kuat | 8 | Tab, aging berbasis jatuh tempo, pembayaran, write-off, kredit pihak |
| Laporan keuangan | Kuat | 8 | P&L/posisi punya pembanding; arus kas/ekuitas masih satu periode |
| Periode fiskal & tutup buku | Sangat kuat | 9 | Checklist bulanan, tutup/kunci/buka, tutup tahun, laba ditahan |
| Rekonsiliasi kontrol | Sangat kuat | 9 | GL vs subledger piutang/utang/persediaan + tersangka selisih |
| Aset tetap | Kuat | 7,5 | Registrasi, penyusutan garis lurus, pelepasan, rekonsiliasi GL; metode masih terbatas |
| Pajak (PPN) | Kuat | 8,5 | Buku PPN Keluaran/Masukan dari jurnal, cetak, CSV/XLSX |
| Audit trail | Kuat | 8 | Aktor, aksi, entitas, before/after, IP, filter, pagination |
| Migrasi bagan akun | Kuat (niche) | 8 | Dry-run, eksekusi, renumber tanpa memindah saldo |
| Beban (rute lama) | Cukup | — | Redirect ke jurnal baru; tidak ada form beban khusus |

## 4. Penilaian detail

### 4.1 Dashboard Akuntansi — 8,5/10

**Sudah bagus**
- Ringkasan P&L bertingkat: pendapatan → HPP → laba kotor → beban → laba
  bersih.
- Beban per akun dengan porsi dan batang pembanding.
- Posisi keuangan: kas/bank, piutang, utang, persediaan, aset/liabilitas/ekuitas.
- Antrean kerja nyata: piutang terlambat, utang jatuh tempo, mutasi bank,
  klaim, kredit pihak.
- Filter periode: bulan ini, bulan lalu, 3 bulan, tahun ini.
- Deteksi anomali saldo beban negatif (bukan menyembunyikan angka).

**Kurang**
- Belum ada tren laba/rugi multi-bulan; yang ada tren penjualan harian.
- Belum ada budget vs actual.
- Angka KPI "Beban" bisa negatif bila data jurnal rusak; sudah diberi
  peringatan, tetapi belum ada tombol "telusuri akun penyebab" langsung.

**Referensi:** dashboard Xero/QuickBooks juga menonjolkan P&L, cash flow,
dan outstanding, tetapi mereka menambahkan perbandingan periode dan budget.

### 4.2 Bagan akun — 9/10

**Sudah bagus**
- Hierarki induk–anak, tipe akun, saldo normal, kelompok laporan, cash flow group.
- Metadata bank (nama bank, nomor rekening termasker, cabang, pemilik).
- Tagging PSAK 118, sifat/fungsi beban, akun kontra.
- Deteksi akun sistem dari pemetaan/metode pembayaran, bukan flag manual.
- "Dipakai oleh" + audit history per akun.
- Migrasi COA 4 digit → 5 digit dengan dry-run.
- Export CSV, pencarian, filter tipe.

**Kurang**
- 141 akun tampil sebagai satu halaman panjang; grup belum bisa dilipat.
- Belum ada merge/rename massal di luar alat migrasi.
- Multi-currency hanya kolom mata uang, belum ada kurs/konversi.

**Referensi:** Xero menyediakan grup akun dan *find & recode*; Odoo
menambahkan analytic dimension. Fitur inti COA kita setara atau lebih kaya
untuk kebutuhan Indonesia.

### 4.3 Jurnal umum — 8/10

**Sudah bagus**
- Form multi-baris, pencarian akun, penyeimbang otomatis, pola cepat,
  indikator seimbang, peringatan periode tertutup.
- Daftar filter: tanggal, sumber, akun, status, user, pencarian.
- Rincian debit/kredit bisa dibuka langsung dari daftar.
- Detail jurnal: sumber dokumen, pihak, jurnal balik, cetak, CSV.
- Jurnal sistem dilindungi: pembalikan harus dari modul asal.

**Kurang**
- Tidak ada draft jurnal manual; langsung posting.
- Tidak ada lampiran bukti (invoice/kuitansi) pada jurnal.
- Tidak ada approval workflow / segregation of duties.
- Tidak ada jurnal berulang (recurring) atau template tersimpan.
- Daftar filter terlalu padat dalam satu baris (search + tanggal + 4 select).

**Referensi:** QuickBooks/Xero mendukung attachment dan recurring journal;
ERP mid-market menambahkan approval. Untuk minimarket, gap draft/attachment
lebih terasa daripada recurring.

### 4.4 Buku besar — 8,5/10

**Sudah bagus**
- Filter akun + tipe + tanggal.
- Saldo awal, total debit/kredit, saldo akhir.
- Saldo berjalan per baris, tautan ke jurnal.
- CSV, Excel, cetak resmi.

**Kurang**
- Belum ada perbandingan periode.
- Belum ada drill-down per dimensi/cost center.
- Export PDF hanya lewat cetak, belum pilihan PDF langsung.

### 4.5 Kas & bank — 8/10

**Sudah bagus**
- Daftar semua akun kas/bank/QRIS dengan saldo berjalan.
- Transfer antar rekening + biaya administrasi otomatis.
- Setoran modal.
- Riwayat transfer terpisah dengan filter.
- Rekonsiliasi bank.

**Kurang**
- Belum ada saldo per rekening dalam grafik tren.
- Belum ada bank feed/sinkronisasi otomatis; impor masih CSV.
- Belum ada cash flow forecast.

### 4.6 Rekonsiliasi bank — 8/10

**Sudah bagus**
- Impor CSV dengan contoh format dan anti-duplikat.
- Cocok otomatis: nominal sama, selisih tanggal ≤3 hari.
- Ambigu ditandai untuk pencocokan manual.
- Buat jurnal untuk mutasi yang belum tercatat.
- Ringkasan saldo buku vs sudah/belum direkonsiliasi.
- Panel dua kolom mutasi vs buku besar.

**Kurang**
- Belum ada aturan pencocokan (mis. "transfer masuk dari BCA").
- Belum ada pencocokan parsial/split.
- Belum ada bank feed.
- Belum ada laporan rekonsiliasi per periode yang disimpan.

**Referensi:** Odoo punya *smart reconciliation* dan bank sync; Xero bank
feed. Untuk minimarket, CSV + exact match sudah memadai.

### 4.7 Piutang & utang — 8/10

**Sudah bagus**
- Tab piutang/utang dengan jumlah dokumen.
- Ringkasan terbuka, lewat jatuh tempo, jatuh tempo ≤7 hari, kredit pihak.
- Pencarian, filter jatuh tempo, aging.
- Pembayaran per dokumen, write-off, saldo awal, kredit pihak.
- Cetak laporan umur.

**Kurang**
- Aging kini memakai tanggal jatuh tempo (fallback tanggal dokumen), konsisten
  di layar, cetak, dan ekspor. Dokumen tanpa jatuh tempo tetap terukur.
- Belum ada statement of account per pelanggan/pemasok.
- Belum ada pembayaran massal.
- Belum ada reminder/dunning.
- Belum ada credit limit di halaman ini (credit limit ada di POS).

### 4.8 Laporan keuangan — 8/10

**Sudah bagus**
- 7 laporan: laba rugi, posisi keuangan, arus kas, perubahan ekuitas,
  neraca saldo, penjualan, catatan.
- Drill-down akun ke buku besar.
- Ekspor CSV/Excel, cetak PDF formal.
- Satu halaman A4 untuk P&L/posisi/arus kas/ekuitas.
- Kop legal, tanda tangan, QR verifikasi.

**Kurang**
- P&L dan posisi keuangan sudah punya pembanding periode sebelumnya/tahun
  lalu di layar dan cetak. Arus kas, ekuitas, dan neraca saldo belum.
- Tidak ada custom report builder / save report.
- Tidak ada budget vs actual.
- Tidak ada laporan PPN/Pajak (input/output).
- Tidak ada multi-currency/consolidation.
- Tidak ada cash-basis report.
- Catatan laporan masih teks bebas, belum template pengungkapan.

### 4.9 Periode fiskal & tutup buku — 9/10

**Sudah bagus**
- Status per bulan: terbuka/ditutup/dikunci.
- Checklist akhir bulan: penyusutan, rekonsiliasi kontrol, tutup bulan,
  tutup tahun.
- Tutup buku tahunan dengan pratinjau laba, akun laba ditahan, jurnal penutup.
- Kunci 12 periode, buka kembali hanya owner + alasan.

**Kurang**
- Belum ada workflow jurnal penyesuaian khusus (masih lewat jurnal manual).
- Belum ada checklist yang bisa dikustomisasi per perusahaan.

### 4.10 Rekonsiliasi kontrol — 9/10

**Sudah bagus**
- Membandingkan GL akun kontrol dengan subledger piutang/utang/persediaan.
- Menampilkan selisih, jurnal manual tersangka, dokumen terbuka terbesar.
- Ini fitur yang **tidak dimiliki banyak ERP kecil** dan sangat membantu audit.

**Kurang**
- Belum bisa langsung membuat jurnal koreksi dari selisih.
- Belum ada snapshot historis rekonsiliasi (hanya per tanggal dipilih).

### 4.11 Aset tetap — 7,5/10

**Sudah bagus**
- Registrasi aset, kategori, umur, residu.
- Penyusutan garis lurus bulanan, idempoten, satu jurnal agregat.
- Pelepasan aset + jurnal.
- Rekonsiliasi saldo akumulasi GL vs rincian aset.
- Riwayat proses penyusutan.

**Kurang**
- Hanya metode garis lurus; belum ada saldo menurun/unit produksi.
- Belum ada impairment/revaluasi.
- Belum ada kapitalisasi otomatis dari pembelian (masih daftar manual).
- Belum ada transfer antar lokasi/cabang.

### 4.12 Riwayat akuntansi — 5/10

**Masalah**
- Isinya hampir sama dengan Jurnal Umum: daftar jurnal dengan filter tanggal,
  sumber, status, user.
- Tidak menampilkan aktivitas non-jurnal (mis. perubahan master, login,
  perubahan pengaturan).
- Tidak ada detail before/after.
- Jadi bukan "audit trail", hanya daftar jurnal kedua.

**Rekomendasi**
-Gabungkan ke Jurnal Umum (hapus dari nav), atau ubah menjadi **Audit
  Trail** yang membaca `audit_log` dan menampilkan aksi + aktor + perubahan.
- Untuk ERP profesional, audit trail global lebih penting daripada daftar
  jurnal duplikat.

### 4.13 Migrasi bagan akun — 8/10

Kuat untuk kebutuhan niche: dry-run, laporan perubahan, eksekusi sadar,
tanpa memindahkan saldo. Tidak perlu diubah sekarang.

### 4.14 Beban (rute lama) — cukup

Sudah redirect ke jurnal baru. Tidak ada masalah selama tidak ada tautan baru
ke rute ini. Input Cepat dan beranda sudah diarahkan ke jurnal baru.

## 5. Perbandingan dengan referensi

| Kebutuhan | Bisa ERP | Xero | QuickBooks | Odoo | Accurate |
|---|---|---|---|---|---|
| Jurnal umum + balik | Ya | Ya | Ya | Ya | Ya |
| COA hierarki + tagging | Ya, kaya | Ya | Ya | Ya | Ya |
| Buku besar + drill-down | Ya | Ya | Ya | Ya | Ya |
| Rekonsiliasi bank CSV | Ya | Bank feed | Bank feed | Bank sync | Impor |
| Piutang/utang + aging | Ya | Ya | Ya | Ya | Ya |
| Laporan komparatif | P&L & posisi | Ya | Ya | Ya | Ya |
| Custom report/budget | **Belum** | Sebagian | Advanced | Ya | Sebagian |
| PPN/tax report | Ya (buku PPN) | Tergantung lokal | Tergantung lokal | Ya | Ya |
| Audit trail global | Ya | Sebagian | Ya | Ya | Ya |
| Aset tetap | Garis lurus | Ya | Ya | Ya | Ya |
| Tutup buku tahunan | Ya | Ya | Ya | Ya | Ya |
| Multi-currency | Belum | Ya | Ya | Ya | Ya |
| Analytic dimension | Belum | Tracking | Class/Location | Ya | Sebagian |

## 6. Prioritas perbaikan

### P1 — sudah dieksekusi 10 November

1. **Periode pembanding P&L & posisi keuangan** — layar + cetak; ekspor dan
   laporan lain menyusul.
2. **Laporan PPN** — halaman, cetak, CSV/XLSX.
3. **Audit trail global** — menggantikan daftar jurnal duplikat.
4. **Aging berbasis jatuh tempo** — layar, cetak, ekspor.

### P1 lanjutan — belum

- Perluas pembanding ke arus kas, ekuitas, neraca saldo, dan ekspor.
- Lampiran bukti + draft/approval jurnal.

### P2 — nilai tinggi, butuh keputusan

5. Lampiran bukti pada jurnal + draft/approval.
6. Jurnal berulang/template.
7. Aturan pencocokan bank + pencocokan parsial.
8. Budget vs actual dan analytic dimension.
9. Statement of account per pelanggan/pemasok.
10. Credit limit di halaman piutang.

### P3 — rapi-rapi

11. Grup COA bisa dilipat; pencarian tetap.
12. Filter jurnal dipindah ke panel "Filter" agar tidak padat.
13. Ringkasan KPI bank/aset memakai `SummaryStrip` seperti dashboard.
14. Template catatan laporan keuangan.

## 7. Yang jangan diubah (kekuatan)

- `postJournal` sebagai satu gerbang double-entry + validasi akun + kunci periode.
- Isolasi tenant `withCompany`/`withCompanyReadOnly`.
- Jurnal sistem tidak bisa dibalik manual; harus void dokumen asal.
- Rekonsiliasi kontrol GL vs subledger.
- Tutup buku tahunan + laba ditahan.
- Audit history per akun.
- Formula dan kontrol stok/AVCO yang sudah teruji.

## 8. Verifikasi audit & implementasi

- 18 halaman Akuntansi diperiksa; tidak ada error JS atau overflow pada
  halaman yang diaudit.
- Halaman baru **Pajak (PPN)**, **Audit trail**, dan **pembanding P&L/posisi**
  diuji di 1440px dan 390px: status 200, tanpa overflow, tanpa error halaman.
- PDF P&L dengan pembanding tetap **1 halaman**; PDF PPN 1 halaman.
- Ekspor PPN CSV/XLSX terverifikasi (HTTP 200, isi terbaca).
- `tsc --noEmit` bersih; `lint` 0 error (19 warning lama); `build` sukses.
- Full suite: **2199 lulus, 1 gagal lama** `review-fixes-t4rb` (saldo bank
  demo negatif) — bukan regresi modul Akuntansi.
- Gap yang masih terbuka: lampiran/approval jurnal, pembanding arus kas/
  ekuitas/neraca saldo, pembanding pada ekspor, aturan bank, budget/dimensi.

## 9. Catatan data demo

Angka negatif besar di kas/beban berasal dari jurnal pembalik payroll uji
bertanggal 2026 yang tertulis ke database demo. Itu masalah data uji, bukan
desain akuntansi. Perlu reseed atau database uji terpisah sebelum demo ke
pengguna.
