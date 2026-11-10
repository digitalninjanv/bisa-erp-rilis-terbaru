# Matriks Kelengkapan Fitur — Program Audit Produksi (Tahap A2)

> Inventarisasi seluruh permukaan aplikasi per 2026-11-08 (HEAD A1
> `1afade9` + test rantai A2). Cakupan: **82 berkas `page.tsx`** di
> `src/app/app/**` (dihitung dari sistem berkas), dikelompokkan per
> modul mengikuti peta menu `src/lib/modules.ts`, ditambah permukaan
> non-halaman (POS desktop, ekspor/ API, offline).
>
> Status: **IMPLEMENTED** (fungsi nyata terhubung ke domain & data),
> **PARTIAL** (inti bekerja, ada batas bernama), **NOT IMPLEMENTED**
> (belum ada — selalu terikat keputusan pemilik di register),
> **NOT TESTED** (ada, belum terbukti di lingkungan ini).
> Kolom Bukti menyebut pembuktian terkuat yang tersedia: nama berkas
> test (integrasi/sim2/unit/e2e), audit A1, atau rantai A2
> (`tests/integration/audit-a2-chains.test.ts`, 12 test).
>
> Tidak ditemukan halaman yang hanya berupa tampilan tanpa fungsi:
> setiap halaman menu membaca data lewat jalur baca server
> (ARS1-01, ditegakkan test arsitektur read-paths) dan setiap aksi
> terhubung ke server action berpenjaga izin (A1: 201/201 aksi
> berpenjaga). Temuan "tampilan saja" yang pernah ada (janji F2 POS
> palsu, field cetak mati) sudah ditutup di A-28 dan dijaga test.

## Ringkasan hitungan

| Modul | Halaman | IMPLEMENTED | PARTIAL | NOT IMPLEMENTED / NOT TESTED |
|---|---|---|---|---|
| Beranda | 1 | 1 | 0 | 0 |
| POS & Penjualan | 12 | 11 | 1 (terminal desktop: kontrak terbukti, GUI NOT TESTED) | 0 |
| Gudang & Pembelian | 31 | 31 | 0 | 0 |
| Akuntansi (termasuk 4 permukaan cetak) | 20 | 20 | 0 | 0 |
| HR & Payroll | 14 | 14 | 0 | 0 |
| Pengaturan & Platform | 4 | 4 | 0 | 0 |
| **Total** | **82** | **81** | **1** | **0** |

(Halaman cetak dihitung di dalam modul pemiliknya: 4 di Akuntansi,
4 di Gudang — PO/penerimaan/retur/transfer — 1 faktur POS, dan
1 slip payroll; total 10 permukaan cetak.)

Fitur bernama yang NOT IMPLEMENTED (bukan halaman): QRIS dinamis via
PSP (AUD-007, keputusan pemilik), PIN supervisor POS (AUD-006,
keputusan pemilik). Keduanya tidak disamarkan sebagai fitur aktif
di UI — QRIS yang tampil adalah statis + konfirmasi manual
(terverifikasi A1), dan tidak ada tombol PIN yang berpura-pura ada.

## Beranda

| Halaman | Fitur | Status | Bukti |
|---|---|---|---|
| `/app` | Beranda: ringkasan & antrean kerja lintas modul | IMPLEMENTED | e2e `simulasi-minimarket`, `fix-a22-k5-dashboard-queues` |

## POS & Penjualan (12)

