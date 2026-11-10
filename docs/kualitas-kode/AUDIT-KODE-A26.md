# Audit Kualitas Kode A-26 (Tahap Q0) — Penilaian terhadap Kontrak Pemilik

**Tanggal:** 2026-11-06 · **Penilai:** `docs/PANDUAN-KUALITAS-KODE.md`
(kontrak pemilik 2026-11-06) · **Keadaan kode:** sesudah A-25 U8 (HEAD
`06c951e`) · **Metode:** Graphify disegarkan (`graphify update .`, graf
6.544 node / 23.967 edge), pengukuran LOC/ekspor/fungsi, pindai impor &
penulis tabel, dibaca silang dengan A-20 (`docs/arsitektur-dalam/AD-1..4`)
dan `docs/MODULE_BOUNDARIES.md`. Tahap ini audit murni — **nol kode
aplikasi diubah**.

## 0. Baseline terukur (semua angka dapat direproduksi)

| Ukuran | Nilai |
|---|---|
| Berkas TS/TSX di `src/` | 432 berkas, **111.044 baris** |
| LOC per wilayah | server 45.488 · components 35.351 · app 18.449 · lib 7.688 · db 4.044 |
| Distribusi ukuran | ≤200 baris: 262 (61%) · 201–400: 95 · 401–500: 20 · **501–800: 29 · 801–1000: 10 · >1000: 16** |
| Konsentrasi ekor | 16 berkas >1000 baris memuat ±24.700 baris ≈ **22% seluruh LOC** di 3,7% berkas |
| Graf dependensi | 6.544 node / 23.967 edge; 4.456 tepi level berkas atas 675 berkas |
| Siklus impor level berkas | **Tepat 1 SCC**: `lib/permissions.ts ↔ lib/modules.ts` — `import type` dua arah, terhapus saat runtime, **sudah terdokumentasi** di MODULE_BOUNDARIES §4. Klaim lama "0 siklus runtime" **terverifikasi ulang: benar** |
| God nodes (degree) | `d()` 590 · `withCompany()` 353 · `AppError` 346 · **`schema.ts` (berkas) 329** · `withCompanyReadOnly()` 289 · `todayISO()` 281 · `formatIDR()` 244 · `guard()` 242 · `writeAudit()` 209 · `toDb()` 208 — semuanya utilitas platform terpusat (kohesi disengaja), kecuali `schema.ts`: berkas data paling terhubung di repo |
| Kepemilikan tulis tabel | 95/100 tabel punya penulis terdeteksi; **65 (68%) penulis-tunggal** per area (pindai kasar, `actions` dihitung sebagai area sendiri). Inti keras bersih 100%: `journalEntries` hanya ditulis `server/accounting.ts` (lewat `postJournal`, 27 pemanggil), `stockMovements` hanya `server/inventory/movements.ts`, insert `sales` hanya `server/pos/sales.ts` |
| Penulis multi-area teratas | `partyPayments` 6 area · `stockReceipts` 6 · `stockOnHand` 4 · `sales` 4 (termasuk `mergeParties` di `master-data.ts` yang menunjuk-ulang FK dokumen) |
| Tulis tabel langsung di lapisan aksi | **±121 titik** `.insert/.update/.delete(` di `src/server/actions/*.ts` |
| Impor bypass barrel | **Tepat 1**: `components/shell/module-shell.tsx` → `@/server/inventory/opname-tasks` (seharusnya lewat barrel `@/server/inventory`) |
| Impor UI→server | Komponen hanya `import type` dari modul server + fungsi baca di server component cangkang; halaman→server lewat modul pemilik (catalog 37 impor, reports 29, hr 16, accounting 12) |
| `lib/` | 7.688 baris / 53 berkas; **±3.764 baris (±49%) adalah logika domain murni** (lihat §4) |
| Fitness functions | **1** test arsitektur (`tests/unit/architecture-read-paths.test.ts`, 100 baris, peta pengecualian kosong) dari 164 berkas test |
| Fungsi terpanjang terukur | `commitImportBatchAction` **517** · `seed()` **791** · `QuickEntryForm` **797** · `postSupplierReturn` **339** · `SettingsForm` **335** · `voidReceipt` 236 · `getPartyDetail` 217 |

