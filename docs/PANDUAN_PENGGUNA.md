# PANDUAN PENGGUNA — MINIMARKET

## 1. Setup awal (< 30 menit)

1. Masuk sebagai owner.
2. **Pengaturan → Umum**: nama toko, alamat, telepon, NPWP, mata uang IDR, zona waktu Asia/Jakarta, PPN 11% (bisa diubah).
3. **Pengaturan → Gudang & cabang**: buat cabang dan gudang default.
4. **Akuntansi → Akun**: periksa bagan akun; jalankan migrasi/template bila perlu.
5. **Pengaturan → Pemetaan akun**: pastikan kas, bank, piutang, persediaan, utang, penjualan, HPP, PPN, beban, laba ditahan terisi. Gunakan **Ekspor** untuk melihat dan **Impor** untuk mengisi massal.
6. **Gudang → Produk → Kategori & satuan**: impor/ekspor kategori dan satuan.
7. **Gudang → Produk → Impor Excel**: unduh template, isi sheet `Data`, baca `Petunjuk` dan `Referensi`, unggah → analisis → impor.
8. **Gudang → Pemasok & pelanggan**: impor template atau input manual.
9. **Gudang → Penerimaan**: catat stok awal/pembelian pertama; cek jurnal dan nilai persediaan.
10. **POS → Sesi kas**: buka sesi kasir, lakukan uji transaksi, cetak struk.

## 2. Impor Excel

- Tombol **Impor Excel** ada di Produk, Akun, Pemasok/Pelanggan, Kategori & Satuan, Nilai Persediaan, dan Pengaturan → Pemetaan akun.
- Template berisi:
  - `Data` — header + contoh;
  - `Petunjuk` — kolom wajib/arti kolom;
  - `Referensi` — kategori, satuan, pemasok, akun, kunci pemetaan yang valid.
- Jangan mengubah nama/urutan header. Kode (SKU/barcode/akun/satuan) ditulis sebagai teks.
- Alur: unggah → petakan kolom → analisis → pilih baris → impor.
- Baris yang sudah ada:
  - produk/pemasok/pelanggan/akun/kategori/satuan: dilewati;
  - pemetaan akun: diperbarui.
- Ekspor mengikuti filter halaman dan menghasilkan `.xlsx`.

## 3. Operasional harian

### Buka shift
POS → Sesi kas → buka dengan modal awal.

### Penjualan
- Pindai barcode/cari produk, atur qty/diskon.
- Pilih pembayaran: tunai, kartu, QRIS, split, atau utang pelanggan.
- Cetak struk; cetak ulang dari Riwayat dengan tanda SALINAN.
- **Cetak otomatis**: setelah checkout, nota terbuka dan otomatis dicetak, lalu kembali ke kasir. Agar tanpa dialog, buka POS lewat launcher `deploy/print/bisa-pos-print.sh` (Linux) atau `bisa-pos-print.bat` (Windows) dan jadikan printer thermal sebagai printer default OS. Browser biasa selalu menampilkan dialog cetak.

### Retur/void
- Retur penjualan lewat **POS → Retur penjualan**; pilih refund, tukar barang, atau kredit toko.
- Void penjualan membuat dokumen pembalik; stok dan jurnal kembali.
- Jangan menghapus dokumen posted.

### Pembelian
Purchase request/PO → kirim → terima barang → stok dan utang terbentuk. Void penerimaan hanya jika belum dibayar/diretur.

### Tutup shift
Hitung kas fisik; sistem mencatat selisih. Selisih tidak menghapus jejak.

### Tutup buku
Akuntansi → Periode: pastikan periode open, posting semua dokumen, rekonsiliasi kas/bank, lalu tutup periode/tahun. Jurnal penutup membuat laba ditahan.

## 4. Pemeriksaan kesehatan

- **Status sistem**: backup terakhir, migrasi, kesehatan DB.
- **Pengaturan → Status**: cek integritas stok/jurnal.
- **Laporan**: laba rugi, neraca, arus kas, buku besar, aging, PPN.
- Dashboard: penjualan, kas/bank, stok menipis, antrean.

## 5. Jika angka tidak cocok

1. Cek apakah dokumen posted/void.
2. Cek laporan periode dan filter tanggal.
3. Cek pemetaan akun (jangan memetakan beban ke pendapatan).
4. Cek stok ledger vs `stock_on_hand` di halaman status.
5. Jangan mengedit jurnal posted; buat jurnal pembalik/koreksi.
6. Simpan backup sebelum koreksi besar.
