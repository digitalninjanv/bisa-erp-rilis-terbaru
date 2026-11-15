export type SupplierReturnBatchIdentity = {
  batchNumber: string | null;
  expiryDate: string | null;
};

/**
 * Legacy receipts may not have recorded a lot identity. In that case an
 * explicitly selected current batch is acceptable; when the receipt did
 * record a lot, both batch number and expiry must match exactly.
 */
export function matchesReceiptBatchIdentity(
  source: SupplierReturnBatchIdentity,
  selected: SupplierReturnBatchIdentity,
): boolean {
  if (source.batchNumber === null && source.expiryDate === null) return true;
  return source.batchNumber === selected.batchNumber && source.expiryDate === selected.expiryDate;
}
