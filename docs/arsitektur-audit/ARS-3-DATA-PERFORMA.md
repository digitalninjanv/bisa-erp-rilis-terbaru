# ARS-3 — Lapisan Data, Performa & Skalabilitas

**Sifat:** audit BACA-SAJA. Tidak ada kode yang diubah; satu-satunya berkas yang ditulis adalah laporan ini.
**Tanggal:** 2026-11-05 · **Repo:** `~/workspace/projects/bisa-erp` (HEAD `235c767`)
**Baseline terverifikasi ulang hari ini:** 313 berkas `src` (.ts/.tsx), 91.044 LOC di `src`, 97 tabel di `src/db/schema.ts` (2.683 baris), 46 migrasi (0000–0045), PostgreSQL 18 + Drizzle + FORCE RLS.
**Bukti:** (a) hitungan statis grep/wc atas pohon saat ini; (b) benchmark terukur SIM-2 S4 (`docs/sim2/S4-BENCHMARK.md`, `scripts/sim2-gen/bench.ts` + hasil mentah JSON) pada dataset sintetis skala A (10 rb produk / 40 rb penjualan / 90 rb baris jurnal) dan B (100 rb produk / 400 rb penjualan / 1 jt baris jurnal / 5,13 jt stock movements) — angka S4 dikutip apa adanya dan dilabeli sebagai pengukuran S4, bukan pengukuran baru. DB dev lokal sedang tidak berjalan saat audit ini (port 5433 menolak koneksi), jadi tidak ada EXPLAIN baru; keputusan indeks S4 sendiri berbasis EXPLAIN (ANALYZE, BUFFERS) sebagai owner **dan** sebagai `app_user` di bawah RLS.

**Target misi yang dipakai sebagai penggaris:** tabel 100 rb+ baris lancar, halaman < 2 dtk, POS < 1 dtk.

---

## Ringkasan vonis

| Aspek | Skor | Vonis singkat |
|---|---:|---|
| 1. Pola kueri | 7/10 | Paginasi server adalah pola dominan; N+1 historis sudah dibereskan; sisa tanpa batas terkonsentrasi di AR/AP, ekspor, dan dropdown master. |
| 2. Indeks | 8/10 | Disiplin indeks tenant-komposit sangat baik dan berbasis bukti (termasuk keberanian mencabut indeks yang terbukti tak terpakai). Dua celah nyata: buku besar & agregasi baris penjualan. |
| 3. Transaksi & kunci | 8,5/10 | `withCompany` nyaris tanpa kecuali; FOR UPDATE luas dengan urutan kunci terdokumentasi; penomoran atomik. Risiko utama bukan deadlock, melainkan transaksi baca panjang menahan pool kecil. |
| 4. Laporan & agregasi | 6/10 | Agregasi SQL yang benar (bukan tarik-mentah), tetapi agregasi tahunan atas jurnal tetap 2–5 dtk di 1 jt baris — tidak ada tabel ringkasan/materialisasi. Ini aspek terlemah terhadap target misi. |
| 5. Skema & migrasi | 7,5/10 | Normalisasi dan tipe uang konsisten; jsonb terkendali dan bertipe; disiplin migrasi terverifikasi dari git. Nilai dikurangi oleh satu berkas skema 2.683 baris dan `company_id` tanpa FK. |
| 6. Klien & bundle | 5,5/10 | Pola server-component + paginasi server sehat, tetapi terminal POS satu komponen 2.985 baris/47 state adalah risiko render & pemeliharaan terbesar di frontend. |
| **Keseluruhan lapisan data & performa** | **7/10** | Fondasi data kelas profesional; utang performa terkonsentrasi dan teridentifikasi jelas di agregasi laporan skala besar — bukan menyebar. |

**Distribusi temuan: P0: 0 · P1: 2 · P2: 5 · P3: 5 (12 temuan).**

---

## 1. Pola kueri — 7/10

