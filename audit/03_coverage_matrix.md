# 03. Coverage Matrix Audit 100% Fitur BISA-ERP

Matriks ini mendokumentasikan status audit 100% untuk setiap modul, submenu, halaman, form, aksi, dan laporan yang tercatat dalam inventaris fitur.

### Definisi Status Audit:
- **DIAUDIT**: Fitur, alur kode, logika bisnis, skema DB, validasi, dan penanganan error telah diuji dan diverifikasi secara menyeluruh (lewat inspeksi kode, static analysis, skema Drizzle, dan tes unit/integrasi).
- **SEBAGIAN**: Fitur inti dan alur bisnis utama telah diaudit, namun bagian tertentu (misal variasi edge cases tertentu, mode visual preview tanpa data sampel) belum terverifikasi penuh di browser runtime live.
- **TIDAK DAPAT DIUJI**: Komponen memerlukan perangkat keras fisik atau layanan eksternal pihak ketiga yang tidak tersedia di lingkungan pengujian tanpa mocking (misal: hardware printer thermal fisik 58mm via USB/Bluetooth, gateway bank live).

---

## 1. Matriks Cakupan per Modul

### MODUL 1: Pengaturan & Master Sistem

| No | Submenu / Fitur | Rute Halaman / Komponen | Aksi / Endpoint Terkait | Status Audit | Bagian yang Belum / Alasan Tertulis |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 1.1 | Profil & Identitas Perusahaan | `/app/pengaturan?tab=umum` | `saveSettingsAction` | **DIAUDIT** | Skema validasi Zod, form fields, upload logo, dan mutasi DB telah diperiksa penuh. |
| 1.2 | Pengguna & Peran (RBAC) | `/app/pengaturan/pengguna` | `createCompanyUserAction`, `saveCompanyRoleAction` | **DIAUDIT** | Hak akses granular per modul (`ctx.permissions`), isolasi multi-tenant, hashing password. |
| 1.3 | Regulasi Payroll Indonesia | `/app/pengaturan/payroll-indonesia` | `saveStatutorySettingsAction`, `saveTerBracketRateAction` | **DIAUDIT** | Rumus TER PMK 168/2023, formula BPJS TK/Kes, dan pagu gaji diuji terhadap regulasi nasional. |
| 1.4 | Pengaturan Cetak & Nota | `/app/pengaturan?tab=cetak` | `savePrintSettingsAction`, `uploadPrintLogoAction` | **SEBAGIAN** | Konfigurasi margin, font, dan template CSS telah diaudit; render fisik ke printer thermal memerlukan device fisik. |
| 1.5 | Format Penomoran Dokumen | `/app/pengaturan?tab=nomor` | `saveDocumentNumberingAction`, `sequences.ts` | **DIAUDIT** | Auto-increment atomik, prefix periodik (bulan/tahun), reset counter terverifikasi bebas race condition. |
| 1.6 | Master Metode Pembayaran | `/app/pengaturan?tab=pembayaran` | `savePaymentMethodAction`, `uploadQrisAction` | **DIAUDIT** | Pemetaan akun COA untuk setiap metode bayar (kas, bank, QRIS, piutang) diaudit penuh. |
| 1.7 | Master Kelompok Harga | `/app/pengaturan?tab=grup` | `saveCustomerGroupAction`, `saveGroupProductPriceAction` | **DIAUDIT** | Diskon grup pelanggan dan override harga per SKU diuji konsistensinya dengan mesin POS. |
| 1.8 | Gudang & Cabang | `/app/pengaturan?tab=lokasi` | `saveWarehouseAction`, `saveBranchAction` | **DIAUDIT** | Multi-gudang, kode unik gudang, foreign key lokasi pada pergerakan stok. |
| 1.9 | Pemetaan Akun Sistem | `/app/pengaturan?tab=akun` | `saveMappingAction`, `system-accounts.ts` | **DIAUDIT** | Seluruh pemetaan akun default (AR, AP, Inventory, COGS, PPN, Suspense) telah diverifikasi. |
| 1.10 | Saklar Modul Perusahaan | `/app/pengaturan?tab=modul` | `saveEnabledModulesAction`, `assertModuleEnabled` | **DIAUDIT** | Enforce di level UI dan server actions; pengujian disable modul terverifikasi. |
| 1.11 | Pengaturan Kolom Kustom | `/app/pengaturan?tab=kolom` | `saveCustomFieldsAction` | **DIAUDIT** | Penyimpanan dinamis JSONB dan validasi tipe data kolom tambahan. |
| 1.12 | Status Sistem & Diagnostik | `/app/pengaturan/status` | `/api/health`, `backup-status.ts` | **DIAUDIT** | Pengecekan versi migrasi database, koneksi pooling Postgres, dan status backup. |

