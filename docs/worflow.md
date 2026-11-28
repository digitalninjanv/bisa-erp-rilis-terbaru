# Peta Fitur & Workflow Bisa ERP

**Tanggal:** 28 November 2026  
**Basis:** working tree setelah commit `7febd50`  
**Sifat:** dokumen analisis dan kontrak kerja. Sumber kebenaran tetap kode + test; bila dokumen dan kode berbeda, kode yang berlaku dan perbedaannya wajib dicatat sebagai temuan.

Dokumen ini menjawab empat pertanyaan:

1. **Fitur apa saja** yang dimiliki Bisa ERP per modul?
2. **Apa fungsi dan aktor** setiap fitur?
3. **Workflow-nya bagaimana**, termasuk penjaga dan output-nya?
4. **Apakah desain, arsitektur, dan workflow-nya sudah mengikuti praktik minimarket/ERP yang sehat?**

Cara memakai dokumen ini:

| Pembaca | Bagian yang paling relevan |
|---|---|
| Pemilik/manager | §1–§3, §10, §14 |
| Developer | §3–§9, §11, §15 |
| QA | §10, §14, §15 |
| Operator toko | §10.1–§10.9 |
| Desainer | §3, §12, §13 |

Dokumen pendamping:

- `docs/BUSINESS_RULES.md` — aturan bisnis yang mengikat.
- `docs/MODULE_BOUNDARIES.md` — kepemilikan modul, domain, dan tabel.
- `docs/ARCHITECTURE.md` — keputusan arsitektur.
- `docs/DESIGN-STANDARD-TABLE-FORM.md` — kontrak tabel & form.
- `docs/OFFLINE_POS_ARCHITECTURE.md` — antrean offline POS.
- `docs/ERP_WORKFLOW.md` — workflow lama; dokumen ini adalah peta yang lebih lengkap dan diperbarui.

### Metode dan pembagian agen

Analisis disusun dengan pembagian kerja berikut, lalu hasilnya direkonsiliasi dengan source dan test:

| Agen | Tugas |
|---|---|
| POS | Memetakan fitur, domain, sesi, pembayaran, retur, offline, cetak |
| Gudang/Pembelian | Memetakan master, PR/PO, GRN, retur, transfer, opname, batch/serial, AVCO |
| Akuntansi/HR | Memetakan jurnal, laporan, kas/bank, pajak, payroll, karyawan |
| Platform | Memetakan pengaturan, auth/RBAC, cetak, PWA/Electron, impor/ekspor |
| Riset UX/arsitektur/workflow | Mencari referensi Exa/web-search: NN/g, SAP Fiori, Material 3, WCAG 2.2, Odoo, Accurate, Shopify, Next.js 16, TanStack |

Verifikasi tambahan: pembacaan source, codegraph, route inventory, dan pemeriksaan status implementasi. Referensi eksternal dicantumkan di §13; klaim vendor tidak diperlakukan sebagai bukti usability independen.

---

## 1. Ringkasan sistem

| Aspek | Keadaan |
|---|---|
| Bentuk aplikasi | Monolit modular Next.js 16 App Router + React 19 + TypeScript |
| Database | PostgreSQL 18, Drizzle ORM, RLS per `company_id` |
| Halaman aplikasi | 103 `page.tsx` di `/app` (plus `/login`, `/two-factor`, `/setup`) |
| Route API | 32 |
| Berkas server action | 61 |
| Tabel database | 109 `pgTable` |
| Migrasi | 91 |
| Unit test | 147 file / 1.270 test |
| E2E penjaga | tabel/form 4/4, POS, akuntansi, PWA, impor |
| Modul pengguna | POS, Gudang, Akuntansi, HR, Analisa |
| Cangkang platform | Beranda `/app` + Pengaturan `/app/pengaturan/**` |
| Cetak | Nota thermal HTML/ESC-POS, faktur A4/A5, dokumen gudang, laporan, slip payroll, Z-report |
| Desktop | Electron (`pos-electron/`), PWA offline POS |

> **Status P0 (28 Nov 2026):** bootstrap owner/perusahaan kini tersedia lewat CLI `pnpm bootstrap` dan route `/setup` bertoken, sedangkan reset kata sandi lintas tenant sudah ditolak kecuali pemanggil adalah owner di semua perusahaan target. Keduanya sudah diuji; lihat §14.0. P0 yang tersisa bersifat non-kode: uji perangkat keras, load test, dan jalur desktop Electron.

### 1.1 Prinsip sistem

- **Satu buku jurnal, satu buku stok.** Semua uang lewat `postJournal`; semua kuantitas stok lewat `stock_movements` append-only.
- **Server yang menghitung.** Harga, diskon, pajak, stok, kredit, dan jurnal dihitung ulang di server; input klien tidak dipercaya.
- **Dokumen tidak diedit diam-diam.** Posted = append-only; koreksi lewat void/reversal/dokumen penyesuaian.
- **Konfigurasi per perusahaan.** Pajak, ambang, termin, penomoran, pemetaan akun, metode bayar, dan cetak adalah konfigurasi, bukan angka mati di kode.
- **Satu alur kerja dominan per layar.** Overview dulu, detail saat diminta; satu aksi primer; tabel/form mengikuti standar bersama.

### 1.2 Legenda status

| Status | Arti |
|---|---|
| **IMPLEMENTED** | Fitur nyata, terhubung ke domain/data, dan memiliki bukti test atau e2e. |
| **PARTIAL** | Inti bekerja, tetapi ada batas yang dinyatakan (mis. QRIS statis, bukan gateway dinamis). |
| **GAP** | Belum dibangun atau sengaja ditahan; bukan diklaim sebagai fitur aktif. |
| **NOT TESTED** | Ada di kode, tetapi belum diuji pada lingkungan/perangkat nyata. |

---

## 2. Peta modul & rute

| Modul | Tujuan | Rute utama | Aktor utama |
|---|---|---|---|
| **Beranda** | Ringkasan toko, antrean tindakan, tren, produk terlaris | `/app` | Owner, manager, admin |
| **POS** | Jual, bayar, tahan, retur, sesi kas, nota, offline, perangkat | `/app/pos/**` | Kasir, supervisor, owner |
| **Gudang** | Produk, pembelian, penerimaan, stok, opname, transfer, nilai persediaan | `/app/gudang/**` | Staf gudang, manager, owner |
| **Akuntansi** | Jurnal, buku besar, kas/bank, piutang/utang, pajak, laporan, periode | `/app/akuntansi/**` | Akuntan, owner |
| **HR** | Karyawan, presensi, cuti, lembur, payroll, kasbon/pinjaman/klaim | `/app/akuntansi/payroll`, `/app/akuntansi/hr/**`, `/app/akuntansi/karyawan/**`, `/app/akuntansi/kasbon/**`, `/app/akuntansi/pinjaman/**`, `/app/akuntansi/klaim` | HR, manager, owner |
| **Analisa** | Kesehatan bisnis, penggerak kinerja, risiko | `/app/analisa` | Owner, manager |
| **Data Master** | Direktori lintas modul: produk, pihak, COA, pemetaan, karyawan, lokasi, metode bayar, penomoran, custom field, pengguna, cetak | `/app/data-master` | Owner, admin, manager |
| **Pengaturan** | Identitas, pajak, gudang/cabang, pengguna/peran, cetak, modul, nomor, pemetaan akun, payroll | `/app/pengaturan/**` | Owner, admin |

### 2.1 Peran bawaan

| Peran | Modul | Hak utama |
|---|---|---|
| **Owner** | Semua | Semua izin; pemilik terakhir tidak bisa dihapus/diturunkan. |
| **Admin** | Semua | Semua izin operasional. |
| **Manager** | Semua | POS, gudang, akuntansi, payroll view/salary, analisa, impor. |
| **Kasir** | POS | Jual, retur, sesi kas. Tidak melihat HPP/gudang. |
| **Staf Gudang** | Gudang | Lihat/kelola produk & stok, lihat HPP. |
| **Akuntan** | Akuntansi, Gudang, Analisa | Jurnal, laporan, COA, lihat stok/HPP. |
| **Lihat Saja** | Gudang, Akuntansi, Analisa | Baca saja. |

Peran kustom dapat dibuat; izin baru harus didefinisikan di `src/lib/permissions.ts` dan ditambahkan ke `MODULE_PERMISSIONS` modul pemiliknya.

### 2.2 Navigasi

- **Desktop:** sidebar per modul, dikelompokkan menurut pekerjaan (Penjualan, Pengadaan, Persediaan, Pembukuan, Laporan, dll.).
- **Mobile:** drawer navigasi + topbar ringkas.
- **Command palette `Ctrl+K`:** cari halaman, produk, nota, dokumen stok; hasil disaring izin.
- **Pendaratan per peran:** pengguna satu modul mendarat di modulnya; beranda menyaring metrik sesuai izin.

---

## 3. Matriks fitur per modul

> Bagian 3.1–3.7 adalah peta fitur. Workflow rinci ada di §4–§9.

### 3.1 POS

| Fitur | Fungsi | UI | Domain/Server | Data utama | Status |
|---|---|---|---|---|---|
| Terminal kasir | Katalog, cari/scan, keranjang, qty, harga, total | `/app/pos` | `actions/pos.ts`, `server/pos/quote.ts` | `sales`, `sale_lines`, `products` | IMPLEMENTED |
| Barcode/SKU | Cocok eksak barcode produk/kemasan/SKU, fallback nama | terminal | `searchProductsAction`, cache lokal | `products`, `product_packagings` | IMPLEMENTED |
| Harga & diskon | Harga normal/grup, diskon baris, ambang izin, pembulatan | terminal | `quoteCart`, `discount` domain | `customer_group_prices`, `sales_discount` | IMPLEMENTED |
| Pajak | PPN inklusif per baris, produk bebas pajak | terminal | quote + `postJournal` | `sales.tax_total`, `tax_output` | IMPLEMENTED |
| Pembayaran | Tunai, QRIS statis, transfer, kartu, utang, split | dialog Bayar | `allocateSalePayments`, `postJournal` | `sale_payments`, `payment_methods` | IMPLEMENTED; QRIS dinamis GAP |
| Kembalian | Tunai lebih → kembalian, non-tunai berlebih ditolak | dialog | server | `sales.change_total` | IMPLEMENTED |
| Penjualan utang | Pelanggan + jatuh tempo + limit kredit | dialog | `validateReceivableTerms` | `sales.due_date`, `party_payments` | IMPLEMENTED |
| Tahan/lanjut | Hold, resume, hapus, nomor HLD | `/app/pos/ditahan` | `sales-hold.ts` | `sales.status=held` | IMPLEMENTED |
| Retur penjualan | Retur dari nota, refund/tukar/kredit toko, plafon baris | `/app/pos/retur` | `pos/returns.ts` | `sale_returns`, `sale_return_lines` | IMPLEMENTED |
| Void | Batalkan nota, stok pulih, jurnal balik, audit | riwayat/aksi | `sales-void.ts` | `sales.status=void` | IMPLEMENTED |
| Sesi kas | Buka/tutup, modal awal, kas masuk/keluar, selisih | `/app/pos/sesi` | `pos/sessions.ts` | `cash_sessions`, `cash_movements` | IMPLEMENTED |
| Riwayat sesi | Daftar & rincian sesi, cetak Z | `/app/pos/sesi/riwayat` | reports + print | `cash_sessions` | IMPLEMENTED |
| Riwayat transaksi | Cari/filter, detail, cetak ulang, faktur | `/app/pos/riwayat` | `listSales` | `sales` | IMPLEMENTED |
| Nota & faktur | Thermal 58/80, A4/A5, salinan, QR, reprint audit | `/app/pos/nota/[id]` | print engine | `sales` | IMPLEMENTED |
| Kelompok harga | Harga per pelanggan + pembulatan | `/app/pos/grup` | `catalog` | `customer_groups`, `customer_group_prices` | IMPLEMENTED |
| Promo | Diskon otomatis per produk/minimal belanja; dievaluasi sebagai diskon baris | `/app/pos/promo` | `pos-promotions` | `pos_promotions` | PARTIAL |
| Piutang pelanggan | Penagihan piutang dari POS | `/app/pos/piutang` | `pos/receivables.ts` | `party_payments` | IMPLEMENTED |
| Offline | Antrean lokal, sinkron idempoten, review konflik; batas katalog/harga grup/Electron | `/app/pos/offline` | `pos-offline.ts`, IndexedDB | `outbox` | PARTIAL |
| Desktop | Pairing, printer, update/download | `/app/pos/terminal` | device API + Electron | `pos_terminals`, `pos_pairing_codes` | IMPLEMENTED; Windows/printer fisik NOT TESTED |