### Yang terbukti baik
- **Paginasi server adalah norma, bukan pengecualian.** Fungsi daftar di `src/server/catalog.ts` (`listMovements`, `listReceiptHistory`, `listPurchaseOrderHistory`, `listDocumentHistory`, `listProducts`) dan `src/server/reports.ts` (`listSales`, `listJournalEntries`, `getLedger`, `getStockCard`, `listExpenses`, `getInventoryValuation` mode berpaginasi) semuanya memakai pola yang sama: `count()` terpisah + `limit(pageSize ≤ 200).offset(...)` + urutan stabil (uuidv7 sebagai pemutus seri `created_at`). `grep '\.limit('` menemukan 364 kemunculan di `src/server` + actions.
- **N+1 historis sudah ditutup dengan bukti.** Kasus terburuk yang pernah ada (halaman Payroll: 2 kueri × karyawan berkasbon) diperbaiki di S4 menjadi satu kueri batch (`proposeAdvanceDeductionsBatch`) — terukur 238,7 → 16,5 ms (A) dan 210,7 → 18,8 ms (B), sidik jari hasil identik.
- **Pemindaian loop-await hari ini:** dari 18 kandidat loop berisi `await tx.*` di seluruh `src`, mayoritas adalah *tulis berurutan yang memang harus serial* dan terbatas ukurannya: baris dokumen (`inventory.ts:1732`, `pos.ts:1168` — sebesar isi keranjang/dokumen), FIFO kasbon/pinjaman atas daftar terbuka satu karyawan (`employee-advances.ts`, `employee-loans.ts` — puluhan baris), dan unggahan impor per 500 baris (`api/import/parse/route.ts:150`). Tidak ditemukan N+1 baca atas hasil kueri daftar di jalur halaman.
- **Hitungan memakai agregasi SQL**, bukan hitung manual di JS: `count()` dan `coalesce(sum(...))` konsisten di reports/catalog (lihat §4).

### Temuan

**ARS3-03 (P2) — Daftar piutang/utang tanpa batas, dipanggil dari 4 permukaan.**
`listReceivables` (`reports.ts:1949`) dan `listPayables` (`reports.ts:2018`) mengembalikan **seluruh** dokumen terbuka tanpa `limit`/paginasi, menggabungkan dua kueri + sortir di memori. Pemanggilnya: halaman piutang-utang, dashboard akuntansi (`src/app/app/akuntansi/page.tsx:49-50`), cetak aging, ekspor aging, dan modal Catat Transaksi (`actions/quick-entry.ts:118,152` — dua muatan penuh tambahan setiap modal dibuka). Terukur S4 skala B: 40.500 dokumen terbuka → 486–525 ms hanya untuk datanya, sebelum render. Ini requirement R-5 S4 / REM-07 S7 yang **masih terbuka di kode saat ini**.
*Terasa pada:* ±10–20 rb dokumen terbuka (≈ 2–4 tahun transaksi kredit minimarket ramai, atau lebih cepat di distributor).
*Rekomendasi:* paginasi server seperti daftar lain (pola sudah ada di berkas yang sama); dashboard dan quick-entry cukup memakai agregat total + sampel, bukan daftar penuh.

**ARS3-07 sebagian (P2, di §2 juga) — Pencarian teks `ilike '%…%'` adalah pola pencarian utama.**
`catalog.ts` memakai `ilike(%q%)` untuk produk, pelanggan, pemasok, nomor dokumen, dan pergerakan stok; pencarian jurnal memakai OR `ilike` atas nomor + deskripsi. Di bawah FORCE RLS pola ini **secara struktural tidak bisa diindeks** (dibuktikan S4: operator LIKE tidak leakproof sehingga planner menolak GIN trigram untuk `app_user`). Terukur: cari produk per kata 309,7 ms (B, sesudah optimasi b-tree nama), cari jurnal 845–961 ms (B). Bukan bug — batas arsitektur yang terdokumentasi — tetapi setiap layar pencarian baru yang meniru pola ini mewarisi biayanya.

