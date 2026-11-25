# Purchasing — Scoped Audit

**Scope:** purchase requests/approval, purchase orders, send/cancel, PO↔receipt three-way match, price variance, purchase advances, supplier returns, AP integration.
**Evidence:** `purchase-order`, `purchase-advances`, `packaging-purchasing` integration tests pass (within the 124/124 warehouse run); source trace of actions/domain; PO UI reviewed.

## Controls observed

- PO creation validates tenant supplier/products, positive qty, non-negative cost, packaging conversion, and optional idempotency key. A DB claim (`purchase.order` scope) prevents a duplicate when the caller supplies a key.
- The primary PO form now generates one key per form session and sends it on submit (`purchase-order-form.tsx:78-80`); the action forwards it (`actions/purchasing.ts:19-53`). **PUR-001 fixed.** A replay with the same key that loses the first response throws `CONFLICT` rather than returning the existing PO; safe but requires the user to refresh/review.
- Receipts lock the PO before validating remaining quantity/price; over-receipt and price-variance reasons are rejected before writes. Receipt, stock, AP and journal share one transaction.
- Supplier returns use receipt/line provenance and a supplier row lock for the authoritative cap; resolution paths (replacement, next-purchase credit, advance, refund, other) are tested.

## Findings / gaps

- **No new P0/P1 purchasing defect confirmed.**
- Purchase-request approval/convert-to-PO role thresholds were source-traced but not executed against the DB in this pass. Treat the approval-role matrix as **PARTIAL**.
- PO replay after a lost response surfaces `CONFLICT` instead of the original document; an operator must refresh. This is a UX/retry concern, not a duplicate-post defect.
- No production-volume PO/receipt benchmark or concurrent three-way-match test was run.

## Evidence status

| Workflow | Status |
|---|---|
| PO create/send/cancel, packaging | VERIFIED (suite) |
| PO → receipt → stock/AP/journal | VERIFIED (suite) |
| Price variance/over-receipt guard | VERIFIED (suite) |
| Purchase advance allocation | VERIFIED (suite) |
| Supplier return resolution | VERIFIED (suite) |
| PR approval role matrix | PARTIAL (source) |
| Production load/concurrency | NOT TESTED |
