# Laporan Audit Modul: Pengaturan & Master Data Sistem (Settings)

- **Kode Modul**: `pengaturan`
- **Prefix Temuan**: `SET-*`
- **Lingkup**: Profil perusahaan, identitas pajak, hak akses & peran (RBAC), konfigurasi cetak, penomoran dokumen, metode pembayaran, kelompok harga, gudang & cabang, pemetaan akun sistem, saklar modul perusahaan, kolom kustom, dan status sistem.

---

## 1. Ikhtisar & Skor Modul

| Dimensi Audit | Skor (1-5) | Catatan Ringkas |
| :--- | :---: | :--- |
| **Fungsi (Happy & Error Path)** | 3.5 | Berjalan baik untuk CRUD dasar, tetapi terdapat kegagalan penanganan relasi foreign key dan validasi dependensi transaksi. |
| **Tampilan Visual (UI)** | 3.0 | Desain form padat, tab navigasi query string tercampur dengan rute halaman terpisah, kontras tombol dan alignment checkbox tidak konsisten. |
| **Pengalaman Pengguna (UX)** | 2.5 | Letak konfigurasi penting salah tempat (misal: `allowNegativeStock` di Profil & Pajak, bukan di Gudang), feedback error generik bila foreign key tertabrak. |
| **Workflow & State Machine** | 4.0 | Alur penyimpanan modul dan proteksi gudang utama/role owner terlindungi dengan baik. |
| **Integritas Data & Atomisitas**| 2.5 | Hard-delete pengguna menghapus record user dan membiarkan string `created_by` menjadi orphan; penghapusan gudang menabrak FK `stock_movements`. |
| **Laporan & Visibilitas** | 3.0 | Status sistem hanya menampilkan metrik teknis tanpa health status integritas relasi antar-tabel. |
| **Performa & Query** | 4.0 | Caching session dan revalidation path berjalan efisien. |
| **Hak Akses & Keamanan** | 3.5 | RBAC terlindungi di server actions, namun pemisahan antara `users` dan `employees` rentan membuat eks-karyawan tetap memiliki akses. |

---

## 2. Rincian Temuan Audit

### SET-001: Penghapusan Gudang Berriwayat Menghasilkan Internal Error 500 (Foreign Key Violation)
- **Severity**: **Tinggi**
- **Kategori**: Integritas Data / Jalur Error
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari schema & logic)
- **Bukti Kode**:
  - `src/server/actions/settings/lokasi.ts:65-95`
  - `src/db/schema/inventory.ts:77` (`stockMovements.warehouseId.references(() => warehouses.id)`)
- **Deskripsi Masalah**:
  Fungsi `deleteWarehouseAction` hanya mengecek apakah saldo saat ini `stockOnHand.qty <> 0`. Apabila gudang saat ini bersaldo 0 tetapi pernah memiliki mutasi di masa lalu, query `delete from warehouses` akan langsung menabrak foreign key constraint Postgres pada tabel `stock_movements`. Sistem tidak menangkap error ini secara spesifik, sehingga pengguna disuguhi modal error generik *"Terjadi kesalahan pada server"*.
- **Dampak Bisnis**:
  Admin kebingungan mengapa gudang kosong tidak bisa dihapus dan menganggap aplikasi rusak. Integritas audit mutasi historis terancam bila tabel tidak diproteksi dengan soft-delete.
- **Rekomendasi Perbaikan**:
  1. Tambahkan pengecekan `stockMovements` dan `sales`: jika sudah pernah ada transaksi, **gudang tidak boleh dihapus fisik** (`delete`), melainkan wajib **dinonaktifkan** (`isActive = false`).
  2. Berikan pesan validasi human-readable: *"Gudang ini memiliki riwayat transaksi mutasi stok. Anda hanya dapat menonaktifkannya."*
- **Estimasi Effort**: **S (Small)**

---

### SET-002: Hard-Delete User Menghancurkan Jejak Audit (*Orphan Creator References*)
- **Severity**: **Tinggi**
- **Kategori**: Integritas Data & Kepatuhan Audit
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode)
- **Bukti Kode**:
  - `src/server/actions/users.ts:88-105`
  - `src/db/schema/accounting.ts:45, 110` (`createdBy: text("created_by")`)
  - `src/db/schema/sales.ts:25` (`userId: text("user_id").notNull()`)
- **Deskripsi Masalah**:
  Pada `removeCompanyUserAction`, jika pengguna tidak lagi menjadi anggota di perusahaan manapun (`remaining.value === 0`), sistem mengeksekusi `await tx.delete(user).where(eq(user.id, targetUserId))`. Karena kolom `created_by` dan `user_id` di tabel penjualan, jurnal akuntansi, dan audit log tidak memakai foreign key cascade, baris transaksi masa lalu tetap ada tetapi menunjuk ke `user.id` yang sudah terhapus fisik dari database.
- **Dampak Bisnis**:
  Pelanggaran standar audit sistem informasi (*audit trail preservation*). Laporan jurnal dan nota penjualan tidak lagi dapat menampilkan nama pembuat/kasir asli karena record user telah musnah.
- **Rekomendasi Perbaikan**:
  Ganti mekanisme penghapusan pengguna dengan status nonaktif (*soft deactivate* / `isBanned = true` atau `deletedAt = now()`). Larang hard-delete akun yang telah memiliki jejak transaksi.
- **Estimasi Effort**: **M (Medium)**

---

### SET-003: Kesalahan Penempatan Konfigurasi Kritis Stok Negatif (*Mental Model Mismatch*)
- **Severity**: **Sedang**
- **Kategori**: UX / Arsitektur Informasi
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari inspeksi UI)
- **Bukti Kode**:
  - `src/components/pengaturan/forms/identitas-pajak.tsx:346`
  - `src/app/app/pengaturan/page.tsx:124`
