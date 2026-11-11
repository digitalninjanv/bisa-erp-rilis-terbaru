# Audit Modul Gudang BISA-ERP — Workflow, Stok & Akuntansi

- **Tanggal**: 11 November 2026
- **Cakupan**: Modul Gudang (penerimaan, void penerimaan, penyesuaian, opname, transfer, batch/serial/FEFO, expiry, supplier returns, opening balances, AVCO/FIFO, GL reconciliation)
- **Mode**: Read-only audit (tanpa perubahan kode, tanpa commit, tanpa mutasi DB)
- **Metode**: Inspeksi statis kode + validasi konsep terhadap referensi warehouse/inventory via Exa AI

> Tidak ada test yang dijalankan ulang. Temuan bersifat statis berbasis kode.

---

## 1. Ringkasan Eksekutif

Ditemukan **9 temuan Gudang**: 3 Tinggi, 3 Sedang, 3 Rendah. Tidak ditemukan konflik tanda (debit/kredit) pada jurnal persediaan utama; jurnal penerimaan (`Dr persediaan DPP + Dr PPN masukan = Cr total`), penjualan (`Dr COGS / Cr inventory`), retur, adjustment, dan opname sudah konsisten. Risiko utama berada pada **guard void penerimaan yang tidak agregat per produk**, **void penerimaan ber-PPN memakai biaya kotor**, **void transfer tertutup yang salah hitung**, serta **race condition AVCO global**.

---

## 2. Referensi Gudang yang Digunakan (Exa)

1. **Jodoo Warehouse Inventory Management** — kontrol penuh stock movement loop: receiving, putaway, pick, transfer, count, adjustment, reconcile; evidence & ownership per movement; exception path.
2. **Descartes Finale warehouse shipping/receiving** — ASN, physical unloading, inspection, goods receipt, putaway, pick, verify, pack, dispatch; barcode scan di setiap transisi.
3. **Infor warehouse inventory management** — verification & location assignment, movement & quantity updates, replenishment, returns handling, cycle counting, location visibility.
4. **Soltein/Odoo valuation & cost** — AVCO recomputed on every receipt; delivery lowers quantity/value but does not change unit cost; FEFO picks by removal date (not expiry); lot/serial & expiry tracking; negative stock control; correct outgoing cost vs valuation.

---

## 3. Area Gudang yang Diverifikasi Konsisten (Tidak Ditemukan Konflik)

- **Jurnal penerimaan**: `Dr persediaan (DPP) + Dr PPN masukan = Cr total` (`src/server/inventory/receipt-journal.ts:111-131`).
- **Penjualan**: `Dr COGS / Cr inventory`; retur penjualan: `Dr inventory / Cr COGS` (`src/server/pos/sales-persist.ts:361-362`, `src/server/pos/returns.ts:662-667`).
- **Penyesuaian write-off**: `Dr damaged/shrink / Cr inventory` (`src/server/inventory/adjustments-post.ts:286-301`).
- **Opname**: surplus `Dr inventory / Cr shrink`, shortage `Dr shrink / Cr inventory` (`src/server/inventory/opname.ts:297-305`).
- **Transfer selisih**: `Dr shrink / Cr inventory` (`src/server/inventory/transfers-receive.ts:127-138`).
- **Batch FEFO**: keluar negatif, masuk positif; invariant `Σ batch = on-hand` (`src/server/batches.ts:119-163`); penjualan memakai `purpose: "sale"` dan mengecualikan batch kedaluwarsa.
- **Void dokumen/mirror movement**: memakai delta negasi original (`src/server/inventory/documents.ts:209`, `receipt-void.ts:184/212`) dengan penjaga stok sebelum penulisan.
- **Maker-checker**: transfer dua tahap (`transfers-receive.ts:76-86`) dan retur pemasok (`supplier-returns/posting.ts:320-330`).
- **Idempotensi** (GDG3-06) dan **lock baris** (`for("update")`) konsisten di penerimaan, penyesuaian, transfer, opname.
- **FEFO eligible pada tanggal kedaluwarsa**: penjualan memakai `purpose: "sale"` yang mengecualikan batch kedaluwarsa.

---

## 4. Temuan

### G-01 (Tinggi) — Void penerimaan tidak mengagregasi stok per produk sebelum cek ketersediaan

