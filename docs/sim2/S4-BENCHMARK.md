# S4 — Data Besar & Benchmark Performa (SIM-2 Fase S4, mandat §10)

**Sifat:** semua angka di laporan ini adalah hasil pengukuran nyata yang dijalankan pada DB dev
(PostgreSQL 18.6, port 5433) selama fase ini. Tidak ada angka karangan: setiap tabel merujuk ke
berkas hasil mentah `scripts/sim2-gen/results/*.json` yang menyimpan durasi per larian.
**Tanggal:** 2026-11-04 · **Suite akhir:** 693/693 test (76 berkas) · build ✓ · typecheck ✓ · lint ✓ (0 masalah).

---

## 1. Dataset ukur

Dibangun oleh `scripts/sim2-gen/generate.ts` sebagai perusahaan benchmark khusus (satu `company_id`
per skala), dihapus bersih di akhir fase oleh `scripts/sim2-gen/cleanup.ts`
(A: 481.745 baris terhapus; B: 8.683.309 baris; sisa baris benchmark terverifikasi 0 dan
perusahaan demo utuh).

**Cara data dimasukkan — jujur:** master (COA, pemetaan, pihak, produk, karyawan) mengikuti pola
seed demo; data volume historis (penjualan, baris penjualan, jurnal, pergerakan stok) dimasukkan
dengan SQL `generate_series` langsung, **bukan lewat domain**, karena tujuannya volume ukur.
Kebenaran perilaku domain pada volume normal sudah dibuktikan S1. Data sintetis tetap menjaga
invariant yang diperiksa: seluruh jurnal seimbang (0 entri tak seimbang dari 545.000), nol stok
negatif, `stock_on_hand` = agregat `stock_movements`, pola penjualan miring realistis
(80% baris ke 200 produk terlaris). Acakan memakai `setseed(0.4242)` agar dapat direproduksi.
Kejadian dicatat apa adanya: generasi skala B berjalan ±13 menit; seluruh insert data committed,
tetapi langkah statistik penutup skrip gagal karena koneksi terputus (`Connection closed`) —
statistik (ANALYZE + verifikasi hitung) dijalankan ulang manual dan dataset terverifikasi lengkap.

| Isi per perusahaan | Skala A | Skala B |
|---|---:|---:|
| Produk | 10.000 | 100.000 |
| Penjualan (12 bulan) | 40.000 | 400.000 |
| Baris penjualan | 100.208 | 1.000.597 |
| Stock movements | 133.541 | 5.133.930 |
| Entri jurnal / baris jurnal | 45.000 / 90.000 | 500.000 / 1.000.000 |
| Karyawan / item payroll (12 bln) | 300 / 3.600 | 300 / 3.600 |
| Kasbon berjalan | 240 | 240 |
| Beban | 5.000 | 20.000 |
| Penerimaan utang / saldo awal pihak | 2.000 / 300 | 8.000 / 1.000 |
| Pelanggan / pemasok | 500 / 50 | 2.000 / 200 |
| Gerakan produk terlaris | 459 | 4.217 |

Ukuran basis data: 47 MB (awal) → ±250 MB (sesudah A) → 3.146 MB (sesudah A+B).
Waktu bangkit data: A 20,4 detik; B ±13 menit (didominasi insert 4 juta gerakan pembelian
dan agregasi `stock_on_hand` atas 5,1 juta baris).

## 2. Metode pengukuran

- `scripts/sim2-gen/bench.ts` memanggil **fungsi domain yang sesungguhnya** (fungsi yang sama
  dengan yang dipakai halaman/rute: `listProducts`, `searchProducts`, `getInventoryValuation`,
  `getTrialBalance`, `getIncomeStatement`, `getBalanceSheet`, `getLedger`, `listReceivables`,
  `listPayables`, `getStockCard`, `listJournalEntries`, `listSales`, `listExpenses`,
  `getHomeSummary`, dan replikasi pemuatan data halaman Payroll) lewat `withCompanyReadOnly`
  — yaitu koneksi aplikasi `app_user` + RLS, persis jalur runtime.
- Per operasi: 2 larian pemanasan (tidak dicatat) lalu 9 larian terukur (7 untuk larian "final");
  p50/p95/p99 dihitung nearest-rank dari durasi mentah yang tersimpan di JSON hasil.
- Setiap operasi juga menghasilkan **sidik jari hasil** (total, saldo, atau hash isi) untuk
  membuktikan angka laporan tidak berubah oleh optimasi — lihat §5.
