import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { customers, saleReturnLines, saleReturns, sales } from "@/db/schema";
import { getSettings } from "@/server/catalog";

/** Data bukti retur untuk halaman cetak; halaman tidak mengueri inline. */
export async function getSaleReturnVoucher(
  tx: Tx,
  companyId: string,
  returnId: string,
) {
  const [row] = await tx
    .select({
      ret: saleReturns,
      sale: sales,
      customer: customers,
    })
    .from(saleReturns)
    .innerJoin(
      sales,
      and(eq(sales.companyId, saleReturns.companyId), eq(sales.id, saleReturns.saleId)),
    )
    .leftJoin(
      customers,
      and(
        eq(customers.companyId, saleReturns.companyId),
        eq(customers.id, sales.customerId),
      ),
    )
    .where(and(eq(saleReturns.companyId, companyId), eq(saleReturns.id, returnId)))
    .limit(1);
  if (!row) return null;
  const [lines, settings] = await Promise.all([
    tx
      .select()
      .from(saleReturnLines)
      .where(
        and(
          eq(saleReturnLines.companyId, companyId),
          eq(saleReturnLines.returnId, returnId),
        ),
      )
      .orderBy(asc(saleReturnLines.id)),
    getSettings(tx, companyId),
  ]);
  return { ...row, lines, settings };
}
