# AUDIT-A27 — Audit Bagan Akun & Model Kas/Bank

Program **A-27 Perbaikan Bagan Akun** · Tahap **B0** (dokumen audit gabungan + rencana; tanpa perubahan kode)
Tanggal: 2026-11-07 · Status: audit selesai, menunggu eksekusi rencana (`docs/bagan-akun/RENCANA.md`)

Sumber bukti: (1) audit internal A-27 dengan **reproduksi nyata** terhadap jalur resmi aplikasi; (2) riset web praktik terbaik — laporan penuh di `~/workspace/research_notes/chart-of-accounts-bank-best-practices-er-20261106-2158/report.md` (373 baris, sumber resmi Odoo/ERPNext/Xero/QuickBooks/Accurate + panduan implementasi PSAK 118) dan addendum `notes/sources-addendum-psak118.md`; (3) kerangka COA dari pengguna (5 digit, 2026-11-07) yang divalidasi riset, bukan diterima membabi buta.

---

## 1. Vonis ringkas

Bagan akun Bisa ERP **sehat di mesin posting, sakit di model kas/bank dan di struktur bagan**.

- Keluhan pengguna **"tambah bank tidak bisa" terbukti dan ter-reproduksi**: penyebabnya bukan penomoran dan bukan bug formulir, melainkan model data — "bank" di sistem ini bukan kelas akun, melainkan **satu slot pemetaan** (`account_mappings` unik per kunci). Bank kedua secara struktural tidak bisa menjadi akun kas/bank penuh (F-01, F-02).
- Mesin jurnal justru kuat: `postJournal` menolak akun non-postable dan nonaktif dengan pesan jelas, hapus akun berpenjaga lengkap, kode duplikat menghasilkan pesan ramah. Bagian ini **tidak diubah**.
- Struktur bagan bawaan belum memakai kemampuan yang sudah ada: hierarki header/detail tersedia di skema tetapi COA terkirim **0 header, 0 akun berinduk**; tidak ada penanda akun sistem; beberapa akun wajib retail hilang (CKPN, pendapatan diterima dimuka, prive/dividen, ongkos kirim pembelian, kontra pembelian, beban penyusutan, settlement e-wallet).
- Kesiapan PSAK 118 (berlaku 1 Jan 2027, retrospektif): kolom `cash_flow_group` sudah ada untuk arus kas (PSAK 207), tetapi **belum ada tag kategori presentasi laba rugi** (operating/investing/financing/income_tax/discontinued) — dan riset membuktikan kategori itu **tidak bisa diturunkan dari rentang kode** (lihat §6.4).

Total temuan: **F-01…F-10** — 2 kritis, 1 tinggi, 4 sedang, 2 rendah, 1 info. Rencana perbaikan: tahap **B1–B8** di `RENCANA.md`.

---

## 2. Keadaan saat ini (terverifikasi dari kode)

### 2.1 Skema akun

`src/db/schema/accounting.ts:27-44` — tabel `accounts`: `code` (teks bebas), `name`, `type` (teks; nilai dibatasi di lapis aksi), `normalBalance`, `parentId` (self-reference, **tanpa FK**), `section`, `cashFlowGroup`, `isPostable` (bawaan true), `isActive` (bawaan true). Indeks unik `(company_id, code)`.

Yang **tidak ada** di skema: kolom subtype/kelas kas-bank, kolom mata uang per akun, kolom flag sistem (`is_system`), kolom penanda kontra (`is_contra`), kolom kategori PSAK 118.

### 2.2 Pemetaan akun — satu kunci, satu akun

`accountMappings` (`src/db/schema/accounting.ts:46-58`): satu baris per `(company_id, key)`, indeks unik `(company_id, key)` → **satu kunci hanya boleh menunjuk satu akun**. Ada **36 kunci resmi** di `src/lib/akuntansi/account-mappings.ts` (`ACCOUNT_MAPPING_KEYS`, dijaga test sinkronisasi) — `cash`, `bank`, `qris`, `receivable`, `inventory`, `payable`, `revenue`, `sales_discount`, …, `tax_withholding_payable`, `receivable_writeoff`. Dibaca lewat `getAccountMap` (`src/server/accounting.ts:145-151`).

Pemetaan adalah pola yang benar untuk *penunjuk bawaan* (akun kas utama POS, akun pendapatan bawaan, dst.). Masalahnya: pemetaan juga dipakai sebagai *definisi keanggotaan kelas* kas/bank — dan di situlah ia runtuh (F-01).