**Tanpa batas yang dapat diterima (dicatat, bukan temuan):** `listAccounts`, `listCategories`, `listSuppliers`, `listWarehouses`, `listPaymentMethods` tanpa `limit` — semuanya tabel master per perusahaan yang secara realistis berhenti di ratusan baris. `listProductsForExport` (catalog.ts:203) tanpa batas adalah jalur ekspor yang disengaja; biayanya dinilai di ARS3-04.

---

## 2. Indeks — 8/10

### Yang terbukti baik
- **170 pernyataan `CREATE INDEX`/`UNIQUE INDEX`** di 46 migrasi; di `schema.ts` pola komposit tenant konsisten: hampir setiap indeks sekunder diawali `company_id`, lalu kolom filter/urutan yang nyata dipakai kueri — `(company_id, date)`, `(company_id, status)`, `(company_id, supplier_id, status)`, `(company_id, type, date)` untuk dokumen stok, `(company_id, product_id, created_at)` + `(company_id, warehouse_id, created_at)` + `(company_id, reference_type, reference_id)` + `(company_id, date)` untuk `stock_movements`, `(company_id, created_at)` + `(company_id, entity_type, entity_id)` untuk `audit_log`. Tabel besar yang paling sering difilter (sales, journal_entries, stock_movements, stock_receipts) semuanya punya indeks tanggal per tenant.
- **Disiplin berbasis bukti, bukan akumulasi.** Migrasi 0029 memasang 8 indeks dari EXPLAIN; migrasi 0030 **mencabut 4** setelah terbukti tidak pernah terpilih planner di bawah RLS (kasus trigram leakproof di atas), dengan alasan tertulis di komentar skema agar tidak dipasang ulang. Praktik ini langka dan benar: indeks yang tak terbaca tetap memajaki setiap insert.
- Indeks unik parsial dipakai tepat sasaran (sesi kas terbuka per pengguna, run payroll per periode non-void, klaim tautan rekonsiliasi), dan `document_sequences` memakai upsert atomik sehingga tidak perlu indeks tambahan untuk penomoran.

### Temuan

**ARS3-05 (P2) — Dua celah indeks pada pola agregasi baris.**
1. `journal_lines` hanya punya `entry_idx (entry_id)` dan `company_account_idx (company_id, account_id)` (schema.ts:460-461). Buku besar (`getLedger`) dan seluruh laporan menyaring `journal_lines` per (company, account) lalu **bergabung ke `journal_entries` untuk status + rentang tanggal** — tidak ada kolom tanggal di `journal_lines` dan tidak ada indeks `(company_id, account_id, entry_id)`, sehingga per akun planner membaca seluruh riwayat baris akun itu sepanjang masa lalu menyaring lewat join. Ini salah satu penyumbang kelas 1–5 dtk buku besar penuh di skala B (S4: 4.886–5.237 ms ekspor penuh).
2. `sale_lines` hanya punya `sale_idx (sale_id)`. Laporan per produk/kategori (`getTopProducts`, `getSalesByCategory`) bergabung dari `sale_lines` ke `sales` demi rentang tanggal lalu `groupBy product` — pada 1 jt baris penjualan, agregasi ini memindai seluruh baris dalam rentang tanpa jalur indeks per produk.
*Terasa pada:* >250 rb baris jurnal / >250 rb baris penjualan.
*Rekomendasi:* uji dengan EXPLAIN di bawah `app_user` (bukan owner — pelajaran S4) kandidat `(company_id, account_id, entry_id)` untuk journal_lines dan `(company_id, product_id, sale_id)` untuk sale_lines; pasang hanya yang terbukti terpilih.

**ARS3-10 (P3) — Indeks trigram warisan yang terbukti mati masih terpasang.**
`products_company_name_trgm_idx` (GIN) terverifikasi S4 tidak pernah terpilih di bawah RLS, tetapi tetap memajaki setiap insert/update produk. S7 mencatatnya sebagai keputusan "pertahankan" — laporan ini menilai ulang: biaya tulisnya kecil per baris tetapi murni kerugian; cabut pada migrasi berikutnya kecuali ada bukti baru. (Peringatan sebaliknya juga berlaku: jangan menambah trigram baru untuk pencarian jurnal/produk — lihat ARS3-07.)

