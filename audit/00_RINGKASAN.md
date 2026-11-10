# 00. Laporan Ringkasan Eksekutif Audit Sistem ERP (BISA-ERP)

- **Tanggal Pelaksanaan Audit**: 10 November 2026
- **Auditor**: Tim Gabungan Senior Full-Stack Engineer, UX Designer, QA Lead, Auditor Sistem Informasi (CISA), & Data Integrity Specialist.
- **Cakupan Audit**: 100% Seluruh Modul, 70 Menu Navigasi, 91 Route Halaman (`page.tsx`), 158 Actions/Endpoints, 83 Form/Dialog, dan 38 Laporan/Cetak.
- **Mode Eksekusi**: **Read-Only Audit Mode** (Nol modifikasi pada kode produksi, nol commit, nol mutasi database). Seluruh artefak tersimpan di direktori `audit/`.

---

## 1. Ringkasan Eksekutif

Aplikasi **bisa-erp** adalah sistem ERP minimarket/retail berbasis Next.js (App Router), Drizzle ORM, PostgreSQL, dan Tailwind CSS. Aplikasi ini memiliki fondasi akuntansi berprinsip *append-only ledger* yang sangat kuat (double-entry balancing, penutupan periode fiskal, dan larangan hard-delete jurnal).

Namun, audit independen menemukan sejumlah kelemahan kritis yang memvalidasi langsung keluhan pengguna:
1. **Perhitungan & Validasi Logika yang Cacat**:
   - Fungsi lembur PP 35/2021 memotong jam pecahan (lembur 1.5 jam hanya dibayar 1.0 jam, sisa 0.5 jam musnah).
   - Batch gaji bulanan menyertakan karyawan baru yang tanggal bergabungnya di masa depan.
   - Ringkasan rekonsiliasi bank menghasilkan nilai selisih negatif semu.
2. **Kerapuhan Integrasi Perangkat & UI Kasir**:
   - Hook penangkap barcode scanner fisik (`useBarcodeScannerCapture`) diimpor namun tidak dipanggil di terminal kasir, menyebabkan angka barcode salah ketik masuk ke field quantity/input lain.
   - Penambahan metode bayar ber-fee tanpa akun penampung menyebabkan terminal kasir *hard-crash* saat melayani antrean pelanggan.
3. **Pemisahan Entitas & Celah Keamanan Serius**:
   - Entitas data karyawan (`employees`) terpisah total dari akun login (`user`). Saat karyawan dipecat, akun login mereka tetap aktif 100% dan dapat terus mengakses data perusahaan.
4. **Disparitas Antarmuka & Navigasi**:
   - Master pelanggan disatukan di dalam modul Gudang dengan pembatasan hak akses yang keliru (`pos.sell`).
   - Fitur deteksi duplikat kontak tidak memiliki tombol navigasi sama sekali di antarmuka pengguna.
   - Pengaturan stok kritis (`allowNegativeStock`) tersembunyi di dalam formulir profil pajak perusahaan.

---

## 2. 15 Risiko & Temuan Teratas (Top 15 Systemic Risks)

