# REGRESSION RESULTS — Bisa ERP Remediation

Tanggal: 2026-11-21
Branch: `remediation/erp-audit-2026-11-21`
Database: `bisa_audit_20261121_test` (terpisah, migrasi 0000–0085, sudah di-seed)
Tidak ada pengujian pada database produksi.

## Full Suite

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Full test suite | `pnpm test:all` | **297 file, 2.561 test PASS** (309,25 dtk) |
| Unit saja | `pnpm test` | **132 file, 1.178 test PASS** |
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS (0 warning) |
| Build standalone | `BISA_TEST_BUILD=1 pnpm build` | PASS |
| Drizzle consistency | `pnpm exec drizzle-kit check` | PASS |
| Migrasi dari DB kosong | `drizzle-kit migrate` pada `bisa_migration_check_test` | PASS — 86 migrasi, kolom baru ada |
| Prune script | `tsx scripts/prune-idempotency.ts` | PASS — 0 baris (tidak ada key lama) |

## Focused Remediation Tests

| File | Hasil | Cakupan |
|---|---|---|
| `tests/integration/remediation-audit-fixes.test.ts` | 9 PASS | INV-01, POS-03, ACC-01, POS-01/06, CORE-06, REP-01, ACC-02, ACC-03, HR-01 |
| `tests/integration/remediation-settings-guards.test.ts` | 2 PASS | SET-01, INV-02 |
| `tests/integration/user-management.test.ts` | 19 PASS | CORE-01 + regresi user/role |
| `tests/integration/pos-device-api.test.ts` | 19 PASS | CORE-04/CORE-05 + device API |
| `tests/sim2/payroll-access.test.ts` | 48 PASS | CORE-03 + field-level payroll |
| `tests/unit/pos-cash-movement.test.ts` | 2 PASS | POS-01 mapping |
| `tests/unit/pos-escpos.test.ts` | 8 PASS | POS-04 |
| `tests/unit/guard-zod.test.ts` | 11 PASS | CORE-07 + validasi |
| `tests/unit/permissions.test.ts` | 16 PASS | CORE-01 pure helper |

## Regression yang Ditemukan dan Diselesaikan

1. **Ratchet ukuran berkas** — `accounting.ts` dan `inventory.ts` melewati plafon setelah perubahan. Diselesaikan dengan memisahkan `journal-idempotency.ts` dan memadatkan schema; architecture test PASS.
2. **Mock test payroll export** — fixture test tidak menyertakan modul HR, sehingga gate baru menghasilkan 403/500. Fixture diperbarui ke `enabledModules` yang realistis; test payroll PASS.
3. **Test idempotensi jurnal lama** — test mengharapkan key sama + payload berbeda replay. Kontrak baru sengaja menolak; test diperbarui untuk menguji replay identik + CONFLICT payload berbeda.
4. **Pairing `FOR UPDATE` vs RLS** — lock awal memicu 401 karena policy UPDATE membutuhkan company context. Diganti klaim atomik `usedAt` setelah company context; pos-device test PASS.
5. **Module gate import** — perubahan P2 menyebabkan mock lama gagal; perubahan ditunda dan dikembalikan, dicatat sebagai CORE-02 deferred.

## Failure / Limitation

- **E2E Playwright tidak dijalankan** pada remediasi ini.
- **Performance benchmark** batch availability tidak dijalankan; hanya verifikasi query correctness lewat full suite.
- **Restore/PITR/offsite** tetap NOT_TESTED.
- **Tauri build/CSP** tidak dijalankan.
- Baris retur/penerimaan lama memakai fallback (goods_total null → total; stock_unit_cost null → inferensi).

## Kesimpulan

Semua test otomatis yang tersedia lulus setelah perbaikan, termasuk regression baru untuk setiap finding P0/P1 yang dapat diuji. Tidak ada regresi test yang tersisa pada suite saat ini.
