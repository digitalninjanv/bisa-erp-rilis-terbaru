# Laporan Audit Produksi — Bisa ERP

> **Program Audit Produksi, Tahap A5 (penutup) — 2026-11-08.**
> Mandat pemilik: audit teknis & fungsional menyeluruh yang BERBUKTI
> (aplikasi dijalankan, workflow diuji nyata ujung-ke-ujung), temuan
> terbukti diperbaiki dengan prioritas kebenaran transaksi, integritas
> stok, akurasi akuntansi, keamanan, dan kestabilan — lalu verdict
> kesiapan produksi berbasis bukti, bukan asumsi.
>
> Sumber bukti: `docs/audit/AUDIT-REGISTER.md` (register temuan hidup
> AUD-001…023), `docs/audit/MATRIKS-FITUR.md` (kelengkapan 82
> halaman), `docs/audit/RENCANA-AUDIT.md` (peta tahap A0–A5),
> `scripts/audit/` (pemeriksa integritas & skrip ukur yang dapat
> diulang), PROGRESS §0K entri A0–A4. Tahapan ter-commit berurutan:
> A0 `a380665` · A1 `1afade9` · A2 `75147f2` · A3 `b730aa8` ·
> A4 `55b47a4`. Laporan ini ditulis di A5 di atas `55b47a4`, tanpa
> perubahan kode.
>
> Status memakai kosakata mandat §9: PASS / FAIL / PARTIAL / BLOCKED /
> NOT IMPLEMENTED / NOT TESTED; risiko P0 (kritis) – P3 (rendah).

---

## A. Executive Summary

**Kondisi keseluruhan.** Bisa ERP adalah monolit modular Next.js 16 /
React 19 / TypeScript strict / Drizzle / PostgreSQL 18 (RLS) dengan
satu klien kedua (POS desktop Tauri lewat kontrak API yang sama).
Audit lima tahap (analisis & integritas DB → audit statis & keamanan
permukaan → rantai integrasi antarmodul → skenario peran, injeksi,
volume → perbaikan & regresi) **tidak menemukan satu pun cacat P0**,
tidak menemukan jurnal tak seimbang, stok tak konsisten, akses
lolos-salah, atau fitur tampilan-saja. Semua cacat produk yang
terbukti bereproduksi sudah diperbaiki di A4 dan terverifikasi ulang
pada gerbang final A5.

**Bukti penentu (gerbang final A5, independen, dari reseed bersih —
rincian di §H):** suite **2039/2039** (larian kedua; larian pertama
2037/2039 oleh dua flake keluarga AUD-008 yang invarian datanya
terpegang dan lulus terisolasi), typecheck & build exit 0, lint
0 error, e2e **25/25**, pemeriksaan integritas DB **0 pelanggaran
pada tenant hidup**, drill backup→restore **LULUS** dengan angka
cocok sumber↔restore.

**Kesiapan per modul.** Semua modul web — Master Data, Gudang &
Pembelian, POS web & penjualan, Akuntansi, HR & Payroll, Pengaturan
& Platform — berstatus **siap operasional** dalam batas syarat pada
verdict. Satu permukaan **PARTIAL**: admin & aplikasi POS desktop
(kontrak API dan logika terbukti; installer & jendela GUI belum
pernah teruji di mesin nyata — AUD-009). Dua fitur bernama
**NOT IMPLEMENTED atas keputusan pemilik**: PIN supervisor POS
(AUD-006) dan QRIS dinamis via PSP (AUD-007, yang terpasang adalah
QRIS statis + konfirmasi manual, terverifikasi bekerja).

**Hitungan temuan (23 temuan register: AUD-001…023).**

| Risiko | Jumlah | Rincian status akhir |
|---|---|---|
| P0 — kritis | **0** | — |
| P1 — tinggi | 1 | AUD-006 BLOCKED (keputusan pemilik) |
| P2 — sedang | 5 | 3 FIXED (001, 002, 013) · 1 OPEN sebagai NOT IMPLEMENTED by decision (007) · 1 BLOCKED lingkungan (009) |
| P3 — rendah | 14 | 5 FIXED (003, 014, 015, 016, 021) · 1 FIXED SEBAGIAN (017) · 4 OPEN (011, 012, 018, 022) · 1 BLOCKED keputusan (010) · 1 NOT VERIFIED (004) · 2 MONITOR (008, 023) |
| INFO (bukan cacat) | 3 | AUD-005, AUD-019, AUD-020 — perilaku terverifikasi benar, dicatat agar tidak diungkit ulang |

Total status: **FIXED penuh 8 · FIXED sebagian 1 · OPEN 5 ·
BLOCKED 3 · NOT VERIFIED 1 · MONITOR 2 · INFO 3 = 23.**

Yang menahan verdict dari GO penuh bukanlah cacat produk yang
terbuka — tidak ada P0, dan tidak ada temuan P1/P2 berstatus cacat
yang belum diperbaiki — melainkan tiga hal di luar kode aplikasi:
(1) audit kerentanan dependensi **NOT VERIFIED** karena endpoint
advisori npm tidak terjangkau dari lingkungan ini (AUD-004);
(2) bukti lapangan desktop **NOT TESTED** (AUD-009);
(3) keputusan pemilik yang masih menunggu (AUD-006/007/010/018).
Verdict lengkap & syaratnya di §H.

---

## B. Feature Completeness

