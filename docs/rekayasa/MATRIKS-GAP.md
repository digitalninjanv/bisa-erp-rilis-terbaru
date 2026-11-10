# Matriks Gap Berbasis Dokumentasi Resmi — Program Rekayasa R0

> Dibuat 2026-11-08 (Tahap R0, tanpa perubahan kode). Format mandat pemilik:
> Area | Dokumentasi/metode terbaik | Implementasi saat ini | Gap | Rekomendasi.
> Bukti implementasi dari repo pada HEAD program Audit Produksi
> (verdict CONDITIONAL GO, suite 2039/2039). Hal yang sudah dibuktikan
> Audit Produksi (cakupan izin 201/201, RLS hidup, rantai integrasi)
> **tidak diaudit ulang** — tahap ini menilai kesesuaian terhadap
> dokumentasi resmi versi terpasang. Inventaris versi:
> `docs/rekayasa/INVENTARIS-TEKNOLOGI.md`. Bahan riset:
> `~/workspace/research_notes/erp-stack-official-docs-best-practices-20261108-0530/report.md`.
>
> **Kelas**: WAJIB = cacat keamanan/kebenaran bila absen ·
> DIANJURKAN = praktik resmi, penurunan risiko nyata ·
> BELUM PERLU = situasional/belum terjustifikasi di skala ini ·
> BERISIKO = perubahan/pola itu sendiri berbahaya tanpa perlakuan khusus.
> Baris yang sudah benar ditandai **SESUAI** (bukan gap).
> Tahap usulan: R1 = pendalaman/penilaian, R3 = implementasi.

## Ringkasan hitungan

| Kelas | Jumlah baris |
|---|---|
| SESUAI (termasuk SESUAI bersyarat/keputusan sadar) | 21 |
| WAJIB | 2 |
| DIANJURKAN | 7 |
| BELUM PERLU | 6 |
| BERISIKO (sebagai tindakan) | 2 |
| **Total baris dinilai** | **38** |

## 1 · Arsitektur & Server Actions / DAL

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-01 | DAL di samping data + DTO minimal; kode server tetap server-only. Next.js Auth guide v16 — https://nextjs.org/docs/app/guides/authentication | DAL nyata: `src/lib/session.ts` (`server-only`, React `cache()`, `requireAuth/requirePermission`); aturan read-path ARS1-01 + penjaga mesin `architecture-read-paths`; domain berparameter `tx` di `src/server/*`; aksi mengembalikan hasil `guard(...)` berbentuk data tampilan (mis. tipe terminal POS di `terminal-types.ts`), bukan baris ORM mentah | Tidak ada gap struktural; pengembalian domain-object per aksi tidak diaudit satu-satu di tahap ini | **SESUAI** — pertahankan; audit DTO per-aksi hanya bila A5 kelak menemukan kebocoran bidang (AUD-013 sudah ditutup di permukaan ekspor) |
| R0-02 | Kesalahan ke klien generik + digest; rincian di log server. Next.js error handling — https://nextjs.org/docs/app/getting-started/error-handling | `guard()` satu pintu (A1): 23505 dipetakan ramah, ZodError diformat per baris, tak dikenal → log terstruktur + pesan generik | — | **SESUAI** |
| R0-03 | Jangan taruh rahasia/PII di kunci/tag cache (teks polos). Auth-with-cache-components — https://nextjs.org/docs/app/guides/authentication-with-cache-components | Cache Components mati; tidak ada cache bertag utk data tenant (revalidasi hanya `revalidatePath`) | Tidak berlaku saat ini; menjadi syarat bila Cache Components kelak diaktifkan | **SESUAI (vakum)** — catat sebagai gerbang prasyarat di baris R0-08 |

