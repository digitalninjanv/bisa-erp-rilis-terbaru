# 05. Laporan Audit UI/UX Global & Design System

Dokumen ini memuat hasil evaluasi komprehensif (Fase 4) terhadap konsistensi desain, arsitektur navigasi, pola CRUD, terminologi bahasa, dan kepadatan visual (*information density*) di seluruh modul **bisa-erp**.

---

## 1. Evaluasi Design System & Konsistensi Visual

### A. Inkonsistensi Pola Form & Aksi CRUD
Ditemukan 3 paradigma UI yang saling bertabrakan saat pengguna melakukan aksi Tambah (*Create*) atau Ubah (*Edit*):
1. **Modal / Dialog**: Dipakai di Akuntansi Bagan Akun (`akun`), Pengaturan Pengguna (`pengguna`), dan POS Penahanan Nota (`ditahan`).
2. **Slide-over Sheet (Drawer Samping)**: Dipakai di Gudang Pemasok & Pelanggan (`pemasok`), Kategori Produk (`taksonomi`).
3. **Dedicated Full Page (Halaman Mandiri)**: Dipakai di Akuntansi Jurnal Baru (`/jurnal/baru`), Gudang Produk Edit (`/produk/[id]`), HR Karyawan Edit (`/karyawan/[id]`).

> [!WARNING]
> Pengguna tidak memiliki ekspektasi yang jelas apakah tombol "Tambah" akan membuka pop-up cepat, panel samping, atau memindahkan mereka ke halaman baru yang menghilangkan konteks daftar data sebelumnya.

### B. Variasi Token Aksen Modul
Sistem menerapkan warna aksen berbeda untuk setiap modul:
- **POS**: Teal / Hijau (`#0e9384`)
- **Gudang**: Amber / Emas (`#c28b36`)
- **Akuntansi**: Ungu / Plum (`#714b67`)
- **HR**: Biru Klasik (`#3b6ea5`)
- **Analisa**: Cyan Gelap (`#0e7490`)
- **Pengaturan**: Slate Netral (`#475569`)

*Penilaian*: Pewarnaan per modul efektif memberikan identitas visual konteks kerja (*contextual cue*). Namun, warna tombol aksi primer (`button variant="default"`) di beberapa halaman menimpa warna aksen dengan warna global `--primary`, menciptakan benturan kontras di mana tombol simpan berwarna hitam pekat di tengah header bertema teal atau plum.

---

## 2. Navigasi, Hierarki & Breadcrumbs

### A. Inkonsistensi Header & Navigasi Kembali (*Back Navigation*)
1. **Keberadaan Breadcrumbs**:
   - Sebagian halaman menggunakan komponen `PageHeader` dengan `eyebrow` teks (misal: `Gudang > Produk`).
   - Halaman detail transaksi seperti `/app/gudang/dokumen/[id]` dan `/app/pos/nota/[id]` tidak memiliki breadcrumbs maupun tombol kembali eksplisit. Pengguna terpaksa mengandalkan tombol browser *Back*, yang berisiko mereset state pencarian tabel sebelumnya.
2. **Navigasi Cangkang Pengaturan yang Terbelah**:
   - Menu Pengaturan membagi 12 konfigurasinya menjadi dua kelas: 9 item berbasis query string (`/app/pengaturan?tab=...`) dan 3 item berbasis sub-folder fisik (`/app/pengaturan/pengguna`, `/app/pengaturan/payroll-indonesia`, `/app/pengaturan/status`).
   - Hal ini merusak kesinambungan navigasi tab dan membuat browser history terpecah.

---

## 3. Standardisasi Bahasa, Label & Terminologi (Glosarium ERP)

Ditemukan percampuran bahasa (Inggris vs Indonesia) dan istilah sinonim yang inkonsisten antar modul:

| Konsep Bisnis | Istilah di Modul A | Istilah di Modul B | Standar Rekomendasi (Konsisten) | Alasan Perbaikan |
| :--- | :--- | :--- | :--- | :--- |
| **Pihak Pemasok** | "Pemasok" (Gudang Sidebar) | "Supplier" (Field Form PO & Dialog) | **Pemasok** | Gunakan bahasa Indonesia baku di seluruh label UI. |
| **Pihak Pembeli** | "Pelanggan" (Gudang Pihak) | "Customer" (Form POS & Quick Add) | **Pelanggan** | Hindari istilah asing yang bercampur di meja kasir. |
| **Pembatalan Dokumen**| "Void" (POS & Kasir) | "Batalkan" (Penerimaan Gudang) | **Void (Kasir) / Dibatalkan (Gudang)** | Bedakan jelas antara void kasir instan dan pembatalan surat jalan berdokumen. |
| **Koreksi Jurnal** | "Balik Jurnal" (Jurnal) | "Reversal" (Dokumen Teknis) | **Jurnal Pembalik (Reversal)** | Istilah standar PSAK akuntansi Indonesia. |
| **Pengadaan Barang** | "Purchase Request" (Gudang URL) | "Permintaan Pembelian" (Sidebar) | **Permintaan Pembelian (PR)** | Seragamkan label tombol aksi dengan label menu sidebar. |
| **Pinjaman Jangka Pendek**| "Kasbon" (HR Sidebar) | "Employee Advance" (Server Actions) | **Kasbon Karyawan** | Istilah kasbon paling dipahami pegawai operasional. |

---

## 4. Kepadatan Data & Ergonomi Antarmuka Kasir (*Information Density*)

### A. Ergonomi Resolusi Rendah di Meja Kasir (1024x768 & 1366x768)
Banyak minimarket di Indonesia menggunakan monitor layar sentuh 15 inci rasio 4:3 (resolusi 1024x768) atau monitor hemat daya 1366x768:
- Pada resolusi 1024x768, antarmuka POS (`pos-terminal.tsx`) mengalami penyempitan horizontal pada kolom keranjang belanja: nama barang panjang terpotong drastis, tombol +/- kuantiti berdekatan sehingga memicu salah tekan (*fat-finger error* pada touchscreen).
- Form Jurnal Umum: Baris debit dan kredit berdesakan bila nama akun COA panjang (misal: "Beban Operasional - Pemeliharaan Gedung & Toko Cabang A"), menyebabkan input nominal tergeser keluar area pandang horizontal (*horizontal overflow*).

### B. Hierarchy & Focus States
- Kotak pencarian produk di kasir (`pos-terminal.tsx`) tidak selalu mempertahankan *auto-focus* setelah item ditambahkan ke keranjang belanja. Kasir harus mengklik kembali kotak cari sebelum dapat mengetik SKU berikutnya, menambah 1 klik ekstra pada setiap barang belanjaan.
