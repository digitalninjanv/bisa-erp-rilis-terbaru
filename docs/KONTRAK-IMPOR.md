# Kontrak Impor — Staging Eksplisit (A-28 Tahap 6, H-X-02)

Dokumen ini menyatakan kontrak impor secara eksplisit agar istilah
"dry-run" tidak terbaca keliru. Kontrak ini **dibuktikan mesin** oleh
`tests/integration/a28-import-staging.test.ts` (snapshot hitungan
seluruh tabel master identik sebelum/sesudah analisis) dan
`tests/sim2/s5-roundtrip.test.ts` (perjalanan penuh berkas contoh).

## Tahapan dan tulisannya

| Tahap | Yang ditulis | Yang TIDAK ditulis |
|---|---|---|
| 1. Unggah & parse (`/api/import/parse`) | Baris berkas menjadi job + baris **staging** (`import_jobs`, `import_rows`) | Data master apa pun |
| 2. Analisis / pratinjau (`analyzeImportAction`) | Isu per baris ke `import_rows.error`, ringkasan job; status job tetap `preview` | Data master apa pun — termasuk kategori/satuan/pemasok "baru" yang ditemukan analisis: mereka hanya **dilaporkan**, dibuat pada tahap commit |
| 3. Tinjau (review) | Perubahan staging: edit nilai baris, lewati (skip) baris | Data master apa pun |
| 4. Commit (`commitImportBatchAction`, bertahap per batch) | **Satu-satunya tahap yang menulis data master** — produk/pemasok/pelanggan/akun/saldo awal beserta kategori/satuan baru yang dibutuhkan | — |
| Batal (cancel) | Job belum ter-commit: ditandai batal, baris staging dipertahankan sebagai jejak; job yang sudah ter-commit tidak bisa dibatalkan dari jalur ini | Penghapusan baris staging |

Jadi arti "dry-run" di sistem ini adalah **pratinjau persisten**:
analisis memang menulis — tetapi hanya ke staging milik job itu
sendiri. Nol baris data master berubah sebelum commit; membatalkan
atau meninggalkan job di tengah jalan tidak meninggalkan perubahan
apa pun pada data master.

## Aturan per baris

- Setiap baris dinilai sendiri-sendiri: baris bermasalah membawa pesan
  error di staging dan tidak menghalangi baris lain (laporan error
  per baris tersedia penuh di layar tinjau).
- Harga kosong **atau 0** (termasuk `0.000000` ekspor Accurate) adalah
  nilai sah, bukan error, tetapi ditandai lewat filter "Harga jual/beli
  kosong/0" agar dapat dikoreksi sebelum commit. Kolom harga di tabel
  pratinjau memakai input berformat id-ID (pemisah ribuan).
- Duplikat di dalam berkas yang sama ditandai sebagai isu baris.
- Strategi duplikat terhadap data yang sudah ada: produk dengan SKU
  yang sama **diperbarui** hanya bila pengguna mengaktifkan opsi
  "Perbarui produk yang sudah ada" (bawaan: dilewati/dilaporkan
  sebagai "sudah ada"); perilaku ini terverifikasi di s5-roundtrip.
- Commit berjalan per batch dalam transaksi; kegagalan satu baris
  dicatat per baris dan tidak menggagalkan batch lain.

## Definisi "Siap impor" (lengkap)

Baris hanya masuk filter **"Siap impor"** dan boleh dipilih untuk impor
jika **semua** syarat ini terpenuhi:

- SKU terisi (bukan SKU fallback otomatis),
- Nama terisi,
- Barcode terisi,
- Satuan terisi,
- Harga beli > 0,
- Harga jual > 0,
- tidak punya error, duplikat di file, atau konflik barcode.

Baris yang belum memenuhi syarat tampil di filter **"Belum lengkap"**,
tidak dapat dicentang, dan bila impor dijalankan akan dilewati dengan
alasan `Belum lengkap — dilewati; lengkapi SKU/Nama/Barcode/Satuan/Harga beli/Harga jual.`
Harga kosong atau 0 dianggap belum lengkap (bukan error); perbaiki lewat
sel harga yang berformat rupiah, lalu baris otomatis berpindah ke
"Siap impor".

