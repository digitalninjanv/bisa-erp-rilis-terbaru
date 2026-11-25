/** Audit-only probe: opposite cart order must not deadlock (POS-009). */
import { and, eq, sql } from "drizzle-orm";
import { withCompany, withCompanyReadOnly } from "../../src/db/tenant";
import { paymentMethods, warehouses } from "../../src/db/schema";
import { createSale } from "../../src/server/pos/sales-create";
import { todayISO } from "../../src/lib/format";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const date = todayISO();
const CONC = Number(process.env.POS_CONCURRENCY ?? 16);

async function main() {
  const setup = await withCompanyReadOnly(ORG, async (tx) => {
    const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true))).limit(1);
    const [method] = await tx.select({ id: paymentMethods.id }).from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG), eq(paymentMethods.type, "cash"))).limit(1);
    const rows = await tx.execute(sql`
      select p.id, p.name, soh.qty::text as qty
      from products p join stock_on_hand soh on soh.product_id = p.id and soh.company_id = p.company_id
      where p.company_id = ${ORG} and p.is_active and p.track_stock and not p.track_serial and not p.track_batch
        and soh.warehouse_id = ${warehouse?.id ?? ""}
      order by soh.qty desc limit 2
    `);
    return {
      warehouseId: warehouse?.id ?? "",
      methodId: method?.id ?? "",
      rows: rows as unknown as Array<{ id: string; name: string; qty: string }>,
    };
  });
  if (setup.rows.length < 2) throw new Error("fixture incomplete");
  const [a, b] = setup.rows;

  const results = await Promise.allSettled(
    Array.from({ length: CONC }, (_, index) => {
      const lines = index % 2 === 0
        ? [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }]
        : [{ productId: b.id, qty: 1 }, { productId: a.id, qty: 1 }];
      const t = performance.now();
      return withCompany(ORG, (tx) =>
        createSale(tx, {
          companyId: ORG,
          userId: USER,
          warehouseId: setup.warehouseId,
          date,
          lines,
          payments: [{ methodId: setup.methodId, amount: 1_000_000, tendered: 1_000_000 }],
          idempotencyKey: crypto.randomUUID(),
        }),
      ).then((sale) => ({ ms: performance.now() - t, id: sale.id }));
    }),
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  console.log(JSON.stringify({
    products: [a.name, b.name],
    stockBefore: [Number(a.qty), Number(b.qty)],
    calls: CONC,
    fulfilled: ok.length,
    rejected: failed.length,
    errors: failed.map((r) => String(r.reason?.message ?? r.reason).slice(0, 200)),
    timings: {
      p50: Number(ok.map((r) => r.value.ms).sort((x, y) => x - y)[Math.floor(ok.length / 2)]?.toFixed(1) ?? 0),
      max: Number(Math.max(0, ...ok.map((r) => r.value.ms)).toFixed(1)),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