**ARS3-11 sebagian (P3) — `stock_movements` untuk kartu stok per gudang.**
Kartu stok menyaring `(company, product, warehouse)` dan mengurutkan `created_at`; indeks yang ada mencakup `(company, product, created_at)` dan `(company, warehouse, created_at)` secara terpisah — cukup pada volume terukur S4 (5,6–6,5 ms di 5,1 jt baris). Saldo awal halaman dalam dihitung dari subkueri "jumlahkan semua baris sebelum offset" — O(offset) per halaman; produk sangat laris dengan >100 rb gerakan per gudang akan membuat halaman dalam melambat linear. Pantau, belum perlu tindakan.

---

## 3. Transaksi & kunci — 8,5/10

### Yang terbukti baik
- **Disiplin `withCompany` nyaris absolut:** 385 lokasi pemanggilan di `src/app` + `src/server/actions`; fungsi domain di `src/server/*.ts` hanya menerima `Tx` (impor dari `@/db` di berkas domain seluruhnya `import type { Tx }` — terverifikasi grep) sehingga secara struktural domain tidak bisa membuka koneksi sendiri di luar transaksi tenant. `withCompanyReadOnly` memakai transaksi read-only sungguhan untuk jalur baca/benchmark.
- **Setiap mutasi multi-tabel berjalan dalam satu transaksi tenant** — ini konsekuensi langsung pola di atas (checkout POS menulis penjualan + stok + jurnal + audit dalam satu `tx`; pola yang sama di penerimaan, retur, payroll).
- **FOR UPDATE luas dan berurutan konsisten:** ±60 lokasi `.for("update")` (pos.ts 11, serials.ts 9, inventory.ts 8, pos-offline.ts 4, …). Urutan kunci didokumentasikan di kode tempat risikonya nyata: `inventory.ts` mengunci on-hand → produk pada blend AVCO dengan komentar eksplisit "urutan kunci selalu sama di semua pemanggil, jadi tidak ada siklus kunci baru"; `pos.ts` mengurutkan kandidat seri (`[...new Set(ids)].sort()`, 3 lokasi) sebelum mengunci; `inventory.ts:2385` mengurutkan productId sebelum kunci massal opname. Ini persis pola anti-deadlock yang benar.
- **Penomoran dokumen bebas bottleneck tabel:** `sequences.ts` memakai `INSERT … ON CONFLICT DO UPDATE … RETURNING` atas baris (company, docType, tahun) — satu baris panas per jenis dokumen per tahun; pada volume minimarket (≤ beberapa dokumen/detik per jenis) ini bukan titik serempak yang berarti, dan terbukti tahan balapan oleh suite konkurensi proyek.
- **Append-only ditegakkan di basis data**, bukan hanya konvensi: trigger `forbid_mutation` pada `stock_movements`/`audit_log` dan trigger immutable + balance-check pada jurnal (migrasi 0001) — lapisan terakhir bila kode aplikasi keliru.

### Temuan

**ARS3-08 (P3) — Pool 12 koneksi vs transaksi baca panjang.**
`src/db/index.ts`: `max: 12, idle_timeout: 20`. Setiap permintaan halaman membuka satu transaksi `withCompany` dan — untuk halaman laporan/beranda — menahannya selama seluruh rangkaian agregasi berurutan (di skala B: 2–5 detik). Uji konkuren S4 (10 worker campuran, pool 12): skala B throughput 5,5 ops/dtk dengan p95 campuran 6,8 dtk, nol error — stabil, tetapi antrean terbentuk dari operasi berat, bukan dari koneksi yang bocor. Di produksi multi-kasir + akuntan membuka laporan bersamaan, pool 12 adalah angka pertama yang harus diukur ulang (PgBouncer atau naikkan `max` dengan batas `max_connections` PG yang jelas), bukan diganti membabi buta.
*Terasa pada:* >5 pengguna bersamaan membuka laporan berat, pada dataset >250 rb baris jurnal.

