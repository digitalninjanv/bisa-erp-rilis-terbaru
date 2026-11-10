> **Catatan 2026-11-09:** templat bagan akun sudah diganti ke bagan referensi IFI MART (141 akun). Angka 124/5-digit di dokumen ini adalah keadaan historis program A-27.

# RENCANA A-27 — Perbaikan Bagan Akun & Model Kas/Bank

Program **A-27** · Dokumen rencana tahap **B0** · Audit acuan: `docs/bagan-akun/AUDIT-A27.md`
Aturan program (mengikat semua tahap):

- **Angka bisnis tidak berubah.** Tidak ada jurnal baru, tidak ada saldo yang bergerak, tidak ada aturan posting yang berubah — kecuali migrasi kode terencana di B7 yang bersifat opt-in pemilik dan tidak menyentuh satu pun baris jurnal (jurnal mereferensikan `accountId`, bukan kode).
- **Satu kepemilikan berkas per tahap.** Tahap berjalan berurutan; di dalam tahap, satu pemilik per berkas.
- **Gerbang tiap tahap**: suite penuh + typecheck/lint/build + e2e 19/19 dari reseed bersih; tahap hanya dinyatakan selesai oleh Pemimpin sesudah bukti gerbang dibaca.
- Kontrak kualitas kode proyek (`docs/PANDUAN-KUALITAS-KODE.md`) berlaku: jangan lemahkan test arsitektur; penambahan perilaku lewat jalur yang sudah terpusat (`postJournal`, `getAccountMap`, fungsi baca domain).

---

## 1. Peta tahap

- [x] **B0 — Audit gabungan + rencana** (dokumen ini + `AUDIT-A27.md`). Tanpa perubahan kode.

- [x] **B1 — Skema kelas kas/bank + rincian bank + FK metode** *(menutup fondasi F-01, F-09)*
  - Migrasi baru (tidak mengedit migrasi lama): kolom `accounts.cash_bank_kind` (`cash | bank | clearing | null`), kolom rincian bank opsional di `accounts` (`bank_name`, `bank_account_number`, `bank_branch`, `bank_account_holder`, `currency` bawaan `IDR`), FK `payment_methods.account_id → accounts.id`.
  - Sebelum FK dipasang: pemeriksaan data — baris metode dengan `account_id` yatim (tidak menunjuk akun sekantor) dilaporkan; bila ada di DB mana pun yang dikenal, migrasi berhenti dan dilaporkan, tidak ditebak.
  - Backfill kelas dari pemetaan yang ada (deterministik, satu-satunya sumber yang dapat dipercaya): akun terpetakan `cash` → `cash`, `bank` → `bank`, `qris` → `clearing`. Akun lain **tidak ditebak** dari nama/kode (Kas Kecil perusahaan berjalan ditandai manual lewat B3/B4 — jujur dicatat di §7).
  - Seed demo: 1000/1010 berkelas `cash`, 1100 berkelas `bank` (+ rincian Bank BCA), 1110 berkelas `clearing`.
  - Pemilik berkas: `src/db/schema/accounting.ts`, `src/db/schema/platform.ts`, `src/db/migrations/*`, `src/db/seed.ts`.
  - Gerbang: suite + e2e; `db:generate` bersih; test baru: backfill kelas dari pemetaan.

- [x] **B2 — Keanggotaan kas/bank dari kelas (domain baca)** *(menutup F-01, F-03, F-04 sisi baca)*
  - Fungsi baca tunggal baru di `src/server/accounting.ts`: `listCashBankAccounts(tx, companyId)` — akun postable + aktif berkelas `cash|bank|clearing`, terurut kode; dan `listCashBankIds` untuk penyaring himpunan.
  - 17 situs pemakai himpunan 3-kunci diklasifikasikan satu per satu dalam tahap ini dan dicatat di laporan tahap:
    - **Situs HIMPUNAN** (butuh semua akun kas/bank: halaman Kas & bank, `listPaymentAccounts`, transfer antar bank, daftar akun pada form beban/quick-entry/payroll/kasbon/pinjaman/klaim/piutang-utang, penjaga saldo kas negatif) → beralih ke kelas.
    - **Situs BAWAAN** (butuh tepat satu akun bawaan: kas sesi POS = pemetaan `cash`, bank bawaan, penampung QRIS bawaan) → **tetap** membaca pemetaan; pemetaan memang penunjuk bawaan.
  - `listReconciliationAccounts` (`src/server/bank-reconciliation/accounts.ts`) menjadi: akun berkelas `cash|bank|clearing` yang postable + aktif. Aturan gabungan metode pembayaran **dihapus** (menutup F-04 sisi baca; sisi tulisnya di B3).
  - Pemilik berkas: `src/server/accounting.ts`, `src/server/bank-reconciliation/accounts.ts`, halaman/server pemakai himpunan sesuai klasifikasi.
  - Gerbang: suite + e2e; test paritas: himpunan demo sebelum = `[1000, 1100, 1110]`, sesudah B1+B2 = `[1000, 1010, 1100, 1110]` (Kas Kecil masuk — itulah perbaikan F-03, dinyatakan eksplisit, bukan efek samping diam-diam); daftar rekonsiliasi demo tidak lagi memuat 1200/2300.

