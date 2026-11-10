# Rencana Implementasi Terukur R2 — Program Rekayasa

> Tahap R2, 2026-11-08. Rencana per kandidat K-1..K-8 dari
> `ANALISIS-R1.md` §7, dilengkapi benchmark "sebelum" yang belum
> tertangkap di R1 (inventaris kebijakan hidup K-1, pemetaan konsumen
> K-3, audit artefak ekspor K-7, keadaan konfigurasi K-5). **Tahap ini
> dokumen rencana saja — nol perubahan kode produksi.**
> Setiap kandidat memuat: tujuan & bukti · perubahan persis · risiko
> & mitigasi · rollback · test pembuktian · metrik sesudah & ambang ·
> ukuran & pemilik berkas. Urutan eksekusi R3 di §9; gerbang akhir
> R3 di §10.

## Ringkasan urutan R3

| Urutan | Kandidat | Kelas risiko | Pemilik berkas (inti) |
|---|---|---|---|
| 1 | K-3 Saring `costPrice` jalur baca gudang | Keamanan (kebocoran aktif) | `actions/inventory/produk.ts` + komponen gudang |
| 2 | K-1 Migrasi kebijakan RLS InitPlan | Migrasi, radius ledak terbesar | `src/db/migrations/0066_*` |
| 3 | K-2 Ekstrak `ensureSystemAccounts` | Refactor domain ×3 | `src/server/system-accounts.ts` (baru) + 3 pemanggil |
| 4 | K-4 Patch Next 16.4.3 → 16.4.5 | Runtime global (lockfile) | `package.json` + `pnpm-lock.yaml` |
| 5 | K-5 `freshAge` + `requireFreshSession` | Perilaku autentikasi | `lib/auth.ts`, `lib/session.ts`, aksi users/periode, route ekspor payroll |
| 6 | K-6 `error.tsx` root + `global-error.tsx` | Aditif murni | 2 berkas baru di `src/app/` |
| 7 | K-7 CSP Tauri | Konfigurasi desktop | `src-tauri/tauri.conf.json` |
| 8 | K-8 Agregasi akumulasi penyusutan | Prioritas rendah, bersyarat | `src/server/fixed-assets.ts` |

Satu-satunya pasangan yang berbagi berkas adalah **K-2 ∩ K-8**
(keduanya menyentuh `src/server/fixed-assets.ts`) — terpisah jauh
dalam urutan dan pemilik yang sama, jadi tidak pernah dikerjakan
bersamaan. K-4 hanya menyentuh lockfile, ditempatkan sesudah kode
tenang agar atribusi gerbang bersih.

---

## K-3 · Saring `costPrice` di jalur baca gudang (urutan 1)

**Tujuan & bukti.** Menutup kebocoran bidang biaya kelas AUD-013
yang tersisa di jalur baca gudang (R1 §5a menemukan 1 dari sampel 10
aksi; pemetaan R2 melengkapinya menjadi **tiga aksi** dalam satu
berkas yang sama, `src/server/actions/inventory/produk.ts`, semuanya
bergerbang hanya `inventory.view`):

| Aksi | Baris | Yang bocor |
|---|---|---|
| `searchInventoryProductsAction` | :408 (select :419) | `costPrice` per produk hasil pencarian |
| `resolveBarcodeAction` | :466 (select :479) | `costPrice` produk hasil pindai |
| `loadOpnameProductsAction` | :551 (muatan :582) | `costPrice` seluruh katalog terlacak (≤1.000) |

Konsumennya adalah `ProductPicker`
(`src/components/gudang/product-picker.tsx`, tipe
`Picked.costPrice: string`) dan pemakainya: `opname-form.tsx`
(costPrice → `unitCost` baris → langkah tinjau menampilkan kolom
"Nilai selisih" dan kartu "Total dampak selisih", :576–597) dan
`supplier-return-form.tsx` (:146 `unitCost` → total & tampilan nilai
klaim per baris). `transfer-receive-form.tsx` dan
`operation-queue.tsx` juga memanggil aksi pencarian — penggunaan
`costPrice`-nya wajib diverifikasi di langkah pertama R3.
**Posting server tidak pernah membaca costPrice dari klien**:
opname memakai `product.costPrice` dari DB
(`src/server/inventory/opname.ts:266,278`); retur pemasok memakai
cuplikan baris penerimaan. Jadi yang bocor murni *tampilan*, dan
yang diperbaiki murni *muatan*.

**Perubahan persis** (pola AUD-013/A4 persis, lihat
`src/app/api/export/products/route.ts:28` dan
`src/server/actions/pos.ts:92,214`):

1. Di ketiga aksi: hitung `const includeCost = can(ctx,
   "inventory.cost")`; bila `false`, muatan membawa
   `costPrice: null` (kolom *hilang nilainya*, aksi tetap berhasil —
   bukan error, bukan penolakan).
2. Tipe mengalir: `Picked.costPrice: string | null` di
   product-picker; tipe baris `loadOpnameProductsAction`
   `costPrice: string | null`.