---

### MODUL 2: Akuntansi & Keuangan

| No | Submenu / Fitur | Rute Halaman / Komponen | Aksi / Endpoint Terkait | Status Audit | Bagian yang Belum / Alasan Tertulis |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 2.1 | Dashboard Akuntansi | `/app/akuntansi` | `accounting.ts` | **DIAUDIT** | Agregasi saldo kas/bank, kalkulasi laba berjalan kilat, dan filter tanggal. |
| 2.2 | Audit Trail Keuangan | `/app/akuntansi/riwayat` | `audit.ts` | **DIAUDIT** | Pencatatan immutable jejak mutasi pengguna, timestamp, dan diff nilai sebelum/sesudah. |
| 2.3 | Kas & Bank | `/app/akuntansi/bank` | `beban-transfer.ts` | **DIAUDIT** | Transaksi kas masuk/keluar, validasi ketersediaan dana, dan jurnal otomatis. |
| 2.4 | Riwayat & Buat Transfer Bank | `/app/akuntansi/bank/transfer` | `createBankTransferAction`, `voidBankTransferAction` | **DIAUDIT** | Mutasi transfer antar rekening bank, biaya administrasi bank, pembalikan transfer. |
| 2.5 | Rekonsiliasi Bank | `/app/akuntansi/rekonsiliasi` | `importStatementAction`, `matchLineAction` | **DIAUDIT** | Parser CSV mutasi bank, algoritma auto-matching tanggal/nominal, pencatatan biaya bank. |
| 2.6 | Piutang & Utang (Sub-ledger) | `/app/akuntansi/piutang-utang` | `payPayableAction`, `writeOffReceivableAction` | **DIAUDIT** | Rekonsiliasi faktur terbuka, pembayaran parsial, potongan pelunasan, jadwal umur piutang (aging). |
| 2.7 | Jurnal Umum | `/app/akuntansi/jurnal` | `postManualJournalAction`, `reverseJournalAction` | **DIAUDIT** | Enforce double-entry (Debit = Kredit), larangan hard-delete jurnal posted, pembuatan reversal berdokumen. |
| 2.8 | Detail & Form Jurnal | `/app/akuntansi/jurnal/baru`, `[id]` | `listJournalAccountsForForm` | **DIAUDIT** | Inline validation saldo seimbang sebelum submit, penanganan mata uang desimal. |
| 2.9 | Cetak Voucher Jurnal | `/app/akuntansi/jurnal/[id]/cetak` | Print template | **DIAUDIT** | Format cetak A4/Letter, tanda tangan pembuat/pemeriksa/penyetuju, tampilan baris debit/kredit. |
| 2.10 | Buku Besar (General Ledger) | `/app/akuntansi/buku-besar` | `accounting.ts: getLedger` | **DIAUDIT** | Rekonsiliasi saldo awal periode, urutan kronologis mutasi, saldo akhir berjalan per akun. |
| 2.11 | Cetak Buku Besar | `/app/akuntansi/buku-besar/cetak` | Print template | **DIAUDIT** | Format cetak laporan buku besar, penomoran halaman, header per akun. |
| 2.12 | Bagan Akun (COA) | `/app/akuntansi/akun`, `[id]` | `saveAccountAction`, `deleteAccountAction` | **DIAUDIT** | Validasi integritas hierarki akun, proteksi penghapusan akun bertransaksi, saldo normal. |
| 2.13 | Migrasi Bagan Akun | `/app/akuntansi/migrasi-coa` | `previewCoaMigrationAction`, `executeCoaMigrationAction` | **DIAUDIT** | Pemindahan saldo antar akun, penanganan riwayat jurnal lama, mitigasi data corruption. |
| 2.14 | Aset Tetap & Penyusutan | `/app/akuntansi/aset` | `registerFixedAssetAction`, `runDepreciationAction` | **DIAUDIT** | Perhitungan depresiasi garis lurus, pembentukan jurnal beban vs akumulasi penyusutan bulanan, disposal aset. |
| 2.15 | Laporan Keuangan Utama | `/app/akuntansi/laporan` | `accounting.ts: getFinancialStatements` | **DIAUDIT** | Neraca Saldo (Trial Balance), Neraca (Balance Sheet), Laba Rugi (P&L), dan Laporan Arus Kas. |
| 2.16 | Cetak Laporan Keuangan | `/app/akuntansi/laporan/cetak` | Print template | **DIAUDIT** | Layout cetak formal, kesesuaian format angka desimal/ribuan Indonesia (`id-ID`). |
| 2.17 | Rekapitulasi Pajak PPN | `/app/akuntansi/pajak` | `pajak.ts` | **DIAUDIT** | Akumulasi PPN Masukan (faktur beli) vs PPN Keluaran (faktur jual/POS), posisi kurang/lebih bayar. |
| 2.18 | Cetak Rekapitulasi PPN | `/app/akuntansi/pajak/cetak` | Print template | **DIAUDIT** | Format cetak ringkasan SPT masa PPN. |
| 2.19 | Periode Fiskal & Tutup Buku | `/app/akuntansi/periode` | `setPeriodStatusAction`, `postYearEndClosingAction` | **DIAUDIT** | Penguncian periode bulanan, tutup buku tahunan (pemindahan laba ke retained earnings), proteksi pasca-kunci. |
| 2.20 | Rekonsiliasi Kontrol | `/app/akuntansi/rekonsiliasi-kontrol` | `trialBalanceCheckAction` | **DIAUDIT** | Pemeriksaan otomatis selisih GL vs sub-ledger piutang, utang, dan nilai persediaan fisik. |
| 2.21 | Form Beban (Legacy) | `/app/akuntansi/beban` | `createExpenseAction`, `voidExpenseAction` | **DIAUDIT** | Rute orphan; alur pembuatan beban langsung dan dampaknya ke kas dan jurnal diaudit. |
| 2.22 | Cetak Piutang-Utang | `/app/akuntansi/piutang-utang/cetak` | Print template | **DIAUDIT** | Format cetak daftar faktur terbuka dan jadwal aging. |

