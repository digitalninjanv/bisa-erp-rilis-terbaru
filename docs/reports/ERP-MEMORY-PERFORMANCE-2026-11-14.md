# ERP Runtime Memory Check — 14 November 2026

## Scope and safety

This check focuses on the web server's startup and request memory. The repository had no running ERP/Next process on the usual local ports when measurement began. The host had 15 GiB RAM, about 3.3 GiB in use, and 11 GiB available. All test server database URLs pointed to an unreachable local port (`59999`); no production or user database was contacted. Build output was isolated under `.next-remediation`; the generated directory was left in place and not treated as source.

The Repowise index is not initialized for this repository. CodeGraph and the installed Next.js 16.4.5 documentation were available and used instead.

## Findings

| ID | Status / priority | Evidence | Finding |
|---|---|---|---|
| MEM-01 | CONFIRMED / MEDIUM | `package.json` `start`; `next.config.ts` `output: "standalone"`; runtime warning | `pnpm start` used `next start`, which Next.js warns is unsupported for a standalone output. On the same isolated build, the standalone entrypoint used 92,332 KiB RSS after static requests; `next start` used 251,176 KiB RSS across its launcher and server processes. Both served the static manifest with HTTP 200. |
| MEM-02 | DESIGN GAP / MEDIUM | 101 App Router page files; installed Next.js memory-usage guide; build output | Next.js preloads route entries at server startup by default, increasing initial memory. This ERP has 101 pages, so entries are now loaded on demand. The first request to a rarely used route may be slower. |
| MEM-03 | UNVERIFIED | No active deployment, test database, browser session, or realistic volume dataset was available | Long-session heap growth, authenticated page memory, large-report memory, browser/POS Desktop memory, and memory under concurrent store traffic were not measured. No application memory leak is confirmed by this check. |

### Measurements

| Mode | Sample | Result |
|---|---|---|
| Development, Turbopack | `/login` returned HTTP 200; 15 warm requests returned HTTP 200 in 48–69 ms each | Next server settled at 476,688 KiB RSS / 429,626 KiB PSS after compilation. This includes development tooling and is not representative of production runtime. |
| Production standalone | Isolated build, idle then one initial and 10 repeated manifest requests | 84,788 KiB RSS / 51,394 KiB PSS idle; 92,332 KiB RSS after requests; HTTP 200. |
| Production `next start` | Same isolated build and static route | 251,176 KiB combined RSS / 169,594 KiB combined PSS after the request; HTTP 200, with Next.js warning that this command does not work with `output: "standalone"`. |

An early development `ps` sample reported 9,924,580 KiB RSS. At first this was not corroborated by a later sample after eviction. A subsequent non-tracing run recorded a 10,314,824 KiB process high-water mark during first compilation, then about 360,848 KiB RSS after compilation and warm requests. The high-water observation is now corroborated as a transient peak; it does not establish a persistent leak.

## Changes

- `next.config.ts`: set `experimental.preloadEntriesOnStart` to `false`. Next.js 16.4.5 documents this as a way to lower initial server memory by loading page modules on demand. The build output confirms the setting was active.
- `package.json`: change `start` to `node .next/standalone/server.js`, matching the repository's standalone output and Docker runtime entrypoint. The same command pattern was tested against the isolated build; the existing `.next` directory was left untouched.
- Existing Turbopack GC, full memory eviction, server Fast Refresh setting, and root restriction were preserved. The development server started with these configured settings.

