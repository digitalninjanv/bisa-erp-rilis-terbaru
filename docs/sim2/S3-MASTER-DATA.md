# SIM-2 Fase S3 — Master Data Management (§18)

Status: **SELESAI** (semua gerbang hijau, belum commit — menunggu Pemimpin).
Acuan: `docs/sim2/S0-B-MASTER-DATA.md` (matriks audit + rekomendasi S3 10 butir).
Test fase ini: `tests/sim2/master-data.test.ts` — **29 test**, perusahaan fixture
khusus `01900000-…-cc03`. Suite penuh sesudah fase: **692/692 lulus (75 berkas)**,
baseline sebelum fase 663 — nol regresi. `pnpm build`, `pnpm typecheck`,
`pnpm lint` hijau. E2E aksesibilitas (axe) 6/6, termasuk daftar produk yang
berubah: 0 pelanggaran.

Catatan urutan: migrasi field pihak (Batch 6, migrasi **0028**) dikerjakan lebih
awal dari rencana batch karena deteksi duplikat Batch 4 membutuhkan kolom NPWP;
migrasi murni aditif (7 kolom nullable), tidak ada perilaku lama yang berubah.

---

## Batch 1 — Ekspor master mengikuti filter + ekspor produk ✅

- **Ekspor produk baru** `GET /api/export/products` — semua kolom master
  penting (SKU, nama, barcode, kategori, satuan, pemasok, harga beli/jual,
  stok minimum, lacak stok/batch, status, keterangan), **tanpa paginasi**,
  menghormati filter yang sama persis dengan halaman daftar produk
  (`q`, `category` termasuk keturunan, `lowStock` aturan D-4). Kondisi filter
  produk kini satu definisi bersama (`buildProductWhere` di
  `src/server/catalog.ts`) untuk daftar, ekspor, dan pemilihan bulk-edit —
  "yang terlihat" tidak bisa berbeda dari "yang terekspor".
- Header ekspor produk diselaraskan dengan alias pemetaan impor produk;
  test membuktikan `suggestMapping` memetakan 10 field penuh dan field
  `stock` (stok awal) **sengaja tidak terpetakan** — ekspor master tidak
  boleh memposting stok awal saat diimpor ulang. Round-trip kolom cukup
  untuk impor ulang (kategori/satuan/pemasok sebagai nama, sama seperti
  template impor yang ada).
- **Ekspor pihak & akun menghormati filter halaman**: pemasok/pelanggan
  menerima `q` + `status` (fungsi daftar tersaring yang sama dipakai
  halaman daftar pihak — halaman pihak kini punya pencarian + chip status),
  bagan akun menerima `q` + `type`. Tautan unduh di ketiga halaman kini
  membawa parameter filter aktif.
- Bukti test: ekspor q/kategori/stok-menipis hanya memuat baris cocok;
  daftar pihak tersaring dipakai bersama halaman & ekspor.

## Batch 2 — Audit create/update pihak ✅

- `saveSupplierAction` & `saveCustomerAction` kini menulis
  `supplier.create`/`supplier.update` & `customer.create`/`customer.update`
  dengan snapshot before/after penuh — termasuk **perubahan batas kredit**
  pelanggan (celah §18I paling memalukan di S0-B, tertutup).
- Snapshot "sesudah" hanya menimpa field yang benar-benar dikirim
  (Drizzle mengabaikan `undefined` di `.set()`), jadi audit tidak pernah
  berbohong soal nilai yang tidak diubah pemanggil.
- Penutup sederhana lain dari S0-B: **simpan cabang** (`saveBranchAction`)
  yang sebelumnya tidak menulis audit sama sekali kini menulis
  `branch.create`/`branch.update` before/after.
- Bukti test: audit_log bertambah dengan snapshot benar untuk buat & ubah
  kedua pihak; batas kredit 1.000.000 → 7.500.000 tercatat before/after.

## Batch 3 — Bulk edit produk berpreview ✅

- Domain `previewBulkEditProducts` / `applyBulkEditProducts`
  (`src/server/master-data.ts`) + aksi dua langkah dengan
  `confirm: z.literal(true)` wajib di server.
- Pemilihan: per baris (checkbox halaman ini) atau **semua hasil filter**
  (filter identik daftar produk). Operasi: harga jual/beli persen atau
  nominal (boleh negatif = turun), ubah kategori, ubah satuan,
  aktif/nonaktifkan, set stok minimum. Penyesuaian harga dibulatkan ke
  sen (2 desimal, half-up, Decimal.js).
