import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { employees, payrollItems, payrollRuns, employeeStatutoryEnrollments, stockMovements, warehouses, accounts, products } from "../../src/db/schema";
import { withCompanyReadOnly } from "../../src/db/tenant";
import { d } from "../../src/lib/money";
import { toCsv } from "../../src/lib/csv";
import { listProducts, searchProducts } from "../../src/server/catalog";
import {
  getBalanceSheet,
  getHomeSummary,
  getIncomeStatement,
  getInventoryValuation,
  getLedger,
  getStockCard,
  getTrialBalance,
  listExpenses,
  listJournalEntries,
  listPayables,
  listReceivables,
  listSales,
} from "../../src/server/reports";
import { getOpenAdvanceTotal, proposeAdvanceDeductions } from "../../src/server/employee-advances";
import * as advancesModule from "../../src/server/employee-advances";

/**
 * SIM-2 S4 — benchmark operasi nyata Bisa ERP pada perusahaan benchmark
 * (lihat generate.ts). Setiap operasi memanggil fungsi domain yang sama
 * dengan yang dipakai halaman/rute aplikasi, lewat withCompanyReadOnly
 * (koneksi aplikasi app_user + RLS), 2× pemanasan lalu N× pengukuran.
 * Hasil mentah (semua durasi per larian) disimpan sebagai JSON agar
 * perbandingan sebelum/sesudah dapat diaudit.
 *
 * Jalan:  pnpm tsx --env-file=.env.local scripts/sim2-gen/bench.ts --scale=A --label=before-A
 *         pnpm tsx --env-file=.env.local scripts/sim2-gen/bench.ts --scale=A --label=after-A --payroll=batch
 *         pnpm tsx --env-file=.env.local scripts/sim2-gen/bench.ts --scale=A --concurrent=30
 */

