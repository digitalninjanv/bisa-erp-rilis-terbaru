# ARS-2 — Audit Kualitas Kode, Keterbacaan & Kemudahan Perawatan

Audit **baca-saja** (tidak ada kode diubah). Semua angka di bawah adalah hasil
`grep`/`wc` nyata pada pohon kerja saat audit, bukan kesan. Baseline mandat
terverifikasi persis: **313 berkas `src/` (`.ts`/`.tsx`), 91.044 LOC**.
Berkas test: **123 berkas Vitest** (`tests/`: unit 27 · integration 68 · sim2 28)
+ **7 berkas e2e** (`e2e/`, termasuk setup & helpers) = 130 berkas test;
hitungan statis `it(`/`test(` = 1.005, sedangkan hitungan runtime 1.137 —
selisihnya kasus yang dibangkitkan (`it.each`/loop). LOC test 48.196 baris
(53% dari LOC src) dengan 4.294 asersi `expect(` — rasio liputan yang kuat.

Ringkasan vonis:

| Aspek | Vonis | Skor |
|---|---|---|
| 1. Berkas raksasa (god files) | **RAWAN** | 5/10 |
| 2. Duplikasi | **SEHAT** (dengan catatan P3) | 7/10 |
| 3. Keamanan tipe | **SEHAT** | 9/10 |
| 4. Penanganan error | **SEHAT** | 9/10 |
| 5. Kode mati & sisa | **SEHAT** | 8/10 |
| 6. Arsitektur test | **RAWAN** | 6/10 |
| **Dimensi kualitas kode keseluruhan** | **RAWAN ringan** | **7/10** |

**Temuan: P0: 0 · P1: 2 · P2: 4 · P3: 5.**

---

## 1. Berkas raksasa — RAWAN (5/10)

19 berkas (6,1% dari 313) melebihi 800 baris; 40 berkas >500; 72 berkas >300.
Sisi baiknya nyata: **median berkas hanya 160 baris dan 60% berkas ≤200 baris** —
mayoritas kodebase ramping. Masalah terkonsentrasi di puncak distribusi:

| Berkas | Baris | Isi |
|---|---|---|
| `src/server/inventory.ts` | 3.050 | 5 siklus hidup dokumen: penerimaan, penyesuaian (+persetujuan), transfer dua tahap, opname, void — plus mesin gerakan stok & AVCO |
| `src/server/pos.ts` | 3.028 | quote, checkout, tahan, void, retur, piutang, sesi kas |
| `src/components/pos/pos-terminal.tsx` | 2.985 | satu komponen `PosTerminal` ±2.683 baris (lihat ARS2-01) |
| `src/server/reports.ts` | 2.723 | 43 fungsi: laporan keuangan + daftar penjualan + riwayat sesi kas + jurnal/buku besar + AR/AP + rekonsiliasi kontrol |
| `src/db/schema.ts` | 2.683 | 98 definisi tabel — **bukan masalah**: deklaratif, satu tanggung jawab (skema), pola standar Drizzle; memecahnya justru merusak |
| `src/server/actions/accounting.ts` | 2.190 | 26 aksi; termasuk logika payroll 581 baris di lapisan aksi (ARS2-03) |
| `src/server/hr.ts` | 2.108 | 42 fungsi HR |
| `src/server/supplier-returns.ts` | 2.071 | satu modul yang koheren (retur pemasok) — besar tapi satu tanggung jawab |
| `src/components/pengaturan/settings-forms.tsx` | 1.795 | ±16 formulir pengaturan dalam satu berkas |
| `src/server/actions/inventory.ts` | 1.602 | 27 aksi |
| `src/server/actions/import.ts` | 1.316 | — |
| `src/server/import-masters.ts` | 1.268 | — |
| `src/components/akuntansi/hr-panel.tsx` | 1.224 | banyak sub-panel; 57 `useState` tersebar antar sub-komponen (masih terstruktur) |
| `src/server/master-data.ts` | 1.165 · `catalog.ts` 1.143 · `actions/settings.ts` 1.116 · `db/seed.ts` 945 · `bank-reconciliation.ts` 930 · `gudang/import-wizard.tsx` 906 | — |

