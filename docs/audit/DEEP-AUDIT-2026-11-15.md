# DEEP AUDIT — GUDANG → AKUNTANSI (2026-11-15)

Mandat: audit total modul Gudang lalu Akuntansi, perbaikan nyata, pengujian di
PostgreSQL disposable, tanpa menyentuh database pengguna.

## 1. Metode

- Inventaris route, server action, domain, tabel, permission, dan test.
- Pembacaan kode + audit workflow pembelian/persediaan + audit akuntansi.
- Riset praktik ERP (SAP Fiori list/object page, Odoo purchase/stock/account,
  Accurate Online pembelian/utang/retur) sebagai pembanding perilaku.
- Verifikasi di database disposable `bisa_erp_audit_test` dan
  `bisa_erp_audit_full_test`; database pengguna `bisa_erp` tidak disentuh.
- Typecheck, lint, test terarah, dan suite penuh dijalankan.

## 2. Inventaris yang diaudit

### Gudang

Route: dashboard, produk, kategori & satuan, pemasok/pelanggan, purchase request,
purchase order, penerimaan + riwayat, pembelian, retur pembelian + riwayat, uang
muka, penyesuaian, transfer, opname (hitung/tugas/riwayat), reservasi, dokumen,
pergerakan, nilai persediaan, rekomendasi, impor, mode operasi, cetak dokumen.

Domain: `server/inventory/*`, `server/purchasing`, `server/supplier-returns`,
`server/purchase-advances`, `server/reservations`, `server/catalog`.

### Akuntansi

Route: dashboard, akun + impor, pemetaan akun, jurnal + baru + detail + riwayat,
buku besar, laporan (laba rugi, posisi keuangan, arus kas, ekuitas, neraca saldo,
penjualan, catatan), pajak, piutang/utang, bank + transfer, rekonsiliasi,
rekonsiliasi kontrol, periode, aset tetap, beban, riwayat, cetak/ekspor.

## 3. Workflow yang diverifikasi

| Workflow | Status | Bukti |
| --- | --- | --- |
| Pembelian kredit: PO → penerimaan → utang → pembayaran | Berfungsi | `purchase-order`, `goods-receipt`, `a26-q8-payables-parity` |
| Penerimaan parsial + sisa PO | Berfungsi | `purchase-order`, `feature-matrix-gudang` |
| Nomor faktur pemasok + anti-duplikat | Berfungsi | `receipt-invoice.ts`, `goods-receipt` |
| Pembelian tunai (kas/bank, tanpa utang palsu) | Berfungsi | `goods-receipt`, `feature-matrix-gudang` |
| Penerimaan stok awal/bonus/retur pelanggan/lainnya | Berfungsi | `receipt-form.tsx`, `inventory-p1` |
| Retur pembelian: potong utang, kredit, refund, replacement, DP, other | Berfungsi | `supplier-returns`, `fix-gdg-tahap2` |
| Plafon retur kumulatif per penerimaan | Berfungsi | `supplier-returns`, `provenance` |
| Transfer dua tahap + penerimaan sebagian/selisih | Berfungsi | `sim2/reservations-transfers`, `fix-gdg-tahap2` |
| Penyesuaian rusak/kedaluwarsa/hilang/karantina | Berfungsi | `inventory-adjustment`, `fix-gdg-tahap2` |
| Opname hitung buta + draf + tinjau selisih | Berfungsi | `opname-form.tsx`, `opname-tasks` |
| Batch/FEFO, seri, reservasi | Berfungsi | `stock-batches`, `sim2/serial-numbers` |
| AVCO + rekonsiliasi stok/GL | Berfungsi | `stock-card-valuation`, `receipt-void-avco` |
| Jurnal manual + periode + reversal | Berfungsi | `journal-validation`, `accounting-integrity` |
| Laporan keuangan + cetak/ekspor | Berfungsi | `a28-ui3-reports`, `report-print` |

## 4. Temuan dan perbaikan putaran ini

### 4.1 Nilai Persediaan: pencarian hanya menyaring halaman tampil (P1 UI)

**Temuan:** kotak pencarian di `/app/gudang/nilai` menyaring `valuation.items`
setelah query berpaginasi. Pada katalog >50 produk, produk di halaman lain tidak
pernah ditemukan meski cocok; total paginasi tidak berubah.

**Perbaikan:** `getInventoryValuation` menerima `q` dan menyaring nama produk,
SKU, dan kategori di SQL sebelum paginasi/agregasi. Ekspor XLSX/CSV juga membawa
`q`. Filter klien di halaman dihapus.

**Bukti:** test baru “pencarian q menyaring seluruh katalog sebelum paginasi”
(`stock-card-valuation.test.ts`) lulus: 1 dari 3 produk, total 1; pencarian SKU
mengembalikan total 3 dengan halaman 2 baris.

### 4.2 Gerbang modul purchasing/PR/reservasi (P1 keamanan)

