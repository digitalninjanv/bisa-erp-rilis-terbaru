import { z } from "zod";
import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionInModule } from "@/lib/session";
import { AppError } from "@/lib/errors";
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
  const ctx = await requirePermissionInModule("accounting.view", "akuntansi");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || `${todayISO().slice(0, 7)}-01`;
  const to = url.searchParams.get("to") || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError("VALIDATION", "Format tanggal buku besar harus YYYY-MM-DD.");
  }
  const accountParam = url.searchParams.get("account");
  if (accountParam && !z.string().uuid().safeParse(accountParam).success) {
    throw new AppError("VALIDATION", "ID akun tidak valid.");
  }
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const input = {
    accountId: accountParam,
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

  const streamed = await createLedgerCsvExport(ctx.company, input, { signal: request.signal });
  if (!streamed) {
    return csvResponse(`buku-besar-${todayISO()}.csv`, toCsv(["Info"], [["Akun tidak ditemukan."]]));
  }
  return csvStreamResponse(
    `buku-besar-${streamed.accountCode}-${from}-${to}.csv`,
    streamed.body,
  );
}

export const GET = withApiError(GETHandler);
