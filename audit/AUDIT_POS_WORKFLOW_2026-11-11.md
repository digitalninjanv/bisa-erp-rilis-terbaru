# Audit POS BISA-ERP — Workflow, Akuntansi & Konsistensi

- **Tanggal**: 11 November 2026
- **Cakupan**: Modul POS (penjualan, pembayaran, stok, jurnal, retur, void, sesi kas, held sales, offline sync, payment fee, barcode scanner)
- **Mode**: Read-only audit (tanpa perubahan kode, tanpa commit, tanpa mutasi DB)
- **Metode**: Inspeksi statis kode + validasi konsep terhadap referensi POS/accounting via Exa AI

> Tidak ada test yang dijalankan ulang. Temuan bersifat statis berbasis kode.

---

## 1. Ringkasan Eksekutif

Ditemukan **7 temuan POS**: 3 Tinggi, 4 Sedang. Tidak ditemukan konflik tanda (debit/kredit) pada jurnal penjualan utama; jurnal penjualan, COGS, piutang, dan pembayaran sudah konsisten. Risiko utama berada pada **penutupan sesi tanpa cek held sales**, **penyelesaian offline yang bisa melewati cek total**, dan **void/refund yang tidak konsisten dengan tender non-tunai/laci**.

---

## 2. Referensi POS yang Digunakan (Exa)

1. **Pinkapple ERP POS Operations** — returns harus mempertahankan original sale reference, returned qty ≤ returnable qty, refund method, stock reversal, GL reversal, settlement impact; session close harus review variance/payment totals; offline sync harus clear pending queue sebelum close.
2. **Tracepos double-entry architecture** — penjualan kredit: `Dr A/R`, `Cr revenue`, `Cr tax`; inventory: `Dr COGS`, `Cr inventory`; penjualan tunai: `Dr cash/bank`, `Cr revenue`, `Cr tax`.
3. **Paladin POS void** — void membuat transaksi invers pada tanggal void, membalik SOH, inventory asset, revenue, COGS, payment type; void harus tercatat untuk audit trail.
4. **Stripe void handling** — void tidak berkontribusi ke revenue/taxable income; harus dibedakan dari completed sale; audit trail penting.
5. **HelloBooks / Veltacode offline-first POS** — `ClientOrderId` UUID, server-side idempotency, retry-safe, per-sale transaction, offline stock reconciliation, last-item conflict ditangani sebagai sinyal.
6. **AnywherePOS / Sahl / Nonari cash reconciliation** — expected cash = opening float + cash sales + cash-in − cash-out − refunds; variance (counted − expected) di-post ke cash over/short; shortage `Dr cash over/short, Cr cash`; surplus `Dr cash, Cr cash over/short`; drawer per register.

---

## 3. Area POS yang Diverifikasi Konsisten (Tidak Ditemukan Konflik)

- **Jurnal penjualan**: revenue `Cr`, tax `Cr`, cash/bank/receivable `Dr`; COGS `Dr`, inventory `Cr` (sesuai referensi Tracepos).
- **Retur penjualan**: pembalik revenue, diskon, tax, COGS, inventory dengan arah yang benar (`src/server/pos/returns.ts:640-675`).
- **Void penjualan**: `reverseSourceJournal` membalik seluruh jurnal penjualan (revenue, tax, COGS, inventory, cash/bank/receivable) dengan arah invers (sesuai referensi Paladin/Stripe).
- **Fee pembayaran**: penjaga `bank_fee` account mapping sebelum posting (`src/server/pos/sales-persist.ts:303-308`, `src/server/pos/receivables.ts:278-283`).
- **Idempotensi offline**: memakai `item.clientKey` sebagai `idempotencyKey` penjualan (`src/server/pos-offline.ts:375-388`), dan deteksi duplikat via `sales.idempotencyKey` (`src/server/pos-offline.ts:268-280`).
- **Barcode scanner global**: hook sudah dipanggil di terminal (`src/components/pos/pos-terminal.tsx:353-361`), temuan audit lama "hook tidak terpakai" tidak berlaku.
- **Session close variance**: jurnal selisih kas lebih/kurang dengan arah yang benar (`src/server/pos/sessions.ts:137-152`), toleransi dan alasan ditegakkan server.
- **Held sales**: helper `countHeldSales` tersedia (`src/server/pos/sessions.ts:341-347`).

