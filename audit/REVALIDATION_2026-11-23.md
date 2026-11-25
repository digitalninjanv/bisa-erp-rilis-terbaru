# Revalidasi Sistem ERP — 23 November 2026

> **Addendum (later on 2026-11-23):** an isolated PostgreSQL fixture was subsequently made available and targeted integration suites were executed. Current evidence: accounting 96/96, warehouse 124/124, POS 140/143 (1 receipt-token regression + 2 fixture-state failures), PWA E2E 8/9. The earlier statement below that integration tests were blocked is superseded. The cash-guard race (ACC-001) was **not reproduced** in an isolated probe; the shared test failure was caused by fixture cash from earlier tests. See [COVERAGE.md](COVERAGE.md), [FINDINGS.md](FINDINGS.md), and [modules](modules/) for the current record. **All findings in this file were fixed/closed on 2026-11-23**, including SEC-002 (production seed guard), PLT-001 (Tauri retired), CORE-02 (module gates), SEC-003 (CI security job), POS-002 (retention CLI) and PERF-001 (export cap). The current ledger additionally records POS-005/POS-006/WH-001/DATA-001/QA-002/QA-003/HR-003/TXN-001 as fixed or closed.

## Putusan

**Belum dapat dinyatakan bebas bug, siap produksi, atau sesuai standar internasional.** Pemeriksaan lokal saat ini lulus untuk unit test, lint, typecheck, build, audit dependency, dan konsistensi metadata migrasi. Namun, ditemukan satu bypass kontrol modul yang masih ada, risiko kredensial owner demo yang dapat dipakai pada deployment, serta jalur rilis Tauri yang tidak memiliki source/config di working tree. Validasi transaksi PostgreSQL, E2E browser, backup/restore, dan load produksi belum terlaksana.

Ini adalah revalidasi terhadap working tree sekarang dan temuan remediasi sebelumnya, bukan sertifikasi independen atau bukti bahwa semua perilaku ERP sudah benar.

## Basis dan batas validasi

- HEAD: `6140f97`.
- Sebelum laporan revalidasi ini dibuat, working tree sudah tidak bersih: 128 file modified, 58 deleted, 38 untracked. Hasil di bawah berlaku untuk snapshot working tree itu, bukan otomatis untuk commit yang sudah dirilis. Audit ini hanya menambah/memperbarui dokumen di `audit/`, bukan source aplikasi.
- Tidak ada `BISA_TEST_DATABASE_URL` / `BISA_TEST_DIRECT_URL`; `psql` dan PostgreSQL lokal tidak tersedia, dan Docker daemon tidak aktif. Guard integration test berhenti sebelum test menyentuh database.
- Tidak ada staging, database dengan data representatif, printer, atau target pemulihan disposable. Tidak dilakukan benchmark aplikasi, query plan, load test, backup/restore, atau pengujian terhadap produksi.
- Revalidasi menggunakan inventaris dan laporan modul yang telah ada, memeriksa ulang area remediasi dan gap berisiko tinggi, lalu menjalankan pemeriksaan repository yang aman. Ini bukan penelusuran runtime ulang atas setiap halaman dan aksi.
- Ponytail FULL, skill/command `/ponytail-audit`, Exa MCP, dan konektor Context7 tidak tersedia pada sesi. Skill Context7 lokal tersedia, tetapi tool `resolve-library-id` / `query-docs` tidak ada. Tidak ada hasil dari tool tersebut yang diklaim. Pemeriksaan dokumentasi memakai sumber resmi yang ditautkan di bawah; source repository tidak dikirim ke layanan riset.
- Semgrep CLI tersedia tetapi tidak ada rulepack/config lokal. Pemindaian otomatis tidak dijalankan karena konfigurasi `auto` mengambil aturan dari registry dan source privat tidak dikirim ke layanan eksternal. `gitleaks`, Trivy, dan osv-scanner tidak tersedia.

## Pemeriksaan yang dijalankan

