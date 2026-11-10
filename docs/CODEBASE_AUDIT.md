# Audit Codebase Bisa ERP — Berbasis Graphify (A-24 Fase 1)

**Tanggal:** 2026-11-05 · **HEAD:** `6d54490` · **Konteks gerbang terakhir:** suite
1441/1441, e2e 16/16 (A-24 T1, commit `55a7484`); baseline demo konsisten:
65 produk, nilai persediaan Rp28.349.600, consistency 11/11; migrasi sampai 0053.
**Mandat:** master prompt pengguna 2026-11-05 22:48 §2 — Graphify sebagai alat
utama pemetaan codebase; hasil audit disimpan di dokumen ini.

Dokumen ini adalah **konsolidasi**: peta dari graf + inventaris temuan
berkategori master prompt, dengan audit lama (A-15…A-23, SIM-2) direkonsiliasi —
dibedakan tegas antara "sudah tertutup program lama (bukti commit/suite)" dan
"masih terbuka (penanganan tercatat)". Rincian eksekusi perbaikan hidup di
`docs/rombak/RENCANA.md` (tahap T1–T8); indeks induk 15 fase master prompt ada
di `IMPLEMENTATION_PLAN.md` di akar repo.

---

## 1. Metode & batas kejujuran graf

1. Graf disegarkan di HEAD: `graphify update .` (exit 0) — 57 dari 739 berkas
   terklasifikasi diekstrak ulang inkremental.
2. Klaim arsitektur (hub, kopling, aliran) diambil dari keluaran CLI graf:
   `graphify god-nodes`, `graphify explain`, `graphify path`,
   `graphify affected`, `graphify query`, dan `graphify-out/GRAPH_REPORT.md`.
3. Temuan yang dijadikan temuan resmi diverifikasi silang ke kode nyata
   (ukuran berkas `wc -l`, isi `package.json`, pola impor, hitungan `grep`).
4. **Batas graf yang harus diakui:**
   - Ekstraksi Graphify untuk kode bersifat deterministik (tree-sitter/AST):
     graf membuktikan *struktur* (siapa memanggil/mengimpor siapa), **bukan**
     kebenaran fungsi bisnis. Klaim "fitur bekerja" di dokumen ini selalu
     bersumber dari test/bukti program lama, bukan dari graf.
   - **55 berkas `.sql` tidak berkontribusi ke graf** (dependensi
     `tree_sitter_sql` tidak terpasang; peringatan eksplisit saat `update`).
     Akibatnya 54 berkas migrasi (`src/db/migrations/`, sampai 0053) dan isi
     skema SQL **tidak terlihat graf** — pernyataan skema di sini bersumber
     dari `src/db/schema.ts` (TypeScript, terlihat graf) dan PROGRESS.md.
   - Graf mencampur node kode + test + dokumen (korpus 734 berkas,
     ±1,73 juta kata). Deteksi komunitas karena itu terencerkan oleh node
     dokumen: skor kohesi komunitas besar hanya 0,02–0,10. **Kohesi rendah di
     sini bukan vonis modul buruk** — yang dipakai sebagai bukti adalah
     derajat node, jalur antar-node, dan pemetaan hub komunitas ke folder
     nyata, bukan angka kohesi mentah.
   - 6% edge berlabel INFERRED (1.207 edge, kepercayaan rata-rata 0,94) —
     hampir semuanya relasi dokumen↔kode. Semua jalur yang dikutip di §4
     berlabel EXTRACTED.

## 2. Statistik graf kunci (sesudah penyegaran, HEAD `6d54490`)

| Ukuran | Nilai |
|---|---|
| Node | 5.814 |
| Edge | 21.792 (94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS) |
| Komunitas | 203 (192 tampil di laporan, 11 tipis disembunyikan) |
| Siklus impor | **0 terdeteksi** |
| Berkas korpus | 734 (±1.734.284 kata) |
| Berkas `src` (TS/TSX) | 363 berkas, 101.744 baris |
| Berkas test + e2e | 156 berkas |
| Migrasi SQL | 54 berkas (tidak terlihat graf — lihat §1) |

### God nodes — sepuluh node terhubung terbanyak

