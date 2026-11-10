# Laporan Rekayasa — Bisa ERP

> **Program Rekayasa, Tahap R4 (penutup) — 2026-11-08.**
> Mandat pemilik: rekayasa berbasis dokumentasi resmi versi terpasang
> (documentation-first: baca dokumentasi → riset praktik terbaik →
> analisis kode → identifikasi gap → rencanakan → implementasikan →
> uji ulang), tanpa optimasi prematur (setiap optimasi wajib
> benchmark sebelum/sesudah + risiko), tanpa rewrite besar, tanpa
> ganti teknologi, tanpa upgrade sembarangan, dan tanpa mengubah
> logika bisnis yang sudah terbukti benar.
>
> Sumber bukti program: `docs/rekayasa/INVENTARIS-TEKNOLOGI.md`
> (R0), `docs/rekayasa/MATRIKS-GAP.md` (R0 + status R1/R2/R3),
> `docs/rekayasa/ANALISIS-R1.md` (R1), `docs/rekayasa/
> ADR-ISOLASI-TRANSAKSI.md` (R1), `docs/rekayasa/RENCANA-R2.md`
> (R2), `docs/rekayasa/HASIL-R3.md` (R3), dan
> `docs/audit/LAPORAN-AUDIT-PRODUKSI.md` (verdict CONDITIONAL GO
> yang dinilai ulang di §J laporan ini). Tahapan ter-commit
> berurutan: R0 `a337de1` · R1 `75d0b4a` · R2 `5010817` ·
> R3 `343e535`. Laporan ini ditulis di R4 di atas `343e535`, tanpa
> perubahan kode.
>
> Program ini berjalan SESUDAH Program Audit Produksi (A0–A5)
> dinyatakan tuntas. Hal yang sudah dibuktikan audit itu (cakupan
> izin 201/201 aksi, RLS hidup, 9 rantai integrasi PASS, matriks
> peran 23/23, integritas DB) **tidak diaudit ulang** — program ini
> menilai kesesuaian terhadap dokumentasi resmi dan hanya menyentuh
> yang terbukti gap atau terukur bottleneck.

---

## A. Dokumentasi & Riset

**Metode.** Documentation-first secara harfiah: tahap R0 dimulai
dari riset dokumentasi resmi per teknologi (±55 baris matriks benih,
8 area, tersimpan di
`~/workspace/research_notes/erp-stack-official-docs-best-practices-20261108-0530/report.md`),
lalu setiap baris riset **dibuktikan terhadap kode aktual** sebelum
menjadi baris matriks — matriks bukan daftar dosa: 21 dari 38 baris
ternyata sudah SESUAI. Tahap R1 mengukur (EXPLAIN nyata, spike
konfigurasi yang dikembalikan, uji patch di worktree terpisah);
R2 mengubah hanya kandidat ber-bukti menjadi rencana; R3
mengimplementasikan 8 kandidat; R4 memverifikasi ulang semuanya
dari reseed bersih (§H).

**Versi yang diverifikasi dari lockfile** (bukan specifier):
Next.js 16.4.3 → **16.4.5** (sesudah K-4) · React 19.3.0 ·
TypeScript 5.9.3 · Drizzle ORM 0.45.4 / kit 0.31.11 · postgres.js
4.0.0 · Better Auth **1.7.15** · **Zod 4.6.7 — definitif mayor 4**
(pertanyaan terbuka riset tertutup: tidak ada migrasi Zod yang
perlu direncanakan; hanya utang idiom) · Decimal.js 10.6.0 ·
Tailwind CSS 4.3.3 · Base UI 1.9.0 / shadcn 4.23.0 · Vitest 5.0.5 ·
Playwright 1.64.1 · Tauri CLI/API 2.12.4 · PostgreSQL 18 ·
Node v24.22.1. Semantik yang menentukan implementasi diverifikasi
dari sumber terpasang itu sendiri bila dokumentasi daring tidak
cukup: semantik `freshAge` Better Auth 1.7.15 dibaca dari paket
terpasang (membandingkan `session.createdAt`; refresh tidak pernah
menyentuhnya), dan kebutuhan `ipc.localhost` pada CSP Tauri
diverifikasi dari dokumentasi resmi Tauri v2 (contoh resminya
memakai `connect-src: ipc: http://ipc.localhost`).

**Yang TIDAK terverifikasi, dan alasannya (dinyatakan, bukan
ditutupi):**

- **Drizzle ORM per-minor**: dokumentasi resmi Drizzle tidak
  berversi; klaim perilaku minor (0.44 vs 0.45) tidak dapat
  diverifikasi dari dokumen — matriks hanya memakai perilaku yang
  teramati pada 0.45.4 terpasang.
