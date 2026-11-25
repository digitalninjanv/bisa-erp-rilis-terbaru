import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { outbox } from "@/db/schema";
import type { OfflineSalePayload } from "@/lib/pos-offline";

export function snapshotTotalOf(item: OfflineSalePayload): number {
  if (item.expectedTotal != null) return item.expectedTotal;
  return item.payments.reduce((sum, payment) => sum + payment.amount, 0);
}

export function offlinePayloadLines(item: OfflineSalePayload) {
  return item.lines.map((line) => ({
    productId: line.productId,
    qty: line.qty,
    discountType: line.discountType ?? null,
    discountValue: line.discountValue ?? 0,
    serialNumbers: line.serialNumbers,
    unitPrice: line.unitPrice,
    packagingId: line.packagingId ?? null,
    isiSnapshot: line.isiSnapshot,
  }));
}

export function offlinePayloadPayments(item: OfflineSalePayload) {
  return item.payments.map((payment) => ({
    methodId: payment.methodId,
    amount: payment.amount,
    tendered: payment.tendered,
    reference: payment.reference,
    fee: payment.fee,
  }));
}

/**
 * Tombstone peninjauan: supervisor sudah membuang/menandai selesai item ini.
 * Terminal tidak boleh mengirim ulang dan memposting penjualan yang sudah
 * diputuskan final — bahkan bila harga/stok kemudian berubah.
 */
export async function findTerminalOfflineResolution(
  tx: Tx,
  companyId: string,
  clientKey: string,
): Promise<"discarded" | "done" | null> {
  const [row] = await tx
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(
      and(
        eq(outbox.companyId, companyId),
        eq(outbox.eventType, "pos_offline_sale"),
        sql`${outbox.payload}->>'clientKey' = ${clientKey}`,
        sql`${outbox.payload}->'resolution'->>'action' in ('discarded', 'done')`,
      ),
    )
    .orderBy(desc(outbox.createdAt))
    .limit(1);
  const action = (row?.payload as { resolution?: { action?: string } } | undefined)?.resolution
    ?.action;
  return action === "discarded" || action === "done" ? action : null;
}
