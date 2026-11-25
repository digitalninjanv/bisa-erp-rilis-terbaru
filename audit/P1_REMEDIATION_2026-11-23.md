# P1 Remediation — 2026-11-23

**Scope:** fix the three P1 findings from the ERP audit. No database schema, production data, or non-P1 business rule was changed.
**Result:** POS-005 fixed; SEC-002 fixed; PLT-001 resolved by retiring the stale Tauri release path (Electron is the documented desktop).

## Changes

### POS-005 — receipt/A4 token and copy contract

- Added `src/lib/pos/receipt-links.ts` (`receiptHref`, `invoiceHref`) so the one-time `printToken` and explicit `salinan=1` marker are built consistently.
- Propagated the token through:
  - `checkout-success-modal.tsx` (“Buka detail nota”, browser-print fallback);
  - `use-terminal-checkout.ts` router fallback;
  - `receipt-print-window.ts` popup;
  - receipt page → A4 invoice link and A4 → receipt cross-link.
- `nota/[id]/page.tsx`: the “Salinan” banner is now driven only by `salinan=1`; a token is still required for a non-reprint user to view a fresh receipt, and historical views are audited.
- `faktur/page.tsx`: accepts a fresh `printToken` (first invoice) or reprint permission; historical views are audited; explicit `salinan=1` still marks a copy.
- Tests: added receipt-link unit tests, a fresh-token integration test; fixed the `a28` test fixture permissions and static page imports. `p1-pos-receipts.log`: 12/12 pass.

### SEC-002 — production seed guard

- Added `src/db/seed-guard.ts`:
  - non-production: unchanged demo credential for local/CI;
  - production: requires `--allow-production-seed` **and** `BISA_SEED_OWNER_PASSWORD` ≥16 chars, rejects the published demo password, and never prints the production password.
- `src/db/seed.ts` resolves the owner credential before any DB query and uses the guard message helper.
- Updated `docs/DEPLOY.md` and `.env.example`.
- Tests: production CLI run rejected (`p1-production-seed-guard.log`), dev path still works (`p1-development-seed.log`), unit guard tests pass.

### PLT-001 — retire Tauri release path

- Official desktop is Electron (`pos-desktop/README.md`, `pos-electron/README.md`, commit `6140f97`); the Tauri source is deleted and the old workflow cannot build.
- Removed `.github/workflows/pos-desktop-release.yml` and `scripts/release-pos-desktop.sh`.
- Removed the `tauri` script and `@tauri-apps/cli` dev dependency (kept `@tauri-apps/api` for the experimental `pos-desktop` prototype).
- Added retirement banners to `docs/pos-native/RUNBOOK-RILIS.md` and `STATUS-TUTUP-TAURI.md`.
- Updated `src/app/api/pos/download/[format]` to serve only Electron artifacts from `BISA_POS_RELEASE_DIR`; updated the terminal download UI to Electron AppImage/EXE copy.
- Evidence: `p1-release-retirement.log`.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm exec eslint src tests e2e scripts` | PASS |
| `next build` | PASS |
| Unit suite | 1,213/1,214; only pre-existing 800-line ratchet (QA-003) |
| POS receipt/invoice regression | 12/12 |
| Cash-guard isolated probe | 1 posted / 1 rejected / balance 300 (priaudit revalidation) |
| Production seed guard | exit 1 with clear message |
| Dev seed path | exit 0, “Seed sudah ada” |
| Tauri release retirement | workflow/script/CLI absent; Electron documented |

## Residual risk

- POS receipt behavior is verified at page/unit level; a real browser click of the success-modal links and a physical printer/jam scenario were not run. Add to GAP-01/GAP-06.
- PLT-001 is closed as a **stale Tauri build/release path removal**, not as a successful Electron installer build. Electron packaging/install/pair/print/update remains GAP-02. The Tauri updater server endpoints/panel and `src/server/pos/releases.ts` remain as inert server code with no Tauri client; remove them in a follow-up if no longer needed.
- SEC-002 still allows an explicitly opted-in production demo seed (with a unique password); this is documented and not silent. A dedicated production bootstrap flow is still preferable.
- The pre-existing 800-line ratchet failure (QA-003) remains; our seed changes were kept at the 950-line ceiling and no new oversized source file was introduced.