- **Decimal.js**: dokumentasi resmi tidak ditemukan oleh riset
  (hanya cermin pihak ketiga) — baris terkait ditandai sesuai itu;
  perilaku uang tidak bergantung pada klaim yang tak terverifikasi
  ini karena terpusat di `src/lib/money.ts` dan teruji.
- **Next.js 16.4.3 spesifik**: tidak ada catatan rilis resmi per
  patch .3; yang dipakai adalah posting 16.4 + panduan upgrade v16.
  Applicability advisori Oktober 2026 dinilai **manual per
  advisori** dari sumber resmi (R1 §3) karena `pnpm audit` tidak
  terjangkau dari lingkungan ini (AUD-004 tetap NOT VERIFIED —
  lihat §G).
- **PostgreSQL `pg_trgm`**: dikutip dari dokumentasi devel
  (halaman 18 tidak terjangkau terpisah) — barisnya tetap di jalur
  register AUD-022, tidak dieksekusi program ini.
- **OWASP ASVS 5.0**: struktur bab terverifikasi (penomoran baru
  V2/V6/V7/V8/V11); nomor syarat per-butir di luar struktur bab
  tidak diklaim.
- **Rendering webview Tauri**: tidak dapat diverifikasi di mesin
  ini (VM tanpa GTK/WebKit) — berlaku untuk K-7 dan seluruh
  permukaan desktop (AUD-009, §G).

---

## B. Arsitektur

**Kondisi akhir — yang dipertahankan karena terbukti sesuai:**
arsitektur monolit modular tidak berubah bentuk. Lapisan otorisasi
tetap DAL di samping data (`src/lib/session.ts`, `server-only`,
React `cache()`), domain berparameter `tx` di `src/server/*`, aksi
mengembalikan DTO bentukan lewat `guard(...)` — sampel DTO 10 aksi
di R1 menemukan 9 bersih; pengecualian tunggalnya menjadi K-3
(§G). Aturan read-path ARS1-01 dan penjaga arsitekturnya tetap
menegakkan pemisahan halaman ↔ fungsi baca bernama. Tidak ada
lapis proxy/middleware yang ditambahkan: otorisasi di DAL terbukti
(Audit Produksi A1/A3), dan rekomendasi resmi pun menyatakan proxy
bukan otorisasi.

**Yang berubah di program ini (arsitektural):**

1. **Strategi isolasi kini tertulis** —
   `ADR-ISOLASI-TRANSAKSI.md`: Read Committed di mana-mana (nol
   `isolationLevel` eksplisit) + 74 titik kunci baris `.for("update")`
   terinventarisasi di 36 berkas + constraint unik sebagai penjaga
   buat-sekali (pola payroll) + aturan urutan kunci. Polanya sudah
   benar dan terbukti uji konkurensi (Audit Produksi A3: 5/5
   penjualan bersamaan, stok tepat); yang ditutup program ini
   adalah sifat *implisitnya* — risiko regresi oleh penyunting
   baru, bukan oleh kode lama.
2. **Satu algoritma `ensureSystemAccounts`** (K-2): tiga
   implementasi "pastikan akun sistem" (potongan gaji, payroll
   Indonesia, aset tetap) menjadi satu helper
   `src/server/system-accounts.ts` bermekanik peta-memori; tiga
   nama publik dipertahankan sebagai pembungkus tipis. Delta
   perilaku disengaja terdokumentasi: pada skenario tabrakan
   nama+kode, ikatan **kode** kini menang di ketiga domain (warisan
   mekanik fixed-assets) — dibuktikan test karakterisasi yang
   ditulis sebelum refactor (15/17 pada kode lama, tepat 2 skenario
   tabrakan yang berbeda) dan lulus 17/17 sesudahnya **tanpa test
   diubah**.
3. **Kebijakan RLS berbentuk InitPlan** (K-1, migrasi 0066):
   97 kebijakan `tenant_isolation` dibungkus `(select
   app_company_id())`; semantik identik (fungsi STABLE atas GUC
   yang disetel sekali per transaksi), ekuivalensi dibuktikan uji
   negatif ulang (§F).

**Yang DITOLAK dengan alasan tertulis (keputusan, bukan sisa
pekerjaan):**

- **Cache Components Next** (`'use cache'`): BERISIKO untuk
  halaman request-time bertenant — kelas risikonya adalah
  kebocoran antar-tenant; manfaat tak terbukti. `cacheComponents:
  false` adalah keputusan sadar yang dipertahankan.
