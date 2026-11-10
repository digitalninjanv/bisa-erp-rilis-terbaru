import { withCompanyReadOnly } from "@/db/tenant";
import { listJournalEntries } from "@/server/reports";
import { requirePermission } from "@/lib/session";
import { journalSourceLabel, monthStartISO, todayISO } from "@/lib/format";
import { csvResponse, moneyCsv, toCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  posted: "Terposting",
  void: "Dibatalkan",
  draft: "Draf",
};

const PAGE_SIZE = 100;
const MAX_PAGES = 100; // plafon ekspor 10.000 jurnal per unduhan

/**
 * FIX-P1 Tahap 5 (AK5-02a): ekspor CSV daftar jurnal mengikuti filter
 * aktif di halaman Jurnal (rentang, pencarian, sumber, akun, status) —
 * sebelumnya CSV hanya ada per satu jurnal di halaman detail.
 */
export async function GET(request: Request) {
  const ctx = await requirePermission("accounting.view");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || monthStartISO();
  const to = url.searchParams.get("to") || todayISO();
  const q = url.searchParams.get("q") || undefined;
  const sourceType = url.searchParams.get("source") || undefined;
  const accountId = url.searchParams.get("account") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const createdBy = url.searchParams.get("user") || undefined;

  const rows = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const all: Awaited<ReturnType<typeof listJournalEntries>>["rows"] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await listJournalEntries(tx, {
        companyId: ctx.company.id,
        from,
        to,
        q,
        sourceType,
        accountId,
        status,
        createdBy,
        page,
        pageSize: PAGE_SIZE,
      });
      all.push(...result.rows);
      if (all.length >= result.total || result.rows.length === 0) break;
    }
    return all;
  });

  const csv = toCsv(
    ["Nomor", "Tanggal", "Keterangan", "Sumber", "Status", "Nilai"],
    rows.map((row) => [
      row.number,
      String(row.date),
      row.description,
      journalSourceLabel(row.sourceType),
      STATUS_LABELS[row.status] ?? row.status,
      moneyCsv(row.amount),
    ]),
  );
  return csvResponse(`jurnal-${from}-${to}.csv`, csv);
}