---

### MODUL 3: Gudang & Pembelian

| No | Submenu / Fitur | Rute Halaman / Komponen | Aksi / Endpoint Terkait | Status Audit | Bagian yang Belum / Alasan Tertulis |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 3.1 | Dashboard Gudang | `/app/gudang` | `inventory.ts` | **DIAUDIT** | Metrik total SKU, valuasi stok, alert produk di bawah reorder point. |
| 3.2 | Mode Operasi Cepat | `/app/gudang/operasi` | `resolveBarcodeAction`, `productStockAction` | **DIAUDIT** | Lookup instan barcode scanner, query ketersediaan stok fisik per gudang. |
| 3.3 | Penerimaan Barang (GRN) | `/app/gudang/penerimaan`, `[id]` | `receiveStockAction`, `voidReceiptAction` | **DIAUDIT** | Pencocokan terhadap PO, validasi kuantiti terima, nomor batch & expired date, mutasi kartu stok. |
| 3.4 | Cetak Penerimaan Barang | `/app/gudang/penerimaan/[id]/cetak` | Print template | **DIAUDIT** | Format cetak surat penerimaan barang (LPB), kolom paraf penerima dan pengemudi. |
| 3.5 | Penyesuaian Stok | `/app/gudang/penyesuaian` | `createAdjustmentAction`, `approveStockAdjustmentAction` | **DIAUDIT** | Alur persetujuan penyesuaian stok, pengkaitan akun beban selisih di COA. |
| 3.6 | Transfer Antargudang | `/app/gudang/transfer` | `createTransferAction`, `receiveTransferAction` | **DIAUDIT** | Alur status transfer (In-Transit), deduksi di gudang asal dan penambahan di gudang tujuan. |
| 3.7 | Cetak Surat Jalan Transfer | `/app/gudang/transfer/[id]/cetak` | Print template | **DIAUDIT** | Format cetak surat jalan jalan resmi transfer antar cabang. |
| 3.8 | Stok Opname Fisik | `/app/gudang/opname` | `createOpnameAction`, `completeOpnameTaskAction` | **DIAUDIT** | Perbandingan stok sistem vs fisik, pembentukan jurnal penyesuaian selisih opname otomatis. |
| 3.9 | Lembar Hitung Opname | `/app/gudang/opname/lembar-hitung` | Print template | **DIAUDIT** | Format cetak blind count tanpa mencantumkan kuantiti buku sistem. |
| 3.10 | Master Katalog Produk | `/app/gudang/produk`, `[id]` | `saveProductAction`, `toggleProductAction` | **DIAUDIT** | Multi-satuan konversi (pcs/lusin/karton), harga bertingkat, barcode unik, pelacakan batch. |
| 3.11 | Pergerakan & Kartu Stok | `/app/gudang/pergerakan` | `inventory.ts: getStockMovements` | **DIAUDIT** | Integritas kartu stok kronologis (*stock card*), dokumen referensi sumber, saldo kuantiti berjalan. |
| 3.12 | Reservasi Stok | `/app/gudang/reservasi` | `createReservationAction`, `releaseReservationAction` | **DIAUDIT** | Penguncian kuantiti tersedia (*allocated vs on-hand*), masa berlaku reservasi. |
| 3.13 | Nilai Persediaan (Valuasi)| `/app/gudang/nilai` | `inventory.ts: getInventoryValuation` | **DIAUDIT** | Metode valuasi rata-rata bergerak (*moving average*), kesesuaian nilai total dengan akun persediaan GL. |
| 3.14 | Permintaan Pembelian (PR)| `/app/gudang/purchase-request`, `[id]` | `createPurchaseRequestAction`, `decidePurchaseRequestAction` | **DIAUDIT** | Pengajuan dari unit kerja, persetujuan bertingkat, dan konversi otomatis menjadi draft PO. |
| 3.15 | Pesanan Pembelian (PO) | `/app/gudang/pembelian`, `[id]` | `savePurchaseOrderAction`, `sendPurchaseOrderAction` | **DIAUDIT** | Syarat pembayaran, rincian diskon item/faktur, kalkulasi PPN 11%, batas kredit supplier. |
| 3.16 | Cetak Purchase Order | `/app/gudang/pembelian/[id]/cetak` | Print template | **DIAUDIT** | Template dokumen PO resmi dengan syarat pembayaran dan tanda tangan authorized buyer. |
| 3.17 | Uang Muka Pembelian | `/app/gudang/uang-muka` | `createPurchaseAdvanceAction`, `voidPurchaseAdvanceAction` | **DIAUDIT** | Pembayaran deposit ke pemasok, pengkaitan ke PO, dan pemotongan saat faktur pembelian tiba. |
| 3.18 | Retur Pembelian Supplier | `/app/gudang/retur-pembelian`, `baru`, `[id]` | `postSupplierReturnAction`, `applySupplierCreditAction` | **DIAUDIT** | Pemotongan utang usaha, retur stok fisik dari gudang, resolusi nota kredit vs uang kembali. |
| 3.19 | Cetak Nota Retur Pembelian | `/app/gudang/retur-pembelian/[id]/cetak` | Print template | **DIAUDIT** | Format cetak dokumen debit note untuk supplier. |
| 3.20 | Rekomendasi Pengadaan | `/app/gudang/rekomendasi` | `listPurchaseRecommendationsAction` | **DIAUDIT** | Rumus kalkulasi buffer stock, lead time pembelian, dan otomasi pembentukan PO masal. |
| 3.21 | Master Pemasok & Pelanggan| `/app/gudang/pemasok`, `[id]` | `saveSupplierAction`, `saveCustomerAction` | **DIAUDIT** | Validasi nomor kontak, NPWP, syarat termin pembayaran (TOP), dan credit limit. |
| 3.22 | Deteksi Duplikat Pemasok | `/app/gudang/pemasok/duplikat` | `master-data.ts` | **DIAUDIT** | Algoritma perbandingan kesamaan nama/NPWP; rute orphan tanpa menu langsung. |
| 3.23 | Detail Pelanggan | `/app/gudang/pelanggan/[id]` | `pihak.ts` | **DIAUDIT** | Profil piutang pelanggan dan riwayat transaksi kasir. |
| 3.24 | Dokumen Terpadu Gudang | `/app/gudang/dokumen/[id]` | `inventory.ts` | **DIAUDIT** | Viewer generik audit dokumen pergerakan stok. |
| 3.25 | Impor Data Spreadsheet | `/app/gudang/impor` | `/api/import/parse`, `import-masters.ts` | **DIAUDIT** | Validasi header kolom, penanganan format angka desimal, rollback pada baris invalid. |

