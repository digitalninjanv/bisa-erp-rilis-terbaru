# Audit Modul Akuntansi BISA-ERP — Workflow, Laporan & Konsistensi

- **Tanggal**: 11 November 2026
- **Cakupan**: Modul Akuntansi (COA, jurnal, buku besar, neraca saldo, laporan keuangan, penyesuaian, penutupan periode, bank reconciliation, rekonsiliasi kontrol, PPN, migrasi COA, pemetaan akun)
- **Mode**: Read-only audit (tanpa perubahan kode, tanpa commit, tanpa mutasi DB)
- **Metode**: Inspeksi statis kode + validasi konsep terhadap referensi akuntansi/PSAK via Exa AI

> Tidak ada test yang dijalankan ulang (kecuali catatan lulus dari subagent). Temuan bersifat statis berbasis kode.

---

## 1. Ringkasan Eksekutif

Ditemukan **6 temuan Akuntansi**: 1 Tinggi, 3 Sedang, 2 Rendah. Tidak ditemukan kegagalan pada fondasi posting (`postJournal`, `signedBalance`, period guard, reversal) yang lulus uji integritas. Risiko utama berada pada **kontrol neraca saldo yang tidak memfilter status jurnal**, **rekonsiliasi bank yang tidak dibatasi tanggal pada mutasi belum tertaut**, **deteksi migrasi COA berbasis nama akun**, dan **akumulasi PPN memakai `Number`**.

Temuan akuntansi yang lebih luas (tanda, klasifikasi, AVCO, rekonsiliasi kontrol) sudah didokumentasikan di `audit/AUDIT_KEUANGAN_TANDA_DAN_KONFLIK_2026-11-11.md` dan tidak diduplikasi di sini.

---

## 2. Referensi Akuntansi yang Digunakan (Exa)

1. **UK Accounting Guide / Acumatica / Tipalti accounting cycle** — siklus akuntansi: transaksi → jurnal → posting ledger → trial balance → penyesuaian → laporan keuangan → penutupan periode; kontrol: rekonsiliasi bank, kontrol akun, VAT, supplier statement.
2. **PwC Indonesia PSAK Pocket Guide / IFRS profile** — SAK Indonesia substantially converged with IFRS; PSAK 118 (IFRS 18) menggantikan PSAK 201 efektif 1 Jan 2027.
3. **FA Indonesia PSAK 118** — 5 kategori laba rugi, subtotal wajib, MPM, arus kas mulai dari laba usaha.
4. **HBS balance sheet** — persamaan A = L + E; perbedaan urutan likuiditas IFRS vs GAAP.

---

## 3. Area Akuntansi yang Diverifikasi Konsisten (Tidak Ditemukan Konflik)

- **Posting jurnal**: `postJournal` menegakkan satu sisi, non-negatif, seimbang, akun postable/aktif, period open (`src/server/accounting.ts:285-399`).
- **Reverse journal**: swap debit/kredit, idempotency key, cek linked statement (`src/server/accounting.ts:586-645`).
- **Neraca saldo/buku besar**: tanda saldo normal akun (`src/server/reports/statements.ts:71`).
- **Laba Rugi & Neraca**: rumus konsisten, `balanced` flag (`src/server/reports/statements.ts:137-140,230-233,255,273`).
- **Period guard**: SELECT FOR UPDATE, materialisasi lazy tahun berjalan/berikutnya (`src/server/accounting.ts:217-283`).
- **Bank reconciliation**: jurnal matched dibatasi tanggal; GL `signed` dengan normal balance (`src/server/bank-reconciliation/reads.ts:34-90`).
- **Rekonsiliasi kontrol**: GL `debit−credit` untuk aset, `credit−debit` untuk utang; subledger `saleDebt − pembayaran − retur` (`src/server/reports/control.ts:440-442,107,145`).
- **Year-end closing**: P&L balances dengan `signedBalance`; jurnal penutup posted ke periode closed (`src/server/year-end-closing.ts`).

---

## 4. Temuan

### A-01 (Tinggi) — `trialBalanceCheckAction` menjumlah semua `journal_lines` tanpa memfilter status jurnal

- **File**: `src/server/actions/accounting/jurnal.ts:271-284`
- **Bukti**: query tidak melakukan JOIN `journalEntries` dan tidak membatasi `journalEntries.status = 'posted'`, sehingga baris jurnal `draft`/`void` (atau baris yatim) ikut terhitung. Evidence: baris 275–282 hanya `where(eq(journalLines.companyId, ctx.company.id))`.
- **Dampak**: kontrol "neraca saldo" bisa tidak selaras dengan laporan posted.
- **Saran**: tambahkan join ke `journalEntries` dan filter `status = 'posted'`.