- [x] **B3 — Tambah bank satu langkah: formulir, dropdown metode, validasi metode** *(menutup F-02, F-04 sisi tulis, F-09)*
  - Formulir akun (`src/components/akuntansi/account-form.tsx`): pemilih kelas kas/bank (`Bukan kas/bank | Kas | Bank | Kliring/Settlement`); bila `Bank`, rincian bank tampil kondisional (nama bank, nomor rekening, cabang, atas nama, mata uang — pola Accurate); nomor rekening ditampilkan termasker di daftar.
  - Dropdown akun metode pembayaran (`src/app/app/pengaturan/page.tsx` + `PaymentMethodForm`): pilihan mengikuti **tipe metode** — `cash` → kelas `cash`, `bank` → kelas `bank`, `qris` → kelas `clearing`, `credit` → akun pemetaan `receivable`, `customer_credit` → akun pemetaan `customer_credit` (dua terakhir memang akun kontrol, bukan kas/bank).
  - Validasi server di `savePaymentMethodAction`/`updatePaymentMethodAction` (`src/server/actions/settings/pembayaran.ts`): akun tujuan wajib ada, sekantor, postable, aktif, dan kelasnya sesuai tipe metode (pesan validasi bernama ala riset §5.1 — gagal dengan alasan, bukan diam). Aturan khusus `customer_credit` yang sudah ada dipertahankan.
  - Uji asap wajib tahap ini: buat bank kedua lewat jalur UI/domain → muncul di Kas & bank, dapat dipilih di metode baru, dapat ditransfer, masuk daftar rekonsiliasi — **tanpa** mengubah pemetaan `bank`.
  - Pemilik berkas: `account-form.tsx`, `pengaturan/page.tsx`, komponen form metode, `actions/settings/pembayaran.ts`, `actions/accounting/akun-pemetaan.ts` (skema Zod akun diperluas kelas + rincian).
  - Gerbang: suite + e2e + uji asap tambah bank di atas.

- [x] **B4 — Penjaga tulis akun: nonaktif setara hapus, hierarki, koherensi, kode dapat diedit, akun sistem terlihat** *(menutup F-05, F-06 sisi tulis, F-07, F-08, F-10)*
  - **Penjaga nonaktif** di jalur ubah `saveAccountAction`: transisi `isActive true→false` menjalankan cek referensi yang sama dengan `deleteAccountAction` (pemetaan, metode pembayaran, akun diskon kelompok) → ditolak `CONFLICT` dengan pesan yang menyuruh menunjuk ulang terlebih dahulu. Nonaktif dengan saldo ≠ 0 (dan lolos cek referensi) wajib flag konfirmasi eksplisit dari UI (pratinjau dampak: saldo terakhir + jumlah baris jurnal) — tidak ada jurnal otomatis (anti-pola QBO, riset §5.3).
  - **Pratinjau dampak**: respons/cek baca `getAccountImpact(tx, companyId, accountId)` — terikat pemetaan kunci apa, metode apa, berapa baris jurnal, saldo, anak akun — dipakai formulir ubah untuk menampilkan panel "akun ini dipakai oleh…" sebelum simpan.
  - **Penjaga hierarki** di jalur simpan: (i) induk wajib `isPostable=false`; (ii) akun yang memiliki anak tidak boleh menjadi postable; (iii) anti-siklus: telusuri rantai induk dari calon induk — menolak bila akun itu sendiri muncul; (iv) mengubah akun beranak menjadi postable ditolak.
  - **Koherensi type↔section**: matriks izin di server (asset→current/non_current_asset; liability→current/non_current_liability; equity→equity; revenue→revenue/other_income; cogs→cogs; expense→operating_expense/other_expense). `normalBalance` tetap eksplisit (akun kontra adalah pengecualian sah: 4010 debit, 1510 kredit).
  - **Kode dapat diedit**: jalur update menerima `code` baru dengan penjaga: unik per perusahaan (pesan ramah yang sudah ada), **audit log** `account.code_change` (before/after), dan penolakan bila kode sama persis (no-op). Aman secara mekanis karena jurnal & pemetaan mereferensikan `accountId`.
  - **`is_system` turunan**: fungsi baca menandai akun yang dirujuk pemetaan/metode (`isSystem` di model baca daftar akun) + lencana kunci di halaman bagan akun; akun sistem: ganti nama & kode boleh (teraudit), ganti tipe/nonaktif/hapus mengikuti penjaga referensi di atas.
  - **Subtotal halaman bagan akun anti hitung ganda**: subtotal grup = jumlah akun **detail** saja; saldo header ditampilkan sebagai rollup anak dan tidak ikut dijumlah ke total grup (`akun/page.tsx`).
  - Pemilik berkas: `actions/accounting/akun-pemetaan.ts`, `account-form.tsx`, halaman `akun/page.tsx` + fungsi baca akun di `src/server/accounting.ts`.
  - Gerbang: suite + e2e; test baru per penjaga (nonaktif terpetakan ditolak, siklus ditolak, induk postable ditolak, ganti kode teraudit, koherensi ditolak).

- [x] **B5 — Tagging PSAK 118 + penanda kontra (data saja; laporan tidak diubah)** *(kesiapan PSAK 118; audit §5.7–5.8)*
  - Migrasi: kolom `accounts.psak118_category` (`operating | investing | financing | income_tax | discontinued | null`), `accounts.expense_nature` (teks dari daftar terkendali: `inventory_expensed | employee_benefits | depreciation | amortisation | rent | utilities | payment_fees | impairment | inventory_writedown | bank_charges | interest | tax | other`), `accounts.expense_function` (`cogs | selling | admin | null`), `accounts.is_contra` (boolean, bawaan false) + `accounts.contra_of` (uuid, nullable).
  - Backfill deterministik dari `section`/`type` untuk akun laba rugi: revenue/other_income/cogs/operating_expense/other_expense → `operating`; akun di blok pajak penghasilan templat → `income_tax`; bunga deposito → `investing` dan bunga pinjaman/sewa → `financing` **hanya** untuk akun templat baru B6 (perusahaan berjalan: bawaan `operating`, akuntan menyesuaikan lewat formulir — dicatat jujur, tidak ditebak dari nama).
  - Fungsi bawaan terpusat `defaultPsak118Tags(type, section)` di `src/lib/akuntansi/` dipakai aksi simpan akun & templat; formulir akun menampilkan ketiga tag hanya untuk akun laba rugi.
  - Penulis laporan **tidak diubah** di A-27 — tagging dulu, sesuai panduan implementasi PSAK 118 (fase mapping & tagging mendahului fase laporan).
  - Pemilik berkas: `src/db/schema/accounting.ts`, `src/db/migrations/*`, `src/lib/akuntansi/*`, `account-form.tsx`, `akun-pemetaan.ts`.
  - Gerbang: suite + e2e; test: backfill deterministik + bawaan per section.

