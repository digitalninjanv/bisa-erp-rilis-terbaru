# Audit Duplikasi & Sentralisasi A-26 (Tahap Q0b) — "Ubah 1 Fitur, 1 Jalur?"

**Tanggal:** 2026-11-06 · **Pemicu:** perintah pengguna 2026-11-06 19:00
WIB — riset ulang arsitektur: apakah masih ada praktik jelek / tidak
efisien / tidak optimal / bertumpuk; pastikan semua **terpusat**
(mengubah 1 fitur cukup dari 1 jalur, tidak ada kemampuan yang
diimplementasikan dua kali, kustomisasi mudah karena parameter
terpusat). **Penilai:** `docs/PANDUAN-KUALITAS-KODE.md` + temuan Q0
(`AUDIT-KODE-A26.md`). **Keadaan kode:** sesudah A-25 U8 (HEAD
`06c951e`); Q1 sedang berjalan di pohon yang sama — tahap ini
**baca-saja, nol kode diubah**.

**Metode (semua angka dapat direproduksi):** grep terarah per concern;
Graphify `god-nodes` atas `graphify-out/graph.json` (graf Q0: 6.544
node / 23.967 edge); **jscpd** (min-lines 10, min-tokens 70) atas kode
TS/TSX tulisan tangan — snapshot migrasi JSON dikecualikan karena
duplikatif by-design (angka mentah tercemar 82,1% berasal dari sana;
angka bersih di bawah); analisis kopling perubahan dari `git log`
244 commit sejak 2026-10-20 (119 menyentuh `src/`; catatan: commit di
repo ini adalah commit tahap program, jadi pasangan co-change adalah
sinyal utama, bukan jumlah absolut per fitur).

## 0. Vonis ringkas

**Sentralisasi concern inti kuat; duplikasi keseluruhan rendah;
masalahnya spesifik, bukan sistemik.**

- Duplikasi kode tulisan tangan terukur jscpd: **3.137 baris klon dari
  110.975 baris = 2,83%** (178 fragmen). Bukan codebase salin-tempel.
- God nodes graf semuanya utilitas platform terpusat yang sah: `d()`
  590 · `withCompany()` 353 · `AppError` 346 · `withCompanyReadOnly()`
  289 · `todayISO()` 281 · `formatIDR()` 244 · `guard()` 242 ·
  `writeAudit()` 209 · `toDb()` 208. Yang paling terhubung di sistem
  justru titik-titik sentralnya — persis yang diminta pemilik.
- Dari 14 concern lintas-fitur yang dipetakan (§2): **9 terpusat
  penuh, 4 sebagian, 1 tersebar** (mekanisme paginasi).
- Duplikasi berbahaya yang nyata hanya **2** (D-01 aging, D-02
  pembayaran utang ganda) + 1 duplikasi alur UI besar (D-03 wizard
  impor). Sisanya ringan, terjaga, atau kemiripan palsu (§1).

## 1. Inventaris duplikasi (D-01…)

Klasifikasi: **ganda-berbahaya** = dua implementasi satu aturan/
kemampuan yang bisa saling menyimpang · **ganda-aman-terjaga** =
duplikasi disengaja dengan penjaga (test/dokumen/kontrak) ·
**kemiripan-palsu** = mirip di permukaan, sebenarnya varian sah atau
primitif bersama.

