# Laporan Audit Modul: Laporan, Cetak & Analisa Bisnis (Reports & Analytics)

- **Kode Modul**: `laporan-analisa`
- **Prefix Temuan**: `REP-*`
- **Lingkup**: Laporan Keuangan (Neraca Saldo, Laba Rugi, Neraca, Arus Kas, Perubahan Ekuitas), Laporan Sub-ledger (Buku Besar, Aging Piutang/Utang, Rekap PPN), Laporan Valuasi Persediaan, Dashboard Analisa Bisnis (`/app/analisa`), Mesin Cetak Dokumen (`PrintShell`), dan Ekspor Data Spreadsheet (CSV & XLSX).

---

## 1. Ikhtisar & Skor Modul

| Dimensi Audit | Skor (1-5) | Catatan Ringkas |
| :--- | :---: | :--- |
| **Fungsi (Happy & Error Path)** | 4.0 | Laporan keuangan seimbang (Neraca = Aktiva = Pasiva + Ekuitas); ekspor spreadsheet menggunakan engine domain tunggal. |
| **Tampilan Visual (UI)** | 3.5 | Komponen `indicator-card` pada analisa bersih; tabel laporan keuangan memiliki indentasi hierarki yang baik; layout cetak formal. |
| **Pengalaman Pengguna (UX)** | 2.5 | Navigasi sidebar Analisa memakai 4 anchor hash (`#kesehatan`, `#kinerja`, `#risiko`) pada 1 halaman monolitik yang mereset scroll saat filter tanggal diubah; ketiadaan streaming Suspense membuat muat awal lambat. |
| **Workflow & State Machine** | 4.0 | Penentuan periode fiskal dan penguncian tahun buku (*year-end close*) tercermin langsung pada Laba Ditahan. |
| **Integritas Data & Atomisitas**| 4.5 | Ekspor CSV dilindungi dari serangan *Formula Injection*; data laporan bersumber langsung dari jurnal posted dan dokumen stok. |
| **Laporan & Akurasi Angka** | 4.0 | Menggunakan `Decimal.js` untuk akumulasi saldo; batas toleransi seimbang `< 0.01` Rupiah. |
| **Performa & Query** | 2.5 | Halaman `/app/analisa` memuat 6 agregasi besar sekaligus secara sinkron tanpa paginasi parsial; query laporan bertanggal lama memindai seluruh `journal_entries`. |
| **Hak Akses & Keamanan** | 4.0 | Terlindungi oleh izin `analytics.view` dan `accounting.view`. |

---

## 2. Rincian Temuan Audit

### REP-001: Fragmentasi Hash Navigasi Analisa Mereset Posisi Layar (*Scroll Reset on Filter*)
- **Severity**: **Sedang**
- **Kategori**: UI/UX & Routing
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari inspeksi UI & URL)
- **Bukti Kode**:
  - `src/lib/modules.ts:196-201`
  - `src/app/app/analisa/page.tsx:65-105`
- **Deskripsi Masalah**:
  Di sidebar modul Analisa, terdapat 4 item menu:
  - `Ringkasan`: `/app/analisa`
  - `Kesehatan bisnis`: `/app/analisa#kesehatan`
  - `Penggerak kinerja`: `/app/analisa#kinerja`
  - `Pengendalian risiko`: `/app/analisa#risiko`
  Keempat item ini menunjuk ke satu halaman monolitik berukuran 562 baris kode. Ketika pengguna berada di section `#kinerja` atau `#risiko` lalu mengklik tombol filter tanggal (misal beralih dari "30 hari" ke "Bulan ini"), halaman melakukan server-side reload utuh dan posisi scroll browser terlempar kembali ke bagian paling atas halaman.
- **Dampak Bisnis**:
  Pengguna merasa frustrasi karena harus scroll ulang ke bawah setiap kali menganalisa indikator risiko atau produk pareto di periode waktu berbeda.
- **Rekomendasi Perbaikan**:
  Pisahkan section analisa menjadi tab terpisah atau sub-rute independen (`/app/analisa/kesehatan`, `/app/analisa/kinerja`, `/app/analisa/risiko`) atau pertahankan parameter scroll menggunakan client-side tab state.
