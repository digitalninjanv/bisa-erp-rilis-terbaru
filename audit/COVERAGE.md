# Coverage and Verification Matrix

**Snapshot:** HEAD `6140f97` + working-tree changes, 2026-11-23. Evidence is limited to what was actually executed or is unambiguously visible in current source. A file inspected is not a workflow verified.

## Status definitions

- **VERIFIED (suite/probe):** the named workflow family was exercised against the disposable PostgreSQL 18 fixture or a deterministic probe, and the assertions passed. This does not certify every branch or production volume.
- **PARTIAL:** some real runtime evidence exists, but one or more assertions failed, a required client/device was unavailable, or only part of the workflow was exercised.
- **SOURCE-TRACED:** the current code path was inspected end-to-end; no runtime proof of the business transaction.
- **NOT TESTED / BLOCKED:** no valid evidence, or the environment cannot support the test.

## Executed checks — 2026-11-23

| Check | Result | Evidence / scope |
|---|---|---|
| Unit suite | **1,235 passed / 1,235** | `audit/checks/pos-unit-after-scan.log`; 143 files. QA-003 ceilings registered; no business failure. |
| Typecheck | **PASS** (repo-wide) | `audit/checks/validate-typecheck-final.log` |
| Lint | **PASS** scoped to `src tests e2e scripts` | `audit/checks/validate-lint-final.log` |
| Production build | **PASS** | `audit/checks/validate-build-final.log` |
| Dependency audit | **PASS** (`pnpm audit --prod --audit-level=high`) | Local run: no known vulnerabilities. CI job added; GitHub run not executed. |
| SAST | **PASS locally** (Semgrep `p/typescript`, error severity, 0 findings) | `audit/checks/validate-semgrep.log` |
| Migration metadata | PASS (`drizzle-kit check` recorded earlier); 89 SQL migrations, latest `0088` | `audit/checks/migration.log`, `src/db/migrations/` |
| POS receipt/invoice P1 set | **12 passed / 12** | `audit/checks/p1-pos-receipts.log`; fresh-token, no-token original, `salinan=1`, A4 |
| POS integration (full module) | **151 passed / 151** (17 files) | `audit/checks/validate-pos-after-scan.log`; adds POS-007 exact-code scan set to the previous 144 |
| POS hot-path lab benchmark | barcode 100k **65.2→4.9 ms p50**; checkout commit 39–50 ms p50; 20-way same-SKU 20/20, stock exact; snapshot 1.08 s/3.2 MB full, 22 ms/13 KB delta | `audit/checks/pos-search-bench-*.log`, `pos-concurrency*.log`, `pos-deadlock-probe.log`, `pos-snapshot-bench.log`, `pos-ui-bench-*.log`; single host, no production load |
| Full integration suite | **1,112 passed / 1,112** (138 files) | `audit/checks/final-integration.log`; baseline reseeded first (`final-reseed.log`) |
| Accounting integration | **96 passed / 96**, 13 files | `audit/checks/validate-accounting2.log` |
| Warehouse integration | **124 passed / 124**, 17 files | `audit/checks/current-warehouse.log` |
| Import/purchase-advance regression | **39 passed / 39**, 7 files | `audit/checks/validate-import-advances.log` |
| Receipt idempotency | PASS: same payload replays, changed payload conflicts | `tests/integration/goods-receipt.test.ts` (new test) |
| Report snapshot consistency | PASS: READ COMMITTED sees new commit; snapshot does not | `tests/integration/report-snapshot-consistency.test.ts` |
| Idempotency retention | PASS: journal fingerprint retained, other old key pruned | `tests/integration/idempotency-retention.test.ts` |
| Cash-guard isolated probe | **1 posted, 1 rejected, balance 300** | `audit/checks/cash-guard-isolated.log`, `audit/repro/cash-guard-isolated.ts`; confirms ACC-001 guard works; test fixture isolated |
| Production seed guard | **Rejected (exit 1)** with a clear production message | `audit/checks/p1-production-seed-guard.log`; dev path still works |
| Tauri release retirement | **PASS**: workflow/script absent, `tauri` script and CLI absent, Electron documented | `audit/checks/p1-release-retirement.log` |
| PWA E2E scenario | **2 passed / 2** | `audit/checks/validate-pwa-final.log`; first offline reload + sync one sale |
| RLS schema inspection | 100/100 company-scoped tables have RLS enabled; `app_user` is `NOBYPASSRLS` | Live `bisa_deep_test`/`bisa_p1_test` catalog query; production grants/policies still need deployment verification |

## Reproduction environment

