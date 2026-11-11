import { withCompanyReadOnly } from "@/db/tenant";
import { listAllUnits } from "@/server/catalog";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ekspor satuan; kode tetap teks agar singkatan seperti "01" tidak hilang. */
export async function GET(request: Request) {
  const ctx = await requirePermission("inventory.view");
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const rows = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listAllUnits(tx, ctx.company.id),
  );
  const headers = ["Kode Satuan", "Nama Satuan", "Status"];
  const cells = rows.map((row) => [row.code, row.name, row.isActive ? "Aktif" : "Nonaktif"]);
  const filename = `satuan-${todayISO()}`;
  if (format === "xlsx") {
    return xlsxResponse(`${filename}.xlsx`, [{ name: "Satuan", headers, rows: cells }]);
  }
  return csvResponse(`${filename}.csv`, toCsv(headers, cells));
}