## 2 · Next.js / React

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-04 | Proxy/middleware BUKAN otorisasi; hanya pemeriksaan optimistis. Proxy guide — https://nextjs.org/docs/app/getting-started/proxy ; `middleware.ts` terdepresiasi → `proxy.ts`. Next 16 — https://nextjs.org/blog/next-16 | **Tidak ada `middleware.ts` maupun `proxy.ts`** — nol lapis proxy; otorisasi sepenuhnya di DAL/aksi (terbukti A1: 201/201 aksi berpenjaga, uji negatif peran A3) | Tidak ada utang depresiasi; tidak ada pengalihan optimistis (tamu → /login ditangani per halaman/layout) | **BELUM PERLU** — Kecil bila kelak diinginkan redirect optimistis; jangan buat proxy demi mengikuti tren. Tahap: ditolak dgn alasan (tak ada kebutuhan terbukti) |
| R0-05 | `cookies()/headers()/params/searchParams` async-only di v16. Upgrade guide — https://nextjs.org/docs/app/guides/upgrading/version-16 | 70× `params: Promise`/`searchParams: Promise`; `cookies/headers` hanya di `session.ts` & `actions/company.ts`, ter-`await`; grep akses sinkron: bersih | — | **SESUAI** |
| R0-06 | `revalidateTag(tag)` satu-argumen terdepresiasi → `revalidateTag(tag,'max')`; `updateTag()` utk read-your-writes di aksi. Next 16 — https://nextjs.org/blog/next-16 | `revalidateTag` **0 pemakaian**; pola tunggal `revalidatePath` di semua aksi (pos.ts, users.ts, purchasing.ts, …) | Tidak ada panggilan terdepresiasi; adopsi `updateTag` tak relevan tanpa cache bertag | **SESUAI** |
| R0-07 | Patch currency: pembaruan keamanan Okt 2026 utk 16.4.x; docs sudah 16.4.5. https://nextjs.org/blog/nextjs-security-update-october-14-2026 | Terpasang **16.4.3** (package.json + lockfile), dua patch di belakang 16.4.5 | Rentang versi terdampak advisory belum bisa diverifikasi dari mesin ini (offline) — tetapi berdiam di belakang patch keamanan tanpa penilaian adalah gap proses | **WAJIB (menilai) + DIANJURKAN (naik patch 16.4.5)** — Kecil–Sedang; R1 nilai advisory di CI berjaringan, R3 naik patch + gerbang penuh. Risiko perubahan rendah (patch line sama) |
| R0-08 | Cache Components direkomendasikan 16.4 sbg pilihan terbaik; konsekuensi: `'use cache'`/`cacheLife` menggantikan config segmen; sesi tak boleh di shell statis. https://nextjs.org/blog/next-16-4 ; migrasi https://nextjs.org/docs/app/guides/migrating-to-cache-components | `cacheComponents: false` eksplisit di `next.config.ts` + tertulis di AGENTS.md ("ERP pages are request-time"); semua halaman `force-dynamic` | Keputusan sadar yang konsisten dgn sifat data tenant (harga/stok tak boleh basi); mengaktifkannya = migrasi tersendiri berisiko (kebocoran antar-tenant adalah kelas risikonya) | **BERISIKO (mengaktifkan)** — Besar; **ditolak untuk sekarang dgn alasan**: manfaat tak terbukti utk halaman request-time bertenant; nilai ulang hanya bila ada halaman publik/statis yang nyata. Tahap: keputusan, bukan pekerjaan |
| R0-09 | Batas kesalahan: `error.tsx` (Client Component) & `global-error.tsx` ber-`<html>/<body>` sendiri. Error handling (URL di R0-02) | `src/app/app/error.tsx` ada; **`src/app/error.tsx` & `src/app/global-error.tsx` tidak ada** — kegagalan di luar segmen /app (login, root) jatuh ke bawaan framework tanpa bingkai aplikasi | Gap kecil nyata: pengalaman gagal tak konsisten di permukaan publik | **DIANJURKAN** — Kecil; R3: tambah keduanya mengikuti pola error.tsx yang ada |
| R0-10 | Multi-instance: semua instance berbagi `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`; `deploymentId` lawan skew versi. Self-hosting — https://nextjs.org/docs/app/guides/self-hosting | `output: "standalone"`, artefak tunggal (Docker/systemd — A-24 T5); kunci enkripsi aksi tidak dirujuk di repo/dok deployment | Aman pada topologi instance-tunggal saat ini; menjadi cacat hanya bila diskalakan horizontal tanpa kunci bersama | **SESUAI bersyarat** — syarat deployment tertulis: tetapkan kunci bersama sebelum multi-instance. Kelas: BELUM PERLU (hari ini) |
| R0-11 | Form React 19: `<form action>` + `useActionState/useFormStatus/useOptimistic`. https://react.dev/reference/react-dom/components/form | Formulir mayoritas client terkelola manual (pola lama yang teruji; `useFormState` 0 pemakaian — tak ada nama lama tersisa) | Tak ada kebocoran/kegagalan terbukti; manfaat PE marjinal utk aplikasi operasional ber-login | **BELUM PERLU** — adopsi insidental saat menyentuh form, bukan program |

