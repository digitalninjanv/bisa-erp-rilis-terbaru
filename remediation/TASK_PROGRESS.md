# TASK PROGRESS — Bisa ERP Remediation

Tanggal: 2026-11-21
Branch: `remediation/erp-audit-2026-11-21`
Baseline: `pnpm test:all` = 294 file / 2.542 test PASS (DB test terpisah, ter-seed); typecheck/lint/build/drizzle check PASS.

## Status Task

| Task | Priority | Status | Test | Catatan |
|---|---|---|---|---|
| FIX-001 schema columns | P0 | **VERIFIED** | Migration 0085 + integration | `stock_unit_cost`, `goods_total` nullable |
| FIX-002 cash drawer | P0 | **VERIFIED (unit+domain)** | Unit mapping + integration | Key per dialog; fingerprint payload; E2E UI belum |
| FIX-003 receipt void | P0 | **VERIFIED** | Integration INV-01 | PPN inklusif + stok lain |
| FIX-004 return reports | P0/P1 | **VERIFIED** | Integration POS-03/REP-01 | goods_total + top products union |
| FIX-005 year-end closing | P0 | **VERIFIED** | Integration ACC-01 | locked period |
| FIX-006 users.manage escalation | P1 | **VERIFIED** | user-management test | subset permission |
| FIX-007 payroll export gate | P1 | **VERIFIED (code)** | — | route module gate; route runtime test belum |
| FIX-008 audit feed HR | P1 | **VERIFIED** | Integration CORE-06 | exclude entity types |
| FIX-009 payroll payment account | P1 | **VERIFIED** | Integration ACC-02 | cash/bank only |
| FIX-010 payment method history | P1 | **VERIFIED** | Integration SET-01 | type/account locked after use |
| FIX-011 packaging price gate | P1 | **VERIFIED** | Integration INV-02 | inventory.price |
| FIX-012 ESC/POS control | P1 | **VERIFIED** | Unit POS-04 | control chars neutralized |
| FIX-013 device module gate | P1 | **VERIFIED (code)** | — | `isModuleEnabled` di token |
| FIX-014 guard redirect | P1 | **VERIFIED** | Unit CORE-07 | NEXT_REDIRECT rethrow |
| FIX-015 HR offboarding | P1 | **VERIFIED (code)** | — | ambiguous name tidak mass-revoke |
| FIX-016 action module gates | P2 | **DEFERRED** | — | Perubahan module gate action ditunda: mock test lama belum kompatibel; CORE-03/04 sudah ditangani |
| FIX-017 POS recovery | P2 | **VERIFIED (code)** | — | error definitif clear; closed session reject |
| FIX-018 batch query/line cap | P2 | **VERIFIED (code)** | — | agregasi batch + max 500 |
| FIX-019 pairing lock | P2 | **VERIFIED (code)** | — | FOR UPDATE |
| FIX-020 manual journal fingerprint | P2 | **VERIFIED** | Integration ACC-03 | replay/conflict |
| FIX-021 prune job | P3 | **VERIFIED (script)** | Unit prune existing | cron belum dipasang |
| FIX-022 Tauri CSP | P3 | **DEFERRED** | — | perlu build Tauri; risiko regresi |

## Baseline Commands

```text
pnpm test          # 132 file / 1.178 test PASS (setelah perubahan)
pnpm test:all      # 297 file / 2.561 test PASS (DB test terpisah)
pnpm typecheck     # PASS
pnpm lint          # PASS
BISA_TEST_BUILD=1 pnpm build  # dijalankan di checkpoint akhir
pnpm exec drizzle-kit check   # PASS
```

## Checkpoint Log

- 2026-11-21: audit selesai; remediation plan disusun.
- 2026-11-21: FIX-001 migration 0085 dibuat (kolom nullable), diterapkan ke DB test.
- 2026-11-21: FIX-002..FIX-020 implemented; focused tests pass.
- 2026-11-21: full suite **297 file / 2.561 test PASS**; build/typecheck/lint/drizzle check PASS.

## Sisa / Residual

- FIX-022 Tauri CSP deferred (butuh build Tauri).
- E2E Playwright belum dijalankan.
- Restore/PITR/offsite tetap NOT_TESTED.
- Baris retur lama tanpa `goods_total` memakai fallback `total` (perilaku historis).
- Baris penerimaan lama tanpa `stock_unit_cost` memakai inferensi PPN.
