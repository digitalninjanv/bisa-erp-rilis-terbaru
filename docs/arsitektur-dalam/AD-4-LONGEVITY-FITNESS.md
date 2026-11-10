# AD-4 — Maintainability Jangka Panjang, Evolvabilitas & Fitness Functions

**Jenis pekerjaan:** analisis BACA-SAJA (tidak ada kode yang diubah; berkas ini satu-satunya keluaran).
**Objek penilaian:** pohon ter-commit **HEAD `67894dc`** (FIX-ARS Tahap 4) + riwayat git (173 commit, satu-satunya branch `main`).
**Bukan objek penilaian:** perubahan FIX-ARS Tahap 5 yang belum ter-commit di pohon kerja saat analisis berjalan.
**Konteks yang dibaca:** `PROGRESS.md` (keputusan D-1..D-25, mandat A-1..A-19), `docs/arsitektur-audit/ARS-4-KETAHANAN-OPERASI.md`, `AGENTS.md`, `README.md`, konfigurasi CI/lint/test, `package.json` + `pnpm-lock.yaml`, dan statistik objek git per tonggak.
**Metode:** grep terarah atas `tests/`, `eslint.config.mjs`, `package.json`; penguraian graf impor runtime dari blob HEAD; statistik LOC per commit tonggak lewat `git ls-tree`/`git show` (tanpa checkout, pohon kerja tidak disentuh); penelusuran keputusan di PROGRESS + pesan commit.

> **Konvensi bukti:** angka dalam laporan ini diukur dari objek git HEAD kecuali disebut lain. Penilaian terhadap lanskap eksternal 2025–2026 ditandai eksplisit sebagai **[penilaian eksternal]** dan dipisahkan dari fakta repo.

---

## Ringkasan vonis

| # | Aspek | Skor |
|---|---|---|
| 1 | Architecture tests / fitness functions | **5,0 / 10** |
| 2 | Trajektori bloat | **6,0 / 10** |
| 3 | Evolvabilitas — risiko lumpur vs over-engineering | **6,5 / 10** |
| 4 | Catatan keputusan (ADR de-facto) | **6,0 / 10** |
| 5 | Kebaruan tumpukan & jalur upgrade 2025–2026 | **7,0 / 10** |
| 6 | Onboarding developer baru | **5,5 / 10** |
| | **Skor dimensi AD-4** | **6,0 / 10** |

**Jawaban inti (dirinci di §1):** batas arsitektur saat ini **tidak ditegakkan oleh architecture test maupun aturan lint batas** — keduanya tidak ada. Yang menegakkan batas adalah, berurutan dari yang paling keras: **(a) invariant database** (trigger, RLS, constraint), **(b) test perilaku/invariant yang sangat tebal** (bukan test struktur), **(c) konfigurasi CI yang sudah ditulis tetapi belum operasional** (repo belum punya remote, jadi workflow belum pernah terpicu), dan **(d) konvensi terdokumentasi + disiplin proses manusia**. Graf impor terukur memang bersih (0 siklus runtime, 0 impor dalam ke modul hasil pecahan), tetapi kebersihan itu hasil kebiasaan yang terverifikasi manual berkala — bukan gerbang otomatis. Satu pelanggaran batas yang ditulis besok tidak akan menggagalkan satu pun pemeriksaan yang ada.

**Risiko dominan 12 bulan (dirinci di §3):** drift menuju lumpur (Big Ball of Mud) lewat titik-titik kopling bersama — skema universal satu berkas, objek `companySettings`, `reports.ts`, jalur baca ganda — **bukan** over-engineering. Over-engineering terukur ada tetapi sempit, periferal, dan dapat dicabut dalam satu pembersihan (dependensi yatim + primitif UI tak terjangkau). Lumpur, sebaliknya, bertambah setiap fitur baru menyentuh hotspot yang sama, dan tidak ada fitness function yang menahannya.

---

## 1. Architecture tests / fitness functions

### 1.1 Yang ADA

**A. Fitness di level database (penegak paling keras, tidak bisa dilewati kode aplikasi).**
Migrasi 0001 memasang 5 trigger bernama: constraint trigger `journal_entries_balanced` (fungsi `assert_journal_balanced` — jurnal wajib seimbang dan bernilai), `journal_entries_immutable`, `journal_lines_immutable` (jurnal posted tidak dapat diubah/dihapus), `stock_movements_append_only`, dan `audit_log_append_only`. Pola RLS `ENABLE + FORCE ROW LEVEL SECURITY + POLICY tenant_isolation` diulang konsisten di setiap migrasi yang menambah tabel tenant — termasuk migrasi terbaru 0046 untuk `account_monthly_balances`. Hitungan grep kasar atas seluruh migrasi: 104 `FOREIGN KEY`, 69 `UNIQUE INDEX`, 103 `CREATE INDEX`, 51 kemunculan `CHECK (`. Ini fitness function yang berjalan di setiap transaksi, bukan hanya saat test.

**B. Fitness perilaku (test suite) — sangat tebal, tetapi menegakkan *perilaku*, bukan *struktur*.**
`tests/` berisi **129 berkas Vitest** (70 integration = 37.270 baris, 31 unit = 3.150 baris, 28 sim2 = 9.508 baris; total 49.928 baris) ditambah `e2e/` 7 berkas (6 spec + setup). Grep menemukan ±1.068 deklarasi `it`/`test` dan 4.527 baris `expect(`; gerbang tercatat pada commit Tahap 4 adalah 1.189 test hijau. Yang paling bernilai sebagai penjaga arsitektur:

- `tests/integration/consistency.test.ts` — invariant lintas-modul: ledger seimbang, `stock_on_hand` = Σ `stock_movements`, nilai persediaan cocok dengan SQL independen, neraca & neraca saldo seimbang, kas sesi cocok dengan gerakan, AR/AP non-negatif, isolasi RLS lintas-tenant mengembalikan 0 baris, laporan bertanggal konsisten.
- `tests/sim2/rbac-matrix.test.ts` + `tests/unit/permissions.test.ts` — matriks izin peran × aksi.
- `tests/unit/modules-enabled.test.ts` — saklar modul per perusahaan ditegakkan juga di lapisan aksi (`assertModuleEnabled`), bukan hanya UI.
- Test kesetaraan hasil refactor (FIX-ARS T2/T3): ringkasan saldo bulanan dan arus kas SQL dibandingkan terhadap implementasi acuan independen.