- [x] **B6 — Templat COA bawaan 5 digit untuk perusahaan baru (+ demo)** *(menutup struktur F-06/F-08; tabel §4–§5)*
  - Modul templat tunggal baru (satu sumber, pola sentralisasi A-26): `src/lib/akuntansi/chart-template.ts` — daftar akun templat §4 (kode, nama, tipe, section, induk, kelas, tag PSAK 118, kontra, kunci pemetaan) + fungsi penanaman `seedChartOfAccounts(tx, companyId)` di `src/server/accounting.ts` yang menanam akun + pemetaan dalam satu transaksi.
  - Perusahaan baru memakai templat ini; **seed demo beralih ke templat yang sama** (satu sumber — demo adalah etalase sekaligus baseline e2e; test yang mengacu kode 4 digit diperbarui di tahap ini, dinyatakan eksplisit di laporan tahap).
  - Pemetaan yang ditanam templat mencakup **seluruh 36 kunci** — termasuk enam yang hari ini malas/tidak terpetakan (`fixed_asset`→12030, `accumulated_depreciation`→12031, `depreciation_expense`→62010, `salary_deductions_payable`→21102, `employee_loan_receivable`→11121, `other_income`→71001).
  - Struktur header/detail diterapkan: 29 header non-postable berinduk sesuai §4; semua detail postable; `Laba Tahun Berjalan` (31020) ditanam **non-postable + tertandai sistem** (dihitung tutup buku; tidak dipetakan ke kunci mana pun pada tahap ini).
  - Pemilik berkas: `chart-template.ts` (baru), `src/db/seed.ts`, `src/server/accounting.ts`, test yang mengacu kode lama.
  - Gerbang: suite penuh + e2e dari reseed bersih; baseline demo terverifikasi ulang (65 produk, nilai persediaan, consistency) — angka demo tidak berubah, hanya kode/nama akun.

- [x] **B7 — Alat migrasi perusahaan berjalan (OPT-IN pemilik; bukan bawaan)** *(§6)*
  - Aksi server terpisah `src/server/actions/accounting/migrasi-coa.ts` + halaman/panel di area akuntansi: (1) **dry-run** menghasilkan laporan per perusahaan: tabel lama → baru yang akan diterapkan, akun pengguna tanpa padanan (dibiarkan, kode tidak diubah), akun templat baru yang akan ditambahkan, bentrok kode yang harus diputuskan manual; (2) **eksekusi** satu transaksi per perusahaan: buat header baru (bila belum ada), perbarui `code`/`parentId`/`isPostable` akun yang terpetakan tabel, tambahkan akun templat yang hilang, tulis audit per perubahan; (3) perusahaan **tanpa transaksi** boleh memilih ganti templat utuh.
  - Tidak ada jalur otomatis/terjadwal; tidak dijalankan untuk perusahaan mana pun tanpa instruksi eksplisit pemilik per perusahaan.
  - Pemilik berkas: `actions/accounting/migrasi-coa.ts` (baru), panel UI migrasi, test integrasi migrasi atas perusahaan fixture (saldo & jurnal identik sebelum/sesudah; hanya kode/induk yang berubah).
  - Gerbang: suite + e2e; bukti test: total neraca saldo per `accountId` identik sebelum/sesudah migrasi.

- [x] **B8 — Gerbang final & penutup A-27**
  - Gerbang penuh dari reseed bersih (suite, typecheck, lint, build, e2e 19/19), uji asap tambah bank end-to-end di UI, dokumen `STATUS-TUTUP-A27.md` (status F-01…F-10 satu per satu + sisa jujur), PROGRESS §0J ditutup, ZIP rilis dari commit final.

---

## 2. Desain model kas/bank (ringkasan keputusan B1–B3)

| Aspek | Keputusan | Alasan |
|---|---|---|
| Wujud bank | Kolom kelas + rincian di `accounts` (tanpa tabel baru) | Padanan minimal model ERPNext/Odoo untuk arsitektur Bisa ERP; menghindari objek jurnal baru; rincian bank mengikuti pola Accurate (kondisional per kelas) |
| Nilai kelas | `cash` (kas & kas kecil), `bank` (rekening bank), `clearing` (settlement QRIS/EDC/e-wallet/marketplace & kliring) | Tiga perilaku baca yang benar-benar berbeda di aplikasi |
| Keanggotaan | Diturunkan dari kelas (postable + aktif) | Menutup F-01/F-03/F-04 |
| Pemetaan `cash/bank/qris` | Tetap ada — turun peran menjadi **penunjuk bawaan** | POS & mesin butuh tepat satu akun bawaan; pemetaan memang untuk itu |
| Mata uang | Kolom `currency` pada rincian bank, bawaan `IDR`, **tidak dapat diubah sesudah akun bertransaksi** (penjaga B4) | Konsensus riset §5.1; multi-mata-uang penuh di luar cakupan A-27 |
| Nomor rekening | Tersimpan penuh, **ditampilkan termasker** di daftar/dropdown | Praktik ERPNext/Xero |

---

## 3. Anatomi penomoran templat 5 digit

Aturan formal (dari koreksi riset, audit §5.6 butir 2):

