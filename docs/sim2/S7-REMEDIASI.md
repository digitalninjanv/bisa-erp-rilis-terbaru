# SIM-2 Fase S7 — Remediasi Konsolidasi

**Tanggal:** 2026-11-04 · **Peran:** Remediation Lead · **Status: SELESAI**
(semua gerbang hijau, belum commit — menunggu Pemimpin).
**Sumber temuan:** S0-A (utang teknis & celah), S0-B (sisa master data),
S0-C (requirement HR), S0-D, S2 (daftar C/H/R), S3 (sisa NOT
IMPLEMENTED), S4 (R-1…R-7), S5 (RT-01…RT-08), S6 (sisa risiko).

Prinsip fase: tutup temuan kecil–menengah yang **tuntas-aman** dengan
TDD (test gagal dulu → perbaikan → hijau + suite penuh hijau). Yang
besar/berisiko tidak dipaksakan — ditulis sebagai TERBUKA + alasan +
requirement/acceptance criteria. Tidak ada angka/regulasi yang diubah,
tidak ada migrasi lama yang diedit, tidak ada pembangunan besar
(offline POS, absensi, aset tetap = S7B per D-24).

---

## 1. Daftar konsolidasi (REM-01…) & status akhir

| ID | Pri | Sumber | Isi | Status |
|---|---|---|---|---|
| REM-01 | P1 | RT-07 (S5), S0-B §2 | FK database untuk relasi master + bersihkan yatim fixture | **TERTUTUP** |
| REM-02 | P2 | S0-B §2 (snapshot) | Snapshot nama+SKU pada baris PO/penerimaan/dokumen stok/retur pemasok | **TERTUTUP** |
| REM-03 | P2 | SEC-09 (S6), S3 sisa #3 | Penampil riwayat perubahan per record (produk & akun) | **TERTUTUP** |
| REM-04 | P3 | H-1 (S2) | Tanggal jurnal payroll `‹periode›-28` → akhir bulan sebenarnya | **TERTUTUP** |
| REM-05 | P3 | S0-A utang #2 | Dead code `reports.listCashSessions` | **TERTUTUP** |
| REM-06 | P3 | S0-A utang #1 | Tabel `outbox` yatim ambigu | **TERTUTUP** (keputusan tercatat) |
| REM-07 | P2 | S4 R-5 | Pagination server daftar piutang/utang | TERBUKA (§3) |
| REM-08 | P3 | S0-A utang #5a | Indeks unik kategori datar vs bertingkat | TERBUKA (§3) |
| REM-09 | P2 | S4 R-1 | Beranda lambat di skala besar (agregasi materialized) | TERBUKA (§3) |
| REM-10 | P2 | S4 R-2 | Streaming ekspor besar | TERBUKA (§3) |
| REM-11 | P3 | S4 R-3 | Pencarian teks jurnal (trigram tak terpakai di bawah RLS) | TERBUKA (§3) |
| REM-12 | P2 | S4 R-4 | Agregasi laporan tahunan 2–5 dtk di 1 jt baris | TERBUKA (§3) |
| REM-13 | P3 | S4 R-6 | Indeks trigram nama produk warisan | TERBUKA — keputusan: **pertahankan** (§3) |
| REM-14 | P3 | S4 R-7 | Berkas DB 3,1 GB pasca-benchmark (VACUUM FULL) | TERBUKA (§3) |
| REM-15 | P3 | S2 H-2…H-7, R-1…R-8 | Sisa payroll Indonesia | TERBUKA per butir (§3) |
| REM-16 | P3 | SEC-04 sisa (S6) | Rate limit in-memory per instance | TERBUKA (§3) |
| REM-17 | P1-desain | RT-04 (S5) | Round-trip transaksi & jurnal penuh tingkat aplikasi | TERBUKA (§3) |
| REM-18 | P3 | S5 | Backup terjadwal + uji restore berkala otomatis | TERBUKA (§3) |
| REM-19 | P3 | S3 sisa #2 | Varian, multi-barcode, brand, kode produk supplier, stok maks, lokasi default, serial | TERBUKA (§3) |
| REM-20 | P3 | S3 sisa #4–#8 | Saved views, impor update-existing + rollback batch, panel kualitas data, duplicate record, status archived/draft | TERBUKA (§3) |
| REM-21 | P3 | S0-A utang #3/#4 | Dua wizard impor paralel; berkas domain raksasa | TERBUKA (§3) |
| REM-22 | P3 | S0-A §5 #9 (sisa) | Cetak bukti pembayaran utang/piutang & faktur penjualan formal | TERBUKA (§3) |
| REM-23 | P3 | S0-C | HR lanjutan: absensi/shift/cuti/lembur, histori jabatan/gaji, terminasi, pinjaman, reimbursement | TERBUKA — lingkup S7B (§3) |
| REM-24 | P2 | S0-A §5 #7/#8 | Purchase Request, banding harga pemasok, diskon/biaya penerimaan, penjaga invoice duplikat, aging/dead/fast-slow, reservasi, in-transit | TERBUKA (§3) |

