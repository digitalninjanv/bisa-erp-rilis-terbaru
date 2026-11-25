import type { Tx } from "@/db";
import {
  claimIdempotencyKey,
  readIdempotencyResultRef,
  writeIdempotencyResultRef,
} from "@/server/idempotency";

const RECEIPT_TOKEN_SCOPE = "pos.receipt.fresh";
const RECEIPT_TOKEN_TTL_MS = 10 * 60 * 1000;

type ReceiptTokenPayload = {
  type: "pos.receipt.fresh";
  companyId: string;
  userId: string;
  saleId: string;
  expiresAt: number;
};

/**
 * Token cetak pertama dari alur checkout. Cetak ulang historis tetap
 * memerlukan izin `pos.receipt.reprint` dan audit; token ini hanya
 * membuktikan bahwa halaman nota dibuka oleh kasir yang baru saja
 * menyelesaikan penjualan tersebut.
 */
export async function issueReceiptPrintToken(
  tx: Tx,
  input: { companyId: string; userId: string; saleId: string },
): Promise<string> {
  const token = crypto.randomUUID();
  await claimIdempotencyKey(tx, {
    companyId: input.companyId,
    key: token,
    scope: RECEIPT_TOKEN_SCOPE,
  });
  const payload: ReceiptTokenPayload = {
    type: "pos.receipt.fresh",
    companyId: input.companyId,
    userId: input.userId,
    saleId: input.saleId,
    expiresAt: Date.now() + RECEIPT_TOKEN_TTL_MS,
  };
  await writeIdempotencyResultRef(tx, {
    companyId: input.companyId,
    key: token,
    scope: RECEIPT_TOKEN_SCOPE,
    resultRef: JSON.stringify(payload),
  });
  return token;
}

export async function verifyReceiptPrintToken(
  tx: Tx,
  input: { companyId: string; userId: string; saleId: string; token: string | null | undefined },
): Promise<boolean> {
  if (!input.token) return false;
  const stored = await readIdempotencyResultRef(tx, {
    companyId: input.companyId,
    key: input.token,
    scope: RECEIPT_TOKEN_SCOPE,
  });
  if (!stored) return false;
  try {
    const payload = JSON.parse(stored) as ReceiptTokenPayload;
    return (
      payload.type === "pos.receipt.fresh" &&
      payload.companyId === input.companyId &&
      payload.userId === input.userId &&
      payload.saleId === input.saleId &&
      payload.expiresAt > Date.now()
    );
  } catch {
    return false;
  }
}
