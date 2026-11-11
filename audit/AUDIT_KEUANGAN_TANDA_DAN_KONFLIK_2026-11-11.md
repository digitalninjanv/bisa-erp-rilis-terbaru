# Audit Finansial BISA-ERP — Tanda (Debit/Kredit), Konflik & Konsistensi

- **Tanggal**: 11 November 2026
- **Mode**: Read-only audit (tanpa perubahan kode, tanpa commit, tanpa mutasi DB)
- **Cakupan**: Core akuntansi, laporan (Laba Rugi, Neraca, Ekuitas, Arus Kas, Trial Balance, Rekonsiliasi Kontrol), persediaan/AVCO, AR/AP & pajak, payroll/HR, fixed assets, kasbon/pinjaman, beban/reimbursement.
- **Metode**: Inspeksi statis kode + validasi konsep terhadap referensi standar/undang-undang via Exa AI (lihat bagian "Validasi Referensi").

> Catatan: tidak ada test yang dijalankan ulang. Temuan bersifat statis berbasis kode. Validasi akhir tetap perlu uji integrasi/DB aktual.

---

## 1. Ringkasan Eksekutif

Ditemukan **17 temuan**: 5 Tinggi, 7 Sedang, 5 Rendah. Tidak ditemukan error aritmetika langsung yang membalik debit/kredit pada jalur utama laporan saat ini (Laba Rugi, Neraca, Trial Balance, Arus Kas, AR/AP, fixed assets, kasbon/pinjaman sudah konsisten). Risiko utama tersisa pada **robustness terhadap akun non-standar**, **default klasifikasi**, **AVCO saat void penerimaan PPN inklusif**, **rekonsiliasi bank skalar**, **overtime pecahan**, **filter karyawan masa depan di payroll**, dan **PPN masukan opt-in**.

---

## 2. Area yang Diverifikasi Konsisten (Tidak Ditemukan Konflik Tanda)

- **Laba Rugi**: pendapatan `kredit − debit`, beban/HPP `debit − kredit`; net profit konsisten dengan rumus uji (`src/server/reports/statements.ts:137-140`).
- **Neraca**: aset `debit − credit`, liabilitas/ekuitas `credit − debit`; `totalEquity = Σekuitas + netProfit` (`statements.ts:230-233,255`).
- **Trial Balance/Buku Besar**: tanda saldo normal akun dipakai untuk opening/closing (`statements.ts:71`).
- **Arus Kas**: cash net = `debit − credit` kas, efek lawan = `credit − debit`, aligned by sign; total per entri dipertahankan via sisa ke kelompok terbesar (`statements.ts:421-447`).
- **AR/AP**: penjualan kredit `Dr receivable`, pembayaran/retur/write-off `Cr receivable`; pembelian/beban `Cr payable`, pembayaran/write-off/retur pemasok `Dr payable`.
- **Diskon, write-off, saldo awal, VAT**: tanda konsisten (diskon penjualan `Dr` saat jual, `Cr` saat retur; write-off piutang `Dr receivable_writeoff / Cr receivable`; write-off utang `Dr payable / Cr other_income`; saldo awal payable `Dr equity / Cr payable`; output VAT `kredit − debit`, input VAT `debit − kredit`).
- **Kredit pihak**: kredit pelanggan (liabilitas) `Cr` saat lahir, `Dr` saat dipakai; kredit pemasok (aset) `Dr` saat lahir, `Cr` saat dipakai.
- **Fixed assets**: penyusutan `Dr depreciation_expense / Cr accumulated_depreciation`; pelepasan menutup akumulasi (Dr) dan aset (Cr) dengan laba/rugi terpisah (`src/server/fixed-assets.ts:473-500,597-610`).
- **Kasbon & pinjaman**: pemberian `Dr piutang / Cr kas`; setoran `Dr kas / Cr piutang`; potongan payroll `Cr piutang`; void payroll memulihkan piutang via entri pemulihan.
- **Jurnal penerimaan**: `Dr persediaan (DPP) + Dr PPN masukan = Cr total` (`src/server/inventory/receipt-journal.ts:111-131`).
- **Penjualan**: `Dr COGS / Cr inventory`; retur penjualan: `Dr inventory / Cr COGS` (`src/server/pos/sales-persist.ts:361-362`, `src/server/pos/returns.ts:662-667`).
- **Payroll run/final pay**: komponen cuti tak berbayar diperlakukan sebagai pengurang bruto (FIX-P1) pada run reguler dan final pay (`src/server/actions/hr/payroll.ts:479-506`, `src/server/hr/final-pay.ts:419-441`).