## Kolom kemasan produk (S6 — Program Satuan Kemasan)

Impor produk menerima tujuh kolom kemasan **opsional**. Baris tanpa
kolom kemasan berperilaku persis seperti sebelumnya dan commit tidak
menyentuh kemasan produk itu sama sekali.

| Kolom | Isi |
|---|---|
| `Kemasan` | Nama kemasan, daftar paralel berpisah titik koma (`Dus;Pak`) |
| `Isi Kemasan` | Isi ke satuan dasar per posisi (`40;10`) — wajib bilangan bulat ≥ 2 |
| `Harga Beli Kemasan` | Harga beli per kemasan per posisi; posisi kosong = belum diatur |
| `Harga Jual Kemasan` | Harga jual per kemasan per posisi (independen, bukan isi × harga pcs) |
| `Barcode Kemasan` | Barcode per posisi; berbagi SATU ruang nama dengan barcode produk & kemasan lain |
| `Status Kemasan` | `Aktif` (bawaan) / `Nonaktif` per posisi |
| `Kemasan Bawaan` | `Beli`, `Jual`, `Beli+Jual`, atau kosong per posisi |

Aturan yang ditegakkan (satu sumber: `parsePackagingCells` di
`src/lib/import/import-packaging.ts` + penjaga domain
`src/server/catalog/packaging.ts` — impor tidak punya aturan kedua):

- Ketujuh kolom adalah **daftar paralel**: posisi ke-i di setiap
  kolom menggambarkan kemasan yang sama. Daftar selain nama boleh
  lebih pendek (posisi hilang = kosong), tidak boleh lebih panjang.
- Validasi isi/harga/nama memakai `validatePackagingInput` domain —
  aturan yang sama dengan formulir produk.
- Analisis memeriksa barcode kemasan terhadap katalog (barcode dasar
  produk lain, barcode kemasan produk lain) dan terhadap semua
  barcode lain di berkas yang sama; konflik menjadi error baris di
  pratinjau, bukan kejutan saat commit.
- Commit menerapkan kemasan lewat `syncProductPackagings` — jalur
  yang sama dengan formulir produk — setelah pra-cek
  (`prepareImportPackagings`): baris yang pra-ceknya gagal menjadi
  error baris dan **produknya tidak ditulis sama sekali**.
- Identitas kemasan di jalur impor adalah **nama** (dicocokkan
  case-insensitive ke baris tersimpan). Daftar impor adalah daftar
  lengkap yang diinginkan: kemasan tersimpan yang hilang dari daftar
  adalah permintaan hapus — ditolak bila sudah terpakai transaksi
  (jalurnya nonaktif, sama seperti formulir), dihapus fisik bila
  belum terpakai.
- Baris produk yang **dilewati** (SKU sudah ada tanpa opsi
  "Perbarui") tidak menerapkan kemasannya, sama seperti field lain.
- Ekspor master produk menulis ketujuh kolom ini di akhir baris
  (semua kemasan, aktif & nonaktif), sehingga ekspor → impor
  pulang-pergi setia: nama, isi, kedua harga, barcode, status, dan
  bendera bawaan kembali sama.

Bukti: `tests/unit/packaging-import.test.ts` (parser, pemetaan
header, paritas pulang-pergi murni) dan
`tests/integration/packaging-import.test.ts` (commit ujung ke ujung,
konflik barcode, pembaruan cocok-nama).

## Kompatibilitas ekspor Accurate

Impor produk menerjemahkan bentuk ekspor Accurate secara otomatis:

| Kolom Accurate | Menjadi |
|---|---|
| `Kode Barang`, `Nama Barang`, `UPC/Barcode`, `Kategori Barang`, `Satuan` | field produk yang sama |
| `Pemasok Utama` | pemasok (dibuat bila belum ada) |
| `Harga Beli` | harga beli |
| `Def. Hrg. Jual Satuan #1` | harga jual |
| `Batas Minimum Stok` | stok minimum |
| `Kuantitas Saldo Awal` | stok awal (bila impor stok aktif) |
| `Satuan #2..#5`, `Rasio Satuan #2..#5`, `Def. Hrg. Jual/Beli Satuan #2..#5` | kemasan ERP (`PackagingInput`), `Rasio` = isi ke satuan dasar; `Satuan Beli` menentukan kemasan bawaan pembelian |
| `Jenis Barang` (INV/Non Persediaan/Jasa) | `trackStock` |
| `Non Aktif` (YA/TIDAK) | `isActive` (dibalik) |
| `Menggunakan No. Seri` | `trackSerial` |
| `Pakai tanggal kadaluarsa` | `trackBatch` |

