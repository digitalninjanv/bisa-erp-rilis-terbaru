# POS Audit — checkpoint 1

**Scope:** Web terminal, server checkout, offline queue/sync, held sales, cashier sessions, returns/voids, customer and pricing inputs, inventory/accounting effects, PWA shell, and print/device boundaries. **Status:** source review complete for the high-risk server paths; full workflow verification is incomplete because the disposable PostgreSQL integration environment is unavailable.

## Coverage and evidence

| Workflow | Code reviewed | Evidence/status |
|---|---|---|
| Product selection, cart, barcode/search, and quote | `src/components/pos/terminal/*`, `src/server/pos/quote.ts`, `src/server/actions/pos.ts` | Static review. The server re-quotes and does not trust client totals. Unit tests ran; no browser interaction timings were collected. |
| Checkout, split tender, receivable, duplicate submission | `src/server/actions/pos.ts`, `src/server/pos/sales-create.ts`, `sales-payments.ts`, `sales-persist.ts` | Static review. Server idempotency/fingerprint, permission checks, row locks, and single-transaction sale/payment/stock/cash/journal/audit writes were found. DB race tests not run. |
| Cashier session and reconciliation | `src/server/pos/sessions.ts`, POS action wrappers | Static review. Close locks the owned session, recomputes cash movements, guards a stale preview, requires a reason beyond configured tolerance, and posts the difference journal atomically. DB-backed close/concurrency tests not run. |
| Returns, voids, refunds | `src/server/pos/returns.ts`, `sales-void.ts`, `src/server/actions/pos.ts` | Static review. Return values use original sale-line snapshots; source sale/payment/serial state is checked and reversal work is transactional. DB-backed tests not run. |
| Offline sync, review, retries | `src/server/pos/offline.ts`, `offline-payload.ts`, `src/server/actions/pos-offline.ts`, `src/app/api/pos/sync/route.ts` | Static review; unit suite passed. Integration/simulation suites could not start without the guarded `*_test` database. |
| POS offline shell cache | `public/pos-sw.js`, `src/proxy.ts`, `src/components/pwa/pos-service-worker.tsx` | Reproduced in local headless Chromium 1254 with a same-origin controlled navigation and an HttpOnly cookie: `FetchEvent.request.headers.get("cookie")` returned `null`. See POS-001. |
| Receipt/thermal print, desktop companion | POS print components, `pos-desktop/`, `pos-electron/`, print queue tests | Static/unit coverage only. No physical printer/device or desktop runtime test. The working tree has no `src-tauri/`; the prior draft’s Tauri path is stale. |

### Positive controls observed

- Checkout validates `pos.sell`, normalizes a request fingerprint, claims/replays an idempotency key, checks held-sale state, and calls the domain posting path in a tenant-scoped transaction (`src/server/actions/pos.ts:257-383`).
- `createSale` recomputes price/tax/discount totals, validates tenant-owned customer/warehouse/payment methods, locks cashier session/customer/stock-sensitive rows, and writes sale, payments, stock movement, cash movement, journal, and audit data in one transaction (`src/server/pos/sales-create.ts`, `sales-persist.ts`, `sales-stock.ts`).
- Offline sync retains origin cashier/session identity, compares the stored receipt snapshot to a fresh quote, and uses the same idempotent sale creation path. Conflicts go to supervisor review instead of silently changing the total (`src/server/pos/offline.ts:324-455`).
- Return valuation reads original sale line amounts and caps against prior returns (`src/server/pos/returns.ts`). The earlier draft claims that returns use current product prices were not supported by the current source reviewed.
- Session close is owner-scoped by default; supervisor force-close is permission-gated and audit logged (`src/server/pos/sessions.ts:176-300`).

## Findings

### POS-001 — Offline terminal shell never uses its per-session cache in Chromium

- **Severity / priority:** High / P1 (offline POS shell workflow unavailable)
- **Confidence:** Confirmed in a local Chromium reproduction; application behavior inferred by matching the tested browser behavior to the inspected code.
- **Affected workflow:** Reloading `/app/pos` while offline after a successful online visit.
- **Location:** `public/pos-sw.js:113-147`; cookie set as HttpOnly at `src/proxy.ts:73-81`.
- **Reproduction:** Register the current worker scope, visit the shell online with an HttpOnly `pos_shell_uid`, then navigate to the shell while offline. In the local controlled-browser reproduction, the fetch event’s `Request` had no readable `cookie` header. The handler therefore gets `uid === null`; `terminalDocument` returns `fetch(request)` before consulting `Cache.match`. The actual application was not launched for this browser test.
- **Expected:** The logged-in terminal can reload the cached shell during a network outage, subject to the intended session isolation policy.
- **Actual:** In Chromium, the request cookie is not visible to this service worker code; the shell cache key is never selected and offline navigation fails.
- **Root cause / impact:** The cache key depends on reading a browser-managed `Cookie` header from `FetchEvent.request`. The same cookie is explicitly `HttpOnly`, and the browser reproduction returned `null`. This breaks offline shell reload, which blocks the PWA shell needed to reach the local offline queue.
- **Minimal safe fix:** Replace the cookie-header dependency with a server-issued, non-authentication cache identity that the page can explicitly pass to the worker, or redesign the cached shell so it does not require per-user SSR content. Preserve the invariant that offline cache keys cannot authorize server actions and that logged-out users cannot receive another session’s personalized shell.
- **Regression check:** Playwright test against the real app on Chromium, Firefox, and WebKit: warm shell online; assert it is cached; switch offline; reload; assert expected shell is served only for the active identity; sign out/switch user; assert prior personalized content is not served.
- **Complexity:** Medium.