- Primary audit fixture: disposable PostgreSQL 18.6 container (`bisa-deep-audit-pg`, database `bisa_deep_test`). It was stopped and its data moved out of the repository (it made repository-wide build scan root-owned files) to `/home/najib/Downloads/bisa-erp-audit-pgdata`.
- P1 regression fixture: fresh disposable container `bisa-p1-pg` with database `bisa_p1_test` (PostgreSQL 18.6, `erp` owner / `app_user` application role) on loopback port 55479. It contains a fresh migration + demo seed; no production/ambient database was used.
- The 1.9 GB prior-audit source copy is at `/tmp/opencode/bisa-audit-artifacts/sandbox`.
- Commands used (replace placeholders; run only against a disposable DB):
  ```bash
  export BISA_TEST_DATABASE_URL='postgresql://app_user:<password>@127.0.0.1:55479/bisa_p1_test'
  export BISA_TEST_DIRECT_URL='postgresql://erp:<password>@127.0.0.1:55479/bisa_p1_test'
  pnpm exec vitest run <test-file...>
  ```
- The cash-guard probe is `audit/repro/cash-guard-isolated.ts`; run it with the same DB URL and `.env.local` auth secret, then inspect `audit/checks/cash-guard-isolated.log`.

## POS workflows

| Workflow | Evidence | Status |
|---|---|---|
| Product catalog, barcode/search, packaging, quote | `tests/integration/feature-matrix-pos`, `pos-search-category`, `pos-search-exact`, `packaging-pos`, `pos-quote-parity`; exact scan now uses the three unique indexes (POS-007); typed search uses name trigram/name index | VERIFIED (server quote/search); UI timing measured on lab fixture only |
| Cart, pricing groups, manual discount, tax, rounding | `pos-quote-parity`, `packaging-pos`, chain `audit-a2-chains` journal assertions | VERIFIED (calculation assertions); UI render timing measured, not production load |
| Checkout, double-submit, retry, split tender, held sale | `pos-audit-remediation`, `pos-guards`, `pos-hold-cash`, `erp-concurrency-remediation`; E2E lost-response replay passed | VERIFIED (fixture + one browser fault scenario) |
| Two cashiers / last stock / negative-stock policy | `sales-create` locks products, stock rows; `warehouse-race` and checkout tests; 4/8/20-way same-SKU and opposite-order probes all committed with exact stock | VERIFIED (lab probe); no multi-host/production load |
| Credit/debt sale, customer limit, due date | `pos-debt-sales`; customer row `FOR UPDATE`; quick-add starts with zero credit | VERIFIED (suite); seed-customer fixture blocked one account test |
| Return/refund/exchange/store credit, stock restore, journal | `pos-returns`, `audit-a2-chains`; origin sale locked; original line cost/tender; return idempotency fingerprint | VERIFIED for financial/stock and original-print assertions after POS-005 fix |
| Void sale, cash refund, AR/credit reversal | `pos-returns`, source `sales-void`; void blocked when posted returns exist | VERIFIED (suite/source) |
| Cash session open/close, cash in/out, variance | `pos-session-close-hardening`, `pos-audit-remediation`; session row lock; tolerance/reason guard | PARTIAL: 2 fixture-state failures; no live cash reconciliation |
| Receipt, reprint, A4 invoice, print | `p1-pos-receipts.log` 12/12; token propagation unit tests; `pos-receipt`; `printReceiptViaPopup` | **VERIFIED** for page/token/copy/A4 behavior; physical printer and browser click-through still NOT TESTED |
| Offline shell, outbox, reconnect sync, supervisor settlement | `pos-offline-tahap2`, PWA E2E; same `processOfflineSaleItem` engine | VERIFIED for first offline reload/sync (PWA E2E 2/2); full outage/retry lifecycle NOT TESTED |
| Desktop pairing, device token, snapshot, sync, updater | `pos-device-api`, `pos-terminals`; digest-only tokens; snapshot omits cost | PARTIAL: server API tested; Tauri retired, Electron packaging/install/pair/print/update NOT TESTED; physical printer NOT TESTED |

## Accounting workflows

| Workflow | Evidence | Status |
|---|---|---|
| CoA, hierarchy, mappings, cash/bank class | `accounting-actions-p2`, `a27-b1/b2/b3` | VERIFIED (suite) |
| Manual journal, balance, account state, period guard | `journal-validation`, `accounting-integrity`, `journal-draft`; `postJournal` central gate | VERIFIED (suite) |
| Automatic journals from POS/warehouse/purchasing/payroll | `audit-a2-chains`, module suites | VERIFIED for tested fixtures; all source-type branches not enumerated |
| Journal reversal / append-only | `fix-a24-t4-journal-links`, `journal-source-*`; DB triggers block posted mutation | VERIFIED (suite + schema) |
| Cash-negative policy under concurrency | Isolated probe: one 700 outflow rejected, balance 300; account row `FOR UPDATE` | VERIFIED (probe + isolated concurrent test) |
| AR/AP, payments, credits, aging, write-offs | `a26-q8-payables-parity`, `accounting-actions-p2`; AR/AP source | VERIFIED (suite) for fixture; large-aging dataset NOT TESTED |
| Bank statement import, matching, journal link | `bank-reconciliation`; amount/account/status checks; partial unique index on matched journal line | VERIFIED (suite + schema) |
| Period close / year-end / locking | `accounting-integrity`, `periode` action source; period row lock | PARTIAL: closing/year-end runtime path not separately exercised at production data |
| Tax (PPN/PPh), fixed assets, depreciation | Source + fixed-asset domain; unique run-per-period index | PARTIAL: fixed-asset runtime not in the executed accounting file list; statutory correctness not certified |
| Financial statements and report consistency | `laporan` page builds income/balance/cash flow in one read-only transaction | VERIFIED for snapshot consistency; large-dataset benchmark NOT TESTED |

