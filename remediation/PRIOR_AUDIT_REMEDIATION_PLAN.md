# Remediation Plan — Prior Deep Audit Findings

Tanggal: 2026-11-22  
Basis: temuan pada `audit/FINDINGS.md`, divalidasi ulang terhadap working tree saat ini.  
Prinsip: perbaikan minimum yang mengunci invariant di boundary bersama, menjaga perilaku bisnis yang sudah ada, dan tidak menghapus data audit tanpa kebijakan retensi.

## Kondisi Revalidasi Awal (sebelum remediasi)

| ID | Status saat ini | Bukti validasi |
|---|---|---|
| POS-001 | Terbuka | Worker masih membaca `Cookie` dari `FetchEvent.request.headers`; proxy menetapkan cookie itu `HttpOnly`. Harness Chromium lokal sebelumnya memastikan header tidak tersedia. |
| POS-002 | Terbuka | Setiap catatan percobaan menulis seluruh payload sale ke `outbox`; retry menghitung histori JSONB, penyelesaian sesi memuat seluruh histori ke Node. Skrip prune yang ada hanya menghapus idempotency keys. |
| ACC-001 | Terbuka | Guard menghitung saldo GL sebelum posting tanpa mengunci akun kas/bank; perubahan lokal journal fingerprint tidak menutup race saldo. |
| HR-001 | Sebagian | Read-before-insert aktif, tetapi belum ada lock bersama atau constraint yang menserialisasi submit dan approval untuk employee/date yang sama. |
| HR-002 | Sebagian | Saldo diperiksa ulang saat approval, tetapi dua approval masih dapat membaca quota yang sama sebelum salah satunya commit. |
| IAM-001 | Terbuka | Pemeriksaan jumlah owner ada di aksi tunggal dan batch, tetapi tidak ada lock perusahaan sebelum hitung dan demosi. |
| PUR-001 | Terbuka | Server menerima idempotency key opsional, tetapi formulir PO tidak membuat atau mengirimkannya. |
| ANL-001 | Terbuka | Analytics menjumlahkan baris penjualan bruto tanpa return lines; report penjualan standar sudah men-net return lines berstatus posted. |
| SEC-001 | Sebagian | Bentuk scalar/karakter key dibatasi sebagian, tetapi body, jumlah field, dan panjang nilai tidak dibatasi; spread detail masih dapat mengganti companyId/userId/event. |
| QA-001 | Terbuka | `pnpm test` hanya menjalankan `tests/unit`; job CI tidak menjalankan `test:integration` dan tidak menetapkan URL database test yang diwajibkan guard. |
| PERF-001 | Terbuka | Jalur cancel menutup iterator, tetapi jeda client tanpa pembatalan dapat menahan transaksi snapshot dan koneksi tanpa batas idle. |
| PLT-001 | Gap checkout | `src-tauri/**` terhapus dari working tree; file masih dapat dibaca dari Git HEAD, tetapi tidak aman memulihkan file yang sengaja dihapus tanpa memastikan kebutuhan produk. |
| TEST-001 | Gap environment | `BISA_TEST_DATABASE_URL`/`BISA_TEST_DIRECT_URL` tidak diset; Docker CLI ada tetapi daemon tidak berjalan. Integrasi lokal belum dapat dijalankan. |
| PERF-002 | Gap environment | Tidak ada service PostgreSQL lokal, fixture representatif atau runtime staging untuk mengukur p95/load. |
| OPS-001 | Gap environment | Drill backup/restore perlu PostgreSQL dan target pemulihan disposable; belum tersedia pada shell ini. |

## Riset dan Dasar Solusi

Exa MCP dan Context7 tidak muncul di daftar tool tersedia. Riset dilakukan sebagai fallback memakai web-search lokal dan pencarian web pada dokumentasi primer, tanpa mengirim source privat. Referensi yang ditemukan:

