import { withCompanyReadOnly } from "@/db/tenant";
import { listCustomersFiltered } from "@/server/catalog";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, moneyCsv, toCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ekspor pelanggan — menghormati filter halaman daftar pihak
 * (`q` kata kunci, `status` aktif/nonaktif) lewat fungsi daftar yang
 * sama dengan halaman (S3 §18F).
 */
export async function GET(request?: Request) {
  const ctx = await requirePermission("inventory.view");
  const url = new URL(request?.url ?? "http://localhost");
  const filter = {
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  };

  const rows = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listCustomersFiltered(tx, ctx.company.id, filter),
  );

  const csv = toCsv(
    ["Kode", "Nama", "Telepon", "Email", "Alamat", "Kelompok Harga", "Batas Kredit", "Catatan", "NPWP", "Termin (hari)", "Status"],
    rows.map((row) => [
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
    ]),
  );
  return csvResponse(`pelanggan-${todayISO()}.csv`, csv);
}
