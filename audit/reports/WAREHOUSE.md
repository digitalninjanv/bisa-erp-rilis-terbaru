# Inventory & Warehouse Audit — checkpoint 3

**Scope:** Product/SKU and packaging, stock ledger/on-hand, receipts and PO links, AVCO, batches/expiry, serials, reservations, adjustments/opname, quarantine, one- and two-stage transfers, purchase returns, and inventory journal valuation. **Status:** critical write paths reviewed statically; database race and reconciliation tests were not executed.

## Coverage and observed controls

| Workflow | Code reviewed | Evidence/status |
|---|---|---|
| Product and packaging | `src/server/actions/inventory/produk.ts`, `src/server/catalog/products.ts`, packaging domain | Tenant-owned references and SKU/barcode uniqueness are checked; price changes have a distinct permission. Once stock movements exist, master edit does not overwrite AVCO `costPrice`. Static review. |
| Stock movement/on-hand | `src/server/inventory/movements.ts`, schema and movement callers | Every mutation takes product then `(company, warehouse, product)` row locks, checks negative stock, and updates on-hand and movement ledger in the same transaction. Source review. |
| Goods receipt/PO/valuation | `src/server/inventory/receipts.ts`, `receipt-stock.ts`, `receipt-journal.ts`, `receipt-prices.ts` | Receipt idempotency, period, tenant ownership, supplier invoice and PO locks/quantity bridge are checked before posting. Stock/batches/serials/journal are written in the caller transaction. Catalog sale-price changes require an explicit `updateCatalogSalePrices` flag and are audited. |
| Transfer/receiving | `src/server/inventory/transfers.ts`, `transfers-receive.ts`, `transit.ts` | Transfer has optional idempotency; two-step mode moves to `in_transit`; receiving locks the document and checks status; batches and serials are carried through both legs. |
| Adjustment/opname/approval | `adjustments.ts`, `adjustments-post.ts`, `opname.ts`, `opname-tasks.ts` | Posting locks the document and rejects already-posted/invalid states; period is checked before movement; maker-checker approval is enforced in the domain; approval locks pending status. |
| Batch/expiry, serials, reservations | `src/server/batches.ts`, `serials.ts`, `reservations.ts`, movement callers | FEFO and tracked-unit mutations are centralized; source reviewed but not run against database fixtures. |
| Inventory-to-ledger valuation | `adjustments-post.ts`, receipt/transfer/return posting and `src/server/accounting.ts` | Source review shows `postJournal` is shared; no numerical reconciliation was run against an isolated DB. |

### Findings status

No new confirmed warehouse data-integrity defect was established from the source paths reviewed. This is not a VERIFIED conclusion for runtime workflows: integration tests could not access their required disposable PostgreSQL database.

Two earlier draft claims were contradicted by current source: `produk.ts:264-277` removes `costPrice` from edits after any stock movement; `receipt-prices.ts` updates catalog sale prices only after an explicit opt-in. The earlier claim that adjustments lacked a duplicate-post state guard is also stale: `adjustments-post.ts:42-53` locks and checks the document state.

## Concurrency and performance risks to measure

- `applyStockMovement` locks the global product row before the warehouse on-hand row (`movements.ts:51-77`). This maintains shared AVCO consistency across warehouses, but serializes same-SKU stock activity across all warehouses. A hot SKU may become a lock-contention bottleneck at peak cashier/receiving concurrency. This is a **measurement target**, not a demonstrated latency finding; no concurrent DB run or percentile data was available.
- Global AVCO recomputes quantity across all `stock_on_hand` rows for the company/product and adds stock in transit. The query is appropriately scoped by company and product; actual plan/latency is unknown without representative data and `EXPLAIN (ANALYZE, BUFFERS)`.

## Test and verification record

- Unit suite: **passed**, 133 unit files / 1,190 tests (41.04 seconds). Unit tests do not establish transactional behavior against PostgreSQL.
- `tests/integration/warehouse-race.test.ts` contains two real-transaction race scenarios: last-unit checkout contention and concurrent same-count opname; `inventory-adjustment.test.ts`, `inventory-p1.test.ts`, `inventory-p2.test.ts`, `inventory-void-import.test.ts`, `packaging-warehouse.test.ts` and related tests are also present. **None were run** because no safe disposable PostgreSQL instance was available; the Vitest DB guard blocked the attempted run.
- No simultaneous POS/warehouse mutation, batch/serial FEFO, AVCO-vs-GL, transfer failure/rollback, load, or query-plan benchmark was executed.
- PostgreSQL RLS/transaction and ORM transaction references: [PostgreSQL RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html), [Drizzle Transactions](https://orm.drizzle.team/docs/transactions).
- Context7 and Exa MCP tools were unavailable; official documentation and local source were used as fallbacks.

## Ponytail audit summary

- **Must:** None established from this static checkpoint.
- **Should:** Run `warehouse-race` and stock/valuation integration suites in an isolated PostgreSQL DB; add same-SKU load measurement across warehouses before setting concurrency expectations.
- **Nice:** None established from evidence.
- **Verdict:** Strong source-level locking, movement ledger, document state checks and transactional posting are present. Do not label stock/GL reconciliation verified without executed database checks.
- **Lean:** Retain the shared stock mutation boundary and its documented product-to-on-hand lock order; investigate the hot-SKU lock only from measured contention.
- **Not checked:** Runtime database constraints/RLS policy state, concurrency tests, real query plans, large-stock performance, UI/handheld usability, and branch-scale load.