- Fetch membatasi akses API terhadap header `Cookie`; Cache partition POS akan memakai Cookie Store API untuk sebuah ID cache acak yang bukan kredensial. Cookie autentikasi dan cookie hash sesi tetap `HttpOnly`. [Fetch Standard](https://fetch.spec.whatwg.org/), [MDN forbidden request header](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header), [MDN CookieStore.get](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore/get), [MDN ServiceWorkerGlobalScope.cookieStore](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/cookieStore).
- PostgreSQL menyarankan row locks atau serializable transactions untuk invariant aplikasi. Patch akan mengambil row locks di dalam transaksi `withCompany`, dengan urutan akun stabil. [PostgreSQL explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html), [data consistency checks](https://www.postgresql.org/docs/18/applevel-consistency.html), [transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html), [Drizzle transactions](https://orm.drizzle.team/docs/transactions).
- Offline queue akan mempertahankan payload hanya selama item masih perlu direview, menyimpan tombstone terminal, mengagregasi settlement di SQL dan mengindeks expression JSONB yang dipakai query. Tidak ada penghapusan histori tanpa kebijakan retensi. [PostgreSQL JSONB indexing](https://www.postgresql.org/docs/18/datatype-json.html), [expression indexes](https://www.postgresql.org/docs/18/indexes-expressional.html), [OWASP logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
- PO retry memakai key stabil untuk percobaan yang sama; server idempotency/fingerprint yang sudah ada tetap menjadi source of truth. [PostgreSQL unique indexes](https://www.postgresql.org/docs/18/indexes-unique.html); validasi lokal terhadap `savePurchaseOrderAction` dan `savePurchaseOrder`.
- Analytics memakai bentuk agregasi return yang sudah ada di report penjualan, bukan aturan akuntansi baru. Rujukan internal: `src/server/reports/sales.ts`.
- Telemetry akan menerapkan batas request, whitelist detail, panjang/nilai field, dan metadata server menang atas data client. [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
- CI akan memakai service PostgreSQL khusus bernama `bisa_test`, menjalankan unit dan integration suites melalui guard repo. [GitHub Actions PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
- Export ledger mendapat idle timeout khusus pada stream. [PostgreSQL client connection defaults](https://www.postgresql.org/docs/18/runtime-config-client.html) menjelaskan `idle_in_transaction_session_timeout` dan risiko snapshot/tuples tertahan.
- Native Tauri tetap perlu audit build dan runtime terhadap source yang benar-benar dipakai. Acuan resmi: [Tauri CSP configuration](https://v2.tauri.app/reference/config/), [Tauri updater signatures](https://v2.tauri.app/plugin/updater/).

## Urutan Implementasi

| Tahap | Finding | Perubahan | Regresi yang ditambahkan |
|---:|---|---|---|
| 1 | POS-001 | Ambil ID cache acak dari Cookie Store, expose hanya ID non-otorisasi, pertahankan cookie sesi HttpOnly, bersihkan cache saat logout/session berganti, naikkan versi cache. | Unit service-worker tanpa header Cookie; cache hanya untuk ID yang cocok; logout dan redirect membersihkan shell. |
| 2 | ACC-001, HR-001, HR-002, IAM-001 | Lock baris invariant di transaksi: akun kas terurut; employee untuk overtime/leave; organization untuk perubahan owner tunggal/batch. Recheck setelah memperoleh lock. | Integration race dengan dua transaksi/aksi paralel; jumlah kas, overtime aktif, kuota cuti, dan owner akhir harus tetap valid. |
| 3 | PUR-001 | Simpan key retry stabil di form dan kirim pada aksi; pertahankan saat transport gagal agar retry payload identik replay aman. | Unit/integration replay key yang sama; pastikan key baru untuk draft baru. |
| 4 | ANL-001 | Kurangi qty, revenue dan profit produk dengan return berstatus posted berdasarkan tanggal retur; hitung ABC/FSN dari data net. | Fixture return penuh/parsial serta retur dalam periode berbeda; cocokkan dengan standard report. |
| 5 | POS-002 | Hapus sale payload dari row terminal/superseded, pertahankan hanya payload unresolved; tambahkan expression indexes untuk client key dan settlement session; pindahkan scan settlement ke `SUM` SQL. Tidak menghapus tombstone tanpa kebijakan retensi. | Tests terminal payload redaction, unresolved review payload, attempt key query dan settlement aggregation. |
| 6 | SEC-001 | Batasi body JSON (8 KiB), Content-Type, daftar field, 32 detail fields, panjang string, finite number; reserve identity/event fields. | Uji body oversized, field berlebih, override metadata dan nilai panjang. |
| 7 | PERF-001 | Tambahkan batas idle demand pada stream untuk membatalkan export terbengkalai dan memastikan iterator/transaksi selesai; tetap hormati client cancel normal. | Unit stream stall/cancel; assert stream error dan iterator cleanup. |
| 8 | QA-001 | CI test database terpisah `bisa_test`; jalankan unit dan integration suite. | Validasi workflow YAML/commands; jalankan suite lokal jika disposable PostgreSQL tersedia. |

## Batas Verifikasi

- Source `src-tauri/**` yang hilang tidak akan dipulihkan otomatis: deletion adalah perubahan lokal eksplisit. Static inspection dapat memakai Git HEAD, tetapi build/signature/update/runtime masih memerlukan source checkout dan target OS yang benar.
- Docker daemon tidak tersedia saat rencana dibuat. DB integration/concurrency/restore checks akan dicoba hanya setelah ada PostgreSQL disposable; URL test harus berakhiran nama database `*_test` sesuai guard.
- Tanpa staging dan data representatif, p95, concurrency load, restore point-in-time, dan produksi tidak akan diklaim terverifikasi. Kode dan CI dapat diperbaiki, tetapi gap lingkungan dicatat eksplisit.

## Hasil Remediasi dan Verifikasi

Semua 11 temuan kode/performa yang direvalidasi sudah mendapat perubahan terarah:

| ID | Hasil | Perubahan utama | Verifikasi yang tersedia |
|---|---|---|---|
| POS-001 | Diperbaiki | Worker membaca UUID partisi cache non-otorisasi melalui Cookie Store; cookie sesi tetap HttpOnly; shell dibersihkan saat autentikasi ditolak/logout. | Tercakup dalam `pnpm test` (service-worker contract). Browser smoke tidak selesai: Playwright tidak menemukan revisi browser bawaan, dan executable Chromium lokal macet saat menunggu service worker aktif. |
| ACC-001 | Diperbaiki | Posting jurnal mengunci akun kas/bank kandidat terurut sebelum membaca saldo GL. | Regresi dua pengeluaran simultan ditambahkan di `tests/integration/erp-concurrency-remediation.test.ts`; belum berjalan karena database test lokal tidak tersedia. |
| HR-001 | Diperbaiki | Submit dan keputusan lembur mengunci employee; keputusan membaca ulang request dan menolak approval aktif kedua untuk employee/tanggal. | Regresi submit/approval paralel ditambahkan di `tests/integration/hr-concurrency.test.ts`; belum berjalan lokal. |
| HR-002 | Diperbaiki | Submit dan approval cuti mengunci employee; request dibaca ulang dan saldo/overlap diperiksa lagi setelah lock. | Regresi dua approval enam hari atas kuota sepuluh hari ditambahkan di `tests/integration/hr-concurrency.test.ts`; belum berjalan lokal. |
| IAM-001 | Diperbaiki | Perubahan role tunggal/batch mengunci row organisasi sebelum menghitung owner. | Regresi dua owner yang saling demosi ditambahkan di `tests/integration/user-management.test.ts`; belum berjalan lokal. |
| PUR-001 | Diperbaiki | Form memakai UUID idempotensi stabil untuk retry; mencegah submit kedua di UI; key dipertahankan pada hasil transport ambigu. | Typecheck, lint, build lulus. Manual check setelah merge: simulasikan response timeout sesudah commit lalu pastikan satu PO dan pesan untuk memeriksa daftar PO. |
| ANL-001 | Diperbaiki | Analytics produk men-net qty/revenue/profit retur posted per produk dan tanggal retur; return-only product dicakup; dead-stock memakai net sold qty. | Regresi retur parsial ditambahkan di `tests/integration/analytics.test.ts`; belum berjalan lokal. |
| POS-002 | Diperbaiki dengan retensi eksplisit | Payload penuh hanya disimpan pada item unresolved; terminal/superseded hanya ringkasan; settlement dipindah ke `SUM` SQL; dua expression index ditambahkan pada migrasi `0087`. | Regresi payload terminal/unresolved ditambahkan di `tests/integration/pos-offline-tahap2.test.ts`; belum berjalan lokal. Tombstone ringkas tetap dipertahankan sampai kebijakan retensi bisnis disetujui. |
| SEC-001 | Diperbaiki | Telemetry mewajibkan JSON, membatasi body 8 KiB, 32 field, key 40 karakter, string 256 karakter, angka finite, dan melindungi metadata server. | Unit test telemetry berjalan di suite penuh. |
| QA-001 | Diperbaiki di CI | Workflow memakai service `bisa_test`, mengekspor URL test khusus, dan menjalankan `pnpm test:integration` setelah migrasi/seed. | YAML workflow valid; unit/quality/build lokal lulus. CI eksternal belum dijalankan di turn ini. |
| PERF-001 | Diperbaiki | Ledger export gagal dengan batas 60 detik tanpa demand, membatalkan iterator dan melepas snapshot transaksi. | Unit test stream idle/cancel berjalan di suite penuh. |

Hasil pemeriksaan akhir:

- `pnpm test`: lulus — 134 file, 1.195 test.
- `pnpm typecheck`: lulus.
- `pnpm lint`: lulus.
- `pnpm build`: lulus.
- `git diff --check`: lulus.
- Validasi YAML `.github/workflows/ci.yml`: lulus menggunakan parser Ruby.
- `pnpm test:integration`: tidak mulai; guard menolak karena `BISA_TEST_DATABASE_URL` dan `BISA_TEST_DIRECT_URL` tidak tersedia. `postgres`, `initdb`, `pg_ctl`, `pg_isready`, dan `psql` tidak tersedia; Docker daemon juga tidak tersedia. Tidak ada database lokal/produksi yang disentuh.
- Browser smoke POS: terhambat oleh ketidakcocokan revisi Chromium Playwright dan worker readiness harness yang menggantung; cache Cookie Store belum dikonfirmasi melalui browser nyata.

Empat gap audit tetap berupa gap verifikasi/produk, bukan temuan kode yang sengaja dibiarkan diam-diam: PLT-001 (source Tauri dihapus dari working tree), TEST-001 (integrasi concurrency menunggu CI/database disposable), PERF-002 (tidak ada staging untuk p95/load), OPS-001 (tidak ada target disposable untuk backup/restore drill). Lihat [`PRIOR_AUDIT_REMEDIATION_REPORT.md`](PRIOR_AUDIT_REMEDIATION_REPORT.md) untuk rincian hasil dan langkah validasi setelah tersedia service database.

Riset Exa MCP dan Context7 tidak dapat dilakukan karena konektornya tidak tersedia; Ponytail FULL dan `/ponytail-audit` juga tidak tersedia sebagai skill/command pada sesi ini. Rujukan resmi PostgreSQL, Drizzle, Fetch/MDN, OWASP, dan GitHub Actions yang tercantum di atas dipakai sebagai sumber fallback.
