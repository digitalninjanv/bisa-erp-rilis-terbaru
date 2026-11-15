import { d, toDb, type MoneyInput } from "@/lib/money";

export type PurchaseOrderPriceVariance = {
  productId: string;
  name: string;
  qty: string;
  expectedUnitCost: string;
  receivedUnitCost: string;
  differenceUnitCost: string;
  differenceAmount: string;
};

/**
 * Compare the PO's frozen base-unit price with the received inventory cost
 * (after line discounts and recoverable input tax). Batch-split receipt lines
 * are combined by quantity so the operator sees one variance per product.
 */
export function findPurchaseOrderPriceVariances(
  orderLines: readonly { productId: string; productName?: string | null; unitCost: MoneyInput }[],
  receiptLines: readonly {
    productId: string;
    name?: string | null;
    qty: MoneyInput;
    stockUnitCost: MoneyInput;
  }[],
): PurchaseOrderPriceVariance[] {
  const orderByProduct = new Map(orderLines.map((line) => [line.productId, line]));
  const receivedByProduct = new Map<
    string,
    { qty: ReturnType<typeof d>; value: ReturnType<typeof d>; name: string }
  >();

  for (const line of receiptLines) {
    const qty = d(line.qty);
    if (!qty.gt(0)) continue;
    const row = receivedByProduct.get(line.productId) ?? {
      qty: d(0),
      value: d(0),
      name: line.name ?? line.productId,
    };
    row.qty = row.qty.plus(qty);
    row.value = row.value.plus(qty.mul(d(toDb(line.stockUnitCost))));
    receivedByProduct.set(line.productId, row);
  }

  const variances: PurchaseOrderPriceVariance[] = [];
  for (const [productId, received] of receivedByProduct) {
    const orderLine = orderByProduct.get(productId);
    if (!orderLine) continue; // The domain separately rejects products outside the PO.

    const expectedUnitCost = d(toDb(orderLine.unitCost));
    const receivedUnitCost = d(toDb(received.value.div(received.qty)));
    const differenceUnitCost = receivedUnitCost.minus(expectedUnitCost);
    if (differenceUnitCost.isZero()) continue;

    variances.push({
      productId,
      name: orderLine.productName ?? received.name,
      qty: toDb(received.qty),
      expectedUnitCost: toDb(expectedUnitCost),
      receivedUnitCost: toDb(receivedUnitCost),
      differenceUnitCost: toDb(differenceUnitCost),
      differenceAmount: toDb(received.value.minus(expectedUnitCost.mul(received.qty))),
    });
  }
  return variances;
}