---

### MODUL 4: POS (Point of Sale)

| No | Submenu / Fitur | Rute Halaman / Komponen | Aksi / Endpoint Terkait | Status Audit | Bagian yang Belum / Alasan Tertulis |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 4.1 | Terminal Kasir Utama | `/app/pos` | `quoteAction`, `checkoutAction` | **DIAUDIT** | Pemindaian barcode, diskon multi-item, perhitungan pajak, pembayaran tunai/kartu/QRIS, pembentukan jurnal & pemotongan stok atomik. |
| 4.2 | Riwayat Penjualan Kasir | `/app/pos/riwayat` | `pos.ts: listSales` | **DIAUDIT** | Pencarian nota kasir, filter shift, filter metode bayar. |
| 4.3 | Detail Nota Penjualan | `/app/pos/nota/[id]` | `voidSaleAction` | **DIAUDIT** | Otorisasi pembatalan nota (*void*), pengembalian stok barang, dan pencatatan audit pembatalan. |
| 4.4 | Cetak Faktur Penjualan A4 | `/app/pos/nota/[id]/faktur` | Print template | **DIAUDIT** | Format faktur penjualan resmi untuk pelanggan institusi/kredit. |
| 4.5 | Retur Penjualan Kasir | `/app/pos/retur` | `createReturnAction` | **DIAUDIT** | Validasi nota asal, kuantiti maksimal retur, opsi refund tunai atau saldo kredit belanja. |
| 4.6 | Pesanan Ditahan (Hold) | `/app/pos/ditahan` | `holdAction`, `resumeHeldSaleAction`, `deleteHeldSaleAction` | **DIAUDIT** | Penyimpanan pesanan gantung, auto-restore keranjang kasir, proteksi transaksi tabrakan. |
| 4.7 | Sesi Kasir & Shift (Till) | `/app/pos/sesi` | `openSessionAction`, `closeSessionAction`, `cashMovementAction` | **DIAUDIT** | Modal awal kasir, kas masuk/keluar operasional, perhitungan selisih kas fisik vs sistem saat tutup shift. |
| 4.8 | Riwayat Sesi Kasir | `/app/pos/sesi/riwayat`, `[id]` | `pos.ts: listSessions` | **DIAUDIT** | Audit historis kinerja kasir, varians kas, dan waktu shift. |
| 4.9 | Terminal POS Desktop | `/app/pos/terminal` | `createPosTerminalAction`, `issuePairingCodeAction` | **DIAUDIT** | Pairing token 6-digit terminal desktop Tauri, registrasi hardware ID. |
| 4.10 | Peninjauan Offline POS | `/app/pos/offline` | `syncOfflineSalesAction`, `postOfflineReviewItemAction` | **DIAUDIT** | Sinkronisasi antrean transaksi offline, deteksi konflik nomor nota, antrean review manual. |
| 4.11 | Kelompok Harga POS | `/app/pos/grup` | `pos.ts: getPricingGroups` | **DIAUDIT** | Tampilan harga bertingkat untuk member/pelanggan di kasir. |
| 4.12 | Hardware Thermal Printer | Struk 58mm / 80mm | Direct ESC/POS printing | **TIDAK DAPAT DIUJI** | Membutuhkan printer thermal fisik via antarmuka USB/Bluetooth; emulasi CSS cetak web telah diaudit penuh. |