---

## 2. Yang TERTUTUP — bukti

### REM-01 — FK integritas referensial (migrasi 0031)

- **Cacat (RED):** test baru `tests/sim2/rem-referential-integrity.test.ts`
  gagal 4/4 sebelum perbaikan: sisipan `stock_on_hand`/`stock_movements`
  berproduk hantu dan produk berkategori/satuan/pemasok hantu semuanya
  DITERIMA database; perusahaan fixture menyimpan 54 baris
  `stock_on_hand` + 166 baris `stock_movements` yatim (produknya tidak
  ada; bertambah dari 46/142 saat S5 karena aktivitas fixture S6).
- **Perbaikan:** 27 constraint FK baru (migrasi `0031`):
  `products.category_id/unit_id/supplier_id`; `stock_on_hand.product_id/
  warehouse_id`; `stock_movements.product_id/warehouse_id/batch_id`;
  `stock_batches.product_id/warehouse_id`; baris dokumen
  (`purchase_order_lines`, `stock_receipt_lines`, `stock_document_lines`,
  `supplier_return_lines`) `.product_id` (+ `batch_id` retur);
  `purchase_orders.supplier_id`; `stock_receipts.warehouse_id/supplier_id/
  payment_account_id`; `stock_documents.warehouse_id/to_warehouse_id/
  supplier_id`; `supplier_returns.supplier_id/warehouse_id`;
  `customers.group_id`; `sales.customer_id`; `payroll_items.employee_id`.
  Semua `ON DELETE no action` — selaras penjaga hapus aplikasi.
- **Pembersihan yatim (tercatat di kepala migrasi 0031):** DELETE
  berbasis anti-join (`product_id NOT IN (SELECT id FROM products)`)
  untuk kedua tabel stok — hanya baris yang produknya sudah tidak ada
  yang tersentuh; Σ qty kedua sisi sama (378) sehingga invariant
  on-hand = Σ movements utuh. Khusus `stock_movements`, trigger
  append-only dimatikan di dalam transaksi migrasi lalu dinyalakan lagi
  sebelum FK dipasang. Pada instalasi tanpa yatim, DELETE ini no-op.
  Sesudah migrasi, query ulang seluruh relasi kandidat: **0 yatim di
  semua relasi** (termasuk yang tidak jadi di-FK).
- **Akar yatim ditutup di sumbernya:** dua cleanup fixture adalah
  produsen yatimnya, dan keduanya diperbaiki mengikuti aturan yang sama
  dengan penjaga hapus aplikasi (produk ber-ledger memang tidak boleh
  dihapus):
  - `tests/integration/master-crud.test.ts` — cleanup tidak lagi
    menghapus produk yang punya `stock_movements`; produk seperti itu
    ditombstone (SKU diganti unik + nonaktif, ledger net-nol utuh).
    Tidak ada assertion yang diubah.
  - `tests/integration/inventory-void-import.test.ts` (GD-P1-6) —
    afterAll tidak lagi menghapus baris master produk impor (komentarnya
    dulu secara eksplisit memilih mengyatimkan baris stok); produk
    dinonaktifkan, SKU-nya sudah unik per larian. Tidak ada assertion
    yang diubah.
  - Sisa fixture yang telanjur tertinggal dari dua larian suite yang
    cleanup-nya rollback dibersihkan satu kali di DB dev dengan logika
    yang sama persis (SKU-P18-STOK/KATEGORI dihapus karena tanpa
    ledger; SKU-P18-GERAK ditombstone; 3 produk TST-VI-IMP dinonaktifkan).