| No | ID Temuan | Modul | Severity | Ringkasan Temuan & Dampak Bisnis |
| :-: | :---: | :--- | :---: | :--- |
| 1 | **POS-001** | POS | **KRITIS** | **Hook Barcode Scanner Terputus**: `useBarcodeScannerCapture` tidak dipanggil di `pos-terminal.tsx`. Scanner barcode fisik salah ketik ke field lain atau hasil pindai hilang saat kursor tidak fokus di kotak pencarian. |
| 2 | **HR-001** | HR | **KRITIS** | **Karyawan Masa Depan Tergaji Penuh**: Query `runPayrollAction` tidak membatasi `joinedAt <= periodEnd`. Karyawan yang mulai kerja bulan depan otomatis terbayar gaji bulan ini. |
| 3 | **SET-004** | Pengaturan | **KRITIS** | **Kasir Crash Akibat Unmapped Bank Fee**: Metode bayar ber-fee dapat disimpan tanpa akun `bank_fee` di Pemetaan Akun. Kasir mengalami *hard crash* saat checkout di jam sibuk toko. |
| 4 | **HR-002** | HR | **TINGGI** | **Pemotongan Jam Pecahan Lembur**: Perulangan integer `for (let hour = 1; hour <= entry.hours; hour += 1)` memotong pecahan jam (misal 1.5 jam dihitung 1 jam). Pelanggaran UU Ketenagakerjaan / PP 35/2021. |
| 5 | **CONF-03** | HR / Auth | **TINGGI** | **Akun Login Eks-Karyawan Tetap Aktif**: Terminasi karyawan di HR tidak menonaktifkan akun di tabel `users`. Eks-karyawan yang dipecat tetap memiliki akses login penuh. |
| 6 | **GDG-001** | Gudang | **TINGGI** | **Izin Salah Sasaran pada Master Pelanggan**: `saveCustomerAction` di gudang menuntut `pos.sell`. Staf gudang diblokir dari mengedit data alamat/kredit pelanggan. |
| 7 | **GDG-002** | Gudang | **TINGGI** | **Kelebihan Penerimaan Barang Tanpa Batas**: Penerimaan barang (`receiveStockAction`) tidak memvalidasi kuantiti PO. Gudang bisa menerima barang melampaui pesanan tanpa otorisasi. |
| 8 | **AKN-001** | Akuntansi | **TINGGI** | **Rumus Rekonsiliasi Bank Negatif**: `getReconciliationSummary` menghasilkan selisih negatif semu pada rekonsiliasi bank karena tidak memisahkan pos setoran dalam proses dan cek beredar. |
| 9 | **AKN-002** | Akuntansi | **TINGGI** | **Jurnal Manual Bebas Memposting ke Akun Kontrol**: Pengguna dapat memposting penyesuaian manual langsung ke akun Piutang/Persediaan GL, merusak rekonsiliasi GL vs Subledger secara permanen. |
| 10 | **SET-001** | Pengaturan | **TINGGI** | **Internal Error 500 Saat Hapus Gudang**: `deleteWarehouseAction` hanya mengecek saldo saat ini. Gudang kosong yang pernah memiliki riwayat mutasi menabrak foreign key `stock_movements`. |
| 11 | **SET-002** | Pengaturan | **TINGGI** | **Hard-Delete User Menghancurkan Jejak Audit**: Penghapusan pengguna memusnahkan baris tabel `user`, meninggalkan string orphan di kolom `created_by` pada transaksi masa lalu. |
| 12 | **POS-002** | POS | **TINGGI** | **Shift Kasir Ditutup dengan Transaksi Gantung**: `closeCashSession` tidak memeriksa pesanan berstatus `held`. Shift kasir dapat ditutup saat barang masih tertahan di kasir. |
| 13 | **AKN-003** | Akuntansi | **SEDANG** | **N+1 Memory Bottleneck Saldo Kas**: `evaluateCashNegativeGuard` menarik seluruh baris historis akun kas ke memori server Node.js dan menjalankan `.reduce()` pada setiap checkout. |
| 14 | **CONF-01** | POS / Pihak | **SEDANG** | **Data Pelanggan Terfragmentasi**: `quickAddCustomerAction` di POS membuat pelanggan tanpa validasi duplikasi telepon, tanpa batas kredit, dan terpisah dari master gudang. |
| 15 | **SET-003** | Pengaturan | **SEDANG** | **Pengaturan Stok Negatif Salah Tempat**: Pengaturan krusial `allowNegativeStock` diletakkan di tab Profil Perusahaan & Pajak alih-alih di pengaturan Gudang/Lokasi. |

---

## 3. Heatmap Skor Kualitas per Modul (Skala 1–5)