- Digit pertama = kelas: 1 Aset · 2 Kewajiban · 3 Ekuitas · 4 Pendapatan · 5 HPP · 6 Beban Operasional · 7 Pendapatan Lain-lain · 8 Beban Lain-lain & Pendanaan · 9 Pajak Penghasilan & Operasi Dihentikan.
- `X0000` = header kelas · `XX000` = header sub-kelas · `XXX00` = header grup · kode lain = detail postable.
- Hierarki disimpan eksplisit (`parentId` + `isPostable=false` pada header) — pola kode hanya konvensi keterbacaan, **tidak pernah** menjadi sumber kebenaran postabilitas.
- Celah disengaja: bank hanya memakai 11010–11059; blok pajak kewajiban 21010–21029 berlangkah 3; rentang cadangan dinyatakan di tabel §4.
- Tipe/section per blok mengikuti matriks koherensi B4; tag PSAK 118 per akun laba rugi mengikuti B5 (bawaan `operating`, kecuali 72xxx = `investing`, 82xxx = `financing`, 91xxx = `income_tax`, 95000 = `discontinued`).

---

## 4. Templat COA bawaan 5 digit (perusahaan baru)

Kolom: Kode · Nama · Jenis (H=header non-postable, D=detail postable) · Induk · Kelas kas/bank · Kunci pemetaan · Catatan (BARU = tidak ada padanannya di COA lama; tag = kategori PSAK 118 untuk akun laba rugi).

### 1XXXX — Aset

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 10000 | Aset | H | — | | | BARU (header kelas) |
| 11000 | Aset Lancar | H | 10000 | | | BARU |
| 11001 | Kas | D | 11000 | cash | cash | ← 1000 |
| 11002 | Kas Kecil | D | 11000 | cash | | ← 1010 (kini berfungsi, F-03) |
| 11011 | Bank BCA | D | 11000 | bank | bank | ← 1100 (contoh bank pertama; 11010–11059 cadangan per bank) |
| 11061 | Piutang Settlement QRIS | D | 11000 | clearing | qris | ← 1110 (blok settlement 11060–11089) |
| 11062 | Piutang Settlement EDC/Debit | D | 11000 | clearing | | BARU |
| 11063 | Piutang Settlement E-Wallet | D | 11000 | clearing | | BARU |
| 11064 | Piutang Settlement Marketplace | D | 11000 | clearing | | BARU |
| 11091 | Kas Dalam Perjalanan | D | 11000 | clearing | | BARU (11090–11099 blok dalam perjalanan) |
| 11100 | Piutang | H | 11000 | | | BARU (header grup) |
| 11101 | Piutang Usaha | D | 11100 | | receivable | ← 1200 |
| 11110 | Cadangan Kerugian Piutang | D | 11100 | | | BARU — kontra piutang (kredit), `is_contra`, pasangan 11101 |
| 11120 | Piutang Karyawan | D | 11100 | | employee_receivable | ← 1220 |
| 11121 | Piutang Pinjaman Karyawan | D | 11100 | | employee_loan_receivable | BARU (kunci lama tak terpetakan di seed) |
| 11130 | Kredit Pemasok | D | 11100 | | supplier_credit | ← 1210 |
| 11140 | Piutang Lain-lain | D | 11100 | | | BARU |
| 11200 | Persediaan | H | 11000 | | | BARU |
| 11201 | Persediaan Barang Dagang | D | 11200 | | inventory | ← 1300 |
| 11210 | Persediaan Konsinyasi | D | 11200 | | | BARU (consignment-out; barang titipan masuk tetap di luar neraca) |
| 11220 | Persediaan Dalam Perjalanan | D | 11200 | | | BARU |
| 11300 | Biaya Dibayar Dimuka | H | 11000 | | | BARU |
| 11301 | Biaya Dibayar Dimuka | D | 11300 | | | BARU (detail umum: sewa/asuransi/lisensi) |
| 11310 | Perlengkapan Toko | D | 11300 | | | ← 1400 |
| 11400 | Uang Muka | H | 11000 | | | BARU |
| 11401 | Uang Muka Pembelian | D | 11400 | | | BARU (operasional saja; uang muka pajak di 11500) |
| 11500 | Pajak Dibayar Dimuka | H | 11000 | | | BARU |
| 11501 | PPN Masukan | D | 11500 | | tax_input | ← 1180 (aset — koreksi riset atas kerangka) |
| 11502 | PPh 22 Dibayar Dimuka | D | 11500 | | | BARU |
| 11503 | PPh 23 Dibayar Dimuka | D | 11500 | | | BARU |
| 11504 | PPh 25 / Uang Muka PPh Badan | D | 11500 | | | BARU |
| 11900 | Kliring & Suspense | H | 11000 | | | BARU (neraca, sementara, target nol) |
| 11901 | Suspense Bank | D | 11900 | clearing | | BARU |
| 11902 | Transfer Internal / Setoran Dalam Perjalanan | D | 11900 | clearing | | BARU |
| 11903 | Kliring Penerimaan | D | 11900 | clearing | | BARU |
| 12000 | Aset Tetap | H | 10000 | | | BARU |
| 12001 | Tanah | D | 12000 | | | BARU (tanpa pasangan penyusutan) |
| 12010 | Bangunan | D | 12000 | | | BARU |
| 12011 | Akumulasi Penyusutan Bangunan | D | 12000 | | | BARU — kontra (kredit), pasangan 12010 |
| 12020 | Kendaraan | D | 12000 | | | BARU |
| 12021 | Akumulasi Penyusutan Kendaraan | D | 12000 | | | BARU — kontra, pasangan 12020 |
| 12030 | Peralatan Toko | D | 12000 | | fixed_asset | ← 1500 (kunci lama tak terpetakan di seed) |
| 12031 | Akumulasi Penyusutan Peralatan | D | 12000 | | accumulated_depreciation | ← 1510 — kontra, pasangan 12030 |
| 12040 | Aset Dalam Pembangunan | D | 12000 | | | BARU |
| 12900 | Aset Lain-lain | H | 10000 | | | BARU |
| 12901 | Deposit Jaminan | D | 12900 | | | BARU (jaminan sewa/listrik) |

