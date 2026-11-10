import { performance } from "node:perf_hooks";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { adminDb, adminSql } from "../../src/db/admin";
import { withCompany, withCompanyReadOnly } from "../../src/db/tenant";
import {
  account as authAccount,
  accounts,
  accountMappings,
  companySettings,
  member,
  organization,
  paymentMethods,
  products,
  stockOnHand,
  user,
  warehouses,
} from "../../src/db/schema";
import { ensureFiscalPeriods } from "../../src/server/accounting";
import { createSale, openCashSession, quoteCart } from "../../src/server/pos";
import { listProducts, searchProducts } from "../../src/server/catalog/products";
import { getInventoryValuation } from "../../src/server/reports/inventory";
import { listSales } from "../../src/server/reports/sales";
import { getIncomeStatement, getTrialBalance } from "../../src/server/reports/statements";
import { getLedger } from "../../src/server/reports/ledger";

/**
 * Program Audit Produksi — Tahap A3 (butir performa): uji volume
 * TERUKUR pada perusahaan fixture buangan (…a302):
 *   ±10.000 produk, 25.000 penjualan / 100.000 baris penjualan,
 *   50.000 baris jurnal, 10.000 baris stok — semua ditulis SQL massal
 *   (bukan jalur domain; yang diukur adalah perilaku BACA & tulis
 *   domain di atas volume itu, bukan kecepatan seed).
 *
 * Mode: generate | measure | concurrency | wipe
 *   pnpm tsx --env-file=.env.local scripts/audit/bench-a3-volume.ts <mode>
 *
 * Perusahaan fixture dihapus TOTAL oleh mode wipe (pola A2:
 * information_schema). Data demo tidak pernah disentuh. Angka yang
 * dicetak adalah angka mesin dev ini — BUKAN klaim kapasitas produksi.
 */

const ORG = "01900000-0000-7000-8000-00000000a302";
const USER_ID = "01900000-0000-7000-8000-00000000a312";
const EMAIL = "volume.a3@uji.local";
const PASSWORD = "VolumeA3!uji";
const PRODUCTS = 10_000;
const SALES = 25_000;
const LINES_PER_SALE = 4;
const YEAR = { from: "2025-01-01", to: "2025-12-31" };

type Tx = Parameters<Parameters<typeof withCompany>[1]>[0];

