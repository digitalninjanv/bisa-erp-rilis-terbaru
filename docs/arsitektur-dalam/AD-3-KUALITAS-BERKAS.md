# AD-3 — Sensus Kualitas Berkas & Code Smell (Standar 2025–2026)

Analisis **baca-saja** atas pohon **ter-commit `HEAD 67894dc`** (FIX-ARS Tahap 4).
Tidak ada kode yang diubah; laporan ini satu-satunya berkas yang ditulis.

**Catatan transisi:** pohon kerja saat sensus berisi refactor terminal POS yang
sedang berjalan (`pos-terminal.tsx` termodifikasi + hook/panel baru belum
ter-commit). Sesuai mandat, berkas itu dinilai dari **versi ter-commit-nya**
(2.985 baris) dan ditandai **[TRANSISI]** di semua tabel — ukurannya adalah
keadaan kemarin, bukan keadaan yang sedang dikerjakan.

**Baseline pembanding (ARS-2, sebelum FIX-ARS):** 313 berkas, 91.044 LOC,
median berkas 160 baris, 19 berkas >800 baris, fungsi terpanjang `createSale`
±790 & `createReceipt` ±528 baris.

## Metodologi (semua angka dapat direproduksi)

| Pengukuran | Metode |
|---|---|
| Ukuran berkas | `git archive HEAD` diekstrak ke pohon bersih; baris = hitungan newline per berkas `.ts`/`.tsx` di `src/` |
| Panjang fungsi | **TypeScript Compiler API** (paket `typescript` milik repo): semua node berbadan (FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, accessor) termasuk yang bersarang; panjang = baris akhir − baris awal + 1 dari span AST persis (bukan heuristik teks) |
| Cabang (kompleksitas kasar) | Hitungan AST: `IfStatement` + `ConditionalExpression` + operator `&&`/`\|\|` + `CaseClause` + `CatchClause` per berkas |
| Fan-out | Jumlah pernyataan `import … from` per berkas (regex atas sumber) |
| Duplikasi | Shingle 8 baris ternormalisasi (komentar & impor dibuang, spasi dirapikan) yang muncul di ≥2 berkas berbeda |
| Blast radius | `git log -60 --numstat/--name-only`: jumlah berkas berubah per commit |

---

## 1. Distribusi ukuran berkas — **RAWAN ringan · 7/10**

Sensus penuh: **330 berkas, 92.880 LOC** (naik dari 313 berkas / 91.044 LOC
di ARS-2 — pertumbuhan berasal dari FIX-ARS Tahap 1–4: `env.ts`, `log.ts`,
health, ringkasan saldo, dan pemecahan folder `server/inventory/` +
`server/pos/`).

| Pita | Berkas | % | Patokan pengguna |
|---|---:|---:|---|
| ≤200 baris | 196 | 59,4% | fokus, satu kali baca |
| 201–400 | 75 | 22,7% | masih dalam patokan umum 200–400 |
| 401–800 | 37 | 11,2% | di atas patokan — perlu alasan |
| >800 | 22 | 6,7% | god-file territory |

- **82,1% berkas ≤400 baris**; median **164,5**; p90 **671**; p99 **2.190**; maks 2.985.
- Dibanding ARS-2: median praktis tak berubah (160 → 164,5) dan pangsa ≤200
  stabil (60% → 59,4%) — codebase **tidak membengkak di badan**, masalah tetap
  terkonsentrasi di ekor distribusi.
- Jumlah berkas >800 naik 19 → 22, tetapi **komposisinya membaik secara
  kualitatif**: dua monster ±3.000 baris milik domain server sudah hilang
  (lihat §2); yang tersisa di pita ini mayoritas berkas 800–1.700 baris.

### 15 berkas terbesar terkini

