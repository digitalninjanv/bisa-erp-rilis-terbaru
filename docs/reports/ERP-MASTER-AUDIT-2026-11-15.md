# LAPORAN AUDIT MENYELURUH SISTEM ERP (BISA ERP)
**Repository:** `digitalninjanv/bisa-erp-rilis-terbaru`  
**Commit Audited:** `21d4505644b8457d024b8e1f08655b28d0d296c6` (`HEAD -> main`)  
**Tanggal Audit:** 15 November 2026  
**Peran Auditor:** Senior ERP Functional Auditor, Software Architect, Accounting Systems Auditor, Product Designer, & QA Lead  
**Mode Audit:** **STRICT READ-ONLY** (Nol modifikasi kode aplikasi, nol mutasi database, nol migrasi, nol refactoring)

---

## 1. RINGKASAN EKSEKUTIF

Audit menyeluruh (*repository-wide audit*) ini dilakukan terhadap seluruh lapisan implementasi **BISA ERP** pada commit terbaru `21d4505`. Penelusuran mencakup **97 route halaman (`page.tsx`)**, **19 route API**, **11 berkas skema Drizzle ORM**, **18.727 node CodeGraph**, serta puluhan *server actions* dan modul domain logika bisnis.

### Hasil Penilaian Global
Fondasi arsitektur BISA ERP tergolong **sangat kokoh dan berstandar enterprise**:
1. **Integritas Finansial & Akuntansi**: Prinsip *append-only general ledger* diterapkan secara ketat via gerbang tunggal `postJournal`, saldo kas negatif dijaga oleh guard SQL langsung di database, dan penutupan periode fiskal (`fiscal_periods`) mengunci mutasi jurnal dengan andal.
2. **Pemisahan Multi-Tenant**: Seluruh transaksi database dibungkus oleh `withCompany` dan `withCompanyReadOnly` yang mengatur konfigurasi sesi PostgreSQL `app.company_id` untuk isolasi tenant berbasis RLS.
3. **Kualitas Kompilasi & Keamanan Dependensi**: TypeScript `tsc --noEmit` lolos dengan **0 error**, dan `pnpm audit` mencatat **0 kerentanan High/Critical** (hanya 1 Low).
4. **Remediasi Terdahulu**: Banyak temuan kritis terdahulu berhasil diperbaiki (misal: barcode scanner di kasir kini terpasang via `useBarcodeScannerCapture`, over-receipt terhadap PO dicegah, rate limiting Better Auth kini terpusat di database via migrasi 0083).

### Temuan Kritis yang Masih Terbuka (Critical Highlights)
Kendati demikian, audit independen menemukan sejumlah cacat logika bisnis dan kesenjangan implementasi yang memerlukan perbaikan segera:
- **[BUG - KRITIS] Karyawan Masa Depan Tergaji Penuh (`HR-001`)**: Query penarik karyawan di `runPayrollAction` hanya memeriksa `isActive = true`, tanpa memfilter tanggal bergabung (`joinedAt <= periodEnd`). Karyawan yang baru masuk bulan depan akan menerima gaji penuh bulan ini.
- **[BUG - TINGGI] Pemotongan Jam Lembur Pecahan (`HR-002`)**: Fungsi `computeOvertimePay` menggunakan loop integer `for (let hour = 1; hour <= entry.hours; hour += 1)`, sehingga jam lembur pecahan (misal 1,5 jam atau 2,75 jam) terpotong dan menit lembur sisa tidak dibayar. Ini melanggar PP 35/2021.
- **[KEAMANAN - TINGGI] Akun Login Eks-Karyawan Tetap Aktif (`CONF-03`)**: Tindakan terminasi karyawan di modul HR (`terminateEmployeeAction`) sama sekali tidak terhubung ke tabel `users` / Better Auth. Eks-karyawan yang dipecat tetap dapat login ke sistem.
- **[DATA - TINGGI] Hard-Delete User Menghapus Jejak Audit (`SET-002`)**: Penghapusan user dari perusahaan di `removeCompanyUserAction` mengeksekusi `tx.delete(user)`, meninggalkan string ID yatim (*orphan*) pada kolom `createdBy` di tabel transaksi historis tanpa identitas nama/email.
- **[WORKFLOW - SEDANG] Sesi Kasir Ditutup Saat Ada Pesanan Gantung (`POS-002`)**: Fungsi `closeCashSession` tidak memvalidasi pesanan berstatus `held`. Kasir dapat menutup sesi kas meski masih ada transaksi gantung yang belum diselesaikan atau dibatalkan.
- **[UI/UX - SEDANG] Adopsi TanStack Table Belum Menyeluruh**: Komponen enterprise `DataTable` (`@tanstack/react-table`) sudah dibangun di `src/components/blocks/data-table/`, namun lebih dari 90% halaman daftar masih menggunakan tabel HTML biasa tanpa fitur multi-sorting, filter faset, dan pengaturan visibilitas kolom.

---

## 2. INVENTARISASI LENGKAP MODUL & FITUR