Inventarisasi `docs/audit/MATRIKS-FITUR.md` mencakup **82 berkas
`page.tsx`** di `src/app/app/**` plus permukaan non-halaman (POS
desktop, PWA offline, ekspor/API, 10 permukaan cetak). Tidak
ditemukan halaman yang hanya berupa tampilan tanpa fungsi: setiap
halaman membaca lewat jalur baca server yang ditegakkan test
arsitektur, dan setiap aksi terhubung ke server action berpenjaga
izin (A1: 201/201).

| Modul | Halaman | IMPLEMENTED | PARTIAL | Catatan |
|---|---|---|---|---|
| Beranda | 1 | 1 | 0 | Ringkasan & antrean kerja lintas modul |
| POS & Penjualan | 12 | 11 | 1 | PARTIAL = admin terminal desktop (kontrak terbukti, GUI NOT TESTED — AUD-009) |
| Gudang & Pembelian | 31 | 31 | 0 | Termasuk kemasan produk, opname campuran, impor berkemasan |
| Akuntansi | 20 | 20 | 0 | Termasuk 4 permukaan cetak di modul ini |
| HR & Payroll | 14 | 14 | 0 | Nominal tergerbang `payroll.salary` |
| Pengaturan & Platform | 4 | 4 | 0 | Termasuk status sistem (backup & drill) |
| **Total** | **82** | **81** | **1** | |

**NOT IMPLEMENTED bernama (bukan halaman, tidak disamarkan di UI):**
QRIS dinamis via PSP berizin (AUD-007 — keputusan pemilik; QRIS
statis + konfirmasi manual yang terpasang terverifikasi A1) dan PIN
supervisor POS (AUD-006 — keputusan pemilik; tidak ada tombol PIN
yang berpura-pura ada).

**Permukaan lintas terverifikasi:** konversi satuan/kemasan di semua
jalur transaksi (program Satuan Kemasan S1–S6, dibuktikan ulang oleh
rantai A2); idempotensi checkout & sinkron offline tepat sekali;
jurnal terposting tidak dapat diubah (koreksi hanya via pembalik);
10 permukaan cetak berfungsi dengan pengaturan cetak satu pintu.

---

## C. Workflow Testing

Seluruh rantai dijalankan nyata di perusahaan fixture buangan
dengan asersi ANGKA (jurnal per akun, stok, saldo laporan) —
`tests/integration/audit-a2-chains.test.ts`, 12/12 test lulus;
fixture dihapus bersih sesudahnya (0 residu terverifikasi).

| # | Skenario ujung-ke-ujung | Hasil | Angka kunci terverifikasi |
|---|---|---|---|
| a | Pembelian: PO berkemasan → terima → utang → bayar sebagian → lunas | **PASS** | 2 Dus isi 40 @145.000 → stok +80, AVCO tepat 3.625; jurnal penerimaan Dr Persediaan 290.000 = Cr Utang 290.000; sisa utang 290.000 → 190.000 (partial) → lunas & hilang dari daftar; neraca saldo: kas −290.000, utang neto 0, persediaan +290.000 |
| a2 | Kelebihan bayar utang | **PASS** | Utang 50.000 dibayar 80.000 → lunas + dokumen kredit pemasok 30.000 lahir (open); kas −80.000 (desain A-21 — AUD-020) |
| b | Penjualan POS: tunai + QRIS, diskon 10%, PPN 11% | **PASS** | Subtotal 20.000, diskon 2.000, tertagih 18.000; jurnal seimbang per akun (pendapatan = subtotal − pajak terekstrak, diskon contra 2.000, PPN = taxTotal quote, HPP 12.000 = kredit persediaan); stok 20 → 18; cetak ulang struk bertanda "Salinan — bukan nota asli", asli tidak |
| c | Retur penjualan sebagian (berkemasan) | **PASS** | Jual 2 Dus (stok 100 → 20) → retur 1 Dus: stok 60; Dr Retur Penjualan 145.000 = Cr Bank 145.000 (nilai baris asal); HPP dibalik 120.000 |
| d | Retur pembelian | **PASS** | Stok 80 → 40; persediaan −145.000; saldo utang terkoreksi +145.000 |
| e | Transfer gudang dua tahap | **PASS** | `in_transit`: asal 50 → 30, tujuan 0 → terima: tujuan 20; total global tetap 50; histori gerakan tercatat |
| f | Pembatalan (void) penjualan | **PASS** | Stok & neto jurnal kembali 0, histori utuh (jurnal asal + pembalik); void kedua ditolak; retur atas penjualan void ditolak |
| g | Offline POS (web & muatan bergaya desktop) | **PASS** | Muatan sama dikirim ulang → `duplicate`, tepat 1 penjualan; muatan stok kurang tertahan tanpa transaksi setengah; muatan desktop berkemasan (isiSnapshot 40) tersinkron, stok −40 |
| h | Tutup sesi kas buta + tutup periode | **PASS** | Selisih −3.000 tanpa alasan ditolak (sesi tetap terbuka); dengan alasan tertutup + jurnal selisih 3.000; posting ke periode tertutup ditolak; koreksi lewat jurnal pembalik bertanggal terbuka seimbang |
| i | Payroll satu siklus | **PASS** | Run bruto 6.500.000: jurnal seimbang, Dr Beban Gaji = bruto, Cr Utang Gaji ≥ bersih; ekspor rekap FORBIDDEN tanpa `payroll.salary`, 200 dengan izin |
| 3 | Konsistensi laporan vs jurnal sumber | **PASS** | Neraca saldo berimbang (< 0,01); persamaan akuntansi neraca berlaku (< 0,01); saldo kas neraca saldo == agregasi jurnal mentah |