| # | Baris | Berkas | Tanggung jawab (satu kalimat) |
|---:|---:|---|---|
| 1 | 2.985 | `src/components/pos/pos-terminal.tsx` **[TRANSISI]** | Seluruh terminal kasir POS dalam satu komponen (versi ter-commit; sedang dipecah di pohon kerja). |
| 2 | 2.835 | `src/server/reports.ts` | Semua pembacaan agregat: laporan keuangan, analitik penjualan POS, jurnal/buku besar, AR/AP, rekonsiliasi kontrol (43 ekspor). |
| 3 | 2.718 | `src/db/schema.ts` | Skema Drizzle deklaratif: 98 tabel + relasi untuk seluruh sistem (dinilai terpisah di §4). |
| 4 | 2.190 | `src/server/actions/accounting.ts` | 26 server action akuntansi — termasuk logika payroll yang hidup di lapisan aksi. |
| 5 | 2.108 | `src/server/hr.ts` | Domain HR lengkap: parameter, organisasi, absensi, lembur, THR, cuti, final pay (55 ekspor). |
| 6 | 2.071 | `src/server/supplier-returns.ts` | Satu siklus hidup utuh retur pemasok: buat, posting, void, penyelesaian campuran (18 ekspor). |
| 7 | 1.795 | `src/components/pengaturan/settings-forms.tsx` | ±16 formulir pengaturan perusahaan dalam satu berkas komponen. |
| 8 | 1.645 | `src/server/pos/sales.ts` | Penjualan POS hasil pecahan Tahap 4: `createSale` terfase, `holdSale`, `voidSale` + helper batch/flag. |
| 9 | 1.602 | `src/server/actions/inventory.ts` | 27 server action gudang: produk, penerimaan, penyesuaian, transfer, opname, taksonomi, pihak. |
| 10 | 1.316 | `src/server/actions/import.ts` | Aksi impor produk: analisis, edit baris, commit batch, batal. |
| 11 | 1.268 | `src/server/import-masters.ts` | Mesin impor master data: pemetaan baris, pratinjau, commit, stok & saldo awal. |
| 12 | 1.224 | `src/components/akuntansi/hr-panel.tsx` | Panel-panel HR di UI akuntansi: organisasi, shift, absensi, lembur, THR, cuti, terminasi (±20 sub-komponen). |
| 13 | 1.165 | `src/server/master-data.ts` | Operasi massal master data: bulk edit berpreview, deteksi duplikat trigram, merge pihak. |
| 14 | 1.143 | `src/server/catalog.ts` | Kueri katalog & daftar: produk, pihak, gudang, riwayat dokumen, detail penerimaan/dokumen. |
| 15 | 1.116 | `src/server/actions/settings.ts` | 19 server action pengaturan: metode bayar, gudang, cabang, QRIS, penomoran, modul, kolom kustom. |

Di bawah 15 besar: `inventory/receipts.ts` 1.004 (pecahan `createReceipt`),
`db/seed.ts` 964, `bank-reconciliation.ts` 930, `gudang/import-wizard.tsx` 906,
`pos/returns.ts` 882, `inventory/transfers.ts` 863, `inventory/adjustments.ts` 842.

---

## 2. Sensus fungsi panjang — **RAWAN · 7/10**

Total terdeteksi: **4.837 fungsi berbadan** (termasuk callback bersarang).

| Pita | Fungsi | % |
|---|---:|---:|
| ≤50 baris | 4.300 | 88,9% |
| 51–100 | 319 | 6,6% |
| 101–250 | 181 | 3,7% |
| 251–400 | 21 | 0,4% |
| >400 | 16 | 0,3% |

Median 6 baris (terdominasi callback kecil), p90 54, p99 232, maks 2.682.
**Hanya 37 fungsi (0,8%) yang melewati 250 baris.**

### Klaim Tahap 4 — TERBUKTI

> "Tidak ada fungsi domain >250 baris di `pos`/`inventory`."

**Terbukti penuh oleh sensus AST:** jumlah fungsi >250 baris di
`src/server/pos/**` dan `src/server/inventory/**` = **0**. Fungsi terbesar
`createSale` kini **118 baris** (`pos/sales.ts:92`, dari ±790); fungsi terbesar
di `inventory/receipts.ts` adalah `voidReceipt` 235 baris; orkestrator
`createReceipt` sendiri jauh di bawah itu. ARS2-02 tertutup untuk dua modul
yang disebutnya.

