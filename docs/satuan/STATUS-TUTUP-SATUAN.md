# Program Satuan Kemasan — Status Tutup

> Program dibuka oleh keputusan pemilik 2026-11-08 yang **membuka lagi
> D-17** (penolakan multi-satuan di A-24), dengan syarat: customizable
> penuh, semua bisa diedit, semua permukaan sinkron tanpa konflik,
> dikerjakan bertahap S0–S6 dengan gerbang terverifikasi per tahap.
> Rencana & status per tahap: `docs/satuan/RENCANA-SATUAN.md`.
> Riset dasar: `~/workspace/research_notes/multi-unit-uom-receiving-vs-selling-20261107-2214/report.md`.
>
> **Model yang dibangun (satu-satunya yang dipakai ERP acuan):** stok
> selalu dalam SATU satuan dasar per produk; dus/pak/slop adalah
> *kemasan* — baris konversi per produk yang menyatakan isinya langsung
> ke satuan dasar. Konversi hanya di titik transaksi lewat satu sumber
> (`src/lib/packaging.ts` + `src/server/catalog/packaging.ts`); ledger
> stok, AVCO, dan jurnal tidak pernah menyimpan dus. Setiap baris
> transaksi memegang cuplikan faktornya sendiri (`isi_snapshot`),
> sehingga edit master tidak pernah mengubah histori. Membuka dus
> bukan transaksi.

## Hasil per tahap

| Tahap | Isi | Commit | Bukti angka |
|---|---|---|---|
| S0 | Audit faktual 14 permukaan + rencana tertulis | (dokumen) | Faktor konversi terbukti tidak pernah ada di 63 migrasi; fondasi satuan-dasar-tunggal sehat di semua jalur |
| S1 | Fondasi: migrasi 0062 `product_packagings`, domain kemasan, form produk seksi Kemasan, seed demo 3 produk berkemasan | `8d5bcca` | Suite 1934/1934; reseed 65 produk Rp28.349.600 tidak berubah; 4 baris kemasan di 3 produk |
| S2 | Pembelian & penerimaan: migrasi 0063 cuplikan di PO/penerimaan/retur pembelian; pindai barcode dus; HPP per pcs ke AVCO | `7730a89` | Suite 1944/1944; terima 2 Dus isi 40 @145.000 → +80 pcs, AVCO tepat Rp3.625; retur memakai cuplikan asal (master diubah 40→48, retur tetap 40) |
| S3 | Gudang: migrasi 0064 `count_breakdown`; opname campuran; transfer dua bentuk; label "≈ X Dus Y Pcs" display-only | `23085f7` | Suite 1963/1963; opname Sampoerna 3 Dus + 4 Slop + 5 Pcs = 345 persis, selisih 0 |
| S4 | Penjualan & POS web: migrasi 0065 cuplikan di baris penjualan/retur + `sale_line_id`; quote = gerbang konversi tunggal; offline web membawa cuplikan | `089b854` | Suite 1972/1972; jual 1 Dus → stok −40 & pendapatan Rp145.000 (harga kemasan independen); rantai riset 400→360→345 lulus sebagai test |
| S5 | POS desktop Tauri: snapshot penuh+delta membawa kemasan; SQLite `snapshot_packagings` + kolom cuplikan; struk bentuk input | `68d1ce4` | Suite 1975/1975; API perangkat 18/18; harness Rust 64/64; struk "1 Dus x Rp 145.000 (= 40 PCS)" |
| S6 | Impor/ekspor master berkemasan; aturan edit massal; saklar rincian laporan; saran pesan-ulang "≈ X Dus"; penutup program | menunggu commit Pemimpin | Suite **1992/1992 (209 berkas)**; test baru 17 (unit 11 + integrasi 6); nol migrasi baru (terakhir tetap 0065) |

