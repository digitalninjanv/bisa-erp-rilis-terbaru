# Cross-Module Integration Audit

**Scope:** data and control flows crossing POS, accounting, inventory, purchasing, HR and reporting. Each lifecycle was source-traced at the primary action/domain boundary. No live DB transaction, job retry, network outage, or simultaneous cashier/warehouse activity was executed.

## Lifecycle evidence

| Lifecycle | Source-level flow reviewed | Atomicity/invariant visible in code | Status |
|---|---|---|---|
| POS sale → payment → stock → cash → accounting | `src/server/actions/pos.ts:257-364` → `src/server/pos/sales-create.ts:22-82` → sales persistence, stock, cash, journal and audit helpers | One `withCompany` transaction; server quote; idempotency/fingerprint; session/stock locking; journal posting and audit within transaction | Source-traced, not DB-verified. ACC-001 can still allow two separate cash outflows to pass the shared block-policy balance guard concurrently. |
| POS return/void → stock restore → refund/credit → journal reversal | `src/server/pos/returns.ts`, `sales-void.ts`, `returns-settlement.ts`, common inventory and accounting services | Origin sale and return quantities checked; source values used; stock/financial reversal composed transactionally | Source-traced; no integration run. |
| Purchase request → PO → goods receipt → stock/AVCO → payable/journal | `src/server/purchase-requests.ts`, `src/server/purchasing.ts`, `src/server/inventory/receipts.ts` and receipt posting helpers | PO/receipt state and remaining quantities checked; stock, AP/advance and GL write in receipt transaction | Source-traced; no DB rollback or 3-way match execution. PUR-001 means UI retries can create a second draft PO before receipt. |
| Supplier return → stock movement → payable/credit/advance → GL | `src/server/supplier-returns/**` plus `src/server/inventory/movements.ts` and `src/server/accounting.ts` | Provenance and remaining return quantity checked; source cost/value and resolution path recorded | Source-traced; no return/GL reconciliation fixture run. |
| Stock adjustment/opname → valuation → GL | Inventory adjustment/opname post domains → `applyStockMovement` → `postJournal` | Document status/row locks; stock ledger and journal composed under caller transaction | Source-traced; not reconciled against live ledger. |
| Cashier shift → cash reconciliation → accounting/report | `src/server/pos/sessions.ts`, cash movement service, `src/server/accounting.ts`, reports | Session lock, expected-cash guard, difference journal/audit in controlled close path | Source-traced; no register close. |
| Payroll run → payroll payable → payment → bank/GL/report | HR run actions/domain, `src/server/hr/payroll-runs.ts`, shared accounting and payroll export | Run journal and later payment journal are separate with state checks; payment uses cash/bank account and idempotency; void reverses posted source journal | Source-traced; no payroll fixture, bank export, or close-period test. |
| Import opening stock/balances → products/subledger → journal | `src/app/api/import/parse/route.ts`, import action/commit phases, stock and accounting services | File hash/job lock, batches, stock ledger, opening journal and job status within transaction scope | Source-traced; import/DB suites blocked. |
| Posted sale/return → sales reports/analytics | `src/server/reports/sales.ts` and `src/server/analytics.ts` | Standard reports subtract posted returns; analytics product/risk views do not | Confirmed mismatch ANL-001; tests not run. |
| Successful payment → receipt print | POS receipt endpoints/components and `pos-electron/main.cjs:69-145` | Sale has already committed; print result can be failed/uncertain and operator is instructed to inspect before retry | Source-traced; no printer test. Print failure does not rollback or duplicate the sale; paper duplication remains possible if operator reprints without checking. |

## Failure and concurrency scenarios requested

| Scenario | Source inspection | Executed here? | Status |
|---|---|---|---|
| DB rollback midway through sale/receipt/return | Tenant transaction boundaries and domain composition reviewed | No | Rollback behavior inferred from transaction use; not runtime-proven. |
| Network interruption / duplicate checkout | POS idempotency and offline review logic reviewed | Local browser tested only for cookie header; no live sale | DB replay test blocked. |
| Concurrent cashier checkout vs same stock | Shared product/on-hand lock order reviewed | No | Existing race tests exist but did not run. |
| Concurrent warehouse write vs cashier sale | Common `applyStockMovement` lock order reviewed | No | Requires isolated DB barrier test. |
| Background job retry | No app job queue/worker discovered; backup/restore systemd jobs are operational | No | No business background retry lifecycle found to simulate. |
| Print failure after committed payment | Electron timeout/uncertain UI behavior reviewed | No | Hardware/runtime not available. |
| External API/service failure | No third-party payment gateway or ERP business API was discovered in the scanned route families | No | Device updater and print are reviewed statically only. |
| Account negative-balance race | Shared guard and subsequent document sequence order inspected | No | Strong Evidence, no PostgreSQL reproduction (ACC-001). |
| HR quota and user role concurrency | Shared read/check/write actions inspected | No | Strong Evidence, no PostgreSQL reproduction (HR-001, HR-002, IAM-001). |

## System consistency conclusions

- Core POS, receipt, return and stock paths generally use shared domain services and tenant transactions, which limits partial posting risk in source.
- Idempotency is implemented for POS sale and several business documents, but it is caller-dependent for the purchase order form (PUR-001).
- Accounting's cash-negative `block` policy has a gap under concurrent outflows even though each individual transaction validates the projected balance (ACC-001).
- Inventory stock writes share explicit locks; warehouse runtime consistency still needs executed race/reconciliation tests.
- Analytics product facts are inconsistent with standard sales reports where posted returns exist (ANL-001).
- This source trace cannot establish real transaction rollback, RLS behavior, server-driver isolation, deployment retries, or data parity without a disposable PostgreSQL run.

## Verification plan

Use a disposable, named `*_test` PostgreSQL DB and independent connections. Execute the repository's import/export, POS, warehouse, finance, HR, analytics and owner-role tests; add barrier-based regressions for ACC-001, HR-001/002 and IAM-001. Compare `stock_on_hand` to movement ledger, subledgers to GL, sales less returns to reports, session cash to movements, payroll run/payment to journal, and imports to audit/job state. Test rollback and duplicate replay after injected failure points. No such run is claimed in this report.