| # | Node | Edge | Makna arsitektural |
|---|---|---|---|
| 1 | `d()` (`src/lib/money.ts`) | 548 | Konstruktor Decimal — seluruh aritmetika uang melewati satu primitif. Betweenness tertinggi (0,146): jembatan antar semua komunitas. |
| 2 | `withCompany()` (`src/db/tenant.ts`) | 342 | Corong transaksi tenant (RLS) untuk tulis. |
| 3 | `AppError` (`src/lib/errors.ts`) | 333 | Satu tipe error di seluruh domain. |
| 4 | `withCompanyReadOnly()` | 277 | Corong baca tenant. Bersama #2: **619 edge** — tidak ada jalur data tenant yang melewati di luar dua fungsi ini. |
| 5 | `todayISO()` | 268 | Primitif tanggal bersama. |
| 6 | `formatIDR()` | 235 | Satu formatter Rupiah untuk seluruh UI/laporan. |
| 7 | `guard()` | 231 | Penutup aksi server tunggal (termasuk formatter ZodError bersama sejak FIX-ARS T1). |
| 8 | `writeAudit()` | 197 | Jejak audit terpusat. |
| 9 | `toDb()` | 191 | Konversi Decimal→string `numeric` satu titik. |
| 10 | `drizzle-orm` | 188 | Dependensi ORM — satu-satunya lapisan data. |

**Pembacaan:** kopling sistem ini berbentuk *bintang ke primitif bersama*
(uang, tenant, error, audit, format), bukan jaring antar-modul. Itu pola yang
disengaja oleh AGENTS.md proyek dan terbukti menahan perubahan besar
(A-20: fitur besar 84–94% baris di berkas baru).

### Berkas terbesar (verifikasi `wc -l`, 2026-11-05)

| Baris | Berkas | Catatan |
|---|---|---|
| 3.093 | `src/server/reports.ts` | Belum dipecah (lihat CB-A1) |
| 2.865 | `src/db/schema.ts` | Seluruh skema satu berkas (ARS1-05) |
| 2.592 | `src/server/actions/accounting.ts` | Memuat juga aksi payroll (CB-A2) |
| 2.521 | `src/server/hr.ts` | Belum dipecah |
| 2.240 | `src/server/supplier-returns.ts` | Belum dipecah |
| 1.874 | `src/components/pengaturan/settings-forms.tsx` | UI pengaturan |
| 1.718 | `src/server/pos/sales.ts` | Hasil pecahan FIX-ARS T4 (dari ±790 baris satu fungsi menjadi folder domain) |
| 1.388 | `src/components/pos/pos-terminal.tsx` | Hasil pecahan FIX-ARS T5 (dari 2.985 baris) — wilayah tidak disentuh A-24 |

## 3. Peta codebase dari graf

### 3.1 Struktur lapisan (sesuai AGENTS.md proyek, terbukti di graf)

```
src/app/app/**            halaman per modul (force-dynamic)
src/app/api/**            rute API (ekspor, impor parse, health)
src/server/actions/*.ts   aksi server tipis: "use server" + Zod + requirePermission + guard()
src/server/*.ts           domain (menerima tx): accounting, hr, reports, payables, …
src/server/pos/           domain POS terpecah: sales, quote, returns, receivables, sessions (+ pos.ts re-export)
src/server/inventory/     domain gudang terpecah: receipts, movements, opname, adjustments, transfers, documents (+ inventory.ts re-export)
src/lib/*.ts              primitif bersama: money, permissions, modules, pos-offline, payroll-indonesia, quick-entry…
src/db/tenant.ts          withCompany/withCompanyReadOnly (corong RLS)
src/db/schema.ts          skema Drizzle satu berkas
src/components/**         UI per modul + blocks/ bersama + pos/ (terminal)
```

### 3.2 Komunitas graf terpetakan ke modul nyata

Deteksi komunitas (203) menghasilkan hub yang selaras dengan batas modul
nyata, antara lain: komunitas `actions/accounting.ts` (133 node),
`actions/hr.ts` (104), `reports.ts` (45), `pos-terminal.tsx` (42),
`server/pos-offline.ts` (33) + `lib/pos-offline.ts` (19),
`server/payroll-indonesia.ts` (27) + `lib/payroll-indonesia.ts` (21, kohesi
0,20 — komunitas kode murni terkohesif di antara domain besar),
`modules.ts` (25), `permissions.ts` (26), `settings-shell.tsx` (20),
`landing.ts` (6 node, kohesi 0,46). Dua sinyal batas yang kabur terbaca dari
graf dan dibahas sebagai temuan: hub `actions/accounting.ts` **mencampur
konten HR/payroll** (CB-A2), dan hub `schema.ts` menampung seluruh tabel
semua modul dalam satu komunitas (CB-A1/ARS1-05).

### 3.3 Komponen & primitif bersama (dari god nodes + hub komunitas)

