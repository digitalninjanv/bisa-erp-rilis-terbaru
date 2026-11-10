# 02. Inventaris Fitur Lengkap Sistem (FEATURE_INVENTORY.md)

Dokumen ini memuat inventaris 100% fitur, menu, submenu, halaman/route, form, aksi, laporan, dan pengaturan terkait di seluruh repositori **bisa-erp**.

Inventaris disusun berdasarkan penelusuran komparatif dua arah:
1. **Sisi Pengguna (Navigasi/UI)**: `MODULES` di `src/lib/modules.ts`, `SETTINGS_NAV` di `src/lib/settings-nav.ts`, serta komponen cangkang (`sidebar-nav.tsx`, `module-shell.tsx`).
2. **Sisi Kode (Route/Controller/Actions)**: Semua `page.tsx` di `src/app/`, route handlers di `src/app/api/`, dan server actions di `src/server/actions/`.

---

## 1. Rekapitulasi Jumlah Item per Modul

| No | Modul | Jml Menu Navigasi | Jml Route Halaman (`page.tsx`) | Jml Server Actions / Endpoints | Jml Form & Dialog Input | Jml Laporan & Cetak |
| :-: | :--- | :-: | :-: | :-: | :-: | :-: |
| 1 | **Pengaturan & Master Sistem** | 12 | 4 | 24 | 14 | 1 |
| 2 | **Akuntansi & Keuangan** | 16 | 24 | 26 | 18 | 11 |
| 3 | **Gudang & Pembelian** | 17 | 32 | 34 | 22 | 8 |
| 4 | **POS (Point of Sale)** | 9 | 12 | 21 | 10 | 4 |
| 5 | **HR & Penggajian (Payroll)** | 10 | 15 | 27 | 15 | 3 |
| 6 | **Analisa Bisnis** | 4 | 1 | 1 | 0 | 4 |
| 7 | **Sistem Pendukung & Global** | 2 | 3 | 25 | 4 | 7 |
| **TOTAL** | **SELURUH SISTEM** | **70** | **91** | **158** | **83** | **38** |

---

## 2. Inventaris Rinci per Modul

### MODUL 1: Pengaturan & Master Sistem (Settings)
- **Aksen / Key**: `#475569` (Netral) / `pengaturan`
- **Tujuan**: Konfigurasi identitas perusahaan, cabang, gudang, hak akses pengguna, penomoran, metode bayar, dan pemetaan akun.

| Submenu / Item | Halaman / Route | Ketersediaan di Nav | Aksi (Tambah, Edit, Hapus, Simpan) | Form & Field Kunci | Laporan / Status | Pengaturan Terkait |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Umum** | `/app/pengaturan?tab=umum` | ADA | Simpan profil perusahaan, update logo | Nama, NPWP, alamat, telp, email, mata uang, zona waktu | - | Profil dasar |
| **Pengguna & Peran** | `/app/pengaturan/pengguna` | ADA | Tambah user, edit role, reset password, hapus user, buat custom role | Nama, email, password, role select, matrix permissions | Daftar pengguna aktif | RBAC multi-tenant |
| **Payroll Indonesia** | `/app/pengaturan/payroll-indonesia` | ADA | Simpan parameter statuter, bracket TER, UMR, BPJS | PPh 21 TER (A, B, C), PTKP status, tarif BPJS (JKK, JKM, JHT, JP, Kes), UMR regional | Ringkasan regulasi | PP 35/2021 & PMK 168/2023 |
| **Cetak & Nota** | `/app/pengaturan?tab=cetak` | ADA | Simpan layout cetak, upload logo cetak | Margin (mm), paper size (58mm, 80mm, A4), font size, header/footer, show tax | Preview layout | Template nota & invoice |
| **Penomoran** | `/app/pengaturan?tab=nomor` | ADA | Simpan konfigurasi prefix & format nomor dokumen | Format prefix dokumen (INV, PO, PR, DO, JV, RET), padding digit, reset period (Bulanan/Tahunan) | Preview nomor berikutnya | Dokumen counter |
| **Metode Pembayaran** | `/app/pengaturan?tab=pembayaran` | ADA | Tambah, edit, aktif/nonaktif, hapus metode, upload QRIS | Nama metode, tipe (Tunai, Bank, EDC/Kartu, QRIS), akun COA tujuan, QRIS image upload | Daftar metode aktif | Kas & Bank COA |
| **Kelompok Harga** | `/app/pengaturan?tab=grup` | ADA | Buat customer group, set harga khusus per produk, clear harga khusus | Nama grup (Retail, Grosir, Member), diskon default %, harga khusus per SKU | Matriks harga grup | Harga jual POS/Gudang |
| **Gudang & Cabang** | `/app/pengaturan?tab=lokasi` | ADA | Tambah gudang, nonaktifkan gudang, hapus gudang, tambah cabang | Kode gudang, nama gudang, tipe (Pusat, Toko, Transit), alamat, penanggung jawab | Status gudang | Multi-warehouse |
| **Pemetaan Akun** | `/app/pengaturan?tab=akun` | ADA | Mapping akun sistem default (Piutang, Utang, Pendapatan, HPP, Persediaan, PPN, Kasbon, dll.) | Dropdown akun COA per kategori sistem | Validasi kelengkapan akun sistem | Jurnal otomatis |
| **Modul Perusahaan** | `/app/pengaturan?tab=modul` | ADA | Toggle enable/disable modul (POS, Gudang, Akuntansi, HR, Analisa) | Checkbox toggle per modul | Ringkasan modul aktif | Enforce `assertModuleEnabled` |
| **Kolom Kustom** | `/app/pengaturan?tab=kolom` | ADA | Tambah/simpan konfigurasi custom field untuk entitas | Nama label, tipe data (text, number, date), wajib/opsional, target entitas | Daftar kolom aktif | Metadata entitas |
| **Status Sistem** | `/app/pengaturan/status` | ADA | Cek kesehatan database, migration status, disk space, backup status | Status database, migration batch, storage usage | Status dashboard | Server health |