- **Satu penyesuaian test yang disadari & didokumentasikan:**
  `tests/integration/consistency.test.ts` "reports the same inventory
  value as SQL" — SQL pembanding kini menyaring `p.is_active = true`,
  populasi yang sama dengan `getInventoryValuation` (laporan memang
  hanya menilai produk aktif). Dulu kedua sisi cocok tanpa filter hanya
  karena baris master fixture terhapus (yatim tak ikut join). Invariant
  angkanya tidak berubah; populasinya kini dinyatakan eksplisit di
  kedua sisi (komentar di test).
- **GREEN:** test REM-01 4/4; ketiga berkas terdampak + consistency
  30/30; suite penuh hijau (§4).

### REM-02 — Snapshot nama produk (migrasi 0032)

- **Cacat (RED):** test baru `tests/sim2/rem-name-snapshot.test.ts`
  gagal: kolom `product_name` tidak ada — nama dokumen historis dibaca
  dari master (S0-B §2: hanya harga yang dibekukan).
- **Perbaikan:** kolom `product_name` + `product_sku` (nullable) di
  `purchase_order_lines`, `stock_receipt_lines`, `stock_document_lines`,
  `supplier_return_lines` (migrasi `0032` + backfill dari master saat
  migrasi — titik beku terbaik yang tersedia untuk dokumen lama,
  dinyatakan di komentar migrasi). Diisi di semua 6 titik pembuatan
  baris: `createPurchaseOrder`, `createReceipt`,
  `createAdjustment`, `createTransfer`, `createOpname`,
  `createSupplierReturn`. Permukaan baca beralih ke
  `coalesce(snapshot, nama master)`: detail PO, cetak PO, cetak GRN,
  `getSupplierReturnDetail` (detail + cetak retur),
  `listOpenPurchaseOrdersForSupplier`, dan pesan penjaga void
  penerimaan. Pola mengikuti `sale_lines` yang sudah lama benar.
- **GREEN:** test REM-02 membuktikan keempat tabel membekukan nama+SKU
  saat pembuatan dan tetap nama awal sesudah produk diganti nama,
  termasuk lewat `getSupplierReturnDetail`. Regresi terarah domain
  terkait: 97/97.

### REM-03 — Penampil riwayat perubahan per record (SEC-09)

- **Cacat (RED):** test baru `tests/sim2/rem-audit-viewer.test.ts`
  gagal: `listEntityAuditTrail is not a function` — audit_log ditulis
  100+ titik tanpa pembaca per record.
- **Perbaikan:**
  - `listEntityAuditTrail(tx, companyId, entityType, entityId, {page,
    pageSize})` di `src/server/audit.ts` — terfilter tepat per entitas,
    terbaru dulu, paginasi server + total jujur (indeks
    `audit_log_company_entity_idx` sudah ada).
  - Komponen bersama `AuditHistorySection`
    (`src/components/blocks/audit-history.tsx`) — ekstraksi persis dari
    seksi riwayat di detail pihak S3 (markup & `summarizeAuditChange`
    yang sama); `party-detail-view.tsx` kini memakainya (perilaku pihak
    tidak berubah; suite master-data hijau).
  - Halaman detail produk: seksi "Riwayat perubahan" berpaginasi
    (`auditPage`); `Pagination` mendapat prop opsional `pageParam`
    (bawaan `"page"`, kompatibel ke belakang) agar dua daftar di satu
    halaman tidak saling menimpa.
  - Halaman detail akun BARU `/app/akuntansi/akun/[id]` (gerbang
    `accounting.view`, sama dengan bagan akun): fakta master, saldo
    berjalan, tautan ke buku besar akun itu, dan riwayat perubahannya.
    Nama akun di bagan akun kini menaut ke detail ini. Rute ter-generate
    di build produksi.
- **GREEN:** test model baca (filter per entitas, urutan, paginasi,
  total) lulus; typecheck bersih; build memuat rute baru.

### REM-04 — H-1: tanggal payroll = akhir bulan periode