| ID | Temuan | Bukti (berkas:baris / hitungan) | Kelas |
|---|---|---|---|
| **D-01** | **Bucket & umur aging AR/AP ditulis 2×.** Batas 30/60/90 hari + hitung umur hari diimplementasikan di halaman piutang-utang DAN di route ekspor aging — keduanya dari data yang sama (`listReceivables`/`listPayables`, `reports/arap.ts`). Bila kebijakan bucket berubah, halaman dan ekspor bisa tidak sepakat. | `app/akuntansi/(akuntansi)/piutang-utang/page.tsx:843-857` (agregasi bucket; selisih hari :852) ↔ `app/api/export/aging/route.ts:13-22` (`ageDays` + `ageBucket`). Ironisnya label status tempo SUDAH bersama lewat `lib/due-date.ts` (`dueDateStatus`, `paymentStatusLabel`) — hanya bucket-nya yang ganda. | **ganda-berbahaya** (sedang) |
| **D-02** | **Dua implementasi paralel "bayar dokumen utang" di satu berkas.** `payPayableDocument` (untuk penerimaan barang) dan `payExpensePayable` (untuk beban) menyalin pola yang sama: validasi tanggal, hitung sisa, fee/withholding, kredit pihak berlebih, jurnal, alokasi. Kode sendiri mengakuinya: *"pola yang persis sama dengan payPayableDocument"* (`payables.ts:509`). Aturan pembayaran berubah ⇒ dua tempat wajib diubah serentak. `opening-balances.ts` ikut berbagi 60 baris klon dengan berkas ini (pencatatan pembayaran saldo awal meniru bentuk yang sama, :520-530 & :675-693). | `server/payables.ts:105` vs `:446`; jscpd: **225 baris klon internal / 7 fragmen** (terbesar di repo); `opening-balances.ts ↔ payables.ts` 60 baris / 4 fragmen. | **ganda-berbahaya** (sedang; jalur pembayaran inti) |
| **D-03** | **Dua komponen wizard impor menyalin seluruh alur.** Unggah → `fetch /api/import/parse` → analisis → muat baris → kecualikan per potongan 1000 → commit → toast: kerangka alur yang sama di `import-wizard.tsx` (937 baris, dokumen stok) dan `import-master-wizard.tsx` (master data). | jscpd: **341 baris klon / 12 fragmen** — pasangan antar-berkas terbesar di kode tulisan tangan. | ganda-sedang (alur UI; risiko drift perilaku impor) |
| D-04 | **Aturan "tarif pajak efektif" disalin tekstual.** Definisi kanonis `effectiveTaxRate` ada satu (`server/expenses.ts:262`, 9 pemanggil), tetapi ekspresi `taxEnabled ? taxRate : "0"` ditulis ulang inline di `server/actions/quick-entry.ts:253` dan `:397`, dan diturunkan lagi sebagai varian Decimal di `server/pos/quote.ts:422`. Varian `inventory/receipts.ts:368-385` berbeda sah (melempar validasi saat penandaan termasuk-PPN dipilih tetapi PPN nonaktif). | grep `taxEnabled ? ` = 4 titik. | ganda-ringan (aturan bisnis 1 baris di 3 salinan) |
| D-05 | **Mekanisme paginasi ditulis ulang di mana-mana.** Tidak ada helper/tipa hasil-paginasi bersama di `lib/` maupun `server/` (pencarian `paginate`/`PageResult` = 0). Pola `.offset((page - 1) * pageSize)` + query hitung terpisah ditulis tangan **≥19 titik** server — `catalog.ts` saja 6× (:153, :654, :712, :759, :813, :907) + `audit.ts:42`, `bank-reconciliation.ts:726`, `reports/sales.ts:259`, `actions/import.ts:148`. Di sisi halaman: idiom parse `Math.max(1, Number(params.page ?? "1") || 1)` ditulis per halaman (**16 halaman**), dan `pageSize` adalah literal per halaman (20/25/30/40/50/100/200 — pilihan tampilan, tetapi tanpa konstanta bernama). Sisi UI-nya justru sudah bersama (`blocks/pagination.tsx`, `DataListToolbar`/`SearchForm` dipakai 21 berkas). | grep terukur di atas. | duplikasi mekanisme — **tersebar** (risiko per titik rendah; biaya ubah perilaku paginasi tinggi) |
| D-06 | **Format tampilan mikro di luar `lib`.** Di luar jalur utama yang terpusat (lihat §2): 14 titik `toLocaleString("id-ID")` untuk angka tampilan (terbanyak `components/pengaturan/group-pricing.tsx` 4×, `components/pos/cart-panel.tsx` 2×, pesan toast wizard impor 2×, `app/pengaturan/page.tsx:278`, `app/pos/grup/page.tsx:81` — semuanya label langkah pembulatan/pesan, bukan hitungan uang), 1 `Intl.NumberFormat` langsung di `components/blocks/empty-state.tsx:69`, dan 1 `toLocaleString()` **tanpa locale** di `components/ui/chart.tsx:257`. | grep `toLocaleString`/`Intl.NumberFormat` di luar `src/lib/`. | ganda-ringan (presentasi; satu-satunya risiko nyata = chart tanpa locale bisa beda format antar-lingkungan) |
| D-07 | **`formatQty` — nama sama, perilaku beda.** `lib/money.ts:87`: format id-ID, maks 3 desimal. `server/supplier-returns/shared.ts:41`: `isInteger ? toFixed(0) : toString()` — tanpa pemisah ribuan, presisi penuh. Pengembang yang mengimpor nama yang salah mendapat keluaran berbeda diam-diam (dipakai 4× di wilayah retur pemasok). | Dua definisi terukur di samping. | kemiripan-menyesatkan (ringan; jebakan nama) |
| D-08 | **Panel fitur kembar kasbon ↔ pinjaman.** `advance-panel.tsx ↔ loan-panel.tsx` 108 baris klon / 5 fragmen; halaman detail `[employeeId]` keduanya 77 baris / 4 fragmen. Dua fitur saudara yang memang paralel (domainnya berbeda: kasbon vs pinjaman berbunga/angsuran). | jscpd. | ganda-aman-struktural — catat, **jangan paksa ekstrak** (baru 2 instans; kontrak §2.2 Rule of Three) |
| D-09 | **MoneyInput ↔ PercentInput = kembar kontrak yang disengaja.** PercentInput (U6) meniru kontrak ketik MoneyInput persis: klon `lib/money-input.ts ↔ lib/percent-input.ts` 118 baris + komponennya 87 baris. Masing-masing terkunci test sendiri (persen: 38 test). Risiko satu-satunya: kontrak perilaku ketik bisa drift tanpa test yang membandingkan keduanya. | jscpd + `tests/unit/percent-input.test.ts`. | ganda-aman-terjaga (dokumentasi keputusan U6) |
| D-10 | **Quote POS offline — lihat §3 (kasus khusus).** | — | **ganda-aman-terjaga** (cerminan disengaja; 1 penjaga tambahan diusulkan) |
| D-11 | **Halaman piutang-utang: dua paruh simetris dalam satu berkas.** Render baris piutang vs utang nyaris identik (blok `PaymentForm`/kredit/write-off di :409-503 terklon ke :560-681); jscpd 86 baris klon internal. Sepupu dekat D-01 — halaman yang sama memikul dua salinan presentasi AR & AP. | jscpd atas `piutang-utang/page.tsx` (887 baris). | duplikasi presentasi (sedang-ringan) |
| D-12 | **Chrome modal ditulis tangan per panel.** 31 titik `fixed inset-0` di ±15 berkas komponen (panel-panel form akuntansi/gudang) — backdrop + panel + penutup dirangkai ulang per form, di samping `ui/dialog.tsx` & `blocks/confirm-dialog.tsx` yang sudah ada. Perilaku tepi (Escape, fokus) tidak diverifikasi seragam per berkas di audit ini. | grep `fixed inset-0` = 31. | duplikasi chrome presentasi (ringan) |
| D-13 | **Validasi pra-kirim klien ditulis per form.** Pola `if (!x) return toast.error("…")` berulang di seluruh panel (128 panggilan `toast.error` di `components/`). Penting: **skema Zod TIDAK terduplikasi** — 165 `z.object` semuanya di `server/actions`, 0 di klien; server tetap otoritas validasi. Yang ganda hanya pemeriksaan UX per form (sebagian memang spesifik per form). | grep terukur. | duplikasi pola (ringan; bukan risiko kebenaran) |
| D-14 | **Aritmetika selisih hari ditulis per tempat.** Pembagi `86_400_000` muncul di ≥5 titik tanpa helper `daysBetween` di `lib/`: `server/pos-offline.ts:157`, `server/hr/employees.ts:253`, `server/bank-reconciliation.ts:297`, rute ekspor aging & halaman piutang-utang (bagian dari D-01). `lib/opname-cycle.ts:90` menghitung lewat nomor-hari UTC (varian ketiga yang sah untuk kasusnya). | grep `86400000\|86_400_000`. | duplikasi mekanisme (ringan) |

