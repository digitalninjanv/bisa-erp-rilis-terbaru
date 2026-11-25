# Master Data, Settings & IAM — Scoped Audit

**Scope:** customers/suppliers/products/categories/units/packaging, duplicate detection, bulk edit, party merge; company identity/tax, branches/warehouses, module switches, payment methods, numbering, printing, custom fields, pricing groups; users, built-in/custom roles, permissions, password reset, membership removal, fresh-session gates.

## Controls observed

- **IAM-001 (last owner):** single and batch role actions lock the `organization` row `FOR UPDATE`, then count owners and reject a demotion below one (`src/server/actions/users.ts:197-231,275-335`). The prior source gap is closed; a DB race test was not executed in this pass. **PARTIAL.**
- Sensitive user actions require `users.manage` and a fresh session; self-role change is rejected; role assignment/management is bounded by the actor’s permissions; password reset deletes the target’s sessions (source).
- **Tenant isolation:** 100/100 company-scoped tables in the tested schema have RLS enabled; `app_user` is `NOBYPASSRLS` and has table privileges scoped by RLS. `withCompany` sets `app.company_id` transaction-locally. Production grants/policies still require deployment verification.
- **Settings/module switches:** module visibility is combined from role modules and company switches; page access uses `requireModuleAccess`; write actions use `requirePermissionInModule` (including the former CORE-02 outliers).
- **Master data integrity:** customer quick-add starts with zero credit/not-unlimited; credit-limit changes require accounting/owner permission and are audited with before/after; party merge/duplicate detection source was reviewed.
- **CSV export:** formula neutralization; permission gates on all 16 export handlers (source check).

## Findings / gaps

| ID | Severity | Summary | Status |
|---|---|---|---|
| CORE-02 | **P2 — FIXED** | Import/bank-reconciliation/purchase-advance module gates added; import entity helper test. | FIXED (source) |
| IAM-001 | — | Last-owner race is source-mitigated; no DB race test in this pass. | PARTIAL |

- **Not executed in this pass:** the full `user-management` integration file, custom-role permission matrix, multi-company switch, password-reset/session-revocation runtime, 2FA policy.
- **Two-factor authentication is available but not mandatory.** No finding is asserted for a policy the product may not intend, but this is a security decision to document before production.
- Settings forms were source/UI reviewed, not browser-tested for validation/error recovery.

## Evidence status

| Workflow | Status |
|---|---|
| Customer/supplier/product/category/unit/packaging CRUD | SOURCE-TRACED; packaging/warehouse tests pass |
| Customer credit quick-add and limit guard | VERIFIED (source + POS suite paths) |
| Party merge/duplicate/bulk edit | SOURCE-TRACED |
| Role create/update/delete, last-owner guard | PARTIAL (source; no DB race) |
| Module switch enforcement | VERIFIED for named write actions; export gates remain permission-only |
| RLS/tenant boundary | VERIFIED for test schema; production UNVERIFIED |
| 2FA/password/session runtime | NOT TESTED |