- **File**: `src/server/inventory/receipt-void.ts:103-115` (`assertVoidStockAvailable`)
- **Bukti**: loop per baris penerimaan, tiap baris memanggil `lockStockQty(... line.productId)` dan membandingkan `available < line.qty` secara terpisah. Jika satu produk muncul di beberapa baris batch, guard bisa lolos walau total qty void melebihi stok tersedia (mis. 2 baris ×5 dengan stok 7: kedua cek 7≥5 lolos, total 10>7).
- **Dampak**: void dapat menurunkan stok negatif diam-diam; invariant `Σ batch = on-hand` bisa patah. Kontras dengan `voidStockDocument` yang sudah agregasi per `warehouse:product`.
- **Saran**: agregasi qty per produk sebelum cek stok, seperti pola `voidStockDocument`.

### G-02 (Tinggi) — Void penerimaan ber-PPN (harga termasuk PPN) memakai biaya kotor, bukan DPP

- **File**: `src/server/inventory/receipt-void.ts:177-183` (`reverseReceiptStock`); `src/server/inventory/receipts.ts:600-618`
- **Bukti**: `reversalUnitCost = line.lineTotal / line.qty`. Untuk penerimaan `taxIncluded`, `lineTotal` yang disimpan di `stock_receipt_lines` adalah harga bruto (inklusif PPN), sedangkan gerakan stok masuk (`applyReceiptStock`) memakai `stockUnitCost` = DPP. Jadi gerakan pembalik dicatat pada biaya kotor dan `recomputeCostFromLedger` akan merusak AVCO/GL.
- **Dampak**: setelah void, `Σ qty × costPrice` dan saldo GL persediaan tidak selaras untuk produk yang pernah diterima dengan PPN inklusif. Mode PPN eksplisit (DPP) tidak terdampak.
- **Saran**: gunakan DPP/biaya gerakan asal (stockUnitCost) untuk reversal, bukan `lineTotal / qty`.

### G-03 (Tinggi) — Void transfer yang ditutup sebagai selisih perjalanan bisa salah hitung guard

- **File**: `src/server/inventory/documents.ts:88-115` (`voidStockDocument`, blok `removals`)
- **Bukti**: agregasi hanya movement dengan `qty > 0`. Pada transfer yang ditutup selisih, gerakan `transfer_in` untuk porsi selisih juga positif, lalu di-offset oleh `transfer_difference` negatif. Guard menghitung kebutuhan pengeluaran = seluruh `transfer_in` (termasuk porsi selisih yang tidak pernah menjadi stok fisik), sehingga stok tujuan yang cukup untuk porsi diterima saja bisa dianggap kurang.
- **Dampak**: void transfer tertutup dapat ditolak palsu atau memaksa pemeriksaan manual.
- **Saran**: netting gerakan `transfer_difference` (negatif) terhadap `transfer_in` per produk/gudang sebelum guard.

### G-04 (Sedang) — Race condition AVCO global saat blend biaya masuk

- **File**: `src/server/inventory/movements.ts:124-150` (`applyStockMovement`)
- **Bukti**: lock hanya pada baris `products` (costPrice) dan gudang target; sum `stock_on_hand` seluruh gudang tidak di-lock. Gerakan keluar (penjualan) di gudang lain yang commit di antara pembacaan sum dan blend dapat membuat `globalBefore = globalAfter - delta` salah, sehingga `costPrice` baru terdistorsi.
- **Dampak**: pada beban tinggi, rata-rata bergerak bisa menyimpang dari GL. Perlu serialisasi stok per produk atau hitung global sebelum dari baris yang terkunci.
- **Saran**: serialisasi stok per produk (lock semua baris stok produk) atau hitung global sebelum lock.

### G-05 (Sedang) — Opname langsung diposting tanpa gate persetujuan/ambang

- **File**: `src/server/inventory/opname.ts:117` (status `posted`) dan seluruh `createOpname`
- **Bukti**: penyesuaian memiliki approval gate berbasis threshold (`adjustments.ts` + `adjustments-post.ts`), tetapi opname selalu status `posted` dengan jurnal otomatis. Tidak ada pemisahan pembuat vs pemeriksa.
- **Dampak**: selisih opname bernilai besar bisa diposting oleh satu pengguna tanpa kontrol empat mata; risiko fraud/kesalahan.
- **Saran**: tambahkan approval/kontrol opname bernilai tinggi (threshold) dan pemisahan maker-checker.

### G-06 (Sedang) — Refund retur pemasok tidak membatasi akun tujuan ke kas/bank

- **File**: `src/server/supplier-returns/resolutions.ts:305-326` (`refundSupplierReturn`)
- **Bukti**: akun tujuan hanya dicek eksistensi (`if (!account) throw`), tanpa validasi postable/aktif/kelas kas-bank seperti `createReceipt` (`resolveReceiptContext`/`listCashBankIds`).
- **Dampak**: refund bisa dijurnal ke akun non-kas (mis. persediaan/pendapatan), merusak GL.
- **Saran**: validasi akun tujuan ke kas/bank (postable, aktif, kelas cash/bank).

