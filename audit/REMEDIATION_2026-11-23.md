# ERP Remediation Record — 2026-11-23

**Scope:** all findings from the 2026-11-23 audit. No production data or schema was modified; disposable test databases only.

## Result summary

| Finding | Result | Evidence |
|---|---|---|
| POS-005 receipt token/copy | FIXED | `p1-pos-receipts.log` 12/12; receipt-link unit tests |
| SEC-002 demo seed credential | FIXED | production seed rejected; guard unit tests |
| PLT-001 Tauri release | RESOLVED (retired; Electron official) | `p1-release-retirement.log` |
| POS-006 first offline reload | FIXED | `validate-pwa-final.log` 2/2 |
| WH-001 receipt payload replay | FIXED | `goods-receipt` fingerprint test |
| CORE-02 module gates | FIXED | import helper test; source gates |
| DATA-001 report snapshot | FIXED | `report-snapshot-consistency.test.ts` |
| SEC-003 CI security | FIXED (CI gate; GitHub run pending) | CI `security` job; Semgrep 0 errors; audit pass |
| POS-002 outbox retention | FIXED (control) | `prune:pos-outbox` + docs |
| PERF-001 export pool pressure | FIXED (control) | concurrent export cap; not load-tested |
| QA-002 fixture/assertion isolation | FIXED | full POS 144/144; cash/HR/returns 24/24 |
| QA-003 file-size ratchet | FIXED (registered debt) | unit 1,219/1,219 |
| HR-003 legacy overtime | CLOSED — intended safe | reject-one-then-approve test |
| TXN-001 journal idempotency retention | FIXED | `idempotency-retention.test.ts` |

## Verification

- Unit: 1,219/1,219.
- Full integration suite: 1,112/1,112 (138 files).
- POS integration: 144/144.
- Accounting: 96/96.
- Warehouse: 124/124.
- Import/purchase advances: 39/39.
- PWA E2E: 2/2.
- Typecheck, lint, production build: PASS.
- `pnpm audit --prod --audit-level=high`: PASS.
- Semgrep `p/typescript` error severity: 0 findings locally.

## Remaining verification gaps (not open code findings)

- GitHub-hosted security job has not run; gitleaks container local check was blocked by sandbox permissions.
- Electron packaging/install/pair/print/update not smoke-tested.
- Production RLS/grants, penetration test/ASVS matrix.
- Representative load/query plans/pool/CPU/memory.
- Backup/restore/PITR and deployment rollback.
- Physical printer/jam/power-loss and full 23-file E2E/browser matrix.
- Payroll/tax/PSAK/IFRS policy review.