Panjang fungsi (perkiraan terukur dari jarak antar deklarasi fungsi top-level;
termasuk komentar/helper di antaranya, jadi batas atas yang konservatif):

- `createSale` (`pos.ts:549`) **±790 baris**; `createSaleReturn` ±445; `quoteCart` ±377; `voidSale` ±346.
- `createReceipt` (`inventory.ts:379`) **±528 baris**; `receiveTransfer` ±399; `createAdjustment` ±319; `createTransfer` ±290.
- `runPayrollAction` (`actions/accounting.ts:920`) **±581 baris**; `processFinalPay` (`hr.ts:1624`) ±485; `postSupplierReturn` ±339; `getControlReconciliation` ±392.
- Komponen: `PosTerminal` ±2.683 baris dalam satu fungsi komponen, `SettingsForm` ±298.

### ARS2-01 (P1) — `PosTerminal` adalah god component sungguhan
Satu fungsi komponen ±2.683 baris memegang **47 `useState`, 12 `useEffect`,
17 `useCallback`/`useMemo`** dan 109 cabang `if` — keranjang, pencarian,
scanner, quote, pembayaran tunggal/campuran/utang, tahanan & resume, kredit
retur, pelanggan, antrean offline & sinkronisasi, dan tampilan, semuanya dalam
satu scope. Setiap perubahan kecil di terminal (modul paling sering disentuh:
15 commit churn) berisiko regresi ke perilaku yang tidak terkait, dan tidak ada
cara menguji sub-bagiannya secara terpisah.
**Rekomendasi:** ekstrak hook per kepedulian yang sudah terbukti stabil
polanya — `useCartPersistence`, `useOfflineQueue`, `useQuote`, `useHeldSales`,
`useReturnCredit` — tanpa mengubah perilaku; komponen menjadi komposisi.
Kerjakan saat fitur terminal berikutnya disentuh, bukan sebagai rewrite khusus.

### ARS2-02 (P1) — Mega-fungsi transaksional di domain uang & stok
`createSale` ±790 dan `createReceipt` ±528 baris adalah fungsi transaksional
paling kritis di sistem (uang + stok + jurnal dalam satu transaksi) sekaligus
yang paling sulit ditinjau: 188 cabang `if` di `pos.ts`, 170 di `inventory.ts`.
Riwayat program menunjukkan pola bug justru lahir di fungsi-fungsi ini
(agregasi baris retur, balapan sesi) dan perbaikannya menuntut membaca ratusan
baris konteks.
**Rekomendasi:** pecah per fase bernama di dalam berkas yang sama dulu
(validasi → penetapan harga → alokasi batch/seri → posting jurnal → finalisasi)
dengan antarmuka `tx` yang sudah ada; jangan tambah berkas baru sebelum fase
terbukti stabil. Target: tidak ada fungsi domain >250 baris.

### ARS2-03 (P2) — Berkas server multi-tanggung-jawab & logika domain di lapisan aksi
`inventory.ts` mencampur 5 siklus hidup dokumen; `reports.ts` mencampur
laporan keuangan, operasional POS, dan daftar AR/AP (43 fungsi ekspor).
Lebih tajam: **`runPayrollAction` ±581 baris hidup di `src/server/actions/`**,
padahal AGENTS.md menetapkan aksi hanya memiliki auth/parsing/revalidasi dan
logika domain di `src/server/*.ts`. Sejalan: **10 dari 21 berkas aksi
mengimpor `@/db/schema` langsung** dan menjalankan kueri di lapisan aksi
(sebagian sah untuk CRUD master sederhana, tetapi polanya tidak dibedakan
secara eksplisit dari pelanggaran lapisan).
**Rekomendasi:** (a) pindahkan badan `runPayrollAction` ke
`src/server/payroll*.ts`, aksi menyisakan parse+izin+panggil; (b) pecah
`reports.ts` menjadi `reports-financial.ts` / `reports-operational.ts` saat
berikutnya disentuh; (c) tulis satu kalimat di AGENTS.md tentang kapan aksi
boleh berkonsultasi skema langsung, agar penyimpangan berikutnya disengaja.

