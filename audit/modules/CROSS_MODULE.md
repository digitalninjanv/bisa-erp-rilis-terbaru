# Cross-Module Integration Verification

**Purpose:** verify that the same business event produces consistent documents, stock, cash, subledger, GL and audit records across POS, warehouse, purchasing, accounting and HR.

## Chains exercised

| Chain | What was asserted | Result |
|---|---|---|
| POS sale → payment → stock → cash movement → journal → audit | Server quote; sale/payments; stock decrement; cash session movement; balanced journal with revenue/COGS/tax/discount; audit row; idempotent replay | **PASS** in `audit-a2-chains`, `pos-*`, `erp-concurrency-remediation`; receipt token/copy assertions pass after POS-005 fix |
| Purchase → receipt → stock/AVCO → AP → journal | Receipt lines/stock/AVCO; supplier invoice lock; PO quantity/price; payable and journal; void reversal | **PASS** in `goods-receipt`, `receipt-void-avco`, `warehouse-race` |
| Return → refund/credit → stock restore → journal offset/reversal | Original line cost/tender; partial caps; stock/serial/batch restore; receivable offset vs cash refund; customer credit; idempotency | **PASS** financial/stock and original-print assertions after POS-005 fix |
| Stock adjustment/opname → valuation → journal | Document state; sorted locks; variance posting; stock value/movement card | **PASS** in `inventory-adjustment`, `opname-tasks`, `stock-card-valuation` |
| Cashier close → expected cash → variance journal → reports | Session row serialization; cash movement sum; tolerance/reason; difference journal | **PASS** for fixture concurrency after QA-002 isolation; no live cash close executed |
| AR/AP payment → subledger → GL → aging | Payment idempotency; account class; party tag; sale paid status; aging source | **PASS** in `a26-q8-payables-parity`, `accounting-integrity` for fixtures |
| Bank statement → match → journal link | Same account, exact amount, posted/live entry, one-to-one claim | **PASS** in `bank-reconciliation` + partial unique index |
| Payroll → expense/payable → payment → reports | Separate post/pay journals; named deductions; void/reversal | **NOT EXECUTED end-to-end**; source-traced |
| Period close → statements → prior-period comparison | Period lock; closing-entry exclusion; report totals | **PARTIAL**: snapshot consistency fixed; no year-end production exercise |

## Consistency findings

- **POS-005 is fixed:** the sale/stock/cash/journal chain commits correctly and the receipt token/copy policy now matches the post-checkout links.
- **ACC-001 is not a cross-module defect:** the isolated probe shows the cash guard serializes two outflows. The shared test failure was caused by prior tests adding cash to the same fixture company.
- **DATA-001 is fixed:** report bundles now use a repeatable-read snapshot; the consistency test proves the old mismatch.
- **WH-001 is fixed:** receipt replay compares a request fingerprint; a changed retry is rejected.
- **HR-003** is a policy deadlock for pre-existing duplicate overtime rows, not a double-posting defect.

## What remains unverified

- Production-volume reconciliation of `stock_on_hand` vs `stock_movements`, subledger vs GL, and report totals vs source transactions.
- Failure injection after commit but before response for receipts/POs/payments (only POS checkout has an E2E lost-response scenario).
- Multi-tenant isolation under real production grants, and cross-branch transfers at volume.
- Printer/power-loss, native client, backup restore, and period-close/year-end at real data.