| No | Modul Domain | Jumlah Halaman (`page.tsx`) | Rute API | File Skema DB | Server Actions / Domain Files |
| :-: | :--- | :-: | :-: | :--- | :--- |
| 1 | **Point of Sale (POS)** | 11 | 2 | `sales.ts` | `server/pos/*`, `actions/pos.ts`, `actions/pos-offline.ts`, `actions/pos-terminals.ts` |
| 2 | **Gudang & Pembelian** | 29 | 3 | `inventory.ts`, `catalog.ts` | `server/inventory/*`, `server/purchasing.ts`, `server/supplier-returns/*`, `actions/inventory/*` |
| 3 | **Akuntansi & Keuangan** | 26 | 5 | `accounting.ts` | `server/accounting.ts`, `server/bank-reconciliation/*`, `server/reports/*`, `actions/accounting/*` |
| 4 | **HR & Penggajian** | 15 | 2 | `hr.ts`, `payroll.ts` | `server/hr/*`, `lib/payroll/*`, `actions/hr/*` |
| 5 | **Pengaturan & Platform** | 4 | 3 | `platform.ts`, `auth.ts` | `server/settings.ts`, `actions/settings/*`, `actions/users.ts`, `actions/company.ts` |
| 6 | **Dashboard & Analisa** | 3 | 1 | N/A | `server/reports/dashboard.ts`, `server/reports/analysis.ts` |
| 7 | **Master Data & Impor** | 9 | 3 | `import.ts` | `server/import/*`, `actions/import/*`, `actions/master-data.ts` |
| **TOTAL** | **7 Modul** | **97 Rute Halaman** | **19 Rute API** | **11 Skema Tabel** | **50+ Berkas Server Domain & Aksi** |

---

## 3. MATRIKS AUDIT FITUR

Kriteria Status:
- **Sesuai**: Fitur telah terimplementasi, mematuhi standar industri, dan terverifikasi secara kode.
- **Perlu Improvement**: Fitur berjalan baik namun membutuhkan peningkatan ergonomi UX, skalabilitas, atau efisiensi.
- **Bug**: Ditemukan kesalahan logika bisnis, perhitungan salah, atau inkonsistensi data.
- **Tidak Efisien**: Terjadi pemborosan kueri, perulangan lambat, atau alur kerja terlalu panjang (*high friction*).
- **Belum Lengkap**: Fitur ada di antarmuka namun kemampuan pendukungnya belum terintegrasi penuh.
- **Belum Terverifikasi**: Dibatasi oleh keterbatasan pengujian hardware fisik atau lingkungan runtime eksternal.

| Modul | Fitur | Status Audit | Bukti & Catatan Kode |
| :--- | :--- | :---: | :--- |
| **POS** | Terminal Kasir & Scanner Barcode | **Sesuai** | `useBarcodeScannerCapture` terhubung di `pos-terminal.tsx#L333`. |
| **POS** | Keranjang, Diskon, Pembulatan Rupiah | **Sesuai** | Perhitungan via `quoteCart` dengan Decimal.js; pembulatan sesuai opsi perusahaan. |
| **POS** | Pembayaran Tunai, Transfer, & Split | **Sesuai** | Tercatat di `sales_payments`, validasi nominal cocok dengan total struk. |
| **POS** | Pembayaran Piutang Kasir | **Sesuai** | Validasi batas kredit pelanggan (`creditLimit`) aktif di `quoteCart`. |
| **POS** | QRIS Dinamis (PSP / Webhook) | **Belum Lengkap** | Hanya mendukung QRIS Statis (`qrisImage`); belum ada integrasi payment gateway. |
| **POS** | Pesanan Ditahan (Hold / Resume) | **Sesuai** | Tersimpan di tabel `sales` status `held` dengan snapshot keranjang lengkap. |
| **POS** | Penutupan Sesi Kasir & Held Sales | **Bug** | `closeCashSession` tidak mengecek `held` sales; kasir bisa tutup sesi saat pesanan tertahan. |
| **POS** | Rekonsiliasi Kas Laci (Blind Count) | **Sesuai** | Toleransi selisih kas (`posSessionDifferenceTolerance`) ditegakkan di server. |
| **POS** | PWA Offline Sync & Idempotensi | **Sesuai** | Idempotency key per payload, resolusi konflik sesi/harga (`pos-offline.ts`). |
| **POS** | Desktop Native App (Tauri) | **Belum Terverifikasi** | Kode Rust `posdb.rs` dan IPC tersedia; pengujian fisik hardware printer belum dilakukan. |
| **Gudang** | Master Produk, Barcode, Kemasan | **Sesuai** | Dukungan multi-kemasan (satuan dasar vs turunan) terkonversi rapi di `packaging`. |
| **Gudang** | Multi-Gudang & Lokasi | **Sesuai** | Terisolasi per gudang, penghapusan gudang tervalidasi terhadap mutasi historis. |
| **Gudang** | Purchase Request (PR) & Approval | **Sesuai** | Threshold approval tersimpan di pengaturan; approval inbox terstruktur. |
| **Gudang** | Purchase Order (PO) & Plafon Qty | **Sesuai** | `lockPurchaseOrderForReceipt` mengagregasi qty dan membatasi over-receipt. |
| **Gudang** | Penerimaan Barang Tunai & Kredit | **Sesuai** | Pembelian tunai langsung mengkredit kas/bank tanpa membentuk utang palsu. |
| **Gudang** | Faktur Supplier & Anti-Duplikasi | **Sesuai** | Nomor faktur supplier diperiksa unik per pemasok di `receipt-invoice.ts`. |
| **Gudang** | Retur Pembelian & Batas Plafon | **Sesuai** | Akumulasi retur dibatasi tidak melebihi sisa barang yang belum diretur. |
| **Gudang** | Settlement Retur (Debit Note/Refund) | **Sesuai** | Mendukung potong utang, saldo kredit supplier, dan kas refund. |
| **Gudang** | Transfer Antar Gudang Dua Tahap | **Sesuai** | Status `in_transit` mencegah lonjakan stok sebelum barang dikonfirmasi tiba. |
| **Gudang** | Stock Opname Buta & Lembar Hitung | **Sesuai** | Mendukung cetak lembar hitung tanpa jumlah sistem, input draf, dan selisih. |
| **Gudang** | Kartu Stok & Valuasi AVCO | **Sesuai** | Moving average AVCO dihitung per mutasi; pencarian menyaring database sebelum paginasi. |
| **Gudang** | Nomor Batch / Kadaluwarsa (FEFO) | **Sesuai** | Pengeluaran barang memilih batch kadaluwarsa terdekat lebih dahulu. |
| **Gudang** | Nomor Seri & Pemulihan Void | **Sesuai** | `restoreSerialsForStockDocumentVoid` memulihkan status seri saat dokumen dibatalkan. |
| **Akuntansi** | Bagan Akun (COA) & Template | **Sesuai** | Struktur standar 5 digit SAK EMKM / PSAK; mendukung impor hierarki akun. |
| **Akuntansi** | Pemetaan Akun Otomatis | **Sesuai** | Semua modul bertransaksi melalui kunci pemetaan akun perusahaan. |
| **Akuntansi** | Gerbang Tunggal Jurnal (`postJournal`)| **Sesuai** | Seluruh mutasi GL wajib seimbang (Debit = Kredit) dan berprinsip append-only. |
| **Akuntansi** | Larangan Mutasi Akun Kontrol | **Sesuai** | `assertManualJournalLines` memblokir mutasi manual Persediaan/Piutang/Utang tanpa tag. |
| **Akuntansi** | Penjaga Saldo Kas/Bank Negatif | **Sesuai** | Evaluasi agregasi SQL langsung di database dengan opsi allow/warn/block. |
| **Akuntansi** | Buku Besar & Neraca Saldo | **Sesuai** | Menghasilkan running balance yang tepat waktu; ekspor streaming CSV/XLSX. |
| **Akuntansi** | Laporan Laba Rugi & Neraca | **Sesuai** | Mematuhi prinsip SAK EMKM: Pendapatan - Beban = Laba Bersih di Ekuitas. |
| **Akuntansi** | Rekonsiliasi Bank & Selisih Semu | **Sesuai** | Formula selisih rekonsiliasi telah disinkronkan dengan tanggal berjalan (`T4R-3b`). |
| **Akuntansi** | Penutupan Periode Fiskal | **Sesuai** | Periode `closed` atau `locked` memblokir mutasi backdated tanpa izin pembukaan. |
| **Akuntansi** | Depresiasi Aset Tetap Otomatis | **Belum Lengkap** | Perhitungan garis lurus tersedia, namun belum ada jadwal otomatisasi/cron bulanan. |
| **HR** | Master Karyawan & Organisasi | **Sesuai** | Departemen, jabatan, atasan langsung, dan riwayat gaji terstruktur. |
| **HR** | Sinkronisasi Terminasi vs User Login | **Bug** | Karyawan dipecat tidak menonaktifkan akun login di tabel `users`. |
| **HR** | Perhitungan Upah Lembur PP 35/2021 | **Bug** | Jam pecahan terpotong pada perulangan integer di `computeOvertimePay`. |
| **HR** | Batch Payroll & Karyawan Masa Depan | **Bug** | Karyawan dengan `joinedAt > periodEnd` ikut terproses dan dibayar penuh. |
| **HR** | Pajak PPh 21 TER (PMK 168/2023) | **Sesuai** | Tabel kategori TER A, B, C dan penyesuaian masa pajak Desember Pasal 17 terintegrasi. |
| **HR** | Kasbon & Pinjaman Karyawan | **Sesuai** | Pemotongan otomatis saat payroll; sisa pinjaman tercatat transparan. |
| **Platform** | Isolasi Multi-Tenant | **Sesuai** | `withCompany` membungkus transaksi dengan penegasan context DB `app.company_id`. |
| **Platform** | Rate Limiting Login Multi-Instance | **Sesuai** | Menggunakan storage database `rate_limit` (Better Auth, migrasi 0083). |
| **Platform** | Penghapusan Pengguna (User Delete) | **Bug** | Hard-delete fisik memusnahkan jejak nama/email pada audit trail transaksi lama. |
| **UI/UX** | Input Uang, Qty, Tanggal, Persen | **Sesuai** | Komponen terstandarisasi (`MoneyInput`, `QtyInput`, `DateField`, `PercentInput`). |
| **UI/UX** | Komponen Tabel Enterprise | **Perlu Improvement** | Mayoritas tabel masih memakai HTML biasa, belum mengadopsi `DataTable` TanStack. |