## 2. Duplikasi — SEHAT (7/10)

Bukti kuat anti-duplikasi di kode produksi:

- Format uang terpusat: `formatIDR` dipakai **542 kali**; `Intl.NumberFormat`/
  `toLocaleString` lokal hanya 19 kemunculan dan hampir semuanya untuk
  *hitungan/bukan uang* (jumlah baris, jumlah produk) — bukan format mata uang
  liar. `parseFloat` di `src/`: **0**. Helper desimal `d()` dipakai 636 kali
  di `src/server`.
- Tanggal terpusat: `todayISO` 197 pemakaian; format tanggal semua dari
  `src/lib/format.ts`.
- Komponen bersama benar-benar dipakai (impor dari `components/blocks/` di
  **101 berkas**, 238 baris impor): PageHeader 61 berkas, EmptyState 43,
  StatusBadge 38, StatCard 26, Pagination 18, SearchForm 15. Varian lokal
  lama (SummaryCard/MiniMetric/AgingCard) sudah 0 — tinggal **satu** komponen
  lokal `Metric` di `src/app/app/akuntansi/payroll/[id]/page.tsx:205`.
- Pola bersama lain juga terpusat: `claimIdempotencyKey` (`src/server/idempotency.ts`),
  `writeAudit` 178 pemakaian, `withCompany` 239, `field-classes` bersama
  diimpor 38 kali (dan berkas akuntansi lama kini hanya re-export).

### ARS2-04 (P2) — Validasi aksi masih dua pola: `parseInput` vs `.parse()` mentah
`parseInput` (pembungkus berpesan Indonesia dari `src/lib/action-validation.ts`)
dipakai 126 kali di aksi, tetapi `.parse()` Zod mentah masih **62 kali** di
`src/server/actions/` (terkonsentrasi di `actions/accounting.ts` dan
`actions/import.ts`). ZodError mentah yang lolos ke `guard()` diterjemahkan
menjadi pesan generik INTERNAL — persis kelas bug A-13 yang pernah diperbaiki
di Pengaturan → Pengguna. Perilakunya tidak salah, tetapi pesan error-nya
tidak konsisten dan bergantung pada berkas mana yang disentuh pengguna.
**Rekomendasi:** migrasikan 62 situs itu ke `parseInput` secara mekanis per
berkas saat disentuh; tambahkan aturan lint/grep-gate sederhana di CI agar
`.parse(` baru di `actions/` tertangkap.

### ARS2-06 (P2) — `window.prompt`/`window.confirm` masih 28 kemunculan
Semuanya di modul akuntansi (alasan void lewat `window.prompt`:
`payment-form.tsx:182`, `expense-form.tsx:189`, `bank-transfer-form.tsx:157`,
`payroll-panel.tsx:454`, `opening-balance-form.tsx:172`, `advance-panel.tsx:294`,
konfirmasi hapus akun `account-form.tsx:210`, dsb.), padahal komponen bersama
`blocks/confirm-dialog.tsx` sudah ada dan gudang sudah dimigrasikan
(FIX-GDG T4). Ini utang konsistensi UX terakhir yang terukur, bukan cacat fungsi.
**Rekomendasi:** satu tahap migrasi kecil mengikuti pola gudang; dialog alasan
void adalah komponen yang sama berulang — ekstrak `ReasonDialog` sekali.

### ARS2-09 (P3) — Sisa duplikasi lokal kecil
- 4 berkas pengaturan masih mendefinisikan `labelClass`/`fieldClass` lokal
  (`settings-forms.tsx`, `group-pricing.tsx`, `user-access.tsx`,
  `payroll-indonesia-form.tsx`) alih-alih mengimpor dari `blocks/field-classes`.
