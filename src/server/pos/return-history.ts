import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashMovements, saleReturnLines, saleReturns } from "@/db/schema";

/** Dokumen retur dan rincian penyelesaian untuk riwayat satu nota POS. */
export async function listSaleReturnHistory(tx: Tx, companyId: string, saleId: string) {
  const documents = await tx
    .select({
      id: saleReturns.id,
      number: saleReturns.number,
      date: saleReturns.date,
      createdAt: saleReturns.createdAt,
      type: saleReturns.type,
      status: saleReturns.status,
      refundMethod: saleReturns.refundMethod,
      disposition: saleReturns.disposition,
      total: saleReturns.total,
      creditUsed: saleReturns.creditUsed,
      reason: saleReturns.reason,
    })
    .from(saleReturns)
    .where(and(eq(saleReturns.companyId, companyId), eq(saleReturns.saleId, saleId)))
    .orderBy(desc(saleReturns.createdAt), desc(saleReturns.id));

  if (documents.length === 0) return [];

  const [lines, cashRows] = await Promise.all([
    tx
      .select({
        returnId: saleReturnLines.returnId,
        productName: saleReturnLines.productName,
        qtyInput: saleReturnLines.qtyInput,
        lineTotal: saleReturnLines.lineTotal,
      })
      .from(saleReturnLines)
      .where(and(
        eq(saleReturnLines.companyId, companyId),
        inArray(saleReturnLines.returnId, documents.map((document) => document.id)),
      )),
    tx
      .select({
        returnId: cashMovements.referenceId,
        amount: sql<string>`coalesce(sum(abs(${cashMovements.amount})), 0)`,
      })
      .from(cashMovements)
      .where(and(
        eq(cashMovements.companyId, companyId),
        eq(cashMovements.referenceType, "sale_return"),
        inArray(cashMovements.referenceId, documents.map((document) => document.id)),
      ))
      .groupBy(cashMovements.referenceId),
  ]);
  const linesByReturn = new Map<string, typeof lines>();
  for (const line of lines) {
    const current = linesByReturn.get(line.returnId) ?? [];
    current.push(line);
    linesByReturn.set(line.returnId, current);
  }
  const cashRefundByReturn = new Map(
    cashRows.flatMap((row) => row.returnId ? [[row.returnId, row.amount] as const] : []),
  );

  return documents.map((document) => ({
    ...document,
    lines: linesByReturn.get(document.id) ?? [],
    cashRefunded: cashRefundByReturn.get(document.id) ?? "0",
  }));
}
