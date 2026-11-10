# Arsitektur — Bisa ERP

**Dokumen resmi program A-24 (ditulis di T8, 2026-11-06).** Dikonsolidasikan
dari `docs/CODEBASE_AUDIT.md` (audit Graphify Fase 1), `AGENTS.md` proyek
(aturan yang ditegakkan test), dan hasil tahap FIX-ARS (A-19), A-24 T2
(modul HR), T4B (pecah berkas domain), T6/T6B (offline/PWA). Batas modul
dirinci di `docs/MODULE_BOUNDARIES.md`; aturan bisnis di
`docs/BUSINESS_RULES.md`; skema di `docs/DATABASE_DESIGN.md`.

## 1. Gambaran

Aplikasi web monolitik modular (bukan microservice): satu Next.js 16
(App Router, Server Actions) + React 19 + TypeScript strict, satu
PostgreSQL 18, satu proses. Pilihan ini disengaja untuk target pemakaian:
satu toko/minimarket dengan server lokal Linux di toko (lihat
`docs/RUNBOOK-INSTALASI-PRODUKSI.md` & `docs/OFFLINE_POS_ARCHITECTURE.md`),
di mana kesederhanaan operasional mengalahkan skalabilitas horizontal.

```
Browser (konter/back-office, LAN)
  │  Server Actions / rute API tipis
  ▼
src/app/app/**            halaman per modul (force-dynamic)
src/server/actions/*.ts   aksi: "use server" + Zod + requirePermission(InModule) + guard()
src/server/<domain>/      logika domain murni (menerima tx Drizzle)
src/lib/*.ts              primitif bersama (uang, izin, modul, offline, payroll)
src/db/tenant.ts          withCompany / withCompanyReadOnly — corong RLS
src/db/schema.ts          skema Drizzle (satu berkas, ±2.915 baris, 100 tabel)
PostgreSQL 18             uuidv7() native · RLS per company_id · append-only triggers
```

## 2. Keputusan struktural yang terbukti (jangan diutak-atik tanpa alasan)

Hasil audit Graphify (graf akhir diperbarui di T8; audit Fase 1: 5.814
node / 21.792 edge / 0 siklus impor) menunjukkan kopling berbentuk
**bintang ke primitif bersama**, bukan jaring antar-modul:

1. **Gerbang jurnal tunggal `postJournal`** (`src/server/accounting.ts`).
   Setiap rupiah dari semua modul melewati satu titik yang menegakkan
   keseimbangan debit=kredit + `assertPeriodOpen`. Pembaliknya juga dari
   sana (`reverseJournalEntry`/`reverseSourceJournal`). Jurnal terposting
   append-only — koreksi hanya reversal.
2. **Corong tenant `withCompany`/`withCompanyReadOnly`.** Semua kueri
   tabel ber-`company_id` melewati dua fungsi ini yang menyetel
   `app.company_id` untuk RLS PostgreSQL. Tidak ada jalur data tenant di
   luar keduanya (terbukti di graf: gabungan 619 edge pada Fase 1).
3. **Primitif uang tunggal.** Uang disimpan `numeric(19,4)` sebagai string;
   aritmetika hanya lewat Decimal.js (`d()`/`toDb()` di `src/lib/money.ts`);
   tampilan hanya lewat `formatIDR()`; input hanya lewat `MoneyInput`
   (kontrak ketik `parseTypedMoneyText` — titik saat mengetik adalah
   ribuan, koma satu-satunya desimal; kontrak tempel/commit
   `parseMoneyText` terpisah dan tidak berubah sejak A-23 S1).
4. **Dua buku besar append-only.** General Ledger (`journal_entries`/
   `journal_lines`) dan Stock Ledger (`stock_movements`, ditegakkan
   trigger). `stock_on_hand` adalah materialisasi yang wajib selalu sama
   dengan Σ `stock_movements` (terverifikasi SQL mentah di T7: 0 selisih
   dua arah).
5. **Ringkasan saldo bulanan** (`account_monthly_balances`, migrasi 0046)
   dipelihara di `postJournal` — laporan tidak lagi memindai seluruh
   riwayat (neraca saldo 12 bulan: 455 → 31,6 ms, FIX-ARS). Assertion
   konsistensi ringkasan == agregat jurnal: 0 selisih (T7).
