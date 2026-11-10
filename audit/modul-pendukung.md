# Laporan Audit Modul: Sistem Pendukung & Global (Supporting Infrastructure)

- **Kode Modul**: `pendukung`
- **Prefix Temuan**: `SYS-*`
- **Lingkup**: Autentikasi Better-Auth, Multi-tenant Isolation, App Switcher, Audit Trail Global, Import Service (Spreadsheet Parser & Batch Commit), Script Backup/Restore Database, Health Check API, dan Error Handling.

---

## 1. Ikhtisar & Skor Modul

| Dimensi Audit | Skor (1-5) | Catatan Ringkas |
| :--- | :---: | :--- |
| **Fungsi (Happy & Error Path)** | 4.0 | Skrip backup dengan manifest SHA256 dan enkripsi AES-256 solid; health check API minimal dan aman. |
| **Tampilan Visual (UI)** | 3.5 | Modal command palette dan company switcher responsif; halaman login bersih. |
| **Pengalaman Pengguna (UX)** | 3.5 | Feedback error validasi bahasa Indonesia di server actions; proses impor spreadsheet memiliki progress batch. |
| **Workflow & State Machine** | 4.0 | Tenant isolation ditegakkan melalui helper `withCompany` di Drizzle ORM. |
| **Integritas Data & Atomisitas**| 4.0 | Batch commit impor master merekam status per baris (*imported/skipped/failed*). |
| **Laporan & Visibilitas** | 3.5 | Audit log merekam snapshot before/after JSONB untuk mutasi sensitif. |
| **Performa & Query** | 4.0 | Indexing multi-tenant `(company_id, ...)` terpasang pada tabel-tabel utama. |
| **Hak Akses & Keamanan** | 3.5 | Sanitasi formula spreadsheet (`neutralizeFormula`) melindungi dari CSV injection; sesi multi-perusahaan terproteksi. |

---

## 2. Rincian Temuan Audit

### SYS-001: Peringatan Inkonsistensi State pada Background Backup Tanpa Automasi Cron Terintegrasi
- **Severity**: **Sedang**
- **Kategori**: Infrastruktur & Keandalan Operasional
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari inspeksi scripts)
- **Bukti Kode**:
  - `scripts/backup.sh`
  - `src/server/backup-status.ts`
- **Deskripsi Masalah**:
  Sistem memiliki skrip backup `scripts/backup.sh` dan manifest status di Pengaturan (`backup-status.ts`). Namun, eksekusi backup database ini sepenuhnya bergantung pada eksternal cron / shell script di level server OS host linux. Tidak ada worker latar belakang terpasang di Node.js/Next.js untuk menjamin pencadangan periodik otomatis jika operator lupa memasang cron sistem.
- **Dampak Bisnis**:
  Bila server dijalankan secara standalone tanpa setup cron OS, database tidak pernah ter-backup secara berkala, meningkatkan risiko kehilangan data (*data loss*) jika storage server rusak.
- **Rekomendasi Perbaikan**:
  Sediakan notifikasi banner amber di dashboard Pengaturan jika manifest backup menunjukkan waktu pencadangan terakhir sudah lebih dari 24 jam.
- **Estimasi Effort**: **S (Small)**

---

### SYS-002: Ketiadaan Pembatalan Massal (*Rollback Job*) pada Impor Master Parsial
- **Severity**: **Sedang**
- **Kategori**: Integritas Data / Impor
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `commit.ts`)
- **Bukti Kode**:
  - `src/server/import/commit.ts:40-80`
- **Deskripsi Masalah**:
  Ketika pengguna mengimpor 1.000 produk dari spreadsheet, commit diproses per chunk limit. Jika pada baris ke-800 terjadi error validasi atau koneksi putus, baris 1-799 yang sudah terlanjur di-commit tetap tersimpan di database. Sistem tidak menyediakan tombol "Rollback Seluruh Job Impor Ini" untuk mengembalikan kondisi database persis seperti sebelum file diunggah.
- **Dampak Bisnis**:
  Staf gudang harus menghapus ratusan produk yang salah impor secara satu-persatu atau melakukan reset manual.
- **Rekomendasi Perbaikan**:
  Tandai setiap baris master yang lahir dari impor dengan `import_job_id` dan sediakan aksi *"Batalkan Hasil Impor"* yang menghapus semua entitas dari job tersebut selama belum ada transaksi penjualan/pergerakan stok yang menggunakannya.
- **Estimasi Effort**: **M (Medium)**

---

### SYS-003: Command Palette (`Ctrl+K`) Membocorkan Label Menu Modul yang Sedang Dinonaktifkan
- **Severity**: **Rendah**
- **Kategori**: UI/UX & Konsistensi Akses
- **Tingkat Keyakinan**: **Sedang** (Terbukti dari command palette search)
- **Bukti Kode**:
  - `src/components/shell/command-palette.tsx`
- **Deskripsi Masalah**:
  Pencarian cepat Command Palette (`Ctrl+K`) mengambil daftar rute statis. Jika modul tertentu dinonaktifkan oleh perusahaan di Pengaturan (`enabledModules: { pos: false }`), item pencarian yang berkaitan dengan POS masih dapat muncul di daftar hasil pencarian Command Palette. Saat pengguna mengkliknya, mereka baru dilempar ke halaman Beranda dengan pesan modul dinonaktifkan.
- **Dampak Bisnis**:
  Pengguna merasa bingung melihat opsi menu yang seharusnya tidak ada di perusahaan mereka.
- **Rekomendasi Perbaikan**:
  Saring entri `command-palette.tsx` menggunakan `isModuleEnabled(ctx.settings, moduleKey)` sebelum merender daftar navigasi.
- **Estimasi Effort**: **S (Small)**
