# Panduan Pengembangan — Bisa ERP

**Dokumen resmi program A-24 (ditulis di T8, 2026-11-06).** Untuk
pengembang yang merawat sistem ini sesudah program A-24. Aturan yang
mengikat & ditegakkan mesin ada di `AGENTS.md` proyek (dibaca mesin di
setiap sesi) — dokumen ini menjelaskan *cara kerja* di atas aturan itu:
perintah, pola penulisan, pola pengujian, dan pola program perbaikan.

## 1. Menjalankan secara lokal

Prasyarat: Node 24, pnpm 11, PostgreSQL 18 (wajib — `uuidv7()` native).

```bash
pnpm install
cp .env.example .env.local   # isi DIRECT_URL (pemilik skema) & DATABASE_URL (app_user, RLS)
pnpm db:migrate              # drizzle-kit tidak membaca .env.local sendiri:
                             #   set -a; . ./.env.local; set +a  sebelum pnpm db:*
pnpm db:seed                 # idempoten; menolak bila data sudah ada
pnpm db:seed -- --force      # reset + tanam ulang demo (DESTRUKTIF)
pnpm dev                     # atau pnpm build && pnpm start
```

Login demo: `owner@bisa.id` / `Bisa12345!` (pemilik "Nadia Putri").
Baseline demo yang harus selalu kembali persis sesudah reseed:
**65 produk, nilai persediaan Rp28.349.600, consistency 11/11.**

Server produksi lokal untuk bukti manual memakai flag
`BISA_ALLOW_LOCALHOST_AUTH_URL=1` (validasi env menolak BETTER_AUTH_URL
localhost tanpa flag — itu disengaja, jangan dilonggarkan di kode).

## 2. Gerbang kualitas (tanpa pipa penutup)

```bash
pnpm test          # vitest: unit + integration + sim2 (161 berkas, 1540 test pada penutupan A-24)
pnpm typecheck     # tsc --noEmit (strict)
pnpm lint          # eslint (0 error; warning lama tercatat)
pnpm build         # next build
pnpm test:e2e      # playwright: build produksi + server sendiri di port 3000 (harus bebas)
```

**Aturan besi program:** jangan pernah menutup perintah gerbang dengan
pipa (`| tail` dkk.) — pipa menutupi exit code dan pernah menghasilkan
klaim lulus yang salah. Tangkap exit code per perintah (arahkan ke log,
lalu baca `EXIT=$?`). Klaim "selesai/lulus" hanya sesudah keluaran
gerbang dibaca pada larian itu juga.

## 3. Pola menulis kode

- **Halaman** (`src/app/app/**/page.tsx`): `export const dynamic =
  "force-dynamic"`. Data hanya lewat (a) fungsi baca bernama dari modul
  server pemilik, atau (b) kueri inline satu tabel tanpa join/agregasi
  dalam `withCompany*` — ditegakkan ratchet
  `tests/unit/architecture-read-paths.test.ts`. Pengecualian sah hanya
  lewat peta `EXCEPTIONS` di test itu dengan alasan tertulis.
- **Aksi server** (`src/server/actions/*.ts`): mulai `"use server"`,
  semua ekspor fungsi async; pola tetap: Zod → `requirePermission` /
  `requirePermissionInModule` → panggil domain dengan `tx` → bungkus
  `guard(...)`. Domain tidak tahu-menahu soal sesi/HTTP.
- **Domain** (`src/server/<domain>/`): fungsi menerima `tx` Drizzle,
  melempar `AppError` berkode, menulis audit via `writeAudit` untuk
  tindakan konsekuensial. Logika uang selalu Decimal (`d()`/`toDb()`),
  tidak pernah aritmetika `number`.
- **Jurnal baru** hanya lewat `postJournal` (atau pembentuk jurnal
  domain yang memanggilnya); koreksi hanya reversal. **Gerakan stok
  baru** hanya lewat domain inventory agar invariant
  `stock_on_hand = Σ movements` terjaga.
- **Fitur finansial baru** mengikuti pola D-25: konfigurasi per
  perusahaan + saklar, bawaan mati/netral, komponen nonaktif terbukti
  tidak dihitung/ditampil/dijurnal oleh test.