const COMPANIES: Record<string, string> = {
  A: "01900000-0000-7000-8000-00000000bea1",
  B: "01900000-0000-7000-8000-00000000bea2",
};

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string) =>
  (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const SCALE = argOf("scale", "A");
const LABEL = argOf("label", `run-${SCALE}`);
const PAYROLL_MODE = argOf("payroll", "loop");
const CONCURRENT_SECONDS = Number(argOf("concurrent", "0"));
const RUNS = Number(argOf("runs", "9"));
const COMPANY_ID = COMPANIES[SCALE];
if (!COMPANY_ID) throw new Error(`Skala tidak dikenal: ${SCALE}`);

type OpResult = {
  name: string;
  runsMs: number[];
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  errors: number;
  fingerprint: string;
};

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function stats(name: string, runsMs: number[], errors: number, fingerprint: string): OpResult {
  const sorted = [...runsMs].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    name,
    runsMs: runsMs.map(round),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    errors,
    fingerprint,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : 1,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

async function measure(
  name: string,
  fn: () => Promise<string>,
): Promise<OpResult> {
  let fingerprint = "";
  let errors = 0;
  // Pemanasan: 2 larian, tidak dicatat.
  for (let i = 0; i < 2; i++) {
    try {
      fingerprint = await fn();
    } catch {
      errors++;
    }
  }
  const runsMs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    try {
      fingerprint = await fn();
    } catch {
      errors++;
    }
    runsMs.push(performance.now() - t0);
  }
  const result = stats(name, runsMs, errors, fingerprint);
  console.log(
    `${name.padEnd(28)} p50 ${String(result.p50).padStart(8)} ms · p95 ${String(result.p95).padStart(8)} ms · p99 ${String(result.p99).padStart(8)} ms · err ${errors} · fp ${fingerprint.slice(0, 24)}`,
  );
  return result;
}

async function main() {
  const meta = {
    label: LABEL,
    scale: SCALE,
    companyId: COMPANY_ID,
    payrollMode: PAYROLL_MODE,
    runs: RUNS,
    node: process.version,
    startedAt: new Date().toISOString(),
  };
  console.log(`Benchmark ${LABEL} — skala ${SCALE} — perusahaan ${COMPANY_ID}`);

  // Konteks: gudang utama, produk terlaris (kartu stok terberat),
  // akun kas, satu barcode nyata.
  const ctx = await withCompanyReadOnly(COMPANY_ID, async (tx) => {
    const [wh] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, COMPANY_ID), eq(warehouses.isDefault, true)))
      .limit(1);
    const [hot] = await tx
      .select({ productId: stockMovements.productId, n: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(eq(stockMovements.companyId, COMPANY_ID))
      .groupBy(stockMovements.productId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);
    const [cash] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyId, COMPANY_ID), eq(accounts.code, "1000")))
      .limit(1);
    const [someProduct] = await tx
      .select({ barcode: products.barcode, name: products.name })
      .from(products)
      .where(eq(products.companyId, COMPANY_ID))
      .orderBy(asc(products.sku))
      .limit(1);
    const [movementCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.companyId, COMPANY_ID),
          eq(stockMovements.productId, hot.productId),
          eq(stockMovements.warehouseId, wh.id),
        ),
      );
    return {
      warehouseId: wh.id,
      hotProductId: hot.productId,
      hotMovements: movementCount.n,
      cashAccountId: cash.id,
      barcode: someProduct.barcode ?? "",
      sampleNameWord: (someProduct.name ?? "Susu").split(" ")[0],
    };
  });
  console.log(
    `Konteks: gudang ${ctx.warehouseId.slice(0, 8)}… · produk terlaris ${ctx.hotMovements} gerakan · kata cari "${ctx.sampleNameWord}"`,
  );

  if (CONCURRENT_SECONDS > 0) {
    await runConcurrent(ctx, CONCURRENT_SECONDS);
    return;
  }

  const year: { from: string; to: string } = { from: "2025-01-01", to: "2025-12-31" };
  const results: OpResult[] = [];
  const ro = <T,>(fn: (tx: Parameters<Parameters<typeof withCompanyReadOnly>[1]>[0]) => Promise<T>) =>
    withCompanyReadOnly(COMPANY_ID, fn);

  results.push(
    await measure("produk-daftar-halaman-1", () =>
      ro((tx) => listProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, page: 1, pageSize: 25 })).then(
        (r) => `total=${r.total}`,
      ),
    ),
  );
  results.push(
    await measure("produk-cari-kata", () =>
      ro((tx) =>
        listProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, q: ctx.sampleNameWord, page: 1, pageSize: 25 }),
      ).then((r) => `total=${r.total}`),
    ),
  );
  results.push(
    await measure("produk-daftar-halaman-dalam", () =>
      ro((tx) => listProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, page: 200, pageSize: 25 })).then(
        (r) => `total=${r.total};rows=${r.rows.length}`,
      ),
    ),
  );
  results.push(
    await measure("pos-cari-kosong", () =>
      ro((tx) => searchProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, q: "", limit: 24, offset: 0 })).then(
        (r) => `rows=${r.length};first=${r[0]?.sku ?? "-"}`,
      ),
    ),
  );
  results.push(
    await measure("pos-cari-kata", () =>
      ro((tx) =>
        searchProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, q: ctx.sampleNameWord, limit: 24, offset: 0 }),
      ).then((r) => `rows=${r.length};first=${r[0]?.sku ?? "-"}`),
    ),
  );
  results.push(
    await measure("pos-cari-barcode", () =>
      ro((tx) => searchProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, q: ctx.barcode, limit: 24, offset: 0 })).then(
        (r) => `rows=${r.length};first=${r[0]?.sku ?? "-"}`,
      ),
    ),
  );
  results.push(
    await measure("valuasi-halaman", () =>
      ro((tx) => getInventoryValuation(tx, COMPANY_ID, undefined, { page: 1, pageSize: 50 })).then(
        (r) => `total=${r.totalValue};rows=${r.items.length}`,
      ),
    ),
  );

  let valuationCsvBytes = 0;
  let valuationCsvMs = 0;
  results.push(
    await measure("valuasi-penuh-ekspor", () =>
      ro(async (tx) => {
        const t0 = performance.now();
        const valuation = await getInventoryValuation(tx, COMPANY_ID);
        const rows = valuation.items.map((row) => [
          row.sku,
          row.name,
          row.category,
          row.unit,
          d(row.qty).toString(),
          d(row.cost).toString(),
          d(row.value).toString(),
          d(row.potential).toString(),
          d(row.minStock).toString(),
        ]);
        const csv = toCsv(
          ["SKU", "Produk", "Kategori", "Satuan", "Stok", "HPP", "Nilai Persediaan", "Potensi Jual", "Stok Minimum"],
          rows,
        );
        valuationCsvMs = performance.now() - t0;
        valuationCsvBytes = csv.length;
        return `total=${valuation.totalValue};csvBytes=${csv.length};hash=${hashOf(csv)}`;
      }),
    ),
  );
  console.log(`  (ekspor valuasi: CSV ${valuationCsvBytes} byte, bangun terakhir ${valuationCsvMs.toFixed(1)} ms)`);

  results.push(
    await measure("neraca-saldo-12-bulan", () =>
      ro((tx) => getTrialBalance(tx, COMPANY_ID, year)).then((rows) => {
        const totalDebit = rows.reduce((acc, r) => acc.plus(d(r.debit)), d(0));
        const totalCredit = rows.reduce((acc, r) => acc.plus(d(r.credit)), d(0));
        return `akun=${rows.length};dr=${totalDebit.toFixed(2)};cr=${totalCredit.toFixed(2)}`;
      }),
    ),
  );
  results.push(
    await measure("laba-rugi-12-bulan", () =>
      ro((tx) => getIncomeStatement(tx, COMPANY_ID, year)).then((r) => `hash=${hashOf(r)}`),
    ),
  );
  results.push(
    await measure("neraca-posisi-akhir-tahun", () =>
      ro((tx) => getBalanceSheet(tx, COMPANY_ID, "2025-12-31")).then((r) => `hash=${hashOf(r)}`),
    ),
  );
  results.push(
    await measure("buku-besar-kas-halaman-1", () =>
      ro((tx) => getLedger(tx, { companyId: COMPANY_ID, accountId: ctx.cashAccountId, ...year, page: 1, pageSize: 100 })).then(
        (r) => `closing=${r.closing};dr=${r.totalDebit};cr=${r.totalCredit}`,
      ),
    ),
  );
  results.push(
    await measure("buku-besar-kas-penuh", () =>
      ro((tx) => getLedger(tx, { companyId: COMPANY_ID, accountId: ctx.cashAccountId, ...year })).then(
        (r) => `closing=${r.closing};dr=${r.totalDebit};cr=${r.totalCredit};rows=${r.items.length}`,
      ),
    ),
  );
  results.push(
    await measure("piutang-daftar-aging", () =>
      ro((tx) => listReceivables(tx, COMPANY_ID)).then((rows) => {
        const outstanding = rows.reduce((acc, r) => acc.plus(d(r.total)).minus(d(r.paidTotal)), d(0));
        return `dokumen=${rows.length};saldo=${outstanding.toFixed(2)}`;
      }),
    ),
  );
  results.push(
    await measure("utang-daftar-aging", () =>
      ro((tx) => listPayables(tx, COMPANY_ID)).then((rows) => {
        // listPayables mengembalikan `outstanding` kanonis per baris
        // (total − terbayar − alokasi retur); jangan hitung ulang dari
        // paidTotal — baris dokumen memakai nama kolom paidAmount.
        const outstanding = rows.reduce((acc, r) => acc.plus(d(r.outstanding)), d(0));
        return `dokumen=${rows.length};saldo=${outstanding.toFixed(2)}`;
      }),
    ),
  );
  results.push(
    await measure("kartu-stok-halaman-1", () =>
      ro((tx) => getStockCard(tx, COMPANY_ID, ctx.hotProductId, { warehouseId: ctx.warehouseId, page: 1, pageSize: 50 })).then(
        (r) => `total=${r.total};rows=${r.rows.length}`,
      ),
    ),
  );
  results.push(
    await measure("kartu-stok-halaman-dalam", () =>
      ro((tx) => getStockCard(tx, COMPANY_ID, ctx.hotProductId, { warehouseId: ctx.warehouseId, page: 5, pageSize: 50 })).then(
        (r) => `total=${r.total};rows=${r.rows.length};last=${r.rows[r.rows.length - 1]?.balance ?? "-"}`,
      ),
    ),
  );
  results.push(
    await measure("jurnal-daftar", () =>
      ro((tx) => listJournalEntries(tx, { companyId: COMPANY_ID, ...year, page: 1, pageSize: 25 })).then(
        (r) => `total=${r.total}`,
      ),
    ),
  );
  results.push(
    await measure("jurnal-cari-gaji", () =>
      ro((tx) => listJournalEntries(tx, { companyId: COMPANY_ID, q: "gaji", page: 1, pageSize: 25 })).then(
        (r) => `total=${r.total}`,
      ),
    ),
  );
  results.push(
    await measure("jurnal-cari-penjualan", () =>
      ro((tx) => listJournalEntries(tx, { companyId: COMPANY_ID, q: "penjualan", page: 1, pageSize: 25 })).then(
        (r) => `total=${r.total}`,
      ),
    ),
  );
  results.push(
    await measure("penjualan-daftar", () =>
      ro((tx) => listSales(tx, { companyId: COMPANY_ID, page: 1, pageSize: 25 })).then((r) => `total=${r.total}`),
    ),
  );
  results.push(
    await measure("beban-daftar-bulanan", () =>
      ro((tx) => listExpenses(tx, COMPANY_ID, { month: "2025-06", page: 1, pageSize: 25 })).then(
        (r) => `total=${r.total}`,
      ),
    ),
  );
  results.push(
    await measure("beranda-ringkasan", () =>
      ro((tx) => getHomeSummary(tx, COMPANY_ID, "2025-06-15")).then((r) => `hash=${hashOf(r)}`),
    ),
  );
  results.push(await measure("payroll-halaman-data", () => payrollPageLoad()));

  const out = { meta, context: ctx, results };
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  const path = new URL(`./results/${LABEL}.json`, import.meta.url);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`Hasil mentah tersimpan: scripts/sim2-gen/results/${LABEL}.json`);
  process.exit(0);
}

