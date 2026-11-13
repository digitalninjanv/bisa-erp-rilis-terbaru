# Audit Nota & Cetak BISA-ERP — Pemetaan Fungsi, Desain, dan Referensi

- **Tanggal**: 12 November 2026
- **Mode**: Read-only analysis (belum ada perubahan kode)
- **Cakupan**: POS (nota thermal, faktur A4/A5), dokumen gudang, dokumen akuntansi, slip gaji, mesin cetak bersama.
- **Metode**: Inventaris rute cetak → petakan fungsi → audit desain statis → bandingkan dengan referensi desain dokumen.

---

## 1. Ringkasan Eksekutif

Sistem sudah memiliki **Print Engine bersama** yang kuat: `PrintShell`, `PrintHeader`, `PrintFooter`, template (modern/minimal/classic), pilihan kertas (thermal 58/80, A5, A4), QR, tanda tangan, dan pengaturan per perusahaan. Namun **desain per dokumen belum konsisten**: hierarki informasi lemah, beberapa dokumen tidak memuat data penting (batch/expiry, syarat pembayaran, alamat), dan beberapa fungsi cetak belum ada (tutup sesi, riwayat sesi, statement piutang).

**Skor desain kasar per area:**
| Area | Skor | Catatan |
|---|---:|---|
| Nota thermal POS | 3/5 | Fungsional, padat, hierarki total masih bisa diperbaiki |
| Faktur A4/A5 | 3/5 | Struktur benar, kurang terms/payment instructions |
| Dokumen gudang | 3/5 | Data inti ada, beberapa kolom audit hilang |
| Laporan akuntansi | 3.5/5 | PrintShell rapi, page break/section handling perlu diuji |
| Slip gaji | 3/5 | Konten lengkap, hierarki net pay bisa lebih tegas |
| Mesin cetak | 4/5 | Fondasi kuat, opsi masih terbatas |

---

## 2. Peta Fungsi Cetak (1 per 1)

| # | Fungsi | Rute | Output | Kertas | Komponen | Status |
|---|---|---|---|---|---|---|
| C-01 | Nota penjualan POS | `/app/pos/nota/[id]` | Struk thermal | 58/80/A5/A4 | `PrintShell` receipt | Ada |
| C-02 | Faktur penjualan | `/app/pos/nota/[id]/faktur` | Faktur dokumen | A4/A5 | `PrintShell` document | Ada |
| C-03 | Pesanan pembelian (PO) | `/app/gudang/pembelian/[id]/cetak` | PO | A4/A5 | `PrintShell` document | Ada |
| C-04 | Bukti penerimaan barang (GRN) | `/app/gudang/penerimaan/[id]/cetak` | GRN | A4/A5 | `PrintShell` document | Ada |
| C-05 | Retur pembelian | `/app/gudang/retur-pembelian/[id]/cetak` | Dokumen retur | A4/A5 | `PrintShell` document | Ada |
| C-06 | Transfer gudang | `/app/gudang/transfer/[id]/cetak` | Surat jalan transfer | A4/A5 | `PrintShell` document | Ada |
| C-07 | Lembar hitung opname | `/app/gudang/opname/lembar-hitung` | Count sheet | A4/A5 | `PrintShell` document | Ada |
| C-08 | Jurnal umum | `/app/akuntansi/jurnal/[id]/cetak` | Jurnal | A4/A5 | `PrintShell` document | Ada |
| C-09 | Buku besar | `/app/akuntansi/buku-besar/cetak` | Ledger | A4/A5 | `PrintShell` document | Ada |
| C-10 | Laporan keuangan | `/app/akuntansi/laporan/cetak` | Laba rugi/neraca/arus kas/ekuitas | A4/A5 | `PrintShell` + `ReportPrintHeader` | Ada |
| C-11 | Buku PPN | `/app/akuntansi/pajak/cetak` | Buku PPN | A4/A5 | `PrintShell` document | Ada |
| C-12 | Aging piutang/utang | `/app/akuntansi/piutang-utang/cetak` | Aging report | A4/A5 | `PrintShell` document | Ada |
| C-13 | Slip gaji | `/app/akuntansi/hr/payroll/[id]/cetak` | Payslip | A4/A5 | `PrintShell` document | Ada |
| C-14 | Tutup sesi kas | — | Z-report/session close | — | — | **Belum ada** |
| C-15 | Riwayat sesi kas | — | Session history report | — | — | **Belum ada** |
| C-16 | Statement piutang pelanggan | — | A/R statement | — | — | **Belum ada** |

