import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { purchaseOrders, stockReceiptLines, stockReceipts, suppliers } from "@/db/schema";

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
export function listSupplierReturnReceiptOptions(tx: Tx, companyId: string) {
  return tx.select({ id: stockReceipts.id, number: stockReceipts.number, date: stockReceipts.date, supplierName: suppliers.name, poNumber: purchaseOrders.number })
    .from(stockReceipts).leftJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .leftJoin(purchaseOrders, eq(stockReceipts.purchaseOrderId, purchaseOrders.id))
    .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.status, "posted")))
    .orderBy(desc(stockReceipts.date), desc(stockReceipts.createdAt)).limit(100);
}
