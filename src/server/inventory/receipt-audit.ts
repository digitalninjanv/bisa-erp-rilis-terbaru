import type { Tx } from "@/db";
import { toDb, type Decimal } from "@/lib/money";
import type { findPurchaseOrderPriceVariances } from "@/lib/purchase-order-price-variance";
import { writeAudit } from "@/server/audit";
import type { ReceiptSource } from "./receipt-journal";

export async function auditPostedReceipt(tx: Tx, input: {
  companyId: string;
  userId: string;
  receipt: { id: string; number: string };
  source: ReceiptSource;
  total: Decimal;
  totalTax: Decimal;
  purchaseOrderNumber?: string;
  priceVarianceReason: string | null | undefined;
  priceVariances: ReturnType<typeof findPurchaseOrderPriceVariances>;
}) {
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase.receive",
    entityType: "stock_receipt",
    entityId: input.receipt.id,
    after: {
      number: input.receipt.number,
      source: input.source,
      total: toDb(input.total),
      ...(input.totalTax.gt(0) ? { taxAmount: toDb(input.totalTax) } : {}),
      ...(input.purchaseOrderNumber
        ? { purchaseOrderNumber: input.purchaseOrderNumber }
        : {}),
      ...(input.priceVariances.length > 0
        ? {
            priceVarianceReason: input.priceVarianceReason,
            priceVariances: input.priceVariances.map((row) => ({
              productId: row.productId,
              qty: row.qty,
              expectedUnitCost: row.expectedUnitCost,
              receivedUnitCost: row.receivedUnitCost,
              differenceAmount: row.differenceAmount,
            })),
          }
        : {}),
    },
  });
}
