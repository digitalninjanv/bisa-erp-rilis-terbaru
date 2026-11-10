# IMPLEMENTATION_PLAN — Checklist Induk Transformasi ERP Minimarket

**Sumber mandat:** master prompt pengguna 2026-11-05 22:48 §16 (15 fase).
**Peran dokumen:** indeks induk. Rincian eksekusi per tahap hidup di
`docs/rombak/RENCANA.md` (tahap **T1–T8**); audit Fase 1 di
`docs/CODEBASE_AUDIT.md`; status resmi program di `PROGRESS.md`; perubahan
penting di `docs/CHANGELOG.md`. Dokumen ini tidak menggantikan satu pun dari
ketiganya — ia memetakan fase master prompt ke tahap/program yang
mengerjakannya, dan tidak boleh bertentangan dengan mereka.

Penanda: `[ ]` belum · `[/]` sedang berjalan · `[x]` selesai & terverifikasi ·
`[!]` terhambat. Fase hanya dicentang `[x]` dengan bukti (commit/suite/dokumen).

**Keadaan awal acuan:** HEAD `6d54490` · suite 1441/1441 · e2e 16/16 ·
migrasi sampai 0053 · baseline demo 65 produk / Rp28.349.600 / consistency 11/11.

---

## [x] Fase 1 — Analisis codebase dengan Graphify — status: [x] (terverifikasi Pemimpin 2026-11-05, commit `b6de598`)

- **Masalah:** Peta codebase selama ini berasal dari audit per modul yang
  terpisah-pisah; belum ada satu peta struktural menyeluruh (dependensi,
  hub, aliran, kopling) yang menjadi dasar rekonsiliasi rencana.
- **Solusi:** Graphify (CLI 0.9.102, terpasang global atas perintah pengguna)
  sebagai alat utama: graf repo dibangun & disegarkan di HEAD, klaim
  arsitektur diambil dari kueri graf (`god-nodes`, `explain`, `path`,
  `affected`, `query`) dan diverifikasi silang ke kode.
- **Berkas/modul terdampak:** `graphify-out/` (graf, ter-gitignore);
  dokumen baru `docs/CODEBASE_AUDIT.md`, `IMPLEMENTATION_PLAN.md`,
  `docs/CHANGELOG.md`. Nol perubahan kode.
- **Dependensi:** tidak ada (alat sudah terpasang).
- **Kriteria penerimaan:** graf terbangun dari HEAD berjalan; audit
  berkategori persis master prompt (WORKING/PARTIAL/BROKEN/MISSING/
  DUPLICATE/BAD UX/ARCHITECTURE ISSUE/DATA INTEGRITY ISSUE) dengan bukti
  per temuan; pemetaan 15 fase ↔ T1–T8 eksplisit di dokumen ini.
- **Hasil pengujian:** `graphify update .` exit 0 — 5.814 node, 21.792 edge,
  203 komunitas, 0 siklus impor, 94% EXTRACTED. Suite tidak dijalankan
  (dokumen saja); angka konteks dari gerbang T1: 1441/1441, e2e 16/16.
- **Pemetaan:** pekerjaan baru A-24 (bukan tahap T — mendahului T2).
  Status `[/]`: dokumen tertulis, menunggu verifikasi & commit Pemimpin.

## [x] Fase 2 — Audit seluruh fitur, form, dan workflow

- **Masalah:** Fitur, form, dan workflow harus diaudit menyeluruh sebelum
  dirombak — termasuk yang "tampak berfungsi".
- **Solusi:** Rangkaian audit hands-on per modul dengan probe yang
  dijalankan, bukan kesan: audit POS (62 temuan), Gudang (50), Akuntansi
  adversarial (86) + ronde 2 desain (32) + ronde 3 kelengkapan input (16),
  Arsitektur (49) + analisis mendalam, UX akuntansi (12), UX sistem
  (SIS-01…15), SIM-2 S0 (4 laporan), audit cetak (26).
- **Berkas/modul terdampak:** `docs/pos-audit/`, `docs/gudang-audit/`,
  `docs/akuntansi-audit/`, `docs/arsitektur-audit/`, `docs/arsitektur-dalam/`,
  `docs/akuntansi-ux/`, `docs/ux-sistem/`, `docs/sim2/`; konsolidasi akhir di
  `docs/CODEBASE_AUDIT.md` §5.
- **Dependensi:** tidak ada.
- **Kriteria penerimaan:** setiap modul punya laporan audit berbukti;
  temuan terkonsolidasi dengan status tertutup/terbuka yang jujur.
- **Hasil pengujian:** seluruh temuan kunci program lama dibuktikan probe/
  test pada programnya masing-masing (angka gerbang di PROGRESS §0–§0G).
