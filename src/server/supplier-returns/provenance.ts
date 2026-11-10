// A-26 Q8: asal-usul (provenance) qty retur — dipisah dari returns.ts
// agar plafon yang dapat diretur punya satu rumah bernama. Dipakai
// penasihat pembuatan draf (returns.ts) dan penilaian otoritatif
// posting (posting.ts). Perilaku tidak berubah dari blok asalnya.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  stockReceiptLines,
  stockReceipts,
  supplierReturnLines,
  supplierReturns,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, type Decimal } from "@/lib/money";
import { POSTED_RETURN_STATUSES, formatQtyExact } from "./shared";

type ReturnProvenance = { received: Decimal; returned: Decimal; replaced: Decimal };

/**
 * Asal-usul qty per produk untuk satu pemasok:
 * - received: Σ qty baris penerimaan TERPOSTING dari pemasok ini
 *   (penerimaan yang sudah di-void tidak dihitung);
 * - replaced: Σ qty barang pengganti yang sudah diterima dari pemasok
 *   ini lewat penyelesaian retur (barang itu fisiknya juga datang dari
 *   pemasok, jadi boleh diretur kembali);
 * - returned: Σ qty retur yang sudah terposting ke pemasok ini.
 * Plafon yang dapat diretur = received + replaced − returned.
 */
export async function getReturnProvenance(
  tx: Tx,
  companyId: string,
  supplierId: string,
  productIds: string[],
): Promise<Map<string, ReturnProvenance>> {
  const result = new Map<string, ReturnProvenance>();
  for (const productId of productIds) {
    result.set(productId, { received: d(0), returned: d(0), replaced: d(0) });
  }
  if (productIds.length === 0) return result;

  const receivedRows = await tx
    .select({
      productId: stockReceiptLines.productId,
      total: sql<string>`coalesce(sum(${stockReceiptLines.qty}), 0)`,
    })
    .from(stockReceiptLines)
    .innerJoin(stockReceipts, eq(stockReceiptLines.receiptId, stockReceipts.id))
    .where(
      and(
        eq(stockReceiptLines.companyId, companyId),
        eq(stockReceipts.supplierId, supplierId),
        eq(stockReceipts.status, "posted"),
        inArray(stockReceiptLines.productId, productIds),
      ),
    )
    .groupBy(stockReceiptLines.productId);
  for (const row of receivedRows) {
    result.get(row.productId)!.received = d(row.total);
  }

  const returnedRows = await tx
    .select({
      productId: supplierReturnLines.productId,
      total: sql<string>`coalesce(sum(${supplierReturnLines.qty}), 0)`,
      replaced: sql<string>`coalesce(sum(${supplierReturnLines.replacedQty}), 0)`,
    })
    .from(supplierReturnLines)
    .innerJoin(supplierReturns, eq(supplierReturnLines.returnId, supplierReturns.id))
    .where(
      and(
        eq(supplierReturnLines.companyId, companyId),
        eq(supplierReturns.supplierId, supplierId),
        inArray(supplierReturns.status, [...POSTED_RETURN_STATUSES]),
        inArray(supplierReturnLines.productId, productIds),
      ),
    )
    .groupBy(supplierReturnLines.productId);
  for (const row of returnedRows) {
    const entry = result.get(row.productId)!;
    entry.returned = d(row.total);
    entry.replaced = d(row.replaced);
  }
  return result;
}

/**
 * Tolak bila qty retur yang diminta (teragregasi per produk) melampaui
 * sisa yang dapat diretur dari pemasok ini. Dipakai dua kali:
 * penasihat saat pembuatan draf (tanpa kunci — draf tidak memesan
 * plafon) dan otoritatif saat posting di bawah kunci baris pemasok,
 * sehingga dua posting bersamaan tidak bisa sama-sama lolos.
 */
export async function assertReturnWithinProvenance(
  tx: Tx,
  input: {
    companyId: string;
    supplierId: string;
    requested: Map<string, Decimal>;
    productName: (productId: string) => string;
  },
): Promise<void> {
  const provenance = await getReturnProvenance(
    tx,
    input.companyId,
    input.supplierId,
    [...input.requested.keys()],
  );
  for (const [productId, qty] of input.requested) {
    const origin = provenance.get(productId) ?? { received: d(0), returned: d(0), replaced: d(0) };
    const everReceived = origin.received.plus(origin.replaced);
    const remaining = everReceived.minus(origin.returned);
    if (qty.gt(remaining)) {
      throw new AppError(
        "VALIDATION",
        `Jumlah retur ${input.productName(productId)} (${formatQtyExact(qty)}) melebihi sisa yang dapat diretur dari pemasok ini: ` +
          `pernah diterima ${formatQtyExact(everReceived)}, sudah diretur ${formatQtyExact(origin.returned)}, sisa yang dapat diretur ${formatQtyExact(remaining)}. ` +
          "Periksa kembali pemasok asal barang ini atau kurangi jumlah retur.",
      );
    }
  }
}