| Halaman | Fitur | Status | Bukti |
|---|---|---|---|
| `/app/pos` + `/app/pos/terminal` | Terminal kasir: katalog, pindai barcode (produk & kemasan), keranjang, diskon baris/kelompok, pajak, tunai/QRIS/bank/utang, tahan/lanjut, pintasan keyboard F2/F4/F8/F9/F10 | IMPLEMENTED | `packaging-pos`, `pos-guards`, `pos-quote-parity`, `pos-debt-sales`, `pos-hold-cash`, e2e `pos-keyboard`, rantai A2-(b) |
| `/app/pos/riwayat` | Riwayat transaksi penjualan | IMPLEMENTED | `feature-matrix-pos`, e2e `simulasi-minimarket` |
| `/app/pos/nota/[id]` | Nota/struk + cetak ulang bertanda SALINAN + faktur A4 (`/faktur`) | IMPLEMENTED | `pos-session-close-hardening` (H-POS-04/05), rantai A2-(b) render asli vs salinan |
| `/app/pos/retur` | Retur penjualan sebagian/penuh, kredit retur, penyelesaian refund | IMPLEMENTED | `pos-returns`, `credit-redemption`, `fix-p1-retur-void`, rantai A2-(c) |
| `/app/pos/ditahan` | Pesanan ditahan & dilanjutkan | IMPLEMENTED | `pos-hold-cash`, e2e `pos-pwa` |
| `/app/pos/offline` | Peninjauan antrean offline: posting ulang, penyelesaian konflik | IMPLEMENTED | `pos-offline-tahap2`, `sim2/pos-offline-sync`, rantai A2-(g) |
| `/app/pos/sesi` | Sesi kas: buka, tutup BUTA dengan toleransi selisih + alasan wajib | IMPLEMENTED | `pos-session-close-hardening`, `cash-session-history`, rantai A2-(h) |
| `/app/pos/sesi/riwayat` + `/[id]` | Riwayat sesi kas & rincian selisih | IMPLEMENTED | `cash-session-history` |
| `/app/pos/terminal` (desktop) | Admin terminal desktop: pairing kode sekali pakai + QR, cabut terminal, panel rilis updater | PARTIAL | Kontrak API 18/18 di `pos-device-api` + harness Rust 64/64 (program Tauri); **GUI/installer NOT TESTED** — AUD-009 (lingkungan tanpa GTK) |
| `/app/pos/grup` | Kelompok harga pelanggan: aturan harga per produk, pembulatan | IMPLEMENTED | `sale-flow`, `pos-quote-parity`, `catalog-parity` |
| (permukaan) PWA offline web | Antrean penjualan offline di peramban, quote lokal, sinkron tepat sekali | IMPLEMENTED | e2e `pos-offline`, `pos-pwa`; rantai A2-(g) duplikat & gagal sinkron |

## Gudang & Pembelian (31)

| Halaman | Fitur | Status | Bukti |
|---|---|---|---|
| `/app/gudang` | Ringkasan gudang | IMPLEMENTED | e2e, `feature-matrix-gudang` |
| `/app/gudang/operasi` | Mode operasi pindai (penerimaan/penyesuaian cepat) | IMPLEMENTED | `feature-matrix-gudang` |
| `/app/gudang/produk` + `/[id]` | Master produk: SKU/barcode unik, kategori, satuan + **kemasan** (isi, harga per kemasan, barcode kemasan), harga beli/jual, edit massal, gabung produk | IMPLEMENTED | `master-crud`, `packaging`, `packaging-import`, `catalog-parity`, program Satuan Kemasan S1/S6 |
| `/app/gudang/pemasok` + `/[id]` + `/duplikat` | Master pemasok + deteksi/gabung duplikat | IMPLEMENTED | `master-crud`, `feature-matrix-gudang` |
| `/app/gudang/pelanggan/[id]` | Rincian pelanggan (master pelanggan dikelola dari POS/Akuntansi; halaman rincian di gudang) | IMPLEMENTED | `master-crud`, `fix-a21-r3b-party-credit` |
| `/app/gudang/pembelian` + `/[id]` + `/[id]/cetak` | Pesanan pembelian (PO) incl. baris berkemasan, kirim PO, cetak bentuk pesanan "10 Dus (400 Pcs)" | IMPLEMENTED | `purchase-order`, `packaging-purchasing`, `a28-ui4-po-send-receive`, rantai A2-(a) |
| `/app/gudang/penerimaan` + `/[id]` + `/[id]/cetak` | Penerimaan dari PO & langsung, batch/seri, FEFO, void penerimaan | IMPLEMENTED | `goods-receipt`, `stock-batches`, `serial-numbers`(sim2), `a28-gdg-fefo-expired`, rantai A2-(a) |
| `/app/gudang/retur-pembelian` + `/baru` + `/[id]` + `/[id]/cetak` | Retur ke pemasok dengan cuplikan baris asal, penyelesaian refund/kredit | IMPLEMENTED | `supplier-returns`, `return-settlement-gate`(sim2), rantai A2-(d) |
| `/app/gudang/purchase-request` + `/[id]` | Permintaan pembelian & persetujuannya | IMPLEMENTED | `sim2/purchase-requests` |
| `/app/gudang/rekomendasi` | Rekomendasi beli (stok menipis) + petunjuk "≈ X Dus" | IMPLEMENTED | `feature-matrix-gudang`, Satuan Kemasan S6 |
| `/app/gudang/transfer` + `/[id]/cetak` | Transfer antar gudang satu tahap & dua tahap (in_transit → terima), surat jalan | IMPLEMENTED | `sim2/reservations-transfers`, `warehouse-race`, rantai A2-(e) dua tahap |
| `/app/gudang/penyesuaian` | Penyesuaian stok (rusak/hilang/koreksi) + persetujuan | IMPLEMENTED | `inventory-adjustment`, `adjustment-approval`, `fix-gdg-tahap1..3` |
| `/app/gudang/opname` + `/lembar-hitung` | Stok opname: hitung buta, hitungan campuran kemasan (dus+pak+pcs), lembar hitung | IMPLEMENTED | `opname-tasks`, `packaging-warehouse`, `a28` tutup sesi buta pola sama |
| `/app/gudang/reservasi` | Reservasi stok & konsumsi reservasi di POS | IMPLEMENTED | `sim2/reservations-transfers` |
| `/app/gudang/pergerakan` | Riwayat pergerakan stok (kartu stok) berpaginasi | IMPLEMENTED | `movements-pagination`, `stock-card-valuation` |
| `/app/gudang/nilai` | Nilai persediaan AVCO + rincian display "≈ X Dus Y Pcs" | IMPLEMENTED (catatan AUD-013: kolom HPP tampil di balik `inventory.view`; gerbang `inventory.cost` untuk halaman ini = perbaikan A5) | `stock-card-valuation`, `consistency`, Satuan Kemasan S3/S6 |
| `/app/gudang/impor` | Impor data (produk incl. kolom kemasan, stok, pihak) dengan staging, pratinjau, anti-duplikat hash | IMPLEMENTED | `import-hardening`, `import-expansion`, `import-review`, `a28-import-staging`, `packaging-import` |
| `/app/gudang/dokumen/[id]` | Rincian dokumen stok (transfer/penyesuaian/opname) | IMPLEMENTED | `feature-matrix-gudang`, `inventory-p1/p2` |