---

## 3. Temuan

### T-01 (Tinggi) — Void penerimaan memakai harga faktur bruto untuk gerakan stok pembalik (AVCO drift)

- **File**: `src/server/inventory/receipt-void.ts:184,195,212,213`; `src/server/inventory/receipt-stock.ts:44`; `src/server/inventory/receipts.ts:727`
- **Bukti**: penerimaan awal memakai `stockUnitCost` (DPP) sebagai `unitCost` gerakan stok, tetapi void membaca `unitCost` dari baris penerimaan yang menyimpan harga faktur bruto, lalu memakainya untuk gerakan `reversal`. GL dibalik dengan `reverseJournalEntry` (konsisten), tetapi subledger stok/AVCO drift sebesar porsi PPN pada penerimaan PPN inklusif.
- **Dampak**: nilai persediaan subledger ≠ GL setelah void penerimaan PPN inklusif.
- **Saran**: void harus memakai `stockUnitCost`/DPP yang sama dengan penerimaan awal, atau menyimpan DPP di baris penerimaan dan memakainya saat reversal.
- **Validasi referensi**: Odoo (AVCO) memisahkan pajak pembelian yang dapat dikreditkan dari biaya produk; pajak tidak menjadi bagian HPP kecuali dikonfigurasi "Included in Price" (Odoo Average Price Valuation docs). Konsisten dengan temuan: DPP (net) yang seharusnya menjadi biaya stok, PPN masukan dipisah ke akun pajak.

### T-02 (Tinggi) — Rekonsiliasi bank: `unreconciledTotal` bisa negatif artifisial

- **File**: `src/server/bank-reconciliation/reads.ts:89-98` (terutama `:94`)
- **Bukti**: `unreconciledTotal: toDb(bookBalance.minus(reconciledTotal))` — pengurangan skalar `bookBalance − reconciledTotal`, tanpa memisahkan deposit in transit vs outstanding checks.
- **Dampak**: selisih rekonsiliasi tampak negatif pada mutasi kredit/overdraft, membingungkan audit.
- **Saran**: ubah ke struktur rekonsiliasi 4-kolom (saldo buku, +deposit in transit, −outstanding payments, saldo disesuaikan).
- **Validasi referensi**: standar rekonsiliasi bank (Xero) memakai `Adjusted Bank Balance = Bank Statement Balance + Deposits in Transit – Outstanding Cheques` dan `Adjusted Book Balance = Cash Book Balance + Bank Credits – Bank Charges`; kedua saldo disesuaikan harus sama. Rekonsiliasi harus memperlakukan overdraft sebagai negatif, bukan skalar sederhana.

### T-03 (Tinggi) — Lembur memotong jam pecahan (understated upah lembur)

- **File**: `src/lib/payroll/payroll-indonesia.ts:307-319` (`computeOvertimePay`); `src/server/hr/overtime.ts:159-161`
- **Bukti**: loop `for (let hour = 1; hour <= entry.hours; hour += 1)` hanya menghitung jam utuh; lembur 1,5 jam dihitung 1 jam. `hours: d(row.hours).toNumber()` juga mengonversi ke `number` sebelum kalkulasi.
- **Dampak**: upah lembur understated (contoh repro HR-002: Rp15.000 vs Rp25.000).
- **Saran**: hitung lembur berbasis jam pecahan (desimal) sesuai PP 35/2021.
- **Validasi referensi**: PP 35/2021 Pasal 31 mengatur upah lembur per jam (termasuk jam pecahan); lembur dihitung proporsional, bukan dibulatkan ke jam utuh.

