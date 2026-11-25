import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { listAllCategories } from "@/server/catalog";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ekspor kategori produk; CSV tetap tersedia, XLSX untuk input ulang. */
async function GETHandler(request: Request) {
  const ctx = await requirePermissionInModule("inventory.view", "gudang");
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const rows = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listAllCategories(tx, ctx.company.id),
  );
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  const headers = ["Nama Kategori", "Induk Kategori", "Status"];
  const cells = rows.map((row) => [
    row.name,
    row.parentId ? (byId.get(row.parentId) ?? "") : "",
    row.isActive ? "Aktif" : "Nonaktif",
  ]);
  const filename = `kategori-produk-${todayISO()}`;
  if (format === "xlsx") {
    return xlsxResponse(`${filename}.xlsx`, [
      { name: "Kategori", headers, rows: cells },
    ]);
  }
  return csvResponse(`${filename}.csv`, toCsv(headers, cells));
}

export const GET = withApiError(GETHandler);