### 2.3 "Bank" tidak punya wujud

Tidak ada tabel `bankAccounts` di seluruh `src/`. "Bank" direpresentasikan sebagai akun GL biasa yang ditunjuk kunci pemetaan `bank` dan/atau `paymentMethods.accountId` (`src/db/schema/platform.ts:202-226`; `accountId` baris 210 **tanpa FK**). Metode pembayaran bawaan seed: CASH, QRIS, TRANSFER, CREDIT, CUSTCREDIT (`src/db/seed.ts:492-535`).

Definisi operasional "akun kas/bank" di seluruh aplikasi = **himpunan maksimal 3 akun** hasil pemetaan `cash`/`bank`/`qris`. Pola ini muncul di **17 tempat**, antara lain:

| Situs | Berkas |
|---|---|
| Halaman Kas & bank (daftar rekening + total) | `src/app/app/akuntansi/(akuntansi)/bank/page.tsx:39-47` |
| `listPaymentAccounts` (daftar akun pembayaran + fee) | `src/server/accounting.ts:638` |
| Daftar akun rekonsiliasi (gabungan, lihat F-04) | `src/server/bank-reconciliation/accounts.ts:21-58` |
| Transfer antar bank | `src/server/bank-transfers.ts` |
| Halaman piutang-utang, beban, payroll, kasbon, pinjaman, klaim | `src/app/app/akuntansi/**` |
| Quick entry, pembayaran utang, saldo awal, POS (sesi, penjualan, retur, piutang) | `src/server/quick-entry.ts`, `payables.ts`, `opening-balances/payments.ts`, `pos/*.ts` |

### 2.4 COA bawaan terkirim: 42 akun, 4 digit, datar

Seed `src/db/seed.ts:382-425` menanam 42 akun (1000 Kas … 9001 Selisih Pembulatan Rugi), semuanya **postable, tanpa induk, tanpa header**, dan memetakan 30 dari 36 kunci (`src/db/seed.ts:442-475`). Enam kunci tidak dipetakan di seed dan ditanam malas oleh domain pemiliknya: `fixed_asset`, `accumulated_depreciation`, `depreciation_expense` (`src/server/fixed-assets.ts:98`), `salary_deductions_payable`, `employee_loan_receivable`, `other_income`. Perusahaan baru pun **tidak punya modul templat bagan akun tunggal** — akun lahir dari seed demo, penanaman malas per domain, dan impor.

Penomoran saat ini: 4 digit per kategori (1xxx aset, 2xxx liabilitas, 3xxx ekuitas, 4xxx pendapatan, 5xxx HPP, 6xxx beban operasional, 8xxx lain-lain, 9xxx pembulatan); blok 7xxx kosong total; ruang bebas besar (untuk bank: 1120–1170, 1190). **Penomoran bukan penghalang tambah bank.**

### 2.5 Yang sudah sehat (jangan diubah)

- Kode duplikat → tertangkap indeks unik dan diterjemahkan `guard` menjadi pesan ramah "Kode akun tersebut sudah digunakan…" (`src/lib/errors.ts`).
- `postJournal` menolak baris ke akun non-postable ("…adalah akun induk dan tidak dapat dipakai untuk posting jurnal") dan akun nonaktif, dengan satu pengecualian terdokumentasi: jurnal pembalik (`src/server/accounting.ts:336-348`).
- `deleteAccountAction` berpenjaga lengkap: menolak bila ada baris jurnal, anak akun, pemetaan, metode pembayaran, atau akun diskon kelompok harga (`src/server/actions/accounting/akun-pemetaan.ts:171-229`).
- Ganti tipe akun yang sudah bertransaksi ditolak dengan pesan yang menjelaskan alasannya (`akun-pemetaan.ts:102-113`).
- `saveMappingAction` memvalidasi akun tujuan: ada, sekantor, postable, aktif (`akun-pemetaan.ts:258-307`).
- Laporan mengelompokkan dari `section`/`cash_flow_group` per akun, **tidak pernah menebak dari rentang kode** (aturan proyek, FIX-R2/AK2-04).

---

## 3. Reproduksi "tambah bank tidak bisa"