## Akuntansi (20)

| Halaman | Fitur | Status | Bukti |
|---|---|---|---|
| `/app/akuntansi` | Ringkasan akuntansi | IMPLEMENTED | e2e `akuntansi` |
| `/app/akuntansi/akun` + `/[id]` | Bagan akun 5 digit: header/detail, kelas kas/bank, edit kode berpenjaga dampak, tag PSAK 118 | IMPLEMENTED | `a27-b1..b6`, program A-27 (10/10 temuan) |
| `/app/akuntansi/migrasi-coa` | Alat migrasi/renumber bagan akun per perusahaan (dry-run → konfirmasi ganda → verifikasi saldo) | IMPLEMENTED | `a27-b7-coa-migration` |
| `/app/akuntansi/jurnal` + `/[id]` + `/baru` | Jurnal umum manual (form halaman penuh), jurnal otomatis semua sumber, pembalikan jurnal | IMPLEMENTED | `journal-validation`, `fix-a24-t4-journal-links`, `journal-source-print`, `payroll-reverse` |
| `/app/akuntansi/buku-besar` (+ cetak) | Buku besar per akun | IMPLEMENTED | `reports-p2`, `a28-ui3-reports`, rantai A2-(3) |
| `/app/akuntansi/laporan` (+ cetak) | Laporan keuangan: neraca saldo, laba rugi, neraca, arus kas, ekuitas — kolom pembanding tahun lalu; ekspor CSV/XLSX | IMPLEMENTED | `reports-p2`, `a28-tahap3-xlsx-export`, `fix-ars-tahap3-cashflow-sql`, rantai A2-(3) |
| `/app/akuntansi/piutang-utang` (+ cetak) | Piutang & utang, aging berbasis tanggal dokumen, pembayaran sebagian/lunas, FIFO, write-off, kredit pihak | IMPLEMENTED | `fix-a21-r3a-*`, `fix-a21-r3b-party-credit`, `payments-void-p2`, rantai A2-(a)/(a2) |
| `/app/akuntansi/bank` | Kas & bank: saldo per akun berkelas, mutasi kas | IMPLEMENTED | `a27-b1/b2/b3`, `cash-session-history` |
| `/app/akuntansi/rekonsiliasi` | Rekonsiliasi bank | IMPLEMENTED | `bank-reconciliation` |
| `/app/akuntansi/rekonsiliasi-kontrol` | Rekonsiliasi kontrol (akun kontrol vs subledger) | IMPLEMENTED | `reports/control` teruji di `reports-p2`, A-28 UI-3 |
| `/app/akuntansi/beban` | Beban/utang beban & pembayarannya | IMPLEMENTED | `expenses-pagination`, `quick-entry` |
| `/app/akuntansi/aset` | Aset tetap & penyusutan | IMPLEMENTED | `sim2/fixed-assets` |
| `/app/akuntansi/periode` | Periode fiskal: tutup/kunci periode, checklist akhir bulan, tutup tahun | IMPLEMENTED | `fix-p1-period-integrity`, rantai A2-(h) |
| (permukaan) Saldo awal | Saldo awal terstruktur (akun, stok, piutang/utang) | IMPLEMENTED | `opening-balances` |
| (permukaan) Entri cepat | Catat transaksi cepat (quick entry) multi dokumen | IMPLEMENTED | `quick-entry`, `quick-entry-batch-docs` |