- **Drizzle Relational Query Builder**: 0 pemakaian disengaja —
  RQB tidak mendukung agregasi yang dominan di laporan, dan pola
  read-path repo adalah keputusan arsitektur yang ditegakkan test.
- **Testcontainers**: pola Vitest terhadap PG 18 dev nyata +
  perusahaan fixture + teardown terbukti menangkap perilaku
  isolasi/RLS; mengganti infrastruktur sehat tanpa kebutuhan
  terbukti ditolak (nilai ulang hanya bila CI terkontainer menjadi
  target).
- **Pengaktifan global flag TS** `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`: terukur **5.920 error** (87% di
  test) — ditunda sebagai program terpisah (§I), bukan ditolak
  selamanya.
- **`proxy.ts`, kunci advisory, menaikkan isolasi global,
  akun-per-worker Playwright, form actions React 19**: masing-
  masing BELUM PERLU dengan alasan per baris di matriks — tidak
  ada kebutuhan terbukti pada topologi & skala hari ini.

---

## C. Kualitas Kode

**Matriks gap: 38 baris — SEBELUM vs SESUDAH program.**
Hitungan SEBELUM adalah ringkasan resmi R0. Dua baris membawa
kelas ganda di R0 (R0-07 = WAJIB menilai + DIANJURKAN naik patch;
R0-13 = SESUAI pola + DIANJURKAN dokumentasikan), sehingga
penjumlahan kelas bukan partisi unik per baris; disposisi SESUDAH
di bawah dapat diaudit per nomor baris di `MATRIKS-GAP.md`.

| Kelas (R0) | Sebelum | Sesudah program |
|---|---|---|
| SESUAI | 21 | **27** — 21 awal tetap sesuai (satu, R0-01, sempat memuat temuan turunan yang ditutup K-3) + 6 baris gap tertutup di bawah |
| WAJIB | 2 | **0 terbuka** — R0-07 tertutup (dinilai tidak terdampak di R1; patch diterapkan K-4) · R0-38 tertutup sebagai konfigurasi (K-7; sisa utang bukti lapangan berpindah ke AUD-009, bukan gap konfigurasi) |
| DIANJURKAN | 7 | **4 tertutup** (R0-09→K-6, R0-13→ADR, R0-17→K-1, R0-21→K-5) · **1 tertulis sebagai gerbang** (R0-24 multi-instance, §I) · **1 ternilai-ditunda** (R0-31, §I) · **1 sengaja tidak disentuh** (R0-19 trigram — tetap jalur register AUD-022) |
| BELUM PERLU | 6 | **6 dipertahankan** dengan alasan per baris (proxy, form actions, kunci advisory, RQB, akun-per-worker, Testcontainers) |
| BERISIKO (sebagai tindakan) | 2 | **2 diputuskan** — R0-08 Cache Components ditolak dengan alasan · R0-31 pengaktifan flag ditunda terukur sebagai program terpisah |

Di luar matriks, dua temuan R1 ikut tertutup: sumber kebenaran
ganda `ensure*Accounts` ×3 (K-2) dan pola N+1 penyusutan (K-8).

**Duplikasi (jscpd).** Pengukuran R1 atas `src/` (ambang 12 baris /
80 token): 83 klon persis, 1.802 baris terduplikasi = **1,11%**
dari 911 berkas. Angka A-26/A1 (2,15% / 2,12%) memakai ambang
berbeda dan **tidak dibandingkan langsung**. Klon algoritmik
terbesar (ensure ×3) sudah hilang oleh K-2. Yang tersisa dan
tercatat jujur: duplikasi *presentasi* — panel UI kasbon ↔ pinjaman
(±290 baris; domainnya sengaja terpisah) dan panel cuti ↔ shift
HR (121 baris) — kandidat penggabungan komponen hanya bila area
itu disentuh, bukan pekerjaan program ini (§I).

**Kontrak kualitas A-26 tetap utuh.** Penjaga arsitektur
(ratchet ukuran berkas, batas modul, siklus impor, read-paths,
settings-reads, penulis-tabel) tidak dilemahkan di seluruh
program; suite R4 hijau **termasuk** keenam berkas penjaga itu.
Satu-satunya penyesuaian kontrak berjalan lewat jalur resmi
penjaga itu sendiri: sentralisasi K-2 mengubah himpunan penulis
tabel `accounts`/`accountMappings`, maka `docs/MODULE_BOUNDARIES.md`
§6 dan peta beku pada test penulis-tabel diperbarui **dalam
perubahan yang sama, dengan alasan tertulis** — pola & ambang
penjaga tidak berubah. Konsistensi pola lain yang diperiksa R1
dan bersih: `guard()` pada 100% aksi terekspos; ekspor laporan
memakai fungsi baca yang sama dengan halaman (tidak ada sumber
kebenaran ganda halaman-vs-ekspor).

