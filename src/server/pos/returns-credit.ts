// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: baca kredit retur (D-12) dipisah dari returns.ts.

import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { saleReturns, sales } from "@/db/schema";
import { d } from "@/lib/money";

export type ReturnCredit = {
  returnId: string;
  number: string;
  total: number;
  used: number;
  available: number;
  saleNumber: string;
};

/**
 * D-12: sisa kredit sebuah dokumen retur exchange/store_credit. Dokumen
 * retur adalah voucher-nya — berlaku juga untuk penjualan walk-in tanpa
 * pelanggan terdaftar, karena yang dirujuk adalah nomor dokumennya.
 * Mengembalikan null bila dokumen tidak ada di perusahaan ini, belum
 * final (status bukan posted), atau metode penyelesaiannya bukan
 * exchange/store_credit — retur tunai/transfer tidak melahirkan kredit.
 */


export async function getReturnCredit(
  tx: Tx,
  companyId: string,
  returnNumber: string,
): Promise<ReturnCredit | null> {
  const [row] = await tx
    .select({
      id: saleReturns.id,
      number: saleReturns.number,
      status: saleReturns.status,
      refundMethod: saleReturns.refundMethod,
      total: saleReturns.total,
      creditUsed: saleReturns.creditUsed,
      saleNumber: sales.number,
    })
    .from(saleReturns)
    .innerJoin(sales, eq(saleReturns.saleId, sales.id))
    .where(and(eq(saleReturns.companyId, companyId), eq(saleReturns.number, returnNumber.trim())))
    .limit(1);
  if (!row) return null;
  if (row.status !== "posted") return null;
  if (row.refundMethod !== "exchange" && row.refundMethod !== "store_credit") return null;
  const total = d(row.total);
  const used = d(row.creditUsed);
  return {
    returnId: row.id,
    number: row.number,
    total: total.toNumber(),
    used: used.toNumber(),
    available: total.minus(used).toNumber(),
    saleNumber: row.saleNumber,
  };
}
