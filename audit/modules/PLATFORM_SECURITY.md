# Platform, Security & Operations — Scoped Audit

**Scope:** authentication/session, RBAC/module gates, tenant RLS, CSP/headers, API/action authorization, telemetry/logging, device credentials, Electron/Tauri shell, CI, migrations, backups/restore, deployment, observability.

## Verified controls

- **Tenant isolation:** live `bisa_deep_test` catalog shows 100/100 tables with a `company_id` have RLS enabled; `app_user` is `NOBYPASSRLS`, `erp` is the owner/migration role. `withCompany` sets `app.company_id` per transaction. 100 tables is a schema count, not proof that every production grant/policy is correct.
- **Auth:** Better Auth signup disabled; database-backed rate limiting (100/10s general, 10/60s email sign-in); production origin/secret validated; sessions re-read membership/permissions every request; sensitive user actions require a fresh session. Two-factor is available but not mandatory.
- **API/actions:** all 16 export handlers have a permission gate; POS device endpoints use digest-only bearer tokens and tenant resolution; pairing codes are one-time and throttled; updater requires a token plus a real artifact/signature; telemetry is bounded and cannot overwrite server identity fields (SEC-001 fixed).
- **Headers/CSP:** CSP nonce + `strict-dynamic` for scripts; `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`; HSTS, nosniff, referrer policy. Service worker is served no-store.
- **Electron:** `sandbox`, `contextIsolation`, no Node integration, origin allowlist, deny/allow window-open policy, main-frame checks for print IPC. The official desktop shell is `pos-electron/`; the Tauri prototype was retired and its stale release workflow removed (PLT-001 resolved).
- **Database integrity:** posted journal headers/lines and stock movements are append-only via triggers; audit log rejects UPDATE/DELETE; journal balance trigger; partial unique indexes for bank-match/asset-depreciation claims. `app_user` has broad DML grants, so triggers (not privileges) are the effective guard.

## Findings / gaps

| ID | Severity | Summary | Status |
|---|---|---|---|
| SEC-002 | **P1 — FIXED** | Production demo seed now requires explicit flag + unique ≥16-char password; demo credential rejected; production password not printed. | FIXED / VERIFIED |
| PLT-001 | **P1 — RESOLVED** | Tauri release path retired; stale workflow/script/CLI removed; Electron is the documented desktop. | RESOLVED |
| SEC-003 | **P2 — FIXED (CI gate)** | Added CI security job: `pnpm audit --prod`, gitleaks, Semgrep (`p/typescript`, error severity). Local audit/Semgrep pass; GitHub run not executed. | FIXED (CI gate) |
| CORE-02 | **P2 — FIXED** | Bank/import/purchase-advance actions now use module gates; import entity helper test. | FIXED (source) |

## Electron POS readiness audit — 2026-11-25

**Packaging:** `pos-electron/package.json` now explicitly bundles `settings-view.js` and `offline-view.js` (the unit test was extended to enforce them). The AppImage was rebuilt from the current source; `app.asar` contains all 11 expected files, and `Bisa POS-0.1.0.AppImage.sha256` matches the artifact. `pnpm run package` now runs `scripts/write-checksum.cjs` automatically so a future build cannot leave a stale checksum.

**Runtime smoke (real Electron 45.4.1, Xvfb):**
- Offline start with unreachable server → offline page, `bisaPosOffline` bridge present, no console errors.
- “Ubah Alamat Server / Atur Printer” → settings window loaded, 3 OS printers discovered, six/80mm controls rendered, no console errors.
- Online start → login → `/app/pos`, `bisaPosDesktop` bridge exposes `printReceipt`, `openPrinterSettings`, `getPrinterConfig`, no console errors.
- Full cash sale in Electron: barcode scan → cart → Bayar → Uang Pas → “Transaksi berhasil”; no page/console errors.
- 13 key pages (`/app`, POS, history/session/hold, warehouse, receipt, valuation, import opening stock, accounting, reports, analytics) returned 200 with no error screen.

**Root cause found during the smoke:** the disposable test DB had not applied migration `0089_product_tax_exempt_and_promo_grants.sql`; `/app/pos` server-rendered a query on `products.is_tax_exempt` and React error #441 surfaced as “Terjadi kesalahan”. After `pnpm db:migrate`, the same Electron flow passed. `deploy/install.sh` and `deploy/update.sh` run `migrate.mjs` before serving; the server release tarball was rebuilt so it contains migration 0089. This is a deployment prerequisite, not an application-code defect.

| ID | Severity | Summary | Status |
|---|---|---|---|
| ELE-001 | **P1 release — FIXED** | The available server release (2026-11-19) predated migration 0089 and the AppImage (07:53) predated the view scripts; checksum was stale. Rebuilt both artifacts and regenerated/automated checksums. | FIXED / VERIFIED |
| ELE-002 | **P2 test-only — FIXED** | Two integration mocks lacked `requirePermissionInModule` after export routes added module gates, causing false test failures. Mocks updated. | FIXED |
| ELE-003 | **P2 operations — OPEN** | `deploy/kiosk/*` and `RUNBOOK-KIOS.md` still describe Tauri paths (`printer.json`, `bisa-pos.db`, `id.bisa.pos`, pairing panel); Electron uses `pos-settings.json`, OS printers, web login, and installs under `~/.local/share/bisa-pos`. | OPEN: revalidate/replace kiosk runbook for Electron before kiosk rollout |
| ELE-004 | **P2 availability — OPEN / documented** | Offline shell requires a secure context: LAN `http://IP` cannot register the service worker. Electron offline page offers reconnect/settings but not offline sales; localhost/HTTPS deployments do. | OPEN: deploy HTTPS or accept no LAN-HTTP offline |
| ELE-005 | **P3 release — OPEN** | No Electron auto-update or code signing; Windows NSIS build was not produced/tested on this Linux host; physical printer/jam/power-loss not tested. | OPEN: field validation |

- **Not tested / blocked:** live penetration test, ASVS 5.0 control matrix, production RLS/grants, mandatory-MFA policy, session fixation/CSRF runtime, backup encrypt/restore/PITR drill, deployment rollback, Electron installer/keychain/updater, printer bridge, load/observability.
- **Backup:** encrypted backup/restore scripts and a systemd timer were source-reviewed; the drill was not executed. No claim of recoverability.
- **Observability:** structured JSON logging exists for checkout/device/health/errors; no metrics/tracing/alerting or SLO evidence. No incident/retention policy was found for outbox/audit history.
- **No P0 security defect was confirmed.** Absence of a P0 is not a certification; production RLS, auth bypass, and native-client behavior were not dynamically attacked.
- **Compliance:** no ASVS/ISO 27001/SSDF/PCI/PSAK/IFRS certification. `pnpm audit` was clean at audit time only.