**Catatan desain (bukan temuan):** tidak ditemukan pola kunci advisory atau `SELECT … FOR UPDATE SKIP LOCKED` untuk antrean outbox; `outbox_pending_idx (processed_at, created_at)` menunjukkan pemrosesan berurutan sederhana — memadai untuk volume POS offline saat ini, perlu ditinjau bila sinkronisasi multi-perangkat menjadi beban nyata.

---

## 4. Laporan & agregasi — 6/10

### Yang terbukti baik
- **Laporan keuangan inti diagregasi di SQL, bukan ditarik mentah.** `getTrialBalance`, `getIncomeStatement`, `getBalanceSheet`, `getEquityStatement` (reports.ts:165–666) memakai `sum(case when date …)` + `groupBy accounts` — jumlah baris yang kembali ke Node adalah jumlah akun (± ratusan), berapa pun volume jurnalnya. Akumulasi uang di JS memakai Decimal (`AK-P3-04` konsisten), dan perbandingan tahun lalu adalah kueri agregat kedua, bukan muatan kedua.
- Penjualan harian/kasir/kategori/produk, rincian pembayaran, ringkasan jurnal, dan total valuasi semuanya `groupBy` + `sum` di SQL. Kartu stok dan buku besar berpaginasi dengan saldo awal halaman dari subkueri agregat — halaman dalam tidak memuat seluruh riwayat (pola yang benar dan tidak umum).
- `getInventoryValuation` berpaginasi server dengan total dari agregat atas seluruh set tersaring; opsi `skipLowStock` (S4) memangkas agregasi kedua yang hasilnya dibuang pemanggil ekspor (−18% waktu muat, keluaran identik byte-per-byte).

### Temuan

**ARS3-01 (P1) — Agregasi tahunan atas seluruh riwayat jurnal: 2–5 detik pada 1 jt baris, tanpa tabel ringkasan.**
Setiap permintaan laporan menjalankan agregasi penuh atas `journal_lines ⨝ journal_entries` untuk rentangnya; tidak ada tabel saldo bulanan per akun, tidak ada materialized view, tidak ada cache (`force-dynamic` di 81 halaman + nol `unstable_cache` di seluruh `src`). Terukur S4 (p50, sebelum→final serupa): neraca saldo 12 bulan 4.597→5.061 ms (B), neraca posisi 3.996→4.851 ms, laba rugi 2.031→2.326 ms, buku besar penuh 4.887→5.237 ms; ringkasan beranda 4.608→4.685 ms (B) — beranda adalah halaman yang dibuka setiap pengguna setiap hari. `getAccountingSummary` memperberatnya: sesudah `Promise.all` tiga laporan, ia menjalankan **lima** `mappedBalance` **berurutan** (bank, receivable, payable, inventory + cash di dalam Promise.all) — serialisasi yang tidak perlu pada jalur terpanas akuntansi.
*Terasa pada:* mulai ±200–250 rb baris jurnal (≈ 100 rb transaksi) laporan tahunan melewati 1 dtk; pada 1 jt baris kelasnya 2–5 dtk seperti terukur — melanggar target halaman < 2 dtk untuk laporan & beranda.
*Rekomendasi (berurutan):* (1) paralelkan kelima `mappedBalance` — perbaikan kecil, hasil identik; (2) pekerjaan domain yang sesungguhnya (R-4 S4, masih terbuka): tabel ringkasan saldo bulanan per (company, account, year-month) yang diperbarui dalam transaksi posting jurnal, dengan laporan membaca ringkasan + agregat bulan berjalan. Tanpa (2), tidak ada indeks yang menutup celah ini — S4 sudah membuktikannya.

