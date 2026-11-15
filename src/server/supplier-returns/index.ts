/**
 * Supplier returns — Retur Pembelian ke Pemasok (A-9, D-20).
 *
 * A return is a claim lifecycle, not a write-off. Posting is the only
 * step that moves stock or money: goods leave at the running AVCO
 * (products.costPrice), and the value V settles in two parts —
 *
 *   Dr Utang Dagang (mapping `payable`)        min(V, open payable)
 *   Dr Kredit Pemasok (mapping `supplier_credit`)  the remainder
 *     Cr Persediaan (mapping `inventory`)      V
 *
 * The payable part is allocated oldest-first over the supplier's open
 * payable documents (credit purchase receipts, then opening balances)
 * in `supplier_return_allocations`, so listPayables and the payment
 * actions — which subtract allocations — can never pay the same debt
 * twice. The credit part is a claim that resolutions consume:
 * applySupplierCredit (Dr Utang / Cr Kredit Pemasok), refunds
 * (Dr Kas/Bank / Cr Kredit Pemasok), replacement receipts
 * (Dr Persediaan / Cr Kredit Pemasok), or an "other" written close,
 * which never books the claim away silently.
 *
 * FIX-P1 Tahap 4 (AK4-04): goods bought under a taxed receipt carry
 * creditable PPN Masukan (mapping `tax_input`). AVCO is net of that
 * tax, so V alone would leave the tax portion sitting in both the
 * payable and the PPN Masukan account forever. The payable-allocated
 * part therefore also reverses input tax proportionally — walking the
 * same FIFO documents, each taxed receipt contributes
 * tax × (its outstanding share) × (the net portion this return takes
 * from it):
 *
 *   Dr Utang Dagang        payableAmount + taxReversal
 *     Cr Persediaan        V
 *     Cr PPN Masukan       taxReversal
 *
 * and the allocation rows record the gross take per document, so a
 * full return settles a taxed receipt completely. The supplier-credit
 * (excess) part carries no tax reversal — see the stage report for
 * that honest limit.
 */

// A-24 Tahap T4B: indeks modul hasil pemecahan src/server/supplier-returns.ts.
// Mengekspor ulang persis API publik berkas asal.

export { SUPPLIER_RETURN_REASON_LABELS, SUPPLIER_RETURN_RESOLUTION_LABELS, POSTED_RETURN_STATUSES } from "./shared";
export { sumReturnAllocations, getSupplierOpenPayable, refreshReceiptPaymentStatus, refreshOpeningPayableStatus } from "./payables";
export { createSupplierReturn, deleteSupplierReturn } from "./returns";
export { postSupplierReturn, voidPostedSupplierReturn } from "./posting";
export { applySupplierCredit, convertSupplierCreditToAdvance, refundSupplierReturn, receiveReplacement, resolveSupplierReturnOther } from "./resolutions";
export { getSupplierReturnDetail, listSupplierReturns, listSupplierReturnsPage, listSupplierReturnWorkQueue, listSupplierOpenPayableDocs, listSupplierOpenPayableDocsForSuppliers, getSupplierReturnPageData, getSupplierReturnPrintData } from "./reads";