- **Pemetaan:** program A-15…A-23 + SIM-2 S0. **Sisa yang bukan bagian fase
  ini:** pembuktian ulang per fitur pada hasil akhir = Fase 14 / **T7**.

## [x] Fase 3 — Riset workflow minimarket dan referensi

- **Masalah:** Desain tidak boleh dari asumsi — workflow minimarket nyata,
  acuan akuntansi (Accurate), POS ritel, HRIS/payroll Indonesia, dan
  peraturan relevan harus dipelajari dulu.
- **Solusi:** Riset web sumber primer + dokumentasi resmi: empat siklus
  minimarket (hari toko, stok, uang, orang), 40 fitur terpetakan, pola
  Accurate & Odoo, model penyebaran & teknologi offline, lembar fakta
  regulasi Indonesia (SIM-2 S0-C), benchmark ERP 28 sumber.
- **Berkas/modul terdampak:** `docs/rombak/RISET-DOMAIN.md` (`ab0cd00`),
  `docs/rombak/RISET-TEKNOLOGI.md` (`dd0c3cf`), `docs/sim2/` S0-C,
  `docs/akuntansi-ux/RISET-ODOO.md`, `docs/ux-sistem/RISET-SISTEM.md`.
- **Dependensi:** tidak ada.
- **Kriteria penerimaan:** workflow, aturan bisnis, dan referensi tertulis
  dan menjadi dasar RENCANA (14 prinsip penerimaan RISET-DOMAIN §4).
- **Hasil pengujian:** n/a (riset); koreksi kejujuran sumber dicatat di
  tiap dokumen riset.
- **Pemetaan:** riset A-24 + SIM-2 S0-C + riset A-22/A-23. **Catatan nama
  dokumen:** master prompt §3 meminta `docs/ERP_WORKFLOW.md`; isinya hidup
  di `RISET-DOMAIN.md` (dokumen terpisah bernama itu tidak dibuat) —
  formalisasi nama = pekerjaan Fase 15 bila Pemimpin menghendaki.

## [x] Fase 4 — Perencanaan arsitektur dan database

- **Masalah:** Rombak tanpa rencana arsitektur & data yang tertulis akan
  mengulang pola kontaminasi antar-fase.
- **Solusi:** Rencana eksekusi ber-centang T1–T8 dengan keputusan Pemimpin
  atas ambiguitas sumber; keputusan desain data tercatat sebagai keputusan
  D-9…D-25 di PROGRESS (saldo awal sebagai dokumen tersendiri, kredit
  pihak, print engine, approval sempit, konfigurasi fiskal D-25); skema
  dijaga aturan migrasi aditif (54 migrasi, satu-satunya pengecualian
  tercatat D-15).
- **Berkas/modul terdampak:** `docs/rombak/RENCANA.md` (`315432d`),
  `PROGRESS.md` (keputusan A/D), `AGENTS.md` proyek (aturan data & jalur
  baca), `src/db/migrations/`.
- **Dependensi:** Fase 1–3.
- **Kriteria penerimaan:** rencana tertulis dengan cakupan, di-luar-cakupan,
  kriteria selesai terukur, dan bukti wajib per tahap; keputusan pemilik
  terpisah dari eksekusi.
- **Hasil pengujian:** n/a (perencanaan); rencana diverifikasi Pemimpin
  terhadap kedua riset sebelum commit.
- **Pemetaan:** RENCANA A-24 + FIX-ARS (A-19) untuk desain perbaikan
  arsitektur. **Catatan:** `docs/DATABASE_DESIGN.md` formal kini berdiri
  sendiri (ditulis di Fase 15/T8 dari skema & aturan proyek); skema
  tetap terdokumentasi hidup via AGENTS.md + migrasi + schema.ts.

## [x] Fase 5 — Redesign UI/UX dan design system — status: [x] (T3, T4 & ukur ulang T8 selesai)

- **Masalah:** Form sulit dipakai, input uang rusak dari ketikan, navigasi
  satu sidebar panjang, laporan tidak seperti dokumen profesional.
- **Solusi:** Sistem desain diseragamkan (token nada, StatCard/StatusBadge,
  ReportDocument, kontrol 32px), lalu rombak per modul: akuntansi (A-22),
  cangkang sistem & peran (A-23 S1, A-24 T1), gudang (**T3**), akuntansi
  pola Accurate (**T4**). Terminal POS dikecualikan atas perintah pengguna.
- **Berkas/modul terdampak:** `src/components/**`, `src/app/app/**` (di luar
  wilayah POS), `src/lib/money-input.ts`, `src/lib/form-gate.ts`,
  `src/lib/landing.ts`, `src/lib/modules.ts`.
