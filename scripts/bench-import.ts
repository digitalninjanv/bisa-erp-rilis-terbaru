import * as XLSX from "xlsx";
import { mapProductRow, suggestMapping } from "../src/lib/import-parse";

/**
 * Import-path benchmark: builds a 10.000-row Accurate-like sheet, parses it,
 * maps every row, and reports timings. It never touches the database.
 *
 * Run: pnpm tsx scripts/bench-import.ts
 */
const ROWS = 10_000;
const headers = [
  "Kode Barang",
  "Nama Barang",
  "Barcode",
  "Kategori",
  "Satuan",
  "Pemasok",
  "Harga Beli",
  "Harga Jual",
  "Stok",
  "Stok Minimum",
];

const rows = Array.from({ length: ROWS }, (_, index) => {
  const n = index + 1;
  return [
    `IMP-${String(n).padStart(5, "0")}`,
    `Produk Impor ${n}`,
    `899${String(n).padStart(10, "0")}`,
    `Kategori ${n % 20}`,
    "PCS",
    `Pemasok ${n % 15}`,
    String(10_000 + (n % 50) * 250),
    String(15_000 + (n % 50) * 300),
    String(n % 40),
    "5",
  ];
});

const started = performance.now();
const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Barang");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const buildMs = performance.now() - started;

const parseStart = performance.now();
const read = XLSX.read(buffer, { type: "buffer", cellDates: true });
const matrix = XLSX.utils.sheet_to_json<unknown[]>(read.Sheets[read.SheetNames[0]], {
  header: 1,
  raw: false,
  defval: "",
});
const parseMs = performance.now() - parseStart;

const mapping = suggestMapping(matrix[0] as string[]);
const mapStart = performance.now();
let valid = 0;
let invalid = 0;
for (const row of matrix.slice(1)) {
  const object: Record<string, string> = {};
  (matrix[0] as string[]).forEach((header, column) => {
    object[header] = String((row as unknown[])[column] ?? "").trim();
  });
  const result = mapProductRow(object, mapping, `GEN-${valid + invalid + 1}`);
  if (result.value) valid += 1;
  else invalid += 1;
}
const mapMs = performance.now() - mapStart;

const memory = process.memoryUsage();
console.log(
  JSON.stringify(
    {
      rows: ROWS,
      fileSizeMb: Number((buffer.byteLength / 1024 / 1024).toFixed(2)),
      buildMs: Math.round(buildMs),
      parseMs: Math.round(parseMs),
      mapMs: Math.round(mapMs),
      totalMs: Math.round(buildMs + parseMs + mapMs),
      rowsPerSecond: Math.round(ROWS / ((parseMs + mapMs) / 1000)),
      valid,
      invalid,
      heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
    },
    null,
    2,
  ),
);
