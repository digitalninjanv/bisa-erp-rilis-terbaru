# Accounting & Finance — Deep Audit

**Scope:** chart of accounts and mappings, manual/automatic journals, posting, reversals, ledger, fiscal periods/year-end, AR/AP and party credits, cash/bank transfers and reconciliation, expenses, tax, fixed assets/depreciation, payroll integration, financial reports.
**Evidence run:** 13 integration files, 96/96 passed (`audit/checks/current-accounting.log`); isolated cash-guard probe passed (`cash-guard-isolated.log`); full unit suite 1,219/1,219.

## Inventory and traceability

| Surface | Main code | Notes |
|---|---|---|
| Journal engine | `src/server/accounting.ts` (`postJournal`, `reverseJournalEntry`, cash guard), `accounting-reversal.ts`, `journal-idempotency.ts` | Single gate for app journals; DB triggers enforce balance/append-only posted entries. |
| Periods | `actions/accounting/periode.ts`, `src/server/reports/periods.ts` | Materialized 12 rows/year; close/lock takes the period row lock; closing entries are special-cased. |
| AR/AP | `src/server/payables.ts`, `party-credits.ts`, `reports/arap.ts`, `pos/receivables.ts` | Payments, credits, advances, aging, write-offs; party tags on control-account lines. |
| Cash/bank | `postJournal` cash guard, `acc-bank` actions, `bank-reconciliation/{matching,import}.ts` | Negative-balance policy; statement import/match/link; partial unique index on matched journal line. |
| Tax/assets/payroll | `tax`, `fixed-assets.ts`, `reports`, `payroll-*` | PPN/PPh mapping; straight-line depreciation with one run per period; payroll posts separate expense/payable. |
| Reports | `src/server/reports/{income,balance,cashflow,ledger,ledger-export-stream}.ts` | Multi-query statements; ledger CSV uses repeatable-read cursor. |

## Verified controls

- **Balanced journal gate:** `postJournal` canonicalizes debit/credit, rejects negative/dual-sided lines, validates company-owned postable/active accounts, locks the fiscal period, and inserts header+lines+monthly summary inside one transaction. DB trigger `assert_journal_balanced` backs the invariant; posted headers/lines reject UPDATE/DELETE.
- **Period interlock:** posting takes `fiscal_periods ... FOR UPDATE`; close takes the same lock. A missing period is treated as closed outside the lazy current/next-year window.
- **Reversal trail:** `reverseJournalEntry` checks posted status, rejects a second reversal, rejects statement-linked journals, and posts a swapped entry with `reversalOfId` plus a stable idempotency key. Manual journals only; module-sourced journals must be voided at their source.
- **Cash-negative policy:** `evaluateCashNegativeGuard` computes net outflow, locks the cash/bank account row `FOR UPDATE`, then aggregates the posted GL balance. Reversals are exempt. **Runtime probe:** a fresh company with 1,000 cash, two concurrent 700 withdrawals → exactly one posted, one rejected, final balance 300 (`audit/repro/cash-guard-isolated.ts`).
- **AR/AP and party credits:** payments validate sale state/date, receipt account class/active/postable, cash-session requirement, fee, overpayment→customer credit, and idempotency. Supplier credit/advance/refund paths are covered by the payables suite. Bank matching validates same account, posted/live entry, exact amount, and one-to-one claim (DB partial unique index).
- **Fixed assets:** unique partial index prevents two live depreciation runs for the same company/period; each run journals one depreciation entry; void reverses the journal and allows reprocessing.

## Invariant checklist