async function wipe() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    const tables = await tx.unsafe<{ tablename: string }[]>(
      `SELECT c.table_name AS tablename FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`,
    );
    for (const { tablename } of tables) {
      await tx.unsafe(`DELETE FROM "${tablename}" WHERE company_id = $1`, [ORG]);
    }
    await tx.unsafe(`DELETE FROM session WHERE user_id = $1`, [USER_ID]);
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM account WHERE user_id = $1`, [USER_ID]);
    await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [USER_ID]);
  });
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  console.log(`  ${label}: ${((performance.now() - start) / 1000).toFixed(2)} dtk`);
  return result;
}

async function generate() {
  await wipe();
  const totalStart = performance.now();
  await adminDb.insert(organization).values({ id: ORG, name: "Volume Mart A3", slug: "volume-a3" });
  await adminDb.insert(user).values({ id: USER_ID, name: "Owner Volume A3", email: EMAIL, emailVerified: true });
  const hashed = await hashPassword(PASSWORD);
  await adminDb.insert(authAccount).values({
    id: crypto.randomUUID(),
    accountId: USER_ID,
    providerId: "credential",
    userId: USER_ID,
    password: hashed,
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: USER_ID, role: "owner",
  });

  let warehouseId = "";
  let byCode = new Map<string, string>();
  await withCompany(ORG, async (tx) => {
    await tx.insert(companySettings).values({
      companyId: ORG, legalName: "Volume Mart A3", roundingMode: "none",
      taxRate: "11", taxEnabled: false,
      enabledModules: { pos: true, gudang: true, akuntansi: true, hr: true },
    });
    const seeds: Array<[string, string, string, "debit" | "credit"]> = [
      ["11001", "Kas", "asset", "debit"], ["11002", "Bank", "asset", "debit"],
      ["12001", "Piutang Usaha", "asset", "debit"], ["13001", "Persediaan", "asset", "debit"],
      ["21001", "Utang Usaha", "liability", "credit"], ["21002", "Utang Gaji", "liability", "credit"],
      ["22001", "PPN Keluaran", "liability", "credit"], ["23001", "Kredit Pihak", "liability", "credit"],
      ["31001", "Modal Pemilik", "equity", "credit"], ["41001", "Penjualan", "revenue", "credit"],
      ["41002", "Diskon Penjualan", "revenue", "debit"], ["41003", "Retur Penjualan", "revenue", "debit"],
      ["51001", "HPP", "cogs", "debit"], ["51002", "Selisih Persediaan", "cogs", "debit"],
      ["51003", "Barang Rusak", "cogs", "debit"], ["61001", "Beban Gaji", "expense", "debit"],
      ["81001", "Selisih Kas Kurang", "expense", "debit"], ["81002", "Selisih Kas Lebih", "revenue", "credit"],
      ["91001", "Pembulatan Laba", "revenue", "credit"], ["91002", "Pembulatan Rugi", "expense", "debit"],
    ];
    const rows = await tx.insert(accounts).values(
      seeds.map(([code, name, type, normalBalance]) => ({
        companyId: ORG, code, name, type, normalBalance,
        cashBankKind: code === "11001" ? "cash" : code === "11002" ? "bank" : null,
      })),
    ).returning();
    byCode = new Map(rows.map((r) => [r.code, r.id]));
    await tx.insert(accountMappings).values([
      { companyId: ORG, key: "cash", accountId: byCode.get("11001")! },
      { companyId: ORG, key: "inventory", accountId: byCode.get("13001")! },
      { companyId: ORG, key: "revenue", accountId: byCode.get("41001")! },
      { companyId: ORG, key: "cogs", accountId: byCode.get("51001")! },
      { companyId: ORG, key: "receivable", accountId: byCode.get("12001")! },
      { companyId: ORG, key: "payable", accountId: byCode.get("21001")! },
    ]);
    const [w] = await tx.insert(warehouses).values({
      companyId: ORG, code: "GD-VOL", name: "Gudang Volume", type: "warehouse", isDefault: true,
    }).returning();
    warehouseId = w.id;
    await tx.insert(paymentMethods).values({
      companyId: ORG, code: "CASH", name: "Tunai", type: "cash",
      accountId: byCode.get("11001")!, sortOrder: 1,
    });
    await ensureFiscalPeriods(tx, ORG, 2025);
    await ensureFiscalPeriods(tx, ORG, 2026);
  });

  const cashId = byCode.get("11001")!;
  const revenueId = byCode.get("41001")!;

  await timed(`${PRODUCTS} produk`, () =>
    adminSql.unsafe(
      `INSERT INTO products (company_id, sku, name, cost_price, sale_price, min_stock, track_stock, track_batch, is_active)
       SELECT $1, 'VOL-' || lpad(g::text, 5, '0'), 'Produk Volume ' || g, 3000, 5000, 0, true, false, true
       FROM generate_series(1, $2) AS g`,
      [ORG, PRODUCTS],
    ),
  );
  await timed("stok awal 10.000 baris (on_hand + movements)", async () => {
    await adminSql.unsafe(
      `INSERT INTO stock_on_hand (company_id, warehouse_id, product_id, qty)
       SELECT company_id, $2, id, 100 FROM products WHERE company_id = $1`,
      [ORG, warehouseId],
    );
    await adminSql.unsafe(
      `INSERT INTO stock_movements (company_id, warehouse_id, product_id, movement_type, date, qty, unit_cost, reference_type, created_by)
       SELECT company_id, $2, id, 'opening', DATE '2025-01-01', 100, 3000, 'opening', $3 FROM products WHERE company_id = $1`,
      [ORG, warehouseId, USER_ID],
    );
  });
  await timed(`${SALES} penjualan`, () =>
    adminSql.unsafe(
      `INSERT INTO sales (company_id, warehouse_id, number, date, due_date, cashier_id, status, subtotal, total, cost_total, paid_total, payment_status)
       SELECT $1, $2, 'VOL-S-' || lpad(g::text, 6, '0'), DATE '2025-01-01' + (g % 365), DATE '2025-01-01' + (g % 365),
              $3, 'completed', 40000, 40000, 24000, 40000, 'paid'
       FROM generate_series(1, $4) AS g`,
      [ORG, warehouseId, USER_ID, SALES],
    ),
  );
  await timed(`${SALES * LINES_PER_SALE} baris penjualan`, () =>
    adminSql.unsafe(
      `INSERT INTO sale_lines (company_id, sale_id, product_id, line_no, qty, unit_price, line_total, unit_cost, product_name, product_sku, qty_input, isi_snapshot)
       SELECT s.company_id, s.id, p.id, l, 2, 5000, 10000, 3000, p.name, p.sku, 2, 1
       FROM sales s
       JOIN LATERAL generate_series(1, 4) AS l ON true
       JOIN products p ON p.company_id = s.company_id
         AND p.sku = 'VOL-' || lpad((((substring(s.number from 7)::int - 1) * 4 + l - 1) % 10000 + 1)::text, 5, '0')
       WHERE s.company_id = $1 AND s.number LIKE 'VOL-S-%'`,
      [ORG],
    ),
  );
  await timed(`${SALES} entri jurnal + ${SALES * 2} baris jurnal`, async () => {
    await adminSql.unsafe(
      `INSERT INTO journal_entries (company_id, number, date, description, source_type, status, posted_at)
       SELECT $1, 'VOL-J-' || lpad(g::text, 6, '0'), DATE '2025-01-01' + (g % 365), 'Penjualan volume A3', 'sale', 'posted', now()
       FROM generate_series(1, $2) AS g`,
      [ORG, SALES],
    );
    await adminSql.unsafe(
      `INSERT INTO journal_lines (company_id, entry_id, account_id, debit, credit, line_no)
       SELECT $1, je.id, $2::uuid, 40000, 0, 1 FROM journal_entries je WHERE je.company_id = $1 AND je.number LIKE 'VOL-J-%'
       UNION ALL
       SELECT $1, je.id, $3::uuid, 0, 40000, 2 FROM journal_entries je WHERE je.company_id = $1 AND je.number LIKE 'VOL-J-%'`,
      [ORG, cashId, revenueId],
    );
    await adminSql.unsafe(
      `INSERT INTO account_monthly_balances (company_id, account_id, year_month, total_debit, total_credit)
       SELECT jl.company_id, jl.account_id, to_char(je.date, 'YYYY-MM'), sum(jl.debit), sum(jl.credit)
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.status = 'posted' AND jl.company_id = $1
       GROUP BY jl.company_id, jl.account_id, to_char(je.date, 'YYYY-MM')
       ON CONFLICT (company_id, account_id, year_month) DO UPDATE
         SET total_debit = EXCLUDED.total_debit, total_credit = EXCLUDED.total_credit`,
      [ORG],
    );
  });

  const counts = await adminSql.unsafe<{ products: string; sales: string; lines: string; journals: string }[]>(
    `SELECT (SELECT count(*) FROM products WHERE company_id = $1) AS products,
            (SELECT count(*) FROM sales WHERE company_id = $1) AS sales,
            (SELECT count(*) FROM sale_lines WHERE company_id = $1) AS lines,
            (SELECT count(*) FROM journal_lines WHERE company_id = $1) AS journals`,
    [ORG],
  );
  console.log(`Dataset: ${JSON.stringify(counts[0])}`);
  console.log(`TOTAL generate: ${((performance.now() - totalStart) / 1000).toFixed(2)} dtk`);
  console.log(`Kredensial HTTP: ${EMAIL} / ${PASSWORD} (perusahaan ${ORG})`);
}

async function median(label: string, fn: () => Promise<unknown>, runs = 5) {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`${label}: median ${times[Math.floor(times.length / 2)].toFixed(1)} ms (rentang ${times[0].toFixed(1)}–${times[times.length - 1].toFixed(1)})`);
}

async function measure() {
  const [w] = await adminDb.select().from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true))).limit(1);
  const [cashAcc] = await adminDb.select().from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, "11001"))).limit(1);

  await withCompanyReadOnly(ORG, async (tx) => {
    await median("listProducts halaman 1 (25 baris, 10rb produk)", () =>
      listProducts(tx, { companyId: ORG, warehouseId: w.id, page: 1, pageSize: 25 } as never));
    await median("listProducts pencarian 'Produk Volume 9999'", () =>
      listProducts(tx, { companyId: ORG, warehouseId: w.id, q: "Produk Volume 9999", page: 1, pageSize: 25 } as never));
    await median("searchProducts POS q='' (24 baris)", () =>
      searchProducts(tx, { companyId: ORG, warehouseId: w.id, q: "", limit: 24, offset: 0 }));
    await median("searchProducts POS q='Volume 9999'", () =>
      searchProducts(tx, { companyId: ORG, warehouseId: w.id, q: "Volume 9999", limit: 24, offset: 0 }));
    await median("getInventoryValuation halaman 1 (50 baris)", () =>
      getInventoryValuation(tx, ORG, undefined, { page: 1, pageSize: 50 }));
    await median("listSales halaman 1 (25 dari 25rb penjualan)", () =>
      listSales(tx, { companyId: ORG, page: 1, pageSize: 25 }));
    await median("getIncomeStatement 2025 (50rb baris jurnal)", () =>
      getIncomeStatement(tx, ORG, YEAR));
    await median("getTrialBalance 2025", () => getTrialBalance(tx, ORG, YEAR));
    await median("getLedger akun Kas 2025 halaman 1", () =>
      getLedger(tx, { companyId: ORG, accountId: cashAcc.id, from: YEAR.from, to: YEAR.to, page: 1, pageSize: 50 }));
  });

  // Titik berat kueri: EXPLAIN ANALYZE pencarian produk tanpa indeks teks.
  const explain = await adminSql.unsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
     SELECT id FROM products WHERE company_id = $1 AND (name ILIKE '%Volume 9999%' OR sku ILIKE '%Volume 9999%') LIMIT 24`,
    [ORG],
  );
  console.log("EXPLAIN pencarian produk (ILIKE %..%):");
  for (const row of explain.slice(0, 8)) console.log(`  ${row["QUERY PLAN"]}`);
  const explainSales = await adminSql.unsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
     SELECT id FROM sales WHERE company_id = $1 ORDER BY created_at DESC LIMIT 25`,
    [ORG],
  );
  console.log("EXPLAIN riwayat penjualan (created_at desc):");
  for (const row of explainSales.slice(0, 6)) console.log(`  ${row["QUERY PLAN"]}`);
}

async function concurrency() {
  const [w] = await adminDb.select().from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true))).limit(1);
  const [pm] = await adminDb.select().from(paymentMethods)
    .where(eq(paymentMethods.companyId, ORG)).limit(1);
  const [product] = await adminDb.select().from(products)
    .where(and(eq(products.companyId, ORG), eq(products.sku, "VOL-00001"))).limit(1);

  const stockOf = async () => {
    const [row] = await adminDb.select().from(stockOnHand)
      .where(and(eq(stockOnHand.companyId, ORG), eq(stockOnHand.productId, product.id), eq(stockOnHand.warehouseId, w.id)))
      .limit(1);
    return Number(row?.qty ?? 0);
  };

  const before = await stockOf();
  await withCompany(ORG, async (tx) => {
    await openCashSession(tx, { companyId: ORG, userId: USER_ID, openingCash: 0 });
  });

  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      withCompany(ORG, async (tx) => {
        const lines = [{ productId: product.id, qty: 3 }];
        const quote = await quoteCart(tx, { companyId: ORG, warehouseId: w.id, lines });
        return createSale(tx, {
          companyId: ORG, userId: USER_ID, warehouseId: w.id,
          date: new Date().toISOString().slice(0, 10),
          dueDate: new Date().toISOString().slice(0, 10),
          lines,
          payments: [{ methodId: pm.id, amount: quote.total, tendered: quote.total }],
          idempotencyKey: crypto.randomUUID(),
        });
      }).then((sale) => ({ i, saleId: sale.id })),
    ),
  );
  const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
  const failed = attempts
    .map((a, i) => (a.status === "rejected" ? { i, reason: String(a.reason).slice(0, 160) } : null))
    .filter(Boolean);
  const after = await stockOf();
  console.log(`Konkurensi: stok awal ${before}; berhasil ${succeeded}/5; gagal ${failed.length}`);
  for (const f of failed) console.log(`  gagal #${f!.i}: ${f!.reason}`);
  console.log(`Stok akhir ${after}; harapan ${before} - 3*${succeeded} = ${before - 3 * succeeded}; cocok: ${after === before - 3 * succeeded}`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "generate") await generate();
  else if (mode === "measure") await measure();
  else if (mode === "concurrency") await concurrency();
  else if (mode === "wipe") {
    await wipe();
    console.log("Fixture volume terhapus.");
  } else {
    console.error("Mode: generate | measure | concurrency | wipe");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => adminSql.end());
