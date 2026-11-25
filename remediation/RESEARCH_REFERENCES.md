# RESEARCH REFERENCES — Remediation Bisa ERP

Tanggal: 2026-11-21
Referensi audit sebelumnya tetap berlaku: `audit-reports/RESEARCH_REFERENCES.md` (R-01..R-14). Dokumen ini menambah referensi yang dipakai untuk implementasi.

## R-15 — Next.js `unstable_rethrow`

- **Judul**: Next.js — `unstable_rethrow`
- **URL**: https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/04-functions/unstable_rethrow.mdx
- **Dipakai untuk**: CORE-07 — mem-preserve `redirect()`/`notFound()` dari catch-all `guard()`.
- **Isi kunci**: `unstable_rethrow(err)` melempar ulang error internal Next.js (redirect, not-found) agar framework melanjutkan perilaku yang diharapkan.
- **Catatan versi**: repo memakai Next.js 16.4.5; API masih ditandai `unstable`. Implementasi akan memakai pemeriksaan digest yang kompatibel dan tidak menambah dependency, lalu diuji.

## R-16 — Drizzle nullable numeric column & migration

- **Judul**: Drizzle Kit — schema/migration; nullable decimal columns
- **URL**: https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/README.md
- **URL**: https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/tests/push/mysql.test.ts
- **Dipakai untuk**: menambah kolom nullable `stock_unit_cost` dan `goods_total` tanpa mengubah baris lama; migrasi `ALTER TABLE ADD COLUMN` aman untuk data existing.
- **Keputusan**: kolom nullable + fallback di kode; tidak ada backfill destruktif. Baris baru menulis nilai eksak; baris lama memakai inferensi/fallback.

## R-17 — PostgreSQL `ALTER TABLE ADD COLUMN`

- **Judul**: PostgreSQL 18 Documentation — ALTER TABLE
- **URL**: https://www.postgresql.org/docs/current/sql-altertable.html
- **Dipakai untuk**: memastikan penambahan kolom nullable tanpa default adalah operasi metadata yang aman pada tabel besar; tidak menulis ulang seluruh tabel.
- **Implikasi**: migrasi 0085 tidak memblokir operasi toko secara lama; tetap dijalankan pada window pemeliharaan sesuai runbook.

## R-18 — PostgreSQL RLS/tenant (reuse)

- **Judul**: PostgreSQL 18 Documentation — Row Security Policies; SET
- **URL**: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- **URL**: https://www.postgresql.org/docs/current/sql-set.html
- **Dipakai untuk**: memastikan perubahan query baru tetap berjalan di dalam `withCompany` dan tidak membuka jalur lintas tenant.

## R-19 — OWASP Authorization (reuse)

- **Judul**: OWASP WSTG — Privilege Escalation; Authorization Cheat Sheet
- **URL**: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization/03-Privilege_Escalation
- **URL**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- **Dipakai untuk**: CORE-01 — subset permission/owner-only; CORE-06 — audit feed filtering.

## R-20 — PostgreSQL numeric / money

- **Judul**: PostgreSQL 18 Documentation — Numeric Types
- **URL**: https://www.postgresql.org/docs/current/datatype-numeric.html
- **Dipakai untuk**: kolom `numeric(19,4)` baru dan perhitungan DPP/goods value dengan Decimal.js.

## R-21 — ESC/POS control characters (reuse)

- **Judul**: Epson ESC/POS Reference — GS V; command table
- **URL**: https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html
- **URL**: https://escpos.readthedocs.io/en/latest/commands.html
- **Dipakai untuk**: POS-04 — menetralkan byte kontrol pada teks.

## R-22 — Better Auth (reuse)

- **Judul**: Better Auth — Rate Limit
- **URL**: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/rate-limit.mdx
- **Dipakai untuk**: memastikan perubahan auth tidak menyentuh rate limit/session yang sudah benar.

## R-23 — Testing database guard repo

- **Sumber**: `tests/vitest-db-guard.mjs`
- **Dipakai untuk**: semua test integrasi remediasi dijalankan pada database `*_test` terpisah, bukan database dev/produksi.

---

## Batas Riset

- Tidak ada benchmark produksi; klaim performa hanya dari query/test lokal.
- `unstable_rethrow` masih unstable; implementasi memilih rethrow berbasis digest yang tidak bergantung pada API unstable, lalu diuji.
- Perubahan skema diuji pada database test; tidak ada migrasi ke database produksi.