## Verification results

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm exec eslint next.config.ts` | PASS |
| `git diff --check` | PASS |
| Isolated `BISA_TEST_BUILD=1 pnpm build` with dummy database URLs | PASS; Next compiled, typechecked, generated all 7 static pages, and listed the application routes |
| Development `/login` and repeated warm requests | PASS; HTTP 200 |
| Standalone production static manifest | PASS; HTTP 200 |
| `next start` against standalone output | HTTP 200 but emitted the unsupported-mode warning described above |
| Unit / integration / E2E / authenticated database workflows | NOT RUN; no disposable ERP test database was available |

The `pnpm start` script itself was not invoked against the default `.next` directory because that directory existed before this check and was preserved. Its target entrypoint was run using the isolated build directory.

## Remaining verification

To determine whether users still see high memory in production, collect process RSS/PSS (or container memory) during authenticated POS, inventory, and accounting workflows with a disposable database and realistic data. Measure browser-tab and POS Desktop memory separately from the Next server. If memory continues to grow during a long session, capture a Node heap profile and compare retained objects before changing application data-loading code.

The independent memory delta from `preloadEntriesOnStart: false` was not measured against a second build with the default enabled; its use is based on the installed Next.js 16.4.5 guide and the confirmed 101-route count.

## Follow-up: request-level memory and data-volume paths

The initial measurements above concern Next.js process startup and static requests. A focused source audit then found application paths that allocated data the page did not render. These changes reduce redundant materialization; without a disposable database and realistic tenant data, their process RSS/latency impact remains unmeasured.

| ID | Status | Evidence and change | Verification |
|---|---|---|---|
| MEM-04 | CONFIRMED; fixed in source | `src/app/app/gudang/page.tsx:46-54` now asks `getInventoryValuation` for one display row and skips low-stock rows. The function still computes quantity/value/potential totals over the full filtered set in SQL, so the dashboard keeps whole-inventory totals without materializing all SKU rows in Node. | Latest typecheck and lint passed. Runtime query/heap measurement not available. |
| MEM-05 | CONFIRMED; fixed in source | `src/server/batches.ts:654-706` adds a dashboard query that returns at most 15 rows and uses window aggregates for exact total and expired counts in the same query. `src/app/app/gudang/page.tsx:56-80,110-120,214-218` uses those totals, preserving the full count while rendering only the bounded list. | A 20-batch integration regression was added to `tests/integration/stock-batches.test.ts`; it was **NOT RUN** because no disposable PostgreSQL test service is available. |
| MEM-06 | CONFIRMED; fixed in source | `src/app/app/akuntansi/(akuntansi)/page.tsx:175-222` previously loaded complete receivable/payable lists and `getReceivablePayableQueues` loaded both complete lists again. `src/server/reports/arap.ts:299-309` now accepts those already-fetched rows. The dashboard calculates exact queue summaries once and retains only the five preview rows after the summary. This removes two full list loads and avoids carrying their remaining rows through render. | A reuse-path integration regression was added to `tests/integration/fix-a22-k5-dashboard-queues.test.ts`; it was **NOT RUN** because no disposable PostgreSQL test service is available. |
| MEM-07 | CONFIRMED; fixed in source | `src/server/year-end-closing.ts:40-75` now sums posted journal debits/credits by account in PostgreSQL before returning rows. Node retains account-level balances rather than every journal line for the year. Numeric results continue through Decimal.js and the existing `signedBalance` rule. | Typecheck and lint verify source; existing year-end workflow integration coverage was not run without the isolated database. No large-volume comparison was measured. |
| MEM-08 | CONFIRMED; fixed in source | `src/lib/pos/pos-offline.ts:105-210,226-278` adds keyed lookup to the memory and IndexedDB adapters. Enqueue duplicate checks and conflict-result updates use `clientKey` lookup instead of reading and sorting the full queue for each result. | A 1,000-item synthetic unit regression asserts 1,000 keyed reads and zero full-list reads. Targeted POS unit test and the full unit suite passed. This verifies operation counts, not browser heap. |
| MEM-09 | CONFIRMED; fixed in source | `src-tauri/src/posdb.rs:1423-1455` returns a recorded sale through a primary-key lookup instead of loading, decoding and filtering every live outbox payload. `src-tauri/src/runtime.rs:92-100` obtains pending count with SQL `COUNT(*)`; `posdb.rs:155-157` adds an idempotent `(status, created_at)` index. The updater session gate now uses `SELECT EXISTS` rather than reading all cash-session history (`runtime.rs:563-571`, `posdb.rs:2067-2074`). | Rust tests verify sale lookup/counts, index use, and open/closed session checks. `cargo test --lib` passed all 65 tests. No user/local POS database was opened or changed by tests. |

The batch dashboard uses PostgreSQL window aggregates to keep exact counts attached to the same filtered row set while limiting returned rows. The year-end query uses SQL aggregation so transfer volume follows account count rather than journal-line count. See the official [PostgreSQL aggregate functions](https://www.postgresql.org/docs/current/functions-aggregate.html) and [window functions](https://www.postgresql.org/docs/current/functions-window.html) references. Next.js likewise recommends measuring memory and examining actual retained objects before making broader runtime changes; see its [memory usage guide](https://nextjs.org/docs/app/guides/memory-usage).

### Verification update

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS on the latest source. |
| `pnpm exec tsc --noEmit --incremental false -p pos-desktop/tsconfig.json` | PASS. |
| `pnpm exec eslint` on all changed source and test files | PASS. |
| `pnpm exec vitest run tests/unit/pos-offline-queue.test.ts` | PASS, 7 tests. |
| `pnpm exec vitest run tests/unit` | PASS, 108 files / 1,054 tests (latest rerun). |
| Warehouse and accounting integration regressions added | NOT RUN; no PostgreSQL test service was available. |
| `cargo test --lib` | PASS, 65 tests. Existing unused-symbol/mutability warnings remain outside this change. |
| `cargo fmt --check` | FAIL: the Rust crate has formatting differences across untouched files. No broad formatting rewrite was applied. |
| Isolated production build | PASS from the earlier web-source verification; the latest changes are POS Desktop/Rust only. |
| POS Desktop production bundle | NOT RUN; its existing generated output was preserved. POS Desktop TypeScript check passed. |
| Authenticated browser workflow and database-backed RSS/query benchmark | NOT RUN; no disposable PostgreSQL service or realistic tenant dataset was available. |
| Latest isolated Next.js production build (`BISA_TEST_BUILD=1`, dummy unreachable DB URLs) | PASS; compiled inventory streaming route and generated the app route manifest. The existing `.next` output was left untouched. |

### Remaining high-volume paths

The source audit confirmed these remaining paths, but their production memory and latency are **UNVERIFIED**:

- Complete inventory export: **fixed in source** by MEM-11 below; realistic-volume memory and latency are still unverified.
- Ledger CSV is cursor-streamed by MEM-26; ledger XLSX and aging CSV/XLSX still materialize full report data. Database-backed RSS/latency at realistic volume remains unmeasured.
- Cash-flow movement rows and counter-account aggregates are now processed in cursor batches by MEM-27 (`src/server/reports/statements.ts`). Database memory, query plan, and realistic-volume latency remain unmeasured.
- The AR/AP page loads only the active tab's rows and obtains the inactive tab badge through SQL counts (MEM-13). The active tab still materializes all matching open documents before in-memory filtering/pagination; server-side list pagination remains open work. `listPayables` no longer materializes allocation history for closed documents (MEM-12).
- Supplier-return payable lookup now groups return allocations in one query rather than querying once per payable document (MEM-14); database query-plan and latency comparisons remain unverified.
- POS Desktop's full offline catalog remains in local SQLite, but the WebView loads only indexed search results and pages of 50 products; exact barcode/SKU lookup and unchanged-sync refresh avoidance are covered by MEM-17. Large real-device latency and WebView heap remain unverified.
- POS Desktop's live outbox summary is now paginated and its session badge uses a SQL count (MEM-25). The sync engine still reads the full queue internally by design; real-device WebView heap and queue-sync latency remain unverified.

The remaining report/AR-AP paths above need bounded queries, pagination/streaming, or a data-access redesign, followed by realistic-volume tests. POS Desktop UI transfer paths are bounded in source but still require runtime profiling on a real terminal. This report does not certify the ERP as production-ready.

### MEM-10 — Cash-flow report retains all counter-account aggregates

`getCashFlow` previously read counter-account aggregates in 10,000-entry query chunks but appended every result to `counterLines`, then duplicated them into `countersByEntry`. This defeated the chunking for large reporting periods. It now groups, attributes, and accumulates each chunk before querying the next, and no longer creates a second full `entryIds` array. Decimal allocation, per-entry grouping, and the existing SQL ordering remain unchanged.

At the time of MEM-10, the retained **counter-account aggregate** rows were bounded to one 10,000-entry chunk but the initial `cashLines` result was still materialized for the entire period. MEM-27 below later cursor-streams those cash movement rows too. Database-side cursor/sort resources and realistic-volume query latency remain unmeasured.

The PostgreSQL documentation describes fetching large result sets a few rows at a time as a way to avoid memory overruns; the current implementation uses bounded application-level query chunks rather than a PostgreSQL cursor. See [PostgreSQL 18 cursor documentation](https://www.postgresql.org/docs/current/plpgsql-cursors.html).

| Check | Result |
|---|---|
| `pnpm typecheck` after the change | PASS |
| `pnpm exec eslint` on changed source and tests | PASS |
| `tests/integration/fix-ars-tahap3-cashflow-sql.test.ts` | BLOCKED before test startup: the test guard requires explicit `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` targeting a dedicated `*_test` database. No database was contacted. |
| Memory/latency comparison | NOT RUN; the available `scripts/bench-cashflow.ts` creates and deletes a fixture company, so it was not run without an isolated database. |

### MEM-11 — Inventory export materialized the full catalog and file

`GET /api/export/inventory` previously called `getInventoryValuation` without pagination, loaded every product and optional package breakdown into arrays, then built a complete CSV string or XLSX buffer. It now reads valuation rows with an ordered `(name, productId)` keyset cursor, 500 rows at a time. SQL selects the limited product page first, then joins and aggregates stock only for those products; this avoids repeatedly grouping the entire remaining catalog for each page. It preserves in-transit quantity and skips whole-catalog totals/low-stock scans that the export never displayed. Package breakdown lookup is restricted to the current page.

CSV is emitted page by page through the existing CSV row serializer, retaining its UTF-8 BOM, formula neutralization, escaping, headers, filename, and no-store header. XLSX rows are committed through the existing ExcelJS streaming writer with backpressure; the writer now accepts an optional worksheet name so this export retains `Nilai Persediaan` while product exports still default to `Produk`. No dependency was added. This uses the ExcelJS [streaming XLSX writer](https://github.com/exceljs/exceljs#streaming-xlsx).

Each page uses a short tenant-scoped read-only transaction, matching product export. Inventory or catalog changes during an export may therefore be visible between pages; point-in-time export consistency remains an unresolved policy. The response size still grows with all exported rows, as required, but application row/buffer memory is bounded by a page plus the streaming writer rather than by the entire workbook.

| Check | Result |
|---|---|
| Typecheck after route/query changes | PASS |
| ESLint on changed source and tests | PASS |
| `tests/unit/product-xlsx-stream.test.ts` | PASS, 3 tests; validates streamed pages, string/formula safety, numeric cells, filter range, cancellation, and custom sheet name. |
| Inventory export integration regression | Added to `tests/integration/audit-a4-cost-exports.test.ts`; NOT RUN because the Vitest database guard requires explicit `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` for a dedicated `*_test` database. |
| 10,000-product RSS/latency/export comparison | NOT RUN; no isolated database and realistic-volume fixture were available. |

### MEM-12 — Payables read loaded supplier-return allocations for closed documents

`listPayables` previously grouped and materialized every supplier-return allocation for the company, then retained only allocations whose IDs matched the open receipt and opening-balance rows already loaded for the payable list. It now reuses the exact open-document predicates in server-side subqueries and returns only allocation groups that can affect those rows. This avoids building a potentially large ID array in application memory and avoids sending unrelated closed-document allocations to Node. The output remains mapped using the same Decimal calculations and filters. Drizzle documents `inArray(column, selectQuery)` as a supported subquery pattern: [Drizzle ORM filter operators](https://orm.drizzle.team/docs/operators).

The query planner may still scan a broad part of the allocation table; without the isolated database, `EXPLAIN (ANALYZE, BUFFERS)` and memory/latency comparison remain **NOT RUN**. The AR/AP list itself still materializes all open documents, so this is a bounded improvement rather than end-to-end pagination.

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm exec eslint src/server/reports/arap.ts` | PASS |
| `pnpm exec vitest run tests/unit` | PASS, 108 files / 1,054 tests |
| `git diff --check` | PASS |
| Supplier-return/AP integration coverage | NOT RUN; the test guard requires explicit `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` for a dedicated `*_test` database. No database was contacted. |
| Query plan and realistic-volume memory/latency comparison | NOT RUN; no disposable database or workload was available. |

### MEM-13 — Piutang & Utang page loaded both full tabs for every visit

`src/app/app/akuntansi/(akuntansi)/piutang-utang/page.tsx:90-109` now loads rows only for the tab selected in the URL. The other tab's badge uses `countOpenReceivables` or `countOpenPayables` in `src/server/reports/arap.ts:303-374`. The payable count applies the same posted-purchase/opening/expense status rules as `listPayables`, includes supplier-return allocation amounts in SQL, and counts only positive outstanding documents. The receivable count follows the source filters in `listReceivables`. Integration assertions now compare payable count with the list before and after a supplier return allocation (`tests/integration/supplier-returns.test.ts`) and receivable count with the list when a customer has both an open invoice and an overpayment credit (`tests/integration/fix-a21-r3b-party-credit.test.ts`).

This removes one complete tab's result rows from every request, while preserving the inactive tab's count badge. The selected tab still loads all open documents for in-memory summary, search, filtering, and pagination; that path remains unbounded until a stable server-side summary/list design is implemented.

| Check | Result |
|---|---|
| Typecheck and ESLint on changed source/test files | PASS |
| `pnpm exec vitest run tests/unit` | PASS, 108 files / 1,054 tests |
| Payable and receivable count parity integration regressions | NOT RUN; no dedicated `*_test` PostgreSQL database is configured. |
| Full-volume database query/memory comparison | NOT RUN; no disposable database or representative workload was available. |

### MEM-14 — Supplier-return payable lookup used one allocation query per document