---

### MODUL 2: Akuntansi & Keuangan (Accounting)
- **Aksen / Key**: `#714b67` / `akuntansi`
- **Tujuan**: Pencatatan jurnal umum, buku besar, neraca saldo, aset tetap, rekonsiliasi kas/bank, tutup buku, dan laporan keuangan komprehensif.

| Submenu / Item | Halaman / Route | Ketersediaan di Nav | Aksi (CRUD, Posting, Approve, Cetak) | Form & Field Kunci | Laporan & Filter Terkait | Pengaturan Terkait |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Ringkasan (Dashboard)** | `/app/akuntansi` | ADA | Filter periode, view KPI saldo kas/bank, laba rugi kilat | Date range filter | Widget saldo kas, trend pendapatan, pending approval | Tutup periode |
| **Audit Trail** | `/app/akuntansi/riwayat` | ADA | Pencarian riwayat aktivitas dan mutasi sistem | Filter user, entitas, tanggal, jenis aksi | Log audit mutasi data | Keamanan & jejak audit |
| **Kas & Bank** | `/app/akuntansi/bank` | ADA | Tambah transaksi kas masuk/keluar, transfer dana antarbank | Tanggal, akun asal, akun tujuan, nominal, memo/catatan, nomor referensi | Buku bank, mutasi kas | Akun kas/bank di COA |
| **Transfer Bank** | `/app/akuntansi/bank/transfer` | ADA | Riwayat & pembuatan transfer bank resmi | Akun pengirim, akun penerima, nominal, biaya admin, ref no | Riwayat transfer | Rekonsiliasi bank |
| **Rekonsiliasi Bank** | `/app/akuntansi/rekonsiliasi` | ADA | Upload bank statement CSV, auto-match, manual match, unmatch, create journal from line | File upload (CSV), mapping kolom (Tanggal, Deskripsi, Mutasi), matching tolerance | Status rekonsiliasi, saldo buku vs bank | Akun bank terdaftar |
| **Piutang & Utang** | `/app/akuntansi/piutang-utang` | ADA | Bayar utang, terima piutang, write-off, cetak aging | Filter pihak (pelanggan/pemasok), metode bayar, potongan, akun pembebanan | Laporan aging (0-30, 31-60, 61-90, 90+ hari) | Pemetaan akun AP/AR |
| **Jurnal Umum** | `/app/akuntansi/jurnal` | ADA | Buat manual journal, reverse jurnal, filter tipe sumber | Tanggal, no bukti, daftar baris: akun COA, debit, kredit, memo, cabang/proyek | Jurnal voucher list | Immutability jurnal |
| **Buat Jurnal Baru** | `/app/akuntansi/jurnal/baru` | **TIDAK (Aksi)** | Simpan & posting jurnal umum | Baris multi-debit/kredit, balance indicator | Validasi seimbang debit = kredit | COA aktif |
| **Detail Jurnal** | `/app/akuntansi/jurnal/[id]` | **TIDAK (Detail)** | View jurnal, reverse jurnal, navigasi cetak | Detail baris debit/kredit, status posted/reversed | Dokumen voucher | Audit trail |
| **Cetak Jurnal** | `/app/akuntansi/jurnal/[id]/cetak` | **TIDAK (Cetak)** | Cetak PDF voucher jurnal | Print layout | Format voucher jurnal | Print settings |
| **Buku Besar** | `/app/akuntansi/buku-besar` | ADA | Filter akun COA, filter rentang tanggal, cetak buku besar | Pilihan akun COA, tanggal mulai & akhir | Kartu buku besar (saldo awal, mutasi, saldo akhir) | COA & Periode |
| **Cetak Buku Besar** | `/app/akuntansi/buku-besar/cetak` | **TIDAK (Cetak)** | Cetak PDF buku besar per akun | Print layout | Laporan buku besar cetak | Print settings |
| **Bagan Akun (COA)** | `/app/akuntansi/akun` | ADA | Tambah akun, edit akun, nonaktifkan, hapus (jika belum ada mutasi) | Kode akun, nama akun, klasifikasi (Aset, Kewajiban, Ekuitas, Pendapatan, Beban), sub-klasifikasi, saldo normal | Struktur pohon COA | Klasifikasi standar |
| **Detail Akun** | `/app/akuntansi/akun/[id]` | **TIDAK (Detail)** | Edit properti akun, view mutasi akun | Nama akun, status aktif | Riwayat mutasi per akun | COA |
| **Migrasi Bagan Akun** | `/app/akuntansi/migrasi-coa` | ADA | Preview mapping migrasi, eksekusi pemindahan akun | Akun asal -> akun tujuan, validasi saldo | Laporan preview dampak migrasi | Validasi saldo akun |
| **Aset Tetap** | `/app/akuntansi/aset` | ADA | Tambah aset, buat kategori aset, jalankan depresiasi bulanan, disposal aset | Nama aset, tanggal perolehan, harga perolehan, masa manfaat (bulan), metode garis lurus, akun aset/akumulasi/beban | Jadwal penyusutan, nilai buku | Jurnal otomatis depresiasi |
| **Laporan Keuangan** | `/app/akuntansi/laporan` | ADA | Filter periode, pilih jenis laporan (Neraca, Laba Rugi, Neraca Saldo, Arus Kas) | Filter tanggal, mode perbandingan periode | Neraca Saldo, Neraca (Balance Sheet), Laba Rugi (P&L), Arus Kas | Tutup periode |
| **Cetak Laporan** | `/app/akuntansi/laporan/cetak` | **TIDAK (Cetak)** | Cetak resmi laporan keuangan ke PDF | Print layout | Laporan keuangan cetak | Margin & format angka |
| **Pajak (PPN)** | `/app/akuntansi/pajak` | ADA | Rekapitulasi PPN Masukan, PPN Keluaran, dan kurang/lebih bayar | Filter bulan & tahun | SPT Masa PPN ringkas | Akun PPN Masukan/Keluaran |
| **Cetak Pajak** | `/app/akuntansi/pajak/cetak` | **TIDAK (Cetak)** | Cetak rekap PPN | Print layout | Form rekap pajak | Print settings |
| **Periode Fiskal** | `/app/akuntansi/periode` | ADA | Buka periode, kunci periode (*lock*), tutup tahun buku (*year-end closing*) | Pilih tahun, bulan, aksi tutup/kunci, alokasi laba berjalan ke retained earnings | Status periode per bulan | Tahun buku & aturan tutup |
| **Rekonsiliasi Kontrol** | `/app/akuntansi/rekonsiliasi-kontrol` | ADA | Pengecekan ketidakcocokan sub-ledger vs GL (Persediaan vs Stok, AR vs Sales, AP vs Purchase) | Tombol audit rekonsiliasi | Matriks diskrepansi nilai | Subledger integrity |
| **Form Beban (Legacy)** | `/app/akuntansi/beban` | **TIDAK (Route Tanpa Menu)** | Catat beban kas langsung (tanpa melalui PO/Invoice) | Tanggal, akun beban, akun kas/bank, nominal, bukti transaksi | Daftar pengeluaran beban | Kas & COA |
| **Cetak Piutang-Utang** | `/app/akuntansi/piutang-utang/cetak` | **TIDAK (Cetak)** | Cetak ringkasan piutang/utang dan aging schedule | Print layout | Laporan umur piutang/utang | Print settings |