## 3 · Database / Drizzle / PostgreSQL 18

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-12 | Semua tulis multi-pernyataan dalam satu transaksi; lempar = rollback. Drizzle transactions — https://orm.drizzle.team/docs/transactions | `withCompany` selalu membuka `db.transaction`; posting jurnal/stok di domain ber-`tx`; terbukti rantai A2 (nol posting setengah) | — | **SESUAI** |
| R0-13 | Isolasi dipilih sadar: di Read Committed, aturan check-then-write wajib kunci eksplisit; RR berisiko write skew. PG 18 — https://www.postgresql.org/docs/18/transaction-iso.html ; konsistensi aplikasi PG — https://www.postgresql.org/docs/17/applevel-consistency.html | Tidak ada `isolationLevel` di repo → semua transaksi **Read Committed**; kompensasinya nyata & tersebar: `.for("update")` pada `stock_on_hand` (`inventory/movements.ts:67,129,368`), dokumen stok, penjualan/retur POS, periode akuntansi, PO, batch, seri; terbukti uji konkurensi A3 (5 penjualan bersamaan stok tepat) | Pola benar tetapi *implisit*: tak ada dokumen yang menyatakan "RC + kunci baris adalah strategi isolasi kita" — pengembang baru bisa menulis check-then-write tanpa kunci | **SESUAI (pola) + DIANJURKAN (dokumentasikan)** — Kecil; R1/R3: satu paragraf ADR di AGENTS.md/rujukan domain. Bukan menaikkan isolasi global (BERISIKO: SSI/RR mengubah profil deadlock seluruh posting) |
| R0-14 | Kunci advisory utk eksklusi tingkat aplikasi (satu run per periode dsb.). PG explicit locking (verify-first per riset) | Nol `pg_advisory_*`; eksklusi dicapai via kunci baris periode (`accounting.ts:254`, `actions/accounting/periode.ts:60`) & baris tahanan POS | Tidak ada kebutuhan yang tak tercakup kunci baris saat ini | **BELUM PERLU** |
| R0-15 | RQB: satu kueri utk baca bersarang; agregasi tetap core/SQL. https://orm.drizzle.team/docs/rqb | `db.query.*`/`tx.query.*`: **0 pemakaian** — semua baca core select + fungsi baca bernama per ARS1-01 (penjaga arsitektur menegakkan) | Bukan gap: RQB tak mendukung agregasi yang justru dominan di laporan; pola sekarang teruji & terjaga mesin | **BELUM PERLU** — ditolak dgn alasan (pola read-path repo adalah keputusan arsitektur yang ditegakkan test) |
| R0-16 | Prepared statements efisien; TETAPI `prepare: false` wajib di depan pooler mode-transaksi. https://orm.drizzle.team/docs/perf-queries ; https://orm.drizzle.team/docs/get-started/supabase-existing | postgres.js tanpa setelan `prepare` (bawaan true) di `src/db/index.ts`; pool `max 12`; koneksi **langsung** ke PG (DIRECT/DATABASE_URL, tanpa PgBouncer di repo) | Benar utk topologi kini; jebakan terdokumentasi hanya muncul bila deployment menambah pooler mode-transaksi | **SESUAI bersyarat** — syarat deployment tertulis: pooler mode-transaksi ⇒ `prepare: false`. Kelas: BELUM PERLU (hari ini) |
| R0-17 | RLS: indeks kolom filter kebijakan; bungkus fungsi per-pernyataan dalam `(select …)` agar jadi InitPlan; tentukan peran. Supabase PG RLS performance — https://supabase.com/docs/guides/database/postgres/row-level-security-performance ; semantik PG — https://www.postgresql.org/docs/18/ddl-rowsecurity.html | Kebijakan: `company_id = app_company_id()` — fungsi STABLE dibaca dari `current_setting`, dipanggil **telanjang** (bukan `(select app_company_id())`), tanpa klausa `TO` (berlaku PUBLIC; peran aplikasi memang tunggal); FORCE RLS aktif; indeks: ±108 deklarasi indeks skema termasuk kolom tenant pada tabel inti | Bentuk kebijakan pra-InitPlan: pada tabel besar planner dapat menilai fungsi per-baris; berdampak performa, bukan kebenaran (RLS hidup terbukti A1/A3). Besaran manfaat = benchmark vendor, belum diukur di sini | **DIANJURKAN** — Sedang; R1: ukur EXPLAIN ANALYZE pada 2–3 tabel terbesar (dari bench A3) sebelum menyentuh migrasi; R3 hanya bila terukur |
| R0-18 | Migrasi versi `generate`+`migrate`; `push` hanya prototipe. https://orm.drizzle.team/docs/migrations | `db:generate`/`db:migrate` di package.json; 66 migrasi ter-commit (terakhir 0065); `strict: true` di drizzle.config; aturan repo melarang edit migrasi terterap | — | **SESUAI** |
| R0-19 | Pencarian fuzzy: indeks GIN `pg_trgm` utk ILIKE/`%`. https://www.postgresql.org/docs/current/pgtrgm.html | Sudah terdaftar **AUD-022** (A3): pencarian teks produk Seq Scan ILIKE 17–23 ms pada 10 rb produk, linear thd katalog | Gap performa terukur, bukan kebenaran; diwarisi dari register audit | **DIANJURKAN** — Sedang; tahap mengikuti register AUD-022 (R3 bila diprioritaskan pemilik program) |
| R0-20 | `uuidv7()` PG 18 utk lokalitas indeks pada tabel sisipan-tinggi. https://www.postgresql.org/about/press/presskit18/ | Tabel bisnis memakai `uuidv7()` native (aturan repo + A0); pengecualian: ID tabel auth dari `crypto.randomUUID()` (`auth.ts advanced.database.generateId`) | Pengecualian berdampak kecil (tabel auth bukan ledger sisipan-tinggi) | **SESUAI** — catatan INFO saja |

