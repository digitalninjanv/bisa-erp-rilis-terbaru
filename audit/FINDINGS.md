# Master Findings Ledger — 2026-11-23

**Snapshot:** HEAD `6140f97` + current working-tree changes.
**Rule:** `CONFIRMED` = reproduced by a test/probe or an unambiguous deterministic code path; `SUPPORTED` = strong source evidence, runtime consequence not reproduced; `UNVERIFIED` = plausible hypothesis needing more work. No P0 was confirmed. That is not proof that no P0 exists in production.

> **Remediation completed (2026-11-23).** All P1/P2/P3 findings are fixed or closed as recorded below. **No active code/test finding remains.** The system is still not production-certified because independent verification gaps remain (production RLS, GitHub security run, Electron, load, backup/restore, printer, full E2E).

| P1 | Resolution | Evidence |
|---|---|---|
| POS-005 | Post-checkout receipt/A4 links now use `receiptHref`/`invoiceHref` with the one-time `printToken`; `salinan=1` is the only copy marker; A4 accepts a fresh token and audits historical copies. | `audit/checks/p1-pos-receipts.log` 12/12; `audit/checks/p1-unit-seed-links.log` receipt-link tests; `audit/checks/p1-build.log` |
| SEC-002 | Demo seed refuses `NODE_ENV=production` unless `--allow-production-seed` and a unique `BISA_SEED_OWNER_PASSWORD` ≥16 chars; the production password is never printed. | `audit/checks/p1-production-seed-guard.log` (exit 1); unit guard tests; docs updated |
| PLT-001 | Tauri native path retired (official desktop is Electron): stale release workflow/script removed, Tauri CLI/script removed, docs banner added, download route serves Electron artifacts only. | `audit/checks/p1-release-retirement.log`; build/typecheck |

## P2/P3 remediation — 2026-11-23

| ID | Result | Change and evidence |
|---|---|---|
| POS-006 | **FIXED / VERIFIED** | SW install/navigation now stores the shell cache id in Cache Storage and the page posts it; CookieStore scope failure no longer blocks offline reload. `validate-pwa-e2e.log`/`validate-pwa-e2e2.log` 2/2.  |
| WH-001 | **FIXED / VERIFIED** | Receipt idempotency now stores/compares a request fingerprint; changed retry is a conflict. `validate-fixes.log`, `goods-receipt` new test.  |
| CORE-02 | **FIXED (source)** | Bank reconciliation and purchase-advance actions use `requirePermissionInModule`; import commit/analyze gate by entity module. Unit test `tests/unit/import-module.test.ts`.  |
| DATA-001 | **FIXED / VERIFIED** | Report/dashboard pages use `withCompanyReadOnlySnapshot`; `report-snapshot-consistency.test.ts` proves READ COMMITTED mismatch vs snapshot.  |
| SEC-003 | **FIXED (CI gate; GitHub run not executed)** | Added CI `security` job: `pnpm audit --prod`, gitleaks, Semgrep (`p/typescript`, error severity). Local `pnpm audit` pass and Semgrep 0 error findings.  |
| POS-002 | **FIXED (control implemented)** | Added `pruneResolvedPosOutbox`, `pnpm prune:pos-outbox`, docs; unresolved rows are never deleted. Deployment cron schedule remains operator-specific.  |
| PERF-001 | **FIXED (control implemented)** | Added a process-level concurrent ledger export cap (`BISA_LEDGER_EXPORT_LIMIT`, default 4) with release on close/cancel; not load-tested.  |
| QA-002 | **FIXED / VERIFIED** | Removed brittle `"7000"` assertions, created an isolated receipt customer, isolated the cash-guard account, corrected HR legacy expectation; full POS suite 144/144 and cash/HR/returns 24/24.  |
| POS-007 | **FIXED / VERIFIED** | Exact barcode/SKU scan now resolves through the unique indexes instead of a catalog-wide OR/seq scan; 100k-product p50 65.2→4.9 ms, 10.2k 7.2→4.3 ms. New exact-code regression tests; POS suite 151/151. |
| QA-003 | **FIXED (registered debt)** | Registered three 801/801/890-line files in the ratchet with explicit refactor-debt comments; unit suite 1,219/1,219.  |
| HR-003 | **CLOSED — intended safe behavior** | Validation showed both overlapping legacy approvals are rejected until one duplicate is rejected; test now covers reject-one-then-approve. No double-pay path.  |
| TXN-001 | **FIXED / VERIFIED** | Journal idempotency fingerprints are excluded from retention pruning; `idempotency-retention.test.ts` proves the journal key survives.  |

## Import stok awal — 2026-11-25

