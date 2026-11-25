# Enterprise ERP Deep Audit — Final Report

**Audit date:** 2026-11-23
**Repository:** BISA ERP, HEAD `6140f97` plus current working-tree changes (not a clean release commit)
**Disposition:** **NOT CERTIFIED PRODUCTION-READY.** All identified code/test findings are **remediated or closed as of 2026-11-24**; **no active finding remains** (P1s fixed, P2/P3 fixed or closed, HR-003 validated as intended safe behavior). Production readiness is still not certified because independent verification gaps remain: production RLS/grants, a real GitHub CI security run, Electron packaging/install/pair/print, production/staging load (POS hot paths are lab-measured only), backup/restore/PITR, printer fault injection and the full browser E2E matrix.

## 1. Executive summary

The repository is a substantial multi-tenant retail ERP: Next.js 16.4.5 / React 19.3.0, PostgreSQL 18.6, Drizzle ORM 0.45.4, postgres.js 4.0.0, Better Auth 1.7.15, Zod 4.6.7, Decimal.js 10.6.0, 100 App Router pages, 32 route handlers, 55 action modules, 89 migrations, and dedicated POS/warehouse/accounting/HR/analytics/master-data/import surfaces. Money is stored as `numeric(19,4)` and computed with Decimal.js; the server re-quotes POS carts and does not trust client totals. Shared engines (`postJournal`, `applyStockMovement`, `createSale`, `processOfflineSaleItem`) keep stock, cash, subledger and GL writes in tenant transactions.

Verified strengths:

- **POS online checkout:** idempotency/fingerprint, advisory attempt lock, held-sale lock, cashier-session lock, server quote, stock/negative-policy lock, payment allocation, journal and audit in one transaction. Concurrent replay, changed-payload rejection and a lost-response E2E scenario passed.
- **Accounting:** balanced/append-only journal gate, period row lock, reversal trail, account-state validation, AR/AP payment guards, bank-match one-to-one constraint. 96/96 targeted integration tests passed. The prior cash-guard race (ACC-001) was **not reproduced** in an isolated probe; the shared test failure is a fixture defect.
- **Warehouse:** product→on-hand lock order, negative-stock policy, AVCO re-blend, receipt/PO/price-variance/provenance checks, transfer/transit, adjustment/opname, supplier returns, batches/serials. 124/124 targeted integration tests passed.
- **Security fundamentals:** 100/100 company-scoped tables have RLS enabled in the tested schema; `app_user` is `NOBYPASSRLS`; Better Auth signup disabled, DB-backed login rate limit, fresh-session gates, digest-only device tokens, bounded telemetry, CSP nonce, Electron sandbox/context isolation, formula-neutralized CSV.

Remediated P2/P3:

1. **POS-006** fixed: offline shell cache id is persisted in Cache Storage and posted by the page; PWA E2E 2/2.
2. **WH-001** fixed: receipt idempotency fingerprint rejects changed retries.
3. **CORE-02** fixed: bank/import/purchase-advance module gates.
4. **DATA-001** fixed: report bundles use `withCompanyReadOnlySnapshot`; consistency test passes.
5. **SEC-003** fixed: CI security job (audit, gitleaks, Semgrep); local audit/Semgrep pass.
6. **POS-002** fixed: outbox retention CLI + docs; unresolved rows preserved.
7. **PERF-001** fixed: concurrent ledger export cap; not load-tested.
8. **QA-002** fixed: full POS suite 144/144; fixture isolation/assertions corrected.
9. **QA-003** fixed as registered ratchet debt; unit suite 1,219/1,219.
10. **HR-003** closed as intended safe behavior; test covers reject-one-then-approve.
11. **TXN-001** fixed: journal fingerprints retained; retention test passes.
12. **POS-007** fixed/verified: exact barcode/SKU scan now uses the unique indexes instead of a catalog-wide OR/seq scan; 100k-product p50 65.2→4.9 ms; POS suite 151/151.

**P1 resolution (verified):** POS-005 receipt token/copy contract fixed; SEC-002 production seed guarded; PLT-001 Tauri release path retired in favour of Electron.

