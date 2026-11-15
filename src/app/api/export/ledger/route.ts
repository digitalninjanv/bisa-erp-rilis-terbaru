import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, csvStreamResponse, toCsv } from "@/lib/csv";
import {
  buildLedgerExportTable,
  xlsxResponse,
} from "@/server/reports";
import { createLedgerCsvExport } from "@/server/reports/ledger-export-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// XLSX tetap memakai ReportTable. CSV dibaca melalui cursor dan diuji
// byte-identik terhadap serialisasi ReportTable yang sudah ada.

async function GETHandler(request: Request) {
  const ctx = await requirePermission("accounting.view");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || `${todayISO().slice(0, 7)}-01`;
  const to = url.searchParams.get("to") || todayISO();
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const input = {
    accountId: url.searchParams.get("account"),
    from,
    to,
  };
  if (format === "xlsx") {
    const built = await withCompanyReadOnly(ctx.company.id, async (tx) =>
      buildLedgerExportTable(tx, ctx.company, input),
    );
    if (!built) {
      return csvResponse(`buku-besar-${todayISO()}.csv`, toCsv(["Info"], [["Akun tidak ditemukan."]]));
    }
    return xlsxResponse(`buku-besar-${built.accountCode}-${from}-${to}.xlsx`, built.table);
  }

  const streamed = await createLedgerCsvExport(ctx.company, input);
  if (!streamed) {
    return csvResponse(`buku-besar-${todayISO()}.csv`, toCsv(["Info"], [["Akun tidak ditemukan."]]));
  }
  return csvStreamResponse(
    `buku-besar-${streamed.accountCode}-${from}-${to}.csv`,
    streamed.body,
  );
}

export const GET = withApiError(GETHandler);