### 3.2 Gudang & Pembelian

| Fitur | Fungsi | UI | Domain/Server | Data utama | Status |
|---|---|---|---|---|---|
| Master produk | SKU/barcode unik, kategori, satuan, kemasan, harga, stok minimum | `/app/gudang/produk` | `catalog`, `actions/inventory` | `products`, `product_packagings` | IMPLEMENTED |
| Kategori & satuan | Hierarki kategori, satuan, kemasan | `/app/gudang/kategori-satuan` | `catalog` | `categories`, `units` | IMPLEMENTED |
| Pemasok/pelanggan | Kode, kontak, NPWP, termin, bank, limit kredit | `/app/gudang/pemasok` | `master-data` | `suppliers`, `customers` | IMPLEMENTED |
| Duplikat pihak | Deteksi & gabung pemasok/pelanggan | `/app/gudang/pemasok/duplikat` | `master-data/merge` | `suppliers`, `customers` | IMPLEMENTED |
| Rekomendasi beli | Stok menipis → saran qty/PO | `/app/gudang/rekomendasi` | `purchasing` | stok, min | IMPLEMENTED |
| Purchase request | PR + persetujuan ambang | `/app/gudang/purchase-request` | `purchase-requests.ts` | `purchase_requests` | IMPLEMENTED |
| Purchase order | Draft → sent → partial → received/cancelled, anti-over-receipt; belum ada edit/approval PO | `/app/gudang/pembelian` | `purchasing.ts` | `purchase_orders` | PARTIAL |
| Penerimaan | Kredit/tunai/non-pembelian, batch/serial, FEFO, cetak GRN; faktur pemasok menyatu di GRN | `/app/gudang/penerimaan` | `inventory/receipts` | `stock_receipts` | IMPLEMENTED |
| Retur pembelian | Plafon asal, refund/kredit/potong/ganti | `/app/gudang/retur-pembelian` | `supplier-returns/*` | `supplier_returns` | IMPLEMENTED |
| Uang muka pembelian | Advance + alokasi ke penerimaan | `/app/gudang/uang-muka` | `purchase-advances.ts` | `purchase_advances` | IMPLEMENTED |
| Pergerakan stok | Kartu stok append-only | `/app/gudang/pergerakan` | `inventory/movements` | `stock_movements` | IMPLEMENTED |
| Nilai persediaan | AVCO, nilai total, potensi jual | `/app/gudang/nilai` | `inventory/valuation` | `stock_on_hand` | IMPLEMENTED |
| Reservasi | Reservasi stok & konsumsi POS | `/app/gudang/reservasi` | `reservations.ts` | `stock_reservations` | IMPLEMENTED |
| Transfer | Satu/dua tahap, in-transit, surat jalan | `/app/gudang/transfer` | `inventory/transfers` | `stock_documents` | IMPLEMENTED |
| Penyesuaian | Rusak/hilang/koreksi, alasan, maker-checker | `/app/gudang/penyesuaian` | `inventory/adjustments` | `stock_documents` | IMPLEMENTED |
| Opname | Hitung buta, lembar hitung, selisih bernilai, posting | `/app/gudang/opname` | `inventory/opname` | `opname_tasks` | IMPLEMENTED |
| Mode operasi | Scan-first penerimaan/penyesuaian cepat | `/app/gudang/operasi` | inventory actions | dokumen stok | IMPLEMENTED |
| Impor/ekspor | Produk, pihak, saldo awal, stok awal, pratinjau/commit; ekspor dokumen/mutasi belum lengkap | `/app/gudang/impor` | import engine | `import_jobs`, `import_rows` | PARTIAL |
| Label produk | Cetak label harga/barcode | `/app/gudang/produk/label` | print | products | IMPLEMENTED |

### 3.3 Akuntansi & Keuangan

| Fitur | Fungsi | UI | Domain/Server | Data utama | Status |
|---|---|---|---|---|---|
| COA | Bagan akun 5 digit, header/detail, kas/bank, PSAK 118 | `/app/akuntansi/akun` | `accounting`, `system-accounts` | `accounts` | IMPLEMENTED |
| Jurnal manual | Form 3 baris, auto-balance, draf, posting | `/app/akuntansi/jurnal/baru` | `accounting.postJournal` | `journal_entries` | IMPLEMENTED |
| Jurnal otomatis | POS, pembelian, beban, transfer, payroll, retur | lintas modul | `postJournal` | `journal_entries` | IMPLEMENTED |
| Buku besar | Per akun, running balance, cetak/ekspor | `/app/akuntansi/buku-besar` | `reports/ledger` | `journal_lines` | IMPLEMENTED |
| Laporan | Laba rugi, neraca, arus kas, ekuitas, neraca saldo | `/app/akuntansi/laporan` | `reports/financial` | `account_monthly_balances` | IMPLEMENTED |
| Kas & bank | Saldo, mutasi, transfer, biaya admin | `/app/akuntansi/bank` | `bank-transfers.ts` | `bank_transfers` | IMPLEMENTED |
| Rekonsiliasi bank | Impor mutasi, auto/manual match, audit match; saldo akhir & unimport belum | `/app/akuntansi/rekonsiliasi` | `bank-reconciliation.ts` | `bank_statement_*` | PARTIAL |
| Piutang/utang | Aging, pembayaran FIFO/per dokumen, write-off, kredit pihak, void pembayaran | `/app/akuntansi/piutang-utang` | `payables`, `receivables` | `party_payments` | IMPLEMENTED |
| Beban | Beban tunai/terutang, PPN masukan, daftar + void berjurnal | `/app/akuntansi/beban` | `expenses.ts` | `expenses` | IMPLEMENTED |
| Aset tetap | Daftar aset, penyusutan garis lurus | `/app/akuntansi/aset` | `fixed-assets.ts` | `fixed_assets` | IMPLEMENTED |
| Pajak | Buku PPN, rekap pajak | `/app/akuntansi/pajak` | reports | `journal_lines` | IMPLEMENTED |
| Periode | Buka/tutup/kunci, checklist ditegakkan, tutup tahun + pembalikannya | `/app/akuntansi/periode` | `fiscal-periods.ts` | `fiscal_periods` | IMPLEMENTED |
| Audit trail | Riwayat aksi & dokumen | `/app/akuntansi/riwayat` | `audit.ts` | `audit_log` | IMPLEMENTED |
| Catat transaksi | Quick entry 5 jenis + draf | modal/beranda | `quick-entry.ts` | `quick_entry_*` | IMPLEMENTED |
| Saldo awal | Akun, stok, piutang/utang awal; form AR/AP orphan | pengaturan/akuntansi | `opening-balances` | `party_opening_balances` | PARTIAL |

### 3.4 HR & Payroll

| Fitur | Fungsi | UI | Domain/Server | Data utama | Status |
|---|---|---|---|---|---|
| Karyawan | Data pribadi, kontrak, PTKP, gaji, riwayat; field statutori & joinedAt belum lengkap di UI | `/app/akuntansi/payroll`, `/karyawan/[id]` | `hr/employees` | `employees` | PARTIAL |
| Organisasi | Departemen, jabatan, atasan, shift | `/app/akuntansi/hr` | `hr/org` | `departments`, `job_positions` | IMPLEMENTED |
| Presensi | Check-in/out, terlambat, koreksi; payroll hanya memakai cuti tak berbayar | `/app/akuntansi/hr/absensi` | `hr/attendance` | `attendance_records` | PARTIAL |
| Cuti | Pengajuan, persetujuan, saldo | `/app/akuntansi/hr/cuti` | `hr/leave` | `leave_requests` | IMPLEMENTED |
| Lembur & THR | Pengajuan, aturan, komponen THR | `/app/akuntansi/hr/lembur` | `hr/overtime` | `overtime_requests` | IMPLEMENTED |
| Persetujuan HR | Inbox cuti/lembur/klaim | `/app/akuntansi/hr/persetujuan` | HR actions | approvals | IMPLEMENTED |
| Payroll | Run periode, PPh 21 TER, BPJS, slip, jurnal; konfigurasi UI mati, preview tidak akurat | `/app/akuntansi/payroll` | `payroll-indonesia.ts` | `payroll_runs` | PARTIAL |
| Kasbon | Pinjaman karyawan, potong gaji | `/app/akuntansi/kasbon` | `employee-advances.ts` | `employee_advances` | IMPLEMENTED |
| Pinjaman | Pinjaman terpisah, cicilan | `/app/akuntansi/pinjaman` | `employee-loans.ts` | `employee_loans` | IMPLEMENTED |
| Klaim | Reimbursement + approval + PPN | `/app/akuntansi/klaim` | `reimbursements.ts` | `reimbursement_claims` | IMPLEMENTED |
| Final pay | Terminasi, prorata, PPh, kasbon/pinjaman, pencabutan akses; pesangon/UPMK/UPH belum | karyawan | `hr/final-pay` | `employees`, `member`, `session` | PARTIAL |

### 3.5 Pengaturan & Platform

| Fitur | Fungsi | UI | Domain/Server | Data utama | Status |
|---|---|---|---|---|---|
| Identitas & pajak | Nama legal, NPWP, alamat, PPN, pembulatan | `/app/pengaturan?tab=umum` | settings | `company_settings` | IMPLEMENTED |
| Gudang & cabang | CRUD gudang/cabang, default | `?tab=lokasi` | `settings/lokasi` | `warehouses`, `branches` | IMPLEMENTED |
| Metode bayar | Akun penampung, fee/MDR | `?tab=pembayaran` | `settings/pembayaran` | `payment_methods` | IMPLEMENTED |
| Kelompok harga | Grup pelanggan + harga produk | `?tab=grup` | `settings/kelompok-harga` | `customer_groups` | IMPLEMENTED |
| Cetak | Template, logo, kop/kaki, QR, kertas, preview | `?tab=cetak` | print engine | `company_settings` | IMPLEMENTED |
| Modul | Saklar modul per perusahaan | `?tab=modul` | settings | modules | IMPLEMENTED |
| Penomoran | Seri dokumen | `?tab=penomoran` | `sequences.ts` | `document_sequences` | IMPLEMENTED |
| Pemetaan akun | 36 kunci akun otomatis | `?tab=akun` | `system-accounts` | `account_mappings` | IMPLEMENTED |
| Pengguna & peran | Undang/buat, role, izin, reset, cabut | `/app/pengaturan/pengguna` | `actions/users.ts` | `member`, `company_roles` | IMPLEMENTED |
| Payroll Indonesia | PTKP, TER, BPJS, upah minimum; halaman konfigurasi aktif | `/app/pengaturan/payroll-indonesia` | `payroll-indonesia.ts` | payroll config tables | IMPLEMENTED |
| Status sistem | Health, backup, migrasi | `/app/pengaturan/status` | health/backup | `audit_log` | IMPLEMENTED |
| Direktori data master | Indeks pemilik & pemakai data master lintas modul | `/app/data-master` | `master-data-directory` | semua master | IMPLEMENTED |
| Auth & tenant | Login, sesi, RLS, 2FA | `/login` | Better Auth, `withCompany` | `user`, `session`, `member` | IMPLEMENTED |
| Audit | Log aksi konsekuensial | lintas | `audit.ts` | `audit_log` | IMPLEMENTED |
| PWA/offline | Service worker, IndexedDB, sync | POS | `pos-offline` | `outbox` | IMPLEMENTED; LAN HTTP limitation |
| Electron | Desktop shell, printer, pairing, update | `pos-electron` | device API | `pos_terminals` | IMPLEMENTED; signing/Windows NOT TESTED |

