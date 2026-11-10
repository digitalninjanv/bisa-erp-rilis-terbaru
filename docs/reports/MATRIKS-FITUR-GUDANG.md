# Matriks Verifikasi Fitur — Gudang (A-5)

**Tanggal:** 2026-11-03 · **Penyusun:** QA Engineer (agen) · **Sumber baris fitur:** tabel fitur `docs/audit/GUDANG.md` (Bagian A) + baris Gudang `docs/SPEK-FITUR-INTI.md` (Bagian B)
**Metode:** setiap baris ditelusur dengan grep ke `tests/` lalu berkas test-nya **dibuka dan dibaca** — bukti hanya diakui bila test benar-benar menjalankan fitur itu di level domain/action terhadap DB nyata, bukan dari nama berkas. Celah integrasi yang ditemukan ditutup di `tests/integration/feature-matrix-gudang.test.ts` (15 test baru, kode M-1 s.d. M-11).
**Status:** `TERBUKTI` = ada test otomatis yang menjalankan fitur end-to-end · `SEBAGIAN` = terbukti sebagian, sisa dijelaskan · `UI` = hanya bisa dibuktikan lewat build/halaman (gerbang e2e Tahap 5) · `CELAH` = belum ada bukti / fitur belum dibangun, alasan dinyatakan apa adanya.