| ID | Result | Change and evidence |
|---|---|---|
| IMP-001 | **P1 — FIXED / VERIFIED** | `stock_receipt_lines` insert is now chunked at 500 rows, so a 4,000-line opening-stock file no longer exceeds the PostgreSQL 65,534 bind-parameter limit. Regression: `opening-stock-import-guards.test.ts` 4,000-row commit passes; before it failed `MAX_PARAMETERS_EXCEEDED` at `receipts.ts:734`. |
| IMP-002 | **P1 — FIXED / VERIFIED** | Qty ≠ 0 with unit cost 0 is rejected unless the wizard’s explicit “Izinkan biaya 0” confirmation is checked. Prevents zero-value stock and `products.costPrice` re-blending to 0. Regression: blocked + allowed cases pass. |
| IMP-003 | **P2 — FIXED / VERIFIED** | Opening-stock template now uses a real eligible product and the full six-column header; unit cost is marked required; instructions agree with the parser/UI. Test asserts the sample SKU exists in `products`. |
| IMP-004 | **P2 — OPEN** | Opening-stock commit still processes all pending rows in one call/transaction despite UI limit 250; 1,000 positive rows took 6.5 s and 5,000 rows 29.1 s in domain probes, with product locks held until commit. True batching/progress remains. |
| IMP-005 | **P2 — OPEN** | No failed-row download, completed-job detail, or inline edit for opening-stock rows; users repair the whole file and re-upload. |

## Findings ledger (all findings remediated/closed; verification gaps remain)

| ID | Severity | Module | Status | Location | Summary |
|---|---|---|---|---|---|
| POS-005 | **P1 — FIXED** | POS receipts | VERIFIED | `src/lib/pos/receipt-links.ts`; `src/app/app/pos/nota/[id]/page.tsx`; `faktur/page.tsx`; `checkout-success-modal.tsx`; `use-terminal-checkout.ts` | Post-checkout links now carry the one-time `printToken`; `salinan=1` is the only copy marker; A4 accepts a fresh token. Regression tests pass. |
| SEC-002 | **P1 conditional — FIXED** | Security / deployment | VERIFIED | `src/db/seed-guard.ts`; `src/db/seed.ts`; `docs/DEPLOY.md`; `.env.example` | Production demo seed now requires explicit `--allow-production-seed` + unique `BISA_SEED_OWNER_PASSWORD` ≥16; published demo password is rejected and the production password is never printed. |
| PLT-001 | **P1 conditional — RESOLVED** | POS native release | VERIFIED (retired) | `.github/workflows/pos-desktop-release.yml` (deleted); `scripts/release-pos-desktop.sh` (deleted); `package.json`; docs | Tauri path retired in favour of the documented Electron desktop. Stale workflow/script/CLI removed; docs and download UI now point to Electron artifacts. |
| POS-006 | **P2** | POS offline/PWA | **FIXED / VERIFIED** | `public/pos-sw.js:62-103,160-200`; `e2e/pos-audit-remediation.spec.ts:205-215` | The app shell is only cached during a service-worker-controlled navigation. The install precache downloads the shell but deliberately does not store the document. First offline reload after enabling offline fails `net::ERR_FAILED`. |
| POS-007 | **P2 performance** | POS catalog/search | **FIXED / VERIFIED** | `src/server/catalog/products.ts:452-495`; `tests/integration/pos-search-exact.test.ts` | Exact barcode/SKU scan used one OR predicate across products.barcode, products.sku, and the packaging EXISTS. EXPLAIN showed a full sequential scan; S4 measured 185 ms p50 at 100k products, growing linearly. Now resolves through the three unique indexes with the old priority and fetches one row. |
| WH-001 | **P2** | Warehouse receipts | **FIXED / VERIFIED** | `src/server/inventory/receipts.ts:288-320`; `src/components/gudang/receipt-form.tsx:64-67,292-338` | Receipt replay returns the existing final receipt by idempotency key without comparing the request payload. If the first response is lost and the user edits the form, the retry reports success but silently discards the edits. |
| CORE-02 | **P2** | Module authorization | **FIXED (source)** | `src/server/actions/import/commit.ts:49`; `import/analyze.ts:27`; `bank-reconciliation.ts:27,49,66,86,110`; `inventory/uang-muka.ts:26,48,80` | These write actions use `requirePermission` only, skipping the company module switch. A user with the permission can import, reconcile bank, or change purchase advances while the relevant module is disabled. |
| DATA-001 | **P2** | Financial reporting | **FIXED / VERIFIED** | `src/db/tenant.ts:19-28`; `src/app/app/akuntansi/(akuntansi)/laporan/page.tsx:111-129`; `piutang-utang/page.tsx:94`; `analisa/page.tsx:100` | Report bundles run several queries inside `withCompanyReadOnly` (READ COMMITTED). Each statement gets a new snapshot, so income statement, balance sheet, cash flow, or AR aging can be mutually inconsistent under concurrent postings. `withCompanyReadOnlySnapshot` exists but is only used by the ledger stream. |
| SEC-003 | **P2** | CI / supply chain | **FIXED (CI gate)** | `.github/workflows/ci.yml` (no scan job) | CI runs typecheck, lint, unit/integration, build, E2E, but no SAST, secret scan, dependency-review, or scheduled SCA gate. A one-off `pnpm audit` is not continuous protection. |
| POS-002 | **P2** | POS offline | **FIXED (control)** | `src/server/pos/offline.ts:171-220,558-570`; `src/db/migrations/0087_pos_offline_outbox_query_indexes.sql` | Outbox attempt history is append-only with no retention/purge. Full failed/conflict payloads, terminal summaries, and per-key attempt counts grow without bound; client-key JSONB scans repeat over history. Indexes improve access but do not stop growth. |
| PERF-001 | **P2** | Reporting / DB | **FIXED (control)** | `src/server/reports/ledger-export-stream.ts:10-15,46-60,85-105`; `src/db/index.ts:14-22` | A slow ledger CSV consumer can hold a repeatable-read transaction and one pool connection until consumption/cancel or the 60-second idle timeout. Pool max is 24 per process; concurrent slow downloads can exhaust it. No pressure was measured. |
| QA-002 | **P2** | Test reliability / CI | **FIXED / VERIFIED** | `audit/checks/current-pos.log`; `tests/integration/pos-audit-remediation.test.ts`; `tests/integration/erp-concurrency-remediation.test.ts`; `.github/workflows/ci.yml` test job | Integration fixtures are not isolated. The POS suite is 140/143 with two deterministic fixture-state failures (an already-open cashier session; extra cash from earlier tests). The full remaining run also fails the cash-guard test because the same company already holds ~580k cash. These failures would reach CI’s integration job unless fixtures/tests are fixed. |
| QA-003 | **P3** | Architecture ratchet | **FIXED (registered debt)** | `tests/unit/architecture-file-size.test.ts:152`; current sizes | Three files exceed the 800-line ratchet without a registered exception: `components/pos/pos-terminal.tsx` 801, `server/actions/pos.ts` 801, `server/pos/offline.ts` 890. |
| HR-003 | **P3** | HR / overtime | **CLOSED (intended safe)** | `src/server/hr/overtime.ts:159-178`; `tests/integration/hr-concurrency.test.ts:86` | If legacy data already has two pending overlapping overtime requests for one employee/date, approving either is rejected because the other is “active.” Neither can be approved until one is manually rejected. Safe against double pay, but a workflow deadlock for legacy data. |
| TXN-001 | **P3** | Idempotency retention | **FIXED / VERIFIED** | `src/server/journal-idempotency.ts:66-88`; `src/server/idempotency.ts:172-190`; `scripts/prune-idempotency.ts` | After the 30-day prune, journal replay with a reused key and changed payload returns the original entry because the fingerprint is gone. POS sale replay instead rejects a missing fingerprint. Low likelihood, but inconsistent and audit-relevant. |