- Uang: `d()`, `toDb()`, `formatIDR()`, komponen `MoneyInput` (hub komunitas
  33) — kontrak ketik diperbaiki A-23 S1, diperluas A-24 T1.
- Tenant & sesi: `withCompany*`, `requireAuth`, `requirePermission(InModule)`,
  `guard()`, `AppError`, `writeAudit()`.
- Presentasi: `PageHeader`, `ModuleShell`, `GateNotice` + `lib/form-gate`
  (A-24 T1), `ReportDocument` (FIX-R2), palet perintah (A-24 T1).
- Domain bersama: `postJournal()` (gerbang jurnal, §4), penomoran dokumen
  (`document-numbering.ts`), `ProductPicker` + penangkap barcode (komunitas
  55, kohesi 0,19 — dipakai gudang & POS; generalisasinya di T3 dibatasi
  keputusan Pemimpin §3.1 RENCANA).
- Konfigurasi: `modules.ts` (`ModuleKey = "pos" | "gudang" | "akuntansi"` —
  terverifikasi di kode hari ini: **belum ada `"hr"`**, lihat CB-P2),
  `permissions.ts` (`BUILTIN_ROLES`), saklar modul per perusahaan, custom
  fields (`custom-fields.ts`).

### 3.4 Aliran rantai utama: UI → aksi server → domain → DB

Semua jalur di bawah EXTRACTED dari graf:

- **Penjualan POS:** `pos-terminal.tsx` → `actions/pos.ts` →
  `server/pos/sales.ts::createSale` → `postSaleJournal` → **`postJournal`**
  (jalur graf: 2 hop, EXTRACTED). Gerakan stok ditulis domain yang sama di
  transaksi yang sama; POS tidak menyentuh tabel stok dari lapisan UI
  (terverifikasi A-18, konsisten dengan struktur komunitas graf).
- **Penerimaan barang:** `actions/inventory.ts` →
  `server/inventory/receipts.ts::createReceipt` → `postReceiptJournal` →
  `postJournal`; AVCO diperbarui di lapisan movements.
- **Payroll:** halaman HR (rute di bawah akuntansi) →
  **`actions/accounting.ts::runPayrollAction` / `payPayrollAction`** →
  `postJournal` (bukti `graphify affected postJournal`). Mesin hitungnya
  sendiri terpisah rapi (`lib/payroll-indonesia.ts` +
  `server/payroll-indonesia.ts`), tetapi *aksi* payroll tinggal di berkas
  aksi akuntansi — lihat CB-A2.
- **Retur pemasok:** `actions/supplier-returns.ts` →
  `server/supplier-returns.ts` → `postJournal`.
- **Offline POS:** terminal → `lib/pos-offline.ts` (`IndexedDbOfflineStorage`,
  antrean tulisan tangan — bukan Dexie) → `server/pos-offline.ts`
  (`postOfflineReviewItem`) → domain penjualan yang sama. Tabel `outbox` ada
  di skema (`schema.ts` L2854 menurut graf).
- **`postJournal` sebagai pusat:** derajat 154 (`src/server/accounting.ts`
  L237). `graphify affected` kedalaman 2 menunjukkan pemanggil langsung dari
  **semua** modul: `payPayableDocument`, `payExpensePayable` (utang),
  `postReceiptJournal`, `createOpname`, `postAdjustmentJournal`,
  `receiveTransfer` (gudang), `createEmployeeAdvance`, `createEmployeeLoan`,
  `processFinalPay` (HR), `registerFixedAsset`, `runFixedAssetDepreciation`,
  `disposeFixedAsset` (aset), `createBankTransfer`, `createJournalFromLine`
  (rekonsiliasi), `createOpeningBalance`, `postWriteOff`, `commitImportBatch`
  (impor), dan pembaliknya sendiri `reverseJournalEntry`/`reverseSourceJournal`.
  Setiap rupiah di sistem melewati satu gerbang yang menegakkan keseimbangan
  jurnal + `assertPeriodOpen` — ini kekuatan integritas terbesar sistem.

### 3.5 Kopling antarmodul terukur

- **0 siklus impor** di seluruh graf. Satu-satunya siklus yang pernah
  tercatat (ARS1-07: `lib/permissions.ts ↔ lib/modules.ts`) terverifikasi
  hari ini bersifat **tipe saja** (`import type { ModuleKey }` di
  permissions.ts:1; `import type { Permission }` di modules.ts:39) — terhapus
  saat runtime, jinak, tetap dicatat (CB-A5).