Jalur resmi pengguna: (1) Bagan Akun → "Akun baru"; (2) Pengaturan → Metode Pembayaran → metode baru tipe Transfer bank; (3) akun diharapkan muncul di Kas & bank / transfer / rekonsiliasi. Reproduksi memakai fungsi domain dan payload aksi yang sama persis terhadap DB demo, dalam transaksi yang di-rollback (DB terverifikasi tidak berubah sesudahnya).

**Baseline demo**: pemetaan `cash`=1000 Kas, `bank`=1100 Bank BCA, `qris`=1110 QRIS Clearing → himpunan Kas & bank = `[1000, 1100, 1110]`.

| Langkah | Hasil |
|---|---|
| 1. Buat akun GL "1150 Bank Mandiri" (payload persis `saveAccountAction`) | **BERHASIL** — akun tampil di bagan akun |
| 2. Keanggotaan sesudah dibuat: himpunan Kas & bank? daftar rekonsiliasi? dropdown akun metode pembayaran baru? | **false / false / false** — dropdown tetap `[1000, 1100, 1110]` |
| 3. Tautkan metode pembayaran `MANDIRI (bank)` → akun baru (payload persis `savePaymentMethodAction`) | Insert **BERHASIL** di server; masuk daftar rekonsiliasi = true (aturan gabungan F-04); masuk himpunan Kas & bank/transfer = **tetap false** |
| 4. Pindahkan pemetaan `bank` ke Bank Mandiri | Bank Mandiri masuk himpunan, tetapi **Bank BCA terlempar keluar** — kunci `bank` satu slot (indeks unik `account_mappings_company_key_uq`) |
| 5. Buat akun dengan kode bentrok `1100` | Error PG 23505 diterjemahkan menjadi pesan ramah — **sehat, bukan bug** |
| 6. Nonaktifkan akun yang sedang terpetakan `bank` (jalur ubah akun) | **BERHASIL tanpa penjaga apa pun**; akun langsung hilang dari daftar rekonsiliasi; kegagalan baru muncul di hilir saat posting |

**Kesimpulan lapis kegagalan**: pembuatan akun GL sehat. Kegagalan ada di lapis model baca/UI: (i) tidak ada cara menandai akun sebagai bank; (ii) dropdown formulir metode pembayaran baru dibatasi himpunan pemetaan (`src/app/app/pengaturan/page.tsx:221-241`, dipakai di `:255`; komentar di lokasi yang sama mengakui ini disengaja), padahal aksi servernya sendiri **tidak** membatasi `accountId` (kecuali tipe `customer_credit`, `src/server/actions/settings/pembayaran.ts:56-76`) — UI memblokir apa yang server izinkan.

---

## 4. Temuan F-01…F-10

### F-01 (KRITIS) — "Bank" = satu slot pemetaan, bukan kelas akun
Tidak ada subtype/flag kas-bank di skema (`accounting.ts:27-44`); keanggotaan kas/bank ditentukan himpunan 3 kunci pemetaan di 17 tempat (§2.3). Bank kedua dan seterusnya secara struktural tidak bisa menjadi akun kas/bank penuh. Bukti: reproduksi langkah 2 & 4.
→ Ditutup oleh rencana **B1+B2** (kelas akun + keanggotaan dari kelas).

### F-02 (KRITIS) — Tambah bank dari UI jalan buntu
Dropdown akun pada formulir metode pembayaran **baru** hanya berisi ≤3 akun terpetakan (`pengaturan/page.tsx:221-241,255`); akun bank baru buatan pengguna tidak pernah bisa dipilih. Satu-satunya jalan UI adalah merebut slot pemetaan `bank` (mengorbankan bank lama dari semua permukaan kas) atau menerima bank baru yang hanya setengah berfungsi (rekonsiliasi lewat metode, tanpa halaman Kas & bank dan tanpa transfer antar bank — `BankTransferForm` hanya menerima himpunan kas/bank).
→ Ditutup oleh **B2+B3** (dropdown & validasi mengikuti kelas).

### F-03 (TINGGI) — COA bawaan tidak muat modelnya sendiri: Kas Kecil yatim
Akun seed `1010 Kas Kecil` tidak masuk himpunan kas/bank mana pun (reproduksi baseline: tidak termasuk) dan di DB demo memiliki **0 baris jurnal** — kas kecil tidak bisa dipakai membayar beban/transfer lewat UI mana pun yang menyaring dengan himpunan pemetaan (mis. halaman beban). Akun yang ditanam resmi oleh sistem sendiri tidak berfungsi.
→ Ditutup oleh **B1+B2** (1010 bertanda kelas `cash` di seed; keanggotaan dari kelas).