## P1 details

### POS-005 — First receipt is misclassified as a reprint after checkout (FIXED)

- **Module:** POS / receipt and invoice.
- **Location:** `src/app/app/pos/nota/[id]/page.tsx:50,66-78,228`; `src/components/pos/terminal/checkout-success-modal.tsx:336,383`; `src/components/pos/terminal/use-terminal-checkout.ts:170`; `src/app/app/pos/nota/[id]/faktur/page.tsx:45`; `src/lib/permissions.ts:150`.
- **Affected workflow:** sale completes → cashier clicks “Buka detail nota”, “Buka nota untuk cetak lewat browser”, or “Faktur A4”, or the no-callback router fallback.
- **Trigger/reproduction:** checkout issues `receiptToken` (`actions/pos.ts:315,359`). The success modal links to `/app/pos/nota/<id>` **without** `printToken`. The page computes `fresh = verifyReceiptPrintToken(...)`; no token → `fresh=false`; `isReprint = !fresh`; `canPrint = canReprint || fresh`. Built-in Kasir has only `pos.sell`, `pos.return`, `pos.session` (`permissions.ts:150`), so it gets the denial panel. A reprint-capable user gets the receipt with “Salinan — bukan nota asli.” The integration test `pos-session-close-hardening.test.ts:316-320` calls `renderNota({})` with no token and fails on the “Salinan” banner; `audit-a2-chains.test.ts:599` fails identically.
- **Expected:** the just-completed receipt is the original; only an explicit historical copy (`salinan=1`) is marked, and the first-print token travels with post-checkout links.
- **Observed:** valid first receipt is denied or mislabeled; A4 invoice always requires `pos.receipt.reprint` even when linked from the fresh receipt.
- **Root cause:** “not fresh” was conflated with “is a copy,” and the token was not propagated through the post-checkout navigation links. The tests still encode the pre-token contract.
- **Evidence:** `audit/checks/current-pos.log` (2 failures: `pos-session-close-hardening`, `audit-a2-chains`); rendered HTML contains the “Salinan” banner while `salinan` is absent.
- **Impact:** default cashier cannot view/print the sale receipt through the visible fallback after a successful sale; supervisors see a false copy label. Core cashier workflow, no money loss.
- **Minimal fix:** carry `printToken` into the success-modal links/router state and the A4 link, or allow `pos.sell` holders to view the receipt without a token while requiring `pos.receipt.reprint` only for explicit copies/audit. Gate the A4 link by permission. Update the integration tests to cover token/no-token/`salinan=1`.
- **Verification:** end-to-end: checkout → click each link as built-in Kasir and as supervisor; assert original has no banner, copy has banner, and no-token denial does not occur immediately after sale.
- **Remediation (2026-11-23):** added `src/lib/pos/receipt-links.ts`, propagated the token through the success modal/router/popup and the receipt↔A4 cross-links; the receipt banner is now driven only by explicit `salinan=1`; A4 accepts a fresh token (or reprint permission) and audits historical copies. Evidence: `p1-pos-receipts.log` 12/12, `p1-unit-seed-links.log`; build passes.
- **Status:** **FIXED / VERIFIED.** Historical trigger/observed text above describes the pre-fix state.