### POS-002 — Offline sync history is append-only, unbounded, and repeatedly scanned

- **Severity / priority:** Medium / P2 (degrades over time; transaction details remain retained)
- **Confidence:** Strong evidence from source and schema; no production-size benchmark was available.
- **Affected workflow:** Offline sale retry/sync and supervisor review/settlement.
- **Location:** `src/server/pos/offline.ts:165-242, 559-572`; `src/server/pos/offline-payload.ts:39-59`; `src/db/schema/platform.ts:323-334`.
- **Reproduction/scenario:** Each call to the sync result recorder inserts another `outbox` row and stores the complete sale payload. A retry for the same client key counts all matching JSONB rows; pending supersession and terminal resolution also filter JSONB by client key. Settlement reads every offline-sale outbox payload for the company and sums in application code. The inspected schema has only `(processed_at, created_at)` and inspected `src/`, `scripts/`, and `deploy/` have no outbox retention/deletion job (apart from fixture cleanup in seed code).
- **Expected:** Retry metadata and required review/audit information stay bounded and key lookups remain proportional to the relevant queue.
- **Actual:** Successful and failed attempts accumulate indefinitely, including full sale payloads and payment references. Company review/settlement queries load and scan historical rows; the default review-list path selects complete rows before discarding sale payloads in application code.
- **Root cause / impact:** Attempt history, operational review queue, and retained replay payload share one JSONB table without a retention policy or a key index. Storage, vacuum work, and sync/review latency grow with historic activity; transaction details remain available longer than necessary.
- **Minimal safe fix:** Define a business-approved retention period; archive/delete resolved payloads after it while preserving the minimum audit record. Store indexed `company_id/event_type/client_key` and settlement session fields (or add suitable expression indexes), and paginate review results. Keep unresolved rows and any legally required audit evidence.
- **Regression check:** Seed a large synthetic outbox in a disposable database, compare plans/latency for sync lookup, settlement, and review, and verify retention never deletes unresolved work.
- **Complexity:** Medium.

## Test and verification record

- `pnpm test`: **passed**, 133 unit files / 1,190 tests, 41.04 seconds (from this audit session’s earlier run). These are unit tests, not checkout-to-database integration tests.
- POS-focused integration/simulation tests: **not run**. The repository’s Vitest guard refused to start because `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` were not configured; Docker is installed but its daemon is unavailable, and no local PostgreSQL service was found. No test touched `.env.local` or a non-test database.
- POS UI/browser flows, browser matrix, printer hardware, API/network-failure timing, load/concurrency percentiles: **not measured**.
- Current Chromium offline-cookie probe: **passed as a defect reproduction**; a controlled fetch event returned `cookie: null` for a browser-managed HttpOnly cookie.

## References used

- Next.js says Server Actions and Route Handlers must be treated as public endpoints and individually authorized: [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security).
- Browser request behavior cross-check: [Fetch Standard](https://fetch.spec.whatwg.org/) and [MDN FetchEvent.request](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/request). The decisive cookie result above is from the local browser reproduction, not an inference from a generic header guide.
- Context7 and Exa MCP were unavailable in this session. Official documentation and local installed-version source were used as fallbacks.

## Ponytail audit summary

Native prioritized summary for this scoped run (maximum 20 findings):

- **Must:** POS-001 — offline shell cache key is unavailable to the worker in the tested Chromium behavior; change the identity flow and add a real-browser offline regression.
- **Should:** POS-002 — bound/index retained offline attempts and paginate review/settlement scans.
- **Nice:** None established from evidence.
- **Verdict:** Do not claim the POS is production-ready for offline operation until POS-001 is fixed and real database/browser lifecycle tests pass. Online sale invariants look deliberately guarded in source; dynamic verification remains incomplete.
- **Lean:** Two findings; fixes should remain localized to the worker identity contract and outbox lifecycle/query shape.
- **Not checked:** Live app/browser end-to-end, DB-backed integration/concurrency, cross-browser offline behavior, printer hardware, measured load/performance.