- Kopling antar-domain **satu arah ke kernel akuntansi**: semua domain
  mengimpor `postJournal`; akuntansi tidak mengimpor balik domain mana pun
  untuk menulis. POS↔stok dan HR↔akuntansi berintegrasi lewat domain +
  jurnal, bukan lewat UI atau tabel silang langsung dari halaman (ratchet
  ARS1-01 menjaga jalur baca halaman; test arsitektur itu sendiri node di
  graf, komunitas 118).
- Konsentrator yang disadari: `quick-entry` (ARS1-11) — Catat Transaksi
  memang dirancang sebagai titik temu lintas domain; dijaga kontrak
  pratinjau==posting dari lib bersama (D-23).
- Risiko konsentrasi perubahan: `d()` (548 edge) dan `schema.ts` (2.865
  baris, semua tabel) — perubahan pada keduanya berdampak sistemik; keduanya
  stabil dan dijaga test, tetapi menjadi alasan perubahan di titik ini wajib
  TDD penuh (pola yang sudah berjalan).

---

## 4. Inventaris temuan berkategori (master prompt §2)

Format tiap temuan: **bukti** (graf/test/dokumen/commit) · **dampak** ·
**penanganan** (tahap RENCANA / fase master prompt / keputusan pemilik /
sisa jujur). ID `CB-*` stabil untuk dirujuk IMPLEMENTATION_PLAN.md.

### 4.1 WORKING — berfungsi & teruji (jangan diutak-atik tanpa alasan)

- **CB-W1 — Gerbang jurnal tunggal.** Bukti: graf §3.4 (derajat
  `postJournal` 154; affected lintas semua modul); audit A4 A-15 membuktikan
  jurnal rantai utama benar; suite hijau mempertahankannya. Dampak: integritas
  double-entry terpusat. Penanganan: dipertahankan; perubahan apa pun padanya
  wajib TDD + gerbang penuh.
- **CB-W2 — Isolasi tenant terpusat.** Bukti: 619 edge graf melalui
  `withCompany`/`withCompanyReadOnly`; probe RLS 89/89 (A-17) & 5/5 (A-15).
  Penanganan: dipertahankan.
- **CB-W3 — Primitif uang & format terpusat.** Bukti: god nodes #1/#6/#9;
  kontrak ketik MoneyInput diperbaiki A-23 S1 (suite +31 test) & A-24 T1.
- **CB-W4 — Invariant stok AVCO.** Bukti: `stock_on_hand` = Σ movements;
  consistency 11/11 pada reseed berulang; probe GDG-1/A-17; trigger
  append-only pada movements. Penanganan: dipertahankan.
- **CB-W5 — Engine payroll Indonesia konfigurable (D-25).** Bukti: komunitas
  graf `lib/payroll-indonesia` kohesi 0,20 & `server/payroll-indonesia`
  (tabel parameter bertanggal efektif: PTKP, TER, tarif, program BPJS,
  upah minimum, lembur); SIM-2 S2/S6 (izin `payroll.view` menutup SEC-01).
- **CB-W6 — Ratchet jalur baca halaman (ARS1-01).** Bukti:
  `tests/unit/architecture-read-paths.test.ts` di suite; halaman berkuei
  sendiri 47→16 (semua sisa satu-tabel sah), join/agregasi di halaman = 0.
- **CB-W7 — Performa laporan teratasi terukur.** Bukti: ringkasan saldo
  bulanan (migrasi 0046) — neraca saldo 12 bulan 455→31,6 ms (FIX-ARS T2);
  arus kas agregat SQL (T3). Penanganan: dipertahankan.
- **CB-W8 — Mekanik offline POS & idempotensi checkout.** Bukti: komunitas
  graf `lib/pos-offline` + `server/pos-offline`; FIX-POS T2 probe audit
  18/18 hijau (antrean >50, kepemilikan penyinkron, sesi). **Batasnya** ada
  di CB-P1: mekanik teruji ≠ terbukti di peramban sungguhan.

### 4.2 PARTIAL — berfungsi sebagian

- **CB-P1 — Offline POS belum terbukti di peramban.** Bukti: keadaan
  terverifikasi RISET-TEKNOLOGI — antrean IndexedDB tulisan tangan, sinkron
  per 25 dengan hasil per item, saklar per perusahaan bawaan mati, **tanpa
  service worker/manifest** (offline hanya menolong bila terminal sudah
  termuat); uji browser sungguhan berlabel NOT TESTED sejak SIM-2.
  Dampak: klaim "bisa offline" belum boleh dibuat ke pemilik toko.
  Penanganan: **T6** (tiga skenario pembuktian) + pengerasan PWA bersyarat;
  pengemasan pemasangannya di **T5**.