Kriteria Skor:
- **5 (Sangat Baik)**: Sempurna, mematuhi standar industri terbaik tanpa cacat.
- **4 (Baik)**: Berfungsi solid dengan proteksi memadai, hanya catatan minor.
- **3 (Cukup)**: Fungsional pada alur utama, namun memiliki inkonsistensi UX atau celah validasi.
- **2 (Kurang)**: Memiliki bug logika yang berdampak bisnis atau cacat alur kerja serius.
- **1 (Kritis)**: Rusak parah, memicu crash sistem, atau mengancam integritas finansial.

| Modul ERP | Fungsi | Tampilan (UI) | UX & Ergonomi | Workflow | Data & Atomisitas | Laporan | Performa | Hak Akses | Rata-Rata Modul |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Pengaturan & Master** | 3.5 | 3.0 | 2.5 | 4.0 | 2.5 | 3.0 | 4.0 | 3.5 | **3.25** |
| **Akuntansi Dasar** | 3.5 | 3.0 | 3.0 | 4.5 | 4.0 | 3.5 | 2.5 | 4.0 | **3.50** |
| **Gudang & Pembelian** | 3.5 | 3.0 | 2.5 | 4.0 | 4.0 | 4.0 | 3.5 | 2.5 | **3.38** |
| **POS (Point of Sale)** | 3.5 | 3.0 | 2.5 | 3.5 | 4.5 | 4.0 | 3.5 | 4.0 | **3.56** |
| **HR & Penggajian** | 3.5 | 3.0 | 3.0 | 3.5 | 2.5 | 3.0 | 4.0 | 3.0 | **3.19** |
| **Laporan & Analisa** | 4.0 | 3.5 | 2.5 | 4.0 | 4.5 | 4.0 | 2.5 | 4.0 | **3.63** |
| **Sistem Pendukung** | 4.0 | 3.5 | 3.5 | 4.0 | 4.0 | 3.5 | 4.0 | 3.5 | **3.75** |
| **RATA-RATA SISTEM** | **3.64** | **3.14** | **2.79** | **3.93** | **3.71** | **3.57** | **3.43** | **3.50** | **3.46** |

---

## 4. Navigasi Berkas Laporan Audit Lengkap

Seluruh temuan rinci, matriks cakupan, bukti kode, dan skrip tes dapat ditinjau pada berkas berikut di folder `audit/`:
- [`01_metodologi.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/01_metodologi.md): Metodologi audit, instrumen tools, dan daftar referensi standar industri Fase 0 (dengan URL).
- [`02_inventaris.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/02_inventaris.md): Inventaris lengkap 100% fitur, menu sidebar vs route, dan rekapitulasi jumlah item per modul.
- [`03_coverage_matrix.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/03_coverage_matrix.md): Status cakupan audit per fitur (DIAUDIT, SEBAGIAN, TIDAK DAPAT DIUJI).
- [`04_peta_data_dan_konflik.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/04_peta_data_dan_konflik.md): Peta Single Source of Truth, Matriks Konflik lintas modul, dan diagram titik kegagalan alur.
- [`05_ui_ux_global.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/05_ui_ux_global.md): Temuan desain visual, inkonsistensi pola CRUD, standardisasi glosarium bahasa, dan ergonomi kasir.
- **Laporan Spesifik per Modul**:
  - [`modul-pengaturan.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/modul-pengaturan.md)
  - [`modul-akuntansi.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/modul-akuntansi.md)
  - [`modul-gudang.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/modul-gudang.md)
  - [`modul-pos.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/modul-pos.md)
  - [`modul-hr.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/modul-hr.md)
  - [`modul-laporan-analisa.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/modul-laporan-analisa.md)
  - [`modul-pendukung.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/modul-pendukung.md)
- [`06_tes_reproduksi.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/06_tes_reproduksi.md): Panduan menjalankan suite tes reproduksi bug di `audit/tests/`.
- [`07_rencana_perbaikan.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/07_rencana_perbaikan.md): Rencana tindakan perbaikan terstruktur (Quick Wins, Perbaikan Struktural, Perubahan Arsitektur).
- [`08_belum_terverifikasi.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/08_belum_terverifikasi.md): Dokumentasi pengujian yang dibatasi oleh ketersediaan hardware/lingkungan eksternal.