| Invariant | Result |
|---|---|
| Every posted journal balances | **PASS** in suite; `postJournal` + DB deferred/trigger guard |
| Debit/credit precision and rounding | Decimal/numeric used; tested cases pass; no exhaustive property test |
| No missing/duplicate postings | Fingerprints/idempotency on POS/payments/journals; journal fingerprints retained |
| Fiscal periods respected | Period row lock + status guard; year-end production path PARTIAL |
| Reversals preserve audit history | Append-only triggers + `reversalOfId`; tested links/reversal suite |
| Reports reconcile with source | Fixture-level accounting suite; report bundles now use a repeatable-read snapshot |
| Failed operations cannot partially post | One tenant transaction; no injected mid-commit failure test |
| Permissions protect financial operations | `accounting.*` + module gate, including bank/import/purchase advances |

## Findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| DATA-001 | **P2 — FIXED** | Report/dashboard bundles use `withCompanyReadOnlySnapshot`; consistency test passes. | FIXED / VERIFIED |
| PERF-001 | **P2 — FIXED (control)** | 60s idle timeout + concurrent export cap (`BISA_LEDGER_EXPORT_LIMIT`, default 4); not load-tested. | FIXED (control) |
| CORE-02 | **P2 — FIXED** | Bank-reconciliation actions use `requirePermissionInModule`; import/purchase-advance gates added. | FIXED (source) |
| TXN-001 | **P3 — FIXED** | Journal idempotency keys excluded from retention prune; integration test. | FIXED / VERIFIED |
| ACC-001 (prior) | — | Cash guard race is **not reproduced**; the failing shared test is invalid. | REVALIDATED |

### DATA-001 detail

`withCompanyReadOnly` starts a READ COMMITTED transaction (`src/db/tenant.ts:19-28`). PostgreSQL gives each statement a new snapshot; “two successive SELECT commands can see different data … within a single transaction” (official PostgreSQL 19 docs, 13.2.1). The statements page calls income statement, prior income statement, balance sheet, prior balance sheet, or cash flow sequentially inside that helper (`laporan/page.tsx:111-129`); AR/AP and analytics pages do the same. A concurrent sale/payment/journal can therefore make the report internally inconsistent even though each query is correct. `withCompanyReadOnlySnapshot` already exists (`tenant.ts:34-43`) and is used for the ledger stream. Fixed 2026-11-23: the named report/dashboard pages now use `withCompanyReadOnlySnapshot`; `report-snapshot-consistency.test.ts` proves READ COMMITTED differs while snapshot is stable.

### ACC-001 revalidation — why the shared test failed

The shared `erp-concurrency-remediation` company receives cash from earlier tests in the same file (F10/F08/F17 sales) before the cash test. Its cash balance is ~580,000, so two 700 withdrawals are both legitimately covered; the test’s expected “one rejected, balance 300” assumes the company has only the 1,000 seed. The guard’s `FOR UPDATE` on `accounts` was confirmed by `cash-guard-isolated.ts`: one posted, one rejected with the projected −400 message, balance 300. The product control works for this scenario; the test is a fixture-isolation defect (QA-002). Residual risk: different isolation levels and multi-account journals were not stress-tested.

## Performance observations (not measured)

- No query plans, latency percentiles, pool wait, or report timing were measured. The cash guard aggregates the full posted history for an outflow account while holding its row lock; this is index-supported but grows with history.
- The ledger stream is intentionally cursor/stream based with a 60s idle demand timeout; slow clients can still hold a snapshot/connection. No concurrent-download pressure test.
- Report pages issue several queries plus prior-period comparisons; cost at 1M journal lines is unknown.

## Test coverage and gaps

- **Covered:** journal validation/integrity, period and draft links, cash/bank classes, payables parity, bank reconciliation, ledger stream, AR/AP actions.
- **Partial:** period close/year-end at production data, fixed-asset depreciation/disposal runtime, tax reports, payroll posting/payment/void.
- **Not tested:** production RLS/grants, actual bank statement feeds, statutory PPN/PPh/PSAK/IFRS compliance, reconciliation at volume, load/latency, backup/PITR.
- **No P0 accounting defect was confirmed.** DATA-001, PERF-001 (control), CORE-02 and TXN-001 are fixed; no active accounting code finding remains. Production-volume report/GL reconciliation remains untested.
