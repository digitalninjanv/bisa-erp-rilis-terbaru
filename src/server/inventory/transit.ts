import { sql, type SQLWrapper } from "drizzle-orm";

/** Owned stock between the two transfer legs, reconstructed as-of from
 * append-only movements. Void mirrors count; loss legs do not count as transit. */
export function stockTransitSql(companyId: string, productId: SQLWrapper, measure: "qty" | "value", asOf?: string) {
  const amount = measure === "qty" ? sql`sm.qty` : sql`sm.qty * sm.unit_cost`;
  return sql<string>`coalesce((
    select sum(pending.amount) from (
      select greatest(0, -sum(${amount})) as amount
      from stock_movements sm
      where sm.company_id = ${companyId} and sm.product_id = ${productId}
        ${asOf ? sql`and sm.date <= ${asOf}::date` : sql``}
        and (sm.movement_type in ('transfer_out', 'transfer_in')
          or (sm.reference_type = 'stock_document_void' and exists (
            select 1 from stock_documents sd where sd.id = sm.reference_id
              and sd.company_id = sm.company_id and sd.type = 'transfer'
          )))
      group by sm.reference_id
    ) pending
  ), 0)`;
}