/**
 * Replikasi persis pemuatan data halaman Payroll
 * (src/app/app/akuntansi/payroll/page.tsx): daftar karyawan, run, item,
 * kepesertaan, lalu usulan potongan kasbon. Mode "loop" = implementasi
 * lama (2 query per karyawan berkasbon); mode "batch" = satu query
 * agregat + hitung di memori (PERF-01). Fingerprint = usulan lengkap,
 * agar kesetaraan hasil kedua mode terbukti dari hash/isi.
 */
async function payrollPageLoad(): Promise<string> {
  return withCompanyReadOnly(COMPANY_ID, async (tx) => {
    const [staff, runs] = await Promise.all([
      tx
        .select()
        .from(employees)
        .where(eq(employees.companyId, COMPANY_ID))
        .orderBy(desc(employees.isActive), employees.name),
      tx
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.companyId, COMPANY_ID))
        .orderBy(desc(payrollRuns.period))
        .limit(24),
    ]);
    const items = await tx
      .select({ runId: payrollItems.runId, employeeName: employees.name, net: payrollItems.net })
      .from(payrollItems)
      .leftJoin(employees, eq(payrollItems.employeeId, employees.id))
      .where(eq(payrollItems.companyId, COMPANY_ID));
    const enrollmentRows = await tx
      .select()
      .from(employeeStatutoryEnrollments)
      .where(eq(employeeStatutoryEnrollments.companyId, COMPANY_ID));
    void enrollmentRows;

    let proposals: Array<{ employeeId: string; openTotal: string; proposed: string }>;
    if (PAYROLL_MODE === "batch") {
      const batch = (advancesModule as Record<string, unknown>).proposeAdvanceDeductionsBatch;
      if (typeof batch !== "function") {
        throw new Error("proposeAdvanceDeductionsBatch belum ada (jalankan mode loop untuk baseline)");
      }
      const rows = await (
        batch as (
          tx: unknown,
          companyId: string,
          staff: unknown[],
        ) => Promise<Array<{ employeeId: string; openTotal: { toFixed: (n: number) => string }; proposal: { total: { toFixed: (n: number) => string } } }>>
      )(tx, COMPANY_ID, staff);
      proposals = rows.map((r) => ({
        employeeId: r.employeeId,
        openTotal: r.openTotal.toFixed(2),
        proposed: r.proposal.total.toFixed(2),
      }));
    } else {
      proposals = [];
      for (const person of staff) {
        if (!person.isActive) continue;
        const openTotal = await getOpenAdvanceTotal(tx, COMPANY_ID, person.id);
        if (!openTotal.gt(0)) continue;
        const proposal = await proposeAdvanceDeductions(tx, COMPANY_ID, person);
        proposals.push({
          employeeId: person.id,
          openTotal: openTotal.toFixed(2),
          proposed: proposal.total.toFixed(2),
        });
      }
    }
    return `staff=${staff.length};runs=${runs.length};items=${items.length};usulan=${hashOf(proposals)}`;
  });
}

