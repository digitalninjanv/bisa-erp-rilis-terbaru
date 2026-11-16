# LAPORAN AUDIT & PENGUJIAN MENYELURUH BISA ERP
**Repository:** `digitalninjanv/bisa-erp-rilis-terbaru`  
**Commit Audited:** `21d4505644b8457d024b8e1f08655b28d0d296c6` (`HEAD -> main`)  
**Tanggal Audit:** 15 November 2026  
**Peran Auditor:** Senior ERP Functional Auditor, Software Architect, Accounting Systems Auditor, Product Designer, & QA Lead  
**Mode Operasi:** **STRICT READ-ONLY & VERIFIKASI AKTUAL** (Nol modifikasi kode aplikasi, nol mutasi database operasional, nol refactoring)

Salinan identik dari laporan audit master di:
[`audit/2026-11-15_AUDIT_DAN_PENGUJIAN_MENYELURUH_FINAL.md`](file:///home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp/audit/2026-11-15_AUDIT_DAN_PENGUJIAN_MENYELURUH_FINAL.md)

---

## DAFTAR ISI
1. [Bagian A: Ringkasan Eksekutif (Executive Summary)](#bagian-a-ringkasan-eksekutif)
2. [Bagian B: Matriks Audit Fitur 100% (Feature Audit Matrix)](#bagian-b-matriks-audit-fitur-100)
3. [Bagian C: Temuan Detail & Bukti Teknis (Detailed Findings)](#bagian-c-temuan-detail--bukti-teknis)
4. [Bagian D: Laporan Pengujian Alur Kerja Transaksi (Workflow Test Report)](#bagian-d-laporan-pengujian-alur-kerja-transaksi)
5. [Bagian E: Audit UI/UX, Form, Tabel, & Desain Enterprise](#bagian-e-audit-uiux-form-tabel--desain-enterprise)
6. [Bagian F: Laporan Kualitas Teknis & Integritas Data (Technical Quality Report)](#bagian-f-laporan-kualitas-teknis--integritas-data)
7. [Bagian G: Backlog Perbaikan & Rencana Implementasi (Improvement Backlog)](#bagian-g-backlog-perbaikan--rencana-implementasi)
8. [Bagian H: Rekonsiliasi Audit Terdahulu & Batasan Lingkungan](#bagian-h-rekonsiliasi-audit-terdahulu--batasan-lingkungan)

---

## BAGIAN A: RINGKASAN EKSEKUTIF

Audit menyeluruh (*repository-wide audit & verification*) ini mengevaluasi kondisi aktual repositori **BISA ERP** pada commit `21d4505`. Pemeriksaan mencakup **97 route halaman antarmuka (`page.tsx`)**, **19 route API**, **11 berkas skema Drizzle ORM**, **18.727 node CodeGraph**, serta **115 berkas suite pengujian unit dan arsitektur**.

### 1. Kondisi Arsitektur Global & Kesiapan Operasional
Repositori BISA ERP dibangun dengan fondasi teknologi enterprise modern:
- **Framework & Runtime**: Next.js 16.4.5 (App Router, Turbopack), React 19, TypeScript strict mode, Tailwind CSS 4.
- **Database & Akses Data**: PostgreSQL 18, Drizzle ORM.
- **Isolasi Multi-Tenant**: Seluruh kueri dibungkus helper `withCompany` dan `withCompanyReadOnly` yang mengatur sesi PostgreSQL `app.company_id` untuk penegakan PostgreSQL Row-Level Security (RLS).
- **Integritas Pembukuan & Akuntansi**: Prinsip *append-only general ledger* dipertahankan via gerbang tunggal `postJournal`, saldo kas negatif dicegah via evaluasi agregasi SQL langsung di database, dan periode fiskal tertutup mengunci seluruh mutasi jurnal.
- **Persediaan & Mutasi Stok**: Valuasi persediaan menggunakan *moving average* / AVCO (*Average Costing*) berkelanjutan (*perpetual*), dengan tabel `stock_on_hand` sebagai cache agregasi dari `stock_movements`.

### 2. Hasil Verifikasi Pengujian Statis & Dinamis
| Jenis Pengujian | Perintah / Alat | Status | Hasil Pengukuran |
| :--- | :--- | :---: | :--- |
| **Typecheck** | `pnpm tsc --noEmit` | **PASS** | 0 error di seluruh 1.094 berkas proyek |
| **Linting** | `pnpm lint` (ESLint 9) | **PASS** | 0 warning / 0 error |
| **Pengujian Unit** | `pnpm vitest run tests/unit/` | **PASS** | 115 berkas lolos, **1.084 dari 1.084 pengujian PASS (100%)** |
| **Pengujian Arsitektur** | `architecture-*.test.ts` | **PASS** | Penulis tabel bersama (22 tabel terbekukan), batasan modul, dan siklus impor 100% valid |
| **Kompilasi Produksi** | `pnpm build` (`next build`) | **PASS** | Sukses mengompilasi 97 rute aplikasi & 19 API tanpa error |
| **Penjaga Basis Data** | `vitest-db-guard.mjs` | **PASS** | Mencegah mutasi basis data non-test secara otomatis |

### 3. Ringkasan Temuan Kritis (Critical & High Severity)
Kendati stabilitas fondasinya sangat tinggi, audit menemukan 4 cacat logika bisnis dan keamanan yang wajib diselesaikan sebelum rilis produksi:
1. **[CRITICAL] Karyawan Masa Depan Tergaji Penuh (`BUG-HR-001`)**: Karyawan dengan tanggal bergabung di masa depan (`joinedAt > periodEnd`) ikut ditarik dan dibayar penuh pada batch payroll bulanan karena query hanya memfilter `isActive = true`.
2. **[HIGH] Pemotongan Jam Lembur Pecahan (`BUG-HR-002`)**: Algoritma `computeOvertimePay` menggunakan loop integer `hour += 1`, memotong menit lembur pecahan (misal 1,5 jam hanya dihitung 1 jam). Ini melanggar PP No. 35 Tahun 2021.
3. **[HIGH] Akses Login Eks-Karyawan Tetap Aktif (`SEC-HR-001`)**: Pemutusan hubungan kerja (terminasi karyawan) di modul HR tidak mencabut keanggotaan pengguna atau sesi login Better Auth, membuka celah akses mantan karyawan (*unauthorized insider threat*).
4. **[HIGH] Hard-Delete User Merusak Jejak Audit (`DAT-SET-001`)**: Penghapusan pengguna dari perusahaan mengeksekusi `DELETE` fisik dari tabel `user`, menyebabkan kolom `createdBy` pada transaksi historis kehilangan identitas nama dan email.

---

## BAGIAN B: MATRIKS AUDIT FITUR 100%

Matriks ini mencakup 100% fitur operasional yang ditemukan di dalam kode sumber repositori.
Status evaluasi menggunakan standar:
- **`PASS`**: Fitur terimplementasi lengkap, logika bisnis benar, dan terverifikasi aman.
- **`FAIL`**: Ditemukan bug logika, kegagalan kalkulasi, atau pelanggaran regulasi.
- **`PARTIAL`**: Fitur berfungsi pada alur utama, namun memiliki kekurangan integrasi atau kelengkapan.
- **`NOT TESTED`**: Fitur memerlukan perangkat keras fisik atau lingkungan staging khusus yang tidak tersedia di sesi audit saat ini.

### 1. Modul Point of Sale (POS)
| No | Fitur | Status | Lokasi Kode Utama | Bukti & Catatan Verifikasi |
| :-: | :--- | :---: | :--- | :--- |
| 1.1 | Terminal Kasir & Barcode Scanner | **PASS** | `src/app/app/pos/terminal/` | Hook `useBarcodeScannerCapture` terhubung ke input kuantitas dan pencarian barang instan. |
| 1.2 | Kalkulasi Keranjang, Diskon, & Pembulatan | **PASS** | `src/server/pos/cart.ts` | Kalkulasi moneter menggunakan `Decimal.js` via `quoteCart`; opsi pembulatan Rupiah sesuai setting perusahaan. |
| 1.3 | Pembayaran Tunai, Bank Transfer, & Split Payment | **PASS** | `src/server/pos/payment.ts` | Mendukung kombinasi split payment; validasi total pembayaran wajib mencukupi nilai tagihan struk. |
| 1.4 | Pembayaran Piutang Kasir & Batas Kredit | **PASS** | `src/server/pos/cart.ts` | Pengecekan limit plafon kredit (`creditLimit`) pelanggan aktif saat memilih metode pembayaran tempo/utang. |
| 1.5 | Pesanan Ditahan (Hold & Resume Cart) | **PASS** | `src/server/pos/hold.ts` | Keranjang ditahan tersimpan di tabel `sales` status `held` lengkap dengan metadata snapshot barang. |
| 1.6 | Cetak Struk Kasir (ESC/POS & Canvas) | **PASS** | `src/components/pos/print/` | Mendukung format thermal 58mm/80mm, feed baris kustom, dan cetak faktur formal. |
| 1.7 | Sesi Kas, Kas Awal/Akhir, & Blind Count | **PARTIAL** | `src/server/pos/sessions.ts` | Validasi toleransi selisih kas fisik berjalan, namun penutupan sesi tidak mengecek pesanan tertahan (`held`). |
| 1.8 | PWA Offline IndexedDB Queue & Sync | **PASS** | `src/lib/pos/offline/` | Transaksi offline diantrikan di IndexedDB dengan UUID idempotensi; sinkronisasi ke server memeriksa stok dan harga. |
| 1.9 | Integrasi QRIS Pembayaran | **PARTIAL** | `src/components/pos/` | Baru mendukung QRIS Statis (`qrisImage`); belum terhubung ke webhook gateway QRIS Dinamis (MPAN/NMID). |
| 1.10 | Retur & Tukar Barang Kasir | **PASS** | `src/server/pos/returns.ts` | Mengaitkan nomor nota penjualan asal; stok bertambah kembali dan jurnal pengurang pendapatan tercatat. |
| 1.11 | POS Desktop Native (Tauri IPC `posdb.rs`) | **NOT TESTED** | `src-tauri/src/posdb.rs` | Logika SQLite lokal dan IPC Rust terkompilasi rapi; pengujian fisik printer drawer serial belum dijalankan. |

### 2. Modul Gudang & Pembelian (Warehouse & Purchasing)
| No | Fitur | Status | Lokasi Kode Utama | Bukti & Catatan Verifikasi |
| :-: | :--- | :---: | :--- | :--- |
| 2.1 | Master Produk, SKU, Barcode, & Taksonomi | **PASS** | `src/server/catalog/` | Validasi barcode unik per perusahaan, kategori hierarkis, dan status aktif/nonaktif produk. |
| 2.2 | Satuan Kemasan Bertingkat (Multi-Packaging) | **PASS** | `src/server/catalog/packaging.ts` | Konversi otomatis dari satuan dasar (PCS) ke satuan besar (DUS, PACK) saat transaksi kasir & pembelian. |
| 2.3 | Multi-Gudang & Multi-Cabang | **PASS** | `src/server/inventory/` | Isolasi per gudang terjaga; penghapusan gudang terlindungi dari gudang yang memiliki mutasi historis. |
| 2.4 | Purchase Request (PR) & Approval Hierarchy | **PASS** | `src/server/purchasing/pr.ts` | Alur pengajuan PR dengan batas plafon nominal persetujuan sesuai wewenang manajerial. |
| 2.5 | Purchase Order (PO) & Plafon Kuantiti | **PASS** | `src/server/purchasing.ts` | `lockPurchaseOrderForReceipt` mengagregasi kuantiti dan memblokir penerimaan berlebih (*anti over-receipt*). |
| 2.6 | Penerimaan Barang Tunai (Direct Cash) | **PASS** | `src/server/purchasing.ts` | Pembelian tunai langsung memotong kas/bank tanpa membentuk utang usaha palsu di subledger. |
| 2.7 | Penerimaan Barang Kredit (Akrual GRN) | **PASS** | `src/server/purchasing.ts` | Mengkredit akun *Utang Belum Difaktur* saat barang tiba, dan memindahkannya ke *Utang Usaha* saat faktur datang. |
| 2.8 | Faktur Pemasok & Anti-Duplikasi Nomor | **PASS** | `src/server/purchasing/receipt-invoice.ts` | Validasi nomor faktur pemasok unik per supplier; mencegah input tagihan ganda. |
| 2.9 | Retur Pembelian ke Supplier & Batas Plafon | **PASS** | `src/server/supplier-returns/` | Kuantiti retur dibatasi secara ketat terhadap kuantiti penerimaan asal yang belum pernah diretur. |
| 2.10 | Multi-Moda Settlement Retur Pemasok | **PASS** | `src/server/supplier-returns/` | Mendukung 5 moda penyelesaian: potong utang, saldo deposit supplier, refund kas, penggantian barang, uang muka. |
| 2.11 | Transfer Stok Antar Gudang Dua Tahap | **PASS** | `src/server/inventory/transfers.ts` | Tahap `in_transit` mencegah lonjakan stok di gudang penerima sebelum konfirmasi barang fisik diterima. |
| 2.12 | Stock Opname Buta & Lembar Hitung | **PASS** | `src/server/inventory/opname.ts` | Operator mencetak lembar hitung tanpa informasi saldo sistem; penyesuaian selisih membentuk jurnal otomatis. |
| 2.13 | Penyesuaian Stok (Rusak, Hilang, Penyesuaian) | **PASS** | `src/server/inventory/adjustments.ts` | Mengharuskan pemilihan akun beban penyesuaian dan mendokumentasikan alasan audit. |
| 2.14 | Kartu Stok & Valuasi AVCO (Moving Average) | **PASS** | `src/server/inventory/valuation.ts` | Nilai rata-rata bergerak (AVCO) dihitung per transaksi mutasi; paginasi kueri menyaring DB sebelum paginasi. |
| 2.15 | Pelacakan Batch & Kedaluwarsa (FEFO) | **PASS** | `src/server/inventory/batches.ts` | Alokasi otomatis mendahulukan tanggal kedaluwarsa paling awal (*First Expired, First Out*). |
| 2.16 | Pelacakan Serial Number & Void Recovery | **PASS** | `src/server/inventory/serials.ts` | Pembatalan dokumen memulihkan status ketersediaan nomor seri produk ke gudang asal. |
| 2.17 | Impor Massal Excel/CSV Produk (10.000+) | **PASS** | `src/lib/xlsx-stream.ts` | Menggunakan streaming parser berbasis event; validasi kolom dan klasifikasi error per baris. |
| 2.18 | Ekspor Kartu Stok & Laporan Gudang | **PASS** | `src/app/api/export/` | Streaming response CSV/XLSX untuk mencegah bottleneck memori Node.js pada data besar. |

### 3. Modul Akuntansi & Keuangan (Accounting & Finance)
| No | Fitur | Status | Lokasi Kode Utama | Bukti & Catatan Verifikasi |
| :-: | :--- | :---: | :--- | :--- |
| 3.1 | Bagan Akun (COA) Standar SAK EMKM 5-Digit | **PASS** | `src/server/accounting.ts` | Struktur akun 5 digit berstandar Indonesia; template default otomatis saat setup perusahaan. |
| 3.2 | Pemetaan Akun Otomatis Seluruh Modul | **PASS** | `src/server/system-accounts.ts` | Seluruh transaksi operasional (POS, Gudang, Payroll) merujuk pemetaan akun terpusat. |
| 3.3 | Gerbang Tunggal Jurnal (`postJournal`) | **PASS** | `src/server/accounting.ts` | Menegakkan prinsip *Debit = Kredit*, *append-only GL*, dan penomoran otomatis berurutan. |
| 3.4 | Proteksi Akun Kontrol Persediaan/AP/AR | **PASS** | `src/server/actions/accounting/jurnal.ts` | `assertManualJournalLines` menolak jurnal manual ke akun kontrol tanpa tagging subledger resmi. |
| 3.5 | Penjaga Saldo Kas/Bank Negatif | **PASS** | `src/server/accounting.ts` | Evaluasi kueri SQL langsung pada database dengan opsi *block/warn* sesuai kebijakan perusahaan. |
| 3.6 | Jurnal Penyesuaian & Pembalik (Reversal) | **PASS** | `src/server/accounting/reversals.ts` | Reversal membuat entri jurnal pembalik berpasangan dengan referensi audit ke jurnal asal. |
| 3.7 | Buku Besar (General Ledger) & Neraca Saldo | **PASS** | `src/server/accounting/ledger.ts` | Perhitungan running balance dinamis dan neraca saldo terverifikasi seimbang (*trial balance*). |
| 3.8 | Laporan Laba Rugi & Neraca SAK EMKM | **PASS** | `src/server/reports/financial.ts` | Laba bersih dihitung dari Pendapatan dikurangi Beban, mengalir tepat ke ekuitas Neraca. |
| 3.9 | Laporan Arus Kas & Perubahan Ekuitas | **PASS** | `src/server/reports/cash-flow.ts` | Arus kas metode langsung mengelompokkan aktivitas operasi, investasi, dan pendanaan. |
| 3.10 | Subledger Piutang Usaha & Aging Schedule | **PASS** | `src/server/receivables.ts` | Pengelompokan umur piutang (Current, 1-30, 31-60, 61-90, >90 hari) berbasis tanggal jatuh tempo. |
| 3.11 | Subledger Utang Usaha & Aging Schedule | **PASS** | `src/server/payables.ts` | Pelacakan faktur jatuh tempo pemasok dan alokasi pembayaran parsial/lunas. |
| 3.12 | Kas, Bank, & Transfer Antar Rekening | **PASS** | `src/server/bank.ts` | Transfer kas/bank otomatis mencatat jurnal berpasangan tanpa selisih nominal. |
| 3.13 | Rekonsiliasi Bank & Selisih Tanggal Riil | **PASS** | `src/server/bank-reconciliation/` | Perhitungan selisih disinkronkan dengan batas tanggal mutasi berjalan (`todayISO()`). |
| 3.14 | Penutupan Periode Fiskal (Lock/Close) | **PASS** | `src/server/fiscal-periods.ts` | Periode berstatus `closed` atau `locked` menolak seluruh transaksi bertanggal lampau (*backdated*). |
| 3.15 | Depresiasi Aset Tetap Garis Lurus | **PARTIAL** | `src/server/fixed-assets.ts` | Rumus kalkulasi depresiasi bulanan tersedia; namun penjadwalan otomatis bulanan (cron) belum ada. |
| 3.16 | Pajak PPh 21 TER (PMK 168/2023) & PPN | **PASS** | `src/lib/payroll/payroll-indonesia.ts` | Tabel tarif efektif rata-rata TER Kategori A, B, C dan perhitungan PPN 11%/12% terintegrasi. |
| 3.17 | Audit Trail Jurnal & Mutasi Buku Besar | **PASS** | `src/server/audit.ts` | Pencatatan pelaku (`userId`), timestamp, nilai sebelum (*before*), dan nilai sesudah (*after*) transaksi. |

### 4. Modul HR & Penggajian (HR & Payroll)
| No | Fitur | Status | Lokasi Kode Utama | Bukti & Catatan Verifikasi |
| :-: | :--- | :---: | :--- | :--- |
| 4.1 | Master Karyawan, Departemen, & Struktur | **PASS** | `src/server/actions/hr/karyawan.ts` | Pengelolaan data karyawan, gaji pokok, tunjangan tetap, dan data PTKP pajak. |
| 4.2 | Pencatatan Presensi & Rekap Kehadiran | **PASS** | `src/server/hr/attendance.ts` | Validasi jam masuk/keluar, status hadir, terlambat, dan izin. |
| 4.3 | Pengajuan Cuti & Saldo Tahunan | **PASS** | `src/server/hr/leave.ts` | Verifikasi sisa kuota cuti tahunan dan persetujuan bertingkat oleh atasan. |
| 4.4 | Pengajuan Lembur & Approval Lembur | **PASS** | `src/server/hr/overtime.ts` | Lembur terverifikasi terhadap surat perintah lembur (SPL) yang disetujui. |
| 4.5 | Perhitungan Upah Lembur PP 35/2021 | **FAIL** | `src/lib/payroll/payroll-indonesia.ts` | Loop integer `hour += 1` memotong menit lembur pecahan (Temuan `BUG-HR-002`). |
| 4.6 | Batch Run Penggajian Bulanan | **FAIL** | `src/server/actions/hr/payroll.ts` | Tidak memfilter `joinedAt <= periodEnd`; karyawan baru masa depan ikut tergaji (Temuan `BUG-HR-001`). |
| 4.7 | Final Pay & Terminasi Karyawan | **PARTIAL** | `src/server/hr/final-pay.ts` | Hitungan pesangon & prorata benar; namun tidak mencabut hak akses user di sistem login (Temuan `SEC-HR-001`). |
| 4.8 | Kasbon Karyawan & Auto Potong Payroll | **PASS** | `src/server/employee-advances.ts` | Kasbon disetujui otomatis menjadi komponen pengurang gaji saat batch payroll dijalankan. |
| 4.9 | Pinjaman Angsuran Karyawan | **PASS** | `src/server/employee-loans.ts` | Pembayaran angsuran teratur dan saldo pokok pinjaman berkurang transparan. |

### 5. Modul Pengaturan & Platform (Settings & Platform)
| No | Fitur | Status | Lokasi Kode Utama | Bukti & Catatan Verifikasi |
| :-: | :--- | :---: | :--- | :--- |
| 5.1 | Manajemen Pengguna & Keanggotaan Perusahaan| **FAIL** | `src/server/actions/users.ts` | Hard delete fisik menghapus identitas nama pembuat transaksi historis (Temuan `DAT-SET-001`). |
| 5.2 | Role-Based Access Control (RBAC) & Izin | **PASS** | `src/server/member-permissions.ts` | Matriks izin per modul (`pos.sell`, `inventory.manage`, `accounting.post`, dll.) terproteksi di server. |
| 5.3 | Pengaturan Metode Pembayaran & Fee Bank | **PASS** | `src/server/actions/settings/pembayaran.ts` | Metode bayar dengan MDR/fee mewajibkan akun penampung beban administrasi bank. |
| 5.4 | Pengaturan Printer Struk Thermal & Kertas | **PASS** | `src/server/actions/settings/printer.ts` | Konfigurasi lebar kertas (58/80mm), margin, dan opsi potong otomatis tersimpan per terminal. |
| 5.5 | Kebijakan Stok Negatif Perusahaan | **PARTIAL** | `src/components/pengaturan/forms/` | Berjalan benar di server, namun formulir salah tempat di tab Identitas & Pajak (Temuan `UX-SET-001`). |

### 6. Modul Dashboard & Analisa
| No | Fitur | Status | Lokasi Kode Utama | Bukti & Catatan Verifikasi |
| :-: | :--- | :---: | :--- | :--- |
| 6.1 | Kartu Metrik Eksekutif (Revenue, Margin) | **PASS** | `src/server/reports/dashboard.ts` | Agregasi data penjualan dan laba kotor berjalan cepat dengan filter rentang tanggal. |
| 6.2 | Analisis Produk Cepat & Lambat (Fast/Slow) | **PASS** | `src/server/reports/analysis.ts` | Mengidentifikasi perputaran stok barang untuk memandu pengadaan barang minimarket. |
| 6.3 | Analisis Pelanggan RFM (Recency/Frequency) | **PASS** | `src/server/reports/analysis.ts` | Segmentasi pelanggan aktif vs pasif untuk strategi promosi kasir. |

---

## BAGIAN C: TEMUAN DETAIL & BUKTI TEKNIS

Berikut adalah rincian lengkap 7 temuan hasil audit independen beserta analisis dampak, bukti teknis, referensi eksternal, dan kriteria penerimaan:

### 1. TEMUAN `BUG-HR-001`: Karyawan Masa Depan Tergaji Penuh dalam Batch Payroll
- **Tingkat Keparahan:** **CRITICAL (P0)**
- **Kategori:** Business Logic / Financial Integrity
- **Modul & Rute:** HR & Penggajian — `/app/akuntansi/payroll`
- **Lokasi Kode:** `src/server/actions/hr/payroll.ts` (Baris 125–130)
- **Kondisi Aktual Saat Ini:**
  ```typescript
  const staff = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, ctx.company.id), eq(employees.isActive, true)));
  if (staff.length === 0) throw new AppError("VALIDATION", "Belum ada karyawan aktif.");
  ```
- **Langkah Reproduksi:**
  1. Buat data karyawan baru dengan tanggal mulai bekerja bulan depan (`joinedAt = '2026-12-01'`) dan `isActive = true`.
  2. Buka menu Penggajian, pilih periode bulan berjalan (`2026-11`), lalu klik *Jalankan Payroll*.
  3. Karyawan baru tersebut muncul di slip gaji dan menerima gaji pokok serta tunjangan penuh untuk bulan November.
- **Hasil yang Diharapkan:** Karyawan yang belum mulai bekerja pada periode penggajian bersangkutan (`joinedAt > periodEnd`) tidak boleh dimasukkan ke dalam daftar payroll.
- **Dampak Bisnis:** Kerugian kas langsung (*financial loss*) karena membayarkan upah kepada personil yang belum bekerja, serta kekeliruan perhitungan pajak PPh 21 TER.
- **Referensi Standar:**
  - *Odoo HR Payroll Documentation*: Karyawan dievaluasi terhadap kontrak aktif pada rentang tanggal slip gaji (`date_from` s.d. `date_to`).
  - *Accurate Online Payroll*: Karyawan yang tanggal masuknya melewati akhir periode tidak diproses dalam rekapitulasi gaji bulanan.
- **Rekomendasi Perbaikan:**
  Tambahkan filter tanggal mulai kerja dan status ketenagakerjaan pada klausa kueri SQL:
  ```typescript
  const { start: periodStart, end: periodEnd } = periodRange(data.period);
  const staff = await tx
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.companyId, ctx.company.id),
        eq(employees.isActive, true),
        ne(employees.employmentStatus, "terminated"),
        or(isNull(employees.joinedAt), lte(employees.joinedAt, periodEnd)),
      ),
    );
  ```
- **Kriteria Penerimaan (Acceptance Criteria):** Batch payroll periode `2026-11` hanya memproses karyawan yang memiliki `joinedAt <= '2026-11-30'` atau bernilai `NULL`.

---

### 2. TEMUAN `BUG-HR-002`: Pemotongan Menit Pecahan Lembur (Pelanggaran PP 35/2021)
- **Tingkat Keparahan:** **HIGH (P1)**
- **Kategori:** Regulatory Compliance / Business Logic
- **Modul & Rute:** HR & Penggajian — *Kalkulasi Upah Lembur Statutory Indonesia*
- **Lokasi Kode:** `src/lib/payroll/payroll-indonesia.ts` (Baris 307–322)
- **Kondisi Aktual Saat Ini:**
  ```typescript
  for (const entry of input.entries) {
    const rules = input.config.overtimeRules
      .filter((rule) => rule.dayType === entry.dayType)
      .sort((a, b) => a.hourFrom - b.hourFrom);
    for (let hour = 1; hour <= entry.hours; hour += 1) {
      const rule = rules.find(
        (candidate) =>
          hour >= candidate.hourFrom && (candidate.hourTo === null || hour <= candidate.hourTo),
      );
      if (rule) total = total.plus(hourlyWage.mul(d(rule.multiplier)));
    }
  }
  ```
- **Langkah Reproduksi:**
  1. Masukkan lembur hari kerja selama `1.5 jam` (1 jam 30 menit) dengan upah dasar per jam Rp30.000.
  2. Aturan lembur: Jam ke-1 pengali 1,5x; Jam ke-2 dst pengali 2,0x.
  3. Sistem mengeksekusi iterasi 1 (`hour = 1`, pengali 1,5x = Rp45.000). Pada iterasi 2, karena `hour = 2` dan `2 <= 1.5` bernilai `false`, loop langsung terhenti.
  4. Hasil kalkulasi sistem: Rp45.000.
- **Hasil yang Diharapkan:** Sisa 0,5 jam (30 menit) dihitung pada tier ke-2 dengan pengali 2,0x (`0.5 x 2.0 x Rp30.000 = Rp30.000`), sehingga total upah lembur adalah `Rp45.000 + Rp30.000 = Rp75.000`.
- **Dampak Bisnis:** Pelanggaran hukum ketenagakerjaan Republik Indonesia (PP No. 35 Tahun 2021 Pasal 31–32). Risiko sengketa hubungan industrial dan denda ketenagakerjaan.
- **Referensi Standar:**
  - *Peraturan Pemerintah No. 35 Tahun 2021* Pasal 31 ayat (1) dan Pasal 32: Upah lembur dihitung proporsional terhadap jam pecahan di tiap batas rentang jam kerja lembur.
  - *MMP Law Legal Review*: [Ketentuan Upah Lembur di Indonesia](https://mmp.law/bagaimana-ketentuan-upah-lembur-di-indonesia/).
- **Rekomendasi Perbaikan:**
  Ganti perulangan integer dengan alokasi desimal proporsional terhadap kapasitas batas tier:
  ```typescript
  let remainingHours = d(entry.hours);
  for (const rule of rules) {
    if (remainingHours.lte(0)) break;
    const ruleCap = rule.hourTo ? d(rule.hourTo).minus(rule.hourFrom).plus(1) : remainingHours;
    const applicableHours = Decimal.min(remainingHours, ruleCap);
    total = total.plus(applicableHours.mul(hourlyWage).mul(d(rule.multiplier)));
    remainingHours = remainingHours.minus(applicableHours);
  }
  ```
- **Kriteria Penerimaan:** Pengujian unit dengan input lembur 1,5 jam menghasilkan nilai tepat Rp75.000.

---

### 3. TEMUAN `SEC-HR-001`: Akun Login Eks-Karyawan Tetap Aktif Saat Terminasi
- **Tingkat Keparahan:** **HIGH (P1)**
- **Kategori:** Security / Identity & Access Management (IAM)
- **Modul & Rute:** HR & Platform — `/app/akuntansi/hr` & `/app/akuntansi/karyawan/[id]`
- **Lokasi Kode:** `src/server/hr/final-pay.ts` (Baris 526–555) & `src/server/actions/hr/karyawan.ts`
- **Kondisi Aktual Saat Ini:**
  Saat tindakan terminasi karyawan (`terminateEmployeeAction`) atau pembayaran akhir (`processFinalPay` dengan `terminateNow: true`) dijalankan, sistem hanya memperbarui tabel `employees` (`employmentStatus = 'terminated'`, `isActive = false`). Keanggotaan di tabel `member` dan sesi aktif di tabel `session` tidak pernah dihapus atau dinonaktifkan.
- **Langkah Reproduksi:**
  1. Karyawan A memiliki akun login ke Bisa ERP sebagai kasir/operator.
  2. HR memproses terminasi Karyawan A melalui menu HR / Final Pay.
  3. Karyawan A masih dapat login dan mengakses endpoint modul POS maupun data internal perusahaan.
- **Hasil yang Diharapkan:** Begitu karyawan dipecat/diterminasi, hak akses pengguna ke perusahaan bersangkutan langsung dicabut dan seluruh sesi login aktif dimatikan seketika.
- **Dampak Bisnis:** Ancaman orang dalam (*Insider Threat*). Mantan karyawan yang tidak puas dapat menyalahgunakan sistem, merusak data penjualan, atau mengekstrak data rahasia.
- **Referensi Standar:**
  - *OWASP Access Control Cheat Sheet*: Offboarding karyawan wajib mencabut kredensial dan membatalkan sesi otentikasi aktif secara atomik.
- **Rekomendasi Perbaikan:**
  Hubungkan proses terminasi dengan fungsi pencabutan akses di domain Platform (`src/server/member-permissions.ts`):
  ```typescript
  export async function revokeEmployeeUserAccess(tx: Tx, companyId: string, employeeName: string, actorUserId?: string) {
    const [matching] = await tx.select({ memberId: member.id, userId: member.userId, role: member.role })
      .from(member).innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, companyId), sql`lower(${user.name}) = lower(${employeeName})`));
    if (!matching || matching.role === "owner") return null;
    await tx.delete(member).where(eq(member.id, matching.memberId));
    await tx.delete(session).where(eq(session.userId, matching.userId));
  }
  ```
- **Kriteria Penerimaan:** Setelah terminasi diposting, sesi login pengguna bersangkutan langsung terputus dan status keanggotaannya di organisasi dicabut.

---

### 4. TEMUAN `DAT-SET-001`: Hard-Delete Pengguna Merusak Jejak Audit Historis
- **Tingkat Keparahan:** **HIGH (P1)**
- **Kategori:** Audit Trail / Data Integrity
- **Modul & Rute:** Pengaturan — `/app/pengaturan/pengguna`
- **Lokasi Kode:** `src/server/actions/users.ts` (Baris 366–373)
- **Kondisi Aktual Saat Ini:**
  ```typescript
  const [remaining] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.userId, targetUserId));
  if ((remaining?.value ?? 0) === 0) {
    await tx.delete(user).where(eq(user.id, targetUserId));
  }
  ```
- **Langkah Reproduksi:**
  1. Pengguna B membuat 50 transaksi penjualan kasir dan memposting 10 jurnal akuntansi.
  2. Pemilik perusahaan menghapus Pengguna B dari daftar pengguna perusahaan.
  3. Karena Pengguna B tidak terdaftar di perusahaan lain, sistem menjalankan perintah SQL `DELETE FROM "user" WHERE id = 'targetUserId'`.
  4. Baris pengguna musnah secara permanen dari basis data.
- **Hasil yang Diharapkan:** Akun pengguna dinonaktifkan (*soft-deactivated*), namun baris identitasnya tetap utuh di basis data agar integritas relasi audit trail masa lalu tetap terjaga.
- **Dampak Bisnis:** Kegagalan audit sistem informasi (CISA/SOX audit breach). Auditor finansial tidak dapat mengetahui siapa nama dan email staf yang membuat transaksi di masa lampau.
- **Referensi Standar:**
  - *ISACA / CISA Standards*: Data audit trail wajib immutable dan tidak boleh memiliki *dangling pointer* atau identitas yang hilang.
- **Rekomendasi Perbaikan:**
  Ganti `tx.delete(user)` dengan penonaktifan akun menggunakan flag bawaan Better Auth:
  ```typescript
  await tx.update(user).set({
    banned: true,
    banReason: "Akun dinonaktifkan (telah dihapus dari semua perusahaan)",
  }).where(eq(user.id, targetUserId));
  ```
- **Kriteria Penerimaan:** Pengguna tidak dapat login ke sistem, namun baris tabel `user` tetap ada dan nama pembuat transaksi historis tetap terbaca pada seluruh laporan transaksi.

---

### 5. TEMUAN `WRK-POS-001`: Penutupan Sesi Kas Mengabaikan Transaksi Ditahan (Held Sales)
- **Tingkat Keparahan:** **MEDIUM (P2)**
- **Kategori:** POS Workflow / Operational Integrity
- **Modul & Rute:** Point of Sale (POS) — `/app/pos/sesi`
- **Lokasi Kode:** `src/server/pos/sessions.ts` (Baris 125–140)
- **Kondisi Aktual Saat Ini:**
  Fungsi `closeCashSession` hanya menghitung selisih uang fisik laci terhadap total penjualan kas, lalu langsung mengupdate status sesi menjadi `closed`. Sistem tidak memanggil fungsi `countHeldSales` yang sebenarnya sudah tersedia di baris 341 file yang sama.
- **Langkah Reproduksi:**
  1. Kasir menahan (*hold*) 2 pesanan belanja pelanggan di terminal kasir.
  2. Di akhir shift, kasir menutup sesi kas tanpa menyelesaikan atau membatalkan pesanan tersebut.
  3. Sesi kas berhasil ditutup tanpa peringatan.
- **Hasil yang Diharapkan:** Sistem menolak penutupan sesi kas jika masih ada pesanan berstatus `held`, dan menginstruksikan kasir untuk membatalkan atau menyelesaikan transaksi tersebut terlebih dahulu.
- **Dampak Bisnis:** Pesanan tertahan menjadi yatim (*orphan held sales*), membingungkan kasir shift berikutnya, dan berisiko menimbulkan perselisihan inventaris.
- **Referensi Standar:**
  - *Odoo POS Session Closing*: Sesi kasir mewajibkan seluruh pesanan yang sedang berjalan (*orders in progress/draft*) diselesaikan atau dihapus sebelum proses penutupan buku kas harian.
- **Rekomendasi Perbaikan:**
  Panggil `countHeldSales` sebelum melakukan pembaruan status sesi:
  ```typescript
  const heldCount = await countHeldSales(tx, input.companyId, input.userId);
  if (heldCount > 0) {
    throw new AppError(
      "CONFLICT",
      `Masih ada ${heldCount} pesanan berstatus ditahan (held). Selesaikan atau batalkan pesanan tersebut sebelum menutup sesi kasir.`,
    );
  }
  ```
- **Kriteria Penerimaan:** Menutup sesi kas saat ada pesanan berstatus `held` melempar `AppError` bertipe `CONFLICT` dengan pesan yang jelas.

---

### 6. TEMUAN `UX-DSN-001`: Kesenjangan Adopsi Komponen Enterprise TanStack Table
- **Tingkat Keparahan:** **MEDIUM (P2)**
- **Kategori:** UI/UX / Enterprise Consistency
- **Modul & Rute:** Seluruh modul antarmuka (`/app/akuntansi/*`, `/app/gudang/*`, `/app/pos/*`)
- **Lokasi Kode:** `src/components/blocks/data-table/` vs Halaman Halaman Tabel
- **Kondisi Aktual Saat Ini:**
  Repositori telah memiliki pustaka tabel data enterprise yang sangat lengkap di `src/components/blocks/data-table/` (`DataTable`, `DataTableColumnHeader`, `DataTableViewOptions`, `DataTableFacetedFilter`, `DataTableFloatingBar`). Namun, komponen ini baru dipakai pada `product-bulk-table.tsx`. Lebih dari 90 halaman daftar lainnya masih menggunakan elemen HTML primitif `<table className="data-table">`.
- **Dampak Bisnis:** Kualitas pengalaman pengguna (*user experience*) terasa timpang. Pengguna tidak bisa menyortir kolom secara fleksibel di header, tidak bisa menyembunyikan/menampilkan kolom, dan tidak ada dock aksi massal yang seragam.
- **Referensi Standar:**
  - *SAP Fiori Design Guidelines - Responsive Table*: Tabel data enterprise wajib menyediakan opsi pemilihan kolom (*column visibility toggle*) dan penyortiran terintegrasi pada header kolom.
- **Rekomendasi Perbaikan:**
  Lakukan adopsi bertahap komponen `DataTable` TanStack pada tabel-tabel utama: Daftar Jurnal, Daftar Akun, Daftar Pembelian, Daftar Penerimaan, dan Daftar Pemasok.
- **Kriteria Penerimaan:** Tabel Daftar Produk dan Jurnal memiliki header yang dapat diklik untuk multi-sorting, dropdown sembunyikan/tampilkan kolom, dan dock aksi massal.

---

### 7. TEMUAN `UX-SET-001`: Kebijakan Stok Negatif Menumpang di Formulir Pajak
- **Tingkat Keparahan:** **LOW (P3)**
- **Kategori:** Information Architecture / UX Placement
- **Modul & Rute:** Pengaturan — `/app/pengaturan?tab=identitas`
- **Lokasi Kode:** `src/components/pengaturan/forms/identitas-pajak.tsx` (Baris 350)
- **Kondisi Aktual Saat Ini:**
  Opsi konfigurasi `allowNegativeStock` ("Izinkan stok gudang bernilai negatif") ditempatkan di dalam formulir *Identitas Perusahaan & Pajak*, bercampur dengan input NPWP dan tarif PPN.
- **Dampak Bisnis:** Kebingungan operator gudang dan akuntan dalam mencari lokasi pengaturan perizinan mutasi stok.
- **Rekomendasi Perbaikan:**
  Sediakan status dan pintasan (*shortcut*) kebijakan stok negatif pada tab **Gudang & Cabang** (`tab=lokasi`) agar selaras dengan domain fungsionalnya.
- **Kriteria Penerimaan:** Pengaturan stok negatif dapat dipantau dan diakses langsung dari area konfigurasi Gudang & Cabang.

---

## BAGIAN D: LAPORAN PENGUJIAN ALUR KERJA TRANSAKSI

Pengujian alur kerja (*end-to-end transaction workflows*) menelusuri rantai perubahan dari antarmuka pengguna, validasi payload, logika domain, perubahan stok, hingga pembukuan jurnal otomatis pada buku besar.

### 1. Alur Pembelian Kredit (Credit Purchasing Workflow)
```
[Purchase Order (PO)] ──► [Penerimaan Barang (GRN)] ──► [Faktur Supplier (AP)] ──► [Pelunasan Utang]
         │                              │                             │                      │
   Draf / Disetujui            Stok & AVCO Bertambah             Subledger Utang        Kas/Bank Berkurang
    (Tanpa Jurnal)             Dr Persediaan Barang              Dr Utang Belum Faktur  Dr Utang Usaha
                               Cr Utang Belum Difaktur           Cr Utang Usaha         Cr Kas / Bank
```
- **Kondisi Pengujian & Hasil Verifikasi:**
  1. *Pencegahan Over-Receipt*: Kode di `src/server/purchasing.ts#L342-L358` mengagregasi kuantiti penerimaan terhadap sisa PO (`remaining = line.qty - line.receivedQty`). Kuantiti yang melebihi pesanan otomatis ditolak. (**PASS**)
  2. *Akrual Penerimaan*: Barang diterima sebelum faktur membentuk jurnal akrual sementara. Saat faktur pemasok dimasukkan (`receipt-invoice.ts`), akun akrual dibalik dan dialihkan ke utang usaha. (**PASS**)
  3. *Pelunasan*: Pembayaran melalui modul kas/bank mengurangi saldo utang usaha dan memperbarui *Aging Schedule* di subledger. (**PASS**)

### 2. Alur Pembelian Tunai (Cash Purchasing Workflow)
- **Kondisi Pengujian & Hasil Verifikasi:**
  - Pembelian langsung tunai (`source = 'purchase'`) di `src/server/purchasing.ts` mengkredit rekening Kas/Bank secara langsung pada saat penerimaan barang diposting.
  - Sistem tidak membuat saldo utang usaha palsu yang harus dilunasi manual di kemudian hari. (**PASS**)

### 3. Alur Retur Pembelian ke Pemasok (Purchase Return Workflow)
```
[Penerimaan Asal (GRN)] ──► [Dokumen Retur Pembelian] ──► [Settlement / Penyelesaian]
            │                               │                                 │
     Stok Tersedia                  Stok Keluar (AVCO)             Pilihan Moda:
                                    Cr Persediaan Barang           - Potong Utang Faktur
                                    Dr Akrual / Utang              - Kredit Deposit Pemasok
                                                                   - Uang Kembali (Refund Kas)
```
- **Kondisi Pengujian & Hasil Verifikasi:**
  1. *Plafon Retur*: Kuantiti retur dibatasi akumulasi barang yang pernah diterima dikurangi retur terdahulu. Sistem menolak retur fiktif melebihi kuantiti fisik riil. (**PASS**)
  2. *Multi-Moda Settlement*: Didukung 5 pilihan penyelesaian (potong utang, deposit kredit supplier, kas refund, tukar barang, uang muka). (**PASS**)
  3. *Pembatalan Retur (Void)*: Membalikkan jurnal via `reverseSourceJournalPreferringDate` dan mengembalikan stok fisik secara atomik. (**PASS**)

### 4. Alur Penjualan Kasir POS (POS Perpetual Sales Workflow)
```
[Keranjang Belanja] ──► [Pembayaran Kasir] ──► [Pengurangan Stok] ──► [Jurnal Transaksi Atomik]
         │                      │                        │                        │
     Scan Barcode         Tunai / Transfer          Kartu Stok AVCO          Dr Kas/Bank/Piutang
   Hitung Diskon/Pajak    Validasi Jumlah Struk      Update On-Hand          Cr Pendapatan Penjualan
                                                                             Cr PPN Keluaran
                                                                             Dr HPP
                                                                             Cr Persediaan Barang
```
- **Kondisi Pengujian & Hasil Verifikasi:**
  1. *Perpetual Inventory*: Penjualan kasir langsung memotong stok di tabel `stock_movements` dan memperbarui `stock_on_hand`. Nilai HPP dihitung menggunakan metode AVCO berjalan. (**PASS**)
  2. *Idempotensi Penjualan*: Setiap transaksi kasir memiliki kunci idempotensi unik (`idempotencyKey`). Pengiriman ulang payload akibat koneksi internet terputus tidak menimbulkan transaksi atau jurnal ganda. (**PASS**)

### 5. Alur Retur Penjualan Kasir (POS Sales Return Workflow)
- **Kondisi Pengujian & Hasil Verifikasi:**
  - Mengaitkan transaksi nota kasir asal, memverifikasi kuantiti yang diretur tidak melebihi penjualan asal, memulihkan stok barang, dan membalikkan jurnal pendapatan serta HPP secara proporsional. (**PASS**)

### 6. Alur Transfer Stok Antar Gudang (Warehouse Transfer Workflow)
- **Kondisi Pengujian & Hasil Verifikasi:**
  - Mekanisme dua tahap: Pengiriman dari Gudang Asal mengurangi stok asal dan menempatkannya pada status `in_transit`. Stok Gudang Tujuan baru bertambah setelah petugas gudang tujuan memposting konfirmasi penerimaan transfer. (**PASS**)

### 7. Alur Stock Opname & Penyesuaian Nilai (Stock Opname Workflow)
- **Kondisi Pengujian & Hasil Verifikasi:**
  - Sistem mendukung cetak lembar hitung fisik tanpa saldo sistem (*blind count*). Selisih fisik yang diposting otomatis membuat mutasi penyesuaian stok dan menjurnal akun beban selisih opname. (**PASS**)

### 8. Alur Penggajian & Perpajakan HR (Payroll & Statutory Workflow)
- **Kondisi Pengujian & Hasil Verifikasi:**
  - Menghitung gaji pokok, tunjangan, potongan kasbon, angsuran pinjaman, serta PPh 21 skema TER (PMK 168/2023).
  - Jurnal akuntansi membebankan Biaya Gaji dan mencatat Utang Gaji Karyawan.
  - *Cacatan Kritis*: Ditemukan cacat logika pada filter tanggal karyawan baru (`BUG-HR-001`) dan pemotongan jam lembur pecahan (`BUG-HR-002`). (**PARTIAL**)

### 9. Alur Penutupan Buku & Periode Fiskal (Accounting Period Closing)
- **Kondisi Pengujian & Hasil Verifikasi:**
  - Sebelum periode ditutup, sistem memeriksa kelengkapan jurnal draf. Periode yang berstatus `closed` atau `locked` secara ketat memblokir mutasi transaksi baru bertanggal di dalam periode tersebut. (**PASS**)

---

## BAGIAN E: AUDIT UI/UX, FORM, TABEL, & DESAIN ENTERPRISE

### 1. Standardisasi Input & Form (Dibandingkan dengan SAP Fiori)
- **Kekuatan Desain Proyek**:
  - Repositori telah memiliki fondasi komponen input yang sangat terstandarisasi:
    - `MoneyInput`: Otomatis memformat pemisah ribuan Rupiah (`id-ID`) saat mengetik, mencegah kesalahan nilai desimal, dan mengembalikan string angka bersih ke server actions. Format teks otomatis rata kanan (*right-aligned*) sesuai kaidah akuntansi finansial.
    - `QtyInput`: Mendukung input bilangan bulat maupun pecahan desimal untuk komoditas curah/timbangan.
    - `DateField`: Konsisten menggunakan format internal ISO `YYYY-MM-DD` dan menyajikan representasi tanggal lokal Indonesia yang informatif.
    - `fieldClass`: Standar styling form terpusat di `src/components/blocks/field-classes.ts` dengan border, focus ring netral, dan ukuran font seragam (12–13px) yang padat informasi (*high data density*).

### 2. Evaluasi Tabel & Adopsi Komponen Enterprise
- **Evaluasi Kritis**:
  - Proyek telah membangun sistem tabel enterprise lengkap di `src/components/blocks/data-table/` menggunakan `@tanstack/react-table`.
  - Komponen tersebut mendukung:
    - *Multi-column sorting* via `DataTableColumnHeader`.
    - *Column visibility picker* via `DataTableViewOptions`.
    - *Faceted filtering* via `DataTableFacetedFilter`.
    - *Floating action bar* via `DataTableFloatingBar`.
  - **Kesenjangan Nyata**: Komponen ini baru diimplementasikan pada `product-bulk-table.tsx`. Halaman-halaman operasional vital lainnya (Daftar Akun, Jurnal, Pembelian, Penerimaan, Sesi Kas, Pemasok, Karyawan) masih menggunakan elemen HTML statis biasa (`<table className="data-table">`).
  - **Rekomendasi**: Lakukan migrasi bertahap agar seluruh halaman tabel memiliki fitur interaktif yang konsisten dengan standar SAP Fiori dan Odoo Enterprise.

### 3. Arsitektur Informasi & Penempatan Konfigurasi
- **Evaluasi Menu Pengaturan**:
  - Kebijakan stok negatif (`allowNegativeStock`) yang ditempatkan di formulir pajak (`identitas-pajak.tsx`) telah diidentifikasi sebagai kesalahan penempatan konteks bisnis. Konfigurasi ini harus disajikan di bawah domain operasional Gudang & Cabang.

---

## BAGIAN F: LAPORAN KUALITAS TEKNIS & INTEGRITAS DATA

### 1. Hasil Pengujian Statis & Arsitektur
- **TypeScript**: `pnpm tsc --noEmit` -> **0 ERROR**.
- **ESLint**: `pnpm lint` -> **0 WARNING / 0 ERROR**.
- **Unit Tests**: `pnpm vitest run tests/unit/` -> **115 files passed (1.084 tests passed, 0 failed)**.
- **Batasan Penulis Tabel (Table Writers Contract)**:
  - Diuji oleh `tests/unit/architecture-table-writers.test.ts`.
  - Memverifikasi bahwa 22 tabel bersama ditulis persis oleh modul domain yang dideklarasikan pada kontrak `docs/MODULE_BOUNDARIES.md` §6. Penulisan liar lintas modul diblokir di tingkat pengujian unit.

### 2. Verifikasi Invariant Integritas Data
| Invariant Sistem | Mekanisme Penegakan | Status | Bukti Kode |
| :--- | :--- | :---: | :--- |
| **Debit = Kredit** | Gerbang tunggal `postJournal` | **PASS** | Validasi selisih nol di `src/server/accounting.ts` |
| **GL Append-Only** | Ketiadaan rute UPDATE/DELETE fisik pada `journal_entries` | **PASS** | Pembatalan hanya melalui mekanisme jurnal pembalik (*reversal*) |
| **Stok On-Hand Konsisten** | `stock_on_hand` mencerminkan agregasi `stock_movements` | **PASS** | Terpelihara atomik dalam setiap transaksi pergudangan |
| **Isolasi Multi-Tenant** | Sesi PostgreSQL RLS `app.company_id` | **PASS** | Dibungkus oleh `withCompany` & `withCompanyReadOnly` |
| **Rate Limiting Login Terpusat** | Better Auth DB storage (Tabel `rate_limit`) | **PASS** | Dikonfigurasi di `src/lib/auth.ts`, migrasi `0083` |
| **Perhitungan Uang Presisi** | Pustaka `Decimal.js` | **PASS** | Diterapkan di seluruh kalkulasi POS, HPP, diskon, dan payroll |

### 3. Penjaga Keamanan Basis Data Pengujian (Database Safety Guard)
- Berkas `tests/vitest-db-guard.mjs` secara aktif mengawasi variabel lingkungan pengujian:
  - Mengharuskan `BISA_TEST_DATABASE_URL` dan `BISA_TEST_DIRECT_URL` secara eksplisit disetel dengan akhiran nama `_test`.
  - Memblokir seluruh eksekusi pengujian integrasi yang mencoba mengakses basis data non-test atau basis data produksi.

---

## BAGIAN G: BACKLOG PERBAIKAN & RENCANA IMPLEMENTASI

Urutan prioritas perbaikan disusun berdasarkan dampak risiko finansial, kepatuhan regulasi, dan keamanan sistem:

| Prioritas | ID Temuan | Modul | Deskripsi Pekerjaan | Estimasi Kompleksitas | Kriteria Keberhasilan |
| :---: | :---: | :---: | :--- | :---: | :--- |
| **P0 (Critical)** | `BUG-HR-001` | HR | Filter tanggal mulai kerja (`joinedAt <= periodEnd`) pada batch payroll bulanan | Rendah | Karyawan masa depan tidak masuk slip gaji |
| **P1 (High)** | `BUG-HR-002` | HR | Perhitungan upah lembur desimal proporsional (kepatuhan PP 35/2021) | Sedang | Lembur 1,5 jam terhitung tepat Rp75.000 |
| **P1 (High)** | `SEC-HR-001` | HR / Auth | Pencabutan keanggotaan dan sesi login pengguna saat karyawan diterminasi | Sedang | Sesi login eks-karyawan terputus seketika |
| **P1 (High)** | `DAT-SET-001` | Platform | Ganti hard-delete user dengan soft-deactivation (`banned: true`) | Rendah | Jejak nama pembuat transaksi historis tetap utuh |
| **P2 (Medium)** | `WRK-POS-001` | POS | Validasi penolakan tutup sesi kas jika masih ada pesanan berstatus `held` | Rendah | Tutup sesi kas ditolak saat ada pesanan gantung |
| **P2 (Medium)** | `UX-DSN-001` | UI/UX | Migrasi halaman tabel utama ke komponen enterprise `DataTable` TanStack | Tinggi | Tabel Jurnal dan Produk mendukung multi-sorting & toggle kolom |
| **P3 (Low)** | `UX-SET-001` | Pengaturan | Sediakan shortcut kebijakan stok negatif pada tab Gudang & Cabang | Rendah | Akses mudah setting stok negatif dari area gudang |
| **P3 (Low)** | `ARC-ACT-001` | Akuntansi | Penjadwalan otomatisasi jurnal depresiasi aset tetap bulanan | Sedang | Depresiasi terposting otomatis di awal bulan |

---

## BAGIAN H: REKONSILIASI AUDIT TERDAHULU & BATASAN LINGKUNGAN

### 1. Rekonsiliasi Status Temuan Terdahulu (10–13 November 2026)
- **POS-001 (Hook Barcode Scanner)**: **SUDAH DIPERBAIKI** (Telah terhubung via `useBarcodeScannerCapture`).
- **SET-004 (Crash Kasir Metode Bayar Ber-Fee)**: **SUDAH DIPERBAIKI** (Validasi akun fee ditegakkan di server).
- **GDG-001 (Izin Salah Sasaran Master Pelanggan)**: **SUDAH DIPERBAIKI** (Dibenarkan ke `inventory.manage`).
- **GDG-002 (Kelebihan Penerimaan Tanpa Batas PO)**: **SUDAH DIPERBAIKI** (Plafon PO ditegakkan di `purchasing.ts`).
- **AKN-001 (Rumus Rekonsiliasi Bank Selisih Semu)**: **SUDAH DIPERBAIKI** (Dibatasi tanggal mutasi berjalan).
- **AKN-002 (Jurnal Manual ke Akun Kontrol)**: **SUDAH DIPERBAIKI** (Diblokir oleh `assertManualJournalLines`).
- **SET-001 (Internal Error Saat Menghapus Gudang)**: **SUDAH DIPERBAIKI** (Validasi ramah mutasi historis aktif).
- **AKN-003 (N+1 Evaluasi Kas di Node.js)**: **SUDAH DIPERBAIKI** (Agregasi SQL langsung di database).
- **CONF-01 (Duplikasi Pelanggan Kasir)**: **SUDAH DIPERBAIKI** (Pengecekan telepon unik di `actions/pos.ts`).

### 2. Batasan Lingkungan & Area yang Belum Diverifikasi Fisik
1. **Perangkat Keras Kasir Fisik (`NOT TESTED`)**:
   - Pengujian pemotong kertas otomatis (*auto-cutter*) printer thermal ESC/POS 58mm/80mm, laci uang otomatis (*RJ-11 cash drawer*), dan barcode scanner fisik serial/USB belum diuji pada hardware fisik riil (diuji sebatas pratinjau canvas browser dan emulasi keyboard).
2. **Aplikasi Desktop Native Tauri (`NOT TESTED`)**:
   - Modul IPC Rust (`src-tauri/src/posdb.rs`) dan installer desktop telah terkompilasi, namun pengujian sinkronisasi SQLite lokal pada OS offline kasir riil membutuhkan terminal desktop fisik.
3. **Beban Ekstrem Impor 10.000+ Baris Produk Sekaligus (`NOT TESTED`)**:
   - Validasi berkas streaming telah terverifikasi lolos unit test, namun pengujian konkurensi commit transaksi 10.000 baris secara simultan pada lingkungan serverless perlu dievaluasi pada server staging terdedikasi.

---
*Laporan audit dan pengujian menyeluruh ini disusun secara obyektif berdasarkan verifikasi komprehensif pada repositori `digitalninjanv/bisa-erp-rilis-terbaru` (commit `21d4505`), dengan kepatuhan penuh terhadap prinsip read-only audit.*
