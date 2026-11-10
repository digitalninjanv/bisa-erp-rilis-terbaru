# HASIL R3 — Program Rekayasa (implementasi K-1..K-8)

Tanggal: 2026-11-08 · Basis: `RENCANA-R2.md` (urutan wajib
K-3 → K-1 → K-2 → K-4 → K-5 → K-6 → K-7 → K-8) · HEAD awal `5010817`
(R2). Semua perubahan di pohon kerja, **belum ter-commit** — Pemimpin
memeriksa & menjalankan ulang gerbang.

## Gerbang akhir (dari reseed bersih, tanpa pipa penutup)

| Gerbang | Hasil |
|---|---|
| Reseed `pnpm db:seed -- --force` | exit 0 — 65 produk, nilai persediaan Rp28.349.600 |
| Suite penuh `pnpm test` | **2077/2077 (218 berkas)** = baseline 2039 + 38 test baru R3 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — 0 error, 29 warning (persis baseline warisan) |
| `pnpm build` | exit 0 (Next 16.4.5) |
| E2E `BISA_E2E_RESEED=1 pnpm test:e2e` | **25/25** |
| `scripts/audit/db-integrity.sql` | semua cek pelanggaran **0** (sesudah pembersihan residu fixture resmi; F1 = 67 baris migrasi) |
| Backup + restore drill (dump pasca-0066) | **LULUS** — `backups/bisa-20261108-065231.dump`, angka restore cocok persis, DB uji dihapus |
| `pnpm pos:export` | exit 0 · `pnpm tauri info` exit 0 · harness Rust **64/64** |

Catatan larian suite: larian 1 = 2076/2077 (penjaga penulis-tabel,
lihat K-2); larian 2 = 2075/2077 (dua flake balapan kelas AUD-008 —
`hardening-t5` AK-P3-03 varian pesan kalah-balapan & `pos-guards`
POS-IDEM-01 jendela replay; kedua berkas hijau mandiri 28/28);
larian 3 dari reseed bersih = **2077/2077**.

## K-3 — Saring `costPrice` di 3 aksi picker ✔

- `searchInventoryProductsAction`, `resolveBarcodeAction`,
  `loadOpnameProductsAction` (`src/server/actions/inventory/produk.ts`)
  kini menghitung `can(ctx, "inventory.cost")`; tanpa izin nilainya
  `null` (bukan error) — pola AUD-013.
- Test `tests/integration/rekayasa-r3-cost-picker.test.ts`: pada kode
  lama **5 gagal/4 lulus** (semua kasus viewer); sesudah perbaikan
  **9/9** + unit opname 14/14.
- Konsumen disesuaikan: `opname-count.ts` (nilai selisih & total
  menjadi `null` bila ada baris terhitung tanpa biaya — kartu/kolom
  nilai disembunyikan), `product-picker.tsx` (chip harga hilang bila
  null), `line-editor.tsx` (prefill kosong, bukan "0"),
  `supplier-return-form.tsx` (total "—" bila biaya tersembunyi).