3. Konsumen memperlakukan `null` sebagai "biaya tak terlihat":
   opname-form menyembunyikan kolom "Nilai selisih" + kartu "Total
   dampak selisih" bila baris tak berbayar-biaya (pola halaman Nilai
   Persediaan A4), hitungan fisik & alur posting tak berubah;
   supplier-return-form menyembunyikan nilai klaim turunan-biaya
   (tampilan), nilai posting tetap dari server. Draf localStorage
   opname: `unitCost: null` diperlakukan sama seperti ketiadaan
   (jalur `?? "0"` yang ada disesuaikan agar `null` tak pernah
   tampil sebagai angka).
4. Bila verifikasi konsumen menemukan pemakaian yang *fungsional*
   (bukan tampilan), kebutuhan itu dipindah ke perhitungan server —
   bukan alasan mempertahankan kebocoran; temuan semacam itu
   dilaporkan sebelum perubahan bentuk.

**Risiko & mitigasi.** (a) Regresi tampilan untuk peran *berizin* —
mitigasi: test paritas owner (nilai identik sebelum/sesudah).
(b) Tipe `null` mengalir ke form pemakai picker lain — mitigasi:
inventaris konsumen adalah langkah pertama, typecheck penuh
menangkap sisanya. (c) Perilaku draf lama di localStorage kasir
(unitCost tersimpan dari sesi berizin dibuka oleh sesi tak berizin)
— mitigasi: draf diperlakukan tampilan; posting tak memakainya.

**Rollback.** Revert commit K-3 (satu commit khusus). Nol migrasi,
nol data.

**Test pembuktian.** Berkas integrasi baru mengikuti pola A4
(`tests/integration/audit-a4-cost-exports.test.ts`: mock hanya
lapisan autentikasi Better Auth + cookie `next/headers`; resolusi
member sungguhan di perusahaan fixture buangan, peran diganti via
baris member):

- Peran tanpa `inventory.cost` (viewer): ketiga aksi dipanggil —
  muatan **tidak memuat nilai biaya nyata di baris mana pun**
  (`costPrice === null` semua). Test ini **gagal pada kode sebelum**
  (muatan berisi nilai tertanam "12345").
- Peran owner: nilai `costPrice` persis seperti sebelum perubahan.
- Render langkah tinjau opname tanpa izin: angka nilai selisih
  tidak muncul; dengan izin: muncul.
- Regresi: test opname & retur pemasok yang sudah ada tetap hijau
  (membuktikan posting memakai biaya server, bukan muatan).

**Metrik sesudah & ambang.** 0 kemunculan nilai biaya nyata pada
muatan ketiga aksi untuk peran tanpa izin; nilai peran berizin
identik; suite penuh hijau tanpa test lama diubah.

**Ukuran & pemilik berkas.** Kecil. Pemilik:
`src/server/actions/inventory/produk.ts`,
`src/components/gudang/product-picker.tsx`, `opname-form.tsx`,
`supplier-return-form.tsx` (+ `transfer-receive-form.tsx` /
`operation-queue.tsx` hanya bila verifikasi konsumen menyentuhnya),
berkas test baru.

---

## K-1 · Migrasi kebijakan RLS ke bentuk InitPlan (urutan 2)

**Tujuan & bukti.** R1 §1: mengganti kualifikasi kebijakan
`company_id = app_company_id()` menjadi `company_id = (select
app_company_id())` membuat agregasi bulan parsial pola
`cumulativeAccountTotals` turun **14,81 → 5,21 ms (−65%)** —
pembungkus `(select …)` menjadi InitPlan konstan sehingga planner
dapat memakai indeks komposit `(company_id, date)` pada tabel yang
pembatasan tenant-nya datang *hanya* dari RLS. Lima kueri lain
netral; manfaat tumbuh seiring volume jurnal.

**Inventaris cakupan (diukur R2 dari skema hidup, 2026-11-08 —
benchmark "sebelum" yang dilengkapi tahap ini):**

- `pg_policies` skema public: **99 kebijakan pada 97 tabel**.
- Tepat **97 kebijakan bernama `tenant_isolation`** (cmd `ALL`,
  PERMISSIVE, roles `{public}`) dengan `qual` dan `with_check`
  sama-sama persis `(company_id = app_company_id())` — **inilah
  cakupan K-1**, tanpa kecuali dan tanpa tambahan.
- **2 kebijakan BUKAN cakupan dan tidak boleh disentuh**:
  `device_digest_lookup` pada `pos_terminals` dan
  `pairing_digest_lookup` pada `pos_pairing_codes` (migrasi 0060) —
  cmd `SELECT` saja, berbasis `current_setting('app.device_digest')`,
  `with_check` NULL. Keduanya jalur pra-tenant dan tidak menyebut
  `app_company_id()` sama sekali.

**Perubahan persis.**