### 15 fungsi terpanjang terkini — di sinilah raksasa yang tersisa tinggal

| # | Baris | Fungsi | Lokasi | Jenis |
|---:|---:|---|---|---|
| 1 | 2.682 | `PosTerminal` | `components/pos/pos-terminal.tsx:287` **[TRANSISI]** | God component (sedang dipecah) |
| 2 | 777 | `seed` | `db/seed.ts:179` | Perkakas dev/demo — bukan jalur produksi |
| 3 | 742 | `ImportWizard` | `components/gudang/import-wizard.tsx:116` | Komponen wizard impor produk |
| 4 | 583 | `QuickEntryForm` | `components/akuntansi/quick-entry-modal.tsx:212` | Komponen modal Catat Transaksi |
| 5 | 556 | `MasterImportWizard` | `components/gudang/import-master-wizard.tsx:59` | Komponen wizard impor master |
| 6 | 553 | `runPayrollAction` | `server/actions/accounting.ts:920` | **Logika domain payroll di lapisan aksi** |
| 7 | 516 | `commitImportBatchAction` | `server/actions/import.ts:666` | Aksi commit impor (transaksional) |
| 8 | 500 | `OpnameForm` | `components/gudang/opname-form.tsx:63` | Komponen formulir opname |
| 9 | 485 | `processFinalPay` | `server/hr.ts:1624` | Domain HR — pesangon/final pay |
| 10 | 432 | `SettingsPage` | `app/app/pengaturan/page.tsx:48` | Halaman pengaturan (server component) |
| 11 | 430 | `SupplierReturnDetailPage` | `app/app/gudang/retur-pembelian/[id]/page.tsx:51` | Halaman detail dokumen |
| 12 | 414 | `ProductBulkTable` | `components/gudang/product-bulk-table.tsx:50` | Komponen tabel bulk edit |
| 13 | 392 | `getControlReconciliation` | `server/reports.ts:2444` | Domain laporan — rekonsiliasi kontrol |
| 14 | 368 | `ReceiptForm` | `components/gudang/receipt-form.tsx:74` | Komponen formulir penerimaan |
| 15 | 326 | `SupplierReturnForm` | `components/gudang/supplier-return-form.tsx:39` | Komponen formulir retur |

(Catatan metodologi: callback anonim bersarang di dalam `runPayrollAction` dan
`commitImportBatchAction` — badan lambda yang dibungkus `guard()` — terhitung
terpisah pada 546/514/509/508 baris dan tumpang-tindih dengan induknya; tabel
di atas memakai fungsi bernama agar tidak menghitung dua kali.)

**Pola yang jelas:** sesudah Tahap 4, fungsi raksasa **tidak lagi tinggal di
domain server POS/gudang**. Sisa terkonsentrasi di tiga tempat:

1. **Komponen UI** — 8 dari 15 teratas adalah komponen/halaman React
   (wizard impor ×2, formulir dokumen gudang, modal entri cepat). Ini pola
   umum React (JSX + state + handler dalam satu span), tetap nyata sebagai
   utang keterbacaan, dengan risiko lebih rendah daripada fungsi transaksional.
2. **Lapisan aksi** — `runPayrollAction` (553) dan `commitImportBatchAction`
   (516) adalah **logika domain yang tinggal di `server/actions/`**, melanggar
   aturan proyek sendiri bahwa logika domain milik `src/server/*.ts`. Ini
   temuan ARS2-03 yang belum tertutup dan kini menjadi fungsi domain terpanjang
   di seluruh repo.
3. **Titik domain tunggal** — `processFinalPay` (485, HR) dan
   `getControlReconciliation` (392, reports): besar tetapi satu tanggung
   jawab yang koheren; kandidat pecah-per-fase seperti pola Tahap 4, bukan
   keadaan darurat.

---

## 3. Package by Feature vs by Layer — **SEHAT · 8/10**

Sensus klasifikasi per area (330 berkas `src/`):

