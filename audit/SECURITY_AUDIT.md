# Security Audit

> **Current-status note (2026-11-23):** SEC-001, QA-001, **SEC-002**, **CORE-02** and **SEC-003 (CI gate)** are fixed; **PLT-001 is resolved by retiring the Tauri path** (Electron is the documented desktop). The CI security job has not yet run on GitHub; local audit/Semgrep evidence is recorded. See [FINDINGS.md](FINDINGS.md), [COVERAGE.md](COVERAGE.md), and [PLATFORM_SECURITY](modules/PLATFORM_SECURITY.md).

**Scope:** authentication/session handling, server actions and API handlers, role/module permissions, tenant isolation, sensitive exports/logs, imports, device credentials, desktop shell, secrets/configuration, dependencies and CI. This is a code/configuration audit, not a penetration test or ASVS certification.

## Prioritized findings

### SEC-001 — POS client telemetry can forge log context and submit unbounded detail fields

- **Severity / priority:** Medium / P2.
- **Confidence:** Confirmed from request parsing and object spread behavior; no live log collector was exercised.
- **Affected workflow:** authenticated `POST /api/pos/telemetry` client error/usage events.
- **Location:** `src/app/api/pos/telemetry/route.ts:7-41`; logger accepts scalar fields in `src/lib/log.ts:26-42`.
- **Reproduction:** authenticated caller submits `{"event":"checkout","details":{"companyId":"other-company","userId":"other-user","event":"invented-event","note":"<very long string>"}}`. `details` is spread after the server-derived `companyId`, `userId`, and `event`, so caller values replace those log fields. `request.json()` has no local body/field-count/value-size cap, and scalar details are accepted for every matching key.
- **Expected:** server-authored identity/event metadata cannot be replaced by client details; logged keys/values and request bytes have explicit limits and PII policy.
- **Actual:** client details can misattribute telemetry records and make one request emit arbitrarily large structured log lines (subject to any separately configured upstream limit, which was not available to inspect). This is telemetry integrity/resource pressure, not an authentication bypass.
- **Minimal safe fix:** reserve `companyId`, `userId`, `event` and all security/audit context keys; allowlist event-specific detail schemas; cap body bytes, field count and scalar lengths; redact PII and rate-limit according to the endpoint's use.
- **Regression:** route test submits reserved keys and oversized/chunked JSON; assert server-authored identity is preserved and request is rejected/truncated before logging.

### IAM-001 — concurrent owner demotions can leave a company without an owner

See `reports/SETTINGS_AND_MASTER_DATA.md`. The single and batch role update actions count owner rows without a company-level serialization boundary (`src/server/actions/users.ts:197-231`, `:281-335`). This threatens administrative recovery and permission governance.

### QA-001 — CI test job runs unit tests but omits DB integration suites

- **Severity / priority:** Medium / P2.
- **Confidence:** Confirmed from current package script and workflow.
- **Location:** `package.json:9-15`; `.github/workflows/ci.yml:60-106`; guard `tests/vitest-db-guard.mjs:50-85`.
- **Problem:** CI's PG-backed test job ends with `pnpm test`; that command runs only `vitest run tests/unit`. Integration/sim2 tests have separate scripts and require explicit isolated `BISA_TEST_*` database URLs. The workflow does not call the integration script. Older `docs/DEVELOPMENT_GUIDE.md:31-39` says `pnpm test` includes unit, integration and sim2, which no longer matches package behavior.
- **Impact:** database transactions, RLS, migrations, concurrency, import/exports and multi-module reconciliation do not get the regression protection suggested by the old guide. This audit's own integration run was blocked by the same guard.
- **Minimal safe fix:** add a separate CI job against an explicitly named isolated `*_test` database, set `BISA_TEST_DATABASE_URL`, `BISA_TEST_DIRECT_URL` and the CI remote-test opt-in for that service, migrate/seed it, then run `pnpm test:integration` (and sim2 if intended). Update developer documentation to match each script.
- **Regression:** verify CI logs show integration tests start against the disposable service, and confirm a deliberately failing integration test fails that job.

