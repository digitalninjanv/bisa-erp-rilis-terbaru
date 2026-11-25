import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Tx } from "@/db";
import { outbox } from "@/db/schema/platform";

/**
 * Retire resolved POS offline-sale outbox rows after a bounded retention.
 *
 * Unresolved rows (processedAt IS NULL) are never deleted: they are the
 * supervisor review/settlement queue. This only removes terminal attempts
 * whose full payload is no longer needed for reconciliation. The retention
 * period remains a business decision; the CLI exposes it explicitly.
 */
export async function pruneResolvedPosOutbox(
  tx: Tx,
  input: { companyId: string; retentionDays?: number },
): Promise<number> {
  const days = Math.min(Math.max(Math.trunc(input.retentionDays ?? 180), 1), 3650);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await tx
    .delete(outbox)
    .where(
      and(
        eq(outbox.companyId, input.companyId),
        eq(outbox.eventType, "pos_offline_sale"),
        isNotNull(outbox.processedAt),
        lt(outbox.processedAt, cutoff),
      ),
    )
    .returning({ id: outbox.id });
  return deleted.length;
}
