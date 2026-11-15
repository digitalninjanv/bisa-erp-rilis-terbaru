// A-26 Q8: asal-usul (provenance) qty retur — dipisah dari returns.ts
// agar plafon yang dapat diretur punya satu rumah bernama. Dipakai
// penasihat pembuatan draf (returns.ts) dan penilaian otoritatif
// posting (posting.ts). Perilaku tidak berubah dari blok asalnya.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockBatches,
  stockReceiptLines,
  stockReceipts,
  supplierReturnLines,
  supplierReturns,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, type Decimal } from "@/lib/money";
import { matchesReceiptBatchIdentity } from "@/lib/supplier-return-batch";
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

/**
 * Enforce the remaining quantity of each selected purchase-receipt line.
 * Supplier/product provenance is intentionally broader for manual returns;
 * a return started from a receipt must also stay within that exact line.
 * Re-run this at posting while the supplier row is locked so concurrent
 * drafts cannot collectively return more than the source receipt supplied.
 */
export async function assertReturnWithinReceiptLines(
  tx: Tx,
  input: {
    companyId: string;
    supplierId: string;
    warehouseId: string;
    lines: {
      receiptLineId: string | null | undefined;
      productId: string;
      batchId: string | null | undefined;
      qty: Decimal;
      productName: string;
    }[];
  },
): Promise<void> {
  const requested = new Map<
    string,
    { qty: Decimal; productName: string; productId: string; batchId: string | null }
  >();
  for (const line of input.lines) {
    if (!line.receiptLineId) continue;
    const current = requested.get(line.receiptLineId);
    if (
      current &&
      (current.productId !== line.productId || current.batchId !== (line.batchId ?? null))
    ) {
      throw new AppError("VALIDATION", "Satu baris retur tidak boleh memakai produk atau batch sumber yang berbeda.");
    }
    requested.set(line.receiptLineId, {
      qty: (current?.qty ?? d(0)).plus(line.qty),
      productName: line.productName,
      productId: line.productId,
      batchId: line.batchId ?? null,
    });
  }
  const receiptLineIds = [...requested.keys()];
  if (receiptLineIds.length === 0) return;

  const origins = await tx
    .select({
      id: stockReceiptLines.id,
      qty: stockReceiptLines.qty,
      productId: stockReceiptLines.productId,
      supplierId: stockReceipts.supplierId,
      source: stockReceipts.source,
      status: stockReceipts.status,
      warehouseId: stockReceipts.warehouseId,
      batchNumber: stockReceiptLines.batchNumber,
      expiryDate: stockReceiptLines.expiryDate,
      trackBatch: products.trackBatch,
    })
    .from(stockReceiptLines)
    .innerJoin(stockReceipts, eq(stockReceiptLines.receiptId, stockReceipts.id))
    .innerJoin(products, eq(stockReceiptLines.productId, products.id))
    .where(
      and(
        eq(stockReceiptLines.companyId, input.companyId),
        inArray(stockReceiptLines.id, receiptLineIds),
      ),
    );
  if (origins.length !== receiptLineIds.length) {
    throw new AppError("VALIDATION", "Baris penerimaan asal tidak ditemukan.");
  }

  const returnedRows = await tx
    .select({
      receiptLineId: supplierReturnLines.receiptLineId,
      qty: sql<string>`coalesce(sum(${supplierReturnLines.qty}), 0)`,
    })
    .from(supplierReturnLines)
    .innerJoin(supplierReturns, eq(supplierReturnLines.returnId, supplierReturns.id))
    .where(
      and(
        eq(supplierReturnLines.companyId, input.companyId),
        inArray(supplierReturnLines.receiptLineId, receiptLineIds),
        inArray(supplierReturns.status, [...POSTED_RETURN_STATUSES]),
      ),
    )
    .groupBy(supplierReturnLines.receiptLineId);
  const returnedByLine = new Map(returnedRows.map((row) => [row.receiptLineId, d(row.qty)]));
  const batchIds = [...new Set([...requested.values()].flatMap((line) => line.batchId ? [line.batchId] : []))];
  const batchRows = batchIds.length > 0
    ? await tx
        .select({
          id: stockBatches.id,
          productId: stockBatches.productId,
          warehouseId: stockBatches.warehouseId,
          batchNumber: stockBatches.batchNumber,
          expiryDate: stockBatches.expiryDate,
        })
        .from(stockBatches)
        .where(and(eq(stockBatches.companyId, input.companyId), inArray(stockBatches.id, batchIds)))
    : [];
  const batchById = new Map(batchRows.map((batch) => [batch.id, batch]));

  for (const origin of origins) {
    if (
      origin.source !== "purchase" ||
      origin.status !== "posted" ||
      origin.supplierId !== input.supplierId
    ) {
      throw new AppError(
        "VALIDATION",
        "Retur dari dokumen harus memakai penerimaan pembelian terposting milik pemasok yang sama.",
      );
    }
    const line = requested.get(origin.id)!;
    if (origin.productId !== line.productId || origin.warehouseId !== input.warehouseId) {
      throw new AppError("VALIDATION", "Retur harus mempertahankan produk dan gudang pada penerimaan asal.");
    }
    if (origin.trackBatch) {
      const batch = line.batchId ? batchById.get(line.batchId) : undefined;
      if (
        !batch ||
        batch.productId !== origin.productId ||
        batch.warehouseId !== origin.warehouseId ||
        !matchesReceiptBatchIdentity(origin, batch)
      ) {
        throw new AppError("VALIDATION", `Batch retur ${line.productName} harus sama dengan batch pada penerimaan asal.`);
      }
    }
    const remaining = d(origin.qty).minus(returnedByLine.get(origin.id) ?? d(0));
    if (line.qty.gt(remaining)) {
      throw new AppError(
        "VALIDATION",
        `Qty retur ${line.productName} melebihi sisa pada penerimaan asal (${remaining.toFixed(4)}).`,
      );
    }
  }
}
