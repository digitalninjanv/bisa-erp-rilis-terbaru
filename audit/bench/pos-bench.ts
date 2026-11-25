/**
 * Audit-only POS hot-path benchmark against a disposable seeded database.
 * Run with DATABASE_URL/DIRECT_URL pointing to the test DB and .env.local
 * available for env validation.
 */
import { and, asc, eq } from "drizzle-orm";
import { withCompany, withCompanyReadOnly } from "../../src/db/tenant";
import { paymentMethods, products, warehouses } from "../../src/db/schema";
import { searchProducts } from "../../src/server/catalog";
import { quoteCart } from "../../src/server/pos/quote";
import { createSale } from "../../src/server/pos/sales-create";
import { todayISO } from "../../src/lib/format";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const date = todayISO();

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
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
    const rows = await tx
      .select({ id: products.id, name: products.name, barcode: products.barcode, salePrice: products.salePrice })
      .from(products)
      .where(eq(products.companyId, ORG))
      .orderBy(asc(products.name))
      .limit(20);
    return { warehouseId: warehouse?.id ?? "", methodId: method?.id ?? "", rows };
  });
  if (!setup.warehouseId || !setup.methodId || setup.rows.length < 20) {
    throw new Error("seed fixture incomplete");
  }
  const barcode = setup.rows[0].barcode!;
  const ids = setup.rows.map((row) => row.id);

  const search = async (q: string, exactCode: boolean) =>
    time(() => withCompanyReadOnly(ORG, (tx) => searchProducts(tx, {
      companyId: ORG,
      warehouseId: setup.warehouseId,
      q,
      limit: exactCode ? 1 : 24,
      exactCode,
    })));
  const quote = async (count: number) =>
    time(() => withCompanyReadOnly(ORG, (tx) => quoteCart(tx, {
      companyId: ORG,
      warehouseId: setup.warehouseId,
      lines: ids.slice(0, count).map((productId) => ({ productId, qty: 1 })),
      canDiscount: true,
    })));

  const out: Record<string, { n: number; p50: number; p95: number; max: number }> = {};
  async function run(label: string, n: number, fn: () => Promise<{ ms: number }>) {
    const values: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const { ms } = await fn();
      values.push(ms);
    }
    out[label] = {
      n,
      p50: Number(pct(values, 50).toFixed(2)),
      p95: Number(pct(values, 95).toFixed(2)),
      max: Number(Math.max(...values).toFixed(2)),
    };
  }

  await run("search_exact_barcode", 60, () => search(barcode, true));
  await run("search_name_Aqua", 60, () => search("Aqua", false));
  await run("search_empty_page", 60, () => search("", false));
  await run("quote_1_line", 40, () => quote(1));
  await run("quote_5_lines", 40, () => quote(5));
  await run("quote_20_lines", 40, () => quote(20));

  const checkoutValues: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const { ms } = await time(() => withCompany(ORG, (tx) => createSale(tx, {
      companyId: ORG,
      userId: USER,
      warehouseId: setup.warehouseId,
      date,
      lines: [{ productId: ids[0], qty: 1 }],
      payments: [{ methodId: setup.methodId, amount: 1_000_000, tendered: 1_000_000 }],
      idempotencyKey: crypto.randomUUID(),
    })));
    checkoutValues.push(ms);
  }
  out.checkout_1_line = {
    n: checkoutValues.length,
    p50: Number(pct(checkoutValues, 50).toFixed(2)),
    p95: Number(pct(checkoutValues, 95).toFixed(2)),
    max: Number(Math.max(...checkoutValues).toFixed(2)),
  };

  console.log(JSON.stringify({ org: ORG, productCount: 10200, results: out }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