### 2XXXX — Kewajiban

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 20000 | Kewajiban | H | — | | | BARU |
| 21000 | Kewajiban Lancar | H | 20000 | | | BARU |
| 21001 | Hutang Usaha | D | 21000 | | payable | ← 2000 |
| 21010 | PPN Keluaran | D | 21000 | | tax_output | ← 2200 (blok pajak 21010–21029 berlangkah 3) |
| 21013 | Utang PPh 21 | D | 21000 | | pph21_payable | ← 2110 |
| 21016 | Utang PPh Dipotong | D | 21000 | | tax_withholding_payable | ← 2130 (PPh 23/4(2) tetap satu akun — lihat keputusan §7) |
| 21019 | Utang PPh 29 | D | 21000 | | | BARU |
| 21022 | Utang Pajak Daerah | D | 21000 | | | BARU |
| 21030 | Pendapatan Diterima Dimuka | H | 21000 | | | BARU |
| 21031 | Uang Muka Pelanggan | D | 21030 | | | BARU |
| 21032 | Voucher & Gift Card Terjual | D | 21030 | | | BARU (liabilitas sampai ditukar) |
| 21033 | Kredit Pelanggan | D | 21030 | | customer_credit | ← 2300 |
| 21040 | Hutang Konsinyasi | D | 21000 | | | BARU (kepada consignor) |
| 21100 | Utang Gaji & Iuran | H | 21000 | | | BARU |
| 21101 | Utang Gaji | D | 21100 | | salary_payable | ← 2100 |
| 21102 | Utang Potongan Gaji Karyawan | D | 21100 | | salary_deductions_payable | BARU (kunci lama tak terpetakan di seed) |
| 21103 | Utang BPJS | D | 21100 | | bpjs_payable | ← 2120 |
| 21104 | Utang THR | D | 21100 | | | BARU |
| 21200 | Utang Jangka Pendek Lainnya | H | 21000 | | | BARU |
| 21201 | Hutang Bank Jangka Pendek & Cerukan | D | 21200 | | | BARU (cerukan = liabilitas, bukan bank negatif) |
| 21202 | Hutang Sewa — Bagian Lancar | D | 21200 | | | BARU |
| 21203 | Hutang Dividen | D | 21200 | | | BARU |
| 22000 | Kewajiban Jangka Panjang | H | 20000 | | | BARU |
| 22001 | Hutang Bank Jangka Panjang | D | 22000 | | | BARU |
| 22002 | Hutang Sewa Jangka Panjang | D | 22000 | | | BARU |

### 3XXXX — Ekuitas

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 30000 | Ekuitas | H | — | | | BARU |
| 31001 | Modal Disetor | D | 30000 | | equity | ← 3000 |
| 31005 | Agio Saham | D | 30000 | | | BARU (cadangan pertumbuhan) |
| 31010 | Laba Ditahan | D | 30000 | | | ← 3100 |
| 31020 | Laba Tahun Berjalan | D* | 30000 | | | BARU — **akun sistem, non-postable bagi pengguna** (dihitung tutup buku; *Jenis D di bagan, `isPostable=false` + tertandai sistem) |
| 31030 | Dividen | D | 30000 | | | BARU (kontra ekuitas — untuk PT) |
| 31035 | Prive Pemilik | D | 30000 | | | BARU (kontra ekuitas — perorangan/CV/firma; dipisah dari Dividen per koreksi riset) |

### 4XXXX — Pendapatan

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 40000 | Pendapatan | H | — | | | BARU · tag operating |
| 41001 | Pendapatan Penjualan | D | 40000 | | revenue | ← 4000 · operating |
| 41002 | Diskon Penjualan | D | 40000 | | sales_discount | ← 4010 · kontra pendapatan (debit), `is_contra` pasangan 41001 |
| 41003 | Retur Penjualan | D | 40000 | | sales_return | ← 4020 · kontra pendapatan (debit), `is_contra` pasangan 41001 |
| 41010 | Pendapatan Komisi Konsinyasi | D | 40000 | | | BARU · operating (konsinyasi berulang = pendapatan usaha, bukan lain-lain) |

### 5XXXX — Harga Pokok Penjualan

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 50000 | Harga Pokok Penjualan | H | — | | | BARU · tag operating |
| 51001 | HPP Barang Dagang | D | 50000 | | cogs | ← 5000 · operating, sifat `inventory_expensed`, fungsi `cogs` |
| 51002 | Diskon Pembelian | D | 50000 | | | BARU — kontra HPP (kredit); **akun penyesuaian HPP perpetual**, lihat §6 catatan |
| 51003 | Retur Pembelian | D | 50000 | | | BARU — kontra HPP (kredit); **akun penyesuaian HPP perpetual**, lihat §6 catatan |
| 51010 | Ongkos Kirim Pembelian | D | 50000 | | | BARU (freight-in, komponen biaya perolehan) |
| 51020 | Selisih Persediaan | D | 50000 | | inventory_shrink | ← 5010 · sifat `inventory_writedown` |
| 51030 | Barang Rusak dan Kedaluwarsa | D | 50000 | | damaged | ← 5020 · sifat `inventory_writedown` |