- Halaman Payroll diukur sebagai replikasi persis kode pemuatan datanya. Mode `loop` memutar
  ulang jalur lama (2 query per karyawan berkasbon — fungsi per-karyawan dipertahankan apa
  adanya); mode `batch` memutar jalur baru halaman sesudah PERF-01.
- EXPLAIN (ANALYZE, BUFFERS) dipakai untuk keputusan indeks — dijalankan sebagai owner **dan**
  sebagai `app_user` di bawah RLS; perbedaan keduanya ternyata menentukan (lihat §4.2).

## 3. Hasil SEBELUM optimasi (p50 / p95, ms)

| Operasi | A p50 | A p95 | B p50 | B p95 |
|---|---:|---:|---:|---:|
| Daftar produk hal. 1 | 18,0 | 19,2 | 134,6 | 142,7 |
| Cari produk (kata) | 51,8 | 70,4 | 446,1 | 520,7 |
| Daftar produk hal. dalam (200) | 51,5 | 62,2 | 185,2 | 235,4 |
| POS cari kosong (kisi 24) | 9,4 | 9,8 | 75,6 | 89,5 |
| POS cari kata | 19,2 | 20,6 | 186,1 | 194,6 |
| POS cari barcode | 20,2 | 21,5 | 186,5 | 200,6 |
| Valuasi persediaan (halaman) | 85,9 | 136,3 | 809,2 | 917,9 |
| Valuasi penuh + bangun CSV (ekspor) | 310,0 | 386,9 | 2.566,9 | 2.824,3 |
| Neraca saldo 12 bulan | 191,5 | 214,8 | 4.597,3 | 5.107,7 |
| Laba rugi 12 bulan (+pembanding) | 152,6 | 219,3 | 2.030,8 | 3.155,9 |
| Neraca posisi akhir tahun | 403,8 | 528,7 | 3.995,6 | 4.153,4 |
| Buku besar Kas hal. 1 | 86,7 | 135,2 | 1.082,7 | 1.164,6 |
| Buku besar Kas penuh (ekspor) | 354,8 | 431,2 | 4.886,5 | 5.218,5 |
| Piutang (daftar aging penuh) | 48,5 | 64,9 | 525,2 | 588,8 |
| Utang (daftar aging penuh) | 24,6 | 43,4 | 82,6 | 131,6 |
| Kartu stok hal. 1 | 4,0 | 5,1 | 5,9 | 6,8 |
| Kartu stok hal. dalam (5) | 4,5 | 6,6 | 5,6 | 11,1 |
| Daftar jurnal | 14,3 | 16,7 | 52,2 | 88,4 |
| Pencarian jurnal "gaji" | 80,9 | 90,4 | 839,6 | 875,3 |
| Pencarian jurnal "penjualan" | 186,2 | 246,9 | 903,6 | 967,4 |
| Daftar penjualan | 63,4 | 110,9 | 354,2 | 428,7 |
| Daftar beban bulanan | 8,8 | 11,5 | 26,6 | 36,6 |
| Ringkasan beranda | 214,4 | 280,7 | 4.607,8 | 5.946,1 |
| Data halaman Payroll (loop N+1) | 238,7 | 466,7 | 210,7 | 300,4 |

Error: **0** pada semua operasi dan semua larian.

Pembacaan singkat: kartu stok sangat sehat (indeks `(company, product, created_at)` bekerja);
yang berat di skala B adalah agregasi laporan tahunan (1 juta baris jurnal), valuasi
(agregasi atas 100 ribu produk), ringkasan beranda, pencarian teks jurnal, dan daftar yang
mengurutkan tanpa indeks pendukung (penjualan per `created_at`, produk per nama).

## 4. Optimasi yang diterapkan

### 4.1 PERF-01 — N+1 halaman Payroll: SELESAI, terbukti 11–14×

- Inti hitung usulan kasbon diekstrak utuh menjadi `computeAdvanceProposal(open, person)`
  (murni, tanpa query); `proposeAdvanceDeductions` lama kini membungkusnya — perilaku
  per-karyawan tidak berubah satu angka pun.
- `proposeAdvanceDeductionsBatch(tx, companyId, staff)`: **satu query** untuk semua kasbon
  berjalan perusahaan, dikelompokkan per karyawan di memori dengan urutan FIFO yang sama
  (`employeeId, date, createdAt`), dihitung oleh fungsi inti yang sama.