---

### MODUL 3: Gudang & Pembelian (Warehouse, Inventory & Purchasing)
- **Aksen / Key**: `#c28b36` / `gudang`
- **Tujuan**: Manajemen produk master, barcode, batch/expiry, stok multi-gudang, penyesuaian, stok opname, purchase request, purchase order, penerimaan barang, dan retur supplier.

| Submenu / Item | Halaman / Route | Ketersediaan di Nav | Aksi (CRUD, Posting, Approve, Cetak) | Form & Field Kunci | Laporan & Filter Terkait | Pengaturan Terkait |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Ringkasan (Dashboard)** | `/app/gudang` | ADA | Filter gudang, indikator stok menipis, barang kedaluwarsa | Filter cabang/gudang | KPI total SKU, nilai stok, PO pending | Minimum stock |
| **Mode Operasi** | `/app/gudang/operasi` | ADA | Mode barcode scanner cepat untuk cek stok dan lokasi | Input barcode/SKU scanner | Lookup instan produk & stok fisik | Barcode scanner |
| **Penerimaan Barang** | `/app/gudang/penerimaan` | ADA | Input penerimaan stok (dari PO atau langsung), batalkan penerimaan | Pilih PO / Pemasok, nomor surat jalan supplier, gudang tujuan, baris produk (qty terima, batch, expiry) | Daftar surat jalan penerimaan | Jurnal persediaan |
| **Detail Penerimaan** | `/app/gudang/penerimaan/[id]` | **TIDAK (Detail)** | View dokumen penerimaan, void penerimaan | Rincian kuantiti & nomor batch | Dokumen bukti terima | Kartu stok |
| **Cetak Penerimaan** | `/app/gudang/penerimaan/[id]/cetak` | **TIDAK (Cetak)** | Cetak bukti tanda terima barang (LPB) | Print layout | Bukti penerimaan barang | Cetak gudang |
| **Penyesuaian Stok** | `/app/gudang/penyesuaian` | ADA | Buat penyesuaian (tambah/kurang), approve/reject penyesuaian | Gudang, tanggal, alasan (rusak, hilang, sampel, bonus), baris produk (qty penyesuaian, akun penyesuaian) | Riwayat penyesuaian stok | Approval workflow |
| **Transfer Antargudang** | `/app/gudang/transfer` | ADA | Buat transfer kirim, terima transfer di gudang tujuan | Gudang asal, gudang tujuan, tanggal, baris produk (qty kirim) | Status transfer (Dikirim, Diterima) | Multi-gudang |
| **Cetak Transfer** | `/app/gudang/transfer/[id]/cetak` | **TIDAK (Cetak)** | Cetak surat jalan transfer antargudang | Print layout | Surat jalan transfer | Print settings |
| **Stok Opname** | `/app/gudang/opname` | ADA | Inisiasi sesi opname, buat lembar hitung, input hasil fisik, selesaikan opname | Nama sesi, gudang, kategori/lokasi rak, toleransi selisih | Matriks perbandingan sistem vs fisik | Jurnal selisih opname |
| **Lembar Hitung Opname** | `/app/gudang/opname/lembar-hitung` | **TIDAK (Aksi)** | Cetak formulir kosong untuk petugas hitung lapangan | Filter gudang & rak | Lembar hitung tanpa jumlah sistem (blind count) | Form fisik |
| **Produk Master** | `/app/gudang/produk` | ADA | Tambah produk, edit, nonaktifkan, hapus, kelola multi-satuan | Kode SKU, barcode, nama produk, kategori, satuan dasar, satuan konversi (isi/box), harga beli, harga jual, min stock, batch tracking flag | Katalog produk & pencarian | Akun persediaan COA |
| **Detail Produk** | `/app/gudang/produk/[id]` | **TIDAK (Detail)** | Edit spesifikasi produk, lihat kartu stok produk | Form edit master produk, riwayat harga | Kartu mutasi produk spesifik | Konversi unit |
| **Pergerakan Stok** | `/app/gudang/pergerakan` | ADA | Filter pergerakan stok per produk, gudang, dan rentang tanggal | Filter tanggal, gudang, tipe dokumen (POS, PO, Opname, Transfer, Adj) | Kartu stok lengkap (Masuk, Keluar, Saldo) | Immutability ledger stok |
| **Reservasi Stok** | `/app/gudang/reservasi` | ADA | Buat reservasi stok pesanan, rilis reservasi kedaluwarsa | Referensi order/pelanggan, gudang, produk, qty reservasi, tanggal kadaluwarsa reservasi | Daftar stok ter-hold | Availabilitas kasir POS |
| **Nilai Persediaan** | `/app/gudang/nilai` | ADA | Analisa valuasi persediaan (metode rata-rata bergerak / FIFO) | Filter gudang, kategori | Total nilai persediaan per SKU & total nilai aset lancar | Rekonsiliasi GL |
| **Permintaan Pembelian** | `/app/gudang/purchase-request` | ADA | Buat PR internal, persetujuan PR (Approve/Reject), konversi PR ke PO | Pemohon, divisi, tanggal butuh, baris barang (qty butuh, estimasi harga, alasan) | Daftar status PR (Draft, Submitted, Approved, Rejected, Converted) | Approval PR |
| **Detail PR** | `/app/gudang/purchase-request/[id]` | **TIDAK (Detail)** | Review dan keputusan PR | Form review PR | Form audit PR | Role approver |
| **Pesanan Pembelian (PO)**| `/app/gudang/pembelian` | ADA | Buat PO ke pemasok, kirim PO, batalkan PO | Pemasok, gudang tujuan, tanggal janji kirim, syarat bayar (TOP), baris item (qty, harga, diskon, PPN) | Daftar PO aktif | Supplier credit limit |
| **Detail PO** | `/app/gudang/pembelian/[id]` | **TIDAK (Detail)** | View status PO, buat penerimaan barang dari PO, buat tagihan | Dokumen PO & tracking penerimaan bertahap | Tracking progres PO | Toleransi over-receipt |
| **Cetak PO** | `/app/gudang/pembelian/[id]/cetak` | **TIDAK (Cetak)** | Cetak PO resmi format kertas A4 | Print layout | Form purchase order cetak | Print settings |
| **Uang Muka Pembelian** | `/app/gudang/uang-muka` | ADA | Catat uang muka supplier bertaut ke PO, void uang muka | Pemasok, nomor PO, akun kas/bank pengeluaran, nominal uang muka, tanggal | Saldo deposit supplier | Akun uang muka pembelian |
| **Retur Pembelian** | `/app/gudang/retur-pembelian` | ADA | Buat retur pembelian, posting retur, klaim nota kredit / refund / ganti barang | Pemasok, nomor bukti penerimaan/faktur asal, alasan retur, item & qty, resolusi (Credit/Refund/Replacement) | Daftar retur pembelian | Jurnal retur & utang |
| **Form Retur Baru** | `/app/gudang/retur-pembelian/baru` | **TIDAK (Aksi)** | Buat dokumen retur baru | Pilih dokumen sumber terima barang, isi qty retur | Validasi qty retur <= qty terima | Akun retur |
| **Detail Retur** | `/app/gudang/retur-pembelian/[id]` | **TIDAK (Detail)** | View & kelola nota retur pembelian | Detail retur & alokasi resolusi | Tracking status retur | Subledger utang |
| **Cetak Retur** | `/app/gudang/retur-pembelian/[id]/cetak` | **TIDAK (Cetak)** | Cetak nota retur pembelian | Print layout | Dokumen debit note | Print settings |
| **Rekomendasi Beli** | `/app/gudang/rekomendasi` | ADA | Kalkulasi reorder point otomatis, generate draft PO massal | Filter supplier, lead time hari, safety stock formula | Daftar produk di bawah buffer stock | Formula min-max stock |
| **Pemasok & Pelanggan** | `/app/gudang/pemasok` | ADA | Tambah/edit pemasok, tambah/edit pelanggan, nonaktifkan, hapus | Tipe pihak (Pemasok/Pelanggan), nama, kontak, telepon, NPWP, syarat pembayaran, limit kredit | Master kontak bisnis | Verifikasi single source |
| **Detail Pemasok** | `/app/gudang/pemasok/[id]` | **TIDAK (Detail)** | Edit profil pemasok & riwayat transaksi | Form profil pemasok | Riwayat pembelian per supplier | Hutang dagang |
| **Deteksi Duplikat Pemasok**| `/app/gudang/pemasok/duplikat`| **TIDAK (Route Tanpa Menu)** | Analisa kemiripan nama & NPWP pemasok untuk deduplikasi | Tabel perbandingan kandidat duplikat | Laporan identifikasi data ganda | Data cleansing |
| **Detail Pelanggan** | `/app/gudang/pelanggan/[id]` | **TIDAK (Detail)** | Edit profil pelanggan & riwayat piutang | Form profil pelanggan, kelompok harga | Riwayat transaksi kasir/piutang | Piutang dagang |
| **Dokumen Terpadu** | `/app/gudang/dokumen/[id]` | **TIDAK (Route Tanpa Menu)** | Tampilan generik audit dokumen pergerakan stok | Tampilan data dokumen gudang | Audit log dokumen fisik | Unified document viewer |
| **Impor Data Gudang** | `/app/gudang/impor` | ADA | Upload spreadsheet (XLSX/CSV) produk, kategori, saldo awal | File dropzone, mapping header Excel, validasi baris, execute import | Progress bar impor & error log | Bulk import template |