---

## 3. Analisis per Fungsi

### C-01 — Nota Penjualan POS (thermal)

- **File**: `src/app/app/pos/nota/[id]/page.tsx`, `src/components/pos/receipt-print.tsx`, `src/components/print/print-shell.tsx`
- **Isi saat ini**: kop, nomor/tanggal/kasir/sesi/NPWP/pelanggan/jatuh tempo, baris produk + qty × harga + diskon, subtotal, diskon, PPN, pembulatan, total, pembayaran, diterima/kembalian, sisa utang, void, salinan, QR, footer.
- **Masalah desain**:
  1. Terlalu banyak baris metadata di atas item pada 58mm; item product tenggelam.
  2. Tidak ada hierarki “Total” vs “Pembayaran” yang tegas; total dan pembayaran memakai bobot mirip.
  3. Tidak ada kolom SKU/unit; produk berkemasan sudah ditangani, tetapi teks harga bisa panjang.
  4. Tidak ada return policy/URL bantuan; QR hanya nomor dokumen.
  5. `Salinan` dan `VOID` memakai pita lebar yang bisa memakan ruang thermal.
- **Referensi**: thermal receipts menggunakan grid karakter (32/48 kolom), maksimal 3 kontrol penekanan per struk; bold hanya untuk nama toko dan total; QR thermal minimal 20–25mm; info wajib tetap teks, bukan hanya QR.
- **Rekomendasi**: ringkas metadata (tanggal+kasir satu baris), buat total paling dominan, tambah baris “Hemat” bila diskon, footer kebijakan retur/URL, QR 22–25mm pada 58mm.

### C-02 — Faktur Penjualan A4/A5

- **File**: `src/app/app/pos/nota/[id]/faktur/page.tsx`
- **Isi**: kop, nomor, tanggal, pelanggan, kasir, jatuh tempo, tabel produk/qty/harga/diskon/jumlah, subtotal/diskon/pembulatan/DPP/PPN/total, pembayaran, sisa utang, status lunas, void, QR, tanda tangan.
- **Masalah desain**:
  1. Belum ada alamat perusahaan penerbit dan alamat pelanggan lengkap (hanya nama/address pelanggan jika ada).
  2. Belum ada **syarat pembayaran/instruksi transfer** (bank, nomor rekening, jatuh tempo).
  3. Belum ada referensi PO/SO/kontrak.
  4. Belum ada kolom SKU/unit pada tabel.
  5. Tata letak total berada di kanan bawah, tetapi blok pembayaran dan sisa utang bercampur.
- **Referensi**: invoice profesional: urutan baca “dari siapa → apa → berapa → kapan → untuk siapa → item → total → cara bayar”; total paling besar; satu warna brand maksimal 3 tempat; kontras 4.5:1; PDF A4 satu halaman bila memungkinkan.
- **Rekomendasi**: tambah blok “Cara pembayaran”, referensi dokumen, kolom SKU/unit, pisahkan “Total” dan “Pembayaran” dengan garis, tampilkan status lunas sebagai badge teks.

### C-03 — Pesanan Pembelian (PO)

- **File**: `src/app/app/gudang/pembelian/[id]/cetak/page.tsx`
- **Isi**: nomor/tanggal/supplier, tabel produk/qty dipesan/sudah diterima/harga/subtotal, total, catatan, tanda tangan.
- **Masalah**:
  1. Tidak ada alamat pengiriman/tujuan gudang.
  2. Tidak ada syarat pembayaran/termin.
  3. Tidak ada barcode/QR PO untuk scanning receiving.
  4. “Sudah diterima” membingungkan pada PO baru; bisa lebih jelas sebagai “Sisa”.
- **Referensi**: dokumen inventory minimal memuat nomor unik, tanggal, pihak, status, item code, deskripsi, UoM, qty, lokasi, lot/serial, dan tanda tangan; barcode di dokumen cetak harus mudah dipindai.
- **Rekomendasi**: tambah alamat kirim, termin, kolom sisa, QR PO, dan status dokumen.