### 3.6 Analisa & Beranda

| Fitur | Fungsi | UI | Domain | Status |
|---|---|---|---|---|
| Ringkasan toko | Penjualan hari ini/periode, kas/bank, piutang, utang, stok menipis | `/app` | dashboard reports | IMPLEMENTED |
| Antrean tindakan | Stok menipis, sesi, piutang/utang jatuh tempo, tahanan, migrasi | `/app` | queues | IMPLEMENTED |
| Tren penjualan | Grafik periode + preset 7/30/bulan | `/app` | sales trend | IMPLEMENTED |
| Produk terlaris | Top produk periode | `/app` | sales report | IMPLEMENTED |
| Omzet & growth | Omzet, pertumbuhan | `/app/analisa` | analytics | IMPLEMENTED |
| Margin & profit | GPM, operating profit, cash flow | `/app/analisa` | financial reports | IMPLEMENTED |
| ABC-FSN | Klasifikasi produk by omzet/frekuensi | `/app/analisa` | analytics | IMPLEMENTED |
| Turnover/GMROI/ATV | Efisiensi persediaan & transaksi | `/app/analisa` | analytics | IMPLEMENTED |
| Stockout/dead stock/shrinkage | Risiko persediaan | `/app/analisa` | analytics | IMPLEMENTED |
| Inventory accuracy | Dari opname posted | `/app/analisa` | analytics | IMPLEMENTED (bila ada opname) |

---

## 4. POS — workflow rinci

**File kunci:** `src/app/app/pos/**`, `src/components/pos/**`, `src/server/pos/**`, `src/server/actions/pos.ts`, `src/lib/pos/**`, `src/lib/escpos/**`.

### 4.1 Aktor dan entry point

| Aktor | Pekerjaan | Entry point |
|---|---|---|
| Kasir | Buka sesi, jual, retur, tahan, tutup sesi | `/app/pos`, `/app/pos/sesi` |
| Supervisor/manager | Void, diskon di atas ambang, cetak ulang, koreksi | aksi baris riwayat/sesi |
| Owner | Semua + pengaturan | `/app/pengaturan` |

### 4.2 Workflow A — buka shift dan mulai jual

1. Kasir membuka `/app/pos/sesi`.
2. Pilih cabang (opsional), isi modal awal, konfirmasi.
3. Server membuat sesi `open` milik kasir; satu sesi terbuka per kasir.
4. Kasir membuka `/app/pos`; katalog awal dimuat untuk gudang default.
5. Scan barcode / ketik SKU / cari nama / pilih kartu produk.
6. Keranjang menampilkan qty, satuan/kemasan, harga, diskon, total.

**Penjaga:** tanpa sesi terbuka, checkout ditolak. Harga dihitung server, bukan dari klien.

### 4.3 Workflow B — pembayaran

1. Kasir menekan **Bayar** (F9) → dialog fokus.
2. Pilih metode: Tunai, QRIS, transfer/kartu, atau Utang.
3. Untuk tunai: masukkan uang diterima / Uang Pas; kembalian dihitung.
4. Untuk non-tunai: referensi/konfirmasi manual; kelebihan non-tunai ditolak.
5. Untuk utang: pilih/tambah pelanggan, isi jatuh tempo, cek limit kredit.
6. Split payment: beberapa metode sampai sisa = 0.
7. Konfirmasi bayar → server quote ulang, idempotency key, commit sale.
8. Stok berkurang, kas bertambah, jurnal terbentuk, audit ditulis.
9. Nota thermal/faktur tersedia; dialog sukses menawarkan cetak.

**Penjaga:** idempotensi checkout; stok tidak negatif (kecuali kebijakan perusahaan); total pembayaran harus menutup tagihan; kredit wajib pelanggan + jatuh tempo.

### 4.4 Workflow C — tahan/lanjut

1. Dari terminal, kasir menekan **Tahan**.
2. Keranjang disimpan sebagai sale `held` dengan nomor HLD.
3. Keranjang aktif dikosongkan; kasir dapat melayani pelanggan lain.
4. Dari `/app/pos/ditahan`, kasir membuka tahanan.
5. Resume memuat baris, harga grup, gudang, pelanggan; checkout menghapus tahanan secara atomik.

**Penjaga:** tahanan diklaim atomik saat checkout; dua terminal tidak dapat menyelesaikan tahanan yang sama.

### 4.5 Workflow D — retur penjualan

1. Buka retur dari nota asal (`/app/pos/retur`).
2. Pilih baris dan qty; sistem menampilkan sisa yang dapat diretur.
3. Pilih penyelesaian: refund tunai/transfer, tukar barang, atau kredit toko.
4. Pilih kondisi barang: layak jual (restock) atau rusak (tanpa restock + reklasifikasi).
5. Posting: stok kembali bila layak jual, jurnal retur/kredit, sesi kas pemroses mencatat refund.

**Penjaga:** qty retur ≤ qty terjual − retur sebelumnya; refund tunai masuk sesi kasir yang memproses, bukan sesi asal; kredit toko terlacak nomor dokumen.

### 4.6 Workflow E — void

1. Dari riwayat, supervisor memilih **Void** dan mengisi alasan.
2. Server menandai sale `void`, mengembalikan stok, membalik jurnal, mengembalikan kredit retur yang terpakai.
3. Audit mencatat pelaku & alasan.

**Penjaga:** izin `pos.void`; dokumen posted tidak diedit; koreksi hanya lewat void/reversal.

### 4.7 Workflow F — tutup sesi

1. Kasir membuka `/app/pos/sesi`.
2. Sistem menampilkan transaksi, penjualan tunai/non-tunai, kas masuk/keluar, ekspektasi kas.
3. Kasir menghitung fisik per pecahan; selisih dihitung.
4. Bila selisih melewati toleransi, alasan wajib.
5. Konfirmasi tutup: sesi `closed`, jurnal selisih (`cash_short`/`cash_over`), audit.
6. Riwayat sesi/Z-report dapat dicetak.

**Penjaga:** satu sesi terbuka per kasir; selisih tidak dapat dihapus; transaksi void/refund terlihat dalam ekspektasi.

### 4.8 Workflow G — piutang dan offline

- **Piutang:** `/app/pos/piutang` menampilkan nota kredit; pembayaran dari POS atau akuntansi masuk ke `party_payments`, jurnal Dr Kas/Cr Piutang. **Celah:** action `payReceivableAction` mensyaratkan `pos.sell`, sedangkan halaman Akuntansi dapat menampilkan form untuk `accounting.post`; void pembayaran punya domain tetapi belum ada tombol UI.
- **Offline:** bila saklar perusahaan aktif, terminal menyimpan katalog & keranjang; checkout offline masuk IndexedDB; sinkron memakai idempotency key; konflik harga/stok masuk `/app/pos/offline` untuk keputusan manusia. **Batas:** quote web tidak membawa aturan harga grup per produk; tidak ada antrean buka/tutup sesi, retur, void, atau piutang; Electron belum punya katalog lokal.
- **Desktop:** pairing perangkat, printer OS, laci kasir, update/download; Electron memakai `pos-terminal` yang sama, tetapi pairing/updater adalah jalur Tauri legacy. Electron belum menjadi POS offline penuh.

### 4.9 Gap POS yang masih nyata

| Gap | Dampak | Status |
|---|---|---|
| Electron bukan POS offline penuh | Saat server mati dan halaman belum ter-cache, Electron berhenti di `offline.html`, bukan terminal kasir | GAP |
| Quote offline tanpa harga grup per produk | Penjualan offline berkelompok dihitung harga normal, lalu masuk review | GAP |
| Izin pembayaran piutang lintas modul | Halaman Akuntansi menampilkan form, tetapi action POS menuntut `pos.sell` | GAP |
| Void penerimaan piutang tanpa UI | Koreksi pembayaran piutang tidak bisa dari UI | GAP |
| Tukar barang bukan satu langkah | Exchange membuat voucher + penjualan pengganti terpisah | PARTIAL |
| Promo = diskon baris | Tidak ada audit redemption/prioritas/stacking; ambang diskon berlaku | PARTIAL |
| Resume hold lintas kasir | Siapa pun `pos.sell` dapat melanjutkan hold kasir lain | PARTIAL |
| QRIS dinamis via gateway/PSP | QRIS hanya gambar statis + konfirmasi manual; tidak ada webhook MPAN/NMID | GAP |
| Printer fisik & Windows | Belum diuji pada perangkat kasir nyata | NOT TESTED |
| PWA di LAN HTTP | Service worker butuh HTTPS/localhost; LAN `http://IP` tidak offline | PARTIAL |
| Electron signing/auto-update | Belum ada code signing/auto-update; Windows NSIS dibangun CI, belum diuji fisik | NOT TESTED |
| First print | Sudah memakai snapshot sale commit; replay/offline memakai fallback | IMPLEMENTED |

---

## 5. Gudang & Pembelian — workflow rinci

**File kunci:** `src/app/app/gudang/**`, `src/components/gudang/**`, `src/server/inventory/**`, `src/server/purchasing.ts`, `src/server/purchase-requests.ts`, `src/server/supplier-returns/**`, `src/server/actions/inventory*`.

### 5.1 Master data dan kemasan

1. Buat kategori/satuan (hierarki kategori).
2. Buat produk: SKU/barcode unik, satuan dasar, harga beli/jual, stok minimum.
3. Tambah kemasan (Dus/Slop/Pack) dengan faktor isi, barcode, harga.
4. Cetak label produk bila perlu.
5. Stok awal lewat impor/penerimaan bersumber saldo awal.

**Penjaga:** barcode/SKU unik per perusahaan; harga pokok historis tidak ditimpa diam-diam; kemasan menyimpan faktor snapshot di dokumen.

### 5.2 Procure-to-pay

1. **Rekomendasi pembelian** dari stok minimum.
2. **Purchase Request** (PR) dibuat; di atas ambang butuh persetujuan.
3. **Purchase Order** (PO) draft → sent → partial → received/cancelled.
4. Barang datang → **Penerimaan**:
   - kredit pemasok (utang lahir),
   - tunai (kas/bank berkurang, tanpa utang),
   - non-pembelian (stok awal/bonus/retur pelanggan/lainnya).
5. Baris penerimaan: qty diterima, batch/serial, tanggal kedaluwarsa, harga.
6. Posting: stok + AVCO, jurnal persediaan/utang/kas, PO progress.
7. Faktur pemasok dicatat; nomor duplikat per pemasok ditolak.
8. Pembayaran utang lewat akuntansi (FIFO/per dokumen).
9. Rekonsiliasi bank menutup pembayaran.

**Penjaga:** anti-over-receipt; penerimaan sebagian sah; batch wajib untuk produk track-batch; item di luar PO ditolak; void penerimaan mengembalikan progres PO.

**Catatan faktur pemasok:** Bisa ERP belum memiliki entity **vendor bill** terpisah. Nomor/tanggal faktur dan jatuh tempo adalah atribut GRN; utang lahir saat GRN. Ini cukup untuk alur “barang dan faktur datang bersamaan”, tetapi belum setara **3-way matching** PO–GRN–faktur. Bila toko menerima faktur terpisah, perlu dokumen vendor bill + matching (lihat G-18).

### 5.3 Retur pembelian

1. Pilih penerimaan asal.
2. Pilih baris & qty; plafon = qty diterima − retur sebelumnya.
3. Pilih alasan berkategori + teks.
4. Pilih penyelesaian: potong utang, kredit pemasok, refund kas, ganti barang, atau cara lain bertulis.
5. Posting: stok keluar pada AVCO, utang/klaim berkurang, kredit pemasok terbentuk bila lebih.

**Penjaga:** retur tidak boleh melebihi dokumen asal; kredit pemasok tidak dihapus diam-diam; penyelesaian bertahap terlacak.

### 5.4 Transfer dan reservasi

- **Transfer satu tahap:** kirim → stok asal keluar, stok tujuan masuk.
- **Transfer dua tahap:** kirim → `in_transit` → terima; selisih terlihat.
- **Reservasi:** mengurangi stok tersedia, bukan stok fisik; dikonsumsi saat penjualan.