---

### MODUL 4: POS (Point of Sale)
- **Aksen / Key**: `#0e9384` / `pos`
- **Tujuan**: Terminal kasir cepat minimarket, scanner barcode, penahanan nota (*hold*), pembayaran campuran (*split payment*), sesi kasir (*till management*), dan mode offline.

| Submenu / Item | Halaman / Route | Ketersediaan di Nav | Aksi (CRUD, Posting, Kasir, Cetak) | Form & Field Kunci | Laporan & Filter Terkait | Pengaturan Terkait |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Kasir (Terminal Utama)** | `/app/pos` | ADA | Scan barcode, cari manual, pilih member/pelanggan, terapkan diskon, hold transaksi, checkout bayar | Barcode input, keranjang belanja, diskon (Rp/% per item atau global), uang diterima, kembalian | Ringkasan keranjang | Sesi kas wajib aktif |
| **Riwayat Transaksi** | `/app/pos/riwayat` | ADA | Cari transaksi, cetak ulang struk, void transaksi, bayar piutang penjualan | Filter tanggal, nomor nota, kasir, status bayar | Daftar penjualan harian | Wewenang void |
| **Detail Nota** | `/app/pos/nota/[id]` | **TIDAK (Detail)** | View rincian penjualan, tombol reprint & faktur | Rincian item belanja, subtotal, diskon, pajak, metode bayar | Nota penjualan | Void audit |
| **Cetak Faktur Penjualan** | `/app/pos/nota/[id]/faktur` | **TIDAK (Cetak)** | Cetak faktur tagihan ukuran A4 untuk pelanggan kredit | Print layout A4 | Faktur penjualan resmi | Print settings |
| **Retur Penjualan** | `/app/pos/retur` | ADA | Input retur barang kasir dari nomor nota asal, buat nota kredit / uang kembali | Cari no nota, pilih item yang dikembalikan, kuantiti retur, alasan retur | Log retur kasir | Restock otomatis |
| **Pesanan Ditahan (Hold)**| `/app/pos/ditahan` | ADA | Lanjutkan pesanan tertahan (*resume*), hapus pesanan tertahan | Daftar transaksi yang di-hold di kasir, catatan meja/nama | Transaksi pending | Auto-clean timer |
| **Sesi Kas (Shift)** | `/app/pos/sesi` | ADA | Buka shift (modal awal), input setoran/penarikan kas tengah hari (*cash in/out*), tutup shift (hitung fisik kas akhir) | Modal awal kasir, kas masuk, kas keluar, kas fisik aktual penutupan, catatan selisih | Ringkasan shift berjalan | Selisih kas otomatis |
| **Riwayat Sesi Kas** | `/app/pos/sesi/riwayat` | ADA | Filter riwayat sesi kasir seluruh cabang & tanggal | Filter rentang tanggal, filter kasir/user | Laporan shift kasir | Rekonsiliasi kas |
| **Detail Sesi Kas** | `/app/pos/sesi/riwayat/[id]`| **TIDAK (Detail)** | Detail rincian transaksi dalam satu shift, audit varians | Rincian uang masuk, total per metode bayar, varians akhir | Audit shift komprehensif | Kas COA |
| **Terminal Desktop** | `/app/pos/terminal` | ADA | Pairing terminal POS fisik, issue pairing code, revoke terminal token | Nama perangkat, kode pairing 6 digit, lokasi gudang/kasir default | Daftar terminal terhubung | Tauri POS desktop app |
| **Peninjauan Offline** | `/app/pos/offline` | ADA | Review antrean penjualan offline yang gagal sinkronisasi otomatis, resolve konflik | Daftar antrean outbox offline, error reason, retry sync | Log konflik offline sync | LocalStorage / IndexedDB |
| **Kelompok Harga POS** | `/app/pos/grup` | ADA | Quick view kelompok harga pelanggan | Daftar grup & diskon aktif | Matriks harga POS | Pengaturan grup harga |

