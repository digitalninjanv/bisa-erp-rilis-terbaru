# AD-1 — Dependency Rule, Bounded Context & Screaming Architecture

Analisis mendalam baca-saja atas pohon **ter-commit HEAD `67894dc`** Bisa ERP
(refactor FIX-ARS Tahap 4 sudah masuk; refactor terminal POS Tahap 5 yang
sedang kotor di pohon kerja **dikecualikan** — berkas kotor dinilai dari versi
ter-commit-nya). Titik awal: `docs/arsitektur-audit/ARS-1-STRUKTUR-LAPISAN.md`;
laporan ini men-dalami dengan kerangka standar profesional 2025–2026
(Dependency Rule, DDD bounded context, DIP/hexagonal-fit), bukan mengulang ARS-1.

## Metodologi (agar angka dapat direproduksi)

- Semesta: `git ls-tree -r HEAD src` → **330 berkas** `.ts/.tsx` ter-commit;
  isi setiap berkas dibaca via `git show HEAD:<path>` (bukan pohon kerja).
  LOC ter-commit per lapisan: app 17.175 · components 27.947 · server 38.743 ·
  lib 5.241 · db 3.750 (total ±92.856).
- Graf impor: skrip Python mengekstrak semua `import`/`export … from` statis,
  menyelesaikan alias `@/` dan jalur relatif ke berkas nyata, dan membedakan
  tepi **runtime** vs **type-only** (`import type`). Siklus dicari dengan
  Tarjan SCC atas graf berkas, dua kali: semua tepi, dan tepi runtime saja.
- Sensus konteks: 98 tabel dari `src/db/schema.ts` dipetakan ke 7 himpunan
  berkas konteks (definisi himpunan dinyatakan per butir 2). "Menyentuh" tabel
  = identifier tabel muncul di berkas konteks (baca/tulis); "menulis" tabel =
  pola `.insert/.update/.delete(<tabel>)` ditemukan.
- Klasifikasi lapisan untuk matriks arah: `app` (src/app) → `components` →
  `actions` (src/server/actions) → `server-domain` (src/server di luar
  actions) → `db`/`lib` (inti terdalam).

---

## Butir 1 — Dependency Rule (dependensi hanya mengarah ke dalam)

**Vonis: SESUAI — Skor 8/10**

**Bukti terukur (matriks tepi antar-lapisan, graf ter-commit):**

| Dari → Ke | app | components | actions | server-domain | db | lib |
|---|---|---|---|---|---|---|
| app | – | 306 | 0 | 90 | 131 | 296 |
| components | 0 | 108 | 31 | 5 (semua type-only) | **0** | 99 |
| actions | 0 | 0 | – | 38 | 30 | 94 |
| server-domain | 0 | 0 | – | 126 | 54 | 86 |
| lib | 0 | 0 | 0 | 0 | 5 | 19 |
| db | 0 | 0 | – | 1 | 4 | 7 |

- **Tepi ke atas (inversi arah): tepat 1 tepi runtime** di seluruh graf —
  `src/db/seed.ts → src/server/payroll-indonesia.ts`. Itu skrip CLI seed
  (perkakas), bukan jalur request; tidak ada inversi di jalur aplikasi.
- **Siklus: 0 pada graf runtime.** Atas semua tepi (termasuk type-only),
  satu-satunya SCC adalah `lib/permissions.ts ↔ lib/modules.ts` — dua arah
  `import type`, terhapus saat kompilasi (sudah dikenal sebagai ARS1-07).
  Sesudah pemecahan Tahap 4, graf folder `pos/` dan `inventory/` ikut bersih:
  tepi internal folder tidak membentuk siklus apa pun.
- **Domain bebas framework: 0 berkas `src/server` di luar `actions/` mengimpor
  `next/*` atau `react`.** Seluruh 22 impor framework di `src/server` tinggal
  di lapisan actions (`next/cache` untuk `revalidatePath` di 21 berkas,
  `next/headers` di `actions/company.ts`) — persis di batas framework tempat
  mereka semestinya berada.
- **Komponen tidak menyentuh basis data: components → db = 0 tepi**, dan
  components → server-domain hanya 5 tepi, **semuanya `import type`**
  (tipe hasil baca seperti `PartyDetail`, `QuoteResultPublic` — tipe tampilan,
  bukan panggilan). Komponen klien memanggil actions (31 tepi) — arah yang
  benar dalam idiom Next.js.