**Kemiripan palsu yang diperiksa dan BUKAN duplikasi** (agar tidak
"diperbaiki" percuma): `listProducts` / `listProductsForExport` /
`searchProducts` — tiga bentuk baca berbeda, **satu pemilik**
(`catalog.ts:105/205/252`); `listSuppliers`/`listCustomers` +
varian `Filtered` — pasangan simetris by-design di berkas yang sama;
`loadHrPayrollConfig` vs `loadStatutoryConfig` — berbeda dan
**terdokumentasi** (`server/hr/shared.ts:29`: satu mengembalikan null,
satu menerapkan bawaan); `documentPrefix` di `sequences.ts` —
re-export terdokumentasi dari `lib/document-numbering.ts` (komentar
:12-16 menyatakan satu sumber kebenaran; catatan kecil: fasad ini
tidak punya pemanggil luar tersisa); `catalog.stockByProduct`
(`catalog.ts:818`, peta massal via SQL mentah) vs
`inventory/movements.getStock` (:269, baca terkunci per produk) —
bentuk & tujuan berbeda; template cetak PO ↔ cetak penerimaan
(63 baris klon) — chrome cetak sama, dokumen berbeda (keluarga D-12,
ringan).

**Di dalam berkas lain yang tercatat jscpd:** `hr-panel.tsx` 137
baris klon internal (keluarga K-07 Q0 — panel multi-fitur),
`serials.ts` 81, `actions/accounting.ts` 76 — semuanya gejala berkas
raksasa yang sudah masuk rencana Q4/Q7/Q8, bukan duplikasi
antar-kemampuan baru.

