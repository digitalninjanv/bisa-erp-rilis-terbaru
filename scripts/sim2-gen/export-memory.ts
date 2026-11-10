import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { withCompanyReadOnly } from "../../src/db/tenant";
import { toCsv } from "../../src/lib/csv";
import { d } from "../../src/lib/money";
import { getInventoryValuation } from "../../src/server/reports";

/**
 * SIM-2 S4 (PERF-02) — pengukuran memori jalur ekspor valuasi persis
 * seperti rute /api/export/inventory: muat seluruh valuasi tanpa
 * pagination, petakan baris, bangun SATU string CSV lewat toCsv.
 * Dilaporkan: waktu per tahap, ukuran CSV, dan delta heap/RSS proses.
 * Jalan: node --expose-gc + tsx, perusahaan benchmark B (100 rb produk).
 *
 *   pnpm tsx --env-file=.env.local scripts/sim2-gen/export-memory.ts --scale=B
 */

const COMPANIES: Record<string, string> = {
  A: "01900000-0000-7000-8000-00000000bea1",
  B: "01900000-0000-7000-8000-00000000bea2",
};
const scale = (process.argv.find((a) => a.startsWith("--scale=")) ?? "--scale=B").split("=")[1];
const companyId = COMPANIES[scale];
if (!companyId) throw new Error(`Skala tidak dikenal: ${scale}`);

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const base = process.memoryUsage();
  console.log(`Baseline proses: heap ${mb(base.heapUsed)}, RSS ${mb(base.rss)}`);

  const t0 = performance.now();
  const valuation = await withCompanyReadOnly(companyId, (tx) => getInventoryValuation(tx, companyId));
  const tLoad = performance.now();
  const afterLoad = process.memoryUsage();
  console.log(
    `Muat valuasi penuh: ${(tLoad - t0).toFixed(0)} ms · ${valuation.items.length} baris · heap ${mb(afterLoad.heapUsed)} (Δ ${mb(afterLoad.heapUsed - base.heapUsed)}) · RSS ${mb(afterLoad.rss)}`,
  );

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
  const tMap = performance.now();
  console.log(`Petakan baris CSV: ${(tMap - tLoad).toFixed(0)} ms`);

  const csv = toCsv(
    ["SKU", "Produk", "Kategori", "Satuan", "Stok", "HPP", "Nilai Persediaan", "Potensi Jual", "Stok Minimum"],
    rows,
  );
  const tCsv = performance.now();
  const afterCsv = process.memoryUsage();
  console.log(
    `Bangun string CSV: ${(tCsv - tMap).toFixed(0)} ms · CSV ${mb(csv.length)} (${csv.length} byte) · heap ${mb(afterCsv.heapUsed)} (Δ total ${mb(afterCsv.heapUsed - base.heapUsed)}) · RSS ${mb(afterCsv.rss)} (Δ ${mb(afterCsv.rss - base.rss)})`,
  );
  console.log(`Total jalur ekspor: ${(tCsv - t0).toFixed(0)} ms`);

  // Varian PERF-02: skipLowStock — CSV harus identik byte-per-byte.
  const tSkip0 = performance.now();
  const valuationSkip = await withCompanyReadOnly(companyId, (tx) =>
    getInventoryValuation(tx, companyId, undefined, { skipLowStock: true }),
  );
  const tSkipLoad = performance.now();
  const rowsSkip = valuationSkip.items.map((row) => [
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
  const csvSkip = toCsv(
    ["SKU", "Produk", "Kategori", "Satuan", "Stok", "HPP", "Nilai Persediaan", "Potensi Jual", "Stok Minimum"],
    rowsSkip,
  );
  const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
  console.log(
    `Varian skipLowStock: muat ${(tSkipLoad - tSkip0).toFixed(0)} ms (vs ${(tLoad - t0).toFixed(0)} ms) · hash CSV ${hash(csvSkip)} vs ${hash(csv)} · identik: ${csvSkip === csv}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