**ARS3-02 (P1) — Arus kas menarik seluruh baris lawan ke memori dan mengatribusikan di JS.**
`getCashFlow` (reports.ts:408–564): sesudah agregat per entri kas, ia memuat **semua** baris jurnal lawan untuk **semua** entri kas dalam rentang (`inArray(journalLines.entryId, entryIds)` tanpa batas — entryIds sebesar jumlah jurnal berkas dalam rentang), membangun `Map` per entri, lalu membagi mutasi kas per entri secara proporsional dengan Decimal di JS. Algoritmanya benar secara akuntansi (atribusi per baris lawan, sisa pembulatan ke kelompok terbesar — ikatan opening+net=closing persis), tetapi kompleksitas memorinya O(total baris jurnal dalam rentang). Pada rentang setahun dengan 500 rb entri (skala B), ini adalah ratusan ribu baris di heap Node per permintaan laporan arus kas.
*Terasa pada:* rentang laporan berisi >50–100 rb entri jurnal berkas.
*Rekomendasi:* dorong agregasi per (entry, cash_flow_group) ke SQL (`groupBy entryId, resolve-group`) sehingga yang menyeberang ke JS adalah baris per entri×kelompok, bukan per baris jurnal; atribusi proporsional tetap di JS atas agregat itu.

**ARS3-04 (P2) — Ekspor CSV dibangun utuh di memori; tidak ada streaming di rute mana pun.**
`src/lib/csv.ts`: `toCsv` mengembalikan satu string; `csvResponse` membungkusnya. Terukur S4 pada ekspor valuasi 100 rb produk: heap +151–196 MB per permintaan (didominasi muatan baris item ±134 MB; CSV-nya sendiri hanya 8,5 MB), total jalur ±2,8–3,0 dtk. Dua ekspor bersamaan pada instance 512 MB–1 GB berisiko OOM. Berlaku sama untuk 8+ rute ekspor (`/api/export/*`).
*Terasa pada:* ekspor ≥50–100 rb baris, atau ekspor bersamaan pada instance kecil.
*Rekomendasi:* requirement R-2 S4 (masih terbuka): `ReadableStream` + paginasi keyset untuk rute ekspor besar; target heap datar < 50 MB pada 100 rb baris.

---

## 5. Skema & migrasi — 7,5/10

### Yang terbukti baik
- **Normalisasi sehat:** 97 tabel dengan dekomposisi domain yang wajar (header/baris dokumen terpisah konsisten: sales/sale_lines, stock_receipts/lines, journal_entries/lines, payroll_runs/items/item_lines, …), snapshot nama/SKU pada baris dokumen (keputusan sadar terdokumentasi — laporan historis tidak berubah saat master berganti nama), dan FK referensial nyata antar-tabel bisnis (ditambah remediasi 27 FK di S7). Tidak ditemukan denormalisasi liar selain snapshot yang disengaja itu.
- **Tipe uang konsisten:** 147 pemakaian `numeric` di schema.ts; seluruh kolom uang/qty bernilai bisnis memakai `numeric(19,4)` (termasuk debit/credit jurnal, harga, qty stok bertanda). Penyimpangan yang ada dapat dibenarkan satu per satu dan **bukan** kolom uang: tarif/persen `numeric(7,4)`, ambang persen `numeric(5,2)`, jam `numeric(6,2)`, hari `numeric(8,2)`. Perhitungan selalu Decimal.js dari string — tidak ada `float8`/`money` PG di skema.
- **jsonb terkendali:** 23 pemakaian, hampir semua bertipe `$type<…>()` dan memang data berbentuk dokumen: pengaturan perusahaan (`document_numbering`, `enabled_modules`, `custom_fields`), nilai custom-field per entitas (`attributes` pada produk/pelanggan/pemasok — pola EAV-terkendali yang menghindari 3 tabel nilai), payload outbox POS offline, payload/draf quick-entry, dan `before`/`after` audit. Tidak ditemukan jsonb yang menyimpan data relasional inti yang seharusnya kolom (tidak ada harga/stok/status di dalam jsonb).
- **Disiplin migrasi terverifikasi dari git:** 46 migrasi berurutan 0000–0045; `git log --diff-filter=M` atas migrasi lama hanya menunjukkan satu modifikasi — commit `1e2c002` (D-15: `CREATE EXTENSION pg_trgm` di kepala 0000, terdokumentasi sebagai pengecualian dengan verifikasi rantai penuh dari DB kosong). Pola lain yang sehat: snapshot drizzle lengkap per migrasi, dan migrasi korektif selalu berkas baru (0029 pasang indeks → 0030 cabut, bukan mengedit 0029).

