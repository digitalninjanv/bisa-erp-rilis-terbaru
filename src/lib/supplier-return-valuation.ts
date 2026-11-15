import { d, toDb, type MoneyInput } from "@/lib/money";

export type LinkedSupplierReturnValuation = {
  invoiceNetValue: string;
  taxValue: string;
  invoiceCreditValue: string;
  inventoryVariance: string;
  taxIncludedInLineValue: boolean;
};

/**
 * Revalue a receipt-linked return from its frozen invoice lines. Stock is
 * still removed at the current AVCO; the supplier claim follows the original
 * invoice (including its proportional tax). A null result means the source
 * invoice totals cannot be reconciled safely, so posting must stop for review.
 */
export function calculateLinkedSupplierReturnValuation(input: {
  sourceLines: readonly { id: string; qty: string | number; lineTotal: string | number }[];
  returnLines: readonly { receiptLineId: string; qty: string | number }[];
  receiptTotal: MoneyInput;
  receiptTaxAmount: MoneyInput;
  inventoryValue: MoneyInput;
}): LinkedSupplierReturnValuation | null {
  const lineById = new Map(input.sourceLines.map((line) => [line.id, line]));
  const sourceLineValue = input.sourceLines.reduce((sum, line) => sum.plus(d(line.lineTotal)), d(0));
  const receiptTotal = d(input.receiptTotal);
  const receiptTax = d(input.receiptTaxAmount);

  const taxIncludedInLineValue = receiptTax.gt(0) && receiptTotal.eq(sourceLineValue);
  const taxAddedToLineValue = receiptTax.gt(0) && receiptTotal.eq(sourceLineValue.plus(receiptTax));
  if (receiptTax.gt(0) && !taxIncludedInLineValue && !taxAddedToLineValue) return null;
  if (!receiptTax.gt(0) && !receiptTotal.eq(sourceLineValue)) return null;
  if (receiptTax.gt(0) && !sourceLineValue.gt(0)) return null;

  const qtyBySourceLine = new Map<string, ReturnType<typeof d>>();
  for (const line of input.returnLines) {
    const qty = d(line.qty);
    if (!qty.gt(0)) return null;
    qtyBySourceLine.set(
      line.receiptLineId,
      (qtyBySourceLine.get(line.receiptLineId) ?? d(0)).plus(qty),
    );
  }

  let returnedLineValue = d(0);
  for (const [receiptLineId, qty] of qtyBySourceLine) {
    const source = lineById.get(receiptLineId);
    if (!source || !d(source.qty).gt(0) || qty.gt(d(source.qty))) return null;
    returnedLineValue = returnedLineValue.plus(d(source.lineTotal).mul(qty).div(d(source.qty)));
  }

  const taxValue = receiptTax.gt(0)
    ? receiptTax.mul(returnedLineValue).div(sourceLineValue).toDecimalPlaces(4)
    : d(0);
  const invoiceNetValue = taxIncludedInLineValue
    ? returnedLineValue.minus(taxValue)
    : returnedLineValue;
  const invoiceCreditValue = taxIncludedInLineValue
    ? returnedLineValue
    : invoiceNetValue.plus(taxValue);

  return {
    invoiceNetValue: toDb(invoiceNetValue),
    taxValue: toDb(taxValue),
    invoiceCreditValue: toDb(invoiceCreditValue),
    inventoryVariance: toDb(invoiceNetValue.minus(d(input.inventoryValue))),
    taxIncludedInLineValue,
  };
}