---

### MODUL 5: HR & Penggajian (Human Resources & Payroll)
- **Aksen / Key**: `#3b6ea5` / `hr` (Secara URL fisik: `/app/akuntansi/(hr)/...`)
- **Tujuan**: Manajemen data karyawan, struktur departemen/jabatan, shift kerja, presensi harian, cuti, lembur, kasbon, pinjaman lunak, klaim reimbursement, dan kalkulasi payroll bulanan.

| Submenu / Item | Halaman / Route | Ketersediaan di Nav | Aksi (CRUD, Posting, Approve, Cetak) | Form & Field Kunci | Laporan & Filter Terkait | Pengaturan Terkait |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Ringkasan (Dashboard HR)**| `/app/akuntansi/hr` | ADA | Filter bulan, KPI kehadiran hari ini, pengajuan pending approval, jadwal gajian | Filter periode | Widget kehadiran, cuti aktif, rekap kasbon | Kalender kerja |
| **Karyawan & Payroll** | `/app/akuntansi/payroll` | ADA | Tambah karyawan, edit status, run payroll bulanan, finalize & bayar gaji | Master karyawan: NIK, nama, departemen, jabatan, status (tetap/kontrak), gaji pokok, tunjangan, status PTKP, BPJS ID | Daftar karyawan & batch payroll | Standar payroll Indonesia |
| **Detail Karyawan** | `/app/akuntansi/karyawan/[id]`| **TIDAK (Detail)** | Edit rincian kompensasi, mutasi jabatan, terminasi karyawan | Gaji, tunjangan tetap/tidak tetap, histori perubahan gaji | Profil riwayat karyawan | Terminasi & pesangon |
| **Detail Batch Payroll** | `/app/akuntansi/payroll/[id]` | **TIDAK (Detail)** | Review rincian gaji per karyawan dalam satu batch, setujui, eksekusi pembayaran gaji | Rincian gaji per orang: gapok, lembur, tunjangan, kasbon, BPJS TK, BPJS Kes, PPh21 TER, take home pay | Rekapitulasi penggajian | Jurnal beban gaji |
| **Cetak Slip Gaji** | `/app/akuntansi/payroll/[id]/cetak`| **TIDAK (Cetak)** | Cetak slip gaji resmi per karyawan | Print layout slip | Slip gaji karyawan | Format slip |
| **Absensi (Presensi)** | `/app/akuntansi/hr/absensi` | ADA | Catat absensi manual, impor absensi via CSV mesin fingerprint | Karyawan, tanggal, jam masuk, jam keluar, status (Hadir, Izin, Sakit, Alpa), keterlambatan | Rekapitulasi presensi bulanan | Shift kerja |
| **Cuti Karyawan** | `/app/akuntansi/hr/cuti` | ADA | Ajukan permohonan cuti, kelola kuota cuti tahunan | Karyawan, jenis cuti (Tahunan, Melahirkan, Penting), tanggal mulai & selesai, alasan | Sisa cuti tahunan per karyawan | Kuota cuti |
| **Lembur & THR** | `/app/akuntansi/hr/lembur` | ADA | Ajukan lembur, hitung otomatis upah lembur (PP 35/2021), kalkulasi THR keagamaan | Karyawan, tanggal lembur, jam mulai & selesai, hari libur/kerja, alasan lembur; kalkulasi THR | Rekap jam lembur & nominal | Rumus PP 35/2021 |
| **Persetujuan Gabungan** | `/app/akuntansi/hr/persetujuan` | ADA | Menyetujui atau menolak cuti, lembur, dan klaim secara terpusat | Review item pengajuan, catatan approver, tombol Approve / Reject | Antrean pekerjaan menunggu | Multi-level approval |
| **Kasbon Karyawan** | `/app/akuntansi/kasbon` | ADA | Ajukan kasbon baru, bayar kasbon langsung, void kasbon | Karyawan, tanggal, nominal, alasan, akun kas pengeluaran | Buku pembantu kasbon karyawan | Potong payroll otomatis |
| **Detail Kasbon Karyawan** | `/app/akuntansi/kasbon/[employeeId]`| **TIDAK (Detail)** | Kartu rincian mutasi kasbon per orang | Riwayat penarikan & pelunasan kasbon | Saldo kasbon per individu | Piutang karyawan COA |
| **Pinjaman Karyawan** | `/app/akuntansi/pinjaman` | ADA | Buat pinjaman jangka panjang (cicilan), atur jadwal angsuran | Karyawan, pokok pinjaman, tenor (bulan), cicilan per bulan, tanggal mulai | Daftar pinjaman aktif & sisa saldo | Cicilan payroll |
| **Detail Pinjaman** | `/app/akuntansi/pinjaman/[employeeId]`| **TIDAK (Detail)** | Jadwal amortisasi pinjaman per individu | Rincian tabel angsuran | Kartu utang karyawan | Amortisasi |
| **Klaim Reimbursement** | `/app/akuntansi/klaim` | ADA | Ajukan klaim biaya operasional, approve klaim, bayar klaim | Karyawan, tanggal, kategori klaim, nominal, deskripsi, upload kuitansi, akun kas | Status klaim (Draft, Disetujui, Dibayar) | Jurnal beban |
| **Pengaturan HR** | `/app/akuntansi/hr/pengaturan` | ADA | Kelola departemen, jabatan, master shift kerja, assign shift ke karyawan | Kode & nama departemen, jabatan & grade, nama shift (jam masuk & pulang), toleransi keterlambatan | Struktur organisasi perusahaan | Jadwal kerja |

