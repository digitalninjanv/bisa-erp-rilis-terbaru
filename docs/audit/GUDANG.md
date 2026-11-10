# Audit Modul Gudang — Bisa ERP

**Tanggal:** 2026-11-03 · **Jenis:** audit kode statis (baca-saja) · **Basis klaim:** `AGENTS.md` + `README.md` proyek
**Cakupan:** `src/app/app/gudang/**`, `src/components/gudang/**`, `src/server/inventory.ts`, `src/server/catalog.ts`, `src/server/actions/inventory.ts`, `src/server/actions/import.ts`, `src/lib/import-parse.ts`, skema gudang di `src/db/schema.ts`, migrasi `0001_rls_and_guards.sql`, dan titik sentuh stok di `src/server/pos.ts` + `src/server/reports.ts`.

**Metode:** setiap klaim README/AGENTS dibuktikan dari kode. Status: `WORKING` = terbukti dari kode · `PARTIAL` = ada tapi cacat/tidak lengkap · `BROKEN` = ada tapi berperilaku salah · `MISSING` = tidak ada · `UI_ONLY` = tampilan ada, fungsi tidak · `NOT_VERIFIED` = tidak bisa dibuktikan dari kode statis (butuh runtime/DB). Tidak ada perilaku runtime yang diklaim di dokumen ini — test integrasi yang ada (`tests/integration/consistency.test.ts`, `sale-flow.test.ts`) hanya menguji rekonsiliasi DB hasil seed dan alur POS; **tidak ada satu pun test untuk penerimaan, penyesuaian, transfer, opname, atau commit impor**, jadi alur-alur itu `NOT_VERIFIED` dari sisi pengujian meski kodenya terbaca benar/salah secara statis.

**Ringkasan hitungan:** 1 temuan P0 · 7 temuan P1 · 10 temuan P2 · 11 temuan P3 (29 temuan bernomor P0-1 s.d. P3-11).

---

## 1. Tabel fitur

