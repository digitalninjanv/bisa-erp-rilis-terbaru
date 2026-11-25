# POS — Deep Audit

**Scope:** catalog/search/barcode, packaging, pricing groups, discounts, tax/rounding, cart/hold, checkout and tender, credit/debt, returns/exchange/void, cash sessions, receipts/printing, offline/PWA, device/desktop APIs, inventory and journal effects.
**Evidence run:** 17 integration files, **151/151 passed** (`audit/checks/validate-pos-after-scan.log`; includes the new exact-code scan set); previous full-module run **144/144** (`audit/checks/validate-pos-full2.log`); PWA E2E **2/2** (`validate-pwa-final.log`); full unit suite **1,235/1,235** (`audit/checks/pos-unit-after-scan.log`).

## Inventory and traceability

| Surface | Main code | Notes |
|---|---|---|
| Terminal UI | `src/components/pos/pos-terminal.tsx` (801 lines), `components/pos/terminal/*` | Search, cart, payment, hold, offline queue, print queue, admin panel. |
| Actions | `src/server/actions/pos.ts`, `pos-offline.ts`, `pos-sessions.ts`, `pos-receipt.ts`, `pos-terminals.ts` | Permission + Zod + tenant transaction; checkout uses `pos.sell`. |
| Domain | `src/server/pos/{quote,sales-create,sales-payments,sales-persist,sales-stock,sales-void,returns,receivables,sessions,offline,terminals,receipt-token}.ts` | Shared by web, offline, and device sync. |
| Persistence | `src/db/schema/{sales,catalog,platform}.ts`, migrations 0087/0088 | Sales, payments, returns, cash sessions, outbox, terminals. |
| API | `/api/pos/{snapshot,sync,pair,telemetry,download,update,desktop/*}` | Bearer device token or authenticated user; pairing code is the credential. |

## Verified workflows

- **Server quote and price integrity:** client prices are ignored; `quoteCart` recomputes product/group/manual discounts, tax, rounding, packaging conversion, stock and reservation availability. `lockCosts:true` locks product rows (`quote.ts:408`) before COGS is snapshotted.
- **Checkout idempotency and replay:** `checkoutAction` takes a transaction-scoped advisory lock, claims `pos.sale` idempotency, compares a canonical fingerprint, handles held-sale claims, and writes sale/payments/stock/cash/journal/audit in one tenant transaction (`actions/pos.ts:257-364`, `sales-create.ts`). Concurrent replay and changed-payload rejection are exercised by `erp-concurrency-remediation` (passed) and the E2E lost-response scenario (passed).
- **Cash session serialization:** checkout and close lock the `cash_sessions` row (`sales-create.ts:344-394`, `sessions.ts:176-260`). Close recomputes expected cash, rejects stale previews, requires a reason beyond tolerance, and posts the difference. Fixture isolation was corrected; the full POS suite now passes 144/144.
- **Stock deduction:** `applyStockMovement` locks product then `stock_on_hand`, refuses negative results unless `allow_negative_stock`, appends the movement, and re-blends AVCO. Sales respect the company setting. Batch lines use FEFO; serials are validated.
- **Returns/voids:** origin sale row and lines are locked; return caps are computed from original line values; stock and serial/batch restoration use original slices; receivable offset and refund are separated; void is blocked when a posted return exists; AR payments and customer credits are reversed. Financial and original-print assertions now pass after the POS-005 fix.
- **Device/security:** device tokens are digest-only, resolved per terminal, revocable, and tenant-scoped; snapshot omits `costPrice`; pairing is throttled; updater requires a token and a real artifact+signature; Electron uses `sandbox`, `contextIsolation`, no Node, and origin navigation guards.
- **Telemetry:** bounded body/fields/values, reserved server keys (SEC-001 fixed).

## Critical POS scenarios