---

### MODUL 6: Analisa Bisnis (Analytics)
- **Aksen / Key**: `#0e7490` / `analisa`
- **Tujuan**: Visualisasi metrik kesehatan bisnis minimarket, penggerak kinerja ritel, dan deteksi risiko operasional.

| Submenu / Item | Halaman / Route | Ketersediaan di Nav | Aksi (Filter, Drill-down, Export) | Form & Field Kunci | Laporan & Grafik Terkait | Pengaturan Terkait |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Ringkasan Eksekutif** | `/app/analisa` | ADA | Filter rentang tanggal, refresh data agregasi | Filter tanggal, filter cabang | KPI Gross Margin, Net Profit, Inventory Turnover, DSO | Periode fiskal |
| **Kesehatan Bisnis** | `/app/analisa#kesehatan` | ADA (Anchor) | Analisa rasio likuiditas, solvabilitas, profitabilitas | Target KPI & batas ambang | Grafik Quick Ratio, Current Ratio, Net Margin | Target perusahaan |
| **Penggerak Kinerja** | `/app/analisa#kinerja` | ADA (Anchor) | Analisa top 10 produk terlaris, basket size kasir, jam sibuk transaksi | Pilihan metrik penjualan | Grafik penjualan per jam, produk pareto 80/20 | Data POS |
| **Pengendalian Risiko** | `/app/analisa#risiko` | ADA (Anchor) | Deteksi stok mati (*dead stock*), barang kedaluwarsa mendekati batas, piutang macet | Ambang batas hari dead stock | Tabel peringatan dini risiko | Buffer stok & jatuh tempo |