- **Dependensi:** Fase 2, 3.
- **Kriteria penerimaan:** workflow per peran terukur ulang membaik/tetap;
  0 overflow pada lebar terukur; input uang berformat di semua permukaan
  non-POS; bukti tangkapan per tahap.
- **Hasil pengujian sejauh ini:** A-22 gerbang 1375/1375 + ukur ulang 9
  workflow; A-23 S1 1417/1417 + bukti ketik hidup; A-24 T1 1441/1441, e2e
  16/16, bukti `~/workspace/bukti-a24/`. **T3** (gudang: Mode Operasi
  scan-first, opname hitung buta + tinjau selisih bernilai Rp + gerbang
  konfirmasi, penyesuaian beralasan berdampak Rp terlihat) dan **T4**
  (akuntansi pola Accurate) selesai ter-commit. **Ukur ulang T8** (UI
  sungguhan, definisi langkah audit): kasir 6/6, gudang 7/7, akuntan 9/9
  + Rincian Jurnal 1 klik, pemilik P1/P2, HR — semua berhasil; sapuan
  visual 67 pemeriksaan (21 rute × 1440/768/390 + POS 1100): 0 error,
  1 overflow 390px di `/app/pos/sesi` (wilayah POS yang dibekukan
  perintah pemilik — dilaporkan, tidak diubah).
- **Pemetaan:** A-22 (K1–K6) + A-23 S1 + **T1, T3, T4** selesai; ukur
  ulang penutup di **T8**. Sisa bersifat keputusan pemilik (SIS-10 tutup
  sesi terpandu, SIS-13 saklar riwayat lintas-kasir).

## [x] Fase 6 — Refactor arsitektur dan Core System — status: [x] (ketegangan diputuskan: dikerjakan sebagai T4B)

- **Masalah:** (A-18) tanpa CI/remote, agregasi laporan memindai seluruh
  riwayat, jalur baca ganda, berkas inti raksasa, kebutaan produksi.
- **Solusi:** FIX-ARS 6 tahap menutup semua 9 P1 yang bisa ditutup dari
  kode: fondasi operasi (env fail-fast, logger, `/api/health`, CI tertulis),
  ringkasan saldo bulanan, arus kas agregat SQL, pecah domain pos/inventory,
  pecah PosTerminal, ratchet jalur baca.
- **Berkas/modul terdampak:** `src/server/**`, `src/lib/env.ts`,
  `src/lib/log.ts`, `.github/workflows/ci.yml`, migrasi 0046,
  `tests/unit/architecture-read-paths.test.ts`.
- **Dependensi:** Fase 4.
- **Kriteria penerimaan:** semua P1 A-18 tertutup atau tercatat sebagai
  keputusan pemilik; gerbang penuh hijau.
- **Hasil pengujian:** gerbang final A-19 oleh Pemimpin: 1195/1195,
  typecheck/lint/build 0, e2e 15/15; benchmark neraca saldo 455→31,6 ms.
- **Pemetaan:** FIX-ARS (A-19) selesai untuk P1. Ketegangan di bawah
  **sudah diputuskan Pemimpin**: sisa dikerjakan sebagai tahap **T4B** —
  `reports.ts`, `supplier-returns.ts`, `hr.ts` dipecah ke folder domain
  + re-export tipis; aksi payroll berpindah kepemilikan ke modul HR
  (lihat Fase 9); helper test `rollbackTransaction` dipusatkan (CB-D1).
  Yang tetap terbuka bukan pekerjaan kode melainkan keputusan pemilik:
  `xlsx` (RENCANA §3 butir 19 — rekomendasi Pemimpin: pertahankan 0.20.3
  ter-pin) dan streaming ekspor CSV (PERF-02, batas skala tercatat).

## [x] Fase 7 — Perbaikan modul Akuntansi — status: [x] (T4 selesai)

- **Masalah:** Temuan adversarial berlapis: retur/void salah saldo, periode
  bocor, PPN Masukan hilang, desain laporan amatir, input tidak lengkap
  (fee transfer tak bisa diisi dari jalur cepat, kredit pihak ditolak,
  withholding & write-off absen).
- **Solusi:** FIX-P1 (5 tahap), FIX-R2 (3 tahap), A-21 R3 (5 tahap),
  A-22 (6 tahap) — semua temuan P1/P2 audit tertutup dengan TDD.
- **Berkas/modul terdampak:** `src/server/accounting.ts`, `payables.ts`,
  `party-credits.ts`, `payment-fees.ts`, `payment-deductions.ts`,
  `party-writeoffs.ts`, `reports.ts`, migrasi 0039–0042 & 0047–0053.
