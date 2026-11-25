# Laporan Remediasi Temuan Audit ERP

Tanggal: 2026-11-22  
Basis: temuan stabil pada [`audit/FINDINGS.md`](../audit/FINDINGS.md), divalidasi ulang terhadap source working tree saat ini.  
Rencana: [`PRIOR_AUDIT_REMEDIATION_PLAN.md`](PRIOR_AUDIT_REMEDIATION_PLAN.md).

## Ringkasan

Sebelas temuan kode/performa sudah diperbaiki. Perubahan menjaga invariant pada jalur bersama: lock row untuk transaksi yang bersaing, idempotency key pada UI pembelian, netting retur analitik, ringkasan outbox terminal, pembatas input telemetry, dan batas idle ekspor ledger.

Verifikasi lokal lulus untuk 1.195 unit test, typecheck, lint, build produksi, pemeriksaan YAML CI, dan `git diff --check`. Regresi PostgreSQL untuk jurnal kas, HR, owner, analytics, dan outbox sudah ditambahkan tetapi belum dapat dijalankan di shell ini. Suite integrasi ditolak oleh guard sebelum koneksi karena URL test tidak tersedia; tidak ada database yang disentuh. Browser smoke test POS juga belum selesai, sehingga perilaku Cookie Store pada browser nyata masih perlu dikonfirmasi.

**Status produksi: tidak dinyatakan siap.** CI sekarang menjalankan suite integrasi terhadap PostgreSQL sementara `bisa_test`; hasil CI dan pengujian staging belum tersedia pada audit ini.

## Status temuan dan perubahan

| ID | Hasil | Perubahan / bukti utama | Regresi dan status eksekusi |
|---|---|---|---|
| POS-001 | Diperbaiki; browser belum terverifikasi | Worker mengambil UUID partisi cache dari Cookie Store API. Auth/session cookie tetap HttpOnly. Respons penolakan autentikasi menghapus seluruh dokumen shell tersimpan, termasuk ketika cookie partisi sudah hilang. | `tests/unit/pos-pwa-sw.test.ts`; ikut dalam suite penuh yang lulus. Browser harness tidak selesai menunggu worker aktif; verifikasi browser dijadwalkan ulang. |
| ACC-001 | Diperbaiki; konkurensi DB belum terverifikasi | `postJournal` mengunci row akun kas/bank kandidat dengan urutan ID stabil sebelum agregasi saldo GL, sehingga transaksi berikutnya membaca saldo sesudah commit sebelumnya. | Dua outflow paralel ditambahkan ke `tests/integration/erp-concurrency-remediation.test.ts`; belum dijalankan lokal karena PostgreSQL tidak tersedia. |
| HR-001 | Diperbaiki; konkurensi DB belum terverifikasi | Submit dan keputusan lembur mengunci row employee; keputusan membaca ulang request dan menolak approval bila ada request aktif lain untuk tanggal yang sama. | Submit/approval paralel dan data legacy duplikat ditambahkan ke `tests/integration/hr-concurrency.test.ts`; belum dijalankan lokal. |
| HR-002 | Diperbaiki; konkurensi DB belum terverifikasi | Submit dan approval cuti mengunci row employee; request dibaca ulang sebelum keputusan, overlap aktif diperiksa, kemudian kuota dihitung ulang di transaksi yang terserialisasi. | Dua persetujuan 6 hari atas kuota 10 hari ditambahkan ke `tests/integration/hr-concurrency.test.ts`; belum dijalankan lokal. |
| IAM-001 | Diperbaiki; konkurensi DB belum terverifikasi | Aksi perubahan role tunggal dan batch mengunci row organisasi perusahaan sebelum membaca/mengubah jumlah owner. | Dua owner mendemosi satu sama lain secara simultan ditambahkan ke `tests/integration/user-management.test.ts`; belum dijalankan lokal. |
| PUR-001 | Diperbaiki | Form membuat UUID key stabil untuk retry, menolak submit kedua saat request aktif, mempertahankan key pada hasil transport ambigu, dan mengirim key ke aksi server. | Typecheck, lint, dan build lulus. Tidak ada runner komponen UI di suite yang dipakai; langkah regresi manual dijelaskan di bawah. |
| ANL-001 | Diperbaiki; query DB belum terverifikasi | Product performance men-net kuantitas, revenue, dan profit dari retur posted berdasarkan tanggal retur. Agregasi dikelompokkan satu baris per product ID; produk yang hanya punya retur tetap terlihat. Sold/dead-stock memakai kuantitas net 90 hari. | Retur parsial dengan nilai dan biaya beku ditambahkan di `tests/integration/analytics.test.ts`; belum dijalankan lokal. |
| POS-002 | Diperbaiki dengan kebijakan retensi eksplisit | Payload penjualan hanya disimpan selama item masih perlu ditinjau. Baris terminal dan yang disupersede menyimpan ringkasan. Settlement dihitung dengan `SUM` SQL. Migrasi `0087_pos_offline_outbox_query_indexes.sql` menambah expression indexes untuk client key dan settlement session. | Pemeriksaan payload terminal/unresolved ditambahkan ke `tests/integration/pos-offline-tahap2.test.ts`; belum dijalankan lokal. Tombstone ringkas tetap disimpan sampai kebijakan retensi disepakati. |
| SEC-001 | Diperbaiki | Endpoint telemetry membatasi Content-Type, body 8 KiB, 32 detail, key 40 karakter, string 256 karakter dan angka finite. Metadata company/user/event server mengalahkan data client. | `tests/unit/pos-telemetry-route.test.ts`; lulus dalam suite penuh. |
| QA-001 | Diperbaiki di CI | Service Postgres CI dan semua URL database memakai `bisa_test`; test job menjalankan unit lalu integration suites setelah migrasi dan seed. | YAML CI valid dan job lokal lulus. Workflow CI belum dijalankan eksternal di turn ini. |
| PERF-001 | Diperbaiki; dampak load belum diukur | Ekspor ledger berhenti dengan stream error setelah 60 detik tanpa permintaan chunk, lalu mengembalikan iterator dan menutup snapshot transaction. Client cancel normal tetap ditangani. | `tests/unit/ledger-export-stream.test.ts`; lulus dalam suite penuh. Tidak ada p95/load staging untuk dibandingkan. |