### Temuan

**ARS3-12 (P3) — Satu berkas skema 2.683 baris untuk 97 tabel.**
`src/db/schema.ts` adalah berkas terbesar kedua di repo. Isinya tertata per domain dengan komentar yang baik, tetapi: konflik merge antar-fase hampir pasti menyentuh berkas yang sama (riwayat program menunjukkan fase memang harus diserialkan sebagian karena ini), navigasi dan review perubahan skema berat, dan snapshot drizzle tetap mengharuskan satu modul skema utuh. *Rekomendasi:* pecah menjadi modul per domain (`schema/akuntansi.ts`, `schema/gudang.ts`, …) yang digabung satu `index.ts` — Drizzle mendukungnya tanpa mengubah satu pun nama tabel; lakukan sebagai satu migrasi-nol (tanpa perubahan SQL) pada jendela tenang.

**ARS3-09 sebagian (P3, berbagi dengan §2) — `company_id` berupa `text` tanpa FK di 89 tabel.**
Seluruh tabel bisnis menyatakan `companyId: text` tanpa `.references(() => organization.id)`. Isolasi tenant ditegakkan oleh RLS + `app_company_id()` (terbukti menahan probe lintas-tenant), jadi ini bukan lubang keamanan; tetapi integritas referensial kolom terpenting di basis data bergantung penuh pada lapisan aplikasi/RLS — baris yatim bertenant tidak akan pernah ditolak FK. Dicatat sebagai keputusan desain yang harus sadar, bukan kebetulan: bila suatu saat ada jalur tulis di luar `withCompany`, tidak ada jaring pengaman kedua.

**ARS3-09 (P3) — Tidak ada strategi pertumbuhan untuk tabel append-only.**
Tidak ada partisi, arsip, atau retensi di seluruh skema/migrasi (`grep partition` = 0). `stock_movements` (5,13 jt baris pada dataset B satu tahun), `journal_lines`, dan `audit_log` (dengan dua kolom jsonb per baris) hanya tumbuh. Dampak terukur tidak langsung: berkas DB dev tetap 3,1 GB sesudah dataset benchmark dihapus (tuple mati; REM-14 S7 — `VACUUM FULL` belum pernah dijalankan). Pada laju skala B, satu perusahaan menambah ±6 jt baris append-only per tahun.
*Terasa pada:* tahun ke-2–3 pemakaian ramai, atau lebih awal pada biaya backup/restore & vacuum.
*Rekomendasi:* belum perlu partisi sekarang; yang perlu adalah kebijakan tertulis (retensi audit, jendela arsip movements/jurnal per tahun fiskal terkunci, jadwal vacuum/analyze) **sebelum** tabel melewati ±10 jt baris, karena mempartisi tabel sebesar itu belakangan jauh lebih mahal.

---

## 6. Klien & bundle — 5,5/10

### Yang terbukti baik
- Arsitektur halaman adalah server-component secara bawaan: 90 berkas `"use client"` dari 313 berkas `src`, dan daftar-daftar besar dirender server dengan paginasi server (§1) — HTML awal tidak mengangkut dataset.
- Invalidasi cache konsisten dan halus: 253 pemanggilan `revalidatePath` di server actions — setiap mutasi membatalkan tepat halaman terkait; untuk ERP transaksional ini pilihan yang benar dibanding cache agresif.
- `export const dynamic = "force-dynamic"` pada 81 halaman sesuai aturan proyek (data ERP selalu segar); tidak ada `fetch` klien yang dapat di-cache-kan secara keliru.

### Temuan