**Penyimpangan yang nyata (dan batas vonis):**

- **app → db = 131 tepi.** Rinciannya bukan kebocoran liar: sebagian besar
  adalah `withCompany/withCompanyReadOnly` dari `@/db/tenant` (pintu komposisi
  tenant yang memang dipakai 88 berkas app) dan `@/db/schema` di halaman yang
  membangun kueri baca sendiri (pola ARS1-01; penertibannya adalah FIX-ARS
  Tahap 6 yang sedang berjalan). Secara Dependency Rule ini **layer-skipping,
  bukan inversi** — arahnya tetap ke dalam, tetapi lapisan presentasi mengenal
  skema ORM untuk baca, melewati domain. Dalam pembacaan Clean Architecture
  yang ketat ini cacat; dalam idiom RSC/Next.js ini pola arus utama. Vonis
  SESUAI diberikan karena tidak ada inversi dan tidak ada siklus runtime,
  dengan catatan lompatan-lapisan baca ini sebagai pengurang skor.
- Penegakan masih **konvensi, bukan perkakas** (ARS1-06 tetap berlaku):
  tidak ada aturan boundaries di eslint/CI. Graf yang bersih hari ini
  bertahan karena disiplin, bukan karena ada yang menolak pelanggaran.

**Risiko praktis:** rendah hari ini; sedang dalam 12 bulan — satu pengembang/
agen baru yang mengimpor `db` dari komponen tidak akan ditolak apa pun.

**Rekomendasi:** (1) kunci graf saat ini dengan aturan `no-restricted-imports`
datar + satu test graf murah di CI (ARS1-06); (2) pertimbangkan memindahkan
`withCompany` secara konseptual ke "platform" (mis. `@/db/tenant` tetap, tetapi
dokumentasikan di AGENTS.md bahwa tenant.ts adalah API platform, bukan akses
data) agar angka app→db tidak dibaca sebagai pelanggaran oleh peninjau baru.

---

## Butir 2 — Bounded Context vs Technical Layering

**Vonis: SEBAGIAN — Skor 6/10**

**Putusan pelabelan (dengan bukti): arsitektur ini adalah _modular monolith
berkonteks yang sedang tumbuh di atas satu database bersama_, disusun
**lapisan-teknis dulu, konteks kedua** — bukan bounded context DDD penuh,
dan bukan lagi layered monolith polos.**

**Peta konteks nyata dari kode:**

| Konteks | Rumah kode | Tabel disentuh (baca+tulis) | Tabel ditulis |
|---|---|---|---|
| POS | `server/pos/` + `pos.ts` + `pos-offline.ts`, `actions/pos*.ts`, rute `app/pos`, `components/pos` | 25 | miliknya + berbagi master |
| Persediaan/Pembelian | `server/inventory/` + purchasing/purchase-requests/supplier-returns/reservations/batches/serials/catalog, rute `app/gudang` | 41 | inti stok eksklusif (lihat bawah) |
| Akuntansi | accounting/reports/payables/opening-balances/year-end/bank-*/expenses/fixed-assets, rute `app/akuntansi` | 49 (termasuk baca lintas untuk laporan) | jurnal eksklusif |
| HR/Payroll | hr/payroll-indonesia/employee-*/reimbursements (+ mesin murni `lib/payroll-indonesia.ts`) | 36 | payroll berbagi dengan Akuntansi |
| Master Data/Impor | master-data/import-masters/import-files, wizard impor | 23 | master berbagi 4 arah |
| Platform/Pengaturan | actions/settings/users/company, audit, member-permissions, idempotency, rute `app/pengaturan` | 23 | platform |
| Fasad lintas | `quick-entry.ts` (modal Catat Transaksi) | 11 | memanggil domain, bukan pemilik |

**Bukti kepemilikan data — sisi kuatnya terukur:**

- Dari 92 tabel yang ditulis kode server, **72 (78%) ditulis tepat satu
  konteks**; hanya 20 yang punya ≥2 penulis konteks.
- Invariant terpenting memegang di tingkat konteks, bukan hanya berkas:
  **`journal_entries`/`journal_lines` ditulis hanya oleh konteks Akuntansi**
  (satu-satunya penulis lain di repo adalah `db/seed.ts`, perkakas), dan
  **`stock_movements` ditulis hanya oleh konteks Persediaan/Pembelian**.
  `account_monthly_balances` (ringkasan Tahap 2) juga penulis-tunggal Akuntansi.
