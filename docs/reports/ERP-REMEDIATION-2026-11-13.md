# Penutupan temuan ERP — 2026-11-13

Status: IMPLEMENTED, VERIFIED & MIGRATED ON ACTIVE LOCAL DATABASE. F01–F17 selesai dalam scope audit; batas dan temuan HR di luar scope tetap dicatat. Permintaan terbaru mengizinkan implementasi perbaikan F01–F17; batas audit-only sebelumnya tidak lagi berlaku untuk pekerjaan ini. Database pengguna tidak dipakai untuk testing atau koreksi otomatis.

Baseline main, HEAD39f1d54; perubahan pengguna `.claude/CLAUDE.md` dipertahankan. Laporan audit historis dipertahankan.

| Temuan | Status kode | Perubahan | Evidence utama |
|---|---|---|---|
| F01 | IMPLEMENTED; regression PASS | Bulk guard history + lock | `master-data/bulk-edit.ts` |
| F02 | IMPLEMENTED; regression PASS | Import guard AVCO + recompute opening | `actions/import/commit-phases.ts` |
| F03 | IMPLEMENTED; regression PASS | Valuation includes inactive stock | `reports/inventory.ts` |
| F04 | IMPLEMENTED; regression PASS | Owned transit pool and report reconstruction | `inventory/transit.ts; inventory/movements.ts; reports/control.ts` |
| F05 | IMPLEMENTED; regression PASS | Recompute ledger AVCO after adjustment | `inventory/adjustments-post.ts` |
| F06 | IMPLEMENTED; regression PASS | Same canonical detail and monthly sums | `accounting.ts; lib/akuntansi/journal-amounts.ts` |
| F07 | IMPLEMENTED; regression PASS | Canonical validation before journal write | `lib/akuntansi/journal-amounts.ts` |
| F08 | IMPLEMENTED; regression PASS | Return operation idempotency + UI retry persistence | `pos/returns.ts; actions/pos.ts; components/pos/return-form.tsx` |
| F09 | IMPLEMENTED; regression PASS | Sellable/write-off condition with stock/GL distinction | `pos/returns.ts; components/pos/return-form.tsx` |
| F10 | IMPLEMENTED; regression PASS | Checkout cost lock before quote; product-first writer lock | `pos/sales-create.ts; pos/quote.ts; inventory/movements.ts` |
| F11 | IMPLEMENTED; regression PASS | Origin cashier authorization + supervised cross-cashier sync | `pos-offline.ts; actions/pos-offline.ts` |
| F12 | IMPLEMENTED; regression PASS | Changed offline factor review and explicit supervised settlement | `pos/quote.ts; app/app/pos/offline/page.tsx` |
| F13 | IMPLEMENTED; regression PASS | DB late append/company/amount guard | `db/migrations/0073_cheerful_ghost_rider.sql` |
| F14 | IMPLEMENTED; regression PASS | Canonical draft contract fixtures | `tests/unit/opname-count.test.ts` |
| F15 | IMPLEMENTED; regression PASS | Batched opname product lookup; amount-indexed matching | `inventory/opname.ts; bank-reconciliation/matching.ts` |
| F16 | IMPLEMENTED; regression PASS | Packaging documentation matches implementation | `docs/BUSINESS_RULES.md` |
| F17 | IMPLEMENTED; regression PASS | Held checkout replay before hold precondition | `actions/pos.ts` |

Verifikasi direncanakan: unit/regression, integrasi PostgreSQL disposable, typecheck/lint, build, browser dengan pengguna sintetis. Jangan menyatakan siap produksi sebelum verifikasi selesai.

## Checkpoint implementasi 1