- **CB-P2 — HR lengkap sebagai domain, belum berdiri sebagai modul.** Bukti:
  `ModuleKey = "pos" | "gudang" | "akuntansi"` di `src/lib/modules.ts:42`
  (terverifikasi hari ini — tidak ada `"hr"`); rute HR hidup di bawah
  `/app/akuntansi/…`; domainnya sendiri lengkap (SIM-2 S2/S7B: payroll,
  absensi, shift, lembur, cuti, pinjaman, final pay). Dampak: pengguna
  mengalami HR sebagai tamu akuntansi — bertentangan dengan mandat modul
  tersendiri. Penanganan: **T2** (modul shell Opsi A, tanpa pindah rute).
- **CB-P3 — Integrasi antarmodul terbukti per rantai, belum menyeluruh pada
  hasil akhir.** Bukti: simulasi SimMart SIM-2 S1 36/36, matriks verifikasi
  A-5 per program, test integrasi rantai (feature-matrix). Dampak: sesudah
  T2–T6, bukti lama tidak otomatis berlaku untuk pohon baru. Penanganan:
  **T7** (matriks fungsi menyeluruh dijalani ulang).
- **CB-P4 — Ekspor laporan hanya CSV.** Bukti: komunitas graf `toCsv`;
  FIX-R2 mencatat ekspor Excel/PDF berformat tidak dibangun. Penanganan:
  keputusan pemilik / sisa jujur (bukan tahap T).
- **CB-P5 — Backup terbukti di tingkat DB, belum terjadwal; round-trip
  jurnal tingkat aplikasi memang tidak dibangun.** Bukti: SIM-2 S5 (prosedur
  lama terbukti rusak lalu diperbaiki; restore identik; RT-04 NOT
  IMPLEMENTED by design); tidak ada timer cadangan. Penanganan: penjadwalan
  di **T5** (systemd timer memakai `scripts/backup.sh`); round-trip aplikasi
  tetap keputusan desain tercatat.
- **CB-P6 — Kredit pihak belum sampai ke terminal POS.** Bukti: A-21 R3-B —
  domain `party_credits` lengkap & teruji; tender kredit di UI terminal dan
  refund tunai kredit tak terpakai ditunda beralasan. Penanganan: keputusan
  pemilik (wilayah POS; batas "terminal tidak disentuh").

### 4.3 BROKEN — error / tidak berfungsi

- **CB-B0 — Tidak ada temuan BROKEN yang diketahui terbuka di HEAD.**
  Bukti: suite 1441/1441 + e2e 16/16 pada `55a7484`, pohon dokumen di atasnya
  tidak mengubah kode. Kejujuran wajib: "tidak diketahui" ≠ "tidak ada" —
  pembuktian per fitur adalah pekerjaan **T7**. Yang pernah BROKEN dan sudah
  ditutup (dicatat agar tidak diklaim/dibuka ulang): pencarian jurnal rusak
  dari UI (A-22 K1, `4cbf628`), halaman Aset Tetap error total tanpa
  pemetaan (A-22 K6, `143a2bc`), MoneyInput merusak nominal ketikan ≥5
  digit (SIS-01 → A-23 S1, `b44d934`), gerbang form jalan-buntu untuk peran
  lihat (SIS-05 → A-24 T1, `55a7484`), prosedur backup lama (SIM-2 S5).

### 4.4 MISSING — belum tersedia

- **CB-M1 — Promosi bertanggal.** Bukti: pemetaan 40 fitur RISET-DOMAIN —
  satu dari dua kekosongan domain nyata. Penanganan: **keputusan pemilik**
  (daftar §3 RENCANA), bukan dibangun diam-diam.
- **CB-M2 — Peringatan kadaluarsa bertingkat.** Bukti: RISET-DOMAIN; batch &
  FEFO sendiri ada (program lama G8), yang hilang adalah jenjang
  peringatannya. Penanganan: **keputusan pemilik**.
- **CB-M3 — Konversi multi-satuan.** Bukti: keputusan D-17 (PROGRESS) —
  sengaja tidak dibangun karena mengubah matematika POS/penerimaan/stok di
  semua jalur; produk satu satuan dasar. Master prompt §7 menyebut konversi
  satuan dalam cakupan gudang — **ketegangan ini dicatat eksplisit** di
  IMPLEMENTATION_PLAN (Fase 8): keputusan pemilik yang berlaku adalah D-17
  sampai pemilik mengubahnya.