6. **Ratchet jalur baca (ARS1-01).** Halaman hanya boleh (a) memanggil
   fungsi baca bernama dari modul server pemiliknya, atau (b) kueri
   inline satu tabel tanpa join/agregasi di dalam `withCompany*`.
   Ditegakkan `tests/unit/architecture-read-paths.test.ts` — pengecualian
   hanya lewat peta `EXCEPTIONS` beralasan tertulis di test itu.
7. **Pemetaan akun sebagai Configuration Engine.** Jurnal otomatis semua
   modul dibentuk dari pemetaan akun per perusahaan (`account_mappings`)
   dengan ensure-malas berpesan jelas — bukan konstanta kode. Akun khusus
   yang lahir dari program: 1180 PPN Masukan, 1210 Kredit Pemasok, 1220
   Piutang Karyawan, 2130 Utang PPh Dipotong, 4010 Diskon Penjualan,
   4020 Retur Penjualan, 6100 Beban Piutang Tak Tertagih, 6060 Beban
   Administrasi & Fee.
8. **Konfigurasi, bukan kode (D-25).** Semua parameter fiskal/regulasi &
   ambang operasional adalah konfigurasi per perusahaan, bertanggal
   efektif untuk angka regulasi, dengan saklar per komponen; komponen
   nonaktif = tidak dihitung, tidak tampil, tidak dijurnal (dibuktikan
   test per fitur).

## 3. Struktur domain (folder = pemilik)

`src/server/` dipecah per domain dengan pola berkas datar tipis sebagai
re-export dari folder domain (pola FIX-ARS T4, diselesaikan T4B):

| Domain | Folder/berkas | Isi |
|---|---|---|
| POS | `src/server/pos/` (sales, quote, returns, receivables, sessions) + `pos.ts`, `pos-offline.ts` | Penjualan, retur, sesi kas, antrean offline & sinkronisasi |
| Gudang | `src/server/inventory/` (receipts, movements, opname, adjustments, transfers, documents) + `supplier-returns/`, `reservations.ts`, `serials.ts`, `batches.ts`, `purchasing.ts`, `purchase-requests.ts` | Stok AVCO, penerimaan, opname, retur pemasok |
| Akuntansi | `src/server/accounting.ts`, `reports/` (arap, cash-sessions, control, home, inventory, journal, ledger, overview, periods, sales), `payables.ts`, `party-credits.ts`, `party-writeoffs.ts`, `payment-fees.ts`, `payment-deductions.ts`, `bank-reconciliation.ts`, `bank-transfers.ts`, `expenses.ts`, `fixed-assets.ts`, `opening-balances.ts`, `year-end-closing.ts` | Jurnal, laporan, utang/piutang, rekonsiliasi, aset, tutup buku |
| HR | `src/server/hr/` (attendance, drafts, employees, final-pay, leave, org, overtime, parameters, reads) + `hr.ts`, `payroll-indonesia.ts`, `employee-advances.ts`, `employee-loans.ts`, `reimbursements.ts` | Karyawan, presensi, cuti, lembur, payroll Indonesia, kasbon/pinjaman/klaim |
| Platform | `src/server/actions/` (satu berkas per wilayah aksi), `master-data.ts`, `catalog.ts`, `import-*.ts`, `sequences.ts`, `idempotency.ts`, `audit.ts`, `palette.ts`, `member-permissions.ts`, `quick-entry.ts` | Master data, impor, penomoran, idempotensi, audit log, Catat Transaksi |

**Kepemilikan aksi (T2/CB-A2):** aksi server payroll & keluarga HR tinggal
di `src/server/actions/hr.ts` (+ berkas kasbon/pinjaman/klaim), bukan di
berkas akuntansi; 33 gerbang aksinya bermodul `hr`. Re-export lintas
berkas `"use server"` tidak dipakai (terbukti mustahil di Turbopack) —
pemanggil mengimpor dari berkas pemiliknya langsung.

Berkas yang **sengaja tidak dipecah**: `src/db/schema.ts` — satu skema
Drizzle memang idiomnya satu berkas; risikonya dikelola lewat migrasi
aditif & test cakupan seed (`seed-reset-coverage`).

## 4. Lapis presentasi

- **Cangkang modul** (`ModuleShell`, sidebar berkelompok per modul, nav
  tersaring izin ∩ saklar perusahaan): modul `pos`, `gudang`, `akuntansi`,
  `hr` (`ModuleKey` di `src/lib/modules.ts`). Pengaturan memakai cangkang
  sendiri (T1) — bukan tamu modul mana pun.