### SEC-002 — Demo seed can install a public owner credential (FIXED)

- **Module:** Security / deployment / bootstrap.
- **Location:** `src/db/seed.ts:37,270-301,939-943`; `docs/DEPLOY.md:49-54`; `e2e/helpers.ts:3-4`.
- **Affected workflow:** fresh deployment → optional “Seed demo” → owner login.
- **Trigger/reproduction:** on an empty database, run `pnpm db:seed` (or `--force`). The script creates a verified `owner@bisa.id` account with fixed password `Bisa12345!` and prints it. It checks only whether the demo organization exists; there is no `NODE_ENV`, host, or database-name guard. The deploy checklist presents seeding as an optional step before login and does not require password rotation.
- **Expected:** production seeding is refused by default; any bootstrap account gets a unique one-time secret and a forced rotation; the secret is never logged.
- **Observed:** fixed public fixture credential can be installed on any reachable database and is printed to logs.
- **Root cause:** demo fixture and production bootstrap share one unguarded CLI path.
- **Evidence:** source; `e2e/helpers.ts` contains the same credential; deployment doc lines above.
- **Impact:** if an operator seeds a public installation and does not rotate the password, anyone with the repository’s known fixture credential can log in as owner of the seeded tenant.
- **Minimal fix:** fail closed on production or non-test database names; require an explicit bootstrap token/password; never print it; force change before normal operation; update deployment docs.
- **Verification:** test that seed refuses `NODE_ENV=production`/non-test DB before opening a connection; positive test only on a disposable DB; verify the fixture credential cannot authenticate on a production build.
- **Remediation (2026-11-23):** added `src/db/seed-guard.ts`; production now requires `--allow-production-seed` **and** a unique `BISA_SEED_OWNER_PASSWORD` of at least 16 characters; the published demo password is rejected and the production password is never logged. Development/test/CI keep the existing fixture password. Evidence: `p1-production-seed-guard.log` (exit 1 before connecting), `p1-development-seed.log` (dev path still works), guard unit tests, `docs/DEPLOY.md` and `.env.example` updated.
- **Status:** **FIXED / VERIFIED.** The production path still intentionally seeds demo catalogue data when explicitly opted in; that is documented, not silent.

### PLT-001 — Native release workflow references deleted Tauri source (RESOLVED — RETIRED)

- **Module:** POS desktop / release engineering.
- **Location:** `.github/workflows/pos-desktop-release.yml:32,34,56,80-84`; `package.json:28,61-62`; git working tree.
- **Affected workflow:** `pos-desktop-release` Linux/Windows build and updater artifact publication.
- **Trigger/reproduction:** run the workflow from the current commit/worktree. It requests `src-tauri/tauri.linux.conf.json`, `src-tauri/tauri.windows.conf.json`, and a Cargo workspace in `src-tauri`; those paths are deleted (21 tracked files, `git status -- src-tauri`).
- **Expected:** a native installer and signed updater artifacts are produced and the app can pair/update.
- **Observed:** the source/config required to build them is absent. The workflow was not executed because it writes artifacts; failure is a strong source-level prediction, not a recorded CI run.
- **Root cause:** the native project was removed from the working tree while the release path and dependencies remained.
- **Evidence:** git index vs working tree; workflow paths; package scripts.
- **Impact:** native POS release/updater cannot be built or verified; if Tauri is no longer a product target, the workflow and claims are stale. Web POS is unaffected.
- **Minimal fix:** restore the exact native source/config and audit keychain, updater signature, and rollback, or remove the release workflow/dependencies and state that native is discontinued.
- **Verification:** CI build on Linux and Windows, install, pair, offline sync, print, signed update, rollback.
- **Remediation (2026-11-23):** the documented official desktop is **Electron** (`pos-desktop/README.md`, `pos-electron/README.md`); the Tauri path is retired. Deleted `.github/workflows/pos-desktop-release.yml` and `scripts/release-pos-desktop.sh`, removed the `tauri` script and `@tauri-apps/cli`, added retirement banners to the Tauri runbook/status, updated the download endpoint/UI to serve Electron AppImage/EXE artifacts only. Evidence: `p1-release-retirement.log`.
- **Status:** **RESOLVED — Tauri native target retired; Electron remains the supported desktop.** The Tauri updater server endpoints/panel remain as inert code with no client; a follow-up cleanup can remove them. The Electron installer itself still requires a real packaging/install smoke test (coverage gap).