- **UI:** shadcn v4 Base UI (prop `render`, bukan `asChild`); utamakan
  `<select>` native, tautan biasa, `buttonVariants`. Komponen bersama
  di `src/components/blocks/` — satu komponen per konsep (MoneyInput,
  GateNotice, ReportDocument, StatusBadge). Bahasa visual compact ala
  Odoo dipertahankan; halaman baru menunjuk pola layar yang diikuti
  (daftar/form dokumen/dialog pembayaran/laporan).
- **Wilayah terlarang tanpa izin tertulis pemilik:** terminal POS
  (`src/app/app/pos/**`, `src/components/pos/**`) sejak 2026-11-05.

## 4. Pola menulis test

- **Perusahaan fixture khusus per berkas** untuk test integrasi yang
  menulis — perusahaan demo bersama menyimpan residu lintas sesi bukti.
  Kegagalan delta kecil yang lulus terisolasi adalah pola kontaminasi
  yang dikenal: verifikasi dengan reseed + larian terisolasi sebelum
  menyimpulkan regresi.
- **TDD untuk cacat:** reproduksi sebagai test merah dulu (RED), perbaiki
  akar (GREEN), lalu gerbang penuh. Penyesuaian test lama selalu
  dinyatakan dengan alasannya — tidak ada test yang dilemahkan diam-diam.
- **Penanda migrasi** di `tests/unit/health.test.ts` menempel pada
  migrasi terakhir; geser penandanya setiap migrasi baru (itu perawatan,
  bukan pelemahan).
- **Menguji input uang:** ketik digit-per-digit seperti manusia
  (pelajaran SIS-01) — `fill()` sekaligus tidak membuktikan kontrak
  ketik.
- **Menguji peran:** buat pengguna lewat UI Pengaturan + skrip
  Playwright; login UI berulang terkena rate-limit Better Auth.
- e2e memakai storageState `e2e/.auth/user.json` (dibuat proyek `setup`);
  reseed membatalkan sesi lama → buat ulang storageState.

## 5. Berkas besar & peta bahaya

- `src/db/schema.ts` (±2.915 baris) — jangan dipecah; perubahan di sini
  berdampak ke semua modul: TDD penuh + migrasi aditif.
- `src/lib/money.ts` (`d()`, god node graf) & `src/db/tenant.ts`
  (`withCompany*`) — primitif paling terhubung di graf; sentuh hanya
  dengan gerbang penuh.
- Memetakan dampak perubahan: Graphify terpasang global —
  `graphify update .` lalu `graphify affected "<simpul>" --graph
  graphify-out/graph.json` sebelum refactor besar (graf ter-gitignore,
  bangun ulang bebas).

## 6. Penyebaran & pemeliharaan

- Rilis & dua jalur pemasangan: `docs/ARCHITECTURE.md` §6,
  `deploy/build-release.sh`, `deploy/install.sh`, unit systemd di
  `deploy/systemd/`. Runbook operator: `docs/RUNBOOK-INSTALASI-
  PRODUKSI.md` & `docs/RUNBOOK-BACKUP-RESTORE.md`.
- Update produksi mengikuti urutan tertulis: backup → migrasi → cek
  `/api/health` → baru trafik; rollback = restore backup (jujur, bukan
  migrasi mundur).
- `/api/health` melaporkan status DB + migrasi terakhir terapan —
  jadikan pemeriksaan pertama setiap laporan "sistem rusak".

## 7. Pola program perbaikan (warisan A-15…A-24)

Sistem ini dirawat lewat **program bertahap beraudit**: riset/audit
berbukti → rencana ber-centang tertulis → satu tahap satu waktu di satu
pohon kode → agen pelaksana tidak commit → pemimpin memverifikasi diff,
menjalankan ulang gerbang, memeriksa bukti visual dengan mata sendiri →
commit atomik per tahap → status resmi di `PROGRESS.md`, indeks di
`IMPLEMENTATION_PLAN.md`, perubahan di `docs/CHANGELOG.md`. Keputusan
yang hanya pemilik bisa ambil dikumpulkan di satu daftar
(`docs/rombak/RENCANA.md` §3) dan tidak pernah dieksekusi diam-diam.
Label PARTIAL/NOT TESTED hanya dicabut oleh bukti pada lingkungan
nyatanya.
