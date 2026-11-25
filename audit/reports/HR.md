# HR & Payroll Audit — checkpoint 5

**Scope:** Employee records/org, attendance/import, work shifts, leave balances and approvals, overtime approvals/pay, employee advances/loans, payroll runs/payments/reversals, THR component drafts, PPh 21 TER/annual true-up, BPJS parameters, and GL integration. **Status:** source review complete for approval and payroll posting paths; DB-backed workflow and statutory parity tests were not run.

## Coverage and observed controls

| Workflow | Code reviewed | Evidence/status |
|---|---|---|
| Attendance/work shifts/import | `src/server/hr/attendance.ts`, HR actions/import | Tenant-scoped employees, workday mapping, normalized CSV fields and row errors are present. Import/duplicate behavior not run against DB. |
| Leave request/balance/approval | `src/server/hr/leave.ts` | Tenant/type/date/overlap/quota validations; balance rechecked at approval; self-approval is blocked for ordinary roles; approval writes attendance in same transaction. A shared-balance concurrency gap is finding HR-002. |
| Overtime request/approval/pay | `src/server/hr/overtime.ts`, payroll action | Positive hours and active same-date overlap check; approval uses conditional pending-state update and maker-checker rule. Submission overlap is a read-then-insert race with no matching DB uniqueness constraint (HR-001). |
| Payroll calculation/posting | `src/server/actions/hr/payroll.ts`, `src/server/payroll-indonesia.ts`, `src/lib/payroll/payroll-indonesia.ts` | Uses Decimal; period totals and a balanced journal are persisted with run/items in one company transaction; approved overtime, leave, loans/advances, THR, statutory deductions are joined into run. A partial unique index is documented as the concurrent regular-run guard. No DB run executed. |
| Payroll pay/void | `src/server/hr/payroll-runs.ts` | State, maker-checker and account checks; payment journal is idempotent; void requires reversal and restores advance/loan/component allocations. Static review only. |
| Employee confidentiality/RBAC | `src/server/actions/hr/*`, session/permission wrappers | Actions are permission-gated in inspected paths; complete role-by-role access review and response-field audit remain unverified. |

## HR-001 — concurrent overtime submissions can bypass the same-day duplicate guard

- **Severity / priority:** High / P1 (can duplicate paid overtime)
- **Confidence:** Strong evidence from the write path and schema; not reproduced on PostgreSQL.
- **Affected workflow:** Two operators submit overtime for the same employee and date at nearly the same time.
- **Location:** `src/server/hr/overtime.ts:33-85`; `src/db/schema/hr.ts:227-249`.
- **Scenario:** Both transactions query for active pending/approved requests and see none, then both insert. The schema defines only non-unique indexes on `(company_id, employee_id, date)` and `(company_id, status)`. Each request can subsequently be approved; payroll consumes approved requests for the period.
- **Expected:** At most one active request per employee/date, consistent with the domain rule and error message.
- **Actual:** Concurrent requests can both become pending and later both contribute to payroll.
- **Root cause / impact:** The overlap rule is implemented as an unlocked existence check with no database-enforced uniqueness/serialization. It is vulnerable to a phantom insert across independent transactions.
- **Minimal safe fix:** Serialize the check-and-insert using a lock keyed by company/employee/date, or add a partial unique index over those columns for active statuses with a safe migration strategy. Keep the user-facing validation message.
- **Regression check:** Barrier-synchronize two DB transactions for one employee/date; assert one request commits and the other is rejected. Then verify one approved request contributes one overtime amount to payroll.
- **Complexity:** Medium (partial unique index and existing rows may require cleanup/rollback planning).

## HR-002 — parallel leave approvals can exceed a limited annual balance

- **Severity / priority:** Medium / P2 (attendance and possible unpaid-leave payroll effects)
- **Confidence:** Strong evidence from query/update ordering; not reproduced on PostgreSQL.
- **Affected workflow:** Approving separate pending leave requests for the same employee, leave type and quota year.
- **Location:** `src/server/hr/leave.ts:151-195,279-371`.
- **Scenario:** An employee has five days available and two non-overlapping three-day requests pending. Two approvers concurrently call `decideLeaveRequest`. Each calculates the same available balance from already-approved rows; each request passes. Each then conditionally updates its own still-pending row and writes leave attendance.
- **Expected:** Approvals serialize against the remaining balance so the combined approved days never exceed quota plus configured carry-over.
- **Actual:** Both approvals can commit based on the same balance snapshot, leaving six approved days against five available.
- **Root cause / impact:** Rechecking at approval handles stale submissions but does not lock a shared employee/type/year balance. Conditional update only protects duplicate decisions on the same request.
- **Minimal safe fix:** Take a stable per-company/employee/leave-type/year lock before calculating remaining balance and hold it through approval; or maintain a locked/constraint-backed balance ledger. Preserve the existing request-row state guard.
- **Regression check:** Two barrier-synchronized approvals for three days against five days available; assert only one commits and only its attendance entries are created.
- **Complexity:** Medium.

## Statutory rules and limits

The engine receives dated company configuration for TER, progressive tax, PTKP, BPJS, overtime and THR rather than embedding those figures in the calculation engine. The default table cites PP 58/2023 and `DEFAULT_OVERTIME_RULES` cites PP 35/2021. Official references reviewed: [DJP PMK 168/2023 PPh 21 TER](https://www.pajak.go.id/index.php/id/pmk-168-tahun-2023-pph-pasal-21-ter), [PP 35/2021 at JDIH BPK](https://peraturan.bpk.go.id/Details/161904/pp-no-35-tahun-2021), and the [official PP 35/2021 text on overtime rates](https://peraturan.bpk.go.id/Download/154582/PP%20Nomor%2035%20Tahun%202021.pdf). This was a source cross-check, not legal certification of every table, employee classification, effective date, BPJS rate/cap, or edge case. 2026 statutory settings and employer obligations need domain-owner/legal confirmation before payroll release.

## Test and verification record

- Unit suite: **passed**, 133 unit files / 1,190 tests (41.04 seconds).
- HR/payroll integration suites exist (`tests/integration/hr-module-gate.test.ts`, payroll reversal and loan/advance tests, `tests/sim2/payroll-batch-proposals.test.ts`) but were **not run**: no safe disposable PostgreSQL service was available, and the test guard refused to fall back to `.env.local`.
- No payroll export/bank file, annual true-up, negative net, high employee count, tax/bpjs boundary, concurrent payroll, or HR data access scenario was executed.
- Context7 and Exa MCP tools were unavailable; official primary sources above and local source were used as fallback.

## Ponytail audit summary

- **Must:** HR-001 — prevent same-day duplicate overtime through a transaction-safe uniqueness/lock rule.
- **Should:** HR-002 — serialize leave balance approval; run statutory boundary/parity and payroll-to-GL integration tests in a disposable DB.
- **Nice:** None established from evidence.
- **Verdict:** Payroll calculations and journals are carefully centralized and stateful in source, but parallel overtime and leave operations can violate business limits. Do not call HR/payroll production-verified without DB tests and current statutory sign-off.
- **Lean:** Fix both balance/duplicate checks at their shared domain boundary rather than adding UI-only disabling.
- **Not checked:** Full HR role matrix, PII field exposure, import with realistic files, UI flow, legal certification, database concurrency, exports, or large payroll performance.
