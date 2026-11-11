// A-26 Q8: pembatalan penerimaan — dipisah dari receipts.ts dan
// dipecah per fase bernama (penjaga keterbatalan → penjaga stok →
// balik jurnal → balik stok → lepas PO). Perilaku, urutan langkah,
// urutan kunci, & pesan identik dengan voidReceipt asal di
// receipts.ts sebelum tahap ini.

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  journalEntries,
  products,
  stockReceiptLines,
  stockReceipts,
  supplierReturnAllocations,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { reverseJournalEntry } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { applyBatchDelta } from "@/server/batches";
import { lockPurchaseOrderHeader, releaseReceiptFromPurchaseOrder } from "@/server/purchasing";
import { voidSerialsForReceipt } from "@/server/serials";
import { applyStockMovement, lockStockQty, recomputeCostFromLedger } from "./movements";
import { getReceiptAdvanceApplied, restorePurchaseAdvancesForReceipt } from "@/server/purchase-advances";

type ReceiptRow = typeof stockReceipts.$inferSelect;

async function loadVoidLines(tx: Tx, companyId: string, receiptId: string) {
  return tx
    .select({
      productId: stockReceiptLines.productId,
      qty: stockReceiptLines.qty,
      unitCost: stockReceiptLines.unitCost,
      lineTotal: stockReceiptLines.lineTotal,
      batchNumber: stockReceiptLines.batchNumber,
      expiryDate: stockReceiptLines.expiryDate,
      // REM-02: pesan penjaga memakai snapshot nama baris penerimaan.
      productName: sql<string>`coalesce(${stockReceiptLines.productName}, ${products.name})`,
      trackBatch: products.trackBatch,
    })
    .from(stockReceiptLines)
    .innerJoin(products, eq(stockReceiptLines.productId, products.id))
    .where(and(eq(stockReceiptLines.companyId, companyId), eq(stockReceiptLines.receiptId, receiptId)));
}

type VoidLine = Awaited<ReturnType<typeof loadVoidLines>>[number];

/**
 * Penjaga keterbatalan: status posted, belum terbayar (pembelian
 * kredit), dan belum dilunasi retur pemasok.
 */
async function assertReceiptVoidable(tx: Tx, companyId: string, receipt: ReceiptRow) {
  if (receipt.status === "void") throw new AppError("INVALID_STATE", "Penerimaan sudah dibatalkan.");
  if (receipt.status !== "posted") {
    throw new AppError("INVALID_STATE", "Hanya penerimaan berstatus posted yang bisa dibatalkan.");
  }
  // Same rule as a paid payroll run: once the payable has been paid, voiding
  // the receipt would leave the payment hanging without a document. The
  // payment itself must be voided first. This guard only applies to credit
  // purchases (D-5): a cash purchase's paidAmount is its own birth payment
  // and is undone by reversing the receipt journal itself, and
  // non-purchase receipts never have payments.
  const isCreditPurchase = receipt.source === "purchase" && !receipt.paymentAccountId;
  const advanceApplied = isCreditPurchase
    ? await getReceiptAdvanceApplied(tx, companyId, receipt.id)
    : d(0);
  if (isCreditPurchase && d(receipt.paidAmount).gt(advanceApplied)) {
    throw new AppError(
      "INVALID_STATE",
      `Penerimaan ${receipt.number} sudah memiliki pembayaran utang dan tidak bisa dibatalkan. Batalkan pembayaran utang terlebih dahulu bila pembayaran itu memang salah.`,
    );
  }
  // A-9 (D-20): same guard for supplier returns — a return may have
  // settled part of this payable without cash (allocations in
  // supplier_return_allocations, queried directly here to avoid an
  // import cycle with the returns domain). Voiding the receipt would
  // leave the return's Dr Utang Dagang pointing at a dead document.
  if (isCreditPurchase) {
    const [returnAlloc] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(supplierReturnAllocations)
      .where(
        and(
          eq(supplierReturnAllocations.companyId, companyId),
          eq(supplierReturnAllocations.receiptId, receipt.id),
        ),
      );
    if ((returnAlloc?.value ?? 0) > 0) {
      throw new AppError(
        "INVALID_STATE",
        `Penerimaan ${receipt.number} sudah dilunasi sebagian oleh retur pembelian dan tidak bisa dibatalkan. Batalkan retur pembelian terkait terlebih dahulu.`,
      );
    }
  }
}