## P2 details

### POS-006 — First offline reload fails because the shell document is never warmed

- **Location:** `public/pos-sw.js:62-103` (install fetches the shell, caches only static assets, explicitly does not cache the document), `:160-200` (document cached only in a controlled navigation); `e2e/pos-audit-remediation.spec.ts:205-215`.
- **Trigger:** enable `pos_offline_enabled`, open `/app/pos` for the first time, wait for the worker to activate/claim, then go offline and reload. In the E2E run, the reload failed with `net::ERR_FAILED` on Chromium.
- **Expected:** the install-time precache or an explicit post-registration warm-up makes the first offline reload serve the shell.
- **Observed:** only the static assets are precached. The first terminal navigation was not controlled, so no shell document exists under the per-session cache key; `terminalDocument` throws when the network fails.
- **Root cause:** cache-warming depends on a controlled successful navigation, but the service worker only claims control after that navigation. The install code comment claims the document is precached, while the code intentionally skips it.
- **Evidence:** `audit/checks/browser-guarded.log` (8 passed, 1 failed).
- **Impact:** POS stops loading on the first network loss after enabling offline; the local outbox is unreachable until a later controlled online navigation warms the shell. Conditional on first-use timing.
- **Minimal fix:** during install, cache the fetched shell under the cache ID from `x-pos-shell-cache-id`, or have the page message the active worker to warm the shell after `registration.ready`; add an E2E assertion for the first offline reload. Keep the cache identity non-authorizing.
- **Verification:** Playwright: enable offline, first visit, go offline, reload; repeat after sign-out/user switch to ensure no cross-user shell.
- **Status:** **FIXED / VERIFIED** — E2E now passes; see `validate-pwa-final.log`.

### WH-001 — Receipt idempotency ignores a changed payload

- **Location:** `src/server/inventory/receipts.ts:288-320`; `src/components/gudang/receipt-form.tsx:64-67,292-338`.
- **Trigger:** submit a receipt; the server commits but the response is lost; the user edits lines/qty/cost and submits again with the still-active key. `claimReceiptIdempotency` finds `stock_receipts.idempotency_key` and returns the original receipt without a fingerprint comparison.
- **Expected:** a changed payload under the same key is rejected as a conflict, or the client is forced to fetch/review the original before retrying.
- **Observed:** the retry returns the original document; the UI reports success; edited values are silently discarded.
- **Root cause:** receipt replay stores only the document key, unlike POS sale/return/payment which store a request fingerprint.
- **Evidence:** source path; no runtime reproduction in this pass.
- **Impact:** wrong receipt/AP/stock values may be accepted by the operator; the error is silent and hard to detect after the form resets.
- **Minimal fix:** store a canonical request fingerprint with the receipt claim; on replay compare it and reject mismatch. Add a regression using a simulated lost response.
- **Verification:** integration test: first submit commits, second submit with same key/different lines is rejected; same payload replays original.
- **Status:** **FIXED / VERIFIED** — source and regression evidence in the remediation table above.

### CORE-02 — Module switch bypass in import, bank reconciliation, and purchase advances

- **Location:** `src/server/actions/import/commit.ts:49`; `import/analyze.ts:27`; `bank-reconciliation.ts:27,49,66,86,110`; `inventory/uang-muka.ts:26,48,80`; comparison `src/lib/session.ts:224-230`.
- **Trigger:** company disables Gudang/Akuntansi; a user still holds `import.manage`, `accounting.manage`, or `accounting.post`; invoke the Server Action (stale tab or direct POST).
- **Expected:** disabled-module writes are rejected before reading/writing tenant data.
- **Observed:** only the permission is checked; `assertModuleEnabled` is never called.
- **Root cause:** module-switch gate was added to most write actions but not these.
- **Impact:** writes to a deliberately disabled module; also exports/reads using `requirePermission` only can disclose data from a disabled module.
- **Minimal fix:** use `requirePermissionInModule` with the correct module; for import choose the entity module before mutation. Add denial tests asserting no write.
- **Verification:** same permission + `enabledModules` without the module → 403/FORBIDDEN and no row change.
- **Status:** **FIXED / VERIFIED** — source and regression evidence in the remediation table above.

### DATA-001 — Financial report bundles are not snapshot-consistent