| Scenario | Result | Evidence / limit |
|---|---|---|
| Double-click checkout | **PASS** | UI blocks overlapping submit + server attempt lock/idempotency; `pos-guards`/`pos-audit-remediation` |
| Two cashiers selling the last stock | **PASS (probe)** | Product/on-hand `FOR UPDATE` + negative policy; disposable-DB probe: 4/8/20 concurrent same-SKU sales all committed, stock delta exact, no oversell. Single host, no production network. |
| Timeout after payment succeeds | **PASS (one scenario)** | Playwright lost-response replay returns the same sale once (`browser-guarded.log`) |
| Network interruption during checkout | **PASS (one scenario)** | Recovery record + retry path; E2E network failure case passed |
| Repeated rapid barcode scanning | **PARTIAL** | Exact barcode/SKU path now index-backed and measured at 10.2k/100k products; no physical scanner/rapid-fire hardware test |
| Failed payment / rollback | **PARTIAL** | Tenant transaction composes sale/stock/cash/journal; no injected DB failure mid-commit |
| Duplicate API request / retry | **PASS** | Fingerprint compare, same key/same payload replay, changed payload conflicts; 8-way replay probe produced one sale row |
| Refund and stock restoration | **PASS** | `pos-returns` stock/serial/batch and journal assertions; POS-005 print/token assertions pass |
| Discount/tax/rounding edge cases | **PASS (tested cases)** | `pos-quote-parity`, `packaging-pos`; no exhaustive property/fuzz test |
| Printer failure after committed sale | **NOT TESTED** | Print is outside the DB commit; no hardware/jam test. A failed print must not re-post the sale. |

## Findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| POS-005 | **P1 — FIXED** | Post-checkout receipt/A4 links now carry the one-time `printToken`; only `salinan=1` marks a copy; A4 accepts a fresh token. | FIXED / VERIFIED (`p1-pos-receipts.log` 12/12) |
| POS-006 | **P2 — FIXED** | First offline reload now works: cache id persisted in Cache Storage + page postMessage; E2E 2/2. | FIXED / VERIFIED |
| POS-002 | **P2 — FIXED** | Outbox retention CLI (`prune:pos-outbox`) preserves unresolved rows; docs added. | FIXED (control) |
| QA-002 | **P2 — FIXED** | Fixture isolation and brittle assertions corrected; full POS 144/144. | FIXED / VERIFIED |
| POS-007 | **P2 — FIXED / VERIFIED** | Exact barcode/SKU scan resolved through unique indexes instead of an OR that seq-scanned the catalog. 100k-product p50 65.2 → 4.9 ms (13.4×); 10.2k 7.2 → 4.3 ms. | FIXED / VERIFIED |

### POS-007 detail (FIXED 2026-11-24)

The scan path called `searchProducts({ exactCode: true })`; its single OR predicate (`barcode = q OR sku = q OR EXISTS(packaging barcode = q)`) defeated the unique B-tree indexes and produced a sequential scan on every scan. EXPLAIN at 10.2k showed `Seq Scan on products`, 10,265 rows removed. The prior S4 benchmark had already measured **185 ms p50** for POS barcode search at 100k products (`docs/sim2/S4-BENCHMARK.md`), which grows linearly with catalog size. The fix resolves the code through `products.barcode`, `product_packagings.barcode`, then `products.sku` (same barcode → packaging → SKU priority as the old `ORDER BY`) and fetches one row by id; typed search and all other semantics are unchanged. A synthetic row at the end of the 100k heap scanned in 4.51 ms p50 after the fix, versus a 73.1 ms seq-scan plan for the old OR on the same code. Regression tests (`tests/integration/pos-search-exact.test.ts`, 7 cases) cover barcode/SKU/packaging matches, inactive packaging, both priority collisions, category filtering, and empty input. Evidence: `validate-pos-after-scan.log` 151/151, `pos-search-bench-100k-before.log` vs `pos-search-bench-100k-after.log`, `pos-search-bench-100k-late-after.log`.

### POS-005 detail (FIXED 2026-11-23)

The pre-fix path had `actions/pos.ts:315,359` returning `receiptToken`, while `checkout-success-modal.tsx` and `use-terminal-checkout.ts` navigated without it; `nota/[id]/page.tsx` treated `!fresh` as a copy and built-in Kasir lacked `pos.receipt.reprint`. The fix adds `src/lib/pos/receipt-links.ts`, propagates the token through the success modal/router/popup and receipt↔A4 links, makes `salinan=1` the only copy marker, and lets A4 accept a fresh token (historical views still require reprint permission and are audited). Evidence: `p1-pos-receipts.log` 12/12, `p1-unit-seed-links.log`; build/typecheck pass.

## POS-006 detail