## 2. Peta sentralisasi per concern — "ubah 1 fitur, lewat mana?"

| Concern | Satu sumbernya hari ini | Yang membaca/menulis di luar jalur | Status |
|---|---|---|---|
| **Uang — hitung & format** | `lib/money.ts` (`d()` 590 edge graf; `formatIDR` 244 edge, ±644 sebutan di `src/`; `formatDate` 107×) | 14 `toLocaleString` tampilan + 1 Intl + 1 chart tanpa locale (D-06) — nol hitungan uang ganda | **TERPUSAT** |
| **Jurnal** | `server/accounting.ts::postJournal` — gerbang tunggal (27 pemanggil, Q0); `getAccountMap` dipakai 65× dari luar berkas pemilik | Insert `journalEntries` di luar pemilik hanya `db/seed.ts:737,848` (bootstrap demo, bukan jalur produksi) | **TERPUSAT PENUH** |
| **Tenant / isolasi** | `db/tenant.ts::withCompany/withCompanyReadOnly` (353/289 edge) | Impor nilai `db` langsung hanya 4 berkas, semuanya pra-tenant platform: `lib/auth.ts:5`, `lib/session.ts:7`, `server/member-permissions.ts:2`, `server/actions/company.ts:6` (sesi & pembuatan perusahaan — belum ada konteks tenant) | **TERPUSAT** (pengecualian platform by-design) |
| **Nomor urut dokumen** | `server/sequences.ts::nextDocumentNumber` (51 pemanggil) + `lib/document-numbering.ts` (awalan & padding bawaan — satu sumber, dipakai UI pengaturan & domain) + override per perusahaan dibaca dalam transaksi yang sama | Tidak ada penerbitan nomor manual untuk dokumen (kode master saat impor, `import-masters.ts:771`, adalah penomoran kode produk — domain berbeda) | **TERPUSAT PENUH** |
| **Pemetaan akun** | 36 kunci di `lib/account-mappings.ts`; resolusi runtime satu pintu di `server/accounting.ts` (`getAccountMap` + resolver per kunci, :86-141) | **Nol** kode akun literal 4-digit (`"4010"`/`"4020"`/`"9000"`/`"9001"` dst.) di kode domain di luar mapping/defaults (grep = 0) | **TERPUSAT PENUH** |
| **Pengaturan (settings)** | **Tulis:** satu pemilik — `server/actions/settings.ts` (8 titik `.update(companySettings)`, semuanya aksi pengaturan) + seed. **Baca:** `catalog.getSettings` (`catalog.ts:359`) dipakai 28× | **±26 berkas** memilih langsung `from(companySettings)` (kebanyakan proyeksi 1-3 kolom di domain/halaman/API: `pos/sales`, `pos/quote`, `inventory/*`, `reports/arap`, halaman laporan & cetak, `lib/session`) — tidak ada kontrak baca bernama tunggal untuk "settings saat ini"; tiap konsumen merangkai ambil-barisnya sendiri | **SEBAGIAN** (tulis terpusat; baca tersebar-proyeksi) |
| **Izin** | `lib/permissions.ts` satu sumber; ditegakkan `requirePermission` 69× (actions), `requirePermissionPage` 154× (halaman), `can(ctx)` 92×, `requireModuleAccess` 12× (layout) | Literal `role === "owner"` di ±5 berkas / ±10 titik (`periode/page.tsx:101`, `pengguna/page.tsx:95`, `actions/accounting.ts:1398,1459`, `actions/users.ts` 6×) — kasus-khusus owner memang pengecualian terdokumentasi AGENTS.md, tetapi tersebar sebagai literal, bukan satu helper `isOwner(ctx)` | **TERPUSAT** (1 kebocoran kecil) |
| **Saklar modul** | `lib/modules.ts` (`MODULES`, `ALL_MODULE_KEYS`) — 42 titik cek enable, layout tergating `requireModuleAccess` | Tidak ditemukan cek saklar tulisan tangan di luar pola ini | **TERPUSAT** |
| **Tarif pajak (PPN)** | Satu kolom `companySettings.taxRate` + saklar `taxEnabled`; aturan efektif satu definisi `expenses.ts:262` (9 pemanggil); perhitungan satu primitif `lib/money::lineTax` (17 pemakaian) | Ekspresi aturan disalin di 3 titik lain (D-04); tidak ada tarif literal di mesin mana pun | **TERPUSAT** (dengan D-04) |
| **Parameter bisnis & tarif statutori** | Pola D-25 berjalan: ambang diskon POS, fee metode bayar, batas kredit = kolom settings/data per perusahaan; statutori payroll: bawaan **satu berkas** `lib/payroll-indonesia-defaults.ts` (305 baris) → ditanam ke tabel per perusahaan bertanggal efektif, mesin `payroll-indonesia.ts` membaca konfigurasi (0 literal tarif di mesin) | Lihat daftar hard-code §4 — nyaris bersih | **TERPUSAT** |
| **Audit log** | `server/audit.ts::writeAudit` — 201 pemakaian | Insert langsung ke tabel audit di luar pemilik: **0** | **TERPUSAT PENUH** |
| **Idempotensi** | `server/idempotency.ts::claimIdempotencyKey` — 31 pemakaian di perbatasan (checkout, sinkron offline, impor, pembayaran) | Tidak ditemukan pola kunci-idempotensi tulisan tangan kedua | **TERPUSAT PENUH** |
| **Penanganan error aksi** | `lib/errors.ts::AppError` (346 edge) + `guard()` (242 edge; 194× di actions) | Hanya 5 blok `try {` di seluruh `server/actions` — tidak ada penanganan error per-aksi yang menyimpang | **TERPUSAT PENUH** |
| **CSV / ekspor** | `lib/csv.ts` (`toCsv`/`csvResponse`/`moneyCsv`) — **11/11 route ekspor** memakainya (42 sebutan) | Tidak ada pembangun CSV manual (grep pola join/kutip = 0 di luar lib) | **TERPUSAT PENUH** |
| **Paginasi & parameter saring** | UI: `blocks/pagination.tsx` + `DataList` (21 berkas memakai toolbar bersama). Server: **tidak ada** helper bersama | ≥19 titik offset manual + 16 halaman parse parameter sendiri (D-05) | **TERSEBAR** (satu-satunya concern yang gagal uji 1-jalur) |
| **Stok tersedia** | Primitif bersama: `getReservedQuantities` satu definisi (`reservations.ts:167`) dipakai quote & checkout; on-hand otoritatif `movements.getStock`; ketersediaan batch `batches.ts` dipakai quote (`quote.ts:380-396`) | Rumus aplikasi `onHand − reserved` diterapkan di 2 tempat di atas primitif yang sama (`pos/quote.ts:390-396` dan `reservations.ts:119`) — tipis dan konsisten, bukan dua mesin | **TERPUSAT** (rumus aplikasi ganda-tipis, tercatat) |