**Penjaga:** setiap mutasi adalah `stock_movements` append-only; transfer tidak boleh membuat stok negatif.

### 5.5 Penyesuaian dan opname

1. **Penyesuaian** rusak/hilang/koreksi/karantina: pilih produk, qty, alasan, nilai dampak.
2. Di atas ambang nilai, maker-checker: pembuat tidak dapat menyetujui sendiri.
3. Posting: stok bergerak, jurnal selisih.
4. **Opname:** buat tugas per gudang/cakupan; cetak lembar hitung buta; hitung fisik (termasuk kemasan campuran); review selisih bernilai Rp; posting.
5. Hasil opname menjadi dasar inventory accuracy.

**Penjaga:** alasan wajib; hitung buta (angka sistem disembunyikan); dokumen posted tidak diedit.

**Catatan opname:** opname belum memakai approval threshold/maker-checker seperti penyesuaian; selisih besar dapat diposting oleh penghitung. Ini gap kontrol (G-19).

### 5.6 Batch, serial, FEFO, dan valuasi

- Produk track-batch: batch + kedaluwarsa wajib saat penerimaan; penjualan FEFO; barang kedaluwarsa diblokir.
- Produk track-serial: serial per unit; void/retur memulihkan status.
- Valuasi AVCO global per produk; nilai gudang = qty × AVCO; potensi jual dari harga jual.
- `stock_on_hand` harus selalu = Σ `stock_movements`.

### 5.7 Impor/ekspor

- Impor produk/pihak/saldo awal/stok awal: unggah → parse → pratinjau per baris → perbaiki/pilih → commit tervalidasi.
- Ekspor produk/stock/report mengikuti filter halaman.
- Deteksi duplikat barcode/SKU/kode; commit idempoten.

### 5.8 Gap gudang

| Gap | Dampak |
|---|---|
| Vendor bill/3-way matching terpisah | Faktur pemasok menyatu di GRN; belum ada matching PO–GRN–faktur |
| Approval/edit PO | PO hanya draft → kirim → batal; tidak ada revisi/approval |
| Approval opname | Selisih opname besar tidak melewati reviewer kedua |
| Freeze opname | Transaksi bisa masuk antara hitung dan posting |
| Scoping gudang/cabang | Semua pemegang `inventory.view/manage` dapat memilih semua gudang |
| Stok negatif non-POS | Setting hanya efektif di POS; dokumen gudang selalu menolak |
| Laporan/ekspor gudang | Ekspor PO/GRN/mutasi/kartu stok belum lengkap |
| Landed cost (freight/duty) | Belum membagi biaya angkut ke nilai persediaan |
| Konsinyasi | Belum ada alur barang titipan |
| Multi-currency | Harga/pembelian valas belum didukung |
| Perbandingan harga pemasok | Belum ada RFQ multi-supplier |
| Stock aging | Belum ada laporan umur stok; dead stock ada di Analisa |

---

## 6. Akuntansi & Keuangan — workflow rinci

**File kunci:** `src/app/app/akuntansi/(akuntansi)/**`, `src/components/akuntansi/**`, `src/server/accounting.ts`, `src/server/reports/**`, `src/server/actions/accounting/**`, `src/server/payables.ts`, `bank-*.ts`, `fixed-assets.ts`.

### 6.1 Jurnal otomatis

Semua modul memanggil `postJournal`:

| Sumber | Jurnal inti |
|---|---|
| POS | Dr kas/bank/piutang, Dr diskon, Cr pendapatan + PPN; Dr HPP / Cr persediaan |
| Penerimaan | Dr persediaan (+ PPN masukan), Cr utang/kas |
| Retur penjualan | Dr retur/diskon, Cr kas/piutang; stok kembali |
| Retur pembelian | Dr utang/kredit pemasok, Cr persediaan |
| Beban | Dr beban (+ PPN masukan), Cr kas/utang |
| Transfer bank | Dr tujuan + biaya admin, Cr asal |
| Payroll | Dr beban gaji/BPJS, Cr utang gaji/BPJS/PPh 21 |
| Penyusutan | Dr beban penyusutan, Cr akumulasi |

**Penjaga:** debit = kredit; periode terbuka; pemetaan akun wajib; tidak ada jurnal kedua.

### 6.2 Jurnal manual

1. Buka `/app/akuntansi/jurnal/baru`.
2. Isi tanggal, keterangan opsional, minimal dua baris akun + debit/kredit. Setiap baris dapat diberi memo sendiri; memo ikut tersimpan, tampil di detail/cetak, dan terbaca di buku besar.
3. Sistem menampilkan total, selisih, dan alasan posting nonaktif.
4. Simpan draf atau posting. `Ctrl/⌘+S` menyimpan draf; `Ctrl/⌘+Enter` memposting dengan validasi yang sama.
5. Posting: nomor jurnal, audit, buku besar, laporan.
6. Untuk jurnal berulang, buka **Duplikat** dari detail atau menu riwayat. Baris, memo, dan tag pihak tersalin ke form baru dengan tanggal hari ini; tidak ada yang tersimpan sampai draf/posting ditekan.

**Penjaga:** wajib seimbang; akun kontrol tidak boleh dijurnal manual tanpa tag subledger; periode tertutup ditolak; koreksi lewat reversal.

### 6.3 Kas, bank, dan rekonsiliasi

- Transfer antar rekening dengan biaya admin; jurnal dua kaki + beban.
- Rekonsiliasi bank: impor CSV, auto-match nominal/tanggal, manual match, write-off.
- Saat impor, operator dapat mengisi saldo akhir rekening koran + tanggal cut-off. Halaman membandingkan saldo buku per tanggal itu, menampilkan selisih, dan menandai berkas selesai hanya bila semua baris sudah tertaut.
- Berkas impor yang belum selesai bisa dihapus; berkas yang sudah selesai atau masih memiliki tautan ditolak. Semua aksi masuk audit.
- Match hanya menautkan, tidak mengubah jurnal; impor ulang tidak menggandakan.

### 6.4 Piutang, utang, dan pembayaran pihak

1. Piutang lahir dari POS kredit atau dokumen penjualan.
2. Utang lahir dari penerimaan kredit/expense terutang.
3. Pembayaran: FIFO atau per dokumen; parsial; kelebihan menjadi kredit pihak.
4. Withholding PPh 23/4(2) bila aktif; write-off dengan ambang + alasan.
5. Aging dari tanggal dokumen; subledger dan GL direkonsiliasi.

### 6.5 Aset tetap

- Daftar aset, kategori, umur, metode garis lurus.
- Proses penyusutan periodik; jurnal; nilai buku.
- Belum ada penjadwalan otomatis cron (diproses dari UI/aksi).

### 6.6 Tutup periode dan tahun

1. Selesaikan draft, rekonsiliasi, penyusutan, penyesuaian.
2. Checklist periode.
3. Tutup → kunci; buka kunci hanya owner beralasan.
4. Laporan dibaca/dicetak.
5. Tutup tahun: jurnal penutup, saldo awal tahun berikutnya.

**Penjaga:** posting ke periode tertutup/terkunci ditolak; laporan memakai snapshot konsisten.

### 6.7 Gap akuntansi

| Gap | Dampak |
|---|---|
| Approval/maker-checker jurnal, beban, transfer, AP/AR payment | Satu pengguna masih dapat membuat dan memposting/membayar sendiri |
| Lampiran bukti dokumen | Audit tidak dapat menelusuri invoice/kuitansi dari jurnal |
| Recurring journal/template | Jurnal akrual/prepaid bulanan masih diketik ulang |
| Payment run, bank file, remittance | Pembayaran pemasok massal masih per dokumen |
| Rekonsiliasi bank tanpa bank feed/API dan auto-match fuzzy | Rekonsiliasi masih manual untuk narasi/partial; saldo akhir, unimport, dan sign-off sudah ada |
| PPh 23/4(2) recap, e-Faktur/SPT | Kepatuhan pajak Indonesia belum lengkap |
| Budget vs actual, cost center/project | Belum ada laba rugi per unit/departemen |
| Multi-currency/FX dan konsolidasi | Belum ada valas, revaluasi, atau laporan grup |
| Aset: metode selain garis lurus, pajak, scheduler | Penyusutan fiskal dan otomasi belum lengkap |
| Form saldo awal AR/AP orphan | Migrasi saldo awal lewat impor/API saja |
| Observability/load test | Belum diuji volume produksi |

---

## 7. HR & Payroll — workflow rinci

**File kunci:** `src/app/app/akuntansi/(hr)/**`, `src/components/akuntansi/hr/**`, `src/server/hr/**`, `src/server/payroll-indonesia.ts`, `src/server/employee-*.ts`, `src/server/actions/hr.ts`.

### 7.1 Karyawan dan organisasi

1. Buat karyawan: identitas, kontak, NIK/NPWP, PTKP, kontrak, gaji pokok/tunjangan.
2. Tetapkan departemen, jabatan, atasan, shift.
3. Riwayat perubahan tercatat.
4. Data gaji hanya terlihat dengan `payroll.salary`.

### 7.2 Presensi, cuti, lembur

1. Presensi check-in/out (manual/CSV); koreksi berizin.
2. Cuti: ajukan → atasan menyetujui → saldo berkurang.
3. Lembur: ajukan → setujui → masuk payroll.
4. Klaim reimbursement: bukti + persetujuan + PPN masukan bila ada.

### 7.3 Payroll

1. Pilih periode; sistem menarik karyawan aktif yang sudah bergabung.
2. Hitung gaji pokok, tunjangan, lembur, insentif, potongan.
3. Hitung PPh 21 TER/Desember, BPJS per program, PTKP.
4. Potong kasbon/pinjaman sesuai rencana; gaji bersih tidak negatif.
5. Review; posting jurnal; bayar dari kas/bank.
6. Slip gaji, rekap pajak/BPJS; reversal bila koreksi.

**Penjaga:** konfigurasi statutori bertanggal efektif; komponen nonaktif tidak dihitung; payroll posted tidak diedit; akses eks-karyawan dicabut saat terminasi.

### 7.4 Kasbon, pinjaman, klaim

- Kasbon: Dr Piutang Karyawan / Cr Kas; potong gaji berikut/cicilan.
- Pinjaman: akun & alur terpisah; cicilan.
- Klaim: beban + PPN masukan; approval.

### 7.5 Terminasi dan final pay

1. Proses final pay: pesangon, prorata, potongan.
2. Status karyawan `terminated`.
3. Akses user dicabut (banned/membership) — sudah diimplementasikan.
4. Jurnal final pay.

### 7.6 Gap HR

| Gap | Dampak |
|---|---|
| `joinedAt` hilang saat edit karyawan | THR/prorata/final pay salah; riwayat masa kerja hilang |
| Field statutori karyawan tidak di UI | NIK/NPWP/PTKP/kontrak/BPJS/wilayah tidak dapat diisi; PPh/BPJS fallback |
| Wizard payroll tidak mengirim acknowledge/final period/override | Gagal di bawah UMP; koreksi potongan tidak bisa |
| Preview payroll ≠ posting | PPh/BPJS/lembur/THR/pinjaman tidak tampil di preview |
| Absensi tidak memengaruhi payroll selain cuti tak berbayar | Alpha/terlambat/insentif kehadiran belum dihitung |
| Karyawan masuk tengah bulan dibayar penuh | Kelebihan bayar pada run reguler |
| Final pay tanpa pesangon/UPMK/UPH/sisa cuti | Kepatuhan & perhitungan akhir masa kerja belum lengkap |
| ESS/portal karyawan | Slip & pengajuan masih lewat HR |
| TER harian / DTP 2026 | Sengaja belum disemai sampai angka resmi |
| Payroll mingguan | Belum didukung |
| Shift scheduling lanjutan | Baru penugasan shift, belum optimizer |
| Pengaturan payroll Indonesia | Halaman redirect; konfigurasi PPh 21/BPJS/PTKP/TER tidak dapat diubah dari UI |