Tidak ada rantai yang FAIL. Dua ekspektasi awal auditor selama
pembangunan test terkoreksi oleh bukti sebagai perilaku desain yang
benar dan kini tercatat permanen sebagai INFO (AUD-019 harga
termasuk PPN; AUD-020 kelebihan bayar → kredit pemasok).

---

## D. Bug & Konflik

Per temuan: ID, risiko, modul, bukti/lokasi sebagaimana tercatat di
register, solusi yang diterapkan atau rekomendasi, dan status akhir
sesudah A4 (perbaikan ter-commit di `55b47a4`) & gerbang final A5.

### P1 — Tinggi (1)

- **AUD-006 · P1 · POS / Keamanan — BLOCKED (keputusan pemilik).**
  PIN supervisor POS belum ada: otorisasi tindakan sensitif kasir
  (void/retur/selisih tutup sesi) belum berpagar PIN supervisor
  (warisan A-28 H-POS-06). Audit tidak membangun fitur otorisasi
  baru tanpa keputusan pemilik. Rekomendasi: putuskan & jadwalkan,
  atau terima risikonya secara tertulis — izin peran (`pos.void`
  dll.) saat ini adalah satu-satunya pagar dan terbukti ditegakkan
  (A3: akuntan & kasir ditolak benar dari void di luar izinnya).

### P2 — Sedang (5)

- **AUD-001 · P2 · Platform / DB dev — FIXED.** 290.896 baris residu
  perusahaan fixture mati di 57/97 tabel bertenant (terbesar:
  journal_lines 69.983, account_monthly_balances 49.115, audit_log
  35.209) — teardown fixture test tidak lengkap; tenant hidup
  selalu bersih. Akibat terbukti di A3: drill restore DB dev gagal.
  Solusi A4: akar diperbaiki (helper bersama
  `tests/helpers/wipe-company.ts` — enumerasi dinamis, satu
  transaksi — dipakai 29 berkas fixture; dua bootstrap fixture
  menulis gerakan `opening` padan; 9 berkas fixture org-less kini
  eksplisit `cashBankKind`) + pembersihan satu kali
  `scripts/audit/cleanup-fixture-residue.{sql,sh}` menghapus
  266.130 baris (backup wajib dulu, satu transaksi, kriteria
  company tanpa baris `organization`). Terverifikasi: db-integrity
  global 0, drill LULUS.
- **AUD-002 · P2 · Akuntansi/HR (data) — FIXED.** FK yatim pada dua
  constraint bernama (`account_monthly_balances.account_id` 47.742
  baris; `employee_history.employee_id` 199 baris) — 100% milik
  perusahaan fixture mati (tenant hidup 0); di A3 kedua constraint
  ini persis yang menggagalkan pg_restore drill. Tertutup oleh
  pembersihan AUD-001; cek D1 db-integrity kini 0 global dan drill
  LULUS di A4 & A5.
- **AUD-007 · P2 · POS / Pembayaran — OPEN: NOT IMPLEMENTED
  (keputusan pemilik); bagian statis PASS.** QRIS dinamis via PSP
  berizin belum terintegrasi. Yang terpasang & terverifikasi A1:
  QRIS statis — gambar tervalidasi tampil di terminal, pembayaran
  non-tunai wajib konfirmasi penerimaan eksplisit kasir terikat
  (metode, total), teruji domain. Dinamis memang tidak dapat
  offline dan butuh kontrak PSP — keputusan & integrasi di luar
  kewenangan audit.
- **AUD-009 · P2 · POS Desktop — BLOCKED (lingkungan).** Utang
  bukti lapangan: installer (.deb/.AppImage/NSIS) belum pernah
  ter-build dan jendela GUI belum pernah terbuka — VM audit tanpa
  pustaka GTK/WebKit sehingga crate Tauri penuh tidak terkompilasi
  di sini. Yang terbukti: kontrak HTTP API perangkat 18/18 (di dalam
  suite), harness Rust berkas-sama 64/64, ekspor statis exit 0.
  Rekomendasi: uji lapangan di satu mesin Linux desktop nyata
  (installer, jendela, printer ESC/POS fisik, keychain OS) sebelum
  desktop dipakai operasional.
- **AUD-013 · P2 · Keamanan / Gudang (izin level-field) — FIXED.**
  Ekspor produk & nilai persediaan membocorkan Harga Beli/HPP ke
  pemegang `inventory.view` tanpa `inventory.cost` — terbukti uji
  negatif langsung (peran viewer ditolak izinnya, tetapi
  `GET /api/export/products` & `/api/export/inventory` menjawab 200
  berisi nilai biaya nyata), padahal UI & payload POS menutupi
  bidang yang sama; halaman Nilai Persediaan juga menampilkan HPP
  di balik `inventory.view` saja. Solusi A4 mengikuti pola
  level-field yang ada: kolom biaya di kedua ekspor dan kolom
  HPP/Nilai + KPI nilai persediaan di halaman hanya tampil bila
  memegang `inventory.cost` (tanpa izin, ekspor tetap berguna —
  kolom hilang, bukan error). Bukti: test baru
  `tests/integration/audit-a4-cost-exports.test.ts` (6 test: viewer
  200 TANPA nilai biaya; owner menerimanya penuh).

