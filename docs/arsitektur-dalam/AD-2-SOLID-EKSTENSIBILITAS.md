# AD-2 — SOLID & Ekstensibilitas, Dibuktikan dari Riwayat Git

Analisis mendalam baca-saja atas pohon ter-commit **HEAD `67894dc`** (173 commit).
Metode utama: arkeologi git — riwayat proyek ini atomik per tahap/fitur, jadi
ekstensibilitas diukur dari fitur yang benar-benar pernah ditambahkan, bukan
dari simulasi. Angka baris selalu **di luar snapshot migrasi** (`src/db/migrations/**`),
karena satu snapshot JSON bernilai ribuan baris dan akan merusak semua rasio.

> Catatan kejujuran pengukuran: saat analisis berjalan ada pekerjaan FIX-ARS
> Tahap 5 yang BELUM ter-commit di pohon kerja (pemecahan `pos-terminal.tsx`
> menjadi hook/panel). Berkas-berkas itu **dikecualikan** dari analisis ini —
> semua angka di bawah adalah pohon ter-commit `67894dc`.

---

## 1. Uji OCP dari fitur nyata (laboratorium git)

Definisi operasional "rasio OCP kasar" di sini: dari baris yang ditambahkan
sebuah commit fitur (di luar migrasi), berapa persen masuk ke **berkas baru**
(ekstensi murni) vs **berkas lama** (menyentuh kode yang sudah ada); dan berapa
baris yang **dihapus dari berkas lama** (proksi terkuat untuk "mengubah perilaku
yang sudah ada"). Semakin tinggi rasio-baru dan semakin kecil hapus-di-lama,
semakin open-closed fitur itu.

| Fitur (commit) | Berkas non-migrasi | + di berkas BARU | + di berkas LAMA | − di berkas LAMA | Rasio baru | Sentuhan ke fungsi inti |
|---|---|---|---|---|---|---|
| Retur Pembelian, domain (`0db6d81`) | 11 | 2.679 | 255 | **19** | **91%** | `inventory.ts` +23/−0: penjaga void aditif; `applyStockMovement` & `postJournal` tidak diubah |
| Retur Pembelian, UI (`8496739`) | 13 | 1.921 | 226 | **2** | **89%** | tidak ada |
| Kasbon Karyawan (`9be0498`) | 16 | 2.006 | 246 | **16** | **89%** | modul baru `employee-advances.ts`; integrasi payroll tipis |
| Payroll Indonesia SIM-2 S2 (`a6c169b`) | 26 | 4.237 | 813 | **61** | **84%** | `pos.ts` +5/−1: saklar PPN `taxEnabled` mengubah perilaku POS global lewat konfigurasi |
| SIM-2 S7B-2 — 7 fitur sekaligus (`b86d976`) | 60 | 8.966 | 1.379 | **22** | **87%** | 6 modul domain baru (`reservations`, `serials`, `fixed-assets`, `employee-loans`, `reimbursements`, `purchase-requests`, `pos-offline`); `inventory.ts` +299/−11 & `pos.ts` +99/−1 berupa kait ke modul baru |
| Catat Transaksi / quick entry (`34c8e16`) | 18 | 3.060 | 185 | **184** | **94%** | tidak menyentuh inti POS/inventory; 4 modul server baru |
| Penjualan Utang POS D-19 (`f53cc4c`) | 13 | 563 | 720 | **59** | **44%** | `pos.ts` +14/−1: satu parameter `dueDate` + validasi di blok piutang yang sudah ada |
| Konsumsi Reservasi di checkout (`21f7058`, di dalam bundle FIX-GDG T2) | 15 | 1.199 | 1.114 | **158** | **52%** | `pos.ts` +83/−1: impor 3 fungsi dari modul `reservations` + parameter + panggilan konsumsi; sisa commit adalah perbaikan bug gudang (AVCO dsb.), bukan fitur ini |
| Ringkasan Saldo Bulanan FIX-ARS T2 (`9269c07`) | 8 | 904 | 328 | **137** | **73%** | `accounting.ts` +42/−1: satu blok upsert aditif di dalam `postJournal` — satu-satunya gerbang jurnal |
| **Kontrapembanding: Refactor FIX-ARS T4 (`67894dc`)** | 15 | 7.259 | 6 | **6.078** | n/a | seluruh `pos.ts` & `inventory.ts` ditulis ulang strukturnya — satu-satunya kelas commit dengan penghapusan massal, dan itu memang tujuannya (restrukturisasi tanpa perubahan perilaku, suite tetap 1189/1189) |

### Pola yang terbukti

1. **Fitur berbentuk modul/dokumen baru bersifat open-closed secara faktual,
   bukan aspirasional.** Enam fitur dari tiga program berbeda (Retur Pembelian,
   Kasbon, Payroll, S7B-2, Catat Transaksi) semuanya mendarat dengan rasio-baru
   **84–94%** dan penghapusan di kode lama hanya **2–61 baris** per fitur.
   Resepnya konsisten dan terlihat di daftar berkas baru: modul domain baru di
   `src/server/<fitur>.ts` + actions baru + halaman/komponen baru + test baru +
   satu migrasi. Tidak satu pun fitur itu mengharuskan menulis ulang logika
   `createSale`, `postJournal`, atau `applyStockMovement`.
2. **Fitur yang memang hidup DI DALAM alur transaksi yang ada membayar biaya
   modifikasi yang kecil dan terlokalisasi.** Penjualan utang (44%) dan
   konsumsi reservasi (52%) terlihat "buruk" secara rasio hanya karena fiturnya
   kecil dan rumahnya adalah fungsi yang sudah ada; dalam angka absolut
   sentuhan intinya **+14/−1** dan **+83/−1 baris** di `pos.ts` — berupa
   parameter baru + validasi + panggilan ke modul pemilik fitur, bukan
   penulisan ulang badan fungsi. Ini pola "hook aditif di inti, logika di
   modul pemilik" dan ia konsisten.
3. **Satu-satunya modifikasi inti yang disengaja bersifat satu titik.**
   Ringkasan saldo T2 mengubah `postJournal` sebesar +42/−1 — dan justru di
   situlah tempat yang benar, karena audit membuktikan `postJournal` adalah
   satu-satunya gerbang insert jurnal; satu hook di sana menjangkau semua
   jurnal termasuk jurnal balik & backdated tanpa jalur kedua.
4. **Yang tidak pernah terjadi**: tidak ada fitur dalam riwayat yang menuntut
   mengubah kontrak fungsi inti (tanda tangan hasil, semantik posting) milik
   modul lain. Penghapusan massal hanya muncul pada commit refactor murni.

**Vonis OCP: SESUAI — skor 8/10.** Bukan 9–10 karena fitur selevel "varian
perilaku di dalam checkout/receipt" tetap harus menyunting berkas inti secara
manual (tidak ada registry varian), dan dua commit di atas membuktikan
biayanya kecil tetapi tidak nol.

---

## 2. Extension points yang benar-benar hidup

| Mekanisme | Bukti lokasi | Jenis pola | Sejauh mana fitur baru tanpa menyentuh inti |
|---|---|---|---|
| **Pemetaan akun (account mapping)** | tabel `account_mappings`; `getAccountId`/`getAccountMap` di `src/server/accounting.ts`, dipakai **24 berkas server** | Data-driven indirection | Fitur penjurnal baru cukup mendaftarkan kunci pemetaan; tidak ada kode akun hardcoded di domain. FIX-P1 T4 memperluas daftar putih menjadi 34 kunci lewat UI Pengaturan tanpa menyentuh kode posting. |
| **Saklar modul per perusahaan** | `src/lib/modules.ts` (224 baris); `enabledModules` jsonb; ditegakkan di layout + lapisan aksi | Configuration / feature toggle | Modul dapat dihidup/matikan per perusahaan tanpa deploy. |
| **Konfigurasi bertanggal efektif** | tabel-tabel `payroll_statutory_*` (D-25) + `src/lib/payroll-indonesia.ts` (324 baris, engine murni membaca DB) | Data-driven strategy (tarif sebagai data) | Perubahan regulasi = data baru ber-`effectiveFrom`, bukan rilis kode. Terbukti lintas modul: saklar `taxEnabled` mengubah perilaku POS lewat +5/−1 baris (commit S2). |
| **Kolom kustom** | `src/lib/custom-fields.ts` (344 baris) | Data-driven schema extension | Definisi tervalidasi untuk product/supplier/customer, nilai di jsonb `attributes`; nilai yatim dari definisi terhapus diabaikan saat render, tidak hilang. Batas sadar D-16: bukan form builder generik. |
| **Metode pembayaran sebagai data** | tabel `payment_methods` + CRUD penuh (commit A-8.2: hanya 5 berkas, +741/−106) | Data-driven | Metode bayar baru = baris data; nol kode. |
| **Seri dokumen & penomoran** | `src/server/sequences.ts` (97 baris) + `document_sequences` | Registry pola tunggal | Jenis dokumen baru mendaftarkan serinya (RTB, KSB, PJM, RBS, AST, PRQ, RSV lahir dengan pola ini). |
| **Pola idempotensi** | `src/server/idempotency.ts` (31 baris) `claimIdempotencyKey` ber-scope | Pola bersama (library, bukan framework) | Dipakai ulang POS, penerimaan, penyesuaian, transfer, retur pemasok — dokumen baru cukup memakai scope-nya. |
| **PrintShell & komponen laporan** | `src/components/print/` + `src/components/akuntansi/report-document.tsx` | Komposisi komponen | Dokumen/laporan cetak baru menyusun shell yang sama (kop, footer, QR, tanda tangan). |
| **Katalog peran & izin** | `src/lib/permissions.ts` (179 baris) `MODULE_PERMISSIONS` | Data/katalog terpusat | Izin baru = entri katalog + pemberian peran, tanpa migrasi (terbukti: `inventory.price` di FIX-GDG T3). |
| **Registry ringan `Record<…>`** | 114 pemakaian `Record<string, …>` di `src/lib`+`src/server` | Strategy-by-table | Label status, label sumber jurnal, peta kelompok laporan — menambah varian = menambah entri tabel. |

### Yang ABSEN — dan penilaian proporsionalnya

- **Tidak ada event bus / pub-sub / plugin system / DI container** (grep
  `EventEmitter|eventBus|registerPlugin` di `src`: nol selain plugin Better
  Auth). Komunikasi antar modul adalah panggilan fungsi langsung di dalam
  transaksi yang sama.
- **Penilaian: ketiadaan ini TEPAT untuk konteksnya, bukan cacat.** Ini
  modular monolith satu produk, satu basis data, transaksi yang menuntut
  atomik lintas modul (penjualan = stok + jurnal + audit dalam satu tx).
  Event bus akan memecah atomik itu menjadi konsistensi-akhir yang harus
  dibuktikan ulang, dan plugin system tidak punya konsumen kedua. Variabilitas
  yang benar-benar ada di produk ini bersifat **per perusahaan** (tarif,
  pemetaan akun, saklar, metode bayar, kolom kustom) — dan tepat di situlah
  mekanismenya data-driven. Variabilitas **per fitur** dijawab dengan modul
  baru (§1). Yang akan mengubah vonis ini: kebutuhan integrasi pihak ketiga
  yang asinkron (webhook marketplace, gateway pembayaran sungguhan) — saat
  itu outbox POS offline yang sudah ada adalah embrio pola yang benar.

**Vonis ekstensibilitas (mekanisme): SESUAI — skor 8/10.**

---

## 3. SRP & kohesi modul (dari daftar ekspor aktual)

| Modul | Ekspor | Baris | Tanggung jawab terukur | Vonis kohesi |
|---|---|---|---|---|
| `accounting.ts` | 10 | 620 | gerbang jurnal (`postJournal`, reversal), peta akun, periode fiskal — **satu pekerjaan** | Teladan |
| `pos/` (6 berkas, hasil T4) | 30 | ±3.640 total | quote, sales, returns, receivables, sessions — satu berkas per alur | Kohesif |
| `inventory/` (7 berkas, hasil T4) | 29 | ±3.630 total | movements, receipts, adjustments, transfers, opname, documents — satu berkas per dokumen | Kohesif |
| `supplier-returns.ts` | 18 | 2.071 | satu domain (klaim + 4 jalur penyelesaian) | Kohesif |
| `employee-advances.ts` / `employee-loans.ts` / `fixed-assets.ts` | 20 / 17 / 17 | — | satu domain per berkas | Kohesif |
| `payroll-indonesia.ts` (server) | 15 | — | satu engine | Kohesif |
| `idempotency.ts`, `sequences.ts`, `audit.ts` | 1–3 | 31–97 | satu pola per berkas | Teladan |
| `catalog.ts` | 33 | 1.143 | kueri master data (produk, kategori, satuan, pemasok, pelanggan, gudang, metode bayar) **plus** riwayat dokumen & kueri stok | Cukup — satu tema "baca master & riwayat", tetapi tiga sub-tema |
| `hr.ts` | **55** | **2.108** | ±7 sub-domain dalam satu berkas: parameter & organisasi, absensi, shift, lembur, draf THR/komponen, cuti, final pay/terminasi | **Laci terbesar yang tersisa** — kelompoknya rapi dan jahitan pemecahannya jelas (pola T4 dapat diulang), tetapi hari ini satu berkas memikul 7 tanggung jawab |
| `reports.ts` | **43** | **2.835** | laporan keuangan (7), analitik penjualan POS (6), riwayat sesi (4), kueri jurnal/buku besar (7), daftar AR/AP/beban (3), rekonsiliasi kontrol — **lima konteks baca dalam satu berkas** | Terlemah di antara modul besar; dapat dibela sebagai "lapisan read-model", tetapi batasnya adalah "semua yang membaca", bukan satu konteks |

**Vonis SRP: SEBAGIAN — skor 7/10.** Mayoritas modul domain pasca-T4
satu-tanggung-jawab secara terukur; dua pengecualian bernama (`hr.ts`,
`reports.ts`) menahan skor, dan keduanya adalah berkas tunggal besar — bukan
percampuran tanggung jawab di dalam fungsi.

---

## 4. Parallel development (churn & co-change dari git log)

Basis: 85 commit menyentuh `src/` dari 173 commit total; 1.026 sentuhan berkas
non-migrasi tersebar di 332 berkas unik; 10 berkas terpanas menyumbang 21%
sentuhan — konsentrasi sedang, bukan ekstrem.

**Churn tertinggi (jumlah commit menyentuh):** `schema.ts` 34 ·
`reports.ts` 23 · `actions/inventory.ts` 22 · `actions/accounting.ts` 22 ·
`settings-forms.tsx` 22 · `inventory.ts` 21 · `pos.ts` 20 ·
`actions/settings.ts` 18 · `catalog.ts` 15 · `pos-terminal.tsx` 15.

**Pasangan co-change teratas:**

| Pasangan | Frekuensi | Interpretasi |
|---|---|---|
| `settings-forms.tsx` ↔ `schema.ts` | 16× | **Titik konflik global #1**: hampir setiap konfigurasi baru menyentuh skema + form pengaturan raksasa (1.795 baris) |
| `settings-forms.tsx` ↔ `actions/settings.ts` | 15× | trio hub pengaturan yang sama |
| `schema.ts` ↔ `actions/settings.ts` | 15× | idem |
| `pengaturan/page.tsx` ↔ `settings-forms.tsx` | 14× | idem — empat berkas ini satu gugus |
| `schema.ts` ↔ `actions/accounting.ts` | 15× | wajar: fitur akuntansi menambah tabel |
| `pos/page.tsx` ↔ `pos-terminal.tsx` | 10× | kopling di dalam konteks POS sendiri |
| `actions/pos.ts` ↔ `pos.ts` | 10× | pasangan actions↔domain satu konteks — sehat |
| `pos-terminal.tsx` ↔ `pos.ts` | 10× | perubahan fitur POS memang menyentuh UI+domain konteksnya sendiri |

**Penilaian untuk 3–5 developer paralel:**

- **Antar konteks: memungkinkan.** Bukti co-change menunjukkan perubahan fitur
  terkonsentrasi di konteksnya sendiri (halaman + komponen + actions + domain
  konteks itu). Developer gudang dan developer payroll jarang menginjak berkas
  yang sama, kecuali dua corong global di bawah.
- **Dua corong global nyata:** (1) `src/db/schema.ts` — satu berkas skema
  untuk ±98 tabel, tersentuh 34/85 commit src; setiap fitur bertabel baru
  melewatinya. (2) Gugus pengaturan (`settings-forms.tsx` 1.795 baris +
  `actions/settings.ts` 1.116 baris) — setiap konfigurasi baru mendarat di
  berkas yang sama. Dua titik ini, bukan batas modulnya, yang akan menjadi
  antrean konflik pertama tim paralel.
- **Fakta organisatoris (proporsional):** tidak ada `CODEOWNERS`, tidak ada
  git remote, satu branch `main`, dan riwayat ditulis dua identitas agen —
  pengembangan paralel manusia **belum pernah terjadi** di repo ini; program
  ini sendiri menserialkan fase justru karena satu pohon kode. Jadi vonis ini
  struktural: batas modulnya *siap* untuk kepemilikan per konteks, tetapi
  infrastruktur kolaborasinya (remote, branch, CODEOWNERS) belum ada.

**Vonis parallel development: SEBAGIAN — skor 5/10** (struktur 7, kesiapan
organisasi 3).

---

## 5. LSP / ISP / DIP di level modul (singkat, berbasis bukti)

- **ISP — SESUAI, 8/10.** Bukti terkuat di repo: `QuoteResultPublic` di
  `src/server/pos/quote.ts:106` didefinisikan sebagai
  `Omit<QuoteResult, "lines"> & { lines: QuoteLinePublic[] }` — tipe hasil
  publik yang terpisah dari tipe internal, dengan `unitCost` dijadikan
  opsional dan disanitasi per baris bagi non-pemegang izin `inventory.cost`
  (FIX-POS T3). Klien secara harfiah tidak dapat melihat harga pokok lewat
  tipe itu. Pola yang sama: `withCompanyReadOnly` vs `withCompany`
  (permukaan baca dipisah dari tulis), dan `index.ts` di `pos/` & `inventory/`
  mengekspor ulang tepat API publik modul — permukaan modul adalah daftar
  ekspor yang disengaja, bukan "semua yang ada di folder".
- **DIP — SEBAGIAN, 6/10.** Inversi yang nyata dan masif: fungsi domain
  menerima `tx: Tx` sebagai parameter — **383 pemakaian** di domain — sehingga
  logika bergantung pada gagang transaksi yang disuntikkan pemanggil
  (withCompany), bukan pada koneksi global; inilah yang membuat fixture test
  rollback-transaction di seluruh program dapat bekerja. Domain juga
  bergantung pada **kunci abstraksi** (pemetaan akun, konfigurasi DB), bukan
  akun konkret. Yang tidak ada: lapisan repository/antarmuka di atas Drizzle
  — domain mengimpor tabel skema langsung. Untuk stack ini itu idiomatik dan
  biaya abstraksinya tidak terbayar; tetapi secara tekstual DIP berhenti di
  batas transaksi & konfigurasi, tidak sampai ke batas penyimpanan.
- **LSP — SEBAGIAN, 6/10.** Tidak ada hierarki kelas, jadi LSP berlaku sebagai
  konsistensi varian di balik satu kontrak fungsi — dan di situ buktinya baik:
  lima `ReceiptSource` (purchase/opening/bonus/customer_return/other) berjalan
  di balik satu `createReceipt` dengan sisi kredit jurnal ditentukan sumber
  secara eksplisit; empat jalur penyelesaian retur pemasok (ganti barang,
  potong pembelian berikut, refund, custom) berjalan di balik satu kontrak
  posting dengan penyelesaian campuran yang teruji. Tidak ditemukan varian
  yang melanggar kontrak induknya. Skor ditahan karena tidak ada mekanisme
  yang *menegakkan* substitusi selain test perilaku per varian.

---

## 6. Tabel vonis & skor

| Prinsip / aspek | Vonis | Skor |
|---|---|---|
| SRP (level modul) | SEBAGIAN | 7/10 |
| OCP (terbukti dari riwayat fitur) | SESUAI | 8/10 |
| LSP (varian di balik kontrak) | SEBAGIAN | 6/10 |
| ISP (segregasi tipe publik) | SESUAI | 8/10 |
| DIP (injeksi Tx & konfigurasi) | SEBAGIAN | 6/10 |
| Ekstensibilitas (mekanisme hidup) | SESUAI | 8/10 |
| Parallel development | SEBAGIAN | 5/10 |
| **Dimensi AD-2 (SOLID & ekstensibilitas)** | **SEBAGIAN–SESUAI** | **7/10** |

**Kesimpulan satu paragraf.** Arsitektur ini lulus uji yang paling sulit
dipalsukan — uji riwayatnya sendiri: sembilan fitur lintas empat program
menunjukkan pola ekstensi yang konsisten (84–94% baris di berkas baru untuk
fitur modular; hook aditif belasan baris untuk fitur yang hidup di dalam alur
lama), ditopang mekanisme data-driven tepat di titik variabilitas per
perusahaan. Kelemahannya bukan pada prinsip SOLID intinya, melainkan pada
dua berkas laci yang tersisa (`hr.ts`, `reports.ts`), dua corong kolaborasi
(`schema.ts`, gugus pengaturan), dan prasyarat organisasi pengembangan
paralel yang memang belum dibangun. Tidak satu pun dari itu adalah cacat
desain domain; semuanya pekerjaan penataan yang jalurnya sudah dicontohkan
oleh FIX-ARS T4 di repo yang sama.