### 6XXXX — Beban Operasional

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 60000 | Beban Operasional | H | — | | | BARU · tag operating |
| 61000 | Beban Gaji & Tunjangan | H | 60000 | | | BARU |
| 61001 | Beban Gaji Karyawan | D | 61000 | | salary_expense | ← 6000 · sifat `employee_benefits` |
| 61002 | Beban Iuran BPJS Perusahaan | D | 61000 | | payroll_employer_expense | ← 6080 · sifat `employee_benefits` |
| 62000 | Beban Operasional Umum | H | 60000 | | | BARU |
| 62001 | Beban Sewa | D | 62000 | | | ← 6010 · sifat `rent`, fungsi `admin` |
| 62002 | Beban Listrik dan Air | D | 62000 | | | ← 6020 · sifat `utilities` |
| 62003 | Beban Telepon dan Internet | D | 62000 | | | ← 6030 · sifat `utilities` |
| 62004 | Beban Transportasi | D | 62000 | | | ← 6040 |
| 62005 | Beban Perlengkapan | D | 62000 | | | ← 6050 |
| 62006 | Beban Administrasi Bank | D | 62000 | | bank_fee | ← 6060 · sifat `bank_charges` (admin bank = operasional, bukan pendanaan) |
| 62007 | Beban MDR & Biaya Pembayaran | D | 62000 | | | BARU · sifat `payment_fees`, fungsi `selling` (MDR ditanggung merchant, tidak dinetokan ke penjualan) |
| 62008 | Beban Lain-lain Operasional | D | 62000 | | | ← 6070 · label "lain-lain" material wajib dipecah (peringatan PSAK 118) |
| 62009 | Beban Selisih Kas Kurang | D | 62000 | | cash_short | ← 8000 (pindah dari blok 8xxx — selisih kas adalah laba rugi operasional) |
| 62010 | Beban Penyusutan | D | 62000 | | depreciation_expense | BARU di seed · sifat `depreciation` (kunci lama tak terpetakan di seed) |
| 62011 | Beban Piutang Tak Tertagih | D | 62000 | | receivable_writeoff | ← 6100 · sifat `impairment` (ECL piutang dagang = operating per PSAK 118) |

### 7XXXX — Pendapatan Lain-lain (dipecah per kategori PSAK 118)

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 70000 | Pendapatan Lain-lain | H | — | | | BARU |
| 71000 | Pendapatan Operasional Lainnya | H | 70000 | | | BARU · tag operating |
| 71001 | Pendapatan Operasional Lainnya | D | 71000 | | other_income | ← 4030 · operating |
| 71002 | Pendapatan Selisih Kas Lebih | D | 71000 | | cash_over | ← 8001 · operating |
| 71003 | Pembulatan Penjualan (Laba) | D | 71000 | | rounding_gain | ← 9000 · operating |
| 72000 | Pendapatan Investasi | H | 70000 | | | BARU · tag investing |
| 72001 | Bunga Deposito & Jasa Giro | D | 72000 | | | BARU · **investing** (bunga atas kas & setara kas) |

### 8XXXX — Beban Lain-lain & Pendanaan (dipecah per kategori PSAK 118)

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 80000 | Beban Lain-lain & Pendanaan | H | — | | | BARU |
| 81000 | Beban Operasional Lainnya | H | 80000 | | | BARU · tag operating |
| 81001 | Selisih Pembulatan (Rugi) | D | 81000 | | rounding_loss | ← 9001 · operating |
| 82000 | Beban Pendanaan | H | 80000 | | | BARU · tag financing |
| 82001 | Beban Bunga Pinjaman | D | 82000 | | | BARU · **financing**, sifat `interest` |
| 82002 | Beban Bunga Sewa | D | 82000 | | | BARU · **financing**, sifat `interest` |

### 9XXXX — Pajak Penghasilan & Operasi Dihentikan

| Kode | Nama | Jenis | Induk | Kelas | Kunci | Catatan |
|---|---|---|---|---|---|---|
| 90000 | Pajak Penghasilan & Operasi Dihentikan | H | — | | | BARU |
| 91001 | Beban Pajak Penghasilan — Kini | D | 90000 | | | BARU · tag `income_tax` (keluar dari 8XXXX per koreksi riset) |
| 91002 | Beban/(Manfaat) Pajak Tangguhan | D | 90000 | | | BARU · tag `income_tax` |
| 91010 | Beban PPh Final | D | 90000 | | | BARU · tag `income_tax` |
| 95000 | Operasi Dihentikan | D* | 90000 | | | BARU — dicadangkan, non-postable sampai diaktifkan akuntan · tag `discontinued` |

**Ukuran templat**: 124 akun (29 header + 95 detail) — di dalam rentang sehat retail SME menurut riset (80–150 akun postable+header untuk multi-bank & pajak Indonesia). Enam kunci pemetaan yang hari ini tidak terpetakan di seed kini terpetakan; total 36/36 kunci tertanam oleh templat.

---

## 5. Tabel mapping lengkap — 42 akun lama → kode baru

Berlaku untuk (a) seed demo di B6 dan (b) dry-run migrasi perusahaan berjalan di B7. Semua pemetaan **1-ke-1**: tidak ada akun lama yang dihapus, digabung, atau dibagi — karena itu tidak diperlukan jurnal migrasi saldo sama sekali; yang berubah hanya `code`, `parentId`, dan penanda baru pada baris akun yang sama (`accountId` tetap).

