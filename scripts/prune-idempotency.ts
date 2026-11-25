/**
 * Hapus idempotency key lama per perusahaan. Dijalankan oleh cron/systemd
 * timer, bukan saat app boot. Default retensi 30 hari; argumen pertama
 * dapat mengubahnya: `tsx scripts/prune-idempotency.ts 14`.
 */
import { db } from "@/db";
import { organization } from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { pruneExpiredIdempotencyKeys } from "@/server/idempotency";

async function main() {
  const days = Number(process.argv[2] ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("Retensi harus bilangan bulat 1–3650 hari.");
  }
  const companies = await db.select({ id: organization.id }).from(organization);
  let total = 0;
  for (const company of companies) {
    const removed = await withCompany(company.id, (tx) =>
      pruneExpiredIdempotencyKeys(tx, { companyId: company.id, retentionDays: days }),
    );
    total += removed;
    if (removed > 0) {
      console.log(`[prune-idempotency] ${company.id}: ${removed} baris`);
    }
  }
  console.log(`[prune-idempotency] selesai: ${total} baris, retensi ${days} hari.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("[prune-idempotency] gagal", error);
  process.exit(1);
});