- Alur aman sesuai mandat: pratinjau server menampilkan nilai
  sebelum→sesudah per produk (sampel 50 + total), jumlah tidak berubah,
  dan daftar baris bermasalah; penerapan mengevaluasi ulang di dalam
  satu transaksi (data bisa berubah sejak pratinjau), baris bermasalah
  (mis. harga menjadi negatif) **dilewati dan dilaporkan per baris**,
  bukan menggagalkan batch diam-diam; kegagalan DB di tengah = rollback
  total. Satu baris audit `product.bulk_edit` per batch berisi operasi,
  ringkasan pemilihan, jumlah & daftar id yang diterapkan/dilewati.
- UI: `ProductBulkTable` menggantikan tabel daftar produk (markup &
  bahasa visual sama) dengan kolom centang, bilah pilihan, dan modal
  pratinjau→konfirmasi. Operasi harga beli disembunyikan tanpa izin
  `inventory.cost` (konsisten dengan visibilitas HPP di daftar).
- Bukti test: **200 produk naik harga jual 5% cocok hitungan persis**
  (10.000 → 10.500,00 di semua baris) + audit batch tunggal berisi 200 id;
  pratinjau terbukti tidak mengubah data; penurunan nominal yang membuat
  harga negatif dilewati & dilaporkan sementara baris lain diterapkan;
  penerapan tanpa konfirmasi ditolak server.

## Batch 4 — Deteksi duplikat pihak + halaman detail pihak ✅

- `findPartyDuplicates`: pasangan pemasok/pelanggan dengan nama sangat
  mirip (**pg_trgm `similarity()` ≥ 0,45**, dihitung satu kueri self-join
  di database — bukan round-trip per pasangan), telepon sama (normalisasi
  digit; awalan negara 62 vs 0 dicocokkan lewat 9 digit terakhir), atau
  **NPWP sama** (normalisasi digit, ≥ 15 digit). Panel
  `/app/gudang/pemasok/duplikat` menampilkan pasangan + alasan; murni
  membaca.
- **Peringatan lembut di formulir** pemasok & pelanggan: sebelum simpan,
  form memeriksa kemiripan (nama ≥ 0,5 / telepon / NPWP, mengecualikan
  record yang sedang diedit) dan menampilkan pihak yang mirip beserta
  alasannya dengan tombol "Tetap simpan" — tidak pernah memblokir.
- **Halaman detail pihak** `/app/gudang/pemasok/[id]` &
  `/app/gudang/pelanggan/[id]`: profil master (termasuk field §18D),
  **saldo berjalan dari fungsi subledger yang sama persis** dengan daftar
  Piutang/Utang global (`listPayables`/`listReceivables` disaring per
  pihak — tidak mungkin berbeda menurut konstruksi), sisa klaim Kredit
  Pemasok untuk pemasok, riwayat penerimaan/PO/retur (pemasok) atau
  penjualan (pelanggan), dokumen saldo awal, pembayaran, dan **riwayat
  perubahan dari audit_log** dengan ringkasan field yang berubah.
- Bukti test: pasangan fixture (nama mirip 1 huruf + telepon sama beda
  format) terdeteksi dengan kedua alasan, pihak kontrol bersih tidak
  terdeteksi; saldo detail pemasok 1.530.000 = saldo awal 1.500.000 +
  penerimaan kredit 30.000 dan sama persis dengan subledger global.

## Batch 5 — Merge supplier/customer ✅

- `previewPartyMerge` (saldo kedua pihak, saldo gabungan, hitungan
  referensi per tabel) + `mergeParties` dalam **satu transaksi**:
  referensi operasional dipetakan ulang ke record utama —
  pemasok: `products.supplier_id`, `purchase_orders`, `stock_receipts`,
  `supplier_returns`, `stock_documents`, `party_payments`,
  `party_opening_balances`; pelanggan: `sales.customer_id`,
  `party_payments`, `party_opening_balances`.
- Domain **mengassert saldo pasca-merge = jumlah saldo sebelum** di
  dalam transaksi; ketidakcocokan melempar error dan seluruh merge
  rollback. Duplikat dinonaktifkan dengan catatan
  `[Digabung ke <nama> (<kode>) pada <tanggal>]` — tidak dihapus,
  histori dokumen tetap utuh, nama snapshot dokumen tidak berubah
  (dokumen tidak disentuh sama sekali, hanya kolom pihak di induknya).