- Halaman payroll memakai jalur batch; satu-satunya pemanggil lain
  (`runPayrollAction`, transaksi tulis per karyawan) tetap memakai jalur per-karyawan.
- Test baru `tests/sim2/payroll-batch-proposals.test.ts`: batch vs jalur lama dibandingkan
  persis (total, sisa terbuka, dan alokasi FIFO per kasbon) atas 6 pola karyawan — rencana
  fixed/percent/full, plafon gaji bersih, karyawan nonaktif, kasbon lunas, tanpa kasbon —
  plus nilai tangan dari skenario dan isolasi antar-perusahaan.
- Hasil: **A 238,7 → 16,5 ms; B 210,7 → 18,8 ms** (p50), sidik jari usulan identik.

### 4.2 PERF-03 — Indeks: 4 dipertahankan, 4 DIBATALKAN dengan bukti

Migrasi **0029** memasang 8 indeks; migrasi **0030** mencabut 4 di antaranya setelah terbukti
tidak berguna. Keadaan akhir yang dipertahankan (semua terbukti terpilih planner / terukur):

| Indeks | Bukti | Dampak terukur |
|---|---|---|
| `sales_company_created_idx` (company_id, created_at desc) | EXPLAIN sebelum: Seq Scan 40 rb + sort 23,6 ms | Daftar penjualan A 63,4→6,9 ms; B 354,2→38,9 ms |
| `products_company_name_idx` (company_id, name) | Daftar & kisi POS mengurutkan nama; GIN trigram tidak melayani ORDER BY | Daftar produk B 134,6→15,1 ms; POS cari kosong B 75,6→2,7 ms; halaman dalam B 185,2→53,9 ms |
| `expenses_company_date_idx` (company_id, date) | `listExpenses` selalu saring perusahaan+rentang tanggal; sebelumnya 0 indeks sekunder | Daftar beban B 26,6→14,3 ms |
| `payroll_items_company_employee_idx` (company_id, employee_id) | Baca halaman payroll per perusahaan sebelumnya seq scan | Ikut menghilangkan seq scan pada tabel yang tumbuh per run × karyawan |

**Yang dibatalkan (migrasi 0030) — temuan penting fase ini:** indeks trigram GIN untuk
`journal_entries.number`, `journal_entries.description`, `products.sku`, `products.barcode`
**tidak pernah terpilih oleh planner untuk peran aplikasi**. Rantai buktinya:

1. Sebagai owner (superuser, RLS ter-bypass), count pencarian "gaji" memakai bitmap trigram:
   137,9 ms pada 500 rb entri.
2. Sebagai `app_user` di bawah FORCE RLS — jalur runtime yang sebenarnya — query yang sama
   adalah Seq Scan 853 ms; dengan `enable_seqscan=off` planner tetap menolak trigram dan
   memilih awalan b-tree `(company_id, …)` (531–1.104 ms).
3. Penyebab: operator LIKE/ILIKE **tidak leakproof** (`pg_proc.proleakproof = false` untuk
   `textlike`/`namelike`). Di bawah RLS, planner tidak boleh mengevaluasi kual non-leakproof
   sebagai index qual sebelum kual keamanan, sehingga GIN trigram gugur sebagai kandidat.
4. Konsekuensi dicatat di komentar skema agar tidak dipasang ulang. Biaya yang dihindari:
   pajak tulis + ruang untuk 4 indeks yang tidak akan pernah terbaca jalur aplikasi.
5. **Implikasi ke belakang:** indeks lama `products_company_name_trgm_idx` (sudah ada sebelum
   S4) memiliki sifat yang sama — terverifikasi tidak terpilih untuk pencarian nama sebagai
   `app_user` (planner memilih b-tree `(company_id, is_active)`). Pencabutannya adalah
   keputusan pemilik/S7 (di luar lingkup S4); pencarian produk tetap membaik lewat b-tree
   `(company_id, name)`: cari kata B 446,1 → 309,7 ms.

Pencarian jurnal sendiri **tidak membaik** (A 80,9→81,8 ms; B 839,6→845,4 ms): botol lehernya
adalah `count(*)` atas OR dua kolom teks (±853 ms SQL dari total ±900 ms di skala B),
sementara baris halamannya sendiri hanya ±15 ms lewat indeks tanggal. Tidak ada perbaikan
indeks yang aman ditemukan di S4 — lihat requirement R-3 di §7.

### 4.3 PERF-02 — Ekspor CSV: diukur penuh, satu perbaikan aman diterapkan, streaming menjadi requirement

