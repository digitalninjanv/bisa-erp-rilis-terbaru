import { and, count, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db";
import { purchaseOrders, stockReceiptLines, stockReceipts, suppliers } from "@/db/schema";
import { d } from "@/lib/money";
import { normalizePageParams, pageOffset, pageResult } from "@/lib/pagination";
import { POSTED_RETURN_STATUSES } from "@/lib/supplier-return-status";

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
  const postedStatuses = sql.join(POSTED_RETURN_STATUSES.map((status) => sql`${status}`), sql`, `);
  const hasReturnableLine = sql`exists (
    select 1
    from stock_receipt_lines returnable_line
    where returnable_line.company_id = ${companyId}
      and returnable_line.receipt_id = ${stockReceipts.id}
      and returnable_line.qty > coalesce((
        select sum(return_line.qty)
        from supplier_return_lines return_line
        inner join supplier_returns return_doc on return_doc.id = return_line.return_id
        where return_line.company_id = ${companyId}
          and return_line.receipt_line_id = returnable_line.id
          and return_doc.company_id = ${companyId}
          and return_doc.status in (${postedStatuses})
      ), 0)
  )`;
  const where = and(
    eq(stockReceipts.companyId, companyId),
    eq(stockReceipts.status, "posted"),
    eq(stockReceipts.source, "purchase"),
    isNotNull(stockReceipts.supplierId),
    hasReturnableLine,
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
  const receiptIds = rows.map((row) => row.id);
  const availabilityLine = alias(stockReceiptLines, "availability_line");
  // Drizzle shortens this outer-column reference inside the raw SQL
  // fragment to `"id"`; qualify the fixed alias to avoid ambiguity with
  // `return_line.id` and `return_doc.id` in the correlated subquery.
  const availabilityLineId = sql.raw('"availability_line"."id"');
  const availabilityRows = receiptIds.length === 0
    ? []
    : await tx
        .select({
          receiptId: availabilityLine.receiptId,
          availableQty: sql<string>`coalesce(sum(greatest(${availabilityLine.qty} - coalesce((
            select sum(return_line.qty)
            from supplier_return_lines return_line
            inner join supplier_returns return_doc on return_doc.id = return_line.return_id
            where return_line.company_id = ${companyId}
              and return_line.receipt_line_id = ${availabilityLineId}
              and return_doc.company_id = ${companyId}
              and return_doc.status in (${postedStatuses})
          ), 0), 0)), 0)`,
        })
        .from(availabilityLine)
        .where(and(eq(availabilityLine.companyId, companyId), inArray(availabilityLine.receiptId, receiptIds)))
        .groupBy(availabilityLine.receiptId);
  const availableByReceipt = new Map(availabilityRows.map((row) => [row.receiptId, row.availableQty]));
  return pageResult(
    rows.map((row) => ({ ...row, availableQty: availableByReceipt.get(row.id) ?? "0" })),
    totalRow?.value ?? 0,
    page,
    pageSize,
  );
}

/** Returnable quantity by source receipt line, in base units. The final
 * posting path recalculates and enforces this under its transaction lock. */
export async function getSupplierReturnableQtyByReceiptLine(
  tx: Tx,
  companyId: string,
  receiptLineIds: string[],
) {
  if (receiptLineIds.length === 0) return new Map<string, string>();
  const postedStatuses = sql.join(POSTED_RETURN_STATUSES.map((status) => sql`${status}`), sql`, `);
  const rows = await tx
    .select({
      id: stockReceiptLines.id,
      qty: stockReceiptLines.qty,
      returnedQty: sql<string>`coalesce((
        select sum(return_line.qty)
        from supplier_return_lines return_line
        inner join supplier_returns return_doc on return_doc.id = return_line.return_id
        where return_line.company_id = ${companyId}
          and return_line.receipt_line_id = ${stockReceiptLines.id}
          and return_doc.company_id = ${companyId}
          and return_doc.status in (${postedStatuses})
      ), 0)`,
    })
    .from(stockReceiptLines)
    .where(and(eq(stockReceiptLines.companyId, companyId), inArray(stockReceiptLines.id, receiptLineIds)));
  return new Map(
    rows.map((row) => {
      const remaining = d(row.qty).minus(d(row.returnedQty));
      return [row.id, (remaining.gt(0) ? remaining : d(0)).toFixed(4)];
    }),
  );
}