**ARS3-06 (P2) — Terminal POS adalah satu komponen klien 2.985 baris / ±130 KB sumber / 47 `useState`.**
`src/components/pos/pos-terminal.tsx` memegang seluruh state kasir dalam satu komponen: keranjang, pencarian + cache produk, quote, pembayaran tunggal/campuran, tahanan & resume, kredit retur, pelanggan utang, status offline + antrean sinkronisasi, preferensi tampilan. Hanya sebagian sub-pohon yang sudah dipecah (`pos-display.tsx` 300 baris, panel-panel kecil). Konsekuensi terukur secara tidak langsung: setiap keystroke pencarian dan setiap perubahan keranjang me-render ulang pohon sebesar ini; dan S4 mengukur pencarian POS solo pada 100 rb produk masih 178–186 ms (sisi server didominasi `ilike`, ARS3-07) sehingga anggaran < 1 dtk untuk alur cari→tambah→quote bergantung pada render klien tetap ringan — yang tidak dijamin oleh struktur saat ini. Risiko pemeliharaannya lebih besar daripada risiko mentahnya: satu berkas ini menyentuh 6 subsistem, dan riwayat perbaikan POS (4 tahap FIX-POS) berulang kali mengeditnya.
*Rekomendasi:* pecah per subsistem yang sudah jelas batasnya (keranjang+quote, pembayaran, offline/sync, pelanggan-utang) menjadi komponen dengan state lokal + satu store keranjang tipis; tanpa mengubah perilaku. Ukur dengan bundle analyzer sesudahnya — saat ini tidak ada pengukuran ukuran JS per rute di repo, jadi klaim "bundle besar" tidak dibuat di sini; yang terukur adalah ukuran sumber dan jumlah state.

**P3 (tanpa nomor sendiri, bagian ARS3-06) — Komponen raksasa kedua:** `settings-forms.tsx` 1.795 baris dan `hr-panel.tsx` 1.224 baris mengikuti pola yang sama (banyak formulir independen dalam satu berkas klien). Dampaknya lebih kecil (halaman pengaturan jarang dibuka, bukan jalur per detik seperti POS), cukup dicatat sebagai arah pemecahan yang sama.

**Catatan target:** tidak ada pemakaian `unstable_cache`/tag cache sama sekali. Untuk data referensi yang jarang berubah (bagan akun, daftar metode bayar, pengaturan perusahaan) ini berarti setiap navigasi membayar kueri yang sama; tetapi mengingat ARS3-01/08, menambah cache sebelum memperbaiki agregasi hanya akan menutupi gejala. Urutan yang benar: ringkasan bulanan dulu, cache referensi sesudahnya bila masih perlu.

---

## Skor akhir & prioritas

**Skor lapisan data & performa: 7/10.** Justifikasi: fondasinya — RLS paksa yang konsisten, transaksi tenant struktural, kunci berurutan, indeks tenant-komposit berbasis EXPLAIN, agregasi SQL + Decimal, disiplin migrasi — adalah praktik profesional yang terverifikasi bukti, bukan klaim. Yang menahan skor adalah satu kelas masalah yang sama muncul di tiga tempat (agregasi atas riwayat jurnal penuh tanpa ringkasan berkala: ARS3-01, ARS3-02, dan separuh ARS3-05/08) ditambah dua utang yang sudah lama teridentifikasi tetapi belum ditutup (ARS3-03 pagination AR/AP, ARS3-04 streaming ekspor). Semuanya terkonsentrasi, terukur, dan punya jalur perbaikan yang sudah ditulis sejak S4 — tidak ada P0 dan tidak ada risiko integritas data di daftar ini; risikonya murni latensi & memori pada volume yang dapat diperkirakan kapan tiba.

**Tiga teratas (urut tindakan):**
1. **ARS3-01 (P1)** — Tabel ringkasan saldo bulanan per akun + paralelkan `mappedBalance` di `getAccountingSummary`. Menutup pelanggaran target < 2 dtk pada beranda & laporan tahunan pada volume ≥ 250 rb baris jurnal.
2. **ARS3-02 (P1)** — Agregasikan baris lawan arus kas di SQL per (entri × kelompok) sebelum atribusi JS. Menurunkan memori arus kas tahunan dari O(total baris) menjadi O(entri × kelompok).
3. **ARS3-03 + ARS3-04 (P2)** — Paginasi server AR/AP dan streaming ekspor CSV: dua requirement S4 terakhir yang masih terbuka di kode, keduanya perbaikan mekanis berpola yang sudah ada di repo.