---

## 8. Pengaturan & Platform — workflow rinci

**File kunci:** `src/app/app/pengaturan/**`, `src/app/app/data-master/**`, `src/components/pengaturan/**`, `src/components/shell/**`, `src/server/actions/settings/**`, `src/lib/auth.ts`, `src/lib/session.ts`, `src/proxy.ts`, `src/components/print/**`, `pos-electron/**`.

### 8.1 Onboarding perusahaan

1. Identitas legal, NPWP, alamat, telepon.
2. Pajak: tarif, PPN aktif, ambang write-off, pembulatan.
3. Gudang & cabang default.
4. COA: templat 141 akun + pemetaan 36 kunci.
5. Metode bayar + akun penampung + fee.
6. Cetak: template, logo, kop/kaki, kertas, QR.
7. Pengguna & peran.
8. Nomor dokumen & modul aktif.
9. Pairing terminal/PWA.

**Catatan kritis:** langkah 1–9 di atas mengandaikan perusahaan sudah ada. Instalasi produksi dari `deploy/install.sh` berakhir dengan database kosong, sign-up dimatikan, dan belum ada halaman/CLI bootstrap owner. Saat ini satu-satunya jalur yang membuat organisasi + owner + pengaturan adalah seed demo. Ini gap P0 (G-28) yang harus ditutup sebelum instalasi toko baru.

### 8.2 Pengguna & peran

- Undang/buat akun; pilih peran; reset password; cabut akses.
- Peran bawaan + kustom; owner terakhir dilindungi.
- Perubahan peran disimpan batch; user sendiri tidak dapat mengubah perannya.
- Sesi membaca ulang izin setiap request.

### 8.3 Cetak

- Satu mesin cetak: template global + override per dokumen.
- Nota thermal 58/80, faktur A4/A5, dokumen gudang, laporan, slip, Z-report.
- Preview memakai komponen cetak yang sama.
- Reprint historis bertanda SALINAN + audit.
- ESC/POS: printer OS/Bluetooth/USB/serial, laci kasir, cut.

### 8.4 Perangkat, PWA, Electron

- Pairing code sekali pakai + QR; token perangkat disimpan hash.
- Snapshot katalog penuh/delta untuk desktop.
- PWA: service worker, IndexedDB, offline queue.
- Electron: sandbox, contextIsolation, allowlist origin, print IPC, settings, update/download.

### 8.5 Impor/ekspor dan audit

- Impor: staging, preview, commit tervalidasi, anti-duplikat.
- Ekspor: CSV/XLSX streaming, filter sama dengan halaman.
- Audit: pelaku, aksi, before/after, waktu; append-only.

### 8.6 Gap platform

| Gap | Dampak |
|---|---|
| Bootstrap owner/perusahaan | Instalasi produksi kosong tidak punya jalur setup; runbook menyebut halaman pendaftaran yang tidak ada |
| Reset password lintas tenant | Admin perusahaan A dapat mereset kredensial user yang owner di perusahaan B |
| QRIS/audit setting sensitif | Perubahan QRIS/identitas tidak selalu diaudit; tidak wajib sesi segar |
| 2FA web | Login web belum menangani TOTP/enrollment/recovery |
| PWA manifest scope | `scope: "/app/pos/"` vs `start_url: "/app/pos"` berpotensi tidak valid |
| Token cetak pertama | Dapat dipakai ulang dalam 10 menit tanpa audit |
| Electron vs Tauri | Pairing/updater/snapshot masih jalur Tauri; Electron resmi tidak memakainya |
| Payroll Indonesia UI | Halaman pengaturan redirect; konfigurasi statutori tidak dapat diubah dari UI |
| Observability | Belum ada metrics/tracing/alert |
| Electron signing/auto-update | Belum ada code signing/updater |
| Windows/printer fisik | Belum diuji |
| PWA LAN HTTP | Tidak dapat offline di `http://IP` |
| Background jobs | Ekspor/sinkron/payroll request-time |
| Multi-currency/consolidation | Belum ada |

### 8.7 Temuan kritis platform dan statusnya (28 Nov 2026)

1. **Bootstrap kosong — SELESAI.** CLI `pnpm bootstrap` dan route `/setup` bertoken membuat owner, perusahaan, cabang, gudang, pengaturan, bagan akun, periode, payroll defaults, dan metode pembayaran. Diuji di `bootstrap-company.test.ts`.
2. **Reset lintas tenant — SELESAI.** Reset ditolak bila target juga anggota perusahaan lain dan pemanggil bukan owner di semua perusahaan itu. Sesi hanya diputus total ketika target tidak lagi menjadi anggota perusahaan mana pun. Diuji di `cross-tenant-password-reset.test.ts`.
3. **QRIS/identitas — SELESAI.** QRIS/identitas diaudit dengan hash before/after; perubahan sensitif mewajibkan sesi segar.
4. **2FA web — SEBAGIAN.** Login memproses `twoFactorRedirect`; halaman `/two-factor`, enrollment TOTP, kode cadangan, dan nonaktifkan tersedia di `/app/keamanan`. Jalur runtime 2FA belum diuji end-to-end di browser.
5. **Token cetak pertama — SELESAI.** Token dikonsumsi atomik; pemakaian kedua ditolak. Diuji di `receipt-token-once.test.ts`.
6. **Desktop terbelah — BELUM.** Pairing/updater/snapshot masih jalur Tauri; Electron resmi belum memakainya.
7. **Payroll Indonesia UI — SELESAI.** Halaman dan form dipulihkan; tautan dari Pengaturan HR ditambahkan.
8. **PWA scope — SELESAI.** `start_url` dan `scope` sama-sama `/app/pos`; kontrak SW tetap `/app/pos`.
9. **Import/export audit — SELESAI.** Impor memakai `requirePermissionInModule("import.manage","gudang")`; ekspor payroll menulis audit `payroll.export` dengan run, format, dan jumlah baris.

---

## 9. Analisa & Beranda — workflow rinci

**File kunci:** `src/app/app/page.tsx`, `src/app/app/analisa/page.tsx`, `src/components/akuntansi/charts.tsx`, `src/server/reports/overview.ts`, `src/server/reports/analysis.ts`.

### 9.1 Beranda

1. Pilih periode (7 hari/30 hari/bulan ini).
2. Baca KPI: penjualan, kas/bank, persediaan, piutang, utang.
3. Baca “Perlu tindakan”: stok menipis, sesi, piutang/utang jatuh tempo, tahanan, migrasi.
4. Lihat tren penjualan & produk terlaris.
5. Klik kartu/antrean untuk masuk ke daftar kerja.

### 9.2 Analisa bisnis

1. Pilih periode.
2. Baca omzet/growth, GPM, operating profit, cash flow.
3. Lihat tren omzet dan kinerja produk (ABC/FSN).
4. Cek turnover, GMROI, ATV, stockout, dead stock, shrinkage, inventory accuracy.
5. Drill-down ke laporan/produk.

**Penjaga:** semua indikator membaca jurnal posted/stock movement, bukan tabel agregat terpisah.

### 9.3 Gap analisa

| Gap | Dampak |
|---|---|
| Custom periode/benchmark | Periode terbatas preset |
| Ekspor analisa | Belum semua indikator diekspor |
| Forecasting | Belum ada prediksi permintaan |
| Cohort/loyalty | Belum ada analisis pelanggan |


---

## 10. Workflow lintas modul (SOP minimarket)

### 10.0 Rantai nilai yang dipetakan

| Rantai | Mulai | Selesai | Modul |
|---|---|---|---|
| **Procure-to-pay** | Rekomendasi/PR | Pembayaran utang + rekonsiliasi | Gudang → Akuntansi |
| **Order-to-cash** | Scan/keranjang | Nota, kas/piutang, jurnal | POS → Akuntansi |
| **Inventory-to-sell** | Master produk | Stok tersedia, FEFO, opname | Gudang → POS |
| **Record-to-report** | Transaksi | Jurnal, laporan, tutup periode | Semua → Akuntansi |
| **Hire-to-retire** | Karyawan | Payroll, final pay, akses dicabut | HR → Akuntansi |
| **Cash-to-bank** | Modal sesi | Setoran, rekonsiliasi bank | POS → Akuntansi |

### 10.1 Siklus harian toko

**Aktor:** kasir, supervisor, owner.

| Langkah | Sistem | Penjaga/Output |
|---|---|---|
| 1. Buka toko | Nyalakan perangkat, cek printer/scanner/jaringan | Checklist fisik; POS butuh sesi kas terbuka |
| 2. Buka sesi kas | Pilih cabang, isi modal awal, konfirmasi | Satu sesi terbuka per kasir; modal jadi acuan tutup |
| 3. Layani pembeli | Scan/cari → keranjang → diskon → bayar → nota | Harga server, stok dicek, jurnal otomatis, nota tercetak |
| 4. Kas masuk/keluar | Catat setoran/penarikan dengan alasan | Tercatat di sesi & ringkasan tutup |
| 5. Retur/void | Dari nota; refund/tukar/kredit | Plafon qty, izin, stok pulih, jurnal balik |
| 6. Tutup sesi | Hitung fisik per pecahan, bandingkan harapan per metode | Selisih wajib alasan; jurnal cash short/over; sesi terkunci |
| 7. Setor kas | Setor ke bank/brankas | Transfer bank atau cash movement; audit |
| 8. Tutup hari | Cek dashboard, Z-report, transaksi mencurigakan | Antrean tindakan, audit trail |

### 10.2 Procure-to-pay

1. Stok menyentuh minimum → rekomendasi pembelian.
2. PR dibuat; di atas ambang butuh persetujuan.
3. PO dikirim ke pemasok.
4. Barang datang → penerimaan (kredit/tunai/non-pembelian), batch/serial, qty rusak.
5. Stok bertambah, AVCO diperbarui, utang/kas terbentuk, jurnal.
6. Faktur pemasok dicatat; nomor duplikat ditolak.
7. Pembayaran utang (FIFO/per dokumen), potongan PPh bila aktif.
8. Rekonsiliasi bank menutup pembayaran.

### 10.3 Stock opname

1. Buat tugas opname per gudang/cakupan.
2. Cetak lembar hitung buta; angka sistem disembunyikan.
3. Hitung fisik, termasuk campuran kemasan.
4. Review selisih bernilai Rp; selisih besar wajib alasan.
5. Posting: stok menyesuaikan, jurnal selisih, dokumen append-only.
6. Indikator inventory accuracy di Analisa diperbarui.

### 10.4 Tutup bulan akuntansi

1. Semua transaksi periode terposting; draft diselesaikan.
2. Rekonsiliasi bank selesai.
3. Piutang/utang di-review; write-off beralasan bila perlu.
4. Penyusutan aset diproses.
5. Jurnal penyesuaian (bila ada) diposting.
6. Checklist periode → tutup → kunci.
7. Laporan laba rugi, neraca, arus kas, ekuitas dibaca/dicetak.
8. Tahun buku ditutup dengan jurnal penutup.

### 10.5 Payroll

1. Master karyawan & kontrak diperbarui.
2. Presensi, cuti, lembur, klaim disetujui.
3. Run payroll periode; komponen statutori dihitung.
4. Review komponen & potongan kasbon/pinjaman.
5. Posting jurnal payroll; bayar dari kas/bank.
6. Slip gaji dicetak/dibagikan; rekap setoran pajak/BPJS.
7. Reversal bila ada koreksi.

### 10.6 Offline & desktop

- PWA menyimpan katalog, keranjang, dan antrean penjualan di IndexedDB.
- Checkout offline memakai quote lokal cermin domain; sinkron idempoten.
- Konflik harga/stok masuk daftar peninjauan, tidak dipaksakan.
- Electron menyediakan printer OS, laci kasir, update/download, dan pairing perangkat.
- Batas: service worker butuh HTTPS/localhost; LAN `http://IP` tidak mendaftarkan PWA.

### 10.7 Peta tugas per peran

