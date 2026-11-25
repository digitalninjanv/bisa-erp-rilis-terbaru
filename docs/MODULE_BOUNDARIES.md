# Batas Modul — Bisa ERP

**Dokumen resmi program A-24 (ditulis di T8, 2026-11-06).** Menetapkan
kepemilikan wilayah: modul, rute, domain server, izin, dan kontrak
integrasinya. Sumber keadaan: `src/lib/modules.ts`, `src/lib/permissions.ts`,
struktur `src/server/`, audit Graphify (`docs/CODEBASE_AUDIT.md`), hasil
T2 (modul HR). Melanggar dokumen ini = temuan arsitektur.

## 1. Empat modul pengalaman + satu cangkang platform

| Modul (`ModuleKey`) | Dunia pengguna | Rute | Izin pemilik | Saklar perusahaan |
|---|---|---|---|---|
| `pos` | Terminal kasir & sesi kas | `/app/pos/**` | `pos.sell`, `pos.return`, `pos.void`, `pos.discount`, `pos.session` | Ya |
| `gudang` | Stok & dokumen gudang | `/app/gudang/**` | `inventory.view`, `inventory.manage` | Ya |
| `akuntansi` | Jurnal, utang/piutang, kas/bank, laporan, periode | `/app/akuntansi/**` (di luar grup HR) | `accounting.view`, `accounting.manage` | Ya |
| `hr` | Karyawan, presensi, cuti, lembur, kasbon/pinjaman/klaim, payroll | Rute lama di bawah `/app/akuntansi/…` (route group `(hr)`): `hr/*`, `karyawan`, `kasbon`, `pinjaman`, `klaim`, `payroll` — **URL tidak berpindah di T2** | `payroll.view`, `payroll.manage` | Ya — dan 33 gerbang aksi keluarga payroll mengikutinya |
| — (platform) | Beranda & Pengaturan (cangkang sendiri, bukan modul) | `/app`, `/app/pengaturan/**` | `settings.manage`, `users.manage` | Selalu aktif |

Aturan pengalaman: sesudah login pengguna mendarat di pekerjaan perannya
(`src/lib/landing.ts`); sidebar hanya memuat dunia modul aktif; pengalih
modul hanya menampilkan modul yang boleh dimasuki peran ∩ saklar aktif;
halaman tanpa izin memantul ke beranda dengan banner penjelasan
(`requirePermissionPage`), tidak pernah halaman rusak.

## 2. Kepemilikan domain server

| Wilayah | Pemilik (`src/server/`) | Boleh dipanggil oleh |
|---|---|---|
| Penjualan, retur penjualan, sesi, offline sync | `pos/`, `pos.ts`, `pos-offline.ts`; aksi `actions/pos.ts`, `actions/pos-offline.ts` | Terminal POS; peninjauan konflik (akuntansi membaca hasil, tidak menulis jalur ini) |
| Stok, penerimaan, opname, penyesuaian, transfer, reservasi, seri, batch | `inventory/`, `reservations.ts`, `serials.ts`, `batches.ts` | Gudang; POS membaca stok lewat domain (tidak menyentuh tabel stok dari UI) |
| Pembelian & retur pemasok | `purchasing.ts`, `purchase-requests.ts`, `supplier-returns/` | Gudang (dokumen), Akuntansi (utang yang lahir darinya) |
| Jurnal & laporan | `accounting.ts`, `reports/` | Semua domain memanggil `postJournal`; hanya akuntansi yang membaca GL untuk laporan |
| Utang/piutang & pembayaran pihak | `payables.ts`, `party-credits.ts`, `party-writeoffs.ts`, `payment-fees.ts`, `payment-deductions.ts` | Akuntansi; POS untuk kredit pelanggan (penebusan) lewat domain yang sama |
| Kas/bank & rekonsiliasi | `bank-transfers.ts`, `bank-reconciliation.ts`, `expenses.ts` | Akuntansi |
| Karyawan s.d. payroll | `hr/`, `hr.ts`, `payroll-indonesia.ts`, `employee-advances.ts`, `employee-loans.ts`, `reimbursements.ts`; aksi `actions/hr.ts` + berkas kasbon/pinjaman/klaim | HR; Akuntansi hanya *menerima* jurnal ringkasan payroll lewat `postJournal` |
| Master data & platform | `master-data.ts`, `catalog.ts`, `import-*.ts`, `sequences.ts`, `idempotency.ts`, `audit.ts`, `palette.ts`, `quick-entry.ts` | Semua modul lewat aksi platform; `quick-entry` adalah konsentrator yang disadari (kontrak D-23: pratinjau == posting dari lib bersama) |

