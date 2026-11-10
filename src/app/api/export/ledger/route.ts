import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import {
  buildLedgerExportTable,
  reportTableToCsv,
  xlsxResponse,
} from "@/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A-28 Tahap 3 (H-AKT-01): baris ekspor kini dirakit
// buildLedgerExportTable — satu model untuk CSV warisan (byte-identik)
// & XLSX berformat (format=xlsx).

export async function GET(request: Request) {
  const ctx = await requirePermission("accounting.view");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || `${todayISO().slice(0, 7)}-01`;
  const to = url.searchParams.get("to") || todayISO();
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const built = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    buildLedgerExportTable(tx, ctx.company, {
      accountId: url.searchParams.get("account"),
      from,
      to,
    }),
  );

  if (!built) {
    return csvResponse(`buku-besar-${todayISO()}.csv`, toCsv(["Info"], [["Akun tidak ditemukan."]]));
  }

  if (format === "xlsx") {
    return xlsxResponse(`buku-besar-${built.accountCode}-${from}-${to}.xlsx`, built.table);
  }
  return csvResponse(
    `buku-besar-${built.accountCode}-${from}-${to}.csv`,
    reportTableToCsv(built.table),
  );
}
