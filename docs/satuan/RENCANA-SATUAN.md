# Program Satuan Kemasan — Rencana & Status

> Keputusan pemilik 2026-11-08: **membangun model kemasan minimal** dari riset
> `~/workspace/research_notes/multi-unit-uom-receiving-vs-selling-20261107-2214/report.md`
> (§5–§8). Keputusan ini **membuka lagi D-17** ("konversi multi-satuan tidak
> dibangun", tercatat di `docs/reports/TAHAP-5-HARDENING.md`,
> `docs/SPEK-FITUR-INTI.md`, `docs/BUSINESS_RULES.md` §9, `docs/CHANGELOG.md`).
> Syarat pemilik: semuanya *customizable* & bisa diedit, semua permukaan
> sinkron, tanpa konflik; dikerjakan bertahap (S1..S6) dengan gerbang per tahap.
>
> Prinsip model (satu-satunya yang dipakai semua ERP acuan — Odoo, ERPNext,
> Accurate, Jurnal): **stok selalu dalam SATU satuan dasar per produk**
> (satuan terkecil yang dijual, mis. Pcs). Dus/Pak/Slop bukan satuan stok —
> mereka *kemasan*: baris konversi tetap per produk yang menyatakan isinya
> langsung ke satuan dasar. Konversi hanya terjadi di pinggir transaksi;
> ledger stok tidak pernah menyimpan dus. Membuka dus **bukan transaksi**.

---

## S0 — Audit keadaan saat ini (2026-11-08, faktual dari kode)

Yang sudah ada hanyalah **label satuan**: tabel master `units` (kode + nama,
bisa dinonaktifkan) dan `products.unitId` sebagai label tunggal. Tidak pernah
ada tabel/kolom faktor konversi di 63 migrasi (0000–0061) — D-17 memang
keputusan sadar, bukan fitur yang hilang. Semua kuantitas di semua dokumen
adalah kuantitas satuan dasar.