- `toLocalISODate` lokal di `pos-terminal.tsx:232` — **tercatat bukan
  pelanggaran**: ia memakai zona waktu *peramban* kasir, sedangkan
  `format.ts` memakai `Asia/Jakarta` sisi server; beda semantik, tetapi
  perbedaannya tidak didokumentasikan di tempat.
- `formatQty` lokal di `supplier-returns.ts:374` dan `roundRupiah` di
  `lib/payroll-indonesia.ts:71` — helper domain kecil yang wajar tetap lokal.

## 3. Keamanan tipe — SEHAT (9/10)

`tsconfig` `strict: true` dan **benar-benar terasa**, bukan formalitas:

- `any` sebagai tipe: **0** yang nyata. Seluruh 26 kemunculan kata `any` di
  src adalah atribut HTML `step="any"`, nilai union `"any"` di
  `action-validation.ts`, atau kata di komentar.
- `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error`: **0**. `eslint-disable`:
  10, semuanya `react-hooks/exhaustive-deps` (6) atau `no-img-element` untuk
  cetak (4) — terkendali dan terlokalisasi.
- `as unknown as …`: **20** (ARS2-08). Non-null assertion `!`: **93**
  (ARS2-11).

### ARS2-08 (P3) — 20 coretan `as unknown as` terkonsentrasi di batas SQL mentah
Pola dominan: hasil `tx.execute(sql\`…\`)` (15 situs `execute(sql` di src)
di-cast ke bentuk baris tulisan tangan — mis. `src/app/app/pos/page.tsx:45,50`,
`src/server/reports.ts:1146`, `src/server/master-data.ts:475,546` — plus hasil
aksi di wizard impor (`import-wizard.tsx:195,220`). Bentuknya tidak divalidasi
runtime; bila kueri berubah, cast ini berbohong tanpa suara. Jumlahnya kecil
dan lokasinya jelas (batas Drizzle/SQL), jadi risikonya terbatas.
**Rekomendasi:** untuk 4 situs di halaman app, pertimbangkan kueri Drizzle
bertipe alih-alih SQL mentah; untuk sisanya, terima sebagai batas terdokumentasi.

### ARS2-11 (P3) — Klaster non-null assertion berisiko rendah
93 kemunculan `!`, terdistribusi aman: ±31 di `db/seed.ts` (bootstrap,
kegagalan = seed gagal keras — dapat diterima), 12 di `import-wizard.tsx`
(`row.cells!` di cabang render yang sudah tergerbang), 2 di
`session-manager.tsx` (`session!.id` sesudah pemeriksaan status), 2 di
`settings-forms.tsx`. Tidak ditemukan `!` pada jalur uang/stok domain.
**Rekomendasi:** tidak ada tindakan khusus; cukup jaga agar tidak merembet ke
`src/server`.

## 4. Penanganan error — SEHAT (9/10)

Ini aspek terkuat kedua. Bukti:

- `throw new AppError` **711 kali** vs `throw new Error` **10 kali** (98,6%
  bertipe) dan `throw "string"` **0**. 10 pengecualian itu: 2 invariant
  konfigurasi saat boot (`db/index.ts`, `db/admin.ts` — wajar), 1 kontrak
  hook UI bawaan shadcn (`ui/chart.tsx`), 3 pesan domain di `hr.ts`
  (impor absensi), 1 di `payroll-indonesia.ts`, dan 3 di `actions/pos.ts`
  (lihat catatan di bawah).
- Satu pintu keluar: `guard()` dipakai **183 kali** di aksi; `AppError`
  membawa kode dari union tertutup 10 nilai (`src/lib/errors.ts`), dan
  `guard()` bahkan memetakan pelanggaran unik Postgres 23505 ke pesan
  Indonesia per constraint — kematangan di atas rata-rata proyek seukuran ini.