### C-04 — Bukti Penerimaan Barang (GRN)

- **File**: `src/app/app/gudang/penerimaan/[id]/cetak/page.tsx`
- **Isi**: nomor/tanggal/PO/supplier/gudang, tabel produk/qty/harga/diskon/subtotal, total, PPN, catatan, tanda tangan.
- **Masalah**:
  1. **Batch/expiry/serial tidak tercetak** padahal data tersedia di detail.
  2. Tidak ada kolom “diterima oleh”/pemeriksa per baris.
  3. Tidak ada QR/barcode dokumen.
  4. Tidak ada status pembayaran/utang pada GRN kredit.
- **Referensi**: receiving document harus memuat supplier, PO, delivery date, dock, item code, ordered vs received qty, lot/serial, condition, exception reason, approval signature.
- **Rekomendasi**: tambah kolom batch/expiry/serial, status, QR, dan area catatan selisih.

### C-05 — Retur Pembelian

- **File**: `src/app/app/gudang/retur-pembelian/[id]/cetak/page.tsx`
- **Isi**: nomor/tanggal/supplier/gudang, alasan, resolusi, tabel produk/batch/qty/harga/subtotal, total, tanda tangan.
- **Masalah**:
  1. Tidak ada referensi GRN/PO asal.
  2. Tidak ada nomor debit note/credit note.
  3. Tidak ada status penyelesaian.
- **Referensi**: supplier return harus menunjuk receipt asal, qty, alasan, batch/lot, dan dampak utang/credit note.
- **Rekomendasi**: tambah referensi GRN/PO, status resolusi, dan nomor dokumen keuangan.

### C-06 — Transfer Gudang

- **File**: `src/app/app/gudang/transfer/[id]/cetak/page.tsx`
- **Isi**: nomor/tanggal, gudang asal/tujuan, tabel produk/terkirim/diterima/sisa, catatan, tanda tangan.
- **Masalah**:
  1. Tidak ada barcode produk/lokasi.
  2. Tidak ada status perjalanan (in transit/received).
  3. Tidak ada kolom kondisi barang.
- **Referensi**: transfer document harus memuat source/destination, priority, carrier, tracking, packaging details.
- **Rekomendasi**: tambah status, barcode, dan area kondisi.

### C-07 — Lembar Hitung Opname

- **File**: `src/app/app/gudang/opname/lembar-hitung/page.tsx`
- **Isi**: header, gudang/tanggal, tabel produk + kolom fisik/catatan, tanda tangan.
- **Masalah**:
  1. Tidak ada kolom sistem (memang blind count — sesuai praktik).
  2. Tidak ada location/bin, padahal gudang bisa multi-lokasi.
  3. Tidak ada barcode produk.
  4. 1.000 baris bisa menjadi dokumen sangat panjang tanpa ringkasan per halaman.
- **Referensi**: cycle count sheet idealnya memuat item, location, system qty, count 1/count 2, initials; blind count menyembunyikan system qty sampai hitungan pertama selesai.
- **Rekomendasi**: tambah lokasi/bin, barcode, kolom hitung 1/2, dan page break per zona.

### C-08 — Jurnal Umum

- **File**: `src/app/app/akuntansi/(cetak)/jurnal/[id]/cetak/page.tsx`
- **Isi**: header, nomor/tanggal, tabel akun/debit/kredit, total, tanda tangan.
- **Masalah**:
  1. Tidak ada status posted/draft/void di dokumen.
  2. Tidak ada referensi sumber transaksi.
  3. Tidak ada “Dibuat oleh”/“Diposting oleh” terpisah.
- **Referensi**: jurnal audit trail harus memuat nomor, tanggal, status, sumber, akun, debit/kredit, total, user, dan waktu posting.
- **Rekomendasi**: tambah status, sumber, dan jejak user.

### C-09 — Buku Besar

- **File**: `src/app/app/akuntansi/(cetak)/buku-besar/cetak/page.tsx`
- **Isi**: header, meta akun, tabel tanggal/ref/keterangan/debit/kredit/saldo, total.
- **Masalah**:
  1. Tidak ada saldo awal eksplisit.
  2. Tidak ada periode di header (mungkin ada).
  3. Tidak ada halaman per akun.
