# ERP Risk-Driven Audit — Plan and Checkpoints

**Audit date:** 2026-11-23 (continuation of the 2026-11-22 baseline)
**Repository snapshot:** HEAD `6140f97` plus the existing working-tree changes. The tree is not clean: 137 modified, 58 deleted, 55 untracked paths at audit start. Findings apply to this working tree, not to a certified release commit.
**Disposition:** AUDIT ONLY. No application source, migration, dependency, configuration or production data was changed. All new files are inside `audit/`.

## 1. Architecture and scope

```text
Browser / PWA / Electron
  -> Next.js 16.4.5 App Router (100 pages, 32 route handlers)
  -> Server Actions (55 action modules) + route handlers
  -> domain services in src/server/**
  -> withCompany()/withCompanyReadOnly() (transaction-local app.company_id)
  -> Drizzle ORM 0.45.4 + postgres.js 4.0.0
  -> PostgreSQL 18 (89 migrations, latest 0088; RLS on 100 company-scoped tables)
```

- **Money:** `numeric(19,4)` and Decimal.js. POS recomputes its quote server-side; client totals are not trusted.
- **Tenant boundary:** RLS policies plus `withCompany`/`withCompanyReadOnly`; `app_user` is `NOBYPASSRLS`, 100/100 company-scoped tables have RLS enabled in the tested schema.
- **Shared write engines:** `postJournal` (journals/period/cash guard), `applyStockMovement` (on-hand/AVCO/locks), `createSale` (POS sale/stock/cash/journal), `processOfflineSaleItem` (offline replay).
- **Deployment paths discovered:** Docker Compose, systemd/standalone release, PWA service worker/outbox, Electron print shell. The Tauri prototype/release path was retired in the P1 remediation (source deleted; stale workflow/script removed).
- **Runtime assumptions not established:** production replica count, peak concurrent cashiers, data volume, proxy topology, backup/PITR state, physical printers. No production system was contacted.

## 2. Audit order and risk ranking

| Order | Workflow family | Impact | Likelihood | Exposure | Triage |
|---|---|---:|---:|---:|---:|
| 1 | POS checkout, offline sync, returns, cash sessions, receipts | 3 | 3 | 3 | 27 |
| 2 | Accounting journals, period close, AR/AP, cash/bank, tax, assets | 3 | 2 | 3 | 18 |
| 3 | Inventory receipt, transfer, adjustment, opname, valuation | 3 | 2 | 3 | 18 |
| 4 | Purchasing, HR/payroll, reporting, master data, IAM, import/export | 2–3 | 2 | 2–3 | 8–18 |
| 5 | Cross-module chains and reconciliation | 3 | 2 | 3 | 18 |
| 6 | Architecture, security, reliability, performance | 3 | 2 | 2 | 12 |

Scores are audit judgments, not measured incident probabilities.

## 3. Research and tool routing

| Source | Used for | Result |
|---|---|---|
| Context7 | Next.js 16.4.5 Server Actions authorization contract | Confirmed Server Actions are directly POST-reachable and must authenticate/authorize inside each action (`/vercel/next.js/v16.4.5`). |
| Exa | Service-worker app-shell precache behavior | Confirmed the app shell should be precached at install; a first navigation is not controlled by a newly installed worker, so runtime-only caching leaves the first offline reload uncovered. |
| Web search | Cookie Store API support / PostgreSQL isolation | CookieStore is supported in current Chrome/Edge 87+, Firefox 140+, Safari 18.4+; PostgreSQL READ COMMITTED takes a new snapshot per statement, REPEATABLE READ one per transaction. |
| Ponytail / `/ponytail-audit` | Requested native audit skill | **BLOCKED:** no `ponytail` or `ponytail-audit` skill/command exists in the checked skill roots (`~/.config/opencode/skills`, `~/.claude/skills`, repo `.claude`). No native Ponytail report was produced. This report remains a manual, evidence-led audit. |
| Local | Unit/integration suites, typecheck, lint, build, DB probes, git/workflow inspection | See checkpoints below. |

No proprietary source or secrets were sent to research services.

## 4. Execution waves and checkpoints

| Checkpoint | Work performed | Evidence |
|---|---|---|
| A. Reconnaissance | Repository/module/API/action/migration inventory; architecture and dependency map; test inventory | `audit/ARCHITECTURE_MAP.md`, `audit/MODULE_INVENTORY.md`, this file |
| B. Global checks | Unit suite, scoped typecheck/lint, production build, dependency audit, migration metadata | `audit/checks/current-unit.log`, `current-typecheck-scoped.log`, `current-lint-scoped.log`, `current-build.log`, `dependency-audit.log` |
| C. POS | Source trace + 16-file integration suite + PWA E2E scenario + receipt/session review | `audit/modules/POS.md`, `audit/checks/current-pos.log`, `browser-guarded.log` |
| D. Accounting | Source trace + 13-file integration suite + isolated cash-guard probe | `audit/modules/ACCOUNTING.md`, `current-accounting.log`, `cash-guard-isolated.log` |
| E. Warehouse | Source trace + 17-file integration suite | `audit/modules/WAREHOUSE.md`, `current-warehouse.log` |
| F. Other modules | Purchasing, HR/payroll, analytics, master data/settings/IAM, import/export, platform | `audit/modules/*.md` |
| G. Cross-module | Sale→stock→cash→journal; receipt→stock→AP→journal; return→stock→journal; session close→variance | `audit/modules/*.md`, integration chains |
| H. Final | Deduplicated findings, coverage/gaps, roadmap | `audit/FINDINGS.md`, `audit/COVERAGE.md`, `audit/FINAL_REPORT.md` |

