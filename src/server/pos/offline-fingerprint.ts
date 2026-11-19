import type { OfflineSalePayload } from "@/lib/pos-offline";
import { paymentRequestFingerprint } from "@/server/idempotency";

/** Match a web checkout whose response was lost before the sale entered the offline queue. */
export function matchesWebCheckoutFingerprint(
  companyId: string,
  userId: string,
  item: OfflineSalePayload,
  fingerprint: string | null | undefined,
): boolean {
  if (!fingerprint) return false;
  return [false, true].some((canDiscount) => fingerprint === paymentRequestFingerprint({
    companyId,
    userId,
    warehouseId: item.warehouseId,
    customerId: item.customerId ?? undefined,
    dueDate: item.dueDate ?? undefined,
    groupId: item.groupId ?? null,
    reservationId: item.reservationId ?? null,
    heldSaleId: item.heldSaleId ?? null,
    idempotencyKey: item.clientKey,
    canDiscount,
    lines: item.lines.map(({ productId, qty, packagingId, discountType, discountValue, serialNumbers }) => ({
      productId, qty: String(qty), packagingId: packagingId ?? null,
      discountType: discountType ?? null, discountValue: discountValue ?? 0, serialNumbers,
    })),
    payments: item.payments,
  }));
}

export function offlineSaleRequestFingerprint(item: OfflineSalePayload): string {
  return paymentRequestFingerprint({
    channel: "offline",
    warehouseId: item.warehouseId,
    heldSaleId: item.heldSaleId ?? null,
    groupId: item.groupId ?? null,
    customerId: item.customerId ?? null,
    dueDate: item.dueDate ?? null,
    date: item.date,
    lines: item.lines,
    payments: item.payments,
    cashierId: item.cashierId ?? null,
    originSessionId: item.originSessionId ?? null,
    deviceId: item.deviceId ?? null,
    expectedTotal: item.expectedTotal ?? null,
  });
}