---

### MODUL 7: Sistem Pendukung & Global
- **Aksen / Key**: `#1e293b` (Netral) / `system`
- **Tujuan**: Otentikasi sesi, cangkang navigasi global, import/export data, audit log aktivitas, backup database, dan health check.

| Submenu / Item | Halaman / Route | Ketersediaan di Nav | Aksi & Endpoint Terkait | Form & Field Kunci | Laporan / Output | Pengaturan Terkait |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Landing / Redirect** | `/` & `/app` | ADA | Redirect ke modul aktif pertama berdasarkan hak akses role | - | Halaman sambutan / dispatch | Default homepage |
| **Login / Otentikasi** | `/login` | **TIDAK (Auth)** | Autentikasi email & password, switch company context | Form input email & password | Sesi cookie Better-Auth | Multi-tenant auth |
| **API Auth Route** | `/api/auth/[...all]` | - | Menangani otentikasi sesi Better-Auth | Payload auth | JSON auth token & session | Konfigurasi sesi |
| **API Health Check** | `/api/health` | - | Monitoring status uptime server dan koneksi DB | GET request | JSON `{ status: "ok" }` | Uptime monitor |
| **Ekspor Excel / CSV** | `/api/export/*` (10 rute) | Tombol di halaman | Download file spreadsheet (produk, pelanggan, supplier, akun, jurnal, buku besar, payroll, persediaan, aging, laporan keuangan) | Query parameter filter | Binary stream file `.xlsx` / `.csv` | SheetJS / XLSX |
| **API Template Impor** | `/api/import/template/[entity]`| Tombol di form | Download template Excel resmi untuk impor entitas (produk, akun, supplier, dll.) | Parameter entitas | File contoh Excel | Skema validasi impor |
| **API Parsing Impor** | `/api/import/parse` | Tombol di form | Upload file Excel dan parsing data baris sebelum commit ke database | File multipart/form-data | Preview data baris & validasi error | Parser service |
| **API POS Sync & Pairing**| `/api/pos/*` (5 rute) | Desktop POS app | Sinkronisasi snapshot katalog, sinkronisasi transaksi offline, pairing terminal, auto-update Tauri | Header bearer token terminal | JSON catalog & sync ACK | POS offline engine |