### F-04 (SEDANG) — Daftar rekonsiliasi timpang dua arah
`listReconciliationAccounts` (`bank-reconciliation/accounts.ts:21-58`) = pemetaan `cash/bank/qris` ∪ akun di balik **semua** metode pembayaran aktif, tanpa memandang tipe akun. Akibatnya daftar akun yang dapat direkonsiliasi di demo berisi **1200 Piutang Usaha** (di balik metode CREDIT) dan **2300 Kredit Pelanggan** (di balik CUSTCREDIT) — akun kontrol piutang/liabilitas dapat "direkonsiliasi" terhadap rekening koran. Terlalu sempit untuk bank baru (F-01), terlalu longgar untuk akun kontrol.
→ Ditutup oleh **B2+B3** (daftar rekonsiliasi = kelas kas/bank/clearing; metode divalidasi kelasnya per tipe).

### F-05 (SEDANG) — Nonaktifkan tanpa penjaga, kontras dengan hapus yang dijaga ketat
Jalur **ubah** (`akun-pemetaan.ts:93-158`) tidak memiliki satu pun cek referensi yang dimiliki jalur hapus: akun terpetakan/terikat metode boleh dinonaktifkan diam-diam (reproduksi langkah 6), lalu `postJournal` menolaknya di hilir — kegagalan muncul jauh dari penyebabnya. Mengganti nama akun sistem bebas; kode akun justru **tidak bisa diubah sama sekali** (jalur update tidak menyetel `code`; formulir menonaktifkannya) — kebalikan dari kebutuhan pengguna "semua bisa diedit, sistem menyesuaikan".
→ Ditutup oleh **B4** (penjaga nonaktif setara penjaga hapus + pratinjau dampak; kode dapat diedit berpenjaga unik + audit).

### F-06 (SEDANG) — Hierarki ada tapi tidak ditegakkan saat tulis, dan tidak dipakai
Jalur simpan hanya memeriksa induk ada & bukan diri sendiri (`akun-pemetaan.ts:74-83`): induk boleh postable, akun postable boleh punya anak, dan **siklus A↔B berhasil dibuat** (reproduksi). `postJournal` hanya memeriksa `isPostable` akun baris itu sendiri, jadi induk postable beranak tetap bisa menerima posting. Subtotal grup di halaman bagan akun menjumlahkan semua baris se-tipe (`akun/page.tsx:151-157`) → risiko hitung ganda tampilan bila induk postable beranak dipakai. Di COA terkirim fitur ini dorman: **0 header, 0 berinduk**.
→ Ditutup oleh **B4** (penjaga hierarki tulis + subtotal anti hitung ganda) dan **B6** (struktur header/detail diterapkan di templat bawaan).

### F-07 (SEDANG) — Tidak ada penanda akun sistem/permanent
Tanpa kolom/flag, **28 akun pembawa kunci pemetaan** dan akun di balik 5 metode pembayaran tidak bisa dibedakan dari akun buatan pengguna; perlindungan murni referensial untuk hapus saja. Pengguna tidak bisa melihat akun mana yang "jangan disentuh".
→ Ditutup oleh **B4** (flag `is_system` diturunkan dari ikatan pemetaan/metode — selalu akurat, tanpa kolom yang bisa basi).

### F-08 (RENDAH) — Kode akun teks bebas tanpa pola
Zod hanya `min(1).max(20)` (`akun-pemetaan.ts:46-68`); pengurutan leksikografis string. Blok 8xxx/9xxx mencampur tipe bersebelahan (8000 expense ↔ 8001 revenue; 9000 revenue ↔ 9001 expense). Ruang nomor sebenarnya longgar (7xxx kosong; 1120–1170 bebas). Keputusan desain (didukung riset §5.2): kode **tetap bebas** — kerapian datang dari templat, bukan dari pola yang dipaksakan ke kode; yang ditambahkan adalah kemampuan *mengedit* kode berpenjaga (F-05/B4).
→ Ditutup oleh **B4+B6**.

### F-09 (RENDAH) — `accountId` metode pembayaran tidak tervalidasi & tanpa FK
Selain tipe `customer_credit`, `savePaymentMethodAction`/`updatePaymentMethodAction` tidak memeriksa akun tujuan ada/sekantor/postable/aktif/kelasnya sesuai (`pembayaran.ts:84-119`), dan kolomnya tanpa FK (`platform.ts:210`) → referensi yatim mungkin lewat pemanggilan di luar UI.
→ Ditutup oleh **B1** (FK) + **B3** (validasi per tipe metode).