| Fitur | Status | Bukti (file:baris) | Dampak |
|---|---|---|---|
| Produk — buat | WORKING | `src/server/actions/inventory.ts:30` (`saveProductAction`), `src/components/gudang/product-form.tsx:53` | — |
| Produk — edit | WORKING | `product-form.tsx` dipakai ulang dengan prop `product` di `src/app/app/gudang/produk/[id]/page.tsx:88`; update di `actions/inventory.ts:82-100` | Edit hanya dari halaman detail, tidak ada tombol edit di daftar produk |
| Produk — nonaktif | PARTIAL | Checkbox `isActive` di `product-form.tsx:193`; `toggleProductAction` (`actions/inventory.ts:118`) **tidak punya pemanggil UI** (dead code) | Nonaktif bisa, tapi hanya lewat form edit |
| Produk — hapus | MISSING | Tidak ada aksi hapus produk di seluruh `src/server/actions/*.ts` (grep `delete` hanya menemukan akun, grup pelanggan, impor, penjualan ditahan, user, role) | Produk salah buat tidak bisa dihapus; hanya bisa dinonaktifkan |
| Kategori — buat | BROKEN | `createTaxonomyAction` (`actions/inventory.ts:371`) **tidak punya pemanggil UI sama sekali**; satu-satunya jalur buat kategori adalah auto-create saat impor (`actions/import.ts:395-415`) dan seed | Dari UI, kategori tidak bisa dibuat — pengguna terkunci pada kategori bawaan seed/impor |
| Kategori — edit/hapus/nonaktif | MISSING | Tidak ada aksi; `listCategories` memfilter `isActive=true` (`catalog.ts:225-231`) tapi tidak ada cara mengubahnya | Kategori salah eja permanen |
| Kategori bertingkat | MISSING (skema saja) | Kolom `parentId` ada di `src/db/schema.ts:427`, tidak pernah dibaca/ditulis di server/komponen/halaman mana pun (grep `parentId` kategori = 0 hasil) | Klaim hierarki tidak terwujud; semua kategori datar |
| Satuan — buat/edit/hapus | BROKEN/MISSING | Sama seperti kategori: buat hanya via `createTaxonomyAction` yang yatim (`actions/inventory.ts:371-396`); edit/hapus tidak ada; tabel `units` bahkan tidak punya kolom `isActive` (`schema.ts:433-442`) | Satuan tidak bisa dikelola dari UI |
| Konversi multi-satuan (dus→pcs dll.) | MISSING | Tidak ada tabel/kolom faktor konversi di skema; `products.unitId` tunggal (`schema.ts:451`); semua dokumen memakai satuan dasar saja | Pembelian per dus dan penjualan per pcs tidak bisa dimodelkan |
| Atribut produk kustom | MISSING | `products` (`schema.ts:444-471`) tidak punya kolom atribut/JSON; hanya `notes` teks bebas | Tidak ada varian/atribut (ukuran, warna, dsb.) |
| Pemasok — buat | WORKING | `actions/inventory.ts:289` (`saveSupplierAction`) + `partner-forms.tsx:13` | — |
| Pemasok — edit | BROKEN | Aksi mendukung `id` (`actions/inventory.ts:297-308`), tapi `SupplierForm` create-only (tanpa prop pemasok) dan tabel di `pemasok/page.tsx:92-111` tidak punya tombol edit | Edit pemasok tidak terjangkau dari UI meski server siap |
| Pemasok — hapus/nonaktif | MISSING | Tidak ada aksi hapus; `supplierSchema` tidak menerima `isActive` (`actions/inventory.ts:279-287`) padahal kolomnya ada (`schema.ts:412`) | Status "Nonaktif" di tabel (`pemasok/page.tsx:106`) tidak bisa dihasilkan dari UI |
| Pelanggan — edit/nonaktif | BROKEN/MISSING | Pola sama dengan pemasok: `saveCustomerAction` (`actions/inventory.ts:318`) mendukung edit, `CustomerForm` create-only, `isActive` tidak diterima skema | Sama seperti pemasok |
| Gudang — buat | WORKING | `src/server/actions/settings.ts:212` (`saveWarehouseAction`) + form di Pengaturan | Berada di Pengaturan, bukan di modul Gudang |
| Gudang — edit/nonaktif | BROKEN | Aksi mendukung `id` + `isActive` (`settings.ts:202-211, 232-238`), tapi `WarehouseForm` (`settings-forms.tsx:334`) create-only dan tabel gudang di `pengaturan/page.tsx` tanpa aksi | Gudang tidak bisa diubah/dinonaktifkan dari UI; tidak ada penjaga "gudang default/terakhir dinonaktifkan" |
| Gudang — hapus | MISSING | Tidak ada aksi hapus gudang | — |
| Multi-gudang di transaksi | PARTIAL | Penerimaan/penyesuaian/transfer/opname/valuasi semua menerima `warehouseId` (`inventory.ts:151, 237, 368, 458`; `reports.ts:607`) — **tetapi** daftar produk terkunci ke gudang default tanpa pemilih gudang (`produk/page.tsx:49-65`) dan HPP rata-rata global rusak di multi-gudang (temuan P1-2) | Stok per gudang tidak bisa dilihat dari daftar produk; valuasi antar gudang tercemar |
| Stok minimum & peringatan | PARTIAL | `products.minStock` global per produk (`schema.ts:456`), bukan per gudang; indikator: kartu dashboard (`gudang/page.tsx:117`), filter "Stok menipis" (`produk/page.tsx:99-107`); definisi tidak konsisten — dashboard menjumlah semua gudang (`gudang/page.tsx:52`), daftar produk per gudang default (`catalog.ts:88-90`) | Angka "stok menipis" bisa berbeda antar halaman untuk data yang sama; tidak ada notifikasi aktif |
| Penerimaan barang + jurnal utang | WORKING (statis) / NOT_VERIFIED (test) | `inventory.ts:139-227`: stok masuk, HPP rata-rata, jurnal Dr Persediaan / Cr Utang bila total > 0 | Lihat cacat validasi P1-7 |
| Penyesuaian (rusak/kedaluwarsa/hilang/karantina) | BROKEN | Tanda qty tidak ditegakkan — lihat P0-1 | Pemakaian normal dari UI mengacaukan stok & jurnal |
| Retur pembelian | BROKEN | Satu jalur dengan penyesuaian (`inventory.ts:240-322`), tanda qty sama bermasalahnya (P0-1); metode `replacement` tetap menjurnal Dr Utang (P2-3) | Retur bisa menambah stok dan mengurangi utang secara keliru |
| Transfer antar gudang | PARTIAL | `inventory.ts:356-440`: dua gerakan dalam satu transaksi, asal ≠ tujuan divalidasi (`:367`) | Qty nol/negatif lolos (P2-8); tanpa cek stok asal selain dari `applyStockMovement` |
| Stok opname | PARTIAL | `inventory.ts:443-539`: selisih dari snapshot, jurnal selisih bersih | Race condition (P2-4); hanya entri manual per produk, tidak ada mode "muat semua produk gudang" (P3-9) |
| Void/koreksi dokumen gudang posted | MISSING | `stock_documents.status` mengenal `void` (`schema.ts:595`), `stock_receipts.status` juga (`schema.ts:552`), tetapi tidak ada aksi void untuk penerimaan/penyesuaian/transfer/opname di `actions/inventory.ts` (seluruh file) | Kesalahan posting tidak bisa dibatalkan secara resmi; satu-satunya jalan adalah dokumen lawan manual yang tidak tertaut |
| Kartu stok | PARTIAL | `reports.ts:657-690` (`getStockCard`) ditampilkan di `produk/[id]/page.tsx:113-152` | Saldo berjalan mencampur semua gudang (P2-5) |
| Pergerakan stok (daftar) | PARTIAL | `catalog.ts:258-301` terpaginasi; halaman `pergerakan/page.tsx` | Kotak pencarian teks tidak berfungsi (P3-7) |
| Nilai persediaan + ekspor CSV | PARTIAL | `reports.ts:607-655`, halaman `nilai/page.tsx`, `src/app/api/export/inventory/route.ts` | Tanpa pagination — semua SKU dirender (P2-6) |
| Pemilih produk untuk transaksi | WORKING | `product-picker.tsx` memakai pencarian server `searchInventoryProductsAction` limit 20 (`actions/inventory.ts:399-427`) — **tidak** memuat semua produk | Fungsi `productOptions()` di `catalog.ts:323` memuat SEMUA produk aktif tanpa limit, tetapi dead code (tidak ada pemanggil) — jebakan performa bila dipakai lagi (P3-5) |
| Integritas `stock_on_hand` = Σ `stock_movements` | WORKING (desain) / NOT_VERIFIED (seluruh jalur) | Keduanya diubah dalam transaksi yang sama di `applyStockMovement` (`inventory.ts:41-90`); `stock_movements` append-only via trigger (`migrations/0001_rls_and_guards.sql`, trigger `stock_movements_append_only`); ada test rekonsiliasi `tests/integration/consistency.test.ts:41` untuk data seed | Pelanggaran tetap mungkin lewat jalur yang tidak memakai `applyStockMovement` secara benar (P0-1, P1-4) |
| Pencegahan stok negatif | PARTIAL | `applyStockMovement` menolak hasil < 0 kecuali `allowNegative` (`inventory.ts:60-62`); POS menghormati `allowNegativeStock` (`pos.ts:339, 528`) | Tidak ada CHECK constraint di DB (`schema.ts:504-517` tanpa check); jalur retur/void POS sengaja `allowNegative: true` (`pos.ts:713, 878`) |
| Konkurensi mutasi stok | PARTIAL | Baris `stock_on_hand` dikunci `FOR UPDATE` sebelum diubah (`inventory.ts:47-57`); nomor dokumen atomik via upsert (`sequences.ts:33-51`) | Opname menghitung selisih dari snapshot tanpa kunci (P2-4); tidak ada idempotency key untuk dokumen gudang mana pun (bandingkan penjualan POS yang wajib — AGENTS.md) sehingga klik ganda/refresh saat submit membuat dokumen ganda |
| Impor — unggah & parse | WORKING | `src/app/api/import/parse/route.ts`: batas 20 MB / 25.000 baris (`:12-13`), baris disimpan sebagai staging `import_rows` status `pending` (`:92-104`) | Hanya sheet pertama yang dibaca (`:31`) (P3-11) |
| Impor — pratinjau & seleksi baris | PARTIAL | Analisis duplikat SKU dalam file, SKU sudah ada, konflik barcode, master baru (`actions/import.ts:124-253`) | UI seleksi hanya memuat 50 baris pertama tanpa pagination (P2-7) |
| Impor — commit per batch | WORKING (statis) | `actions/import.ts:268-595`, batch 250 dari wizard (`import-wizard.tsx:130-134`), satu transaksi per batch → rollback per batch bila error | Tidak ada rollback lintas batch / undo impor selesai (P2-8) |
| Impor — stok awal + jurnal | PARTIAL | Gerakan `opening` + jurnal Dr Persediaan / Cr Modal dengan `idempotencyKey` per batch (`actions/import.ts:505-540`) | Untuk produk yang **diperbarui** (`updateExisting`), stok awal tidak pernah diposting (P1-6) |
| Impor — perbaiki baris error | MISSING | Baris `error` hanya bisa dilewati (`skipImportRowsAction`, `actions/import.ts:630-648`); tidak ada edit data baris; satu-satunya perbaikan adalah unggah ulang file | Sesuai temuan user: baris error tidak bisa diperbaiki di tempat |
| Penomoran dokumen | WORKING | `src/server/sequences.ts:33-51` upsert atomik per perusahaan/jenis/tahun | — |
| Batch/lot & tanggal kedaluwarsa per stok | MISSING | Grep `expiry|batch|lot|serial` di skema/server/komponen gudang: tidak ada kolom batch/lot/exp pada stok; "kedaluwarsa" hanya jenis penyesuaian | FEFO dan pelacakan lot tidak mungkin; barang kedaluwarsa tidak bisa diidentifikasi dari data |
| Pembayaran utang penerimaan | WORKING (di Akuntansi) | `src/server/actions/accounting.ts:312-353` memperbarui `paidAmount`/`paymentStatus` penerimaan | Di luar cakupan gudang; dicatat agar tidak diklaim hilang |