### P3 — Rendah (14)

- **AUD-003 · P3 · Test/E2E — FIXED.** E2E berbagi DB dev dengan
  suite: e2e tepat sesudah suite penuh menggagalkan 1 spec oleh
  data fixture suite bertanggal periode berjalan (bukan bug
  aplikasi). Solusi A4: reseed otomatis di global setup Playwright
  di balik saklar `BISA_E2E_RESEED=1` (`e2e/global-setup.ts`; tanpa
  saklar perilaku lama persis). Terbukti pada urutan persis yang
  dulu rapuh — termasuk gerbang final A5: suite → e2e bersaklar
  25/25.
- **AUD-004 · P3 · Dependensi/Keamanan — NOT VERIFIED.** Audit
  kerentanan dependensi tidak dapat dijalankan di lingkungan ini:
  `pnpm audit --json` = `fetch failed`; `pnpm audit --prod --json`
  mencapai registry tetapi endpoint advisori massal ditolak
  **403 `policy_denied`** oleh proksi lingkungan (dua percobaan,
  A0 & A3). `pnpm outdated` hanya menunjukkan ketertinggalan
  patch/minor untuk runtime (next 16.4.3→16.4.5, better-auth
  →1.7.18, react →19.3.1, postgres →4.1.0); mayor hanya di
  devDependencies. **Syarat verdict: jalankan di CI berjaringan
  penuh sebelum deploy produksi. Tidak diklaim bersih.**
- **AUD-008 · P3 · Test/POS — MONITOR.** Keluarga flake balapan
  konkuren di bawah beban suite paralel penuh: test
  `a28-hardening-e2e` (deadlock PG 40P01 pada kunci `cash_sessions`,
  tercatat sejak penutup Satuan Kemasan S6) dan — sesudah DB dev
  dibersihkan di A4 — dua test balapan lain (AK-P3-03 payroll
  konkuren; POS-IDEM-01 idempotensi). Pada semua kejadian
  **invarian data terpegang** (tepat satu pemenang; pihak kalah
  tertolak CONFLICT) — yang berbeda hanya bentuk/teks error pihak
  kalah; terisolasi & batch kecil selalu lulus. A4 menemukan &
  memperbaiki satu celah nyata di keluarga ini (penerjemah error
  payroll kini memetakan kedua constraint `payroll_runs` ke
  CONFLICT yang sama). **Gerbang final A5 mereproduksi keluarga
  ini persis**: larian suite pertama 2037/2039 dengan dua kegagalan
  bernama itu (pesan balapan payroll & bentuk hasil balapan
  idempotensi), kedua berkas lulus terisolasi 28/28, larian kedua
  2039/2039. Rekomendasi tindak lanjut: samakan bentuk error pihak
  kalah pada jalur idempotensi di bawah kontensi (klaim domain
  sudah benar) — pekerjaan test/robustness terpisah, bukan cacat
  data.
- **AUD-010 · P3 · Platform — BLOCKED (keputusan pemilik).**
  Scheduler `a24-lanjut-otomatis` belum diputus matikan/biarkan
  sejak penutup A-24. Dampak: pekerjaan latar terjadwal warisan
  program lama; bukan cacat aplikasi. Menunggu keputusan.
- **AUD-011 · P3 · Kualitas kode — OPEN.** 29 warning lint
  (0 error) — semuanya `@typescript-eslint/no-unused-vars` warisan
  di berkas lama (27 pada A0; 29 pada A4/A5 sesudah berkas test
  audit bertambah; nol dari kode fitur program ini). Bukan
  penghalang gerbang; pembersihan oportunistik.
- **AUD-012 · P3 · Dependensi — OPEN.** `xlsx` dipin dari tarball
  CDN SheetJS (`cdn.sheetjs.com/xlsx-0.20.3`) bukan registry npm —
  keputusan lama terdokumentasi; terverifikasi A1: terkunci di
  `pnpm-lock.yaml` **dengan integrity sha512**, bukan unduhan
  runtime. Risiko sisa: ketersediaan CDN saat install & advisori
  npm tidak menjangkau paket ini (berkaitan AUD-004). Tinjau saat
  AUD-004 ditutup di CI.
- **AUD-014 · P3 · Keamanan/Platform — FIXED.** Tidak ada header
  keamanan global (terkonfirmasi A3 lewat HTTP nyata pada build
  produksi: `/`, `/login`, `/api/health`, halaman terautentikasi
  semuanya tanpa CSP/X-Frame-Options/nosniff/Referrer-Policy/
  HSTS). Solusi A4 di `next.config.ts`: header global `/:path*`
  (nosniff, Referrer-Policy strict-origin-when-cross-origin,
  X-Frame-Options SAMEORIGIN, HSTS 63072000 includeSubDomains) +
  CSP konservatif yang terbukti kompatibel dengan aplikasi
  (build + e2e hijau di bawahnya; header khusus `/pos-sw.js`
  dipertahankan). Sisa tercatat: CSP memakai 'unsafe-inline'
  (App Router streaming + recharts) — pengetatan nonce = pekerjaan
  terpisah bila diinginkan.