**C. Pemeriksaan statis.** `tsconfig` dengan `strict: true` yang nyata (0 `any` eksplisit terlarang secara konvensi dan terverifikasi audit ARS-2; 0 `ts-ignore`/`ts-expect-error` di `src/`). Typecheck dan lint adalah script paket standar.

**D. CI (baru lahir di FIX-ARS Tahap 1, commit `8958a68`).** `.github/workflows/ci.yml` — satu-satunya berkas di `.github/` — terpicu pada push ke `main` dan `pull_request`, dengan concurrency cancel-in-progress, dan 4 job:

| Job | Isi | Nilai sebagai fitness function |
|---|---|---|
| `quality` | install frozen-lockfile + typecheck + lint | Menangkap regresi tipe & gaya dasar |
| `test` | service `postgres:18-alpine`, `docker/init.sql` (membuat `app_user` sebelum migrasi), `db:migrate`, `db:seed`, `pnpm test` | **Kuat**: membuktikan migrasi dari nol + seed + seluruh suite di DB sungguhan, bukan mock |
| `build` | `next build` | Menangkap kegagalan build produksi |
| `e2e` | migrate + seed + `playwright install --with-deps chromium` + build + `test:e2e` + upload artefak saat gagal | Alur pengguna kritis terverifikasi ujung-ke-ujung |

### 1.2 Yang TIDAK ADA (terverifikasi dengan grep, bukan kesan)

| Fitness function | Status di HEAD | Bukti |
|---|---|---|
| Architecture test (uji impor/struktur/batas modul) | **Tidak ada** | Grep `tests/` untuk pola `readFile`/`readdir`/`child_process`/`git`/`eslint`/`madge`/`circular`/`boundary`/`dependency` tidak menemukan satu pun uji struktur; satu-satunya `vi.importActual` dipakai untuk mock sesi/izin |
| Aturan lint batas modul | **Tidak ada** | `eslint.config.mjs` hanya memuat preset `eslint-config-next/core-web-vitals` + `typescript` + `globalIgnores` (`.next`, `out`, `build`, `next-env.d.ts`) — nol aturan `boundaries`, `no-restricted-imports`, atau batas lapisan |
| Dependency graph tool (dependency-cruiser/madge/knip-setara) | **Tidak ada** | Tidak tercantum di `package.json`; juga tidak ada `lint-staged`, `husky`, `commitlint` — tidak ada hook lokal sama sekali |
| Ambang coverage | Tidak ada | Tidak ada konfigurasi threshold di `vitest.config.mts` maupun CI |
| Anggaran performa / ukuran berkas / kompleksitas | Tidak ada | Skrip bench ada (`scripts/bench-monthly-balances.ts`, `scripts/bench-cashflow.ts`) tetapi hasilnya dibaca manusia, bukan gerbang |
| Audit dependensi terjadwal / bot pembaruan | Tidak ada | Tidak ada dependabot/renovate; tidak ada job `schedule:` di CI |
| Jadwal (schedule) apa pun di CI | Tidak ada | Trigger hanya `push` + `pull_request` |

### 1.3 Celah fitness baru yang lahir dari FIX-ARS Tahap 2

Tabel ringkasan `account_monthly_balances` (migrasi 0046) adalah *derived data* kedua yang dipelihara kode aplikasi (setelah `stock_on_hand`). Kesetaraannya terhadap agregat mentah **hanya** diuji oleh `tests/integration/fix-ars-tahap2-monthly-balances.test.ts` atas data fixture. `consistency.test.ts` — suite invariant yang berjalan atas data berjalan — **tidak** memeriksa ringkasan vs mentah (grep `monthly`/`summary` nihil). Jalur bypass yang dikenal (seed, skrip bench) memelihara ringkasan secara manual dan terdokumentasi di komentar kode, tetapi tidak ada rekonsiliasi berkala/terjadwal yang akan menangkap drift bila suatu hari muncul jalur tulis baru yang lupa memperbarui ringkasan. Inilah contoh persis mengapa fitness function struktural diperlukan: invariantnya benar hari ini karena satu titik tulis (`postJournal`) disiplin — dan tidak ada mesin yang menjaga disiplin itu tetap satu-satunya titik.

### 1.4 Vonis §1

Batas arsitektur ditegakkan oleh **invariant DB + test perilaku + konvensi**, dengan CI sebagai **rancangan** gerbang otomatis. Dua fakta penyeimbang yang wajib disebut bersamaan:

1. **CI belum operasional.** `git remote -v` kosong dan hanya ada branch `main` lokal; workflow belum pernah terpicu di GitHub, branch protection tidak ada/tidak terverifikasi, tidak ada tag rilis. Mengaktifkan CI adalah keputusan pemilik (pilihan akun/tujuan remote) yang masih terbuka — sampai itu terjadi, seluruh gerbang bergantung pada manusia/agen yang menjalankan perintah lokal dengan disiplin, persis keadaan sebelum Tahap 1.
2. **Yang tidak diuji tidak dijaga.** Siklus impor = 0 dan impor dalam = 0 hari ini adalah *hasil pengukuran audit*, bukan *sifat yang dipertahankan otomatis*. Tanpa architecture test, regresi batas hanya tertangkap pada audit manual berikutnya.

**Skor §1: 5,0/10** — fondasi fitness perilaku & DB termasuk yang terkuat untuk ukuran proyek ini; nol penegakan struktural dan CI yang belum hidup menahan skor di tengah.

---

## 2. Trajektori bloat (dari riwayat git)

**Metode:** untuk setiap commit tonggak, berkas `.ts`/`.tsx` di bawah `src/` dihitung dari objek git (`git ls-tree` + `git show`, tanpa checkout). LOC = baris fisik. Kolom test menghitung berkas di `tests/` + `e2e/` (termasuk setup/helper). Perhatian: seluruh riwayat terkompresi dalam ±3 hari kalender (3–5 November 2026) karena dikerjakan sebagai program-program berurutan — jadi yang dibaca adalah **laju per fase program**, bukan laju organik bulanan; jangan diekstrapolasi sebagai "per bulan".