1. **Migrasi BARU `0066_*`** (migrasi lama tidak pernah diedit —
   aturan repo). Dihasilkan lewat `pnpm db:generate --custom`
   (env `.env.local` di-source lebih dulu) atau registrasi
   jurnal + snapshot manual mengikuti preseden migrasi bernama
   tangan (`0013_bank_reconciliation`, `0033`–`0038`). Isi: satu
   blok `DO` — bentuk yang sama dengan preseden migrasi 0001 itu
   sendiri — yang:
   - menegaskan hitungan kebijakan `tenant_isolation` di skema
     public = **97** (selain itu `RAISE EXCEPTION` → migrasi gagal
     utuh, tidak setengah);
   - untuk setiap tabel pemiliknya: `DROP POLICY tenant_isolation`
     lalu `CREATE POLICY tenant_isolation USING (company_id =
     (select app_company_id())) WITH CHECK (company_id = (select
     app_company_id()))` (cmd ALL, PERMISSIVE, roles public adalah
     bawaan `CREATE POLICY` — ekuivalen bentuk lama);
   - menegaskan di akhir: 97 kebijakan kini berbentuk terbungkus
     dan 2 kebijakan digest (`device_digest_lookup`,
     `pairing_digest_lookup`) masih ada dengan bentuk asal.
2. Pin test kesehatan: `tests/unit/health.test.ts:48` dari
   `/^0065_/` menjadi `/^0066_/`.
3. `ENABLE`/`FORCE ROW LEVEL SECURITY` tidak berubah (properti
   tabel, bukan kebijakan) — migrasi tidak menyentuhnya.

**Ekuivalensi semantik (wajib dilampirkan sebagai bukti di R3).**
`app_company_id()` adalah fungsi SQL `STABLE` atas
`current_setting('app.company_id', true)` (migrasi 0001:5–8). Nilai
GUC ditetapkan sekali per transaksi oleh `set_config(...,
is_local=true)` di `src/db/tenant.ts:14,25` dan tidak dapat berubah
di tengah satu pernyataan; fungsi tak berefek samping. Menilai
sekali (InitPlan) ≡ menilai per baris — untuk `USING` maupun
`WITH CHECK`. Yang berubah hanya strategi planner, bukan himpunan
baris yang terlihat/tertulis.

**Risiko & mitigasi.** (a) Bentuk kebijakan salah → RLS bocor atau
aplikasi gagal total: mitigasi — DDL transaksional PG (migrasi satu
transaksi; kegagalan = rollback utuh), assertion hitungan di dalam
migrasi, dan uji negatif RLS penuh *sebelum* commit (di bawah).
(b) Kebijakan digest tertukar/tertulis ulang: mitigasi — filter
nama kebijakan di blok DO + assertion akhir. (c) Snapshot drizzle
untuk migrasi kustom: skema tabel tidak berubah sehingga snapshot
identik secara skema; hanya jurnal yang maju — verifikasi
`db:generate` berikutnya tidak menghasilkan drift.

**Rollback.** Migrasi kompensasi BARU `0067_*` berisi kebalikannya
(bentuk telanjang, assertion yang sama), pin health menjadi
`/^0067_/`. Tidak pernah mengedit 0066, tidak pernah menulis ulang
sejarah migrasi.

**Test pembuktian & verifikasi.**

1. Inventaris ulang pasca-migrasi: 99 kebijakan / 97 tabel; 97
   berbentuk `(select app_company_id())` pada qual & with_check;
   2 digest utuh.
2. **Uji negatif RLS gaya A1 diulang penuh** sebagai `app_user`:
   tanpa konteks → 0 baris; konteks demo → tepat 65 produk;
   perusahaan lain → 0; INSERT lintas-tenant ditolak kebijakan;
   UPDATE lintas-tenant → 0 baris. Ditambah test integrasi RLS
   yang sudah ada di suite (harus hijau tanpa diubah).
3. **EXPLAIN sesudah pada dataset yang sama dengan R1**: bangun
   ulang volume (`pnpm tsx --env-file=.env.local
   scripts/audit/bench-a3-volume.ts generate` — 10 rb produk /
   25 rb penjualan / 100 rb baris jual / 50 rb baris jurnal),
   jalankan himpunan 6 kueri R1 3× sebagai `app_user`, bandingkan
   median; perusahaan volume di-`wipe` sesudahnya.
4. `scripts/audit/db-integrity.sql` bersih; gerbang penuh §10.

**Metrik sesudah & ambang keberhasilan.** Q5 median **≤ 7,5 ms**
(≥ 50% keuntungan R1 tertahan; target ≈ 5,2 ms); Q1a/Q1b/Q2/Q3/Q4
dalam noise (selisih ≤ 20% atau ≤ 0,5 ms); jumlah baris hasil
setiap kueri identik sebelum/sesudah; nol perubahan pada uji
negatif RLS.

**Ukuran & pemilik berkas.** Sedang (satu migrasi + gerbang penuh).
Pemilik: `src/db/migrations/0066_*.sql`, `meta/_journal.json` +
snapshot meta, `tests/unit/health.test.ts`.

---

## K-2 · Ekstrak `ensureSystemAccounts` bersama (urutan 3)

**Tujuan & bukti.** R1 §6.2: satu algoritma "pastikan akun sistem
dari daftar spec" hidup di tiga implementasi — perbaikan tagging
PSAK 118 (A-27 B5) terbukti harus diterapkan tiga kali:

