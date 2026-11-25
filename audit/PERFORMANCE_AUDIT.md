# Performance Audit

> **Current-status note (2026-11-23):** no production-scale measurement was added. PERF-001 remains a static/operational risk; the ledger stream now has a 60s idle-demand timeout, but pool/snapshot pressure is unmeasured. See [PERFORMANCE finding in FINDINGS.md](FINDINGS.md) and [COVERAGE.md](COVERAGE.md).

**Scope:** frontend/POS hot paths, server requests, query/pagination patterns, exports, database pool, memory, async work and capacity assumptions. The audit did not have a running authenticated app, disposable DB, representative data or staging load target.

## Measurements actually available

| Measurement/check | Result | Interpretation |
|---|---|---|
| Unit suite duration | 41.04 seconds for 1,190 tests in 133 unit files | Test throughput only; not ERP request latency. |
| Production build | PASS | Confirms build completes; not a runtime performance measurement. |
| Typecheck/lint | PASS | Static quality checks, no latency evidence. |
| Browser user interaction / POS render timing | Not measured | No live app/browser session was launched. |
| API p50/p95/p99, DB query latency, rows scanned, pool wait | Not measured | No local PostgreSQL or test URL was available. |
| CPU/RSS/heap, request count, concurrent cashier load | Not measured | No profiler/load harness run against app. |
| EXPLAIN/BUFFERS, vacuum horizon, DB locks | Not measured | No database connection used. |

## Performance findings and scale risks

### PERF-001 — streamed ledger can pin a pool connection and repeatable-read snapshot

- **Severity / priority:** Medium / P2 operational risk; no incident measured.
- **Confidence:** Strong Evidence from explicit resource lifetime in source.
- **Location:** `src/server/reports/ledger-export-stream.ts:10-15,58-105`; `src/server/reports/ledger-csv-generator.ts:32-35,53-57,84-125`; `src/db/tenant.ts:31-43`; `src/db/index.ts:14-22`.
- **Behavior:** response backpressure intentionally waits for downstream demand while the cursor and snapshot transaction stay open. Cancellation returns the iterator and closes the cursor, which is a good cleanup path. A slow but still connected client can nevertheless hold one DB connection and an old MVCC snapshot for the download duration. Pool max is 24 per Node process, so total capacity scales with the number of app processes and can be consumed by exports.
- **Recommendation:** instrument active exports, transaction age, pool wait and cancellation; set a maximum export duration/concurrency and test slow-client disconnects. If measurements show pressure, move large ledger exports to an asynchronous file/job workflow or use bounded-snapshot keyset pages with an explicit consistency contract.
- **Validation:** compare pool wait and oldest transaction age under realistic concurrent downloads and cashier traffic; assert disconnect releases cursor/connection promptly.

### Other scale risks (not findings without measurement)

- **POS-002:** outbox JSONB key scans, full payload history retention and settlement scan grow with all retained offline sync attempts. Record plans/rows and p95 sync/review query time after synthetic long-term history before selecting retention/index changes.
- **ANL-001 report:** analytics fetches grouped product rows and full valuation, then filters/sorts/slices to 20 rows in Node (`src/server/analytics.ts:122-160,308-329`; `src/app/app/analisa/page.tsx:100-155`). Query result size and heap can grow with product count. Add query-side pagination/aggregation only after profiling and return-correctness is fixed.
- **Stock hot SKU:** `applyStockMovement` locks product then per-warehouse stock row (`src/server/inventory/movements.ts:51-77`) to keep AVCO and on-hand consistent. This can serialize same-product movement across warehouses; no lock-wait measurement exists. Do not weaken correctness locks based on guesswork.
- **Exports:** inventory/product exports use keyset pages and bounded 500-row DB queries; payroll export requires an explicit run. Ledger export uses cursor streaming. Excel can still consume CPU and depend on client download time.
- **Pool:** `postgres.js` max is 24 per process with 20s idle and 10s connect timeout (`src/db/index.ts:14-22`). A deployment with multiple web workers can exceed the nominal Postgres connection allowance unless total replica/process count is included in capacity planning.
- **POS UI:** source has memoized/controlled terminal structures and no measured render hotspot. The requested interaction/request/rerender timings were not collected; no “instant” or “smooth” claim is made.

## Benchmark plan for staging/CI

1. Seed disposable datasets at small, expected and stress volumes (e.g. 10k/100k/1M sales lines and 10k/100k products where feasible); record dataset shape.
2. Measure p50/p95/p99 for product search, add-to-cart, checkout commit and revalidation, offline sync batch, session close, inventory valuation, ledger export and analytics.
3. Capture SQL count, `EXPLAIN (ANALYZE, BUFFERS)`, lock waits, pool acquisition delay, open transaction age, CPU/RSS/heap, and output size.
4. Load test only isolated staging/CI; include 20+ terminals, hot SKU, concurrent receipt/adjustment and slow/aborted exports. Do not run disruptive load against production.
5. Keep concurrency semantics (idempotency, locks, transaction boundaries) intact; compare correctness reconciliation as well as latency.

## Research references

- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html) and [application-level consistency](https://www.postgresql.org/docs/18/applevel-consistency.html).
- [Drizzle transaction API](https://orm.drizzle.team/docs/transactions).
- Modern Web Guidance security/performance review focus was consulted; client request-body and resource-bound review is reflected in SEC-001 and the import safety report.
- Context7 and Exa MCP were unavailable; no measurement or tool output is invented.

**Verdict:** no application latency baseline or load result exists in this audit. PERF-001 and the outbox/analytics patterns are testable capacity risks, not benchmark findings. Production performance remains unverified.
