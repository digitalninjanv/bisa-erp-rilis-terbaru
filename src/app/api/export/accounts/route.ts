import { withApiError } from "@/lib/api-error";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { accounts } from "@/db/schema";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ekspor bagan akun — menghormati filter halaman bagan akun
 * (`q` kode/nama, `type` tipe akun) agar hasil unduhan sama dengan
 * yang sedang tampil (S3 §18F).
 */
async function GETHandler(request?: Request) {
  const ctx = await requirePermissionInModule("accounting.view", "akuntansi");
  const url = new URL(request?.url ?? "http://localhost");
  const q = url.searchParams.get("q")?.trim();
  const type = url.searchParams.get("type")?.trim();
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const conditions = [eq(accounts.companyId, ctx.company.id)];
  if (q) {
    conditions.push(or(ilike(accounts.code, `%${q}%`), ilike(accounts.name, `%${q}%`))!);
  }
  if (type) conditions.push(eq(accounts.type, type));

  const rows = await withCompanyReadOnly(ctx.company.id, (tx) =>
    tx
      .select({
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        normalBalance: accounts.normalBalance,
        section: accounts.section,
        cashFlowGroup: accounts.cashFlowGroup,
        isPostable: accounts.isPostable,
        isActive: accounts.isActive,
      })
      .from(accounts)
      .where(and(...conditions))
      .orderBy(asc(accounts.code)),
  );

  // Header Bahasa Indonesia, nilai mentah apa adanya dari bagan akun agar
  // berkas hasil ekspor bisa diimpor kembali tanpa terjemahan nilai.
  const headers = ["Kode", "Nama", "Tipe", "Saldo Normal", "Bagian", "Kelompok Arus Kas", "Dapat Diposting", "Status"];
  const cells = rows.map((row) => [
    row.code,
    row.name,
    row.type,
    row.normalBalance,
    row.section,
    row.cashFlowGroup,
    row.isPostable ? "Ya" : "Tidak",
    row.isActive ? "Aktif" : "Nonaktif",
  ]);
  const filename = `bagan-akun-${todayISO()}`;
  if (format === "xlsx") {
    return xlsxResponse(`${filename}.xlsx`, [
      { name: "Bagan Akun", headers, rows: cells, widths: [12, 36, 14, 14, 22, 18, 16, 12] },
    ]);
  }
  return csvResponse(`${filename}.csv`, toCsv(headers, cells));
}

export const GET = withApiError(GETHandler);