- Shared kernel yang sah secara DDD memang ada dan kecil: `lib/money`
  (Decimal), `lib/errors`, `lib/permissions`+`lib/modules`, `lib/session`,
  `db/tenant` (konteks tenant/RLS), `server/sequences` (penomoran dokumen),
  `server/audit`, `server/idempotency`. Konteks mengimpor kernel ini dari mana
  pun — itu pola shared kernel yang benar, bukan kebocoran.

**Bukti sisi lemahnya — konteks adalah batas modul, bukan batas data:**

- **Satu skema bersama**: 98 tabel dalam satu `src/db/schema.ts`; tidak ada
  namespace skema per konteks (ARS1-05 tetap berlaku sesudah Tahap 4).
- **48 dari 98 tabel (49%) direferensikan ≥2 konteks** untuk baca/tulis.
  Yang paling dibagi: `accounts`, `user`, `session` (7 konteks — sebagian
  artefak join nama pembuat & pemetaan akun), `company_settings`, `customers`,
  `sales` (6), `products`, `warehouses` (5). Sebagian sah (master data memang
  dibaca semua), sebagian menunjukkan kepemilikan belum tuntas.
- **Master data ditulis 4 konteks**: `customers` ditulis POS, Persediaan,
  Master Data/Impor, **dan** Platform/Pengaturan (CRUD pihak hidup juga di
  actions pengaturan & actions persediaan — kelanjutan ARS1-04: 118 titik
  mutasi di actions). `products`, `suppliers`, `categories`, `units`,
  `purchase_orders`, `stock_documents` masing-masing ditulis 2 konteks
  (domain + jalur actions/impor).
- **Dua penulis pinggiran untuk stok**: `stock_on_hand` ikut ditulis
  `actions/settings.ts` dan `actions/inventory.ts` — keduanya `delete`
  baris qty-nol yang terjaga hitungan (pembersihan administratif saat
  nonaktif gudang/produk), bukan mutasi gerakan; `stock_movements`-nya sendiri
  tetap penulis-tunggal. Kecil, tetapi membuktikan garis "hanya domain yang
  menulis" punya pengecualian di lapisan actions.
- **Pelaporan membaca semua konteks tanpa read-model terpisah**:
  `reports.ts` (konteks Akuntansi) mereferensikan 49 tabel termasuk milik POS
  & Persediaan. Untuk ERP satu deployment ini pilihan yang masuk akal
  (laporan *adalah* produk lintas-konteks), tetapi secara DDD itu berarti
  tidak ada batas baca antar-konteks sama sekali.
- Impor lintas-konteks antar himpunan berkas: 106 tepi; terbesar yang sejati
  adalah POS → Persediaan (11, lewat barrel `applyStockMovement` — jalur
  resmi), POS → Akuntansi (5) dan Persediaan → Akuntansi (6) (lewat
  `postJournal` — jalur resmi), HR → Akuntansi (5) vs Akuntansi → HR (4)
  (payroll memang dua arah secara bisnis: HR menghitung, Akuntansi memposting
  & melaporkan). Sisanya sebagian besar konsumsi shared kernel yang dalam
  sensus ini terpetakan ke "Platform".

**Risiko praktis:** perubahan skema/aturan master data memiliki blast radius
lintas-konteks yang tidak terlihat dari struktur folder; tim yang mengira
folder = kepemilikan akan terkejut. Risiko integritas rendah (invariant
jurnal & stok justru penulis-tunggal), risiko evolusi sedang.

**Rekomendasi:** (1) tulis peta konteks ini sebagai dokumen resmi (satu
halaman di `docs/`) dengan label jujur "modular monolith, database bersama,
kepemilikan tulis per konteks" + daftar 20 tabel multi-penulis sebagai daftar
pantau; (2) tutup dua penulis pinggiran `stock_on_hand` di actions dengan
memindahkannya ke fungsi domain inventory saat berkasnya disentuh;
(3) jangan kejar pemisahan skema per konteks sekarang — biaya migrasi tidak
sebanding manfaat pada satu deployment; cukup jangan menambah penulis baru
untuk tabel yang hari ini penulis-tunggal.

---

## Butir 3 — Public Interface vs Internal Implementation