## Controls observed

- Better Auth signup is disabled; sign-in uses a database-backed rate limit with a stricter email sign-in rule; production origin and secret are validated (`src/lib/auth.ts:31-100`). Password reset deletes all sessions for the target user (`src/server/actions/users.ts:371-400`). Two-factor functionality is configured, but this audit found no policy requiring it for all accounts; no mandatory-MFA finding is asserted.
- `requireAuth` scopes the active company to actual user memberships; permission/module wrappers are used by reviewed actions (`src/lib/session.ts:82-175`, `:224-239`). Next.js documentation cautions that Server Actions and Route Handlers should be individually authorized; this audit checked explicit server-side guards instead of trusting the UI ([Next.js Data Security](https://nextjs.org/docs/app/guides/data-security)).
- Tenant transactions install `app.company_id`; migrations define RLS policies (`src/db/tenant.ts:9-43`, migration family under `src/db/migrations/`). Deployed database policy state and app-role grants were not queried, so effective production RLS remains unverified. PostgreSQL RLS documentation was used as a control reference ([PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)).
- Static scan of all 16 export handlers found a permission check. Payroll recap additionally requires `payroll.salary`, enabled HR module, and a fresh session (`src/app/api/export/payroll/route.ts:41-53`); cost fields are individually hidden without `inventory.cost`.
- Import parsing requires `import.manage`, limits stream bytes/rows and validates magic bytes/ZIP bounds (`src/app/api/import/parse/route.ts:46-79`, `:117-127`; `src/lib/import-file-validation.ts:130-204`). CSV export neutralizes formula-like cells (`src/lib/csv.ts:1-32`).
- Device secrets are generated with 32 random bytes and only digest stored; token lookup is tenant-resolved and revoked terminals stop being accepted (`src/server/pos/terminals.ts:123-145`; `src/server/pos-device.ts:74-95`). Pair-throttle state is process-local, a documented per-instance defense-in-depth limit (`src/lib/pair-throttle.ts:13-16`).
- Electron uses sandbox, context isolation, disabled Node integration, same-origin checks and narrow IPC validation (`pos-electron/main.cjs:19-45`, `:225-259`).
- `pnpm audit --prod` reported no known vulnerabilities in the current production dependency graph at audit time. Dependency audit cannot establish app security or rule out unpublished vulnerabilities.

## Other security review notes

- POS-001 is primarily an offline reliability defect: the worker relies on a browser-managed cookie header that Chromium did not expose in the local harness. It is documented in the POS report; do not use a client-visible value as a server authorization credential.
- Product/service-worker caches must be reviewed for logout/session isolation in a real browser; the current code depends on the unavailable cookie identity (POS-001).
- No `.env.local` values or private database credentials were read, copied or sent to external services. Secret scanning was limited to repository source/config patterns; no credential values are reproduced in this report.
- No SQL injection finding was established from the reviewed Drizzle parameterized query paths. This is not a complete taint analysis or penetration test.
- User-generated CSS/style and print sinks were sampled; the chart style uses controlled theme variables and kiosk print template interpolates a generated local time. No XSS finding was established from those inspected call sites. No claim is made that every client sink was exhaustively fuzzed.

## Standards and research

- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/) — particularly resource-consumption and authorization review categories.
- [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security) and [Authentication](https://nextjs.org/docs/app/guides/authentication).
- [PostgreSQL row security policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html) and [transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html).
- Context7 MCP and Exa MCP were unavailable; no result was fabricated. Official sources and local installed-version source were used instead.

**Verdict:** Authentication, tenant wrappers, field-level export gates and input limits are visible in source. SEC-001 and IAM-001 are actionable; runtime authorization, deployed RLS and native Tauri controls remain unverified. This does not constitute an ASVS pass.