## 3. Kasus khusus: quote POS offline vs quote server

**Klasifikasi: cerminan DISENGAJA dan terjaga (ganda-aman-terjaga) —
bukan duplikasi liar.**

- Server: `server/pos/quote.ts::quoteCart` (599 baris berkas) adalah
  otoritas. Lokal: `lib/pos-offline.ts::computeLocalOfflineQuote`
  (:354, di berkas 470 baris) — lahir dari temuan A-24 T6-01: tombol
  Bayar mati saat server tak terjangkau; kontrak D-23.
- Keduanya **berbagi primitif yang sama** dari `lib/money.ts`
  (diskon baris, pajak inklusif, pembulatan) — yang dicerminkan hanya
  orkestrasi atas katalog lokal, bukan rumus uang. Bukti jscpd:
  klon literal antar keduanya hanya **48 baris / 2 fragmen** — ini
  penulisan-ulang di atas primitif bersama, bukan salin-tempel.
- Penjaga yang ada: (a) test unit khusus
  `tests/unit/pos-offline-local-quote.test.ts` — **8 kasus**, nilai
  harapnya dihitung dari logika `quote.ts` server (komentar kepala
  berkas menyatakannya eksplisit); (b) test integrasi offline
  (`pos-offline-tahap2`, `pos-offline-queue`) + e2e skenario A/C
  A-24 yang membuktikan angka sinkronisasi cocok; (c) divergensi
  yang memang disengaja terdokumentasi di kepala test: harga
  kelompok per produk tidak diketahui klien → selisih diselesaikan
  sebagai **konflik harga di peninjauan sinkronisasi**, bukan
  disenyapkan.
- **Kesenjangan penjaga (satu-satunya):** paritas dijaga *manual* —
  nilai harap ditulis tangan dari logika server. Tidak ada
  *differential test* yang menjalankan kedua implementasi atas
  fixture yang sama dan membandingkan keluaran; bila aturan quote
  server berubah, test lokal hanya gagal bila kasusnya kebetulan
  tercakup 8 kasus itu. Usulan penjaga ada di §6 (P-05).

## 4. Inventaris angka & aturan terkode keras di domain

Hasil perburuan literal (grep tarif/ambang/kode di `src/server` +
`src/lib`): **nyaris bersih** — ini kekuatan nyata codebase terhadap
kontrak §1.4 & aturan D-25 pemilik.