| Area | Berkas | Pola | Putusan |
|---|---:|---|---|
| `src/app/app/**` (rute) | 89 | **100% per fitur**: `akuntansi/`, `gudang/`, `pos/`, `pengaturan/` lalu sub-fitur (`hr/`, `payroll/`, `retur-pembelian/`, …) | By-feature murni — folder berteriak domain |
| `src/components/**` | 117 | 70 per fitur (`akuntansi/`, `gudang/`, `pos/`, `pengaturan/`, `auth/`) vs 47 bersama/teknis (`blocks/`, `ui/`, `print/`, `shell/`) | By-feature + folder bersama yang sah |
| `src/server/` domain | 45 | Per domain bisnis: `pos/`, `inventory/`, `hr.ts`, `reports.ts`, `catalog.ts`, `supplier-returns.ts`, `purchasing.ts`, `employee-advances.ts`, … | By-feature (bounded context terlihat) |
| `src/server/actions/` | 21 | **Satu lapisan teknis** (server actions), tetapi berkasnya dibagi per domain (`accounting.ts`, `inventory.ts`, `pos.ts`, `hr.ts`, …) | By-layer yang dimitigasi pembagian per domain |
| `src/app/api/**` + login | 18 | Per fungsi teknis: `export/`, `import/`, `auth/`, `health/` | Teknis — wajar untuk route handler |
| `src/lib/` | 34 | Utilitas teknis (`money`, `format`, `errors`, `env`, `log`) **dicampur** nama domain (`payroll-indonesia.ts`, `pos-offline.ts`, `stock.ts`, `accounting.ts`, `hr.ts`) | Paling tidak berteriak: lemari utilitas campuran |
| `src/db/` | 5 | Teknis murni (skema, koneksi, seed) | Wajar |
| `tests/` + `e2e/` | 129+7 | Tingkat atas **per jenis test** (`unit/`, `integration/`, `sim2/`), nama berkas per fitur/program (`fix-*`, `feature-matrix-*`, skenario sim) | By-layer di atas, by-feature di nama berkas |

**Putusan keseluruhan:** struktur folder **berteriak domain bisnis** di tiga
area yang paling sering disentuh developer (rute, komponen, domain server) —
seorang developer baru menemukan fitur dari nama folder tanpa membaca
framework-nya. Dua pengecualian terukur: (1) lapisan `actions/` adalah
package-by-layer, diterima karena berkas-berkasnya per domain dan lapisannya
tipis secara desain; (2) `src/lib/` adalah satu-satunya area yang tumbuh
sebagai lemari campuran teknis+domain (34 berkas datar, termasuk logika
payroll murni dan mesin offline POS) — kandidat alami untuk subfolder domain
bila terus tumbuh, bukan masalah hari ini.

---

## 4. Feature Concentration & god-file sisa — **RAWAN · 5/10**

Lima berkas non-skema terbesar dinilai dari pengelompokan ekspornya:

| Berkas | Kelompok kepedulian di dalamnya | Vonis |
|---|---|---|
| `pos-terminal.tsx` **[TRANSISI]** | ±10 kepedulian dalam 1 komponen ter-commit: keranjang, pencarian/scanner, quote, pembayaran (tunai/campuran/utang), konfirmasi QRIS, tahanan/resume, kredit retur, pelanggan, antrean offline + peninjauan, pemilih reservasi | **God component** — satu-satunya god-file sejati yang tersisa; sedang dipecah di pohon kerja (hook + panel sudah muncul sebagai berkas baru) |
| `reports.ts` | **≥5 konteks**: (1) laporan keuangan (neraca saldo, LR, posisi, arus kas, ekuitas), (2) ringkasan beranda/akuntansi, (3) analitik operasional POS (penjualan per hari/kasir/kategori, produk terlaris, sesi kas), (4) penelusuran jurnal & buku besar, (5) daftar AR/AP + beban, (6) valuasi & kartu stok, (7) rekonsiliasi kontrol | **Feature concentration tertinggi di server**: disatukan oleh "semua yang membaca agregat", bukan oleh satu bounded context. Kandidat pecah per konteks baca (statements / pos-analytics / subledger-lists) |
| `actions/accounting.ts` | ±8 kelompok aksi: jurnal, beban, transfer bank, pembayaran utang, saldo awal, karyawan+payroll, akun/pemetaan, periode/tutup buku, modal | Konsentrasi **per lapisan**, diperburuk `runPayrollAction` yang membawa logika domain (§2) |
| `hr.ts` | ±9 sub-domain dalam 1 konteks HR: parameter, departemen/jabatan, riwayat karyawan, kontrak kedaluwarsa, shift, absensi, lembur, THR, draf komponen, cuti, final pay | Koheren di level bounded context (semua HR), terkonsentrasi di level berkas — kandidat folder `server/hr/` seperti pola `pos/` & `inventory/` |
| `supplier-returns.ts` | **1 kepedulian**: siklus hidup retur pemasok + penyelesaian + penyegaran status utang terkait | **Kontra-contoh sehat**: 2.071 baris tetapi satu tanggung jawab; ukuran saja bukan smell |