- Audit lengkap dua baris: `party.merge` di record utama (snapshot
  duplikat + saldo sebelum + peta referensi + saldo gabungan) dan
  `party.merged_into` di record duplikat. Penjaga: merge ke diri sendiri
  ditolak (VALIDATION), duplikat yang sudah pernah digabung ditolak
  (INVALID_STATE), pihak utama yang sudah pernah digabung ditolak, dan
  id dari perusahaan lain tidak ditemukan dalam cakupan perusahaan
  (NOT_FOUND — merge lintas perusahaan mustahil).
- **Keputusan tercatat**: `journal_lines.party_id` SENGAJA tidak
  dipetakan ulang — baris jurnal terposting append-only menurut
  AGENTS.md (tidak pernah update/delete), jadi tag pihak historis di
  jurnal tetap menunjuk record asal. Ini tidak memengaruhi saldo:
  subledger utang/piutang dihitung dari dokumen operasional (yang
  semuanya dipetakan), bukan dari tag jurnal.
- UI: panel merge di halaman duplikat — pilih record utama (radio),
  pratinjau saldo & referensi, konfirmasi eksplisit.
- Bukti test ujung-ke-ujung: utama berutang 500.000 + duplikat 330.000
  (saldo awal + penerimaan) → merge → subledger utama 830.000 persis,
  duplikat nol & nonaktif bercatatan, produk berpindah pemasok utama,
  lalu **pembayaran FIFO 830.000 melunasi seluruh utang gabungan**
  (2 alokasi dokumen). Merge pelanggan menggabungkan piutang saldo awal
  120.000 + 80.000 = 200.000 persis.

## Batch 6 — Field pihak §18D (migrasi 0028) ✅

- Migrasi aditif **0028**: `suppliers.tax_id`, `suppliers.bank_name`,
  `suppliers.bank_account_number`, `suppliers.bank_account_name`,
  `suppliers.payment_term_days`, `customers.tax_id`,
  `customers.payment_term_days` (semua nullable; pola S0-B rekomendasi #8:
  rekening hanya pemasok).
- Tampil & tersimpan lewat formulir pihak (dengan semantik edit aman:
  field tidak dikirim = nilai lama dipertahankan; string kosong =
  dikosongkan), tampil di halaman detail, ikut snapshot audit, ikut
  **ekspor CSV pihak** dan **impor master** (field + pemetaan baris +
  commit impor diperluas; header ekspor pihak terpetakan balik penuh —
  termasuk penjagaan agar kolom "NPWP" tidak dirampas field telepon
  oleh pencocokan parsial alias "hp").
- **Termin dipakai**: dokumen saldo awal (utang/piutang) yang dibuat
  tanpa tanggal jatuh tempo kini mewarisi termin pihak
  (`dueDate = tanggal dokumen + paymentTermDays`); jatuh tempo eksplisit
  selalu menang; pihak tanpa termin berperilaku persis seperti sebelum
  fase ini (jatuh tempo kosong).
