# Import and Export Audit

**Scope:** XLS/XLSX/CSV import parsing, preview/edit/cancel/commit, template generation, bulk product/master imports, accounting opening balances, and all discovered export endpoints.

## Ponytail audit summary

### Should — import safety controls observed

- `POST /api/import/parse` requires `import.manage`, rejects oversized `Content-Length`, and also applies a streaming request-body cap before multipart parsing (`src/app/api/import/parse/route.ts:46-60`; `src/lib/import-file-validation.ts:164-204`). The file is capped at 20 MiB; XLSX ZIP entries, uncompressed bytes and compression ratio are bounded; magic bytes must match the extension (`src/lib/import-file-validation.ts:14-17`, `:130-162`). Parsed non-empty rows are capped at 25,000 (`src/app/api/import/parse/route.ts:117-127`).
- Parse creates a tenant-scoped preview job with content hash and duplicate-applied-file rejection (`src/app/api/import/parse/route.ts:130-164`). Commit actions require `import.manage`; job commits lock the company/job row and reject completed/cancelled jobs and already-applied matching file hashes (`src/server/actions/import/commit.ts:47-58`; `src/server/actions/import/commit-phases.ts:64-91`).
- Product processing is batched; stock movements and opening-stock journals use the shared inventory/accounting domain and are in the same transaction for a batch. Job/row status and audit history are updated on commit. The design limits blast radius to each committed batch; later batches remain separately resumable.
- CSV output quotes cells and prefixes spreadsheet formula-like text while preserving numeric negatives (`src/lib/csv.ts:1-32`).
- A static scan of the 16 discovered export route handlers found an explicit permission check in each. Sensitive payroll export additionally checks `payroll.salary`, HR module enablement, and session freshness (`src/app/api/export/payroll/route.ts:41-53`). Cost values are hidden unless `inventory.cost` is present (`src/app/api/export/products/route.ts:26-38`; `src/app/api/export/inventory/route.ts:21-40`).

### Not checked — dynamic failure behavior

No representative XLS/XLSX/CSV import, commit retry, malformed archive, concurrent commit, cancellation, or export download was run in this audit environment. Although integration coverage exists (`tests/integration/import-export-excel.test.ts` and import-specific suites), the Vitest guard refused non-unit tests without `BISA_TEST_DATABASE_URL` and `BISA_TEST_DIRECT_URL` naming an isolated `*_test` database. Do not infer successful runtime round trips from source inspection or stale `docs/VALIDATION.md` claims.

### Risk-based verification to run in isolated test DB

1. Submit chunked multipart input beyond 20 MiB without `Content-Length`; expect 413 before XLSX parsing.
2. Test ZIP entry, uncompressed-size, ratio, invalid magic-byte and >25,000-row boundaries.
3. Race two commits on the same job; expect exactly one set of row movements/journals and safe replay/error for the second.
4. Retry a partially committed multi-batch job after process failure; reconcile row counts, opening stock, AVCO, GL, and job status.
5. Verify CSV injection payloads remain text in spreadsheet applications, including leading whitespace, newline, comma and quote cases.
6. For every export, test unauthenticated, wrong-role, module-disabled and field-level cost/payroll permission denial.

**Verdict:** Good source-level input/resource defenses and explicit export gates. Runtime import/export workflows remain unverified here; no defect confirmed in the reviewed paths.
