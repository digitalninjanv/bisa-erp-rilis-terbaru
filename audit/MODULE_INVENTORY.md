# Complete Module and Workflow Inventory

**Inventory basis:** current working tree. Discovery was performed once using App Router files, API route handlers, server actions, schema/migration files, tests, deployment scripts and documentation. A discovered path is not by itself proof that its workflow has been runtime-tested.

## Module inventory

| Module / submodule | Discovered scope and main surfaces | Primary report | Audit state |
|---|---|---|---|
| POS terminal and sales | Product search/barcode and packaging, cart/quote, discounts/promotions/customer groups, cash/credit/split tender, checkout, held sales, receipt, history | [POS](reports/POS.md) | Core server flow source-traced; one PWA offline-shell defect; DB and full UI journeys blocked. |
| POS cash sessions | Open/close, cash in/out, close variance, history, print/export | [POS](reports/POS.md) | Session locks and expected-cash guard reviewed; no live cash reconciliation. |
| POS returns/refunds/voids | Return provenance, partial limits, original prices/tenders, stock restoration, void/reversal | [POS](reports/POS.md) | Core source paths reviewed; no live DB return/refund/void test. |
| POS offline/PWA | Service-worker shell caching, local outbox, reconnect sync, retry/review/settlement, duplicate recognition | [POS](reports/POS.md) | Browser cookie-header harness run; real app/browser/database lifecycle not run. Outbox retention/index risk recorded. |
| POS desktop devices | Pair/enroll/login, terminal registry/revocation, snapshots, device sync, session intents, receipt, update | [Integrations & Platform](reports/INTEGRATIONS_AND_PLATFORM.md) | Server API and Electron shell source reviewed; native Tauri source absent. |
| Accounting and general ledger | CoA/mappings, manual/automatic journals, postings, reversals, ledger, period and year-end close | [Accounting](reports/ACCOUNTING.md) | Source-traced; no DB-backed balance, period or concurrency tests. |
| AR/AP and party credits | Receivables/payables, opening balances, payments, returns/credits/advances, aging and write-offs | [Accounting](reports/ACCOUNTING.md) | Source-traced; no live subledger/GL reconciliation. |
| Cash, bank and expenses | Cash/bank accounts, transfers, expenses, reconciliation, cash-negative policy | [Accounting](reports/ACCOUNTING.md) | Source-traced; ACC-001 shared-balance race. |
| Tax and fixed assets | VAT/PPN mapping/report, payroll tax integration, asset acquisition/depreciation/disposal | [Accounting](reports/ACCOUNTING.md) | Source-traced; tax/legal configuration not certified against actual taxpayer facts. |
| Inventory and warehouse | Product/SKU, stock-in/out, stock movements, AVCO, batches/expiry/serial, warehouse, reservation, stock card/value | [Warehouse](reports/WAREHOUSE.md) | Core locks/state transitions reviewed; no DB race reconciliation or large-volume profiling. |
| Stock control workflows | Receipt, supplier/customer return, adjustments, approval, stock count/opname, transfer and in-transit receive | [Warehouse](reports/WAREHOUSE.md) | Source-traced; DB workflows not executed. |
| Purchasing | Purchase request, approval/convert-to-PO, PO lifecycle, receipt match, supplier return, purchase advance | [Purchasing](reports/PURCHASING.md) | Source-traced; PO form idempotency-key gap recorded. |
| HR organization and people | Organization/department/position/shift, employees, attendance and payroll settings | [HR](reports/HR.md) | Source-traced; no legal certification or DB runtime. |
| Leave and overtime | Submit, overlap/quota check, approval/rejection, attendance and payroll linkage | [HR](reports/HR.md) | Source-traced; HR-001 and HR-002 concurrency findings. |
| Payroll and employee finance | Payroll run/post/pay/void, PPh21/BPJS, THR, advances, loans, reimbursements/final pay | [HR](reports/HR.md) | Calculators and flow source-traced; integration tests blocked, statutory inputs require customer review. |
| Analytics and reporting | Dashboard, KPI, sales/product analytics, stock risk, statements, print and report export | [Analytics & Reporting](reports/ANALYTICS_AND_REPORTING.md) | ANL-001 returned-sales mismatch; no production-size benchmark. |
| Master data and merge | Customer/supplier/product/category/unit/packaging, duplicate detection, bulk edit, party merge | [Settings & Master Data](reports/SETTINGS_AND_MASTER_DATA.md) | Merge source reviewed; prior orphan-credit claim is stale; IAM-001 applies to roles. |
| Settings and company configuration | Company identity/tax, branch/location, module switches, payment methods, numbering, printing, custom fields, pricing groups | [Settings & Master Data](reports/SETTINGS_AND_MASTER_DATA.md) | Permission/schema paths reviewed; no browser or DB settings mutation test. |
| Users, roles and permissions | Invite/create, role CRUD/batch, password reset, membership remove, session freshness, module permissions | [Settings & Master Data](reports/SETTINGS_AND_MASTER_DATA.md) | IAM-001 last-owner race. Auth browser/session reset not dynamically tested. |
| Import / export | CSV/XLS/XLSX upload, validation, preview, row mapping/edit, batch commit/cancel/template; CSV/XLSX exports | [Import & Export](reports/IMPORT_EXPORT.md) | Source controls reviewed; DB/round-trip runtime blocked. |
| Platform and operations | Auth, tenant RLS, health, CI, migrations, encrypted backups, restore drill, service deployment/systemd, printer bridge | [Integrations & Platform](reports/INTEGRATIONS_AND_PLATFORM.md) | Static source/config audit; no live deployment, restore or printer exercise. |

