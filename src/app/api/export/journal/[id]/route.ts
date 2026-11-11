import { withCompanyReadOnly } from "@/db/tenant";
import { getJournalDetail } from "@/server/reports";
import { requirePermission } from "@/lib/session";
import { csvResponse, moneyCsv, toCsv } from "@/lib/csv";
import { xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const ctx = await requirePermission("accounting.view");
  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getJournalDetail(tx, ctx.company.id, id),
  );

  if (!data) {
    return csvResponse(`jurnal-${id}.csv`, toCsv(["Info"], [["Jurnal tidak ditemukan."]]));
  }

  const { entry, lines } = data;
  if (format === "xlsx") {
    const cells = lines.map((line) => [
      line.accountCode,
      line.accountName,
      line.description ?? "",
      Number(line.debit),
      Number(line.credit),
    ]);
    return xlsxResponse(`jurnal-${entry.number}.xlsx`, [
      {
        name: "Jurnal",
        headers: ["Kode Akun", "Nama Akun", "Keterangan", "Debit", "Kredit"],
        rows: cells,
        widths: [14, 36, 44, 16, 16],
        titleRows: [
          [`Jurnal ${entry.number}`, entry.description, entry.date, entry.sourceType, entry.status],
          [],
        ],
      },
    ]);
  }
  const rows = lines.map((line) => [
    line.accountCode,
    line.accountName,
    line.description ?? "",
    moneyCsv(line.debit),
    moneyCsv(line.credit),
  ]);

  const csv = toCsv(
    [`Jurnal ${entry.number}`, entry.description, entry.date, entry.sourceType, entry.status],
    rows,
  );
  return csvResponse(`jurnal-${entry.number}.csv`, csv);
}
