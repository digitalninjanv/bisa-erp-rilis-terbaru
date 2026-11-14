import { and, count, desc, eq, ilike, inArray, isNotNull, or } from "drizzle-orm";
import type { Tx } from "@/db";
import { purchaseOrders, stockReceiptLines, stockReceipts, suppliers } from "@/db/schema";
import { normalizePageParams, pageOffset, pageResult } from "@/lib/pagination";

export function getPurchaseOrderSupplierTerms(tx: Tx, companyId: string, orderId: string) {
  return tx.select({ paymentTermDays: suppliers.paymentTermDays }).from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, orderId))).limit(1);
}
export function getReceiptPurchaseOrderNumber(tx: Tx, companyId: string, receiptId: string) {
  return tx.select({ number: purchaseOrders.number }).from(stockReceipts)
    .innerJoin(purchaseOrders, eq(stockReceipts.purchaseOrderId, purchaseOrders.id))
    .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.id, receiptId))).limit(1);
}
export async function listReceiptSourceDocuments(tx: Tx, companyId: string, receiptLineIds: string[]) {
  if (receiptLineIds.length === 0) return [];
  const rows = await tx.select({ receiptNumber: stockReceipts.number, purchaseOrderNumber: purchaseOrders.number })
    .from(stockReceiptLines).innerJoin(stockReceipts, eq(stockReceiptLines.receiptId, stockReceipts.id))
    .leftJoin(purchaseOrders, eq(stockReceipts.purchaseOrderId, purchaseOrders.id))
    .where(and(eq(stockReceiptLines.companyId, companyId), inArray(stockReceiptLines.id, receiptLineIds)));
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.receiptNumber)) return false;
    seen.add(row.receiptNumber);
    return true;
  });
}
export async function listSupplierReturnReceiptOptions(
  tx: Tx,
  companyId: string,
  input: { page?: number; pageSize?: number; q?: string } = {},
) {
  const { page, pageSize } = normalizePageParams(input, 20);
  const q = input.q?.trim();
  const where = and(
    eq(stockReceipts.companyId, companyId),
    eq(stockReceipts.status, "posted"),
    eq(stockReceipts.source, "purchase"),
    isNotNull(stockReceipts.supplierId),
    q
      ? or(
          ilike(stockReceipts.number, `%${q}%`),
          ilike(stockReceipts.supplierInvoiceNumber, `%${q}%`),
          ilike(suppliers.name, `%${q}%`),
        )
      : undefined,
  );
  const [totalRow] = await tx
    .select({ value: count() })
    .from(stockReceipts)
    .innerJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .where(where);
  const rows = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      supplierInvoiceNumber: stockReceipts.supplierInvoiceNumber,
      date: stockReceipts.date,
      supplierName: suppliers.name,
      poNumber: purchaseOrders.number,
    })
    .from(stockReceipts)
    .innerJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .leftJoin(purchaseOrders, eq(stockReceipts.purchaseOrderId, purchaseOrders.id))
    .where(where)
    .orderBy(desc(stockReceipts.date), desc(stockReceipts.createdAt))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));
  return pageResult(rows, totalRow?.value ?? 0, page, pageSize);
}