---

## 2. Temuan prioritas

### P0 — Kritis

**P0-1. Tanda qty dokumen keluar (rusak/kedaluwarsa/hilang/karantina/retur pembelian) tidak ditegakkan — pemakaian normal dari UI mengacaukan stok DAN jurnal.**
`createAdjustment` meneruskan qty apa adanya sebagai delta stok (`src/server/inventory.ts:286-305`), skema Zod tidak membatasi tanda (`src/server/actions/inventory.ts:175-195`), dan form tidak memberi petunjuk tanda apa pun (`adjustment-form.tsx`, `line-editor.tsx` — kolom hanya berlabel "Qty"). Staf yang mencatat "Barang rusak: 5" dengan qty positif `5` akan **menambah** stok 5, dan jurnalnya terbalik arah: untuk non-retur, arah jurnal ditentukan tanda jumlah qty (`inventory.ts:324`), sehingga kerusakan dicatat sebagai persediaan bertambah; untuk retur pembelian, jurnal selalu Dr Utang / Cr Persediaan (`inventory.ts:310-322`) — mengkredit persediaan sementara stok fisik justru naik, GL dan subledger stok langsung berlawanan.
*Rekomendasi:* tegakkan tanda di server berdasarkan tipe — `damaged|expired|lost|quarantine|purchase_return` selalu keluar (normalisasi ke negatif / tolak qty positif), `adjustment` wajib bertanda eksplisit; UI menampilkan label arah ("Qty keluar") dan stok tersedia. Tambahkan test integrasi: retur 5 unit menurunkan stok 5 dan jurnal searah.