- **AUD-015 · P3 · Keamanan/POS Desktop — FIXED.** `POST
  /api/pos/pair` tanpa throttle percobaan (mitigasi bawaan kuat:
  kode ±49,5 bit entropi, TTL 15 menit, sekali pakai, 401 seragam).
  Solusi A4: `src/lib/pair-throttle.ts` — maks 20 kegagalan per
  sumber per jendela 10 menit, sukses mereset, sumber ter-throttle
  tetap menerima 401 yang persis sama. In-memory per instance
  (batasan sama dengan rate limit Better Auth, tercatat di kode).
  6 test unit.
- **AUD-016 · P3 · Kualitas kode — FIXED.** 3 fungsi ter-ekspor
  tanpa pemanggil terverifikasi grep silang seluruh repo:
  `allocateFefo` (implementasi FEFO alternatif yang mati — FEFO
  produksi di `src/server/inventory/movements.ts`; risiko drift),
  `getAvailableSerials`, `listInTransitTransfers`. Dihapus di A4
  sesudah verifikasi ulang nol pemanggil (termasuk pola dinamis);
  suite/typecheck/build hijau.
- **AUD-017 · P3 · Dependensi — FIXED SEBAGIAN + KOREKSI.** 7
  dependensi runtime tak terpakai dicabut via `pnpm remove`
  (react-hook-form, @hookform/resolvers, @tanstack/react-query,
  @tanstack/react-table, clsx, tailwind-merge, pg-boss); lockfile
  konsisten, gerbang hijau. **Koreksi atas klaim awal register:**
  `@tauri-apps/api` yang semula diduga nyasar TERBUKTI TERPAKAI
  oleh `pos-desktop/lib/pos-bridge.ts` (pos-desktop sengaja memakai
  instalasi repo induk) — dibuktikan dua arah (cabut →
  `pnpm pos:export` gagal resolve; kembalikan → hijau) dan
  dipertahankan.
- **AUD-018 · P3 · Keamanan/Auth — OPEN (kebijakan pemilik).**
  Panjang kata sandi minimum 8 (`minPasswordLength` di
  `src/lib/auth.ts`) di bawah rekomendasi NIST SP 800-63B (≥15)
  dari riset A-28. Mitigasi terpasang: rate limit sign-in 10/60
  dtk + plugin 2FA tersedia. Menaikkan minimum hanya untuk kata
  sandi baru dapat dilakukan segera setelah pemilik menyetujui.
- **AUD-021 · P3 · Platform/Backup — FIXED.** `scripts/backup.sh`
  tidak punya fallback jalur biner klien PostgreSQL yang dimiliki
  `restore-drill.sh` — pada mesin tanpa PATH yang tepat backup
  gagal "pg_dump tidak ditemukan". Solusi A4: blok fallback yang
  sama ditambahkan (+ PG_BIN env dihormati). Terbukti:
  `env -i PATH=/usr/bin:/bin bash scripts/backup.sh` exit 0 dengan
  dump ±13,5 MB.
- **AUD-022 · P3 · Performa/Gudang & POS — OPEN.** Pencarian teks
  produk = sequential scan ILIKE tanpa indeks trigram (terukur A3:
  EXPLAIN ANALYZE Seq Scan 17–23 ms SQL pada katalog 10.000;
  30,7–42,2 ms di tingkat domain). Masih di bawah ambang rasa pada
  skala minimarket hari ini, tetapi biayanya linear terhadap
  katalog. Rekomendasi: indeks `pg_trgm` pada name/sku/barcode
  bila katalog/pencarian membesar.
- **AUD-023 · P3 · Performa/Akuntansi — MONITOR.** Buku besar &
  laporan keuangan adalah permukaan baca terberat (terukur A3 pada
  50.000 baris jurnal: buku besar 335 ms, laba rugi 213 ms, neraca
  saldo 220 ms; halaman HTTP 0,46–0,86 dtk). Wajar untuk
  operasional minimarket hari ini; tumbuh bersama volume jurnal.
  Optimasi (saldo berjalan ter-materialisasi per bulan) hanya bila
  angka nyata menuntut.

### INFO — terverifikasi bukan cacat (3)

- **AUD-005 · Arsitektur.** Siklus impor tipe-saja dua arah
  `src/lib/modules.ts` ↔ `src/lib/permissions.ts` (keduanya
  `import type`) — terhapus saat kompilasi, bukan siklus runtime;
  test siklus impor repo lulus. Tindakan hanya bila salah satu
  mulai mengimpor nilai runtime dari yang lain.
- **AUD-019 · Akuntansi/POS.** Konvensi harga jual TERMASUK PPN
  konsisten: pendapatan dikredit = `subtotal − taxTotal`
  (`sales-persist.ts`), diskon contra terpisah, PPN keluaran =
  pajak terekstrak. Jurnal seimbang & laporan laba rugi konsisten
  (rantai A2-b).
- **AUD-020 · Akuntansi/Utang.** Kelebihan bayar utang tidak
  ditolak — menjadi kredit pemasok terbuka yang dapat dipakai
  pembayaran berikutnya (desain A-21 R3-02, terjurnal seimbang;
  rantai A2-a2).

---

## E. Database & Financial Integrity

Pemeriksa yang dapat diulang: `scripts/audit/db-integrity.sql`
(baca-saja, dijalankan terhadap DB hidup sebagai pemilik skema).

**Keuangan (A0, terverifikasi ulang pada gerbang final A5):**