### G-07 (Sedang) — Impor stok awal tidak me-blend AVCO (inkonsisten dengan penerimaan)

- **File**: `src/server/actions/import/commit-phases.ts:439-452`; `src/server/inventory/movements.ts:113-117`
- **Bukti**: `applyStockMovement` hanya me-blend `costPrice` untuk `movementType === "purchase" || "sale_return"`; gerakan `opening` dicatat dengan `unitCost` tetapi tidak memperbarui `products.costPrice`. Penerimaan sumber `opening` justru lewat `receipt-stock.ts:45` memakai `movementType: "purchase"`, sehingga AVCO-nya ter-blend.
- **Dampak**: menambah stok awal ke produk yang sudah punya stok dapat meninggalkan `costPrice` lama; nilai persediaan subledger ≠ GL.
- **Saran**: samakan perlakuan AVCO untuk gerakan `opening` (blend) atau dokumentasikan sebagai pengecualian.

### G-08 (Rendah) — Koreksi persediaan memakai akun `inventory_shrink` dua arah

- **File**: `src/server/inventory/adjustments-post.ts:264-268`
- **Bukti**: koreksi naik `Dr inventory / Cr inventory_shrink`; koreksi turun `Dr inventory_shrink / Cr inventory`.
- **Dampak**: secara aritmetika seimbang, tetapi secara semantik akun `inventory_shrink` dipakai dua arah; tidak ada akun gain persediaan terpisah.
- **Saran**: tambahkan akun gain persediaan terpisah untuk koreksi positif (opsional, sesuai kebijakan).

### G-09 (Rendah) — `recomputeCostFromLedger` mempertahankan `costPrice` lama bila qty neto ≤ 0

- **File**: `src/server/inventory/movements.ts:392-412`
- **Bukti**: `if (qty.lte(0)) return;`
- **Dampak**: produk dengan stok nol/negatif tetap menampilkan HPP acuan lama; blend berikutnya memakai acuan itu. Didokumentasikan sebagai disengaja, tetapi berisiko bila negatif stock diizinkan.
- **Saran**: reset `costPrice` ke 0 atau nilai terakhir bila qty ≤ 0, sesuai kebijakan.

---

## 5. Validasi Kode per Temuan (Read-Only)

| ID | Status | Bukti kode yang diperiksa ulang |
|---|---|---|
| G-01 | Tervalidasi | `receipt-void.ts:103-115` loop per baris tanpa agregasi per produk |
| G-02 | Tervalidasi | `receipt-void.ts:177-183` `reversalUnitCost = line.lineTotal / line.qty`; `receipts.ts:600-618` DPP vs bruto |
| G-03 | Tervalidasi | `documents.ts:88-115` agregasi `qty > 0` tanpa netting selisih |
| G-04 | Tervalidasi | `movements.ts:124-150` lock hanya produk & gudang target |
| G-05 | Tervalidasi | `opname.ts:117` status `posted` otomatis |
| G-06 | Tervalidasi | `resolutions.ts:305-326` hanya cek eksistensi akun |
| G-07 | Tervalidasi | `commit-phases.ts:439-452` gerakan `opening`; `movements.ts:113-117` blend hanya purchase/sale_return |
| G-08 | Tervalidasi | `adjustments-post.ts:264-268` memakai `inventory_shrink` dua arah |
| G-09 | Tervalidasi | `movements.ts:392-412` `if (qty.lte(0)) return;` |

---

## 6. Catatan Metodologi

- Audit ini **read-only**: tidak ada perubahan kode, tidak ada commit, tidak ada mutasi DB.
- Tidak ada test yang dijalankan ulang; temuan bersifat statis berbasis kode.
- Validasi akhir tetap perlu uji integrasi/DB aktual, khususnya untuk G-01/G-02/G-03 (void) dan G-04 (race condition AVCO).

---

## 7. Rekomendasi Langkah Lanjut

- Prioritas perbaikan: **G-01, G-02, G-03** (Tinggi).
- Tambahkan agregasi per produk pada guard void penerimaan.
- Gunakan DPP/biaya gerakan asal untuk reversal void penerimaan ber-PPN.
- Netting gerakan selisih pada guard void transfer tertutup.
- Serialisasi stok per produk untuk AVCO global.
- Tambahkan approval/kontrol opname bernilai tinggi.
- Validasi akun refund retur ke kas/bank.

---
*File ini adalah artefak audit Gudang. Tidak mengubah kode produksi.*