# Laporan Audit Modul: Gudang & Pembelian (Inventory & Purchasing)

- **Kode Modul**: `gudang`
- **Prefix Temuan**: `GDG-*`
- **Lingkup**: Master Produk, Multi-satuan & Konversi, Penerimaan Barang (GRN), Penyesuaian Stok, Transfer Antargudang, Stok Opname & Lembar Hitung, Kartu Stok, Reservasi Stok, Nilai Persediaan (AVCO), Permintaan Pembelian (PR), Pesanan Pembelian (PO), Uang Muka Pembelian, Retur Pembelian, Rekomendasi Pengadaan, Master Pemasok & Pelanggan, dan Impor Spreadsheet.

---

## 1. Ikhtisar & Skor Modul

| Dimensi Audit | Skor (1-5) | Catatan Ringkas |
| :--- | :---: | :--- |
| **Fungsi (Happy & Error Path)** | 3.5 | Alur logistik lengkap, namun terdapat celah penerimaan barang melebihi PO (*over-receipt unconstrained*) dan pembatasan izin keliru pada master pelanggan. |
| **Tampilan Visual (UI)** | 3.0 | Tabel pergerakan stok dan opname sangat informatif; modal konversi satuan agak sempit; button deduplikasi tidak muncul di UI. |
| **Pengalaman Pengguna (UX)** | 2.5 | Master pelanggan disatukan di menu gudang; fitur merge duplikat tersembunyi tanpa tautan; form penerimaan barang membutuhkan input nomor surat jalan manual yang rentan typo. |
| **Workflow & State Machine** | 4.0 | Alur PR → PO → Penerimaan → Retur jelas; pemisahan tugas (*segregation of duties*) pada approval penyesuaian stok berjalan baik. |
| **Integritas Data & Atomisitas**| 4.0 | Pergerakan stok terhubung erat ke jurnal GL; batch FEFO dan pelacakan expired date berjalan atomik. |
| **Laporan & Akurasi Angka** | 4.0 | Perhitungan Moving Average (AVCO) konsisten; kartu stok merekam saldo sebelum dan sesudah secara kronologis. |
| **Performa & Query** | 3.5 | Pencarian produk via barcode cepat; paginasi diterapkan pada kartu stok. |
| **Hak Akses & Keamanan** | 2.5 | Izin `pos.sell` salah sasaran dipakai untuk mengunci penyimpanan master pelanggan di modul Gudang (`pihak.ts`). |

---

## 2. Rincian Temuan Audit

### GDG-001: Kontrol Izin Akses Keliru pada Master Pelanggan Gudang (`pos.sell` vs `inventory.manage`)
- **Severity**: **Tinggi**
- **Kategori**: Hak Akses & Integritas Domain
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode)
- **Bukti Kode**:
  - `src/server/actions/inventory/pihak.ts:137, 218, 238`
- **Deskripsi Masalah**:
  Pada modul Gudang di halaman Pemasok & Pelanggan (`/app/gudang/pemasok`), server actions untuk pelanggan:
  - `saveCustomerAction`: `requirePermissionInModule("pos.sell", "gudang")`
  - `toggleCustomerAction`: `requirePermissionInModule("pos.sell", "gudang")`
  - `deleteCustomerAction`: `requirePermissionInModule("pos.sell", "gudang")`
  Menuntut permission key **`pos.sell`** (yang dialokasikan untuk kasir), padahal modul yang diperiksa adalah **`gudang`**. Kepala gudang / admin logistik yang hanya memiliki izin `inventory.manage` akan ditolak dengan error `FORBIDDEN` saat mencoba menambah atau memperbarui batas kredit pelanggan dari menu gudang.
- **Dampak Bisnis**:
  Staf gudang tidak bisa mengelola kontak pelanggan institusi/grosir; tim operasional terpaksa meminta akun kasir atau akun owner hanya untuk mengisi data alamat pengiriman pelanggan.
- **Rekomendasi Perbaikan**:
  Ubah otorisasi di `pihak.ts` menjadi:
  `requirePermissionInModule("inventory.manage", "gudang")` atau buat permission terpadu `contacts.manage`.
- **Estimasi Effort**: **S (Small)**

---

### GDG-002: Ketiadaan Kontrol Kelebihan Penerimaan Barang (*Unrestricted Over-Receipt*)
- **Severity**: **Tinggi**
- **Kategori**: Logika Bisnis & Pengendalian Internal
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `purchasing.ts`)
- **Bukti Kode**:
  - `src/server/purchasing.ts:60-95` (`deriveFulfilmentStatus`)
  - `src/server/inventory/receipts.ts:450-480`
- **Deskripsi Masalah**:
  Saat petugas gudang menerima barang bertaut PO (`receiveStockAction`), sistem menghitung kuantiti terima dan mengupdate baris PO:
  ```typescript
  const receivedQty = d(orderLine.receivedQty).plus(receivedDelta);
  ```
  Sistem **tidak memvalidasi** apakah `receivedQty > orderLine.qty`. Petugas gudang dapat memasukkan kuantiti penerimaan sebesar apapun (misal PO 100 pcs, diinput terima 200 pcs). Sistem akan langsung menerima 200 pcs ke stok fisik dan otomatis membentuk tagihan hutang dagang (AP) sebesar 200 pcs ke jurnal akuntansi tanpa meminta konfirmasi revisi PO atau otorisasi manajer pembelian.