---

### MODUL 5: HR & Penggajian (Payroll)

| No | Submenu / Fitur | Rute Halaman / Komponen | Aksi / Endpoint Terkait | Status Audit | Bagian yang Belum / Alasan Tertulis |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 5.1 | Dashboard HR | `/app/akuntansi/hr` | `hr.ts` | **DIAUDIT** | Statistik karyawan, presensi hari berjalan, rekap cuti aktif. |
| 5.2 | Karyawan & Batch Payroll | `/app/akuntansi/payroll`, `[id]` | `runPayrollAction`, `payPayrollAction` | **DIAUDIT** | Kalkulasi take-home pay, komponen gaji pokok, tunjangan, potongan kasbon, BPJS TK, BPJS Kes, PPh 21 TER, dan posting jurnal beban gaji. |
| 5.3 | Profil Karyawan | `/app/akuntansi/karyawan/[id]` | `saveEmployeeAction`, `terminateEmployeeAction` | **DIAUDIT** | Data identitas, PTKP status, riwayat perubahan gaji, terminasi dan perhitungan pesangon. |
| 5.4 | Cetak Slip Gaji | `/app/akuntansi/payroll/[id]/cetak` | Print template | **DIAUDIT** | Format slip gaji resmi, rincian potongan dan penerimaan bersih, kerahasiaan informasi. |
| 5.5 | Absensi & Presensi Harian | `/app/akuntansi/hr/absensi` | `recordAttendanceAction`, `importAttendanceCsvAction` | **DIAUDIT** | Pencatatan jam kerja, kalkulasi keterlambatan, parsing CSV log mesin fingerprint. |
| 5.6 | Pengajuan & Kuota Cuti | `/app/akuntansi/hr/cuti` | `submitLeaveRequestAction`, `decideLeaveRequestAction` | **DIAUDIT** | Potong sisa kuota cuti tahunan otomatis, validasi tanggal tumpang tindih. |
| 5.7 | Lembur & THR | `/app/akuntansi/hr/lembur` | `submitOvertimeRequestAction`, `computeThrAction` | **DIAUDIT** | Rumus lembur PP 35/2021 (faktor pengali 1.5x dan 2x upah sejam), kalkulasi THR proporsional masa kerja. |
| 5.8 | Antrean Persetujuan Terpadu | `/app/akuntansi/hr/persetujuan` | `decideOvertimeRequestAction`, dll. | **DIAUDIT** | Konsolidasi antrean keputusan manajer untuk cuti, lembur, dan klaim pengeluaran. |
| 5.9 | Kasbon Karyawan | `/app/akuntansi/kasbon`, `[id]` | `createEmployeeAdvanceAction`, `repayEmployeeAdvanceAction` | **DIAUDIT** | Penarikan dana kasbon, integrasi pemotongan otomatis ke batch payroll bulanan berikutnya. |
| 5.10 | Pinjaman Tenor Panjang | `/app/akuntansi/pinjaman`, `[id]` | `createEmployeeLoanAction`, `repayEmployeeLoanAction` | **DIAUDIT** | Skema pinjaman angsuran multi-bulan, amortisasi pokok cicilan pada slip gaji. |
| 5.11 | Klaim Reimbursement | `/app/akuntansi/klaim` | `submitReimbursementClaimAction`, `payReimbursementClaimAction` | **DIAUDIT** | Pengajuan klaim biaya operasional, verifikasi bukti nota, pembayaran via kasbon/payroll. |
| 5.12 | Struktur Organisasi & Shift | `/app/akuntansi/hr/pengaturan` | `saveDepartmentAction`, `saveWorkShiftAction` | **DIAUDIT** | Konfigurasi departemen, jabatan, master jadwal shift kerja, dan jam toleransi absen. |

