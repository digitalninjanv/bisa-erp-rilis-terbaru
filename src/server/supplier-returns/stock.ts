import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockBatches,
  stockMovements,
  supplierReturnLines,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type Decimal } from "@/lib/money";
import { applyBatchDelta, creditBatchById } from "@/server/batches";
import { applyStockMovement } from "@/server/inventory";
import { pickSerialsOut, restoreSerialsForSale } from "@/server/serials";
import type { SupplierReturnRow } from "./shared";

export type ReturnLineRow = typeof supplierReturnLines.$inferSelect;
export type ReturnProductRow = Pick<
  typeof products.$inferSelect,
  "id" | "name" | "costPrice" | "trackBatch" | "trackSerial"
>;
export type FrozenReturnLine = {
  line: ReturnLineRow;
  product: ReturnProductRow;
  qty: Decimal;
  unitCost: Decimal;
  lineTotal: Decimal;
};

/**
 * Bekukan nilai baris pada AVCO berjalan dan pra-periksa qty batch
 * eksplisit: applyBatchDelta mendebit batch eksplisit lebih dulu
 * tetapi membiarkan luapan jatuh ke FEFO, yang akan diam-diam
 * mengambil barang dari batch yang tidak dipilih pengguna.
 */
export async function freezeReturnLineValues(
  tx: Tx,
  input: {
    companyId: string;
    lines: ReturnLineRow[];
    productById: Map<string, ReturnProductRow>;
  },
): Promise<{ frozenLines: FrozenReturnLine[]; totalValue: Decimal }> {
  let totalValue = d(0);
  const frozenLines: FrozenReturnLine[] = [];
  for (const line of input.lines) {
    const product = input.productById.get(line.productId);
    if (!product) throw new AppError("VALIDATION", "Ada produk retur yang tidak ditemukan.");
    const qty = d(line.qty);
    const unitCost = d(product.costPrice);
    const lineTotal = qty.mul(unitCost);
    totalValue = totalValue.plus(lineTotal);
    if (product.trackBatch && line.batchId) {
      const [batch] = await tx
        .select({ qty: stockBatches.qty, batchNumber: stockBatches.batchNumber })
        .from(stockBatches)
        .where(and(eq(stockBatches.companyId, input.companyId), eq(stockBatches.id, line.batchId)))
        .limit(1)
        .for("update");
      if (!batch || d(batch.qty).lt(qty)) {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `Stok ${product.name} pada batch ${batch?.batchNumber ?? "terpilih"} tidak cukup. Tersedia ${batch ? d(batch.qty).toFixed(2) : "0"}.`,
        );
      }
    }
    frozenLines.push({ line, product, qty, unitCost, lineTotal });
  }
  return { frozenLines, totalValue };
}

/** Tulis nilai beku ke baris, keluarkan stok (batch/FEFO/serial) per baris. */
export async function issueReturnStock(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    header: SupplierReturnRow;
    frozenLines: FrozenReturnLine[];
  },
) {
  const { header } = input;
  for (const frozen of input.frozenLines) {
    await tx
      .update(supplierReturnLines)
      .set({ unitCost: toDb(frozen.unitCost), lineTotal: toDb(frozen.lineTotal) })
      .where(
        and(
          eq(supplierReturnLines.companyId, input.companyId),
          eq(supplierReturnLines.id, frozen.line.id),
        ),
      );

    if (frozen.product.trackBatch) {
      // Correction purpose: returning damaged/expired goods must be able
      // to draw expired batches too — removing them is the point.
      const slices = await applyBatchDelta(tx, {
        companyId: input.companyId,
        productId: frozen.line.productId,
        warehouseId: header.warehouseId,
        delta: frozen.qty.negated(),
        batchId: frozen.line.batchId ?? undefined,
        asOfDate: header.date,
        purpose: "correction",
      });
      for (const slice of slices) {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: header.warehouseId,
          productId: frozen.line.productId,
          delta: slice.qty.negated(),
          unitCost: frozen.unitCost,
          movementType: "purchase_return",
          referenceType: "supplier_return",
          referenceId: header.id,
          referenceNumber: header.number,
          reason: header.reasonDetail,
          userId: input.userId,
          batchId: slice.batchId,
          date: header.date,
        });
      }
    } else {
      await applyStockMovement(tx, {
        companyId: input.companyId,
        warehouseId: header.warehouseId,
        productId: frozen.line.productId,
        delta: frozen.qty.negated(),
        unitCost: frozen.unitCost,
        movementType: "purchase_return",
        referenceType: "supplier_return",
        referenceId: header.id,
        referenceNumber: header.number,
        reason: header.reasonDetail,
        userId: input.userId,
        date: header.date,
      });
    }
    if (frozen.product.trackSerial) {
      // SIM-2 S7B-2 Batch 5: unit serial yang diretur ke pemasok keluar
      // dari identitas stok (seri tertua lebih dulu).
      await pickSerialsOut(tx, {
        companyId: input.companyId,
        userId: input.userId,
        productId: frozen.line.productId,
        productName: frozen.product.name,
        warehouseId: header.warehouseId,
        qty: frozen.qty,
        referenceType: "supplier_return",
        referenceId: header.id,
        referenceNumber: header.number,
      });
    }
  }
}

/** Stok kembali masuk pada irisan gerakan asal persis, batch & seri ikut pulih. */
export async function restoreReturnedStock(
  tx: Tx,
  input: { companyId: string; userId: string; header: SupplierReturnRow; date: string; reason: string },
) {
  const { header } = input;
  const movements = await tx
    .select()
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, input.companyId),
        eq(stockMovements.referenceType, "supplier_return"),
        eq(stockMovements.referenceId, header.id),
      ),
    )
    .orderBy(asc(stockMovements.createdAt));
  for (const movement of movements) {
    const backQty = d(movement.qty).negated();
    if (movement.batchId) {
      await creditBatchById(tx, {
        companyId: input.companyId,
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        batchId: movement.batchId,
        qty: backQty,
      });
    }
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: movement.warehouseId,
      productId: movement.productId,
      delta: backQty,
      unitCost: movement.unitCost,
      movementType: "reversal",
      referenceType: "supplier_return_void",
      referenceId: header.id,
      referenceNumber: header.number,
      reason: input.reason,
      userId: input.userId,
      batchId: movement.batchId,
      date: input.date,
    });
  }

  // FIX-GDG Tahap 2 (GDG1-03): seri yang dikeluarkan retur ini ikut dipulihkan.
  for (const productId of [...new Set(movements.map((movement) => movement.productId))]) {
    await restoreSerialsForSale(tx, {
      companyId: input.companyId,
      userId: input.userId,
      saleId: header.id,
      productId,
      warehouseId: header.warehouseId,
      referenceType: "supplier_return_void",
      referenceId: header.id,
      referenceNumber: header.number,
    });
  }
}