- `console.*`: **11 total** — 8 di `db/seed.ts` (CLI, sah), 1 di
  `lib/errors.ts:115` (itulah logger yang ditunjuk `guard()`), 1 di rute
  impor (`console.error` berkonteks), 1 di penangkap akhir seed. **Tidak ada
  `console.log` debug tertinggal di kode aplikasi.**
- Blok catch kosong: **0** (`catch {}` tanpa isi: 0 dari 53 situs catch).
  Catch tanpa argumen yang ada semuanya berbentuk fallback terdokumentasi:
  localStorage tak tersedia (komentar eksplisit), QR gagal → `null`,
  pencarian gagal → toast Indonesia. Tidak ditemukan catch yang menelan
  error domain secara diam-diam.

Catatan kecil (terhitung di ARS2-04): 3 `throw new Error` berpesan pengguna
di `src/server/actions/pos.ts:179,339,383` ("Belum ada gudang aktif",
"Pesanan ditahan tidak ditemukan", …) akan sampai ke pengguna sebagai pesan
generik INTERNAL lewat `guard()` — pesannya hilang. Ubah ke
`AppError("NOT_FOUND"/"VALIDATION", …)` dalam satu commit kecil.

## 5. Kode mati & sisa — SEHAT (8/10)

- **TODO/FIXME/HACK/XXX: 0.** 13 kemunculan grep awal seluruhnya positif
  palsu (kata `TEMPLATE(S)` pada fitur pola cetak/jurnal). Tidak ada kode
  ter-komentar yang terdeteksi (heuristik baris `//` berbentuk kode: hanya
  komentar prosa). Komentar 6,9% dari LOC dan berkualitas jejak-audit
  (menyebut nomor temuan/perbaikan), bukan komentar pengulang kode.
- Kepatuhan konvensi AGENTS.md terukur: semua 21 berkas aksi diawali
  `"use server"` (0 pelanggaran); `force-dynamic` hadir di 81 berkas rute
  untuk 78 `page.tsx`; 0 berkas halaman mengimpor `@/db` langsung.

### ARS2-07 (P3) — 12 simbol mati yang dapat dibuktikan + 6 dependensi tak terpakai
Metode: simbol ekspor yang total referensi repo-nya (termasuk tests & e2e)
hanya deklarasinya sendiri — terbukti mati, bukan tebakan:

- Komponen: `PrintButton` (`src/components/blocks/print-button.tsx`) —
  didefinisikan, tidak pernah dirender di mana pun.
- `src/lib/accounting.ts`: `INCOME_SECTIONS`, `isBalanceSection` ·
  `src/lib/format.ts`: `yearStartISO` · `src/lib/modules.ts`: `EXTRA_ICONS` ·
  `src/lib/money.ts`: `floorQty` · `src/lib/journal-form.ts`: `EMPTY_JOURNAL_LINE` ·
  `src/lib/payroll-indonesia-defaults.ts`: `STATUTORY_PROGRAM_CODES`,
  `OVERTIME_DAY_TYPE_LABELS` · `src/server/batches.ts`: `allocateFefo` ·
  `src/server/reservations.ts`: `listInTransitTransfers` ·
  `src/server/serials.ts`: `getAvailableSerials`.
- Dependensi produksi tanpa satu pun impor di repo (di luar
  `package.json`/lockfile): **`date-fns`, `pg-boss`, `@tanstack/react-query`,
  `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`** —
  6 dari 28 dependensi (sisa templat shadcn yang tidak pernah dipakai;
  total dependensi 28 prod + 15 dev sendiri tergolong ramping).

Jumlahnya kecil dan tidak berbahaya, tetapi `allocateFefo` yang mati layak
diperiksa maksudnya: apakah FEFO memang tidak dipakai (alokasi batch punya
jalur lain) atau fitur yang hilang diam-diam — itu pertanyaan produk, bukan
kebersihan.
**Rekomendasi:** hapus 12 simbol + 6 dependensi dalam satu commit higiene;
putuskan nasib `allocateFefo` secara eksplisit.

