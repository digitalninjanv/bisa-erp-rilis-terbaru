# POS Deep Hardening — Implementation Plan

Status: IMPLEMENTED — verification recorded in `remediation/POS_DEEP_FIX_REPORT.md`  
Source audit: `audit-reports/POS_DEEP_AUDIT_2026-11-21.md`  
Rule: every finding is validated against current code before it is changed. Design
choices that are intentional are documented, not “fixed” by breaking the
workflow.

## Findings and decisions

| ID | Finding | Decision | Acceptance |
|---|---|---|---|
| POS-AUD-01 | Discarded/done offline review can be reposted | Fix server + client tombstone | Discard is terminal; local item removed; no new review row |
| POS-AUD-02 | Recovery lockup on definitive retry | Fix | All definitive AppError codes clear pending; corrupt attempt escapable |
| POS-AUD-03 | Non-cash confirmation survives sale | Fix | New sale always unconfirmed |
| POS-AUD-04 | Stale held id survives clear/resume failure | Fix | Clear/reset detaches held id; stale hold auto-detaches |
| POS-AUD-05 | Blind count not blind | Fix | Expected withheld until count submitted; X report gated; no post-reveal edit |
| POS-AUD-06 | Reprint permission/audit bypass | Fix | Historical print requires reprint permission + audit; fresh checkout print allowed |
| POS-AUD-07 | Cash receivable outside drawer session | Fix | Cash receipt/refund requires open session or explicit rejection |
| POS-AUD-08 | Credit-limit bypass | Fix | Quick-add no unlimited credit; opening balances counted |
| POS-AUD-09 | Cash under-tender not blocked | Fix | Client blocks; server remains authoritative |
| POS-AUD-10 | Hidden serials after qty decrease | Fix | Serials trimmed; serial qty integer-only |
| POS-AUD-11 | Serial return identity lost | Fix | Return captures/restores exact serials |
| POS-AUD-12 | Web offline coverage partial | Improve + document | Cache catalog/group/customers or explicit limitation UI |
| POS-AUD-13 | Cash movement label vs journal | Fix wording/semantics | Bank transfer labels; expense routed to accounting |
| POS-AUD-14 | Shift close controls incomplete | Fix | Force-close supervisor, branch, offline-queue warning |
| POS-AUD-15 | Negative counted cash | Fix | Domain rejects negative |
| POS-AUD-16 | CSV formula injection | Fix | Route uses shared CSV serializer |
| POS-AUD-17 | Print queue/PWA cache cross-user | Fix | Jobs user-scoped; shell cache session-scoped |
| POS-AUD-18 | Unbounded receivables/session rows | Fix | DB pagination/aggregation |
| POS-AUD-19 | Receivable cash labelled sale | Fix | Distinct movement type/reporting |
| POS-AUD-20 | Inline scan has no beep | Fix | Same feedback as global scan |
| POS-AUD-21 | No manual offline sync | Fix | Visible sync action + status |
| POS-AUD-22 | History links 404 without reprint | Fix | Non-copy detail link; reprint action gated |
| POS-AUD-23 | No return voucher/true exchange | Fix | Printable return voucher + prefilled replacement sale |
| POS-AUD-24 | Held sales lose serials | Fix | Serial snapshot persisted/resumed |
| POS-AUD-25 | Price group persists | Fix | Reset to normal after sale with explicit indicator |
| POS-AUD-26 | Rounding all tenders | Verify | UI/comments state it is total rounding; no hidden cash-only claim |
| POS-AUD-27 | Offline payload exposed to pos.sell | Fix | Sanitize payload when caller lacks pos.void |
| POS-AUD-28 | POS page sequential reads | Fix | Independent reads parallelized |
| POS-AUD-29 | Minor validation/UX gaps | Fix | Actor filter, try/finally, focus, reprint link prop |

## Phases

1. **Safety/client core**: AUD-02, 03, 04, 09, 10, 20, 21, 22, 25, 29.
2. **Offline lifecycle**: AUD-01, 12, 27.
3. **Cash/session**: AUD-05, 14, 15, 19.
4. **Security/audit**: AUD-06, 16, 17.
5. **Receivables/credit**: AUD-07, 08, 18.
6. **Returns/serial**: AUD-11, 23, 24.
7. **Performance/docs**: AUD-26, 28.
8. **Verification**: unit, typecheck, lint, build where possible; integration
   tests documented as not runnable without dedicated test DB.

## Verification policy

- Pure logic: failing Vitest test first, then implementation.
- Server/DB changes: integration tests are added; they are run only against a
  dedicated `*_test` database. The current shell has no test DB, so typecheck +
  existing unit suite are the executable gate for this pass, and the gap is
  reported explicitly.
- No production/dev database writes, no deployment, no migration application.
