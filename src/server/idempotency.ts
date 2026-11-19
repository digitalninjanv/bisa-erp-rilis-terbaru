import type { Tx } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";

/**
 * GDG3-06 — klaim kunci idempotensi dokumen, pola yang sama dengan
 * POS-IDEM-01 di checkout POS: sisipkan klaim ke tabel bersama
 * `idempotency_keys` di dalam transaksi dokumen itu sendiri.
 *
 * Mengembalikan `true` bila kunci berhasil diklaim oleh transaksi ini
 * (silakan lanjut membuat dokumen). Mengembalikan `false` bila kunci
 * sudah dimiliki transaksi lain: panggilan `onConflictDoNothing` akan
 * MENUNGGU sampai pemilik kunci commit (dokumennya lalu dapat dibaca
 * ulang oleh pemanggil dan dikembalikan sebagai hasil replay) atau
 * rollback (klaim ini lalu berhasil pada percobaan berikutnya — dalam
 * praktiknya pemanggil melempar CONFLICT agar klien mengulang dengan
 * kunci yang sama dan menemukan dokumen pemenang).
 *
 * Klaim hidup di transaksi yang sama dengan dokumennya: bila pembuatan
 * dokumen gagal dan transaksi rollback, klaim ikut lepas.
 */
export async function claimIdempotencyKey(
  tx: Tx,
  input: { companyId: string; key: string; scope: string },
): Promise<boolean> {
  const [claim] = await tx
    .insert(idempotencyKeys)
    .values({ companyId: input.companyId, key: input.key, scope: input.scope })
    .onConflictDoNothing({ target: [idempotencyKeys.companyId, idempotencyKeys.scope, idempotencyKeys.key] })
    .returning({ id: idempotencyKeys.id });
  return Boolean(claim);
}

/** Read the stored replay result through the platform idempotency owner. */
export async function readIdempotencyResultRef(
  tx: Tx,
  input: { companyId: string; key: string; scope: string },
): Promise<string | null> {
  const [row] = await tx
    .select({ resultRef: idempotencyKeys.resultRef })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.companyId, input.companyId),
        eq(idempotencyKeys.scope, input.scope),
        eq(idempotencyKeys.key, input.key),
      ),
    )
    .limit(1);
  return row?.resultRef ?? null;
}

/** Persist replay data for a key claimed in the same transaction. */
export async function writeIdempotencyResultRef(
  tx: Tx,
  input: { companyId: string; key: string; scope: string; resultRef: string },
): Promise<void> {
  const [row] = await tx
    .update(idempotencyKeys)
    .set({ resultRef: input.resultRef })
    .where(
      and(
        eq(idempotencyKeys.companyId, input.companyId),
        eq(idempotencyKeys.scope, input.scope),
        eq(idempotencyKeys.key, input.key),
      ),
    )
    .returning({ id: idempotencyKeys.id });
  if (!row) throw new AppError("CONFLICT", "Kunci idempotensi tidak tersedia untuk menyimpan hasil transaksi.");
}

const PAYMENT_IDEMPOTENCY_SCOPE = "accounting.payment";
const PAYMENT_RESULT_TYPE = "accounting-payment-result";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Stable digest of the normalized business request; raw payment details are not duplicated in the key registry. */
export function paymentRequestFingerprint(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(request))).digest("hex");
}

/**
 * Run one accounting payment once per client key, in the same transaction
 * as its journal and balance changes. A replay with the same request returns
 * the stored result; reuse of the key for different data is a conflict.
 */
export async function runIdempotentPayment<T>(
  tx: Tx,
  input: { companyId: string; key: string; request: unknown },
  run: () => Promise<T>,
): Promise<T> {
  const fingerprint = paymentRequestFingerprint(input.request);
  const claimed = await claimIdempotencyKey(tx, {
    companyId: input.companyId,
    key: input.key,
    scope: PAYMENT_IDEMPOTENCY_SCOPE,
  });

  if (!claimed) {
    const [existing] = await tx
      .select({ resultRef: idempotencyKeys.resultRef })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.companyId, input.companyId),
          eq(idempotencyKeys.scope, PAYMENT_IDEMPOTENCY_SCOPE),
          eq(idempotencyKeys.key, input.key),
        ),
      )
      .limit(1);
    if (!existing?.resultRef) {
      throw new AppError("CONFLICT", "Pembayaran dengan kunci ini belum memiliki hasil tersimpan. Muat ulang sebelum mencoba lagi.");
    }

    let stored: unknown;
    try {
      stored = JSON.parse(existing.resultRef);
    } catch {
      throw new AppError("CONFLICT", "Hasil pembayaran sebelumnya tidak dapat dibaca. Jangan kirim ulang transaksi ini.");
    }
    if (
      !stored ||
      typeof stored !== "object" ||
      !("type" in stored) ||
      stored.type !== PAYMENT_RESULT_TYPE ||
      !("fingerprint" in stored) ||
      stored.fingerprint !== fingerprint ||
      !("result" in stored)
    ) {
      throw new AppError("CONFLICT", "Kunci pembayaran sudah digunakan untuk data yang berbeda.");
    }
    return stored.result as T;
  }

  const result = await run();
  await tx
    .update(idempotencyKeys)
    .set({ resultRef: JSON.stringify({ type: PAYMENT_RESULT_TYPE, fingerprint, result }) })
    .where(
      and(
        eq(idempotencyKeys.companyId, input.companyId),
        eq(idempotencyKeys.scope, PAYMENT_IDEMPOTENCY_SCOPE),
        eq(idempotencyKeys.key, input.key),
      ),
    );
  return result;
}

/** Order browser checkout and offline reconciliation for the same sale attempt. */
export async function lockPosSaleAttempt(tx: Tx, companyId: string, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pos.sale:${companyId}:${key}`}, 0))`);
}