`listOpenPayableDocs` previously awaited `sumReturnAllocations` sequentially for each receipt and opening balance. With many supplier documents, this caused a query count proportional to document count. It now uses the existing `sumReturnAllocationsForDocs` grouped aggregate for both ID sets, matching the batch multi-supplier path. The same Decimal aggregation and `assembleOpenPayableDocs` function still determine outstanding values and order. The expected lookup shape is two source-row queries plus one grouped allocation query when at least one payable document exists, instead of two source queries plus one allocation query per document.

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm exec eslint` on changed server and integration test files | PASS |
| `git diff --check` | PASS |
| Supplier-return payable integration coverage | NOT RUN; no dedicated `*_test` PostgreSQL database is configured. |
| Query-count, query-plan, and realistic-volume latency comparison | NOT RUN; database was not available. |

### Build and host-memory observations

The isolated Next.js production build completed successfully. Build-time process samples reached about 4.6 GiB RSS early and about 3.5 GiB later during compilation; these are transient build samples, not the running server's memory. They may matter on a small CI/build host and should be measured against the actual deployment builder's memory limit.

A final host snapshot had no running Next.js/ERP process, so it cannot be used as an application measurement. It showed 4.7 GiB host memory in use and about 10 GiB available; the largest listed process was the CodeGraph indexer at about 1.1 GiB RSS, with browser processes also present. Do not attribute that host total to the ERP.

### POS Desktop outbox optimization

The local POS terminal previously loaded and JSON-decoded every live outbox item to return the sale just written and to count pending items in device status. The updater also loaded and decoded the complete session history every five seconds while waiting for an open session to close. `record_sale` now performs a primary-key lookup; device status uses SQL `COUNT(*)` with an idempotent `(status, created_at)` index; the updater uses `SELECT EXISTS`. The SQLite query-plan assertion confirms the count uses the index. These changes reduce transient allocation, repeated JSON parsing, and work per updater poll; latency under a large real outbox/history remains **UNVERIFIED**.

### MEM-15 — Piutang & Utang allocated full copies before pagination

`src/app/app/akuntansi/(akuntansi)/piutang-utang/page.tsx` previously copied every active receivable/payable into normalized `allRows`, built another full array of filtered row references, then sliced 40 rows for rendering. It now scans the active tab once to compute the same summary and filtered count, retaining only the requested page (at most 40 normalized row objects). Credit lookup is restricted in SQL to the active party type and open status; the visible positive-balance credit list is built once for its summary, while the payment map groups credits only for parties on the displayed page. The inactive tab remains count-only as documented in MEM-13.

This removes a full collection of matching row references and avoids cloning every active document just to add `partyId`/`partyName`. It does **not** bound database result memory: `listReceivables` or `listPayables` still loads all active documents so the page can calculate an exact full-list total, aging totals, search, and page count. Server-side filtering/pagination plus SQL summary aggregation is still needed for predictable memory with very large ledgers. Credit detail rows also remain unpaginated in the disclosure section.

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| ESLint on the changed page, credit service, and related integration test | PASS |
| `git diff --check` | PASS |
| `tests/integration/fix-a21-r3b-party-credit.test.ts` | BLOCKED before test startup: Vitest requires explicit `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` for a dedicated `*_test` database. No database was contacted. |
| Full-volume query, memory, and latency comparison | NOT RUN; no dedicated database/workload was available. |

The latest host snapshot during this work had no ERP/Next process running, so it does not measure the user's reported application load. It showed 15 GiB total RAM, 3.7 GiB used and 11 GiB available; the largest process was CodeGraph at about 595 MiB RSS, followed by a browser renderer at about 346 MiB. These are host/tool processes, not ERP measurements.

### MEM-16 — Production build reached a high memory peak

A new `pnpm build` run on the current tree reached about **9.9 GiB RSS** in the Next.js `next-build` process after roughly 23 seconds. At that sample, the host showed about 1.3 GiB available memory and 3.3 GiB swap in use. The build reported `Compiled successfully in 24.7s` and moved to `Running TypeScript`; I interrupted it with SIGINT to prevent further host pressure. Therefore the current production build is **INTERRUPTED**, not PASS. Separate root `pnpm typecheck` and POS Desktop TypeScript checks later passed; they do not substitute for a completed production build.

The installed Next.js 16.4.5 memory guide notes source maps and parallel build work as memory contributors. The configured Turbopack memory eviction is documented as development-only; Turbopack GC can apply to builds when filesystem caching is enabled. The project already enables GC and filesystem caching defaults. The observed peak occurred during optimized compilation, so I did not add speculative concurrency or source-map settings without a phase-specific memory profile. See [Next.js memory guidance](https://nextjs.org/docs/app/guides/memory-usage), [Turbopack GC](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackGc), and [Turbopack memory eviction](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackMemoryEviction).

| Check | Result |
|---|---|
| Root `pnpm typecheck` on current tree | PASS |
| `pnpm build` | INTERRUPTED after optimized compilation completed, during TypeScript phase, due measured host memory pressure |
| Production runtime memory after this build | NOT RUN; build did not finish |

### MEM-17 — POS Desktop rendered every local product at once

`pos-desktop/app/page.tsx` kept the full offline snapshot in React state and rendered one card plus package controls for every product. It now shows 50 products per page and searches the local snapshot by name, SKU, product barcode, package name, or package barcode. `pos-desktop/lib/catalog-page.ts` counts matches while retaining only the requested 50 references; the UI no longer creates DOM nodes for the entire catalog. Barcode scanning still uses the full offline snapshot, so offline behavior and product availability remain intact.

This reduces WebView DOM/render work and avoids creating a full filtered list. The complete snapshot is still transferred into WebView memory by `list_snapshot_products`, and exact barcode scanning still scans the in-memory collection. A follow-up using indexed SQLite search and exact-code lookup would bound JavaScript memory and lookup work too; it needs a Rust query-plan and 20,000-product test before adoption.

| Check | Result |
|---|---|
| Root `pnpm typecheck` | PASS |
| `pnpm exec tsc --noEmit -p pos-desktop/tsconfig.json` | PASS |
| ESLint on changed POS Desktop and AR/AP files | PASS |
| `tests/unit/pos-desktop-catalog-page.test.ts` | PASS, 3 tests |
| `pnpm exec vitest run tests/unit` | PASS, 109 files / 1,057 tests |
| 20,000-product WebView memory/render comparison | NOT RUN; no Tauri runtime benchmark fixture was available |
| Integration database tests | BLOCKED before startup without a dedicated `*_test` database; no user database was contacted |

#### MEM-17 follow-up — SQLite paging and exact barcode lookup implemented

The earlier DOM-only improvement still transferred the whole catalog to React. The terminal now keeps the full offline snapshot in its existing local SQLite database and returns only the requested page (50 products) plus that page's packagings over Tauri IPC. Product-name ordering uses an additive SQLite index. Name, SKU, product barcode, package name and package barcode filters run against SQLite; the input is debounced by 180 ms. The former full-catalog Tauri command is no longer exposed to the WebView.

Barcode/SKU scanning now uses exact SQLite lookup instead of traversing a JavaScript array. Exact product SKU/barcode indexes and the existing package-barcode index are used. Active package barcodes retain precedence over product codes, and the selected product still carries its packaging choices into the cart.

The product count is cached in local `snapshot_meta` to avoid counting the entire table in both `snapshot_info` and an unfiltered page request. The cache is backfilled once when an older local POS database opens, then refreshed transactionally on full and delta snapshot application. This is an additive local-database change; it does not alter server or production ERP data.

Changed implementation: `src-tauri/src/posdb.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `pos-desktop/lib/pos-bridge.ts`, and `pos-desktop/app/page.tsx`. The earlier client-side paging helper and its tests were removed because the database now owns paging and search.

| Verification | Result |
|---|---|
| Tauri Rust unit tests | PASS, 69 tests; includes legacy-count backfill, package precedence, SQL index-plan assertions and a synthetic 10,000-product page/search/scan case |
| Synthetic 10,000-product scenario | PASS in 0.15 s for fixture insertion plus paging, search, exact lookup and plan checks; this is a local test result, not a production latency guarantee |
| Root `pnpm typecheck` | PASS |
| POS Desktop TypeScript check | PASS (`pnpm exec tsc --noEmit -p pos-desktop/tsconfig.json`) |
| ESLint on POS Desktop page and bridge | PASS |
| Root unit tests | PASS, 107 files / 1,052 tests |
| `git diff --check` | PASS |
| Full Next production build | NOT RUN again; the previous measured attempt reached about 9.9 GiB RSS and was interrupted during TypeScript phase |
| Tauri visual/runtime memory profile | NOT RUN; no ERP/Next/Tauri application process was running during this pass, and launching it could attach to the configured live database |

#### MEM-18 — substring catalog search remains scan-bound

The preserved search behavior matches text anywhere in a product/package name, SKU or barcode. Its `%term%` pattern begins with a wildcard, so SQLite cannot use the ordinary B-tree prefix optimization for that filtered search. Debouncing avoids a query per keystroke, while exact barcode/SKU scans and unfiltered pages use indexes/cache. If catalog search is still CPU-bound above the tested 10,000-product fixture, the next safe step is to benchmark FTS5/trigram support in the bundled SQLite build or explicitly approve prefix-only search semantics. Do not claim large-scale substring search is indexed.

