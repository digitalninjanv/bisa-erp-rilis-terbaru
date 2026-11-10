# Analisis Terukur R1 — Program Rekayasa

> Tahap R1, 2026-11-08. Pendalaman atas `MATRIKS-GAP.md` (R0) dengan
> pengukuran nyata. **Nol perubahan kode produksi**: spike konfigurasi
> dikembalikan (`git status` bersih untuk berkas kode), eksperimen
> patch berjalan di worktree terpisah yang sudah dibuang, perubahan
> kebijakan RLS hanya di dalam transaksi yang di-rollback, dan
> perusahaan volume A3 (`…a302`) dibangun lalu **di-wipe** sesudah
> pengukuran (demo utuh: 65 produk).
> Catatan metode: worktree JANGAN ditaruh di `/tmp` — tmpfs 512 MB di
> mesin ini penuh oleh satu instalasi worktree (ENOSPC); pakai disk
> workspace.

## 1 · RLS InitPlan (R0-17) — TERUKUR: kandidat sah, dampak terarah

**Metode.** Dataset volume A3 dibangun ulang persis (10.000 produk ·
25.000 penjualan · 100.000 baris penjualan · 50.000 baris jurnal ·
10.000 baris stok; ANALYZE dijalankan). Enam kueri representatif yang
mencerminkan fungsi baca produksi dijalankan `EXPLAIN (ANALYZE,
BUFFERS)` 3× sebagai `app_user` dengan konteks tenant, dua varian:
kebijakan saat ini `company_id = app_company_id()` vs varian
`company_id = (select app_company_id())` — varian diterapkan lewat
`ALTER POLICY` di dalam satu transaksi + `SET LOCAL ROLE app_user`,
lalu **ROLLBACK** (terverifikasi: `pg_policies` kembali ke bentuk asal
sesudah pengukuran).

| Kueri (bentuk produksi) | Saat ini — median | Varian — median | Selisih |
|---|---|---|---|
| Q1a hitung produk (`listProducts` count) | 4,11 ms | 4,25 ms | ≈ 0 (noise) |
| Q1b halaman produk (join + subkueri stok) | 0,19 ms | 0,18 ms | ≈ 0 |
| Q2 pencarian teks produk (bentuk AUD-022) | 15,65 ms | 15,48 ms | ≈ 0 — biaya = Seq Scan ILIKE (Rows Removed 10.135), bukan kualifikasi RLS |
| Q2 yang sama sebagai penyewa minoritas (demo, 65 produk) | 0,21 ms | 0,18 ms | ≈ 0 (indeks perusahaan dipakai di kedua varian) |
| Q3 halaman riwayat penjualan | 0,04 ms | 0,06 ms | ≈ 0 |
| Q4 halaman buku besar akun kas (gabung jl⋈je) | 0,40 ms | 0,51 ms | ≈ 0 (noise larian pertama) |
| **Q5 agregasi bulan parsial (`cumulativeAccountTotals` mentah)** | **14,81 ms** | **5,21 ms** | **−65% (≈3× lebih cepat)** |

**Mekanisme (terbaca dari rencana).** Pada Q5, `journal_entries`
tidak punya predikat perusahaan eksplisit dari aplikasi — pembatasan
tenant-nya datang **hanya dari RLS**. Dengan fungsi telanjang, planner
tidak dapat memakai kualifikasi itu sebagai kondisi indeks komposit
`(company_id, date)`: rencana jatuh ke Seq Scan `journal_lines`
(50.008 baris) + Bitmap Heap Scan `journal_entries` + Hash Join.
Dengan pembungkus `(select …)`, kualifikasi menjadi InitPlan konstan
→ Index Scan `journal_entries_company_date_idx` (1.035 entri dalam
rentang) + nested-loop Index Scan `journal_lines_entry_idx`.
Kueri yang predikat perusahaannya eksplisit dari aplikasi (Q1–Q4)
tidak berubah: di sana fungsi per-baris bukan faktor penentu.