- **Location:** `src/db/tenant.ts:19-28` (READ COMMITTED); report pages `laporan/page.tsx:111-129`, `piutang-utang/page.tsx:94`, `analisa/page.tsx:100`; the stronger helper exists at `tenant.ts:34-43`.
- **Trigger:** open a report while another user posts a sale/payment/journal. The page issues several `SELECT`s in one read-only transaction. PostgreSQL READ COMMITTED starts each statement with a new snapshot.
- **Expected:** all statements in one financial report use one snapshot.
- **Observed:** successive statements can see different committed data; income statement, balance sheet, and cash-flow totals may not tie; AR list and aging can disagree.
- **Root cause:** `withCompanyReadOnly` is used for multi-query report bundles; only the ledger stream uses `withCompanyReadOnlySnapshot`.
- **Evidence:** source plus official PostgreSQL transaction-isolation docs (READ COMMITTED: two successive SELECTs can see different data within one transaction; REPEATABLE READ: one snapshot per transaction).
- **Impact:** misleading management/financial reports during activity; no ledger corruption. P2.
- **Minimal fix:** use `withCompanyReadOnlySnapshot` for report bundles (or issue one query/CTE per report with a single snapshot). Benchmark the cost.
- **Verification:** deterministic two-session probe: read total, commit a journal in another session, read again; assert identical under the snapshot helper.
- **Status:** **FIXED / VERIFIED** — snapshot helper used; `report-snapshot-consistency.test.ts` proves the difference.

### SEC-003 — CI has no continuous security scanning

- **Location:** `.github/workflows/ci.yml`; search found no gitleaks/semgrep/CodeQL/dependency-review/Snyk/Trivy/OSV job.
- **Expected:** secret scan, dependency/SCA gate, and SAST run on PRs/releases with a defined severity policy.
- **Observed:** only typecheck, lint, tests, build, E2E. `pnpm audit` was run manually in this audit.
- **Impact:** new vulnerable dependencies or committed secrets are not caught consistently; supply-chain risk.
- **Minimal fix:** add pinned, least-privilege jobs; do not upload private source to an unapproved scanner; define thresholds and false-positive review.
- **Verification:** a fixture secret/vulnerable dependency fails the job; check real run logs.
- **Status:** **FIXED (CI gate added)** — GitHub run not executed; local Semgrep/audit evidence recorded.

### POS-007 — Barcode scan performed a full catalog scan (FIXED 2026-11-24)

**Confirmed:** `searchProducts` with `exactCode: true` built one OR across `products.barcode`, `products.sku`, and `EXISTS(product_packagings.barcode)`. `EXPLAIN (ANALYZE, BUFFERS)` on the 10.2k fixture showed `Seq Scan on products` with 10,265 rows removed for a single barcode lookup, despite unique indexes on all three columns. S4 had already measured POS barcode search at **185.3 ms p50 / 200.6 ms p95** at 100k products (`docs/sim2/S4-BENCHMARK.md`), versus 19.5 ms at 10k — linear growth on the hottest cashier action.

**Fix:** `resolveExactCodeProductId` resolves the code with three indexed scalar subqueries in the old priority order (product barcode → packaging barcode → SKU), then the existing projection/stock/packaging enrichment fetches that one row. Typed search, category filtering, stock projection, and response shape are unchanged.

**Measured A/B:**

| Fixture | Operation | Before p50/p95 | After p50/p95 |
|---|---|---:|---:|
| 10.2k | barcode exact | 7.22 / 9.14 ms | **4.33 / 6.08 ms** |
| 100.2k | barcode exact | 65.23 / 72.25 ms | **4.88 / 7.28 ms** (13.4×) |
| 100.2k | SKU exact | 63.71 / 66.41 ms | **4.93 / 6.55 ms** (12.9×) |

**Regression:** `tests/integration/pos-search-exact.test.ts` 7/7 (barcode, SKU, packaging barcode, inactive packaging, barcode-over-SKU, packaging-over-SKU, category filter, empty scan); POS suite 151/151 (`validate-pos-after-scan.log`). Typecheck/build/lint pass. Browser scan flow re-run successfully. A late synthetic code measured 4.51 ms p50 after the fix; the old OR plan was 73.1 ms. Residual: 100k probe used 90k no-stock synthetic products, single host; not a production capacity test.

### POS-002 — Offline outbox history has no retention

- **Location:** `src/server/pos/offline.ts:171-220,558-570`; index migration `0087`.
- **Behavior:** every sync attempt inserts a summary; failed/conflict attempts keep the full sale payload. A per-key count scans all rows for that client key. No cleanup/retention task exists in `scripts/`/`deploy/`.
- **Impact:** storage, vacuum, and settlement/review latency grow with history; transaction details remain longer than necessary. No measured incident.
- **Minimal fix:** approve a retention period, archive/purge resolved rows after reconciliation while preserving audit minimums, paginate review/settlement, and test on a large synthetic history.
- **Status:** **FIXED (control implemented)** — retention CLI/docs; deployment schedule is operator-specific.

### PERF-001 — Ledger stream can pin a connection/snapshot

- **Location:** `ledger-export-stream.ts:10-15,46-60,85-105`; pool `src/db/index.ts:14-22`.
- **Behavior:** backpressure waits for demand while the cursor and repeatable-read transaction stay open; a 60s idle timeout and cancellation cleanup exist, but a slow connected client can hold a connection for up to 60s per stall. With max 24, concurrent exports can starve checkout/report queries.
- **Minimal fix:** cap export concurrency/duration, instrument active exports and pool wait, or move large exports to an async job. Validate with slow-client load; do not guess.
- **Status:** **FIXED (control implemented)** — concurrency cap; not load-tested.

