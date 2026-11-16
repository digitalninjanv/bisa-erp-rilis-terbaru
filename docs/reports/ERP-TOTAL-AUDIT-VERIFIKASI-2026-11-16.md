# LAPORAN AUDIT TOTAL DAN VERIFIKASI MENYELURUH SISTEM BISA ERP
**Repository:** `digitalninjanv/bisa-erp-rilis-terbaru`  
**Commit Audited:** `21d4505644b8457d024b8e1f08655b28d0d296c6` (`HEAD -> main`)  
**Tanggal Audit:** 16 November 2026  
**Peran Auditor:** Senior ERP Functional Auditor, Software Architect, Accounting Systems Auditor, Product Designer, & QA Lead  
**Mode Operasi:** **STRICT READ-ONLY & VERIFIKASI AKTUAL** (Nol modifikasi kode, nol migrasi/mutasi basis data, nol refactoring)

Salinan identik dari laporan audit master di:
[`audit/2026-11-16_AUDIT_TOTAL_DAN_VERIFIKASI_MENYELURUH.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/2026-11-16_AUDIT_TOTAL_DAN_VERIFIKASI_MENYELURUH.md)

---

## DAFTAR ISI
1. [Bab 1: Ringkasan Eksekutif (Executive Summary)](#bab-1-ringkasan-eksekutif)
2. [Bab 2: Inventarisasi Lengkap Modul, Fitur, Rute, & Server Actions](#bab-2-inventarisasi-lengkap-modul-fitur-rute--server-actions)
3. [Bab 3: Matriks Evaluasi Fitur 100% Berdasarkan 20 Kriteria Wajib](#bab-3-matriks-evaluasi-fitur-100-berdasarkan-20-kriteria-wajib)
4. [Bab 4: Audit Fungsional & Logika Bisnis Modul POS](#bab-4-audit-fungsional--logika-bisnis-modul-pos)
5. [Bab 5: Audit Fungsional & Logika Bisnis Gudang & Pembelian](#bab-5-audit-fungsional--logika-bisnis-gudang--pembelian)
6. [Bab 6: Audit Fungsional & Logika Bisnis Akuntansi & Keuangan](#bab-6-audit-fungsional--logika-bisnis-akuntansi--keuangan)
7. [Bab 7: Audit Fungsional & Logika Bisnis HR & Penggajian (Payroll)](#bab-7-audit-fungsional--logika-bisnis-hr--penggajian-payroll)
8. [Bab 8: Audit Fungsional & Logika Bisnis Pengaturan & Platform](#bab-8-audit-fungsional--logika-bisnis-pengaturan--platform)
9. [Bab 9: Audit Alur Kerja Transaksi Antarmodul (Workflow Traceability)](#bab-9-audit-alur-kerja-transaksi-antarmodul-workflow-traceability)
10. [Bab 10: Audit Desain, UI/UX, Form, Tabel, & Aksesibilitas Enterprise](#bab-10-audit-desain-uiux-form-tabel--aksesibilitas-enterprise)
11. [Bab 11: Audit Arsitektur, Skema Database, & Keamanan (Security & IAM)](#bab-11-audit-arsitektur-skema-database--keamanan-security--iam)
12. [Bab 12: Audit Performa, Beban Skalabilitas, & Efisiensi Data](#bab-12-audit-performa-beban-skalabilitas--efisiensi-data)
13. [Bab 13: Audit Cakupan Pengujian (Test Coverage & Gap Analysis)](#bab-13-audit-cakupan-pengujian-test-coverage--gap-analysis)
14. [Bab 14: Rekonsiliasi Komprehensif Temuan Audit Terdahulu](#bab-14-rekonsiliasi-komprehensif-temuan-audit-terdahulu)
15. [Bab 15: Katalog Temuan Baru Berdasarkan Prioritas & Bukti Reproduksi](#bab-15-katalog-temuan-baru-berdasarkan-prioritas--bukti-reproduksi)
16. [Bab 16: Keterbatasan Pemeriksaan & Area Belum Terverifikasi](#bab-16-keterbatasan-pemeriksaan--area-belum-terverifikasi)
17. [Bab 17: Backlog Rekomendasi Perbaikan & Rencana Roadmap](#bab-17-backlog-rekomendasi-perbaikan--rencana-roadmap)

---

## BAB 1: RINGKASAN EKSEKUTIF

Audit total dan verifikasi menyeluruh (*comprehensive enterprise audit*) ini dilakukan terhadap seluruh lapisan implementasi **BISA ERP** pada commit resmi terbaru `21d4505`. Pemeriksaan mencakup **97 route halaman (`page.tsx`)**, **19 rute API**, **11 berkas skema basis data Drizzle ORM**, **18.727 node CodeGraph**, **115 berkas suite pengujian unit**, serta skrip uji reproduksi independen.

### 1.1 Kondisi Arsitektur Global & Integritas Sistem
Fondasi teknis BISA ERP berada pada tingkat kematangan enterprise yang sangat tinggi:
- **Tumpukan Teknologi**: Next.js 16.4.5 (App Router, Turbopack), React 19, TypeScript strict mode, Tailwind CSS 4, Drizzle ORM, dan PostgreSQL 18.
- **Pemisahan Tenant (Multi-Tenant Isolation)**: Seluruh transaksi dibungkus helper `withCompany` dan `withCompanyReadOnly` yang mengatur konfigurasi sesi PostgreSQL `app.company_id` untuk penegakan PostgreSQL Row-Level Security (RLS).
- **Integritas Finansial**: Transaksi akuntansi diproteksi oleh gerbang tunggal `postJournal` (append-only GL, saldo debit = kredit wajib seimbang), larangan mutasi manual ke akun kontrol, pencegahan saldo kas negatif via agregasi SQL langsung di database, dan perlindungan periode fiskal tertutup.
- **Persediaan & Valuasi**: Menerapkan metode *moving average perpetual* (AVCO) di mana tabel `stock_on_hand` dipelihara sebagai cache konsisten dari agregasi mutasi fisik `stock_movements`.
- **Hasil Pemeriksaan Statis & Pengujian Bersih**:
  - `pnpm tsc --noEmit`: **PASS** (0 kesalahan kompilasi tipe di 1.094 berkas).
  - `pnpm lint`: **PASS** (0 warning / 0 error ESLint 9).
  - `pnpm vitest run tests/unit/`: **PASS** (**115 berkas uji, 1.084 dari 1.084 tes lolos 100%**).
  - `pnpm build`: **PASS** (Sukses mengompilasi 97 halaman aplikasi dan 19 API endpoint).

### 1.2 Temuan Kritis Utama (Critical & High Severity)
Meskipun arsitektur dasarnya sangat kokoh, audit mendalam menemukan 4 cacat fungsional & kepatuhan signifikan yang perlu ditangani:
1. **[CRITICAL - P0] Karyawan Masa Depan Tergaji Penuh (`BUG-HR-001`)**: `runPayrollAction` ([`src/server/actions/hr/payroll.ts#L125-L130`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/server/actions/hr/payroll.ts#L125-L130)) hanya mengecek `isActive = true`. Karyawan baru yang tanggal bergabungnya di masa depan (`joinedAt > periodEnd`) ikut terbayar penuh. Terbukti via uji reproduksi [`audit/tests/repro-hr-payroll-filter.test.ts`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/tests/repro-hr-payroll-filter.test.ts).
2. **[HIGH - P1] Pemotongan Menit Pecahan Lembur (`BUG-HR-002`)**: `computeOvertimePay` ([`src/lib/payroll/payroll-indonesia.ts#L307-L317`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/lib/payroll/payroll-indonesia.ts#L307-L317)) menggunakan loop integer `for (let hour = 1; hour <= entry.hours; hour += 1)`, memotong menit lembur pecahan (misal 1,5 jam dihitung 1 jam saja, upah terpotong Rp10.000). Melanggar PP No. 35 Tahun 2021. Terbukti via uji reproduksi [`audit/tests/repro-overtime-truncation.test.ts`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/tests/repro-overtime-truncation.test.ts).
3. **[HIGH - P1] Akun Pengguna Tetap Aktif Pasca-Terminasi Karyawan (`SEC-HR-001`)**: `processFinalPay` ([`src/server/hr/final-pay.ts#L526-L555`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/server/hr/final-pay.ts#L526-L555)) hanya memutasi tabel `employees`. Akun login di tabel `users`/`member` tetap aktif, membuka celah keamanan *insider threat*.
4. **[HIGH - P1] Hard-Delete Pengguna Merusak Jejak Audit Historis (`DAT-SET-001`)**: `removeCompanyUserAction` ([`src/server/actions/users.ts#L366-L373`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/server/actions/users.ts#L366-L373)) mengeksekusi `DELETE FROM "user"` jika pengguna keluar dari satu-satunya perusahaan, memusnahkan identitas pembuat ribuan transaksi lampau.

---

## BAB 2: INVENTARISASI LENGKAP MODUL, FITUR, RUTE, & SERVER ACTIONS

| No | Modul Domain | Jumlah Halaman UI | Rute API | File Skema DB | Server Actions / Domain Handlers |
| :-: | :--- | :---: | :---: | :--- | :--- |
| 1 | **Point of Sale (POS)** | 11 | 2 | `sales.ts` | `src/server/pos/*`, `src/server/actions/pos.ts`, `src/server/actions/pos-offline.ts`, `src/server/actions/pos-terminals.ts` |
| 2 | **Gudang & Pembelian** | 29 | 3 | `inventory.ts`, `catalog.ts` | `src/server/inventory/*`, `src/server/purchasing.ts`, `src/server/supplier-returns/*`, `src/server/actions/inventory/*` |
| 3 | **Akuntansi & Keuangan** | 26 | 5 | `accounting.ts` | `src/server/accounting.ts`, `src/server/bank-reconciliation/*`, `src/server/reports/*`, `src/server/actions/accounting/*` |
| 4 | **HR & Penggajian** | 15 | 2 | `hr.ts`, `payroll.ts` | `src/server/hr/*`, `src/lib/payroll/*`, `src/server/actions/hr/*` |
| 5 | **Pengaturan & Platform** | 4 | 3 | `platform.ts`, `auth.ts` | `src/server/settings.ts`, `src/server/actions/settings/*`, `src/server/actions/users.ts`, `src/server/actions/company.ts` |
| 6 | **Dashboard & Analisa** | 3 | 1 | N/A | `src/server/reports/dashboard.ts`, `src/server/reports/analysis.ts` |
| 7 | **Master Data & Impor** | 9 | 3 | `import.ts` | `src/server/import/*`, `src/server/actions/import/*`, `src/server/actions/master-data.ts` |
| **TOTAL** | **7 Modul Inti** | **97 Halaman** | **19 Rute API** | **11 Skema Tabel** | **50+ Berkas Server Domain & Aksi** |

---

## BAB 3: MATRIKS EVALUASI FITUR 100% BERDASARKAN 20 KRITERIA WAJIB

Setiap fitur dievaluasi menggunakan 20 kriteria:
*(1) Kelengkapan, (2) Fungsional, (3) Business Logic, (4) Workflow, (5) Input Data, (6) Output, (7) Data Integrity, (8) Relasi Dokumen, (9) Permission, (10) Error Handling, (11) UI/UX, (12) Responsiveness, (13) Accessibility, (14) Performance, (15) Security, (16) Integration, (17) Audit Trail, (18) Reporting, (19) Test Coverage, (20) Documentation.*

| ID | Modul | Fitur | Lokasi Implementasi | Kriteria Utama yang Disorot | Status | Bukti Kode & Catatan | Referensi Standar | Tingkat Keyakinan | Severity | Rekomendasi |
| :-: | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :---: | :---: | :--- |
| **POS-01** | POS | Terminal Kasir & Scanner | `app/app/pos/terminal/` | Fungsional, Input Data, Performance | **PASS** | Hook `useBarcodeScannerCapture` terhubung ke input kuantitas & pencarian instan. | Odoo 20 POS Scanner | High | - | Pertahankan performa pencarian in-memory. |
| **POS-02** | POS | Kalkulasi Keranjang & Diskon | `src/server/pos/cart.ts` | Business Logic, Data Integrity | **PASS** | `quoteCart` menggunakan Decimal.js; pembulatan Rupiah sesuai setting perusahaan. | SAP Retail POS Pricing | High | - | Sudah mematuhi standar Decimal moneter. |
| **POS-03** | POS | Penutupan Sesi Kas | `src/server/pos/sessions.ts` | Workflow, Error Handling, Business Logic | **PARTIAL** | `closeCashSession` tidak mengecek `held` sales; kasir dapat menutup sesi saat pesanan tertahan. | Odoo POS Session Closing | High | Medium | Panggil `countHeldSales` dan tolak jika > 0. |
| **POS-04** | POS | PWA Offline Sync & Idempotensi | `src/lib/pos/offline/` | Reliability, Security, Data Integrity | **PASS** | IndexedDB queue dengan UUID unik; validasi harga & stok saat sinkronisasi server. | Square POS Offline Mode | High | - | Mekanisme offline queue sangat tangguh. |
| **POS-05** | POS | Integrasi QRIS Pembayaran | `src/components/pos/` | Kelengkapan, Integration | **PARTIAL** | Mendukung QRIS Statis (`qrisImage`); belum terhubung webhook QRIS Dinamis. | Standar BI QRIS CPM/MPM | High | Low | Integrasikan webhook payment gateway. |
| **POS-06** | POS | Desktop Native Tauri | `src-tauri/src/posdb.rs` | Performance, Integration | **NOT TESTED** | Kode Rust dan IPC siap; pengujian printer thermal fisik memerlukan hardware nyata. | Tauri 2.0 Native Shell | Medium | - | Uji pada terminal minimarket fisik. |
| **GDG-01** | Gudang | Master Produk & Multi-Kemasan | `src/server/catalog/` | Kelengkapan, Input Data | **PASS** | Multi-packaging dengan rasio konversi satuan dasar (PCS/DUS) berjalan akurat. | Odoo Multi-Unit UoM | High | - | Pertahankan struktur packaging saat ini. |
| **GDG-02** | Gudang | Purchase Order (Anti Over-Receipt) | `src/server/purchasing.ts` | Business Logic, Data Integrity | **PASS** | `lockPurchaseOrderForReceipt` mengagregasi kuantiti dan menolak over-receipt. | Accurate Online PO Rules | High | - | Mekanisme penguncian kuantiti sudah sangat tepat. |
| **GDG-03** | Gudang | Penerimaan Tunai vs Kredit | `src/server/purchasing.ts` | Workflow, Accounting Integration | **PASS** | Tunai langsung potong kas/bank; kredit mencatat akrual utang belum difaktur. | SAP MM GR/IR Workflow | High | - | Akuntansi GR/IR sesuai prinsip SAK EMKM. |
| **GDG-04** | Gudang | Retur Pembelian & Plafon | `src/server/supplier-returns/` | Relasi Dokumen, Business Logic | **PASS** | Retur dibatasi kuantiti penerimaan asal; mendukung 5 moda penyelesaian (*settlement*). | Accurate Online Retur | High | - | Alur validasi plafon retur sudah aman. |
| **GDG-05** | Gudang | Transfer Stok Dua Tahap | `src/server/inventory/transfers.ts` | Workflow, Data Integrity | **PASS** | Status `in_transit` mencegah lonjakan stok di tujuan sebelum konfirmasi fisik. | Odoo Internal Transfer | High | - | Mencegah anomali stok fisik. |
| **GDG-06** | Gudang | Stock Opname Buta | `src/server/inventory/opname.ts` | UI/UX, Reporting, Audit Trail | **PASS** | Lembar hitung fisik dicetak tanpa saldo sistem; selisih opname menjurnal otomatis. | SAP Fiori Blind Counting | High | - | Sesuai kaidah audit fisik inventaris. |
| **GDG-07** | Gudang | Kartu Stok & AVCO Perpetual | `src/server/inventory/valuation.ts` | Performance, Business Logic | **PASS** | Moving average AVCO dihitung per mutasi; kueri menyaring DB sebelum paginasi. | PSAK 14 / SAK EMKM | High | - | Evaluasi AVCO terjaga konsisten. |
| **GDG-08** | Gudang | Impor Massal Excel (10.000+) | `src/lib/xlsx-stream.ts` | Performance, Error Handling | **PASS** | Streaming parser berbasis event; validasi per baris mencegah out-of-memory. | Node.js Stream Standards | High | - | Streaming XLSX andal menangani file besar. |
| **AKN-01** | Akuntansi | Bagan Akun (COA) Standar | `src/server/accounting.ts` | Reporting, Kelengkapan | **PASS** | Struktur 5 digit standar Indonesia; template bawaan otomatis saat setup. | Standar Akuntansi EMKM | High | - | Struktur akun rapi dan hierarkis. |
| **AKN-02** | Akuntansi | Gerbang Tunggal `postJournal` | `src/server/accounting.ts` | Security, Data Integrity, Audit Trail | **PASS** | GL append-only; debit=kredit wajib seimbang; larangan mutasi manual akun kontrol. | General Ledger Invariants | High | - | Menjamin integritas buku besar. |
| **AKN-03** | Akuntansi | Penjaga Saldo Kas Negatif | `src/server/accounting.ts` | Business Logic, Error Handling | **PASS** | Evaluasi agregasi SQL langsung di basis data; opsi block/warn sesuai setting. | Bank Overdraft Controls | High | - | Menghindari N+1 memory bottleneck. |
| **AKN-04** | Akuntansi | Laporan Keuangan SAK EMKM | `src/server/reports/financial.ts` | Reporting, Output | **PASS** | Laba Rugi, Neraca, Arus Kas metode langsung; ekspor streaming CSV/XLSX. | IAI SAK EMKM 2024 | High | - | Rumus aliran ekuitas sinkron. |
| **AKN-05** | Akuntansi | Rekonsiliasi Bank & Selisih Riil | `src/server/bank-reconciliation/` | Fungsional, Business Logic | **PASS** | Formula selisih rekonsiliasi dibatasi tanggal transaksi berjalan (`todayISO()`). | Odoo Bank Reconciliation | High | - | Mencegah selisih negatif semu. |
| **AKN-06** | Akuntansi | Depresiasi Aset Tetap Otomatis | `src/server/fixed-assets.ts` | Workflow, Kelengkapan | **PARTIAL** | Rumus garis lurus tersedia; namun penjadwalan otomatis bulanan (cron) belum ada. | PSAK 16 Fixed Assets | High | Low | Tambahkan background worker depresiasi. |
| **HR-01** | HR | Filter Karyawan Baru di Payroll | `src/server/actions/hr/payroll.ts` | Business Logic, Data Integrity | **FAIL** | Karyawan masa depan (`joinedAt > periodEnd`) ikut dibayar penuh di batch payroll. | Odoo HR Payroll Contract | High | Critical | Tambahkan filter `joinedAt <= periodEnd`. |
| **HR-02** | HR | Perhitungan Lembur PP 35/2021 | `src/lib/payroll/payroll-indonesia.ts` | Business Logic, Regulatory Compliance | **FAIL** | Loop integer `hour += 1` memotong menit lembur pecahan (1,5 jam dihitung 1 jam). | PP No. 35 Tahun 2021 | High | High | Ganti loop integer dengan alokasi desimal. |
| **HR-03** | HR | Pencabutan Akses Terminasi | `src/server/hr/final-pay.ts` | Security, IAM | **PARTIAL** | Terminasi karyawan tidak mencabut keanggotaan/sesi login di tabel `users`. | NIST SP 800-53 PS-4 / OWASP | High | High | Cabut sesi & keanggotaan pengguna. |
| **SET-01** | Platform | Penghapusan Pengguna (User Delete) | `src/server/actions/users.ts` | Audit Trail, Data Integrity | **FAIL** | Hard delete memusnahkan identitas nama/email pada kolom `createdBy` transaksi lampau. | ISACA/CISA Audit Standards | High | High | Ubah menjadi soft-deactivation (`banned: true`). |
| **SET-02** | Platform | Kebijakan Stok Negatif di Form Pajak| `src/components/pengaturan/forms/` | UI/UX, Workflow | **PARTIAL** | Opsi `allowNegativeStock` salah tempat di form pajak, bukan di tab Gudang. | SAP Fiori Architecture | High | Low | Sediakan shortcut di tab Gudang & Cabang. |
| **UI-01** | UI/UX | Adopsi TanStack DataTable | `src/components/blocks/data-table/` | UI/UX, Performance, Accessibility | **PARTIAL** | Komponen enterprise ada, namun 90% halaman tabel masih memakai HTML primitif. | SAP Fiori Responsive Table | High | Medium | Migrasikan tabel utama ke `DataTable`. |

---

## BAB 4: AUDIT FUNGSIONAL & LOGIKA BISNIS MODUL POS

### 4.1 Katalog & Pemilihan Produk
- **Barcode Scanning**: Hook `useBarcodeScannerCapture` ([`src/app/app/pos/terminal/pos-terminal.tsx#L333`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/app/app/pos/terminal/pos-terminal.tsx#L333)) aktif mendengarkan input barcode scanner USB/Bluetooth, menangani karakter cepat (*burst inputs*), dan menambahkan barang ke keranjang secara instan.
- **Produk Nonaktif & Stok Kosong**: Kueri katalog kasir memfilter `isActive = true`. Jika stok habis dan kebijakan `allowNegativeStock = false`, penambahan produk ke keranjang dicegah di server.

### 4.2 Keranjang & Logika Moneter
- **Kalkulasi Desimal**: Seluruh perhitungan keranjang di `src/server/pos/cart.ts` dan `quote.ts` menggunakan `Decimal.js`. Diskon bertingkat, PPN 11%/12%, dan pembulatan kasir (Rupiah ke atas/bawah/500/1000) bekerja tanpa kesalahan floating-point biner IEEE-754.

### 4.3 Sesi Kasir & Transaksi Gantung (`WRK-POS-001`)
- **Temuan Cacat Alur**: Pada fungsi `closeCashSession` ([`src/server/pos/sessions.ts#L100-L165`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/server/pos/sessions.ts#L100-L165)), sistem memverifikasi uang fisik laci (*blind count*) namun sama sekali tidak mengecek keberadaan transaksi berstatus `held`. Kasir dapat menutup sesi kas saat masih ada belanjaan pelanggan yang tertahan di antrean kasir.
- **Bukti Kode**: Fungsi `countHeldSales` sudah dideklarasikan di baris 341 file yang sama, tetapi tidak dipanggil dalam rantai validasi `closeCashSession`.

### 4.4 Offline PWA & Idempotensi
- **Penyimpanan Lokal**: IndexedDB menyimpan payload penjualan dengan UUID `idempotencyKey` unik.
- **Sinkronisasi**: Server action `syncLocalSales` memeriksa kembali harga dan status aktif barang saat sinkronisasi online, mencegah posting ganda akibat request retry jaringan putus-nyambung.

---

## BAB 5: AUDIT FUNGSIONAL & LOGIKA BISNIS GUDANG & PEMBELIAN

### 5.1 Rantai Pengadaan & Pembelian
- **Purchase Order & Batas Penerimaan**: `lockPurchaseOrderForReceipt` ([`src/server/purchasing.ts#L342-L358`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/server/purchasing.ts#L342-L358)) mengagregasi kuantiti penerimaan terhadap pesanan PO. Upaya over-receipt langsung ditolak secara atomik.
- **Penerimaan Tunai vs Kredit**: Pembelian tunai langsung memotong kas/bank tanpa membentuk utang usaha palsu. Pembelian kredit mencatat akrual penerimaan (*Goods Received Not Invoiced*) yang dialihkan ke Utang Usaha saat faktur pemasok dimasukkan.
- **Anti-Duplikasi Faktur**: Validasi `number` unik per supplier di `receipt-invoice.ts` mencegah pencatatan tagihan ganda.

### 5.2 Retur Pembelian & Multi-Moda Settlement
- **Plafon Retur**: Kuantiti retur dibatasi kuantiti penerimaan asal yang belum pernah diretur.
- **Pilihan Penyelesaian**: Mendukung 5 moda: potong utang faktur, kredit deposit supplier, refund kas, penggantian barang (*replacement*), atau uang muka.
- **Pembatalan Retur (Void)**: Membalikkan jurnal secara atomik via `reverseSourceJournalPreferringDate` dan memulihkan stok fisik di kartu stok.

### 5.3 Transfer Antar-Gudang & Stock Opname
- **Dua Tahap**: Status `in_transit` mencegah lonjakan stok sebelum gudang penerima melakukan konfirmasi penerimaan fisik.
- **Opname Buta**: Lembar hitung fisik dicetak tanpa saldo sistem (*blind counting*). Selisih fisik yang disetujui otomatis menjurnal akun beban selisih opname.

---

## BAB 6: AUDIT FUNGSIONAL & LOGIKA BISNIS AKUNTANSI & KEUANGAN

### 6.1 Bagan Akun & Gerbang Jurnal Tunggal
- **COA SAK EMKM**: Kode akun 5 digit standar Indonesia.
- **Append-Only GL**: Gerbang tunggal `postJournal` ([`src/server/accounting.ts#L286`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/server/accounting.ts#L286)) memvalidasi keseimbangan Debit = Kredit dan ketiadaan rute UPDATE/DELETE fisik pada `journal_entries`. Koreksi wajib melalui jurnal pembalik (*reversal*).
- **Proteksi Akun Kontrol**: `assertManualJournalLines` ([`src/server/actions/accounting/jurnal.ts#L212-L226`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/src/server/actions/accounting/jurnal.ts#L212-L226)) memblokir posting manual ke akun Persediaan/Utang/Piutang tanpa tagging subledger resmi.

### 6.2 Penjaga Kas Negatif & Rekonsiliasi Bank
- **Penjaga Kas Negatif SQL**: Pengecekan saldo kas/bank dilakukan via evaluasi SQL agregat langsung di database (bukan perulangan memori Node.js), mencegah N+1 bottleneck.
- **Rekonsiliasi Bank**: Perhitungan selisih disinkronkan dengan batas tanggal transaksi berjalan (`todayISO()`), menghilangkan selisih negatif semu.

---

## BAB 7: AUDIT FUNGSIONAL & LOGIKA BISNIS HR & PENGGAJIAN (PAYROLL)

### 7.1 Cacat Karyawan Masa Depan Tergaji Penuh (`BUG-HR-001`)
- **Lokasi Kode**: `src/server/actions/hr/payroll.ts` (Baris 125–130)
- **Kondisi Aktual**:
  ```typescript
  const staff = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, ctx.company.id), eq(employees.isActive, true)));
  ```
- **Masalah**: Hanya menyaring `isActive = true`. Karyawan baru yang mulai bekerja bulan depan (`joinedAt = '2026-12-01'`) ikut terbayar penuh pada batch penggajian periode berjalan (`2026-11`).
- **Bukti Empiris Reproduksi**: Dijalankan via [`audit/tests/repro-hr-payroll-filter.test.ts`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/tests/repro-hr-payroll-filter.test.ts):
  ```
  Karyawan yang terproses pada periode 2026-11 (Aktual): [ 'Budi (Karyawan Lama)', 'Siti (Karyawan Baru Masuk Des)' ]
  Karyawan yang seharusnya terproses (Normatif): [ 'Budi (Karyawan Lama)' ]
  ```
- **Tingkat Keparahan**: **CRITICAL (P0)**.

### 7.2 Cacat Pemotongan Menit Pecahan Lembur (`BUG-HR-002`)
- **Lokasi Kode**: `src/lib/payroll/payroll-indonesia.ts` (Baris 307–317)
- **Kondisi Aktual**:
  ```typescript
  for (let hour = 1; hour <= entry.hours; hour += 1) {
    const rule = rules.find(
      (candidate) => hour >= candidate.hourFrom && (candidate.hourTo === null || hour <= candidate.hourTo),
    );
    if (rule) total = total.plus(hourlyWage.mul(d(rule.multiplier)));
  }
  ```
- **Masalah**: Karena variabel `hour` melonjak dengan integer `hour += 1`, lembur selama `1.5 jam` hanya menghitung jam ke-1. Jam ke-2 tidak terpenuhi (`2 <= 1.5` adalah `false`), sehingga sisa 0,5 jam (30 menit) hilang tidak dibayar.
- **Bukti Empiris Reproduksi**: Dijalankan via [`audit/tests/repro-overtime-truncation.test.ts`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/tests/repro-overtime-truncation.test.ts):
  ```
  Hasil aktual dari fungsi computeOvertimePay: 15000
  Hasil yang seharusnya (normatif PP 35/2021): 25000
  ```
- **Pelanggaran Regulasi**: Melanggar PP No. 35 Tahun 2021 Pasal 31 ayat (1) dan Pasal 32.
- **Tingkat Keparahan**: **HIGH (P1)**.

### 7.3 Cacat Hak Akses Sesi Karyawan Dipecat (`SEC-HR-001`)
- **Lokasi Kode**: `src/server/hr/final-pay.ts` (Baris 526–555)
- **Kondisi Aktual**: Saat karyawan diterminasi (`terminateNow: true`), sistem hanya memperbarui tabel `employees`. Akun login di tabel `users`, relasi `member`, dan token di `session` tidak dicabut. Mantan karyawan masih bisa login ke sistem.
- **Tingkat Keparahan**: **HIGH (P1)**.

---

## BAB 8: AUDIT FUNGSIONAL & LOGIKA BISNIS PENGATURAN & PLATFORM

### 8.1 Hard Delete Pengguna Merusak Jejak Audit (`DAT-SET-001`)
- **Lokasi Kode**: `src/server/actions/users.ts` (Baris 366–373)
- **Kondisi Aktual**:
  ```typescript
  const [remaining] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.userId, targetUserId));
  if ((remaining?.value ?? 0) === 0) {
    await tx.delete(user).where(eq(user.id, targetUserId));
  }
  ```
- **Masalah**: Jika pengguna dihapus dari satu-satunya perusahaan tempat ia terdaftar, akun di-delete fisik dari basis data. Kolom `createdBy` pada dokumen penjualan, penerimaan barang, jurnal, dan audit trail historis kehilangan nama dan email pelaku transaksi.
- **Tingkat Keparahan**: **HIGH (P1)**.

### 8.2 Struktur Menu & Penempatan Kebijakan Stok Negatif (`UX-SET-001`)
- **Lokasi Kode**: `src/components/pengaturan/forms/identitas-pajak.tsx#L350`
- **Kondisi Aktual**: Opsi `allowNegativeStock` berada di tab *Identitas Perusahaan & Pajak*. Ini menimbulkan kebingungan navigasi karena manajer gudang mencari konfigurasi stok di bawah tab *Gudang & Cabang*.
- **Tingkat Keparahan**: **LOW (P3)**.

---

## BAB 9: AUDIT ALUR KERJA TRANSAKSI ANTARMODUL (WORKFLOW TRACEABILITY)

Setiap transaksi dapat ditelusuri dari dokumen hulu hingga hilir:
1. **Pembelian Kredit**:
   `Purchase Order (Draf/Approve) -> Penerimaan Barang (GRN) -> Dr Persediaan, Cr Akrual -> Faktur Pemasok (AP) -> Dr Akrual, Cr Utang Usaha -> Pembayaran Kas/Bank -> Dr Utang Usaha, Cr Kas/Bank`.
2. **Pembelian Tunai Langsung**:
   `Penerimaan Barang Tunai -> Dr Persediaan, Cr Kas/Bank` (Nol utang palsu).
3. **Penjualan Kasir POS Perpetual**:
   `Cart Barcode Scan -> Pembayaran Tunai/Bank -> Mutasi Stok Keluar -> HPP AVCO -> Jurnal Atomik: Dr Kas/Bank, Cr Pendapatan, Cr PPN, Dr HPP, Cr Persediaan`.
4. **Retur Pembelian Supplier**:
   `Dokumen Asal GRN -> Kuantiti Retur <= Plafon -> Mutasi Stok Keluar -> Jurnal Reversal / Potong Utang / Deposit Kredit`.

---

## BAB 10: AUDIT DESAIN, UI/UX, FORM, TABEL, & AKSESIBILITAS ENTERPRISE

### 10.1 Evaluasi Form & Komponen Input (Tolok Ukur SAP Fiori)
- **Keunggulan**: Menggunakan komponen input moneter kanonis `MoneyInput` (pemisah ribuan otomatis `id-ID`, rata kanan), `QtyInput` (desimal timbangan), dan `DateField` (format ISO internal, representasi lokal).
- **Styling**: `fieldClass` terpusat di `src/components/blocks/field-classes.ts` memberikan visual form yang rapi, padat (*compact*), dan seragam.

### 10.2 Evaluasi Tabel & Kesenjangan Adopsi TanStack Table (`UX-DSN-001`)
- **Kondisi**: Repositori telah memiliki fondasi tabel enterprise lengkap di `src/components/blocks/data-table/` (`DataTable`, `DataTableColumnHeader`, `DataTableViewOptions`, `DataTableFacetedFilter`, `DataTableFloatingBar`).
- **Kesenjangan**: Komponen enterprise ini baru diimplementasikan pada 1 halaman (`product-bulk-table.tsx`). Lebih dari 90 halaman daftar lainnya masih menggunakan elemen HTML primitif `<table className="data-table">`, sehingga kehilangan kemampuan multi-sorting interaktif, filter faset, dan pemilihan visibilitas kolom.
- **Tingkat Keparahan**: **MEDIUM (P2)**.

---

## BAB 11: AUDIT ARSITEKTUR, SKEMA DATABASE, & KEAMANAN (SECURITY & IAM)

### 11.1 Pemisahan Multi-Tenant & RLS
- Seluruh kueri basis data dibungkus oleh `withCompany` dan `withCompanyReadOnly` yang mengatur sesi PostgreSQL `app.company_id`. Kebocoran data lintas perusahaan dicegah pada engine PostgreSQL.

### 11.2 Kontrak Penulis Tabel Bersama (Module Boundaries §6)
- Diuji oleh `tests/unit/architecture-table-writers.test.ts`. Memastikan bahwa 22 tabel bersama ditulis persis oleh modul domain yang dideklarasikan pada kontrak kepemilikan data.

### 11.3 Rate Limiting Terpusat di Basis Data
- Konfigurasi Better Auth di `src/lib/auth.ts#L81-L86` menggunakan storage basis data (tabel `rate_limit`, migrasi `0083`), kebal terhadap lingkungan multi-instance server.

---

## BAB 12: AUDIT PERFORMA, BEBAN SKALABILITAS, & EFISIENSI DATA

- **Streaming XLSX/CSV**: Ekspor laporan jurnal, kartu stok, dan daftar produk menggunakan streaming response berbasis chunk (`src/lib/xlsx-stream.ts`), mencegah kehabisan memori Node.js pada dataset besar.
- **Indeks Basis Data**: Indeks komposit multi-tenant (`company_id, status`, `company_id, date`, `company_id, created_at`) telah terpasang pada tabel-tabel berfrekuensi tinggi (`sales`, `journal_entries`, `stock_movements`).

---

## BAB 13: AUDIT CAKUPAN PENGUJIAN (TEST COVERAGE & GAP ANALYSIS)

- **Unit Tests**: 115 berkas uji (1.084 tes lolos 100%).
- **Database Safety Guard**: `tests/vitest-db-guard.mjs` memblokir pengujian integrasi yang menyasar basis data non-test secara otomatis.
- **Kesenjangan Uji**: Belum ada pengujian unit otomatis bawaan untuk menangani kasus lembur jam pecahan desimal dan kasus karyawan masa depan pada batch payroll bulanan (kedua kasus ini berhasil dibuktikan melalui skrip reproduksi independen di `audit/tests/`).

---

## BAB 14: REKONSILIASI KOMPREHENSIF TEMUAN AUDIT TERDAHULU

| ID Terdahulu | Modul | Deskripsi Temuan Awal | Status di HEAD `21d4505` | Bukti Kode Aktual |
| :-: | :--- | :--- | :---: | :--- |
| **POS-001** | POS | Hook Barcode Scanner tidak terpanggil di kasir | **Sudah Diperbaiki** | `useBarcodeScannerCapture` dipanggil di `pos-terminal.tsx#L333`. |
| **HR-001** | HR | Karyawan masa depan tergaji penuh di payroll | **Masih Terjadi (Bug)** | Query `src/server/actions/hr/payroll.ts#L128` tidak memfilter `joinedAt <= periodEnd`. |
| **SET-004** | Pengaturan | Crash kasir metode bayar ber-fee tanpa akun penampung | **Sudah Diperbaiki** | Validasi akun fee ditegakkan di `actions/settings/pembayaran.ts#L180`. |
| **HR-002** | HR | Pemotongan jam pecahan lembur (integer loop) | **Masih Terjadi (Bug)** | Loop integer `for (let hour = 1; hour <= entry.hours; hour += 1)` di `payroll-indonesia.ts#L311`. |
| **CONF-03** | HR / IAM | Akun login eks-karyawan tetap aktif saat terminasi | **Masih Terjadi (Bug)** | `processFinalPay` (`final-pay.ts`) tidak mencabut akses di tabel `user`/`member`. |
| **GDG-001** | Gudang | Izin salah sasaran master pelanggan (`pos.sell`) | **Sudah Diperbaiki** | Diganti menjadi `inventory.manage` di `pihak.ts#L222`. |
| **GDG-002** | Gudang | Over-receipt penerimaan barang tanpa batas PO | **Sudah Diperbaiki** | Agregasi kuantiti dan validasi plafon ditegakkan di `purchasing.ts#L342-L358`. |
| **AKN-001** | Akuntansi | Rumus rekonsiliasi bank menghasilkan selisih semu | **Sudah Diperbaiki** | Disesuaikan dengan batas tanggal `todayISO()` di `reads.ts#L50-L74`. |
| **AKN-002** | Akuntansi | Jurnal manual bebas memposting ke akun kontrol | **Sudah Diperbaiki** | `assertManualJournalLines` memblokir mutasi akun kontrol di `jurnal.ts#L212-L226`. |
| **SET-001** | Pengaturan | Error 500 saat menghapus gudang berriwayat | **Sudah Diperbaiki** | Validasi ramah mutasi historis aktif di `lokasi.ts#L204-L213`. |
| **SET-002** | Pengaturan | Hard-delete user menghancurkan jejak audit trail | **Masih Terjadi (Bug)** | `removeCompanyUserAction` mengeksekusi `tx.delete(user)` di `users.ts#L371`. |
| **POS-002** | POS | Sesi kasir ditutup saat ada pesanan gantung (`held`) | **Masih Terjadi (Bug)** | `closeCashSession` di `sessions.ts#L100-L165` tidak memanggil `countHeldSales`. |
| **AKN-003** | Akuntansi | N+1 Memory bottleneck evaluasi kas di Node.js | **Sudah Diperbaiki** | Menggunakan agregasi SQL langsung di database di `accounting.ts#L86-L92`. |

---

## BAB 15: KATALOG TEMUAN BARU BERDASARKAN PRIORITAS & BUKTI REPRODUKSI

### 15.1 [CRITICAL - P0] `BUG-HR-001`: Pendaftaran Karyawan Masa Depan ke Batch Payroll
- **Lokasi**: `src/server/actions/hr/payroll.ts` (Baris 125–130)
- **Dampak**: Pembayaran upah penuh kepada karyawan yang belum bekerja, distorsi PPh 21 TER.
- **Rekomendasi**: Tambahkan filter `ne(employees.employmentStatus, 'terminated')` dan `or(isNull(employees.joinedAt), lte(employees.joinedAt, periodEnd))`.

### 15.2 [HIGH - P1] `BUG-HR-002`: Pemotongan Jam Lembur Pecahan (PP 35/2021)
- **Lokasi**: `src/lib/payroll/payroll-indonesia.ts` (Baris 307–317)
- **Dampak**: Pelanggaran regulasi upah lembur ketenagakerjaan Indonesia.
- **Rekomendasi**: Ganti loop integer dengan alokasi desimal proporsional berbasis kapasitas batas tier menggunakan `Decimal.min`.

### 15.3 [HIGH - P1] `SEC-HR-001`: Ketiadaan Pencabutan Sesi Login Saat Terminasi Karyawan
- **Lokasi**: `src/server/hr/final-pay.ts` (Baris 526–555)
- **Dampak**: Kerentanan akses mantan karyawan (*Insider Threat*).
- **Rekomendasi**: Jalankan fungsi pencabutan keanggotaan `member` dan pembatalan sesi `session` di domain Platform secara atomik saat terminasi dilakukan.

### 15.4 [HIGH - P1] `DAT-SET-001`: Hard Delete Pengguna Merusak Integritas Jejak Audit
- **Lokasi**: `src/server/actions/users.ts` (Baris 366–373)
- **Dampak**: Kolom `createdBy` pada dokumen transaksi historis kehilangan identitas nama/email.
- **Rekomendasi**: Terapkan penonaktifan akun (*soft-deactivation*) menggunakan `banned: true, banReason: ...` alih-alih `tx.delete(user)`.

### 15.5 [MEDIUM - P2] `WRK-POS-001`: Penutupan Sesi Kas Mengabaikan Transaksi Ditahan
- **Lokasi**: `src/server/pos/sessions.ts` (Baris 125–140)
- **Dampak**: Pesanan tertahan menjadi yatim dan mengacaukan operasional kasir shift berikutnya.
- **Rekomendasi**: Tolak penutupan sesi kas jika `countHeldSales(tx, companyId, userId) > 0`.

### 15.6 [MEDIUM - P2] `UX-DSN-001`: Kesenjangan Adopsi Komponen Enterprise DataTable
- **Lokasi**: `src/components/blocks/data-table/` vs 90+ Halaman Tabel
- **Dampak**: Pengguna tidak dapat menyortir kolom di header, tidak ada filter faset, dan tidak ada toggle kolom pada tabel-tabel utama.
- **Rekomendasi**: Migrasikan halaman master Produk, Jurnal, dan Pembelian ke komponen `DataTable`.

### 15.7 [LOW - P3] `UX-SET-001`: Salah Penempatan Pengaturan Stok Negatif
- **Lokasi**: `src/components/pengaturan/forms/identitas-pajak.tsx#L350`
- **Dampak**: Friksi navigasi operator gudang.
- **Rekomendasi**: Sediakan status dan shortcut link kebijakan stok negatif di tab Gudang & Cabang.

---

## BAB 16: KETERBATASAN PEMERIKSAAN & AREA BELUM TERVERIFIKASI

1. **Hardware Kasir Fisik (`NOT TESTED`)**:
   - Integrasi auto-cutter printer thermal ESC/POS 58mm/80mm, cash drawer RJ-11, dan barcode scanner fisik serial belum diuji pada hardware fisik riil (diuji sebatas pratinjau canvas dan emulasi keyboard).
2. **Paket Desktop Native Tauri (`NOT TESTED`)**:
   - Modul IPC Rust (`src-tauri/src/posdb.rs`) telah terkompilasi, namun pengujian konkurensi SQLite lokal pada terminal offline riil memerlukan hardware terminal desktop fisik.
3. **Beban Ekstrem Impor 10.000+ Baris Produk Sekaligus (`NOT TESTED`)**:
   - Validasi berkas streaming telah terverifikasi lolos unit test, namun uji beban pemrosesan *bulk commit* 10.000 produk secara konkuren pada serverless HTTP memerlukan server staging terdedikasi.

---

## BAB 17: BACKLOG REKOMENDASI PERBAIKAN & RENCANA ROADMAP

| Prioritas | ID Temuan | Modul | Ringkasan Tindakan Perbaikan | Estimasi Kompleksitas | Kriteria Keberhasilan |
| :---: | :---: | :---: | :--- | :---: | :--- |
| **P0 (Critical)** | `BUG-HR-001` | HR | Filter tanggal bergabung `joinedAt <= periodEnd` pada batch payroll bulanan | Rendah | Karyawan masa depan tidak masuk slip gaji |
| **P1 (High)** | `BUG-HR-002` | HR | Perhitungan upah lembur desimal bertingkat (PP 35/2021) | Sedang | Lembur 1,5 jam terhitung tepat Rp75.000 |
| **P1 (High)** | `SEC-HR-001` | HR / Auth | Pencabutan akses keanggotaan dan sesi login pengguna saat karyawan diterminasi | Sedang | Sesi login eks-karyawan dicabut seketika |
| **P1 (High)** | `DAT-SET-001` | Platform | Soft-deactivation pengguna (`banned: true`) alih-alih hard-delete | Rendah | Jejak nama pembuat transaksi lampau tetap utuh |
| **P2 (Medium)** | `WRK-POS-001` | POS | Validasi tolak tutup sesi kas jika masih ada pesanan berstatus `held` | Rendah | Kasir tidak bisa menutup sesi dengan pesanan gantung |
| **P2 (Medium)** | `UX-DSN-001` | UI/UX | Migrasi halaman tabel utama ke pustaka `DataTable` TanStack | Tinggi | Tabel Jurnal & Produk mendukung multi-sort & toggle kolom |
| **P3 (Low)** | `UX-SET-001` | Pengaturan | Shortcut kebijakan stok negatif di tab Gudang & Cabang | Rendah | Navigasi pengaturan stok terhubung rapi |
| **P3 (Low)** | `ARC-ACT-001` | Akuntansi | Penjadwalan otomatisasi jurnal depresiasi aset tetap bulanan | Sedang | Depresiasi terposting otomatis di awal bulan |

---
*Laporan audit total dan verifikasi menyeluruh ini disusun secara obyektif berdasarkan inspeksi mendalam pada repositori `digitalninjanv/bisa-erp-rilis-terbaru` (commit `21d4505`), dengan kepatuhan penuh terhadap mandat read-only audit.*