- **Deskripsi Masalah**:
  Pengaturan `allowNegativeStock` (Izinkan Stok Negatif) diletakkan di tab **"Identitas & Pajak"** (`?tab=umum`), bersatu dengan nama legal perusahaan, NPWP, dan tarif PPN. Padahal secara domain bisnis dan ekspektasi operator, kontrol stok adalah tanggung jawab kepala gudang / logistik yang mencari pengaturan tersebut di tab **"Gudang & Cabang"** (`?tab=lokasi`) atau tab operasional.
- **Dampak Bisnis**:
  Manajer operasional kesulitan menemukan cara mengaktifkan/menonaktifkan penjualan saat stok fisik ada namun belum di-input di sistem, memperlambat proses adaptasi minimarket.
- **Rekomendasi Perbaikan**:
  Pindahkan field `allowNegativeStock` ke tab **"Gudang & Cabang"** atau sub-bagian **"Operasi Gudang"**, berikan tooltip penjelasan risiko akuntansi jika stok negatif diizinkan.
- **Estimasi Effort**: **S (Small)**

---

### SET-004: Potensi Hard-Crash Kasir POS Akibat Unmapped `bank_fee` pada Metode Bayar
- **Severity**: **Kritis**
- **Kategori**: Lintas Modul / Validasi Form
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode server POS)
- **Bukti Kode**:
  - `src/server/actions/settings/pembayaran.ts:35-80`
  - `src/server/pos/sales-persist.ts:299-304`
- **Deskripsi Masalah**:
  Di menu **Metode Pembayaran** (`?tab=pembayaran`), admin dapat menambahkan metode pembayaran EDC/QRIS dengan potongan biaya transaksi (*MDR / Fee %*). Namun, sistem mengizinkan penyimpanan metode bayar ber-fee ini **tanpa memvalidasi** apakah akun `bank_fee` di menu **Pemetaan Akun** (`?tab=akun`) sudah diisi. Akibatnya, saat kasir di toko menggunakan metode bayar ini, `checkoutAction` melempar `AppError("VALIDATION", 'Akun untuk "bank_fee" belum dipetakan di Pengaturan...')`, menghentikan seluruh antrean transaksi di kasir fisik.
- **Dampak Bisnis**:
  Kegagalan transaksi kasir (*checkout outage*) di jam sibuk toko, antrean kasir macet, komplain pelanggan.
- **Rekomendasi Perbaikan**:
  Di form metode pembayaran (`pembayaran.ts`), jika nilai fee > 0, validasi secara instan apakah `map.bank_fee` sudah terisi di database. Jika belum, blokir penyimpanan metode atau tampilkan peringatan wajib konfigurasi akun penampung fee bank terlebih dahulu.
- **Estimasi Effort**: **S (Small)**

---

### SET-005: Inkonsistensi Arsitektur Rute Navigasi Pengaturan (Query Params vs Sub-halaman)
- **Severity**: **Sedang**
- **Kategori**: UI/UX & Routing
- **Tingkat Keyakinan**: **Tinggi**
- **Bukti Kode**:
  - `src/lib/settings-nav.ts:29-44`
  - `src/app/app/pengaturan/`
- **Deskripsi Masalah**:
  Dari 12 item navigasi di cangkang Pengaturan:
  - 9 item berupa query params pada halaman utama: `/app/pengaturan?tab=umum`, `?tab=cetak`, `?tab=nomor`, `?tab=pembayaran`, `?tab=grup`, `?tab=lokasi`, `?tab=akun`, `?tab=modul`, `?tab=kolom`.
  - 3 item berupa sub-halaman rute terpisah: `/app/pengaturan/pengguna`, `/app/pengaturan/payroll-indonesia`, `/app/pengaturan/status`.
  Perbedaan ini menyebabkan hilangnya state form saat pengguna berpindah tab (karena URL berganti struktur), perilaku tombol browser Back/Forward yang canggung, dan struktur breadcrumbs yang tidak seragam.
- **Dampak Bisnis**:
  Kebingungan navigasi pengguna, rasa frustrasi saat konfigurasi yang belum tersimpan hilang karena pergantian tab.
- **Rekomendasi Perbaikan**:
  Seragamkan seluruh sub-bagian pengaturan menjadi sub-rute konsisten (misal `/app/pengaturan/umum`, `/app/pengaturan/cetak`, `/app/pengaturan/lokasi`, dll.) atau buat layout tab bersarang dengan preservasi state.
- **Estimasi Effort**: **M (Medium)**

---

### SET-006: Dead Variable `ctx` di Halaman Status Sistem
- **Severity**: **Rendah**
- **Kategori**: Kualitas Kode / Linting
- **Tingkat Keyakinan**: **Tinggi** (Terdeteksi via ESLint)
- **Bukti Kode**:
  - `src/app/app/pengaturan/status/page.tsx:99:9`
- **Deskripsi Masalah**:
  ESLint mendeteksi variable `'ctx' is assigned a value but never used @typescript-eslint/no-unused-vars`. Hal ini menunjukkan kode sisa refactoring otentikasi yang belum dibersihkan.
- **Dampak Bisnis**:
  Menurunkan keterbacaan kode (*code hygiene*), potensi pembengkakan bundle.
- **Rekomendasi Perbaikan**:
  Hapus assignment `ctx` yang tidak terpakai atau gunakan untuk pengecekan hak akses eksplisit.
- **Estimasi Effort**: **S (Small)**