| Tonggak | Commit | Berkas `src` | LOC | Rata-rata | Median | >500 | >1000 | Berkas terbesar | Test (berkas/LOC) | Migrasi |
|---|---|---|---|---|---|---|---|---|---|---|
| Baseline impor | `fe709c2` | 149 | 26.455 | 177,6 | 116 | 10 | 4 | `pos.ts` 1.208 | 5 / 1.020 | 7 |
| Akhir perbaikan awal | `c149f33` | 197 | 46.301 | 235,0 | 125 | 23 | 10 | `pos.ts` 2.087 | 63 / 21.735 | 22 |
| Akhir SIM-2 | `7a457a6` | 284 | 78.906 | 277,8 | 152 | 35 | 15 | `schema.ts` 2.593 | 108 / 36.286 | 39 |
| Akhir FIX-R2 | `263a43e` | 299 | 84.121 | 281,3 | 154 | 38 | 15 | `reports.ts` 2.705 | 120 / 41.156 | 43 |
| Akhir A-17 (POS/Gudang) | `235c767` | 313 | 91.044 | 290,9 | 160 | 40 | 16 | `inventory.ts` ±3.050 | 130 / 48.472 | 46 |
| **HEAD (FIX-ARS T4)** | `67894dc` | **330** | **92.880** | **281,5** | **164,5** | **44** | **16** | `pos-terminal.tsx` 2.985 | **136 / 50.204** | **47** |

LOC khusus `src/server` per tonggak: 6.946 → 16.943 → 32.368 → 34.308 → 37.403 → 38.743. Distribusi HEAD per area: server 66 berkas/38.743 baris, components 117/27.947, app 107/17.175, lib 34/5.241, db 5/3.750 (didominasi `schema.ts` 2.718).

### Pola pertumbuhan per interval

- **Baseline → perbaikan awal:** LOC **+75%** vs berkas **+32%**, rata-rata ukuran berkas **+32%**. Pola dominan: **penggemukan berkas lama** — fitur ditambahkan ke monolit yang sudah ada (`pos.ts` 1.208 → 2.087).
- **Perbaikan awal → SIM-2:** LOC **+70%**, berkas **+44%**, rata-rata **+18%**. Campuran: modul-modul baru memang lahir (payroll, HR, aset tetap), tetapi berkas lama tetap ikut menggemuk (rata-rata naik, berkas terbesar berpindah ke `schema.ts` 2.593).
- **SIM-2 → FIX-R2:** LOC **+6,6%**, berkas **+5,3%**. Pertumbuhan terkendali — fase perbaikan, bukan penambahan fitur.
- **FIX-R2 → A-17:** LOC **+8,2%**, berkas **+4,7%**, tetapi berkas terbesar melonjak ke ±3.050 (`inventory.ts`). Perbaikan fitur terkonsentrasi kembali ke hotspot.
- **A-17 → HEAD (FIX-ARS T1–T4):** LOC **+2,0%**, berkas **+5,4%**, rata-rata **turun −3,2%** — interval pertama di mana rata-rata berkas *mengecil*: Tahap 4 memecah `inventory.ts` (3.051 → 7 berkas folder, terpanjang 1.004) dan `pos.ts` (3.029 → 6 berkas folder) tanpa perubahan perilaku. Bukti bahwa trajektori *bisa* dibalikkan oleh refactor terarah.
- **Total baseline → HEAD:** LOC **+251%**, berkas **+121%**, rata-rata **+58%**, median **+42%**, berkas terbesar **+147%**.

### Pembacaan

1. **Mayoritas berkas sehat; risiko terkonsentrasi.** Median HEAD hanya 164,5 baris — pengembang yang membuka berkas acak umumnya mendarat di berkas yang dapat dikelola. Masalahnya adalah ekor distribusi: 44 berkas >500 baris dan 16 berkas >1.000 baris, dan ekor itu berisi berkas-berkas paling sentral: `pos-terminal.tsx` 2.985, `reports.ts` 2.835, `schema.ts` 2.718, `actions/accounting.ts` 2.190, `hr.ts` 2.108, `supplier-returns.ts` 2.071, `settings-forms.tsx` 1.795, `pos/sales.ts` 1.645 (sisa Tahap 4: fungsi-fungsinya sudah di bawah target, berkasnya belum), `actions/inventory.ts` 1.602.
2. **Test tumbuh jauh lebih cepat daripada kode.** Korpus test 1.020 → 50.204 baris (×49) melawan `src` ×3,5; test kini ±54% dari LOC sumber. Ini aset longevity terbesar proyek (perubahan berani menjadi mungkin), sekaligus beban pemeliharaan nyata: suite berjalan serial (`fileParallelism: false`, timeout 60 detik) dan helper rollback transaksi yang sama diduplikasi di **49 berkas test** — duplikasi yang akan membuat satu perubahan pola fixture menyentuh 49 tempat.
3. **Migrasi 7 → 47** dalam lima fase program: evolusi skema sangat aktif dan berdisiplin maju-saja (migrasi terlarang diedit, tambah baru). Strategi ini sehat selama riwayat migrasi tetap menjadi satu-satunya jalan — yang kembali bergantung pada konvensi, bukan gerbang (CI fresh-migrate memang akan menangkap migrasi rusak, begitu CI hidup).

**Skor §2: 6,0/10** — pertumbuhan historis menunjukkan penggemukan hotspot yang klasik, tetapi dua interval terakhir membuktikan perlambatan + pembalikan arah yang disengaja; ekor >1.000 baris di berkas sentral belum tertangani (terminal POS adalah pekerjaan Tahap 5, di luar HEAD).

---

## 3. Evolvabilitas: lumpur vs over-engineering

### 3.1 Kekuatan struktural (terukur di HEAD)