### P1 — Tinggi

**P1-2. Harga pokok rata-rata (moving average) dihitung dari stok per-gudang, bukan stok global produk.**
Di `inventory.ts:92-118`, pembaruan `costPrice` hanya berjalan untuk gerakan `purchase`, dan memakai `before` = stok di gudang tujuan saja, sementara `products.costPrice` bersifat global per produk. Bila produk sudah punya stok di gudang lain, penerimaan di gudang yang stoknya 0 mereset HPP menjadi harga penerimaan terakhir itu saja — rata-rata global hilang, dan semua valuasi/COGS sesudahnya salah.
*Rekomendasi:* hitung rata-rata dari total stok semua gudang (Σ `stock_on_hand` produk) atau simpan HPP per gudang secara eksplisit; putuskan satu model dan uji dengan skenario dua gudang.

**P1-3. Jurnal penyesuaian untuk dokumen campuran tanda salah nilai.**
`totalValue` adalah Σ |qty| × HPP (`inventory.ts:276-280`), sedangkan arah jurnal dipilih dari tanda Σ qty (`inventory.ts:324`). Dokumen berisi baris +10 dan −5 menghasilkan jurnal sebesar nilai 15 unit pada satu arah, padahal perubahan nilai persediaan sebenarnya 5 unit. Jurnal tidak sama dengan perubahan stok.
*Rekomendasi:* pisahkan jurnal per arah (total masuk dan total keluar sebagai dua kelompok baris), atau larang dokumen campuran tanda; uji dengan dokumen campuran.

**P1-4. Produk `trackStock=false` tetap digerakkan stoknya oleh POS.**
Quote POS memberi stok tak-terbatas untuk produk non-lacak (`src/server/pos.ts:256`), tetapi loop checkout menerapkan `applyStockMovement` untuk **semua** baris tanpa memeriksa `trackStock` (`src/server/pos.ts:516-530`). Produk jasa/non-stok menumpuk gerakan penjualan dan saldo `stock_on_hand` negatif, mencemari kartu stok dan rekonsiliasi.
*Rekomendasi:* lewati produk `trackStock=false` saat posting gerakan di checkout, void, dan retur POS; atau dokumentasikan & uji perilaku sebaliknya bila memang disengaja.

**P1-5. Tidak ada void/koreksi untuk dokumen gudang yang sudah posted.**
Skema mengenal status `void` untuk `stock_documents` dan `stock_receipts` (`schema.ts:552, 595`), tetapi tidak ada aksi void di `src/server/actions/inventory.ts`. Penerimaan salah qty/harga tidak bisa dibatalkan secara tertaut — stok, HPP rata-rata, dan jurnal utangnya tetap salah, dan dokumen lawan manual tidak membatalkan HPP yang sudah terlanjur dirata-rata.
*Rekomendasi:* implementasikan void dokumen gudang: gerakan pembalik tertaut + `reverseSourceJournal` (pola yang sudah dipakai modul lain), status dokumen menjadi `void`, dengan alasan wajib dan audit.