- **Requirement integrasi lanjutan (belum dibangun)**: penerimaan
  pembelian & penjualan utang POS belum memiliki kolom jatuh tempo
  per dokumen untuk utang dagang (utang dihitung dari tanggal dokumen),
  jadi termin belum menjadi bawaan jatuh tempo penerimaan/PO. Titik
  integrasinya butuh kolom `due_date` di `stock_receipts` + perubahan
  aging utang — keputusan desain tersendiri, dicatat di sini sesuai
  mandat batch ("bila berisiko, cukup simpan + tampilkan + catat
  requirement").
- Bukti test: field tersimpan & teraudit; edit parsial tidak menghapus
  NPWP/termin; NPWP sama (format berbeda) terdeteksi sebagai duplikat;
  saldo awal 2026-01-10 + termin 14 hari → jatuh tempo 2026-01-24.

### Penyesuaian test lama (transparan)

Ekspor pihak kini membawa kolom §18D, jadi 3 ekspektasi lama yang
menegaskan baris/header ekspor **persis** diperbarui ke bentuk baru
(`tests/integration/feature-matrix-t4.test.ts` 2 test,
`tests/integration/import-expansion.test.ts` 1 test) — maksud
verifikasinya (round-trip field persis) dipertahankan dan diperluas,
bukan dilemahkan; tidak ada test yang di-skip atau dihapus.

---

## Status §18 sesudah S3 (dibanding S0-B)

| Kelompok §18 | S0-B | Sesudah S3 |
|---|---|---|
| Produk — Export | ❌ tidak ada | ✅ CSV master, mengikuti filter, round-trip impor terbukti |
| Produk — Bulk Edit | ❌ | ✅ berpreview + konfirmasi + audit batch + laporan per baris |
| Produk — Bulk Delete | ❌ | ❌ tetap (disengaja: hapus per baris berpenjaga sudah benar — rek. S0-B) |
| Produk — Duplicate record | ❌ | ❌ tetap (requirement di bawah) |
| Produk — Change History | ✅ | ✅ (penampil per record produk belum ada — lihat sisa) |
| Supplier/Customer — Detail + saldo + riwayat | ❌ | ✅ halaman detail lengkap |
| Supplier/Customer — Change History | ◐ hanya delete/deactivate | ✅ create/update/delete/toggle semua teraudit |
| Supplier/Customer — Export | ✅ tanpa filter | ✅ mengikuti filter q/status + kolom §18D |
| Supplier/Customer — Deteksi duplikat | ◐ impor saja | ✅ panel + peringatan form (nama/telepon/NPWP) |
| Supplier/Customer — Merge | ❌ | ✅ penuh, saldo ter-assert, audit dua sisi |
| Supplier/Customer — NPWP/rekening/termin | ❌ | ✅ migrasi 0028 + form/detail/impor/ekspor + termin → saldo awal |
| Akun — Export | ✅ tanpa filter | ✅ mengikuti filter q/type |
| Cabang — Change History | ◐ save tak selalu teraudit | ✅ create/update teraudit |
| Pihak — Search/Filter (§18F) | ❌ dimuat semua | ✅ q + status (server-side di query yang sama dengan ekspor) |
| Produk — Search/Filter/Pagination | ✅ | ✅ + ekspor & bulk memakai filter yang sama |

## Sisa NOT IMPLEMENTED (jujur) + requirement

1. **Konversi multi-satuan** — keputusan tercatat **D-17: tidak dibangun**
   (di luar lingkup S3 sesuai mandat).
2. **Varian produk, multi-barcode, brand, kode produk supplier, stok
   maksimum, lokasi default/bin, nomor seri** — belum dibangun.
   Requirement: tabel `product_barcodes` (alias barcode unik per
   perusahaan) & `product_variants` butuh perubahan jalur POS/penerimaan
   yang membaca barcode/SKU — fase tersendiri dengan test POS penuh.
3. **Penampil riwayat perubahan per record untuk produk & akun** — data
   audit_log sudah lengkap; yang dibangun fase ini baru penampil pihak
   (di halaman detail). Requirement: seksi "Riwayat perubahan" yang sama
   di halaman detail produk (komponen ringkasannya sudah ada di
   `party-detail-view.tsx` dan bisa digeneralisasi).
4. **Saved views, kolom tampil/sembunyi, filter multi-kondisi** (§18F) —
   belum ada untuk master mana pun.
5. **Impor master update-existing** — impor pihak/akun masih create-only
   (kode yang sudah ada dilewati, bukan diperbarui) dan **rollback batch
   impor** belum ada (keadaan sama seperti S0-B).
6. **Panel kualitas data umum** (§18G) — panel duplikat pihak menutup
   bagian duplikat; pemeriksaan harga 0, barcode kosong, dan yatim
   referensi belum punya halaman pemantau.
7. **Status archived terpisah & status draft master** — tidak dibangun
   mengikuti rekomendasi S0-B (nonaktif diperlakukan sebagai arsip
   de facto); **termin → jatuh tempo penerimaan/PO** menunggu kolom
   `due_date` di dokumen pembelian (lihat Batch 6).
8. **Duplicate (copy) record master** — belum ada untuk entitas mana pun.

## Berkas kunci fase ini

- Domain: `src/server/master-data.ts` (baru) — bulk edit, duplikat,
  detail, merge. Aksi: `src/server/actions/master-data.ts` (baru).
- Filter bersama: `buildProductWhere`, `listProductsForExport`,
  `listSuppliersFiltered`, `listCustomersFiltered` di
  `src/server/catalog.ts`.
- UI: `src/components/gudang/product-bulk-table.tsx`,
  `party-merge-panel.tsx`, `party-detail-view.tsx` (baru);
  halaman `/app/gudang/pemasok/[id]`, `/app/gudang/pelanggan/[id]`,
  `/app/gudang/pemasok/duplikat` (baru).
- Skema/migrasi: `suppliers`/`customers` + migrasi `0028_flippant_hydra.sql`.
- Kejadian lingkungan: PostgreSQL 18 sempat mati di tengah satu larian
  suite penuh (host, bukan kode) — dipulihkan dengan prosedur PROGRESS.md,
  larian ulang bersih 692/692.