| Pemeriksaan | Hasil | Arti dan batas |
|---|---|---|
| `pnpm test` | **PASS — 134 file, 1.195 test** | Unit test saja; tidak membuktikan transaksi atau constraint PostgreSQL. |
| `pnpm typecheck` | **PASS** saat dijalankan lagi setelah build selesai | Percobaan paralel pertama berbenturan dengan regenerasi `.next/types` oleh build dan gagal mencari `routes.js`; typecheck bersih setelah build. |
| `pnpm lint` | **PASS** | ESLint statis. |
| `pnpm build` | **PASS** | Build Next.js berhasil; tidak menjalankan smoke test deployment. |
| `pnpm audit --prod` dan `pnpm audit` | **PASS — no known vulnerabilities found** | Tidak menemukan advisory yang diketahui pada graph dependency saat dijalankan; ini bukan hasil audit source atau jaminan bebas CVE mendatang. |
| `pnpm exec drizzle-kit check` | **PASS** | Metadata migrasi lolos pemeriksaan; migrasi tidak diterapkan ke database. Tree saat ini sudah berisi `0087_pos_offline_outbox_query_indexes.sql`. |
| `git diff --check` | **PASS** | Tidak ada whitespace error pada diff. |
| `pnpm test:integration` | **BLOCKED sebelum test startup** | Guard mewajibkan database khusus `*_test`; tidak ada database yang disentuh. |
| `pnpm exec playwright test --list` | **66 test pada 24 file terdaftar** | Hanya enumerasi; tidak ada browser journey yang dijalankan. |
| `pnpm tauri info` | **PASS sebagai pemeriksaan environment saja** | Bukan build native. Source Rust dan config Tauri tidak ada di working tree. |

Workflow CI sekarang memang memanggil `pnpm test:integration`, tetapi hasil run GitHub Actions tidak tersedia untuk audit ini. Waktu unit test dan build bukan metrik latency produk. Tidak ada p50/p95/p99, query latency, pool wait, RSS/CPU, request count, atau concurrency benchmark.

## Cakupan modul pada revalidasi

Rujukan inventaris dan alur sebelumnya: [Module Inventory](MODULE_INVENTORY.md) dan [Workflow Coverage](WORKFLOW_COVERAGE.md). Keduanya perlu dibaca bersama addendum ini; inventaris lama menyebut migrasi terakhir `0086`, sementara working tree saat ini sudah memiliki `0087`.

| Area | Yang diperiksa sekarang | Status runtime |
|---|---|---|
| POS online, cart, pembayaran, retur, sesi, stok dan jurnal | Status perbaikan sebelumnya ditinjau; unit suite penuh lulus. | Checkout, retur, rekonsiliasi kas dan concurrency PostgreSQL belum dijalankan. |
| POS offline/PWA | Worker memakai cookie UUID cache non-otorisasi; batas telemetry dan ringkasan outbox terlihat di source; migrasi index lolos `drizzle-kit check`. | Browser smoke, sinkronisasi database, settlement, dan retensi jangka panjang belum dijalankan. |
| Akuntansi/keuangan | Row lock penjaga saldo kas/bank ditinjau; alur jurnal lama tetap melalui `postJournal`. | Tes dua outflow paralel dan rekonsiliasi ledger tidak berjalan tanpa PostgreSQL. |
| Inventory/gudang/purchasing | Kunci idempotensi PO ditinjau; alur outbox dan index diinspeksi. | Receipt, transfer, retur supplier, stock race, dan retry PO belum diuji pada database. |
| HR/payroll | Lock karyawan dan pemeriksaan ulang cuti/lembur ditinjau. | Kuota dan approval race test belum berjalan. Kepatuhan payroll perlu telaah kebijakan/statutori pelanggan. |
| Analytics/reporting | Netting retur dan produk yang hanya memiliki retur ditinjau. | Integration untuk retur dan dataset besar belum dijalankan. |
| Import/export | Input limit dan aksi import/reconciliation/uang muka diperiksa. | Negative authorization dan alur import round-trip belum dijalankan; ada temuan CORE-02 di bawah. |
| Users, roles, settings, tenant/RLS | Lock owner dan source gate ditinjau; audit dependency lulus. | RLS/grants yang benar-benar terpasang, session, serta role race belum diverifikasi pada DB live/test. |
| Desktop POS dan operasi | Workflow release Tauri, backup, deploy, dan CI diperiksa statis. | Build Tauri, printer, updater, deploy, backup/restore drill tidak dijalankan. |