### T-04 (Tinggi) — Payroll menyertakan karyawan yang mulai kerja di masa depan

- **File**: `src/server/actions/hr/payroll.ts:125-129`
- **Bukti**: query staf hanya `eq(employees.isActive, true)` tanpa batas `joinedAt <= periodEnd`.
- **Dampak**: karyawan dengan `joinedAt` bulan depan terbayar gaji penuh pada run bulan ini (repro HR-001).
- **Saran**: tambahkan filter `joinedAt <= periodEnd` (dan sesuaikan pro-rata bila bergabung di tengah periode).

### T-05 (Sedang) — PPN Masukan hanya terpisah bila opsi "Termasuk PPN" aktif (default bruto)

- **File**: `src/server/expenses.ts:50-80,155-225`; `src/server/reimbursements.ts:255-295`
- **Bukti**: kode sebenarnya mendukung pemisahan PPN masukan (`tax_input`) bila `taxIncluded` aktif dan tarif > 0; namun default beban bruto. Tidak ada deteksi otomatis status PKP/faktur pajak; pengguna harus mengaktifkan opsi dan memasukkan tarif.
- **Dampak**: beban dapat overstated sebesar PPN yang seharusnya dapat dikreditkan bila opsi tidak diaktifkan; tetapi bukan konflik tanda jurnal, melainkan gap kepatuhan/compliance.
- **Saran**: tambahkan panduan/UI yang jelas untuk PKP, default berdasarkan status perusahaan, dan validasi faktur pajak.
- **Validasi referensi**: DJP menjelaskan pajak masukan adalah PPN yang dibayar PKP atas perolehan BKP/JKP dan menjadi pengurang PPN keluaran; pengkreditan diatur UU PPN (Pasal 9 ayat 9, diubah UU HPP) dan PMK 81/2024; pajak masukan tidak boleh dibebankan sebagai biaya bila dikreditkan.

### T-06 (Tinggi) — Jurnal manual bebas memposting ke akun kontrol

- **File**: `src/server/actions/accounting/jurnal.ts:25-95`; `src/server/reports/control.ts:47-50`
- **Bukti**: `postManualJournalAction` tidak melarang akun kontrol subledger (piutang/persediaan/utang), sehingga GL menyimpang permanen dari subledger.
- **Dampak**: rekonsiliasi kontrol selamanya menunjukkan selisih.
- **Saran**: tolak posting manual ke akun kontrol yang terpetakan; wajib lewat dokumen operasional.

---

### T-07 (Sedang) — Impor stok awal tidak me-blend AVCO (inkonsisten dengan penerimaan)

- **File**: `src/server/actions/import/commit-phases.ts:439-452`; `src/server/inventory/movements.ts:113-117`
- **Bukti**: `applyStockMovement` hanya me-blend `costPrice` untuk `movementType === "purchase" || "sale_return"`; gerakan `opening` dicatat dengan `unitCost` tetapi tidak memperbarui `products.costPrice`. Penerimaan sumber `opening` justru lewat `receipt-stock.ts:45` memakai `movementType: "purchase"`, sehingga AVCO-nya ter-blend.
- **Dampak**: menambah stok awal ke produk yang sudah punya stok dapat meninggalkan `costPrice` lama; nilai persediaan subledger ≠ GL.
- **Saran**: samakan perlakuan AVCO untuk gerakan `opening` (blend) atau dokumentasikan sebagai pengecualian.

### T-08 (Sedang) — `mappedBalance` menentukan tanda dari tipe akun, bukan saldo normal

