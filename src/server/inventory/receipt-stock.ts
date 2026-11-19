// Fase stok penerimaan barang (batch, ledger AVCO, nomor seri) —
// diekstrak dari receipts.ts agar berkas domain tetap di bawah ratchet.

import type { Tx } from "@/db";
import { addToBatch } from "@/server/batches";
import { registerSerialsIn } from "@/server/serials";
import { applyStockMovement } from "./movements";
import type { EffectiveReceiptLine } from "./receipt-types";

export async function applyReceiptStock(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    date: string;
  },
  receipt: { id: string; number: string },
  effectiveLines: EffectiveReceiptLine[],
  productById: Map<string, { trackBatch: boolean }>,
  openingMigration = false,
) {
  for (const line of effectiveLines) {
    if (openingMigration && line.qty.isZero()) continue;
    // Batch-tracked lines land in their batch row first; the movement then
    // carries that batch's id so the ledger slice and the batch row agree.
    let batchId: string | null = null;
    if (productById.get(line.productId)?.trackBatch) {
      const batch = await addToBatch(tx, {
        companyId: input.companyId,
        productId: line.productId,
        warehouseId: input.warehouseId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        delta: line.qty,
      });
      batchId = batch.id;
    }
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      productId: line.productId,
      delta: line.qty,
      // AVCO menyerap DPP (stockUnitCost), bukan harga faktur bruto,
      // bila PPN dipisah — lihat belah baris di effectiveLines.
      unitCost: line.stockUnitCost,
      movementType: openingMigration ? "opening_migration" : "purchase",
      allowNegative: openingMigration,
      referenceType: "stock_receipt",
      referenceId: receipt.id,
      referenceNumber: receipt.number,
      userId: input.userId,
      batchId,
      date: input.date,
    });
    if (line.serialNumbers.length > 0) {
      await registerSerialsIn(tx, {
        companyId: input.companyId,
        userId: input.userId,
        productId: line.productId,
        productName: line.productName,
        warehouseId: input.warehouseId,
        serialNumbers: line.serialNumbers,
        receiptId: receipt.id,
        receiptNumber: receipt.number,
      });
    }
  }
}
