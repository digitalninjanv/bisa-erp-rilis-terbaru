# Analytics & Reporting — Scoped Audit

**Scope:** dashboard/KPI, sales/product analytics, ABC/FSN, dead stock, stock risk, income statement, balance sheet, cash flow, equity changes, ledger, sales-by-cashier/category/payment, aging, print/CSV/XLSX exports.
**Evidence:** source trace of `src/server/analytics.ts`, `reports/{sales,arap,income,balance,cashflow,ledger}`, report pages; accounting integration 96/96; no production-size benchmark in this pass.

## Controls observed

- **ANL-001 fixed:** product performance subtracts posted `sale_return_lines` (by return date and product) and includes return-only products with negative quantities/revenue/profit. `getSalesSummary`, sales-by-day/category/product and payment breakdown also subtract posted returns. This aligns analytics with the standard sales reports for the tested logic.
- Reports separate operational revenue, contra-revenue/discounts, COGS, operating/other expense, current/non-current assets/liabilities, and prior-period comparisons. Closing entries are excluded where intended.
- CSV export neutralizes spreadsheet formulas and escapes delimiters/newlines; payroll export has a dedicated salary permission; cost fields are permission-gated. Export handlers were statically checked for a permission gate.
- Ledger CSV streams from a repeatable-read cursor, preserving a consistent snapshot and bounded Node memory; a 60s idle-demand timeout limits a stalled client (see PERF-001).

## Findings / gaps

| ID | Severity | Summary | Status |
|---|---|---|---|
| DATA-001 | **P2 — FIXED** | Report/dashboard bundles use repeatable-read snapshot; consistency test. | FIXED / VERIFIED |
| PERF-001 | **P2 — FIXED (control)** | 60s idle timeout + concurrent export cap; not load-tested. | FIXED (control) |

- **No measured performance data:** no p50/p95/p99, query plans, rows scanned, heap/CPU, or 10k/100k/1M dataset run. `getPerformanceDrivers` still aggregates product rows and computes ABC/FSN in Node; the result size grows with product count. Do not claim a latency target.
- **No formal reconciliation of every report to source transactions** at production volume; the accounting suite covers representative fixtures.
- Report definitions are not certified against PSAK/IFRS or Indonesian tax reporting. This is a product/accounting-policy review, not a code-audit conclusion.
- Print layouts (A4/thermal) and XLSX generation were source-reviewed; no physical print/Excel round-trip was executed in this pass.

## Evidence status

| Workflow | Status |
|---|---|
| Sales summary/day/category/product/payment with returns | VERIFIED (logic/source + suite logic) |
| ABC/FSN/dead stock/stock risk | SOURCE-TRACED; ANL-001 fixed |
| Income/balance/cash-flow/equity | VERIFIED for snapshot consistency; large dataset not benchmarked |
| Aging/AR-AP report | PARTIAL; accounting suite for fixtures |
| CSV/XLSX/print export | SOURCE-TRACED; no large-file run |
| Production performance | NOT MEASURED |