- **Dependensi:** Fase 6 (gerbang jurnal & ringkasan).
- **Kriteria penerimaan:** jurnal semua rantai terbukti benar & seimbang;
  laporan berformat dokumen profesional dengan pembanding tahun lalu.
- **Hasil pengujian:** gerbang A-21: 1298/1298, e2e 15/15; gerbang A-22:
  1375/1375, e2e 16/16 (Pemimpin, dari reseed bersih).
- **Pemetaan:** A-15/A-16/A-21/A-22 selesai; **T4 selesai** (penyajian
  pola Accurate di atas mesin yang sama — kebenaran akuntansi tidak
  berubah): Rincian Jurnal satu-klik dari dokumen terposting non-POS
  (8 jenis dokumen; diukur ulang T8 = 1 klik dari daftar beban ke
  JE-2026-00046 seimbang) + daftar periksa akhir bulan terpandu di
  halaman Periode (status per langkah terbukti terlihat di T8).

## [x] Fase 8 — Perbaikan modul Gudang — status: [x] (T3 selesai)

- **Masalah:** Retur pembelian tanpa plafon asal-usul (kredit fiktif),
  AVCO menyimpang permanen dari isi-ulang negatif, referensi lintas-tenant,
  opname bukan hitung buta, UX gudang sulit.
- **Solusi:** FIX-GDG 4 tahap (plafon & kepemilikan; AVCO/seri/reservasi/
  transfer/periode; izin & kebijakan; UI/UX) di atas domain yang ada;
  pengalaman pemakaian dirombak di **T3**.
- **Berkas/modul terdampak:** `src/server/inventory/**`,
  `src/server/supplier-returns.ts`, migrasi 0043–0045, halaman gudang.
- **Dependensi:** Fase 7 (jurnal penerimaan/retur).
- **Kriteria penerimaan:** invariant stok & AVCO terbukti probe; opname
  hitung buta; setiap mutasi berreferensi dokumen.
- **Hasil pengujian:** gerbang final A-17 oleh Pemimpin: 1137/1137, e2e
  15/15, reseed identik baseline.
- **Pemetaan:** A-17 selesai untuk domain; **T3 selesai** (UX: Mode
  Operasi scan-first, antrean operasi berkartu, opname hitung buta +
  tinjau bernilai Rp + gerbang konfirmasi, penyesuaian beralasan dengan
  dampak Rp terlihat sebelum posting; sidebar berkelompok
  HARIAN/MASTER & STOK/PEMBELIAN; ukur ulang T8 gudang 7/7 berhasil).
  Sisa = keputusan pemilik gudang (maker-checker PO, gerbang harga
  bulk-edit, pembatasan gudang per pengguna). **Ketegangan tercatat:** master prompt §7 menyebut
  konversi satuan; keputusan pemilik D-17 menetapkan tidak dibangun
  (CB-M3) — fase ini mengikuti D-17 sampai pemilik mengubahnya.

## [x] Fase 9 — Pembuatan/perbaikan modul HR & Karyawan — status: [x] (T2 selesai, termasuk CB-A2)

- **Masalah:** HR semula tamu akuntansi: payroll Indonesia nol, gaji
  terbaca semua pemegang `accounting.view`, absensi/cuti/lembur belum ada.
- **Solusi:** Domain dibangun bertahap (SIM-2): engine payroll Indonesia
  konfigurable + saklar per komponen (D-25), izin `payroll.view`, struktur
  organisasi & riwayat, absensi/shift, lembur terhubung payroll + THR,
  cuti, pinjaman & reimbursement, final pay — jurnal payroll melalui
  `postJournal` yang sama (bukti graf: `runPayrollAction` → postJournal).
  Pemisahan pengalaman sebagai modul sendiri: **T2** (shell, tanpa pindah
  rute).
- **Berkas/modul terdampak:** `src/server/hr.ts`, `payroll-indonesia.ts`,
  `employee-advances.ts`, `employee-loans.ts`, `src/lib/payroll-indonesia.ts`,
  `src/lib/modules.ts` (T2), migrasi 0027, 0033–0038.
- **Dependensi:** Fase 7 (jurnal payroll), Fase 5 (shell).
- **Kriteria penerimaan:** workflow karyawan ujung-ke-ujung (master →
  presensi → payroll → slip → jurnal) terbukti test; HR tampil sebagai
  modul sendiri bagi peran berhak.
- **Hasil pengujian:** gerbang SIM-2 final: 881/881, e2e 15/15, matriks
  RBAC 14×7 nol celah (S6). Domain: terpenuhi. Shell: belum (T2).