## 1. Skor per prinsip kontrak

| # | Prinsip kontrak | Skor | Bukti ringkas |
|---|---|---|---|
| 1.1a | Dependency Rule (dependensi ke dalam) | **SEBAGIAN** | 0 siklus runtime; domain server 0 impor Next/React; domain menerima `tx` (DIP pragmatis). Pengurang: ±121 tulis tabel langsung di actions (batas aksi↔domain bocor); `lib/auth.ts` & `lib/session.ts` mengimpor `@/db`; 19 halaman mengimpor objek tabel skema untuk lookup 1 tabel (sah menurut ARS1-01 proyek, longgar menurut kontrak §1.3) |
| 1.1b | High Cohesion + Loose Coupling | **SEBAGIAN** | 5 wilayah server sudah folder domain kohesif (pos, inventory, hr, reports, supplier-returns); pengurang: `catalog.ts` & `settings-forms.tsx` kohesi rendah (banyak concern), wilayah datar lain belum berbentuk |
| 1.1c | Blast Radius Minimal | **SEBAGIAN** | Arkeologi A-20: fitur besar 84–94% baris di berkas baru. Pengurang struktural: `schema.ts` degree 329 — hampir setiap fitur data menyentuh 1 berkas raksasa yang sama; `catalog.ts` dibaca 37 halaman |
| 1.1d | Screaming Architecture | **SEBAGIAN** | `src/server/` menjerit domain (nama folder/berkas = bahasa bisnis); struktur utama tetap lapis teknis `app/components/server/lib/db` — sebagian dipaksa Next.js App Router, sebagian pilihan |
| 1.2 | Modular Monolith + Vertical Slice | **SEBAGIAN** | Monolit modular: ya (4 modul + platform, MODULE_BOUNDARIES tegas). Slice vertikal per fitur: belum — aksi/domain/UI masih terpisah per lapis, bukan per fitur |
| 1.3 | Boundary & public interface | **SEBAGIAN** | Barrel `index.ts` hidup di 5 folder domain; bypass terukur hanya 1; gerbang jurnal tunggal `postJournal` = facade akuntansi yang nyata. Pengurang: ±12 wilayah domain masih berkas datar tanpa facade formal; kepemilikan tabel bersama (partyPayments 6 penulis) belum berkontrak tertulis per tabel |
| 1.4 | Extensibility / OCP | **SESUAI** | Bukti A-20 (skor 8/10): fitur besar lahir di berkas baru; angka bisnis = konfigurasi per perusahaan (D-25), bukan konstanta; pemetaan akun & peran kustom = titik ekstensi nyata |
| 2.1 | Ukuran berkas & fungsi (SRP) | **MELANGGAR (di ekor)** | 87% berkas sehat (≤500 baris), tetapi 16 berkas >1000 baris = 22% LOC, dan fungsi 300–800 baris masih ada di jalur kritis (impor, retur pemasok, terminal, seed) |
| 2.2 | Package by Feature | **SEBAGIAN** | Sama dengan 1.1d/1.2: arah folder-domain di server terbukti, belum menyeluruh (actions & components masih per lapis/modul, bukan per fitur) |
| 2.3 | Prinsip kode inti (kejelasan, testabilitas) | **SEBAGIAN** | Kuat: penamaan domain konsisten, error terpusat (`guard`/`AppError`, 346–242 degree = dipakai merata), logika murni terpisah & teruji (164 berkas test). Pengurang: fungsi raksasa sulit diuji per cabang; logika domain di `lib/` tak berlabel kepemilikan |
| 2.4 | Anti-bloat & fitness functions | **SEBAGIAN** | Bloat sempit (A-20: 6 dependensi yatim). Tetapi penjaga mesin nyaris tidak ada: 1 fitness function; **tidak ada ratchet ukuran berkas, larangan impor internal, atau test siklus** — pelanggaran besok tidak tertangkap CI |
| 3 | UI/UX (§3 kontrak) | **SEBAGIAN** | A-25 baru menutup konsistensi visual & workflow (bukan diaudit ulang di sini). Terukur tersisa: **7 komponen >800 baris**; target sentuh permukaan padat dominan h-8 (32px)/h-9 (36px), stepper qty POS `size-6` (24px) — di bawah 44px kontrak §3.2 (konflik sadar dengan AGENTS.md "compact Odoo", lihat §3) |