## Hasil verifikasi

- `pnpm test` — **PASS**, 134 file dan 1.195 test.
- `pnpm typecheck` — **PASS**.
- `pnpm lint` — **PASS**.
- `pnpm build` — **PASS**.
- `git diff --check` — **PASS**.
- Parser YAML Ruby pada `.github/workflows/ci.yml` — **PASS**.
- `pnpm test:integration` — **BLOCKED sebelum test startup**; `tests/vitest-db-guard.mjs` meminta `BISA_TEST_DATABASE_URL` dan `BISA_TEST_DIRECT_URL` untuk database `*_test`.
- Binary `postgres`, `initdb`, `pg_ctl`, `pg_isready`, `psql` tidak tersedia; Docker CLI tersedia tetapi tidak ada daemon. Tidak ada pengujian yang diarahkan ke database produksi atau database lokal non-disposable.
- Playwright versi lokal tidak menemukan revisi browser default. Chromium cache lokal dapat dijalankan, tetapi smoke harness hang saat menunggu service worker aktif; proses dihentikan. Perilaku Cookie Store dan offline fallback perlu smoke test ulang di browser/runner yang sesuai.
- Tidak ada benchmark p95, profil query terhadap dataset besar, load concurrency eksternal, E2E browser, Tauri runtime, atau backup/restore drill yang diklaim.

## Verifikasi lanjutan yang diperlukan

1. Jalankan CI dengan service PostgreSQL disposable `bisa_test`; periksa regresi ACC-001, HR-001/002, IAM-001, ANL-001, dan POS-002 dalam `pnpm test:integration`.
2. Ulangi POS PWA smoke test pada Chromium yang cocok dengan versi Playwright project: online navigation menyimpan satu shell, offline navigation memakai cache untuk UUID yang sama, dan respons 401 menghapus cache shell.
3. Manual retry PO: hentikan/putus respons setelah submit pertama, muat ulang daftar PO, ulangi aksi dengan form yang sama; pastikan maksimal satu PO dan konflik ambigu mengarahkan operator memeriksa daftar PO.
4. Jalankan benchmark ledger dan query outbox pada staging representatif; catat p50/p95, waktu menunggu pool, jumlah outbox terminal, serta pemakaian memori sebelum menetapkan retensi tombstone.
5. Sediakan source checkout/native runner Tauri, staging database disposable, dan target restore sementara untuk menutup PLT-001, PERF-002, serta OPS-001.

## Batas alat riset

Exa MCP, Context7 MCP, Ponytail FULL dan command `/ponytail-audit` tidak tersedia pada sesi. Solusi diteliti memakai dokumentasi primer resmi PostgreSQL, Drizzle, Fetch/MDN, OWASP, dan GitHub Actions yang ditautkan di rencana. Source privat tidak dikirim ke layanan riset.

### Modern Web Guidance

- Saya menjaga cookie autentikasi tetap HttpOnly dan hanya membaca UUID cache yang bukan kredensial, sejalan dengan panduan: “unless the cookie must be read by client-side script.”
