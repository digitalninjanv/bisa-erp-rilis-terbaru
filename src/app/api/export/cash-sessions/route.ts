import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { csvResponse } from "@/lib/csv";
import { xlsxResponse } from "@/lib/xlsx";
import { listCashSessionHistory } from "@/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request: Request) {
  const ctx = await requirePermission("pos.session");
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const status = url.searchParams.get("status") === "open" || url.searchParams.get("status") === "closed"
    ? url.searchParams.get("status")!
    : undefined;
  const userId = url.searchParams.get("kasir") || undefined;
  const branchId = url.searchParams.get("cabang") || undefined;
  const from = url.searchParams.get("dari") || undefined;
  const to = url.searchParams.get("sampai") || undefined;

  const rows: Awaited<ReturnType<typeof listCashSessionHistory>>["rows"] = [];
  let page = 1;
  while (true) {
    const result = await withCompanyReadOnly(ctx.company.id, async (tx) =>
      listCashSessionHistory(tx, ctx.company.id, {
        status,
        userId,
        branchId,
        from,
        to,
        page,
        pageSize: 100,
      }),
    );
    rows.push(...result.rows);
    if (rows.length >= result.total) break;
    page += 1;
  }

  const headers = [
    "Kasir",
    "Cabang",
    "Dibuka",
    "Ditutup",
    "Status",
    "Transaksi",
    "Penjualan non-tunai",
    "Modal awal",
    "Masuk",
    "Keluar",
    "Seharusnya",
    "Dihitung",
    "Selisih",
  ];
  const dataRows = rows.map((row) => [
    row.userName ?? row.userId,
    row.branchName ?? "",
    row.openedAt instanceof Date ? row.openedAt.toISOString() : String(row.openedAt),
    row.closedAt ? (row.closedAt instanceof Date ? row.closedAt.toISOString() : String(row.closedAt)) : "",
    row.status === "open" ? "Masih terbuka" : "Ditutup",
    row.transactionCount,
    row.nonCashSalesTotal ?? "0",
    row.openingCash,
    row.totalIn,
    row.totalOut,
    row.expectedCash,
    row.countedCash ?? "",
    row.difference ?? "",
  ]);

  if (format === "xlsx") {
    return xlsxResponse("riwayat-sesi-kasir.xlsx", [
      {
        name: "Riwayat Sesi",
        headers,
        rows: dataRows,
      },
    ]);
  }

  const csv = [headers.join(","), ...dataRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
  return csvResponse("riwayat-sesi-kasir.csv", csv);
}

export const GET = withApiError(GETHandler);
