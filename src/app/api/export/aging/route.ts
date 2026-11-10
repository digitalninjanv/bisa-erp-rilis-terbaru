import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse } from "@/lib/csv";
import {
  buildAgingExportTable,
  reportTableToCsv,
  xlsxResponse,
} from "@/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A-26 Q1b (D-01): umur & kelompok aging kini dari lib/due-date —
// satu definisi yang sama dengan kartu umur halaman piutang-utang.
//
// FIX-P1 Tahap 5 (AK5-05b): ekspor CSV aging piutang/utang — daftar
// penagihan/penjadwalan bayar lengkap dengan jatuh tempo, umur dokumen
// (bucket berbasis tanggal dokumen sesuai aturan proyek), dan status
// keterlambatan per dokumen.
// A-28 Tahap 3 (H-AKT-01): perakitan baris pindah ke
// buildAgingExportTable — satu model untuk CSV warisan (byte-identik)
// & XLSX berformat (format=xlsx).

export async function GET(request: Request) {
  const ctx = await requirePermission("accounting.view");
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "utang" ? "utang" : "piutang";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const today = todayISO();

  const table = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    buildAgingExportTable(tx, ctx.company, kind),
  );

  if (format === "xlsx") {
    return xlsxResponse(`aging-${kind}-${today}.xlsx`, table);
  }
  return csvResponse(`aging-${kind}-${today}.csv`, reportTableToCsv(table));
}
