# Import & Export — Scoped Audit

**Scope:** CSV/XLS/XLSX upload and parsing, Accurate.id header mapping, preview/validation, row edit, batch commit/cancel/template, opening stock import, CSV/XLSX exports.

**Update 2026-11-25:** opening-stock deep dive. Three confirmed defects were fixed: the 65,534-parameter receipt insert ceiling, zero-cost opening stock silently revaluing `products.costPrice`, and the invalid/fictional opening-stock template example. Evidence: `audit/checks/opening-guards-before.log` (4 failures), `opening-guards-after.log` (4/4), `opening-related-after.log` (35/35), `opening-all-import-after.log` (60/60), `opening-warehouse-after.log` (125/125), `opening-build.log`. A 5,000-row positive probe now commits in 29.1 s (previously failed with `MAX_PARAMETERS_EXCEEDED`); 1,000 rows still take 6.5 s, confirming the remaining batching/lock risk.

## Controls observed

- Import parsing requires an authenticated `import.manage` user; stream bytes/rows are bounded and file magic/ZIP bounds are validated (`src/app/api/import/parse/route.ts`, `src/lib/import-file-validation.ts`). Batch size is limited (250 rows) for staged commits and jobs/rows are persisted for audit.
- Import commit uses a job lock and batch phases; master-data/stock/journal writes are transaction-scoped. Opening stock supports positive/zero/negative migrations with explicit signed journals and per-warehouse/cut-off documents; product-tracked serial/batch opening stock is intentionally rejected through this path.
- **Opening-stock receipt lines are inserted in 500-row chunks** (`receipts.ts`). The PostgreSQL bind message parameter count is Int16 (postgres.js caps at 65,534); the previous one-statement insert failed above ~3,850 lines even though the UI accepts 25,000.
- **Opening-stock rows with qty ≠ 0 and unit cost 0 are rejected** unless the wizard's explicit “Izinkan biaya 0” confirmation is checked. This stops a missing/blank cost column from silently importing zero-value stock and re-blending `products.costPrice` to 0.
- **Opening-stock template examples are generated from a real eligible product** (active, stock-tracked, not serial/batch, cost > 0), with the full six-column header including warehouse and cut-off date. If no eligible product exists, the Data sheet contains headers only rather than a guaranteed-invalid example.
- CSV export neutralizes `= + - @` formula prefixes while preserving plain numbers; cells with delimiters/newlines are quoted. All 16 export handlers were statically checked for a permission gate; payroll requires `payroll.salary`.
- The import wizard does not import historical sales/purchases/journals; this is documented, not a silent omission.

## Findings / gaps

| ID | Severity | Summary | Status |
|---|---|---|---|
| IMP-001 | **P1 — FIXED** | Opening-stock commit built one `stock_receipt_lines` INSERT for all rows; >~3,850 lines in one warehouse/date group exceeded 65,534 bind parameters and rolled the whole job back with a generic error. | FIXED / VERIFIED: 4,000-row regression + 4-pass probe; chunk size 500 |
| IMP-002 | **P1 — FIXED** | Positive opening stock accepted blank/zero unit cost, imported qty, wrote a zero receipt with no journal, and re-blended `products.costPrice` to 0. | FIXED / VERIFIED: qty≠0 + cost 0 blocked unless explicit confirmation; 2 new cost tests |
| IMP-003 | **P2 — FIXED** | Shipped opening-stock example used an empty SKU and a fictional product, so the first analysis always failed; template/guide also disagreed on required cost and columns. | FIXED / VERIFIED: dynamic real-product sample + six-column header + required cost flag; template route test |
| IMP-004 | **P2 — OPEN** | `commitOpeningStockImport` still processes all pending rows in one call/transaction despite the UI sending limit 250. 1,000 rows take ~6.5 s; 5,000 positive rows now succeed but take ~29.1 s and hold product locks; progress does not advance per batch. | PARTIAL: hard parameter failure fixed; true batching/progress and lock scope remain |
| IMP-005 | **P2 — OPEN** | No downloadable failed-row file, no completed-job detail, and no inline edit for opening-stock rows (only product import can edit). Users must repair the whole source file and re-upload. | NOT FIXED |
| IMP-006 | **P3 — OPEN** | Opening stock is the 15th tab on the generic import page; no CTA from receipts/valuation pages. Template now states base-unit qty, but batch/serial opening stock still requires manual receipts. | PARTIAL |
| CORE-02 | **P2 — FIXED** | Import commit/analyze gate by entity module (gudang/akuntansi/hr); helper unit test. | FIXED (source) |
| QA-002 | **P2 — FIXED** | Import/integration fixture isolation corrected; this pass ran 60 import tests and 125 warehouse tests. | FIXED / VERIFIED |

- **Not executed in this pass:** representative XLS/XLSX/CSV import through a browser, retry/cancel/concurrent commit on large files, malformed/ZIP-bomb archives, export round-trip.
- No claim is made about production throughput; 1,000/4,000-row timings are single-host lab measurements with domain calls, not HTTP/browser measurements.

## Evidence status

| Workflow | Status |
|---|---|
| Parse/validation/bounds | SOURCE-TRACED + template route tests |
| Preview/row mapping/template | VERIFIED for 6 import entities in this pass; opening-stock sample dynamic |
| Commit/retry/cancel | VERIFIED for opening-stock 1k/4k probes; broader retry/cancel fixtures |
| Opening stock import | VERIFIED: 4,000-row zero-value commit, 5,000-row positive commit (29.1 s), cost guard, template; 1k positive 6.5 s |
| CSV/XLSX export security | SOURCE-TRACED; unit/serializer checks |
| Large-file performance | PARTIAL: 4,000-row chunking; no 25k/browser measurement |