- F01/F02: guard history AVCO pada bulk/import; import stock juga recompute cost.
- F03/F04: seluruh status produk masuk valuation; stok transit direkonstruksi dari movement append-only (termasuk void), masuk cost pool/valuation/control.
- F05: recompute cost ledger setelah adjustment; biaya beku approval dipertahankan dengan pool yang ikut disesuaikan.
- F06/F07: canonical4dp sebelum write, residual dialokasikan pada leg terbesar per sisi; summary memakai angka canonical yang sama.
- F08/F09: migration0073 idempotency/disposition retur, claim domain, UI operation key persisted sessionStorage, opsi sellable/write-off + jurnal loss.
- F10: lock cost saat checkout dan period sebelum quote, stock writer product→onHand.
- F11/F12: cross-cashier hanya supervisor; faktor berbeda masuk review, historic factor hanya explicit supervised frozen settlement; rincian faktor ditampilkan.
- F13: migration0073 guard late-line/same-company/amount checks; probe savepoint membuktikan xmin subxid berbeda; guard memakai pg_xact_status agar nested tx sah.
- F14/F15/F16/F17: draft contract tests, preload opname product + matcher amount buckets, docs satuan, replay hold sebelum precondition termasuk setelah concurrent wait.
- Podman test container `bisa-erp-remediation-test-20261113`, localhost55439, database `bisa_erp_test`, role app terbatas. Database pengguna tidak disentuh. Baseline migrasi +0073 dan seed sintetis berhasil.
- Regression baru11case domain PASS pada run pertama; core gate awal88/89, satu test lama mengharapkan faktor kemasan berubah tetap auto-sync (kini diubah menjadi review→settle sesuai security fix).
- Full unit awal974/983; ditemukan kontrak nav/list/health stale dan struktur pre-existing. Sudah diperbarui route test yang benar, extraction Excel opname/props terminal, query halaman dipindahkan ke catalog getter. Run unit kedua990/991; sisa file opname807baris, orphan comment dibuang setelah extraction.
- Sedang berjalan: full integration+sim2 (output /tmp/bisa-erp-integration.json), production build isolated (.next-remediation), final typecheck/unit/browser masih perlu diselesaikan.

## Checkpoint verifikasi 2

- Full unit: **991/991 PASS** (`/tmp/bisa-erp-unit-final.json`).
- Full integration + sim2: **1288/1289 PASS**, satu kegagalan fixture POS-IDEM telah dikoreksi (fixture diinisialisasi sebelum transaksi bersamaan; assertion dua pemanggil menerima sale yang sama tetap dipertahankan). Re-run terarah termasuk file tersebut, regresi domain, concurrency dan retur: **40/40 PASS** (`/tmp/bisa-erp-regression-final.json`). Empat concurrency case baru seluruhnya PASS: receipt/sale AVCO, partial return retry, late journal-line insert setelah commit, held checkout replay.
- Typecheck PASS; lint src/tests PASS. Production build awal PASS, build akhir menunggu perubahan terakhir.
- Migrasi dari database kosong `bisa_erp_migration_test` sampai0073: **PASS**; tetap di container testing terpisah yang sama. DB aplikasi pengguna belum dimigrasi.
- Gate integrasi menemukan race pre-existing lazy seed HR saat concurrent payroll. `seedHrDefaults` sekarang `ON CONFLICT DO NOTHING` pada company/key/effectiveFrom, mempertahankan parameter yang sudah ada. Test payroll concurrency lulus dalam full suite.
- E2E awal membuktikan autofocus/F2, arrow selection dan F9 mixed payment PASS; axe menemukan `aria-pressed` pada link Akun nol. Link sekarang memakai label tindakan tampil/sembunyi yang sesuai dan tidak memakai atribut button pada anchor. Verifikasi ulang masih berjalan.
- E2E simulasi minimarket lama mengasumsikan form penerimaan tertutup. Implementasi aktual membuka form dari awal; harness diperbarui agar hanya membuka jika tombol terlihat, tanpa mengubah workflow aplikasi.
- Screenshot/axe yang redirect login selama suite auth berjalan **tidak dihitung sebagai verifikasi modul**. Browser akhir memakai login baru setelah suite selesai.

## Ketentuan rilis dan data lama

Kode guard mencegah korupsi baru; ia tidak membuktikan bahwa data historis pengguna sudah bersih. Jangan mengubah AVCO lama atau membuat jurnal penyeimbang otomatis. Setelah backup, lakukan rekonsiliasi movement/on-hand/transit, AVCO/valuation/GL dan monthly summary per perusahaan/tanggal. Diagnosa selisih sebelum dokumen koreksi disahkan.

Migrasi0073 menambahkan idempotency/disposition retur, constraint amount jurnal untuk write baru, guard lifecycle insert jurnal dan rebuild summary bulanan dari jurnal posted. Constraint amount menggunakan NOT VALID agar baris historis tidak diubah diam-diam; pemeriksaan dan validasi historical constraint dilakukan sesudah rekonsiliasi. Selama rollout hentikan writer, backup, terapkan migrasi dengan role migrator lalu jalankan aplikasi baru dan smoke test. Jangan menjalankan kode baru terhadap schema sebelum0073.