| Implementasi | Lokasi | Mekanik | Kembali |
|---|---|---|---|
| `ensurePaymentDeductionAccounts` | `src/server/payment-deductions.ts:36` (specs :22) | kueri per spec: pemetaan → nama+tipe → buat | `Record<string,string>` |
| `ensurePayrollIndonesiaAccounts` | `src/server/payroll-indonesia.ts:79` (specs :61) | kueri per spec (nyaris verbatim) | `void` (pemanggil membaca ulang peta) |
| `ensureFixedAssetAccounts` | `src/server/fixed-assets.ts:70` (specs :55) | **peta di memori: muat sekali** | `Record<string,string>` |

Pemanggil: `actions/hr/payroll.ts:145` + jalur statutori
`payroll-indonesia.ts:228`; `fixed-assets.ts:233,574,700`;
`party-writeoffs.ts:231,399`. Ketiganya menyematkan
`defaultPsak118Tags(spec.type, spec.section)` saat menyisipkan.

**Rancangan helper bersama.**

- Berkas baru **`src/server/system-accounts.ts`**: tipe
  `SystemAccountSpec` (bentuk spec yang sudah identik di ketiganya:
  `key, code, fallbackCode, name, type, normalBalance, section,
  cashFlowGroup`) + `ensureSystemAccounts(tx, companyId, specs):
  Promise<Record<string, string>>` bermekanik milik fixed-assets
  (yang terbaik): muat sekali `accountMappings` + `accounts`
  perusahaan → peta `byCode` dan `byName|type` di memori → per
  spec: lewati bila sudah terpetakan; cocokkan akun yang ada;
  sisipkan dengan `fallbackCode` bila kode terpakai (tagging PSAK
  118 dari `defaultPsak118Tags`); **perbarui peta di memori dan map
  hasil pada setiap sisipan** agar spec berikutnya dalam panggilan
  yang sama melihatnya; tulis baris pemetaan.
- Ketiga nama publik dipertahankan persis sebagai pembungkus tipis
  di berkas asal (pemanggil tak berubah): payment-deductions &
  fixed-assets meneruskan dan mengembalikan hasil helper;
  payroll-indonesia mempertahankan tanda tangan `void`-nya
  (menerima `Executor`, meneruskan dengan cast `Tx` seperti pola
  yang ada sekarang). Daftar specs tetap di berkas domain
  masing-masing — yang disatukan algoritmanya, bukan datanya.

**Titik rawan yang wajib diputuskan sadar: urutan pencocokan.**
Mekanik lama payment/payroll memeriksa **nama+tipe dulu** (baris
tertua), kode hanya menentukan fallback saat menyisipkan. Mekanik
fixed-assets memeriksa **kode (dengan tipe sama) dulu**, lalu
nama+tipe. Menyatukan berarti memilih satu urutan — rekomendasi
rencana ini: **urutan fixed-assets (kode → nama)**, *dengan syarat*
test paritas di bawah membuktikan hasil akhir (pemetaan
key→accountId + akun terbuat) identik pada skenario kanonik ketiga
domain. Bila ada skenario tabrakan yang hasilnya berbeda (akun
bernama sama berkode lain + akun berkode spec bernama lain hidup
bersamaan), selisih itu dicatat sebagai perubahan perilaku yang
disengaja dan dinilai risikonya *sebelum* kode ditulis — tidak
boleh lolos diam-diam.

**Risiko & mitigasi.** (a) Selisih urutan pencocokan di atas.
(b) Perbedaan `Executor` vs `Tx` antar pemanggil — mitigasi:
helper bertipe `Tx` (supertipe yang sudah dipakai pola cast yang
ada). (c) Berkas baru tunduk ratchet arsitektur A-26 (ukuran &
batas modul) — helper satu-tujuan, jauh di bawah plafon.

**Rollback.** Revert commit K-2. Murni refactor kode: nol migrasi,
nol perubahan data; akun yang sempat terbuat oleh helper baru
adalah akun yang sama yang akan terbuat oleh kode lama (oleh
paritas), jadi tak ada keadaan data yatim.

**Test pembuktian.** Test karakterisasi ditulis **pertama**, pada
kode lama, dan harus lulus *sebelum* refactor; sesudah refactor
test yang sama lulus **tanpa diubah**: berkas baru
`tests/integration/system-accounts-parity.test.ts` (perusahaan
fixture buangan, helper wipe A4). Per domain × skenario:
(a) bagan kosong → akun terbuat persis (kode, nama, tipe, saldo
normal, section, cashFlowGroup, tag PSAK 118) + pemetaan lengkap;
(b) akun nama+tipe sudah ada → dipakai ulang, nol duplikat;
(c) skenario tabrakan urutan (untuk keputusan di atas);
(d) kode spec terpakai akun lain → `fallbackCode` terpakai;
(e) pemetaan sudah ada → nol perubahan; (f) panggil dua kali →
idempoten (hitungan akun tetap). Permukaan lama tetap hijau:
`tests/integration/payroll-indonesia.test.ts`,
`tests/sim2/fixed-assets.test.ts`,
`tests/integration/fix-a21-r3a-writeoff.test.ts`,
`tests/integration/fix-p1-ppn-pemetaan.test.ts`.

**Metrik sesudah & ambang.** Test karakterisasi hijau sebelum &
sesudah dengan isi tak berubah; definisi algoritma ensure tinggal
**1** (grep: satu-satunya implementasi di `system-accounts.ts`);
klon jscpd klaster ini hilang; suite penuh hijau.

