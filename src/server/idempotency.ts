import type { Tx } from "@/db";
import { idempotencyKeys } from "@/db/schema";

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
    .onConflictDoNothing({ target: [idempotencyKeys.companyId, idempotencyKeys.key] })
    .returning({ id: idempotencyKeys.id });
  return Boolean(claim);
}
