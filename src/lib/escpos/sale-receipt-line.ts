import { d, type MoneyInput } from "@/lib/money";
import type { ReceiptLineItem } from "./types";

/** Stored sale quantities are base units; receipts show the unit the customer bought. */
export function saleReceiptLine(line: {
  productName: string;
  packagingId: string | null;
  packagingName: string | null;
  qty: MoneyInput;
  qtyInput: MoneyInput;
  isiSnapshot: MoneyInput;
  unitPrice: MoneyInput;
  lineTotal: MoneyInput;
  discountAmount: MoneyInput;
}): ReceiptLineItem {
  return {
    name: line.packagingName ? `${line.productName} (${line.packagingName})` : line.productName,
    qty: d(line.packagingId ? line.qtyInput : line.qty).toNumber(),
    qtyBase: d(line.qty).toNumber(),
    unit: line.packagingName,
    price: d(line.unitPrice).mul(line.packagingId ? d(line.isiSnapshot) : 1).toNumber(),
    subtotal: d(line.lineTotal).toNumber(),
    discount: d(line.discountAmount).toNumber(),
  };
}