**Ukuran & pemilik berkas.** Kecil–Sedang. Pemilik:
`src/server/system-accounts.ts` (baru),
`src/server/payment-deductions.ts`, `src/server/payroll-indonesia.ts`,
`src/server/fixed-assets.ts`, berkas test paritas baru.

---

## K-4 · Naik patch Next 16.4.3 → 16.4.5 (urutan 4)

**Tujuan & bukti.** R1 §3: versi terpasang **tidak terdampak**
advisori keamanan Sept/Okt 2026 (rentang GHSA-p3m5-59mp-jv5r
`>=16.4.0 <=16.4.0`; 16.4.3 terbit sesudah rilis keamanan 16.4.1;
sharp sudah 0.35.5; prasyarat konfigurasi advisori lain absen) —
naik patch adalah pemeliharaan rutin DIANJURKAN, bukan penambalan
lubang. Bukti worktree R1 (dibuang sesudahnya): 16.4.5 typecheck 0,
unit 836/836, subset integrasi terarah 34/34, build exit 0, nol
delta perilaku.

**Perubahan persis.** `package.json` — `next` (:36) dan
`eslint-config-next` (:62), keduanya pin persis `16.4.3` →
`16.4.5` — plus `pnpm-lock.yaml`. Perintah (catatan operasional
R1): `export PATH="$HOME/.local/bin:$PATH"` lalu
`pnpm up next@16.4.5 eslint-config-next@16.4.5 --prefer-offline`
(percobaan online pertama di R1 gagal pada HEAD CDN SheetJS —
tarball xlsx ter-pin AUD-012; `--prefer-offline` berhasil).
Sesudahnya periksa diff lockfile: hanya entri next /
eslint-config-next dan transitif milik next yang boleh berubah;
sharp tetap 0.35.5; paket lain yang ikut bergeser = berhenti dan
nilai, jangan terima diam-diam.

**Risiko & mitigasi.** Patch line yang sama (risiko rendah);
risiko nyata justru diff lockfile menyeret paket tak terkait —
mitigasi pemeriksaan diff di atas. pos-desktop mengonsumsi next
dari instalasi root yang sama (`pos:export` =
`../node_modules/.bin/next build`) → ekspor statis desktop masuk
gerbang kandidat ini.

**Rollback.** Revert commit K-4 (package.json + lockfile), lalu
`pnpm install`.

**Test pembuktian & metrik.** Gerbang penuh §10 (kandidat ini
menyentuh runtime semua permukaan, jadi gerbangnya memang penuh):
suite ≥ baseline **2039/2039**, typecheck/lint/build exit 0, e2e
**25/25**, `pnpm pos:export` exit 0 — dan **nol test diubah untuk
lulus** (delta perilaku nol adalah ambangnya).

**Ukuran & pemilik berkas.** Kecil. Pemilik: `package.json`,
`pnpm-lock.yaml` saja.

---

## K-5 · `freshAge` 3.600 detik + `requireFreshSession` (urutan 5)

**Tujuan & bukti.** R1 §5b (desain selesai): operasi eskalasi hak
dan finalitas keuangan saat ini bertumpu pada izin saja; sesi
berusia hampir 7 hari yang tercuri tetap dapat mengubah peran atau
mengunci periode. Keadaan terverifikasi R2: `src/lib/auth.ts:48–50`
— `session.expiresIn` 7 hari, `updateAge` 1 hari, **`freshAge`
tidak disetel**; `CompanyContext.session` hanya membawa `{ id }`
(`src/lib/session.ts:34`). Better Auth memakai `freshAge` yang sama
untuk endpoint sensitif bawaannya (ganti kata sandi, 2FA), jadi
satu setelan menyelaraskan keduanya.

**Perubahan persis.**

1. `src/lib/auth.ts`: tambah `freshAge: 3600` (detik) pada blok
   `session`.
2. `src/lib/session.ts`: perluas `CompanyContext.session` agar
   membawa `createdAt`; tambah **`requireFreshSession()`** di
   samping `requirePermission` — menolak sesi yang umurnya
   melampaui `freshAge` dengan `AppError` berkode autentikasi dan
   pesan Indonesia yang memerintahkan masuk ulang. **Semantik
   persis wajib diverifikasi terhadap dokumentasi Better Auth
   1.7.15 di awal R3** (nama bidang sesi, dan apakah `updateAge`
   menggeser `createdAt`) — jangan menebak (peringatan R1 §5b).
3. Titik penerapan — **hanya** sepuluh titik bernama ini:
   - `src/server/actions/users.ts`: `createCompanyUserAction`
     (:66), `updateUserRoleAction` (:140),
     `resetUserPasswordAction` (:193), `removeCompanyUserAction`
     (:247), `saveCompanyRoleAction` (:313),
     `deleteCompanyRoleAction` (:394).
   - `src/server/actions/accounting/periode.ts`:
     `setPeriodStatusAction` (:27), `postYearEndClosingAction`
     (:168), `lockYearPeriodsAction` (:199).
     (`seedMissingPeriodsAction` sengaja **tidak** — bukan
     finalitas.)
   - `src/app/api/export/payroll/route.ts`: sesudah gerbang
     `payroll.salary` yang ada (:43).
   Operasi POS (void/refund) **sengaja tidak disentuh**: frekuensi
   operasional tinggi, sudah bergerbang izin + alasan wajib.