## 3. Kontrak integrasi antarmodul (satu-satunya jalur sah)

1. **Lewat jurnal:** modul operasional tidak menulis jurnal dengan
   caranya sendiri — semua lewat `postJournal` dengan pemetaan akun per
   perusahaan. Akuntansi tidak mengimpor balik domain operasional untuk
   menulis.
2. **Lewat domain, bukan tabel:** halaman & aksi tidak menyentuh tabel
   modul lain; kebutuhan lintas modul dipenuhi fungsi domain pemiliknya
   (ditegakkan ratchet jalur baca ARS1-01 untuk pembacaan halaman).
3. **Lewat dokumen:** retur merujuk dokumen asal (plafon terkunci),
   pembayaran melunasi dokumen (FIFO/per dokumen), kredit pihak merujuk
   dokumen kelahirannya — referensi dokumen adalah kontraknya, bukan
   nominal bebas.
4. **Idempotensi di perbatasan:** setiap penyerahan yang bisa berulang
   (checkout, sinkronisasi offline, impor, pembayaran form) membawa kunci
   idempotensi; pengulangan = `duplicate` yang aman.

## 4. Pengecualian & ketegangan yang tercatat (bukan pelanggaran diam-diam)

- **Terminal POS tidak disentuh** sejak perintah pengguna 2026-11-05
  21:50 (`src/app/app/pos/**`, `src/components/pos/**`). Konsekuensinya:
  dokumen POS tidak mendapat aksi Rincian Jurnal (T4 membatasi ke
  dokumen non-POS); tutup sesi terpandu (SIS-10) dan PIN supervisor
  (POS3-12) menunggu keputusan pemilik. Perubahan kemampuan kasir
  `pos.return` (`7079687`) adalah perubahan *izin* di `src/lib/
  permissions.ts`, bukan perubahan terminal, dan bisa dibalik satu
  perintah.
- **Rute HR di bawah `/app/akuntansi/…`** adalah keputusan sadar T2
  (route group, nol URL berubah, nol tautan/penanda rusak) — batas
  *pengalaman & kepemilikan kode*-nya tegas, batas *alamat*-nya memang
  warisan. Memindah URL adalah pekerjaan terpisah bila pemilik
  menginginkan.
- **Catat Transaksi (`quick-entry`)** memang dirancang sebagai titik
  temu lintas domain di dalam modul akuntansi; mitigasinya adalah
  kontrak pratinjau==posting dari satu lib bersama (D-23) dan ia tidak
  menulis semantik baru — hanya membungkus domain pemilik yang ada.
- **Siklus tipe `permissions.ts ↔ modules.ts`** (`import type` dua arah):
  terhapus saat runtime, graf membuktikan 0 siklus impor runtime.
  Dicatat agar tidak "diperbaiki" menjadi perubahan besar tanpa alasan.

## 5. Menambah modul/fitur baru — aturan main

1. Fitur masuk ke modul pemiliknya; bila benar-benar lintas modul,
   kontraknya adalah salah satu dari §3 — bukan impor silang UI.
2. Izin baru didefinisikan di `src/lib/permissions.ts` dan ditambahkan
   ke `MODULE_PERMISSIONS` modul pemiliknya; template peran bawaan
   diubah hanya lewat konstanta `BUILTIN_ROLES` (peran kustom tidak
   ditimpa).