---

## 4. AUDIT WORKFLOW & KEBENARAN TRANSAKSI

### A. Rantai Pembelian, Penerimaan, Utang, & Pembayaran
```
Purchase Order (PO) ──► Penerimaan Barang (GRN) ──► Faktur Pemasok (AP) ──► Pembayaran Utang
      │                           │                         │                      │
   Draf/Sent             Stok & AVCO Bergerak          Utang Dicatat          Kas/Bank Keluar
 (Tanpa Jurnal)          Dr Persediaan                 Dr Persediaan          Dr Utang Usaha
                         Cr Utang Belum Difaktur       Cr Utang Usaha         Cr Kas/Bank
```
- **Kebenaran Transaksi**:
  - Saat barang diterima sebelum faktur terbit, sistem mencatat jurnal penerimaan barang dengan mengkredit akun *Utang Belum Difaktur* (akrual penerimaan).
  - Ketika faktur pemasok dimasukkan, saldo akrual ditutup dan dipindahkan ke akun *Utang Usaha*.
  - Mekanisme **pembelian tunai langsung** (`source = 'purchase'`, bayar kas/bank) langsung memotong kas tanpa menciptakan utang palsu yang perlu dilunasi manual.
  - **Pencegahan Over-Receipt**: Kode di `src/server/purchasing.ts#L342-L358` mengagregasi kuantiti barang yang diminta per produk dan membandingkannya dengan sisa pesanan PO (`remaining = line.qty - line.receivedQty`). Jika melebihi batas, transaksi digagalkan secara atomik.