- **Penyimpangan tercatat**: `buyPrice` kemasan pada payload yang sama
  (termasuk `resolved.packaging`) ikut disaring — kelas kebocoran
  sama, preseden ekspor A4 ("harga beli produk & kemasan =
  inventory.cost"). Sanitasi hanya di batas aksi; domain
  `listPackagingsForProducts` tidak diubah (dipakai internal luas).

## K-1 — Migrasi 0066: kebijakan RLS → bentuk InitPlan ✔

- Migrasi BARU `src/db/migrations/0066_rls_initplan_policies.sql`:
  satu blok DO dengan assertion hitungan SEBELUM = 97, loop
  `pg_policies` membungkus tepat **97 kebijakan `tenant_isolation`**
  menjadi `(select app_company_id())`, assertion SESUDAH = 97
  terbungkus (teks deparse PG18 persis). 2 kebijakan digest migrasi
  0060 **tidak disentuh** (terverifikasi utuh). `pnpm db:migrate`
  exit 0; `pnpm db:generate` ulang → "No schema changes" (nol drift).
  Pin `tests/unit/health.test.ts` 0065_ → 0066_.
- Uji negatif RLS gaya A1 sebagai `app_user` **LULUS**: tanpa konteks
  → 0 produk; konteks demo → tepat 65; perusahaan lain → 0; INSERT
  lintas-tenant ditolak kebijakan; UPDATE lintas-tenant → 0 baris.
- EXPLAIN sesudah pada dataset volume R1 yang sama (10 rb produk /
  25 rb penjualan / 50 rb baris jurnal; sebagai `app_user`, median
  3 larian). Dataset dibersihkan (wipe) sesudahnya.

  | Kueri | R1 sebelum | R1 varian | R3 terpasang | Vonis |
  |---|---|---|---|---|
  | Q1a hitung produk | 4,11 | 4,25 | 3,81 | noise ✔ |
  | Q1b halaman produk | 0,19 | 0,18 | 1,53 | A/B dataset-sama bentuk lama = 1,56 → **bukan regresi** |
  | Q2 pencarian teks | 15,65 | 15,48 | 14,87 | noise ✔ |
  | Q3 riwayat penjualan | 0,04 | 0,06 | 0,61 | A/B bentuk lama = 0,57 → **bukan regresi** |
  | Q4 buku besar kas | 0,40 | 0,51 | 35,34 | A/B bentuk lama = 34,94 → **bukan regresi** (angka R1 berasal dari keadaan rencana lain; di dataset ini gabung 25 rb baris + sort top-N mendominasi di kedua bentuk) |
  | **Q5 agregasi bulan parsial** | **14,81** | 5,21 | **7,11** | **≤ ambang 7,5 ms ✔ (−52%)** |

  A/B dilakukan dengan menukar bentuk kebijakan di dalam transaksi
  lalu ROLLBACK (metode R1); jumlah kebijakan terbungkus terverifikasi
  tetap 97 sesudah setiap rollback.

## K-2 — Sentralisasi `ensure*Accounts` ✔

- Test karakterisasi ditulis DULU:
  `tests/integration/system-accounts-parity.test.ts` (17 skenario).
  Pada kode lama **15/17** — tepat 2 gagal = skenario tabrakan
  payment & payroll (membuktikan delta perilaku).
- Helper baru `src/server/system-accounts.ts` —
  `ensureSystemAccounts(tx, companyId, specs)` bermekanik peta-memori
  fixed-assets (cocok KODE bertipe-sama dulu, lalu nama+tipe; sisip
  dengan `fallbackCode` + tag PSAK 118; pemetaan tak ditimpa;
  idempoten). Tiga pembungkus tipis bernama sama di berkas domain;
  langkah kontra A-27 B5 tetap di pembungkus fixed-assets. Test
  paritas **17/17 tanpa diubah**; algoritma ensure tinggal 1.
- **Perubahan perilaku disengaja** (sesuai titik rawan R2): skenario
  tabrakan — akun pembawa nama-standar DAN akun pembawa kode-standar
  hidup bersamaan — payment/payroll kini mengikat ke pembawa **kode**
  (warisan fixed-assets); dulu ke pembawa nama.
- **Pembaruan kontrak**: sentralisasi mengubah himpunan penulis
  `accounts`/`accountMappings`; penjaga
  `tests/unit/architecture-table-writers.test.ts` digagalkan suite
  larian 1 dan diselesaikan lewat jalur resminya — perbarui
  `docs/MODULE_BOUNDARIES.md` §6 (alasan tertulis: penulis pola
  pastikan-ada kini `server/system-accounts.ts`;
  fixed-assets tetap penulis `accounts` untuk penandaan kontra) +
  peta beku test dalam perubahan yang sama. Penjaga TIDAK dilemahkan
  (pola & ambangnya utuh).

## K-4 — Next.js 16.4.3 → 16.4.5 ✔

- `pnpm up next@16.4.5 eslint-config-next@16.4.5 --prefer-offline`
  exit 0. Diff lockfile terkurung pada keluarga next (next,
  eslint-config-next, @next/eslint-plugin-next, sufiks peer
  better-auth — versinya sama) + transitif next sendiri
  (baseline-browser-mapping, is-core-module 2.17→2.18,
  napi-postinstall 0.3.7→0.3.8, semver). **sharp tetap 0.35.5.**
  Tidak ada dependensi langsung lain yang bergeser.
- **Nol test diubah untuk lulus**; gerbang penuh hijau di 16.4.5
  (suite/typecheck/lint/build/e2e/pos:export).

## K-5 — Sesi segar (freshAge 1 jam) untuk tindakan sensitif ✔

- Semantik diverifikasi DULU dari sumber Better Auth 1.7.15 terpasang
  (`session.mjs` + `create-context.mjs`): `freshSessionMiddleware`
  menolak bila `Date.now() − session.createdAt >= freshAge×1000`;
  bawaan 86400; refresh `updateAge` hanya mengubah
  `expiresAt`/`updatedAt`, **tidak pernah `createdAt`** — jadi
  `freshAge` mengukur umur sejak masuk, sesuai desain R2.
- Implementasi: `session.freshAge: 3600` di `src/lib/auth.ts`;
  `SESSION_FRESH_AGE_SECONDS = 3600` + `assertSessionFresh` +
  `requireFreshSession(ctx)`; `CompanyContext.session` kini membawa
  `createdAt`. Penolakan: `AppError FORBIDDEN` berpesan "masuk ulang".
- 10 titik terpasang sesudah gerbang izin: users.ts ×6
  (createCompanyUser, updateUserRole, resetUserPassword,
  removeCompanyUser, saveCompanyRole, deleteCompanyRole);
  periode.ts ×3 (setPeriodStatus, postYearEndClosing,
  lockYearPeriods); route ekspor payroll ×1 (sesudah
  `payroll.salary`). POS dikecualikan secara sadar.
- Test `tests/integration/rekayasa-r3-fresh-session.test.ts` **6/6**:
  batas murni 3599 lolos / 3600 & 3601 ditolak; sesi segar lolos di 3
  permukaan; sesi tua (2 jam) ditolak FORBIDDEN di 3 permukaan;
  kontrol negatif — sesi tua TETAP lolos `seedMissingPeriodsAction`
  (sengaja tidak dipasangi) & buka/tutup sesi POS.
- **Penyimpangan tercatat**: helper tinggal di modul daun BARU
  `src/lib/session-freshness.ts` (di-re-export oleh `lib/session.ts`,
  permukaan DAL satu pintu utuh) dan 3 berkas titik panggil mengimpor
  dari sana. Alasan terukur: 7 berkas test lama memock `@/lib/session`
  secara pabrik; menaruh implementasi di sana membuat
  `requireFreshSession` tak terdefinisi pada mock (25 test lama gagal
  — semuanya hijau lagi 141/141 sesudah pemindahan, **tanpa mengubah
  satu pun test lama**).

## K-6 — Batas kesalahan root & global ✔

- `src/app/error.tsx` (di dalam layout root; pola & teks persis
  `src/app/app/error.tsx`: kartu `ShieldAlert`, varian "Akses
  ditolak") + `src/app/global-error.tsx` (`<html lang="id">`/`<body>`
  sendiri + impor `./globals.css`, tanpa dependensi provider/komponen
  bersama — sesuai dokumentasi Next 16 di node_modules).
- Test render `tests/unit/error-boundaries.test.ts` **3/3** (judul &
  teks produk; varian ditolak meneruskan pesan; global memuat
  html/body sendiri). Build exit 0 (impor CSS global-error sah).

## K-7 — CSP Tauri ✔ (terpasang & terverifikasi statis)

- `src-tauri/tauri.conf.json`: `app.security.csp` disetel per rancangan
  R2 + `devCsp` (longgar hanya untuk dev: tambah
  `http://localhost:3000` & `ws://localhost:3000` pada connect-src —
  devUrl menunjuk aplikasi web; dokumentasi `SecurityConfig` Tauri:
  tanpa `devCsp`, CSP produksi ikut diberlakukan di dev).
- **Keputusan `ipc.localhost` terverifikasi dari dokumentasi resmi
  Tauri v2** (halaman CSP v2.tauri.app): contoh resminya memakai
  `connect-src: ipc: http://ipc.localhost` — saluran IPC memang
  diatur connect-src. **Penyimpangan dari draf R2**: skema `ipc:`
  ditambahkan (contoh resmi membuktikan ia sumber IPC yang sah);
  tanpa pengecualian ini IPC Windows mati, sementara eksfiltrasi
  internet tetap tertutup (tak ada host eksternal).
  CSP produksi final: `default-src 'self'; script-src 'self'
  'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'
  data: blob:; font-src 'self' data:; connect-src 'self' ipc:
  http://ipc.localhost https://ipc.localhost; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none';
  worker-src 'self'`.
- Verifikasi: `pnpm tauri info` exit 0 (konfigurasi sah);
  `pnpm pos:export` exit 0; audit statis artefak — 0 URL eksternal di
  HTML, 0 `eval(`, 0 img eksternal, skrip inline RSC ada di kedua
  halaman (membenarkan `'unsafe-inline'`), satu-satunya `fetch(`
  adalah shim pustaka terbundel (bukan panggilan aplikasi; HTTP tetap
  milik Rust); harness Rust 64/64.
- **Utang bukti tetap dinyatakan (AUD-009)**: rendering webview
  sungguhan dengan CSP ini BELUM teruji — VM tanpa GTK; K-7 =
  terpasang & terverifikasi statis, bukan teruji lapangan.

## K-8 — Agregasi akumulasi penyusutan satu kueri ✔

- Test karakterisasi ditulis DULU & hijau pada kode lama (3/3):
  `tests/integration/rekayasa-r3-depreciation-parity.test.ts` —
  3 aset × 2 run posted + 1 run VOID berisi baris Rp777 jt yang wajib
  tetap terkecuali; nilai buku per aset & total diperiksa persis.
- `getAccumulatedDepreciationMap(tx, companyId, assetIds)` di
  `src/server/fixed-assets.ts`: satu kueri `SUM(amount) … JOIN runs
  … WHERE runs.status='posted' GROUP BY asset_id` (filter persis
  helper lama; SUM numeric PG eksak ≡ penjumlahan Decimal).
  Loop run bulanan & `getFixedAssetBookValues` memakai peta;
  pemakaian tunggal pelepasan TIDAK disentuh.
- Sesudah refaktor: test paritas **tanpa diubah** hijau +
  `tests/sim2/fixed-assets.test.ts` hijau (gabungan 8/8).

## Penyimpangan dari RENCANA-R2 (rekap)

1. K-3: `buyPrice` kemasan ikut disaring (kelas kebocoran sama).
2. K-5: helper di `src/lib/session-freshness.ts`, bukan langsung di
   `lib/session.ts` (alasan mock pabrik test lama; re-export menjaga
   permukaan).
3. K-7: skema `ipc:` ditambahkan ke connect-src (bukti dokumentasi
   resmi Tauri).
4. K-2: kontrak MODULE_BOUNDARIES §6 & peta beku penulis-tabel
   diperbarui dengan alasan (jalur resmi penjaga, bukan pelemahan).
5. Typecheck gerbang menangkap 1 error pada test K-8 baru
   (`bookValueAfter` bukan kolom skema — Drizzle membuangnya diam-
   diam saat runtime); properti dibuang dari fixture, perilaku test
   tidak berubah.