`Harga dari rincian grup` **tidak pernah** dipakai sebagai harga: kolom itu boolean penanda Accurate, bukan nominal. Alias harga jual memakai `exclude: ["rincian grup"]` agar salah petakan tidak terulang.

Batas:

- Rasio kemasan harus bilangan bulat ≥ 2; rasio pecahan ditolak per baris.
- Produk non-persediaan/jasa, ber-seri, atau ber-batch tidak boleh menerima stok lewat jalur impor produk. Stoknya lewat Penerimaan (seri/batch) atau tab Stok Awal.
- Bagan akun diimpor datar; akun induk/hierarki dan pemetaan akun tidak diubah. Untuk perusahaan berjalan, petakan ke COA ERP yang ada.
- Riwayat transaksi tidak diimpor; wizard ini hanya master data + saldo awal.

Untuk stok awal, tab **Stok Awal** menerima `Gudang Saldo Awal`, `Kuantitas Saldo Awal`, `Nilai Satuan`, dan `Per Tanggal`; satu penerimaan dibuat per kombinasi gudang+tanggal. Bila kolom tanggal kosong, dipakai tanggal cut-off di layar.

Aturan stok awal (2026-11-25):

- `Kuantitas Saldo Awal` selalu dalam **satuan dasar** produk (PCS/kg/...), bukan jumlah dus/kemasan.
- `Nilai Satuan` wajib untuk qty selain 0. Baris dengan biaya 0 hanya diterima bila pengguna mencentang **“Izinkan biaya 0”** di wizard; tanpa konfirmasi, baris ditolak agar harga pokok/AVCO tidak turun ke 0 tanpa disadari.
- Template XLSX/CSV memakai contoh produk nyata yang aktif, stok-tracked, bukan serial/batch, dan berbiaya > 0. Bila belum ada produk yang layak, sheet Data hanya berisi header.
- Baris penerimaan di-insert dalam potongan 500 baris untuk menghindari batas 65.534 parameter PostgreSQL; satu job tetap menjadi satu penerimaan per grup gudang+tanggal.

Penjaga duplikat T4R-5 bekerja per **produk antar-job**: stok awal satu produk hanya diterima dari satu job impor. Karena itu, masukkan seluruh gudang untuk produk yang sama dalam satu file (format “saldo awal per gudang” Accurate memang mendukung baris produk berulang per gudang). Memecah per gudang ke beberapa job akan membuat job kedua melewati produk yang sudah diterima job pertama.

## Bukti

- `tests/integration/a28-import-staging.test.ts` — snapshot 10 tabel
  master (produk, kategori, satuan, pemasok, pelanggan, kelompok
  pelanggan, akun, stok, gerakan stok, jurnal) identik sebelum/sesudah
  `analyzeImportAction` untuk jalur produk dan jalur master
  (pemasok); staging terbukti bertambah dan beranotasi.
- `tests/integration/import-hardening.test.ts` — semantik batal,
  penyelesaian bertahap, dan fallback SKU.
- `tests/sim2/s5-roundtrip.test.ts` — ekspor → impor ulang berkas
  contoh untuk semua entitas.
- `tests/unit/import-classify.test.ts` + `tests/integration/import-row-edit.test.ts`
  — definisi "Siap impor" lengkap, filter "Belum lengkap", dan baris
  belum lengkap yang tidak dapat dipilih/dilewati dengan alasan.
- `tests/unit/accurate-import.test.ts` — header nyata ekspor Accurate:
  harga jual, stok awal, multi-satuan, atribut produk, tipe akun,
  pelanggan/pemasok, dan stok awal bertanggal.
- `tests/integration/accurate-import.test.ts` — commit produk Accurate
  (harga, atribut, kemasan) dan stok awal per gudang/tanggal.