`public/pos-sw.js:62-103` fetches `/app/pos` during install, caches only `/_next/static/*` assets, and explicitly skips the document. `terminalDocument` caches the document only during a controlled successful navigation (`:160-177`). The first `/app/pos` navigation occurs before the new worker controls the page, so the per-session cache is empty. Pre-fix E2E failed \`net::ERR_FAILED\`. Fixed by storing the cache id in Cache Storage during install/navigation and accepting the page-posted id (CookieStore in a worker cannot read the `/app/pos` cookie because of the script-URL scope restriction). Post-fix E2E: 2/2 (`validate-pwa-final.log`).

## Measured performance (2026-11-24)

Disposable PostgreSQL 18.6 fixture, app role `app_user` under forced RLS, production standalone Next.js build on the same host. These are **lab measurements, not production SLOs**: no store LAN, no representative prod data, no physical scanner/printer, no multi-host pool contention. Raw logs are in `audit/checks/pos-*.log`.

**Server domain calls, 10,200 products (p50 / p95 ms; 40–60 runs):**

| Operation | Before POS-007 | After POS-007 |
|---|---:|---:|
| Exact barcode scan | 7.22 / 9.14 | **4.33 / 6.08** |
| Exact SKU scan | 7.16 / 8.08 | **4.53 / 6.20** |
| Typed name search ("Aqua") | 19.35 / 21.11 | unchanged |
| Empty catalog page (24) | 4.44 / 5.96 | unchanged |
| Quote 1 / 5 / 20 lines | 6.11 / 6.09 / 6.99 p50 | unchanged |
| Checkout 1 line (commit incl. journal/stock/cash) | 39.4 / 95.2 (n=10) | unchanged |

**Scaling probe, 100,200 products (90k synthetic no-stock rows added to the 10.2k fixture; 40 runs):**

| Operation | Before | After | Change |
|---|---:|---:|---:|
| Exact barcode | 65.23 / 72.25 | **4.88 / 7.28** | **13.4× p50** |
| Exact SKU | 63.71 / 66.41 | **4.93 / 6.55** | **12.9× p50** |
| Typed word | 159.95 / 168.51 | 158.60 / 174.08 | unchanged (not optimized) |

The synthetic 100k rows have no stock rows, so the old path is *faster* than S4's 185 ms p50 (which had stock rows); the before/after comparison is still apples-to-apples within this fixture. The result is not position-dependent: a synthetic row at the end of the 100k heap measured **4.51 / 6.13 ms p50/p95** after the fix, while the old OR query's `EXPLAIN` on that same code was **73.1 ms** (`Seq Scan`, 90,140 rows removed).

**Browser, Chromium, production build, 10.2k products, 3 baseline runs before POS-007** (the scan flow was re-run successfully after the fix; absolute times below are baseline):

| Interaction | Observed |
|---|---|
| `/app/pos` TTFB / DOMContentLoaded / load | 29–278 / 114–435 / 183–509 ms (first vs warm) |
| Scan → cart line visible | p50 **82–86 ms**, p95 **198–251 ms** (first scan slower) |
| Quote → Bayar enabled | **225–268 ms** (includes 180 ms debounce) |
| Bayar → success modal | **238–303 ms** end-to-end; server commit 84–110 ms, revalidation 0–1 ms |
| Typed search → refreshed cards | **343–378 ms** (includes 220 ms debounce; action 99–192 ms) |
| Long tasks (>50 ms) | 0–2 per run, max 51 ms; no console errors |

Text search deliberately keeps debounce rather than `useDeferredValue` alone: React's own guidance says `useDeferredValue` does not reduce network requests (https://react.dev/reference/react/useDeferredValue). The 220 ms debounce is what cuts requests; the measured first-char search is 25 ms server-side at 10.2k and 157 ms at 100k.

**Checkout concurrency and integrity (same-product lock queue):**

| Probe | Result |
|---|---|
| 4 simultaneous same-SKU sales | 4/4 committed, p50 189.5 ms, p95 258.6 ms |
| 8 simultaneous same-SKU sales | 8/8 committed, p50 344.9 ms, p95 544.6 ms |
| 20 simultaneous same-SKU sales | 20/20 committed, p50 787.5 ms, p95 1,344.4 ms |
| 16 simultaneous 2-product carts in opposite order | 16/16 committed, p50 758.6 ms, max 1,241.1 ms; no deadlock |
| 8 concurrent retries with one idempotency key | 8 fulfilled, **1 sale row / 1 id**, p50 50–68 ms |
| Stock delta after each run | exactly `−sold`, no oversell |

This confirms the serialized lock is safe and that opposite cart order does not deadlock (POS-009), but absolute times are single-host lab numbers; a 20-terminal same-SKU burst is a stress case, not a normal cashier load.

**Offline snapshot (direct domain call, 10.2k products):** full snapshot **1,083.7 ms / 3.21 MB**; immediate delta **22.4 ms / 13.4 KB**. Full sync is a one-time/offline initial cost; delta is the recurring sync path.

**Not measured:** production/staging network latency, pool-wait under mixed reporting + POS load, 100k-product browser run, long soak/memory, physical scanner inter-key timing, printer throughput/jam. The 100k probe is a scaling indicator, not a capacity guarantee.

## Test evidence and gaps

- `validate-pos-after-scan.log`: 17 files, **151/151 passed** after POS-007 (POS suite + exact-code regression).
- `p1-pos-receipts.log`: receipt/invoice P1 regression set **12/12 passed** (fresh token, no-token original, `salinan=1`, A4).
- `current-pos.log` (pre-fix): 14 files pass; `pos-audit-remediation` 2 fixture failures; the `pos-session-close-hardening` POS-005 failure is now fixed.
- `validate-pwa-final.log`: PWA online/offline reload + sync **2/2 passed**.
- **Not tested:** physical printer/jam/power loss, barcode scanner hardware/rapid scan, cross-browser matrix, full 23-file E2E suite, production RLS, load/concurrency at target volume, Electron packaging/install.
- **No P0 confirmed** in the executed POS paths. POS-005, POS-006, and POS-007 are fixed; no active POS code finding remains. Full outage/retry lifecycle, target-volume load, and printer hardware remain untested.

## Electron desktop smoke — 2026-11-25

- Rebuilt AppImage from current source: `app.asar` contains `main.cjs`, preload/settings/offline scripts, both HTML files, and both view scripts; SHA-256 matches the artifact.
- Real Electron 45.4.1 under Xvfb: offline start → offline page; settings window → printer list/58–80mm controls; login → `/app/pos`; full cash sale → “Transaksi berhasil”; no page/console errors.
- 13 key ERP pages (POS, history/session/hold, warehouse, receipt/valuation, opening-stock import, accounting/reports) returned 200 with no error screen.
- Root cause of an initial React #441: disposable DB had not applied migration 0089 (`products.is_tax_exempt`); after `pnpm db:migrate`, POS opened normally. The server release tarball was rebuilt with 0089 and install/update scripts run `migrate.mjs` before serving.
- Residual desktop gaps: LAN `http://IP` is not a secure context, so the PWA offline shell does not register there; kiosk scripts/runbook still carry Tauri-era paths; no auto-update/code signing and Windows NSIS was not built on this host. See `audit/modules/PLATFORM_SECURITY.md` (ELE-001…ELE-005).