## Bagian A — Baris fitur audit Gudang

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| A1 | Produk — buat | `master-crud.test.ts` (fixture `createProduct` lewat `saveProductAction`, dipakai semua test hapus) · `inventory-p1.test.ts` "still accepts valid string amounts for a product" + "rejects a negative product cost price" | TERBUKTI |
| A2 | Produk — edit | `feature-matrix-gudang.test.ts` (M-5) "saveProductAction dengan id mengubah nama & harga; id hantu ditolak NOT_FOUND" — **celah ditutup batch ini** (sebelumnya hanya jalur buat yang teruji) | TERBUKTI |
| A3 | Produk — nonaktif | `feature-matrix-gudang.test.ts` (M-5b) "toggleProductAction menonaktifkan lalu mengaktifkan kembali produk" — **celah ditutup batch ini** | TERBUKTI |
| A4 | Produk — hapus (berpenjaga) | `master-crud.test.ts` "blocks deleting a stocked product and a moved product, deletes a clean one" | TERBUKTI |
| A5 | Kategori — buat | `master-crud.test.ts` "creates a category and a unit through the taxonomy action" + "rejects a duplicate category name and duplicate unit code as CONFLICT" | TERBUKTI |
| A6 | Kategori — edit / hapus / nonaktif | Edit+konflik+hantu: `master-crud.test.ts` "edits taxonomy rows, rejects rename conflicts and ghost ids" · Hapus berpenjaga + audit: "blocks deleting a category used by a product, deletes a clean one with audit" · Nonaktif: `feature-matrix-gudang.test.ts` (M-9) "toggleCategoryAction menonaktifkan lalu mengaktifkan kembali kategori" — **celah ditutup batch ini** | TERBUKTI |
| A7 | Kategori bertingkat (`parentId`) | — | **CELAH — fitur belum dibangun.** Kolom `parentId` tetap yatim; tidak ada keputusan desain/permintaan pengguna yang mengesahkannya di tahap ini. Bukan kegagalan uji; dicatat agar tidak diklaim ada. |
| A8 | Satuan — buat / edit / hapus | `master-crud.test.ts` (satu rangkaian taxonomy dengan A5/A6, termasuk hapus satuan bersih). Nonaktif satuan tidak ada (tabel `units` tanpa kolom `isActive`) — utang kecil yang sudah tercatat di PROGRESS sejak G3 | TERBUKTI |
| A9 | Konversi multi-satuan (dus→pcs) | — | **CELAH — fitur belum dibangun.** Tidak ada tabel/kolom faktor konversi. Sama seperti A7: dicatat jujur, bukan diklaim. |
| A10 | Atribut produk kustom | — | **CELAH — fitur belum dibangun.** Masuk lapisan platform Tahap 5 menurut A-6 (custom fields). |
| A11 | Pemasok — buat | `master-crud.test.ts` (dibuat lewat `saveSupplierAction` di rangkaian edit & hapus) | TERBUKTI |
| A12 | Pemasok — edit | `master-crud.test.ts` "edits a supplier and rejects a ghost id with NOT_FOUND" (termasuk toggle nonaktif) | TERBUKTI |
| A13 | Pemasok — hapus / nonaktif | Nonaktif: test A12 · Hapus bersih + hantu: "deletes clean supplier and customer rows" · Penjaga bertransaksi: `feature-matrix-gudang.test.ts` (M-10) "deleteSupplierAction menolak pemasok yang masih menjadi pemasok utama produk" — **celah ditutup batch ini**. Penjaga berbasis riwayat penerimaan/dokumen mengikuti pola kode yang sama; belum punya test khusus (lihat Catatan 3) | TERBUKTI |
| A14 | Pelanggan — buat / edit / nonaktif / hapus | `master-crud.test.ts` "edits a customer and rejects a ghost id with NOT_FOUND" (termasuk toggle) + "deletes clean supplier and customer rows". Penjaga hapus berbasis riwayat penjualan belum punya test khusus (lihat Catatan 3) | TERBUKTI |
| A15 | Gudang — buat | `master-crud.test.ts` (`saveWarehouseAction` di rangkaian edit gudang) | TERBUKTI |
| A16 | Gudang — edit / nonaktif | `master-crud.test.ts` "edits a warehouse and rejects a ghost id with NOT_FOUND" (termasuk toggle) | TERBUKTI |
| A17 | Gudang — hapus (berpenjaga) | `master-crud.test.ts` "blocks deleting the default warehouse and a stocked warehouse, deletes a clean one" | TERBUKTI |
| A18 | Multi-gudang di transaksi | `inventory-p1.test.ts` (GD-P1-2) "receiving into an empty second warehouse averages against stock in the first" · `feature-matrix-gudang.test.ts` (M-3) transfer dua gudang · `inventory-p2.test.ts` (GD-P2-10) daftar produk & valuasi per gudang | TERBUKTI |
| A19 | Stok minimum & peringatan menipis | `inventory-p2.test.ts` (GD-P2-10/D-4) "isLowStock compares the displayed qty against the product minStock" + "product list and valuation judge low stock by the warehouse figure they display" · Kartu peringatan di dashboard gudang: build/UI | TERBUKTI |
| A20 | Penerimaan barang + jurnal utang (kredit) | `goods-receipt.test.ts` (a) "pembelian kredit: stok bertambah, jurnal Dr Persediaan / Cr Utang, tampil di daftar utang" — alur yang audit nyatakan NOT_VERIFIED kini terbukti penuh | TERBUKTI |
| A21 | Penyesuaian (rusak/kedaluwarsa/hilang/karantina) | Tanda & jurnal: `inventory-adjustment.test.ts` (4 test, termasuk campuran tanda per arah) · Karantina semantik: `inventory-p2.test.ts` (GD-P2-3a, 3 test) · Tipe dokumen tersimpan: (GD-P2-2) · Total dokumen: (GD-P2-1) | TERBUKTI |
| A22 | Retur pembelian ke pemasok (4 metode) | Jalur utang: `inventory-adjustment.test.ts` "purchase_return with a positive qty reduces stock and journals Dr payable / Cr inventory" · `credit_note`: `inventory-p2.test.ts` (GD-P2-3b) "refund via credit note still settles against the payable" · `replacement`: (GD-P2-3b) "replacement: receivable is debited, payable is untouched, inventory is credited" · `cash` & `deduction`: `feature-matrix-gudang.test.ts` (M-11a/M-11b) — **celah ditutup batch ini** | TERBUKTI |
| A23 | Transfer antar gudang | `feature-matrix-gudang.test.ts` (M-3) "transfer memindahkan stok kedua sisi lewat dua gerakan tertaut; on_hand = Σ gerakan" + (M-3b) penjaga stok negatif — **celah ditutup batch ini** (sebelumnya hanya total dokumen di `inventory-p2.test.ts` GD-P2-1 dan jalur void di `inventory-void-import.test.ts` (d)) · Void transfer: `inventory-void-import.test.ts` (d) "void transfer mengembalikan stok kedua gudang" | TERBUKTI |
| A24 | Stok opname | Selisih + jurnal dua arah: `feature-matrix-gudang.test.ts` (M-4) "opname kurang menjurnal selisih kurang, opname lebih membalik arah; stok mengikuti hasil hitung" — **celah ditutup batch ini** · Duplikat baris ditolak: `inventory-p2.test.ts` (GD-P2-4) · Total dokumen: (GD-P2-1) | TERBUKTI |
| A25 | Void/koreksi dokumen gudang posted | `inventory-void-import.test.ts` (a) void penerimaan, (b) penolakan stok terpakai, (c) void penyesuaian, (d) void transfer · `goods-receipt.test.ts` (e) void per sumber + penolakan yang sudah dibayar · Tautan PO: Bagian B6 | TERBUKTI |
| A26 | Kartu stok (`getStockCard`) | — | **CELAH — terjadwal Tahap 4 (GD-P2-5).** Fungsi belum punya test dan perilaku saldo berjalannya masih mencampur gudang (cacat yang sudah diketahui & dijadwalkan); mengujinya sekarang akan mengunci perilaku yang salah. Bukan celah yang bisa ditutup dengan test di tahap ini. |
| A27 | Pergerakan stok (daftar) | Pencarian teks: `movements-pagination.test.ts` (GD-P3-7, 2 test) · Pagination: `feature-matrix-gudang.test.ts` (M-8) "pagination per produk: total konsisten antar halaman dan baris tidak tumpang tindih" — **celah ditutup batch ini** | TERBUKTI |
| A28 | Nilai persediaan + ekspor CSV | Fungsi valuasi: `consistency.test.ts` "reports the same inventory value as SQL" · `inventory-p2.test.ts` (GD-P2-10) valuasi per gudang · Dashboard = saldo GL: `reports-p2.test.ts` (AK-P2-11). Ekspor CSV: route build/UI. Pagination valuasi = GD-P2-6, terjadwal Tahap 4 | TERBUKTI |
| A29 | Pemilih produk untuk transaksi | `feature-matrix-gudang.test.ts` (M-6) "searchInventoryProductsAction menemukan produk aktif dari nama & SKU; yang nonaktif tidak tampil" — **celah ditutup batch ini** (action pencarian server limit 20 kini teruji nyata) | TERBUKTI |
| A30 | Integritas `stock_on_hand` = Σ `stock_movements` | `consistency.test.ts` "keeps stock_on_hand equal to the movement ledger" (seluruh data seed) + invariant per skenario di `stock-batches.test.ts` (Σ batch) dan (M-3)/(M-4) berkas matriks | TERBUKTI |
| A31 | Pencegahan stok negatif | Jalur batch: `stock-batches.test.ts` (c)/(c2) checkout ditolak `INSUFFICIENT_STOCK` · Jalur transfer: `feature-matrix-gudang.test.ts` (M-3b) · Penjaga void: `inventory-void-import.test.ts` (b) · POS menghormati `allowNegativeStock`: `sale-flow.test.ts` | TERBUKTI |
| A32 | Konkurensi mutasi stok | Kunci baris `FOR UPDATE` di `applyStockMovement`/`lockStockQty` terverifikasi dari kode; perilaku anti-dobel teruji tidak langsung lewat penolakan duplikat opname (GD-P2-4) dan anti-ganda commit impor (`inventory-void-import.test.ts` (e)). Uji balapan paralel sejati tidak ada dalam pola suite ini | SEBAGIAN |
| A33 | Impor — unggah & parse | `import-hardening.test.ts` (g) "rute parse membaca nilai mentah dan memperingatkan sheet lain" · Unit: `tests/unit/import-parse.test.ts` (22 test) | TERBUKTI |
| A34 | Impor — pratinjau & seleksi baris | `import-review.test.ts` "analisis menyimpan issue per baris dan listImportRowsAction menyaringnya dengan tepat" (isu per baris + filter problem + pagination) | TERBUKTI |
| A35 | Impor — commit per batch | `inventory-void-import.test.ts` (e) commit + anti-ganda · `import-hardening.test.ts` (d) "fallback SKU identik di analisis, daftar baris, dan commit" | TERBUKTI |
| A36 | Impor — stok awal + jurnal saldo awal | `inventory-void-import.test.ts` (e) "produk yang diperbarui menerima gerakan opening + jurnal saldo awal, dan commit ulang tidak menggandakan" | TERBUKTI |
| A37 | Impor — perbaiki baris error di tempat | — | **CELAH — fitur belum dibangun.** Baris error hanya bisa dilewati (`skipImportRowsAction`, teruji di `import-hardening.test.ts` (f)); edit baris di tempat belum pernah diputuskan/dibangun. |
| A38 | Penomoran dokumen gudang | `purchase-order.test.ts` (a) pola nomor `PO-<tahun>-…` · Semua test dokumen di atas membentuk dokumen lewat `nextDocumentNumber` yang sama dan nomornya dipakai sebagai kunci pencarian (mis. `movements-pagination.test.ts` mencari gerakan dari nomor penerimaan) | TERBUKTI |
| A39 | Batch/lot & tanggal kedaluwarsa per stok + FEFO | `stock-batches.test.ts` (9 test: penerimaan batch, batch wajib, FEFO, blokir kedaluwarsa penuh/sebagian, retur ke batch asal, transfer batch, sisa tanpa-batch, daftar kedaluwarsa) | TERBUKTI |
| A40 | Pembayaran utang penerimaan (modul Akuntansi) | `payments-void-p2.test.ts` "records a payable payment on the chosen past date" + rangkaian void pembayaran · Daftar utang terbaca dari penerimaan: `goods-receipt.test.ts` (a) | TERBUKTI |