---

## D. Efisiensi & Performa

Semua angka dari dataset volume Audit Produksi A3 yang dibangun
ulang persis (satu perusahaan buangan: 10.000 produk · 25.000
penjualan · 100.000 baris penjualan · 50.000 baris jurnal ·
10.000 baris stok), `EXPLAIN (ANALYZE, BUFFERS)` sebagai
`app_user`, median 3 larian. Perbandingan terpasang-vs-lama untuk
Q1b/Q3/Q4 dibuktikan dengan A/B bentuk-lama pada dataset yang
sama di dalam transaksi rollback (metode R1).

| Kueri / jalur | Sebelum | Sesudah (terpasang) | Vonis |
|---|---|---|---|
| **Q5 agregasi bulan parsial** (`cumulativeAccountTotals` — jalur neraca saldo/buku besar) | **14,81 ms** | **7,11 ms** | **−52%, di bawah ambang R2 ≤ 7,5 ms ✔** (varian rollback R1 mengukur 5,21 ms; angka terpasang 7,11 dari larian & keadaan rencana berbeda — keduanya jauh di bawah bentuk telanjang). Mekanisme: pembungkus `(select …)` menjadi InitPlan konstan → planner memakai indeks komposit `(company_id, date)` pada `journal_entries` yang pembatasannya hanya datang dari RLS |
| Q1a hitung produk | 4,11 ms | 3,81 ms | Netral (noise) |
| Q1b halaman produk | 0,19 ms | 1,53 ms | **Bukan regresi** — A/B dataset-sama bentuk lama = 1,56 ms; selisih antar-larian berasal dari keadaan rencana/dataset, bukan bentuk kebijakan |
| Q2 pencarian teks produk | 15,65 ms | 14,87 ms | Netral — biayanya Seq Scan ILIKE (AUD-022), memang bukan sasaran K-1 dan tidak disentuh |
| Q3 riwayat penjualan | 0,04 ms | 0,61 ms | **Bukan regresi** — A/B bentuk lama = 0,57 ms |
| Q4 buku besar akun kas | 0,40 ms | 35,34 ms | **Bukan regresi** — A/B bentuk lama = 34,94 ms; gabung 25 rb baris + sort top-N mendominasi di kedua bentuk pada dataset ini; angka R1 berasal dari keadaan rencana lain |
| Akumulasi penyusutan aset tetap (K-8) | N kueri (1 per aset) + tarik semua baris & jumlah di JS | **1 kueri** `SUM … GROUP BY asset_id` | Perbaikan *bentuk* yang terbukti dari kode; dampak praktis kecil pada jumlah aset minimarket (puluhan) — dinyatakan sebagai koreksi pola, **bukan** kemenangan benchmark |

**Yang dinyatakan netral / tanpa klaim performa:** kenaikan patch
Next (K-4), sentralisasi akun sistem (K-2), penyaringan biaya
(K-3), sesi segar (K-5), batas kesalahan (K-6), CSP desktop (K-7)
— semuanya perubahan kebenaran/keamanan; tidak ada angka performa
yang diklaim untuk mereka.

**Batas klaim (diwarisi A3/A5, tidak berubah):** terukur hanya
SATU perusahaan pada volume itu di mesin dev. Belum terukur:
100 rb+ dokumen penjualan, banyak perusahaan aktif bersamaan,
beban tulis campuran berkelanjutan, perangkat keras kelas
produksi. Manfaat K-1 terkonsentrasi pada agregasi laporan yang
menggabung tabel tanpa predikat perusahaan eksplisit, dan tumbuh
seiring volume jurnal; permukaan laporan selebihnya tetap
terpantau di AUD-023 (§I).

---

## E. Kelengkapan Fungsional

**Program ini tidak mengubah fungsi bisnis apa pun — dinyatakan
eksplisit.** Kelengkapan fungsional tetap persis seperti yang
dibuktikan Audit Produksi (`docs/audit/MATRIKS-FITUR.md`):
**82 halaman = 81 IMPLEMENTED, 1 PARTIAL** (admin terminal
desktop — kontrak API terbukti, GUI NOT TESTED per AUD-009);
NOT IMPLEMENTED bernama tetap dua dan tetap atas keputusan
pemilik: PIN supervisor POS (AUD-006) dan QRIS dinamis via PSP
(AUD-007). Tidak ada halaman, alur, aturan harga/stok/jurnal,
atau perilaku transaksi yang ditambah, dikurangi, atau diubah
oleh R0–R4; aturan bisnis yang terbukti benar di audit
dipertahankan apa adanya.