**Risiko & mitigasi.** (a) Gesekan: admin bersesi tua terkunci di
tengah pekerjaan — mitigasi nilai 3.600 dtk (longgar untuk
operasi sejarang ini) + pesan masuk-ulang yang jelas. (b)
Semantik `createdAt` yang bergeser oleh `updateAge` bisa membuat
kesegaran tak pernah kedaluwarsa (atau sebaliknya menolak semua)
— mitigasi: verifikasi dokumentasi versi terpasang + test batas
di bawah, sebelum titik panggil dipasang. (c) Penerapan bocor ke
aksi lain — mitigasi: kontrol negatif POS pada test.

**Rollback.** Revert commit K-5 (konfigurasi + helper + titik
panggil satu paket).

**Test pembuktian.** Pola mock A3/A4 (mock hanya `@/lib/auth` +
`next/headers`; member sungguhan di perusahaan fixture):

- Sesi segar (dibuat sekarang): aksi ubah peran, tutup periode,
  dan ekspor payroll **lolos**.
- Sesi tua (dibuat −2 jam): ketiga permukaan **ditolak** dengan
  pesan masuk-ulang.
- Kontrol: aksi void POS dengan sesi tua **tetap lolos**
  (membuktikan penerapan tidak bocor global).
- Unit batas helper: umur 3.599 dtk lolos, 3.601 dtk ditolak.

**Metrik sesudah & ambang.** 10/10 titik bernama tertutup;
0 aksi di luar daftar berubah perilaku; suite penuh hijau.

**Ukuran & pemilik berkas.** Kecil. Pemilik: `src/lib/auth.ts`,
`src/lib/session.ts`, `src/server/actions/users.ts`,
`src/server/actions/accounting/periode.ts`,
`src/app/api/export/payroll/route.ts`, berkas test baru.

---

## K-6 · `error.tsx` root + `global-error.tsx` (urutan 6)

**Tujuan & bukti.** R1 §5c: keadaan terverifikasi R2 — `src/app/`
punya `layout.tsx`, `not-found.tsx`, `page.tsx`, `login/` tetapi
**tanpa `error.tsx` / `global-error.tsx`**; hanya
`src/app/app/error.tsx` yang ada. Kegagalan render di luar segmen
`/app` (login, root) jatuh ke batas bawaan framework tanpa bingkai
aplikasi dan tanpa bahasa produk. Risiko fungsional nol, risiko
pengalaman nyata.

**Perubahan persis** (ikuti pola yang ada —
`src/app/app/error.tsx`: Client Component, kartu `ShieldAlert`,
teks Indonesia, membedakan "Akses ditolak" dari kesalahan umum;
dan baca dulu panduan error-handling Next 16 di
`node_modules/next/dist/docs/` sesuai aturan AGENTS.md repo):

1. `src/app/error.tsx` **baru** — Client Component, hidup di dalam
   layout root (tanpa `<html>`/`<body>`), salinan pola & teks yang
   sama dengan `app/error.tsx`.
2. `src/app/global-error.tsx` **baru** — Client Component dengan
   `<html lang="id">` + `<body>` sendiri dan impor
   `./globals.css` (global-error menggantikan layout root saat
   layout itu sendiri yang gagal), teks yang sama, **tanpa**
   dependensi pada provider/komponen bersama yang bisa ikut gagal.

**Risiko & mitigasi.** Bentuk global-error yang salah bisa
menampilkan halaman kosong justru saat paling dibutuhkan —
mitigasi: bentuk minimal persis dokumentasi + test render di
bawah; tak ada logika lain yang ditambahkan.

**Rollback.** Hapus dua berkas (aditif murni, nol permukaan lain
tersentuh).

**Test pembuktian.** Render test kedua komponen
(`renderToStaticMarkup`, pola test halaman A4): memuat judul &
teks produk yang diharapkan; build exit 0; e2e penuh tetap 25/25
(tak ada rute yang berubah perilaku).

**Metrik sesudah & ambang.** Kedua berkas ada dan ter-render;
nol perubahan perilaku rute; gerbang §10 hijau.

**Ukuran & pemilik berkas.** Kecil. Pemilik: `src/app/error.tsx`,
`src/app/global-error.tsx` (baru), berkas test render.

---

## K-7 · CSP restriktif untuk shell Tauri (urutan 7)

**Tujuan & bukti.** R0-38 (kelas WAJIB): `app.security.csp: null`
di `src-tauri/tauri.conf.json` — satu-satunya lubang konfigurasi
keamanan desktop. Pengukuran artefak yang dilengkapi R2:

- Override `tauri.linux.conf.json` / `tauri.windows.conf.json`
  **tidak menyetel CSP** → satu titik setel di conf utama. Berlaku
  untuk semua jendela, termasuk jendela display yang dibuat
  runtime (asumsi ini diverifikasi ke dokumentasi Tauri 2.12 di
  R3).