### B. Rantai Retur Pembelian & Plafon Pengembalian
- Retur pembelian ke pemasok (`src/server/supplier-returns/`) diverifikasi terhadap penerimaan asal:
  1. Kuantiti retur dibatasi plafon kumulatif: tidak boleh meretur barang melebihi kuantiti yang diterima dikurangi retur sebelumnya.
  2. Mendukung 5 moda penyelesaian (*settlement*): potong utang faktur, kredit pemasok (*supplier credit note*), uang kembali (*refund* kas/bank), penggantian barang (*replacement*), atau pemotongan uang muka.
  3. Pembatalan (*void*) retur memulihkan stok dan membalikkan jurnal secara otomatis melalui `reverseSourceJournalPreferringDate`.

### C. Alur POS, Sesi Kasir, & Kas Laci
- **Perpetual Inventory POS**:
  - Penjualan kasir memotong fisik stok seketika, menghitung HPP berbasis AVCO berjalan, dan membuat entri jurnal atomik:
    - `Dr Kas/Bank/Piutang` (Nilai Penjualan)
    - `Cr Pendapatan Penjualan` (DPP)
    - `Cr PPN Keluaran` (Pajak jika ada)
    - `Dr Harga Pokok Penjualan (HPP)` (Beban HPP)
    - `Cr Persediaan Barang` (Nilai Buku Persediaan)
- **Kelemahan Alur Sesi Kas**:
  - Pada fungsi `closeCashSession` (`src/server/pos/sessions.ts`), sistem tidak memvalidasi keberadaan transaksi berstatus `held`. Kasir dapat menutup sesi kasir di akhir giliran kerja meskipun masih ada barang pelanggan yang ditahan di antrean kasir. Akibatnya, transaksi gantung tersebut menjadi yatim atau membingungkan kasir shift berikutnya.

---

## 5. AUDIT UI/UX, FORM, TABEL, DAN INPUT DATA

### A. Evaluasi Standardisasi Form & Input
- **Kelebihan**:
  - Aplikasi telah mengadopsi komponen input kanonis yang sangat baik:
    - `MoneyInput`: Otomatis memformat pemisah ribuan Rupiah (`id-ID`) saat mengetik, mencegah salah ketik nilai desimal, dan mengembalikan string angka bersih ke server actions.
    - `QtyInput`: Mendukung input kuantiti bilangan bulat maupun pecahan untuk barang timbangan/curah.
    - `DateField`: Konsisten menggunakan format tanggal ISO `YYYY-MM-DD` di balik layar dan menampilkan format lokal Indonesia di antarmuka.
    - `fieldClass`: Standar styling form terpusat di `src/components/blocks/field-classes.ts` dengan border, focus ring, dan ukuran font seragam (12–13px).

### B. Evaluasi Tabel Data & Kerapian Visual
- **Temuan Kesenjangan (Adopsi TanStack Table)**:
  - Repositori telah menginstal `@tanstack/react-table` dan membangun koleksi komponen enterprise di `src/components/blocks/data-table/`:
    - `DataTable` (komponen tabel dengan state mesin)
    - `DataTableColumnHeader` (pengurutan multi-arah)
    - `DataTableFloatingBar` (dock aksi massal mengambang)
    - `DataTableViewOptions` (toggle sembunyikan/tampilkan kolom)
    - `DataTableFacetedFilter` (penyaring faset dinamis)
  - **Namun**, komponen ini baru dimanfaatkan pada `product-bulk-table.tsx`. Halaman daftar utama lainnya (Daftar Akun, Jurnal, Pembelian, Penerimaan, Sesi Kas, Pemasok, Karyawan) masih menggunakan elemen HTML statis `<table className="data-table">`.
  - **Dampak UX**: Pengguna dihadapkan pada tabel tanpa kemampuan memilih kolom yang ingin dilihat, tidak bisa menyortir kolom secara langsung di header tabel, dan harus bergantung pada filter form terpisah di atas tabel.

### C. Penataan Pengaturan yang Tidak Sesuai Kategori
- **Stok Negatif Menumpang di Formulir Pajak**:
  - Pengaturan `allowNegativeStock` (kebijakan apakah kasir/gudang boleh mengeluarkan barang saat stok 0) diletakkan di tab *Identitas & Pajak* (`src/components/pengaturan/forms/identitas-pajak.tsx#L350`).
  - Berdasarkan standar SAP Fiori dan Odoo Inventory, pengaturan stok negatif mutlak berada di bawah **Kebijakan Gudang & Inventaris**, bukan di profil perusahaan atau perpajakan.

---

## 6. AUDIT PERFORMA, KEAMANAN, DAN ARSITEKTUR

### A. Isolasi Tenant & Keamanan Database
- **RLS & withCompany**: Seluruh server actions yang mengeksekusi operasi data membungkus query di dalam helper `withCompany(companyId, tx => ...)` yang mengeksekusi:
  ```sql
  SET LOCAL app.company_id = '...';
  ```
- Ini memastikan isolasi data multi-perusahaan terjamin pada level database engine PostgreSQL, mencegah kebocoran data lintas cabang/perusahaan (*cross-tenant leakage*).

### B. Evaluasi Keamanan Autentikasi & Rate Limiting
- Pada audit terdahulu (8 November 2026), terdapat catatan risiko `BERP-01` di mana rate limit sign-in Better Auth masih in-memory per-proses.
- **Verifikasi HEAD 15 November 2026**:
  - Di `src/lib/auth.ts#L81-L86`, konfigurasi rate limit telah diubah menjadi:
    ```typescript
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 10,
      max: 100,
    }
    ```
  - Dan skema `rate_limit` telah dibuat di `src/db/schema/auth.ts` melalui migrasi `0083`.
  - **Status: Masalah rate limiting terpusat telah SELESAI DIPERBAIKI.**

### C. Kerapuhan Jejak Audit pada Penghapusan User (`SET-002`)
- Di `src/server/actions/users.ts#L366-L372`:
  ```typescript
  const [remaining] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.userId, targetUserId));
  if ((remaining?.value ?? 0) === 0) {
    await tx.delete(user).where(eq(user.id, targetUserId));
  }
  ```