- **Pendaratan sadar peran** (`src/lib/landing.ts`): pengguna satu modul
  mendarat langsung di modulnya; beranda menyaring statistik & pintasan
  per modul terjangkau (tidak membocorkan angka keuangan ke peran
  terbatas).
- **Gerbang halaman seragam**: `requirePermissionPage` memantulkan ke
  beranda dengan `ForbiddenBanner` bersama — penolakan tidak pernah
  tampil sebagai halaman rusak. Aksi server tetap melempar (untuk
  `guard()`), dua lapis yang tidak dicampur.
- **Komponen bersama** (`src/components/blocks/` dkk.): `GateNotice` +
  `src/lib/form-gate.ts` (tiga cabang jujur: formulir / prasyarat hilang /
  mode lihat), `ReportDocument` untuk semua laporan, `MoneyInput`,
  `StatusBadge`/`StatCard`, palet perintah Ctrl+K tersaring peran
  (`src/lib/palette.ts` + pencarian entitas tergating server).
- Bahasa visual: compact ala Odoo — skala huruf kecil, tabel padat, palet
  redup; satu pola per jenis layar (daftar, form dokumen, dialog
  pembayaran, laporan).

## 5. Keamanan & integritas

- **Autentikasi** Better Auth; sesi membawa `CompanyContext` hasil
  `requireAuth()` (izin & modul terlarut dari peran bawaan
  `BUILTIN_ROLES` di `src/lib/permissions.ts` atau peran kustom
  `company_roles` — peran kustom tidak pernah ditimpa template).
- **Otorisasi dua lapis**: visibilitas (nav/beranda tersaring) + penegakan
  server (`requirePermission(InModule)` di setiap aksi; aksi payroll
  mengikuti saklar modul pemiliknya).
- **RLS PostgreSQL** per `company_id` di semua tabel bisnis; dua peran DB:
  `DIRECT_URL` = pemilik skema (`erp`, hanya migrasi/seed), `DATABASE_URL`
  = `app_user` (runtime, terikat RLS).
- **Idempotensi**: kunci idempotensi wajib pada checkout & form dokumen
  uang; pengiriman ulang menghasilkan `duplicate`, bukan dokumen ganda —
  termasuk sinkronisasi offline.
- **Audit log** (`writeAudit`, tabel `audit_log` append-only) mencatat
  pelaku untuk tindakan konsekuensial (diskon di atas ambang, void,
  penyesuaian, perubahan master & pengaturan).
- **Kegagalan keras di awal**: validasi env fail-fast, logger JSON,
  `/api/health` (status DB + migrasi terakhir), format error terpusat di
  `guard()` (termasuk ZodError berbahasa pengguna).

## 6. Penyebaran & operasi

Satu artefak rilis, dua jalur resmi (keputusan Pemimpin T5):

1. **Docker Compose produksi** — Dockerfile standalone + compose;
   migrasi eksplisit. *Batas jujur: runtime Compose NOT TESTED di
   lingkungan program (daemon tidak berjalan di VM bersarang); berkas
   tervalidasi statis.*
2. **install.sh + systemd** — rilis berversi + symlink `current`;
   urutan update: backup → migrasi → cek `/api/health`; rollback =
   restore backup. Jalur ini **terbukti penuh** di T5 (install bersih,
   login, 5 halaman modul 200).

Backup otomatis: systemd timer menjalankan dump terjadwal; round-trip
restore terverifikasi identik (T5/SIM-2 S5). Runbook non-teknisi:
`docs/RUNBOOK-INSTALASI-PRODUKSI.md`, `docs/RUNBOOK-BACKUP-RESTORE.md`.

## 7. Keadaan terverifikasi pada penutupan A-24

Suite 1540 test (161 berkas) + e2e 19; migrasi sampai 0054; matriks fungsi
61/61 LULUS (T7, `docs/TESTING_REPORT.md`). Sisa arsitektur yang diakui &
bukan tahap: ekspor CSV dibangun sebagai string di memori (batas skala
ekspor, PERF-02), siklus tipe `permissions.ts ↔ modules.ts` (runtime
bersih — 0 siklus di graf), dependensi `xlsx` (keputusan pemilik §3
butir 19), CI GitHub menunggu remote (keputusan pemilik §3 butir 9).
