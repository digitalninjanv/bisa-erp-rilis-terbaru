import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { listCustomersFiltered } from "@/server/catalog";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, moneyCsv, toCsv } from "@/lib/csv";
import { xlsxResponse, type XlsxCell } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ekspor pelanggan — menghormati filter halaman daftar pihak
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
    listCustomersFiltered(tx, ctx.company.id, filter),
  );

  const headers = ["Kode", "Nama", "Telepon", "Email", "Alamat", "Kelompok Harga", "Batas Kredit", "Catatan", "NPWP", "Termin (hari)", "Status"];
  const cells: XlsxCell[][] = rows.map((row) => [
    row.code,
    row.name,
    row.phone,
    row.email,
    row.address,
    row.groupName,
    Number(row.creditLimit),
    row.notes,
    row.taxId,
    row.paymentTermDays == null ? null : Number(row.paymentTermDays),
    row.isActive ? "Aktif" : "Nonaktif",
  ]);
  const filename = `pelanggan-${todayISO()}`;
  if (format === "xlsx") {
    return xlsxResponse(`${filename}.xlsx`, [
      { name: "Pelanggan", headers, rows: cells, widths: [12, 32, 18, 26, 34, 20, 16, 28, 20, 14, 12] },
    ]);
  }
  return csvResponse(
    `${filename}.csv`,
    toCsv(headers, rows.map((row) => [
      row.code,
      row.name,
      row.phone,
      row.email,
      row.address,
      row.groupName,
      moneyCsv(row.creditLimit),
      row.notes,
      row.taxId,
      row.paymentTermDays,
      row.isActive ? "Aktif" : "Nonaktif",
    ])),
  );
}

export const GET = withApiError(GETHandler);