- **CB-M4 — Service worker + manifest (PWA).** Bukti: RISET-TEKNOLOGI §0.
  Penanganan: butir bersyarat **T6** (diputuskan dari bukti skenario server
  mati), bukan janji.
- **CB-M5 — Tiga angka regulasi belum disemai** (batas JP 2026
  Rp11.086.300, lapisan TER harian, status DTP 2026). Bukti: SIM-2 S2/S8 —
  sengaja tidak disemai karena belum terverifikasi penuh; D-25 melarang
  angka regulasi dikarang. Penanganan: **keputusan pemilik** (sumber resmi).
- **CB-M6 — PIN supervisor POS (POS3-12).** Penanganan: **keputusan
  pemilik** sejak A-17.
- **CB-M7 — Form builder generik & status dokumen kustom.** Bukti: D-16 —
  **ditolak beralasan**, bukan kelalaian: status dokumen adalah enum penjaga
  integritas akuntansi/stok. Penanganan: keputusan pemilik bila ingin
  dibuka lagi; saklar modul & custom fields (yang aman) sudah ada.

### 4.5 DUPLICATE — fungsi tumpang tindih / tersalin

- **CB-D1 — Helper test `rollbackTransaction` tersalin di 56 berkas.**
  Bukti: `grep -rl` definisi di `tests/` pada 2026-11-05 = 56 berkas
  (A-18/ARS2-05 mencatat 48; bertambah seiring suite tumbuh). Dampak: utang
  arsitektur test (skor 6/10 di A-20), bukan cacat produk. Penanganan:
  sisa jujur — kandidat Fase 6 master prompt, belum terjadwal di tahap T.
- **CB-D2 — Dua pola validasi aksi masih hidup** (`parseInput` bersama vs
  `.parse()` mentah per aksi; ARS2-04). Format error-nya sudah terpusat di
  `guard()` (FIX-ARS T1 menutup ARS1-03), pola penulisannya belum seragam.
  Penanganan: sisa jujur oportunistik.
- **CB-D3 — Pola folder domain belum merata.** Bukti: graf & struktur §3.1 —
  `pos/` & `inventory/` sudah folder domain + re-export 3 baris (FIX-ARS
  T4); `reports.ts`, `supplier-returns.ts`, `hr.ts`, `accounting.ts` masih
  berkas datar raksasa. Bukan duplikasi fungsi, melainkan ketidakseragaman
  pola yang sama — dirujuk bersama CB-A1.

### 4.6 BAD UX — sulit digunakan (sisa sesudah A-22/A-23/T1)

- **CB-U1 — Workflow gudang masih sulit.** Bukti: audit A-23 wilayah gudang
  (a.o. SIS-09 sidebar gudang tidak berkelompok; pekerjaan dokumen belum
  scan-first terpandu). Domainnya kuat (FIX-GDG), pengalamannya belum.
  Penanganan: **T3**.
- **CB-U2 — HR terkubur di navigasi akuntansi.** Bukti: CB-P2. Penanganan:
  **T2**.
- **CB-U3 — Dokumen terposting tanpa "Lihat jurnal" satu klik.** Bukti:
  RISET-DOMAIN §3.1 (pola "Rincian Jurnal" Accurate) — jurnal terasa kotak
  hitam dari dokumen sumber. Penanganan: **T4** (dokumen non-POS; dokumen
  POS dikecualikan per keputusan Pemimpin §3.1 RENCANA).