async function runConcurrent(
  ctx: { warehouseId: string; hotProductId: string; sampleNameWord: string },
  seconds: number,
) {
  const ops: Array<() => Promise<unknown>> = [
    () =>
      withCompanyReadOnly(COMPANY_ID, (tx) =>
        listProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, page: 1, pageSize: 25 }),
      ),
    () =>
      withCompanyReadOnly(COMPANY_ID, (tx) =>
        searchProducts(tx, { companyId: COMPANY_ID, warehouseId: ctx.warehouseId, q: ctx.sampleNameWord, limit: 24, offset: 0 }),
      ),
    () =>
      withCompanyReadOnly(COMPANY_ID, (tx) =>
        getInventoryValuation(tx, COMPANY_ID, undefined, { page: 1, pageSize: 50 }),
      ),
    () =>
      withCompanyReadOnly(COMPANY_ID, (tx) =>
        getStockCard(tx, COMPANY_ID, ctx.hotProductId, { warehouseId: ctx.warehouseId, page: 1, pageSize: 50 }),
      ),
  ];
  const WORKERS = 10;
  const deadline = Date.now() + seconds * 1000;
  let completed = 0;
  let failed = 0;
  const latencies: number[] = [];
  async function worker(id: number) {
    let i = id;
    while (Date.now() < deadline) {
      const op = ops[i % ops.length];
      i++;
      const t0 = performance.now();
      try {
        await op();
        completed++;
        latencies.push(performance.now() - t0);
      } catch {
        failed++;
      }
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
  const elapsed = (Date.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  const summary = {
    mode: "concurrent",
    scale: SCALE,
    companyId: COMPANY_ID,
    workers: WORKERS,
    seconds: elapsed,
    completed,
    failed,
    throughputPerSec: Math.round((completed / elapsed) * 10) / 10,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
  console.log(JSON.stringify(summary, null, 2));
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL(`./results/${LABEL}-concurrent.json`, import.meta.url),
    JSON.stringify(summary, null, 2),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