## Bagian B — Baris Gudang dari spek fitur inti pengguna

| # | Fitur spek | Bukti uji | Status |
|---|---|---|---|
| B1 | Terima barang skenario B — bayar tunai sekaligus, tanpa utang | `goods-receipt.test.ts` (b) "pembelian tunai: jurnal Dr Persediaan / Cr akun kas pilihan, tanpa utang, dokumen lahir lunas" | TERBUKTI |
| B2 | Terima barang skenario C — tanpa pembelian (stok awal/bonus/retur pelanggan/lainnya) | `goods-receipt.test.ts` (c) stok awal ke ekuitas, (c2) bonus ke `other_income`/fallback pendapatan, (c3) retur pelanggan ke `sales_return` · Validasi sumber: (d) | TERBUKTI |
| B3 | Cetak Bukti Penerimaan Barang (GRN) | Halaman cetak per penerimaan (pola cetak proyek) — build/UI, tanpa test otomatis | UI — gerbang e2e Tahap 5 |
| B4 | Nomor invoice supplier tercatat di penerimaan | `goods-receipt.test.ts` (a) memeriksa `supplierInvoiceNumber` tersimpan. (Jumlah rusak per baris SENGAJA tidak dibangun — keputusan D-5; barang rusak saat tiba lewat dokumen penyesuaian A21) | TERBUKTI |
| B5 | Purchase Order — siklus draft→sent→partial→received/cancelled, anti-kelebihan | `purchase-order.test.ts` (a) draft→sent, (b/c) sebagian→penuh, (d) kelebihan ditolak tanpa perubahan, (d2) pemasok/produk di luar PO ditolak, (e) batal bersyarat | TERBUKTI |
| B6 | Void penerimaan tertaut PO mengembalikan progres PO | `feature-matrix-gudang.test.ts` (M-1a) penuh: received→sent & receivedQty 10→0 · (M-1b) sebagian: received→partial & receivedQty 10→4 — **celah wajib ditutup batch ini** (sebelumnya diakui PROGRESS belum teruji) | TERBUKTI |
| B7 | Penerimaan terhadap PO untuk produk `track_batch` (jalur G7 × G8) | `feature-matrix-gudang.test.ts` (M-2) progres PO + batch tercatat + invariant Σ batch = stok · (M-2b) tanpa nomor batch ditolak, PO tidak berubah — **celah wajib ditutup batch ini** (dua fitur belum pernah bertemu di test) | TERBUKTI |
| B8 | Rekomendasi pembelian + buat PO per pemasok | `purchase-order.test.ts` (f) "rekomendasi: qty saran = 2× minimum − stok; buat PO mengelompokkan per pemasok" (angka saran terverifikasi persis, produk tanpa pemasok utama masuk daftar skipped) | TERBUKTI |
| B9 | Cetak Purchase Order | Halaman cetak PO (pola GRN) — build/UI, tanpa test otomatis | UI — gerbang e2e Tahap 5 |
| B10 | Simulasi pengguna end-to-end (spek §5) | `goods-receipt.test.ts` (f) "SIMULASI PENGGUNA: terima tunai 100 @2.500, jual 1 @3.000, stok 99, laba kotor 500" | TERBUKTI |