/**
 * Stock guard, checked for every line before anything is written: the
 * reversal takes the received qty back out of the same warehouse, so if
 * part of it was already consumed or sold the void would silently drive
 * stock negative. Reject, naming the product.
 */
async function assertVoidStockAvailable(
  tx: Tx,
  input: { companyId: string; warehouseId: string; receiptNumber: string; lines: VoidLine[] },
) {
  for (const line of input.lines) {
    const available = await lockStockQty(tx, input.companyId, input.warehouseId, line.productId);
    if (available.lt(d(line.qty))) {
      throw new AppError(
        "VALIDATION",
        `Stok ${line.productName} di gudang penerimaan tinggal ${available.toFixed(2)}, kurang dari qty penerimaan ${d(line.qty).toFixed(2)} yang akan dibatalkan — sebagian stok sudah terpakai atau terjual, jadi penerimaan ${input.receiptNumber} tidak bisa dibatalkan.`,
      );
    }
  }
}

/**
 * createReceipt only posts its journal when the receipt total is > 0, so a
 * reversal is only owed under the same condition. The journal is found by
 * the document's sourceId — never by guessing a sourceType (D-5) — and
 * payment journals (sourceType "payment", same sourceId) are excluded:
 * they belong to payPayableAction, not to this document. When a journal
 * is owed but missing, the void fails hard (AK-P2-05 pattern) instead of
 * leaving the document voided with its books still standing.
 */
async function reverseReceiptJournal(
  tx: Tx,
  input: { companyId: string; userId: string; receipt: ReceiptRow; date: string; reason: string },
): Promise<{ id: string; number: string } | null> {
  const { receipt } = input;
  if (!d(receipt.total).gt(0)) return null;
  const [original] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.sourceId, receipt.id),
        eq(journalEntries.status, "posted"),
        isNull(journalEntries.reversalOfId),
        ne(journalEntries.sourceType, "payment"),
      ),
    )
    .orderBy(asc(journalEntries.createdAt))
    .limit(1);
  if (!original) {
    throw new AppError(
      "VALIDATION",
      `Jurnal asal penerimaan ${receipt.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan penerimaan dibatalkan agar stok dan buku besar tetap selaras; periksa jurnal penerimaan ini terlebih dahulu.`,
    );
  }
  const result = await reverseJournalEntry(tx, {
    companyId: input.companyId,
    entryId: original.id,
    date: input.date,
    description: `Pembatalan penerimaan ${receipt.number} — ${input.reason}`,
    createdBy: input.userId,
  });
  return result.reversal;
}

