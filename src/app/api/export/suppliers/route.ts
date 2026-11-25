import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { listSuppliersFiltered } from "@/server/catalog";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse, type XlsxCell } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ekspor pemasok — menghormati filter halaman daftar pihak
 * (`q` kata kunci, `status` aktif/nonaktif) lewat fungsi daftar yang
 * sama dengan halaman (S3 §18F).
 */
async function GETHandler(request?: Request) {
  const ctx = await requirePermissionInModule("inventory.view", "gudang");
  const url = new URL(request?.url ?? "http://localhost");
  const filter = {
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  };
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const rows = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listSuppliersFiltered(tx, ctx.company.id, filter),
  );

  const headers = ["Kode", "Nama", "Telepon", "Email", "Alamat", "Catatan", "NPWP", "Bank", "No. Rekening", "Atas Nama", "Termin (hari)", "Status"];
  const cells: XlsxCell[][] = rows.map((row) => [
    row.code,
    row.name,
    row.phone,
    row.email,
    row.address,
    row.notes,
    row.taxId,
    row.bankName,
    row.bankAccountNumber,
    row.bankAccountName,
    row.paymentTermDays == null ? null : Number(row.paymentTermDays),
    row.isActive ? "Aktif" : "Nonaktif",
  ]);
  const filename = `pemasok-${todayISO()}`;
  if (format === "xlsx") {
    return xlsxResponse(`${filename}.xlsx`, [
      { name: "Pemasok", headers, rows: cells, widths: [12, 32, 18, 26, 34, 28, 20, 18, 20, 24, 14, 12] },
    ]);
  }
  return csvResponse(`${filename}.csv`, toCsv(headers, cells));
}

export const GET = withApiError(GETHandler);
