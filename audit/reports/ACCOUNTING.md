# Accounting & Finance Audit — checkpoint 2

**Scope:** Chart of accounts and mappings, manual/system journals, reversals, fiscal periods and year-end close, AR/AP payments and write-offs, expenses/transfers, bank reconciliation, fixed assets, monthly balances, and finance reporting. **Status:** high-risk posting paths reviewed statically; database-backed accounting workflows and concurrency have not been run.

## Coverage and observed controls

| Area | Code reviewed | Evidence/status |
|---|---|---|
| Journal construction/posting | `src/server/accounting.ts`, `src/lib/akuntansi/journal-amounts.ts`, `src/server/actions/accounting/jurnal.ts` | Source review: nonnegative finite amounts, one-sided lines, balanced total, positive journal, tenant-owned/postable account checks, period check, idempotent replay, monthly-balance update in same transaction. Unit tests ran; DB-backed posting not run. |
| Reversal/correction | `src/server/accounting.ts`, journal action | Reversals are append-only, idempotent, and blocked while a journal line remains matched to a bank statement line. Source review only. |
| Period management/year close | `src/server/actions/accounting/periode.ts`, `src/server/year-end-closing.ts` | Posting locks the period row; close action uses the same lock. Year-end close validates year, retained-earnings account and that no monthly period remains open. The old draft claim that open periods were not checked is stale. |
| AR/AP, payments, credits, fees/withholding/write-offs | `src/server/payables.ts`, `src/server/party-payments.ts`, `src/server/party-credits.ts`, `src/server/actions/accounting/pembayaran.ts`, POS receivables domain | Shared idempotent payment wrapper and transactions cover payment, journal, document balance, credit and audit mutations. Source review; no DB tests run. |
| Bank transfers/reconciliation | `src/server/bank-reconciliation/*`, accounting actions | Exact account/amount matching, separate adjustment journal, explicit unlink requirement before reversal. Source review only. |
| Fixed assets/depreciation | `src/server/fixed-assets.ts`, related actions | Straight-line policy is explicit, period based, capped at depreciable amount, and linked to posting. Tax/regulatory policy correctness was not independently verified against jurisdictional requirements. |
| Financial reports/exports | `src/server/reports/{ledger,journal,...}.ts`, report actions | Monthly summary table is updated inside `postJournal`; read-only snapshot wrapper exists for streamed ledger exports. Plans and large-ledger latencies were not measured. |

## ACC-001 — concurrent cash outflows can both pass the blocking balance guard

- **Severity / priority:** High / P1 when a company configures `cash_negative_policy = block`.
- **Confidence:** Strong evidence from execution order and PostgreSQL isolation behavior; not reproduced against PostgreSQL because the safe local database is unavailable.
- **Affected workflow:** Two payments, expenses, transfers, or manual journals concurrently drawing from the same cash/bank account.
- **Location:** `src/server/accounting.ts:60-112,382-420`; `src/server/sequences.ts:39-78`.
- **Scenario:** A cash/bank balance is 100. Two separate transactions each post an 80 outflow. Both can read 100 in `evaluateCashNegativeGuard`, calculate projected 20, and pass. The guard takes no account-row/advisory lock. Both then proceed to `nextDocumentNumber`; any sequence-row serialization occurs after the balance reads and cannot invalidate those earlier decisions. Under PostgreSQL’s default Read Committed isolation, the aggregate query sees rows committed before that statement began.
- **Expected:** With policy `block`, at most one outflow may commit if the combined balance would become negative.
- **Actual:** The source permits both validations to pass on overlapping snapshots; final cash/bank can be negative despite the configured block policy.
- **Root cause / impact:** The invariant is enforced by a read-and-check over journal history without serializing competing writers for the cash account. This is a race in the shared posting gate, so every posting surface using it is affected.
- **Minimal safe fix:** Acquire a shared per-company/per-account lock before reading the balance and hold it through journal commit, or use serializable transactions with a bounded retry for serialization failures. Keep the balance check in the common posting boundary.
- **Regression check:** In a disposable PostgreSQL database, start two independent transactions behind a barrier, each post an 80 outflow against a 100 balance with `block`, then assert exactly one commits and the final ledger balance is nonnegative. Repeat with multiple posting workflows.
- **Complexity:** Medium.

## Areas requiring dynamic verification

- Posting/void/reversal behavior under duplicate requests and overlapping periods.
- Concurrent cash guard scenario above.
- AR/AP partial payments, overpayment-to-credit, fee/withholding, void and write-off reconciliation.
- Year-end preview/close/reversal, period lock race, bank reconciliation, depreciation and report parity.
- Decimal boundary cases at four decimal places, currency rounding, and large report exports.
- Installed dependency docs were checked by package/version inventory, but Context7 and Exa MCP tools were unavailable. Official PostgreSQL documentation was used as fallback.

## Test and research record

- Unit suite: **passed**, 133 unit files / 1,190 tests (41.04 seconds); this does not prove DB or cross-module posting behavior.
- Integration suites, including `tests/integration/accounting-integrity.test.ts`, `accounting-actions-p2.test.ts`, `warehouse-race.test.ts`, and payment/reversal coverage: **not run** because the configured disposable `*_test` PostgreSQL URLs were absent and Docker daemon was not running. The Vitest guard correctly refused to use `.env.local`.
- No journal throughput, query plan, report P95, or concurrent operator load measurement was available.
- PostgreSQL documents that Read Committed is statement-snapshot based and recommends locking/serializable handling for application consistency checks: [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html), [Application-Level Consistency Checks](https://www.postgresql.org/docs/18/applevel-consistency.html). Drizzle transaction API reference: [Drizzle Transactions](https://orm.drizzle.team/docs/transactions).
- Next.js Server Actions must be treated as public endpoints and authorized individually: [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security).

## Ponytail audit summary

- **Must:** ACC-001 — serialize the shared cash/bank balance check before posting under `block` policy; add a two-transaction regression.
- **Should:** Run guarded PostgreSQL integration suite and compare report outputs to ledger fixtures before treating finance workflows as verified.
- **Nice:** None established from reviewed evidence.
- **Verdict:** Core journal balancing, transaction boundaries, period locks and reversal discipline are present in source. Do not treat concurrency-sensitive cash controls or full accounting reconciliation as verified until DB tests pass.
- **Lean:** One code finding; one cross-cutting test gap. Avoid duplicating the posting gate in individual payment modules.
- **Not checked:** Full UI workflows, production DB constraints/query plans, accounting policy sign-off, jurisdictional tax conclusions, workload latency or multi-company live behavior.