- **Referensi**: ledger report standar: opening balance, mutasi, closing balance, periode, akun, dan page header berulang.
- **Rekomendasi**: tambah saldo awal/akhir dan page header berulang.

### C-10 — Laporan Keuangan

- **File**: `src/app/app/akuntansi/(cetak)/laporan/cetak/page.tsx`
- **Isi**: laba rugi, neraca, arus kas, ekuitas; group sections; prior period; total; `PrintShell`.
- **Masalah**:
  1. Page break antar laporan/section perlu diuji; tabel panjang bisa terpotong.
  2. Tidak ada “See accompanying notes”/catatan.
  3. Tidak ada tanda tangan/penyusun.
  4. Header berulang per halaman belum tentu.
- **Referensi**: laporan keuangan: angka rata kanan, label kiri, garis subtotal/total, header tahun bold, section baru di halaman baru, ulangi header tabel saat page break, footer halaman.
- **Rekomendasi**: page break per laporan, header tabel berulang, footer “Halaman x dari y”, dan blok penyusun.

### C-11 — Buku PPN

- **File**: `src/app/app/akuntansi/(cetak)/pajak/cetak/page.tsx`
- **Isi**: header, tabel tanggal/nomor/DPP/PPN, total.
- **Masalah**:
  1. Tidak ada masa pajak/rentang tanggal di header.
  2. Tidak ada status map/faktur pajak.
- **Referensi**: VAT report harus menyatakan periode, dasar pengenaan, tarif, dan total.
- **Rekomendasi**: tambah periode, ringkasan output/input, dan catatan.

### C-12 — Aging Piutang/Utang

- **File**: `src/app/app/akuntansi/(cetak)/piutang-utang/cetak/page.tsx`
- **Isi**: header, tabel per dokumen/pihak, kolom umur, total per kolom.
- **Masalah**:
  1. Tidak ada tanggal “as of” yang menonjol.
  2. Tidak ada ringkasan per pelanggan.
- **Referensi**: aging report harus menyatakan as-of date, bucket, total, dan pihak.
- **Rekomendasi**: tambah as-of date, subtotal per pihak, dan grand total.

### C-13 — Slip Gaji

- **File**: `src/app/app/akuntansi/(hr)/payroll/[id]/cetak/page.tsx`
- **Isi**: header, identitas karyawan, tabel penghasilan, iuran perusahaan, potongan, net pay, tanda tangan.
- **Masalah**:
  1. Net pay mungkin tidak cukup dominan.
  2. Tidak ada periode/ID karyawan/NPWP.
  3. Tidak ada YTD.
- **Referensi**: payslip harus memuat identitas legal, periode, earning breakdown, deduction breakdown, net pay dominan, leave balance, dan label plain language.
- **Rekomendasi**: buat net pay sebagai blok paling besar, tambah periode/ID, dan YTD.

### C-14/C-15/C-16 — Fungsi cetak yang belum ada

- **Tutup sesi kas**: belum ada Z-report/session close print; hanya layar.
- **Riwayat sesi**: belum ada cetak rekap shift.
- **Statement piutang pelanggan**: belum ada print statement/aging per pelanggan.
- **Rekomendasi**: tambahkan setelah C-01–C-13 stabil.

---

## 4. Masalah Lintas Dokumen

1. **Hierarki tipografi belum seragam** — total, subtotal, dan info sekunder sering memakai bobot mirip.
2. **Header identitas belum konsisten** — sebagian dokumen memuat NPWP/alamat, sebagian tidak.
3. **Page break** — tabel panjang dan laporan keuangan perlu `break-inside-avoid`, header berulang, dan footer halaman.
4. **QR** — ukuran, quiet zone, dan teks pendamping belum seragam.
5. **Tanda tangan** — label sudah bisa dikustomisasi, tetapi jumlah/posisi belum tentu cocok untuk semua kertas.
6. **Barcode** — dokumen gudang belum memuat barcode dokumen/produk.
7. **Status dokumen** — draft/posted/void tidak selalu tercetak.
8. **Kontras & aksesibilitas** — cetak hitam-putih harus tetap terbaca; jangan mengandalkan warna.
9. **Kertas** — A5/thermal 58mm perlu uji khusus; beberapa tabel terlalu lebar.
10. **Belum ada template per dokumen** — template global, belum bisa memilih layout berbeda untuk nota vs faktur vs GRN.