- **File**: `src/server/reports/shared.ts:164-169`
- **Bukti**: `const sign = row.type === "asset" || row.type === "expense" || row.type === "cogs" ? 1 : -1;` mengabaikan `normalBalance`.
- **Dampak**: akun kontrol kontra akan dihitung dengan tanda salah pada leg GL rekonsiliasi kontrol, menyebabkan selisih palsu. Akun kontrol normal tidak terpengaruh.
- **Saran**: gunakan `normalBalance` akun (atau `signedBalance` yang sesuai) untuk menentukan tanda.

### T-09 (Sedang) — Default klasifikasi akun belum ditandai eksplisit

- **File**: `src/lib/akuntansi/accounting.ts:67-75` (`defaultSection`); `:96-108` (`resolveCashFlowGroup`)
- **Bukti**: `asset → current_asset`, `liability → current_liability`, `liability → operating`; hanya nilai eksplisit `section`/`cash_flow_group` yang menandai pengecualian.
- **Dampak**: aset tetap/liabilitas jangka panjang/pinjaman pendanaan yang belum ditandai eksplisit otomatis masuk aset lancar/liabilitas jangka pendek/arus operasi, memengaruhi neraca dan arus kas.
- **Saran**: wajibkan penandaan section/cash flow group saat pembuatan akun non-standar, atau beri peringatan audit.

### T-10 (Sedang) — Arus kas & guard saldo kas rentan pada akun kas/bank non-aset

- **File**: `src/server/reports/statements.ts:286-294,304-305`; `src/server/accounting.ts:85-91`
- **Bukti**: pembukaan arus kas memakai `signedBalance(row.type, …)` (tanda per tipe), tetapi mutasi kas memakai `inflow = sum(debit)`, `outflow = sum(credit)` (asumsi kas = aset normal debit). Guard kas juga memakai `balance = sum(debit − credit)` untuk semua akun kelas kas/bank. `listCashBankAccounts` tidak menyaring `type`.
- **Dampak**: bila ada akun kas/bank bertipe non-aset (mis. overdraft/utang bank yang ditag `cashBankKind`), arus kas dan guard saldo kas menampilkan arah terbalik. Bagan bawaan hanya menandai aset, jadi latent.
- **Saran**: batasi kelas kas/bank ke akun aset, atau buat tanda berbasis `normalBalance`/`type` yang konsisten di seluruh arus kas.

### T-11 (Sedang) — Reimbursement diakui saat dibayar, bukan saat disahkan

- **File**: `src/server/reimbursements.ts:225-262`
- **Bukti**: klaim yang sudah disahkan belum menjurnal; beban baru diakui pada tanggal pembayaran.
- **Dampak**: salah timing beban lintas periode (bukan konflik tanda, tetapi akurasi periode).
- **Saran**: akui beban saat klaim disahkan (accrual), pembayaran hanya menyelesaikan utang.

### T-12 (Sedang) — `signedBalance` menandai berdasarkan tipe, bukan `normalBalance`

- **File**: `src/server/accounting.ts:648-659`
- **Bukti**: `if (type === "asset" || type === "expense" || type === "cogs") return debit − credit; else return credit − debit;` (tidak membaca `normalBalance`).
- **Dampak**: untuk akun kontra, tanda hasilnya justru benar; namun fungsi ini tidak aman dipakai untuk akun non-standar yang tipe dan saldo normalnya tidak sinkron. Saat ini hanya dipakai untuk kas/bank dan P&L closing, yang aman.
- **Saran**: jika akan dipakai lebih luas, ubah signature agar menerima `normalBalance` atau buat helper terpisah.

---

### T-13 (Rendah) — Ekuitas: baris laba ditahan sintetis dapat double count pada buku yang sebagian ditutup