---

## 4. Temuan

### P-01 (Tinggi) — Penutupan sesi kas tidak memeriksa held sales

- **File**: `src/server/pos/sessions.ts:100-205` (`closeCashSession`)
- **Bukti**: fungsi hanya menghitung `expected = sum(cashMovements)` dan menutup sesi; tidak ada query `sales.status = 'held'`. Helper `countHeldSales` ada di `src/server/pos/sessions.ts:341-347` tetapi tidak dipanggil di `closeCashSession`.
- **Dampak**: shift bisa ditutup sementara masih ada held sales, sehingga penjualan gantung & stok reservasi tertinggal (melanggar referensi Pinkapple: jangan close session dengan pending queue).
- **Saran**: tambahkan penjaga di `closeCashSession`: tolak penutupan bila ada held sales, atau wajibkan release/cancel held sales terlebih dahulu.

### P-02 (Tinggi) — Penyelesaian offline melewati cek total bila snapshot harga tidak lengkap

- **File**: `src/server/pos-offline.ts:625,647-652`
- **Bukti**: `hasFrozenPrices = item.lines.every((line) => line.unitPrice != null)`; pengecekan `sale.total === snapshotTotal` hanya dijalankan `if (hasFrozenPrices && ...)`. Satu baris tanpa `unitPrice` membuat cek total dilewati.
- **Dampak**: penyelesaian dapat memposting total berbeda dari struk offline.
- **Saran**: jadikan `unitPrice` wajib pada snapshot offline; bila ada baris tanpa harga, tolak penyelesaian atau gunakan harga server dengan konfirmasi eksplisit.

### P-03 (Tinggi) — Cek harga snapshot offline tidak atomik terhadap posting

- **File**: `src/server/pos-offline.ts:343-393`
- **Bukti**: `quoteCart` dilakukan pada baris 343-353, lalu `createSale` di transaksi terpisah pada baris 376-393; tidak ada kunci yang menjaga harga/produk di antara dua kutipan.
- **Dampak**: perubahan harga/produk di antara dua kutipan bisa memposting total berbeda dari struk.
- **Saran**: lakukan `quoteCart` dan `createSale` dalam satu transaksi/locking, atau simpan snapshot harga yang immutable.

### P-04 (Sedang) — Pemilihan sesi kas untuk refund retur tanpa `FOR UPDATE`

- **File**: `src/server/pos/returns-settlement.ts:316-334`
- **Bukti**: query sesi terbuka pemroses (`status = 'open'`) tidak memakai `.for("update")`, sedangkan `closeCashSession` mengunci baris sesi yang sama. Mutasi refund dapat menempel ke sesi yang baru ditutup transaksi lain.
- **Dampak**: `expectedCash`/selisih tutup sesi bisa rusak.
- **Saran**: tambahkan `.for("update")` pada pemilihan sesi pemroses.
- **Catatan**: jalur void (`sales-void.ts:332-337`) sudah mengunci sesi asal, tetapi fallback sesi pemroses di `sales-void.ts:344-356` juga tanpa `FOR UPDATE`.

### P-05 (Sedang) — Jurnal retur selalu memakai `map.sales_discount`, mengabaikan akun diskon kelompok