- **Masalah**: Bila user dikeluarkan dari satu-satunya perusahaan tempat ia terdaftar, sistem mengeksekusi `DELETE` fisik dari tabel `user`.
- **Dampak**: Kolom `createdBy` pada dokumen penjualan, penerimaan barang, jurnal akuntansi, dan log audit di masa lalu kini mengarah ke ID yang sudah terhapus secara fisik di tabel user. Laporan riwayat transaksi masa lalu tidak lagi dapat menampilkan nama atau email siapa yang memposting transaksi tersebut.
- **Rekomendasi**: Ubah menjadi *soft-deactivation* (`isActive = false` atau `banned = true`), bukan hard delete.

---

## 7. REKONSILIASI DENGAN AUDIT TERDAHULU

Rekonsiliasi terhadap 15 Risiko Teratas (*Top 15 Systemic Risks*) dari audit 10–13 November 2026:

| ID Lama | Modul | Deskripsi Temuan Awal | Status di HEAD (15 Nov 2026) | Bukti Kode Aktual |
| :-: | :--- | :--- | :---: | :--- |
| **POS-001** | POS | Hook Barcode Scanner tidak dipanggil di terminal kasir | **Sudah Diperbaiki** | `useBarcodeScannerCapture` dipanggil di `pos-terminal.tsx#L333`. |
| **HR-001** | HR | Karyawan masa depan tergaji penuh di run payroll | **Masih Terjadi (Bug)** | Query `src/server/actions/hr/payroll.ts#L125-L129` tidak memfilter `joinedAt <= periodEnd`. |
| **SET-004** | Pengaturan | Kasir crash akibat metode bayar ber-fee tanpa akun penampung | **Sudah Diperbaiki** | Validasi `map.bank_fee` ditegakkan di `actions/settings/pembayaran.ts#L180`. |
| **HR-002** | HR | Pemotongan jam pecahan lembur (integer loop) | **Masih Terjadi (Bug)** | Loop integer `for (let hour = 1; hour <= entry.hours; hour += 1)` di `payroll-indonesia.ts#L311`. |
| **CONF-03** | HR / Auth | Akun login eks-karyawan tetap aktif saat karyawan dipecat | **Masih Terjadi (Bug)** | `processFinalPay` (`final-pay.ts`) tidak menonaktifkan akun di tabel `users`. |
| **GDG-001** | Gudang | Izin salah sasaran pada master pelanggan (`pos.sell`) | **Sudah Diperbaiki** | Diganti menjadi `requirePermissionInModule("inventory.manage", "gudang")` di `pihak.ts#L222`. |
| **GDG-002** | Gudang | Kelebihan penerimaan barang tanpa batas PO | **Sudah Diperbaiki** | Agregasi kuantiti dan validasi sisa PO ditegakkan di `purchasing.ts#L342-L358`. |
| **AKN-001** | Akuntansi | Rumus rekonsiliasi bank menghasilkan selisih negatif semu | **Sudah Diperbaiki** | Disesuaikan dengan batas tanggal `todayISO()` dan live predicate di `reads.ts#L50-L74`. |
| **AKN-002** | Akuntansi | Jurnal manual bebas memposting ke akun kontrol | **Sudah Diperbaiki** | `assertManualJournalLines` memblokir mutasi akun kontrol tanpa tag di `jurnal.ts#L212-L226`. |
| **SET-001** | Pengaturan | Internal error 500 saat menghapus gudang berriwayat | **Sudah Diperbaiki** | Pengecekan `stockMovements` dan `sales` melempar pesan ramah di `lokasi.ts#L204-L213`. |
| **SET-002** | Pengaturan | Hard-delete user menghancurkan jejak audit trail | **Masih Terjadi (Bug)** | `removeCompanyUserAction` mengeksekusi `tx.delete(user)` di `users.ts#L371`. |
| **POS-002** | POS | Shift kasir ditutup saat ada transaksi gantung (held) | **Masih Terjadi (Bug)** | `closeCashSession` di `sessions.ts#L100-L165` tidak mengecek `countHeldSales`. |
| **AKN-003** | Akuntansi | N+1 Memory bottleneck evaluasi saldo kas di Node.js | **Sudah Diperbaiki** | Menggunakan agregasi SQL langsung di database di `accounting.ts#L86-L92`. |
| **CONF-01** | POS / Pihak | Data pelanggan terfragmentasi tanpa cek telepon | **Sudah Diperbaiki** | Validasi nomor telepon duplikat ditambahkan di `actions/pos.ts#L148-L151`. |
| **SET-003** | Pengaturan | Pengaturan stok negatif salah tempat di profil pajak | **Sebagian Diperbaiki** | Label risiko diperjelas, namun form masih berada di tab Identitas & Pajak. |

---

## 8. KATALOG TEMUAN DETAIL & REKOMENDASI

### TEMUAN 1: Karyawan Masa Depan Tergaji Penuh dalam Batch Payroll
- **ID Temuan:** `BUG-HR-001`
- **Modul & Fitur:** HR & Penggajian — *Run Payroll Bulanan*
- **Lokasi File:** `src/server/actions/hr/payroll.ts` (Baris 125–130)
- **Kondisi Aktual:**
  ```typescript
  const staff = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, ctx.company.id), eq(employees.isActive, true)));
  if (staff.length === 0) throw new AppError("VALIDATION", "Belum ada karyawan aktif.");
  ```
- **Masalah:** Query penarik karyawan aktif hanya menyaring `isActive = true`. Karyawan baru yang tanggal bergabungnya di masa depan (`joinedAt > periodEnd`) atau karyawan yang telah berhenti sebelum awal periode (`employmentStatus = 'terminated'` tapi `isActive` belum di-update) akan ditarik ke dalam daftar penerima gaji dan dibayar penuh (gaji pokok + tunjangan).
- **Dampak Bisnis:** Kerugian finansial langsung bagi perusahaan karena membayar gaji individu yang belum aktif bekerja pada periode tersebut.
- **Prioritas:** **CRITICAL (P0)**
- **Rekomendasi Solusi:**
  Tambahkan filter tanggal bergabung dan status pemberhentian:
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
- **Kriteria Penerimaan:** Batch payroll untuk periode `2026-11` tidak boleh menyertakan karyawan yang memiliki `joinedAt = '2026-12-01'`.