**P1-6. Impor dengan "Perbarui produk yang sudah ada" mengabaikan stok awal secara diam-diam.**
Pada cabang update di `actions/import.ts:439-486`, produk diperbarui lalu baris ditandai `imported` — tanpa `applyStockMovement` cabang `opening` (yang hanya ada di cabang insert, `:505-520`). Wizard tetap menampilkan opsi "Impor stok awal" aktif (`import-wizard.tsx`), sehingga pengguna mengira stok awal ikut masuk padahal tidak, tanpa peringatan apa pun.
*Rekomendasi:* posting stok awal juga untuk produk yang diperbarui (atau nonaktifkan opsi + beri penjelasan eksplisit di UI bila kombinasi itu tidak didukung).

**P1-7. Validasi qty/biaya dokumen gudang nyaris kosong — penerimaan negatif lolos sampai ke stok dan jurnal.**
Semua skema baris memakai `z.union([z.string(), z.number()])` tanpa batas nilai (`actions/inventory.ts:149, 190, 226`); string non-numerik baru gagal di `Decimal()` dan berubah menjadi pesan generik "Terjadi kesalahan pada server" (`src/lib/errors.ts`, `guard`). Penerimaan dengan qty negatif mengurangi stok sebagai gerakan `purchase` dan, karena total ≤ 0, **tidak membuat jurnal** (`inventory.ts:196-211` hanya menjurnal bila `total.gt(0)`) — stok turun tanpa jejak akuntansi. Harga produk negatif juga lolos dari `productSchema` (`actions/inventory.ts:14-28`), dan tanggal hanya divalidasi `z.string().min(10)`.
*Rekomendasi:* skema numerik terpusat (string numerik valid, qty penerimaan/transfer > 0, biaya ≥ 0, tanggal format ISO valid) dipakai semua aksi gudang; pesan error per kolom, bukan INTERNAL generik.

**P1-8. CRUD master tidak lengkap secara sistematis.**
(a) Hapus tidak ada untuk produk/kategori/satuan/pemasok/gudang — dan karena itu juga tidak ada penjaga hapus untuk master bertransaksi. (b) Edit pemasok/pelanggan/gudang didukung server tetapi tidak terjangkau UI (form create-only, tabel tanpa tombol edit — `partner-forms.tsx`, `settings-forms.tsx:334`, `pemasok/page.tsx`, `pengaturan/page.tsx`). (c) Kategori/satuan tidak bisa dibuat dari UI sama sekali (P-tabel di atas). Pola "server siap, UI tidak" berulang tiga kali menunjukkan lapisan form tidak pernah diselesaikan untuk mode edit.
*Rekomendasi:* selesaikan matriks CRUD per master — buat/edit/nonaktif untuk semua, hapus permanen dengan penjaga (tolak bila ada transaksi/stok, arahkan ke nonaktif) mengikuti pola penjaga yang sudah ada untuk akun di `actions/accounting.ts:651`; samakan pola form create/edit di semua master.

...[truncated 11824 chars]
### P2 — Sedang

**P2-1. `stock_documents.total` tidak pernah diisi — kolom nilai menampilkan Rp0 di mana-mana.**
`createAdjustment`, `createTransfer`, dan `createOpname` tidak menyetel `total` saat insert (`inventory.ts:244-258, 372-390, 460-474`) sehingga selalu default `0` (`schema.ts:598`). Dashboard "Dokumen terakhir" (`gudang/page.tsx:47-59, 176`) dan riwayat penyesuaian kolom "Nilai" (`penyesuaian/page.tsx`) menampilkan Rp0 untuk semua dokumen penyesuaian/transfer/opname.
*Rekomendasi:* isi `total` saat posting (nilai absolut gerakan), atau hitung dari `stock_document_lines` saat membaca.

**P2-2. Jenis dokumen rusak/kedaluwarsa/hilang/karantina hilang di riwayat.**
`createAdjustment` menormalisasi tipe dokumen menjadi hanya `adjustment`/`purchase_return` (`inventory.ts:252`); tipe spesifik hanya hidup di `stock_movements.movementType`. Halaman penyesuaian memetakan `stockDocuments.type` ke label Rusak/Kedaluwarsa/dsb. (`penyesuaian/page.tsx`, `typeLabel`) — cabang label itu tidak akan pernah terpakai, semua tampil "Penyesuaian". Pergerakan stok masih membedakan tipe, jadi data tidak hilang, hanya salah tampil di riwayat dokumen.
*Rekomendasi:* simpan tipe asli di `stock_documents.type` (skema sudah membedakannya di komentar `schema.ts:588`), atau tampilkan tipe dari gerakan terkait.