- **Cacat (RED):** test unit baru `tests/unit/period-end-date.test.ts`
  gagal 3/3 (helper belum ada); perilaku lama menanggalkan jurnal
  payroll `‹periode›-28` untuk semua bulan.
- **Perbaikan:** helper murni `periodEndDate(period)` di
  `src/lib/format.ts` (hari kalender terakhir, Februari kabisat benar);
  `runPayrollAction` memakainya di ketiga titik yang dulu `-28` (nomor
  dokumen — yang hanya memakai tahunnya —, tanggal jurnal, tanggal
  alokasi kasbon). **Run historis tidak berubah** (tanggalnya sudah
  tercatat); hanya run baru yang bertanggal benar. Tidak ada angka yang
  berubah; `assertPeriodOpen` bekerja per bulan sehingga hasil
  buka/tutup periode identik.
- **GREEN:** unit 3/3; test integrasi baru di
  `tests/sim2/payroll-indonesia.test.ts` membuktikan jurnal run periode
  2026-08 bertanggal **2026-08-31**; seluruh berkas payroll terkait
  58/58 hijau.

### REM-05 — Dead code `reports.listCashSessions`

Dihapus. Bukti mati: `grep` di `src/`, `tests/`, `e2e/` = 0 pemanggil
(sudah digantikan `listCashSessionHistory` sejak A-8.3, sesuai catatan
S0-A). Suite penuh + typecheck hijau sesudah penghapusan membuktikan
tidak ada pemakai tersembunyi.

### REM-06 — Tabel `outbox`

**Tidak dihapus** (sesuai mandat fase: ia rumah antrean offline POS
S7B per D-24). Status ambigu yang dikeluhkan S0-A ditutup dengan
komentar keputusan di `src/db/schema.ts` yang menyatakan tabel ini
sengaja dipertahankan tanpa pemakai runtime sampai S7B.

---

## 3. Yang TERBUKA — alasan + requirement

- **REM-07 (S4 R-5, pagination AR/AP):** `listPayables`/`listReceivables`
  punya 5 pemanggil dengan semantik berbeda — dashboard (butuh total
  semua), halaman piutang-utang (daftar tampil), aksi Catat Transaksi
  (himpunan terbuka penuh untuk pembayaran FIFO), detail & merge pihak
  (himpunan per pihak). Pagination yang aman hanya untuk halamannya,
  lewat fungsi baca berpaginasi BARU, bukan mengubah tanda tangan
  fungsi yang dipakai jalur pembayaran. Requirement: tambah
  `listPayablesPage`/`listReceivablesPage` (offset/keyset + agregat
  total terpisah), halaman piutang-utang memakainya; AC: angka total
  halaman = total fungsi penuh pada data yang sama (test), pemanggil
  lain tidak berubah.
- **REM-08 (kategori bertingkat vs unik datar):** DIBLOKIR bukti —
  pencocokan kategori saat impor berbasis nama per perusahaan
  (`src/server/actions/import.ts:792-797`, `lower(name)`), jadi nama
  kategori unik per perusahaan adalah asumsi yang menopang impor.
  Melonggarkan indeks ke `(company, parent, name)` tanpa mengubah
  impor akan membuat resolusi kategori ambigu diam-diam. Requirement:
  referensi kategori impor berbasis jalur ("Induk > Anak") atau
  ID eksternal; AC: dua subkategori bernama sama di bawah induk berbeda
  dapat dibuat, impor dengan jalur menunjuk yang benar, impor nama
  tunggal yang ambigu ditolak dengan pesan jelas.
- **REM-09/10/12 (S4 R-1/R-2/R-4):** ketiganya perubahan domain/
  arsitektur (agregasi harian materialized untuk beranda; streaming
  ReadableStream + keyset untuk ekspor ≥100 rb baris; tabel ringkasan
  saldo bulanan per akun) — di luar remediasi aman satu fase.
  Requirement & angka dasarnya sudah lengkap di S4 §7; AC R-2 terukur
  (heap <50 MB pada 100 rb baris).
- **REM-11 (S4 R-3):** perlu keputusan produk (batasi pencarian ke
  awalan nomor / terima biaya / kolom pencarian khusus). Jangan pasang
  trigram lagi tanpa bukti baru (terbukti leakproof di bawah RLS).