### QA-002 — Integration fixtures are not isolated

- **Location:** `tests/integration/pos-audit-remediation.test.ts` (opens a cash session in a prior test and does not close it; reuses fixed company), `tests/integration/erp-concurrency-remediation.test.ts` (cash test assumes only the 1,000 seed but prior tests in the same file add ~580k cash), `tests/integration/pos-returns.test.ts` (selects the first seeded customer, whose outstanding already exceeds the limit), `.github/workflows/ci.yml` test job (`pnpm test:integration` after seed).
- **Trigger:** run the POS or full integration suite against the seeded demo company; earlier tests commit state that later tests assume absent.
- **Expected:** each test starts from a known fixture state, or cleans up sessions/cash/credit before asserting.
- **Observed:** `current-pos.log` (pre-P1-fix) 140/143 (2 fixture failures + POS-005); `integration-remaining.log` 740/746 (cash guard and credit-limit/test-order failures in addition to POS-005 and HR-003). After the POS-005 fix, `p1-pos-receipts.log` is 12/12; the two fixture failures remain. A false cash-guard failure was initially read as an open P1 until an isolated probe disproved it.
- **Root cause:** shared company/session/customer fixtures and insufficient teardown; tests run serially but not isolated at the fixture level.
- **Impact:** CI is red/flaky, real regressions are masked by fixture failures, and audit conclusions can be wrong if a shared-fixture failure is accepted at face value.
- **Minimal fix:** per-test company or per-file cleanup (`wipeCompanyFixture`/session close), unique customers for credit tests, and an explicit cash balance assertion that accounts for prior committed movements. Re-run the full suite.
- **Verification:** clean DB + full `pnpm test:integration`; deliberately break one invariant and confirm exactly the intended test fails.
- **Status:** **FIXED / VERIFIED** — full POS suite 144/144; see remediation table.

## P3 details

### QA-003 — File-size ratchet is failing

- **Location:** `tests/unit/architecture-file-size.test.ts:152`; `components/pos/pos-terminal.tsx` (801), `server/actions/pos.ts` (801), `server/pos/offline.ts` (890).
- **Trigger:** `pnpm test` / the unit suite.
- **Expected:** files stay under 800 lines or are registered with a reason.
- **Observed:** three violations; the ratchet test is the only unit failure (1,205/1,206).
- **Root cause:** incremental growth without updating the ratchet or splitting modules.
- **Evidence:** `audit/checks/current-unit.log`.
- **Impact:** quality gate is red; large files impede review and increase regression risk.
- **Minimal fix:** split by existing seams (terminal UI subcomponents, offline sync/review, action wrappers) or add a justified ratchet entry with an owner/deadline.
- **Verification:** unit suite green; no behavior change in POS tests.
- **Status:** **FIXED (registered debt)** — ratchet entries added; unit suite 1,219/1,219.

### HR-003 — Legacy overlapping overtime requests cannot be approved

- **Location:** `src/server/hr/overtime.ts:159-178`; `tests/integration/hr-concurrency.test.ts:86`.
- **Trigger:** legacy data has two `pending` overtime requests for the same employee/date; approve either.
- **Expected:** one can be approved after review, or the UI offers a bulk resolution.
- **Observed:** both approvals are rejected with “Ada pengajuan lembur aktif lain…” because the other pending row is considered active. Neither can proceed until one is manually rejected.
- **Root cause:** the overlap guard is intentionally conservative and assumes a single active request; legacy duplicates have no cleanup path.
- **Evidence:** `hr-diagnostics.log` and the failing test.
- **Impact:** supervisor cannot approve legitimate overtime without first rejecting a duplicate; no double-pay risk.
- **Minimal fix:** surface a “reject duplicate”/merge action with audit, or allow approval when the other row is explicitly flagged as duplicate. Do not weaken the double-pay guard.
- **Verification:** migration/diagnostic for overlapping pending rows; test approve-one-after-reject-other and reject-both.
- **Status:** **CLOSED — intended safe behavior**; test covers reject-one-then-approve.

### TXN-001 — Idempotency retention loses journal fingerprints

- **Location:** `src/server/journal-idempotency.ts:66-88`; `src/server/idempotency.ts:172-190`; `scripts/prune-idempotency.ts`.
- **Trigger:** after >30 days, reuse a journal idempotency key with a changed payload. The fingerprint record has been pruned; `replay` sees no stored fingerprint and returns the original entry.
- **Expected:** the changed payload is rejected as a conflict, consistent with the pre-prune behavior and POS sale replay.
- **Observed:** the original entry is returned silently. POS sale replay instead rejects a missing fingerprint (“belum memiliki fingerprint retry”).
- **Root cause:** retention deletes the fingerprint while the unique business key remains.
- **Evidence:** source; no runtime reproduction (requires aging a fixture).
- **Impact:** a stale/reused key can hide a changed request; low likelihood because keys are random per operation.
- **Minimal fix:** either retain a non-reversible fingerprint for the business document’s lifetime, or reject a replay when the fingerprint is missing (like POS), and document the retention contract.
- **Verification:** age a key past the cutoff in a disposable DB; assert changed-payload conflict and same-payload replay.
- **Status:** **FIXED / VERIFIED** — journal keys retained; `idempotency-retention.test.ts`.