### F-10 (INFO) — Kategori tertutup di kode, tanpa validasi koherensi
`type` enum 6 nilai & `section` enum 10 nilai dikeraskan di Zod (`akun-pemetaan.ts:46-68`) dan formulir (`src/components/akuntansi/account-form.tsx`). Koherensi type↔section↔normalBalance tidak divalidasi (akun expense dengan section `current_asset` lolos). Enum tertutup itu sendiri **sesuai praktik terbaik** (riset §5.3: taksonomi tipe memang tertutup dan dimiliki sistem di semua ERP) — yang kurang adalah validasi koherensinya.
→ Ditutup oleh **B4** (matriks koherensi type↔section; saldo normal tetap eksplisit karena akun kontra adalah pengecualian sah).

### Akun wajib retail yang HILANG dari COA bawaan

Dari ekstraksi 42 akun (§2.4) terhadap kerangka pengguna + koreksi riset:

| Akun | Status | Catatan |
|---|---|---|
| Cadangan Kerugian Piutang (CKPN) | **TIDAK ADA** | Kontra piutang; pasangan 1200 |
| Pendapatan Diterima Dimuka (+ Uang Muka Pelanggan, Voucher/Gift Card) | **TIDAK ADA** | Liabilitas retail klasik |
| Prive / Dividen | **TIDAK ADA** | Ekuitas hanya 3000 Modal & 3100 Laba Ditahan |
| Ongkos Kirim Pembelian (freight-in) | **TIDAK ADA** | Komponen biaya perolehan persediaan |
| Diskon Pembelian & Retur Pembelian (kontra HPP) | **TIDAK ADA** | Kontra hanya ada di sisi penjualan (4010/4020) |
| Beban Penyusutan | **TIDAK ADA di seed** | 1510 Akumulasi Penyusutan berdiri tanpa pasangan beban; kunci `depreciation_expense` tidak terpetakan di demo (ditambah malas oleh fixed-assets) |
| Settlement e-wallet/EDC/marketplace | **TIDAK ADA** | Hanya 1110 QRIS Clearing |
| Laba Tahun Berjalan (system-reserved) | **TIDAK ADA** | Riset: akun ini seharusnya akun sistem, bukan postable bebas |
| Hutang bank jk. pendek/cerukan, hutang konsinyasi, deposit jaminan, kas dalam perjalanan, kliring/suspense | **TIDAK ADA** | Lihat peta rentang revisi riset §7.3 |

Yang sudah benar dan dipertahankan: PPN Masukan sebagai **aset** (1180), Kas Kecil terpisah (1010), Selisih Kas (8000/8001), QRIS Clearing (1110), kontra penjualan di blok pendapatan (4010/4020), pasangan akumulasi penyusutan menempel pada asetnya (1500/1510).

---

## 5. Sintesis riset web (ringkasan; laporan penuh di folder riset)

### 5.1 Model bank: tiga sistem, satu kesimpulan
- **ERPNext** — tiga record terpisah: Bank (institusi) ≠ Bank Account (identitas rekening nyata) ≠ Account (buku besar GL). Bank Account menghubungkan institusi + perusahaan + ledger bertipe Bank; satu Bank Account tidak boleh menampung beberapa rekening nyata.
- **Odoo** — satu formulir tambah bank **otomatis membuat** akun GL khusus + jurnal bank khusus; kas adalah pengecualian (jurnal/akun kas dibuat manual per laci/dana).
- **Xero** — alur "Add bank account" terpisah dari "Add Account"; hasilnya akun bertipe Bank yang dapat direkonsiliasi.
- **QuickBooks Online** — pengecualian: akun bagan bertipe Bank *adalah* banknya; koneksi feed adalah langkah kedua.
- **Accurate Online (Indonesia)** — akun bertipe Kas & Bank dengan kolom bank (Nama Bank, No. Rekening, Atas Nama) yang **hanya muncul kondisional** untuk tipe itu.