/** Keluarkan kembali stok penerimaan per baris (batch FEFO bila terlacak), lalu bangun ulang AVCO dari buku gerakan. */
async function reverseReceiptStock(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    receipt: ReceiptRow;
    lines: VoidLine[];
    date: string;
    reason: string;
  },
) {
  const { receipt } = input;
  for (const line of input.lines) {
    // Nilai persediaan masuk pada DPP/net (lineTotal), bukan harga
    // faktur bruto. Void harus memakai biaya per unit yang sama agar
    // AVCO dan GL tetap cocok saat PPN/diskon dipisah.
    const reversalUnitCost = d(line.qty).gt(0)
      ? d(line.lineTotal).div(line.qty)
      : d(line.unitCost);
    // Batch-tracked lines leave the batch they arrived in (G8/D-7); if
    // FEFO sales already consumed part of it, the overflow is taken FEFO
    // across the remaining batches so no batch row goes negative alone.
    if (line.trackBatch) {
      const slices = await applyBatchDelta(tx, {
        companyId: input.companyId,
        productId: line.productId,
        warehouseId: receipt.warehouseId,
        delta: d(line.qty).negated(),
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        purpose: "correction",
      });
      for (const slice of slices) {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: receipt.warehouseId,
          productId: line.productId,
          delta: slice.qty.negated(),
          unitCost: reversalUnitCost,
          movementType: "reversal",
          referenceType: "stock_receipt_void",
          referenceId: receipt.id,
          referenceNumber: receipt.number,
          reason: input.reason,
          userId: input.userId,
          batchId: slice.batchId,
          date: input.date,
        });
      }
      continue;
    }
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: receipt.warehouseId,
      productId: line.productId,
      delta: d(line.qty).negated(),
      unitCost: reversalUnitCost,
      // "reversal" movements never feed the incremental blend (only
      // positive purchase/sale-return movements do); the void's effect
      // on the average is applied once, explicitly, by
      // recomputeCostFromLedger below (FIX-P1 AK4-06b).
      movementType: "reversal",
      referenceType: "stock_receipt_void",
      referenceId: receipt.id,
      referenceNumber: receipt.number,
      reason: input.reason,
      userId: input.userId,
      date: input.date,
    });
  }

  // FIX-P1 (AK4-06b): with the mirror movements written, rebuild each
  // affected product's moving average from the remaining ledger so the
  // stock valuation (Σ qty × costPrice) matches the GL again.
  for (const productId of [...new Set(input.lines.map((line) => line.productId))]) {
    await recomputeCostFromLedger(tx, input.companyId, productId);
  }
}

export async function voidReceipt(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    receiptId: string;
    reason: string;
    date: string;
  },
) {
  if (!input.reason.trim()) throw new AppError("VALIDATION", "Alasan pembatalan wajib diisi.");

  const [receipt] = await tx
    .select()
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, input.receiptId)))
    .limit(1)
    .for("update");
  if (!receipt) throw new AppError("NOT_FOUND", "Penerimaan tidak ditemukan.");
  await assertReceiptVoidable(tx, input.companyId, receipt);

  // R-2: lock the linked PO header BEFORE the stock guard below, the
  // same lock order createReceipt uses (PO header → stock rows). Without
  // this, a void and a fresh receipt against the same PO could interleave
  // their stock/PO writes in opposite orders.
  if (receipt.purchaseOrderId) {
    await lockPurchaseOrderHeader(tx, input.companyId, receipt.purchaseOrderId);
  }

  const lines = await loadVoidLines(tx, input.companyId, receipt.id);
  await assertVoidStockAvailable(tx, {
    companyId: input.companyId,
    warehouseId: receipt.warehouseId,
    receiptNumber: receipt.number,
    lines,
  });

  const reversal = await reverseReceiptJournal(tx, {
    companyId: input.companyId,
    userId: input.userId,
    receipt,
    date: input.date,
    reason: input.reason,
  });

  await reverseReceiptStock(tx, {
    companyId: input.companyId,
    userId: input.userId,
    receipt,
    lines,
    date: input.date,
    reason: input.reason,
  });

  // Uang muka yang dipotong saat penerimaan kembali menjadi saldo siap pakai.
  await restorePurchaseAdvancesForReceipt(tx, input.companyId, receipt.id);

  // SIM-2 S7B-2 Batch 5: seri milik penerimaan ini ikut dibatalkan —
  // ditolak bila ada unit yang sudah keluar (voidSerialsForReceipt).
  await voidSerialsForReceipt(tx, {
    companyId: input.companyId,
    userId: input.userId,
    receiptId: receipt.id,
    receiptNumber: receipt.number,
  });

  // A voided receipt must give its quantities back to the linked PO
  // (G7/D-6), or the order would stay fulfilled by goods that left again.
  if (receipt.purchaseOrderId) {
    await releaseReceiptFromPurchaseOrder(tx, {
      companyId: input.companyId,
      orderId: receipt.purchaseOrderId,
      lines,
    });
  }

  await tx
    .update(stockReceipts)
    .set({ status: "void" })
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, receipt.id)));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase.void",
    entityType: "stock_receipt",
    entityId: receipt.id,
    after: { number: receipt.number, reason: input.reason, reversalNumber: reversal?.number },
  });

  return { id: receipt.id, number: receipt.number };
}