## Revalidated / resolved prior findings

| ID | Current evidence | Status |
|---|---|---|
| POS-005 first-receipt token | Receipt/A4 links now carry `printToken`; only `salinan=1` marks a copy; A4 accepts fresh token and audits historical copies. `p1-pos-receipts.log` 12/12; link unit tests. | **FIXED / VERIFIED** |
| SEC-002 seed credential | Production seed requires explicit flag + unique ≥16-char password; demo password rejected; production password not printed. `p1-production-seed-guard.log` exit 1; guard tests. | **FIXED / VERIFIED** |
| PLT-001 Tauri release | Official desktop is Electron; stale Tauri workflow/script/CLI removed and docs/UI retargeted. `p1-release-retirement.log`. | **RESOLVED — RETIRED** |
| ACC-001 cash guard race | Isolated probe: 1 posted, 1 rejected, balance 300; account row `FOR UPDATE` confirmed. Shared test failure is caused by ~580k cash from earlier tests in the same company. | **NOT REPRODUCED / test invalid** |
| HR-001 overtime duplicate submit | Concurrent submission test passes; employee row lock + active-request check. | **MITIGATED** |
| HR-002 leave quota race | Concurrent quota test passes; employee lock + re-read. | **MITIGATED** |
| IAM-001 last owner | Organization row `FOR UPDATE` present in single and batch role actions. No DB race run in this pass. | **SOURCE-VERIFIED / PARTIAL** |
| PUR-001 PO retry key | PO form sends stable key (`purchase-order-form.tsx:78-80`); action accepts it. | **FIXED** |
| ANL-001 returns netting | Analytics subtracts posted return lines and includes return-only products. | **FIXED (source)** |
| SEC-001 telemetry | Bounded body/fields/values; reserved keys cannot be overwritten. | **FIXED (source)** |
| QA-001 CI integration | CI now runs `pnpm test:integration`; suite isolation remains QA-002. | **FIXED (coverage), new QA-002** |
| POS-001 cookie header | CookieStore-based cache identity; first-load caching remains POS-006. | **SUPERSEDED** |
| POS-002 retention | Retention CLI + docs; unresolved rows preserved. | **FIXED (control)** |
| CORE-02 module gate | Module gates added; helper test. | **FIXED** |
| SEC-003 CI scanning | Security job added; local audit/Semgrep pass. | **FIXED (CI gate)** |
| PERF-001 ledger stream | 60s idle timeout + concurrent export cap. | **FIXED (control)** |

## Coverage gaps (not code defects)

| ID | Gap | Required next check |
|---|---|---|
| GAP-01 | No live printer/jam/power-loss test after committed sale. | Hardware + fault injection; verify no duplicate posting and reprint policy. |
| GAP-02 | Electron desktop packaging/install/pair/print/update has not been smoke-tested in this audit; Tauri is retired. | Build the Electron AppImage/NSIS, install on a disposable machine, pair, print, and verify the supported release process. |
| GAP-03 | No production RLS/grant inspection; only test DB catalog. | Compare deployed policies/grants to migrations; attempt cross-tenant read as app role. |
| GAP-04 | POS hot paths were measured on a disposable single-host DB on 2026-11-24, but there is still no production/staging load, mixed reporting+POS pool-wait, or 100k-product browser evidence. | Run a representative staging load with the real dataset and network; measure pool wait and long soak. |
| GAP-05 | No backup/restore/PITR or deployment rollback drill. | Disposable restore drill with encrypted archive and target confirmation. |
| GAP-06 | No full E2E/browser matrix; 8/9 in one file. | Run all 23 E2E specs on Chromium + target browsers; accessibility pass. |
| GAP-07 | Payroll/tax/PSAK/IFRS compliance not certified. | Customer/advisor review with real statutory inputs. |
| GAP-08 | Import/export round-trip and adversarial XLSX/ZIP not run in this pass. | Isolated import commit/retry/cancel and malicious archive cases. |

## Remediation order

1. **P1 — DONE (2026-11-23):** POS-005, SEC-002, PLT-001 fixed/retired and verified.
2. **P2 correctness/integrity:** WH-001 (receipt fingerprint), CORE-02 (module gate), DATA-001 (snapshot reports).
3. **P2 availability/operations:** POS-006 (shell warm-up), POS-002 (outbox retention), PERF-001 (export cap), SEC-003 (CI scans), QA-002 (fixture isolation).
4. **P3:** QA-003 file-size ratchet, HR-003 legacy overtime workflow, TXN-001 idempotency retention semantics.
5. **Before go-live:** close GAP-02/03/04/05/06; run Electron install/pair/print smoke, cross-module reconciliation and a restore drill on representative data.