## 5. Test strategy and safety

- **Tier 0:** unit suite, typecheck, lint, build, dependency audit, git/workflow inspection.
- **Tier 1:** targeted integration suites against isolated PostgreSQL 18 test databases (`bisa_deep_test` and the fresh `bisa_p1_test`) on loopback. The Vitest guard requires a `*_test` database; no production or ambient database was touched.
- **Tier 2:** one Playwright fault-injection scenario (offline/PWA) against a disposable test database and production build; no load test, no printer, no native client.
- State-changing tests were limited to disposable test companies/fixtures. The seeded demo company is test data.
- The audit tooling created `audit/checks/**` and `audit/repro/**`. The prior audit's 1.9 GB source copy and root-owned PostgreSQL data were moved out of the repository; repository-wide typecheck/lint/build now pass. A fresh disposable `bisa-p1-pg` container was used for the P1 regression run.

## 6. Current progress

- Reconnaissance and module inventory: **complete**.
- POS, Accounting, Warehouse deep audits: **complete**, with the evidence gaps in `COVERAGE.md`.
- Remaining modules: **complete at baseline/scoped depth**, with high-risk paths escalated.
- Cross-module chains: **complete for the tested fixtures**; production-volume reconciliation remains untested.
- System-wide performance/security/reliability: **assessed**; no load, backup/restore or Electron-client run.
- P1/P2/P3 remediation: **complete** — all identified code/test findings fixed or closed; regression evidence in `COVERAGE.md`/`FINDINGS.md`. Remaining work is independent verification (production RLS, GitHub CI, Electron, load, backup/restore, printer, full E2E).
- Final report: **complete**, with explicit blockers and unverified areas.

## 7. Revalidation of the prior baseline

| Prior finding | Current status |
|---|---|
| ACC-001 cash guard race | **Not reproduced.** Isolated two-transaction probe: 1 posted, 1 rejected, final balance 300. The failing shared-fixture test is invalid because earlier tests add ~580k cash to the same company. |
| HR-001 overtime duplicate submission | **Mitigated** for concurrent submissions; test passes. |
| HR-002 concurrent leave over-quota | **Mitigated** for the quota test; test passes. |
| IAM-001 last-owner demotion | Source now locks the organization row; no DB race test was run. **PARTIAL.** |
| PUR-001 PO retry key | Fixed: form sends a stable key. |
| ANL-001 return netting | Fixed: analytics subtracts posted returns and includes return-only products. |
| SEC-001 telemetry log injection | Fixed: bounded body/fields, reserved server keys, scalar lengths. |
| QA-001 CI integration | Fixed: CI runs `pnpm test:integration`; fixture/assertion isolation fixed (QA-002) and full POS suite is 144/144. |
| POS-001 PWA cookie-header | Superseded by cache-id persistence in Cache Storage + page postMessage; POS-006 fixed and E2E 2/2. |
| POS-005 first receipt token | **Fixed 2026-11-23:** token propagated; explicit copy marker; A4 fresh-token access; receipt tests 12/12. |
| POS-006 offline first load | **Fixed 2026-11-23:** cache id persisted; PWA E2E 2/2. |
| POS-002 outbox retention | **Fixed (control):** `pruneResolvedPosOutbox` + `prune:pos-outbox`; unresolved rows preserved. |
| CORE-02 module switch | **Fixed:** bank/import/purchase-advance gates; import entity module helper test. |
| WH-001 receipt replay | **Fixed:** request fingerprint; changed retry conflicts; integration test. |
| DATA-001 report snapshot | **Fixed:** repeatable-read snapshot; consistency test. |
| SEC-002 seed credentials | **Fixed 2026-11-23:** production opt-in + unique ≥16-char password; demo credential rejected; production password not printed. |
| SEC-003 CI security scanning | **Fixed (CI gate):** audit + gitleaks + Semgrep job; local audit/Semgrep pass. |
| PLT-001 Tauri source | **Resolved 2026-11-23:** Tauri release path retired; stale workflow/script/CLI removed; Electron is the documented desktop. |
| PERF-001 ledger stream | **Fixed (control):** 60s idle timeout + concurrent export cap; not load-tested. |
| QA-002 test isolation | **Fixed:** full POS 144/144; cash/HR/returns 24/24; brittle assertions removed. |
| QA-003 file-size ratchet | **Fixed (registered debt):** three files registered with refactor comments; unit 1,219/1,219. |
| HR-003 legacy overtime | **Closed — intended safe behavior:** reject one duplicate before approving; test covers it. |
| TXN-001 idempotency retention | **Fixed:** journal fingerprints retained; retention test passes. |