## Page and API inventory

- 100 App Router page files in `src/app/app/**` and shared app shell/error routes. Functional prefixes discovered: `pos`, `akuntansi` (including nested HR), `gudang`, `analisa`, `data-master`, and `pengaturan`.
- 32 API route handlers, listed below. Every export route was statically checked for a permission gate.

### API handlers

- Auth/health: `/api/auth/[...all]`, `/api/health`.
- Import: `/api/import/parse`, `/api/import/template/[entity]`.
- Export: `/api/export/account-mappings`, `accounts`, `aging`, `cash-sessions`, `categories`, `customers`, `inventory`, `journal/[id]`, `journals`, `ledger`, `opname-sheet`, `payroll`, `products`, `report`, `suppliers`, `units`.
- POS: `/api/pos/desktop/enroll`, `login`, `sessions`, `transactions`, `transactions/[saleId]/receipt`; `/api/pos/download/[format]`; `/api/pos/pair`; `/api/pos/snapshot`; `/api/pos/sync`; `/api/pos/telemetry`; `/api/pos/update/[target]/[arch]/[version]`; `/api/pos/update/download/[target]/[arch]`.

## Action and persistence inventory

- 59 server-action files under `src/server/actions/`: accounting (8), inventory (9), HR (6), import (6), settings (9), plus POS, users, company, purchasing, purchase requests, supplier returns, reservations, master data, fixed assets, advances/loans/reimbursements and shared helpers.
- Shared schema is split under `src/db/schema/**`; **89 SQL migrations** are present. The latest discovered migration is **0088**. Tenant/RLS policy definitions are source-visible; deployed schema parity was not verified.
- Tests discovered: 133 unit files, 135 integration files, 29 sim2 files, 26 E2E tree files. Only the unit suite was executed in this audit; see [MASTER_PLAN](MASTER_PLAN.md).

## Hidden or absent surfaces explicitly recorded

- No separate sales order / CRM / notification service or background job queue was discovered as an independently implemented module. Sales workflows are POS-led; purchase and party lifecycles are inventory/purchasing domain paths.
- The Tauri native Rust application directory is present only as deletions in the current working tree; its source is unavailable. Do not count its intended features as audited runtime behavior.
- No local/staging DB URL or running PostgreSQL was available; deployment runtime and actual RLS grants/policies are not established by repository inspection alone.
