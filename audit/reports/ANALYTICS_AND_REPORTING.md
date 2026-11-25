# Analytics and Reporting Audit

**Scope:** dashboard, analytics, financial and inventory statements, sales reports, ledger and CSV/XLSX export paths. Reviewed server queries and route permissions. No live data fixture or representative large-data benchmark was available.

## Ponytail audit summary

### Must — ANL-001: analytics product metrics ignore posted returns

- **What:** net product sales, margin, ABC/FSN classification, and dead-stock detection against posted returns.
- **Problem:** `getPerformanceDrivers` aggregates original sale lines for `completed` and `returned` sales without joining or subtracting posted `sale_return_lines`. `getRiskControls` likewise classifies a product as “sold in the last 90 days” if any original line exists, even if the sale was fully returned. Product revenue/profit rankings can therefore overstate sales and returned products can disappear from dead-stock alerts.
- **Evidence:** `src/server/analytics.ts:123-147` sums `saleLines.lineTotal`, `qty`, and line profit while filtering both statuses; metrics are returned at `:163-187`. The risk sold-product set uses the same statuses at `:262-273`, then excludes any such product from dead stock at `:319-329`. The ordinary category report explicitly subtracts posted return quantities, values, and profits in `src/server/reports/sales.ts:191-256`; `getSalesSummary` also subtracts posted returns at `:35-91`.
- **Reproduction:** sell product A for 100; post a full return for A in the reporting period; open analytics for that period. Expected: net item revenue/profit and sold/dead-stock classification reflect the return date and returned quantity. Actual: analytics adds the original sale line and does not deduct its return.
- **Impact:** purchasing/replenishment decisions and stock-risk indicators can be based on false velocity, revenue, margin and dead-stock values. The GL and standard sales totals have separate netting logic, so views can disagree.
- **Minimal fix:** reuse a shared return-netting query/model keyed to return date and original sale-line/product provenance; test full and partial returns, returns on a different date from sale, and products present only in return rows.
- **Regression:** DB-backed analytics tests compare product metrics and dead-stock status with sale/return fixtures; include partial and full returns.
- **Severity / priority / complexity:** Medium / P2 / Medium. **Confidence:** Confirmed by source trace; runtime fixture not executed.

### Should — scale and report consistency

- The analytics period is bounded to 366 days in the page (`src/app/app/analisa/page.tsx:77-86`), and displayed lists are sliced to 20 rows only after all analytics rows have been fetched and filtered in memory (`:100-105`, `:119-155`). `getPerformanceDrivers` groups all products in the chosen period and inventory valuation returns the full item list (`src/server/analytics.ts:122-160`, `:308-329`). This is a scalability risk for large catalogs, not a measured bottleneck. Measure query time, rows, heap and TTFB on representative company volumes before adding aggregation or indexes.
- CSV serialization neutralizes spreadsheet formula prefixes (`src/lib/csv.ts:1-32`); sensitive payroll recap requires `payroll.salary`, HR enabled, and fresh session (`src/app/api/export/payroll/route.ts:41-53`). Product/inventory cost columns require `inventory.cost` (`src/app/api/export/products/route.ts:26-38`, `src/app/api/export/inventory/route.ts:21-40`).
- All 16 discovered `/api/export/**` route handlers contain an explicit permission check. This is static route inspection, not a negative authorization test.

### Should — ledger stream resource lifetime

- **PERF-001:** CSV ledger export deliberately keeps a repeatable-read, read-only tenant transaction and server-side cursor open until the client consumes or cancels the response (`src/server/reports/ledger-export-stream.ts:10-15`, `:58-105`; `src/server/reports/ledger-csv-generator.ts:32-35`, `:53-57`, `:84-125`). The database pool is capped at 24 connections per process (`src/db/index.ts:14-22`). Backpressure bounds memory, but a slow or abandoned download can pin a pool connection and old MVCC snapshot. Cancellation cleanup exists. This is a **Strong Evidence operational risk**, not a measured incident. Add export duration/concurrency controls if production telemetry shows pressure; validate slow-client cancellation and monitor active transaction age/pool wait.

## Coverage and limitations

Reviewed analytics indicators, product ABC/FSN and risk queries, standard sales report netting, financial report export assembly, ledger CSV cursor, inventory valuation export pagination, cost permission gates and CSV injection defense. Existing `tests/integration/analytics.test.ts` checks broad output/classification shape but does not assert returned-product netting; integration tests could not run without the guarded disposable PostgreSQL database. No P50/P95/TTFB, query plans, pool-wait or production-volume measurements were collected.

**Verdict:** One confirmed analytics correctness defect; export controls are visible in code; performance conclusions remain static risks pending realistic data/runtime measurement.
