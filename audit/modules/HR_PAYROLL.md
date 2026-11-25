# HR & Payroll — Scoped Audit

**Scope:** organization/departments/positions/shifts, employees, attendance, leave, overtime, payroll runs (PPh21/BPJS/THR), advances/loans/reimbursements/final pay, payroll posting/payment/void.
**Evidence:** `tests/integration/hr-concurrency.test.ts` 2 passed / 1 failed; payroll calculators/source reviewed; no full payroll DB run in this pass; unit suite passes except the unrelated file-size ratchet.

## Controls observed

- **Overtime submission:** locks the employee row `FOR UPDATE` before the same-employee/date active-request check, so concurrent submissions serialize; the test passes.
- **Overtime approval:** locks employee then request, re-reads status, enforces maker-checker (creator cannot approve unless owner/admin), and rejects approval when another pending/approved request exists for the same employee/date.
- **Leave:** employee lock + re-read quota; the concurrent leave-quota test passes (HR-002 mitigated).
- **Payroll:** run/post/pay/void use document state guards, separate expense/payable/payment journals, and named deduction accounts; calculators and source paths were reviewed. No statutory certification is claimed.
- **Module gate:** a repository test exists (`tests/integration/hr-module-gate.test.ts`); it was not executed in this pass. HR pages are under the accounting module family.

## Findings / gaps

| ID | Severity | Summary | Status |
|---|---|---|---|
| HR-003 | **P3 — CLOSED** | Two pending overlapping legacy requests are both rejected until one duplicate is rejected; test now verifies reject-one-then-approve. No double-pay path. | CLOSED — intended safe behavior |
| HR-001/002 | — | Concurrent duplicate submission and leave-quota overspend are mitigated; tests pass. | REVALIDATED |

- **Payroll run → post → pay → void was not executed end-to-end against the DB in this pass.** Statutory PPh21/BPJS/THR inputs, rates, and legal compliance require customer/advisor review; this audit does not certify them.
- Attendance/leave calendar edge cases (holidays, cross-month leave, half-days) were not exhaustively tested.
- No production-volume payroll or concurrency test.

## Evidence status

| Workflow | Status |
|---|---|
| Concurrent overtime submit | VERIFIED (suite) |
| Concurrent leave quota | VERIFIED (suite) |
| Legacy overlapping overtime approval | RESOLVED by reject-one-then-approve; test covers it |
| Payroll calculation source | SOURCE-TRACED |
| Payroll posting/payment/void | NOT TESTED (DB) |
| Statutory/legal compliance | NOT CERTIFIED |