**Vonis: SESUAI — Skor 8/10**

**Bukti terukur (sesudah pemecahan Tahap 4):**

- **Penetrasi ke internal `pos/` & `inventory/` dari luar modulnya: 0 impor.**
  Setiap pemanggil luar (actions, halaman, test, `pos-offline`) mengimpor
  lewat permukaan publik: `src/server/pos.ts` / `src/server/inventory.ts`
  (barrel kompatibilitas 4 baris, berkomentar asal-usulnya) yang mengekspor
  ulang `pos/index.ts` / `inventory/index.ts`. Di dalam folder, modul saling
  mengimpor secara langsung (itu hak internal), dan arah internalnya DAG:
  pos — sales → quote, returns → sales; inventory — dokumen → movements.
- Pola yang sama terbalik di lapisan komponen: komponen hanya menerima
  **tipe** dari domain (5 tepi type-only, butir 1) dan memanggil actions —
  tidak ada komponen yang menembus implementasi domain.

**Keterbatasan pola (pengurang skor):**

- Pola folder+index baru diterapkan pada **2 dari ±7 konteks**. Konteks lain
  berbentuk berkas tunggal (`accounting.ts`, `reports.ts`, `hr.ts`, …) —
  nama berkasnya *adalah* antarmukanya, yang sah untuk modul satu berkas,
  tetapi berarti tidak ada perbedaan "publik vs internal" yang dapat
  ditegakkan di sana; fungsi pembantu dan fungsi publik tercampur dalam satu
  daftar ekspor.
- Barrel memakai `export *`: permukaan publik = "apa pun yang diekspor
  folder", tanpa kurasi daftar ekspor eksplisit. Hari ini daftar ekspor
  `pos/index.ts`/`inventory/index.ts` memang persis API asal (terverifikasi
  Tahap 4), tetapi tidak ada yang mencegah ekspor internal bocor menjadi
  publik di masa depan selain review.
- Di luar server, tidak ada barrel sama sekali: impor komponen/lib selalu
  jalur-dalam per berkas (`@/components/blocks/…`, `@/lib/…`). Idiomatik
  untuk Next.js dan tidak menimbulkan masalah terukur hari ini, tetapi
  "permukaan publik" di lapisan itu murni konvensi jalur.

**Risiko praktis:** rendah; terutama risiko drift — pola bagus yang tidak
digeneralisasi akan kalah oleh kebiasaan lama pada modul berikutnya.

**Rekomendasi:** terapkan folder+index secara oportunistik saat modul domain
lain melewati ±1.500 baris atau saat disentuh besar (kandidat berikut:
`reports.ts`, `supplier-returns.ts`, `hr.ts`); pertimbangkan mengganti
`export *` pada barrel dengan daftar ekspor bernama saat daftarnya stabil.

---

## Butir 4 — Screaming Architecture

**Vonis: SEBAGIAN — Skor 7/10**

**Bukti terukur (sensus kata domain atas 330 jalur berkas ter-commit):**

| Wilayah | Jalur mengandung kata domain bisnis |
|---|---|
| `src/app` (rute) | **90/107 (84%)** |
| `src/components` | 71/117 (61%) |
| `src/server` | 33/66 (50%) |
| `src/lib` | 2/34 (6%) |
| `src/db` | 0/5 (0%) |
| **Total** | **196/330 (59%)** |

- **Rute berteriak paling keras, dan itu yang dilihat pertama kali**:
  `src/app/app/` berisi tepat empat modul bisnis — `pos`, `gudang`,
  `akuntansi`, `pengaturan` — dengan kosakata Indonesia domain di dalamnya
  (`jurnal`, `buku-besar`, `kasbon`, `pinjaman`, `opname`, `penerimaan`,
  `penyesuaian`, `retur-pembelian`, `piutang-utang`, …). Developer baru
  dapat memetakan produk dari pohon rute saja.
- **Komponen mencerminkan modul bisnis**: folder `pos`, `gudang`,
  `akuntansi`, `pengaturan` + folder teknis yang jujur perannya (`blocks`,
  `print`, `shell`, `ui`).
- **Kerangka teratas tetap berbentuk framework**: `app / components / server /
  lib / db` adalah layering teknis (dan idiom Next.js). Di dalam `server/`,
  konteks tampil sebagai nama berkas pada daftar datar 45 berkas
  (`accounting.ts` di samping `catalog.ts` di samping `hr.ts`) — terbaca,
  tetapi tidak "berteriak"; dua folder Tahap 4 (`pos/`, `inventory/`)
  menunjukkan arah yang lebih baik.