Dua perubahan yang menyentuh permukaan pengguna adalah
**pengerasan, bukan fitur baru**:

- **K-3** menyelaraskan gerbang bidang biaya yang sudah ada:
  tiga aksi pemilih produk kini memperlakukan `costPrice`
  (dan `buyPrice` kemasan) persis seperti ekspor & halaman nilai
  persediaan sejak perbaikan AUD-013 — tampil hanya untuk
  pemegang `inventory.cost`, selain itu `null` (bukan error).
  Perilaku posting tidak berubah: domain opname selalu memakai
  biaya dari DB, bukan dari muatan aksi.
- **K-5** menambahkan syarat kesegaran sesi (masuk ≤ 1 jam) pada
  10 titik sensitif yang sudah bergerbang izin (6 aksi
  pengguna/peran, 3 aksi periode/tutup tahun, ekspor payroll).
  Tidak ada izin baru, tidak ada alur baru; POS sengaja
  dikecualikan dan pengecualian itu dibuktikan test kontrol
  negatif.
- **K-6** (error.tsx root & global) hanya mengubah *bingkai
  tampilan kegagalan* di luar segmen `/app`; **K-7** hanya
  konfigurasi keamanan shell desktop.

---

## F. Integritas Database & Finansial

**Satu-satunya migrasi program ini adalah 0066**
(`0066_rls_initplan_policies.sql`) — dan ia tidak menyentuh skema
data bisnis sama sekali: tidak ada tabel/kolom/indeks bisnis yang
ditambah, diubah, atau dihapus. Isi migrasi: satu blok DO dengan
assertion hitungan SEBELUM = 97, membungkus tepat **97 kebijakan
`tenant_isolation`** ke bentuk `(select app_company_id())`,
assertion SESUDAH = 97 terbungkus. Dua kebijakan digest perangkat
migrasi 0060 (jalur pra-tenant `pos_terminals` &
`pos_pairing_codes`) **tidak disentuh** dan terverifikasi utuh.
`db:generate` ulang sesudah migrasi: "No schema changes" — drift
skema 0. Konsistensi migrasi kini 67 berkas = 67 jurnal meta =
67 baris DB (cek F1 db-integrity di gerbang R4 = 67).

**Ekuivalensi RLS dibuktikan, bukan diasumsikan:** sesudah 0066,
uji negatif gaya A1 diulang sebagai `app_user` dan LULUS — tanpa
konteks perusahaan → 0 produk; konteks demo → tepat 65;
perusahaan lain → 0; INSERT lintas-tenant ditolak kebijakan;
UPDATE lintas-tenant → 0 baris. Fungsi yang dibungkus STABLE dan
membaca GUC yang disetel sekali per transaksi oleh `withCompany`,
jadi nilai per pernyataan identik dengan nilai per baris
sebelumnya.

**Invarian finansial & stok tidak berubah dan terverifikasi
ulang di gerbang R4:** jurnal posted tak seimbang 0, tanpa baris
0, `stock_on_hand ≠ Σ movements` 0, FK yatim 0 — seluruh
pemeriksaan `scripts/audit/db-integrity.sql` bernilai **0 secara
global** pada gerbang final (§H), sesudah pembersihan residu
fixture resmi. **Drill backup→restore LULUS** dua kali di
program ini: di R3 dari dump pasca-0066, dan di gerbang R4 dari
dump segar — jumlah akun/produk/nilai persediaan/selisih neraca
saldo (0) cocok persis sumber↔restore. Posting tetap melewati
gerbang tunggal `postJournal`; jurnal terposting tetap
append-only; tidak ada baris data bisnis yang ditulis ulang oleh
program ini.

---

## G. Keamanan & Reliabilitas

**Yang dikeraskan program ini:**

- **K-3 — kebocoran bidang biaya kelas AUD-013 tertutup penuh.**
  Temuan turunan R1 (sampel DTO): `loadOpnameProductsAction`
  mengirim `costPrice` di balik `inventory.view` saja. Pemetaan
  R2 memperluas cakupan dari 1 menjadi **3 aksi** yang menyuplai
  pemilih produk bersama (`searchInventoryProductsAction`,
  `resolveBarcodeAction`, `loadOpnameProductsAction`) — memperbaiki
  satu aksi saja akan menyisakan kebocoran yang sama. Test:
  5 kasus viewer gagal pada kode lama, 9/9 lulus sesudahnya.