## 6. Arsitektur test — RAWAN (6/10)

Kekuatan dulu: cakupan berperilaku nyata (bukan test formalitas) — test
integrasi merekonsiliasi jurnal/stok/nilai persediaan terhadap DB sungguhan;
pola perusahaan fixture khusus per berkas dengan ID `01900000-…` (337
referensi di 97 berkas) adalah disiplin yang dipelajari dari insiden cemaran
residu dan dipatuhi konsisten; test dinamai menurut program/temuan
(`fix-p1-*`, `fix-gdg-tahap*`, `*-audit-probe`) sehingga asal-usul setiap
regresi dapat dilacak ke laporannya. Unit test murni (27 berkas) cepat dan
terisolasi dengan benar.

### ARS2-05 (P2) — Boilerplate fixture tersalin di 48 berkas; tidak ada modul helper bersama
`tests/` **tidak memiliki berkas helper/fixture bersama sama sekali**.
Fungsi `rollbackTransaction` yang nyaris identik (±15 baris: buka transaksi,
`set_config('app.company_id', …)`, jalankan, lempar `Rollback`) **didefinisikan
lokal di 48 berkas**; varian `alignSequences` tersalin di 4 berkas; pola
`ensureFixtureCompany` ditulis ulang per berkas (53 berkas memakai
`beforeAll`, 43 berkas integrasi/sim2 tanpa `beforeAll` karena memakai
perusahaan demo/bersama secara rollback). Akibat praktisnya: menambah test
fitur baru berarti menyalin 60–100 baris perancah sebelum asersi pertama,
dan satu perbaikan pada pola rollback harus diterapkan di 48 tempat.
Berkas test terbesar juga besar (`sim-bisnis.test.ts` 1.472 baris,
`fix-gdg-tahap2.test.ts` 1.199, `pos1-audit-probe.test.ts` 1.176).
**Rekomendasi:** ekstrak `tests/helpers/rollback.ts` + `tests/helpers/fixture.ts`
(rollbackTransaction, alignSequences, pembangun perusahaan fixture
berparameter ID) lalu migrasikan berkas secara bertahap saat disentuh —
jangan rewrite massal. Ini investasi perawatan tertinggi di aspek test.

### ARS2-10 (P3) — Suite berjalan serial; waktu gerbang tumbuh bersama suite
`vitest.config.ts` menetapkan `fileParallelism: false` dengan
`testTimeout`/`hookTimeout` 60 detik — konsekuensi wajar dari 96 berkas yang
berbagi satu database dev, tetapi gerbang penuh terukur ±3,5 menit untuk
test+lint pada 1.137 test dan akan memburuk linear. Tidak ada pemisahan
gerbang cepat (unit saja) yang terdokumentasi untuk putaran pengembangan.
**Rekomendasi:** dokumentasikan perintah gerbang dua tingkat (unit+berkas
terdampak untuk iterasi; penuh untuk penutup tahap) dan nilai skema DB per
berkas/paralelisme terbatas sebelum suite melewati ±2.000 test.

---

## Skor dimensi

**Kualitas kode, keterbacaan & kemudahan perawatan: 7/10.**

Justifikasi: fondasi disiplinnya jauh di atas rata-rata — strict yang nyata
(0 `any`, 0 ts-ignore), error bertipe 98,6% dengan satu pintu `guard()`,
0 TODO/catch kosong/console liar, format & komponen bersama yang benar-benar
dipakai, dan median berkas 160 baris. Yang menahan skor bukan kekacauan
melainkan **konsentrasi**: dua komponen/fungsi raksasa di jalur paling kritis
dan paling sering berubah (terminal POS & checkout), utang konsistensi yang
terukur jelas (62 `.parse()` mentah, 28 prompt/confirm, duplikasi fixture
test 48×), dan lapisan aksi yang mulai menampung logika domain. Semuanya
adalah pekerjaan penataan bertahap yang terlokalisasi — tidak ada temuan
yang menuntut rewrite, dan tidak ada P0.