Pengukuran memori jalur ekspor valuasi persis seperti rute `/api/export/inventory`
(proses tersendiri, `scripts/sim2-gen/export-memory.ts`, `--expose-gc`):

| Tahap (skala B, 100 rb produk) | Waktu | Memori |
|---|---:|---:|
| Muat valuasi penuh (tanpa pagination) | 2,2–2,6 dtk | heap +134 MB (baris item) |
| Petakan baris CSV | ±0,4 dtk | — |
| `toCsv` satu string | ±0,1 dtk | CSV 8,5 MB (8.895.950 byte); heap total +151–196 MB; RSS +238–252 MB |
| **Total jalur** | **±2,8–3,0 dtk** | — |

Di skala A jalur yang sama: total 404 ms, heap +18 MB — tidak berisiko.
Kesimpulan jujur: pada 100 rb produk ekspor **bekerja**, tetapi menahan ±200 MB heap per
permintaan; dua ekspor bersamaan di instance 512 MB–1 GB berisiko OOM. Biaya didominasi
**memuat seluruh baris item** (±134 MB), bukan pembangunan string (CSV-nya sendiri hanya
8,5 MB). Mengubah 7 rute ekspor menjadi streaming ber-kursor adalah perubahan lintas
potong yang tidak aman dilakukan tanpa pengujian rute per rute — sesuai mandat langkah ini,
streaming ditulis sebagai requirement R-2 (§7) lengkap dengan angka ukurnya.

Satu perbaikan aman yang **sudah diterapkan**: `getInventoryValuation` sebelumnya selalu
menjalankan agregasi penuh kedua untuk daftar stok menipis (`lowRows` tanpa batas) — hasil
yang **dibuang** oleh rute ekspor. Kini ada opsi `skipLowStock` (bawaan: tetap menghitung;
halaman nilai persediaan & dashboard gudang tidak berubah) dan rute ekspor memakainya.
Hasil pada skala B: waktu muat 2.228 → 1.826 ms (−18%) dan **CSV identik byte-per-byte**
(hash SHA-256 sama pada kedua varian).

## 5. Hasil SESUDAH (keadaan final: kode + indeks final) & invariansi angka

| Operasi | A sebelum | A final | B sebelum | B final | Sidik jari |
|---|---:|---:|---:|---:|---|
| Daftar produk hal. 1 | 18,0 | **6,1** | 134,6 | **15,1** | sama |
| Cari produk (kata) | 51,8 | **34,6** | 446,1 | **309,7** | sama |
| Daftar produk hal. dalam | 51,5 | 36,3 | 185,2 | **53,9** | sama |
| POS cari kosong | 9,4 | **2,6** | 75,6 | **2,7** | sama |
| POS cari kata | 19,2 | 19,1 | 186,1 | 177,8 | sama |
| POS cari barcode | 20,2 | 19,5 | 186,5 | 185,3 | sama |
| Valuasi (halaman) | 85,9 | 81,1 | 809,2 | 821,6 | sama |
| Valuasi penuh + CSV | 310,0 | 250,7 | 2.566,9 | 2.724,2 | sama persis (hash CSV) |
| Neraca saldo 12 bln | 191,5 | 404,5 † | 4.597,3 | 5.061,3 † | sama (Dr=Cr) |
| Laba rugi 12 bln | 152,6 | 155,2 | 2.030,8 | 2.325,7 † | sama (hash isi) |
| Neraca posisi | 403,8 | 365,1 | 3.995,6 | 4.850,7 † | sama (hash isi) |
| Buku besar Kas hal. 1 | 86,7 | 128,3 † | 1.082,7 | 1.110,1 | sama |
| Buku besar Kas penuh | 354,8 | 366,8 | 4.886,5 | 5.237,0 † | sama |
| Piutang | 48,5 | 53,8 | 525,2 | 486,2 | sama |
| Utang | 24,6 | 21,6 | 82,6 | 74,5 | sama ‡ |
| Kartu stok hal. 1 / dalam | 4,0 / 4,5 | 3,8 / 5,8 | 5,9 / 5,6 | 5,6 / 6,5 | sama |
| Daftar jurnal | 14,3 | **7,7** | 52,2 | 54,5 | sama |
| Cari jurnal "gaji" | 80,9 | 81,8 | 839,6 | 845,4 | sama |
| Cari jurnal "penjualan" | 186,2 | 172,3 | 903,6 | 961,5 | sama |
| Daftar penjualan | 63,4 | **6,9** | 354,2 | **38,9** | sama |
| Daftar beban | 8,8 | **5,8** | 26,6 | **14,3** | sama |
| Ringkasan beranda | 214,4 | 234,9 | 4.607,8 | 4.684,5 | sama (hash isi) |
| Data halaman Payroll | 238,7 | **16,5** | 210,7 | **18,8** | sama (hash usulan) |