- **Graf impor runtime: 330 berkas, 1.650 edge, 0 siklus** (komponen kuat/SCC berukuran >1 tidak ada; satu-satunya siklus src-wide `permissions`↔`modules` bersifat type-only dan hilang saat runtime).
- **Disiplin permukaan publik nyata:** impor dalam (deep import) ke internal modul hasil pecahan `pos/` dan `inventory/` = **0**; pemanggil memakai barrel `@/server/inventory` (47 rujukan) dan `@/server/pos` (31 rujukan), dan barrel itu sendiri berupa ekspor bernama yang dikurasi, bukan `export *` buta. Ini pola yang benar — tetapi ditegakkan konvensi (lihat §1).
- **Gerbang tulis tunggal untuk dua buku besar:** semua jurnal lewat `postJournal`, semua gerakan stok lewat `applyStockMovement`; POS tidak menyentuh tabel stok secara langsung.
- **State global nyaris nol:** `globalThis` hanya dipakai singleton pool DB (pola standar Next.js); konstanta tingkat modul berupa tabel lookup immutable. State klien (keranjang POS, antrean offline, draf opname di localStorage) bersifat per-perangkat dan dirancang dengan sinkronisasi idempoten.
- **Kebersihan jalan pintas:** `TODO`/`FIXME`/`HACK` = **0** di `src/`; `ts-ignore`/`ts-expect-error` = 0; `eslint-disable` = 10; `as unknown as` = 18, terkonsentrasi di batas infrastruktur.

### 3.2 Indikator tekanan lumpur (bukti)

1. **Skema universal satu berkas.** `@/db/schema` diimpor oleh **103 berkas** (50 di `app`, 51 di `server`, 2 di `lib`); `schema.ts` sendiri 2.718 baris dan disentuh **34 dari 173 commit** — berkas sumber paling sering berubah setelah `PROGRESS.md`. Setiap perubahan bentuk tabel berdampak kompilasi ke seluruh aplikasi dan berpotensi konflik gabung untuk setiap pengembang paralel. Ini kopling struktural terbesar repo, dan ia *tumbuh* bersama jumlah tabel (62 → ±98 tabel dalam riwayat program).
2. **Objek konfigurasi bersama.** `companySettings` dirujuk **23 berkas** lintas area (server 16, app 5, lib 1, seed 1) — pemetaan akun, saklar modul, ambang persetujuan, konfigurasi POS, dan parameter fiskal semua mengalir lewat satu tabel/tipe. Fleksibilitas D-25 memang menuntutnya, tetapi setiap fitur baru cenderung menambah kolom di sini, menjadikannya "god object" konfigurasi.
3. **Hub laporan.** `reports.ts` 2.835 baris, disentuh 23 commit; hampir semua kebutuhan baca lintas-domain bermuara ke sini (termasuk dependensi terbalik yang tercatat: `master-data` → `reports`).
4. **Jalur baca ganda.** **46 dari 76** `page.tsx` masih menjalankan `.select(` langsung di lapisan halaman (keadaan HEAD; Tahap 6 belum berjalan). Artinya aturan "halaman memanggil fungsi baca server" adalah aspirasi yang setengah terlaksana — logika baca yang sama dapat hidup di dua tempat dan menyimpang diam-diam.
5. **Lapisan aksi tidak murni tipis.** Aksi server melakukan **118 mutasi Drizzle langsung** (35 `insert`, 64 `update`, 19 `delete` di 8–9 berkas aksi) di samping memanggil domain. Bukan pelanggaran fatal — banyaknya CRUD master yang memang dangkal — tetapi klaim "aksi = gerbang tipis di atas domain" tidak sepenuhnya benar, dan logika tulis yang hidup di aksi tidak dapat dipakai ulang jalur lain (impor, offline sync).
6. **Titik sentuh bersama berulang.** Selain `schema.ts`: `actions/inventory.ts` 22 commit, `actions/accounting.ts` 22, `settings-forms.tsx` 22, `inventory.ts` 21, `pos.ts` 20, `PROGRESS.md` **89 dari 173 commit (51%)**. Untuk pengembangan paralel (manusia atau agen), berkas-berkas ini adalah titik konflik dan titik tinjau wajib — *blast radius* perubahan fitur rata-rata memang kecil (median commit hanya menyentuh 3 berkas), tetapi fitur yang menyentuh skema/pengaturan/laporan selalu menyentuh berkas yang sama dengan semua fitur lain.
7. **Derived data yang dipelihara kode.** `stock_on_hand` dan kini `account_monthly_balances` adalah ringkasan yang benar hanya selama semua jalur tulis disiplin memperbaruinya; seed dan skrip bench adalah bypass yang dikenal dan ditangani manual. Setiap ringkasan baru menambah satu invariant yang tidak dijaga mesin (lihat §1.3).

### 3.3 Indikator over-engineering (bukti — nyata tetapi sempit)

1. **Dependensi yatim.** Enam dependensi runtime memiliki **0 impor** di `src/`, `tests/`, `e2e/`, dan `scripts/` pada HEAD: `pg-boss` (antrean job — arsitektur akhirnya memilih sinkronisasi offline di dalam request, sehingga pg-boss tidak pernah terpakai; ia tetap menarik `pg`, `cron-parser`, `rrule-temporal` ke lockfile), `date-fns`, `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`. Ketiganya yang terakhir adalah *paradigma alternatif yang tidak diadopsi* (aplikasi memakai Server Components + Server Actions + form natif) — membiarkannya terpasang mengundang pengembang baru memilih paradigma kedua dan memecah konsistensi. `shadcn` juga 0 impor langsung tetapi terdaftar sebagai dependensi **runtime**, padahal ia perkakas CLI (komponennya di-vendor ke `src/components/ui`).
2. **Primitif UI tak terjangkau.** `src/components/ui` berisi 28 modul/2.881 baris (hasil generate shadcn), tetapi graf impor aplikasi hanya menjangkau **6 modul** (`alert`, `button`, `dialog`, `input`, `label`, `skeleton`). **22 modul (2.538 baris, 88% folder)** — termasuk `chart`, `command`, `dropdown-menu`, `select`, `table`, `tabs` — tidak terjangkau dari kode aplikasi mana pun (aplikasi secara sadar memakai elemen natif + kelas field bersama). Biaya bawanya bukan nol: permukaan lint/typecheck/audit membesar dan developer baru dapat salah mengira inilah sistem desain yang harus dipakai.
3. **Yang TIDAK over-engineered justru bagian intinya.** Tidak ditemukan lapisan penerus murni sebagai pola dominan, tidak ada pola repository/unit-of-work/event-bus spekulatif; dari ±90 deklarasi `interface`, hampir semuanya bentuk data (DTO/hasil), bukan port satu-implementasi — satu-satunya port sungguhan, `OfflineQueueStorage`, memiliki dua implementasi nyata (penyimpanan browser + fake test). Konfigurasi fiskal bertanggal-efektif dan pemetaan akun yang tampak "berat" terbukti terpakai dan teruji — itu kompleksitas domain yang dibenarkan, bukan abstraksi prematur.

