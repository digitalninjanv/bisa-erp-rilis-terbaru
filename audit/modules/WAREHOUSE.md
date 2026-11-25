# Inventory & Warehouse — Deep Audit

**Scope:** products/SKU/barcode/packaging, warehouses, goods receipt, purchase link/price variance, stock movements, on-hand cache, AVCO, transfers/transit, adjustments, opname, supplier returns, batches/expiry/FEFO, serials, reservations, valuation/stock card, import/export.
**Evidence run:** 17 integration files, 124/124 passed (`audit/checks/current-warehouse.log`); POS sale/receipt concurrency test passed; full unit suite 1,219/1,219.

## Inventory and traceability

| Surface | Main code | Notes |
|---|---|---|
| Receipt | `actions/inventory/penerimaan.ts`, `inventory/receipts.ts`, `receipt-stock.ts`, `receipt-void.ts` | Supplier/invoice lock, PO link, tax, advance, AP, journal, AVCO, stock. |
| Movement engine | `inventory/movements.ts` | Product → on-hand lock order; negative-stock policy; appended movement; AVCO blend/global qty; batch/serial hooks. |
| Transfers | `inventory/transfers.ts`, `transfers-receive.ts`, `transit.ts` | Dispatch/transit/receive; batch continuity; source/destination stock. |
| Adjustments/opname | `inventory/adjustments.ts`, `adjustments-post.ts`, `opname.ts` | Document state; sorted product locks; approval/posting; variance journals. |
| Returns/purchasing | `supplier-returns/**`, `purchasing.ts`, `purchase-advances.ts` | Provenance/caps under supplier lock; replacement/credit/refund/advance. |
| Master/packaging | `catalog/*`, `master-data/*`, `packaging*` | Multi-unit conversion snapshots; product/category/unit/supplier. |

## Verified workflows

- **Receipt posting:** validates tenant-owned warehouse/supplier, duplicate supplier invoice under a supplier row lock, source-specific accounts, tax mode, PO over-receipt/price variance, advance plan; then writes receipt/lines/stock/AP/journal/audit in one transaction. Void checks remaining stock and reverses AVCO/journal/AP; partial states are covered by `receipt-void-avco`.
- **Stock movement/AVCO:** every writer locks the product then `stock_on_hand`, refuses a negative result when the policy forbids it, appends an immutable movement, and re-blends cost using global on-hand + transit. Sale, receipt and adjustment paths share this engine; `warehouse-race` and the sale-vs-receipt test exercise contention.
- **Transfers/transit:** dispatch moves stock out, receive consumes transit and adds destination stock, batch slices are preserved; the suite covers partial receipt and serial/batch state.
- **Adjustments/opname:** stored exact lines, document status guards, sorted product locks, approval/posting; variance and valuation journals are asserted by `inventory-adjustment`, `inventory-p1/p2`, `opname-tasks`.
- **Supplier returns:** source receipt/line provenance caps, supplier lock for the authoritative check, stock restoration and AP/credit/advance/refund resolution; suite passes.
- **Valuation/card:** `stock-card-valuation`, `stock-document-history-filter`; stock value and movement history reconcile in the tested fixtures.
- **Batches/serials/FEFO:** `stock-batches`; expired batches are excluded from sale availability; serial state is restored on return/void.

## Invariant checklist

| Invariant | Result |
|---|---|
| Stock movements reconcile with balances | Tested fixtures pass; no DB-level cache trigger or full-history reconciliation |
| Concurrent stock changes safe | Product → on-hand locks; `warehouse-race` passes; no long mixed stress |
| No lost updates | Row locks + read-modify-write in one transaction; tested cases |
| No double deduction | Sale/receipt/return idempotency + document locks; receipt replay now compares a request fingerprint |
| Transfers atomic | Dispatch/transit/receive in tenant transactions; suite passes |
| Rollback restores consistent state | Transaction boundaries; no injected mid-commit failure test |
| Valuation follows configured rules | AVCO global-qty blend; valuation suite passes; GL reconciliation at volume not tested |
| Permission boundaries respected | `inventory.*` + module gate, including purchase advances; CORE-02 fixed |

## Findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| WH-001 | **P2 — FIXED** | Receipt replay now stores/compares a request fingerprint; changed retry conflicts. Integration test added. | FIXED / VERIFIED |
| CORE-02 | **P2 — FIXED** | Purchase-advance and bank/import actions now use module gates; import entity helper test. | FIXED (source) |
| QA-002 | **P2** | Integration fixtures share company/session state; POS failures are fixture leakage, not warehouse defects. | CONFIRMED (runtime) |

### WH-001 detail

`claimReceiptIdempotency` (`src/server/inventory/receipts.ts:288-320`) first looks up `stock_receipts.idempotency_key`; if found, it returns the row without a fingerprint. The form keeps the key until a successful response and resets it only after success (`receipt-form.tsx:64-67,292-338`). Scenario: server commits, response is lost, user edits lines/cost/qty and retries → server returns the original receipt, UI says success, edits are discarded. Fixed 2026-11-23: `claimReceiptIdempotency` and `receipt-idempotency.ts` store/compare a `paymentRequestFingerprint`; changed retry throws CONFLICT. Regression in `goods-receipt.test.ts`.

## Concurrency and data-integrity assessment

- Lock ordering is deliberately product → on-hand across stock writers; adjustments additionally sort product ids. This prevents lost updates and most deadlock cycles. Receipts rely on the per-line movement engine, not a pre-sorted product set; overlapping receipts in different line orders can still deadlock at PostgreSQL level (aborted transaction, no corruption) — not observed, not measured.
- `stock_on_hand` is a cache; the application writes it with the movement in one transaction. No DB trigger proves cache = movement sum. Existing tests reconcile representative cases; a global consistency job/trigger is not present.
- Negative-stock policy is centralized and company-scoped. Offline sales may be rejected at sync if stock is insufficient; the outbox routes this to supervisor review rather than silently overselling.

## Performance observations (not measured)

- No query plans, lock waits, or large-volume profiling were run. Hot paths lock product/on-hand rows and scan movement history for valuation/recompute; indexes exist on `(company, product, created_at)`, `(company, warehouse, created_at)`, and references.
- Product search uses barcode/SKU indexes plus a trigram name index. Stock card/valuation and import at 10k+ products were not benchmarked in this pass.

## Test evidence and gaps

- **Covered:** receipt/PO/advance, void/AVCO, adjustments/opname, transfers, supplier returns, batches/serials, valuation, stock race.
- **Not tested:** production-volume stock counts, long-running mixed sale/receipt/adjustment contention, physical stock count UX, import round-trip in this pass, GL↔subledger reconciliation over a large historical dataset.
- **No P0 warehouse defect was confirmed.** WH-001 is fixed and verified; no active warehouse code finding remains. Production-volume stock/GL reconciliation remains untested.
