/** Audit-only searchProducts latency by term shape (10.2k products). */
import { and, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "../../src/db/tenant";
import { warehouses } from "../../src/db/schema";
import { searchProducts } from "../../src/server/catalog";

const ORG = "01900000-0000-7000-8000-000000000001";

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: Number(p(0.5).toFixed(2)), p95: Number(p(0.95).toFixed(2)), max: Number(Math.max(...values).toFixed(2)) };
}

async function main() {
  const warehouseId = await withCompanyReadOnly(ORG, async (tx) => {
    const [row] = await tx.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true))).limit(1);
    return row?.id ?? "";
  });
  const terms = [
    { label: "one_char_a", q: "a", exact: false },
    { label: "two_char_ab", q: "ab", exact: false },
    { label: "three_char_aqu", q: "aqu", exact: false },
    { label: "word_Aqua", q: "Aqua", exact: false },
    { label: "word_indomie", q: "Indomie", exact: false },
    { label: "sku_prefix_SKU-00", q: "SKU-00", exact: false },
    { label: "sku_exact", q: "SKU-00001", exact: true },
    { label: "barcode_exact", q: "8991000000001", exact: true },
  ];
  if (process.env.POS_EXTRA_BARCODE) {
    terms.push({ label: "barcode_late", q: process.env.POS_EXTRA_BARCODE, exact: true });
  }
  if (process.env.POS_EXTRA_SKU) {
    terms.push({ label: "sku_late", q: process.env.POS_EXTRA_SKU, exact: true });
  }
  const out: Record<string, unknown> = {};
  for (const term of terms) {
    const values: number[] = [];
    let count = 0;
    for (let i = 0; i < 40; i += 1) {
      const t = performance.now();
      const rows = await withCompanyReadOnly(ORG, (tx) =>
        searchProducts(tx, {
          companyId: ORG,
          warehouseId,
          q: term.q,
          limit: term.exact ? 1 : 24,
          exactCode: term.exact,
        }),
      );
      values.push(performance.now() - t);
      count = rows.length;
    }
    out[term.label] = { n: count, ...stats(values) };
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
