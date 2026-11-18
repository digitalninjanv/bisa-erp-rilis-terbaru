import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import { getCompanySettingsRow } from "@/server/settings";

/** Enforce the company-level switch before accepting an offline sale. */
export async function assertOfflineEnabled(tx: Tx, companyId: string) {
  const settings = await getCompanySettingsRow(tx, companyId);
  if (!settings?.posOfflineEnabled) {
    throw new AppError(
      "FORBIDDEN",
      "Mode offline POS tidak aktif untuk perusahaan ini. Aktifkan saklar Mode offline POS di Pengaturan.",
    );
  }
}