- **K-5 — kesegaran sesi untuk tindakan sensitif.**
  `session.freshAge: 3600` + `requireFreshSession()` pada 10
  titik bernama; penolakan berbentuk `AppError FORBIDDEN`
  berpesan masuk-ulang. Semantik diverifikasi dari sumber Better
  Auth 1.7.15 terpasang sebelum menerapkan (refresh sesi tidak
  menyentuh `createdAt`, jadi ukuran umurnya jujur). Test 6/6
  termasuk batas 3599/3600/3601 detik dan kontrol negatif.
- **K-7 — CSP desktop terpasang.** `tauri.conf.json` kini menyetel
  CSP produksi restriktif per direktif (diturunkan dari artefak
  ekspor nyata: skrip inline flight RSC membenarkan
  `'unsafe-inline'` pada script-src; JS desktop nol `fetch(` —
  seluruh HTTP milik Rust — sehingga connect-src tertutup kecuali
  saluran IPC Tauri) + `devCsp` longgar hanya untuk dev.
  Terverifikasi statis: `tauri info` exit 0, audit artefak ekspor
  bersih (0 URL eksternal, 0 `eval(`), harness Rust 64/64.
  **Sisa utang dinyatakan eksplisit: rendering webview sungguhan
  dengan CSP ini BELUM teruji** — VM tanpa GTK; ini bagian dari
  AUD-009 dan hanya tertutup oleh uji lapangan (§J syarat 2).
- **K-4 — mata uang patch.** Next 16.4.3 → 16.4.5; penilaian R1
  membuktikan 16.4.3 **tidak terdampak** advisori keamanan
  Oktober 2026 (rentang GHSA-p3m5 `>=16.4.0 <=16.4.0`; prasyarat
  konfigurasi advisori lain absen; sharp sudah 0.35.5), jadi
  kenaikan ini pemeliharaan rutin yang teruji drop-in (gerbang
  penuh hijau, nol test diubah untuk lulus) — bukan penambalan
  lubang terbuka.
- **K-6 — batas kesalahan root/global** menutup permukaan publik
  (login, root) yang sebelumnya jatuh ke bingkai bawaan framework.

**Yang TIDAK berubah (jujur):** audit kerentanan dependensi
**AUD-004 tetap NOT VERIFIED** — endpoint advisori npm tetap
tidak terjangkau dari lingkungan ini (403 `policy_denied` oleh
proksi); penilaian manual per-advisori R1 bukan pengganti
`pnpm audit` di CI berjaringan. Pin tarball CDN `xlsx` (AUD-012)
tetap seperti semula, terkunci lockfile berintegritas. Header
keamanan web & CSP konservatif dari A4 tidak disentuh. Kebijakan
kata sandi (AUD-018) dan seluruh keputusan pemilik di §I tidak
diubah diam-diam oleh program ini.

---

## H. Bukti Testing

**Gerbang final R4 (independen, dari reseed bersih, exit code per
perintah, tanpa pipa penutup):**

| Gerbang | Hasil R4 | Harapan |
|---|---|---|
| Reseed demo | exit 0 — 65 produk, nilai persediaan Rp28.349.600 | sama ✓ |
| Suite penuh | **2077/2077 (218 berkas), exit 0 — larian pertama** | 2077/2077 ✓ |
| Typecheck | exit 0 | exit 0 ✓ |
| Lint | exit 0 — 0 error, 29 warning warisan | 0 error ✓ |
| Build produksi | exit 0 (Next 16.4.5) | exit 0 ✓ |
| E2E (`BISA_E2E_RESEED=1`, urutan suite→e2e) | **25/25, exit 0** | 25/25 ✓ |
| db-integrity | exit 0 — **semua cek pelanggaran 0 secara global** (A1–A5, B1–B4, C1–C6c, D1, E1–E2, G1–G4; F1 = 67 migrasi; sesudah pembersihan residu fixture resmi — residu terverifikasi 0 sebelum pengukuran) | 0 ✓ |
| Backup + drill restore | backup exit 0 (`backups/bisa-20261108-072057.dump`); **drill LULUS exit 0** — jumlah produk 65, nilai persediaan, selisih neraca saldo 0 cocok sumber↔restore; DB uji dihapus | LULUS ✓ |
| `pos:export` / `tauri info` | exit 0 / exit 0 | exit 0 ✓ |
| Harness Rust (berkas-sama) | **64/64**, exit 0 | 64/64 ✓ |