---

## 3. Temuan Diskrepansi Menu Navigasi vs Route Kode

Dari perbandingan silang 100% antara navigasi pengguna dan route filesystem Next.js ditemukan ketidaksesuaian arsitektural:

1. **Route Tanpa Menu di Navigasi (Orphan / Hidden Routes)**:
   - `/app/akuntansi/beban`: Halaman entri beban mandiri masih aktif dan bisa diakses via URL, namun sengaja dihapus dari sidebar. Bila pengguna mengaksesnya, timbul kebingungan karena form beban ini tidak sinkron dengan alur jurnal standar.
   - `/app/gudang/pemasok/duplikat`: Fitur deteksi duplikat pemasok memiliki halaman lengkap tetapi tidak memiliki tautan langsung dari submenu pemasok maupun sidebar gudang.
   - `/app/gudang/dokumen/[id]`: Halaman generik pelacak dokumen gudang tidak dapat ditemukan dari navigasi hierarkis manapun.
2. **Coupling Struktural Navigasi HR ke Akuntansi**:
   - Seluruh modul HR (`/hr`, `/payroll`, `/kasbon`, `/pinjaman`, `/klaim`) di level kode diletakkan di dalam folder `src/app/app/akuntansi/(hr)/`.
   - Di UI sidebar, HR ditampilkan sebagai modul terpisah dari Akuntansi (punya ikon, warna aksen, dan peran tersendiri). Hal ini menciptakan ambiguitas izin rute: proteksi layout akuntansi dapat memutus akses pengguna yang hanya memiliki izin modul HR.
3. **Penyatuan Master Pelanggan ke dalam Modul Gudang**:
   - Master data Pelanggan (`/app/gudang/pelanggan/[id]`) diletakkan di bawah modul Gudang (`/app/gudang/pemasok`), bukan di CRM / Penjualan atau Master Data terpusat. Operator kasir POS tidak memiliki navigasi langsung ke master pelanggan tanpa membuka modul Gudang.
