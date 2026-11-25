import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashMovements, saleLines, saleReturnLines, saleReturns } from "@/db/schema";
import { d, type Decimal } from "@/lib/money";

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

export async function listRecentSaleReturns(tx: Tx, companyId: string, limit = 20) {
  return tx
    .select({
      id: saleReturns.id,
      number: saleReturns.number,
      date: saleReturns.date,
      type: saleReturns.type,
      refundMethod: saleReturns.refundMethod,
      total: saleReturns.total,
      creditUsed: saleReturns.creditUsed,
      reason: saleReturns.reason,
      saleNumber: sql<string>`(select number from sales s where s.id = ${saleReturns.saleId})`,
    })
    .from(saleReturns)
    .where(eq(saleReturns.companyId, companyId))
    .orderBy(desc(saleReturns.createdAt))
    .limit(limit);
}

export async function getReturnedQtyByProduct(tx: Tx, companyId: string, saleId: string) {
  const rows = await tx.execute(sql`
    select srl.product_id, coalesce(sum(srl.qty), 0) as qty
    from sale_return_lines srl
    join sale_returns sr on sr.id = srl.return_id
    where sr.company_id = ${companyId} and sr.sale_id = ${saleId}
    group by srl.product_id
  `);
  return new Map(
    (rows as unknown as { product_id: string; qty: string }[]).map((row) => [
      row.product_id,
      Number(row.qty),
    ]),
  );
}

export async function getReturnedQtyBySaleLine(
  tx: Tx,
  companyId: string,
  saleId: string,
) {
  const originalLines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(saleLines.lineNo));
  const rows = await tx
    .select({
      saleLineId: saleReturnLines.saleLineId,
      productId: saleReturnLines.productId,
      qty: saleReturnLines.qty,
    })
    .from(saleReturnLines)
    .innerJoin(saleReturns, eq(saleReturnLines.returnId, saleReturns.id))
    .where(and(eq(saleReturns.companyId, companyId), eq(saleReturns.saleId, saleId)));
  const attributed = attributeReturnedByLine(originalLines, rows);
  return new Map([...attributed.entries()].map(([id, qty]) => [id, qty.toNumber()]));
}

export function attributeReturnedByLine(
  originalLines: (typeof saleLines.$inferSelect)[],
  rows: { saleLineId: string | null; productId: string; qty: string }[],
): Map<string, Decimal> {
  const byProduct = new Map<string, (typeof saleLines.$inferSelect)[]>();
  for (const line of originalLines) {
    const list = byProduct.get(line.productId) ?? [];
    list.push(line);
    byProduct.set(line.productId, list);
  }
  const result = new Map<string, Decimal>();
  for (const row of rows) {
    let targetId = row.saleLineId;
    if (!targetId) {
      const candidates = byProduct.get(row.productId) ?? [];
      if (candidates.length === 1) targetId = candidates[0].id;
    }
    if (!targetId) continue;
    result.set(targetId, (result.get(targetId) ?? d(0)).plus(d(row.qty)));
  }
  return result;
}