Kesimpulan untuk SME ERP: model yang memungkinkan impor mutasi, rekonsiliasi, mata uang per rekening, dan nomor rekening termasker adalah **record/rincian bank yang terikat 1-1 ke akun GL berkelas Bank**. Untuk Bisa ERP — yang tidak punya jurnal-per-bank ala Odoo dan tidak ingin tabel baru yang berat — padanan minimalnya: **kelas kas/bank/clearing sebagai kolom di `accounts` + rincian bank opsional di tabel yang sama**, ditambah wizard/formulir yang membuat akun GL berkelas bank dalam satu langkah (semangat Odoo/Accurate, tanpa objek jurnal baru).

Kegagalan "tambah bank" yang terdokumentasi di sistem-sistem itu selalu berbentuk **pesan validasi bernama** (perusahaan salah, akun grup, akun nonaktif, tipe ≠ Bank, mata uang salah, nomor rekening duplikat) — bukan kegagalan diam seperti F-02. Mata uang rekening dipilih saat pembuatan dan **tidak dapat diubah** sesudahnya.

### 5.2 Taksonomi tipe: tertutup, dimiliki sistem
Lima kelas akar di semua sistem (Asset/Liability/Equity/Income/Expense); subtipe adalah daftar tertutup (Odoo 19 tipe; ERPNext ±22; Xero ±15; Accurate: Kas & Bank, Piutang Usaha, Persediaan, Aset Tetap, Akumulasi Penyusutan, Utang Usaha, dst.). Subtipe menggerakkan perilaku (filter pemilih akun, rekonsiliasi, stok, pajak, tutup buku) — pengguna membuat **akun dari** tipe yang ada, tidak menciptakan tipe baru. Akun sistem (kontrol piutang/utang, laba tahun berjalan, ekuitas saldo awal) ditandai dan dilindungi di semua sistem. Ini memvalidasi enum 6 tipe + 10 section Bisa ERP sebagai *akar* yang sah; yang hilang adalah subtipe perilaku — dan untuk kebutuhan Bisa ERP, subtipe yang benar-benar menggerakkan perilaku adalah **kelas kas/bank/clearing** (F-01) dan penanda kontra, bukan 19 subtipe penuh.

### 5.3 Fleksibilitas bagan
- Header/grup **tidak pernah** menerima posting — ditegakkan di mesin posting dan di setiap pemilih akun (model ERPNext paling aman ditiru; Odoo menurunkan grup laporan dari awalan kode).
- Kode unik per perusahaan, panjang bebas (Xero ≤10 karakter); **tidak ada sistem yang mewajibkan 4/5/6 digit**. Konvensi blok digit-pertama + celah (gap) adalah praktik universal.
- Ganti nama/kode dengan riwayat: **diizinkan**, teraudit, berlaku untuk laporan baru; laporan periode tertutup tidak ditulis ulang (model Xero).
- Akun berriwayat **tidak pernah dihapus keras** di kelima sistem: deprecated/disable/archive. Nonaktif diblokir sampai saldo nol atau ada jurnal pemindah eksplisit, bawaan (default) ditunjuk ulang, dan sub-akun dipindahkan. (Perilaku QBO yang otomatis menjurnal saldo ke Opening Balance Equity saat nonaktif **tidak boleh ditiru**.)
- Detail cabang/departemen adalah pekerjaan **dimensi/subledger**, bukan akun GL duplikat (ERPNext Cost Center/Accounting Dimensions; satu akun Piutang Usaha kontrol × subledger pelanggan).

### 5.4 Penjaga pembuatan akun
Bidang minimum dengan tipe dipilih lebih dulu; kode/nama duplikat diblokir; pemilih akun di transaksi menyaring akun grup/nonaktif/perusahaan lain/tipe salah; aturan khusus per tipe (bank mewajibkan rincian bank; piutang/utang mewajibkan pihak pada baris jurnal); flag rekonsiliasi disengaja per akun; akun sistem terkunci dari hapus/arsip/ganti tipe; dan ERPNext menganjurkan alur "chart check" sesudah perubahan struktural (draf transaksi uji + tinjau laporan).

### 5.5 Templat: biji satu kali, bukan baju besi
Odoo memasang paket lokalisasi negara (Indonesia didukung, `l10n_id`) yang *identitas paketnya* terkunci sesudah posting pertama, tetapi akun di dalamnya bebas ditambah/diubah/dinonaktifkan. ERPNext membuat bagan dari templat standar/negara/salinan perusahaan lain; penimpaan templat utuh hanya boleh untuk perusahaan **tanpa transaksi**. Pola yang ditiru: templat = titik awal; yang dikunci hanya akun sistem yang diandalkan mesin.