- **REM-13 (S4 R-6):** keputusan fase ini: **pertahankan** indeks
  trigram nama produk. S4 membuktikan ia tidak terpilih di bawah RLS,
  tetapi koneksi non-RLS (seed/admin sebagai owner) masih bisa
  memakainya untuk `ilike` pada katalog besar, dan biaya insert-nya
  tidak terukur material di S4. Cabut hanya bila pengukuran produksi
  menunjukkan biaya tulis nyata.
- **REM-14 (S4 R-7):** operasional — `VACUUM FULL` mengunci tabel;
  jadwalkan di jendela pemeliharaan, bukan dari fase kode.
- **REM-15 (S2):** H-2 (periode hanya bulanan), H-3/H-5 (dasar BPJS &
  cek UMP = pokok+tunjangan gabungan — butuh pemisahan tunjangan
  tetap/tidak tetap di master karyawan = perubahan domain), H-4
  (bawaan PTKP TK/0 — sudah jujur tercatat `ptkpAssumed` di snapshot;
  menjadikannya konfigurasi menyentuh engine + halaman pengaturan),
  H-6 (kode program adalah kosakata skema), H-7/R-2 (tarif PPN
  bertanggal efektif), R-1 (TER harian — tabelnya belum terverifikasi
  penuh dari sumber resmi, lihat catatan S0-C; jangan disemai dari
  angka yang belum pasti), R-3 (toggle PPN per transaksi), R-4 (DTP),
  R-5 (aksi bayar setoran 2110/2120), R-6 (THR/lembur terhubung run —
  menunggu data absensi/lembur S7B; fungsi murninya sudah teruji),
  R-7 (gross-up), R-8 (slip mandiri karyawan). Requirement + AC lengkap
  per butir sudah ada di S2 §7 — tetap berlaku apa adanya.
- **REM-16 (SEC-04 sisa):** rate limit login kini eksplisit tetapi
  in-memory per instance. Requirement: storage rate-limit di database
  (tabel Better Auth) atau limiter di reverse proxy untuk deployment
  multi-instance; CAPTCHA/penguncian akun & UI 2FA (plugin `twoFactor`
  masih dorman) adalah keputusan produk terpisah.
- **REM-17 (RT-04):** round-trip transaksi & jurnal penuh tingkat
  aplikasi tetap **NOT IMPLEMENTED by design** — riwayat jurnal tidak
  punya jalur ekspor/impor aplikasi (yang teruji PASS: master, stok
  awal, saldo awal AR/AP per dokumen). Requirement & batasnya di
  runbook S5 tetap berlaku; jalur yang sah untuk pemulihan penuh
  adalah backup/restore database (terbukti PASS di S5).
- **REM-18:** backup terjadwal + retensi + off-site + uji restore
  berkala otomatis — pekerjaan operasional/deployment; requirement di
  runbook S5.
- **REM-19/20 (S3):** pembangunan fitur (varian/multi-barcode/brand/
  dst.; saved views & kolom kustom; impor master update-existing +
  rollback batch; panel kualitas data umum; duplicate record; status
  archived/draft terpisah). Requirement per butir di laporan S3
  ("Sisa NOT IMPLEMENTED") tetap berlaku. Catatan: bagian panel
  kualitas data yang menyangkut yatim referensial kini dicegah di
  sumbernya oleh REM-01.
