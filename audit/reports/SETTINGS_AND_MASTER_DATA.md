# Settings, Master Data, Users and RBAC Audit

**Scope:** company settings, module switches, custom roles, user lifecycle, customer/supplier merge, product master operations and related audit history. **Method:** current working-tree source review plus unit/static checks recorded in the master plan. No database-backed role or merge workflow was executed.

## Ponytail audit summary

### Must — IAM-001: concurrent demotion can remove the last owner

- **What:** preserve at least one `owner` membership under concurrent role changes.
- **Problem:** `updateUserRoleAction` counts owners, then demotes a target in the same ordinary transaction, but does not serialize company-level owner changes. Two distinct owners can each change the other owner to a non-owner role at the same time. Under PostgreSQL Read Committed, each transaction can see two owners, pass the `<= 1` check, update a different membership row, and commit, leaving zero owners. The batch action also counts without a common lock.
- **Evidence:** `src/server/actions/users.ts:197-231`; `updateUserRolesBatchAction` counts at `:281-315`. `member` has a unique company/user index but no owner-count constraint in `src/db/schema/auth.ts:112-128`; no database trigger enforcing an owner invariant was found.
- **Reproduction:** create exactly two owners; concurrently submit owner A demoting B and owner B demoting A. Each request must have a fresh session. Expected: one change is rejected or serialized while one owner remains. Actual code permits both checks to read the original count before either update commits.
- **Impact:** company can lose the role required to grant admin/owner access and recover role administration.
- **Minimal fix:** serialize all owner-affecting role writes on a company-scoped advisory lock (including batch writes), then recount under the lock; consider a database-enforced invariant if the organization model permits it.
- **Regression:** barrier-controlled two-transaction test for individual and batch actions; assert committed owner count remains >= 1.
- **Severity / priority / complexity:** High / P1 / Medium. **Confidence:** Strong Evidence; not database-reproduced in this environment.

### Should — permission and data-boundary controls observed

- `requireAuth` resolves the selected company only from the user's memberships, loads role permissions inside tenant-scoped reads, and computes enabled module switches (`src/lib/session.ts:82-169`). `requirePermission` and module-aware wrappers gate actions (`:172-175`, `:224-230`).
- User create, role update, password reset, custom role writes require `users.manage` and fresh sessions; role assignment is bounded by the actor's effective permissions (`src/server/actions/users.ts:104-181`, `184-245`, `342-405`, `485-535`). Owners cannot be removed directly (`:417-426`). The concurrency gap above affects the separate “at least one owner” invariant.
- Company setting mutations use `settings.manage`, schema parsing, and `withCompany`; cost visibility is field-gated with `inventory.cost` in exports and the inventory valuation page.
- The public sign-up endpoint is disabled and auth rate limits are database-backed (`src/lib/auth.ts:61-89`). Two-factor support is configured but this audit found no repository policy requiring it for every account; no mandatory-MFA finding is inferred.
- Party merge now remaps supplier advances and party credits in its transaction (`src/server/master-data/merge.ts:335-340`, `381-392`) and documents pre/post outstanding-balance checks. The previous audit note claiming those references were omitted is stale and is not retained as a current finding.

## Coverage and limitations

Reviewed user/role action paths, permission helpers, settings action families, tenant wrapper and merge reference remapping. Role concurrency, company-setting UI behavior, restore of access after role misconfiguration, and multi-company browser behavior need DB-backed/API tests. No live database was available; full settings screens were not manually traversed in a browser.

**Verdict:** Strong static safeguards with one high-impact concurrency defect. Not runtime-verified.