Kebijakan belum disahkan (GRNI/faktur terpisah, credit note pemasok, koreksi retur posted, negative stock, pajak/legal dan opname cut-off) tidak dijadikan fitur baru spekulatif. Retur kondisi campuran dipecah menjadi dokumen layak jual/rusak; retur rusak tidak menambah stok dan biaya direklasifikasi ke inventory_shrink. Perubahan faktor kemasan offline memerlukan review supervisor dengan bukti transaksi, bukan auto-accept client snapshot.

## Checkpoint verifikasi 3

- E2E minimarket actual: **PASS** penerimaan tunai100×2500 → status Lunas (tunai) di riwayat → stok+100 → sale1×4000 → nota → stok−1; bukti run Playwright pada localhost3100, DB sintetis. Harness menunggu hidrasi form, memakai source purchase_cash dan membuka halaman riwayat aktual.
- Axe laporan akuntansi setelah perbaikan atribut link: **PASS 0 violations** pada gate WCAG2 A/AA.
- Mobile POS menemukan tombol menu tanpa nama saat span `hidden sm:inline`; ditambahkan aria-label Menu terminal POS dan E2E mobile. Petunjuk Alt+B jurnal dinaikkan10→11px.
- Pemeriksaan font luas `ui-neatness-guard` kini melewati jurnal, tetapi **FAIL pada HR** (label summary dan employee code10px). Di luar lingkup audit POS/Accounting/Warehouse; tidak diperbaiki atau ditutupi dengan mengubah assertion. Gate akhir inti mengecualikan hanya test font campuran itu dan hasilnya dicatat terpisah. Pengujian primer tunggal dan mobile overflow tetap dijalankan.
- Screenshot terautentikasi12kombinasi4halaman×3viewport berhasil; awal mobile POS satu button-name sudah diperbaiki. Seluruh kombinasi bebas overflow dokumen. Artefak `/tmp/erp-verified-{390,768,1440}-{pos,produk,laporan,offline}.png`; screenshot login dari probe awal tidak dipakai sebagai bukti modul.
- Build/typecheck/lint, gate E2E inti dan integration akhir masih menunggu checkpoint akhir.


## Temuan tambahan saat verifikasi

