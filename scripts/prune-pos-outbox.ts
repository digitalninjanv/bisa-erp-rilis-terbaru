/**
 * Purge terminal POS offline-sale outbox rows older than the retention
 * window (default 180 days). Unresolved review/settlement rows are never
 * deleted. Run from cron/systemd, not at app boot:
 *
 *   pnpm prune:pos-outbox 180
 */
import { db } from "@/db";
import { organization } from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { pruneResolvedPosOutbox } from "@/server/pos/outbox-retention";

async function main() {
  const days = Number(process.argv[2] ?? 180);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("Retensi outbox harus bilangan bulat 1–3650 hari.");
  }
  const companies = await db.select({ id: organization.id }).from(organization);
  let total = 0;
  for (const company of companies) {
    const removed = await withCompany(company.id, (tx) =>
      pruneResolvedPosOutbox(tx, { companyId: company.id, retentionDays: days }),
    );
    total += removed;
    if (removed > 0) console.log(`[prune-pos-outbox] ${company.id}: ${removed} baris`);
  }
  console.log(`[prune-pos-outbox] selesai: ${total} baris, retensi ${days} hari.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("[prune-pos-outbox] gagal", error);
  process.exit(1);
});