### 3.4 Vonis §3 — risiko dominan 12 bulan

**Lumpur, dengan selisih jelas.** Alasannya mekanistis, bukan teoretis: (i) pertumbuhan fitur selama ini terbukti mengalir ke berkas bersama yang sama (skema, pengaturan, laporan, aksi besar), dan kelimanya masih menjadi jalur termudah untuk fitur berikutnya; (ii) tidak ada fitness function yang membuat jalur menyimpang (impor dalam, query halaman yang menggemuk, mutasi langsung di aksi, ringkasan baru tanpa rekonsiliasi) menjadi *gagal otomatis* — penyimpangan hanya tertangkap audit manual; (iii) residu over-engineering bersifat *statis dan terbatas* (±2.500 baris UI mati + 7 dependensi) — ia tidak bertumbuh sendiri dan dapat dicabut dalam satu pekerjaan pembersihan, sedangkan kopling bersama *bertambah* dengan setiap fitur. Risiko sekunder yang memperbesar keduanya: riwayat dan catatan keputusan saat ini hanya hidup di repo lokal tanpa remote — kehilangan mesin berarti kehilangan konteks evolusi, bukan hanya kode.

**Skor §3: 6,5/10** — arsitektur inti (DAG bersih, gerbang tulis tunggal, permukaan publik disiplin) memberi modal evolusi yang baik; titik kopling bersama + absennya penegakan otomatis membuat modal itu terkikis perlahan bila tidak segera dikunci fitness function.

---

## 4. Catatan keputusan: PROGRESS.md sebagai ADR de-facto

### 4.1 Yang kuat

- **Cakupan lengkap dan dapat ditelusur:** D-1..D-25 semuanya hadir di `PROGRESS.md` §2, mayoritas dengan penentu, tanggal, alasan, dan alternatif yang ditolak. Supersesi tertangani secara eksplisit dan konsisten: D-24 mencabut bagian offline dari D-10, D-21 mencabut sebagian D-17, D-19 menimpa aturan POS lama. Developer baru yang tahu nomor keputusan dapat menemukan *mengapa* dalam hitungan menit.
- **Disiplin pemeliharaan terbukti:** PROGRESS diubah dalam **89 dari 173 commit (51%)** — catatan keputusan benar-benar hidup selama program berjalan, bukan ditulis sekali lalu ditinggalkan.
- **Pesan commit berfungsi sebagai ADR mikro:** commit-commit FIX-ARS memuat alasan desain + bukti angka (mis. `9269c07` untuk ringkasan saldo: titik pembaruan tunggal, pembacaan hibrida, hasil benchmark; `423fffb` untuk arus kas: bentuk subkueri yang *ditolak* beserta alasan EXPLAIN-nya). Alasan penolakan alternatif — bagian ADR yang paling sering hilang — justru tercatat di sini dan di komentar kode.

### 4.2 Yang lemah

1. **Satu berkas padat tanpa indeks per keputusan.** PROGRESS adalah 207 baris fisik tetapi **12.148 kata** (baris-baris sangat panjang). Tidak ada `docs/adr/`, tidak ada satu berkas per keputusan, tidak ada indeks yang memetakan keputusan → berkas/migrasi yang disentuhnya. Penemuan kembali bergantung pada Ctrl-F dan pengetahuan awal bahwa keputusan itu ada.
2. **Ada bagian yang basi di dalam dokumen otoritatif.** §4 "Status tahap" masih menampilkan tahap-tahap awal sebagai BERJALAN/BELUM DIMULAI, ditimpa oleh seksi-seksi program berikutnya. Pembaca baru yang membaca berurutan akan menemukan kontradiksi di dokumen yang sama.
3. **Keputusan arsitektur terbaru belum tercatat di sana.** Pada HEAD, grep `A-19`/`FIX-ARS` di PROGRESS **nihil**: keputusan Tahap 1 (validasi env fail-fast), Tahap 2 (tabel ringkasan saldo + pembacaan hibrida), Tahap 3 (agregasi arus kas SQL + penolakan bentuk subkueri), dan Tahap 4 (pemecahan modul) hanya hidup di pesan commit, komentar kode, dan berkas test. Untuk keputusan sebesar "laporan kini membaca tabel ringkasan yang dipelihara `postJournal`" — perubahan arsitektur data yang permanen — satu-satunya catatan adalah commit `9269c07`. Itu memadai bagi yang tahu cara mencari (`git log -S`), dan tidak terlihat bagi yang tidak.
4. **Dokumen arsitektur khusus menua tanpa penanda.** `docs/sim2/S0-A-ARSITEKTUR.md` (325 baris) ditulis saat 27 migrasi dan `pos.ts`/`inventory.ts` masih monolit; kini migrasi 47 dan kedua berkas itu sudah folder modul. Tidak ada penanda "digantikan oleh" di kepalanya.
5. **Tidak ada tag rilis, branch, atau CODEOWNERS.** Riwayat linear `main` tanpa penanda versi membuat "keputusan X masuk di rilis mana" tidak dapat dijawab dari repo.

### 4.3 Vonis §4

Untuk *mengapa* keputusan produk/domain besar dibuat, catatan ini **di atas rata-rata** — alasan dan supersesi dapat ditemukan kembali. Untuk *mengapa* keputusan arsitektur teknis terbaru dibuat, catatan **rapuh**: tersebar di pesan commit yang untungnya ditulis dengan baik, tanpa indeks, tanpa ADR, dan dengan satu dokumen status yang sebagian basi. Kecukupan menurun seiring waktu karena setiap program baru menambah lapisan seksi di atas dokumen yang sama.