**Gerbang final S6 (semua tanpa pipa, dari reseed bersih):** suite
1992/1992 = baseline S5 1975 + 17 test baru · typecheck exit 0 · lint
exit 0 (0 error; 27 warning warisan, nol di berkas S6) · build exit 0 ·
e2e 25/25 · test API perangkat 18/18 (di dalam suite) · harness Rust
64/64 · `pnpm pos:export` exit 0 · baseline demo tetap 65 produk,
nilai persediaan Rp28.349.600 persis.

## S6 — yang dibangun (detail)

- **Impor produk**: 7 kolom kemasan opsional sebagai daftar paralel
  berpisah titik koma (Kemasan; Isi Kemasan; Harga Beli/Jual Kemasan;
  Barcode Kemasan; Status Kemasan; Kemasan Bawaan) — pola yang sama
  untuk 1..n kemasan per baris tanpa mengubah bentuk berkas datar.
  Parser memakai SATU sumber validasi domain yang sama dengan form
  produk (`validatePackagingInput`): isi bilangan bulat ≥ 2, barcode
  satu ruang nama lintas produk↔kemasan (diperiksa terhadap katalog
  dan terhadap seluruh berkas). Pra-cek commit berjalan SEBELUM produk
  ditulis — konflik membuat baris gagal dan produk tidak lahir
  setengah jadi. Kontrak tertulis di `docs/KONTRAK-IMPOR.md` §
  "Kolom kemasan produk (S6)"; templat contoh & petunjuk halaman impor
  diperbarui.
- **Ekspor master**: 7 kolom kemasan ditambahkan DI AKHIR header
  ekspor (indeks kolom lama tidak bergeser), memuat semua kemasan
  aktif maupun nonaktif → ekspor→impor pulang-pergi setia (teruji
  paritas: unit murni + integrasi commit nyata).
- **Edit massal**: bidang kemasan BUKAN bidang massal — operasi massal
  secara struktural tidak pernah menyentuh `product_packagings`.
  Pratinjau kini menyatakannya terus terang (`packagingNote`), dan
  test membuktikan harga massal +10% mengubah harga dasar
  (3.800→4.180) sementara harga kemasan tetap Rp145.000. Mengganti
  satuan lewat edit massal hanya mengganti label satuan dasar.
- **Laporan persediaan** (`/app/gudang/nilai`): saklar "Rincian
  Dus + Pcs" display-only (bawaan menyala, mempertahankan perilaku
  S3); angka dasar tidak berubah. Ekspor CSV laporan menambah kolom
  "Rincian Kemasan" hanya bila `rincian=1` diminta eksplisit —
  bentuk CSV bawaan tidak berubah.
- **Saran pesan-ulang**: rekomendasi beli menampilkan petunjuk
  "≈ X Dus" — saran dasar dibulatkan KE ATAS ke kemasan utuh dari
  kemasan AKTIF bawaan beli (helper murni `suggestedPackagingLabel`;
  teruji: saran 200 atas Dus isi 40 → "≈ 5 Dus").

## Keputusan & penyimpangan terkumpul (jujur)

1. **Koreksi audit S0 butir #14 (S6):** audit awal menulis "`merge.ts`
   menggabung produk". Terverifikasi di S6 (grep + baca berkas):
   `merge.ts` adalah gabung PIHAK (pemasok/pelanggan); **fitur gabung
   produk tidak pernah ada** di aplikasi ini. Karena kemasan menempel
   pada produk, gabung pemasok yang memetakan ulang
   `products.supplierId` tidak menyentuh kemasan sama sekali. Aturan
   gabung produk dalam mandat S6 karena itu tidak dapat diterapkan —
   dinyatakan tertulis di RENCANA & di sini, dan fitur gabung produk
   TIDAK dibangun diam-diam. Bila pemilik kelak menghendaki gabung
   produk, aturan yang disiapkan: kemasan sumber yang namanya belum
   ada di tujuan berpindah; yang bertabrakan nama/isi berbeda wajib
   diputuskan eksplisit (tidak hilang diam-diam).