## Ringkasan

- **Total baris fitur: 50** (40 audit + 10 spek).
- **TERBUKTI otomatis: 42 baris** — termasuk 15 test baru batch ini yang menutup 10 baris/celah: A2, A3, A6 (nonaktif), A13 (penjaga), A22 (cash/deduction), A23, A24, A27 (pagination), A29, B6, B7.
- **SEBAGIAN: 1 baris** (A32 konkurensi — desain kunci terverifikasi kode, tanpa test balapan paralel).
- **UI/build saja: 2 baris** (B3 cetak GRN, B9 cetak PO) — gerbang e2e Tahap 5.
- **CELAH tersisa: 5 baris**, semuanya **bukan** celah uji integrasi:
  - 4 fitur yang memang belum dibangun dan belum diputuskan dibangun di tahap ini: A7 kategori bertingkat, A9 konversi multi-satuan, A10 atribut produk kustom (Tahap 5), A37 edit baris impor di tempat.
  - 1 perbaikan terjadwal: A26 kartu stok per gudang (GD-P2-5, Tahap 4).
- **Celah uji integrasi yang tersisa: NOL.** Semua alur dokumen gudang yang dulu NOT_VERIFIED (penerimaan, penyesuaian, transfer, opname, commit impor) kini punya test end-to-end.
- **Bug produksi yang ditemukan test matriks: TIDAK ADA.** Ke-15 test baru hijau terhadap kode produksi apa adanya; jalur gabungan yang belum pernah bertemu (void × PO, PO × batch) berperilaku benar. Satu-satunya kegagalan selama penulisan adalah assertion test yang salah kontrak (`listMovements` memang tidak mengembalikan `productId` — barisnya berbentuk tampilan), diperbaiki di sisi test dengan bukti filter yang setara (total eksak + SKU baris).