| # | Literal | Tempat | Penilaian |
|---|---|---|---|
| H-01 | Toleransi seimbang `"0.01"` | `server/reports/statements.ts:273` | Magic number akuntansi tanpa nama konstanta — kecil, tetapi satu-satunya angka domain telanjang di mesin laporan |
| H-02 | Batas bucket aging 30/60/90 | 2 tempat (D-01) | Aturan bisnis terkode keras **dan** ganda — perbaiki lewat D-01 (pindah ke `lib/due-date.ts` sebagai konstanta bernama) |
| H-03 | Batas baris impor `MAX_ROWS = 25_000` | `app/api/import/parse/route.ts:17` | Batas teknis, satu definisi, pesan kesalahan memakainya — sah; cukup dicatat |
| H-04 | `pageSize` per halaman (20/25/30/40/50/100/200) | 16+ halaman (D-05) | Pilihan tampilan per konteks — bukan aturan bisnis; yang kurang hanya konstanta bernama bila ingin diseragamkan |
| H-05 | Validasi fee persen `< 100` | `server/actions/settings.ts:249` | Batas domain di validator — sah |
| — | Tarif PPN, tarif & batas BPJS/TER/PTKP, ambang diskon, fee, upah minimum | **Tidak ada literal di mesin mana pun** — semuanya konfigurasi per perusahaan (settings / tabel statutori bertanggal efektif dari bawaan `lib/payroll-indonesia-defaults.ts`) | **Bersih** |
| — | Kode akun (`4010`, `4020`, `9000`, `9001`, …) | **0 literal** di kode domain (hanya di pemetaan & data seed) | **Bersih** |

## 5. Kopling perubahan — fitur apa yang paling menyebar saat diubah

Analisis `git log` (244 commit sejak 2026-10-20; 119 menyentuh
`src/`; median 11 berkas src per commit tahap):

**Berkas paling sering berubah:** `db/schema.ts` **40×** ·
`server/reports.ts` 30× (termasuk era pra-pecah T4B) ·
`actions/accounting.ts` 29× · `settings-forms.tsx` 28× ·
`actions/inventory.ts` 23× · `actions/settings.ts` 21× ·
`server/inventory.ts` 21× · `pengaturan/page.tsx` 20× ·
`server/pos.ts` 20× · `pos-terminal.tsx` 18× · `catalog.ts` 17×.

**Pasangan berubah-bersama teratas:** `schema.ts + _journal.json`
40× (mekanis migrasi) · `schema.ts + actions/accounting.ts` 20× ·
**klaster pengaturan: `pengaturan/page.tsx + settings-forms.tsx`
18×, `settings-forms.tsx + actions/settings.ts` 18×,
`settings-forms.tsx + schema.ts` 18×, `page + actions/settings.ts`
16×** · `actions/inventory.ts + server/inventory.ts` 16× ·
`schema.ts + reports.ts` 15×.

Lima fitur dengan sebaran terburuk + jalur idealnya:

| # | Fitur | Sebaran terukur hari ini | Jalur ideal (1 fitur = 1 wilayah) |
|---|---|---|---|
| F-1 | **Pengaturan / konfigurasi perusahaan** | 4 berkas / 3 lapis setiap perubahan berarti: halaman + `settings-forms.tsx` (1.811 baris) + `actions/settings.ts` + sering `schema.ts` (pasangan 16-18×) | Sudah diagendakan Q3+Q4; tambah: baca settings lewat satu kontrak bernama (§2) agar fitur konfigurasi baru tidak menambah titik baca langsung baru |
| F-2 | **Fitur data akuntansi** (akun/periode/jurnal) | `schema.ts + actions/accounting.ts` 20× — dua berkas raksasa yang sama untuk hampir semua fitur | Q2 (skema per domain) + Q4 (aksi per domain): fitur menyentuh 1 berkas skema domain + 1 berkas aksi domain |
| F-3 | **Impor** (master & dokumen) | Tersebar 4 wilayah server (K-10 Q0) + **2 wizard UI** (D-03) + route parse | Q6 diperluas ke UI: satu folder impor server + satu kerangka wizard bersama |
| F-4 | **Laporan** | `reports.ts` churn 30× historis; `schema + reports` 15× | Sudah terpecah per domain laporan (T4B); sisa = jangan biarkan barrel menjadi titik sunting (impor langsung ke berkas domain laporan) |
| F-5 | **POS** (fitur kasir/penjualan) | `pos.ts` 20× + `pos-terminal.tsx` 18× + `actions/pos.ts` — fitur kasir membuka berkas terminal raksasa yang sama | Q7(a): terminal menjadi orkestrasi tipis; fitur menyentuh sub-panelnya saja |