**P2-3. "Karantina" tidak memindahkan barang ke gudang karantina; retur metode `replacement` menjurnal utang secara keliru.**
Penyesuaian tipe `quarantine` hanya mengubah stok di gudang yang sama dengan tipe gerakan `quarantine` (`inventory.ts:286-305`) — tidak ada parameter gudang tujuan, padahal skema gudang mengenal tipe `quarantine` (`schema.ts:206`). Barang karantina tidak terpisah secara fisik di data. Selain itu retur dengan `refundMethod = "replacement"` tetap menjurnal Dr Utang/Cr Persediaan (`inventory.ts:310`) — untuk penggantian barang, utang seharusnya tidak berkurang (barang pengganti akan datang sebagai penerimaan baru).
*Rekomendasi:* karantina = transfer semantik ke gudang bertipe quarantine; `replacement` tanpa jurnal penyelesaian (atau jurnal memo yang dapat dilacak ke penerimaan pengganti).

**P2-4. Opname rawan race condition dan duplikasi baris di level server.**
`createOpname` membaca snapshot stok tanpa kunci (`inventory.ts:475` via `getStock`, `inventory.ts:122-138` tanpa `FOR UPDATE`), menghitung selisih dari snapshot itu, lalu `applyStockMovement` menerapkannya ke saldo terkini — penjualan/penerimaan yang masuk di antaranya membuat hasil akhir ≠ hasil hitung fisik. Duplikasi produk dalam satu dokumen juga tidak divalidasi server (hanya dicegah UI di `opname-form.tsx:28`); dua baris produk sama menghasilkan selisih ganda dari snapshot yang sama.
*Rekomendasi:* kunci baris stok di awal transaksi opname (atau hitung ulang di dalam kunci per produk), dan tolak baris duplikat di server seperti yang sudah dilakukan `createReceipt` (`inventory.ts:145-148`).

**P2-5. Kartu stok: saldo berjalan mencampur semua gudang dan dimuat tanpa batas.**
`getStockCard` (`reports.ts:657-690`) menjumlahkan saldo berjalan atas gerakan semua gudang yang terurut waktu (halaman detail produk tidak mengoper `warehouseId`, `produk/[id]/page.tsx:52`), sehingga kolom "Saldo" pada baris suatu gudang adalah total lintas gudang — tidak cocok dengan stok gudang mana pun. Fungsi ini juga memuat seluruh riwayat gerakan produk tanpa limit dan mengonversi qty ke `Number` JS.
*Rekomendasi:* saldo berjalan per gudang (grup + running sum per gudang), pagination/limit dengan pemuatan bertahap, aritmetika Decimal.

**P2-6. Nilai persediaan tanpa pagination dan beraritmetika `Number`.**
`getInventoryValuation` (`reports.ts:607-655`) mengembalikan semua produk aktif sekaligus; halaman `nilai/page.tsx` merender semuanya dan rute ekspor CSV memakai data yang sama. Pada katalog 10.000 produk (skenario `db:seed:bulk` yang didukung proyek) halaman ini merender 10.000 baris. Agregasi nilai juga memakai `Number` (`reports.ts:640-646`), melanggar aturan proyek sendiri (AGENTS.md: uang wajib Decimal).
*Rekomendasi:* pagination server untuk halaman nilai (CSV tetap full export), agregasi dengan Decimal/SQL `SUM` numerik.

**P2-7. Review/seleksi impor hanya menjangkau 50 baris pertama; isu per baris tidak ditampilkan.**
Wizard memuat pratinjau dengan `listImportRowsAction({ page: 1, pageSize: 50 })` (`import-wizard.tsx:106`) tanpa kontrol pagination, lalu seleksi (kotak centang exclude) hanya atas 50 baris itu; teksnya sendiri mengakui "Menampilkan 50 baris pertama". Hasil `analysis.preview` (30 baris beserta isu per baris dari `actions/import.ts:214-228`) tidak pernah dirender wizard — tabel seleksi menampilkan kolom "Catatan" dari `row.error ?? row.preview?.barcode ?? "Siap"` (`import-wizard.tsx:335-337`), padahal isu duplikat/konflik hasil analisis tidak disimpan ke `import_rows.error`, sehingga baris bermasalah tampil "Siap"/barcode di tabel seleksi. Klaim README "Pratinjau validasi … Pilih baris yang diimpor" untuk 10.000+ baris dengan demikian hanya benar untuk ringkasan hitungan, bukan review per baris.
*Rekomendasi:* pagination/filter "bermasalah saja" di tabel seleksi (aksi `listImportRowsAction` sudah mendukung `filter: "problem"`, tidak dipakai wizard), dan tampilkan `issue` per baris dari analisis.