| Lama | Nama lama | → Baru | Nama baru | Kunci / catatan |
|---|---|---|---|---|
| 1000 | Kas | 11001 | Kas | cash; kelas `cash` |
| 1010 | Kas Kecil | 11002 | Kas Kecil | kelas `cash` (F-03 tertutup) |
| 1100 | Bank BCA | 11011 | Bank BCA | bank; kelas `bank` + rincian bank |
| 1110 | QRIS Clearing | 11061 | Piutang Settlement QRIS | qris; kelas `clearing`; nama diperjelas (piutang settlement, bukan bank) |
| 1180 | PPN Masukan | 11501 | PPN Masukan | tax_input; pindah ke grup Pajak Dibayar Dimuka |
| 1200 | Piutang Usaha | 11101 | Piutang Usaha | receivable |
| 1210 | Kredit Pemasok | 11130 | Kredit Pemasok | supplier_credit |
| 1220 | Piutang Karyawan | 11120 | Piutang Karyawan | employee_receivable |
| 1300 | Persediaan Barang Dagang | 11201 | Persediaan Barang Dagang | inventory |
| 1400 | Perlengkapan | 11310 | Perlengkapan Toko | di bawah grup Biaya Dibayar Dimuka |
| 1500 | Peralatan Toko | 12030 | Peralatan Toko | fixed_asset (kini terpetakan) |
| 1510 | Akumulasi Penyusutan Peralatan | 12031 | Akumulasi Penyusutan Peralatan | accumulated_depreciation; kontra pasangan 12030 |
| 2000 | Utang Usaha | 21001 | Hutang Usaha | payable (ejaan diseragamkan "Hutang" mengikuti kerangka) |
| 2100 | Utang Gaji | 21101 | Utang Gaji | salary_payable |
| 2110 | Utang PPh 21 | 21013 | Utang PPh 21 | pph21_payable |
| 2120 | Utang BPJS | 21103 | Utang BPJS | bpjs_payable |
| 2130 | Utang PPh Dipotong | 21016 | Utang PPh Dipotong | tax_withholding_payable (tetap satu akun) |
| 2200 | PPN Keluaran | 21010 | PPN Keluaran | tax_output |
| 2300 | Kredit Pelanggan | 21033 | Kredit Pelanggan | customer_credit; di bawah grup Pendapatan Diterima Dimuka |
| 3000 | Modal Pemilik | 31001 | Modal Disetor | equity; nama mengikuti kerangka |
| 3100 | Laba Ditahan | 31010 | Laba Ditahan | |
| 4000 | Penjualan | 41001 | Pendapatan Penjualan | revenue |
| 4010 | Diskon Penjualan | 41002 | Diskon Penjualan | sales_discount; kontra 41001 |
| 4020 | Retur Penjualan | 41003 | Retur Penjualan | sales_return; kontra 41001 |
| 4030 | Pendapatan Lain-lain | 71001 | Pendapatan Operasional Lainnya | other_income (kini terpetakan); pindah blok 7xxxx-operasional |
| 5000 | Harga Pokok Penjualan | 51001 | HPP Barang Dagang | cogs |
| 5010 | Selisih Persediaan | 51020 | Selisih Persediaan | inventory_shrink |
| 5020 | Barang Rusak dan Kedaluwarsa | 51030 | Barang Rusak dan Kedaluwarsa | damaged |
| 6000 | Beban Gaji Karyawan | 61001 | Beban Gaji Karyawan | salary_expense |
| 6010 | Beban Sewa | 62001 | Beban Sewa | |
| 6020 | Beban Listrik dan Air | 62002 | Beban Listrik dan Air | |
| 6030 | Beban Telepon dan Internet | 62003 | Beban Telepon dan Internet | |
| 6040 | Beban Transportasi | 62004 | Beban Transportasi | |
| 6050 | Beban Perlengkapan | 62005 | Beban Perlengkapan | |
| 6060 | Beban Administrasi Bank | 62006 | Beban Administrasi Bank | bank_fee |
| 6070 | Beban Lain-lain | 62008 | Beban Lain-lain Operasional | nama diperjelas |
| 6080 | Beban Iuran BPJS Perusahaan | 61002 | Beban Iuran BPJS Perusahaan | payroll_employer_expense; pindah ke keluarga gaji |
| 6100 | Beban Piutang Tak Tertagih | 62011 | Beban Piutang Tak Tertagih | receivable_writeoff |
| 8000 | Selisih Kas Kurang | 62009 | Beban Selisih Kas Kurang | cash_short; keluar dari blok campur 8xxx |
| 8001 | Selisih Kas Lebih | 71002 | Pendapatan Selisih Kas Lebih | cash_over; keluar dari blok campur 8xxx |
| 9000 | Pembulatan Penjualan (Laba) | 71003 | Pembulatan Penjualan (Laba) | rounding_gain; keluar dari blok 9xxx lama (9xxxx kini khusus pajak penghasilan) |
| 9001 | Selisih Pembulatan (Rugi) | 81001 | Selisih Pembulatan (Rugi) | rounding_loss |

Ringkasan: **42/42 akun lama terpetakan 1-ke-1**; 0 digabung, 0 dibagi, 0 dihapus. Akun baru tanpa padanan lama: **53 detail baru + 29 header** (bertanda BARU di §4), termasuk seluruh akun hilang dari audit (CKPN 11110, grup Pendapatan Diterima Dimuka 21030+, Prive 31035 & Dividen 31030, Ongkos Kirim Pembelian 51010, Diskon Pembelian 51002, Retur Pembelian 51003, Beban Penyusutan 62010, settlement EDC/e-wallet/marketplace 11062–11064, Laba Tahun Berjalan 31020).

Keputusan yang diambil di tabel ini (dapat dibalik pemilik, tercatat): **selisih kas tetap dua akun** (62009 beban / 71002 pendapatan) — bukan satu akun yang membalik presentasi menurut tanda saldo seperti anjuran ringkas riset — karena penulis laporan Bisa ERP mengelompokkan berdasar `section` akun dan tidak dapat membalik presentasi per tanda saldo; menggabungkan akan mengubur salah satu sisi. Satu-akun dapat dipertimbangkan nanti bila penulis laporan mendukung presentasi bertanda.

---

## 6. Strategi migrasi perusahaan yang sudah berjalan

Fakta yang membuat migrasi aman: **kode adalah data per perusahaan**. Jurnal (`journal_lines.account_id`), pemetaan (`account_mappings.account_id`), metode (`payment_methods.account_id`), dan saldo awal (jurnal `opening`) semuanya mereferensikan `accountId` (uuid), **bukan kode**. Laporan membaca atribut akun saat ini (type/section/tag). Karena itu renumber = memperbarui baris `accounts` saja; tidak ada jurnal migrasi, tidak ada saldo yang berpindah, tidak ada riwayat yang ditulis ulang.

Meski aman secara mekanis, migrasi **tidak pernah dijalankan diam-diam**:

