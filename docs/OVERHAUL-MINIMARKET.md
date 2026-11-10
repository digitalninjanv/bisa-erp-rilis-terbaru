# Overhaul ERP Minimarket — catatan desain & status

Mandat pemilik (2026-11-09): ERP minimarket dengan UX setara Accurate
Online, satu pintu pencatatan manual = **Jurnal Umum**, laporan satu
periode, COA mengikuti file referensi
`/home/najib/Documents/ref/akun-perkiraan (3).xlsx`.

## 1. Information architecture

Sidebar modul akuntansi kini berkelompok:

| Grup | Item |
|---|---|
| Dashboard | Ringkasan |
| Kas & Bank | Kas & bank, Transfer bank, Rekonsiliasi bank |
| Buku Besar | Jurnal umum, Buku besar, Bagan akun |
| Laporan | Laporan, Periode fiskal, Rekonsiliasi kontrol |
| Setting | Aset tetap, Migrasi bagan akun, Pengguna & peran, Pengaturan |

Prinsip: item harian di atas, master & konfigurasi di bawah. Form
**Beban** dan **Piutang & Utang** yang berdiri sendiri tidak lagi
tampil di menu; pencatatan manual diarahkan ke Jurnal Umum. Rute lama
tetap hidup agar tautan/dokumen lama tidak putus.

## 2. Jurnal Umum — spesifikasi yang diterapkan

- Baris awal: **3**.
- `Tambah 2 baris` menambah dua baris sekaligus.
- Kolom **Kredit** memakai teks merah; Debit normal.
- **Pola cepat** dan **Memo per baris** dihapus.
- **Keterangan opsional**; server mengisi `Jurnal umum` bila kosong.
- Saat nominal selesai diisi (blur), baris berdekatan yang sudah punya
  akun dan belum bernominal diisi otomatis sebesar selisih.
- Pemilih akun menampilkan `kode · nama` tanpa awalan Rp.
- Indikator keseimbangan dan alasan tombol Posting nonaktif tetap
  terlihat; jurnal tidak seimbang tidak dapat diposting.
- Sesudah simpan: redirect ke histori jurnal; rincian baris dapat
  dibuka langsung dari daftar.
- Histori: filter tanggal, sumber, akun, status, dan **user**; ekspor
  CSV mengikuti filter yang sama.

## 3. Jurnal otomatis yang sudah ada

| Transaksi | Dokumen | Jurnal |
|---|---|---|
| Penjualan POS | `sales` | Dr kas/bank/piutang, Dr diskon, Cr pendapatan + PPN, Dr HPP / Cr persediaan |
| Penerimaan barang | `stock_receipts` | Dr persediaan (+ PPN masukan bila aktif), Cr utang pemasok / kas |
| Beban | `expenses` | Dr akun beban (+ PPN masukan), Cr kas/bank atau utang |
| Transfer bank | `bank_transfers` | Dr rekening tujuan + biaya admin, Cr rekening asal |
| Retur penjualan | `sale_returns` | Dr retur/diskon, Cr kas/piutang; stok kembali |
| Payroll | `payroll_runs` | Dr beban gaji/BPJS, Cr utang gaji/BPJS/PPh 21 |

Semua jalur memakai `postJournal` + `assertPeriodOpen`, sehingga
jurnal selalu seimbang dan periode tertutup menolak posting.

## 4. Laporan

- Layar dan cetak resmi: **satu periode** (dari–sampai / per tanggal).
- Kolom tahun sebelumnya, saklar pembanding, dan CSS pembanding
  dihapus. Laporan tetap membaca jurnal posted secara real-time.
- Laba rugi, posisi keuangan, arus kas, perubahan ekuitas, neraca
  saldo, penjualan, dan catatan tersedia sebagai tab.
- Ekspor CSV/XLSX mengikuti model yang sama: satu periode, tanpa kolom
  pembanding/selisih.

## 5. COA referensi IFI MART

File referensi divalidasi:

- 126 akun, **126 kode unik**.
- Tidak ada induk hilang, referensi diri, atau siklus hierarki.
- Tipe Accurate: `BANK` 13, `EXPS` 26, `OEXP` 20, `OINC` 16, `OCAS` 7,
  `REVE` 7, `FASS` 6, `DEPR` 5, `OCLY` 5, `INTR` 5, `AREC` 5,
  `EQTY` 4, `APAY` 4, `COGS` 1, `LTLY` 1, `OASS` 1.

### Status: sudah diterapkan (cutover 2026-11-09)

Bagan referensi sudah menjadi `CHART_TEMPLATE`:

- **126 akun referensi** dipertahankan kode/nama/induknya; satu
  perbaikan hierarki: BSI `11010203` ditempatkan di bawah `110102`.
- **15 akun operasional** ditambahkan dengan kode turunan yang tidak
  bentrok: QRIS clearing, piutang karyawan/pinjaman, kredit
  pelanggan, PPh 21/dipotong, utang gaji/potongan/BPJS, selisih
  persediaan, selisih kas, piutang tak tertagih.