- **CB-U4 — Tutup sesi POS satu klik tanpa hitung terpandu (SIS-10).**
  Wilayah terminal POS. Penanganan: **keputusan pemilik** (batas "POS
  jangan disentuh" pengguna sendiri).
- **CB-U5 — Sisa fitur lanjutan POS-2 (POS2-07/08/21)** di luar berkas tahap
  FIX-POS A-17. Penanganan: sisa jujur / keputusan pemilik.

### 4.7 ARCHITECTURE ISSUE — struktur teknis bermasalah

- **CB-A1 — Berkas raksasa tersisa di domain inti.** Bukti: §2 —
  `reports.ts` 3.093, `actions/accounting.ts` 2.592, `hr.ts` 2.521,
  `supplier-returns.ts` 2.240 baris; `schema.ts` 2.865 baris menampung
  seluruh tabel (ARS1-05). FIX-ARS menutup kelas yang sama untuk
  pos/inventory/PosTerminal (bukti pola penanganannya ada), tiga domain ini
  belum. Dampak: blast radius review & risiko regresi per perubahan.
  Penanganan: **sisa jujur** — bukan tahap T1–T8; kandidat Fase 6 master
  prompt (ketegangan dicatat di IMPLEMENTATION_PLAN).
- **CB-A2 — Aksi payroll tinggal di berkas aksi akuntansi.** Bukti: graf —
  `runPayrollAction`/`payPayrollAction`/`processFinalPay`-adjacent berada di
  `src/server/actions/accounting.ts` (2.592 baris) dan hub komunitas graf
  `actions/accounting.ts` mencampur temuan HR; bandingkan `actions/hr.ts`
  yang ada untuk sebagian HR lain. Dampak: batas kepemilikan kode HR tidak
  sejelas batas pengalamannya sesudah T2 — master prompt §4 meminta business
  logic per modul, T2 hanya memisahkan shell. Penanganan: sisa jujur;
  kandidat Fase 6/9 lanjutan bila Pemimpin menjadwalkan.
- **CB-A3 — Dependensi `xlsx` dari tarball CDN.** Bukti: `package.json:51`
  terverifikasi hari ini: `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/…"`;
  konteks SEC-05 (versi dengan kerentanan yang belum tertambal di npm) +
  dependensi yatim ARS2-07. Penanganan: sisa Fase 13 — mengganti sumber
  dependensi adalah perubahan rantai pasok, perlu keputusan/uji tersendiri.
- **CB-A4 — Ekspor CSV dibangun utuh sebagai string di memori (PERF-02)** +
  paginasi AR/AP belum streaming/keyset. Bukti: node temuan di komunitas
  graf `toCsv`; daftar sisa P2/P3 A-18. Dampak: batas skala ekspor.
  Penanganan: sisa jujur oportunistik.
- **CB-A5 — Siklus tipe `permissions.ts ↔ modules.ts`.** Bukti: §3.5 —
  runtime bersih (graf: 0 siklus), tipe saling mengimpor. Dampak: kecil;
  penanda batas lib belum steril. Penanganan: sisa jujur.
- **CB-A6 — `quick-entry` konsentrator kopling (ARS1-11, by design).**
  Penanganan: dipantau; kontrak D-23 (pratinjau == posting dari lib
  bersama) adalah mitigasinya dan teruji.
- **CB-A7 — CI tertulis, tidak pernah berjalan di GitHub.** Bukti:
  `.github/workflows/ci.yml` ada (komunitas graf `ci.yml`, jobs quality/
  build/test/e2e) tetapi repo **tanpa git remote** — ARS4-01, satu-satunya
  P1 A-18 yang tidak bisa ditutup dari kode. Penanganan: **keputusan
  pemilik** (remote + branch protection + required CI).

### 4.8 DATA INTEGRITY ISSUE — berpotensi data tidak konsisten

- **CB-I1 — Assertion konsistensi ringkasan bulanan masih terbatas
  perusahaan demo.** Bukti: FIX-ARS penjaga `072489b` — DB dev bersama
  memuat 18 perusahaan residu historis pra-0046 (baris dari generator
  bypass & cleanup fixture lama) sehingga assertion dua arah belum bisa
  digeneralisasi ke semua perusahaan di DB dev itu. Ini keterbatasan bukti
  di lingkungan dev bersama, **bukan** cacat pada jalur produksi (titik
  pemeliharaan ringkasan tunggal di `postJournal`). Penanganan: sisa jujur
  (pembersihan residu + audit helper bypass).
- **CB-I2 — Gerakan stok pra-0044 dinilai pada tanggal posting.** Bukti:
  catatan A-17; terdeklarasi di UI rekonsiliasi. Penanganan: diterima &
  terdokumentasi; bukan dihitung ulang diam-diam.
- **CB-I3 — Heuristik nama untuk akun PPh atas bunga** pada model cepat
  rekonsiliasi (A-22 K3): kandidat akun dipilih dari nama; pemetaan khusus
  per perusahaan belum ada. Dampak: pilihan bawaan bisa meleset pada COA
  bernama tak lazim (pengguna tetap memutuskan di form). Penanganan:
  **keputusan pemilik** (kandidat pemetaan khusus).
- **CB-I4 — Dua baris auth yatim** (`kasir.a23@bisa.id`,
  `gudang.a23@bisa.id`, sisa audit A-23, tanpa keanggotaan perusahaan)
  memblokir pemakaian ulang kedua email itu untuk pengguna baru.
  Penanganan: sisa jujur kecil — pembersihan data dev, bukan perubahan kode.

---

## 5. Konsolidasi audit lama — tertutup vs masih terbuka

| Program / audit | Temuan | Status hari ini (bukti) |
|---|---|---|
| Audit awal 3 modul + perbaikan 5 tahap (2026-11-03/04) | 91 temuan | Tertutup pada programnya; fondasi matriks A-5 |
| SIM-2 S0–S8 (A-14) | Payroll ID nol, SEC-01 gaji terbaca luas, master data, backup rusak | Tertutup `4eb7944`, suite 881/881; sisa jujurnya (offline NOT TESTED, 3 angka regulasi) hidup sebagai CB-P1/CB-M5 |
| Audit adversarial akuntansi (A-15, 86 temuan) + FIX-P1 | 18 P1 angka/periode/PPN | Tertutup `57ba612`, suite 968/968; sisa: kompensasi PPN akhir masa & SPT manual (proses bisnis, bukan cacat) |
| Ronde 2 desain (A-16, 32 temuan) + FIX-R2 | Desain laporan & konsistensi UI | Tertutup, suite 1009/1009; sisa: ekspor berformat (CB-P4), RD2-13/14/15 (detail audit hilang — tidak dikarang) |
| Audit POS (A-17, 62 temuan) + FIX-POS | 16 P1 domain/offline/izin/UI | Tertutup 4 tahap, suite 1072/1072 saat itu; sisa: POS3-12/POS3-14 (keputusan pemilik), POS2 lanjutan (CB-U5), offline browser (CB-P1) |
| Audit Gudang (A-17, 50 temuan) + FIX-GDG | 8 P1 plafon/AVCO/kepemilikan | Tertutup 4 tahap (migrasi 0043–0045); sisa: keputusan pemilik gudang (maker-checker PO, gerbang harga massal, pembatasan per pengguna) |
| Audit arsitektur (A-18, 49 temuan, 6,9/10) + FIX-ARS (A-19) | 9 P1 | 8 tertutup dari kode (suite 1195/1195); 1 = remote/CI (CB-A7, keputusan pemilik); P2/P3 sisa = CB-A1/A3/A4, CB-D1/D2 |
| Analisis mendalam (A-20, vonis 6,7/10) | Dependency Rule 8/10, OCP 8/10; bounded context 6/10; parallel dev 5/10 | Penilaian berdiri; delta FIX-ARS tercatat di laporannya; tidak ada rewrite yang dituntut — konsisten dengan graf hari ini (0 siklus, kopling bintang) |
| Akuntansi R3 kelengkapan input (A-21, 16 temuan) | Fee transfer, penjaga seragam, kredit pihak, fee/withholding/write-off | Tertutup, suite 1298/1298, migrasi 0047–0053; sisa P3 murni R3-13/14/16 (kebijakan/cakupan) + CB-P6/CB-I3 |
| UI/UX akuntansi (A-22, 12 temuan) | K1–K6 | Tertutup `e9c59da`, suite 1375/1375, e2e 16/16 |
| UI/UX sistem (A-23, SIS-01…15) | 3 P1: SIS-01 uang ketik, SIS-02 kasir bocor modul, SIS-03 kasir tanpa retur | SIS-01/02 tertutup S1 `b44d934`; SIS-03 tertutup `7079687` (izin retur kasir); SIS-05/07/11/12/15 tertutup A-24 T1 `55a7484`; sisa wilayah gudang → T3 (CB-U1); SIS-10 → keputusan pemilik (CB-U4) |
| Riset A-24 (domain + teknologi) | Fondasi lengkap; celah di jangkauan peran, gerbang, bukti offline; 2 kekosongan domain | Menjadi RENCANA T1–T8; kekosongan = CB-M1/CB-M2 |

## 6. Kesimpulan Fase 1

Graf mengonfirmasi vonis A-18/A-20 dengan data segar di HEAD: **fondasi
kelas satu** — gerbang jurnal tunggal, corong tenant, primitif uang terpusat,
nol siklus, invariant stok & RLS teruji — di atasnya pekerjaan yang tersisa
bersifat *terlokalisasi dan sudah terjadwal*: T2 (shell HR), T3 (UX gudang),
T4 (pola Accurate), T5 (pengemasan Linux), T6 (bukti offline), T7 (matriks
fungsi), T8 (gerbang final). Di luar jadwal T, sisa jujur arsitektur
(CB-A1/A2/A3/A4, CB-D1/D2) dan daftar keputusan pemilik (18 butir di RENCANA
§3) adalah dua daftar yang tidak boleh dicampur: yang pertama pekerjaan
teknis oportunistik, yang kedua hanya pemilik yang boleh membuka.