### `schema.ts` dinilai terpisah — **SEHAT (bukan masalah nyata)**

- Deklaratif murni: 98 definisi tabel, tanpa logika; satu tanggung jawab
  (skema) yang memang menuntut kelengkapan dalam satu tempat — pola standar
  Drizzle.
- Pola pemakaian terukur: **103 berkas** mengimpor dari `@/db/schema`, dan
  hanya **3** yang mengimpor seluruh skema (`db/index.ts`, `db/admin.ts`,
  `lib/auth.ts`) — ketiganya infrastruktur yang secara sah membutuhkan objek
  skema utuh untuk Drizzle/Better Auth. 100 pemakai lain memakai **named
  import parsial** (hanya tabel yang mereka butuhkan).
- Risiko nyatanya sempit dan jujur: satu titik sentuh untuk perubahan skema
  (potensi konflik gabung saat pengembangan paralel) dan kompilasi ulang
  pemakai saat skema berubah. Keduanya biaya kecil dibanding manfaat satu
  sumber kebenaran skema. **Tidak direkomendasikan dipecah.**

---

## 5. Blast radius terukur (git log 60 commit terakhir) — **RAWAN ringan · 6/10**

| Populasi commit | n | Median berkas | p90 | Maks |
|---|---:|---:|---:|---:|
| Semua commit | 60 | 10 | 31 | 63 |
| Menyentuh `src/` | 39 | 16 (12 di antaranya berkas `src/`) | 41 (36 `src/`) | 63 |
| Menyentuh kode/test | 43 | 15 | 32 | 63 |

12 dari 60 commit adalah commit dokumen 1-berkas (penutup program di
`PROGRESS.md`) yang menekan median keseluruhan; angka yang mewakili perubahan
kode adalah baris kedua.

**Radius terbesar — dan penyebab strukturalnya:**

| Berkas | Commit | Penyebab |
|---:|---|---|
| 63 | `75ad80f` FIX-R2 Tahap 2 "Paket Konsistensi UI" | **Sapuan standardisasi komponen bersama** — satu pola (StatCard/StatusBadge/field-classes) diganti di semua modul sekaligus; radius lebar *by design*, bukan kebocoran |
| 63 | `b86d976` SIM-2 S7B-2 (pinjaman, aset tetap, PR, reservasi, seri, offline POS) | **Bundel fitur satu tahap**: enam fitur dibundel dalam satu commit program |
| 54 | `48f9ad9` FIX-GDG Tahap 4 UI/UX gudang | Sapuan konsistensi UI gudang + halaman detail baru |
| 41 | `441eb0c` FIX-R2 Tahap 3 sisa angka | Perbaikan lintas laporan + seed + pengaturan dalam satu tahap |

**Interpretasi jujur:** radius per commit di repo ini **diperbesar oleh
metode kerja programnya sendiri** (satu commit per tahap yang membundel satu
paket perbaikan), bukan murni oleh arsitektur — commit perbaikan terfokus
biasa jauh lebih kecil. Namun dua pola struktural tetap nyata: (1) perubahan
komponen bersama memang merembet ke puluhan berkas (bukti tidak langsung
bahwa komponen bersama dipakai luas — sisi baiknya — sekaligus bahwa sapuan
s
...[truncated 1919 chars]