**Invariansi:** seluruh 48 pasang sidik jari (24 operasi × 2 skala) **identik** sebelum vs
final — total valuasi, total debit=kredit neraca saldo (A: Rp112.354.580.000;
B: Rp1.249.675.960.000), hash laba rugi/neraca/beranda, saldo buku besar, jumlah dokumen
piutang/utang, hash usulan kasbon, dan hash CSV ekspor. Optimasi tidak mengubah satu pun
angka laporan.

† **Kejujuran variansi:** agregasi laporan tahunan (neraca saldo, neraca posisi, buku besar)
tidak menyentuh satu pun objek yang diubah fase ini, dan rencananya terverifikasi tetap
bitmap index scan (agregasi inti neraca saldo A: 260 ms SQL). Angka finalnya terukur
10–20% lebih lambat dari sesi "sebelum" di skala B dan ±2× di skala A untuk neraca saldo.
Penjelasan terukur, bukan alasan: sesi "sebelum-A" berjalan saat DB hanya berisi perusahaan
A (47→250 MB); sesi sesudah berjalan dengan dataset B (3,1 GB) sudah termuat — indeks yang
sama kini menaungi 1,1 juta baris jurnal gabungan dan cache buffer berbagi. Sampel berulang
buku besar Kas B di tiga sesi berbeda: 1.083 / 2.148 / 1.110 ms — variansi antar-sesi di
sandbox bersama memang sebesar itu. Kesimpulan yang didukung bukti: agregasi tahunan penuh
atas 1 juta baris jurnal memang berada di kelas 2–5 detik pada mesin ini; bukan regresi
dari perubahan S4 (sidik jari & rencana query sama), dan bukan sesuatu yang bisa diperbaiki
indeks — lihat R-4.

‡ **Koreksi sidik jari utang:** formula sidik jari awal di skrip bench keliru membaca kolom
(`paidTotal` padahal baris dokumen memakai `paidAmount`) sehingga "saldo" yang tercatat di
larian before/final adalah total dokumen, bukan sisa utang. Rumus diperbaiki memakai kolom
kanonis `outstanding`; nilai domain terverifikasi ulang terhadap hitungan SQL independen
dan **cocok persis** — A: Rp9.055.136.665 (penerimaan 8.719.270.000 + saldo awal 335.866.665);
B: Rp36.011.276.672 (34.810.610.000 + 1.200.666.672). Kesetaraan sebelum/sesudah tetap sah
karena kedua sisi memakai rumus yang sama secara deterministik; yang salah hanya label
angkanya di JSON mentah before/final, dan angka benarnya adalah yang tertulis di sini.

## 6. Uji beban ringan bersamaan (Langkah 4)

10 worker paralel, campuran 4 operasi baca (daftar produk, pencarian POS, valuasi halaman,
kartu stok), jendela 30 detik, pool aplikasi bawaan (maks 12 koneksi):

| Skala | Selesai | Error | Throughput | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|---:|
| A | 1.416 operasi / 30,2 dtk | **0** | 47,0 ops/dtk | 99 ms | 703 ms | 891 ms |
| B | 173 operasi / 31,7 dtk | **0** | 5,5 ops/dtk | 903 ms | 6.793 ms | 8.087 ms |

Nol error di kedua skala. Di skala B throughput ditahan oleh operasi valuasi halaman
(±800 ms solo, 3 agregasi atas 100 rb produk) yang mengantre di belakang 10 worker —
p95 campuran ini **bukan** gambaran lalu lintas POS murni (pencarian POS solo di B ±180 ms).
Ini uji stabilitas ringan satu node sandbox, bukan klaim kapasitas produksi.

## 7. Requirement lanjutan (belum dikerjakan, dengan dasar angka)

- **R-1 Beranda lambat di skala besar.** `getHomeSummary` B = 4,6–4,7 dtk — operasi
  halaman terberat yang terukur. Profil per-query dan pertimbangan agregasi harian
  materialized adalah pekerjaan S7; tidak ada kandidat indeks yang terbukti di S4.
