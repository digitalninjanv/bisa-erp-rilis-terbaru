# Inventarisasi Teknologi Aktual — Program Rekayasa R0

> Dibuat 2026-11-08 (Tahap R0). Sumber kebenaran: `package.json` +
> `pnpm-lock.yaml` (versi *resolved*, bukan rentang specifier),
> berkas konfigurasi repo, dan kode. Tanpa perubahan kode.
> Pendamping: `docs/rekayasa/MATRIKS-GAP.md`; bahan riset:
> `~/workspace/research_notes/erp-stack-official-docs-best-practices-20261108-0530/report.md`.

## 1. Versi dependensi kunci (resolved dari lockfile)

| Teknologi | Specifier (package.json) | Resolved (pnpm-lock.yaml) | Catatan |
|---|---|---|---|
| Next.js | `16.4.3` (pin persis) | **16.4.3** | Dokumen resmi sudah di 16.4.5 — lihat baris N-14 matriks |
| eslint-config-next | `16.4.3` | 16.4.3 | Selaras dgn Next |
| React / React DOM | `19.3.0` (pin persis) | **19.3.0** | |
| TypeScript | `^5` | **5.9.3** | `tsconfig.json`: `strict: true`; `noUncheckedIndexedAccess` & `exactOptionalPropertyTypes` **tidak aktif**; target ES2017, moduleResolution bundler, plugin next |
| Drizzle ORM | `^0.45.4` | **0.45.4** | |
| drizzle-kit | `^0.31.5` | **0.31.11** | `drizzle.config.ts`: schema `./src/db/schema.ts`, out `./src/db/migrations`, dialect postgresql, kredensial `DIRECT_URL ?? DATABASE_URL`, `verbose+strict: true` |
| postgres.js | `^4.0.0` | **4.0.0** | Pool di `src/db/index.ts`: `max: 12, idle_timeout: 20, connect_timeout: 10`; `prepare` **tidak disetel** (bawaan postgres.js = true); koneksi langsung (tanpa pooler mode-transaksi di repo) |
| Better Auth | `^1.7.15` | **1.7.15** | Konfigurasi `src/lib/auth.ts` — rincian §2 |
| Zod | `^4.6.7` | **4.6.7** | **Definitif: Zod mayor 4.** (Menutup pertanyaan terbuka riset #7 — baris Zod adalah idiom, BUKAN migrasi.) |
| Decimal.js | `^10.6.0` | **10.6.0** | Satu konfigurasi global: `src/lib/money.ts:3` `Decimal.set({precision: 30, rounding: ROUND_HALF_UP})` |
| Tailwind CSS | `^4` | **4.3.3** | + `@tailwindcss/turbopack` 4.3.3; CSS-first: `globals.css` memakai `@import "tailwindcss"` + `@theme inline` |
| Base UI | `@base-ui/react ^1.9.0` | **1.9.0** | shadcn **4.23.0**, `components.json`: style `base-nova`, `cssVariables: true`, tailwind.config kosong — sesuai pola Tailwind v4 |
| Sonner | `^2.0.8` | 2.0.8 | Pengganti toast terdepresiasi — sudah dipakai |
| tw-animate-css | `^1.4.0` | 1.4.0 | Pengganti tailwindcss-animate — sudah dipakai |
| Vitest | `^5.0.5` | **5.0.5** | `vitest.config.mts`: environment node, include `tests/**/*.test.ts`, `fileParallelism: false`, timeout 60 dtk |
| Playwright | `@playwright/test ^1.57.0` | **1.64.1** | `playwright.config.ts`: proyek `setup` + `chromium` (dependencies), `workers: 1`, `fullyParallel: false` |
| Tauri | CLI/API `^2.12.4` (devDeps root) | **2.12.4** | Rust: `tauri = "2"`, `tauri-plugin-updater = "2"` (`src-tauri/Cargo.toml`); aplikasi `id.bisa.pos` v0.1.0 |
| Node (mesin ini) | — | **v24.22.1** | ≥ 20.9 yang disyaratkan Next 16 |
| Package manager | `pnpm@11.8.0` (packageManager) | — | |
| Lain terpasang | next-themes 0.4.6 · recharts 3.8.0 · date-fns 4.4.0 · cmdk 1.1.1 · qrcode 1.5.4 · lucide-react 1.66.0 · xlsx 0.20.3 (tarball CDN ter-pin, integrity di lockfile — AUD-012) | | |

## 2. Konfigurasi relevan

- **Next** (`next.config.ts`): `output: "standalone"`, `cacheComponents: false`
  (keputusan sadar, juga tertulis di AGENTS.md: halaman ERP request-time),
  header keamanan global dari AUD-014 (CSP konservatif + HSTS + nosniff +
  frame-ancestors), header khusus `/pos-sw.js` no-store. **Tidak ada
  `middleware.ts` dan tidak ada `proxy.ts`** di repo.
- **Better Auth** (`src/lib/auth.ts`): adapter Drizzle; email+password
  `minPasswordLength: 8`, `disableSignUp: true`, `autoSignIn: true`;
  sesi `expiresIn` 7 hari / `updateAge` 1 hari (persis bawaan resmi);
  rate limit eksplisit (jendela 10 dtk/100 umum; `/sign-in/email` 10/60 dtk),
  penyimpanan **memori per instance** (komentar kode menyatakannya sebagai
  batasan yang disadari); plugin hanya `twoFactor()` (tanpa opsi —
  `skipVerificationOnEnable` tidak disetel) dan `nextCookies()`.
  Plugin `admin`/`organization` **sengaja dicabut** (SEC-02 SIM-2: model
  otorisasi kedua yang tak terpakai; perusahaan/keanggotaan dikelola
  aplikasi lewat tabel sendiri). `cookieCache` tidak dikonfigurasi
  (bawaan: mati). `freshAge` tidak disetel eksplisit. ID auth dibuat
  `crypto.randomUUID()` (`advanced.database.generateId`).
- **Tenant/DB** (`src/db/tenant.ts`): `withCompany`/`withCompanyReadOnly`
  membuka `db.transaction` (isolasi bawaan Drizzle/PG = Read Committed;
  tidak ada `isolationLevel` di seluruh repo) lalu
  `set_config('app.company_id', …, true)` di dalam transaksi yang sama.
  `withCompanyReadOnly` menambahkan `set transaction read only`.
  RLS: migrasi 0001 mengaktifkan + **FORCE ROW LEVEL SECURITY** pada semua
  tabel ber-`company_id`, kebijakan `tenant_isolation` =
  `company_id = app_company_id()`; `app_company_id()` adalah fungsi SQL
  **STABLE** yang membaca `current_setting('app.company_id')`.
  Peran aplikasi `app_user` (bukan pemilik skema) — lihat AGENTS.md.
- **Skema**: `src/db/schema/` 10 berkas domain; ±108 deklarasi indeks
  (`index(...)` terhitung grep per berkas skema); migrasi terakhir 0065.
- **Desktop** (`src-tauri/`): capabilities per jendela —
  `default.json` (jendela utama) dan `display.json` (layar pelanggan),
  keduanya seminimal yang sama (`core:default` +
  `core:event:allow-listen`), tanpa fs/http/shell. `tauri.conf.json`:
  `app.security.csp = null`; override `tauri.linux.conf.json` /
  `tauri.windows.conf.json` tidak menyetel CSP. Updater: pubkey minisign
  tertanam di conf, `createUpdaterArtifacts: true`, `endpoints: []`
  (dibangun runtime per terminal); kunci privat + kata sandi + README
  kustodi ada di `~/workspace/pos-native-keys/` (di luar repo).
- **Testing**: e2e memakai proyek setup Playwright + `storageState`
  `e2e/.auth/user.json`; `.gitignore` memuat `/e2e/.auth/` ✓.
  Integrasi Vitest berjalan terhadap DB dev nyata dgn transaksi rollback
  (AGENTS.md) dan `fileParallelism: false`.

## 3. Fakta penentu utk matriks

- `revalidateTag`: **0 pemakaian** di `src/`; pola revalidasi tunggal =
  `revalidatePath` (aksi POS/pengguna/pembelian dst.).
- Akses async Next 16: 70 pemakaian `params: Promise`/`searchParams: Promise`
  di `src/app`; `cookies()`/`headers()` hanya di `src/lib/session.ts` &
  `src/server/actions/company.ts`, ter-`await`.
- Relational Query Builder Drizzle (`db.query.*`/`tx.query.*`): **0 pemakaian**
  — semua baca adalah core select; jalur baca diatur aturan ARS1-01 +
  penjaga `architecture-read-paths`.
- Kunci baris eksplisit `.for("update")` tersebar di jalur posting:
  `inventory/movements.ts` (kunci `stock_on_hand`), `inventory/documents.ts`,
  `pos/sales-create.ts`, `pos/returns.ts`, `accounting.ts` (periode),
  `purchasing.ts`, `batches.ts`, `serials.ts`, HR advances/loans, dst.
  Tidak ada `pg_advisory_*` di kode.
- Zod: idiom yang ditemukan `z.string().uuid()` dsb. (gaya v3 yang tetap
  berfungsi di v4); **nol** pemakaian API yang dihapus v4
  (`invalid_type_error`/`required_error`/`errorMap`/`.format()` pada error);
  format error dirawat sendiri (`formatZodIssues` atas `error.issues`,
  `src/lib/action-validation.ts`, `src/lib/errors.ts`). `z.email()`/
  `treeifyError`/`toJSONSchema`: belum dipakai.
- Batas kesalahan: `src/app/app/error.tsx` ada; `src/app/error.tsx` dan
  `src/app/global-error.tsx` **tidak ada**.
- `getSessionCookie` (pemeriksaan eksistensi saja): **0 pemakaian** —
  sesi divalidasi server lewat DAL `src/lib/session.ts` (`server-only` +
  React `cache()`).