| # | Permukaan | Keadaan saat ini (bukti) | Gap terhadap model kemasan |
|---|---|---|---|
| 1 | Skema master produk | `units` = daftar label per perusahaan (`src/db/schema/catalog.ts:121`); `products.unitId` FK label tunggal; `products.barcode` teks tunggal + indeks unik per perusahaan (`catalog.ts:140,171`); harga tunggal `cost_price`/`sale_price` | Tidak ada tabel kemasan, tidak ada faktor/isi, barcode hanya 1 per produk, tidak ada harga per kemasan |
| 2 | Form produk | Pemilih "Satuan" = label tunggal, opsi "Tanpa satuan" (`src/components/gudang/product-form.tsx:176`); satu field Barcode; harga beli/jual tunggal (MoneyInput) | Tidak ada bagian Kemasan; barcode kemasan tidak bisa dicatat |
| 3 | Daftar & detail produk | Daftar menampilkan kolom Satuan = nama label (`product-bulk-table.tsx`, `catalog/products.ts:123`); detail menampilkan kode satuan (`produk/[id]/page.tsx:275`) | Kemasan tidak tampil di mana pun |
| 4 | Purchase Order | `purchase_order_lines`: `qty` + `unit_cost` satuan dasar saja (`inventory.ts:146`) | Baris belum bisa menyatakan "10 Dus" + faktor cuplikan |
| 5 | Penerimaan (GRN) | `stock_receipt_lines`: `qty` + `unit_cost` satuan dasar (+ batch/ED) (`inventory.ts:210`) | Pindai barcode dus belum menyelesaikan ke (produk, kemasan); harga per dus belum dikonversi ke HPP per pcs di baris |
| 6 | Penjualan / POS web | `sale_lines`: `qty` + `unit_price` satuan dasar (`sales.ts:74`); pencarian barcode terminal hanya `products.barcode` (`use-product-search.ts:103`); antrean offline baris `{productId, qty}` (`lib/pos/pos-offline.ts`) | Pindai dus akan memotong 1 pcs (mode gagal klasik riset §5.2 #3); harga jual per kemasan belum ada |
| 7 | Retur penjualan | `sale_return_lines`: `qty` satuan dasar (`sales.ts:146`) | Retur belum memakai faktor cuplikan baris asal |
| 8 | Retur pemasok | `supplier_return_lines`: `qty` satuan dasar (`inventory.ts:244` dst.) | Sama seperti #7 |
| 9 | Dokumen stok (penyesuaian/opname/transfer) | `stock_document_lines`: `qty`, `system_qty`, `received_qty` satuan dasar (`inventory.ts:422`) | Opname belum menerima hitungan campuran (dus utuh + pak + pcs lepas); transfer belum mencetak dua satuan |
| 10 | Ledger stok & HPP | `stock_movements`/`stock_on_hand` selalu satuan dasar; AVCO per satuan dasar | **Sehat — TIDAK berubah.** Inilah fondasi yang membuat model kemasan aman ditambahkan sebagai lapisan konversi |
| 11 | Snapshot POS desktop | `PosSnapshotProduct` = {id, sku, barcode, name, salePrice, stock, trackStock, trackSerial, unitCode} (`src/server/pos-device.ts:212`); SQLite lokal meniru bentuk yang sama | Snapshot belum membawa kemasan + barcode kemasan; basis data lokal belum bisa mengonversi saat offline |
| 12 | Impor produk | Field `unit` = label satuan dasar (`src/lib/import/import-parse.ts:23`); kontrak `docs/KONTRAK-IMPOR.md` | Tidak ada kolom kemasan (nama/isi/harga/barcode) |
| 13 | Laporan & ekspor | Ekspor master memuat "Satuan" label (`catalog/products.ts:163`); laporan stok dalam satuan dasar | Tampilan pecahan "7 Dus 1 Pcs" (div/mod, display-only) belum ada; ekspor master belum memuat kemasan |
| 14 | Edit massal & gabung produk | `server/master-data/bulk-edit.ts` mengubah satuan label; `merge.ts` | **KOREKSI AUDIT (S6, terverifikasi grep + baca berkas): `merge.ts` adalah gabung PIHAK (pemasok/pelanggan), BUKAN gabung produk — fitur gabung produk tidak pernah ada di aplikasi ini.** Kemasan menempel pada produk, jadi gabung pemasok (yang memetakan ulang `products.supplierId`) tidak menyentuh kemasan sama sekali. Edit massal secara struktural tidak menyentuh `product_packagings`; S6 menegaskan ini di pratinjau massal + test, bukan membangun fitur gabung produk baru diam-diam |

**Kesimpulan audit:** fondasi satuan dasar tunggal sehat dan konsisten di
semua jalur (itulah sebabnya regresi nol mungkin). Yang dibangun program ini
murni **lapisan kemasan di sekelilingnya**: satu tabel master baru, kolom
cuplikan di baris transaksi per tahap, dan satu fungsi konversi bersama.

---

## Model data final

### Tabel baru `product_packagings` (migrasi 0062, pemilik modul: `src/server/catalog/packaging.ts`)

Satu baris = satu kemasan dari satu produk. **Semua faktor dinyatakan
langsung ke satuan dasar produk** — tidak ada konversi berantai
(dus→pak→pcs dilarang; dus isi 144 dinyatakan 144, bukan 6 pak × 24).

| Kolom | Tipe | Aturan |
|---|---|---|
| `id` | uuid pk `uuidv7()` | |
| `company_id` | text | RLS `tenant_isolation` seperti tabel lain |
| `product_id` | uuid FK → `products.id` (cascade) | |
| `name` | text | Nama kemasan ("Dus", "Pak", "Slop", "Renceng"…); unik per produk (domain: trim + case-insensitive; DB: indeks unik `(company_id, product_id, name)`) |
| `isi` | numeric(19,4) | **Isi ke satuan dasar** — nama kolom sengaja bukan "factor" (riset §1.3). Domain menegakkan: bilangan bulat ≥ 2 (1 = duplikat satuan dasar; pecahan ditolak untuk barang terhitung). Tipe numeric demi konsistensi kolom qty repo & varian terukur (kg/liter) di masa depan tanpa migrasi |
| `buy_price` | numeric(19,4) null | Harga beli **per kemasan**; null = belum diatur (penerimaan memakai harga baris PO/penerimaan seperti biasa) |
| `sale_price` | numeric(19,4) null | Harga jual **per kemasan, INDEPENDEN** dari harga satuan dasar — tidak pernah diturunkan mekanis `isi × harga pcs` (paling jauh jadi isian awal yang bisa diedit) |
| `barcode` | text null | Barcode level kemasan (GTIN-14/dus, stiker distributor, apa pun — tidak divalidasi struktur GS1). Indeks unik `(company_id, barcode)` di tabel ini + penjaga domain lintas tabel (lihat aturan barcode) |
| `is_default_purchase` | boolean | Paling banyak satu per produk (semantik radio, ditegakkan fungsi sinkronisasi) |
| `is_default_sale` | boolean | Sama |
| `is_active` | boolean | Nonaktif = terarsip: tidak ditawarkan pemilih mana pun, tetap terselesaikan untuk histori |
| `sort_order` | integer | Urutan tampil |
| `created_at` / `updated_at` | timestamptz | |

Indeks: unik `(company_id, product_id, name)`; unik `(company_id, barcode)`;
`(company_id, product_id)`.

### Baris transaksi (ditambahkan per tahap S2–S5, bukan di S1)

Setiap baris dokumen yang bisa memakai kemasan mendapat empat kolom:

| Kolom | Isi |
|---|---|
| `packaging_id` | uuid null — null berarti satuan dasar |
| `qty_input` | Kuantitas **sebagaimana dimasukkan/dicetak** (10 = 10 Dus) |
| `isi_snapshot` | Faktor cuplikan saat posting (40) — retur & histori memakai ini, TIDAK PERNAH master hari ini |
| `qty` (yang sudah ada) | Kuantitas satuan dasar = `qty_input × isi_snapshot`, dihitung **sekali** di posting oleh satu fungsi konversi |

Kode posting yang ada tetap hanya mengonsumsi `qty` (satuan dasar) — ledger,
AVCO, dan laporan tidak berubah bentuk.

### Satu sumber konversi

`src/lib/packaging.ts` (murni, teruji unit) + `src/server/catalog/packaging.ts`
(domain DB):

- `toBaseQty(qtyInput, isi)` = qty × isi, dibulatkan **sekali** ke 4 desimal
  (skala numeric repo) — tidak ada konversi lapis kedua di mana pun.
- `costPerBaseUnit(hargaKemasan, isi)` = harga ÷ isi (HPP per pcs), 4 desimal.
- `planPackagingSync(current, submitted, usedIds)` — rencana sinkronisasi
  murni (buat/ubah/hapus/nonaktif + deteksi perubahan harga); penjaga edit
  hidup di sini agar teruji tanpa DB.
- `assertBarcodeAvailable(tx, …)` — satu-satunya penjaga keunikan barcode:
  memeriksa `products.barcode` **dan** `product_packagings.barcode`.
- `findProductByAnyBarcode(tx, …)` — resolusi pindai → `{productId, packagingId|null}`;
  satu-satunya jalur pencarian barcode mulai S2.
- `findUsedPackagingIds(tx, …)` — registrasi tabel baris yang mereferensikan
  kemasan; S1 kosong (belum ada kolom referensi), S2+ mengisinya bersamaan
  dengan kolom `packaging_id` (gerbang tahap itu).

## Aturan edit (prinsip pemilik: semua bisa diedit, sistem menyesuaikan)

1. **Nama, harga, barcode, bendera bawaan, urutan** — bebas diedit kapan pun.
   Berlaku untuk dokumen **berikutnya** dan semua permukaan baca langsung;
   dokumen lama tidak berubah karena barisnya memegang harga & faktor
   cuplikannya sendiri.
2. **Isi (`isi`)** — bisa diedit; hanya memengaruhi dokumen berikutnya.
   Histori tidak pernah dihitung ulang (cuplikan di baris). Bila pemasok
   mengganti isi secara permanen, pola yang disarankan UI tetap sama:
   edit isi di sini (dokumen lama aman oleh cuplikan).
3. **Harga kemasan berubah** pada produk yang sudah ada = perubahan harga:
   tunduk pada gerbang izin `inventory.price` yang sama dengan harga master
   (pola GDG3-11). Harga awal produk/kemasan baru tidak digerbang.
4. **Hapus** — kemasan yang **pernah terpakai** di baris transaksi TIDAK bisa
   dihapus (sinkronisasi menolak dengan pesan jelas); jalurnya adalah
   **nonaktifkan** (arsip). Kemasan belum terpakai boleh dihapus fisik.
   Menghilangkan baris terpakai dari formulir = permintaan hapus → ditolak,
   bukan diam-diam diarsipkan.
5. **Nonaktifkan** mengarsipkan tanpa menghapus: hilang dari semua pemilih
   (penerimaan, POS, opname), tetap tampil di master sebagai nonaktif, dan
   barcode-nya tetap teresolusi untuk histori tetapi tidak ditawarkan
   untuk transaksi baru.
6. **Barcode unik per perusahaan lintas produk & kemasan**: barcode kemasan
   tidak boleh sama dengan barcode satuan dasar produk mana pun atau
   barcode kemasan lain. Ditegakkan indeks DB per tabel + penjaga domain
   satu sumber yang dipanggil kedua jalur simpan (produk & kemasan).
7. **Produk tanpa kemasan berperilaku persis seperti sekarang** — nol
   regresi adalah gerbang setiap tahap.
8. **Satuan dasar produk** (`products.unitId`) tetap label satuan stok;
   mengganti label tidak mengubah angka apa pun (stok memang selalu dalam
   satuan itu). Mengganti *makna* satuan dasar (pcs→gram) di luar cakupan:
   prosedur stok-nol ala SAP (riset §4.2), bukan edit biasa.

## Peta tahap

| Tahap | Cakupan | Gerbang |
|---|---|---|
| **S1 — Fondasi + master produk** | Migrasi 0062 `product_packagings` + RLS; domain `server/catalog/packaging.ts` + lib murni & test; form produk bagian Kemasan; daftar/detail menampilkan kemasan; seed demo 3 produk berkemasan; baseline demo tetap 65 produk | Suite penuh hijau (≥1907 + test baru), typecheck, lint; reseed bersih: 65 produk, nilai persediaan tak berubah; produk tanpa kemasan regresi nol |
| **S2 — Pembelian & penerimaan** ✅ SELESAI | Kolom cuplikan di `purchase_order_lines` + `stock_receipt_lines` + `supplier_return_lines` (migrasi 0063); form PO/penerimaan/retur memilih kemasan (bawaan beli), pindai barcode dus via `findProductByAnyBarcode`; HPP per pcs = harga kemasan ÷ isi masuk AVCO; `findUsedPackagingIds` dihubungkan | Test: terima 2 Dus isi 40 @145rb → stok +80, AVCO 3.625; campuran → 3.450; PO dus diterima campuran dus+pcs; retur memakai cuplikan asal (isi master diubah 40→48, retur tetap 40) — 10 test di `tests/integration/packaging-purchasing.test.ts` |
| **S3 — Gudang** | Opname hitungan campuran (dus utuh + pak utuh + pcs lepas per lokasi → qty dasar, selisih dua bentuk tampil); transfer memasukkan dalam satuan apa pun & mencetak dua satuan; penyesuaian menerima kemasan | Opname campuran cocok dengan hitungan manual; dokumen lama tanpa kemasan tetap terbaca |
| **S4 — POS web** ✅ SELESAI | Snapshot/katalog kasir membawa kemasan; pindai barcode dus → baris Dus berharga kemasan, potong `isi` pcs; pemilih satuan per baris; antrean offline menyimpan `packaging_id` + cuplikan; retur penjualan memakai cuplikan baris asal | Jual 1 Dus → stok −40; jual campuran 2 Dus + 3 Pcs satu produk; offline→sync identik; rantai riset penuh (400→360→345→opname 345, selisih 0) lulus sebagai test |
| **S5 — POS desktop (Tauri)** ✅ SELESAI | Snapshot server membawa blok kemasan per produk (penuh + delta); SQLite lokal: tabel kemasan + barcode kemasan; mesin jual lokal & sinkron memakai cuplikan yang sama; struk mencetak satuan input | Paritas web↔desktop pada skenario dus yang sama; harness Rust hijau; rilis mengikuti RUNBOOK-RILIS |
| **S6 — Impor, laporan, permukaan sisa** ✅ SELESAI | Impor produk: kolom kemasan opsional (nama/isi/harga/barcode, pola KONTRAK-IMPOR); ekspor master memuat kemasan; laporan stok: saklar tampil "Dus + Pcs" (div/mod display-only); edit massal/gabung produk: aturan kemasan eksplisit; saran pesan-ulang menampilkan "≈ X Dus" | Impor→ekspor pulang-pergi setara; laporan satuan dasar tidak berubah angka; audit permukaan: nol tempat menampilkan qty tanpa jalur satuan yang jelas |

Di luar cakupan (keputusan terpisah, jangan dibangun diam-diam): satuan
terukur non-bulat (kg↔gram sebagai kemasan desimal — skema menampung,
domain S1 menolak), stok dus tersegel terpisah dari pcs lepas (pemisahan
lokasi gudang/toko adalah jawaban operasionalnya, riset §3.2), kemasan per
pemasok (satu produk, isi berbeda per pemasok — perluas tabel dengan
`supplier_id` bila kelak dibutuhkan).

---

## Status

- **S0 — SELESAI 2026-11-08.** Audit di atas (dibuktikan per berkas/baris;
  riwayat D-17 diverifikasi di dokumen proyek).
- **S1 — SELESAI 2026-11-08** (menunggu commit Pemimpin). Migrasi
  `0062_product_packagings`; domain `src/server/catalog/packaging.ts`;
  matematika & rencana sinkron murni di `src/lib/packaging.ts` (test unit
  `tests/unit/packaging.test.ts`, 20 test); test integrasi penjaga DB
  `tests/integration/packaging.test.ts` (7 test); form produk: editor
  kemasan `src/components/gudang/packaging-editor.tsx`; daftar produk
  menampilkan kemasan aktif di kolom Satuan; detail produk punya seksi
  Kemasan; seed demo `src/db/seed-packaging.ts` (Indomie Goreng — Dus
  isi 40; Beng Beng Chocolate — Pak isi 10; Sampoerna Mild 16 — Slop
  isi 10 + Dus isi 100, keduanya langsung ke satuan dasar). Harga jual
  kemasan demo sengaja TIDAK sama dengan isi × harga pcs (grosir
  independen). **Gerbang terverifikasi: suite 1934/1934 (204 berkas) =
  baseline 1907 + 27 test baru; typecheck exit 0; lint exit 0 (0 error,
  27 warning warisan lama, nol di berkas baru); reseed bersih: 65
  produk, nilai persediaan Rp28.349.600 tidak berubah, 4 baris kemasan
  tertanam di 3 produk.** Penyesuaian penjaga yang sah: pin tag migrasi
  health 0061→0062; pengecualian seed-packaging pada penjaga
  penulis-tabel (beralasan tertulis di test, kelas yang sama dengan
  seed-chart); `product_packagings` masuk daftar reset seed.
- **S2 — SELESAI 2026-11-08** (menunggu commit Pemimpin). Migrasi
  `0063_packaging_line_snapshots`: `packaging_id`/`qty_input`/
  `isi_snapshot` di `purchase_order_lines`, `stock_receipt_lines`,
  `supplier_return_lines` (backfill baris lama `qty_input = qty`,
  `isi_snapshot = 1` terverifikasi di 1.603 baris). Semantik baris
  domain: `packagingId` terisi ⇒ `qty`/`unitCost` masukan adalah PER
  KEMASAN; konversi satu titik per dokumen (`createPurchaseOrder`,
  `buildReceiptLines`, rencana baris retur) lewat `resolveLinePackagings`
  + `toBaseQty`/`costPerBaseUnit`; kolom tersimpan tetap satuan dasar
  sehingga ledger/AVCO/tiga arah tak berubah bentuk. Retur dari baris
  berkemasan mewarisi `isi_snapshot` ASAL (master tidak dibaca;
  kemasan asal nonaktif pun tetap sah). `findUsedPackagingIds` nyata
  (union ketiga tabel baris). UI: pemilih satuan per baris di form
  PO/penerimaan/retur (bawaan = kemasan bawaan beli / hasil pindai
  `findProductByAnyBarcode`), anotasi bentuk kemasan di halaman detail
  & cetak PO. Pecahan ratchet: `inventory/receipt-journal.ts`,
  `purchasing/reads.ts`. Test integrasi baru
  `tests/integration/packaging-purchasing.test.ts` (10) + bukti UI
  nyata (spec asap sementara). **Gerbang terverifikasi: suite
  1944/1944 (205 berkas) = baseline 1934 + 10 baru; typecheck 0; lint
  0 error; build 0; e2e 25/25 dari reseed bersih (65 produk,
  Rp28.349.600).**
- **S3 — SELESAI 2026-11-08** (menunggu commit Pemimpin). Migrasi
  `0064_nice_devos`: `packaging_id`/`qty_input`/`isi_snapshot` +
  `count_breakdown` (jsonb) di `stock_document_lines` (backfill pola
  0063: `qty_input = qty`, `isi_snapshot = 1`). **Opname campuran**:
  baris hitung menerima `countComponents` (per kemasan + pcs lepas);
  total hitung otoritatif di server = Σ komponen lewat
  `resolveLinePackagings` dengan cuplikan per komponen; selisih &
  jurnal tetap satuan dasar; mode hitung buta A-28 utuh. Rincian
  komponen teraudit dua lapis: `count_breakdown` di baris berselisih
  + `counts` di muatan audit opname (lembar hitung lengkap, termasuk
  baris cocok — baris dokumen selisih-0 tetap tidak lahir, perilaku
  lama). Semantik tripel opname berbeda secara sadar (terdokumentasi
  di skema): `qty` = selisih, `qty_input` = hitung dasar. **Transfer
  & penyesuaian** menerima `packagingId` per baris (ledger tetap pcs;
  cetak/detail dua bentuk "10 Dus (400 Pcs)"); penerimaan transfer
  dua tahap tetap satuan dasar (label info saja); `unitCost`
  penyesuaian tetap per satuan dasar. **Tampilan stok display-only**:
  "≈ X Dus Y Pcs" dari kemasan aktif terbesar di nilai persediaan &
  kartu produk; pergerakan menampilkan satuan input hanya untuk
  gerakan sebesar satu baris utuh. `findUsedPackagingIds` diperluas
  ke `stock_document_lines`, `count_breakdown`, dan muatan audit
  opname. Test baru 19 (unit +6/+5, integrasi
  `packaging-warehouse.test.ts` 8): opname Sampoerna 345 = 3 Dus +
  4 Slop + 5 Pcs → selisih 0; hitungan 340 → selisih −5; transfer
  2 Dus Indomie = 80 pcs; regresi nol tanpa kemasan. **Gerbang
  terverifikasi: suite 1963/1963 (206 berkas) = baseline 1944 + 19
  baru; typecheck 0; lint 0 error; build 0; e2e 25/25 dari reseed
  bersih (65 produk, Rp28.349.600).**
- **S4 — SELESAI 2026-11-08** (menunggu commit Pemimpin). Migrasi
  `0065_hot_toxin`: `packaging_id`/`qty_input`/`isi_snapshot` di
  `sale_lines` + `sale_return_lines` (backfill pola 0063; terverifikasi
  0 baris null dari 5.461 baris penjualan & 2.494 baris retur) dan
  kolom ekstra `sale_line_id` di `sale_return_lines` (meniru pola S2
  `receipt_line_id` — diperlukan untuk sisa per baris asal).
  `findUsedPackagingIds` mencakup kedua tabel penjualan. **Quote**
  adalah gerbang konversi tunggal penjualan: kunci duplikat kini
  (produk, kemasan) sehingga 1 Dus + 3 Pcs produk sama sah; harga
  kemasan = harga jual kemasan master ÷ isi (INDEPENDEN); aturan
  harga kelompok TIDAK berlaku pada baris berkemasan, diskon manual
  tetap berlaku; cek stok pra-periksa diagregat per produk.
  Cuplikan `isiSnapshot` hanya diterima dari jalur server tepercaya
  (prosesor offline) — skema aksi klien sengaja tidak menerimanya,
  doktrin yang sama dengan frozenPrices. **Terminal**: katalog
  membawa kemasan aktif + `matchedPackagingId` (pindai barcode dus =
  baris Dus, bukan 1 Pcs); pemilih satuan per baris (ganti satuan
  me-reset qty ke 1, menggabung bila baris tujuan ada); harga tampil
  per kemasan; stok & seri dinilai dalam satuan dasar; chip kemasan
  di kartu katalog. **Offline web**: muatan membawa `packagingId` +
  `isiSnapshot` + harga snapshot PER KEMASAN; server mengonversi
  dengan cuplikan muatan (bukan master saat sinkron — nama & harga
  tetap dari master walau nonaktif, baris master hilang ditolak);
  muatan lama tanpa kolom ini tetap sah di semua gerbang (aksi web,
  prosesor, skema perangkat). **Retur penjualan**: baris bertarget
  memakai cuplikan baris ASAL (isi & harga asal; master tidak
  dibaca), sisa divalidasi per baris asal (`getReturnedQtyBySaleLine`
  baru); kiriman warisan tanpa target dialokasi FIFO ke baris asal
  produk itu dengan perilaku & pesan lama persis; pemulihan stok
  diagregat per produk. Struk, faktur A4, dan form retur menampilkan
  bentuk masukan ("1 Dus × Rp145.000 (= 40 Pcs)"). Penjualan non-POS
  produk stok TIDAK ada di aplikasi ini (terverifikasi grep —
  penjualan hanya lewat terminal/aksi POS yang sama; faktur A4
  adalah cetakan dari penjualan yang sama) sehingga butir itu
  tertutup oleh domain quote/createSale bersama. Snapshot desktop
  TIDAK berubah oleh S4 (builder memetakan field eksplisit) — blok
  kemasan di snapshot adalah pekerjaan S5. Penyesuaian penjaga yang
  sah tanpa melemahkan: impor quote dialihkan ke barrel
  `@/server/catalog`; operasi baris keranjang dipecah ke
  `components/pos/terminal/cart-lines.ts` (pos-terminal 846→789
  baris, di bawah plafon 800); pin tag migrasi health 0064→0065;
  fixture `a28-ui2-print-surfaces` menambah `qtyInput`. Test baru 9:
  integrasi `tests/integration/packaging-pos.test.ts` 7 (jual 1 Dus
  Indomie: pendapatan Rp145.000, stok −40, HPP 40 × 3.100; barcode
  dus → baris Dus; master diubah 40→50 & Rp160.000 sesudah jual →
  retur tetap 40 & Rp145.000 + penolakan melebihi sisa per baris;
  offline berkemasan tersinkron dengan cuplikan muatan walau master
  isi 99; campuran 2 Dus + 3 Pcs; regresi nol tanpa kemasan; gerbang
  kemasan produk lain/nonaktif) + unit quote lokal offline 2.
  **Gerbang terverifikasi: suite 1972/1972 (207 berkas) = baseline
  1963 + 9 baru; typecheck 0; lint 0 error (27 warning warisan);
  build 0; e2e 25/25 dari reseed bersih (65 produk, Rp28.349.600);
  `pnpm pos:export` exit 0.**
- **S5 — SELESAI 2026-11-08** (menunggu commit Pemimpin). Tanpa migrasi
  server: snapshot `GET /api/pos/snapshot` (penuh + delta) membawa blok
  `packagings` per produk (id, nama, isi, harga jual per kemasan,
  barcode, isActive, isDefaultSale) dari `listPackagingsForProducts`
  S1; delta mendapat sumber perubahan keempat
  `product_packagings.updated_at` (nonaktif tertangkap sebagai UPDATE;
  hapus fisik berjalan di dalam simpan produk yang membubuhkan
  `products.updated_at` pada transaksi yang sama). Kontrak sinkron
  tidak berubah — skema S4 memang sudah menerima bidang kemasan.
  **Rust (`posdb.rs`)**: tabel `snapshot_packagings` diganti utuh per
  produk saat snapshot/delta; kolom cuplikan `packaging_id`/
  `qty_input`/`isi_snapshot` di `local_sale_lines` lewat migrasi
  aditif (DB lama utuh); `record_sale` satu transaksi memvalidasi
  kemasan dikenal & aktif + faktor cuplikan wajib, dan mengurangi
  stok lokal dalam satuan dasar (qty × isi). `SaleLineInput`
  membawa `packagingId`/`isiSnapshot` sehingga payload outbox
  terkirim apa adanya ke prosesor server S4. **Struk** (`printing.rs`):
  frasa bentuk input "1 Dus x Rp 145.000 (= 40 PCS)" — kode satuan
  dari master (nota web menulis "Pcs" harfiah); byte emas baru.
  **UI desktop**: pindai barcode kemasan → baris Dus; chip kemasan;
  pemilih satuan per baris (reset qty 1 & gabung, cermin web).
  Test baru 7 (API +3 → 18/18; harness +4 & +1 emas → 64/64).
  **Gerbang terverifikasi: suite 1975/1975 (207 berkas) = baseline
  1972 + 3 test API baru; typecheck 0; lint 0 error; ekspor statis
  exit 0.** Utang bukti lapangan tetap:
  crate Tauri penuh tidak terkompilasi di VM ini (GTK/WebKit absen) —
  bukti = harness berkas-sama + kontrak HTTP + ekspor statis.
- **S6 — SELESAI 2026-11-08** (menunggu commit Pemimpin) — **TAHAP
  AKHIR; program Satuan Kemasan TUNTAS** (dokumen penutup:
  `docs/satuan/STATUS-TUTUP-SATUAN.md`). **Tanpa migrasi baru**
  (terakhir tetap 0065). **Impor produk**: 7 kolom kemasan opsional
  sebagai daftar paralel berpisah titik koma (nama, isi, harga
  beli/jual, barcode, status, bawaan) di `IMPORT_FIELDS` + parser
  `parsePackagingCells` (`src/lib/import/import-packaging.ts`) yang
  memakai SATU sumber validasi domain `validatePackagingInput`
  (isi bilangan bulat ≥ 2; `errorKind: "packaging"` baru); analisis
  memeriksa barcode kemasan terhadap katalog (dasar produk lain +
  kemasan produk lain) dan seluruh berkas (satu peta barcode);
  commit menjalankan pra-cek `prepareImportPackagings` SEBELUM
  produk ditulis (cocokkan id produk lewat NAMA case-insensitive,
  `assertBarcodeAvailable`, `planPackagingSync` vs
  `findUsedPackagingIds`) — gagal = error baris & produk tidak lahir;
  penerapan via `syncProductPackagings(..., { priceGateSatisfied:
  true })` beralasan tertulis (commit impor sendiri penulisan master
  berizin aksi impor). Semantik: daftar berkas = daftar lengkap yang
  diinginkan (kemasan hilang = hapus bila belum terpakai); baris
  dilewati tidak menerapkan kemasan. **Ekspor master**: 7 kolom
  kemasan DI AKHIR header (indeks lama tak bergeser), memuat kemasan
  aktif & nonaktif → pulang-pergi setia. **Edit massal**:
  `BulkPreview.packagingNote` menyatakan terus terang kemasan TIDAK
  ikut berubah (operasi massal struktural tak menyentuh
  `product_packagings`; ganti satuan = label dasar saja) — teruji
  harga massal +10% (3.800→4.180) dengan harga kemasan tetap
  145.000. **Gabung produk — KOREKSI AUDIT #14**: fitur gabung
  produk TIDAK ADA (`merge.ts` = gabung pihak pemasok/pelanggan);
  kemasan menempel pada produk sehingga gabung pemasok tidak
  menyentuh kemasan; tidak dibangun diam-diam (aturan usulan bila
  kelak dibangun tercatat di STATUS-TUTUP). **Laporan persediaan**:
  saklar "Rincian Dus + Pcs" di Nilai persediaan (bawaan NYALA =
  perilaku S3; `rincian=0` mematikan); ekspor CSV menambah kolom
  "Rincian Kemasan" hanya bila `rincian=1` eksplisit (bentuk bawaan
  tak berubah); angka dasar tidak berubah. **Saran pesan-ulang**:
  helper murni `suggestedPackagingLabel` (bulatkan KE ATAS ke
  kemasan utuh dari kemasan AKTIF bawaan beli) →
  `PurchaseRecommendation.suggestedPackaging` tampil di rekomendasi
  beli (teruji: saran 200 → "≈ 5 Dus"). Kontrak impor diperbarui
  (`docs/KONTRAK-IMPOR.md` § Kolom kemasan produk) + templat contoh
  & petunjuk halaman impor. Pecahan ratchet (bukan entri baru):
  `import-parse.ts` 870→669 (`import-cells.ts`,
  `import-packaging.ts`), `commit-phases.ts` 815→758
  (`commit-packaging.ts`); impor katalog S6 sempat ditangkap penjaga
  batas modul (impor langsung `catalog/packaging`) → dialihkan ke
  barrel `@/server/catalog`, penjaga tidak dilemahkan. Test baru 17:
  unit `packaging-import.test.ts` 11 (pemetaan header, parser,
  paritas pulang-pergi murni, label saran) + integrasi
  `packaging-import.test.ts` 6 (commit produk baru berkemasan +
  resolusi barcode kemasan; pembaruan cocok-nama + hapus
  tak-terpakai; konflik barcode kemasan → error baris & produk tak
  lahir; isi pecahan ditolak; edit massal; saran Dus).
  **Gerbang terverifikasi tanpa pipa dari reseed bersih: suite
  1992/1992 (209 berkas) = baseline 1975 + 17 baru; typecheck 0;
  lint 0 error (27 warning warisan); build 0; e2e 25/25; API
  perangkat 18/18; harness Rust 64/64; `pnpm pos:export` exit 0;
  baseline demo 65 produk Rp28.349.600.** Bukti visual:
  `~/workspace/bukti-satuan/` (5 screenshot terverifikasi).