Catatan larian, apa adanya: gerbang R4 hijau **pada larian
pertama** — keluarga flake balapan AUD-008 yang mereproduksi di
gerbang A5 (dan dua kali selama R3) **tidak muncul** kali ini;
itu tidak mengubah status MONITOR-nya (§I), karena tidak ada
perbaikan akar yang diklaim untuknya di program ini. Pemulihan
lingkungan selama R4: PostgreSQL sempat mati (VM) dan dipulihkan
dengan prosedur baku sebelum reseed; tidak ada dampak ke hasil.

**Akumulasi test program:** suite tumbuh **2039 → 2077 test
(213 → 218 berkas)** = **+38 test baru R3**, semuanya ditulis
dengan pola gagal-sebelum/lulus-sesudah atau karakterisasi:
penyaringan biaya picker (9), paritas `ensureSystemAccounts`
(17), sesi segar (6), batas kesalahan (3), paritas penyusutan
(3) — ditambah pin versi health yang diperbarui ke migrasi 0066.
Nol test lama diubah untuk meluluskan perubahan, kecuali dua
penyesuaian yang terdokumentasi alasannya di `HASIL-R3.md`:
pembaruan peta beku penulis-tabel (jalur resmi penjaga, §C) dan
pembuangan satu properti fixture yang bukan kolom skema pada
test K-8 baru (ditangkap typecheck; perilaku test tidak berubah).
E2E tetap 25 spec; test API perangkat (18) berada di dalam suite;
harness Rust tetap 64/64.

---

## I. Remaining Issues

Daftar jujur — tidak ada yang dieksekusi diam-diam oleh program
ini; sebagian adalah keputusan pemilik yang sama dengan laporan
Audit Produksi, sebagian tindak lanjut terpantau:

1. **Flag TypeScript tambahan = program terpisah (R0-31).**
   Terukur 5.920 error (tests 5.151 · src 718 · scripts 42 ·
   e2e 9); urutan yang benar bila kelak dikerjakan: pisahkan
   tsconfig aplikasi vs test, panen `src/` dulu (domain posting
   lebih dulu), test menyusul. Posisi hari ini — `strict: true`
   + cakupan uji yang ada — dipertahankan secara sadar.