**Skor §4: 6,0/10.**

---

## 5. Kebaruan tumpukan 2025–2026 & jalur upgrade

### 5.1 Fakta repo (dari `package.json` + resolusi `pnpm-lock.yaml` di HEAD)

| Paket | Spesifikasi | Resolusi lock | Catatan fakta |
|---|---|---|---|
| next | `16.4.3` (pin persis) | 16.4.3 | Juga `eslint-config-next` 16.4.3 |
| react / react-dom | `19.3.0` (pin persis) | 19.3.0 | |
| typescript | `^5` | 5.9.3 | `strict: true` |
| drizzle-orm / drizzle-kit | `^0.45.4` / `^0.31.5` | 0.45.4 / 0.31.11 | Masih seri 0.x (pra-1.0) |
| better-auth | `^1.7.15` | 1.7.15 | |
| zod | `^4.6.7` | 4.6.7 | |
| vitest | `^5.0.5` | 5.0.5 | |
| @playwright/test | `^1.57.0` | 1.64.1 | |
| tailwindcss | `^4` | 4.3.3 | |
| postgres (driver) | `^4.0.0` | 4.0.0 | PostgreSQL server 18 |
| @types/node | `^20` | 20.19.43 | **Tidak selaras**: CI memakai Node 24, README mensyaratkan Node 22+ |

Fakta pendamping: tidak ada field `engines`, tidak ada `.nvmrc`/`.node-version`; `packageManager` terpin `pnpm@11.8.0`; tidak ada dependabot/renovate; tidak ada remote git sehingga tidak ada mekanisme distribusi pembaruan yang berjalan.

### 5.2 Penilaian [eksternal]

- **[Penilaian eksternal]** Pada jendela 2025–2026, Next 16 + React 19 + TypeScript 5.9 + Zod 4 + Tailwind 4 berada di garis depan arus utama — repo ini **tidak** menanggung utang "tertinggal dua major" yang biasa menjadi risiko longevity terbesar. Keputusan memin Next/React secara persis (bukan caret) adalah praktik yang tepat untuk framework yang bergerak cepat.
- **[Penilaian eksternal]** Risiko versi terbesar bukan keterlambatan, melainkan **pra-1.0 dan kecepatan rilis**: Drizzle ORM 0.45.x dan Better Auth 1.x adalah proyek mainstream tetapi dengan permukaan perubahan yang lebih aktif daripada Next/React. Tanpa bot pembaruan dan tanpa cadence yang terjadwal, pola yang lazim terjadi adalah "tidak pernah di-upgrade sampai terpaksa lompat jauh" — dan lompatan jauh pada ORM menyentuh 104 berkas pengimpor `drizzle-orm`.
- **[Penilaian eksternal]** Ketidakselarasan Node (CI 24 vs README 22+ vs @types/node 20) adalah jenis drift kecil yang menimbulkan bug "di mesin saya bisa" dalam 12 bulan; memperbaikinya murah dan seharusnya tidak menunggu.

### 5.3 Jalur upgrade: permukaan framework terukur

Kabar baiknya terukur. Pemakaian API Next di HEAD didominasi pola standar dan stabil: `"use server"` 22 berkas, `"use client"` 92, `force-dynamic` 94, `next/navigation` 85, `next/link` 83, `next/cache` 21 (semuanya `revalidatePath`), `next/server` 3, `next/headers` 2. API eksotik/eksperimental: **`unstable_cache` 0, `use cache` 0, `connection()` 0, `Suspense` 0, `useActionState`/`useOptimistic`/`useTransition` 0**. Better Auth hanya tersentuh **5 berkas** (rute auth, `auth.ts`, `auth-client`, seed, aksi pengguna) dan plugin yang tidak terpakai sudah dicabut secara sadar — permukaan upgrade auth kecil dan terisolasi. Konfigurasi auth sendiri terdokumentasi alasannya di komentar `src/lib/auth.ts`.

Biaya upgrade terkonsentrasi di dua tempat: (i) **Drizzle** — 104 berkas mengimpor `drizzle-orm` dan ada 196 kemunculan template `sql\`` di server/db/lib; polanya konsisten (query builder + `withCompany`), sehingga upgrade mayoritas bersifat mekanis-kompilasi, tetapi volumenya besar dan skema satu berkas membuat setiap perubahan API skema berdampak global; (ii) **konvensi proyek di atas framework** — prop `render` Base UI, aturan Turbopack CSS di `next.config.ts`, dan peringatan di `AGENTS.md` bahwa dokumentasi Next yang berlaku adalah yang di `node_modules/next/dist/docs/` (API dapat berbeda dari pengetahuan umum). Ini bukan utang, tetapi berarti upgrade Next wajib diikuti membaca ulang catatan rilis + dok lokal, bukan sekadar menaikkan versi.

### 5.4 Risiko ketergantungan: xlsx tarball CDN — status terkini