## 4 · Auth / Keamanan (Better Auth 1.7.15 + OWASP ASVS 5.0)

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-21 | Sesi: bawaan 7 hari/1 hari; `freshAge` menggerbang operasi sensitif. https://better-auth.com/docs/concepts/session-management | `expiresIn` 7 hari + `updateAge` 1 hari persis bawaan; **`freshAge` tidak disetel** — operasi sensitif aplikasi (ganti peran, void, pembayaran) digerbang izin aplikasi, bukan kesegaran sesi | Selisih dari pola resmi: sesi curian berumur < 1 hari lolos operasi sensitif tanpa autentikasi ulang | **DIANJURKAN** — Kecil; R1 nilai titik sensitif mana yang layak fresh-session (manajemen pengguna/peran), R3 terapkan terarah — bukan global |
| R0-22 | Cookie cache: lag pencabutan terdokumentasi; matikan/persingkat utk operasi sensitif. (URL di R0-21) | `cookieCache` **tidak dikonfigurasi** → bawaan mati; sesi selalu divalidasi DB lewat DAL | — | **SESUAI** |
| R0-23 | Org plugin: bawaan siapa pun bisa membuat organisasi → batasi `allowUserToCreateOrganization`. https://better-auth.com/docs/plugins/organization | Plugin organization **dicabut seluruhnya** (SEC-02 SIM-2, komentar beralasan di `auth.ts`); tak ada endpoint pembuatan organisasi; perusahaan dibuat jalur aplikasi berizin | Lebih kuat dari rekomendasi (permukaan diserang tidak ada) | **SESUAI (melampaui)** |
| R0-24 | Rate limit: penyimpanan memori tak cocok multi-instance → database/sekunder; kunci IP dari X-Forwarded-For bisa dipalsukan tanpa konfigurasi proksi tepercaya. https://better-auth.com/docs/concepts/rate-limit | Eksplisit: umum 10 dtk/100; `/sign-in/email` 10/60 dtk (contoh resmi 3/10 dtk — lebih longgar); penyimpanan **memori** (disadari di komentar kode); tak ada `advanced.ipAddress`/trustedProxies | Aman utk instance-tunggal di belakang proksi yang menimpa XFF; dua syarat deployment belum tertulis sbg gerbang | **DIANJURKAN** — Sedang; R3 bila multi-instance/proksi berubah: storage database + aturan sign-in diperketat + konfigurasi sumber IP. Hari ini: catat syarat |
| R0-25 | Integrasi Next: jangan gerbang dgn `getSessionCookie` (eksistensi saja); pasang `nextCookies` agar Set-Cookie dari aksi tak hilang. https://better-auth.com/docs/integrations/next | `getSessionCookie`: **0 pemakaian**; `nextCookies()` terpasang di `plugins` `auth.ts`; validasi sesi server penuh di DAL | — | **SESUAI** |
| R0-26 | 2FA: `skipVerificationOnEnable: true` mengalahkan verifikasi pendaftaran — jangan. https://better-auth.com/docs/plugins/2fa | `twoFactor()` tanpa opsi → verifikasi TOTP wajib sebelum aktif (bawaan aman) | Kewajiban 2FA per peran (admin/owner) adalah keputusan kebijakan pemilik (sejajar AUD-018) | **SESUAI (mekanisme)** — mandat per-peran: BELUM PERLU diputuskan di tahap ini, serahkan ke daftar keputusan pemilik |
| R0-27 | Peta kontrol memakai penomoran ASVS 5.0 (V2/V6/V7/V8/V11), bukan 4.0.3. https://owasp.org/projects/asvs | Register audit repo memakai ID AUD sendiri; riset & laporan A28 memakai rujukan OWASP tanpa penomoran bab lama yang mengikat | — | **SESUAI** |