- **REM-21 (S0-A utang #3/#4):** penggabungan dua wizard impor dan
  pemecahan berkas domain raksasa (`pos.ts`, `reports.ts`,
  `inventory.ts`, `actions/accounting.ts`) adalah refactor besar tanpa
  nilai fungsi langsung; risiko regresi > manfaat di fase remediasi.
  Requirement: lakukan sebagai fase tersendiri dengan gerbang suite
  penuh per langkah ekstraksi, mengikuti pola ekstraksi yang sudah
  dimulai (`expenses.ts`, `bank-transfers.ts`, `payables.ts`).
- **REM-22 (S0-A §5 #9 sisa):** cetak bukti pembayaran utang/piutang &
  faktur penjualan formal = permukaan cetak baru (rute + kerangka
  Print Engine + tautan dari daftar pembayaran). Slip gaji — bagian
  terbesar butir ini — sudah tertutup di S2. Requirement: halaman
  cetak per pembayaran pihak memakai `party_payments` + jurnalnya,
  mengikuti pola cetak GRN/RTB; AC: nominal & pihak di cetakan =
  dokumen pembayaran, termasuk pembayaran saldo awal.
- **REM-23 (S0-C):** absensi/shift/lembur, cuti & saldo cuti, histori
  jabatan/gaji, terminasi terstruktur & final pay, pinjaman karyawan
  terpisah, reimbursement berpersetujuan — pembangunan besar, lingkup
  S7B sesuai D-24. Requirement + acceptance criteria per sub-bab sudah
  lengkap di S0-C §6 — tetap berlaku.
- **REM-24 (S0-A §5 #7/#8):** Purchase Request formal, banding harga
  pemasok, diskon pembelian/biaya tambahan penerimaan, penjaga
  duplikat nomor invoice pemasok, stock aging, dead/fast/slow moving,
  reservasi stok, in-transit, serial number — pembangunan fitur;
  S0-A mencatat data mentahnya (`stock_movements` bertanggal, batch
  berkedaluwarsa) sudah lengkap untuk dibangun tanpa migrasi besar.

---

## 4. Gerbang verifikasi (dijalankan pada pohon final)

| Pemeriksaan | Hasil |
|---|---|
| `pnpm test` (vitest run) | **806/806 lulus, 88 berkas, exit 0** (baseline awal fase 796/796, 84 berkas → +10 test baru: 4 REM-01, 1 REM-02, 1 REM-03, 3 unit + 1 integrasi REM-04) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (0 error; 1 warning warisan S5 di `tests/sim2/s5-roundtrip.test.ts` — berkas tidak disentuh fase ini) |
| `pnpm build` | **exit 0** (compiled ±100 dtk; rute baru `/app/akuntansi/akun/[id]` ter-generate) |
| Migrasi | `0031` (27 FK + pembersihan yatim tercatat) & `0032` (8 kolom snapshot + backfill) diterapkan ke DB dev; tidak ada migrasi lama diubah |

Catatan deploy: jalankan `pnpm db:migrate` sampai 0032. Rollback 0031 =
drop 27 constraint (nama constraint ada di berkas migrasinya); baris
yatim fixture yang terhapus memang sampah uji (produknya sudah tidak
ada) dan tidak perlu dipulihkan. Rollback 0032 = drop 8 kolom snapshot.

## 5. Berkas kunci fase ini

- Migrasi: `src/db/migrations/0031_tricky_james_howlett.sql`,
  `0032_good_thanos.sql`; skema: `src/db/schema.ts` (FK REM-01, kolom
  snapshot REM-02, komentar keputusan `outbox` REM-06).
- Domain: `src/server/audit.ts` (`listEntityAuditTrail`),
  `src/server/inventory.ts` + `purchasing.ts` + `supplier-returns.ts`
  (isi & baca snapshot), `src/server/reports.ts` (dead code dihapus),
  `src/server/actions/accounting.ts` + `src/lib/format.ts` (REM-04).
- UI: `src/components/blocks/audit-history.tsx` (baru),
  `src/components/blocks/pagination.tsx` (`pageParam`),
  `src/components/gudang/party-detail-view.tsx` (memakai komponen
  bersama), `src/app/app/gudang/produk/[id]/page.tsx` (seksi riwayat),
  `src/app/app/akuntansi/akun/[id]/page.tsx` (baru) +
  `src/app/app/akuntansi/akun/page.tsx` (tautan detail), halaman
  detail/cetak PO & cetak GRN (snapshot).
- Test baru: `tests/sim2/rem-referential-integrity.test.ts`,
  `tests/sim2/rem-name-snapshot.test.ts`,
  `tests/sim2/rem-audit-viewer.test.ts`,
  `tests/unit/period-end-date.test.ts`; test disentuh:
  `tests/integration/master-crud.test.ts`,
  `tests/integration/inventory-void-import.test.ts` (cleanup fixture
  REM-01), `tests/integration/consistency.test.ts` (populasi valuasi
  eksplisit), `tests/sim2/payroll-indonesia.test.ts` (+1 test REM-04).