- **File**: `src/server/pos/returns.ts:657`
- **Bukti**: baris kredit pembalik diskon hardcode `map.sales_discount`, sementara penjualan memakai `quote.discountAccountId ?? map.sales_discount` (`sales-persist.ts:349`). `discountAccountId` tidak disimpan di `sales`/`sale_lines`, jadi retur tidak bisa memakai akun diskon kelompok asal.
- **Dampak**: GL diskon per akun tidak seimbang untuk penjualan dengan kelompok harga.
- **Saran**: simpan `discountAccountId` pada sale/sale line, atau resolve ulang dari kelompok harga saat retur.

### P-06 (Sedang) — Void penjualan non-tunai tidak mencatat refund/outflow

- **File**: `src/server/pos/sales-void.ts:325-327` (`cashTotal` hanya metode `cash`)
- **Bukti**: `reverseSourceJournal` membalik seluruh jurnal penjualan (termasuk QRIS/bank), tetapi `recordVoidCashRefund` hanya menulis mutasi kas untuk tender tunai. Tidak ada pencatatan keluar untuk tender non-tunai.
- **Dampak**: saldo bank/QRIS GL berkurang tanpa dokumen arus keluar; risiko double-count.
- **Saran**: untuk tender non-tunai, catat mutasi bank/QRIS (outflow) atau dokumen settlement yang sesuai.

### P-07 (Sedang) — Void tunai tanpa sesi terbuka membiarkan laci tidak konsisten

- **File**: `src/server/pos/sales-void.ts:359-374`
- **Bukti**: bila tidak ada sesi terbuka, `refundSessionId` tetap `null` dan tidak ada mutasi laci, tetapi mutasi kas awal penjualan tetap ada. Audit hanya mencatat `refundSessionNote`.
- **Dampak**: saldo laci ≠ GL kas; selisih tutup sesi berikutnya tidak terjelaskan.
- **Saran**: wajibkan sesi kas terbuka untuk void tunai, atau catat refund sebagai mutasi "pending" yang harus diselesaikan saat sesi berikutnya dibuka.

---

## 5. Validasi Kode per Temuan (Read-Only)

| ID | Status | Bukti kode yang diperiksa ulang |
|---|---|---|
| P-01 | Tervalidasi | `closeCashSession` tidak memanggil `countHeldSales`; helper tersedia tapi tidak dipakai |
| P-02 | Tervalidasi | `pos-offline.ts:625` `hasFrozenPrices`; `:647-652` cek total kondisional |
| P-03 | Tervalidasi | `pos-offline.ts:343-353` `quoteCart`; `:376-393` `createSale` terpisah |
| P-04 | Tervalidasi | `returns-settlement.ts:316-334` tanpa `.for("update")` |
| P-05 | Tervalidasi | `returns.ts:657` hardcode `map.sales_discount`; `sales-persist.ts:349` memakai `quote.discountAccountId` |
| P-06 | Tervalidasi | `sales-void.ts:325-327` filter `methodType === "cash"` |
| P-07 | Tervalidasi | `sales-void.ts:359-374` `refundSessionId` bisa null tanpa mutasi laci |

---

## 6. Catatan Metodologi

- Audit ini **read-only**: tidak ada perubahan kode, tidak ada commit, tidak ada mutasi DB.
- Tidak ada test yang dijalankan ulang; temuan bersifat statis berbasis kode.
- Validasi akhir tetap perlu uji integrasi/DB aktual, khususnya untuk P-02/P-03 (offline settlement) dan P-04 (race condition session close).

---

## 7. Rekomendasi Langkah Lanjut

- Prioritas perbaikan: **P-01, P-02, P-03** (Tinggi).
- Tambahkan penjaga server untuk held sales saat close session.
- Jadikan snapshot harga offline immutable atau lakukan quote+create dalam satu transaksi.
- Tambahkan `.for("update")` pada pemilihan sesi pemroses refund.
- Simpan `discountAccountId` pada sale/sale line untuk retur yang akurat.
- Tambahkan pencatatan refund non-tunai pada void.

---
*File ini adalah artefak audit POS. Tidak mengubah kode produksi.*