| Peran | Rutinitas harian | Rutinitas periodik |
|---|---|---|
| Kasir | Buka sesi → jual → retur → tutup sesi | Cek riwayat tahanan/nota |
| Supervisor | Review diskon/void, bantu tutup sesi | Audit transaksi menyimpang |
| Staf gudang | Cek stok menipis → terima barang → penyesuaian | Opname, transfer, review nilai persediaan |
| Akuntan | Jurnal, kas/bank, piutang/utang | Rekonsiliasi bank, laporan, tutup periode |
| HR | Presensi, cuti, lembur, klaim | Payroll, pajak/BPJS, evaluasi kontrak |
| Owner | Dashboard, antrean tindakan | Laporan keuangan, audit, keputusan harga/promo |
| Admin | Pengguna/peran, printer, perangkat | Backup/status, audit akses |

### 10.8 Event → efek lintas modul

| Event | Stok | Kas/utang/piutang | Jurnal | Dokumen |
|---|---|---|---|---|
| Penjualan POS | −FEFO | +kas/+piutang | Dr kas/piutang, Cr pendapatan + PPN; Dr HPP/Cr persediaan | Nota/faktur |
| Penerimaan kredit | +batch | +utang | Dr persediaan/Cr utang | GRN |
| Penerimaan tunai | +batch | −kas | Dr persediaan/Cr kas | GRN |
| Retur penjualan | +stok (bila layak jual) | −kas/kredit | Dr retur/Cr kas/piutang | Nota retur |
| Retur pembelian | −stok | −utang/kredit pemasok | Dr utang/Cr persediaan | RTB |
| Transfer | pindah gudang | — | — | Surat jalan |
| Penyesuaian/opname | ±stok | — | Dr/Cr selisih persediaan | Dokumen stok |
| Payroll | — | −kas/+utang gaji | Dr beban gaji/Cr kas/utang | Slip |
| Beban | — | −kas/+utang | Dr beban/Cr kas/utang | Bukti |
| Transfer bank | — | pindah rekening | Dr tujuan + fee/Cr asal | Bukti transfer |

### 10.9 Checklist SOP fisik yang dipetakan ke sistem

**Buka toko**

- [ ] Datang lebih awal, cek kebersihan & keamanan.
- [ ] Nyalakan perangkat, printer, scanner, jaringan.
- [ ] Login, buka sesi kas, hitung modal awal.
- [ ] Cek stok promo/stok menipis.
- [ ] Buka pintu, siap melayani.

**Transaksi**

- [ ] Sapa pelanggan, scan semua barang.
- [ ] Konfirmasi total, tanya member.
- [ ] Terima uang, hitung di depan pelanggan, input, serahkan kembalian.
- [ ] Berikan struk; jangan tutup laci sebelum kembalian diserahkan.

**Tutup toko**

- [ ] Layani pelanggan terakhir, kunci pintu.
- [ ] Tutup sesi, hitung kas per pecahan, cocokkan dengan sistem.
- [ ] Catat selisih + alasan; setor kas.
- [ ] Matikan peralatan non-esensial, aktifkan alarm.

**Penerimaan**

- [ ] Cocokkan surat jalan/PO, hitung qty, cek kondisi & kedaluwarsa.
- [ ] Catat qty aktual, batch/serial, faktur pemasok.
- [ ] Simpan barang; input dokumen; tanda tangan.

---

## 11. Arsitektur, framework, dan performa

### 11.1 Keputusan yang dipertahankan

| Keputusan | Alasan | Konsekuensi |
|---|---|---|
| Monolit modular Next.js | Satu toko, satu server lokal, tim kecil | Operasional sederhana; tidak perlu microservice |
| Server Components untuk baca | Data dekat DB, JS klien kecil | Halaman `force-dynamic`; caching opt-in |
| Server Actions + Zod + permission | Mutasi terpusat, tipe aman | Tidak ada API publik untuk semua mutasi |
| PostgreSQL + RLS | Isolasi tenant di database | Semua query lewat `withCompany*` |
| `postJournal` tunggal | Double-entry konsisten | Jurnal tidak bisa ditulis dari UI |
| Stock ledger append-only | Stok dapat diaudit | Koreksi lewat dokumen/void |
| Idempotency key | Retry aman | Checkout/offline tidak menggandakan |
| TanStack Table | Tabel konsisten & interaktif | Paginasi/filter besar tetap server-side |

### 11.2 Pola performa yang dipakai

- **Paginasi server** dan filter di SQL, bukan memuat seluruh dataset ke browser.
- **Keyset pagination** untuk ekspor/kartu stok/ledger.
- **Parallel query** dengan `Promise.all` untuk referensi independen.
- **Snapshot read-only** (`repeatable read`) untuk laporan/ekspor yang harus konsisten.
- **Connection pool 24** untuk 20+ terminal; tidak membuka koneksi per request.
- **Index komposit** pada `company_id + status/date/created_at` untuk tabel panas.
- **Ringkasan saldo bulanan** agar laporan tidak memindai seluruh jurnal.
- **Streaming export** agar memori tidak meledak.

### 11.3 Bukti performa terukur (lab, 2026-11-24)

Disposable PostgreSQL 18, RLS aktif, build standalone, 10.200 produk. **Bukan SLO produksi.**

| Operasi | p50 / p95 |
|---|---:|
| Scan barcode eksak | **4,33 / 6,08 ms** |
| Scan SKU eksak | 4,53 / 6,20 ms |
| Cari nama ("Aqua") | 19,35 / 21,11 ms |
| Quote 1–20 baris | 6,09–6,99 ms |
| Checkout 1 baris (commit + jurnal + stok + kas) | 39,4 / 95,2 ms |
| Scan → baris keranjang terlihat | 82–86 / 198–251 ms |
| Bayar → modal sukses | 238–303 ms (commit server 84–110 ms) |
| 8 retry dengan satu idempotency key | 1 sale row, 8 respons sukses |
| 20 penjualan serentak same-SKU | 20/20 commit, p50 787 ms, p95 1.344 ms |

Pada 100.200 produk, scan eksak turun dari 65,23 ms menjadi **4,88 ms p50** setelah indeks exact-match; pencarian teks tetap ~159 ms dan perlu debounce. Full snapshot offline 10.200 produk = 1,08 detik / 3,21 MB; delta 22,4 ms / 13,4 KB.

### 11.4 Rekomendasi arsitektur berikutnya

1. **Observability:** metrics (latency checkout/quote, DB pool, error rate, outbox backlog), tracing OpenTelemetry, alert; saat ini hanya log JSON + `/api/health`.
2. **Pindahkan pencarian read-only** (katalog POS, palette) dari Server Action ke GET route handler/Server Component; action berurutan per klien dan bisa mengantre di belakang mutasi.
3. **Background jobs:** antrean untuk ekspor besar, sinkronisasi offline, payroll, dan rekonsiliasi; saat ini dilakukan request-time.
4. **Cache Components/PPR:** pertimbangkan untuk halaman referensi yang jarang berubah; jangan cache data stok/kas/ledger/tenant sensitif tanpa kunci perusahaan + peran.
5. **Keyset pagination** untuk riwayat penjualan, ledger, pergerakan stok, dan audit log; offset tetap untuk master data terbatas.
6. **Virtualisasi** hanya setelah data besar dimuat ke klien; untuk saat ini paginasi server lebih tepat.
7. **RLS coverage test + migration lint:** pastikan setiap tabel baru ber-`company_id` memiliki FORCE RLS + policy, dan app role non-owner.
8. **Load test** pada volume target (transaksi/jam, jumlah SKU, jumlah terminal) dan uji restore/PITR.
9. **Electron signing/auto-update** dan uji printer fisik pada Windows/Linux.

### 11.4 Rujukan arsitektur

- Next.js 16 — Server and Client Components: <https://nextjs.org/docs/app/getting-started/server-and-client-components>
- Next.js 16 — Caching / Cache Components: <https://nextjs.org/docs/app/getting-started/caching>
- TanStack Table — Client-side vs Server-side: <https://tanstack.com/table/latest/docs/guide/client-side-vs-server-side>
- WCAG 2.2 — Target Size Minimum: <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>

---

## 12. Standar UI/UX, tabel, form, dan cetak

Kontrak rinci ada di `docs/DESIGN-STANDARD-TABLE-FORM.md`. Ringkasnya:

### 12.1 Tabel

- Satu `h1`, satu aksi primer, toolbar pencarian/filter + kontrol kolom.
- Header sticky; sortir langsung; angka rata kanan; aksi baris satu menu ⋯.
- Region gulir fokusabel + scrollbar tipis; kartu mobile di bawah `lg`.
- Empty state di dalam bingkai; paginasi 44px di ponsel.
- TanStack untuk tabel interaktif; paginasi/filter besar tetap server-side.

### 12.2 Form

- Label terlihat, field wajib ditandai, hint/error terhubung `aria-describedby`.
- Error summary di atas form; fokus otomatis ke ringkasan.
- Tinggi field 44px mobile / 36px desktop.
- Satu aksi utama; aksi sekunder outline/ghost.
- Konfirmasi saat meninggalkan form kotor; autofocus hanya untuk permukaan scan-first.
- `MoneyInput`/`QtyInput`/`PercentInput`/`DateField` adalah kontrol standar.

### 12.3 Cetak

- Nota: identitas badan + outlet + NPWP → metadata → item → total/PPN → pembayaran/status → banner salinan/void/retur → footer/QR.
- Kuantitas pecahan wajib benar; diskon per baris; status LUNAS/BELUM LUNAS.
- Logo tidak melebihi kertas; referensi panjang membungkus.
- Faktur A4/A5: DPP dari baris kena pajak, NPWP pembeli, rekening bank bila kredit.
- Nota sheet tidak memakai nomor halaman; laporan boleh.

### 12.4 Rujukan desain

- NN/g — Data Tables: Four Major User Tasks (2022): <https://www.nngroup.com/articles/data-tables/>
- NN/g — Progressive Disclosure: <https://www.nngroup.com/articles/progressive-disclosure/>
- SAP Fiori — Table Overview: <https://www.sap.com/design-system/fiori-design-web/v1-38/foundations/best-practices/ui-elements/tables/table-overview>
- SAP Fiori — Table Rows/empty row: <https://www.sap.com/design-system/fiori-design-web/v1-120/discover/frameworks/sap-fiori-elements/tables-and-lists/table-rows-sap-fiori-elements-2>
- WCAG 2.2 Target Size: <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>

---

## 13. Referensi workflow minimarket/ERP

### 13.1 Temuan riset yang mengubah prioritas

1. **Pencarian read-only jangan memakai Server Action.** Next.js 16 mengeksekusi Server Action secara berurutan per klien; pencarian POS/palette yang dipanggil saat mengetik dapat mengantre di belakang checkout. Pindahkan ke GET route handler/Server Component (G-25).
2. **Form dokumen panjang sebaiknya full-page, bukan modal.** PO, jurnal, opname, dan retur butuh section, sticky footer, validasi inline + ringkasan, dan guard draf.
3. **Tabel mobile butuh label per nilai.** Kartu mobile tanpa label kolom membingungkan pembaca layar dan pengguna; `mobileCard` harus menyertakan label field.
4. **Kontrol shift/opname/retur adalah titik audit.** Tambah approval opname dan vendor bill/3-way match bila faktur datang terpisah (G-18/G-20).
5. **Pisahkan drawer, session, dan device** bila beberapa terminal berbagi satu laci kas (G-26).
6. **Observability sebelum optimasi.** Tanpa trace/metrics, klaim performa tidak bisa dibuktikan (G-04).
7. **Jangan cache data stok/kas/ledger.** Cache hanya referensi (produk, satuan, COA, tarif) dengan kunci perusahaan + peran.

### 13.2 Sumber utama