**Vonis keseluruhan: SEBAGIAN — fondasi sehat, ekor distribusi melanggar.**
Sistem ini bukan big ball of mud: batas modul, gerbang jurnal, dan
kepemilikan inti terukur bersih. Yang melanggar kontrak terkonsentrasi
di (a) ±16 berkas raksasa, (b) lapisan aksi yang menebal & menulis
langsung, (c) penjaga mesin yang kurang. Ketiganya dapat diperbaiki
inkremental tanpa rewrite — persis resep kontrak §1.2.

## 2. Daftar pelanggaran terprioritaskan

Blast radius = seberapa luas perubahan pada titik ini merembet.
Risiko = peluang merusak perilaku bila dibiarkan / saat diperbaiki.

| ID | Pelanggaran | Bukti | Blast radius | Risiko |
|---|---|---|---|---|
| **K-01** | `src/db/schema.ts` — 2.915 baris, **100 tabel, ±10 domain dalam 1 berkas**; berkas dengan degree tertinggi di graf (329) | wc + graf | **Sangat tinggi**: setiap fitur data menyentuh berkas yang sama → konflik, antre review, satu titik ubah untuk semua modul | Sedang (mekanis bila dipecah dgn barrel) |
| **K-02** | `components/pengaturan/settings-forms.tsx` — 1.811 baris, **17 ekspor, ±9 concern** (identitas/pajak, QRIS, metode bayar CRUD, gudang CRUD, cabang, pemetaan akun, cetak, penomoran, modul, kolom kustom) | ekspor terukur | Tinggi di wilayah Pengaturan (wilayah paling sering berubah = churn konfigurasi) | Rendah–sedang |
| **K-03** | Lapisan aksi menebal per layer: `actions/accounting.ts` 1.621 (27 aksi, ±11 concern), `actions/hr.ts` 1.656 (24 aksi, ±10 concern), `actions/inventory.ts` 1.686 (30 aksi, ±7 concern) — **plus ±121 tulis tabel langsung** di actions, menembus konvensi proyek sendiri ("actions own auth, parsing, revalidation; domain logic in src/server") | grep tulis di actions | Tinggi: tiga berkas ini pintu masuk hampir semua mutasi UI | Sedang |
| **K-04** | `server/catalog.ts` — 1.452 baris, **45 ekspor, ±10 concern** = read god-module; diimpor 37× dari halaman | ekspor + impor terukur | **Tinggi**: perubahan baca kecil berisiko merembet ke semua modul pengalaman | Sedang |
| **K-05** | Fungsi raksasa di jalur kritis: `commitImportBatchAction` 517, `postSupplierReturn` 339, `createSupplierReturn` 238, `voidReceipt` 236, `getPartyDetail` 217 baris | awk fungsi | Sedang per fungsi; cabang-cabangnya sulit diuji unit | Sedang–tinggi bila disentuh tanpa pecah |
| **K-06** | `components/pos/pos-terminal.tsx` — 1.448 baris, **1 komponen berfungsi 1.356 baris**; pendamping `payment-panel.tsx` 943. Permukaan paling kritis (kasir) dalam satu komponen | awk + wc | Tinggi di POS: setiap perubahan kasir membuka berkas yang sama | Tinggi (wilayah sensitif; pola pecah T5 A-19 sudah terbukti) |
| **K-07** | Panel multi-fitur: `components/akuntansi/hr-panel.tsx` 1.287 (20 ekspor, ±10 concern), `quick-entry-modal.tsx` 1.049 (satu `QuickEntryForm` 797 baris), `gudang/import-wizard.tsx` 937, `akuntansi/bank-reconciliation-panel.tsx` 856 | wc + ekspor | Sedang–tinggi per modul | Sedang |
| **K-08** | **Fitness functions kurang**: hanya 1 test arsitektur; tidak ada ratchet ukuran, larangan impor internal lintas modul, atau test siklus. Kontrak §2.4 tak terjaga mesin | `tests/unit/` | Menyeluruh (jangka panjang): setiap pelanggaran di atas bisa kambuh diam-diam | Rendah utk ditambah, tinggi bila absen |
| **K-09** | Kepemilikan tabel bersama tanpa kontrak per tabel: `partyPayments` ditulis 6 area, `stockReceipts` 6, `stockOnHand` 4, `sales` 4; `master-data.ts::mergeParties` menulis FK di tabel POS/gudang/akuntansi | pindai penulis tabel | Sedang: sebagian memang by-design (penyelesaian pembayaran bersama, merge pihak) — cacatnya adalah **tidak tertulis** di MODULE_BOUNDARIES, bukan keberadaannya | Sedang |
| **K-10** | Pola folder+barrel baru menutup 5 wilayah; **±12 wilayah domain masih berkas datar besar** tanpa facade: `master-data.ts` 1.165, `import-masters.ts` 1.268, `bank-reconciliation.ts` 884, `opening-balances.ts` 823, `purchasing.ts` 781, `serials.ts` 762, `payroll-indonesia.ts` 762, `fixed-assets.ts` 704, `employee-advances.ts` 702, `payables.ts` 697, `accounting.ts` 686 (rumah `postJournal`!), `batches.ts` 680. Domain impor tersebar 4 tempat (`import-masters.ts`, `import-files.ts`, `actions/import.ts` 1.316, `lib/import-parse|classify`) | ls + wc | Sedang: inkonsistensi pola = biaya kognitif tiap edit lintas wilayah | Rendah–sedang |
| K-11 | Target sentuh < 44px di permukaan padat (h-8/h-9 dominan; stepper qty `size-6` tercatat sejak FIX-POS) — kontrak §3.2 vs kepadatan ERP desktop | grep kelas ukuran | Rendah (keputusan desain sadar, lihat konflik §3) | Rendah |
| K-12 | `db/seed.ts` 1.061 baris, satu fungsi `seed()` 791 baris | awk | Rendah (hanya demo/dev; tidak menyentuh produksi) | Rendah |