### 5.6 Koreksi riset atas kerangka pengguna (penting)
1. **Tidak ada standar yang mengatur jumlah digit.** "Sesuai PSAK" datang dari *klasifikasi & pemetaan presentasi*, bukan dari penomoran. Skema 5 digit pengguna **sah sebagai konvensi** dan konsisten dengan praktik Indonesia (digit pertama 1–5 adalah baku ajar; pemisahan 5=HPP, 6=Beban Operasional, 7/8=lain-lain adalah varian yang tersebar luas) — tetapi jangan pernah dipasarkan sebagai "5 digit = PSAK".
2. **Anatomi digit perlu satu aturan formal**: `X0000` header kelas, `XX000` header sub-kelas, `XXX00` header grup, selain itu detail postable. Konsekuensinya 11100/11200/11300 menjadi **header** (Piutang Usaha detail pindah ke 11101, dst.). Hierarki disimpan eksplisit (`parentId` + `isPostable`), tidak pernah diturunkan dari pola kode.
3. **PPN Masukan adalah aset** (kerangka pengguna hanya memuat Hutang PPN) — Bisa ERP saat ini sudah benar (1180); templat baru menaruhnya di grup Pajak Dibayar Dimuka 11500.
4. **Blok bank 11010–11099 terlalu rakus** — persempit bank ke 11010–11059; **11060–11089 untuk Piutang Settlement** (QRIS/EDC/e-wallet/marketplace per provider — settlement adalah peristiwa kedua sesudah penjualan, dikredit neto MDR); 11090–11099 kas dalam perjalanan.
5. **Blok hutang pajak terlalu rapat** — 21010/21011/21012 berurutan melanggar prinsip gap pengguna sendiri; alokasikan 21010–21029 dengan langkah 2–3 (PPN Keluaran, PPh 21, PPh 23, PPh 4(2), PPh 29, pajak daerah).
6. **Kliring & suspense** perlu rumah sendiri (11900): suspense bank, transfer internal/setoran dalam perjalanan, kliring penerimaan — neraca, sementara, target nol.
7. **Selisih kas adalah akun laba rugi** (bukan aset): kekurangan = beban operasional, kelebihan = pendapatan operasional lainnya.
8. **Pajak penghasilan keluar dari 8XXXX** — blok baru **9XXXX**; 7XXXX/8XXXX dipecah menurut kategori PSAK 118 (71xxx operasional lainnya, 72xxx investasi; 81xxx operasional lainnya, 82xxx pendanaan). Bunga deposito/jasa giro = **investasi**; bunga pinjaman & bunga sewa = **pendanaan**; admin bank/MDR = **operasional**.
9. **Laba Tahun Berjalan = akun sistem** (dihitung tutup buku, tidak diposting bebas); Prive dan Dividen **dipisah** (bentuk badan berbeda).
10. **Konsinyasi**: barang titipan masuk (consignment-in) **di luar neraca** (memo saja) + Hutang Konsinyasi bila toko menjualkan; persediaan konsinyasi keluar (consignment-out) tetap persediaan sendiri di akun terpisah.

### 5.7 PSAK 118 — yang sebenarnya berubah
PSAK 118 (adopsi IFRS 18, disahkan DSAK IAI 28 Mei 2025, menggantikan PSAK 201) berlaku **1 Jan 2027**, retrospektif — tahun pembanding 2026 sudah harus dapat disajikan ulang. Setiap pos laba rugi wajib masuk satu dari **lima kategori**: operating, investing, financing, income taxes, discontinued operations; ada dua subtotal wajib baru (laba operasi; laba sebelum pendanaan & pajak penghasilan). Klasifikasi bersifat **berdasarkan sumber pos**, bukan nama akun: bunga atas kas/setara kas = investing; beban bunga pinjaman & bunga liabilitas sewa = financing; gagal bayar piutang dagang (ECL) = operating; selisih kurs mengikuti kategori transaksi asalnya. Panduan implementasi Indonesia secara eksplisit menganjurkan **"tagging akun di ERP: kategori + sifat beban"** dan checklist go-live "setiap akun laba rugi punya tag kategori PSAK 118 dan tag sifat beban". Kesimpulan desain: bagan memerlukan **kolom tag** (`psak118_category`, sifat beban, fungsi beban) pada akun laba rugi — penomoran saja tidak cukup, dan ember 7/8XXXX campur tidak bisa memetakan 1-1 ke kategori. Catatan cakupan yang jujur: entitas yang melaporkan di bawah **SAK EP / SAK EMKM tidak otomatis wajib** PSAK 118 — klaim produk yang benar adalah "pemetaan siap PSAK 118", bukan "patuh PSAK 118".

