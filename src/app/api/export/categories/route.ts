import { withCompanyReadOnly } from "@/db/tenant";
import { listAllCategories } from "@/server/catalog";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ekspor kategori produk; CSV tetap tersedia, XLSX untuk input ulang. */
export async function GET(request: Request) {
  const ctx = await requirePermission("inventory.view");
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
