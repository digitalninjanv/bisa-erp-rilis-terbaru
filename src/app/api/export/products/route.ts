import { withCompanyReadOnly } from "@/db/tenant";
import {
  getSettings,
  listProductsForExport,
  listWarehouses,
  pickDefaultWarehouseId,
  productExportHeaders,
  toProductExportRow,
} from "@/server/catalog";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse, type XlsxCell } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ekspor master produk (S3 §18H) — menghormati filter yang sama dengan
 * halaman daftar produk (`q`, `category`, `lowStock`), tanpa paginasi.
 * Kolom diselaraskan dengan pemetaan impor produk agar berkas hasil
 * ekspor dapat diimpor kembali (round-trip).
 */
export async function GET(request?: Request) {
  const ctx = await requirePermission("inventory.view");
  // AUD-013: harga beli (produk & kemasan) adalah data level-field
  // `inventory.cost`; tanpa izin itu kolom biaya tidak disertakan.
  const includeCost = can(ctx, "inventory.cost");
  const url = new URL(request?.url ?? "http://localhost");
  const q = url.searchParams.get("q") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const lowStock = url.searchParams.get("lowStock") === "1";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const rows = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [settings, warehouses] = await Promise.all([
      getSettings(tx, ctx.company.id),
      listWarehouses(tx, ctx.company.id),
    ]);
    const warehouseId = pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId);
    return listProductsForExport(tx, {
      companyId: ctx.company.id,
      warehouseId,
      q,
      categoryId: category,
      lowStock,
      activeOnly: false,
    });
  });

  const headers = productExportHeaders(includeCost);
  const stringRows = rows.map((row) => toProductExportRow(row, { includeCost }));
  if (format === "xlsx") {
    const numericHeaders = new Set(["Harga Beli", "Harga Jual", "Stok Minimum"]);
    const cells: XlsxCell[][] = stringRows.map((row) =>
      row.map((value, index) => {
        if (value === null || value === "") return null;
        if (numericHeaders.has(headers[index])) {
          const number = Number(value);
          return Number.isFinite(number) ? number : value;
        }
        return value;
      }),
    );
    return xlsxResponse(`produk-${todayISO()}.xlsx`, [
      {
        name: "Produk",
        headers,
        rows: cells,
        widths: [14, 36, 18, 18, 10, 24, 14, 14, 14, 12, 12, 12, 28, 20, 16, 18, 18, 18, 14, 16],
      },
    ]);
  }
  return csvResponse(`produk-${todayISO()}.csv`, toCsv(headers, stringRows));
}