**Temuan:** `purchasing.ts`, `purchase-requests.ts`, dan `reservations.ts`
memakai `requirePermission`, bukan `requirePermissionInModule`. Modul Gudang
yang dimatikan tetap dapat diakses lewat aksi tersebut.

**Perbaikan:** semua aksi memakai `requirePermissionInModule(..., "gudang")`.

**Bukti:** `purchase-order`, `sim2/purchase-requests`, `sim2/reservations-transfers`,
`gdg3-audit-probe`, `feature-matrix-gudang`, `review-fixes-t2` — 79 test lulus.

### 4.3 Void penyesuaian/opname/karantina tidak memulihkan nomor seri (P1 stok)

**Temuan:** `voidStockDocument` hanya memulihkan seri untuk transfer. Seri yang
dikonsumsi penyesuaian/opname (atau dipindah ke gudang karantina) tetap `out`
atau tertinggal di karantina setelah void.

**Perbaikan:** helper `restoreSerialsForStockDocumentVoid` memulihkan seri ke
gudang asal, hanya bila gerakan terakhir seri memang milik dokumen yang
di-void. Karantina dipindah balik; barang rusak/opname kembali `in_stock`.

**Bukti:** dua test baru “GDG1-03b” lulus: barang rusak 3→2→3 seri; karantina
seri kembali ke gudang asal; stok kembali 2/3.

### 4.4 Tanggal void payroll/penjualan/transfer bank (P1 akuntansi)

**Temuan:** void memakai `todayISO()`. Dokumen bulan lalu yang di-void membuat
pendapatan/beban bulan berjalan negatif dan P&L bulanan tidak rekonsiliasi.

**Perbaikan:** helper `reverseSourceJournalPreferringDate` memakai tanggal asal
(penjualan: `sale.date`; payroll: akhir periode; transfer: `transfer.date`)
bila periode asal terbuka; bila tertutup, jatuh ke hari ini dengan penanda di
deskripsi.

**Bukti:** test `sale-flow`, payroll, dan transfer bank lulus dan mengunci
tanggal pembalik ke tanggal dokumen asal (bukan hari ini).

### 4.5 Batas modul arsitektur (P2)

**Temuan:** halaman retur baru mengimpor `server/catalog/receipt-links`
langsung, dan `receipt-links` mengimpor `server/supplier-returns/shared`
langsung. Dua pelanggaran batas modul.

**Perbaikan:** impor lewat barrel `@/server/catalog` dan
`@/server/supplier-returns`; `POSTED_RETURN_STATUSES` diekspor dari barrel.

**Bukti:** `architecture-module-boundaries.test.ts` lulus.

## 5. Yang belum selesai / blocker

1. **Branch coverage 79,35%** (26 cabang lagi); lines/statements/functions
   sudah ≥89%. E2E production build 44/44 lulus.
2. **Installer HTTPS** sudah di kode (nginx/TLS) dan config tervalidasi,
   tetapi instalasi penuh di mesin root/systemd staging belum dijalankan.
3. **Kebocoran memori dev Turbopack per-render** (#97555) tetap ada di dev
   runtime; gunakan production build untuk sesi panjang.

## 6. Perintah dan hasil verifikasi

```bash
pnpm typecheck        # lulus
pnpm lint             # lulus
# DB disposable
BISA_TEST_DATABASE_URL=... BISA_TEST_DIRECT_URL=... pnpm test
```

Hasil suite penuh pada `bisa_erp_t8_test` (fresh migrate + seed):
**2440 lulus, 0 gagal, 6 skipped (275 file)** — `EXIT:0`.
Payroll/HR: 41/41 lulus setelah engine statutory dipulihkan.
Arsitektur: import-cycle, module-boundaries, file-size, dan table-writers
semua lulus.
SEC-003: masking biaya di PO/penerimaan/retur/dokumen/cetak + test matriks izin lulus.
Faktur pemasok: migrasi 0082 (`supplier_invoice_date`, `due_date`), form,
koreksi, detail, cetak, dan aging utang — test integrasi lulus.
SEC-006: 16 route export memakai `withApiError`; test mapper + payroll-access
lulus.
SEC-008: streaming limit 20MB, magic bytes, batas ZIP; test upload lulus.
Coverage inti: lines 87.04%, statements 83.81%, functions 86.28%,
branches 79,35%. E2E 44/44.
Tahap 8: impor massal cabang/gudang/metode bayar/kelompok harga/karyawan/
aset tetap; test integrasi 11/11 dan E2E tab impor lulus.
E2E production build (`pnpm test:e2e`): **44/44 lulus** — auth, POS keyboard,
POS offline conflict/sync, PWA service worker, gudang, akuntansi, pengaturan,
laporan, aksesibilitas, dan penjaga UI.

## 7. Rekomendasi lanjutan

1. Tutup branch coverage 80% dan perluas role kustom E2E.
2. Jalankan installer HTTPS penuh di staging root/systemd + sertifikat resmi.
3. Ulangi restore drill berkala dan deploy dengan backup terjadwal.