- **Dampak Bisnis**:
  Kebocoran anggaran pengadaan; pemasok dapat mengirimkan kelebihan stok (*dumping goods*) yang tidak disetujui perusahaan, dan sistem langsung mengakuinya sebagai hutang resmi yang harus dibayar.
- **Rekomendasi Perbaikan**:
  1. Terapkan ambang batas toleransi kelebihan terima (default: 0%, atau maks 5% untuk barang curah/timbangan).
  2. Jika penerimaan melebihi PO di luar batas toleransi, tolak transaksi atau alihkan ke alur persetujuan *Over-Receipt Approval* oleh Purchasing Manager.
- **Estimasi Effort**: **M (Medium)**

---

### GDG-003: Fitur Deteksi & Penggabungan Duplikat Kontak Menjadi Rute Tersembunyi (*Hidden Feature*)
- **Severity**: **Sedang**
- **Kategori**: UI/UX & Visibilitas Fitur
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari inspeksi komponen & navigasi)
- **Bukti Kode**:
  - `src/app/app/gudang/pemasok/duplikat/page.tsx`
  - `src/components/gudang/party-merge-panel.tsx`
  - `src/lib/modules.ts:145`
- **Deskripsi Masalah**:
  Tersedia halaman canggih `/app/gudang/pemasok/duplikat` yang mampu mendeteksi duplikasi pemasok/pelanggan berdasarkan algoritma trigram kemiripan nama, kesamaan nomor telepon, dan NPWP, lengkap dengan dialog penggabungan saldo (*merge*). Namun, halaman ini **sama sekali tidak memiliki tautan**, tombol aksi, maupun indikator badge di halaman utama Pemasok (`/app/gudang/pemasok`) maupun sidebar.
- **Dampak Bisnis**:
  Pengguna mengeluhkan data pemasok/pelanggan ganda dan kotor, padahal modul solusi pembersih data sudah selesai dibuat namun tidak dapat diakses oleh user biasa.
- **Rekomendasi Perbaikan**:
  Tambahkan tombol aksi di header `/app/gudang/pemasok`: *"Cek Duplikat Kontak"* dengan ikon peringatan bila terdeteksi kandidat pasangan pihak yang mirip.
- **Estimasi Effort**: **S (Small)**

---

### GDG-004: Penempatan Master Pelanggan di Bawah Menu Gudang Menciptakan Kebingungan Domain
- **Severity**: **Sedang**
- **Kategori**: Arsitektur Informasi & UX
- **Tingkat Keyakinan**: **Tinggi**
- **Bukti Kode**:
  - `src/app/app/gudang/pelanggan/[id]/page.tsx`
  - `src/lib/modules.ts:145` (`{ label: "Pemasok & pelanggan", href: "/app/gudang/pemasok", ... }`)
- **Deskripsi Masalah**:
  Entitas Pelanggan (Customer) dikelompokkan di dalam modul Gudang (`/app/gudang/pemasok` & `/app/gudang/pelanggan/[id]`). Bagi operator kasir POS dan staf penjualan, gudang adalah area logistik barang fisik. Menempatkan pelanggan di dalam gudang menyalahi kebiasaan operasional retail/minimarket di mana Pelanggan adalah entitas Penjualan/CRM.
- **Dampak Bisnis**:
  Operator toko kesulitan menemukan tempat mengedit profil pelanggan member, batas piutang tempo, atau alamat penagihan pelanggan.
- **Rekomendasi Perbaikan**:
  Sediakan akses langsung ke Master Pelanggan dari modul POS atau sediakan section "Kontak & Mitra Bisnis" bersama yang dapat diakses dari modul Penjualan/POS maupun Gudang.
- **Estimasi Effort**: **M (Medium)**

---

### GDG-005: Viewer Dokumen Generik (`/app/gudang/dokumen/[id]`) Tanpa Tautan Breadcrumb Kembali yang Jelas
- **Severity**: **Rendah**
- **Kategori**: UX & Navigasi
- **Tingkat Keyakinan**: **Tinggi**
- **Bukti Kode**:
  - `src/app/app/gudang/dokumen/[id]/page.tsx`
- **Deskripsi Masalah**:
  Halaman dokumen pergerakan stok terpadu dapat dibuka via direct link dari log mutasi, namun tidak menyediakan tombol kembali (*back navigation*) yang adaptif berdasarkan jenis dokumen sumbernya (misal kembali ke Penerimaan, Transfer, atau Opname).
- **Dampak Bisnis**:
  Pengguna merasa "tersesat" saat memeriksa riwayat mutasi stok.
- **Rekomendasi Perbaikan**:
  Tambahkan tombol kembali kontekstual dan breadcrumbs dinamis yang menunjuk ke modul asal dokumen.
- **Estimasi Effort**: **S (Small)**