- Ekspor statis (`pos-desktop/out`): semua `<script src>` dan aset
  berasal dari `/_next/static/…` (same-origin), **nol origin
  eksternal** dirujuk HTML yang diekspor; tetapi setiap halaman
  memuat skrip **inline** `<script id="_R_">self.__next_f.…`
  (data flight RSC) — `script-src` tanpa `'unsafe-inline'`
  **mematikan aplikasi**, dan hash tidak praktis (isi berbeda per
  halaman & per build) sementara nonce mustahil untuk berkas
  statis.
- JS desktop **tidak melakukan `fetch(` sama sekali** (0 temuan di
  `pos-desktop/lib` & `pos-desktop/app`): seluruh HTTP milik Rust
  (reqwest) memakai `server_url` dari `device.json`
  (`src-tauri/src/device.rs:36`; `commands.rs:101`) dan token tak
  pernah masuk JS (keputusan D7 program Tauri). **Origin API tidak
  pernah dimuat webview.**

**Rancangan CSP** (ditetapkan sebagai nilai
`app.security.csp` di `src-tauri/tauri.conf.json`):

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://ipc.localhost https://ipc.localhost; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'
```

Alasan per direktif: `script-src 'unsafe-inline'` adalah
konsekuensi terukur data flight inline — lapis yang tetap
dipertahankan adalah kode *jarak jauh* mustahil dimuat (hanya
`'self'` + inline bawaan build sendiri). `connect-src`: webview
tidak butuh jaringan sama sekali; satu-satunya pengecualian adalah
`ipc.localhost`, saluran IPC Tauri v2 di Windows (fetch ke
`http://ipc.localhost`) — **keputusan ini wajib diverifikasi dari
dokumentasi Tauri 2.12 di R3**: tanpa pengecualian itu aplikasi
Windows berisiko mati total, sedangkan dengan pengecualian pun
eksfiltrasi ke internet tetap tertutup (origin itu lokal, milik
shell sendiri). Bentuk `'none'` murni hanya boleh dipilih bila
dokumentasi membuktikan IPC Windows tidak melewati connect-src.
`img-src data: blob:` untuk gambar produk lokal/placeholder;
`font-src data:` untuk font tertanam build. Catatan dev: `devUrl`
menunjuk aplikasi web utama (`http://localhost:3000/app/pos`) dan
CSP konfigurasi turut berlaku pada jendela dev — periksa bidang
`app.security.devCsp` pada skema Tauri 2.12; tetapkan `devCsp`
yang melonggarkan seperlunya agar `tauri dev` tidak rusak, atau
buktikan CSP produksi kompatibel dengan halaman dev.

**Risiko & mitigasi.** CSP terlalu ketat mematikan aplikasi di
mesin kasir — risiko tertinggi kandidat ini. Mitigasi: verifikasi
statis menyeluruh di bawah + nilai konservatif di atas. Status
quo hari ini adalah `null`, jadi CSP yang terverifikasi statis
adalah perbaikan bersih; **tetapi** pengiriman bundel desktop
tetap bergating uji lapangan AUD-009 yang sama — K-7 tidak
menaikkan maupun menurunkan gerbang itu.

**Verifikasi terbaik yang tersedia di mesin tanpa GUI** (yang
dikerjakan R3, berurutan):

1. `pnpm tauri info` membaca konfigurasi valid (preseden langkah
   7 program Tauri) + kesesuaian terhadap skema
   `https://schema.tauri.app/config/2`.
2. **Audit statis artefak**: jalankan `pnpm pos:export` segar,
   lalu klasifikasikan *setiap* referensi sumber daya (script,
   style, img, font, connect) di HTML & JS hasil ekspor terhadap
   direktif CSP di atas — nol referensi di luar yang diizinkan;
   skrip inline terhitung persis sebagai yang dicakup
   `'unsafe-inline'`.
3. `pnpm pos:export` exit 0; harness Rust tetap 64/64 (CSP tidak
   menyentuh logika Rust).

**Sisa utang bukti lapangan (dinyatakan, tidak ditutupi):**
rendering webview sungguhan di bawah CSP ini — perilaku WebKitGTK
terhadap skrip flight inline, saluran IPC Windows terhadap
`connect-src`, dan jendela display runtime — hanya dapat dibuktikan
di mesin ber-GTK/Windows. Masuk daftar uji lapangan AUD-009 yang
sudah ada; laporan R4 mencatat K-7 sebagai *terpasang &
terverifikasi statis*, bukan *terbukti di lapangan*.

**Rollback.** Kembalikan satu kunci `csp` menjadi `null` (satu
commit).

**Metrik sesudah & ambang.** `tauri info` exit 0; audit statis
0 pelanggaran; ekspor & harness hijau.

**Ukuran & pemilik berkas.** Sedang (perubahannya satu nilai;
penalaran & verifikasinya yang besar). Pemilik:
`src-tauri/tauri.conf.json` saja.

---

## K-8 · Agregasi akumulasi penyusutan (urutan 8 — prioritas rendah, bersyarat)