### A-02 (Sedang) — `unmatchedStatementTotal` tidak dibatasi tanggal

- **File**: `src/server/bank-reconciliation/reads.ts:75-87`
- **Bukti**: `bookBalance` dan `reconciledTotal` dibatasi `lte(journalEntries.date, todayISO())`, tetapi agregasi mutasi bank yang belum tertaut tidak memiliki batas tanggal. Evidence: blok `unmatchedStatement` (baris 75–87) tidak memakai `lte(... date, todayISO())`.
- **Dampak**: rekonsiliasi historis/as-of bisa selisih palsu.
- **Saran**: tambahkan filter tanggal pada `bankStatementLines` (atau konsisten dengan as-of).

### A-03 (Sedang) — Deteksi migrasi COA bergantung pada nama akun

- **File**: `src/server/coa-migration.ts:106-124`
- **Bukti**: penanda referensi dicari dari nama akun `"Tunai"` / `"Penjualan"`. Evidence: `cashMarker?.name === "Tunai"` dan `byCode.get("400001")?.name === "Penjualan"`.
- **Dampak**: jika akun templat diubah namanya, dry-run/eksekusi migrasi bisa salah menganggap bagan belum atau sudah termigrasi.
- **Saran**: gunakan penanda yang lebih stabil (kode + tipe + section), bukan nama.

### A-04 (Sedang) — Akumulasi PPN memakai `Number`, bukan `Decimal`

- **File**: `src/server/reports/vat.ts:101-110`
- **Bukti**: `output` dan `input` diakumulasi dengan `+=` pada `number` dari `Number(row.debit/credit)`. Evidence: baris 105–110.
- **Dampak**: potensi selisih sen pada laporan PPN.
- **Saran**: akumulasi dengan `Decimal`, konversi ke number di akhir.

### A-05 (Rendah) — Replay idempotensi mengembalikan `warnings: []`

- **File**: `src/server/accounting.ts:299-313`
- **Bukti**: jika posting asli memicu peringatan saldo kas/bank negatif, retry dengan kunci yang sama tidak lagi menampilkan peringatan tersebut. Evidence: baris 312.
- **Dampak**: informasi kontrol hilang saat retry.
- **Saran**: simpan/ambil warnings dari posting asli, atau dokumentasikan perilaku.

### A-06 (Rendah) — `mapped: true` bila hanya salah satu akun PPN terpetakan

- **File**: `src/server/reports/vat.ts:62-73`
- **Bukti**: jika hanya `tax_output` atau `tax_input` yang terpetakan, laporan tetap `mapped: true` dan sisi yang hilang bernilai 0. Evidence: baris 62–73 dan 127–136.
- **Dampak**: pengguna bisa mengira laporan lengkap.
- **Saran**: set `mapped` true hanya bila kedua akun terpetakan, atau beri flag partial.

---

## 5. Validasi Kode per Temuan (Read-Only)

| ID | Status | Bukti kode yang diperiksa ulang |
|---|---|---|
| A-01 | Tervalidasi | `jurnal.ts:271-284` tanpa join/filter status |
| A-02 | Tervalidasi | `reads.ts:75-87` tanpa batas tanggal pada unmatched statement |
| A-03 | Tervalidasi | `coa-migration.ts:106-124` deteksi berbasis nama |
| A-04 | Tervalidasi | `vat.ts:101-110` akumulasi `Number` |
| A-05 | Tervalidasi | `accounting.ts:299-313` replay `warnings: []` |
| A-06 | Tervalidasi | `vat.ts:62-73` `mapped: true` parsial |

---

## 6. Catatan Metodologi

- Audit ini **read-only**: tidak ada perubahan kode, tidak ada commit, tidak ada mutasi DB.
- Subagent menjalankan beberapa tes integritas (accounting-integrity, fix-p1-period-integrity, bank-reconciliation, journal-validation, a27-b4-account-guards) dan lulus; namun audit ini tidak mengulang test.
- Validasi akhir tetap perlu uji integrasi/DB aktual, khususnya untuk A-01 (trial balance check) dan A-02 (bank reconciliation as-of).

---

## 7. Rekomendasi Langkah Lanjut

- Prioritas perbaikan: **A-01** (Tinggi).
- Tambahkan filter status posted pada `trialBalanceCheckAction`.
- Tambahkan batas tanggal pada `unmatchedStatementTotal`.
- Ubah deteksi migrasi COA ke penanda stabil.
- Akumulasi PPN dengan `Decimal`.
- Simpan warnings pada replay idempotensi.
- Set `mapped` partial untuk PPN.

---
*File ini adalah artefak audit Akuntansi. Tidak mengubah kode produksi.*