2. **Semantik daftar impor (S6):** daftar kemasan di berkas impor
   adalah daftar LENGKAP yang diinginkan untuk produk yang
   diperbarui — kemasan yang hilang dari berkas = permintaan hapus,
   tunduk penjaga yang sama seperti form (kemasan terpakai ditolak,
   hanya bisa nonaktif). Baris yang DILEWATI (SKU sudah ada tanpa
   opsi perbarui) tidak menerapkan kemasan apa pun. Penerapan di
   commit impor memakai `priceGateSatisfied: true` dengan alasan
   tertulis di kode: commit impor sendiri adalah penulisan master
   yang sudah digerbang izin aksi impor; tanpa ini, impor pembaruan
   harga kemasan akan selalu gagal gerbang harga form.
3. **Harga kemasan independen** di semua tahap: harga jual/beli per
   kemasan tidak pernah diturunkan mekanis dari isi × harga dasar
   (paling jauh isian awal yang bisa diedit) — sesuai temuan riset
   bahwa harga grosir dus memang bukan perkalian harga ecer.
4. **Aturan harga kelompok tidak berlaku pada baris berkemasan** (S4):
   harga kemasan adalah harga grosir yang berdiri sendiri; diskon
   manual tetap berlaku. Keputusan ini tercatat di RENCANA S4.
5. **Pecahan berkas demi ratchet, bukan entri ratchet baru** (S6):
   `import-parse.ts` 870→669 baris (pecahan `import-cells.ts` +
   `import-packaging.ts`), `commit-phases.ts` 815→758 (pecahan
   `commit-packaging.ts`). Pola yang sama dipakai S2–S4. Pada larian
   suite pertama S6, penjaga batas modul menangkap impor langsung
   `@/server/catalog/packaging` dari kode impor — diperbaiki ke
   barrel `@/server/catalog`, penjaga tidak dilemahkan.

## Sisa jujur (di luar cakupan, keputusan pemilik terpisah)

- **Satuan terukur desimal** (kg↔gram, liter): skema menampung
  (`isi` numeric), domain saat ini menolak isi pecahan untuk barang
  terhitung. Belum dibangun.
- **Kemasan per pemasok** (satu produk, isi berbeda per pemasok):
  belum dibangun; perluasan tabel dengan `supplier_id` bila kelak
  dibutuhkan.
- **Stok dus tersegel terpisah** dari pcs lepas: bukan fitur model
  ini; jawaban operasionalnya adalah pemisahan lokasi gudang/toko.
- **Utang bukti lapangan POS desktop (dari program Tauri, tidak
  berubah oleh program ini):** installer belum pernah ter-build dan
  jendela GUI belum pernah terbuka di VM ini (pustaka GTK/WebKit
  absen); printer fisik & keychain OS sungguhan belum diuji; kunci
  privat updater di luar repo harus dicadangkan pemilik.
- **Vonis visual pemilik** atas screenshot bukti akhir program ini
  (`~/workspace/bukti-satuan/`) belum tercatat — penentu akhir
  kualitas tampilan tetap mata pemilik, bukan angka suite.

## Bukti visual

`~/workspace/bukti-satuan/` (dibaca & diverifikasi penulis tahap):
`01-form-produk-kemasan.png` (seksi Kemasan di form produk) ·
`02-penerimaan-dus.png` (pemilih Dus isi 40, "= 40 satuan dasar ·
harga per satuan dasar Rp 3.100") · `03-opname-campuran.png`
(Sampoerna: Slop 3 + Dus 4 + lepas 5 → "= 435 Pak") ·
`04-pos-terminal-dus.png` (keranjang "Rp 145.000 / Dus", "= 40 PCS") ·
`05-nilai-rincian-dus-pcs.png` (Nilai persediaan Rp28.349.600,
saklar rincian menyala, "≈ 6 Dus" / "≈ 12 Pak").