3. Angka bisnis baru (tarif/ambang/batas) masuk sebagai konfigurasi
   per perusahaan (pola D-25), bukan konstanta.
4. Fungsi baca baru untuk halaman tinggal di modul server pemiliknya
   dengan nama & tipe eksplisit (ratchet ARS1-01 akan menolak pola lain
   di suite).
5. Setiap dokumen uang/stok baru wajib: seri penomoran sendiri, jurnal
   lewat `postJournal` atau gerakan lewat Stock Ledger, koreksi via
   void/reversal, dan baris matriks verifikasi di putaran QA berikutnya.

## 6. Kontrak kepemilikan tulis tabel bersama (A-26 Q9, K-09)

Audit A-26 K-09 menemukan tabel yang ditulis banyak area **tanpa
kontrak tertulis** — sebagian besar sah by-design, cacatnya adalah
tidak tertulisnya. Bagian ini kontraknya. Keadaan diverifikasi ulang
di Q9 (2026-11-06) dengan memindai seluruh `src/` untuk pola tulis
Drizzle `.insert/.update/.delete(<tabel>)`: **95 tabel punya penulis
produksi; 22 di antaranya ditulis ≥2 domain.** `src/db/seed.ts`
menulis semua tabel saat bootstrap demo dan **dikecualikan** dari
kontrak ini (bukan jalur produksi).

**Aturan mengubah tabel bersama:**

1. Mengubah *perilaku* tabel bersama dilakukan lewat fungsi domain
   pemiliknya. Penulis lain hanya sah dalam pola yang tercatat di
   tabel bawah (pastikan-ada, penyelesaian dokumen, tunjuk-ulang FK
   gabung, penyediaan baris kunci) — pola baru = ubah kontrak ini
   dulu.
2. Penulis baru (berkas/domain) atas tabel bersama wajib memperbarui
   bagian ini **dan** peta beku di
   `tests/unit/architecture-table-writers.test.ts` dalam perubahan
   yang sama; test itu menggagalkan suite bila himpunan penulis
   berubah tanpa pembaruan kontrak.
3. Jangkar yang sudah benar dan tidak boleh dilemahkan:
   `journalEntries`/`journalLines` hanya ditulis `server/accounting.ts`
   (gerbang `postJournal`), dan perubahan kuantitas `stockOnHand`
   hanya lewat `server/inventory/movements.ts` (posting Stock Ledger).

**Pola lintas yang berulang:** `server/master-data/merge.ts` muncul
sebagai penulis `update` di banyak tabel — itu satu-satunya tempat
gabung pihak/produk duplikat menunjuk-ulang FK dokumen ke entitas
hasil gabungan; by-design dan memang harus terpusat di sana.