## Contrast & readability audit — 2026-11-25

The POS palette was raised from a white-on-white hierarchy to a neutral canvas + white surfaces + strong component boundaries. Layout and workflow are unchanged.

| Token/role | Value | Contrast |
|---|---|---|
| Main text / white | `#0f172a` / `#ffffff` | 17.85:1 |
| Secondary text / white | `#475569` / `#ffffff` | 7.58:1 |
| Field border / white | `#64748b` / `#ffffff` | 4.76:1 |
| Component border / white | `#77869a` / `#ffffff` | 3.71:1 |
| Component border / tray | `#77869a` / `#e9eef5` | 3.29:1 |
| Action green / white | `#047857` / `#ffffff` | 5.48:1 |

Changes: canvas `#e4eaf1`, tray `#e9eef5`, header `#e2e8f0`; product/payment/cart panels use `--pos-border-strong`; fields use `--input: #64748b`; accurate action primary darkened `#059669 → #047857`; selected cards use the full action-soft fill; stock badges use `slate-200/slate-800`; payment content is a tinted band; category bar and pagination footer are tinted; payment footer is sticky with a solid action button. `@media (prefers-contrast: more)` strengthens borders/backgrounds, and the existing forced-colors rules remain.

Verification: axe-core WCAG 2 A/AA scan of `/app/pos` with two cart lines reports **0 violations** (`audit/checks/pos-axe-final.log`); screenshot `audit/checks/pos-contrast-after.png`; unit suite 1,249/1,249, typecheck/build/lint pass. No contrast claim is made for physical displays or unmeasured color-blind simulations.