- Total **141 akun** (20 header non-postable + 121 detail), **36
  pemetaan** resmi, 7 pasangan kontra, 11 akun kas/bank berkelas.
- Tipe Accurate dipetakan: BANK/INTR/AREC/OCAS/OASS/FASS/DEPR →
  aset; APAY/OCLY/LTLY → liabilitas; EQTY → ekuitas;
  REVE/OINC → pendapatan; COGS → HPP; EXPS/OEXP → beban.
- Alat migrasi `LEGACY_CHART_CODE_MAP` diperbarui ke kode referensi
  dan mendeteksi perusahaan yang sudah memakai bagan baru
  (penanda `110107 Tunai` / `400001 Penjualan`) agar kode root yang
  kebetulan sama tidak di-renumber.
- Seed demo + data laba rugi diulang; neraca seimbang dan laporan
  tetap menghasilkan angka yang sama.

## 5a. Pinjaman & laporan keuangan

Referensi laporan IFI MART memisahkan **Pendapatan/Beban Operasional**
dan **Non Operasional**. Pinjaman diperlakukan sebagai berikut:

| Transaksi | Jurnal | Laporan |
|---|---|---|
| Pinjaman karyawan (pencairan) | Dr `110305` Piutang Pinjaman Karyawan / Cr kas-bank | Neraca: aset lancar; Arus kas: operasi keluar |
| Setoran/cicilan pinjaman karyawan | Dr kas-bank / Cr `110305` | Neraca: aset turun; Arus kas: operasi masuk |
| Cicilan dipotong payroll | Dr utang gaji / Cr `110305` (di jurnal payroll) | Neraca: piutang & utang turun; **bukan** Laba Rugi |
| Pinjaman bank/hutang jangka panjang | Dr kas-bank / Cr `2201` | Neraca: liabilitas jangka panjang; Arus kas: pendanaan |
| Bunga/biaya pinjaman | Dr `720001` Beban Bunga Pinjaman / Cr kas-bank | Laba Rugi: **Beban lain-lain (non operasional)** |
| Bunga/jasa giro | Dr kas-bank / Cr `710001`/`710002` | Laba Rugi: **Pendapatan lain-lain (non operasional)** |

Pokok pinjaman **tidak pernah** menjadi pendapatan atau beban —
hanya perpindahan antara kas dan piutang/utang. Modul Pinjaman
Karyawan saat ini tidak membebankan bunga (0%), sehingga tidak ada
baris bunga di Laba Rugi; bila bunga diterapkan, gunakan akun
`720001`.

## 5b. Margin produk & modul Analisa

- **Produk & harga**: kartu overview margin rata-rata/tertinggi/terendah/
  negatif; kolom margin per produk; form produk punya kalkulator
  **target margin** (harga jual = HPP ÷ (1 − target%)). HPP yang dipakai
  adalah moving average yang diperbarui setiap penerimaan.
- **Penerimaan barang**: setiap baris pembelian menampilkan Harga jual,
  Margin, dan Target margin. Mengubah target langsung menghitung harga
  jual; harga jual master ikut diperbarui saat penerimaan diposting
  (butuh izin `inventory.price`).
- **Modul Analisa** (`/app/analisa`, permission `analytics.view`)
  berisi 12 indikator:
  1. Omzet & Growth
  2. Gross Profit Margin
  3. Operating Profit
  4. Cash Flow Operasional
  5. Analisis ABC-FSN (tabel 10 produk teratas + hitungan A/B/C & F/S/N)
  6. Inventory Turnover (disetahunkan)
  7. GMROI (disetahunkan)
  8. Average Transaction Value
  9. Stockout Rate
  10. Dead Stock Ratio (penjualan 90 hari)
  11. Shrinkage Rate (pergerakan rusak/kedaluwarsa/hilang/penyesuaian/opname)
  12. Inventory Accuracy (dari opname posted; “—” bila belum ada)

Semua indikator membaca jurnal posted, penjualan, pergerakan stok, dan
opname — tidak ada tabel agregat baru yang bisa melenceng.

## 6. Status pekerjaan

- [x] Ekspor CSV/XLSX laporan diselaraskan ke satu periode.
- [x] Rute Beban dialihkan ke Jurnal Umum; Piutang & Utang dialihkan
      ke laporan posisi keuangan. Halaman cetak aging tetap ada.
- [x] Field **PPN Masukan eksplisit** (nominal bebas, 0 = non-PPN)
      pada penerimaan barang; harga baris = DPP, PPN ditambahkan di
      atasnya dan dijurnal ke akun PPN Masukan.
- [x] Filter histori transfer: rekening, jenis, user.
- [x] Migrasi COA referensi (141 akun, 36 pemetaan, tes kontrak
      bagan ditulis ulang untuk struktur baru).
- [ ] Filter histori tambahan (gudang, pemasok) bila diperlukan.