---

### TEMUAN 2: Pemotongan Menit Pecahan Lembur Karyawan (Pelanggaran PP 35/2021)
- **ID Temuan:** `BUG-HR-002`
- **Modul & Fitur:** HR & Penggajian — *Kalkulasi Upah Lembur Statutory Indonesia*
- **Lokasi File:** `src/lib/payroll/payroll-indonesia.ts` (Baris 307–317)
- **Kondisi Aktual:**
  ```typescript
  for (const entry of input.entries) {
    const rules = input.config.overtimeRules
      .filter((rule) => rule.dayType === entry.dayType)
      .sort((a, b) => a.hourFrom - b.hourFrom);
    for (let hour = 1; hour <= entry.hours; hour += 1) {
      const rule = rules.find(
        (candidate) => hour >= candidate.hourFrom && (candidate.hourTo === null || hour <= candidate.hourTo),
      );
      if (rule) total = total.plus(hourlyWage.mul(d(rule.multiplier)));
    }
  }
  ```
- **Masalah:** Variabel `hour` bertambah dengan integer `hour += 1`. Jika karyawan lembur selama `1.5 jam` (1 jam 30 menit):
  - Iterasi 1: `hour = 1`, `1 <= 1.5` -> Dihitung pengali 1.5x.
  - Iterasi 2: `hour = 2`, `2 <= 1.5` -> Evaluasi `false`, loop berhenti.
  - **Sisa 0.5 jam (30 menit) terbuang sepenuhnya tanpa dibayar.**
- **Dampak Bisnis:** Pelanggaran regulasi ketenagakerjaan Indonesia (PP No. 35 Tahun 2021 Pasal 31–32). Menimbulkan perselisihan hubungan industrial dan tuntutan upah lembur karyawan.
- **Prioritas:** **HIGH (P1)**
- **Rekomendasi Solusi:**
  Hitung alokasi jam lembur per batas rentang (*tier bracket*) secara desimal:
  ```typescript
  let remainingHours = d(entry.hours);
  let currentHourOffset = d(0);
  for (const rule of rules) {
    if (remainingHours.lte(0)) break;
    const ruleCap = rule.hourTo ? d(rule.hourTo).minus(rule.hourFrom).plus(1) : remainingHours;
    const applicableHours = Decimal.min(remainingHours, ruleCap);
    total = total.plus(applicableHours.mul(hourlyWage).mul(d(rule.multiplier)));
    remainingHours = remainingHours.minus(applicableHours);
  }
  ```
- **Kriteria Penerimaan:** Lembur hari kerja 1,5 jam dengan upah per jam Rp30.000 harus menghasilkan: `(1 x 1.5 x 30.000) + (0.5 x 2.0 x 30.000) = Rp45.000 + Rp30.000 = Rp75.000` (bukan Rp45.000).

---

### TEMUAN 3: Karyawan Diterminasi Tetap Memiliki Akses Login Aktif
- **ID Temuan:** `SEC-HR-001`
- **Modul & Fitur:** HR & Platform — *Siklus Hidup Karyawan & Akun Pengguna*
- **Lokasi File:** `src/server/hr/final-pay.ts` (Baris 535–555) & `src/server/actions/hr/karyawan.ts`
- **Kondisi Aktual:**
  Saat `terminateEmployeeAction` atau `processFinalPay` dijalankan dengan `terminateNow: true`, baris di tabel `employees` diubah menjadi `employmentStatus = 'terminated'` dan `isActive = false`. Namun, tidak ada pencarian atau pemutusan akun pada tabel `user` / `member`.
- **Masalah:** Ketiadaan relasi struktural antara `employees.id` dan `user.id`. Akun login eks-karyawan tetap berstatus aktif di Better Auth dan masih dapat login, membuka menu POS kasir, atau melihat data perusahaan.
- **Dampak Bisnis:** Ancaman keamanan serius (*Insider Threat / Unauthorized Access*). Mantan karyawan yang diberhentikan secara tidak baik dapat merusak data atau membocorkan rahasia dagang.
- **Prioritas:** **HIGH (P1)**
- **Rekomendasi Solusi:**
  1. Tambahkan kolom relasi `userId: text("user_id").references(() => user.id)` pada tabel `employees`.
  2. Saat karyawan diterminasi, jika memiliki `userId`, nonaktifkan keanggotaan perusahaan di tabel `member` (`member.role = 'suspended'` atau hapus dari `member`).
- **Kriteria Penerimaan:** Begitu proses *Final Pay / Termination* selesai, sesi login pengguna bersangkutan langsung dicabut dan tidak dapat mengakses endpoint perusahaan lagi.

---

### TEMUAN 4: Penutupan Sesi Kas Mengabaikan Transaksi Gantung (Held Sales)
- **ID Temuan:** `WRK-POS-001`
- **Modul & Fitur:** Point of Sale (POS) — *Penutupan Sesi Kasir (`closeCashSession`)*
- **Lokasi File:** `src/server/pos/sessions.ts` (Baris 100–165)
- **Kondisi Aktual:**
  `closeCashSession` hanya menghitung selisih kas fisik laci terhadap total mutasi kas, lalu langsung mengupdate `status = 'closed'`. Fungsi `countHeldSales` sudah tersedia di baris 341 file yang sama, namun tidak dipanggil di dalam `closeCashSession`.