## Temuan dan risiko tersisa

### SEC-002 — Seed dapat membuat akun owner dengan kredensial demo publik

- **Severity / priority:** High / P1 bila seed dipakai pada environment produksi.
- **Confidence:** Strong Evidence; jalur aplikasi di bawah kondisi deployment itu tidak dijalankan.
- **Lokasi:** `src/db/seed.ts:37, 269-295, 939-943`; `docs/DEPLOY.md:49-54`; `e2e/helpers.ts:3-4`.
- **Reproduksi aman:** pada database kosong, ikuti langkah opsional “Seed demo” di deployment checklist. Seed membuat user demo dengan `emailVerified: true`, role `owner`, dan password tetap yang juga ada di fixture E2E. Jangan lakukan ini di database produksi.
- **Expected:** seed produksi ditolak atau akun bootstrap mendapat secret unik sekali pakai dan wajib diganti sebelum akses normal.
- **Actual:** script tidak memeriksa environment/database agar hanya local/test; akun dengan kredensial tetap dibuat dan nilainya dicetak ke log. Checklist deployment mengizinkan seed demo lalu langsung meminta login owner tanpa langkah wajib rotasi password.
- **Root cause:** seed demo menggunakan password konstan dan tidak memiliki fail-closed guard untuk `NODE_ENV`, host, atau nama database; proses test memiliki guard database terpisah, tetapi guard itu tidak melindungi seed CLI.
- **Dampak:** bila operator menggunakan seed pada instalasi yang dapat diakses publik dan tidak mengganti password, siapa pun yang mengetahui kredensial fixture dapat login sebagai owner pada tenant seed.
- **Minimal fix:** larang seed pada production secara default sebelum koneksi/query; pindahkan password ke secret test-only yang acak dan jangan cetak nilainya; jika bootstrap produksi diperlukan, buat token/password sekali pakai dan paksa perubahan sebelum operasi normal. Tambahkan instruksi rotasi eksplisit di deploy checklist.
- **Verifikasi:** uji bahwa seed menolak `NODE_ENV=production` / database non-test tanpa menyentuh data; tes positif hanya pada database disposable; pastikan kredensial fixture tidak dapat login pada build produksi.
- **Kompleksitas:** rendah–sedang.

> Nilai password tidak disalin ke laporan ini. Kode dan dokumen menyimpannya sebagai kredensial demo publik.

### CORE-02 — Aksi server melewati switch modul perusahaan

- **Severity / priority:** Medium / P2.
- **Confidence:** Confirmed dari jalur source; tidak dieksekusi terhadap DB karena environment integration tidak tersedia.
- **Lokasi:** `src/server/actions/import/commit.ts:47-53`; `src/server/actions/import/analyze.ts:25-35`; `src/server/actions/bank-reconciliation.ts:25-50,64-90,108-120`; `src/server/actions/inventory/uang-muka.ts:22-50,76-83`; perbandingan helper `src/lib/session.ts:224-230`.
- **Reproduksi:** perusahaan menonaktifkan modul Gudang/Akuntansi tetapi pengguna tetap memegang permission `import.manage`, `accounting.manage`, atau `accounting.post`; panggil Server Action langsung dari tab lama/HTTP.
- **Expected:** operasi untuk modul yang dinonaktifkan ditolak sebelum membaca atau mengubah data.
- **Actual:** aksi yang tercantum hanya memanggil `requirePermission(...)`. Helper `requirePermissionInModule(...)` menambah pemeriksaan `assertModuleEnabled`, tetapi aksi ini tidak memanggil helper tersebut.
- **Root cause:** aksi-aksi tersebut tertinggal saat gate switch modul dipindahkan ke batas server-action.
- **Dampak:** pengguna dengan permission masih dapat menjalankan import, rekonsiliasi bank, atau perubahan uang muka ketika modul bersangkutan sedang dinonaktifkan dari UI/perusahaan.
- **Minimal fix:** gate setiap action pada modul yang benar; untuk import, pilih gate berdasarkan entity sebelum mutasi. Perbarui mock permission dan tes.
- **Verifikasi:** test langsung action dengan permission yang benar tetapi `enabledModules` tidak berisi Gudang/Akuntansi; pastikan 403/FORBIDDEN dan tidak ada write.
- **Kompleksitas:** sedang.