Sebaran sehat sebagai pembanding: fitur gudang operasional berjalan
lewat pasangan `actions/inventory + server/inventory` (16×, dua
berkas yang memang sepasang lapis) — bukti bahwa pola folder domain
menurunkan sebaran ke 1-2 berkas begitu wilayahnya berbentuk.

## 6. Inefisiensi terukur

| ID | Temuan | Bukti | Penilaian |
|---|---|---|---|
| I-01 | **N+1 baca di pemuat pratinjau Catat Transaksi.** Sesudah 1 query `listReceivables` untuk seluruh perusahaan, kode memanggil `listOpenReceivableDocs` **per pelanggan** di dalam loop; pola yang sama untuk pemasok (`listPayables` + `listSupplierOpenPayableDocs` per pemasok). Jumlah query = 1 + jumlah pihak bersaldo terbuka, setiap pratinjau dimuat. | `server/actions/quick-entry.ts:155-202` (loop :167 & :189) | Inefisiensi nyata satu-satunya yang berbentuk N+1 baca; perbaiki dengan satu query dokumen terbuka berkelompok per pihak |
| I-02 | **Update per baris di jalur impor.** Penandaan baris staging dilakukan `tx.update(importRows)` per baris dalam loop (panggung hingga 25.000 baris, H-03). | `server/actions/import.ts:625-637`; `server/import-masters.ts:549-551` | Kandidat update massal per potongan (pola potongan 1000 sudah dipakai sisi klien, D-03); ukur dulu — jangan optimasi buta |
| I-03 | 21 titik loop-ber-`await` terdeteksi heuristik; **mayoritas sah**: penulisan per baris dokumen di dalam satu transaksi (posting ERP — terbatas ukuran dokumen), dan sinkronisasi offline per item dengan transaksi terpisah (`actions/pos-offline.ts:94-111`) yang memang disengaja agar kegagalan satu item tidak menggagalkan antrean. `.map(async` = 0; `Promise.all` dipakai 30× di titik yang memang paralel. | Pindai loop server | Bukan temuan — dicatat agar tidak "dioptimasi" menjadi rapuh |
| I-04 | Ambil-baris settings berulang antar-alur terkait (efek §2 settings): penerbitan nomor, quote, dan aksi dalam satu permintaan dapat masing-masing membaca baris settings yang sama tanpa memo per permintaan. | ±26 titik baca langsung (D-05/§2) | Ringan; terselesaikan sebagian bila kontrak baca settings bernama diadopsi (F-1) |

## 7. Usulan tahap baru / perubahan atas Q2–Q10 (urut prioritas risiko × sebaran)

Tidak ada usulan yang mengubah urutan besar RENCANA; semuanya
disisipkan ke tahap yang sudah ada atau menjadi satu tahap kecil baru.