| Pemeriksaan | A0 | A5 final |
|---|---|---|
| Jurnal posted tak seimbang (Σdebit ≠ Σkredit) | 0 | **0** |
| Jurnal posted tanpa baris | 0 | **0** |
| Jurnal posted total nol | 0 | **0** |
| Baris jurnal beda perusahaan dari header / akun lintas perusahaan | 0 / 0 | **0 / 0** |
| Nomor jurnal / penjualan / PO duplikat per perusahaan | 0 | **0** |

Posting jurnal melewati satu gerbang tunggal `postJournal`
(Graphify: degree 194 — payroll, utang, retur, impor, entri cepat
semua mengimpornya) yang menegakkan keseimbangan + periode terbuka;
jurnal terposting append-only, koreksi hanya via pembalik (rantai
A2-f/h membuktikan penolakan edit/void ganda & koreksi periode
tertutup lewat pembalik).

**Stok & HPP:** invarian `stock_on_hand = Σ stock_movements`
terpegang **0 selisih pada tenant hidup** di A0 dan A5 (cek G1);
stok negatif 0; valuasi AVCO (moving average) terbukti angka-demi-
angka pada rantai A2 (terima berkemasan → HPP per pcs 3.625;
retur membalik pada nilai baris asal). Pada A5, cek B1 global
menunjukkan 2 baris — keduanya terbukti milik perusahaan fixture
buangan tanpa organisasi (`…aa03`/`…aa05`, kolom tenant_hidup =
false) yang memang menulis stok awal uji secara langsung; bukan
milik tenant hidup.

**Relasi & skema:** 122 FK (semua satu kolom) — yatim **0 global**
sesudah perbaikan AUD-001/002 (cek D1; di A0 terdapat 47.941 baris
yatim milik fixture mati pada dua constraint, dan drill restore
gagal karenanya di A3). Drift skema Drizzle vs DB hidup **0**
(105/105 tabel, 0 kolom menyimpang; 292 index). Migrasi konsisten
tiga arah: 66 berkas = 66 jurnal meta = 66 baris DB, terakhir 0065.
RLS aktif + kebijakan pada **97/97 tabel bertenant** (99 kebijakan)
dan terbukti hidup sebagai `app_user` (A1: tanpa konteks 0 baris;
sisip lintas-tenant ditolak; ubah lintas-tenant 0 baris).

**Backup & recovery:** mekanisme backup berjalan (AUD-021
diperbaiki); **drill restore LULUS di A4 dan terverifikasi ulang
LULUS di gerbang final A5** — dump segar dipulihkan ke DB uji,
jumlah akun/produk/nilai persediaan/selisih neraca saldo cocok
persis sumber↔restore, DB uji dihapus. Residu fixture pasca-suite
di DB dev (3.430 baris milik perusahaan buangan tanpa organisasi
pada A5; datanya konsisten, D1 tetap 0) adalah artefak harness dev
dengan remediasi satu perintah
(`scripts/audit/cleanup-fixture-residue.sh`, backup wajib → hapus
satu transaksi → verifikasi) — bukan keadaan basis data produksi.

---

## F. Performance & Security

### Performa (A3 — `scripts/audit/bench-a3-volume.ts`, dapat diulang)

Dataset terukur pada mesin dev ini, satu perusahaan buangan:
10.000 produk · 25.000 penjualan · **100.000 baris penjualan** ·
50.000 baris jurnal · 10.000 baris stok (terbangun 7,31 dtk).

| Pengukuran (median domain, 5 larian) | Hasil |
|---|---|
| Daftar produk hal. 1 / pencarian teks | 5,7 ms / 42,2 ms |
| Pencarian POS q kosong / q teks | 4,7 ms / 30,7 ms |
| Valuasi persediaan hal. 1 | 97,2 ms |
| Daftar penjualan hal. 1 (25 rb dokumen) | 5,9 ms (index scan 0,1 ms) |
| Laba rugi / neraca saldo (50 rb baris jurnal) | 213 ms / 220 ms |
| Buku besar akun Kas hal. 1 (25 rb baris akun) | 335 ms |
| Halaman HTTP nyata (build produksi, hangat) | 0,04–0,63 dtk (laporan 0,46; buku besar 0,63) |
| 5 penjualan bersamaan, produk sama (stok 100, @3) | **5/5 berhasil; stok akhir tepat 85** — tanpa oversell, tanpa deadlock pada larian itu |

**Batas klaim yang jujur:** terukur hanya SATU perusahaan pada
volume itu di mesin dev. Belum terukur: 100 rb+ penjualan sebagai
dokumen, banyak perusahaan aktif bersamaan, beban tulis campuran
berkelanjutan, dan perangkat keras kelas produksi. Titik berat
terdaftar: pencarian teks tanpa indeks trigram (AUD-022) dan
permukaan laporan/buku besar (AUD-023) — keduanya wajar hari ini
dan terpantau, bukan penghalang.

### Keamanan

- **Otorisasi (A1):** 201/201 server action berpenjaga izin (198
  panggilan langsung + 3 helper izin-ganda; dua pengecualian
  bernama terverifikasi sah); 20 route API terpetakan — 11 ekspor
  berpenjaga tepat (payroll → `payroll.salary`), impor berbatas
  20MB/25.000 baris + whitelist + hash anti-duplikat, perangkat POS
  token-digest, health publik minimal by-design. Sesudah A4,
  bidang biaya ikut tergerbang level-field `inventory.cost`
  (AUD-013 FIXED).