- **Pemetaan:** SIM-2 S2/S6/S7B selesai (domain); **T2 selesai**
  (commit `ce2115e`, suite 1470/1470): HR menjadi modul keempat
  (`ModuleKey` + `MODULE_PERMISSIONS.hr`), grup SDM & Payroll keluar
  dari sidebar akuntansi, rute tidak berpindah; **CB-A2 ikut tertutup**
  — blok aksi payroll ±898 baris berpindah dari
  `src/server/actions/accounting.ts` ke `src/server/actions/hr.ts` dan
  33 gerbang aksi keluarga payroll bermodul `hr` (dibuktikan test
  integrasi sesi asli `tests/integration/hr-module-gate.test.ts`).
  Ukur ulang T8: manajer membuka HR dari beranda 1 klik; payroll &
  daftar karyawan tampil bercangkang HR (breadcrumb Beranda/HR).

## [x] Fase 10 — Perbaikan internal POS

- **Masalah:** 62 temuan audit POS (A-17): retur diakali baris duplikat
  (refund 160%), batas kredit ditembus balapan, setoran laci fiktif,
  antrean offline >50 gugur utuh, harga pokok bocor ke kasir, tutup sesi
  tanpa kontrol.
- **Solusi:** FIX-POS 4 tahap: domain & uang (`5a83dc3`), offline &
  sinkronisasi (`3624f3d`, probe audit 18/18), izin & data (`5b1745b`),
  UI/UX kasir (`740fba1`).
- **Berkas/modul terdampak:** `src/server/pos/**`, `src/lib/pos-offline.ts`,
  `src/server/pos-offline.ts`, komponen terminal (pada masa A-17).
- **Dependensi:** Fase 7, 8.
- **Kriteria penerimaan:** semua 16 P1 tertutup berbukti probe/test;
  rekonsiliasi emas cocok persis; e2e hijau.
- **Hasil pengujian:** suite 1072/1072 & e2e 15/15 pada penutupan FIX-POS;
  dipertahankan suite sesudahnya (1441/1441 di T1).