### 5.8 Kontra & arsitektur perpetual
- Diskon/retur penjualan = kontra-pendapatan **di dalam blok pendapatan**, tepat sesudah penjualan bruto (kerangka pengguna benar; Bisa ERP saat ini juga benar: 4010/4020).
- Diskon/retur pembelian = pengurang **di dalam perhitungan HPP** (rumus Pembelian Bersih), bukan pendapatan lain-lain (kerangka pengguna benar secara penempatan).
- **Peringatan model untuk Bisa ERP**: Bisa ERP memakai persediaan **perpetual** (moving average; pembelian mendebit Persediaan langsung, HPP lahir saat penjualan — lihat AGENTS.md proyek). Dalam arsitektur ini akun Diskon/Retur Pembelian **bukan** akun pembelian periodik: ia adalah **akun penyesuaian HPP** yang hanya dipakai (i) dokumen retur pembelian yang tidak bisa sekadar membalik penerimaan persediaan asal (selisih harga, retur sesudah tutup periode), dan (ii) diskon penyelesaian yang diterima sesudah barang terjual. Jalur normal retur pembelian tetap membalik persediaan pada biaya asal lewat Kredit Pemasok (seperti berjalan hari ini). Saldo 51002/51003 yang membesar terus adalah bau konfigurasi — kedua jalur tidak boleh berjalan bersamaan untuk transaksi yang sama.
- Kontra-aset menempel tepat sesudah induknya dalam blok yang sama (CKPN sesudah Piutang Usaha; Akumulasi Penyusutan sesudah asetnya), dan status kontra dibaca dari **data** (flag + tautan pasangan), bukan dari nama/akhiran kode.

---

## 6. Kesimpulan desain untuk Bisa ERP

1. **Kelas, bukan slot.** Tambahkan kelas kas/bank/clearing pada `accounts` + rincian bank opsional; keanggotaan himpunan kas/bank diturunkan dari kelas. Pemetaan `cash`/`bank`/`qris` **turun peran** menjadi penunjuk bawaan (kas utama, bank bawaan, penampung QRIS bawaan) — tetap dipakai di tempat yang memang butuh *satu* akun bawaan.
2. **Satu langkah tambah bank.** Formulir akun berkelas bank menampilkan rincian bank kondisional (pola Accurate) dan akun langsung berfungsi di semua permukaan (Kas & bank, transfer, dropdown metode, rekonsiliasi) tanpa merebut slot siapa pun.
3. **Penjaga simetris.** Nonaktif seketat hapus; pratinjau dampak sebelum mengubah akun yang terikat; hierarki ditegakkan saat tulis; koherensi type↔section divalidasi; kode dapat diedit dengan penjaga unik + audit (jurnal mereferensikan `accountId`, jadi renumber aman secara mekanis).
4. **Akun sistem terlihat.** Flag `is_system` diturunkan dari ikatan pemetaan/metode dan ditampilkan sebagai lencana kunci; perlindungan mengikuti ikatan, bukan nama.
5. **Templat 5 digit untuk perusahaan baru** mengikuti kerangka pengguna **dengan koreksi riset §5.6**, struktur header/detail diterapkan, akun hilang ditambahkan (tabel lengkap + mapping 42 lama → baru di `RENCANA.md` §4–§5).
6. **Perusahaan berjalan tidak di-renumber diam-diam.** Kode adalah data per perusahaan; migrasi adalah alat opt-in terencana dengan dry-run (RENCANA §6) — keputusan pemilik.
7. **Tagging PSAK 118 sekarang, laporan menyusul.** Kolom kategori + sifat/fungsi ditanam dan diisi bawaan dari section; penulis laporan belum diubah (RENCANA B5).
8. **Yang tidak disentuh**: mesin posting & penjaganya, angka bisnis, jurnal yang sudah terposting, pemetaan sebagai konsep penunjuk bawaan, dan enum tipe/section sebagai taksonomi tertutup.

Dokumen rencana: `docs/bagan-akun/RENCANA.md` (tahap B1–B8, tabel templat & mapping lengkap, strategi migrasi, keputusan pemilik).