- **Peran langsung (A3):** matriks 6 peran × fungsi lewat
  pemanggilan aksi/route sungguhan — **tidak ada satu pun LOLOS
  SALAH** (23/23 test); gerbang level-field `inventory.price`
  bekerja persis (gudang boleh rename, tidak boleh reprice).
- **Isolasi tenant (A1):** RLS hidup sebagai `app_user` — tanpa
  konteks 0 baris, sisip lintas-tenant ditolak kebijakan, ubah
  lintas-tenant 0 baris; jalur pra-tenant digest perangkat tetap
  sempit (migrasi 0060).
- **Injeksi (A3):** SQLi pada pencarian produk/pelanggan POS →
  0 baris & tabel utuh; XSS tersimpan pada nama produk/pelanggan →
  ter-escape pada render halaman nyata.
- **Autentikasi (A1):** pendaftaran publik mati; hash scrypt
  Better Auth; sesi 7 hari; rate limit sign-in eksplisit 10/60
  dtk; plugin 2FA terpasang; secret dari env tervalidasi Zod;
  produksi menolak URL auth localhost kecuali flag harness.
  Pemindaian rahasia ter-hardcode: bersih (satu-satunya temuan =
  kata sandi demo seed yang terdokumentasi publik).
- **Header & permukaan (A4):** header keamanan global + CSP
  konservatif terpasang & terbukti via HTTP nyata (AUD-014);
  throttle pairing desktop (AUD-015); error handling satu pintu
  `guard()` tanpa kebocoran pesan DB mentah (A1).
- **Sisa keamanan:** audit kerentanan dependensi **NOT VERIFIED**
  (AUD-004 — lingkungan; wajib CI berjaringan); kebijakan kata
  sandi minimum 8 < anjuran NIST ≥15 menunggu keputusan pemilik
  (AUD-018) dengan mitigasi rate limit + 2FA; CSP masih memakai
  'unsafe-inline' (pengetatan nonce = pekerjaan terpisah).

---

## G. Production Readiness Checklist

| Persyaratan | Status | Dasar bukti |
|---|---|---|
| Environment production | **PARTIAL** | Validasi env Zod menegakkan aturan produksi (start tanpa flag DITOLAK bila BETTER_AUTH_URL ber-host localhost pada NODE_ENV=production — terbukti A3); secret dari env, tidak ter-hardcode (A1). Hosting, TLS, dan variabel lingkungan mesin produksi adalah tanggung jawab deployment pemilik — tidak dapat diverifikasi dari repo/lingkungan audit |
| Database & migration | **PASS** | 66 migrasi konsisten berkas = meta = DB; drift skema 0; RLS 97/97 tabel bertenant terbukti hidup; aturan "migrasi terpasang tidak diedit" ditegakkan proses |
| Backup & recovery | **PASS** | Backup berjalan dari mesin operator tanpa PATH manual (AUD-021 FIXED); **drill restore dijalankan sungguhan & LULUS di A4 dan A5** (angka cocok sumber↔restore); status backup & drill tampil di Pengaturan → Status sistem. Catatan: salinan offsite/topologi 3-2-1 penuh adalah sisi deployment pemilik |
| Logging & monitoring | **PARTIAL** | Logger terstruktur pada jalur error (`guard()` mencatat error tak dikenal); endpoint `/api/health` minimal (status/db/tag migrasi); halaman Status sistem memuat kesehatan backup/drill. Belum ada integrasi pemantauan eksternal/APM/alerting yang terbukti di repo — keputusan deployment |
| Error handling | **PASS** | Satu pintu `guard()`: AppError diteruskan, 23505 dipetakan ke pesan ramah per constraint, ZodError diformat per baris, error tak dikenal → log + pesan generik; nol kebocoran pesan DB mentah ke klien (A1) |
| Keamanan | **PARTIAL** | Header keamanan global + CSP terpasang & terbukti HTTP (AUD-014); autentikasi & sesi terverifikasi; injeksi teruji bersih; throttle pairing. Menahan PASS penuh: audit kerentanan dependensi NOT VERIFIED (AUD-004) dan kebijakan kata sandi di bawah anjuran NIST menunggu keputusan pemilik (AUD-018) |
| Hak akses | **PASS** | 201/201 aksi berpenjaga; matriks peran langsung 23/23 tanpa lolos-salah; izin level-field (`inventory.cost`, `inventory.price`, `payroll.salary`) ditegakkan di server & terbukti dengan uji negatif (A1/A3/A4) |
| Performa | **PARTIAL** | Terukur memadai pada 10 rb produk / 100 rb baris penjualan / 50 rb baris jurnal di mesin dev (halaman 0,04–0,63 dtk; laporan 213–335 ms; konkurensi stok tepat). Batas terukur dinyatakan apa adanya; beban multi-perusahaan & perangkat keras produksi belum terukur (AUD-022/023 terpantau) |
| Konsistensi transaksi | **PASS** | 9 rantai integrasi + konsistensi laporan PASS dengan asersi angka (A2); idempotensi tepat sekali terbukti termasuk kirim ulang & gagal sinkron; invarian stok & jurnal 0 pelanggaran pada tenant hidup (A0/A5) |
| Regression test | **PASS** | Suite 2039 test + e2e 25 spec + penjaga arsitektur A-26 (ratchet, batas modul, read-paths) tidak dilemahkan; gerbang final A5 hijau (dengan catatan flake AUD-008 di bawah). Test tidak pernah dimatikan/dilemahkan demi meloloskan gerbang di seluruh program |