2. **Gerbang multi-instance (R0-10/R0-16/R0-24) — tertulis,
   belum terpicu.** Sebelum >1 instance aplikasi atau perubahan
   proksi/pooler: tetapkan `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
   bersama; pindahkan penyimpanan rate-limit dari memori ke
   database + nilai ulang aturan sign-in (10/60 dtk → contoh
   resmi 3/10 dtk) + konfigurasi sumber IP eksplisit; setel
   `prepare: false` bila ada pooler mode-transaksi. Hari ini
   topologi instance-tunggal terbukti aman.
3. **AUD-022 — indeks trigram pencarian (OPEN).** Q2 tetap
   14,87 ms (Seq Scan ILIKE, linear terhadap katalog) — program
   ini membuktikan K-1 bukan obatnya dan tidak mengklaimnya.
   Kerjakan bila katalog/pencarian membesar.
4. **AUD-023 — permukaan laporan (MONITOR, sebagian teringankan).**
   Jalur agregasi bulan parsial kini ±2× lebih cepat oleh K-1;
   buku besar & laporan selebihnya tetap permukaan baca terberat
   dan terpantau apa adanya.
5. **AUD-008 — keluarga flake balapan test (MONITOR).** Tidak
   muncul di gerbang R4, muncul di A5 & R3; invarian data selalu
   terpegang. Rekomendasi lama tetap berlaku: samakan bentuk
   error pihak kalah pada jalur idempotensi di bawah kontensi —
   pekerjaan ketahanan test terpisah, bukan cacat data.
6. **AUD-011 — 29 warning lint warisan** (0 error): tidak
   bertambah, tidak berkurang di program ini; pembersihan
   oportunistik.
7. **AUD-012 + AUD-004 — pin CDN `xlsx` & audit dependensi:**
   tertutup hanya oleh CI berjaringan (§J syarat 1).
8. **Keputusan pemilik — TIDAK berubah oleh program ini:**
   PIN supervisor POS (AUD-006, P1); QRIS dinamis via PSP
   (AUD-007); minimum kata sandi ke anjuran NIST (AUD-018);
   scheduler `a24-lanjut-otomatis` (AUD-010); matriks ECL;
   renumber bagan akun per perusahaan (alat siap); tindakan
   lapangan desktop — cadangan kunci privat updater, sertifikat
   Authenticode Windows, kanal AppImage vs .deb, uji lapangan
   kios (AUD-009).
9. **Duplikasi presentasi tercatat (bukan temuan baru):** panel
   kasbon ↔ pinjaman (±290 baris) & cuti ↔ shift HR (121 baris)
   — gabungkan hanya bila area itu disentuh.
10. **Modernisasi idiom Zod 4** (`z.uuid()`, `treeifyError`):
    BELUM PERLU — kerjakan insidental per berkas, bukan program.

---

## J. Production Readiness — Verdict Program

Audit Produksi menutup dengan **CONDITIONAL GO** (operasional
web; desktop belum termasuk) bersyarat empat:

1. `pnpm audit` di CI berjaringan sebelum deploy produksi
   (AUD-004);
2. uji lapangan desktop nyata sebelum POS desktop operasional
   (AUD-009);
3. keputusan pemilik atas AUD-006/007/018/010;
4. tindak lanjut P3 terpantau (AUD-008/011/022/023).

Penilaian program ini atas keempatnya, berbasis bukti R0–R4:

- **Syarat 1 — TIDAK BERUBAH.** Lingkungan ini tetap tidak dapat
  menjalankan audit advisori dependensi; program ini tidak
  menutupnya dan tidak mengklaimnya tertutup. (Yang berubah hanya
  posisi patch: Next kini 16.4.5 dan terbukti tidak terdampak
  advisori bernama — itu mengurangi permukaan, bukan mengganti
  pemindaian.)
- **Syarat 2 — TIDAK BERUBAH.** K-7 menutup gap *konfigurasi*
  CSP desktop dan verifikasi statisnya, tetapi installer, jendela
  GUI, printer fisik, dan keychain OS tetap belum teruji di mesin
  nyata. POS desktop tetap di luar verdict sampai uji lapangan
  lulus; jalur produksi kasir tetap POS web.
- **Syarat 3 — TIDAK BERUBAH.** Program ini tidak mengambil satu
  pun keputusan pemilik; daftarnya utuh di §I butir 8.
- **Syarat 4 — TERTUTUP SEBAGIAN oleh program ini, dan sisanya
  berubah sifat.** Yang bernama dan dapat ditutup lewat rekayasa
  sudah tertutup: permukaan agregasi laporan terberat pada jalur
  `cumulativeAccountTotals` dipercepat terukur (K-1, §D);
  kebocoran bidang biaya sekelas AUD-013 yang tersisa di aksi
  pemilih produk ditutup (K-3); 29 warning lint (AUD-011) tidak
  bertambah oleh program ini. Sisanya — flake AUD-008, trigram
  AUD-022, pemantauan laporan AUD-023 — adalah pemantauan
  berkala berkriteria pemicu yang jelas, bukan pekerjaan yang
  menahan kesiapan; ia berpindah dari syarat verdict menjadi
  daftar pantau §I.

### Verdict akhir gabungan: **CONDITIONAL GO — tetap, dengan syarat menyempit dari 4 menjadi 3**

Berlaku untuk operasional minimarket lewat **aplikasi web**,
persis batas berlakunya verdict Audit Produksi. Tiga syarat yang
tersisa, semuanya di luar jangkauan rekayasa kode dari mesin ini:
**(1)** jalankan `pnpm audit` di CI berjaringan penuh sebelum
deploy produksi dan tangani/terima-tertulis advisori kritis &
tinggi (AUD-004, sekalian tinjau AUD-012); **(2)** uji lapangan
POS desktop di mesin nyata sebelum desktop dipakai operasional
(AUD-009) — sampai lulus, desktop bukan jalur produksi;
**(3)** keputusan pemilik atas PIN supervisor (AUD-006), QRIS
dinamis (AUD-007), kebijakan kata sandi (AUD-018), dan scheduler
warisan (AUD-010) — dijadwalkan atau diterima sebagai risiko
tercatat.

GO tanpa syarat tetap akan mengklaim hal yang belum terbukti
(kebersihan advisori dependensi & kesiapan desktop di mesin
nyata). NO GO tetap tidak berdasar: program ini menambah bukti
di atas audit — 38 test baru, satu migrasi kebijakan yang
ekuivalensinya teruji negatif, satu kebocoran bidang tertutup,
dan gerbang final R4 yang hijau pada larian pertama dari reseed
bersih — tanpa menemukan satu pun cacat baru pada fungsi,
integritas, atau keamanan yang terbangun.

---

*Program Rekayasa R0–R4 ditutup dengan laporan ini. Matriks gap
tetap hidup di `docs/rekayasa/MATRIKS-GAP.md`; register audit
tetap hidup di `docs/audit/AUDIT-REGISTER.md`. Tidak ada
pekerjaan yang dieksekusi diam-diam di luar daftar §I.*
