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

  const csv = toCsv(
    productExportHeaders(includeCost),
    rows.map((row) => toProductExportRow(row, { includeCost })),
  );
  return csvResponse(`produk-${todayISO()}.csv`, csv);
}