## Warehouse workflows

| Workflow | Evidence | Status |
|---|---|---|
| Product/SKU/packaging master | `packaging-warehouse`, `packaging-purchasing` | VERIFIED (suite) |
| Goods receipt, PO link, price variance, AP, journal | `goods-receipt`, `purchase-order`, `purchase-advances`; supplier/invoice lock | VERIFIED (suite) |
| Receipt void, AVCO reversal, stock availability | `receipt-void-avco`, `inventory-void-import` | VERIFIED (suite) |
| Stock movement, on-hand, AVCO, stock card/value | `stock-card-valuation`, `inventory-p1/p2`; product → on-hand lock order | VERIFIED (suite) |
| Transfers, transit, partial receive | `warehouse-race`, `packaging-warehouse` | VERIFIED (suite); production contention NOT TESTED |
| Adjustments, approval/posting, opname | `inventory-adjustment`, `inventory-p1/p2`, `opname-tasks`; sorted product locks | VERIFIED (suite) |
| Supplier returns, replacement, credit/refund/advance | `supplier-returns`, `purchase-advances` | VERIFIED (suite) |
| Batches, expiry/FEFO, serials | `stock-batches` | VERIFIED (suite) |
| Concurrent stock changes / lost update | `warehouse-race`, sale-vs-receipt test | VERIFIED for tested cases; long mixed workload NOT TESTED |
| Import/export and bulk master data | Source/tests exist but not in the executed warehouse file list | PARTIAL / NOT TESTED runtime in this pass |

## Other modules

| Module | Evidence | Status |
|---|---|---|
| Purchasing / purchase requests | `purchase-order`, `purchase-advances`, `packaging-purchasing`; PO form now sends stable idempotency key | VERIFIED (suite); PR approval role paths PARTIAL |
| HR / payroll | `hr-concurrency`: 2 pass, 1 fail (legacy overtime policy); payroll calculators unit/source | PARTIAL: payroll run/payment/void not executed against DB in this pass; statutory inputs need customer/advisor review |
| Analytics / reporting | `analytics.ts` now subtracts posted returns and includes return-only products; source + prior integration | PARTIAL: no production-size dataset; snapshot consistency fixed |
| Master data / settings / IAM | Source + `user-management` test exists; owner row lock in source | PARTIAL: owner-demotion race not executed against PostgreSQL in this pass |
| Import / export | Source controls: bounded streams, ZIP limits, formula neutralization, permission checks | SOURCE-TRACED; import round-trip not executed in this pass |
| Platform / security / operations | Auth/rate limit, CSP, RLS schema, CI, backup scripts, Electron hardening reviewed | PARTIAL: no live auth/ASVS test, no backup/restore drill, no Electron installer smoke, no printer |

## Cross-module chains

| Chain | Evidence | Status |
|---|---|---|
| POS sale → payment → stock → cash movement → journal → audit | `audit-a2-chains`, `pos-*`, `erp-concurrency-remediation`; one transaction | VERIFIED (fixture); receipt token/copy assertions now pass |
| Purchase → receipt → stock/AVCO → AP → journal | `goods-receipt`, `receipt-void-avco`, `warehouse-race` | VERIFIED (suite) |
| Return → refund → stock restore → journal reversal/offset | `pos-returns`, `audit-a2-chains` | VERIFIED (fixture); receipt token/copy assertions pass (POS-005 fixed) |
| Adjustment → valuation → journal | `inventory-adjustment`, `stock-card-valuation` | VERIFIED (suite) |
| Cashier close → expected cash → variance journal | `pos-session-close-hardening` + source | PARTIAL: fixture-state failures; no live close |
| AR/AP subledger ↔ GL ↔ aging | `a26-q8-payables-parity`, `accounting-integrity` | VERIFIED (fixture); production reconciliation NOT TESTED |
| Period close → statements | Source + `accounting-integrity` | PARTIAL: no year-end production exercise; reports now use snapshot |

## Blocked or not tested

- Live printer, paper-out/jam after a committed sale; ESC/POS throughput.
- Electron desktop packaging/install/pair/print/update smoke test; the Tauri prototype is retired.
- Full browser matrix and complete E2E suite (23 spec files; only one 9-test file executed).
- Production RLS grants/policies, real authentication/session penetration test, mandatory-MFA policy.
- Backup/restore/PITR drill and deployment rollback.
- Representative load beyond the POS lab fixture: production/staging API p50/p95/p99, mixed reporting+POS pool wait, memory/CPU, 100k-product browser run, long-ledger download pressure. POS hot paths were measured on a disposable single-host DB (2026-11-24).
- Statutory payroll/tax/PSAK/IFRS certification. This audit does not certify legal compliance.
- Import/export round-trip and very large XLSX/ZIP adversarial cases in this pass.
