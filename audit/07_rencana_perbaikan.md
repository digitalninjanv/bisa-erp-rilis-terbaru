# 07. Rencana Perbaikan Bertahap Sistem BISA-ERP (Actionable Roadmap)

Rencana perbaikan ini disusun dalam 3 fase bertahap berdasarkan prioritas dampak bisnis, tingkat keparahan (*severity*), dan kompleksitas implementasi.

---

## Tahap 1: Quick Wins (Perbaikan Cepat & Bug Kritis, Estimasi 1–3 Hari)
*Fokus: Memperbaiki bug yang memicu crash, pemotongan hak karyawan, dan kegagalan scanner kasir tanpa mengubah skema database.*

1. **Aktifkan Hook Barcode Scanner Global di Kasir POS (POS-001)**:
   - Hubungkan `useBarcodeScannerCapture` di `src/components/pos/pos-terminal.tsx`.
   - Mengatasi scanner USB/Bluetooth yang mengetik ke field salah atau hilang saat fokus tidak di kotak cari.
2. **Koreksi Perhitungan Jam Pecahan Lembur PP 35/2021 (HR-002)**:
   - Perbaiki perulangan integer di `src/lib/payroll/payroll-indonesia.ts` agar mendukung pecahan desimal jam (1.5 jam, 2.5 jam).
3. **Filter Batas Tanggal Mulai Bekerja pada Penggajian (HR-001)**:
   - Tambahkan `lte(employees.joinedAt, periodEnd)` pada query `runPayrollAction` di `src/server/actions/hr/payroll.ts` agar karyawan baru tidak terbayar sebelum masuk kerja.
4. **Validasi Wajib Pemetaan Akun Fee Bank pada Metode Bayar (SET-004)**:
   - Di `src/server/actions/settings/pembayaran.ts`, cegah penyimpanan metode bayar dengan fee jika akun `bank_fee` belum dipetakan, menghentikan crash kasir di jam sibuk.
5. **Perbaiki Permission Key Master Pelanggan Gudang (GDG-001)**:
   - Ganti `pos.sell` menjadi `inventory.manage` pada `src/server/actions/inventory/pihak.ts` agar staf gudang bisa mengelola data kontak pelanggan.
6. **Tautkan Menu "Cek Duplikat Kontak" di Gudang (GDG-003)**:
   - Tambahkan tombol aksi di header `/app/gudang/pemasok` menuju `/app/gudang/pemasok/duplikat`.

---

## Tahap 2: Perbaikan Struktural & Integritas Bisnis (Estimasi 1–2 Minggu)
*Fokus: Memperkuat alur dokumen, validasi kontrol akuntansi, dan penanganan relasi data.*

1. **Proteksi Penguncian Shift Kasir dengan Pesanan Ditahan Aktif (POS-002)**:
   - Tolak `closeCashSession` bila masih ada transaksi berstatus `held`.
2. **Pembatasan Jurnal Manual ke Akun Kontrol GL (AKN-002)**:
   - Blokir posting manual ke akun Piutang, Hutang, dan Persediaan di `postManualJournalAction` untuk mencegah disparitas GL vs Sub-ledger.
3. **Penyempurnaan Rumus & Rekonsiliasi Bank 4-Kolom (AKN-001)**:
   - Perbaiki query `getReconciliationSummary` agar memisahkan *Deposit in Transit* dan *Outstanding Checks*, menghilangkan hasil saldo negatif semu.
4. **Batasi Kelebihan Penerimaan Barang Terhadap PO (GDG-002)**:
   - Terapkan batas toleransi over-receipt (maksimal kuantiti PO + toleransi 0-5%) dan minta persetujuan manajerial jika melampaui.
5. **Optimasi Performa Saldo Kas `evaluateCashNegativeGuard` (AKN-003)**:
   - Ganti pengambilan seluruh baris historis ke memori Node.js dengan agregasi SQL `sum(debit) - sum(credit)` langsung di database.
6. **Proteksi Penghapusan Gudang Berriwayat Transaksi (SET-001)**:
   - Periksa tabel `stock_movements` sebelum menghapus gudang; jika sudah ada mutasi, ubah menjadi nonaktif (`isActive = false`).

---

## Tahap 3: Perubahan Arsitektur & Standarisasi Fondasi (Estimasi 2–4 Minggu)
*Fokus: Single source of truth, sinkronisasi keamanan pengguna, dan standarisasi design system.*

1. **Sinkronisasi Siklus Hidup Karyawan & Akun Login (CONF-03 / HR-003)**:
   - Hubungkan `employees.userId` ke `user.id`.
   - Otomatiskan penonaktifan akun login saat proses terminasi karyawan selesai.
2. **Penyatuan Master Pelanggan & Standarisasi Input (CONF-01 / GDG-004)**:
   - Tetapkan modul Kontak / Mitra Bisnis terpadu sebagai *Single Source of Truth* untuk Pelanggan dan Pemasok.
   - Perbaiki `quickAddCustomerAction` di POS agar memvalidasi nomor telepon unik dan menyinkronkan data profil lengkap.
3. **Standarisasi Pola CRUD & Design System (Fase 4)**:
   - Seragamkan seluruh form tambah/edit menggunakan Slide-over Drawer untuk form menengah dan Dedicated Page untuk transaksi multi-baris.
   - Pindahkan pengaturan `allowNegativeStock` dari profil perusahaan ke pengaturan gudang/lokasi (SET-003).
4. **Migrasi Rute Fisik HR Menjadi Segmen Mandiri (HR-004)**:
   - Pindahkan direktori fisik dari `src/app/app/akuntansi/(hr)/` ke `src/app/app/hr/` dengan URL bersih `/app/hr/*`.