This limitation is consistent with the [SQLite query planner documentation](https://www.sqlite.org/queryplanner.html), which describes indexes for ordering and lookup, and the [SQLite LIKE optimization rules](https://www.sqlite.org/optoverview.html#the_like_optimization), which require a pattern without a leading wildcard for range-index optimization.

`cargo fmt --check` remains non-clean because the existing Tauri tree has formatting differences in unrelated and previously modified Rust sections. The touched query implementation itself has no rustfmt diff; no workspace-wide formatting was applied to avoid reformatting unrelated work.

### MEM-19 — report CSV serialization copied every row and the complete output

The accounting report, ledger, and aging CSV routes previously passed a fully materialized `ReportTable` through `reportTableToCsv`. That path built another array of converted cells/rows and then retained a complete serialized CSV string before `csvResponse` wrapped it in a BOM-prefixed response. The three routes now send `reportTableToCsvStream` through the existing `csvStreamResponse`. It serializes at most 128 rows per pull, emits the BOM and CRLF separators, and reuses `csvRow` so escaping and spreadsheet-formula neutralization remain unchanged. XLSX routes and the legacy string serializer remain available.

**Synthetic measurement:** with a prebuilt 50,000-row, six-column report table (3,738,934 output bytes), five timed runs after warm-up had median serialization times of 114.6 ms for the old full-string path and 109.2 ms for the streamed path. After forcing GC while retaining the old output string, incremental retained heap was 7.13 MiB; after consuming the stream row batches and forcing GC, incremental retained heap was 0.00 MiB at the displayed precision. Output byte counts matched. This is a local Node 22 microbenchmark of the serializer only, not a peak-RSS, database, HTTP, production, or p95 benchmark.

At the time of MEM-19, the source still built the full report table before streaming: `buildLedgerExportTable` received an unpaginated ledger result and `buildAgingExportTable` loaded all active receivables/payables. MEM-26 below later bounds ledger CSV row memory with a PostgreSQL cursor. Ledger XLSX and aging exports still materialize report data, and XLSX output still constructs a complete workbook buffer. The MEM-19 serializer improvement alone did not bound end-to-end report memory.

The installed Next.js 16.4.5 Route Handler documentation uses the Web `Response` API, and its streaming guide explicitly supports `ReadableStream` response bodies for large-file generation ([Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Streaming guide](https://nextjs.org/docs/app/guides/streaming)).

| Verification | Result |
|---|---|
| `tests/unit/report-export-stream.test.ts` | PASS, 2 tests; byte equality covers BOM, formula neutralization, escaping, optional rows, `csvWidth`, batched chunks, and no trailing newline. |
| `pnpm exec vitest run tests/unit` after final batching change | PASS, 108 files / 1,054 tests. |
| `pnpm typecheck` | PASS. |
| ESLint on the five changed implementation files and new test | PASS, no warnings. |
| `git diff --check` | PASS. |
| Authenticated export route / database integration | NOT RUN; the configured local database is the active `bisa_erp` database and no dedicated `*_test` database URLs are configured. |
| Full Next.js production build | NOT RUN; the earlier run on this tree reached about 9.9 GiB RSS and was interrupted during TypeScript checking. |

The local dev server remains available at `http://127.0.0.1:3000`. After compilation, the Next.js server process sampled at about 263 MiB RSS and 0.4% CPU; no business route was requested, so this is an idle development-process sample, not an application workload or production measurement. The broader JavaScript process tree has additional RSS, and RSS can count shared pages more than once.

### MEM-20 — report routes loaded SheetJS even for CSV exports

`src/server/reports/export-table.ts` previously imported `xlsx` at module evaluation. The CSV report routes import the reports barrel, so they could load the SheetJS package even when the request only needed CSV. The import now occurs inside async `reportTableToXlsx`; `xlsxResponse` is async and loads it only when the XLSX branch is selected. The three route handlers are already async. The direct A-28 XLSX integration test now awaits the serializer, and a unit regression test parses the generated workbook and checks its content type, company name, and numeric cell.

In a local Node 22 import probe with forced GC, importing the report serializer retained 0.52 MiB; dynamically importing `xlsx` afterward retained an additional 2.91 MiB. This is one isolated module-heap sample, not an application RSS comparison. It demonstrates the avoided import cost until the XLSX code path is called, not an end-to-end server memory reduction measurement. Other modules such as `src/lib/xlsx.ts` still statically load SheetJS for their own export routes.

| Verification | Result |
|---|---|
| `tests/unit/report-export-stream.test.ts` after lazy-load change | PASS, 3 tests; includes workbook parsing after async load. |
| `pnpm exec vitest run tests/unit` after combined CSV-stream and XLSX lazy-load changes | PASS, 108 files / 1,055 tests. |
| `pnpm typecheck` | PASS. |
| ESLint on changed serializer, report routes, and affected tests | PASS. |
| `git diff --check` | PASS. |
| `tests/sim2/a28-hardening-e2e.test.ts` database workflow | NOT RUN; no dedicated `*_test` database was configured. Its changed direct serializer call is covered by full-repository typecheck; workbook behavior is covered by the new unit test. |

### MEM-21 — shared master-data XLSX helper loaded SheetJS on CSV-capable routes

Fourteen API export routes use `src/lib/xlsx.ts` for XLSX output. The helper previously imported SheetJS at module evaluation, including when a route request selected CSV. `buildXlsx`, `xlsxResponse`, and `buildImportTemplate` are now async and load `xlsx` only when called; the import-template route also loads SheetJS inside `sampleMatrix` rather than at module evaluation. Its normal CSV response with no custom fields therefore avoids the XLSX import. The actual `/api/import/parse` route still loads SheetJS statically because it parses uploaded XLSX files.

A local Node 22 probe measured 0.66 MiB additional retained heap after importing the shared helper, before the XLSX path ran. Calling `buildXlsx` then added 3.11 MiB retained at displayed precision after forced GC; that includes package/module state and the probe workbook, so it is not an isolated library-size or application RSS measurement. Dynamic import defers this memory until an XLSX path is used; it does not unload the package after the first XLSX request.

| Verification | Result |
|---|---|
| `tests/unit/xlsx.test.ts` and `tests/unit/report-export-stream.test.ts` | PASS, 6 tests; validates both serializers, parsed workbook content, and import-template reference sheets. |
| `pnpm typecheck` after async API propagation | PASS across all 22 `xlsxResponse` callsites and import-template caller. |
| ESLint on shared XLSX helper, import-template route, and direct tests | PASS. |
| `git diff --check` | PASS. |
| `pnpm exec vitest run tests/unit` after MEM-21 | PASS, 108 files / 1,056 tests. |
| Production build and database-backed XLSX route tests | NOT RUN; the prior build peak reached about 9.9 GiB RSS, and no dedicated `*_test` database is configured. |

XLSX generation through the shared helper still materializes its rows and returns a complete buffer. Deferring the import reduces idle/CSV-path memory only; large master-data XLSX outputs still need endpoint-specific page/stream handling, while existing product and inventory exports already have separate streaming paths.

### MEM-22 — bound inactive Next.js development page entries

`next.config.ts` now sets `onDemandEntries.maxInactiveAge` to 25 seconds and `pagesBufferLength` to 2. This affects development only: it limits how many inactive compiled page entries Next.js retains, with the trade-off that revisiting an evicted page may require compilation. The installed Next.js 16.4.5 types and docs support these values; Next.js documents these settings for controlling page disposal in development ([onDemandEntries](https://nextjs.org/docs/app/api-reference/config/next-config-js/onDemandEntries)). Existing Turbopack filesystem caching, GC, full memory eviction, and disabled preload remain enabled. Full eviction is documented to run after cache snapshots and depends on filesystem caching ([Turbopack Memory Eviction](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackMemoryEviction)).

**Corrected local dev observation:** `/login` returned HTTP 200; the first direct request took 6.25 s wall time while Next logged 1.031 s for the completed route request/compile, and two later warm requests took 61 ms and 72 ms in the Next logs. The earlier 8.56 s / 0.11 s values above were inaccurate and are superseded. Four protected routes (`/app`, `/app/gudang`, `/app/akuntansi/buku-besar`, `/app/pos/sesi`) returned redirects without a session; they did not expose business data. The Next server process RSS was 1,373,080 kB after those route requests, fell to 622,272 kB after 30 seconds idle, and measured 682,728 kB after revisiting `/app/gudang` (HTTP 307, 0.13 s). The observed RSS drop was 750,808 kB (about 733 MiB, 55%) during the idle interval. This is a single development-session observation, not a controlled before/after comparison and not proof that `onDemandEntries` alone caused the drop; Turbopack eviction and runtime garbage collection are also active.

The process `VmHWM` remained 9,391,020 kB (about 8.96 GiB) and `VmSwap` about 22 MiB. This historical peak is still unacceptably high, its allocation phase is not identified, and this change did not lower that recorded high-water mark. A heap/turbopack trace is still needed to find the transient allocation source. Do not present the current RSS drop as a production-memory result: the pages were unauthenticated redirects, no authenticated ERP workflow or database-backed report was exercised, and dev mode differs from production.

A later point sample of the same process showed 746,276 kB RSS (about 729 MiB), 20 MiB process swap, and 0.0% CPU across the one-second `top` sample; host available memory was about 11 GiB. RSS therefore varied upward after the earlier idle/revisit sample, while CPU was idle at that moment. This is not a sustained CPU profile or stable RSS baseline.

The final two one-second `top` samples showed 734,824 kB RSS (about 718 MiB) and 0.0% CPU in both intervals; host available memory was about 11 GiB. The high-water mark remained 9,391,020 kB. These short idle snapshots do not explain the earlier peak or represent active authenticated work.

| Verification | Result |
|---|---|
| `pnpm typecheck` after config change | PASS. |
| Next dev config reload and HTTP GET `/login` | PASS, HTTP 200; corrected first wall request 6.25 s (Next route log 1.031 s), then warm route logs 61–72 ms. |
| Four protected-route requests without a session | PASS as safe redirects (HTTP 307); no authenticated workflow or database-backed page behavior verified. |
| Development process memory sample | RSS 1.31 GiB after route compilation; 607.7 MiB after 30 s idle; 666.7 MiB after warm revisit; later 729 MiB. Single process/session; not a controlled comparison or stable baseline. |
| Historical high-water RSS | 8.96 GiB; root cause and phase NOT VERIFIED. |
| Production build and production runtime profile | NOT RUN; previous production-build attempt reached about 9.9 GiB RSS and was interrupted. |
| ERP authenticated pages and realistic database workload | NOT RUN; no dedicated test database/session was available. |

### MEM-23 — reduce the cold development memory peak without dropping Tailwind styles

**Finding:** a fresh, non-tracing Turbopack dev process again reached `VmHWM` 10,314,824 KiB (~9.84 GiB) while compiling `/login`; after compilation and warm requests the same process RSS fell to 360,848 KiB. Another run reached 10,332,252 KiB. This corroborates a transient compiler peak rather than sustained idle consumption. A tracing-enabled diagnostic reached a still higher peak, so trace-mode memory is not used as a normal-run baseline.

The trace's file-read search showed Turbopack reading large ignored Rust artifacts below `src-tauri/target` (including an ~772 MiB `.a`, ~256 MiB executable artifacts, and large `.so`/`.rlib` files); that directory is 8.1 GiB and ignored by Git (`.gitignore:59`). This is direct evidence of artifact reads, but their exact share of the memory allocation is not isolated. Moving the directory to an external cache and leaving a symlink at the original path did not reduce the measured HWM; that experiment was fully reversed and the original target directory restored. A narrower `turbopack.root` under `src` was rejected by Next with `distDirRoot must stay inside the project root`; that config experiment was also reverted.

**Mitigation now active for `pnpm dev`:** use the supported Webpack dev mode to avoid the large Turbopack cold peak, keep `dev:turbopack` as an opt-in, and add Tailwind v4's official PostCSS plugin so Webpack emits the application's utility CSS. `postcss.config.mjs` configures `@tailwindcss/postcss`; the dependency is pinned through the lockfile at the same 4.3.3 version as the existing Turbopack adapter. Only the default `dev` bundler changed; the `build` script remains `next build` (Turbopack by default), and a production build with the new PostCSS config is still unverified.

**Verification:** `pnpm dev --hostname 127.0.0.1 --port 3000` reported Next.js 16.4.5 (webpack). `/login` returned 200 with two CSS assets (396,596 bytes total) containing `.flex`, `.grid`, and Tailwind variables. `/app`, `/app/gudang`, `/app/akuntansi/buku-besar`, and `/app/pos/sesi` returned 307 without a session, so no transaction data was read or changed. After these five requests, `VmHWM` was 2,921,836 KiB (~2.79 GiB), RSS 2,920,976 KiB, and process swap 0; after 20 seconds idle RSS was 2,727,848 KiB and a two-second CPU sample was 0.0%. Later, while `pnpm typecheck` ran concurrently, process RSS reached 3,266,968 KiB; that concurrent sample is recorded but is not the normal route-only baseline. This is an observed improvement in peak memory, with a trade-off: first-time Webpack route compilation is slower than the warm path, and the retained Webpack RSS is higher than Turbopack's post-eviction idle RSS. The comparison is not a controlled benchmark with cleared caches.

After the typecheck, the server was restarted and left running through the default `pnpm dev` script. With the local Webpack cache already populated, one `/login` request again returned 200 with both CSS utility checks passing; process high-water mark was 1,248,292 KiB, RSS was 1,234,972 KiB, process swap was 0, and CPU sampled at 0.0%. This warm-cache restart is the current running state, not a cold-start benchmark.

| Verification | Result |
|---|---|
| Webpack dev server through the default `pnpm dev` script | PASS; Next 16.4.5 selected Webpack and listened on `127.0.0.1:3000`. |
| Tailwind CSS assets in `/login` | PASS; both assets returned 200 and include expected utility selectors. |
| Four unauthenticated ERP page requests | PASS as HTTP 307 redirects; authenticated workflows NOT RUN. |
| `pnpm typecheck` | PASS. |
| ESLint on `next.config.ts` and `postcss.config.mjs` | PASS. |
| `git diff --check` | PASS. |
| Production build with the new PostCSS config, production runtime profile, authenticated workflows | NOT RUN; this turn did not run a build or use a database. |

### MEM-24 — Webpack memory-optimization flag tested and removed

Next.js 16.4.5 exposes `experimental.webpackMemoryOptimizations`; its official memory guide says it can reduce Webpack's maximum memory use, with a small possible compile-time cost ([Next.js memory usage](https://nextjs.org/docs/app/guides/memory-usage)). I tested the flag in the existing Webpack dev server, requesting `/login` and the same four protected ERP routes used for MEM-23. The first post-route sample showed a lower HWM (`2,932,892` KiB versus `3,091,868` KiB before the experiment), but a later sample after all route compiles and a warm login reached `3,193,664` KiB. The samples were not fully controlled and did not show repeatable savings. I removed the flag rather than retaining an experimental setting without a measured benefit. The production `build` script uses Turbopack, so this Webpack-only flag would not address its previously observed build peak either.

After removing the flag, Next restarted with the default `pnpm dev` script, selected Webpack, and `/login` returned 200. That restart sample was `1,318,820` KiB RSS and `1,393,720` KiB HWM after a cold login compile; it is not comparable with the four-route peak. The default Webpack dev mitigation from MEM-23 remains active.

### MEM-25 — bound POS Desktop outbox data sent to the WebView

`refreshLocal` previously loaded and JSON-decoded every pending, inflight, and held outbox payload, sent the full queue over Tauri IPC, and retained it in React state. The screen only displayed client key, status, payment total, and last message. It also loaded every local cash session just to show a count. The sync engine still needs the full outbox, so that internal Rust path is unchanged.

The UI now requests an indexed page of 50 outbox summaries, with a hard page-size maximum of 100 and next/previous navigation. The page contains the same live statuses, preserves oldest-first order, reports the total from SQL, and reads the displayed amount from the related local sale row. It does not select or deserialize the payload JSON. A partial `(created_at, client_key)` index covers only live outbox statuses; the query explicitly uses it to avoid a temporary full-order sort. A missing legacy sale row remains visible with an em dash for its amount because the summary uses a left join. The UI now uses `COUNT(*)` for its local cash-session count instead of transferring session history.

The in-memory SQLite regression seeds 10,000 outbox records (7,500 live), checks page boundaries and stable order, verifies page size is capped at 100, verifies the query plan uses the partial index without a temporary B-tree, and asserts that the serialized 50-row summary is under 5% of the complete live payload response. This checks bounded IPC output on a synthetic fixture; it is not a measurement of Tauri WebView RSS or production terminal latency.

| Verification | Result |
|---|---|
| `cargo test --lib` | PASS, 71 tests; includes 10,000-row outbox paging and session-count regressions. Existing unrelated unused/mutability warnings remain. |
| Root `pnpm typecheck` | PASS. |
| POS Desktop `tsc --noEmit -p pos-desktop/tsconfig.json` | PASS. |
| ESLint on `pos-desktop/app/page.tsx` and `pos-desktop/lib/pos-bridge.ts` | PASS. |
| `git diff --check` | PASS. |
| Tauri desktop runtime with a large real local queue / WebView heap comparison | NOT RUN; tests use an in-memory SQLite database and no user POS database was opened. |

### MEM-26 — stream ledger CSV rows through a point-in-time database cursor

`GET /api/export/ledger` previously built a complete ledger `ReportTable` for CSV, retaining all fetched journal lines, mapped report rows, and CSV serialization state in Node. The CSV branch now selects the same account, summary, ordering, and posted journal-line filters, then declares a tenant-scoped PostgreSQL cursor and fetches at most 500 rows per request. It serializes at most 128 output rows per chunk through the existing `csvRow` and `moneyCsv` helpers. XLSX continues to use the existing report builder. The route still checks `accounting.view` before creating the stream.

The cursor runs inside a read-only, repeatable-read tenant transaction so opening/closing balances and cursor rows share one database snapshot. Backpressure limits output to a demanded chunk; cancellation returns the async generator, closes the cursor, and ends the transaction. The generator independently verifies its rolling balance against the summarized closing balance and fails the export if they disagree. This bounds application row retention to one fetched page and a small output chunk; the database's sort/cursor resources and slow-client transaction duration are not measured. A stalled download can keep a read snapshot open longer, so this path still needs production workload profiling and an operational timeout policy.

The implementation follows PostgreSQL's documented cursor/FETCH pattern for consuming query results in smaller batches ([DECLARE](https://www.postgresql.org/docs/current/sql-declare.html), [FETCH](https://www.postgresql.org/docs/current/sql-fetch.html)). Repeatable-read transaction semantics are documented at [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

| Verification | Result |
|---|---|
| `tests/integration/ledger-export-stream.test.ts` on disposable PostgreSQL 18.6 | PASS, 1 test; 1,001 synthetic posted entries exercise 500-row cursor fetches, exact byte equality with the previous CSV builder, row count, and closing balance. Fixture transaction rolled back. |
| `tests/unit/ledger-export-stream.test.ts` | PASS, 2 tests; verifies streamed chunks and cancellation finalization. |
| Root `pnpm typecheck` | PASS. |
| ESLint on ledger stream implementation, route, tenant helper, and tests | PASS. |
| `git diff --check` | PASS. |
| Authenticated HTTP download, slow-client behavior, 10,000+ row RSS/p95 profile, and ledger XLSX memory | NOT RUN. |

Changed implementation: `src/server/reports/ledger.ts`, `src/server/reports/ledger-csv-generator.ts`, `src/server/reports/ledger-export-stream.ts`, `src/db/tenant.ts`, and `src/app/api/export/ledger/route.ts`. Regression coverage is in `tests/integration/ledger-export-stream.test.ts` and `tests/unit/ledger-export-stream.test.ts`.

### Runtime smoke check — 15 November 2026

The development server was restarted with `pnpm dev --hostname 127.0.0.1 --port 3000`; Next.js 16.4.5 selected Webpack and remained available. `/login` returned HTTP 200 in 5.65 seconds on the first request and 0.21 seconds on a warm request. After compilation, the `next-server` process was at 2,077,132 KiB RSS with 0 KiB swap; its recorded high-water mark was 2,717,504 KiB. A one-second CPU sample was 0.0%; this is an idle sample, not sustained workload evidence. Host available memory was about 8.8 GiB at the preceding sample.

The local `.env.local` database endpoint `127.0.0.1:5433` refused a session query while a browser requested `/app`, so protected/authenticated workflow verification is blocked by the unavailable local database. The login HTTP 200 is only a route smoke check. This sample also shows that the dev process still retains substantial memory after a small route compilation; it does not establish a production runtime baseline or attribute all memory to ERP application code.

**Later runtime recheck, same dev process:** after roughly 12 minutes and repeated browser `/app` requests, `next-server` RSS measured 3,302,984 KiB, `VmHWM` 3,382,496 KiB, and swap 0 KiB. A one-second CPU sample was 0.0%, and host available memory was about 8.3 GiB. The repeated protected-page requests logged Better Auth session-query failures to the unavailable `127.0.0.1:5433` endpoint. RSS increased from the earlier sample, but the exact retained allocation source is not isolated; no Node heap profile was taken, and this is a development process rather than a production workload. This supersedes the smaller RSS sample above as the latest runtime observation.

### MEM-27 — bound cash-flow movement rows with a PostgreSQL cursor

`getCashFlow` already aggregated counter accounts and processed them in 10,000-entry batches, but it first loaded every cash movement for the selected period into `cashLines`. The query now runs through a transaction-scoped PostgreSQL cursor and fetches up to 10,000 cash movement rows at a time. For each batch, the existing grouped counter-account query and Decimal attribution logic run unchanged, then the batch is released before the next fetch. Final report rows remain aggregated by source type and cash-flow group, so output size is bounded by those group combinations rather than journal count.

The cursor uses a generated, identifier-escaped name and is closed after normal completion. On a database query error, the surrounding transaction rollback closes it while the original error is preserved. The cursor query keeps company, posted-status, date, and cash-account predicates; the counter query retains its company and entry-id constraints. This reduces Node's retained cash movement rows from O(all entries in the period) to one batch. Counter-account rows can still scale with the number of distinct counter accounts in a batch, and database cursor/sort memory, CPU, and latency have not been benchmarked under production volume.

| Verification | Result |
|---|---|
| `tests/integration/fix-ars-tahap3-cashflow-sql.test.ts` on disposable PostgreSQL 18.6 | PASS, 9 tests; includes comparison against the independent pre-optimization reference and 10,001 synthetic posted entries crossing the 10,000-row cursor boundary. Synthetic transaction rolled back. |
| Root `pnpm typecheck` | PASS. |
| ESLint on `src/server/reports/statements.ts` and the regression test | PASS. |
| `git diff --check` | PASS. |
| 40,000-entry production query-plan / CPU / RSS comparison | NOT RUN; the existing benchmark script deletes and regenerates a fixture company, so it was not run against the configured local database. |

### MEM-28 — use Turbopack for the default development server

The default `pnpm dev` had been pinned to Webpack after earlier, uncontrolled memory observations. A same-source A/B run on Next.js 16.4.5 now compares clean development output directories, the same five routes (`/login`, `/app`, `/app/gudang`, `/app/akuntansi/buku-besar`, `/app/pos/sesi`), and a disposable PostgreSQL URL. No authenticated session was used and no database writes were made. Both runs returned 200 for login and 307 for protected routes.

After requests and an idle interval, the measured process-tree RSS was 927 MiB for Turbopack (8-second idle sample) and 3,044 MiB for Webpack (10-second idle sample); both CPU samples were 0.0%. The Turbopack run had one additional warm `/login` request before the five-route sequence, so cold first-request latency is not compared. This is a development-server memory comparison, not a production benchmark or a profile after all 101 ERP routes have been visited. The result nevertheless shows materially lower retained memory for the same route set, so `pnpm dev` now uses Turbopack; `pnpm dev:webpack` remains available as a fallback. The change follows Next.js guidance that Turbopack is the default development bundler and that development compiles routes on demand ([local development](https://nextjs.org/docs/app/guides/local-development), [memory usage](https://nextjs.org/docs/app/guides/memory-usage)).

The updated root `pnpm dev` was then run against a fresh `.next` directory. Next.js selected Turbopack; `/login` returned 200 and its stylesheet returned 200 with the expected `.flex` and `.grid` utility selectors. The live process tree measured 1,058 MiB RSS and 0.0% CPU over a 10-second idle sample. The previous Webpack `.next` cache was preserved in a sibling temporary backup directory, outside the repository.

On the original environment, an already-open browser requested `/app` with its existing session cookie and received HTTP 500 because Better Auth could not connect to the configured local database at `127.0.0.1:5433`. This is an observed database-availability failure; authenticated ERP workflows remain unverified and no database was modified.

| Verification | Result |
|---|---|
| Same-source Turbopack route smoke on temporary clone | PASS; login 200, four protected routes 307. |
| Same-source Webpack route smoke on the same temporary clone | PASS; login 200, four protected routes 307. |
| A/B idle process-tree sample | PASS; Turbopack 927 MiB / 0.0% CPU; Webpack 3,044 MiB / 0.0% CPU. RSS is summed across each dev process tree. |
| Updated root `pnpm dev` | PASS; Next.js 16.4.5 selected Turbopack and listened on `127.0.0.1:3000`. |
| Login CSS smoke | PASS; `/login` 200, stylesheet 200, `.flex` and `.grid` present. |
| Root typecheck/build and production runtime comparison | NOT RUN; this change affects only the development script, and the production build previously exceeded available memory. |
| Authenticated route verification on the configured local database | BLOCKED; `.env.local` points to `127.0.0.1:5433`, which refuses the session query. No database was started or changed. |

### MEM-29 — 22-route POS, Warehouse, and Accounting development soak

The live Turbopack development process was requested across 22 static routes spanning POS, Warehouse, and Accounting. Every request returned the expected unauthenticated 307 redirect; this exercises route compilation and authorization redirects, not authenticated business workflows. No mutation request was sent. Process-tree RSS was about 1,058 MiB before the route pass, reached 1,769 MiB in the first post-pass sample, then fell to 1,195 MiB after another idle interval. A stable 10-second sample after worker activity settled measured 0.0% CPU. This indicates the route-compilation peak was mostly released and the retained process-tree RSS increased by about 137 MiB from the pre-pass sample; it does not measure browser memory or database-backed rendering.

| Verification | Result |
|---|---|
| POS, Warehouse, Accounting route smoke | PASS; 22 unauthenticated requests returned HTTP 307. |
| Post-route idle memory | PASS; 1,195 MiB process-tree RSS after eviction/GC settled; approximately 1,058 MiB before route pass. |
| Stable post-route CPU sample | PASS; 0.0% over 10 seconds after compilation activity settled. |
| Authenticated workflows and database-backed page memory | BLOCKED; configured local DB at `127.0.0.1:5433` refuses connections. |

### MEM-30 — Recheck after starting the existing local database

Follow-up on 15 November 2026: confirmed that the existing `bisa-erp-db` PostgreSQL 18 container was stopped. It uses the pre-existing `bisa-erp-pgdata` volume and already maps host port 5433; that container was started without creating a new database, running migrations, seeding, resetting, or issuing application writes. The configured application URL then passed a read-only SQL probe: database `bisa_erp`, role `app_user`, PostgreSQL 18.6, and 107 visible public tables.

With the database up, `/login` returned HTTP 200, `/app` returned HTTP 307 to the login flow when requested without a browser session, and `GET /api/auth/get-session` returned HTTP 200 with a null session. The session endpoint's first request took 3.28 seconds, so this includes cold route compilation and is not a warmed latency measure. The development process tree contained seven processes and measured 1,548,028 KiB RSS, changing by 68 KiB over a 10-second idle sample; CPU was 0.6% over that interval. These figures sum process RSS and may double-count shared pages. The PostgreSQL container used 39–46 MiB during idle samples. Host memory reported 10 GiB available. This confirms the application database was reachable and the prior connection refusal no longer reproduces, but it does not verify authenticated ERP workflows or production memory.

This resolves the database-availability blocker recorded above. Authenticated screens and business workflows remain **UNVERIFIED** because no authenticated browser session was available; the unauthenticated redirects are not evidence that their database-backed pages work. Keep the earlier 927 MiB vs 3,044 MiB same-source A/B as the controlled bundler comparison; the current 1.48 GiB process-tree sample is from the live root dev environment after multi-route compilation, with a different process tree and workload, so it is not a directly comparable A/B result.

| Verification | Result |
|---|---|
| Existing local DB service start | PASS; existing container/volume only, no migration/reset/seed. |
| Configured DB connection | PASS; read-only query to `bisa_erp` on PostgreSQL 18.6. |
| Web smoke after DB start | PASS; login 200, `/app` unauthenticated redirect 307, session endpoint 200/null. |
| Idle dev resource sample after DB start | PASS; 1,548,028 KiB summed process RSS, +68 KiB, 0.6% CPU over 10 seconds; DB 39–46 MiB. |
| Authenticated application workflows / production runtime | UNVERIFIED; no authenticated browser session or fresh isolated production build in this check. |

### MEM-31 — Current-worktree regression verification

On 15 November, the first full unit run found one architecture-boundary failure: the ledger CSV route imported its cursor-stream implementation directly from inside the reports domain. The route needs that specialized streaming entry point; adding it to the shared reports barrel would broaden the public module surface used by many pages. The boundary test now records this single route-to-implementation exception with a reason, while continuing to reject undocumented cross-domain imports.

The current worktree then passed all 1,058 unit tests across 109 files, `pnpm typecheck`, and ESLint for the changed boundary test. A subsequent 30-second idle sample of the live Next development process tree was stable at 1,616,816 KiB RSS (+32 KiB) and 0.2% CPU. Host memory availability was 10 GiB; PostgreSQL used about 40 MiB. RSS is summed across seven processes, may double-count shared pages, and is not a production or authenticated-workflow measurement.

| Verification | Result |
|---|---|
| Initial full unit run | FAIL; 1 architecture-boundary test failed, 1,057 tests passed. |
| Targeted architecture-boundary test after correction | PASS; 3/3. |
| Full unit suite after correction | PASS; 109 files, 1,058 tests. |
| `pnpm typecheck` | PASS; exit 0. |
| ESLint for `tests/unit/architecture-module-boundaries.test.ts` | PASS. |
| 30-second post-verification idle resource sample | PASS; 1,616,816 KiB summed process RSS (+32 KiB), 0.2% CPU; PostgreSQL ~40 MiB; host available memory 10 GiB. |

### MEM-32 — resolve the database outage and page AR/AP from PostgreSQL

The earlier session-query errors did coincide with the local database being stopped. After the existing `bisa-erp-db` service was started, a read-only probe returned database `bisa_erp`, role `app_user`, PostgreSQL 18.6; `/api/auth/get-session` returned HTTP 200 in 60 ms (null session). This confirms connectivity, not an authenticated business workflow. The database outage explains the previous connection failures. It does not explain all observed application memory: after recovery, the current `next-server` still measured 1,645,940 KiB RSS, with a 9,871,924 KiB historical high-water mark, while the local database container used about 39 MiB. A 3-second CPU sample was 0.7%; host available memory was about 9.9 GiB. The HWM may include earlier build/route-compilation activity and cannot be attributed to a particular ERP page without a heap profile.

The accounting receivables/payables page previously fetched every open document through `listReceivables` or `listPayables`, then searched, filtered, summarized, and paginated in application memory. It now calls `listReceivablesPage` / `listPayablesPage` from the `arap-page` report module. PostgreSQL applies search, due-date filters, ordering, pagination, and unfiltered summary totals; the page receives at most 40 document rows. The accounting dashboard now uses the same read model for its five-row previews and queue summaries, so these two high-traffic screens no longer materialize every open document in Node. Legacy full-list functions remain for other callers, including print/history flows, so those consumers are not yet bounded by this change. The query and queue-summary implementation is in `src/server/reports/arap-page.ts`; the worklist and dashboard integrations are in `src/app/app/akuntansi/(akuntansi)/piutang-utang/page.tsx` and `src/app/app/akuntansi/(akuntansi)/page.tsx`.

On the dedicated synthetic Scale A database (4,150 open receivables and 2,150 open payables), the old and new functions were executed sequentially, warmed once, then measured five times inside the same read-only transaction. The new result was limited to 40 rows while retaining the same count and summary semantics.

| Workload | Legacy p50 / p95 | Paged p50 / p95 | Result |
|---|---:|---:|---|
| Receivables list | 32.6 / 43.1 ms | 19.4 / 19.9 ms | p50 40% lower |
| Payables list | 25.8 / 29.8 ms | 11.0 / 11.3 ms | p50 57% lower |
| Accounting dashboard previews + queues | 73.7 / 81.9 ms | 29.5 / 30.5 ms | p50 60% lower; five preview rows per side |

An independent comparison materialized the legacy rows and all new pages, then matched source, ID, number, dates, totals, payment status, party, reference, outstanding amount, and journal linkage. Both modules matched all rows; open counts and independently computed totals/overdue/soon/partial summaries matched. Search and all three due-date filters also matched the legacy semantics for both modules, including the first 40 returned rows. This is a read-only functional/performance check against synthetic data. The benchmark used a test-database superuser, so it bypassed RLS; the normal app role on `bisa_erp` returned zero open documents for the selected organization, which verified query execution but did not provide a non-empty RLS parity check.

The first full unit run after adding the page query found the reports file exceeded the repository's 800-line architecture limit. The paging implementation was extracted into `arap-page.ts`; the existing report API is re-exported through the reports barrel. This reduced `arap.ts` to 383 lines.

| Verification | Result |
|---|---|
| Synthetic Scale A row and summary parity | PASS; 4,150 receivables and 2,150 payables matched across every row. |
| Synthetic Scale A search/due filters | PASS; all eight module/filter cases matched total count and first page. |
| `tests/integration/fix-a22-k5-dashboard-queues.test.ts` | PASS, 9/9 on disposable PostgreSQL 18.6. |
| Repeated page timing | PASS; 5 measured runs after one warm-up, sequential A/B as shown above. |
| `pnpm typecheck` after module split | PASS. |
| Targeted ESLint and `git diff --check` | PASS. |
| `pnpm exec vitest run tests/unit` | PASS after file split; 109 files, 1,058 tests. The initial run had 1 failure because of the 800-line file-size guard. |
| Authenticated browser workflow, Scale B (40,500+ documents), production build/runtime and heap profile | UNVERIFIED. |

The local database is reachable now, so the prior connection-refusal blocker is resolved. It remains important to distinguish that outage from the separate retained memory of the long-running Next.js development process; this audit has not established a production RSS baseline or a causal heap allocation for the historical high-water mark.

### MEM-33 — bound inventory valuation page work to the visible product page

After the database was confirmed online, a repeatable Scale A run measured the existing inventory valuation page at p50 1,488.8 ms / p95 1,527.3 ms over five measured calls after two warm-ups. It scanned/aggregated the grouped catalog for the page query and then fetched the full low-stock detail list, although the page only rendered that list's count. The paged query now selects the ordered product IDs and metadata first, then aggregates stock only for that page. Its summary query calculates low-stock count alongside the existing totals; the UI no longer materializes every low-stock row. Full-list callers retain their existing detailed `lowStock` array behavior, and the warehouse filter remains part of the product selection.

On the same synthetic test database and workload, the updated page path measured p50 668.3 ms / p95 688.9 ms (five measured calls after two warm-ups), about 55% lower at p50. A full-list comparison matched page rows, product count, quantity, inventory value, potential value, and low-stock count for both all warehouses and the default warehouse across 10,000 products. Because the generated Scale A fixture had zero low-stock products, a separate transaction-only probe raised one product's minimum stock, confirmed the count matched the full detail list, then rolled back and verified the original value was restored. The test database role is a superuser and bypasses RLS; this validates query/result behavior on synthetic data, not normal-role RLS behavior.

| Verification | Result |
|---|---|
| Synthetic Scale A page parity | PASS; 10,000 products, all-warehouse and selected-warehouse first pages and aggregates matched their full-list equivalents. |
| Nonzero low-stock count probe | PASS; count matched full detail rows; test-only update was rolled back and the original data rechecked. |
| Page valuation timing | PASS; old p50/p95 1,488.8/1,527.3 ms; new 668.3/688.9 ms. |
| `tests/integration/audit-a4-cost-exports.test.ts` | PASS, 7/7 on disposable PostgreSQL 18.6; covers the inventory export and value page paths. |
| `tests/integration/inventory-p2.test.ts` | BLOCKED by missing baseline fixture in this disposable database: 11 cases stopped before the target query because company `01900000-0000-7000-8000-000000000001` has no default warehouse/supplier. The direct synthetic checks above exercised the changed query. |
| Root unit suite | PASS, 109 files / 1,058 tests. |
| Root typecheck, targeted ESLint and `git diff --check` | PASS. |
| Production build, Scale B, normal app-role non-empty RLS parity, authenticated browser and production heap profile | NOT RUN / UNVERIFIED; the current production-build attempt previously reached high memory and was interrupted. |

The same SQL subquery alias issue was also corrected in the already-paged inventory export query after the live PostgreSQL probe exposed ambiguous `name` columns. The A4 inventory export integration suite then passed, including the XLSX and permissions cases. The application database was only probed read-only; all test-side changes were against the disposable `bisa_perf_test` database, and the one temporary costing threshold update was rolled back.

After those checks, both local database containers reported `running`, and the unauthenticated session endpoint returned HTTP 200 in 67 ms. A five-second idle sample of the existing Next.js development process showed about 2.2 GiB RSS and 0.0% CPU in both samples; host available memory was about 9.9 GiB and swap use about 1.9 GiB. The sample is after route compilation and tests, is not production memory, and does not prove the cause of the RSS or swap use. The host's `pg_isready` command is not installed; container state and the HTTP session probe were used instead.

### MEM-34 — repeat live checks with PostgreSQL available

On 15 November, a read-only `pg_isready` and `SELECT current_database(), current_timestamp` confirmed `bisa_erp` accepts connections as `app_user`. The session endpoint returned HTTP 200 in 50 ms with no session. The protected inventory valuation route returned HTTP 307 in 1.57 seconds on its first smoke request and 0.11–0.12 seconds over three warmed requests. These are unauthenticated redirects, so they verify the web/DB services are reachable but do not exercise inventory reads or authenticated ERP workflows.

The live Next.js 16.4.5 dev server process held about 1.65 GiB RSS across a 30-second idle sample; its measured CPU delta was 0.0% in each of three 10-second intervals. The PostgreSQL application container used 39.7 MB and the disposable performance-test container used 158.2 MB at the sampled instant. Host `MemAvailable` stayed near 9 GiB. A concurrent `pnpm typecheck` passed in 6.82 seconds with maximum RSS of 881,324 KiB and no swap. This confirms the earlier connection error was environmental (database unavailable); it does not establish that database availability caused the development server's retained memory. The dev server's idle RSS remains high relative to the database, while CPU was idle in this sample. Without an authenticated production-like workload and a heap profile, no further safe memory-specific source change is evidenced.

| Verification | Result |
|---|---|
| Application PostgreSQL readiness and read-only SQL probe | PASS; `bisa_erp` accepted the `app_user` connection. |
| Session and protected inventory route smoke | PASS for service reachability; session 200, protected route 307 without authentication. Inventory page data path remains UNVERIFIED. |
| Warm protected-route response | PASS; 0.11–0.12 s for three unauthenticated redirects after cold request. |
| Idle Next dev process CPU/RSS | PASS measurement; 0.0% CPU over each of three 10-second intervals, about 1.65 GiB RSS for the Next server PID. This is development-only and not a process-tree sum. |
| Database container memory | PASS measurement; application DB 39.7 MB, disposable test DB 158.2 MB at one sample. |
| `pnpm typecheck` | PASS; 6.82 s elapsed, 881,324 KiB peak RSS. |
| Authenticated workflow, production build/runtime, production heap profile | UNVERIFIED; not exercised in this check. |

### MEM-35 — scope Tailwind source detection to the web application

The web stylesheet imported Tailwind without a source base, while the Next/Turbopack root is the repository root. Tailwind v4's official detection guide says automatic detection scans project files outside `.gitignore`, `node_modules`, binary files, CSS, and package-manager lockfiles; `.gitignore` does not exclude this repository's docs, tests, or scripts. The tracked tree contains 882 files under `src` and another 445 across docs/tests/scripts. The web UI is under `src`; the native POS frontend has its own stylesheet and is outside this change.

Changed `src/app/globals.css` to disable automatic detection and explicitly scan `../` relative to that stylesheet (the complete `src` tree). This avoids generating candidates from repository documentation and test fixtures while retaining all tracked web UI sources. The source list is explicit; no runtime data, UI component, or application/database code changed.

An alternating six-process PostCSS A/B compile using the installed Tailwind 4.3.3 plugin measured these medians:

| Metric | Repository-wide baseline | `src`-scoped | Change |
|---|---:|---:|---:|
| Compile time | 581 ms | 417 ms | 28.2% lower |
| Peak RSS | 159,844 KiB | 141,884 KiB | 11.2% lower |
| Generated CSS | 191,659 bytes | 186,951 bytes | 4,708 bytes / 2.5% lower |

After the change, the live Next dev server returned `/login` with HTTP 200 and served its CSS chunk (202,764 bytes). Representative selectors used across the login and shared ERP UI (`.flex`, `.grid`, `.min-h-screen`, `.bg-background`, `.text-foreground`, `.text-destructive`) were present. The CSS chunk includes dev-runtime overhead and is not directly comparable to the standalone PostCSS output sizes above.

The live dev process later settled at 577 MiB RSS and 0.0% CPU across three 10-second idle intervals, with host available memory near 11 GiB. That sample followed route eviction and is not a controlled before/after server benchmark, so it is not attributed to this CSS change. A fresh development request for `/app/akuntansi` had previously compiled in 3.3 seconds; the process briefly peaked around 8.6 GiB during compilation, then fell to about 2.8 GiB. `process.memoryUsage()` after compilation showed about 254 MiB V8 heap used versus 2.89 GiB RSS, so the transient peak is mostly outside the JavaScript heap. The exact native allocation source and production runtime memory remain unverified.

For diagnosis, a heap snapshot of the older dev process contained about 520 MiB of string nodes, 148 MiB of arrays, 112 MiB of code, and 91 MiB of objects (self sizes; not retained-size dominators). Snapshot generation itself raised that process RSS to about 3.45 GiB and a forced GC did not return the native allocation. The dev process was restarted to clear this profiler overhead; the snapshot was deleted, the inspector port was closed, and the current server was rechecked. Do not treat snapshot-time RSS as the application's steady-state memory.

| Verification | Result |
|---|---|
| Tailwind A/B source-scan compile | PASS; six alternating isolated runs; scoped median 417 ms / 141,884 KiB vs baseline 581 ms / 159,844 KiB. |
| Live Next/Turbopack CSS response | PASS; login 200, CSS asset 200, representative web UI selectors present. |
| Idle dev server after route eviction | PASS measurement; 577 MiB RSS, 0.0% CPU over each of three 10-second intervals; not a controlled causal comparison. |
| Authenticated report workflows, production build/runtime, production native-heap profile | UNVERIFIED. |

### MEM-36 — separate build and typecheck peaks while retaining a required type gate

An isolated production build previously reached a recorded maximum RSS of 10,734,340 KiB while Next.js was running its integrated TypeScript phase. Host available memory had fallen to about 1.1 GiB, so that attempt was interrupted before completion. To avoid overlapping build and typecheck memory peaks, the root build script now runs `next build` followed by the repository's `pnpm typecheck`. Next's integrated type validation is skipped, but the build command cannot return success until the same TypeScript check exits successfully; generated route types are already included by `tsconfig.json`. The setting and script are in `next.config.ts` and `package.json`.

With this gate in place, `BISA_TEST_BUILD=1 pnpm build` completed in 13.83 seconds. Next compiled, generated the route manifest and seven static pages, then `tsc --noEmit` passed. Recorded peak RSS was 1,459,916 KiB, about 86% below the prior interrupted run's high-water mark. This is a strong measured reduction, though the prior measurement was interrupted and the pair is not a perfectly controlled repeat-run comparison. No swap was used during the completed build. The build used the isolated `.next-remediation` output and made no database changes.

| Verification | Result |
|---|---|
| `BISA_TEST_BUILD=1 pnpm build` | PASS; production compilation plus required post-build typecheck, exit 0. |
| Completed build max RSS | 1,459,916 KiB; previous interrupted attempt peaked at 10,734,340 KiB. |
| `pnpm typecheck` as an independent check | PASS; 7.60 seconds, max RSS 886,572 KiB. |
| `pnpm exec eslint next.config.ts` | PASS. |
| `git diff --check` and package JSON parse | PASS. |

### MEM-37 — standalone production runtime smoke and current database state

The isolated standalone output was launched locally on port 3010 with the existing environment file; secret values were not printed. The login page and auth session endpoint returned HTTP 200, and an unauthenticated protected accounting page redirected to `/login` (HTTP 307). Both generated CSS files returned HTTP 200 after the standalone static assets were staged in the isolated build directory, and representative Tailwind selectors were present. The production server held about 126–130 MiB RSS, with approximately 0–0.7% CPU in short idle samples. This is a smoke measurement, not a load test or authenticated transaction test.

The API health endpoint returned HTTP 503 because the local database is behind the code's expected migration `0080_tenant_pos_references`. A direct read-only query on 15 November confirmed the application database is currently online: `bisa_erp`, PostgreSQL 18.6, role `app_user`; `drizzle.__drizzle_migrations` has 80 rows, latest timestamp `1794650782568` (migration 0079). The repository migration journal includes 0080. No migration was applied because the existing authorization was limited to migration 0073. Therefore the standalone runtime was reachable, but this database/code pair does not currently pass the app's migration health check; this is an operational blocker outside the measured performance changes.

| Verification | Result |
|---|---|
| Standalone `/login`, session API, protected route, CSS assets | PASS for unauthenticated smoke; 200, 200, 307, and 200 respectively. |
| Standalone idle process memory/CPU | PASS measurement; about 126–130 MiB RSS, CPU below 1% in short idle samples. |
| Read-only live database identity probe | PASS; `bisa_erp`, `app_user`, PostgreSQL 18.6; 80 applied migrations through 0079. |
| `/api/health` migration check | FAIL / BLOCKED for readiness; HTTP 503 due to expected migration 0080 being unapplied. No migration was run. |
| Authenticated POS/warehouse/accounting workflows, concurrency/load test, production host and restore drill | UNVERIFIED. |

The local development server remains available at `http://127.0.0.1:3000`; its `/login` endpoint returned HTTP 200 at final verification. PostgreSQL is reachable on port 5433. The `pg_isready` utility is not installed in this environment, so direct SQL and the application endpoint were used instead. The inspector port used for the earlier heap diagnostic is closed, and its temporary snapshot was deleted.

### Operational follow-up — migration 0080 applied (15 November 2026)

After the above readiness check, an encrypted, archive-verified backup was created before changing the database: `backups/bisa-20261115-070332-98091.dump.enc` (672,248 bytes). Its SHA-256 matched the sidecar manifest. The backup credential was generated randomly and stored outside the repository at `~/.config/bisa-erp/backup-passphrase` with mode `0600`; its contents were not logged. Keep a recovery copy of this credential in an approved off-host secret store.

`pnpm db:migrate` completed successfully against the verified local target `localhost:5433/bisa_erp`. The migration journal now has 81 applied entries through `0080_tenant_pos_references`; a source-journal comparison found no pending migrations. The three company/id unique indexes and nine company-scoped POS foreign keys introduced by 0080 are present. The foreign keys are `NOT VALID` by design in the migration, so existing rows were not scanned/validated; PostgreSQL enforces them for subsequent writes, while legacy-history validation remains a separate task.

The application health endpoint was rechecked after migration and returned HTTP 200 with `db=ok`, `migration=0080_tenant_pos_references`, and `migrationStatus=current`. The earlier 503 observation above is preserved as historical evidence; it is now resolved for this local database. No application source/configuration or business records were changed by the migration; the schema and Drizzle migration history were updated.