---

## H. FINAL VERDICT

### Gerbang final A5 (independen, dari reseed bersih, tanpa pipa)

| Gerbang | Hasil A5 | Baseline harapan |
|---|---|---|
| Reseed demo | exit 0 — 65 produk, nilai persediaan Rp28.349.600 | sama |
| Suite penuh — larian 1 | **2037/2039, exit 1** — 2 gagal, keduanya keluarga flake AUD-008: `AK-P3-03` payroll konkuren (pesan pihak kalah generik, kode CONFLICT & invarian terpegang) dan `POS-IDEM-01` balapan idempotensi (bentuk hasil pihak kalah di bawah kontensi); kedua berkas **lulus terisolasi 28/28** | 2039/2039 |
| Suite penuh — larian 2 | **2039/2039 (213 berkas), exit 0** | 2039/2039 ✓ |
| Typecheck | exit 0 | exit 0 ✓ |
| Lint | exit 0 — 0 error, 29 warning warisan | 0 error ✓ |
| Build produksi | exit 0 | exit 0 ✓ |
| E2E (saklar `BISA_E2E_RESEED=1`, urutan suite→e2e) | **25/25, exit 0** | 25/25 ✓ |
| db-integrity | exit 0 — semua cek pelanggaran **tenant hidup = 0** (A1–A5, B2–B4, C, D1, E, G1–G3); B1 global = 2, keduanya terbukti baris fixture buangan tanpa organisasi; F1 = 66 migrasi; R1 = 1 organisasi | 0 ✓ (dengan atribusi B1) |
| Backup + drill restore | backup exit 0; **drill LULUS exit 0** — jumlah akun/produk/nilai persediaan/selisih neraca saldo cocok sumber↔restore | LULUS ✓ |

Selisih dari baseline dilaporkan apa adanya: suite membutuhkan dua
larian karena flake balapan AUD-008 (terdaftar MONITOR sejak sebelum
A5; invarian data tidak pernah dilanggar olehnya), dan B1 global
membawa 2 baris fixture buangan yang teratribusi penuh. Tidak ada
selisih lain.

### Verdict: **CONDITIONAL GO**

**Berlaku untuk:** operasional minimarket lewat **aplikasi web**
(satu perusahaan/toko yang dioperasikan lewat web ERP & POS web),
dengan syarat tindak lanjut bernama di bawah dipenuhi/dijadwalkan
pemilik. Aplikasi POS **desktop belum termasuk** dalam verdict ini
sampai uji lapangannya selesai (syarat 2).

**Alasan (berbasis bukti):** tidak ada temuan P0; tidak ada cacat
P1/P2 yang terbuka — satu-satunya P1 (AUD-006) dan P2 fitur
(AUD-007) adalah fitur yang belum dibangun **atas keputusan
pemilik**, bukan cacat pada yang terbangun; seluruh cacat terbukti
(termasuk kebocoran bidang biaya AUD-013 dan residu yang
menggagalkan restore AUD-001/002) sudah diperbaiki dan
terverifikasi ulang. Integritas transaksi, stok, dan jurnal
terbukti di empat lapis independen (pemeriksaan DB langsung,
rantai integrasi berangkakan angka, matriks peran langsung, dan
gerbang final dari reseed bersih). NO GO tidak berdasar pada bukti
ini; GO tanpa syarat akan mengklaim dua hal yang belum terbukti —
kebersihan kerentanan dependensi dan kesiapan desktop di mesin
nyata.

**Syarat & tindak lanjut bernama:**

1. **AUD-004 (wajib sebelum deploy produksi):** jalankan
   `pnpm audit` di CI berjaringan penuh; advisori kritis/tinggi
   yang ditemukan harus ditangani atau diterima tertulis. Sekalian
   tinjau pin CDN `xlsx` (AUD-012).
2. **AUD-009 (wajib sebelum POS desktop dipakai operasional):**
   uji lapangan di mesin Linux desktop nyata — build installer,
   buka jendela, cetak ke printer ESC/POS fisik, pairing & keychain
   OS. Sampai lulus, jalur produksi kasir adalah POS web.
3. **Keputusan pemilik (jadwalkan atau terima sebagai risiko
   tercatat):** PIN supervisor POS (AUD-006, P1), QRIS dinamis via
   PSP (AUD-007, P2), kenaikan minimum kata sandi ke anjuran NIST
   untuk kata sandi baru (AUD-018), dan nasib scheduler
   `a24-lanjut-otomatis` (AUD-010).
4. **Tindak lanjut P3 berkala:** pantau keluarga flake balapan
   (AUD-008 — samakan bentuk error pihak kalah jalur idempotensi),
   indeks trigram pencarian bila katalog membesar (AUD-022),
   permukaan buku besar/laporan bila volume jurnal menuntut
   (AUD-023), dan bersihkan 29 warning lint warisan secara
   oportunistik (AUD-011).

---

*Program Audit Produksi A0–A5 ditutup dengan laporan ini. Register
temuan tetap hidup di `docs/audit/AUDIT-REGISTER.md` untuk tindak
lanjut syarat di atas; tidak ada pekerjaan audit yang dieksekusi
diam-diam di luar daftar ini.*