Gejala kecil yang ikut tercatat: 1 impor bypass barrel
(`module-shell.tsx → inventory/opname-tasks`) — murah diperbaiki,
nilainya sebagai contoh penegakan K-08.

## 3. Titik konflik kontrak vs konvensi proyek (AGENTS.md) — eksplisit

Kontrak pemilik menang sebagai arah; migrasi pragmatis, bukan big-bang.

1. **Struktur utama (§1.1d/§2.2 kontrak vs struktur berjalan).** Kontrak
   meminta package-by-feature sebagai struktur utama; repo berjalan
   package-by-layer berdomain (`app/components/server/lib/db`) — dan
   Next.js App Router *memaksa* `src/app`. **Putusan audit:** jangan
   rombak struktur utama; perdalam folder-domain di dalam `server/`,
   `actions/`, dan `components/` per wilayah (arah yang sudah terbukti
   di 5 folder domain). Struktur "menjerit domain" dicapai di dalam
   lapis, bukan dengan melawan framework.
2. **Target sentuh 44px (§3.2 kontrak vs AGENTS.md "compact Odoo-like
   visual language" + keputusan terukur A-22/A-25: kontrol 32px).**
   **Putusan audit:** kontrak menang untuk *target sentuh primer di
   permukaan mobile/kasir* (aksi utama, stepper, baris yang diketuk
   kasir); kepadatan 32px di tabel desktop padat dipertahankan sebagai
   pengecualian sadar dan tertulis — bukan pelanggaran diam-diam.
   Penegakannya masuk ratchet Q1 sebagai daftar permukaan, bukan sapuan
   global.
3. **Dependency Rule ketat (§1.1 kontrak vs pola Tx-injection berjalan).**
   Domain menerima tipe `Tx` Drizzle — secara teori domain "tahu"
   database. AD-1 menilai ini DIP pragmatis yang tepat konteks (7/10):
   domain tidak mengimpor Next/React/UI sama sekali, dan seluruh
   logika murni (uang, parse, quote offline) hidup tanpa infra.
   **Putusan audit:** pertahankan; kontrak ditafsirkan terpenuhi pada
   arah dependensi runtime (0 siklus, 0 impor framework UI di domain).
4. **Satu berkas skema (§2.1 kontrak vs konvensi Drizzle).** Drizzle
   lazim satu `schema.ts`; kontrak melarang berkas multi-concern.
   **Putusan eksplisit ada di RENCANA (Q2): pecah per domain dengan
   barrel** — nama tabel & permukaan ekspor identik, migrasi tidak
   berubah, semua impor `@/db/schema` tetap sah.
5. **Query inline halaman (kontrak §1.3 vs ARS1-01 proyek).** AGENTS.md
   mengizinkan halaman mengueri 1 tabel tanpa join/agregasi; kontrak
   lebih suka semua lewat facade modul. **Putusan audit:** pertahankan
   ARS1-01 (sudah ber-ratchet dan peta pengecualiannya kosong); dicatat
   sebagai penyimpangan sadar dari tafsir paling ketat kontrak.

## 4. Peran `lib/` — mesin domain yang bersembunyi

`lib/` bukan sekadar utilitas: **±3.764 dari 7.688 barisnya adalah
logika domain murni** — `import-parse.ts` 709 (parser impor),
`pos-offline.ts` 470 (cermin quote POS offline, kontrak D-23),
`payroll-indonesia.ts` 324 + `payroll-indonesia-defaults.ts` 305
(mesin & tarif statutori), `statement-csv.ts` 321 (parser mutasi bank),
`custom-fields.ts` 344, `quick-entry.ts` 286 (definisi Catat Transaksi),
`account-mappings.ts` 204, `import-classify.ts` 214,
`opname-count.ts` 166 + `opname-cycle.ts` 92, `document-numbering.ts`
116, `accounting.ts` 112, `payment-settlement.ts` 101.

Penilaian jujur dua sisi: secara kontrak §2.3 ini **kekuatan** — logika
murni, teruji unit tanpa spin-up infra, tidak tahu Drizzle/Next.
Cacatnya **struktural**: kepemilikan domainnya tidak diakui (berkas
payroll tinggal sejajar `utils.ts`), sehingga developer baru tidak
melihat bahwa `lib/` memuat separuh mesin bisnis. Sisanya (±3.900
baris) infra murni yang sah di `lib/`: `money.ts`, `format.ts`,
`errors.ts`, `env.ts`, `permissions.ts`, `modules.ts`, `session.ts`,
`auth.ts`. Keputusan perbaikannya (pengelompokan bernama, tanpa
memindah logika ke server) ada di RENCANA Q9.

## 5. Yang sudah kuat — jangan dirusak refactor

- Gerbang jurnal tunggal `postJournal` (27 pemanggil, 1 penulis
  `journalEntries`) dan ledger stok tunggal (`stockMovements` 1
  penulis) — facade domain yang nyata, sesuai kontrak §1.3.
- 0 siklus runtime terverifikasi dari graf segar; satu-satunya SCC
  adalah pasangan type-only yang terdokumentasi.
- Folder domain + barrel di pos/inventory/hr/reports/supplier-returns
  dengan paritas API teruji (pola A-19/A-24) — pola pecah yang akan
  digeneralisasi, bukan pola baru.
- Ratchet ARS1-01 hidup dan bersih (0 pengecualian) — bukti fitness
  function bekerja; Q1 tinggal memperbanyak jenisnya.
- OCP terukur dari arkeologi git A-20 (fitur besar 84–94% berkas baru).