- **Masalah:** Kasir dapat menutup sesi kasir saat masih terdapat transaksi berstatus `held` (ditahan).
- **Dampak Bisnis:** Antrean pesanan pelanggan yang tertahan menjadi yatim (*orphan held sales*), berisiko terlewatkan tidak diproses atau merusak stok inventaris yang terikat pada keranjang tersebut.
- **Prioritas:** **MEDIUM (P2)**
- **Rekomendasi Solusi:**
  Panggil `countHeldSales` sebelum menutup sesi:
  ```typescript
  const heldCount = await countHeldSales(tx, input.companyId);
  if (heldCount > 0) {
    throw new AppError(
      "CONFLICT",
      `Masih ada ${heldCount} pesanan berstatus ditahan (held). Selesaikan atau batalkan pesanan tersebut sebelum menutup sesi kasir.`,
    );
  }
  ```
- **Kriteria Penerimaan:** Menutup sesi kas dengan pesanan gantung akan menampilkan pesan error validasi yang jelas dan menolak penutupan sesi sampai pesanan diselesaikan/dibatalkan.

---

### TEMUAN 5: Hard-Delete User Menghapus Identitas Audit Trail Transaksi Historis
- **ID Temuan:** `DAT-SET-001`
- **Modul & Fitur:** Pengaturan — *Manajemen Pengguna (`removeCompanyUserAction`)*
- **Lokasi File:** `src/server/actions/users.ts` (Baris 366–373)
- **Kondisi Aktual:**
  ```typescript
  const [remaining] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.userId, targetUserId));
  if ((remaining?.value ?? 0) === 0) {
    await tx.delete(user).where(eq(user.id, targetUserId));
  }
  ```
- **Masalah:** Baris pengguna di-delete secara fisik dari basis data. Seluruh transaksi di masa lalu (jurnal, struk POS, dokumen penerimaan barang, kartu stok) hanya menyimpan string ID di kolom `createdBy`.
- **Dampak Bisnis:** Kegagalan fungsi audit trail dan kepatuhan sistem informasi (CISA/SOX audit failure). Saat auditor memeriksa siapa yang memposting jurnal 6 bulan lalu, sistem hanya menampilkan ID UUID tanpa nama atau email.
- **Prioritas:** **MEDIUM (P2)**
- **Rekomendasi Solusi:**
  Jangan pernah melakukan hard-delete pada tabel `user`. Terapkan penonaktifan (*soft-deactivation*):
  ```typescript
  await tx.update(user).set({ banned: true, banReason: "Akun dinonaktifkan dari perusahaan" }).where(eq(user.id, targetUserId));
  ```
- **Kriteria Penerimaan:** Menghapus user dari perusahaan mencabut aksesnya, namun baris tabel `user` tetap ada sehingga nama pembuat transaksi historis tetap terbaca di seluruh laporan audit.

---

### TEMUAN 6: Kesenjangan Adopsi Komponen Enterprise DataTable
- **ID Temuan:** `UX-DSN-001`
- **Modul & Fitur:** UI/UX Global — *Implementasi Komponen Tabel Seluruh Modul*
- **Lokasi File:** `src/app/app/**/page.tsx` vs `src/components/blocks/data-table/*`
- **Kondisi Aktual:**
  Paket `@tanstack/react-table` dan sub-komponen `DataTable` telah dibangun dengan sangat lengkap di `src/components/blocks/data-table/`, namun lebih dari 90 halaman daftar (Akun, Jurnal, Pembelian, Penerimaan, Pelanggan, Pemasok, Karyawan) masih menggunakan elemen HTML primitif `<table className="data-table">`.
- **Masalah:** Tidak adanya konsistensi antarmuka tabel. Pengguna tidak dapat menyortir kolom secara fleksibel di header, tidak dapat menyembunyikan kolom yang tidak relevan, dan pagination masih menggunakan link server reload biasa tanpa filter faset instan.
- **Dampak Bisnis:** Penurunan produktivitas operator dan akuntan dalam menganalisis data dalam jumlah besar.
- **Prioritas:** **MEDIUM (P2)**
- **Rekomendasi Solusi:**
  Lakukan migrasi bertahap pada halaman-halaman master dan dokumen utama untuk memanfaatkan `DataTable` yang telah disediakan proyek.
- **Kriteria Penerimaan:** Tabel Produk, Pemasok, dan Jurnal mendukung pengurutan kolom interaktif, toggle visibilitas kolom via dropdown, dan filter faset.

---

### TEMUAN 7: Penempatan Pengaturan Stok Negatif di Formulir Perpajakan
- **ID Temuan:** `UX-SET-001`
- **Modul & Fitur:** Pengaturan — *Struktur Menu dan Pengelompokan Kebijakan*
- **Lokasi File:** `src/components/pengaturan/forms/identitas-pajak.tsx` (Baris 350)
- **Kondisi Aktual:**
  Opsi `allowNegativeStock` ("Izinkan stok gudang bernilai negatif") ditempatkan di dalam formulir *Identitas Perusahaan & Pajak*, berdampingan dengan NPWP, tarif PPN, dan mode pembulatan.
- **Masalah:** Salah penempatan konteks bisnis (*misplaced domain context*). Manajer gudang atau operasional tidak mengira bahwa pengaturan mutasi stok berada di tab pajak.
- **Dampak Bisnis:** Kebingungan operator dan friksi navigasi saat mengonfigurasi sistem minimarket baru.
- **Prioritas:** **LOW (P3)**
- **Rekomendasi Solusi:**
  Pindahkan input `allowNegativeStock` ke tab **Gudang & Cabang** atau buatkan bagian khusus **Kebijakan Operasi Gudang** di bawah menu Pengaturan Gudang.
- **Kriteria Penerimaan:** Konfigurasi stok negatif dapat diakses langsung dari area pengaturan gudang.

---

## 9. REFERENSI RISET EKSTERNAL & STANDAR INDUSTRI

Temuan audit ini diverifikasi dan disandarkan pada tolok ukur resmi:

