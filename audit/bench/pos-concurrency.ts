/**
 * Audit-only POS checkout concurrency probe: same-product contention,
 * idempotency replay, and stock consistency. Disposable DB only.
 */
import { and, eq, sql } from "drizzle-orm";
import { withCompany, withCompanyReadOnly } from "../../src/db/tenant";
import { paymentMethods, products, warehouses } from "../../src/db/schema";
import { createSale } from "../../src/server/pos/sales-create";
import { todayISO } from "../../src/lib/format";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const date = todayISO();

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    n: values.length,
    p50: Number(p(0.5).toFixed(1)),
    p95: Number(p(0.95).toFixed(1)),
    max: Number(Math.max(...values).toFixed(1)),
  };
}

async function main() {
  const setup = await withCompanyReadOnly(ORG, async (tx) => {
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
      .limit(1);
    const [method] = await tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG), eq(paymentMethods.type, "cash")))
      .limit(1);
    const rows = await tx.execute(sql`
      select p.id, p.name, soh.qty::text as qty
      from ${products} p
      join stock_on_hand soh on soh.product_id = p.id and soh.company_id = p.company_id
      where p.company_id = ${ORG} and p.is_active and p.track_stock and not p.track_serial and not p.track_batch
        and soh.warehouse_id = ${warehouse?.id ?? ""}
      order by soh.qty desc
      limit 1
    `);
    const row = (rows as unknown as Array<{ id: string; name: string; qty: string }>)[0];
    return { warehouseId: warehouse?.id ?? "", methodId: method?.id ?? "", row };
  });
  if (!setup.warehouseId || !setup.methodId || !setup.row) throw new Error("fixture incomplete");
  const productId = setup.row.id;

  const stockOf = async () =>
    withCompanyReadOnly(ORG, async (tx) => {
      const rows = await tx.execute(sql`
        select qty::text as qty from stock_on_hand
        where company_id = ${ORG} and warehouse_id = ${setup.warehouseId} and product_id = ${productId}
      `);
      return Number((rows as unknown as Array<{ qty: string }>)[0]?.qty ?? 0);
    });

  const sell = (key: string) =>
    withCompany(ORG, (tx) =>
      createSale(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: setup.warehouseId,
        date,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: setup.methodId, amount: 1_000_000, tendered: 1_000_000 }],
        idempotencyKey: key,
      }),
    );

  const before = await stockOf();

  const CONC = Number(process.env.POS_CONCURRENCY ?? 20);
  const sequential: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const t = performance.now();
    await sell(crypto.randomUUID());
    sequential.push(performance.now() - t);
  }

  const concurrentKeys = Array.from({ length: CONC }, () => crypto.randomUUID());
  const concurrent = await Promise.allSettled(
    concurrentKeys.map(async (key) => {
      const t = performance.now();
      await sell(key);
      return performance.now() - t;
    }),
  );

  const replayKey = crypto.randomUUID();
  const replay = await Promise.allSettled(
    Array.from({ length: 8 }, async () => {
      const t = performance.now();
      const sale = await sell(replayKey);
      return { ms: performance.now() - t, id: sale.id };
    }),
  );

  const after = await stockOf();
  const replayIds = new Set(
    replay.filter((r): r is PromiseFulfilledResult<{ ms: number; id: string }> => r.status === "fulfilled").map((r) => r.value.id),
  );
  const replayCount = await withCompanyReadOnly(ORG, async (tx) => {
    const rows = await tx.execute(sql`select count(*)::int as n from sales where company_id = ${ORG} and idempotency_key = ${replayKey}`);
    return (rows as unknown as Array<{ n: number }>)[0].n;
  });

  console.log(
    JSON.stringify(
      {
        product: setup.row.name,
        stockBefore: before,
        stockAfter: after,
        sold: 5 + concurrentKeys.length + 1,
        stockDelta: after - before,
        sequential: summary(sequential),
        concurrent: {
          fulfilled: concurrent.filter((r) => r.status === "fulfilled").length,
          rejected: concurrent.filter((r) => r.status === "rejected").length,
          timings: summary(
            concurrent
              .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
              .map((r) => r.value),
          ),
          errors: concurrent
            .filter((r): r is PromiseRejectedResult => r.status === "rejected")
            .map((r) => String(r.reason?.message ?? r.reason).slice(0, 160)),
        },
        idempotencyReplay: {
          calls: replay.length,
          fulfilled: replay.filter((r) => r.status === "fulfilled").length,
          distinctSaleIds: replayIds.size,
          salesRowsWithKey: replayCount,
          timings: summary(
            replay
              .filter((r): r is PromiseFulfilledResult<{ ms: number; id: string }> => r.status === "fulfilled")
              .map((r) => r.value.ms),
          ),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
