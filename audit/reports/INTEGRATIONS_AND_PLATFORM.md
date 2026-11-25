# Integrations, POS Desktop and Platform Audit

**Scope:** Better Auth, multi-tenant request context, POS device APIs, browser PWA, POS desktop shells, updater delivery, printing, health, backup/restore scripts, deployment and CI. POS PWA defect is cross-listed in `reports/POS.md`.

## Ponytail audit summary

### Should — platform controls observed

- Better Auth disables public signup, uses explicit secret/environment validation, trusted origin behavior, and database-backed rate limiting with a stricter email sign-in rule (`src/lib/auth.ts:31-100`). Sensitive account/role operations require fresh sessions in the user action layer. Two-factor plugin support exists but is not enforced as mandatory for all accounts; no such product policy was discovered.
- Tenant DB access is wrapped in transaction-local `app.company_id` settings (`src/db/tenant.ts:9-27`); repeatable-read snapshots are used for point-in-time ledger streaming (`:31-43`). Migrations include tenant RLS policies; actual deployed schema/policy state was not queried.
- POS device tokens are high-entropy, stored as SHA-256 digests, revoked terminal identities are rejected, and token lookup uses a constrained pre-tenant digest policy (`src/server/pos/terminals.ts:28-52`, `:123-145`). Device routes use bearer tokens and explicit CORS; wildcard CORS is consistent with the documented non-cookie bearer model (`src/server/pos-device.ts:74-105`). Pairing codes are one-use with a 15-minute TTL; the additional IP throttle is process-local, so it is per-instance in a multi-instance deployment (`src/lib/pair-throttle.ts:13-16`, `:20-55`). Pair code entropy is substantial; distributed throttling is defense-in-depth rather than a confirmed authentication bypass.
- Desktop update metadata and artifact downloads require a paired device token. Target/architecture map to canonical filenames, `.sig` is read from the release directory, and downloads stream from the canonical resolved path (`src/app/api/pos/update/[target]/[arch]/[version]/route.ts:41-93`; `src/app/api/pos/update/download/[target]/[arch]/route.ts:26-51`; `src/server/pos/releases.ts:200-252`). Artifact signing-key custody and updater verification by the client could not be tested because the Tauri client source is unavailable.
- `pos-electron/` configures sandbox, context isolation, disabled Node integration, web security, same-origin navigation checks, denied permissions and narrow IPC validation (`pos-electron/main.cjs:19-45`, `:225-259`; `pos-electron/preload.cjs:1-8`). Local settings are atomically replaced with mode `0600`; the URL parser requires HTTPS except local/LAN HTTP (`pos-electron/settings.cjs:19-47`). Printing is not exactly-once: Electron returns `uncertain: true` for ambiguous driver/timeout outcomes and tells the operator to inspect before retry (`pos-electron/main.cjs:123-143`), which is an appropriate operational safeguard.
- Health route is intentionally minimal. Backup/restore scripts were statically reviewed for encryption, restrictive file mode, archive verification, explicit restore target/confirmation, and in-place restore guardrails; they were not executed.

### Must — integration verification gap

- **PLT-001: Tauri native source missing from this working tree.** `git status` reports `src-tauri/**` deleted, so Rust client authentication storage, updater signature verification, native sync retry/locking, OS keychain behavior, permissions, packaging and install/update rollback cannot be inspected from the current checkout. The server API contract and `pos-desktop/` web shell are reviewable, but this is not enough to claim the native terminal workflow is verified.
- **Reproduction / expected:** restore or provide the intended Tauri source/build artifact, then trace pairing → keychain persistence → snapshot/sync → revocation → signed update → rollback on failed install. Expected contract: device token never enters web local storage/logs; revoked token cannot sync; only signed compatible artifacts apply. Current actual native behavior is unknown.
- **Impact:** device credential protection and software supply-chain safety remain unverified for the native release target.
- **Next check:** audit the exact release commit/source and perform a signed update lifecycle in an isolated staging installation; include rollback and revoked-terminal tests.
- **Severity / priority / complexity:** Medium / P2 / Medium (coverage gap, not a confirmed vulnerability). **Confidence:** Confirmed checkout-state limitation.

### Should — CI does not run database integration suite (QA-001)

See `SECURITY_AUDIT.md` and `FINDINGS.md`. The current CI test job runs `pnpm test` only; `package.json` maps that to `vitest run tests/unit`, while the integration suite is separate. CI has a PostgreSQL service but does not invoke `pnpm test:integration`/`pnpm test:all` (`.github/workflows/ci.yml:60-106`, `package.json:9-15`). The test database guard requires explicit isolated `BISA_TEST_*` URLs for non-unit suites. This leaves database workflows without CI regression protection despite older docs describing a broader `pnpm test` command.

## Coverage and limitations

Static API inventory includes Better Auth, health, import, export and POS desktop/device/updater endpoints. No live auth browser session, device pair, desktop build, printer, update, backup, restore, rollback, failover or deployment was exercised. The historical `src-tauri/` deletion and absence of a disposable PostgreSQL environment are material limitations. No external code or secrets were sent to research services.

**Verdict:** Strong server-side tenant/device controls are visible. Native Tauri lifecycle and production operations are not runtime-verified; CI integration omission needs remediation.