## HR & Payroll (14)

| Halaman | Fitur | Status | Bukti |
|---|---|---|---|
| `/app/akuntansi/payroll` + `/[id]` + `/[id]/cetak` | Payroll Indonesia: run gaji, jurnal otomatis, slip & cetak; nominal hanya untuk `payroll.salary`/`payroll.manage` | IMPLEMENTED | `payroll-indonesia`(sim2), `payroll-reverse`, `payroll-access`(sim2), rantai A2-(i) incl. penolakan ekspor tanpa `payroll.salary` |
| `/app/akuntansi/karyawan/[id]` | Master karyawan & riwayat (nominal tersamar tanpa izin gaji) | IMPLEMENTED | `sim2/hr-org-history`, `payroll-access` |
| `/app/akuntansi/hr` | Organisasi & pengaturan HR (jabatan, shift, parameter) | IMPLEMENTED | `sim2/hr-org-history`, `hr-module-gate` |
| `/app/akuntansi/hr/absensi` | Absensi & shift | IMPLEMENTED | `sim2/hr-attendance` |
| `/app/akuntansi/hr/cuti` | Cuti & saldo cuti | IMPLEMENTED | `sim2/hr-leave` |
| `/app/akuntansi/hr/lembur` | Lembur & THR (nominal tersamar tanpa izin gaji) | IMPLEMENTED | `sim2/hr-overtime-thr` |
| `/app/akuntansi/hr/persetujuan` | Persetujuan HR (cuti/lembur/klaim) | IMPLEMENTED | `sim2/hr-leave`, `hr-loans-reimbursement` |
| `/app/akuntansi/kasbon` + `/[employeeId]` | Kasbon karyawan & potongan gaji | IMPLEMENTED | `employee-advances`, `sim2/hr-loans-reimbursement` |
| `/app/akuntansi/pinjaman` + `/[employeeId]` | Pinjaman karyawan & cicilan | IMPLEMENTED | `sim2/hr-loans-reimbursement` |
| `/app/akuntansi/klaim` | Reimbursement/klaim | IMPLEMENTED | `sim2/hr-loans-reimbursement` |

## Pengaturan & Platform (4)

| Halaman | Fitur | Status | Bukti |
|---|---|---|---|
| `/app/pengaturan` | Pengaturan perusahaan satu pintu (12 seksi: umum, pajak, cetak & branding, POS, toleransi sesi, payroll, dll.) | IMPLEMENTED | e2e `pengaturan`, `print-settings`, A-28 UI-2, validasi-2 V-02 |
| `/app/pengaturan/pengguna` | Pengguna & peran: peran bawaan + kustom, gerbang owner terakhir | IMPLEMENTED | `user-management`, `sim2/rbac-matrix`, `company-switch` |
| `/app/pengaturan/payroll-indonesia` | Pengaturan Payroll Indonesia (PTKP, BPJS, PPh 21 TER) | IMPLEMENTED | `sim2/payroll-indonesia`, `payroll-indonesia-desember` |
| `/app/pengaturan/status` | Status sistem: backup terakhir, drill restore, kesehatan | IMPLEMENTED | A-28 T6 (`backup-status`), `platform-t5` |

## Permukaan cetak (10 berkas, sudah termasuk di hitungan modul di atas)

PO, penerimaan, retur pembelian, transfer (surat jalan), nota &
faktur POS, jurnal, buku besar, laporan keuangan, piutang-utang,
slip payroll — semua IMPLEMENTED dengan bukti test di baris
modulnya masing-masing; pengaturan cetak satu pintu (logo, kop,
footer, tanda tangan per dokumen) terverifikasi di A-28 UI-2
(`a28-ui2-print-surfaces`).

## Fitur lintas yang diverifikasi A2 (bukan halaman)

| Fitur | Status | Bukti A2 |
|---|---|---|
| Konversi satuan/kemasan di semua jalur transaksi | IMPLEMENTED | Rantai (a)–(e), (g); program Satuan Kemasan S1–S6 |
| Idempotensi checkout & sinkron offline | IMPLEMENTED | Rantai (g): kirim ulang = `duplicate`, tepat satu penjualan |
| Kelebihan bayar utang → kredit pemasok | IMPLEMENTED (desain A-21 R3-02) | Rantai (a2) |
| Harga termasuk PPN; pendapatan bruto pasca-ekstraksi pajak, diskon contra | IMPLEMENTED (konvensi terdokumentasi di kode) | Rantai (b) |
| Jurnal terposting tidak dapat diubah; koreksi via pembalik | IMPLEMENTED | Rantai (f) void ganda ditolak, (h) pembalik periode tertutup |
| Persamaan akuntansi & neraca saldo berimbang sesudah semua rantai | PASS | Rantai (3) |
