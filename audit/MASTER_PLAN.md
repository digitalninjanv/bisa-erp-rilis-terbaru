# Master Audit Plan and Progress

> **Current plan/status (2026-11-23):** see [PLAN.md](PLAN.md), [COVERAGE.md](COVERAGE.md), [FINDINGS.md](FINDINGS.md), and [FINAL_REPORT.md](FINAL_REPORT.md). This file records the earlier 2026-11-22 plan; its integration-blocked status is superseded.

**Audit date:** 2026-11-22 (Asia/Jakarta)  
**Repository:** `bisa-erp`, current working tree under `/home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp`  
**Audit mode:** read-only source and repository audit. Only files under `audit/` were created/updated for this deliverable; no application source edits were made by this audit.

## Objective and status

This audit traced the repository's core financial, stock, payroll, identity, import/export and platform workflows, reviewed every discovered app/API module family, and created per-module reports plus a shared findings ledger. The code and static quality checks are complete for the accessible checkout. Runtime validation is **incomplete** because no disposable PostgreSQL service/database is available and the integration-test guard correctly refuses to use ambient/local database configuration. No production database, live deployment, printer, external provider or destructive restore was touched.

**Overall disposition:** do not certify production readiness from this audit. There are confirmed high-priority concurrency/correctness issues and material unverified deployment/runtime areas. No P0 issue was confirmed from the accessible source review.

## Technology and repository baseline

- Next.js 16.4.5 App Router, React 19.3.0, TypeScript 5 strict, Tailwind CSS 4 / Base UI components.
- PostgreSQL 18, Drizzle ORM 0.45.4, `postgres` driver, Better Auth 1.7.15, Zod 4.6.7, Decimal.js 10.6.0.
- pnpm 11.8.0, Node 22.23 locally (CI config currently selects Node 24), Vitest 5.0.5, Playwright, Electron 45.4.1 in `pos-electron/`.
- 100 App Router page files; 32 API route handlers; 59 server-action files; 87 SQL migration files numbered through 0086; 133 unit test files, 135 integration test files, 29 `sim2` test files, and 26 files in the Playwright `e2e/` tree. These are inventory counts, not coverage percentages.
- Primary modules: POS, Accounting/Finance, Inventory/Warehouse, Purchasing, HR/Payroll, Analytics/Reporting, Master Data, Settings/Users/RBAC, Import/Export, POS Desktop/PWA and operational platform/deployment.
- `src-tauri/**` is deleted in the current working tree (`git status`); native Rust client source is not present for this audit. `pos-desktop/` and `pos-electron/` remain.

## Method and required-tool limitations

- Ponytail FULL and ponytail-audit guidance were loaded from the local skill backup and their correctness, safety, real-load, testing, performance and simplicity principles were applied to each scoped report. Reports use prioritized Must/Should/Nice findings with What/Problem/Fix/If skip, Verdict/Lean/Not checked, and a shared full ledger. **The native `/ponytail-audit` command/executable was unavailable**, so no native command run is claimed.
- Context7 MCP and Exa MCP were not present in the connected tool list. They were not called and no output is attributed to them. Official primary-source web docs were used instead for framework/database/security/API and statutory references.
- Modern Web Guidance security guidance was consulted for service-worker request/cookie boundaries, input/resource limits, and sensitive logging. It informed review focus; it did not substitute for source evidence.
- Workspace began with extensive pre-existing modifications and deletions, including source, package, PWA and native-client files. This checkout was treated as the audit target and was not reset or normalized. Findings reference the current working tree only.

## Plan and completion matrix