## 5 · Frontend / TypeScript / Zod / Decimal

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-28 | Tailwind v4 CSS-first: `@import "tailwindcss"`, token `@theme`, `@utility`; shadcn v4: `@theme inline` + cssVariables. https://tailwindcss.com/docs/upgrade-guide ; https://ui.shadcn.com/docs/tailwind-v4 | `globals.css`: `@import "tailwindcss"` + `tw-animate-css` + `@theme inline` memetakan variabel semantik; `components.json` style `base-nova`, `cssVariables: true`, config JS kosong; prop `render` Base UI per AGENTS.md | — | **SESUAI** |
| R0-29 | Deprekasi shadcn: toast→Sonner, tailwindcss-animate→tw-animate-css, forwardRef hilang (ref-as-prop). (URL di R0-28) | Sonner 2.0.8 & tw-animate-css 1.4.0 terpasang (lockfile) | — | **SESUAI** |
| R0-30 | Zod 4: param `error` menyatu; `invalid_type_error/errorMap/.format()` hilang; format string top-level. https://zod.dev/v4 | Terpasang **Zod 4.6.7**; kode memakai idiom kompatibel (`z.string().uuid()`, `.safeParse`, `error.issues` via `formatZodIssues` sendiri); **nol** API yang dihapus v4 | Utang idiom saja: `z.string().uuid()` terdepresiasi di v4 (diganti `z.uuid()`), format error rawatan sendiri vs `z.treeifyError()` | **SESUAI (fungsional)** — modernisasi idiom: **BELUM PERLU** (Kecil per berkas, kerjakan insidental). Penting: TIDAK ada migrasi mayor yang harus direncanakan — pertanyaan riset tertutup |
| R0-31 | TS: `strict` ≠ `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; keduanya bawaan anjuran TS 5.9. https://www.typescriptlang.org/tsconfig/ | `tsconfig.json`: `strict: true` saja; kedua flag **absen**. Pola kode banyak mengindeks record/array di jalur keranjang & laporan (kelas bug `T` vs `T \| undefined` nyata di domain ini) | Biaya mengaktifkan tak terukur tanpa spike: bisa puluhan–ratusan error susulan | **BERISIKO (mengaktifkan membabi buta)** — R1: spike terukur (aktifkan di cabang, hitung error per area) lalu putuskan; jangan aktifkan di R3 tanpa angka spike. Kelas temuan: DIANJURKAN menilai |
| R0-32 | Decimal dari string; satu konfigurasi; `Decimal.clone()` utk kebutuhan berbeda per modul. Decimal.js API (mirror — situs resmi tak terverifikasi per riset) | `Decimal.set` tepat **satu kali** (`src/lib/money.ts:3`, precision 30, HALF_UP); konstruksi terpusat `d()` — nilai DB `numeric(19,4)` tiba sebagai string; sampel jalur uang/AVCO memakai `d(...)`/`new Decimal(0)` | Tipe `MoneyInput` masih menerima `number` (pintu masuk float secara teori); tak ada bukti float mengambang di jalur posting | **SESUAI** — INFO: mempersempit tipe = perubahan API luas, BELUM PERLU |

## 6 · Testing

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-33 | Playwright: setup project + storageState; `.auth` di-gitignore (kuki mampu impersonasi). https://playwright.dev/docs/next/auth | Persis pola resmi: proyek `setup` + dependensi proyek chromium, `storageState: e2e/.auth/user.json`, `.gitignore` memuat `/e2e/.auth/` ✓ | — | **SESUAI** |
| R0-34 | Tes yang memutasi state server butuh akun per worker paralel. https://playwright.dev/docs/next/test-parallel | `workers: 1`, `fullyParallel: false` — serial disengaja; satu akun demo bersama aman pada mode ini | Harga: kecepatan suite; bukan kebenaran | **BELUM PERLU** — akun-per-worker hanya bila paralelisasi diputuskan (Dianjurkan bersyarat) |
| R0-35 | DB integrasi nyata sekelas produksi (pola otoritatif: Testcontainers). https://node.testcontainers.org/modules/postgresql/ | Vitest terhadap **PG 18 dev nyata** (bukan mock/sqlite), rollback per alur, `fileParallelism: false`; terbukti menangkap perilaku isolasi/RLS (A2/A3) | Pola sekarang *terbukti bekerja*; Testcontainers menambah isolasi CI/hermetik tetapi mengganti infrastruktur yang sehat | **BELUM PERLU** — nilai ulang hanya bila CI berjaringan/terkontainer menjadi target (catatan portabilitas, bukan gap) |
| R0-36 | Isolasi Vitest per berkas ≠ isolasi DB. https://vitest.dev/api/vi.html | Disadari & dikompensasi: perusahaan fixture buangan + teardown (diperbaiki A4) + serial | — | **SESUAI** |

## 7 · Desktop (Tauri v2)

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-37 | Capabilities = ACL per jendela, least-privilege. https://v2.tauri.app/reference/config/ ; panduan capabilities per jendela | `default.json` (utama) & `display.json` (pelanggan) sama-sama minimal: `core:default` + `core:event:allow-listen`; tanpa fs/http/shell; HTTP/token milik Rust (program Tauri langkah 4–8) | Jendela utama memegang set yang sama dgn display — tetapi set itu sendiri sudah lantai minimal; tak ada izin berlebih yang bisa dicabut | **SESUAI** |
| R0-38 | `app.security.csp` dikonfigurasi produksi; `csp: null` = tanda bahaya. https://v2.tauri.app/reference/config/ | **`"csp": null` di `tauri.conf.json`**; override linux/windows tak menyetel CSP. Muatan webview = ekspor statis lokal; tak ada konten jarak jauh; tetapi XSS di webview tanpa CSP kehilangan satu lapis penahan menuju invoke kustom | Gap nyata satu-satunya di permukaan desktop | **WAJIB** — Sedang; R3: tetapkan CSP restriktif yang kompatibel dgn ekspor statis Next (skrip inline bawaan ekspor adalah kendala nyata — uji pada build desktop + harness; jangan salin CSP web mentah-mentah) |
| R0-39 | Klien desktop tak tepercaya: nol rahasia di biner; server memvalidasi tiap panggilan. (Turunan AU/T-1 riset) | Token perangkat di keychain OS/berkas 0600 sisi Rust; endpoint `/api/pos/*` mengautentikasi token per panggilan (terbukti A1/S5) | — | **SESUAI** |

## 8 · ERP domain (rujukan silang — tidak diaudit ulang)

| # | Dokumentasi / metode terbaik (+URL) | Implementasi saat ini (bukti) | Gap | Rekomendasi + kelas + ukuran + tahap |
|---|---|---|---|---|
| R0-40 | Idempotensi: kunci dari klien, hasil disimpan dalam transaksi posting yang sama, putar-ulang aman. Stripe — https://docs.stripe.com/api/idempotent_requests | Terbukti A2 rantai (g): kirim-ulang muatan = `duplicate`, tepat satu penjualan; kunci idempotensi pada checkout (AGENTS.md) | — | **SESUAI** |
| R0-41 | IAS 2: FIFO atau rata-rata tertimbang; LIFO dilarang; rata-rata bergerak dihitung ulang saat penerimaan. https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/ | AVCO perpetual terbukti S2/A2 (penerimaan 2 Dus → AVCO 3.625 persis; penjualan tak mengubah rata-rata satuan) | — | **SESUAI** |
| R0-42 | Ledger append-only; koreksi = jurnal pembalik, bukan edit. Fowler Accounting Patterns — https://www.martinfowler.com/eaaDev/AccountingNarrative.html | Aturan repo + penjaga DB (migrasi 0001 guards) + terbukti A0 (jurnal posted tanpa baris 0, tak seimbang 0) & A2 rantai (f)/(h) | — | **SESUAI** |

## 8 gap paling penting (urutan tindak lanjut)

1. **R0-38 — CSP Tauri `null`** (WAJIB): satu-satunya lubang konfigurasi
   keamanan yang belum tertutup di seluruh permukaan.
2. **R0-07 — Next 16.4.3 di belakang patch keamanan** (WAJIB menilai):
   naik ke 16.4.5 sesudah penilaian advisory.
3. **R0-17 — Kebijakan RLS tanpa pembungkus InitPlan** (DIANJURKAN):
   ukur dulu di tabel terbesar; jangan migrasi membabi buta.
4. **R0-31 — Flag TS tambahan absen** (BERISIKO bila langsung): spike
   terukur di R1 sebelum keputusan.
5. **R0-21 — `freshAge` tak disetel** (DIANJURKAN): operasi sensitif
   bertumpu izin saja, tanpa kesegaran sesi.
6. **R0-24 — Rate-limit memori + sumber IP** (DIANJURKAN bersyarat):
   aman hari ini, menjadi syarat gerbang multi-instance.
7. **R0-09 — `global-error.tsx` absen** (DIANJURKAN, Kecil): permukaan
   publik tanpa bingkai gagal aplikasi.
8. **R0-13 — Strategi isolasi implisit** (DIANJURKAN dokumentasi):
   pola RC + `FOR UPDATE` benar & terbukti, tetapi belum tertulis —
   risiko regresi oleh penyunting baru, bukan oleh kode hari ini.

## Status sesudah R1 (2026-11-08 — pengukuran di `ANALISIS-R1.md`)

| Baris | Status R1 |
|---|---|
| R0-01 | Tetap SESUAI + satu temuan turunan: `loadOpnameProductsAction` mengirim `costPrice` di balik `inventory.view` saja → kandidat K-3 (ANALISIS-R1 §5a) |
| R0-07 | **TERNILAI — TIDAK TERDAMPAK** advisori Sept/Okt 2026: rentang GHSA-p3m5 `>=16.4.0 <=16.4.0` terpatahkan oleh 16.4.3 terpasang (terbit 2026-10-23, sesudah rilis keamanan 16.4.1); prasyarat konfigurasi advisori lain absen; sharp sudah 0.35.5. Kelas turun: WAJIB-menilai **selesai dinilai**; naik 16.4.5 = DIANJURKAN rutin, terbukti drop-in di worktree (typecheck 0, unit 836/836, integrasi 34/34, build 0) → kandidat K-4 |
| R0-09 | DINILAI → kandidat K-6 (bentuk minimal dua berkas dispecifikasikan di ANALISIS-R1 §5c) |
| R0-13 | **TERTUTUP** — strategi tertulis di `ADR-ISOLASI-TRANSAKSI.md` (RC + 74 titik kunci di 36 berkas + penjaga constraint unik + aturan urutan kunci) |
| R0-17 | **TERUKUR** — varian `(select app_company_id())`: agregasi bulan parsial 14,81 → 5,21 ms (−65%, mekanisme InitPlan membuka indeks komposit pada tabel yang pembatasannya hanya dari RLS); 5 kueri lain netral → kandidat K-1 |
| R0-21 | DESAIN SELESAI → kandidat K-5 (freshAge 3.600 dtk; titik: manajemen pengguna/peran, tutup/kunci periode & tutup tahun, ekspor payroll; POS sengaja dikecualikan) — ANALISIS-R1 §5b |
| R0-24 | TERTULIS sebagai **gerbang multi-instance** (bersama R0-10 & R0-16): storage rate-limit database + aturan sign-in dinilai ulang + sumber IP eksplisit sebelum >1 instance/proksi berubah — ANALISIS-R1 §5d |
| R0-31 | **TERUKUR — DITUNDA**: kedua flag = 5.920 error (tests 5.151, src 718, scripts 42, e2e 9); bukan kandidat R2/R3; program terpisah bila pernah, urutan tsconfig terpisah → panen `src/` dulu |
| Temuan baru R1 (di luar matriks) | `ensure*Accounts` ×3 implementasi (K-2) · panel UI kasbon/pinjaman salinan paralel ±290 baris (presentasi) · N+1 loop penyusutan aset tetap (pola terbukti, dampak kecil) — ANALISIS-R1 §6 |

## Status sesudah R2 (2026-11-08 — rencana di `RENCANA-R2.md`)

Semua kandidat R1 berubah menjadi rencana implementasi terukur
(tujuan, perubahan persis, risiko, rollback, test pembuktian,
metrik & ambang, pemilik berkas) dengan **urutan eksekusi R3**:
K-3 → K-1 → K-2 → K-4 → K-5 → K-6 → K-7 → K-8. Benchmark "sebelum"
yang dilengkapi di R2: inventaris kebijakan hidup K-1 (99
kebijakan / 97 tabel; tepat 97 `tenant_isolation` berbentuk
telanjang; 2 kebijakan digest migrasi 0060 di luar cakupan),
pemetaan konsumen K-3, audit artefak ekspor K-7, keadaan
konfigurasi K-5.

| Baris / temuan | Disposisi R2 → kandidat & posisi R3 |
|---|---|
| R0-01 (turunan K-3) | **Cakupan K-3 DIPERLUAS** dari 1 aksi temuan sampel R1 menjadi **3 aksi** dalam `actions/inventory/produk.ts` (`searchInventoryProductsAction`, `resolveBarcodeAction`, `loadOpnameProductsAction`) — pemetaan R2 membuktikan ketiganya mengembalikan `costPrice` di balik `inventory.view` dan dua yang pertama menyuplai ProductPicker bersama. Pola perbaikan = AUD-013 (`can(ctx, "inventory.cost")`, nilai hilang bukan error). **Posisi R3: 1** |
| R0-17 | K-1 direncanakan penuh: migrasi BARU 0066 (blok DO + assertion 97, preseden bentuk migrasi 0001), ekuivalensi semantik STABLE/`set_config` tertulis, rollback = migrasi kompensasi 0067, ambang EXPLAIN Q5 ≤ 7,5 ms + uji negatif RLS diulang. **Posisi R3: 2** |
| Temuan R1 `ensure*Accounts` ×3 | K-2 direncanakan: helper baru `src/server/system-accounts.ts` bermekanik peta-memori fixed-assets; **titik rawan tercatat** — urutan pencocokan lama berbeda (nama→kode vs kode→nama), disamakan ke kode→nama hanya bila test karakterisasi membuktikan paritas hasil akhir. **Posisi R3: 3** |
| R0-07 | K-4 direncanakan: pin `next` + `eslint-config-next` 16.4.3 → 16.4.5 via `pnpm up --prefer-offline` (catatan CDN SheetJS dari R1), pemeriksaan diff lockfile (sharp tetap 0.35.5), gerbang penuh termasuk `pos:export`. **Posisi R3: 4** |
| R0-21 | K-5 direncanakan: `freshAge: 3600` di `lib/auth.ts` + `requireFreshSession()` di `lib/session.ts` (ctx sesi diperluas membawa `createdAt`; semantik Better Auth 1.7.15 wajib diverifikasi di awal R3) pada **10 titik bernama** (6 aksi users, 3 aksi periode/tutup tahun, ekspor payroll); POS sengaja dikecualikan + kontrol negatif pada test. **Posisi R3: 5** |
| R0-09 | K-6 direncanakan: `src/app/error.tsx` (di dalam layout root) + `src/app/global-error.tsx` (html/body sendiri + impor globals.css, tanpa dependensi bersama), meniru pola `app/error.tsx`; test render. **Posisi R3: 6** |
| R0-38 | K-7 direncanakan dengan nilai CSP tertulis per direktif. Bukti artefak R2: ekspor statis memuat skrip inline flight RSC di setiap halaman → `script-src` wajib `'unsafe-inline'`; JS desktop nol `fetch(` (HTTP milik Rust dari `device.json`) → webview tak butuh jaringan, satu-satunya pengecualian `ipc.localhost` (IPC Tauri Windows — wajib diverifikasi dokumentasi 2.12 di R3). Verifikasi tanpa GUI: `tauri info` + audit statis artefak ekspor; sisa utang bukti rendering webview tetap di daftar lapangan AUD-009. **Posisi R3: 7** |
| Temuan R1 N+1 penyusutan | K-8 **disertakan bersyarat** (dinilai murah & aman: satu berkas, satu kueri `SUM … GROUP BY`, penjumlahan numeric eksak): helper peta akumulasi untuk loop run bulanan & baca daftar; dikerjakan hanya sesudah K-1..K-7 hijau, boleh ditunda tanpa menghalangi penutupan R3. Berbagi berkas dengan K-2 (`fixed-assets.ts`) — urutan menjamin tak bersamaan. **Posisi R3: 8** |

## Status sesudah R3 (2026-11-08 — bukti di `HASIL-R3.md`)

Kedelapan kandidat **TERLAKSANA & TERVERIFIKASI**; gerbang akhir dari
reseed bersih: suite **2077/2077** (218 berkas; baseline 2039 + 38
test baru), typecheck 0, lint 0 error/29 warning, build 0, e2e 25/25,
db-integrity 0, restore drill LULUS, pos:export 0, harness Rust 64/64.

| Kandidat | Status R3 |
|---|---|
| K-3 (turunan R0-01) | **TERTUTUP** — 3 aksi picker menyaring `costPrice` (+`buyPrice` kemasan, kelas sama) di balik `inventory.cost`; test viewer gagal-sebelum (5)/lulus-sesudah (9/9). R0-01 kembali SESUAI penuh |
| K-1 (R0-17) | **TERTUTUP** — migrasi 0066 membungkus 97/97 kebijakan `tenant_isolation`; uji negatif RLS lulus; Q5 14,81 → **7,11 ms** (ambang ≤7,5); Q1b/Q3/Q4 terbukti bukan regresi via A/B dataset-sama |
| K-2 (temuan `ensure*Accounts`) | **TERTUTUP** — satu helper `server/system-accounts.ts`; paritas 17/17 (2 skenario tabrakan membuktikan delta disengaja: ikatan kode menang); kontrak MODULE_BOUNDARIES §6 diperbarui dengan alasan |
| K-4 (R0-07) | **TERTUTUP** — next + eslint-config-next 16.4.5; diff lockfile terkurung keluarga next; sharp 0.35.5; nol test diubah |
| K-5 (R0-21) | **TERTUTUP** — `freshAge: 3600` + `requireFreshSession` di 10 titik bernama (POS dikecualikan sadar); semantik Better Auth 1.7.15 terverifikasi dari sumber terpasang; test 6/6 termasuk kontrol negatif; helper di modul daun `lib/session-freshness.ts` (re-export session.ts) |
| K-6 (R0-09) | **TERTUTUP** — `src/app/error.tsx` + `src/app/global-error.tsx` berpola `app/error.tsx`; test render 3/3; R0-09 selesai |
| K-7 (R0-38) | **TERPASANG & TERVERIFIKASI STATIS** — CSP + devCsp di tauri.conf.json (skema `ipc:` ditambahkan per dokumentasi resmi Tauri); tauri info 0; audit artefak bersih; **utang bukti rendering webview tetap di AUD-009** |
| K-8 (N+1 penyusutan) | **TERTUTUP** — `getAccumulatedDepreciationMap` satu kueri SUM…GROUP BY; test karakterisasi hijau sebelum & sesudah tanpa diubah |

## Status final R4 (2026-11-08 — penutup program; laporan di `LAPORAN-REKAYASA.md`)

Program Rekayasa R0–R4 **TUNTAS**. Gerbang final R4 independen
dari reseed bersih mengonfirmasi keadaan akhir tanpa perubahan
kode di tahap ini: **suite 2077/2077 (218 berkas) pada larian
pertama**, typecheck 0, lint 0 error/29 warning warisan, build 0
(Next 16.4.5), e2e 25/25, db-integrity **0 pelanggaran secara
global** (F1 = 67 migrasi), backup + restore drill LULUS,
pos:export 0, tauri info 0, harness Rust 64/64. Keluarga flake
AUD-008 tidak muncul di gerbang ini; status MONITOR-nya tidak
berubah (tidak ada perbaikan akar yang diklaim).

Disposisi final per baris gap (baris SESUAI sejak R0 tidak
diubah statusnya — 21 baris, termasuk R0-01 yang temuan
turunannya ditutup K-3):

| Baris | Disposisi final |
|---|---|
| R0-07 (WAJIB menilai + naik patch) | **TERTUTUP** — R1: tidak terdampak advisori Okt 2026; R3/K-4: 16.4.5 terpasang, gerbang penuh hijau |
| R0-38 (WAJIB — CSP Tauri) | **TERTUTUP sebagai konfigurasi** — K-7 terpasang & terverifikasi statis; sisa utang bukti rendering webview tetap di AUD-009 (daftar lapangan, bukan gap baris ini) |
| R0-09 (DIANJURKAN) | **TERTUTUP** — K-6: `src/app/error.tsx` + `global-error.tsx` |
| R0-13 (DIANJURKAN dokumentasi) | **TERTUTUP** — ADR-ISOLASI-TRANSAKSI (R1) |
| R0-17 (DIANJURKAN) | **TERTUTUP** — K-1: migrasi 0066, 97/97 kebijakan; Q5 14,81 → 7,11 ms terpasang |
| R0-21 (DIANJURKAN) | **TERTUTUP** — K-5: freshAge 3600 di 10 titik bernama |
| R0-24 (DIANJURKAN bersyarat) | **TERTULIS SEBAGAI GERBANG** — paket syarat multi-instance (bersama R0-10 & R0-16); implementasi menunggu pemicu topologi |
| R0-31 (menilai DIANJURKAN / mengaktifkan BERISIKO) | **TERNILAI & DITUNDA** — 5.920 error terukur; program terpisah bila pernah (urutan: tsconfig terpisah, panen `src/` dulu) |
| R0-19 (DIANJURKAN — trigram) | **TIDAK DISENTUH program ini** — tetap OPEN di register AUD-022; K-1 terbukti bukan obatnya (Q2 netral) |
| R0-08 (BERISIKO — Cache Components) | **DITOLAK dengan alasan** — keputusan dipertahankan: halaman request-time bertenant; nilai ulang hanya bila halaman publik/statis nyata muncul |
| R0-04, R0-11, R0-14, R0-15, R0-34, R0-35 (BELUM PERLU ×6) | **DIPERTAHANKAN** — alasan per baris di badan matriks tidak berubah oleh bukti program ini |
| Temuan R1 di luar matriks (K-2, K-8) | **TERTUTUP** — `ensureSystemAccounts` satu algoritma (paritas 17/17); akumulasi penyusutan satu kueri agregat (paritas tanpa test diubah) |

Ringkasan akhir kelas: SESUAI/TERTUTUP 27 · WAJIB terbuka 0 ·
DIANJURKAN tersisa bernama 3 (R0-19 di AUD-022, R0-24 sebagai
gerbang tertulis, R0-31 sebagai program terpisah) · BELUM PERLU
dipertahankan 6 · BERISIKO diputuskan 2 (satu ditolak, satu
ditunda terukur). Verdict gabungan dgn Audit Produksi:
**CONDITIONAL GO — tetap, syarat menyempit 4 → 3** (rincian:
LAPORAN-REKAYASA §J).