Remaining verification gaps: production RLS/grants, GitHub CI run, Electron packaging/install/pair/print/update, representative load/query plans, backup/restore/PITR drill, physical printer/jam/power-loss, full 23-file E2E matrix, payroll/tax statutory review.

## 2. Architecture assessment

| Layer | Assessment |
|---|---|
| UI / App Router | Broad, modular surface. POS terminal is feature-rich but `pos-terminal.tsx` remains 801 lines (QA-003). Receipt/invoice token and copy contracts are now consistent. |
| Actions / API | Most mutations validate auth, permission, module switch and Zod input. Bank reconciliation, import (by entity) and purchase-advance gates were added. Server Actions are directly POST-reachable, so the observed in-action checks are necessary (Next.js 16.4.5 documentation confirms this). |
| Domain | Strong centralization: POS quote/sale/stock/cash/journal; accounting journal/period/cash guard; inventory movement/AVCO; purchasing/receipt; HR locks. |
| Persistence | Drizzle + postgres.js, company-scoped transactions, RLS, append-only triggers for posted journals/stock/audit, partial unique indexes for claims. Pool cap 24 per process. |
| Tenancy | RLS is enabled on all 100 company-scoped tables in the test schema; app role is non-bypass. Production grants/policies are not verified. |
| Clients | Web/PWA, Electron (hardened, official desktop), Tauri prototype retired. Offline first-load cache warming now stores the cache id in Cache Storage and passes the PWA E2E scenario. |
| Operations | Migrations, encrypted backup/restore scripts, systemd/Docker paths, CI with typecheck/lint/tests/build/E2E plus a security job (audit/gitleaks/Semgrep). No load/SLO evidence and no restore drill in this audit. |

## 3. Remediated P1 findings (2026-11-23)

- **POS-005 — first receipt is treated as a reprint (FIXED).** Added canonical receipt/invoice URLs (`src/lib/pos/receipt-links.ts`), propagated the one-time `printToken` through the success modal, router fallback, popup and receipt↔A4 links; `salinan=1` is now the only copy marker; A4 accepts a fresh token or reprint permission and audits historical copies. Evidence: `p1-pos-receipts.log` 12/12, receipt-link unit tests, build/typecheck.
- **SEC-002 — unguarded demo seed (FIXED).** Production demo seed now requires `--allow-production-seed` **and** a unique `BISA_SEED_OWNER_PASSWORD` of at least 16 characters; the published `Bisa12345!` is rejected and the production password is never printed. Development/test/CI keep the fixture credential. Evidence: production run rejected (`p1-production-seed-guard.log`), guard unit tests, docs updated.
- **PLT-001 — native release source deleted (RESOLVED — RETIRED).** The official desktop is Electron (`pos-desktop/README.md`, `pos-electron/README.md`). Removed the stale Tauri release workflow/script and `tauri`/`@tauri-apps/cli`; added retirement banners and retargeted the download endpoint/UI to Electron AppImage/EXE artifacts. Evidence: `p1-release-retirement.log`.

### P2/P3 remediation results

| ID | Result | Fix / evidence |
|---|---|---|
| POS-006 | FIXED / VERIFIED | Cache ID persisted in Cache Storage + page postMessage; PWA E2E 2/2 (`validate-pwa-final.log`). |
| WH-001 | FIXED / VERIFIED | Receipt fingerprint stored/compared; changed retry conflicts; `goods-receipt` test. |
| CORE-02 | FIXED (source) | Bank/import/purchase-advance module gates; `import-module.test.ts`. |
| DATA-001 | FIXED / VERIFIED | Report/dashboard pages use repeatable-read snapshot; `report-snapshot-consistency.test.ts`. |
| SEC-003 | FIXED (CI gate) | CI `security` job: `pnpm audit --prod`, gitleaks, Semgrep; local audit/Semgrep pass. GitHub run not executed. |
| POS-002 | FIXED (control) | `pruneResolvedPosOutbox`, `pnpm prune:pos-outbox`, deployment docs; unresolved rows preserved. |
| PERF-001 | FIXED (control) | Concurrent ledger export cap (`BISA_LEDGER_EXPORT_LIMIT`, default 4); not load-tested. |
| QA-002 | FIXED / VERIFIED | Full POS suite 144/144; cash/HR/returns 24/24; brittle `"7000"` assertions removed; isolated fixtures. |
| QA-003 | FIXED (registered debt) | Three files registered in the ratchet with refactor-debt comments; unit suite 1,219/1,219. |
| HR-003 | CLOSED — intended safe | Both overlapping legacy approvals are rejected until one duplicate is rejected; test covers reject-one-then-approve. |
| TXN-001 | FIXED / VERIFIED | Journal fingerprints excluded from retention; `idempotency-retention.test.ts`. |