**P2-8. Tidak ada rollback/undo impor; aksi batal justru menghapus jejak audit.**
`cancelImportAction` (`actions/import.ts:596-606`) menghapus `import_rows` + `import_jobs` tanpa memeriksa status — termasuk job yang sudah sebagian/seluruhnya ter-commit (produk dan stok yang sudah masuk tidak ikut dibatalkan, tetapi bukti impornya hilang). `finalizeImportAction` (`:608-628`) menandai job `completed` tanpa memeriksa sisa baris `pending`. Keduanya juga **tidak punya pemanggil UI** (dead code), sehingga dari UI memang tidak ada jalan membatalkan atau meng-undo impor sama sekali.
*Rekomendasi:* sediakan "Batalkan impor" yang aman: hanya untuk job belum ter-commit; untuk job ter-commit sediakan laporan dampak + alur koreksi (nonaktifkan produk hasil impor / jurnal & gerakan pembalik tertaut), bukan penghapusan riwayat.

**P2-9. Pilihan gudang default pada form tidak konsisten dengan gudang default perusahaan.**
Form penerimaan/penyesuaian/opname/wizard impor mengawali pilihan gudang ke `warehouses[0]` — hasil `listWarehouses` terurut nama (`catalog.ts:243-254`) — bukan gudang `isDefault`/`settings.defaultWarehouseId` (`receipt-form.tsx:21`, `adjustment-form.tsx:30`, `opname-form.tsx:21`, `import-wizard.tsx:66`). Daftar produk justru memakai gudang default dari pengaturan (`produk/page.tsx:49-55`). Risiko salah gudang senyap pada pemakaian pertama.
*Rekomendasi:* semua form menerima dan mengawali ke gudang default perusahaan (settings → `isDefault` → pertama), satu helper bersama.

**P2-10. Stok minimum global, definisi "stok menipis" tidak konsisten.**
`minStock` satu nilai per produk untuk semua gudang (`schema.ts:456`), tetapi dashboard menghitung menipis dari Σ semua gudang (`gudang/page.tsx:52`), daftar produk dari gudang default saja (`catalog.ts:88-90`), dan halaman nilai dari gudang terpilih (`reports.ts:653`). Satu produk bisa "menipis" di satu halaman dan tidak di halaman lain. Untuk minimarket multi-gudang, minimum per gudang adalah kebutuhan standar.
*Rekomendasi:* pindahkan ambang ke level (produk × gudang) atau dokumentasikan satu definisi kanonis dan pakai di semua halaman.

### P3 — Rendah

**P3-1. Fallback SKU impor tidak konsisten antar tahap.** Pratinjau baris memakai `SKU-<nomorBaris>` (`actions/import.ts:88`), commit memakai `IMP-<6 digit>` (`actions/import.ts:344`), analisis memakai string kosong (`actions/import.ts:160`). SKU yang dilihat pengguna saat review bisa berbeda dari SKU yang benar-benar dibuat.
*Rekomendasi:* satu fungsi fallback SKU dipakai ketiga tahap.

**P3-2. `mapProductRow` menelan data buruk secara diam-diam.** Harga tak terbaca menjadi 0, stok/minimum negatif di-clamp ke 0 tanpa error (`src/lib/import-parse.ts:149-167`); hanya harga negatif eksplisit yang error. Baris dengan harga "abc" lolos sebagai produk berharga 0.
*Rekomendasi:* nilai numerik yang ada tapi tidak terbaca = error baris; tampilkan peringatan clamp di pratinjau.

**P3-3. Laporan hasil aksi impor tidak akurat.** `skipImportRowsAction` mengembalikan jumlah yang *diminta*, bukan yang benar-benar ter-update (`actions/import.ts:646`); `commitSchema.offset` diterima tetapi tidak pernah dipakai (`actions/import.ts:258`); wizard memotong daftar exclude ke 1.000 baris tanpa pemberitahuan (`import-wizard.tsx:117`).
*Rekomendasi:* kembalikan hitungan aktual dari hasil update; hapus parameter mati atau implementasikan.

**P3-4. `createTaxonomyAction` menelan konflik.** Insert memakai `.onConflictDoNothing()` dan mengembalikan `null` (`actions/inventory.ts:377-390`) — pemanggil tidak bisa membedakan "berhasil" dari "nama sudah ada".
*Rekomendasi:* kembalikan error `CONFLICT` yang jelas (mengikuti pola `saveProductAction`).

**P3-5. Dead code yang menyesatkan cakupan fitur.** `productOptions()` memuat semua produk tanpa limit (`catalog.ts:323-337`), `rebuildStockOnHand()` (`inventory.ts:542-556`), `getAllowNegativeStock()` (`inventory.ts:558-570`), `toggleProductAction`, `createTaxonomyAction`, `cancelImportAction`, `finalizeImportAction` — semuanya tanpa pemanggil. Keberadaannya membuat cakupan fitur tampak lebih lengkap dari kenyataan.
*Rekomendasi:* hapus atau sambungkan ke UI; jangan biarkan fungsi yatim menjadi "fitur".