Next.js menyebut Server Actions sebagai endpoint HTTP publik yang tetap harus memeriksa autentikasi/otorisasi di setiap action ([Data Security](https://nextjs.org/docs/app/guides/data-security), [Authentication](https://nextjs.org/docs/app/guides/authentication)). Aksi ini memiliki permission check, tetapi tidak memenuhi kebijakan module switch aplikasi.

### PLT-001 — Workflow rilis POS desktop merujuk source Tauri yang hilang dari checkout

- **Severity / priority:** High / P1 bila POS Tauri masih merupakan target rilis.
- **Confidence:** Strong Evidence; workflow build release tidak dijalankan.
- **Lokasi:** working tree menandai 21 path `src-tauri/**` sebagai deleted; contoh dependensi yang masih aktif: `package.json:28,61-62`, `.github/workflows/pos-desktop-release.yml:31-56,61-69`, dan UI native di `pos-desktop/`.
- **Reproduksi:** jalankan workflow `pos-desktop-release` dari commit yang memuat penghapusan saat ini. Matriks Linux/Windows meminta config `src-tauri/tauri.linux.conf.json` dan `src-tauri/tauri.windows.conf.json`, serta Cargo workspace `src-tauri`.
- **Expected:** workflow menghasilkan installer dan artefak update yang ditandatangani.
- **Actual yang dapat dibuktikan saat ini:** konfigurasi dan Rust project tidak tersedia pada working tree. Build tidak dicoba karena akan menulis artefak; karena itu kegagalan workflow adalah prediksi kuat, bukan hasil run.
- **Root cause:** native project dihapus sementara workflow release, dependensi Tauri, dan frontend Tauri tetap ada.
- **Dampak:** rilis POS desktop tidak bisa diverifikasi dan kemungkinan tidak menghasilkan installer/update.
- **Minimal fix:** pulihkan source Tauri yang tepat dan audit konfigurasi/CSP/update signature; bila produk native sudah dihentikan, hapus jalur release dan klaim integrasi yang tidak dipakai.
- **Verifikasi:** build Linux + Windows pada CI dan smoke-test instalasi, pairing, sinkronisasi, printer, signature update dan rollback.
- **Kompleksitas:** sedang–tinggi.

### SEC-003 — CI tidak menjalankan pemindaian keamanan source/dependency secara otomatis

- **Severity / priority:** Medium / P2 — kesenjangan proses, bukan bukti eksploitasi.
- **Confidence:** Confirmed dari file workflow saat ini.
- **Lokasi:** `.github/workflows/ci.yml:48-110` dan `.github/workflows/pos-desktop-release.yml`; pencarian konfigurasi tidak menemukan SAST, secret scanning, atau SCA gate.
- **Expected:** perubahan dependency/source dan secret terdeteksi berulang di CI sebelum rilis.
- **Actual:** CI memiliki typecheck, lint, unit/integration, build, dan E2E; tidak ada security scan otomatis. `pnpm audit` lulus saat audit ini dijalankan, tetapi itu manual dan tidak mencegah advisory berikutnya masuk.
- **Root cause:** tidak ada job atau policy security scanning pada workflow.
- **Dampak:** risiko dependency baru, secret tidak sengaja, dan kelas bug source umum tidak tertangkap secara konsisten pada pull request.
- **Minimal fix:** tambahkan dependency audit terjadwal/pada pull request, secret scanning, serta SAST dengan rule set lokal/terpercaya; tetapkan severity threshold dan dokumentasikan false-positive review. Pin action pihak ketiga ke SHA sesuai kebijakan supply-chain organisasi.
- **Verifikasi:** pull request uji pada branch test memunculkan temuan fixture dan membuat job gagal; pastikan source privat tidak diunggah ke scanner eksternal tanpa kebijakan yang disetujui.
- **Kompleksitas:** rendah–sedang.

### POS-002 — Riwayat outbox terminal belum memiliki retensi terbatas

- **Severity / priority:** Medium / P2 kapasitas; belum ada dampak latency yang terukur.
- **Confidence:** Strong Evidence dari source dan tidak ditemukannya cleanup outbox di scripts.
- **Lokasi:** `src/server/pos/offline.ts:171-220,558-570`; index pada `src/db/schema/platform.ts` dan migrasi `src/db/migrations/0087_pos_offline_outbox_query_indexes.sql`.
- **Expected:** payload besar tidak disimpan setelah terminal, dan metadata audit memiliki masa retensi/arsip eksplisit.
- **Actual:** payload besar sudah dilepas dari hasil terminal dan query diberi index, tetapi ringkasan/tombstone tiap percobaan disimpan tanpa batas; attempt counter menghitung riwayat untuk `clientKey`. Belum ada bukti pertumbuhan storage atau latency, jadi ini risiko kapasitas, bukan temuan benchmark.
- **Root cause:** kebijakan retensi belum diputuskan; index memperbaiki akses tetapi tidak menghentikan pertumbuhan tabel.
- **Dampak:** storage dan biaya scan history terus tumbuh; query settlement/outbox dapat makin mahal.
- **Minimal fix:** tentukan retensi yang sesuai kebutuhan audit, lakukan arsip/purge aman setelah rekonsiliasi, dan uji pada dataset historis besar sebelum memilih partisi/index tambahan.
- **Verifikasi:** simulasi jutaan terminal summary; ukur row growth, storage, query p95 dan hasil rekonsiliasi sebelum/sesudah purge.
- **Kompleksitas:** sedang; perlu keputusan bisnis retensi.

### Gap verifikasi — integritas transaksi, disaster recovery, UX dan performa

- Regresi yang baru ditambahkan untuk concurrency kas, HR, owner, analytics, dan offline outbox belum berjalan pada PostgreSQL. Penggunaan row lock konsisten dengan kemampuan PostgreSQL, tetapi hasil runtime sistem belum dibuktikan ([PostgreSQL explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html), [transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html)).
- POS PWA memakai Cookie Store API untuk ID cache non-otorisasi. API tersebut tersedia di secure context dan support browser dapat berbeda ([MDN CookieStore](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore/get)); unit test lulus tetapi browser smoke aktual belum dijalankan.
- Backup/restore, PITR, rollback deploy, printer, dan updater belum diuji. Checklist deployment sendiri meminta restore drill di [DEPLOY.md](../docs/DEPLOY.md).
- E2E 66 test hanya terdaftar; tidak ada bukti runtime atau accessibility pass pada audit ini.

## Status temuan remediasi sebelumnya

| Temuan sebelumnya | Revalidasi saat ini |
|---|---|
| POS-001 PWA shell | Perubahan worker ada; unit suite lulus; browser smoke masih belum diverifikasi. |
| ACC-001 kas/bank race | Row lock ada; integration concurrency belum berjalan. |
| HR-001/HR-002 | Lock karyawan dan reread state ada; DB concurrency test belum berjalan. |
| IAM-001 last owner | Lock organisasi ada; DB race test belum berjalan. |
| PUR-001 PO retry | Key UI stabil terlihat; tidak ada component/E2E test yang dijalankan. |
| ANL-001 return netting | Netting retur ada; integration data belum dijalankan. |
| POS-002 outbox | Payload terminal telah diringkas dan index ditambah; retensi tombstone tetap terbuka seperti dijelaskan di atas. |
| SEC-001 telemetry | Batas body/field dan reserved metadata terlihat; unit suite lulus. |
| QA-001 CI integration | `pnpm test:integration` sekarang ada di CI; hasil workflow eksternal belum diperiksa. |
| PERF-001 ledger idle timeout | Batas idle terlihat; unit suite lulus; kapasitas/latency belum dibenchmark. |

`audit/MODULE_INVENTORY.md`, `audit/WORKFLOW_COVERAGE.md`, dan `audit/FINAL_REPORT.md` berisi status dari fase sebelumnya. Addendum ini yang paling baru untuk hasil validasi per tanggal di atas.

## Penilaian standar

Standar dan pedoman yang dipakai sebagai acuan:

- [OWASP ASVS 5.0.0](https://asvs.owasp.org/) — katalog persyaratan verifikasi keamanan aplikasi.
- [OWASP Top 10:2025](https://top10.owasp.org/2025/) dan [OWASP API Security Top 10:2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/) — daftar risiko awareness, bukan sertifikasi.
- [OWASP WSTG 4.2](https://owasp.org/projects/web-security-testing-guide) — versi stabil saat halaman proyek menyebut 5.0 masih dikembangkan.
- [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final) — praktik siklus pengembangan software aman pada tingkat organisasi.
- [ISO/IEC 27001:2022](https://www.iso.org/standard/27001) — persyaratan sistem manajemen keamanan informasi sebuah organisasi.

**Klaim kesesuaian:** belum terbukti. Tidak ada matriks kontrol ASVS yang lengkap, penetration test/WSTG penuh, bukti operasi dan incident response, ISMS/risk register/audit eksternal untuk ISO 27001, atau bukti supply-chain program SSDF. `pnpm audit` yang bersih hanya menyatakan advisory dependency yang diketahui tidak ditemukan pada saat pemeriksaan. Kepatuhan laporan akuntansi terhadap IFRS/PSAK, pajak Indonesia, ketenagakerjaan/BPJS, privasi, dan PCI DSS juga tidak disimpulkan; itu memerlukan scope, dataflow dan kebijakan yang sesuai, termasuk penilaian ahli/regulator.

## Remediasi prioritas

1. **P1:** hilangkan risiko owner demo pada deployment: production guard di seed dan kredensial bootstrap unik/rotasi wajib.
2. **P1 jika desktop Tauri dipakai:** pulihkan source/config native dan jalankan build rilis Linux/Windows; atau keluarkan workflow yang tidak lagi didukung.
3. **P2:** pasang module gate pada aksi import, rekonsiliasi bank, dan uang muka; tambahkan tes denial tanpa write.
4. **P2:** sepakati retensi outbox, lalu ukur dan verifikasi cleanup/arsip pada fixture historis.
5. **P2:** jalankan unit + integration + E2E pada CI dan staging disposable; periksa log run nyata.
6. **P2:** tambahkan secret/dependency/SAST scanning yang aman bagi source privat.
7. **Sebelum go-live:** lakukan cross-module reconciliation dan backup/restore drill; ukur latency dan load dengan dataset/concurrency target yang mewakili operasi.

## Kesimpulan akhir

Pemeriksaan kualitas lokal saat ini baik dan dependency audit tidak melaporkan advisory yang diketahui. **Akan tetapi, sistem belum dapat dinyatakan tanpa temuan atau sesuai standar internasional.** Setidaknya CORE-02 masih merupakan bypass kontrol modul; SEC-002 berisiko tinggi bila seed demo dipakai pada deployment; jalur Tauri tidak lengkap pada checkout sekarang; dan bukti transaksi database, browser, pemulihan, serta performa belum tersedia.