- **File**: `src/server/reports/statements.ts:549-571`
- **Bukti**: baris `"retained-earnings"` ditambahkan hanya bila `priorProfit.netProfit` tidak nol, dengan `opening = closing = priorProfit`; `totalClosing = Σclosing + profit.netProfit`.
- **Dampak**: pada buku yang sebagian sudah ditutup (closing sebagian) atau akun laba ditahan yang sudah memuat laba sebelumnya, laba sebelumnya dapat terhitung dua kali atau terlewat. Kasus normal (belum/telah ditutup penuh) aman karena `priorProfit` menjadi 0 setelah closing penuh.
- **Saran**: tambahkan deteksi status closing sebagian atau gunakan akun laba ditahan aktual bila ada.

### T-14 (Rendah) — Rekonsiliasi kontrol hanya menampilkan jurnal `sourceType = "manual"`

- **File**: `src/server/reports/control.ts:390-422`
- **Bukti**: `manualJournalsFor` memfilter `eq(journalEntries.sourceType, "manual")`.
- **Dampak**: jurnal penyesuaian/penutupan yang menyentuh akun kontrol tetapi bertipe sumber lain tidak muncul di panel, sehingga selisih mungkin tidak terlacak lewat panel ini.
- **Saran**: perluas filter ke semua jurnal yang menyentuh akun kontrol, atau beri label sumber.

### T-15 (Rendah) — Koreksi persediaan memakai akun `inventory_shrink` dua arah

- **File**: `src/server/inventory/adjustments-post.ts:264-268`
- **Bukti**: koreksi naik `Dr inventory / Cr inventory_shrink`; koreksi turun `Dr inventory_shrink / Cr inventory`.
- **Dampak**: secara aritmetika seimbang, tetapi secara semantik akun `inventory_shrink` dipakai dua arah; tidak ada akun gain persediaan terpisah.
- **Saran**: tambahkan akun gain persediaan terpisah untuk koreksi positif (opsional, sesuai kebijakan).

### T-16 (Rendah) — `recomputeCostFromLedger` mempertahankan `costPrice` lama bila qty neto ≤ 0

- **File**: `src/server/inventory/movements.ts:405-406`
- **Bukti**: `if (qty.lte(0)) return;`
- **Dampak**: produk dengan stok nol/negatif tetap menampilkan HPP acuan lama; blend berikutnya memakai acuan itu. Didokumentasikan sebagai disengaja, tetapi berisiko bila negatif stock diizinkan.
- **Saran**: reset `costPrice` ke 0 atau nilai terakhir bila qty ≤ 0, sesuai kebijakan.

### T-17 (Rendah) — Idempotensi setoran kasbon/pinjaman lemah

- **File**: `src/server/employee-advances.ts:544`; `src/server/employee-loans.ts:423`
- **Bukti**: `idempotencyKey: crypto.randomUUID()` (AK4-16) → submit ganda tidak terdedup server; perlindungan hanya dari validasi sisa terbuka.
- **Saran**: gunakan idempotency key deterministik berbasis dokumen/sesi.

---

## 4. Validasi Kode per Temuan (Read-Only)