1. **Peraturan Pemerintah No. 35 Tahun 2021 (Ketenagakerjaan RI)**:
   - *Pasal 31 & 32*: Upah sejam dihitung 1/173 upah sebulan. Jam pertama lembur hari kerja dibayar 1,5x upah sejam, jam berikutnya 2x upah sejam. Jam pecahan wajib dihitung proporsional terhadap pengali jam bersangkutan.
   - *Rujukan*: [MMP Law - Ketentuan Upah Lembur di Indonesia](https://mmp.law/bagaimana-ketentuan-upah-lembur-di-indonesia/).

2. **Peraturan Menteri Keuangan (PMK) No. 168 Tahun 2023**:
   - Ketentuan pemotongan Pajak Penghasilan Pasal 21 menggunakan skema Tarif Efektif Rata-Rata (TER Kategori A, B, C) untuk masa pajak bulanan Januari–November dan rekonsiliasi Pasal 17 pada masa pajak Desember.

3. **Odoo ERP Best Practice — Inventory Valuation & Accounting**:
   - Perpetual inventory method: setiap pergerakan stok barang otomatis membentuk jurnal persediaan berpasangan dengan HPP atau akrual penerimaan barang.
   - *Rujukan*: [Odoo Accounting Documentation - Inventory Valuation](https://www.odoo.com/documentation/20.0/applications/finance/accounting/get_started/inventory_valuation.html).

4. **Accurate Online — Alur Retur Pembelian & Dokumen Asal**:
   - Retur pembelian wajib bertaut pada nomor faktur/penerimaan asal, membatasi kuantiti maksimal retur, dan mendokumentasikan pemotongan utang secara tertelusur.
   - *Rujukan*: [Accurate Online - Penjelasan dan Fungsi Retur Pembelian](https://help.accurate.id/product/accurate-online/fitur-aol/pembelian/retur-pembelian/penjelasan-dan-fungsi-retur-pembelian/).

5. **SAP Fiori Design Guidelines — Data Density & Enterprise Forms**:
   - Prinsip hierarki form: field dikelompokkan logis per konteks tugas (bukan menumpuk setting gudang di form pajak). Input angka moneter wajib memiliki pemisah ribuan otomatis dengan perataan kanan (*right-aligned*).
   - *Rujukan*: [SAP Fiori Design Guidelines](https://experience.sap.com/fiori-design-web/).

6. **OWASP DevSecOps & Authentication Cheat Sheet**:
   - *Audit Trail Immutability*: Akun pengguna tidak boleh di-hard delete dari basis data relasional jika memiliki riwayat transaksi berharga hukum.
   - *Distributed Rate Limiting*: Pertahanan serangan brute-force harus menggunakan shared state storage (Database/Redis) agar kebal pada lingkungan multi-instance.
   - *Rujukan*: [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

---

## 10. RENCANA PERBAIKAN & KRITERIA PENERIMAAN

### Tahap 1: Perbaikan Cepat (Quick Wins - Logika & Keamanan Kritis)
1. **Perbaikan Filter Tanggal Payroll (`BUG-HR-001`)**:
   - Ubah klausa `where` pada `runPayrollAction` untuk memastikan karyawan yang bergabung setelah akhir periode tidak dihitung.
2. **Kalkulasi Desimal Lembur (`BUG-HR-002`)**:
   - Ganti perulangan integer di `computeOvertimePay` dengan kalkulasi desimal berbasis batas tier.
3. **Pencegahan Sesi Kas Ditutup dengan Pesanan Gantung (`WRK-POS-001`)**:
   - Panggil `countHeldSales` di dalam `closeCashSession` dan tolak penutupan sesi jika nilainya > 0.

### Tahap 2: Penguatan Arsitektur & Relasi Data
1. **Penonaktifan Akun User Eks-Karyawan (`SEC-HR-001`)**:
   - Tambahkan relasi `userId` pada karyawan dan nonaktifkan sesi saat terminasi dilakukan.
2. **Pencegahan Hard-Delete User (`DAT-SET-001`)**:
   - Ganti `tx.delete(user)` dengan flag `banned: true` untuk menjaga keutuhan jejak audit trail.

### Tahap 3: Penyempurnaan Antarmuka (UI/UX)
1. **Adopsi TanStack Table (`UX-DSN-001`)**:
   - Migrasikan tabel utama master data (Produk, Pemasok, Akun) ke komponen `DataTable`.
2. **Relokasi Form Stok Negatif (`UX-SET-001`)**:
   - Pindahkan checkbox stok negatif dari form pajak ke form operasi gudang.

---

## 11. BATASAN AUDIT & AREA BELUM TERVERIFIKASI

1. **Perangkat Keras Kasir Fisik**:
   - Pengujian integrasi pemotong kertas (*auto-cutter*) printer thermal ESC/POS 58mm/80mm, cash drawer RJ-11 otomatis, dan scanner barcode fisik serial/USB belum diuji pada perangkat keras nyata (diuji sebatas emulasi event keyboard dan pratinjau canvas).
2. **Paket Desktop Native (Tauri)**:
   - Backend Rust (`src-tauri/src/posdb.rs`) dan bundle build installer (`AppImage`/`RPM`) telah terkompilasi, namun pengujian konkurensi SQLite lokal pada sistem operasi offline riil memerlukan hardware terminal kasir langsung.
3. **Skala Ekstrem 10.000+ Baris Produk Sekaligus**:
   - Rute impor Excel telah dilengkapi validasi streaming, namun uji beban pemrosesan *bulk commit* 10.000 produk secara konkuren pada serverless HTTP tanpa background worker queue perlu diuji pada staging terisolasi.

---
*Laporan ini disusun secara obyektif berdasarkan inspeksi menyeluruh kode aktual pada commit `21d4505`, tanpa melakukan perubahan pada repositori produksi.*