| Phase | Scope | Status | Result / limitation |
|---|---|---|---|
| 0 | Repository recon, stack, routes, schema, tests, operations, risk plan | Complete | Inventories and architecture map created; deployment database state not queried. |
| 1 | POS | Source audit complete; dynamic partial | Core checkout, quote, payment, stock, GL, session, returns, offline queue and print paths traced. POS-001 confirmed by local Chromium request-header harness; database integration was blocked. |
| 2 | Accounting & Finance | Source audit complete; dynamic partial | Journal, balance/period, payment/void/reversal, AR/AP, bank, tax, fixed assets, close/report paths reviewed. ACC-001 static concurrency risk identified; no DB race reproduction. |
| 3 | Inventory/Warehouse | Source audit complete; dynamic partial | Movement locks, AVCO, batches/serials, receipt, adjustment, transfer, opname, reservations and valuation reviewed. No new confirmed defect in the reviewed write paths. |
| 4 | Purchasing, HR, Master Data, Settings, Analytics/Reports, Import/Export, Users/RBAC | Source audit complete; dynamic partial | PUR-001, HR-001/002, IAM-001, ANL-001 and SEC-001/QA-001 identified; unaffected reports record tested/untested boundaries. |
| 5 | Cross-module integration | Source trace complete; runtime blocked | POS sale/return, purchase receipt/return, stock adjustment, shift close and journal/report boundaries traced. No controlled rollback/concurrency/network tests ran. |
| 6 | Architecture, security, performance, reliability | Source/tool checks complete; runtime partial | Auth/RLS/config/exports/backups/CI inspected. No P95/load/query-plan/memory baseline without an isolated DB and running deployment. |
| 7 | Final verification and report synthesis | Complete for this checkout | All requested report files supplied. Dynamic evidence gaps are explicit; no production-ready declaration. |

## Verification actually performed

| Check | Result |
|---|---|
| `pnpm test` (script is `vitest run tests/unit`) | PASS: 133 unit files, 1,190 tests, 41.04 s. Does not include integration/sim2. |
| `pnpm typecheck` | PASS. |
| `pnpm lint` | PASS. |
| `pnpm build` | PASS; Next production build and typecheck completed. Route map generated. |
| `pnpm audit --prod` | PASS: no known production dependency vulnerabilities reported by the configured audit source at run time. This is not a guarantee against unlisted/zero-day issues. |
| Integration suite attempt | BLOCKED before test startup by `tests/vitest-db-guard.mjs`; explicit isolated `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` were unavailable. No `.env.local` DB values were read or used. |
| Local PostgreSQL / container service | Not available; Docker daemon socket was absent. |
| POS HttpOnly cookie harness | PASS as a browser-platform reproduction: installed headless Chromium exposed `cookie: null` to a service-worker FetchEvent request header. It was a local harness, not the live ERP application. Application offline failure is inferred from the matched worker/proxy code path. |
| Benchmarks, E2E, authenticated browser journeys, actual app request latencies | NOT RUN; no live app/test DB/browser environment. |
| Backup/restore, deployment update, printer, desktop device pairing | NOT RUN; destructive/operational side effects were not appropriate without disposable staging services. |

## Risk-based next steps

1. **P1:** fix and database-test POS shell offline identity, accounting cash guard serialization, owner-role invariant, overtime daily uniqueness/serialization, and leave quota approval serialization.
2. **P2:** net posted returns into analytics; bound/redact telemetry fields and reserve auth/context keys; propagate stable PO idempotency key from the UI; add outbox retention/indexing and ledger export resource controls based on measurements.
3. Add a CI integration job using an explicitly isolated database name containing `_test`; preserve the destructive-suite guard.
4. Restore/provide the intended Tauri native source and audit pairing/keychain/update/rollback against the exact release commit.
5. Run workflow-specific integrations, negative authorization tests, concurrency tests, migration/restore drills and realistic load tests in disposable CI/staging.
6. Collect p50/p95/p99 route latency, connection-pool wait, transaction age, rows scanned, heap/RSS, slow-query and browser interaction timings before accepting performance claims.

## Research references

- [Next.js data security and Server Functions](https://nextjs.org/docs/app/guides/data-security)
- [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html)
- [PostgreSQL application-level consistency](https://www.postgresql.org/docs/18/applevel-consistency.html)
- [Drizzle ORM transactions](https://orm.drizzle.team/docs/transactions)
- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/)
- [MDN FetchEvent request](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/request)
- [DJP PMK 168/2023](https://www.pajak.go.id/index.php/id/pmk-168-tahun-2023-pph-pasal-21-ter) and [PP 35/2021](https://peraturan.bpk.go.id/Details/161904/pp-no-35-tahun-2021)