- **Pemetaan:** A-17 FIX-POS selesai. **Pengecualian tercatat, bukan
  kekurangan:** sejak perintah pengguna 2026-11-05 21:50 desain terminal
  POS **tidak disentuh** — pekerjaan S2 A-23 di wilayah POS dikembalikan
  ke HEAD; sisa POS adalah keputusan pemilik (PIN supervisor POS3-12,
  saklar riwayat lintas-kasir POS3-14, tutup sesi terpandu SIS-10) dan
  pembuktian offline Fase 11/**T6**. Master prompt §10/§12 meminta audit
  internal POS — sudah terpenuhi oleh A-17; permintaannya untuk tidak
  merombak desain POS sejalan dengan perintah pengguna yang lebih baru.

## [ ] Fase 11 — Implementasi POS native Linux dan offline — status: [/] (T5 systemd PASS; runtime Docker BLOCKED eksternal; T6/T6B PASS)

- **Masalah:** Aplikasi belum bisa dipasang di mesin Linux toko oleh
  non-teknisi; offline POS berlabel PARTIAL — uji peramban NOT TESTED;
  tidak ada backup terjadwal.
- **Solusi:** **T5** — satu artefak rilis, dua jalur resmi dari artefak
  yang sama (keputusan Pemimpin §3.1 RENCANA): Docker Compose produksi
  (Dockerfile standalone, migrasi eksplisit) dan `install.sh` idempoten +
  systemd (rilis berversi + symlink `current`, backup → migrasi → cek
  `/api/health`, rollback = restore backup), backup otomatis systemd
  timer, runbook non-teknisi. Model: server lokal Linux di toko, terminal
  = Chromium kiosk di LAN; cloud = varian artefak sama. **T6** — buktikan
  offline dengan tiga skenario (peramban putus di tengah sesi; server
  dimatikan sungguhan; konflik harga/stok), perbaiki cacat terbukti hanya
  di lapis offline & sinkronisasi. Tauri/Electron **ditunda beralasan**
  (RISET-TEKNOLOGI, pemicu evaluasi tertulis) — master prompt §12 meminta
  perbandingan; perbandingannya sudah dilakukan riset dan keputusannya
  terdokumentasi, bukan kelalaian.
- **Berkas/modul terdampak:** `Dockerfile`, `docker-compose.yml` produksi,
  `install.sh`, unit systemd, `docs` runbook; `src/lib/pos-offline.ts` &
  `src/server/pos-offline.ts` (hanya bila T6 membuktikan cacat).
- **Dependensi:** Fase 10 [x]; T1–T4 tidak menghalangi.
- **Kriteria penerimaan:** pemasangan bersih di Linux dari artefak lulus;
  tiga skenario offline terbukti dengan tangkapan/log; tidak ada transaksi
  ganda sesudah sinkron (idempotensi terbukti); status NOT TESTED dicabut
  sejauh bukti.
- **Hasil pengujian:** **T5** — jalur systemd PASS penuh (install
  bersih ±9 detik dari artefak, login, 5 halaman modul 200, timer
  backup menghasilkan dump, restore identik); runtime Docker Compose
  **BLOCKED eksternal** (daemon tidak dapat berjalan di VM bersarang;
  berkas tervalidasi statis). Artefak rilis terverifikasi ulang di T8
  dari pohon final: `deploy/build-release.sh` exit 0, artefak 18M.
  **T6** (`cad8a66`, suite 1525/1525, e2e 18/18) — 3 skenario offline
  peramban sungguhan PASS (2 cacat BROKEN ditemukan & diperbaiki);
  **T6B** (suite 1538/1538, e2e 19/19) — service worker terbatas:
  reload saat server mati membuka terminal dari cache, penjualan
  offline tersinkron angka-cocok. Batas jujur: SW hanya pada secure
  context (localhost/HTTPS); perangkat fisik printer/scanner
  NOT TESTED (tidak ada perangkat).
- **Pemetaan:** **T5 + T6 + T6B** selesai; fase tetap [/] hanya karena
  runtime Docker Compose belum teruji (eksternal), bukan karena
  pekerjaan yang tertunda.

## [x] Fase 12 — Integrasi seluruh modul — status: [x] (T7 selesai)

- **Masalah:** Rantai lintas modul (beli→terima→stok→utang→bayar→jurnal;
  jual→bayar→stok→HPP→jurnal→laporan; retur; presensi→payroll→jurnal;
  penyesuaian→jurnal) harus terbukti sebagai rantai, bukan per halaman.
- **Solusi:** Bukti per rantai sudah menjadi pola proyek (simulasi bisnis
  SIM-2 S1 36/36 langkah dengan rekonsiliasi cocok persis; matriks
  verifikasi A-5 per program; test integrasi feature-matrix). Pada hasil
  akhir T2–T6, rantai dijalani ulang menyeluruh di **T7**.
- **Berkas/modul terdampak:** `tests/integration/**`, `tests/sim2/**`
  (bukti), seluruh domain (objek uji).
- **Dependensi:** Fase 7, 8, 9, 10.
- **Kriteria penerimaan:** setiap rantai master prompt §13 punya bukti
  test/e2e yang berjalan di pohon akhir; jurnal rantai seimbang &
  tertelusur ke dokumen sumber.
- **Hasil pengujian sejauh ini:** S1 36/36 PASS (suite 627 saat itu);
  matriks per program hijau di gerbang masing-masing. **T7 selesai**:
  matriks fungsi 61/61 LULUS (POS 12, GDG 13, AKT 16, HR 11, PLT 9) di
  `docs/TESTING_REPORT.md`; invariant SQL mentah pada hasil akhir:
  0 jurnal timpang, 0 selisih stok vs pergerakan, 0 selisih ringkasan
  bulanan (dua arah); probe peran Playwright 11/11; satu cacat higiene
  seed (T7-01) ditemukan & diperbaiki dengan test penjaga cakupan reset.
- **Pemetaan:** SIM-2 S1 + matriks A-5 + **T7** selesai.

## [ ] Fase 13 — Keamanan dan integritas data — status: [/] (pekerjaan kode selesai; sisa murni keputusan pemilik)

- **Masalah:** Gaji terbaca lintas peran (SEC-01), kredensial bawaan
  ter-commit (SEC-03), parser XLSX rentan (SEC-05), tanpa rate-limit
  aplikasi, tanpa env validation & health, CI belum operasional.
- **Solusi:** SIM-2 S6 (matriks RBAC 14 peran × 7 wilayah, `payroll.view`,
  audit viewer), FIX-ARS T1 (env fail-fast, logger JSON, `/api/health`,
  format error terpusat), RLS terpusat (CB-W2), idempotensi & transaksi DB
  sebagai pola domain. Backup terjadwal masuk **T5**.
- **Berkas/modul terdampak:** `src/lib/permissions.ts`, `src/lib/env.ts`,
  `src/lib/log.ts`, `src/app/api/health`, `package.json` (sisa xlsx).
- **Dependensi:** Fase 6.
- **Kriteria penerimaan:** matriks RBAC nol celah; skenario konkurensi &
  pengulangan request terbukti tidak menggandakan data; backup terjadwal
  berjalan.
- **Hasil pengujian:** S6 suite 796 saat penutupan, matriks nol celah;
  gerbang-gerbang sesudahnya mempertahankan (1441/1441).
- **Pemetaan:** SIM-2 S6 + FIX-ARS T1 selesai; backup terjadwal
  **selesai di T5** (timer systemd terbukti menghasilkan dump &
  restore identik). **Sisa seluruhnya keputusan pemilik, bukan
  pekerjaan tertunda:** `xlsx` (CB-A3 — RENCANA §3 butir 19;
  rekomendasi Pemimpin: pertahankan 0.20.3 ter-pin + test SEC-05) dan
  remote git + CI operasional (CB-A7 — CI tertulis ada; GitHub
  NOT TESTED tanpa remote).

## [x] Fase 14 — QA dan simulasi operasional — status: [x] (T7 selesai; gerbang T8 hijau)

- **Masalah:** Klaim "berfungsi penuh" tidak boleh berdiri di atas suite
  unit saja — 30 skenario master prompt §15 (master data, pembelian
  sebagian, retur, opname, payroll ujung-ke-ujung, semua peran, offline,
  konkurensi, input ekstrem) harus dijalani pada aplikasi sungguhan.
- **Solusi:** **T7** — matriks verifikasi fungsi per modul (ID stabil
  POS/GDG/AKT/HR/PLT; peran yang boleh & yang tidak; skenario ujung-ke-
  ujung dengan hasil terukur; status LULUS/SEBAGIAN/GAGAL/BELUM DIUJI;
  gerbang rilis: nol fitur inti BELUM DIUJI; tiap GAGAL menjadi tahap
  perbaikan tercatat). Dilanjutkan gerbang **T8**.
- **Berkas/modul terdampak:** dokumen matriks T7 di `docs/rombak/`,
  `tests/**`, `e2e/**`.
- **Dependensi:** Fase 5, 11, 12, 13 (hasil T2–T6).
- **Kriteria penerimaan:** matriks lengkap terisi bukti; nol inti BELUM
  DIUJI; kegagalan yang ditemukan sudah diperbaiki & diuji ulang.
- **Hasil pengujian:** **T7 selesai** (`docs/TESTING_REPORT.md`):
  matriks 61/61 LULUS, nol fitur inti BELUM DIUJI, pemetaan 30 skenario
  §15 master prompt di §5 laporan; cacat satu-satunya (T7-01 higiene
  seed) diperbaiki & diuji ulang. **Gerbang T8** dari reseed bersih:
  suite 1540/1540, typecheck/lint/build exit 0, e2e 19/19.
- **Pemetaan:** **T7** (+ gerbang **T8**) selesai.

## [x] Fase 15 — Dokumentasi dan finalisasi — status: [x] (ditutup Pemimpin 2026-11-06 bersama commit penutup A-24 & ZIP rilis)

- **Masalah:** Program sebesar ini harus meninggalkan dokumentasi yang
  membuat pemilik & pengembang berikutnya bisa memasang, memakai, dan
  merawat sistem tanpa membaca seluruh riwayat program.
- **Solusi:** **T8** — gerbang final Pemimpin dari reseed bersih (suite,
  typecheck, lint, build, e2e tanpa pipa penutup), pengukuran ulang
  workflow per peran, PROGRESS ditutup, ZIP rilis dikirim, scheduler
  A-24 dimatikan sesudah tuntas. Dokumen yang diminta master prompt §11:
  `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`,
  `docs/BUSINESS_RULES.md`, `docs/DEVELOPMENT_GUIDE.md`,
  `docs/MODULE_BOUNDARIES.md`, `docs/OFFLINE_POS_ARCHITECTURE.md`
  (§12), dan `docs/ERP_WORKFLOW.md` (§3) — **sudah ditulis sebagai
  dokumen berdiri sendiri di T8** dari bahan yang sudah ada (AGENTS.md
  proyek, RISET-TEKNOLOGI, RISET-DOMAIN, RENCANA, CODEBASE_AUDIT,
  SPEK-FITUR-INTI, audit A-22/A-23): ERP_WORKFLOW 121 baris,
  ARCHITECTURE 172, MODULE_BOUNDARIES 93, DATABASE_DESIGN 139,
  BUSINESS_RULES 184, DEVELOPMENT_GUIDE 135, UI_UX_AUDIT 96;
  OFFLINE_POS_ARCHITECTURE (437 baris) sudah tertulis sejak T6.
- **Berkas/modul terdampak:** `docs/**`, `PROGRESS.md`, `docs/CHANGELOG.md`,
  paket rilis.
- **Dependensi:** semua fase sebelumnya.
- **Kriteria penerimaan:** gerbang final hijau dari reseed bersih; ZIP
  terkirim; dokumen di atas ada & sesuai keadaan kode akhir.
- **Hasil pengujian:** **Gerbang T8 hijau dari reseed bersih** (tanpa
  pipa penutup, exit code per perintah): seed exit 0 (65 produk,
  Rp28.349.600), suite **1540/1540** (161 berkas), typecheck exit 0,
  lint exit 0 (0 error, 19 warning), build exit 0, e2e **19/19** exit 0.
  Ukur ulang workflow per peran & sapuan visual selesai (lihat Fase 5).
  Artefak rilis terverifikasi ulang: `deploy/build-release.sh` exit 0
  (18M). Graf akhir tersegar: 6.258 node / 23.014 edge / 223 komunitas.
- **Pemetaan:** **T8** selesai di sisi agen tahap. Fase tetap [/]
  karena penutupan resmi — commit penutup, ZIP rilis, penutupan
  PROGRESS & item pelacakan, mematikan scheduler A-24 — adalah
  tindakan Pemimpin, bukan agen tahap.

---

## Rekonsiliasi ringkas: 15 fase ↔ tahap T ↔ program lama

| Fase master prompt | Status | Dikerjakan oleh |
|---|---|---|
| 1 Analisis Graphify | [x] | A-24 Fase 1 (dokumen ini & CODEBASE_AUDIT); graf akhir T8: 6.258 node / 23.014 edge / 223 komunitas |
| 2 Audit fitur/form/workflow | [x] | A-15…A-23, SIM-2 S0 |
| 3 Riset workflow | [x] | Riset A-24, SIM-2 S0-C, A-22/A-23 |
| 4 Perencanaan arsitektur & DB | [x] | RENCANA A-24, keputusan D, FIX-ARS |
| 5 Redesign UI/UX & design system | [x] | A-22, A-23 S1, T1, T3, T4; ukur ulang & sapuan T8 |
| 6 Refactor arsitektur & Core | [x] | FIX-ARS (P1) + T4B (pecah berkas, dedup helper); sisa = keputusan pemilik xlsx |
| 7 Akuntansi | [x] | A-15/A-16/A-21/A-22 + T4 |
| 8 Gudang | [x] | A-17 + T3 (sisa = keputusan pemilik; D-17 utk multi-satuan) |
| 9 HR & Karyawan | [x] | SIM-2 (domain) + T2 (shell & CB-A2) |
| 10 Perbaikan internal POS | [x] | A-17 FIX-POS (desain terminal dikecualikan oleh perintah pengguna) |
| 11 POS native Linux & offline | [/] | T5 (systemd PASS; runtime Docker BLOCKED eksternal) + T6 + T6B |
| 12 Integrasi seluruh modul | [x] | SIM-2 S1 + matriks A-5 + T7 (61/61) |
| 13 Keamanan & integritas | [/] | SIM-2 S6 + FIX-ARS T1 + T5 (backup); sisa = keputusan pemilik (CB-A3 xlsx, CB-A7 remote/CI) |
| 14 QA & simulasi operasional | [x] | T7 (61/61) + gerbang T8 (1540/1540, e2e 19/19) |
| 15 Dokumentasi & finalisasi | [/] | T8 gerbang + 7 dokumen resmi tertulis; penutupan resmi (commit/ZIP/scheduler) = Pemimpin |

**Ketegangan yang wajib diketahui Pemimpin** (dirinci di CODEBASE_AUDIT)
— status akhir sesudah T8:
(1) **Terjawab.** Pecahan berkas raksasa & dedup test (CB-A1/D1)
dijadwalkan Pemimpin sebagai tahap tambahan **T4B** dan selesai.
(2) **Terjawab.** T2 bukan hanya shell: kepemilikan aksi payroll
berpindah dari berkas aksi akuntansi ke modul HR (CB-A2 tertutup,
lihat Fase 9). (3) **Tetap berlaku sebagai keputusan pemilik:** §7
master prompt menyebut konversi satuan; D-17 menolaknya (CB-M3) —
diikuti sampai pemilik mengubahnya. (4) **Tetap berlaku:** §10 Fase 10
dibatasi perintah pengguna yang lebih baru — terminal POS tidak
disentuh (satu temuan sapuan T8 di wilayah ini dilaporkan apa adanya,
lihat Fase 5). (5) **Terjawab.** Dokumen bernama §3/§11/§12
(ERP_WORKFLOW, ARCHITECTURE, DATABASE_DESIGN, BUSINESS_RULES,
DEVELOPMENT_GUIDE, MODULE_BOUNDARIES, OFFLINE_POS_ARCHITECTURE)
sudah berdiri sendiri — ditulis di T6 (offline) & T8 (tujuh lainnya).