| Sumber | Pelajaran yang dipakai |
|---|---|
| Odoo 20 POS Workflow | Buka register dengan modal awal; jual; refund; cash in/out; tutup register dengan hitung pecahan dan selisih; hak akses kasir/manager. <https://www.odoo.com/documentation/20.0/applications/sales/point_of_sale/use.html> |
| Odoo 20 Purchase / vendor bills | PO → receipt → vendor bill → 3-way match → payment → reconciliation. <https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/purchase/manage_deals/manage.html> |
| Odoo 20 Inventory adjustments | Hitung fisik, difference, alasan, apply; stock move tercatat. <https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html> |
| Odoo 20 Bank reconciliation | Matching otomatis/manual, write-off, jejak rekonsiliasi. <https://www.odoo.com/documentation/20.0/applications/finance/accounting/bank/reconciliation.html> |
| Odoo 20 Year-end closing | Checklist rekonsiliasi, depresiasi, pajak, penutupan. <https://www.odoo.com/documentation/20.0/applications/finance/accounting/reporting/year_end.html> |
| Majoo minimarket | Batch/serial, multi-satuan, harga grosir, pembelian, retur, opname. <https://majoo.id/bisnis/aplikasi-kasir-dan-point-of-sale-minimarket-dan-grosir> |
| Olsera POS | Offline/online, multi-outlet, transfer stok, laporan real-time, kas keluar. <https://www.olsera.com/en/pos/features> |
| Accurate Online | Persediaan, pembelian, kas/bank, rekonsiliasi, 200+ laporan. <https://accurate.id/fitur/> |
| Kelola retail | Alur buka shift → jual → stok menipis → terima barang → tutup shift → opname. <https://kelola.io/solusi/toko-ritel> |
| Kasaba SOP minimarket | Checklist buka/tutup, pembayaran tunai, penerimaan, opname, selisih kas. <https://docs.kasaba.id/industri/minimarket/sop/> (halaman bertanda “segera hadir”; dipakai sebagai ilustrasi, bukan standar formal) |
| NN/g — Mobile Tables | Tabel mobile perlu prioritas kolom, kartu, label, dan isyarat gulir. <https://www.nngroup.com/articles/mobile-tables/> |
| NN/g — EAS Framework for Simplifying Forms | Eliminate, automate, simplify; jangan membebani form dengan field yang bisa diisi sistem. <https://www.nngroup.com/articles/eas-framework-simplify-forms> |
| NN/g — UI Accelerators | Shortcut mempercepat expert, tetapi harus ditemukan dan tidak menjadi satu-satunya jalan. <https://www.nngroup.com/articles/ui-accelerators> |
| Material 3 — Density & Breakpoints | Density table boleh tinggi, tetapi target sentuh default 48dp; breakpoint 600/840/1200. <https://m3.material.io/foundations/layout/grids-spacing/density> |
| Next.js 16 — Server Actions | Action adalah POST, berurutan per klien; bukan untuk read/polling. <https://nextjs.org/docs/app/guides/server-actions> |
| OWASP — Multi-Tenant Security | RLS + FORCE + GUC per transaksi + role non-owner. <https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html> |
| Shopify POS — Cash Management | Sesi register tertutup tidak dapat dibuka/edit; hitung kas, selisih, alasan. <https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-pos> |
| Accurate — Perintah Stok Opname | Opname tidak boleh backdate; transaksi setelah hitung dapat menyebabkan selisih. <https://help.accurate.id/product/accurate-online/fitur-aol/persediaan/perintah-stok-opname/mengenal-fitur-perintah-stok-opname> |

**Catatan:** tidak ada satu “standar internasional ERP” tunggal. Yang dipakai adalah kombinasi **WCAG 2.2** untuk aksesibilitas, **SAP Fiori/NN/g** untuk pola enterprise, **Odoo/Accurate** untuk alur dokumen, dan **SOP ritel Indonesia** untuk kebiasaan operasional. Dokumen vendor menjelaskan implementasi mereka, bukan bukti usability independen; validasi akhir tetap lewat uji 5–8 kasir/supervisor/owner dan pengukuran waktu tugas, error rate, serta selisih kas.

---

## 14. Gap register dan roadmap

Prioritas: **P0** = integritas uang/stok/akses; **P1** = menghambat operasi harian; **P2** = skala/efisiensi; **P3** = kenyamanan.

Snapshot 28 November 2026: **23 IMPLEMENTED**, **12 PARTIAL**, **23 GAP**, **3 NOT TESTED**, **1 BY DESIGN**. Status tidak dinaikkan tanpa bukti test; lihat §14.0.

| ID | Prioritas | Gap | Dampak | Rekomendasi | Status |
|---|---|---|---|---|---|
| G-01 | P1 | QRIS dinamis via PSP | QRIS hanya statis + konfirmasi manual; tidak ada webhook | Integrasi MPAN/NMID + webhook + rekonsiliasi otomatis | GAP |
| G-02 | P1 | Printer fisik, Windows, Electron signing | Operasi kasir nyata belum terbukti di semua perangkat | Uji printer 58/80, laci, cut, Windows; code signing + updater | NOT TESTED |
| G-03 | P1 | PWA di LAN HTTP | Service worker tidak aktif di `http://IP` | Wajib HTTPS atau terima terminal Electron untuk offline | PARTIAL |
| G-04 | P1 | Observability | Tidak ada metrics/tracing/alert; insiden sulit didiagnosis | Metrics checkout/quote/DB pool, tracing, alert, SLO | GAP |
| G-05 | P2 | Background jobs | Ekspor/sinkron/payroll berjalan request-time | Worker queue + retry + status job | GAP |
| G-06 | P2 | Migrasi tabel legacy ke DataTable | Beberapa tabel belum punya kartu mobile/pilihan kolom | Migrasi bertahap per modul; kontrak di `DESIGN-STANDARD-TABLE-FORM.md` | PARTIAL |
| G-07 | P2 | Isyarat gulir tabel lebar | Tabel legacy bisa mengharuskan swipe tanpa petunjuk | Scroll shadow/scrollbar tipis + kartu mobile | PARTIAL |
| G-08 | P2 | Target sentuh sisa 32–36px | Beberapa aksi sekunder di ponsel masih kecil | Sapu 44px untuk aksi utama/berbahaya | PARTIAL |
| G-09 | P2 | e-Faktur/pajak | Belum ada ekspor/impor e-Faktur | Integrasi format pajak Indonesia | GAP |
| G-10 | P2 | Multi-currency & konsolidasi | Belum ada valas/laporan konsolidasi | Desain kurs, revaluasi, eliminasi | GAP |
| G-11 | P2 | Landed cost / konsinyasi / RFQ | Belum ada biaya angkut, barang titipan, perbandingan pemasok | Tambah modul purchasing lanjutan | GAP |
| G-12 | P2 | ESS & payroll lanjutan | Belum ada portal karyawan, TER harian/DTP, payroll mingguan | Prioritaskan sesuai kebutuhan operasional | GAP |
| G-13 | P3 | Saved views / status kustom / form builder | Sengaja ditahan (D-16); status enum menjaga integritas | Jangan tambah tanpa desain guard | BY DESIGN |
| G-14 | P3 | Analisa forecasting/cohort | Belum ada prediksi/cohort | Tambah setelah data 12 bulan | GAP |
| G-15 | P2 | `sales.branchId` historis | Nota memakai cabang sesi; laporan berbasis branchId bisa kosong | Isi branchId saat persist + backfill | PARTIAL |
| G-16 | P2 | Load/volume test | Belum diuji volume target (SKU/transaksi/terminal) | Load test + index review + query plan | NOT TESTED |
| G-17 | P3 | Test perangkat keras | Barcode scanner HID, printer, cash drawer | Uji lapangan | NOT TESTED |
| G-18 | P1 | Vendor bill/3-way matching | Faktur pemasok menyatu di GRN; belum ada matching PO–GRN–faktur | Buat entity vendor bill + matching bila faktur datang terpisah | GAP |
| G-19 | P2 | Approval/edit PO | PO tidak bisa direvisi; tidak ada approval PO | Edit draft/versi + approval berbasis ambang | GAP |
| G-20 | P2 | Approval opname | Selisih opname besar tidak lewat reviewer kedua | Opsi approval di atas ambang nilai | GAP |
| G-21 | P2 | Scoping gudang/cabang | Semua pemegang izin dapat memilih semua gudang | Scope per user/role + filter server-side | GAP |
| G-22 | P2 | Konsistensi stok negatif | Setting hanya efektif di POS; dokumen gudang selalu menolak | Perjelas label atau terapkan kebijakan terpisah + constraint | PARTIAL |
| G-23 | P2 | Ekspor/laporan gudang | PO/GRN/mutasi/kartu stok belum bisa diekspor | Tambah ekspor dokumen & kartu stok | PARTIAL |
| G-24 | P2 | Serial opname | Surplus serial belum bisa direkonsiliasi | Input seri temuan/alur khusus | GAP |
| G-25 | P1 | Read-only search via Server Actions | Pencarian POS/palette bisa antre di belakang mutasi | Pindahkan ke GET route handler/Server Component | GAP |
| G-26 | P2 | Drawer-centric cash model | Sesi per kasir, belum per laci fisik bersama | Pisahkan drawer/session/device bila multi-terminal | GAP |
| G-27 | P3 | Command palette belum punya recents/shortcut hints | Expert users kurang cepat menemukan aksi berulang | Tambah recents, hint shortcut, empty state | PARTIAL |
| G-28 | P0 | Bootstrap owner/perusahaan | Dulu instalasi kosong tidak bisa dipakai | CLI + `/setup` bertoken; diuji `bootstrap-company.test.ts` | IMPLEMENTED |
| G-29 | P0 | Reset password lintas tenant | Dulu admin A bisa mereset kredensial user yang owner di B | Wajib owner di semua perusahaan target; sesi hanya diputus bila target tidak lagi anggota mana pun. Diuji `cross-tenant-password-reset.test.ts` | IMPLEMENTED |
| G-30 | P1 | QRIS & setting sensitif | QRIS/identitas diaudit hash before/after; perubahan sensitif mewajibkan sesi segar | — | IMPLEMENTED |
| G-31 | P1 | 2FA web | Login, enrollment TOTP, kode cadangan, dan nonaktifkan tersedia; belum diuji e2e | Uji browser dengan akun 2FA aktif | PARTIAL |
| G-32 | P1 | PWA manifest scope | `start_url`/`scope` kini sama `/app/pos` | — | IMPLEMENTED |
| G-33 | P2 | Token cetak pertama | Dulu bisa dipakai ulang 10 menit | Dikonsumsi atomik; pemakaian kedua ditolak. Diuji `receipt-token-once.test.ts` | IMPLEMENTED |
| G-34 | P1 | Electron vs Tauri pairing/updater | Menu terminal/rilis tidak mengendalikan Electron | Satukan jalur desktop | GAP |
| G-35 | P1 | Payroll Indonesia settings UI | Halaman & form dipulihkan; tautan dari Pengaturan HR ditambahkan | — | IMPLEMENTED |
| G-36 | P2 | Import module gate & export audit | Impor bergerbang modul gudang; ekspor payroll kini diaudit | Audit ekspor keuangan lain bila diperlukan | IMPLEMENTED |
| G-37 | P2 | Company switcher hidden di mobile | Kini tampil di topbar mobile | — | IMPLEMENTED |
| G-38 | P2 | Izin tab Pemetaan akun vs aksi | Tab disaring dengan `accounting.manage` di halaman | — | IMPLEMENTED |
| G-39 | P1 | Electron bukan POS offline penuh | Server mati + halaman belum cache → `offline.html`, bukan terminal | Sediakan mesin katalog lokal atau cache shell penuh | GAP |
| G-40 | P1 | Quote offline harga grup | `priceRules` per kelompok kini dikirim ke payload quote offline | — | IMPLEMENTED |
| G-41 | P2 | Exchange bukan satu langkah | Voucher + penjualan pengganti terpisah | Alur tukar satu transaksi atau panduan jelas | PARTIAL |
| G-42 | P2 | Izin bayar piutang lintas modul | Jalur `source=accounting` memakai `accounting.post`; jalur POS tetap `pos.sell` | — | IMPLEMENTED |
| G-43 | P2 | Void penerimaan piutang | Daftar “Pembayaran terakhir” merender tombol void | — | IMPLEMENTED |
| G-44 | P2 | Promo tidak punya audit redemption/prioritas | Promo = diskon baris; sulit memisahkan promo vs diskon kasir | Audit promo, prioritas, stacking | PARTIAL |
| G-45 | P2 | Resume hold lintas kasir | Checkout menolak hold kasir lain kecuali pemegang `pos.void` | — | IMPLEMENTED |
| G-46 | P3 | Input tunai kosong | Kolom kosong ditolak; chip “Uang Pas” mengisi total | — | IMPLEMENTED |
| G-47 | P2 | Opname tidak membekukan transaksi | Stok bisa bergerak antara hitung dan posting | Snapshot/freeze per gudang atau rekonsiliasi selisih | GAP |
| G-48 | P1 | `joinedAt` terhapus saat edit | Edit tanpa field tidak lagi mengosongkan; form edit mengirim nilai | — | IMPLEMENTED |
| G-49 | P1 | Field statutori karyawan | NIK/NPWP/PTKP/kontrak/JKK/wilayah/struktur organisasi + kepesertaan BPJS per program tersedia di form | — | IMPLEMENTED |
| G-50 | P1 | Wizard payroll opsi server | Acknowledge UMP, masa pajak terakhir, dan override kasbon dikirim dari UI | — | IMPLEMENTED |
| G-51 | P2 | Preview payroll ≠ posting | Persetujuan atas angka berbeda | Preview memakai fungsi hitung yang sama | GAP |
| G-52 | P2 | Absensi tidak memengaruhi payroll selain cuti tak berbayar | Potongan alpha/insentif belum ada | Definisikan komponen kehadiran | GAP |
| G-53 | P2 | Karyawan masuk tengah bulan dibayar penuh | Kelebihan bayar | Prorata run reguler | GAP |
| G-54 | P1 | Final pay tanpa pesangon/UPMK/UPH/sisa cuti | Kepatuhan akhir masa kerja | Tambah komponen + konfigurasi | GAP |
| G-55 | P2 | Void pembayaran gaji | Jurnal pembayaran dibalik dan run kembali `posted`; diuji `payroll-reverse` | — | IMPLEMENTED |
| G-56 | P2 | Reversal tutup buku | Tombol “Balik jurnal penutup” + alasan tersedia di panel | — | IMPLEMENTED |
| G-57 | P2 | Beban tanpa daftar/void | Halaman daftar + void berjurnal dikembalikan | — | IMPLEMENTED |
| G-58 | P2 | Checklist periode | Tutup/kunci ditolak bila penyusutan/kontrol tertunda; acknowledge eksplisit tersedia | — | IMPLEMENTED |
| G-59 | P2 | Rekonsiliasi bank | Audit, saldo akhir koran, perbandingan saldo buku, sign-off, dan hapus impor tersedia | — | IMPLEMENTED |
| G-61 | P2 | Bank feed/API & auto-match fuzzy | Masih impor CSV/manual; narasi dan partial payment belum disarankan model | Integrasi bank + aturan pencocokan | GAP |
| G-60 | P2 | Impor COA kelas kas/bank | Nama akun aset lancar menginferensikan cash/bank/clearing; diuji unit | — | IMPLEMENTED |

