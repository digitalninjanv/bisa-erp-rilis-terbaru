// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: helper stok penjualan — flag pelacakan & pemulihan
// batch baris penjualan (dipakai void & retur).

import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { products } from "@/db/schema";
import { d, Decimal, MoneyInput } from "@/lib/money";
import { applyBatchDelta, planBatchRestore } from "@/server/batches";
import { applyStockMovement } from "@/server/inventory";

/**
 * Stock-tracking flags for the given products. Only an explicit
 * trackStock=false skips stock movements; a product row that no longer
 * exists defaults to tracked (the historical behavior for old sales).
 */


export async function trackStockFlags(
  tx: Tx,
  companyId: string,
  productIds: string[],
): Promise<Map<string, boolean>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: products.id, trackStock: products.trackStock })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
  return new Map(rows.map((row) => [row.id, row.trackStock]));
}

/** Batch-tracking flags (G8/D-7); missing products default to untracked. */


export async function batchTrackFlags(
  tx: Tx,
  companyId: string,
  productIds: string[],
): Promise<Map<string, boolean>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: products.id, trackBatch: products.trackBatch })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
  return new Map(rows.map((row) => [row.id, row.trackBatch]));
}

/**
 * Put `qty` of one sold line back onto the batches the sale drew from
 * (G8/D-7), writing one stock movement per restored slice. Quantities the
 * restore plan cannot place (sales predating batch tracking) land in the
 * batch-null remainder. Used by both sale void and sale returns; only the
 * movement reference differs.
 */


export async function restoreSaleLineBatches(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    productId: string;
    saleId: string;
    referenceNumber: string;
    qty: Decimal;
    unitCost: MoneyInput;
    referenceType: string;
    referenceId: string;
    reason?: string;
    // FIX-GDG Tahap 2 (GDG3-03): tanggal dokumen pemulih (retur/void).
    date?: string;
  },
) {
  const plan = await planBatchRestore(tx, {
    companyId: input.companyId,
    productId: input.productId,
    warehouseId: input.warehouseId,
    saleId: input.saleId,
    qty: input.qty,
  });
  let restored = d(0);
  const slices = [...plan];
  const leftover = input.qty.minus(plan.reduce((acc, slice) => acc.plus(slice.qty), d(0)));
  if (leftover.gt(0)) {
    const [remainder] = await applyBatchDelta(tx, {
      companyId: input.companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      delta: leftover,
      purpose: "correction",
    });
    if (remainder) slices.push(remainder);
  }
  for (const slice of slices) {
    if (plan.includes(slice)) {
      await applyBatchDelta(tx, {
        companyId: input.companyId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        delta: slice.qty,
        batchId: slice.batchId,
        purpose: "correction",
      });
    }
    restored = restored.plus(slice.qty);
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      delta: slice.qty,
      unitCost: input.unitCost,
      movementType: "sale_return",
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      reason: input.reason,
      userId: input.userId,
      allowNegative: true,
      batchId: slice.batchId,
      date: input.date,
    });
  }
  return restored;
}
