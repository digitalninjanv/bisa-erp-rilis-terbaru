import { withCompanyReadOnly } from "@/db/tenant";
import { listPackagingsForProducts } from "@/server/catalog";
import { getInventoryValuation } from "@/server/reports";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, moneyCsv, toCsv } from "@/lib/csv";
import { xlsxResponse, type XlsxCell } from "@/lib/xlsx";
import { packagingBreakdownLabel, type PackagingSnapshot } from "@/lib/packaging";
import { d } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await requirePermission("inventory.view");
  // AUD-013: HPP dan Nilai Persediaan adalah data biaya level-field
  // `inventory.cost`; tanpa izin itu kedua kolom tidak disertakan
  // (Potensi Jual berbasis harga jual — tetap tampil).
  const includeCost = can(ctx, "inventory.cost");
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const warehouseId = url.searchParams.get("warehouse") ?? undefined;
  // S6: kolom rincian kemasan hanya lahir bila diminta eksplisit
  // (`rincian=1`, dikirim tombol ekspor halaman Nilai persediaan saat
  // saklarnya nyala) — bentuk CSV bawaan tidak berubah.
  const withBreakdown = url.searchParams.get("rincian") === "1";

  const { valuation, packagings } = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    // PERF-02 (SIM-2 S4): ekspor tidak memakai daftar stok menipis —
    // lewati agregasi penuh keduanya; isi CSV tidak berubah.
    const result = await getInventoryValuation(tx, ctx.company.id, warehouseId, {
      skipLowStock: true,
    });
    const packs = withBreakdown
      ? await listPackagingsForProducts(
          tx,
          ctx.company.id,
          result.items.map((row) => row.productId),
        )
      : new Map<string, PackagingSnapshot[]>();
    return { valuation: result, packagings: packs };
  });

  const rows = valuation.items.map((row) => {
    const cells = [
      row.sku,
      row.name,
      row.category,
      row.unit,
      d(row.qty).toString(),
      ...(includeCost ? [moneyCsv(row.cost), moneyCsv(row.value)] : []),
      moneyCsv(row.potential),
      d(row.minStock).toString(),
    ];
    if (withBreakdown) {
      cells.push(
        packagingBreakdownLabel(
          row.qty,
          (packagings.get(row.productId) ?? []).filter((pack) => pack.isActive),
          row.unit ?? "Pcs",
        ) ?? "",
      );
    }
    return cells;
  });

  const headers = [
    "SKU",
    "Produk",
    "Kategori",
    "Satuan",
    "Stok",
    ...(includeCost ? ["HPP", "Nilai Persediaan"] : []),
    "Potensi Jual",
    "Stok Minimum",
    ...(withBreakdown ? ["Rincian Kemasan"] : []),
  ];

  const filename = `nilai-persediaan-${todayISO()}`;
  if (format === "xlsx") {
    const numericHeaders = new Set(["Stok", "HPP", "Nilai Persediaan", "Potensi Jual", "Stok Minimum"]);
    const cells: XlsxCell[][] = rows.map((row) =>
      row.map((value, index) => {
        if (value === null || value === "") return null;
        if (numericHeaders.has(headers[index])) {
          const number = Number(value);
          return Number.isFinite(number) ? number : value;
        }
        return value as XlsxCell;
      }),
    );
    return xlsxResponse(`${filename}.xlsx`, [
      { name: "Nilai Persediaan", headers, rows: cells, widths: [14, 34, 18, 10, 12, 14, 18, 16, 14, 28] },
    ]);
  }
  return csvResponse(`${filename}.csv`, toCsv(headers, rows));
}