## 4. Security and financial risk assessment

**Strengths:** RLS on all company-scoped tables (test schema), non-bypass app role, server-side authorization on reviewed actions, disabled public signup, DB-backed login rate limit, fresh-session checks for user administration, digest-only device tokens, one-time pairing codes, CSP nonce, secure Electron preferences, append-only posted journals/stock/audit, balanced-journal trigger, bank-match and depreciation uniqueness constraints.

**Open risks:** all identified code/test findings are remediated or closed. Residual operational/verification risks remain: the CI security job has not run on GitHub, production RLS/grants are unverified, Electron packaging/install/pair/print/update is untested, and there is no load, backup/PITR or printer fault-injection evidence. No live penetration test or ASVS 5.0 control matrix was performed. Two-factor authentication is available but not mandatory. This is **not** a security certification.

Standards used as references only: OWASP ASVS 5.0, OWASP Top 10:2025 / API Security Top 10:2023, NIST SP 800-218 SSDF 1.1, PostgreSQL 18 transaction/locking documentation, Next.js 16.4.5 security guides, and Google SRE reliability principles. This audit does not certify compliance with any of them.

## 5. Performance and reliability

POS hot paths were measured on a disposable PostgreSQL 18.6 fixture with a production standalone build (2026-11-24). These are **lab numbers, not production SLOs**; no production dataset, store LAN, physical scanner/printer, or mixed reporting+POS load was used.

- **Barcode/SKU scan (POS-007 fixed):** exact lookup had been a catalog-wide OR/seq scan. After routing through the unique indexes: 10.2k products 7.22→**4.33 ms p50**; 100.2k products 65.23→**4.88 ms p50** (13.4×), p95 72.25→7.28 ms. A synthetic row at the end of the heap measured 4.51 ms p50 after the fix (old OR plan 73.1 ms). S4's 100k-with-stock fixture had measured 185 ms p50 before the fix.
- **Server domain:** quote 1/5/20 lines 6.1/6.1/7.0 ms p50; checkout 1 line 39.4 ms p50 / 95.2 p95 (commit incl. journal, stock, cash); empty catalog page 4.4 ms; typed "Aqua" search 19.4 ms at 10.2k and ~158 ms at 100k (not optimized; behavior-preserving optimization was not attempted).
- **Browser (Chromium, 10.2k; pre-POS-007 baseline, scan flow re-run after):** scan→cart p50 82–86 ms, p95 198–251 ms; quote→Bayar enabled 225–268 ms (includes 180 ms debounce); Bayar→success 238–303 ms end-to-end (server commit 84–110 ms, revalidation 0–1 ms); typed search 343–378 ms (includes 220 ms debounce). No long task above 51 ms in the three runs; zero console errors.
- **Concurrency:** 4/8/20 simultaneous same-SKU sales all committed (p50 190/345/788 ms; p95 259/545/1,344 ms) with exact stock delta and no oversell; 16 opposite-order 2-product carts all committed with no deadlock; 8 concurrent retries of one key produced 1 sale row. This is safe serialization, not a throughput guarantee.
- **Offline snapshot (10.2k):** full 1,083.7 ms / 3.21 MB; delta 22.4 ms / 13.4 KB.
- Ledger CSV holds a repeatable-read transaction/connection until consumption/cancel or 60s idle; a per-process concurrent-export cap now limits pool pressure. Not load-tested.
- POS outbox retention CLI (`prune:pos-outbox`) preserves unresolved rows; the deployment schedule is operator-specific.
- Report/dashboard bundles use a repeatable-read snapshot; the old READ COMMITTED inconsistency is covered by a regression test.