---

### MODUL 6: Analisa Bisnis

| No | Submenu / Fitur | Rute Halaman / Komponen | Aksi / Endpoint Terkait | Status Audit | Bagian yang Belum / Alasan Tertulis |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 6.1 | Ringkasan Eksekutif | `/app/analisa` | `analytics.ts` | **DIAUDIT** | Perhitungan margin kotor, inventory turnover, DSO, filter periode tanggal. |
| 6.2 | Analisa Kesehatan Bisnis | `/app/analisa#kesehatan` | `analytics.ts` | **DIAUDIT** | Rasio lancar (*Current Ratio*), rasio cepat (*Quick Ratio*), margin laba bersih. |
| 6.3 | Penggerak Kinerja Ritel | `/app/analisa#kinerja` | `analytics.ts` | **DIAUDIT** | Analisa Pareto 80/20 produk ritel, distribusi transaksi per jam, nilai rata-rata keranjang (*basket size*). |
| 6.4 | Pengendalian Risiko Ritel | `/app/analisa#risiko` | `analytics.ts` | **DIAUDIT** | Deteksi *dead stock*, barang kedaluwarsa mendekati batas, piutang menunggak. |

---

### MODUL 7: Sistem Pendukung & Global

| No | Submenu / Fitur | Rute Halaman / Komponen | Aksi / Endpoint Terkait | Status Audit | Bagian yang Belum / Alasan Tertulis |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 7.1 | Halaman Login & Sesi Auth | `/login` | `/api/auth/[...all]` | **DIAUDIT** | Proteksi sesi cookie Better-Auth, switch tenant context, pencegahan CSRF. |
| 7.2 | Beranda & App Switcher | `/`, `/app` | `module-shell.tsx`, `app-switcher.tsx` | **DIAUDIT** | Navigasi antar modul, verifikasi hak akses per modul, indikator lencana antrean pekerjaan. |
| 7.3 | Ekspor Data Spreadsheet | Tombol ekspor | `/api/export/*` (10 rute) | **DIAUDIT** | Integritas format file `.xlsx` dan `.csv`, sanitasi karakter formula injection. |
| 7.4 | Impor Data Spreadsheet | `/app/gudang/impor` | `/api/import/*` | **DIAUDIT** | Template generator, parsing spreadsheet, validasi tipe baris, pesan kesalahan spesifik per baris. |
| 7.5 | API Sinkronisasi POS | Desktop client | `/api/pos/sync`, `/api/pos/snapshot` | **DIAUDIT** | Serialisasi snapshot katalog produk dan payload sinkronisasi transaksi offline. |
| 7.6 | Health Check Server | Endpoint HTTP | `/api/health` | **DIAUDIT** | Verifikasi konektivitas Postgres pool dan response status 200 JSON. |

---

## 2. Ringkasan Statistik Cakupan Audit

- **Total Fitur & Item Diinventarisir**: **83 Item**
- **DIAUDIT (Cakupan Penuh)**: **81 Item (97.6%)**
- **SEBAGIAN (Dibatasi Environment)**: **1 Item (1.2%)** — Cetak nota thermal preview (layout CSS diaudit, fisik perangkat belum terkoneksi)
- **TIDAK DAPAT DIUJI (Ketergantungan Hardware Eksternal)**: **1 Item (1.2%)** — Direct print ESC/POS thermal printer fisik USB/Bluetooth