### 14.0 Remediasi 28 November 2026

Gelombang perbaikan yang sudah masuk ke kode dan test:

| Kelompok | Gap yang ditutup | Bukti |
|---|---|---|
| Platform & akses | G-28 bootstrap CLI + `/setup`; G-29 reset lintas tenant; G-32 scope PWA; G-33 token cetak sekali pakai; G-35 halaman payroll; G-37 switcher mobile; G-38 gate tab akun | `bootstrap-company`, `cross-tenant-password-reset`, `receipt-token-once`, `pos-pwa-manifest`, `settings-nav`, `a28-v2-uiux` |
| POS | G-40 harga grup offline; G-42 izin AR akuntansi; G-43 void pembayaran; G-45 kepemilikan hold; G-46 uang tunai eksplisit | `pos-permissions-tahap3`, `pos-hold-ownership`, `pos-cash-tender`, `pos-offline-local-quote`, `workflow-remediation-ui` |
| Akuntansi | G-30 audit QRIS; G-36 audit ekspor payroll; G-55 void pembayaran gaji; G-56 reversal tutup buku; G-57 daftar/void beban; G-58 checklist periode; G-59 rekonsiliasi (audit + saldo akhir + unimport + sign-off); G-60 kelas kas/bank impor COA | `settings-audit`, `payroll-reverse`, `period-*`, `bank-reconciliation`, `bank-reconciliation-ux`, `import-account-cash-bank` |
| HR | G-48 `joinedAt`; G-49 field statutori; G-50 opsi wizard payroll | `sim2/hr-org-history`, `workflow-remediation-ui`, `payroll-reverse` |
| UX jurnal | Memo per baris, duplikat jurnal, Ctrl/⌘+Enter & Ctrl/⌘+S | `journal-copy`, `accounting-journal-ux`, e2e `akuntansi` |
| Bukti global | Unit 154 file / 1.299 test; integration 144 file / 1.134 test; sim2 29 file / 281 test; build + typecheck; e2e `akuntansi` 6/6, `table-form-guard` 4/4, `ui-neatness-guard` 4/4, `pengaturan` 3/3 | snapshot 28 Nov 2026 |

**Masih terbuka dan sengaja tidak dipaksakan:** 2FA belum diuji e2e; export payroll belum diaudit; saldo akhir/unimport rekonsiliasi belum ada; preview payroll masih belum sama dengan posting; prorata karyawan masuk tengah bulan, komponen kehadiran, pesangon/UPMK/UPH, vendor bill/3-way, PO edit/approval, scoping gudang, opname freeze/approval, serial surplus, Electron offline, dan exchange satu langkah. Ini membutuhkan keputusan produk, kontrak PSP, atau uji perangkat — bukan sekadar wiring.

### 14.1 Ditahan by design (bukan lupa)

| Fitur | Alasan |
|---|---|
| QRIS dinamis/PSP | Butuh kontrak gateway, webhook, rekonsiliasi; QRIS statis tetap jujur ditandai |
| PIN supervisor POS | Keputusan pemilik; izin peran sudah ada |
| Status dokumen kustom / form builder | Enum status adalah penjaga integritas (D-16) |
| Multi-currency | Belum ada kebutuhan tervalidasi; menambah kurs mengubah jurnal & laporan |
| Konsinyasi/landed cost | Belum menjadi kebutuhan inti minimarket yang disepakati |
| Saved views | Belum ada permintaan; filter saat ini cukup |
| ESS/portal karyawan | Ditunda sampai payroll inti stabil |

### 14.2 Keputusan yang perlu pemilik

| Keputusan | Pilihan | Dampak |
|---|---|---|
| Faktur pemasok | Tetap menempel di GRN vs vendor bill terpisah | 3-way matching, umur utang, disiplin AP |
| Laci kas | Sesi per kasir vs drawer per terminal | Shift handover, multi-terminal satu laci |
| Scope gudang | Semua gudang vs per user/cabang | Keamanan & kerapian operasi multi-cabang |
| Stok negatif | Hanya POS vs semua dokumen | Risiko selisih vs kelonggaran operasional |
| QRIS | Statis manual vs gateway dinamis | Rekonsiliasi otomatis, biaya MDR |
| Multi-currency | Ya/tidak | Kompleksitas jurnal & laporan |
| Harga/promo | Snapshot per baris vs hitung ulang | Audit harga & sengketa |

### 14.3 Urutan eksekusi yang disarankan

1. **Verifikasi rollout:** ulangi bootstrap di instalasi bersih, uji 2FA end-to-end, dan jalankan load test G-16. G-28/G-29 sudah tertutup di kode.
2. **Operasi kasir nyata:** G-02 (printer/Windows/signing), G-03 (HTTPS/PWA), G-04 (observability), G-39 (Electron offline), G-44 (audit promo).
3. **Integrasi pembayaran:** G-01 (QRIS gateway).
4. **Skala & ketahanan:** G-05 (background jobs), G-15 (`sales.branchId`), G-25 (read-only search).
5. **Keuangan lanjutan:** G-18 (vendor bill/3-way), G-61 (bank feed/auto-match fuzzy), G-09/G-10/G-11 (pajak, valas, purchasing lanjutan).
6. **Gudang:** G-19–G-24 dan G-47 (approval, scoping, ekspor, serial, freeze opname).
7. **HR lanjutan:** G-49 (enrollment BPJS), G-51–G-54 (preview, absensi, prorata, pesangon), G-12.
8. **Poles UX & analitik:** G-06, G-07, G-08, G-14, G-27.

---

## 15. Bukti dan peta test

| Area | Bukti utama |
|---|---|
| POS | `sale-flow`, `pos-guards`, `pos-returns`, `pos-hold-cash`, `pos-session-close-hardening`, `feature-matrix-pos`, `pos-offline-tahap2`, `packaging-pos`, e2e `pos-keyboard`, `pos-pwa` |
| Gudang | `goods-receipt`, `purchase-order`, `inventory-adjustment`, `feature-matrix-gudang`, `stock-batches`, `sim2/reservations-transfers`, `opname-tasks`, `import-hardening`, `packaging-warehouse` |
| Akuntansi | `journal-validation`, `reports-p2`, `payments-void-p2`, `bank-reconciliation`, `fixed-assets`, `period-integrity`, `opening-balances`, `quick-entry`, `a27-*` |
| HR | `payroll-indonesia`, `payroll-reverse`, `sim2/hr-org-history`, `sim2/hr-attendance`, `sim2/hr-leave`, `sim2/hr-overtime-thr`, `sim2/hr-loans-reimbursement`, `final-pay` |
| Platform | `pos-device-api`, `print-settings`, `a28-ui2-print-surfaces`, `user-management`, `cross-tenant-password-reset`, `bootstrap-company`, `receipt-token-once`, `settings-audit`, `sim2/rbac-matrix`, `company-switch`, `backup-status` |
| UI/UX | 154 file / 1.299 unit test, 144 file / 1.134 integration, 29 file / 281 sim2, e2e `akuntansi` 6/6, `table-form-guard` 4/4, `ui-neatness-guard` 4/4, `pengaturan` 3/3 |
| Cross-module | `audit-a2-chains`, `consistency`, `erp-concurrency-remediation` |

**Celah bukti yang terlihat:** belum ada e2e HR/payroll; 2FA belum diuji e2e; preview payroll vs posting belum setara. Saldo akhir, unimport, dan sign-off rekonsiliasi kini punya test domain/UX; bank feed/API dan auto-match fuzzy belum ada. `joinedAt`, izin AR, reversal tutup buku, void beban, dan void pembayaran gaji kini sudah punya test regresi.

**Batasan bukti:** count test berubah seiring pekerjaan; angka di dokumen ini adalah snapshot 28 November 2026. Test bukan bukti perangkat keras, beban produksi, atau semua jalur dinamis.

---

## 16. Lampiran — keluarga rute

| Modul | Jumlah halaman | Contoh rute |
|---|---:|---|
| Beranda | 1 | `/app` |
| POS | 17 | `/app/pos`, `/app/pos/riwayat`, `/app/pos/sesi`, `/app/pos/nota/[id]` |
| Gudang | 37 | `/app/gudang/produk`, `/app/gudang/penerimaan`, `/app/gudang/opname`, `/app/gudang/nilai` |
| Akuntansi + HR | 41 | `/app/akuntansi/jurnal`, `/app/akuntansi/laporan`, `/app/akuntansi/payroll`, `/app/akuntansi/hr/**` |
| Data Master | 1 | `/app/data-master` |
| Pengaturan | 4 | `/app/pengaturan`, `/pengguna`, `/payroll-indonesia`, `/status` |
| Analisa | 1 | `/app/analisa` |
| Akun | 1 | `/app/keamanan` (2FA) |
| Publik | 3 | `/login`, `/two-factor`, `/setup` |
| API | 32 route | `/api/pos/*`, `/api/export/*`, `/api/import/*`, `/api/health` |

Daftar rute lengkap dapat dihasilkan dari `find src/app/app -name page.tsx`; route group `(akuntansi)`, `(cetak)`, dan `(hr)` tidak mengubah URL publik.