- **R-2 Streaming ekspor.** Pada ≥100 rb baris, ekspor valuasi menahan ±200 MB heap
  (±134 MB hanya untuk baris item) dan 2,8–3,0 dtk. Ubah rute ekspor besar ke
  ReadableStream + pagination keyset; target: heap datar (<50 MB) pada 100 rb baris.
  `skipLowStock` (sudah diterapkan) hanya memangkas ±18% waktu muat, bukan memori item.
- **R-3 Pencarian teks jurnal.** Count atas OR `ilike` dua kolom = ±853 ms pada 500 rb
  entri di bawah RLS; trigram terbukti tidak dapat dipakai (leakproof). Opsi yang perlu
  keputusan: batasi pencarian ke awalan nomor (btree-able), terima biaya ini terdokumentasi,
  atau evaluasi kolom pencarian khusus — jangan memasang trigram lagi tanpa bukti baru.
- **R-4 Agregasi laporan tahunan.** Neraca saldo/posisi/buku besar penuh berada di kelas
  2–5 dtk pada 1 juta baris jurnal (benar, tetapi lambat). Bila target produksi menuntut
  <1 dtk: tabel ringkasan saldo bulanan per akun (materialized, diperbarui saat posting)
  adalah arahnya — perubahan domain, di luar S4.
- **R-5 Daftar piutang/utang tanpa pagination.** `listReceivables`/`listPayables`
  mengembalikan seluruh dokumen terbuka (B: 40.500 dokumen, 486–525 ms). Pagination
  server-side seperti daftar lain adalah perbaikan langsung untuk S7.
- **R-6 Indeks trigram nama produk warisan.** `products_company_name_trgm_idx` terbukti
  tidak terpilih di bawah RLS (kasus sama dengan §4.2) tetapi tetap memajaki insert
  produk; keputusan cabut/pertahankan milik pemilik/S7.
- **R-7 Ruang DB sesudah pembersihan.** Dataset benchmark terhapus penuh (0 baris sisa),
  tetapi berkas DB tetap 3,1 GB (tuple mati; sudah di-VACUUM agar ruangnya dapat dipakai
  ulang internal). Pengecilan berkas memerlukan `VACUUM FULL` (kunci tabel) — tidak
  dijalankan di fase ini.

## 8. Batas kejujuran pengukuran

- Mesin: VM sandbox bersama (bukan server produksi), satu node PostgreSQL 18.6, pool
  aplikasi maks 12 koneksi; angka absolut akan berbeda di perangkat produksi — yang
  dapat dibawa adalah **urutan besar relatif dan perbandingan sebelum/sesudahnya**.
- p95/p99 berasal dari 7–9 larian per operasi (nearest-rank) — cukup untuk perbandingan
  fase ini, bukan sertifikasi SLA. Variansi antar-sesi terukur hingga ±2× untuk agregasi
  berat (lihat † di §5) sehingga selisih <25% pada operasi agregat tidak diklaim sebagai
  perbaikan maupun regresi.
- Data sintetis dimasukkan via SQL (bukan domain) untuk volume; distribusi harga/nama/
  tanggal adalah buatan generator (seed tetap), bukan data bisnis nyata. Pola akses yang
  diukur adalah pola fungsi aplikasi yang sesungguhnya.
- Berkas bukti: `scripts/sim2-gen/results/{before,after,final,verify}-A.json`,
  `{before,after,final,verify}-B.json`, `{conc-A,conc-B}-concurrent.json`.

## 9. Perubahan kode fase ini (ringkas)

- `src/server/employee-advances.ts` — ekstrak `computeAdvanceProposal` + tambah
  `proposeAdvanceDeductionsBatch` (PERF-01).
- `src/app/app/akuntansi/payroll/page.tsx` — loop N+1 diganti jalur batch.
- `src/server/reports.ts` + `src/app/api/export/inventory/route.ts` — opsi `skipLowStock`
  untuk ekspor valuasi (PERF-02, keluaran identik).
- `src/db/schema.ts` + migrasi `0029` (indeks) & `0030` (cabut trigram yang terbukti
  tidak terpakai, dengan komentar alasan leakproof/RLS di skema).
- `tests/sim2/payroll-batch-proposals.test.ts` — test kesetaraan batch (baru).
- `scripts/sim2-gen/` — generator dataset, skrip benchmark, pengukuran memori ekspor,
  cleanup, dan hasil mentah pengukuran (`results/`).