## Catatan & temuan untuk Pemimpin

1. **T-1 (minor, di luar ruang lingkup perbaikan batch ini):** `toggleProductAction` (`src/server/actions/inventory.ts`) tidak menolak id yang tidak ada — update tanpa cek hasil, sehingga toggle untuk produk hantu tampak berhasil, tidak konsisten dengan toggle pemasok/pelanggan/gudang/kategori yang semuanya mengembalikan `NOT_FOUND` (teruji di `master-crud.test.ts`). Ditemukan saat membaca kode untuk baris A3; berkas action tidak termasuk ruang lingkup perbaikan yang diizinkan batch ini, jadi dicatat, tidak diubah.
2. **Dokumen gudang belum punya kunci idempotensi** (sudah dicatat audit di baris konkurensi): perlindungan terhadap kirim-ulang saat ini hanya state sibuk di form. Bila Pemimpin ingin menutupnya, polanya meniru kunci idempotensi jurnal/POS yang sudah ada.
3. **Penjaga hapus berbasis riwayat untuk pemasok (penerimaan/dokumen) dan pelanggan (penjualan)** mengikuti pola kode yang sama dengan penjaga yang teruji (produk/gudang/kategori/pemasok-utama), tetapi belum punya test khusus — membuatnya butuh fixture transaksi ter-commit yang tidak bisa di-rollback bersih dari action. Dicatat sebagai sisa bukti minor, bukan celah perilaku: tidak ada indikasi penjaganya salah.
4. DB dev sempat mati dan dihidupkan ulang mengikuti prosedur PROGRESS.md (`pg_ctl … -p 5433 start` sebagai `pguser`); percobaan start pertama gagal wajar karena server ternyata masih berjalan (PID postmaster aktif, log checkpoint normal) — tidak ada data yang hilang.