1. **Opt-in per perusahaan** oleh pemilik (keputusan §7 butir 1). Perusahaan yang puas dengan 4 digit tetap sah selamanya — tidak ada standar yang mewajibkan 5 digit (audit §5.6 butir 1).
2. **Dry-run dulu** (B7): laporan tabel lama→baru untuk perusahaan itu persis, akun kustom pengguna yang tidak ada di tabel §5 (dibiarkan apa adanya — kode tidak diubah), akun templat §4 yang akan ditambahkan, dan daftar bentrok (kode target sudah dipakai akun lain di perusahaan itu) yang harus diputuskan manual sebelum eksekusi.
3. **Eksekusi satu transaksi**: buat header yang belum ada → perbarui `code`/`parentId`/`isPostable`/kelas/tag akun terpetakan tabel (urut pembaruan menghindari tabrakan unik sesaat: kode yang bertukar tempat dilewati kode sementara internal transaksi) → tambahkan akun baru → audit log per akun. Gagal di tengah = rollback utuh.
4. **Verifikasi sesudah**: neraca saldo per `accountId` identik dengan sebelum (test B7 membuktikan di fixture; panel menampilkan perbandingan total per tipe), pemetaan 36 kunci utuh, dan uji asap tambah bank.
5. **Perusahaan tanpa transaksi** boleh memilih jalur ERPNext: ganti templat utuh (hapus bagan lama yang belum terpakai jurnal, tanam §4) — tetap lewat dry-run yang sama.
6. Periode tertutup/terkunci **tidak** menghalangi renumber (tidak ada jurnal yang disentuh), tetapi laporan yang sudah diterbitkan untuk periode tertutup tidak diterbitkan ulang dengan kode baru tanpa keputusan pemilik — kode pada laporan lama adalah fakta historis dokumen itu.

### Catatan arsitektur persediaan perpetual (mengikat B6/B7)
Bisa ERP perpetual (moving average): pembelian mendebit Persediaan, HPP lahir saat penjualan, retur pembelian normal membalik persediaan pada biaya asal lewat Kredit Pemasok (11130). Karena itu 51002 Diskon Pembelian & 51003 Retur Pembelian di §4 adalah **akun penyesuaian HPP** — hanya untuk selisih harga retur, retur sesudah tutup periode yang tak bisa membalik penerimaan asal, dan diskon penyelesaian pasca-penjualan (audit §5.8). Dokumentasi templat & deskripsi pemetaan wajib menyatakan ini; saldo keduanya yang tumbuh terus-menerus adalah indikator salah konfigurasi, dan **tidak ada** jalur posting baru yang dibuat A-27 untuk mengisinya di luar kasus-kasus itu.

---

## 7. Keputusan pemilik yang terkumpul

| # | Keputusan | Rekomendasi Pemimpin | Status |
|---|---|---|---|
| 1 | Renumber perusahaan yang **sudah berjalan** ke skema 5 digit | **Opt-in per perusahaan** lewat alat B7 (dry-run → persetujuan → eksekusi); tidak pernah otomatis/diam-diam | Menunggu pemilik per perusahaan |
| 2 | Seed demo beralih ke templat 5 digit di B6 (test yang mengacu kode 4 digit diperbarui) | **Ya** — satu sumber templat; demo adalah baseline e2e, templat harus teruji di jalur yang sama | Keputusan Pemimpin, dapat dibalik pemilik |
| 3 | Selisih kas: satu akun membalik tanda vs dua akun | **Dua akun** (62009/71002) — penulis laporan berbasis section belum bisa membalik presentasi | Keputusan Pemimpin (alasan di §5) |
| 4 | PPh 23 dan PPh 4(2) dipecah menjadi dua akun hutang terpisah | **Tidak untuk migrasi ini** — 2130 tetap satu akun `Utang PPh Dipotong` (21016) karena kunci `tax_withholding_payable` tunggal; celah blok 21010–21029 memungkinkan pemecahan kelak tanpa renumber | Keputusan Pemimpin |
| 5 | Mesin penyisihan CKPN/ECL (mengisi akun 11110 secara berkala) | Akun **ditambahkan**; mesin penyisihan **tidak dibangun** di A-27 — matriks ECL adalah keputusan pemilik yang sudah lama menunggu (daftar keputusan A-24 §3) dan tidak boleh dibangun diam-diam | Menunggu pemilik |
| 6 | Penandaan kelas kas/bank & tag PSAK 118 untuk akun kustom perusahaan berjalan | Manual lewat formulir B3/B5 (backfill otomatis hanya dari pemetaan & section — tidak menebak nama/kode) | Keputusan Pemimpin (kejujuran data) |
| 7 | Multi-mata-uang penuh untuk akun bank (saldo & jurnal valas) | Di luar cakupan A-27; kolom `currency` disiapkan sebagai data rincian | Menunggu pemilik bila dibutuhkan |

---

## 8. Risiko & kejujuran cakupan

- B6 adalah tahap terberat: baseline e2e dan banyak test mengacu kode 4 digit; pembaruan test adalah bagian eksplisit tahap, bukan efek samping. Bila sapuan test terbukti lebih luas dari perkiraan, B6 boleh dipecah B6a (modul templat + perusahaan baru) dan B6b (alih seed demo) tanpa mengubah desain.
- FK `payment_methods.account_id` (B1) dapat menggagalkan migrasi bila ada baris yatim di DB non-demo yang tidak dikenal dari repo ini — karena itu pemeriksaan data adalah langkah pertama B1 dan kegagalannya adalah laporan, bukan tebakan perbaikan.
- Tag PSAK 118 di B5 adalah *kesiapan data*; laporan laba rugi berformat PSAK 118 (dua subtotal wajib, kategori dari tag) adalah program tersendiri sesudah tagging terbukti terisi — dan kewajiban PSAK 118 sendiri bergantung pilar SAK entitas (SAK EP/EMKM tidak otomatis wajib; audit §5.7).
- A-27 tidak membangun: mesin CKPN/ECL, jurnal per bank ala Odoo, impor mutasi bank per rincian baru, dan multi-mata-uang. Semuanya tercatat sebagai pekerjaan lanjutan berkeputusan pemilik, bukan sisa diam-diam.