| Tabel | Pemilik | Penulis lain yang sah (berkas — pola/alasan) |
|---|---|---|
| `branches`, `warehouses` | Platform/Pengaturan (`server/actions/settings/lokasi.ts` CRUD lokasi) | Impor `server/import/commit-locations.ts` — insert saat commit impor cabang/gudang; duplikat kode/nama dilewati. Kuantitas `stockOnHand` tidak disentuh jalur ini |
| `customerGroups` | Platform/Pengaturan (`server/actions/settings/kelompok-harga.ts` CRUD kelompok harga) | Impor `server/import/commit-commerce.ts` — insert kelompok harga saat commit; nama duplikat dilewati |
| `paymentMethods` | Platform/Pengaturan (`server/actions/settings/pembayaran.ts` CRUD metode pembayaran) | Impor `server/import/commit-commerce.ts` — insert metode pembayaran saat commit; kode/nama duplikat dilewati, akun sumber divalidasi |
| `employees` | HR (`server/actions/hr/karyawan.ts` CRUD; `server/hr/final-pay.ts` update status terminasi lewat proses final pay) | Impor `server/import/commit-hr-assets.ts` — insert karyawan saat commit; kode/NIK duplikat dilewati |
| `customers` | Master Data (CRUD: `server/actions/inventory/pihak.ts`) | POS `server/actions/pos.ts` — insert tambah pelanggan cepat di terminal untuk penjualan kredit (D-19). Impor `server/import/commit.ts` — insert saat commit impor. Pengaturan `server/actions/settings/kelompok-harga.ts` — update melepaskan `groupId` saat grup harga dihapus |
| `suppliers` | Master Data (CRUD: `server/actions/inventory/pihak.ts`) | Impor `server/import/commit.ts` + `server/actions/import/commit-phases.ts` — insert saat commit impor |
| `products` | Gudang (`server/actions/inventory/produk.ts` CRUD; `server/inventory/movements.ts` update `costPrice` AVCO sebagai bagian posting ledger stok) | Impor `server/actions/import/commit-phases.ts` — insert/update saat commit. Platform `server/master-data/bulk-edit.ts` — update edit massal; `server/master-data/merge.ts` — update gabung produk |
| `categories`, `units` | Gudang (`server/actions/inventory/taksonomi.ts` CRUD) | Impor produk `server/actions/import/commit-phases.ts` dan impor master `server/import/commit.ts` — insert temukan-atau-buat saat commit |
| `accounts` | Akuntansi (`server/actions/accounting/akun-pemetaan.ts` CRUD) | Pola "pastikan akun sistem ada" kini TERPUSAT di `server/system-accounts.ts` (`ensureSystemAccounts`, Program Rekayasa R3 K-2, 2026-11-08): satu-satunya penulis pola ini — pembungkus tipis di `server/fixed-assets.ts`, `server/payment-deductions.ts` & `server/payroll-indonesia.ts` hanya menyerahkan spec akun bawaannya. `server/fixed-assets.ts` tetap penulis untuk langkah penandaan kontra A-27 B5 (update `isContra`/`contraOf` akumulasi penyusutan sesudah ensure). Impor `server/import/commit.ts` — insert baris impor bagan akun. Penanam templat perusahaan baru (A-27 B6): `server/accounting.ts` (`seedChartOfAccounts`) menanam bagan 5 digit utuh dari `lib/akuntansi/chart-template.ts` untuk perusahaan yang belum berakun. Alat migrasi perusahaan berjalan (A-27 B7): `server/coa-migration.ts` — update `code`/atribut templat akun yang di-renumber + insert akun templat yang hilang, hanya dalam transaksi migrasi opt-in pemilik (dry-run → konfirmasi eksplisit per perusahaan; tidak pernah otomatis) |
| `accountMappings` | Akuntansi (`server/actions/accounting/akun-pemetaan.ts`) | Pola pastikan-ada yang sama, terpusat di `server/system-accounts.ts` (R3 K-2): ketiga domain di atas tidak lagi menulis pemetaan langsung. Penanam templat (A-27 B6): `server/accounting.ts` (`seedChartOfAccounts`) menanam seluruh 36 kunci bersama akun templatnya dalam satu transaksi. Impor pemetaan master: `server/import/commit.ts` — upsert per kunci setelah kontrak tipe akun divalidasi. Alat migrasi (A-27 B7): `server/coa-migration.ts` — insert pemetaan HANYA untuk kunci yang belum terpetakan, menunjuk akun templat baru yang dibuatnya dalam transaksi migrasi yang sama; pemetaan yang sudah ada tidak pernah dialihkan |
| `sales` | POS (insert: `server/pos/sales-hold.ts`, `sales-persist.ts`; update status/penyelesaian: `sales-void.ts`, `returns.ts`, `receivables.ts`) | Akuntansi `server/party-writeoffs.ts` — update menandai penjualan lunas lewat penghapusan piutang. Platform `server/master-data/merge.ts` — tunjuk-ulang FK pelanggan |
| `partyPayments` | Akuntansi (`server/payables.ts` — mesin pembayaran bersama; `server/opening-balances/payments.ts` — pembayaran saldo awal; `server/party-writeoffs.ts` — pembayaran penghapusan) | POS `server/pos/receivables.ts` insert & void — penagihan piutang penjualan kredit di terminal & pembatalannya (`sales-void.ts` untuk void penjualan). Platform `server/master-data/merge.ts` — tunjuk-ulang FK pihak |
| `partyOpeningBalances` | Akuntansi (`server/opening-balances/documents.ts` insert/update; `payments.ts` update) | Pembelian `server/supplier-returns/payables.ts` — update: retur mengurangi saldo utang awal. Akuntansi `server/party-writeoffs.ts` — update penghapusan atas saldo awal. Platform `server/master-data/merge.ts` — tunjuk-ulang FK pihak |
| `stockReceipts` | Gudang (`server/inventory/receipts.ts` insert; `receipt-void.ts` update void; `receipt-invoice.ts` koreksi nomor faktur pemasok yang mengunci pemasok dan menolak nomor duplikat) | Penulis kolom pembayaran (`paidAmount`/status bayar) yang sah: Akuntansi `server/payables.ts` & `server/party-writeoffs.ts`; Pembelian `server/supplier-returns/payables.ts` (retur menutup utang penerimaan). Platform `server/master-data/merge.ts` — tunjuk-ulang FK |
| `stockOnHand` | Gudang — **kuantitas hanya berubah lewat `server/inventory/movements.ts`** | Penyediaan/pembersihan baris (bukan kuantitas berjalan): `server/batches.ts` & `server/reservations.ts` insert baris kosong `onConflictDoNothing` agar bisa dikunci FOR UPDATE; `server/actions/inventory/produk.ts` delete saat produk dihapus; `server/actions/settings/lokasi.ts` delete saat gudang dihapus |
| `stockDocuments` | Gudang (`server/inventory/{opname,adjustments,adjustments-post,transfers,transfers-receive,documents}.ts`) | Platform `server/master-data/merge.ts` — tunjuk-ulang FK saat gabung |
| `purchaseOrders` | Pembelian (`server/purchasing.ts`) | Platform `server/master-data/merge.ts` — tunjuk-ulang FK pemasok |
| `purchaseAdvances` | Pembelian (`server/purchase-advances.ts`) | Platform `server/master-data/merge.ts` — tunjuk-ulang FK pemasok saat gabung pihak |
| `partyCredits` | POS (`server/party-credits.ts`) | Platform `server/master-data/merge.ts` — tunjuk-ulang FK pihak saat gabung pihak |
| `expenses` | Akuntansi (`server/expenses.ts`, `server/payables.ts`, `server/party-writeoffs.ts`) | Platform `server/master-data/merge.ts` — tunjuk-ulang FK pihak saat gabung pihak |
| `supplierReturns` | Pembelian (`server/supplier-returns/{returns,posting,resolutions}.ts`) | Platform `server/master-data/merge.ts` — tunjuk-ulang FK pemasok |
| `idempotencyKeys` | Platform (`server/idempotency.ts` — helper klaim untuk aksi umum) | POS `server/pos/sales-create.ts` & `server/pos/receivables.ts` — klaim kunci **harus satu transaksi** dengan checkout/pembayaran piutangnya (klaim hidup & gugur bersama transaksi penjualan; `onConflictDoNothing` lalu baca hasil pemenang) |
| `payrollStatutorySettings`, `payrollStatutoryPrograms`, `payrollPtkpStatuses`, `payrollStatutoryParameters`, `payrollTerBrackets`, `payrollMinimumWages` | HR (konfigurasi statutori Payroll Indonesia) | Dua penulis berlapis, keduanya HR: `server/actions/payroll-indonesia.ts` — aksi Pengaturan (suntingan pengguna, insert/update bertanggal efektif); `server/payroll-indonesia.ts` — domain (penyemaian konfigurasi bawaan per perusahaan saat pertama diaktifkan, pola pastikan-ada). Tidak ada penulis ketiga yang sah |