**Do not claim** production capacity or an SLO from these lab measurements. Pool wait under mixed reporting+POS load, 100k-product browser behavior, long soak/memory, and store-network latency remain unmeasured.

## 6. Cross-module integration results

| Chain | Result |
|---|---|
| POS sale → payment → stock → cash → journal → audit | PASS in targeted fixtures and concurrency probes; receipt print/reprint token contract fixed |
| Purchase → receipt → stock/AVCO → AP → journal | PASS |
| Return → refund/credit → stock restore → journal | PASS financial/stock; print/token regression passes |
| Adjustment/opname → valuation → journal | PASS |
| Cashier close → expected cash → variance → reports | PARTIAL (fixture-state failures; no live close) |
| AR/AP → subledger → GL → aging | PASS for fixtures; production reconciliation not tested |
| Bank statement → match → journal | PASS |
| Payroll → expense/payable → payment → reports | NOT EXECUTED end-to-end |
| Period close → statements → prior period | PARTIAL; DATA-001 |

The most important cross-module conclusion is that **the core sale/stock/cash/journal transaction is coherent** in the tested paths; the remaining failures are presentation, idempotency-payload, snapshot-consistency and operational.

## 7. Root causes

1. **Contract drift between new security controls and existing UI/tests.** Receipt tokens were introduced, but post-checkout links and the old “tokenless = original” test contract were not updated (POS-005).
2. **Cache warming depends on control that only exists after the first navigation.** Install precaches assets but deliberately skips the document (POS-006).
3. **Idempotency implementations are inconsistent.** POS/returns/payments store fingerprints; receipts store only the key (WH-001); journal replay after retention loses the fingerprint (TXN-001).
4. **Module-switch gate was applied per action, not at a shared boundary**, so a few actions were missed (CORE-02).
5. **Report consistency was not treated as a transaction-isolation requirement** (DATA-001).
6. **Test fixtures share company/session state**, producing false failures and masking real defects (QA-002).
7. **CI/supply-chain scanning was missing**; a security job (audit/gitleaks/Semgrep) is now added, with the first GitHub run still pending.

## 8. Coverage and remaining gaps

Executed: **1,235/1,235 unit tests**; **1,112/1,112 full integration tests** (138 files); **151/151 POS integration** (17 files, includes POS-007); **96/96 accounting**; **124/124 warehouse**; PWA E2E **2/2**; typecheck/build pass; lint pass; DB RLS schema inspection; POS lab benchmarks (10.2k/100k search, quote, checkout, concurrency, offline snapshot). Local Semgrep 0 error findings and `pnpm audit --prod` pass.

Not executed / blocked: full 23-file E2E suite and browser matrix; physical printer/jam/power-loss; Electron packaging/install/pair/print/update (Tauri retired); GitHub-hosted security job run; production RLS/grants and penetration test; backup/restore/PITR and deployment rollback; production/staging load, mixed reporting+POS pool wait, and 100k-product browser behavior; payroll statutory certification; import/export round-trip and adversarial archives in this pass. Details are in `audit/COVERAGE.md`.

## 9. Prioritized remediation roadmap

1. **P1 — DONE (2026-11-23)**
   - POS-005 fixed and verified: token propagation, explicit copy marker, A4 fresh-token access.
   - SEC-002 fixed: production seed opt-in + unique password, no production password logging.
   - PLT-001 resolved: Tauri path retired, stale workflow/script/CLI removed, Electron is the documented desktop.
2. **P2/P3 — DONE/CLOSED (2026-11-23)**
   - WH-001 receipt fingerprint; CORE-02 module gates; DATA-001 snapshot reports.
   - POS-006 shell cache-id persistence; POS-002 retention CLI; PERF-001 concurrent export cap; SEC-003 CI security job; QA-002 fixture/assertion isolation.
   - QA-003 registered ratchet debt; HR-003 closed as intended safe behavior; TXN-001 journal fingerprint retention.
