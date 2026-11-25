import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { stockReceipts } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { claimIdempotencyKey, readIdempotencyResultRef } from "@/server/idempotency";

export type ReceiptIdempotencyInput = {
  companyId: string;
  idempotencyKey?: string | null;
};

/**
 * Claim/replay a receipt idempotency key. The stored fingerprint is compared
 * on replay so an edited retry after an ambiguous success cannot silently
 * return the original document. Missing fingerprints (legacy rows) are
 * treated as a conflict rather than a trusted replay.
 */
export async function claimReceiptIdempotency(
  tx: Tx,
  input: ReceiptIdempotencyInput,
  fingerprint: string | null,
): Promise<{ existing: { id: string; number: string } | undefined; idemKey: string | null }> {
  const idemKey = input.idempotencyKey?.trim() || null;
  const findReceiptByKey = async () => {
    if (!idemKey) return undefined;
    const [row] = await tx
      .select({ id: stockReceipts.id, number: stockReceipts.number })
      .from(stockReceipts)
      .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.idempotencyKey, idemKey)))
      .limit(1);
    return row;
  };
  if (idemKey) {
    const existing = await findReceiptByKey();
    if (existing) {
      const stored = await readIdempotencyResultRef(tx, {
        companyId: input.companyId,
        key: idemKey,
        scope: "inventory.receipt",
      });
      if (!fingerprint || stored !== fingerprint) {
        throw new AppError(
          "CONFLICT",
          "Kunci penerimaan sudah dipakai untuk data yang berbeda. Periksa dokumen penerimaan yang sudah ada sebelum mencoba lagi.",
        );
      }
      return { existing, idemKey };
    }
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: idemKey,
      scope: "inventory.receipt",
    });
    if (!claimed) {
      const winner = await findReceiptByKey();
      if (winner) {
        const stored = await readIdempotencyResultRef(tx, {
          companyId: input.companyId,
          key: idemKey,
          scope: "inventory.receipt",
        });
        if (!fingerprint || stored !== fingerprint) {
          throw new AppError(
            "CONFLICT",
            "Kunci penerimaan sudah dipakai untuk data yang berbeda. Periksa dokumen penerimaan yang sudah ada sebelum mencoba lagi.",
          );
        }
        return { existing: winner, idemKey };
      }
      throw new AppError(
        "CONFLICT",
        "Penerimaan dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }
  return { existing: undefined, idemKey };
}