| Prioritas | Usulan | Menutup | Penempatan |
|---|---|---|---|
| **P-01** | **Sentralisasi aging ke `lib/due-date.ts`**: pindah `ageDays` + batas bucket bernama (`AGING_BUCKETS`) ke lib yang sudah memiliki `dueDateStatus`/`paymentStatusLabel`; halaman piutang-utang & route ekspor memakai yang sama; tambah test unit batas bucket. Kecil, mekanis, menutup satu-satunya aturan bisnis yang ganda. | D-01, D-14 (sebagian), H-02 | **Tahap kecil baru "Q1b — sentralisasi cepat"** (sebelum Q2; setengah hari kerja agen) bersama P-02 & P-03 |
| **P-02** | **Panggil `effectiveTaxRate` di 2 titik inline** `actions/quick-entry.ts:253,397` (helper sudah ada & teruji); biarkan varian quote (Decimal) & receipts (validasi) apa adanya — beda semantik sah. | D-04 | Q1b |
| **P-03** | **Ganti nama `formatQty` retur pemasok** → nama jujur per perilakunya (mis. `formatQtyFull`) di `supplier-returns/shared.ts` + 4 pemanggilnya; jebakan nama hilang tanpa menyatukan dua format yang memang berbeda kebutuhan. | D-07 | Q1b |
| **P-04** | **Ekstrak inti pembayaran bersama di `payables.ts`**: satukan kerangka `payPayableDocument`/`payExpensePayable` menjadi satu fungsi inti berparameter (dokumen sumber, label asal kredit, kait FIFO), dua fungsi publik menjadi pembungkus tipis; `opening-balances.ts` menilai ulang apakah bisa memakai inti yang sama. Paritas dibuktikan suite pembayaran yang ada (jalur uang — gerbang penuh + e2e). | D-02 | **Q8 diperluas eksplisit** (fungsi raksasa domain) — jangan dicampur tahap lain; risiko tertinggi di daftar ini sehingga berdiri sendiri dengan bukti paritas |
| **P-05** | **Differential parity test quote**: fixture keranjang bersama (termasuk diskon baris, pajak inklusif, pembulatan tunai, kelompok tanpa harga khusus) dijalankan ke `quoteCart` (via integrasi) dan `computeLocalOfflineQuote`; selisih yang diizinkan hanya yang terdokumentasi (harga kelompok). Menjadi fitness function permanen di suite. | D-10 (penjaga) | Ditambahkan ke daftar fitness **Q1** bila masih terbuka; bila Q1 sudah ter-commit, masuk **Q10** sebagai syarat tutup |
| **P-06** | **Helper paginasi server bersama**: satu `paginate`/tipe hasil di `server/` (atau `lib/` murni untuk hitung offset + bentuk hasil), diadopsi pertama di `catalog.ts` (6 titik) saat Q5 memecahnya; halaman cukup memakai idiom parse bersama untuk `page`. Ratchet Q1 dapat menambah aturan: berkas server baru tidak menulis `.offset((page` tulisan tangan. | D-05 | **Q5 diperluas** (pecah catalog) |
| **P-07** | **Kerangka wizard impor bersama**: ekstrak alur unggah/analisis/kecualikan/commit (hook/komponen kerangka di `components/gudang/import/`) saat Q6 menyatukan domain impor; kedua wizard menjadi konfigurasi di atasnya (entitas, kolom, aksi commit). | D-03 | **Q6 diperluas ke UI** |
| **P-08** | **Kontrak baca settings bernama**: fungsi baca tunggal `getCompanySettingsRow`/proyeksi bernama di modul platform; konsumen baru dilarang memilih `companySettings` langsung (ratchet daftar-izinkan seperti ARS1-01). Tidak memaksa migrasi 26 titik sekaligus — titik lama berpindah oportunistik saat wilayahnya disentuh tahap lain. | §2 settings, I-04, F-1 | Definisi di **Q4** (batas aksi/domain); penegakan ratchet di **Q10** |
| **P-09** | **Perbaiki N+1 pratinjau Catat Transaksi**: satu query dokumen terbuka untuk semua pihak (atau per halaman pihak), bukan per pihak. Ukur sebelum/sesudah dengan jumlah query pada data demo bersaldo banyak. | I-01 | Tahap kecil mandiri (boleh kapan saja; tidak menyentuh berkas tahap lain) |
| **P-10** | **Chrome modal bersama masuk daftar periksa Q7**: saat panel disentuh Q7, overlay tulisan tangan berpindah ke kerangka dialog bersama; tidak ada sapuan khusus. D-08 (kasbon/pinjaman) & D-09 (input kembar) **dinyatakan diterima** — dipantau lewat pengukuran ulang jscpd di Q10 (target: klon kode tulisan tangan tetap ≤ ±3%). | D-12; pemantauan D-08/D-09/D-11 | Q7 + Q10 |

**Penjaga fitness tambahan yang diusulkan** (melengkapi Q1):
(1) differential parity quote (P-05); (2) ratchet daftar-izinkan
untuk baca `companySettings` langsung (P-08) dan untuk pola
`.offset((page` tulisan tangan di berkas server baru (P-06);
(3) pengukuran ulang jscpd (migrasi dikecualikan) sebagai angka
penutup Q10 di `STATUS-TUTUP.md` — bukan gerbang CI, cukup bukti
tren.

## 8. Jawaban langsung untuk pemilik

- *"Ubah 1 fitur mudah, jalurnya terpusat?"* — **Sebagian besar ya,
  dan terbukti**: uang, jurnal, tenant, nomor dokumen, pemetaan
  akun, audit, idempotensi, error, CSV, izin, saklar modul, tarif
  statutori — semuanya satu pintu. Pengecualian terukur: baca
  settings tersebar-proyeksi, paginasi tanpa helper, dan klaster
  pengaturan yang masih menyentuh 4 berkas (sedang dibenahi Q3/Q4).
- *"Ada produk/fungsi yang sama dua kali?"* — **Tidak ada kemampuan
  utuh yang dibangun dua kali.** Yang ada: 1 aturan bisnis ganda
  (bucket aging, D-01), 1 pola pembayaran disalin untuk dua keluarga
  dokumen (D-02), 1 alur UI disalin (wizard impor, D-03), dan
  duplikasi mekanisme ringan (paginasi, selisih hari, format mikro).
  Total klon kode tulisan tangan hanya **2,83%**.
- *"Kustomisasi mudah karena parameter terpusat?"* — **Ya, ini
  kekuatan terukur sistem**: nol tarif/kode akun terkode keras di
  mesin; semua angka bisnis adalah konfigurasi per perusahaan
  (D-25) dengan satu pintu tulis di pengaturan.