**Tujuan & bukti.** R1 §6.5: `getAccumulatedDepreciation`
(`src/server/fixed-assets.ts:359`) menarik **semua** baris
penyusutan satu aset (join ke runs) lalu menjumlah di JS, dan
dipanggil per aset di dua tempat: loop run penyusutan bulanan
(:436) dan baca daftar aset (:658) — pola N+1 yang terbukti dari
kode. Pemakaian tunggal di pelepasan (:576) wajar dan tidak
disentuh. Dampak hari ini kecil (aset minimarket puluhan), jadi
kandidat ini **prioritas rendah**.

**Penilaian murah & aman: YA, disertakan dengan syarat.**
Perubahan terkungkung satu berkas; satu kueri agregat menggantikan
N kueri; semantik penjumlahan identik (SUM atas `numeric` di
PostgreSQL eksak, sama dengan penjumlahan Decimal.js atas string
`numeric(19,4)` — tak ada pembulatan di kedua sisi). Syarat
penyertaan: dikerjakan hanya sesudah K-1..K-7 hijau; bila gerbang
R3 menyempit, K-8 **boleh ditunda tanpa menghalangi penutupan R3**
dan dicatat di laporan R4 sebagai sisa terjadwal.

**Perubahan persis.** Di `src/server/fixed-assets.ts`: tambah
`getAccumulatedDepreciationMap(tx, companyId, assetIds)` — satu
kueri `SELECT asset_id, SUM(amount) … JOIN runs … WHERE company
= ? AND runs.status = 'posted' GROUP BY asset_id` (filter persis
helper lama); loop run bulanan (:436) dan baca daftar (:658)
memakai peta itu (aset tanpa baris = 0); helper tunggal :359
dipertahankan untuk pelepasan :576; `monthlyDepreciationAmount`
tidak diubah.

**Risiko & mitigasi.** Selisih filter status run antara kueri
lama dan baru akan mengubah angka diam-diam — mitigasi: test
paritas di bawah memuat run berstatus non-posted yang wajib tetap
terkecuali. Berkas ini juga milik K-2 — K-8 selalu sesudah K-2
selesai di berkas yang sama (urutan menjamin).

**Rollback.** Revert commit K-8.

**Test pembuktian.** Paritas: fixture beberapa aset × beberapa run
penyusutan (termasuk satu run non-posted) → nilai peta ==
penjumlahan per-aset cara lama untuk setiap aset, termasuk aset
tanpa baris (= 0); nominal total run bulanan pada fixture identik
sebelum/sesudah; test yang ada tetap hijau
(`tests/sim2/fixed-assets.test.ts` + integrasi aset terkait).

**Metrik sesudah & ambang.** Kueri akumulasi per run bulanan dari
1 + N menjadi konstan (1 agregat); angka paritas identik; suite
hijau.

**Ukuran & pemilik berkas.** Kecil. Pemilik:
`src/server/fixed-assets.ts` (+ test paritas).

---

## 9 · Penilaian tumpang tindih & keamanan urutan

- **K-2 ∩ K-8** (`fixed-assets.ts`): satu-satunya tumpang tindih
  berkas. Urutan menempatkan K-8 terakhir, sesudah K-2 ter-commit
  dan hijau — tidak ada penyuntingan bersamaan.
- **K-1** tidak berbagi berkas dengan kandidat mana pun selain pin
  `tests/unit/health.test.ts` (unik miliknya).
- **K-4** hanya lockfile + `package.json`; ditempatkan sesudah
  perubahan kode (K-1..K-3) agar bila gerbang merah, sumbernya
  tidak ambigu antara kode dan runtime.
- Kandidat berisiko didahulukan saat energi verifikasi penuh:
  kebocoran aktif (K-3) dan migrasi (K-1) di posisi 1–2; sisanya
  menurun menurut radius dampak.
- Setiap kandidat dikerjakan sebagai **satu commit khusus** oleh
  Pemimpin R3 sesudah gerbang terarahnya hijau — rollback per
  kandidat selalu revert satu commit (K-1: migrasi kompensasi).

## 10 · Gerbang akhir R3

Dari **reseed bersih**, tanpa pipa penutup (exit code dibaca per
perintah, pelajaran gerbang program):

1. Reseed demo (`pnpm db:seed -- --force` dengan `.env.local`
   di-source) → baseline 65 produk, nilai persediaan
   Rp28.349.600.
2. Suite penuh `pnpm test` — baseline 2039/2039 **plus** test baru
   K-2 (paritas), K-3 (muatan biaya), K-5 (kesegaran sesi),
   K-6 (render), K-8 (paritas penyusutan).
3. `pnpm typecheck` exit 0; `pnpm lint` 0 error; `pnpm build`
   exit 0.
4. E2E dengan reseeding otomatis (`BISA_E2E_RESEED=1`) — 25/25.
5. Uji negatif RLS (gaya A1) dan izin (K-3) diulang dan lulus.
6. EXPLAIN sesudah K-1 pada dataset volume yang dibangun ulang
   (lalu perusahaan volume di-wipe) — ambang §K-1.
7. `scripts/audit/db-integrity.sql` — semua cek pelanggaran 0.
8. Desktop: `pnpm pos:export` exit 0; harness Rust 64/64;
   `pnpm tauri info` valid dengan CSP K-7 terpasang.
9. Backup + restore drill LULUS dari dump pasca-migrasi 0066.