**P3-6. Riwayat dokumen terpotong tanpa pagination.** Penerimaan `limit(40)`, penyesuaian `limit(40)`, transfer `limit(40)`, opname `limit(30)` (halaman masing-masing di `src/app/app/gudang/`) tanpa komponen pagination — dokumen lebih lama tidak terjangkau dari UI (hanya dari pergerakan stok).
*Rekomendasi:* pakai komponen `Pagination` yang sudah ada seperti di daftar produk/pergerakan.

**P3-7. Kotak pencarian di Pergerakan Stok tidak berfungsi.** Halaman memasang `SearchForm` dengan placeholder "Filter dokumen…" (`pergerakan/page.tsx:48-50`), tetapi `searchParams` tidak membaca `q` dan `listMovements` tidak punya parameter teks (`catalog.ts:258-301`) — mengetik di kotak itu tidak menyaring apa pun. Status: UI_ONLY.
*Rekomendasi:* tambahkan filter teks (nomor referensi/produk) ke `listMovements` atau hapus kotak pencariannya.

**P3-8. Indeks pencarian tidak lengkap; commit impor memindai ulang tabel produk per batch.** Indeks trgm hanya pada `products.name` (`schema.ts:467`); pencarian `ilike` pada SKU/barcode di `listProducts`/`searchProducts`/`searchInventoryProductsAction` tidak terindeks trigram. Commit impor memuat **seluruh** tabel produk/kategori/satuan/pemasok ke memori pada setiap batch (`actions/import.ts:362-367`) — untuk 10.000 produk × ±40 batch ini pekerjaan berulang yang besar.
*Rekomendasi:* indeks trgm untuk SKU (barcode sudah equality-friendly), dan muat peta master sekali per sesi commit atau query hanya SKU yang ada di batch.

**P3-9. Opname: stok sistem basi setelah ganti gudang; tidak ada mode hitung menyeluruh.** Form mengambil stok sistem saat produk ditambahkan (`opname-form.tsx:27-36`); mengganti gudang sesudahnya tidak mengambil ulang, sehingga kolom "Sistem/Selisih" menyesatkan (server menghitung ulang, jadi dampaknya hanya tampilan). Opname juga hanya bisa per produk yang dicari manual — tidak ada "muat semua produk di gudang ini", membuat opname berkala ratusan SKU tidak praktis.
*Rekomendasi:* ambil ulang stok sistem saat gudang berubah; sediakan mode muat semua produk per gudang dengan pagination.

**P3-10. Update master tanpa cek keberadaan; parse impor menelan error otorisasi.** `saveSupplierAction`/`saveCustomerAction` mengembalikan hasil update kosong tanpa `NOT_FOUND` bila id tidak ditemukan (bandingkan `saveProductAction` yang melempar `NOT_FOUND`). Rute parse impor menangkap semua error termasuk kegagalan izin dan membalas 500 generik "Gagal membaca file" (`route.ts:108-111`).
*Rekomendasi:* samakan pola `NOT_FOUND`; bedakan error auth/validasi dari error parse di rute impor.

**P3-11. Parse impor hanya membaca sheet pertama dan mengandalkan format tampilan.** `route.ts:31-38` membaca `SheetNames[0]` saja dan memakai `raw: false` (nilai terformat) — file Accurate multi-sheet atau angka dengan format akuntansi yang tidak dikenal `parseNumber` bisa terbaca keliru tanpa peringatan.
*Rekomendasi:* beri pilihan sheet atau peringatan bila sheet > 1; uji dengan fixture ekspor Accurate nyata (NOT_VERIFIED tanpa fixture).

---

## 3. Yang terbukti baik (agar tidak "diperbaiki" tanpa alasan)

- Pencarian produk untuk dokumen memakai pencarian server terpaginasi (limit 20), bukan memuat semua produk — `actions/inventory.ts:399-427`, `product-picker.tsx`.
- `applyStockMovement` mengubah cache dan ledger dalam satu transaksi dengan kunci baris `FOR UPDATE` — `inventory.ts:41-90`.
- `stock_movements` dan `audit_log` append-only di level database — `migrations/0001_rls_and_guards.sql`.
- Nomor dokumen atomik per perusahaan/jenis/tahun — `sequences.ts:33-51`.
- Penerimaan menolak produk duplikat dalam satu dokumen dan produk tak dikenal — `inventory.ts:145-155`.
- Commit impor: staging baris, analisis duplikat/konflik sebelum commit, batch dalam satu transaksi, jurnal stok awal dengan kunci idempotensi — `actions/import.ts`.
- Daftar produk dan pergerakan stok terpaginasi server — `catalog.ts:41-118, 258-301`.
- Ada test rekonsiliasi integritas stok vs ledger untuk data seed — `tests/integration/consistency.test.ts:41`. Yang belum ada: test untuk alur dokumen gudang itu sendiri (penerimaan/penyesuaian/transfer/opname/impor) — statusnya NOT_VERIFIED.