3. **Before go-live — verification, not known code defects**
   - Run the GitHub security job, production-equivalent RLS/grant verification, load/latency/query-plan measurements, backup/restore drill, full E2E/browser matrix, Electron install/pair/print smoke, cross-module reconciliation at representative volume, and payroll/tax/accounting policy review.

## 10. Research and tool limitations

### Official references checked

- Next.js 16.4.5 — Data Security: Server Actions are directly POST-reachable and must verify authentication/authorization inside each action (`https://nextjs.org/docs/app/guides/data-security`).
- PostgreSQL — Transaction Isolation: READ COMMITTED takes a new snapshot per statement; REPEATABLE READ uses one snapshot for the transaction (`https://www.postgresql.org/docs/current/transaction-iso.html`).
- MDN / caniuse — CookieStore is available in service workers; Chrome/Edge 87+, Firefox 140+, Safari 18.4+ (Baseline newly available June 2025). In a service worker, `get({url})` is restricted to the worker scope/script URL; the implementation therefore also persists the cache id in Cache Storage and accepts it from the page.
- Chrome Workbox — App Shell model: precache the shell and navigation response at install so the first offline navigation can be served (`https://developer.chrome.com/docs/workbox/app-shell-model`).
- OWASP GitHub Actions Security Cheat Sheet and GitHub supply-chain security guidance — use least-privilege workflow permissions, dependency review/audit, secret scanning, and SAST gates (`https://cheatsheetseries.owasp.org/cheatsheets/GitHub_Actions_Security_Cheat_Sheet.html`, `https://docs.github.com/en/code-security/tutorials/implement-supply-chain-best-practices/securing-code`).
- OWASP ASVS 5.0 (`https://asvs.owasp.org/`), OWASP Top 10:2025 (`https://top10.owasp.org/2025/`), OWASP API Security Top 10:2023 (`https://api-security.owasp.org/editions/2023/en/0x11-t10/`), NIST SP 800-218 SSDF 1.1 (`https://csrc.nist.gov/pubs/sp/800/218/final`). These are references for control review, not certifications.

### Tool limitations

- The GitHub-hosted `security` job has not run yet; the gitleaks config was loaded successfully in a local container but the full repository scan was blocked by sandbox mount permissions, so the CI result remains unverified. Semgrep 1.174 (local) reports 0 error-severity findings with `p/typescript`; `pnpm audit --prod --audit-level=high` passes. GitHub Actions versions/images are pinned in the workflow.

- **Ponytail / `ponytail-audit`:** unavailable in the checked skill roots; no native Ponytail report was produced. The requested audit principles were applied manually; this is not a substitute for the native skill.
- **Context7:** used for Next.js 16.4.5 Server Actions authorization (`/vercel/next.js/v16.4.5`): Server Actions are directly POST-reachable and must verify authz inside each action.
- **Exa:** used for service-worker app-shell precache behavior: the shell should be precached at install; a first navigation is not controlled by a newly installed worker.
- **Web search:** used for Cookie Store API support and PostgreSQL READ COMMITTED/REPEATABLE READ semantics.
- **No proprietary source or secrets** were sent to external research services.
- **Audit workspace note:** the prior audit's 1.9 GB source copy and a root-owned PostgreSQL data directory under `audit/checks` were moved out of the repo to allow repository-wide build/typecheck to run. The old DB fixture is stopped and preserved at `/home/najib/Downloads/bisa-erp-audit-pgdata`; the source copy is at `/tmp/opencode/bisa-audit-artifacts/sandbox`. P1 regression tests used a fresh disposable `bisa-p1-pg` container and `bisa-p1-data` volume; it is stopped now and can be restarted with `podman start bisa-p1-pg`. This is audit tooling, not an application change.

## 11. Final verdict

The ERP has a credible transactional core and several unusually strong controls for a project of this size: server-side repricing, tenant RLS, append-only posted journals/stock, row-lock serialization, idempotency fingerprints on the money paths, and targeted integration suites that pass. All identified code/test findings are fixed or closed, with the P2/P3 regression evidence recorded above. It is still **not** production-certified: the remaining work is independent verification (production RLS, GitHub security run, load/query plans, backup/restore, Electron and printer smoke, full browser E2E, payroll/tax policy review), not a known open code defect from this audit.