**Masih ada di HEAD.** `package.json` memasang `xlsx` dari `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Mitigasi yang sudah ada: `pnpm-lock.yaml` mencatat integrity `sha512-…` untuk tarball itu, sehingga isi yang terambil terverifikasi terhadap hash — risiko *drift isi* teredam. Yang tersisa: (i) **ketersediaan** — install bersih bergantung pada CDN pihak ketiga di luar registry; (ii) **audit rantai pasok** — paket di luar registry lolos dari alur audit/scanning standar; (iii) xlsx **bukan** dependensi yatim (terpakai nyata di 4 berkas impor/ekspor), jadi solusinya adalah mengganti sumber distribusi/mirror internal, bukan mencabut. Risiko dinilai kecil-tetapi-nyata, dan merupakan satu-satunya dependensi non-registry di repo.

**Skor §5: 7,0/10** — tumpukan segar dan permukaan framework standar membuat upgrade 12 bulan ke depan tampak rutin; yang menahan skor adalah ketiadaan mesin pembaruan, ketidakselarasan versi Node, dan satu dependensi CDN.

---

## 6. Onboarding: simulasi jalur developer baru

### 6.1 Jalur yang akan ia tempuh (dan yang ia temukan)

1. **README.md** (1.317 kata) — Stack, perintah, peran DB, aturan akuntansi, kredensial demo. Berguna untuk mulai dalam ±15 menit, **tetapi sebagian basi terverifikasi**: baris 19 menyebut "PostgreSQL 16+ (disarankan 18)" padahal `AGENTS.md` mewajibkan PG 18; baris 54 menyatakan POS tidak memakai data pelanggan dan metode tempo/kredit tidak ditampilkan — bertentangan dengan D-19 (penjualan utang POS sudah dibangun); struktur di baris ±134 masih `src/server/*.ts` padahal kini folder modul; catatan outbox "belum ada worker produksi" tidak lagi menggambarkan desain sinkronisasi yang berjalan.
2. **AGENTS.md** (887 kata) — dokumen orientasi terbaik di repo: aturan keras (RLS/`withCompany`, uang `numeric(19,4)` string + Decimal.js, jurnal append-only, AVCO, `force-dynamic`, peran) dalam satu tempat. Developer yang membaca ini utuh menghindari sebagian besar kesalahan fatal.
3. **PROGRESS.md** (12.148 kata) — lengkap tetapi padat dan sebagian basi (§4.2 di atas); membaca utuhnya 1–2 jam, dan tidak ada penanda bagian mana yang masih berlaku.
4. **docs/** — 59 berkas, **±145.035 kata**, terorganisasi per program audit (sim2 14 berkas, akuntansi-audit 12, reports 12, arsitektur-audit 5, pos-audit 4, gudang-audit 4, audit 4, research 2) tanpa indeks, tanpa `docs/ARCHITECTURE.md`, tanpa `CONTRIBUTING.md`, tanpa panduan onboarding. Korpus ini adalah *arsip bukti program*, bukan *peta jalan masuk*: developer baru tidak dapat tahu berkas mana yang menggambarkan keadaan kini vs keadaan saat audit ditulis (contoh: `S0-A-ARSITEKTUR.md`, lihat §4.2 butir 4).
5. **Kode + test sebagai jaring.** Di sinilah onboarding terselamatkan: pola baku konsisten (satu `guard()`, satu `postJournal`, satu pola aksi Zod+RBAC, komponen laporan bersama), dan test integrasi berfungsi sebagai spesifikasi yang dapat dieksekusi — Skenario penerimaan pengguna di `SPEK-FITUR-INTI.md` §5 bahkan hidup sebagai test.

### 6.2 Estimasi sampai perubahan pertama yang aman [penilaian penilai, bukan pengukuran]

- Perubahan kecil di lapisan UI/lib dengan test unit yang menamainya: **hari yang sama** (±2–4 jam termasuk setup dan membaca AGENTS.md).
- Perubahan domain transaksional pertama (menyentuh jurnal/stok/periode): **2–5 hari** — bukan karena kodenya sulit ditemukan, melainkan karena invariantnya tersebar (AGENTS.md + PROGRESS + komentar kode + test), fixture test punya jebakan historis (perusahaan demo menyimpan residu lintas program sehingga test baru wajib perusahaan fixture khusus; dokumen bernomor di perusahaan demo memerlukan penyejajaran sequence), dan suite berjalan serial sehingga siklus verifikasi penuh tidak cepat.

### 6.3 Tiga hambatan onboarding terbesar (terbukti)

1. **Tidak ada peta arsitektur yang mutakhir, dan dokumen pintu masuk sebagian basi.** README salah pada 4 titik terverifikasi, peta arsitektur khusus berhenti di migrasi 0027, PROGRESS §4 basi, dan 145 ribu kata dokumentasi tidak terindeks. Developer baru menghabiskan waktu membedakan "masih berlaku" vs "sejarah" — pekerjaan yang seharusnya dilakukan satu halaman `ARCHITECTURE.md` + indeks ADR.
2. **Invariant kritis bersifat implisit dan tersebar.** RLS/`withCompany`, uang string-Decimal, AVCO global per produk, gerbang periode, ringkasan turunan, saklar modul, dan matriks izin masing-masing dijelaskan di tempat berbeda (AGENTS.md, PROGRESS, komentar, test). Tidak ada panduan "perubahan pertama" yang menelusuri satu transaksi ujung-ke-ujung. Kesalahan di wilayah ini tidak selalu gagal keras — ia bisa lolos sebagai angka akuntansi yang diam-diam salah, dan hanya test invariant yang menangkapnya *bila* test terkait ditulis.
3. **Alur test/kerja bersifat bespoke dan berat.** Suite serial (`fileParallelism: false`), test integrasi berbagi DB hasil seed dengan jebakan residu/sequence yang terdokumentasi hanya di laporan program, helper rollback yang sama disalin ke 49 berkas test (tidak ada helper bersama), dan e2e terikat storageState localhost + flag lingkungan khusus. Developer baru tidak bisa begitu saja "menjalankan satu test dan membaca hasilnya" tanpa lebih dulu mempelajari konvensi fixture proyek.

**Skor §6: 5,5/10** — pola kode yang konsisten dan test sebagai spesifikasi membuat onboarding *mungkin* berjalan baik; dokumentasi pintu masuk yang basi dan ketiadaan peta membuat minggu pertama lebih lambat dan lebih berisiko daripada seharusnya.

---

## 7. Fitness functions yang DIREKOMENDASIKAN (yang memang absen, urut nilai/biaya)

| # | Rekomendasi | Jenis | Biaya | Nilai & catatan baseline |
|---|---|---|---|---|
| 1 | **Aktifkan remote git + branch protection dengan 4 job CI sebagai required checks + tag rilis** | Gerbang proses | Rendah (keputusan pemilik: akun/tujuan) | Nilai tertinggi dari seluruh daftar: tanpa ini, CI (§1.1D) dan seluruh rekomendasi di bawah hanya berjalan bila seseorang ingat menjalankannya. Sekaligus menutup risiko kehilangan riwayat lokal |
| 2 | **Architecture test atas graf impor** (dependency-cruiser, atau skrip Node tanpa dependensi baru yang dijalankan Vitest/CI): larang siklus runtime; larang impor dalam ke internal `server/pos/*` & `server/inventory/*` (wajib via barrel); larang `components` mengimpor `db`/`server` secara runtime; larang domain `server` mengimpor `app`/`components`/`actions`. Pengecualian yang sah saat ini (mis. rute health memakai `sqlClient`) masuk daftar izin eksplisit | Uji struktur | Sedang-rendah | Mengubah kebersihan terukur §3.1 (0 siklus, 0 impor dalam) dari *hasil audit* menjadi *sifat yang dipertahankan*. Mulai sebagai *ratchet*: aturan yang hari ini hijau dikunci; jangan langsung menuntut aturan yang hari ini merah |
| 3 | **Ratchet untuk pelanggaran yang sudah ada**: hitungan halaman dengan `.select(` langsung (baseline 46) dan mutasi Drizzle langsung di aksi (baseline 118) hanya boleh *turun*; CI gagal bila naik | Uji struktur (hitungan) | Rendah | Menahan jalur baca ganda (§3.2.4) dan pengikisan lapisan aksi (§3.2.5) tanpa mewajibkan refactor besar di muka — sejalan dengan mandat Tahap 6 |
| 4 | **Rekonsiliasi ringkasan masuk `consistency.test.ts`**: `account_monthly_balances` vs agregat `journal_lines` mentah untuk rentang acak + bulan berjalan, menutup celah §1.3; plus perintah rekonsiliasi read-only yang dapat dijadwalkan atas data produksi | Uji invariant data | Rendah | Satu-satunya invariant turunan yang saat ini tidak dijaga suite invariant utama; polanya menyalin pemeriksaan `stock_on_hand` yang sudah ada |
| 5 | **Ratchet ukuran berkas/fungsi di CI**: berkas/fungsi yang sudah melampaui ambang (berkas >1.000 baris: 16; fungsi >250 baris) masuk daftar kakek (grandfather list); CI gagal bila daftar membesar atau entri yang ada memburuk; berkas baru >400 baris memerlukan justifikasi di PR | Uji struktur | Rendah | Menjadikan pembalikan trajektori Tahap 4 (§2) permanen dan mencegah hotspot baru lahir diam-diam |
| 6 | **Kebersihan dependensi sebagai pemeriksaan**: `knip`/depcheck + `pnpm audit` di CI (jadwal mingguan), diawali satu pembersihan: cabut 6 dependensi yatim §3.3, pindahkan `shadcn` ke devDependencies, dan putuskan nasib 22 primitif UI tak terjangkau (pakai atau hapus) | Uji dependensi | Rendah–sedang | Menghapus permukaan audit/pasang yang tidak memberi nilai dan mencegah paradigma ganda (React Query/Hook Form) masuk tanpa keputusan |
| 7 | **Selaraskan & otomatiskan pembaruan versi**: samakan Node di `engines` + `.nvmrc` + CI + `@types/node` (satu angka: 24), aktifkan Dependabot/Renovate untuk patch/minor mingguan dengan CI sebagai gerbang | Gerbang proses | Rendah | Menutup drift §5.2 sebelum menjadi lompatan upgrade paksa pada Drizzle/Better Auth |
| 8 | **Anggaran performa atas skrip bench yang sudah ada**: jalankan `bench-monthly-balances` & `bench-cashflow` di CI malam atas dataset sintetis tetap; gagal bila regresi >2× baseline tercatat (31,6 ms / 3,5 ms / arus kas netral) | Uji performa | Sedang | Mengubah kemenangan performa Tahap 2–3 dari angka sekali-ukur menjadi sifat yang dipertahankan; ambang longgar (2×) menjaga derau tetap toleran |
| 9 | **Fitness migrasi & pemulihan**: CI sudah membuktikan fresh-migrate dari nol; tambahkan (a) uji upgrade dari snapshot skema rilis sebelumnya, (b) smoke backup→restore terjadwal (runbook sudah ada dan terbukti manual; penjadwalan + verifikasi otomatisnya yang belum ada) | Uji evolusi skema | Sedang | Menjaga jalur yang benar-benar akan dipakai instalasi berumur panjang: naik versi di atas data lama, bukan hanya install baru |
| 10 | **Kebersihan dokumen sebagai pemeriksaan ringan**: pemeriksaan tautan/jalur dokumen di CI + aturan "commit yang menyentuh migrasi atau batas modul wajib menyentuh `docs/adr/` atau PROGRESS" — diawali ekstraksi 4 keputusan FIX-ARS dari pesan commit menjadi ADR singkat dan penandaan basi pada PROGRESS §4 & `S0-A-ARSITEKTUR.md` | Uji dokumentasi | Rendah | Menyerang langsung hambatan onboarding §6.3.1 dan kerapuhan §4.2 dengan biaya terkecil di daftar ini |

Yang **sengaja tidak** direkomendasikan sekarang: ambang coverage persentase keras (suite sudah tebal; angka tunggal akan dikejar, bukan kualitas), mutation testing (biaya tinggi untuk nilai marjinal pada tahap ini), dan pemecahan `schema.ts` per domain sebagai pekerjaan tersendiri (nilai nyata, tetapi itu refactor — bukan fitness function; ratchet #2/#5 akan menunjukkan kapan ia menjadi mendesak).

---

## 8. Kesimpulan dimensi

Bisa ERP di HEAD `67894dc` adalah modular monolith dengan **inti yang disiplin dan tepi yang dijaga kebiasaan**: graf dependensi bersih, gerbang tulis tunggal, invariant database keras, dan korpus test yang tumbuh 49× lipat mendampingi pertumbuhan kode. Modal longevity-nya nyata. Yang belum dimiliki — dan yang membedakan skor 6 dari skor 8 — adalah **mesin penegak**: tidak ada architecture test, tidak ada aturan lint batas, CI belum terhubung ke remote mana pun, keputusan arsitektur terbaru belum masuk catatan keputusan, dan dokumen pintu masuk sebagian basi. Semua kekurangan itu berbiaya rendah-sedang untuk ditutup (daftar §7), dan semuanya bersifat *mencegah kemunduran* — persis jenis pekerjaan yang paling murah dilakukan saat keadaan masih baik, dan paling mahal dilakukan setelah lumpur terbentuk.

**Skor dimensi AD-4 (maintainability jangka panjang, evolvabilitas & fitness functions): 6,0 / 10.**
