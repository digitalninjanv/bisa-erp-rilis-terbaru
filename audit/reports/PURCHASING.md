# Purchasing Audit — checkpoint 4

**Scope:** Purchase requests (PR), approvals/conversion, purchase orders (PO), recommendation-based orders, goods receipt/PO match, supplier advances, AP, supplier returns/credits, cancellation, and cross-module inventory/accounting effects. **Status:** source review complete for core lifecycles; no DB-backed purchase workflow was executed.

## Coverage and observed controls

| Workflow | Code reviewed | Evidence/status |
|---|---|---|
| PR create/approve/convert | `src/server/purchase-requests.ts`, `src/server/actions/purchase-requests.ts` | PR action accepts an idempotency key; approval locks the request, maker-checker and threshold rules are enforced; conversion locks PR and changes it to `converted` in the same transaction as PO creation. Static review. |
| PO create/send/cancel | `src/server/purchasing.ts`, `src/server/actions/purchasing.ts`, `src/components/gudang/purchase-order-form.tsx` | Domain validates company-owned supplier/products, positive quantities, snapshots packaging conversion, and supports idempotency when supplied. Send/cancel lock header and check state. The UI omission is finding PUR-001. |
| PO receipt bridge | `src/server/purchasing.ts`, `src/server/inventory/receipts.ts` | Receipt locks PO before validating supplier and remaining quantities; received quantities/status update in the receipt transaction. |
| Receipt/payable/stock/GL | `src/server/inventory/receipts.ts`, `receipt-stock.ts`, `receipt-journal.ts`, `src/server/payables.ts` | Receipt invoice duplicate guard locks supplier; tax, pricing, stock, payable, journal and audit work are written in shared transaction. Static review; no numerical reconciliation run. |
| Advances and returns | `src/server/purchase-advances.ts`, `src/server/supplier-returns/*` | Source includes idempotent creation, FIFO allocation/restore and stateful return posting/void/reversal. Static review only. |

## PUR-001 — PO form does not send the idempotency key supported by its server action

- **Severity / priority:** Medium / P2 (duplicate procurement documents after retries)
- **Confidence:** Strong evidence from the current UI-to-domain path; no browser/network failure was injected.
- **Affected workflow:** Create a PO, then lose the success response or replay the server action.
- **Location:** `src/components/gudang/purchase-order-form.tsx:57-85`; `src/server/actions/purchasing.ts:19-53`; `src/server/purchasing.ts:100-135`.
- **Scenario:** The form calls `savePurchaseOrderAction` without `idempotencyKey`. The action schema makes the key optional and passes `null` to `createPurchaseOrder`. The domain only claims a key when one is supplied. A repeated request with a new action invocation can therefore create a second draft PO.
- **Expected:** A retry of one user intent returns or identifies the same PO without creating a second commitment document.
- **Actual:** The browser form does not use the server’s idempotency support, so an ambiguous network result followed by resubmission can create another PO. The server validates rows, but there is no business-level duplicate constraint to collapse two distinct creates.
- **Root cause / impact:** Idempotency was added at the domain/action layer but not wired into the primary UI caller. Duplicate drafts can be sent separately and cause duplicate purchasing commitments.
- **Minimal safe fix:** Generate a stable request key when the form intent is created, retain it across retry, pass it through the action, and rotate it only after a confirmed successful create or a deliberate new form. Prefer returning the original result for replay rather than a generic conflict.
- **Regression check:** Browser test that submits the same key twice (including a dropped first response) and asserts one PO/document number; a deliberate new form must use a new key.
- **Complexity:** Low.

The older draft assertion that PO/PR idempotency did not exist was too broad: PR and PO server domains accept/claim keys. The defect here is specifically that the primary PO form omits its optional key.

## Test and verification record

- Unit suite: **passed**, 133 unit files / 1,190 tests (41.04 seconds).
- `tests/integration/purchase-order.test.ts`, `purchase-advances.test.ts`, `supplier-returns/*`, and `tests/sim2/purchase-requests.test.ts` are present, but were **not run** because the isolated PostgreSQL test URLs were absent and the local Docker daemon was unavailable.
- PO retry, concurrent receipt vs cancel, over-receipt rejection, supplier invoice duplicate race, return allocation, and payment/AP-to-GL reconciliation remain unverified dynamically.
- No recommendation-generation or procurement peak-load latency was measured.
- Official references used for tenant/security and transactions: [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security), [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html), [Drizzle Transactions](https://orm.drizzle.team/docs/transactions). Context7 and Exa MCP were unavailable.

## Ponytail audit summary

- **Must:** PUR-001 — connect the PO form to its idempotency mechanism and verify ambiguous-retry behavior.
- **Should:** Execute PO/receipt/return integration suites in an isolated database; validate physical quantity and payable/GL totals end to end.
- **Nice:** None established from evidence.
- **Verdict:** Purchase receipt and supplier-return paths are intentionally transactional and stateful in source. PO creation remains vulnerable to duplicate user intent through its current UI retry path.
- **Lean:** Wire the existing idempotency contract into the form; do not add another PO abstraction.
- **Not checked:** Supplier communication/delivery integration, live UI retry behavior, database race tests, invoice-format policy, and production load.