---

## 5. Referensi Desain

1. **Thermal receipt design** — grid karakter 32/48 kolom, maksimal 3 penekanan, bold hanya nama toko & total, QR 20–25mm untuk 58mm.  
   https://www.matthewswong.com/en/blog/epson-tm-t82-receipt-design-principles/
2. **Invoice design** — hierarki total, urutan baca, satu warna brand, kontras 4.5:1, A4 satu halaman.  
   https://www.billdu.com/blog/advice/what-does-a-professional-invoice-template-look-like/  
   https://charminginvoices.com/blog/invoice-design
3. **Inventory document best practices** — nomor unik, tanggal, pihak, status, item code, UoM, qty, lot/serial, lokasi, tanda tangan, barcode.  
   https://www.cleverence.com/articles/for-business/inventory-management-document-7391/
4. **Financial statement format** — angka rata kanan, garis subtotal/total, section baru per halaman, header berulang, footer halaman.  
   https://blog.techaccountingpro.com/p/opinionated-guide-on-format-of-financial-statement
5. **Payslip design** — identitas legal, earning/deduction breakdown, net pay dominan, label plain language.  
   https://www.biposervice.com/news/payslip-design-best-practices-compliance-and-user-experience/
6. **QR pada nota/faktur** — ukuran minimal, quiet zone, jangan mengganti info wajib dengan QR, sediakan teks pendamping.  
   https://www.qrcode-handbook.com/en/best-practices/qr-codes-on-receipts-and-invoices/

---

## 6. Roadmap Prioritas

**P0 — Nota & faktur POS**
1. Rapikan hierarki nota thermal: metadata ringkas, total dominan, footer retur.
2. Faktur A4: blok “Cara pembayaran”, referensi, SKU/unit, status lunas.
3. QR size/quiet zone + teks pendamping.
4. Cetak Z-report/tutup sesi.

**P1 — Dokumen gudang**
5. GRN: batch/expiry/serial, status, QR.
6. PO: alamat kirim, termin, sisa, QR.
7. Retur: referensi GRN/PO, debit note, status.
8. Transfer: status perjalanan, barcode, kondisi.

**P2 — Akuntansi & HR**
9. Jurnal: status/sumber/user.
10. Buku besar: saldo awal/akhir.
11. Laporan keuangan: page break, header berulang, footer halaman.
12. Slip gaji: net pay dominan, periode/ID, YTD.

**P3 — Template & kustomisasi**
13. Template per jenis dokumen (nota, faktur, GRN, PO, laporan).
14. Pilihan kolom/footer/QR per dokumen.
15. Uji cetak nyata 58mm/80mm/A5/A4.

---
*Dokumen ini adalah analisis read-only. Belum ada kode yang diubah.*
---

## 7. Status Implementasi (12 Nov 2026)

- **P0 POS**: nota thermal (SKU, hierarki total, blok pembayaran), faktur (SKU, status lunas, cara pembayaran), Z-report baru, statement piutang pelanggan.
- **P1 Gudang**: PO (alamat kirim, gudang default, termin, sisa, status/QR), GRN (status, PO, batch/expiry/serial), retur (dokumen asal, status, QR), transfer (status, diterima pada, seri, kondisi).
- **P2 Akuntansi/HR**: jurnal (status/sumber/user/posting), buku besar (saldo awal/akhir), laporan keuangan (page break/footer/pembanding), PPN (masa/summary), aging (as-of/summary), slip gaji (A/B/C, net pay dominan).
- **P3 Template per dokumen**: kolom `company_settings.print_document_settings` (jsonb), sanitasi/merge di `PrintSettings`, UI tabel override di Pengaturan → Cetak, dan seluruh halaman cetak memanggil `toPrintSettings(row, docType)`.

Sisa: uji cetak fisik 58mm/80mm/A5/A4 dan preview per dokumen di halaman pengaturan.
