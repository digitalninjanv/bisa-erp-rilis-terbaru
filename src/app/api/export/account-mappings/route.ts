import { withApiError } from "@/lib/api-error";
import { asc, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { accountMappings, accounts } from "@/db/schema";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse } from "@/lib/xlsx";
import { MAPPING_GROUPS, MAPPING_LABELS } from "@/lib/account-mappings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ekspor pemetaan akun: kunci, label, grup, dan akun yang dipakai. */
async function GETHandler(request: Request) {
  const ctx = await requirePermissionInModule("accounting.view", "akuntansi");
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const rows = await withCompanyReadOnly(ctx.company.id, (tx) =>
    tx
      .select({
        key: accountMappings.key,
        code: accounts.code,
        name: accounts.name,
      })
      .from(accountMappings)
      .leftJoin(accounts, eq(accountMappings.accountId, accounts.id))
      .where(eq(accountMappings.companyId, ctx.company.id))
      .orderBy(asc(accountMappings.key)),
  );
  const groupByKey = new Map<string, string>();
  for (const group of MAPPING_GROUPS) {
    for (const key of group.keys) groupByKey.set(key, group.title);
  }
  const headers = ["Kunci", "Label", "Grup", "Kode Akun", "Nama Akun"];
  const cells = rows.map((row) => [
    row.key,
    MAPPING_LABELS[row.key] ?? row.key,
    groupByKey.get(row.key) ?? "",
    row.code ?? "",
    row.name ?? "",
  ]);
  const filename = `pemetaan-akun-${todayISO()}`;
  if (format === "xlsx") {
    return xlsxResponse(`${filename}.xlsx`, [
      { name: "Pemetaan Akun", headers, rows: cells, widths: [26, 34, 28, 14, 36] },
    ]);
  }
  return csvResponse(`${filename}.csv`, toCsv(headers, cells));
}

export const GET = withApiError(GETHandler);