- **Estimasi Effort**: **S (Small)**

---

### REP-002: Beban Query Agregat Serentak pada Halaman Analisa (*Heavy Monolithic Query Loading*)
- **Severity**: **Sedang**
- **Kategori**: Performa & Efisiensi Database
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `analytics.ts`)
- **Bukti Kode**:
  - `src/server/analytics.ts:80-140` (`getBusinessAnalytics`)
  - `src/app/app/analisa/page.tsx:96-98`
- **Deskripsi Masalah**:
  Fungsi `getBusinessAnalytics` memanggil secara bersamaan: `getSalesSummary`, `getIncomeStatement`, `getCashFlow`, `getInventoryValuation`, kalkulasi Pareto ABC/FSN seluruh produk, deteksi dead stock, dan aging piutang. Seluruh data ini dieksekusi secara serial/blocking sebelum HTML halaman dikirim ke browser (tanpa React Suspense streaming).
- **Dampak Bisnis**:
  Waktu respon halaman Analisa (*Time to First Byte / TTFB*) melambat signifikan seiring bertambahnya volume transaksi (bisa mencapai > 3-5 detik), menurunkan responsivitas aplikasi.
- **Rekomendasi Perbaikan**:
  Bungkus masing-masing kartu metrik dengan `<Suspense fallback={<CardSkeleton />}>` dan pecah pemanggilan server data menjadi komponen-komponen mandiri yang dapat dimuat secara paralel dan progresif.
- **Estimasi Effort**: **M (Medium)**

---

### REP-003: Kerentanan Margin Driver Printer Thermal Fisik pada Cetak Web
- **Severity**: **Sedang**
- **Kategori**: Desain Cetak & Kompatibilitas Hardware
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari CSS print-shell)
- **Bukti Kode**:
  - `src/components/print/print-shell.tsx:68-80`
  - `src/app/globals.css`
- **Deskripsi Masalah**:
  Meskipun `PrintShell` telah mengatur `width: 58mm` atau `80mm`, cetak struk kasir melalui browser (`window.print()`) sangat rentan terhadap margin bawaan driver printer Windows/Linux (bawaan browser sering menambahkan margin 10mm jika pengguna tidak memilih opsi "Margins: None"). Margin tambahan ini menyebabkan teks struk 58mm (yang lebarnya hanya 32 karakter) terpotong di tepi kanan atau turun ke baris baru (*word-wrap* berantakan).
- **Dampak Bisnis**:
  Struk belanja pelanggan terpotong sebagian angkanya, memicu komplain kasir dan ketidakpercayaan pembeli minimarket.
- **Rekomendasi Perbaikan**:
  Tambahkan aturan CSS `@media print` agresif pada level dokumen cetak struk:
  ```css
  @media print {
    @page {
      margin: 0 !important;
      size: auto;
    }
    body {
      margin: 0 !important;
      padding: 0 !important;
    }
  }
  ```
- **Estimasi Effort**: **S (Small)**

---

### REP-004: SheetJS Community Edition Tidak Membawa Styling & Freeze Panes pada Ekspor XLSX
- **Severity**: **Rendah**
- **Kategori**: UX Pelaporan & Format Dokumen
- **Tingkat Keyakinan**: **Tinggi** (Dicatat jujur di `export-table.ts`)
- **Bukti Kode**:
  - `src/server/reports/export-table.ts:16-22`
- **Deskripsi Masalah**:
  Pustaka `xlsx` versi Community Edition yang digunakan untuk mengekspor laporan keuangan ke format Excel `.xlsx` tidak mendukung penulisan styling (bold header, garis bawah total, warna latar) dan freeze panes (pembekuan baris judul saat di-scroll).
- **Dampak Bisnis**:
  File Excel hasil ekspor tampak polos (*plain*) dan akuntan harus memformat ulang (menebalkan baris total dan membekukan header) sebelum menyerahkannya kepada pemilik bisnis atau auditor eksternal.
- **Rekomendasi Perbaikan**:
  Pertimbangkan penggunaan pustaka alternatif open-source seperti `exceljs` yang mendukung full formatting (bold, cell borders, freeze panes, dan auto-filter) tanpa biaya lisensi.
- **Estimasi Effort**: **M (Medium)**