- **`lib/` adalah laci teknis yang menyembunyikan domain**: hanya 2/34 nama
  berkas berkosa-domain, tetapi diukur dari isinya **±66% LOC `lib/`
  (±3.290 dari 5.241 baris) adalah logika domain murni** — mesin payroll
  Indonesia (`payroll-indonesia.ts` 325 + `payroll-indonesia-defaults.ts` 306),
  mesin impor (`import-parse.ts` 710 + `import-classify.ts` 215),
  `custom-fields.ts` 345, `pos-offline.ts` 259, `accounting.ts` 113,
  `journal-form.ts` 191, `opname-count.ts` 167. Sisanya platform murni yang
  memang pantas generik (money, errors, permissions, session, env, log, csv,
  format, utils). Jadi masalahnya bukan isi — isi tertata per berkas — melainkan
  bahwa struktur folder menyembunyikan fakta bahwa dua konteks (Payroll,
  Impor) sebagian tinggal di "laci utilitas".

**Risiko praktis:** orientasi developer baru: produk terbaca dari rute,
tetapi mesin payroll & impor harus ditemukan lewat pencarian, bukan struktur.
Risiko salah tempat untuk kode baru: logika domain baru tergoda masuk `lib/`
karena "di sana tempatnya logika murni", mengaburkan konteksnya.

**Rekomendasi:** jangan restrukturisasi besar. Saat payroll/impor disentuh
berikutnya, pertimbangkan `lib/payroll/` dan `lib/import/` (atau pindahkan
mesin murni ke folder konteks server-nya dengan `import type`-saja dari klien
bila memang dipakai klien); tambahkan satu baris di AGENTS.md: "logika murni
milik konteks X tinggal di <folder konteks>, `lib/` hanya untuk kernel
platform & utilitas lintas-konteks".

---

## Butir 5 — DIP & Kesesuaian Hexagonal untuk Konteks Ini

**Vonis: SESUAI untuk konteksnya (bukan kemurnian teori) — Skor 7/10**

**Bukti terukur:**

- **Injeksi transaksi adalah norma, bukan pengecualian**: dari 45 berkas
  domain `src/server`, **39 mendeklarasikan fungsi berparameter `tx: Tx`**,
  dan **0 berkas memanggil singleton `db` secara langsung**
  (`db.select/insert/update/delete/transaction` = 0 kemunculan di domain).
  Ketergantungan domain pada modul `@/db` bersifat **type-only**:
  `import type { Tx } from "@/db"` — domain tidak tahu pool, URL, atau
  kredensial; ia hanya tahu "beri saya transaksi".
- **Composition root tunggal & konsisten**: transaksi lahir di tepi lewat
  `withCompany`/`withCompanyReadOnly` (`src/db/tenant.ts`, sekaligus penegak
  RLS tenant) — dirujuk 114 berkas (20 actions, 88 app, 4 domain). Inilah
  "port" sesungguhnya arsitektur ini: satu cara membuka unit-of-work
  bertenant, dipakai semua jalur.
- **Gerbang lintas-konteks berperan sebagai port de facto**: konteks lain
  tidak menulis jurnal kecuali lewat `postJournal` (Akuntansi) dan tidak
  menggerakkan stok kecuali lewat `applyStockMovement` (Persediaan) —
  terverifikasi penulis-tunggal di butir 2. Dua fungsi ini adalah antarmuka
  antar-konteks yang nyata, lebih berarti daripada interface formal.
- **Adapter pihak ketiga terkungkung**: Better Auth disentuh hanya oleh
  `lib/auth.ts` (konfigurasi), `app/api/auth/[...all]/route.ts` (mount point),
  dan `actions/users.ts` (manajemen pengguna admin — pemakaian tepi yang sah);
  tidak ada berkas domain yang tahu Better Auth ada. Pencetakan terkungkung
  di `components/print` (PrintShell). Ekspor/impor berkas terkungkung di
  rute `app/api/export|import` + `lib/csv`, `lib/import-*`.
