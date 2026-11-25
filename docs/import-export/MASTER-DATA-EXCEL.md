# Impor & Ekspor Excel — Master Data

Dokumen ini mencatat kontrak impor/ekspor master data yang dipakai aplikasi.
Tujuannya: berkas yang diunduh bisa diedit di Excel lalu diimpor kembali tanpa
menerjemahkan header atau kehilangan nol di depan.

## Prinsip

1. **Template resmi, header tetap.** Pengguna mengunduh template dari aplikasi;
   nama dan urutan kolom tidak diubah. Pemetaan kolom tetap tersedia untuk
   berkas lama/ekspor sistem lain.
2. **Validasi seluruh berkas sebelum menulis.** Wizard menampilkan baris valid,
   duplikat, dan error per baris; commit hanya menulis baris yang dipilih.
3. **Kunci stabil.** Produk memakai SKU, akun memakai kode akun, satuan memakai
   kode satuan, kategori memakai nama. Baris dengan kunci yang sudah ada
   dilewati (kecuali pemetaan akun: diperbarui).
4. **Kode tetap teks.** SKU, barcode, kode akun, kode satuan, dan NPWP ditulis
   sebagai sel teks agar nol di depan tidak hilang.
5. **Angka tetap angka.** Harga, stok, qty, dan nominal ditulis sebagai sel
   numerik, tanpa `Rp`, titik ribuan, atau simbol mata uang.
6. **Tanggal ISO.** Gunakan `YYYY-MM-DD`.
7. **Tidak ada formula dari isi sel.** Serializer XLSX mematikan parsing formula;
   CSV menetralkan awalan `=`, `+`, `-`, `@`.
8. **Jejak impor.** Setiap unggahan menjadi `import_jobs` + `import_rows`,
   dengan ringkasan sukses/gagal dan riwayat di halaman Impor.

## Entitas yang didukung

| Entitas | Impor | Ekspor Excel | Kunci |
| --- | --- | --- | --- |
| Produk + kemasan | Ya | Ya | SKU |
| Bagan akun | Ya | Ya | Kode akun |
| Pemetaan akun | Ya (upsert) | Ya | Kunci pemetaan |
| Pemasok | Ya | Ya | Nama/kode |
| Pelanggan | Ya | Ya | Nama/kode |
| Kategori produk | Ya | Ya | Nama |
| Satuan | Ya | Ya | Kode |
| Stok awal | Ya | — | SKU/nama |
| Saldo awal utang | Ya | — | Pemasok + referensi |
| Saldo awal piutang | Ya | — | Pelanggan + referensi |
| Nilai persediaan | — | Ya | SKU |
| Jurnal | — | Ya | Nomor |
| Rekap payroll | — | Ya | Run payroll |

## Alur impor

1. Buka **Gudang → Impor data** (atau tombol **Impor Excel** di halaman master).
2. Unduh **template Excel**. Sheet `Data` berisi contoh; sheet `Petunjuk`
   menjelaskan kolom wajib; sheet referensi berisi nilai yang dikenal sistem
   (kategori, satuan, pemasok, akun, kunci pemetaan). Untuk **Stok Awal**,
   contoh memakai produk nyata yang aktif, stok-tracked, bukan serial/batch,
   dan berbiaya > 0; qty selalu dalam satuan dasar.
3. Isi data mulai baris 2, lalu unggah.
4. Periksa pemetaan kolom dan tekan **Analisis**.
5. Periksa baris valid/duplikat/error. Baris bermasalah bisa diperbaiki di
   berkas lalu diunggah ulang; baris valid bisa dipilih.
6. Tekan **Impor**. Hasil per baris tersimpan dan bisa dilihat di riwayat.

**Stok awal:** `Nilai Satuan` wajib untuk qty selain 0. Baris biaya 0 hanya
diterima bila **Izinkan biaya 0** dicentang di wizard. Penerimaan dipecah
internal per 500 baris agar tidak menabrak batas parameter PostgreSQL; satu
job tetap menghasilkan satu penerimaan per kombinasi gudang+tanggal.

## Ekspor

Tombol **Unduh Excel** di halaman master memakai filter yang sama dengan layar
(pencarian/kategori/status). Berkas ditulis `.xlsx` dengan header Bahasa
Indonesia dan tipe sel yang benar. Ekspor CSV lama tetap tersedia lewat
`?format=csv` untuk integrasi yang sudah ada.

## Riset acuan

- BANA — PRD catalogue import from Excel: validasi seluruh berkas, preview,
  konfirmasi, idempotensi per kunci stabil.
- Rivane — Data Import CSV/XLSX: validasi semua error dalam satu pass,
  validasi terpisah dari commit, baris gagal bisa dilewati, audit per batch.
- Nokbil — Data transfer Excel/ERP: template versioned, kolom tetap, kode teks,
  tanggal ISO, preview sebelum live, rekonsiliasi jumlah baris.
- APPNEURAL — Excel import/export: template + instructions + example rows,
  validasi baris, keputusan create/update, batas ukuran, log/rollback.
- ProntoPlan — dua fase parse → validate, hasil validasi dapat diunduh,
  template dengan tipe data/dropdown.
- Oasis POS / SmartPOS — template produk minimarket: nama, SKU/barcode, unit,
  kategori, harga beli/jual, stok awal, lokasi; barcode sebagai teks.
- SISC / React Box — impor bagan akun: kode & nama wajib, preview per baris,
  kode unik, hierarki induk, commit all-or-nothing atau baris terpilih.

## Celah berikutnya

- Impor master untuk gudang/cabang, metode pembayaran, kelompok harga
  pelanggan, karyawan, dan aset tetap sudah tersedia; form tunggal tetap ada
  untuk koreksi kecil.
- **Stok awal**: commit masih satu transaksi per job. Baris penerimaan sudah
  dipecah internal 500 baris agar tidak gagal karena batas parameter, tetapi
  job besar masih dapat menahan lock produk dan belum menampilkan progres per
  batch.
- Belum ada unduhan baris gagal dari riwayat, detail job selesai, atau edit
  baris untuk entitas selain produk. Pengguna masih harus memperbaiki berkas
  sumber dan mengunggah ulang.
- Produk serial/batch belum dapat menerima stok awal lewat impor; jalurnya
  masih Penerimaan manual.