| ID | Status | Bukti sebelum | Perbaikan / batas |
|---|---|---|---|
| R18 | PASS build;0backup/env files in standalone | `.next-remediation/standalone/backups/*.dump` berisi6salinan backup lokal; isi dump tidak dibaca | next.config.ts outputFileTracingExcludes untuk backups/** dan .env*. Backup asli tidak diubah; bukti hasil build ulang wajib tidak mengandung dump/env. Tidak terbukti bisa diunduh lewat HTTP, tetapi artefak deployment seharusnya tidak membawa data backup. |
| R19 | PASS browser | Link filter laporan dengan aria-pressed dan menu POS mobile tanpa accessible name | Link memakai label aksi, menu memakai aria-label; axe laporan dan E2E mobile PASS. |
| R20 | PASS integration | Concurrent payroll gagal di lazy seed parameter HR sebelum duplicate-run guard | Seed parameter memakai conflict target existing unique key; payroll concurrency PASS. Perbaikan kecil pada dependency integrasi akuntansi, tidak memperluas audit HR. |

## Gate akhir sementara

- E2E inti **12/12 PASS** (56.7s): lima route axe, mobile POS axe, tiga keyboard/payment, simulasi minimarket dan dua UI layout gates.
- Build produksi akhir sebelum R18 **PASS** (compile + TypeScript74s + route generation). Build setelah tracing exclusion masih berjalan.
- `next start` probe HTTP lokal sengaja ditolak environment guard HTTPS. Ini bukan kelulusan runtime produksi; pengujian HTTP lokal hasil build perlu dua override harness yang eksplisit, tidak boleh dipakai deployment sungguhan. Server probe dihentikan; dev server testing juga telah dihentikan. Aplikasi pengguna port3000 tidak dihentikan.
- Restore tsconfig hanya perubahan otomatis Next dari baseline awal tanpa user edit, setelah server build selesai agar tidak meninggalkan konfigurasi testing pada source.


## Hasil akhir verifikasi kode

| Gate | Hasil aktual |
|---|---|
| Unit | **PASS 991/991**, final run sesudah perubahan UI |
| Integration + sim2 | **PASS 1289/1289**, final full run; DB PostgreSQL18 disposable, app_user terbatas |
| Regresi terarah | **PASS 40/40**, termasuk15case baru domain/concurrency |
| Typecheck | **PASS** tsc --noEmit; build juga memverifikasi TypeScript |
| Lint | **PASS** src/tests dan tiga file E2E yang berubah; tidak menyatakan seluruh repo lint bila tidak dijalankan |
| Build produksi | **PASS** sesudah R18, compile3.1s + TypeScript10.9s + routes |
| Artefak release | **PASS** traversal standalone tidak menemukan file backups/ ataupun .env*;6dump yang sebelumnya tersalin sekarang0 |
| Migrasi kosong | **PASS** seluruh migrasi sampai0073 pada bisa_erp_migration_test |
| E2E dev | **PASS 12/12** gate inti; detail checkpoint3 |
| E2E standalone produksi | **PASS 12/12** final clean run (30.7s), termasuk simulasi, mobile axe, keyboard dan layout |
| Font HR gate campuran | **FAIL di luar scope**,8teks HR10px; assertion tidak dilemahkan. Petunjuk jurnal yang termasuk scope sudah11px |
| Database aktif pengguna | **MIGRATED** sesudah persetujuan eksplisit dan backup;74migrasi sampai0073; hanya smoke read-only, tidak dipakai untuk menjalankan suite test |
| Physical/native/stress | **NOT RUN** scanner/printer/drawer fisik, Tauri, crash recovery native, p95 skala toko, full backup-restore data pengguna |

Tidak ada framework/dependency/lockfile update, perubahan branch atau Git reset. User edit `.claude/CLAUDE.md` tetap4+/4− seperti baseline; tsconfig kembali baseline. Hasil ini menutup implementasi F01–F17 pada kode dan data sintetis, bukan sertifikasi kepatuhan pajak atau pernyataan bahwa data historis pengguna bersih.


## Checkpoint rilis

- R18 selesai: build ulang PASS, pemeriksaan rekursif standalone **0file backup/environment**. Backup asli tetap ada.
- Production standalone runtime berhasil start dengan localhost/insecure overrides **hanya pada command harness**, tidak disimpan di konfigurasi aplikasi. Login browser PASS.
- E2E standalone awal11/12 PASS; selector `.last()` mengambil tabel nonaktif di DOM riwayat. Diubah ke tabel accessible pertama. Re-run simulasi **PASS** (5.1s). Semua langkah termasuk cash receipt, paid status, stock+100, POS sale/receipt dan stock−1 terbukti pada hasil build produksi. Gate12case produksi satu-run bersih sedang diselesaikan.
- Konfirmasi eksplisit diminta sebelum backup+migrasi database aktif localhost5433/bisa_erp, karena instruksi awal melarang perubahan database. Sampai konfirmasi diterima, database itu tidak diubah dan tidak ada klaim aplikasi aktif sudah siap rollout. File migrasi yang siap direview: `src/db/migrations/0073_cheerful_ghost_rider.sql`.
- Tidak mengklaim gate font HR telah lulus atau native/hardware/stress telah diuji. Tidak mengubah kebijakan bisnis yang belum didefinisikan.


## Penutupan rollout aktif — 13 November 2026

Pengguna menyetujui **Lanjut backup dan migrasi database aktif**. Target diverifikasi localhost5433/bisa_erp, PostgreSQL18.6, container bisa-erp-db. Proses Next dev6145 dihentikan sebelum backup; server kembali berjalan dengan next dev -p3000 dan konfigurasi .env.local semula. Tidak mengubah environment file, role DB, branch atau data transaksi untuk testing.

Backup: `backups/bisa-pre-remediation-20261113-1794539771863.dump`,4,152,327byte, permission0600; SHA256 `adcfa755fe5ff0ab33d6485ecd47faeeb3717676116f7c0431b11777260b70aa`. `pg_restore --list` PASS dan TABLE DATA journal_lines/stock_movements/sales ditemukan. Pemeriksaan ini memverifikasi struktur arsip dan checksum, **bukan restore drill penuh**. Manifest backup diperbarui dengan salinan metadata sebelumnya dipertahankan; backup tidak masuk paket standalone.

| Pemeriksaan aktif | Sebelum | Sesudah |
|---|---:|---:|
| Migrasi diterapkan |73 (sampai0072)|74 (sampai0073)|
| Journal entries |4773|4773|
| Journal lines |12973|12973|
| Sales |1169|1169|
| Sale returns |392|392|
| Stock movements |3168|3168|
| Posted journal unbalanced |0|0 (query ulang sesudah restart)|
| Monthly amount mismatches vs posted ledger |Tidak diukur sebelum|0|
| Invalid debit/credit row amounts |Tidak diukur sebelum|0|
| journal_lines_insert_guard |Belum ada|Terpasang|
| AVCO vs owned ledger+transit, perusahaan operasional |Tidak diukur sebelum|0di atas toleransi presisi simpan (max0.01atauqty×0.0001)|

Dua cache stock mismatch pada baseline ternyata milik fixture integration lama: company aa05 / SKU UJI-REVIEW-T3-1 (ledger99956 vs cache99999), dan company aa03 / UJI-PENJAGA-1 (99949 vs100000). Sumber terbukti di tests/integration/review-fixes-t3.test.ts:52,294 dan pos-guards.test.ts:774,876. Tidak merekonsiliasi atau menghapus fixture/data itu diam-diam. Tidak ditemukan mismatch cache perusahaan operasional dalam query lintas-company tersebut.

Smoke browser **aplikasi aktif localhost3000**: login PASS; GET POS, Produk, Laporan keuangan, Retur penjualan, Peninjauan offline dan Status sistem semuanya200dengan heading modul yang benar, **runtimeErrors=[]**. Tidak membuat sale, receipt, return, adjustment atau transaksi bisnis lain pada database aktif. Semua workflow tulis diuji pada database sintetis port55439.

Gate akhir: unit991/991, integration+sim21289/1289, E2E standalone12/12, typecheck/lint/build/migrasi PASS. Test font HR campuran masihFAILdi luar scope; scanner/printer/native dan stressbenchmark tetapNOT RUN. Kebijakan akuntansi/pajak yang belum disahkan tidak dianggap selesai hanya karena kode lulus test.

Server testing3100dihentikan setelah verifikasi; aplikasi aktif3000tetap berjalan. Container testing55439dipertahankan untuk reproduksi. Perubahan pengguna .claude/CLAUDE.md dipertahankan dan tsconfig kembali baseline. Tidak ada koreksi saldo historis atau restore data pengguna.

## Checkpoint lanjutan — 14 November 2026

Catatan database aktif di atas adalah snapshot setelah migrasi 0073. Pada checkpoint ini dilakukan backup dan migrasi berikutnya:

- Backup lokal terenkripsi AES-256-GCM: `backups/bisa-20261114-172714-293357.dump.enc`; mode file `0600`. Manifest dan sidecar cocok dengan SHA-256. Secret disimpan pada desktop Secret Service keyring dengan label `Bisa ERP local database backup key` dan attribute `purpose=local-db-backup-20261114`; nilai tidak dicetak. Backup berhasil didekripsi secara terautentikasi dan arsip hasilnya lolos `pg_restore --list`. Backup ini lokal, belum offsite, dan belum di-restore ke host lain.
- Migrasi aktif lokal: `MIGRASI sebelum=74 sesudah=80 diterapkan=6` (0074–0079). Rerun: `80 → 80`, `diterapkan=0`. Tidak ada transaksi database lain yang aktif saat preflight.
- Pemeriksaan read-only sebelum migrasi mencocokkan 25 relasi tenant yang baru diberi constraint: **0 mismatch**. Setelah migrasi, katalog DB menunjukkan 25 FK komposit baru aktif sebagai `NOT VALID`, 11 unique parent index, dan `app_user` tetap dapat membaca migration journal. Constraint menegakkan pasangan tenant untuk tulis baru; validasi penuh baris historis sengaja belum dijalankan.
- Tes PostgreSQL sintetis: `tenant-product-fks.test.ts` **16/16 PASS**; lima suite `erp-remediation`, `erp-concurrency-remediation`, `accounting-integrity`, `goods-receipt`, dan `supplier-returns` **46/46 PASS** setelah demo seed non-destructive pada database test. Typecheck, lint target, Drizzle check, production build terisolasi, dan diff check **PASS**.

Kesiapan produksi tetap belum tersertifikasi: salinan backup offsite, restore lintas-host, validasi constraint historis, DDL timing pada volume produksi representatif, native hardware dan stress test tetap terbuka. Tidak ada perubahan saldo historis.