- **Yang tidak ada (dan memang tidak perlu ada di sini)**: tidak ada
  interface repository, tidak ada lapisan port/adapter formal, domain menulis
  kueri Drizzle langsung terhadap objek tabel skema (41/45 berkas domain
  mengimpor `@/db/schema`). Domain dan persistensi adalah satu lapisan yang
  menyatu dengan sadar.

**Penilaian kesesuaian konteks:** untuk ERP UKM **satu deployment, satu
basis data (PostgreSQL), satu UI (Next), satu penyedia auth**, hexagonal
penuh akan berarti membungkus 98 tabel dengan interface + implementasi +
pemetaan DTO tanpa satu pun sumbu perubahan nyata yang dilayaninya — itu
over-engineering menurut standar 2025–2026 sendiri (pragmatic architecture:
bayar abstraksi hanya di titik yang terbukti berubah). Titik yang *terbukti*
berubah/berisiko di sistem ini — posting jurnal, gerakan stok, konteks
tenant, auth — justru sudah diabstraksi lewat fungsi gerbang dan injeksi Tx.
Skor ditahan di 7, bukan lebih tinggi, oleh tiga hal: (1) tipe `Tx` sendiri
diekspor dari modul infrastruktur `@/db` (domain mengimpor tipe dari
infrastruktur — kebocoran inversi kecil; tipe netral di `lib/` akan lebih
bersih); (2) lapisan actions masih menulis DB langsung di wilayah CRUD
(ARS1-04), sehingga DIP berlaku penuh hanya di domain, tidak di tepi tulis;
(3) `db/seed.ts` melewati semua gerbang (perkakas — dapat diterima, tetapi
membuat "satu-satunya jalan" tidak harfiah benar di repo).

**Risiko praktis:** bila suatu hari ada sumbu perubahan kedua (mis. API
publik untuk pihak ketiga, atau aplikasi mobile), titik sambungnya adalah
lapisan actions — yang memang sudah menjadi gerbang — sehingga evolusi itu
tidak menuntut pembongkaran domain. Risiko hari ini: minimal.

**Rekomendasi:** jangan bangun lapisan repository. Cukup: (1) pindahkan
deklarasi tipe `Tx`/`Db` ke berkas tipe netral atau dokumentasikan sebagai
pengecualian resmi; (2) jaga aturan "domain tidak memanggil singleton db"
dengan test graf murah (angka hari ini 0 — kunci sebelum berubah).

---

## Skor dimensi & ringkasan

| Butir | Vonis | Skor |
|---|---|---|
| 1. Dependency Rule | SESUAI | 8/10 |
| 2. Bounded Context vs layering | SEBAGIAN | 6/10 |
| 3. Public interface vs internal | SESUAI | 8/10 |
| 4. Screaming Architecture | SEBAGIAN | 7/10 |
| 5. DIP & hexagonal fit | SESUAI (konteks) | 7/10 |
| **Dimensi AD-1** | | **7/10** |

**Tiga temuan terpenting:**

1. **Disiplin dependensi terukur kelas satu, tetapi belum dikunci perkakas.**
   0 siklus runtime, 0 impor framework di domain, 0 panggilan DB konkret di
   domain, tepat 1 tepi ke atas (skrip seed). Ini fondasi yang benar-benar
   dapat dipertahankan — kelemahannya hanya bahwa tidak ada fitness function
   yang menjaga angka-angka ini tetap 0 (ARS1-06).
2. **Label yang jujur adalah "modular monolith berkonteks, database bersama",
   bukan bounded-context DDD.** Kepemilikan *tulis* kuat di tempat yang
   menentukan integritas (jurnal & gerakan stok penulis-tunggal per konteks;
   78% tabel penulis-tunggal), tetapi data & baca dibagi bebas (49% tabel
   direferensikan ≥2 konteks, master ditulis hingga 4 konteks, satu skema
   monolit). Pilihan ini tepat untuk produknya — asal tidak diklaim lebih
   dari itu.
3. **Dua perbaikan struktural termurah dengan nilai tertinggi:** generalisasi
   pola folder+barrel Tahap 4 (hari ini penetrasi internal = 0 pada 2 modul
   yang menerapkannya — bukti pola itu bekerja) ke modul domain besar
   berikutnya saat disentuh, dan pengakuan struktural atas domain yang
   bersembunyi di `lib/` (±66% LOC-nya logika domain: payroll & impor)
   agar struktur folder berhenti menyembunyikan dua konteks.