| ID | Status | Bukti kode yang diperiksa ulang |
|---|---|---|
| T-01 | Tervalidasi | `receipt-void.ts` membaca `unitCost` (bruto tersimpan) untuk gerakan reversal; `receipt-stock.ts:44` memakai `stockUnitCost` (DPP); `receipts.ts:600-618` membedakan `unitCost` vs `stockUnitCost` |
| T-02 | Tervalidasi | `reads.ts:89-98` memakai `bookBalance.minus(reconciledTotal)` skalar |
| T-03 | Tervalidasi | `payroll-indonesia.ts:307-319` loop jam utuh; `overtime.ts:159-161` konversi ke number |
| T-04 | Tervalidasi | `actions/hr/payroll.ts:125-129` hanya filter `isActive` |
| T-05 | Tervalidasi (disesuaikan) | `expenses.ts:50-80,155-225` mendukung `tax_input` bila `taxIncluded` aktif; default bruto |
| T-06 | Tervalidasi | `jurnal.ts:25-95` tidak melarang akun kontrol; `control.ts:47-50` mendokumentasikan risiko |
| T-07 | Tervalidasi | `commit-phases.ts:439-452` gerakan `opening`; `movements.ts:113-117` blend hanya purchase/sale_return |
| T-08 | Tervalidasi | `shared.ts:164-169` sign berdasarkan `row.type` |
| T-09 | Tervalidasi | `lib/akuntansi/accounting.ts:67-75,96-108` default section/cash flow group |
| T-10 | Tervalidasi | `statements.ts:286-294,304-305`; `accounting.ts:85-91`; `listCashBankAccounts` tidak menyaring type |
| T-11 | Tervalidasi | `reimbursements.ts:225-262` beban diakui saat bayar |
| T-12 | Tervalidasi | `accounting.ts:648-659` sign berdasarkan type |
| T-13 | Tervalidasi (latent) | `statements.ts:549-571` baris retained-earnings sintetis |
| T-14 | Tervalidasi | `control.ts:390-422` filter `sourceType = "manual"` |
| T-15 | Tervalidasi | `adjustments-post.ts:264-268` memakai `inventory_shrink` dua arah |
| T-16 | Tervalidasi | `movements.ts:392-412` `if (qty.lte(0)) return;` |
| T-17 | Tervalidasi | `employee-advances.ts:544`; `employee-loans.ts:423` `crypto.randomUUID()` |

## 5. Validasi Referensi (Exa AI)

1. **AVCO & pajak pembelian** — Odoo Average Price Valuation docs: pajak pembelian yang dapat dikreditkan tidak masuk biaya produk; hanya pajak yang "Included in Price" masuk valuation. Mendukung T-01 (DPP sebagai biaya stok, PPN masukan dipisah).
2. **Rekonsiliasi bank** — Xero bank reconciliation guide: `Adjusted Bank Balance = Bank Statement Balance + Deposits in Transit – Outstanding Cheques`; `Adjusted Book Balance = Cash Book Balance + Bank Credits – Bank Charges`; overdraft diperlakukan negatif. Mendukung T-02 (perlu pemisahan debit/kredit, bukan skalar).
3. **Overtime PP 35/2021** — PP No. 35/2021 (terjemahan): Pasal 26 (batas lembur), Pasal 31 (upah lembur per jam). Mendukung T-03 (lembur pecahan harus dibayar proporsional).
4. **PPN masukan** — DJP: pajak masukan adalah PPN yang dibayar PKP atas perolehan BKP/JKP dan menjadi pengurang PPN keluaran; pengkreditan diatur UU PPN (Pasal 9 ayat 9, diubah UU HPP) dan PMK 81/2024; pajak masukan tidak boleh dibebankan sebagai biaya bila dikreditkan. Mendukung T-05.

---

## 6. Catatan Metodologi

- Audit ini **read-only**: tidak ada perubahan kode, tidak ada commit, tidak ada mutasi DB.
- Tidak ada test yang dijalankan ulang; temuan bersifat statis berbasis kode. Validasi akhir tetap perlu uji integrasi/DB aktual, khususnya untuk T-01 (void penerimaan PPN inklusif) dan T-02 (bank reconciliation).
- Banyak temuan merupakan **robustness/klasifikasi** (akun non-standar, default klasifikasi), bukan error aritmetika langsung pada jalur utama laporan saat ini.

---

## 7. Rekomendasi Langkah Lanjut

- Prioritas perbaikan: **T-01, T-02, T-03, T-04, T-05, T-06** (Tinggi).
- Tambahkan test regresi untuk: void penerimaan PPN inklusif → verifikasi `products.costPrice` dan saldo GL persediaan; bank reconciliation dengan mutasi kredit/overdraft; overtime 1,5 jam; payroll dengan karyawan bergabung di masa depan; expense dengan PPN masukan untuk PKP.
- Audit lanjutan (jika diminta): validasi akun kontrol kontra (T-08/T-12) dan status closing sebagian (T-13) dengan data riil.

---
*File ini adalah artefak audit. Tidak mengubah kode produksi.*