**Putusan.** Kandidat R2/R3 yang sah dan terukur — satu migrasi
mendefinisikan ulang kebijakan 97 tabel bertenant ke bentuk
`(select app_company_id())`; semantik identik (fungsi & nilai sama,
hanya pelipatan konstan planner), risiko kebenaran rendah, wajib
digerbang suite + e2e + pengukuran ulang EXPLAIN. Manfaat hari ini
terkonsentrasi pada agregasi laporan yang menggabung tabel tanpa
predikat eksplisit, dan **tumbuh seiring volume jurnal** (jalur
mundurnya adalah seq scan tabel baris). Bukan perbaikan untuk Q2 —
itu tetap jalur AUD-022 (trigram), tidak diusulkan ulang di sini.

## 2 · Spike flag TypeScript (R0-31) — TERUKUR: jangan aktifkan global

**Metode.** `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
diaktifkan bersama di `tsconfig.json`, `pnpm typecheck` dijalankan,
lalu tsconfig **dikembalikan** (`git checkout`). Atribusi per flag
dari keluarga kode error (metode dinyatakan apa adanya: bukan dua
larian terpisah).

**Hasil: 5.920 error** (baseline hari ini: 0).

| Area | Error | Pangsa |
|---|---|---|
| `tests/` | 5.151 | 87,0% |
| `src/` | 718 | 12,1% |
| `scripts/` | 42 | 0,7% |
| `e2e/` | 9 | 0,2% |

| Keluarga | Kode | Jumlah | Sifat |
|---|---|---|---|
| noUncheckedIndexedAccess langsung | TS18048 + TS2532 + TS2538 + TS18047 | 4.711 | akses indeks/`rows[0]` tanpa penyempitan |
| exactOptionalPropertyTypes | TS2379 + TS2375 + TS2412 + TS2418 | 288 | `T \| undefined` ke properti opsional — noise anotasi, terkonsentrasi di tipe filter DTO & props komponen bersama (memperbaiki tipe bersama memanen banyak situs) |
| Turunan campuran (mayoritas NUIA) | TS2322 + TS2345 + TS2769 + TS2722 | 921 | `T \| undefined` mengalir ke assignment/argumen |

Di dalam `src/` (718): `src/server` 462, `src/app` 97,
`src/components` 79, `src/lib` 51, `src/db/seed.ts` 28. Berkas
teratas adalah domain inti: `pos/quote.ts` 25, `fixed-assets.ts` 20,
`master-data/parties.ts` 16, `supplier-returns/returns.ts` 15,
`inventory/opname.ts` & `adjustments.ts` 15.

**Penilaian sampel.** Sebagian kecil error `src/server` adalah pola
yang memang rawan (destukturisasi hasil kueri dipakai tanpa
penyempitan yang hanya terlihat manusia dari cek sebelumnya — mis.
`'job' is possibly 'undefined'` di route impor), tetapi mayoritas
adalah pemanenan mekanis atas pola yang sudah dijaga uji runtime.
Mengaktifkan kedua flag secara global = program pembersihan ±5.920
situs yang 87%-nya di test — nilai keselamatannya tidak sebanding
sebagai pekerjaan di program ini, dan flag bersifat global per
project (tidak bisa dinyalakan per folder dalam satu tsconfig).

**Putusan.** **Ditunda sebagai program terpisah** (bukan kandidat
R2/R3): bila kelak dikerjakan, urutan yang benar adalah pisahkan
tsconfig aplikasi vs test, panen dulu 718 error `src/` (domain
posting lebih dulu), test menyusul. Untuk sekarang `strict: true` +
cakupan uji yang ada adalah posisi yang dipertahankan secara sadar.

## 3 · Patch Next 16.4.3 → 16.4.5 (R0-07) — TERNILAI: tidak terdampak; naik patch aman

**Applicability advisori (sumber resmi, dibaca 2026-11-08).**

| Advisori | Versi perbaikan (jalur 16.4) | Rentang terdampak | Berlaku utk repo ini? |
|---|---|---|---|
| DoS Server Actions — GHSA-p3m5-59mp-jv5r (High) | 16.4.1 | `>= 16.4.0 <= 16.4.0` (halaman advisori GitHub resmi) | **Tidak** — terpasang 16.4.3, di luar rentang |
| RCE `use cache` typed arrays — GHSA-673q-mjm6-r5xr (Critical) | 16.4.1 | aplikasi Cache Components | **Tidak** — `cacheComponents: false`, nol `use cache` |
| RCE Image Optimization SVG — CVE-2026-96889 | 16.4.1 (sharp ≥ 0.35.5) | jalur optimasi gambar + SVG | **Tidak** — lockfile sudah sharp **0.35.5**; nol pemakaian `next/image`; tak ada konfigurasi `images` |
| SSRF Image Optimization — CVE-2026-94483 (rilis Sept, jalur 16.3.x) | 16.3.8 | hanya bila `images.remotePatterns` terkonfigurasi (pernyataan advisori sendiri) | **Tidak** — remotePatterns kosong |
| Cache poisoning SSG/ISR — CVE-2026-94543 & CVE-2026-94484 | 16.3.8 | Pages Router SSG/ISR / catch-all + SSG | **Tidak** — App Router, semua halaman `force-dynamic` |
| Metadata image routes — CVE-2026-94485 | 16.3.8 | build webpack + route `opengraph-image` dinamis | **Tidak** — build Turbopack (`next.config.ts:69`), nol route metadata-image, nol `generateStaticParams` |
| Kebocoran `use cache`/Draft Mode — GHSA-h694-7cp9-m8p3, CVE-2026-94544 | 16.3.8 | Cache Components | **Tidak** |
| Dev server MCP — CVE-2026-94486 (Low) | 16.3.8 | hanya `next dev` | Tidak relevan produksi |

Tanggal terbit npm menguatkan: 16.4.1 terbit 2026-10-14 (rilis
keamanan), **16.4.3 terbit 2026-10-23 — sesudahnya**, jadi perbaikan
Oktober sudah termasuk di versi terpasang. Ini **mengoreksi bingkai
R0** yang menulis "dua patch di belakang pembaruan keamanan":
penilaiannya kini tuntas — yang tertinggal dari 16.4.5 hanyalah
perbaikan patch biasa, bukan lubang keamanan bernama. AUD-004
(audit dependensi otomatis) tetap NOT VERIFIED sebagai jalur
(registri advisori npm menolak dari lingkungan ini) — penilaian di
atas adalah penilaian manual per-advisori dari sumber resmi,
bukan pengganti `pnpm audit` di CI.

**Uji worktree (dibuang sesudahnya).** Worktree terpisah dinaikkan
ke 16.4.5 (next + eslint-config-next): **typecheck exit 0 · test
unit 836/836 (76 berkas) · subset integrasi terarah 34/34
(auth-hardening, pos-guards, reports-p2, a28-ui3-reports) · build
exit 0**. Nol delta perilaku teramati. Satu catatan operasional:
`pnpm up` pertama gagal karena HEAD ke CDN SheetJS (tarball xlsx
ter-pin, AUD-012) tersendat socket; percobaan kedua
`--prefer-offline` berhasil — di R3 gunakan cara yang sama.

**Putusan.** **Aman naik patch di R3** sebagai pemeliharaan rutin
(DIANJURKAN, bukan WAJIB keamanan), digerbang suite penuh + e2e.

## 4 · Strategi isolasi — didokumentasikan (R0-13)

`docs/rekayasa/ADR-ISOLASI-TRANSAKSI.md`: Read Committed + 74 titik
kunci baris eksplisit di 36 berkas + constraint unik sebagai penjaga
buat-sekali (pola payroll) + aturan urutan kunci (pelajaran AUD-008)
+ syarat amendemen utk Serializable/advisory. Baris R0-13 tertutup
sebagai dokumentasi.

## 5 · Sisa DIANJURKAN kecil

### 5(a) Sampel DTO 10 aksi — 9 bersih, 1 temuan

| Aksi (berkas) | Bentuk kembali | Nilai |
|---|---|---|
| `createCompanyUserAction` dkk. (`actions/users.ts`) | `{id, name, email, role}`, `{userId}`, `{id}` | bersih — tanpa hash/kredensial |
| `resumeHeldSaleAction` (`actions/pos.ts:340`) | objek dibentuk manual; baris `sales` penuh hanya dibaca internal | bersih |
| void penerimaan piutang (`actions/pos.ts:560`) | `.select()` penuh utk kunci baris internal; kembali hasil domain | bersih |
| `saveEmployeeAction` (`actions/hr/karyawan.ts:244`) | snapshot `before` utk riwayat; kembali `{id}` | bersih |
| `saveSupplierAction` (`actions/inventory/pihak.ts:66`) | snapshot utk audit before/after; kembali hasil domain | bersih |
| program statutori (`actions/payroll-indonesia.ts:126` dst.) | `.select()` penuh utk logika effective-dating internal | bersih |
| `switchCompanyAction` (`actions/company.ts:52`) | `{companyId}` | bersih |
| aksi jurnal (`actions/accounting/jurnal.ts`) | `return result` = hasil domain berbentuk | bersih |
| aksi pembelian (`actions/purchasing.ts`) | `return result` = hasil domain (`{id, number, …}`) | bersih |
| `searchPaletteAction` (`actions/palette.ts`) | daftar dibentuk per izin | bersih |
| **`loadOpnameProductsAction` (`actions/inventory/produk.ts:553`)** | baris katalog termasuk **`costPrice`** per produk, gerbang hanya **`inventory.view`** | **TEMUAN** |

Pola umumnya sehat: `.select()` penuh di berkas aksi selalu untuk
keperluan internal (snapshot audit, kunci baris, logika tanggal)
dan yang kembali ke klien selalu DTO bentukan. Pengecualiannya
satu: aksi muat-produk opname mengirim `costPrice` ke pemegang
`inventory.view` tanpa `inventory.cost` — kelas bidang yang sama
yang ditutup AUD-013 di ekspor & halaman nilai persediaan.
**Kandidat R2/R3**: saring `costPrice` dari muatan aksi ini bila
pemanggil tak memegang `inventory.cost` (pola AUD-013 persis),
atau buktikan kebutuhan tampilannya dan naikkan gerbangnya.

### 5(b) Desain `freshAge` (R0-21) — rekomendasi R3

Mekanisme: setel `session.freshAge` di `src/lib/auth.ts` (usulan
**3.600 detik**) dan tambahkan pemeriksa kesegaran di DAL
(`requireFreshSession()` di samping `requirePermission`) yang
menolak sesi lebih tua dari freshAge dengan pesan autentikasi-ulang.
Better Auth sendiri memakai freshAge yang sama utk endpoint
sensitif bawaannya (ganti kata sandi, 2FA), jadi satu setelan
menyelaraskan keduanya. Titik penerapan yang diusulkan (nilai
risiko tertinggi, frekuensi rendah — gesekan operasional minimal):

1. Manajemen pengguna & peran: `updateUserRoleAction`,
   `resetUserPasswordAction`, `removeCompanyUserAction`,
   `createCompanyUserAction`, `saveCompanyRoleAction`,
   `deleteCompanyRoleAction` (`actions/users.ts`) — jalur eskalasi
   hak istimewa.
2. Finalitas keuangan: `setPeriodStatusAction` (tutup/kunci
   periode), `lockYearPeriodsAction`, `postYearEndClosingAction`
   (`actions/accounting/periode.ts`).
3. Ekspor payroll (`GET /api/export/payroll`, gerbang
   `payroll.salary` sudah ada — kesegaran = lapis kedua utk data
   gaji massal).

Yang sengaja **tidak** diusulkan: operasi POS (void/refund) —
frekuensi operasional toko tinggi dan sudah bergerbang izin +
alasan; kesegaran sesi di sana membeli sedikit dgn gesekan besar.
Semantik persis pemeriksaan kesegaran pada Better Auth 1.7.15
wajib diverifikasi terhadap dokumentasi versi itu saat R3
menerapkan (jangan menebak nama bidang sesi).

### 5(c) `error.tsx` root & `global-error.tsx` (R0-09)

Keadaan: hanya `src/app/app/error.tsx` yang ada; `src/app/` tak
punya `error.tsx`/`global-error.tsx`, tetapi punya `not-found.tsx`.
Dampak: kegagalan render di luar segmen `/app` (halaman login,
root `/`, layout root) jatuh ke batas kesalahan bawaan framework —
tanpa bingkai aplikasi, tanpa bahasa/pola visual produk, dan utk
kegagalan layout root tampil halaman minimal bawaan Next. Risiko
fungsional nol (permukaan publik kecil), risiko pengalaman nyata.
**Bentuk minimal R3**: `src/app/error.tsx` meniru pola
`app/error.tsx` (Client Component, tanpa `<html>/<body>` — di dalam
layout root) + `src/app/global-error.tsx` dgn `<html>/<body>`
sendiri dan impor `globals.css`, salinan teks yang sama. Kecil,
satu pola, tanpa keputusan desain baru.

### 5(d) Rate-limit & sumber IP (R0-24) — gerbang multi-instance

Dinyatakan sebagai **syarat deployment tertulis**, tanpa
implementasi hari ini (instance tunggal terbukti aman): sebelum
menjalankan >1 instance aplikasi atau mengubah proksi di depan
aplikasi, tiga hal wajib ditutup sekaligus — (1) penyimpanan
rate-limit Better Auth dipindah dari memori ke database/storage
sekunder (komentar di `src/lib/auth.ts` sudah menyatakannya);
(2) aturan sign-in diperketat dari 10/60 dtk menuju contoh resmi
3/10 dtk atau dinilai ulang dgn data percobaan nyata; (3) sumber
IP dikonfigurasi eksplisit (`advanced.ipAddress`/proksi tepercaya)
agar kunci rate-limit tak bisa dipalsukan lewat X-Forwarded-For.
Ditulis juga sebagai baris syarat di matriks (status R1 baris
R0-24) dan berlaku bersama syarat R0-10 (kunci enkripsi aksi
bersama) & R0-16 (`prepare: false` di depan pooler mode-transaksi)
sebagai satu paket gerbang multi-instance.

## 6 · Analisis kode mandat §3 (di luar matriks)

### 6.1 Duplikasi terukur (jscpd)

jscpd atas `src/` (ambang 12 baris/80 token): **83 klon persis,
1.802 baris terduplikasi = 1,11%** dari 911 berkas. (Angka A-26/A1
2,15%/2,12% memakai ambang berbeda — tidak dibandingkan langsung;
yang dipakai di sini adalah daftar klonnya, bukan persentasenya.)

Klasifikasi klon terbesar:

- **Cerminan disengaja terjaga** — `lib/pos/pos-offline.ts ↔
  server/pos/quote.ts` (23+21 baris): cermin quote offline yang
  memang dirancang ganda dan dijaga test paritas
  (`pos-offline-local-quote.test.ts`). Bukan temuan.
- **TEMUAN UTAMA — tiga implementasi satu algoritma** (rincian
  6.2).
- **Kembar presentasi kasbon/pinjaman** — `components/akuntansi/
  advance-panel.tsx ↔ loan-panel.tsx`: 4 klon berjumlah ±290 baris,
  ditambah halaman daftar/detail kasbon↔pinjaman (±80 baris).
  Domainnya memang sengaja terpisah (produk piutang karyawan yang
  tak boleh tercampur di jurnal — SIM-2 S2), tetapi panel UI-nya
  salinan paralel: perbaikan tampilan/perilaku harus dilakukan
  dua kali. Kelas: duplikasi presentasi, risiko sedang-rendah;
  kandidat penggabungan komponen hanya bila area itu disentuh.
- **Panel master-data HR** — `components/akuntansi/hr/leave.tsx ↔
  shifts.tsx` (121 baris): pola CRUD salinan. Kelas sama seperti di
  atas.
- **Pasangan input paralel** — `lib/money-input.ts ↔
  percent-input.ts` + komponennya (±78 baris): dua implementasi
  saudara utk input uang & persen; kandidat basis bersama, nilai
  kecil.
- Sisanya klon kecil satu-modul (void-buttons, pembayaran,
  halaman cetak) — di bawah ambang tindak lanjut.

### 6.2 Sumber kebenaran ganda: `ensure*Accounts` ×3

Algoritma "pastikan akun sistem dari daftar spec" — lewati bila
sudah terpetakan → cari berdasarkan nama+tipe → periksa kode →
sisipkan dgn `fallbackCode` bila kode terpakai + tagging PSAK 118
→ sisipkan pemetaan — hidup di **tiga** implementasi:

| Implementasi | Lokasi | Mekanik |
|---|---|---|
| `ensurePaymentDeductionAccounts` | `src/server/payment-deductions.ts:36` | kueri per spec (klon nyaris verbatim dgn baris berikutnya) |
| `ensurePayrollIndonesiaAccounts` | `src/server/payroll-indonesia.ts:79` | kueri per spec |
| `ensureFixedAssetAccounts` | `src/server/fixed-assets.ts:70` | peta di memori (mekanik terbaik: muat sekali, O(1)) |

Hanya data `ACCOUNT_SPECS`-nya yang berbeda. Bukti risiko nyatanya
sudah terjadi: tagging PSAK 118 (A-27 B5) harus diterapkan di
**ketiga** salinan (komentar B5 ada di ketiganya) — setiap
perbaikan semantik algoritma ini wajib diingat tiga kali.
**Kandidat R2/R3**: ekstrak satu helper bersama
`ensureSystemAccounts(tx, companyId, specs)` berbasis mekanik
peta-memori milik fixed-assets; tiga pemanggil menyimpan specs-nya
masing-masing. Permukaan uji pendukung sudah ada (payroll,
fixed-assets, payment-deductions teruji integrasi).

### 6.3 Yang diperiksa dan bersih (agar tak diungkit ulang)

- **Ekspor laporan memakai fungsi baca yang sama** dgn halaman
  (`export-builders.ts` mengimpor `getTrialBalance`,
  `getIncomeStatement`, `getBalanceSheet`, `getLedger` dari modul
  reports) — tak ada sumber kebenaran ganda halaman-vs-ekspor.
- **Bucket aging** terpusat di `src/lib/due-date.ts`; **tarif pajak
  efektif** terpusat lewat `effectiveTaxRate` (pemakaian konsisten
  di quick-entry, reimbursements, beban-transfer) — temuan A-26
  sudah tertutup dan tetap tertutup.
- **Ringkasan sesi kas** yang menghitung ulang dari
  `cash_movements` adalah desain rekonsiliasi terdokumentasi
  ("sumber kebenaran tunggal untuk riwayat & rincian" —
  `reports/cash-sessions.ts`), berdampingan dgn snapshot
  `expectedCash` saat tutup sesi; bukan duplikasi tak disengaja.
- **Penomoran dokumen & uang** tetap terpusat (`document-numbering`,
  `lib/money.ts`) sesuai keadaan A-26.

### 6.4 Konsistensi pola antar-modul

- `guard()`: **100% aksi terekspos** — dua berkas tanpa `guard`
  (`import/commit-phases.ts`, `import/commit-packaging.ts`) bukan
  berkas `"use server"`; keduanya fase internal yang diorkestrasi
  `commit.ts` yang ber-`guard`.
- Validasi: dua idiom hidup berdampingan — `parseInput(...)` 123
  pemakaian vs `.parse(input)` langsung 52 pemakaian (+1
  `safeParse`). Keduanya Zod dan diterjemahkan `guard()`; bedanya
  hanya jalur pemformatan pesan. Kelas: inkonsistensi kosmetik,
  risiko rendah; samakan insidental saat menyentuh berkas, bukan
  program.
- `throw new Error(...)` polos: hanya **4 situs** di seluruh
  actions (`pos.ts:189,352,401`; `payroll-indonesia.ts:372`) vs
  `AppError` berkode di mana-mana — pesannya tetap Indonesia &
  bermakna, tetapi tak membawa kode semantik. Kelas mikro sama
  seperti di atas.

### 6.5 N+1 & biaya kueri halaman berat

- **Buku besar** (`getLedger`, `reports/ledger.ts`): **8 kueri
  tetap** per render (akun 1 + `cumulativeAccountTotals` 2×2 +
  count 1 + jumlah sebelum-halaman 1 + baris halaman 1) — tak
  bergantung jumlah akun/baris. **Neraca saldo**: 5 kueri tetap.
  `cumulativeAccountTotals` sendiri selalu tepat 2 kueri (ringkasan
  bulanan + agregasi bulan parsial). **Tidak ada N+1 di
  laporan inti**; biaya median A3 (buku besar 335 ms) adalah biaya
  agregasi di dalam kueri-kurir itu (§1 Q5 adalah salah satunya),
  bukan jumlah kueri.
- **Satu pola N+1 yang terbukti dari kode** — run penyusutan
  bulanan aset tetap (`fixed-assets.ts:435`): loop semua aset aktif
  memanggil `getAccumulatedDepreciation` per aset (1 kueri per
  aset, dan helper itu menarik **semua** baris penyusutan aset lalu
  menjumlah di JS — tanpa `SUM`/`GROUP BY` SQL). Terbatas pada
  jalur tulis bulanan dan jumlah aset minimarket (puluhan), jadi
  dampak praktisnya kecil hari ini; tercatat sebagai pola yang
  salah bentuknya, bukan bottleneck terukur. Perbaikan bentuknya
  murah (satu kueri agregat ber-`GROUP BY asset_id`) bila area
  itu disentuh.
- Pola loop-atas-dokumen lain yang ditemukan (baris dokumen,
  kasir unik pada sinkron offline, cicilan pinjaman) adalah
  pemrosesan per-baris-dokumen yang memang semantiknya demikian —
  terbatas oleh ukuran dokumen, bukan oleh ukuran tabel.

## 7 · Daftar kandidat final R2 (hanya yang ber-bukti)

| # | Kandidat | Bukti | Ukuran |
|---|---|---|---|
| K-1 | Migrasi kebijakan RLS ke `(select app_company_id())` (semua tabel bertenant) + verifikasi EXPLAIN ulang | §1: Q5 14,81 → 5,21 ms; netral di 5 kueri lain; manfaat tumbuh dgn volume | Sedang (1 migrasi + gerbang penuh) |
| K-2 | Ekstrak `ensureSystemAccounts` bersama; 3 implementasi → 1 | §6.2: algoritma sama ×3, perbaikan B5 harus ×3 | Kecil–Sedang |
| K-3 | Saring `costPrice` di `loadOpnameProductsAction` utk peran tanpa `inventory.cost` | §5(a): muatan aksi vs gerbang `inventory.view`; pola AUD-013 | Kecil |
| K-4 | Naik patch Next 16.4.3 → 16.4.5 | §3: worktree hijau penuh (typecheck 0, unit 836/836, integrasi 34/34, build 0) | Kecil |
| K-5 | `freshAge` 3.600 dtk + `requireFreshSession` di titik §5(b) | §5(b): desain selesai; operasi eskalasi/finalitas tanpa kesegaran sesi | Kecil |
| K-6 | `src/app/error.tsx` + `src/app/global-error.tsx` | §5(c): permukaan publik tanpa bingkai gagal | Kecil |
| K-7 | CSP Tauri restriktif (dari R0-38, kelas WAJIB — di luar pengukuran R1, tetap antre R3) | Matriks R0-38 | Sedang |
| K-8 (prioritas rendah) | Agregasi akumulasi penyusutan → satu kueri `GROUP BY` | §6.5: pola N+1 terbukti dari kode; dampak kecil pada skala aset kini | Kecil |

**Dinyatakan BUKAN kandidat** (dgn alasan): pengaktifan global
flag TS (§2 — program terpisah bila pernah); Cache Components,
RQB, Testcontainers, proxy.ts (putusan R0 bertahan); trigram
pencarian produk (tetap jalur AUD-022 di register audit, bukan
usulan baru); menaikkan isolasi global (ADR §keputusan 1).

## 8 · Status baris matriks sesudah R1

R0-07 TERNILAI (tidak terdampak advisori; naik patch = K-4) ·
R0-13 TERTUTUP oleh ADR · R0-17 TERUKUR (K-1) · R0-21 DESAIN
SELESAI (K-5) · R0-24 TERTULIS sbg gerbang multi-instance ·
R0-31 TERUKUR (ditunda, program terpisah) · R0-09 DINILAI (K-6) ·
R0-01 ditambah satu temuan turunan (K-3).
