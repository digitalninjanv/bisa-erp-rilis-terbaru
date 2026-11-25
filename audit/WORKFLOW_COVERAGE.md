# Workflow Coverage and Verification Matrix

> **Superseded for current status by [COVERAGE.md](COVERAGE.md) (2026-11-23).** This file records the earlier source-trace phase when the integration DB was still blocked. Accounting (96/96), warehouse (124/124), POS (144/144) and the full integration suite (1,112/1,112) have since passed. Keep this file for the original workflow map, not as the current pass/fail record.

## Status definitions

- **Source-traced:** relevant current code path inspected end-to-end at the main server/domain boundary; not a claim of successful runtime behavior.
- **Unit-verified:** only the named pure/unit suite was executed; it does not establish DB transaction behavior.
- **Integration present / blocked:** repository contains relevant DB tests, but this audit did not execute them because the isolated DB guard was unsatisfied.
- **Partial:** useful source evidence exists but a native client, production runtime, browser journey, or business/legal policy is missing.
- **Not tested:** no valid evidence in this audit. No row below is labelled VERIFIED because critical workflows were not adequately executed end-to-end.

## Coverage matrix

| Workflow | Main path traced | Key invariant checked in source | Audit status / evidence gap |
|---|---|---|---|
| POS online sale → tender → stock → cash → GL → audit | `checkoutAction` → `createSale` → persistence, stock, cash and journal helpers | Server-side quote, idempotency/fingerprint, transaction scope, cashier-session lock | Source-traced; integration test suite blocked. No live DB/browser checkout. |
| POS repeated/double checkout | Shared attempt lock + idempotency claim/replay | Same key/same payload replays; changed fingerprint conflicts | Source-traced; concurrency test exists in repository but not executed here. |
| POS held sale → checkout | Held row `FOR UPDATE`, verify held status, delete held document after successful create | Two terminals cannot post same held sale twice | Source-traced; DB race not run. |
| POS split/partial/credit tender | Server quote/payment allocation and receivable terms | Tender allocation and receivable journal stay in sale transaction | Source-traced; no runtime finance fixture. |
| POS return/refund/void | Origin sale/lines locked, return cap and tender/provenance checks, stock/GL reversal | Original sale values and return quantity limits | Source-traced; integration suites blocked. |
| POS cashier close/reconciliation | Session lock, expected cash, movement totals, close/audit | One closing result and controlled difference | Source-traced; no live register session. |
| POS offline queue → reconnect | Snapshot + service worker + outbox sync/review | Same sale engine and idempotency; conflicting prices routed to review | Partial; local Chromium confirms FetchEvent cookie header absent; real app offline shell not run. POS-001. |
| POS offline repeated failure/review retention | Outbox insert/update and supervisor settlement | Pending row supersession; stored payload can be reviewed/resolved | Source-traced; no retention cleanup found; storage/query risk POS-002. |
| POS desktop enrollment/pair/sync/revoke | Better Auth bridge and device registry/digest policies | Tenant resolved from paired token; revocation rejects next request | Server source-traced; Tauri source deleted; end-to-end native auth/keychain not tested (PLT-001). |
| POS receipt print after sale | Receipt token/API or desktop bridge and printer handler | Financial commit does not depend on print result; ambiguous print tells operator to check before retry | Source-traced; printer unavailable. Duplicate paper output is an operational possibility, not duplicate sale posting. |
| Manual journal / payment / reversal | Actions → `postJournal` / idempotent payment helpers | Balanced entry, account state, open period, reversal trail | Source-traced; no DB ledger verification. |
| Cash outflow with block-negative policy | `postJournal` cash guard then document numbering/post | Intended check blocks projected negative balance | Source-traced but concurrency invariant is not protected (ACC-001); no DB race reproduction. |
| Close period / year-end | Period status guard, close rows and closing journal | Posted entries respect period status and idempotency | Source-traced; no DB close/reopen/year-end exercise. |
| Bank reconciliation | Statement import/matching, journal source linking | Match identity and reconciliation state scoped to company | Source-traced; live statement not used. |
| Purchase request → approval → PO | PR domain/action, role threshold, conversion | Conditional request state and company scope | Source-traced; no DB race/approval role tests. |
| PO creation → send/cancel | UI → `savePurchaseOrderAction` → domain idempotency optional | Server supports idempotency only when caller supplies key | Source-traced; UI omission creates retry duplicate risk PUR-001. |
| PO → receipt → stock/AVCO/AP/GL | Receipt action/domain, stock movement, purchase accounting | Source receipt/PO lines and mutations composed transactionally | Source-traced; no DB-backed three-way match or rollback. |
| Supplier return → stock/AP/credit/advance/journal | Provenance, stock and return resolution/posting | Source receipt quantity and original costing/financial path | Source-traced; no live return. |
| Stock movement → on-hand/ledger/AVCO | `applyStockMovement` and batch helpers | Product/on-hand row locks and appended movement | Source-traced; existing concurrency tests not run. |
| Warehouse transfer immediate / two-step | transfer-out/in movements and batch continuity | No double stock during transit, atomic document state | Source-traced; not DB-tested here. |
| Stock adjustment/opname approval | Stored exact lines; lock/state checks at approval/post | No post of stale/changed document; ledger and GL follow approved lines | Source-traced; no role/race/reconciliation execution. |
| HR overtime submit → approve → payroll | overlap check, approval state, approved entries in run | Same-day active request and approval maker-checker rules | Static trace; overtime duplicate race HR-001; no DB test. |
| HR leave submit → approve → attendance/payroll | workday and balance checks, approval recheck, attendance writes | Annual quota and date overlap | Static trace; concurrent quota approvals can overspend HR-002; no DB test. |
| Payroll run → post → payment → void | Indonesian calculation config, journal posting, separate pay and reversal | Named deductions and journal recovery | Source-traced; actual payroll data/statutory review and DB execution absent. |
| Analytics products/stock risk → returns | product aggregate and sold-product set vs standard sales return netting | Posted returns should reduce the correct period/product values | Source-traced defect ANL-001; no DB fixture run. |
| Import upload → preview → batch commit/retry | bounded parse, hash, job lock, row batches and journal | Batch idempotency/state, import/stock/audit consistency | Source-traced; all integration cases blocked. |
| CSV/XLSX export access and escaping | permission gate, field-level cost/payroll filters, serializer | No export without permission; formula-like cells remain text | Static check of all 16 export handlers; no negative HTTP tests. |
| User role change / owner continuity | `users.manage`, fresh session, role permission boundaries, owner count | At least one owner should remain | IAM-001 concurrency gap; static only. |
| Backup → restore / rollback | encryption, archive check, target confirmation and timer units | Restore must target explicit isolated DB and recover encrypted archive | Script/config source review only; no backup/restore run. |
| Deployment / migration / rollback | systemd, release/update and migration scripts | release artifacts and migration order | Static only; no staging host or production config access. |

## Test evidence and prohibited assumptions

- Executed: unit suite, typecheck, lint, production build, production dependency audit and the local Chromium cookie-header harness. Exact results are in `MASTER_PLAN.md`.
- Not executed: database integration/sim2 tests, E2E, concurrent business transactions, migrations against a test database, browser usability/accessibility paths, query plans, load tests, backup/restore, desktop update, printer and remote integrations.
- Integration suite did not start: the guard requires explicit `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` for an isolated loopback `*_test` DB. Docker daemon was unavailable. No production or ambient database was contacted.
- Historic markdown reports contain older counts and findings that do not always match the current source. This matrix supersedes old “VERIFIED” labels for this audit.
