// FIX-ARS Tahap 4: bagian dari pemecahan src/server/inventory.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/inventory.ts.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  opnameTasks,
  products,
  stockDocumentLines,
  stockDocuments,
  stockMovements,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { reverseSourceJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { applyBatchDelta } from "@/server/batches";
import { restoreSerialsForTransferVoid } from "@/server/serials";
import { applyStockMovement, lockStockQty } from "./movements";

export type StockDocumentRow = typeof stockDocuments.$inferSelect;


export type StockDocumentLineRow = typeof stockDocumentLines.$inferSelect;

/**
 * FIX-ARS Tahap 4: fase dari postStockAdjustment — badan dipindah apa adanya;
 * putar ulang baris tersimpan sebagai gerakan stok (batch FEFO
 * dinilai saat posting) termasuk leg kedua karantina; mengakumulasi
 * nilai masuk/keluar dari baris tersimpan.
 */


const STOCK_DOCUMENT_REFERENCE_TYPES = ["adjustment", "purchase_return", "transfer", "opname"];

/**
 * Void a posted stock document — adjustment, purchase return, transfer, or
 * opname (GD-P1-5). Every original movement is mirrored with the opposite
 * delta at its original cost as a "reversal" movement, and the document's
 * journal (when the document type posts one, and one was actually posted)
 * is reversed via reverseSourceJournal. Transfers never post a journal.
 * As with receipts, the moving average is not recomputed: the reversal
 * movements plus the reversed journal keep stock and GL consistent.
 */


export async function voidStockDocument(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    documentId: string;
    reason: string;
    date: string;
  },
) {
  if (!input.reason.trim()) throw new AppError("VALIDATION", "Alasan pembatalan wajib diisi.");

  const [doc] = await tx
    .select()
    .from(stockDocuments)
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, input.documentId)))
    .limit(1)
    .for("update");
  if (!doc) throw new AppError("NOT_FOUND", "Dokumen stok tidak ditemukan.");
  if (doc.status === "void") throw new AppError("INVALID_STATE", "Dokumen sudah dibatalkan.");
  // Transfer dua tahap yang masih in_transit boleh dibatalkan: yang
  // dibalik hanya leg keluarnya (leg masuk belum pernah diterapkan).
  const voidable =
    doc.status === "posted" || (doc.type === "transfer" && doc.status === "in_transit");
  if (!voidable) {
    throw new AppError("INVALID_STATE", "Hanya dokumen berstatus posted yang bisa dibatalkan.");
  }

  const originals = await tx
    .select()
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, input.companyId),
        eq(stockMovements.referenceId, doc.id),
        inArray(stockMovements.referenceType, STOCK_DOCUMENT_REFERENCE_TYPES),
      ),
    )
    .orderBy(asc(stockMovements.createdAt));

  // Stock guard: inbound originals become outbound reversals. Aggregate per
  // warehouse+product (a document may repeat a product), lock, and compare
  // before writing anything.
  const removals = new Map<
    string,
    { warehouseId: string; productId: string; qty: ReturnType<typeof d> }
  >();
  for (const movement of originals) {
    const qty = d(movement.qty);
    if (!qty.gt(0)) continue;
    const key = `${movement.warehouseId}:${movement.productId}`;
    const current = removals.get(key) ?? {
      warehouseId: movement.warehouseId,
      productId: movement.productId,
      qty: d(0),
    };
    current.qty = current.qty.plus(qty);
    removals.set(key, current);
  }
  if (removals.size > 0) {
    const productIds = [...new Set([...removals.values()].map((row) => row.productId))];
    const productRows = await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
    const names = new Map(productRows.map((row) => [row.id, row.name]));
    for (const removal of removals.values()) {
      const available = await lockStockQty(tx, input.companyId, removal.warehouseId, removal.productId);
      if (available.lt(removal.qty)) {
        throw new AppError(
          "VALIDATION",
          `Stok ${names.get(removal.productId) ?? "produk"} tinggal ${available.toFixed(2)}, kurang dari ${removal.qty.toFixed(2)} yang harus dikeluarkan untuk membatalkan dokumen ${doc.number} — sebagian stok sudah terpakai atau terjual, jadi dokumen ini tidak bisa dibatalkan.`,
        );
      }
    }
  }

  // Which journal (if any) did this document post? Mirrors createAdjustment /
  // createOpname: adjustments and purchase returns post when their total
  // line value is > 0; opname posts when its signed net value is non-zero;
  // transfers never post. Since GD-P2-2 the adjustment family stores its
  // original type (damaged/expired/lost) instead of "adjustment", so the
  // family is matched explicitly. Quarantine documents are pure location
  // moves (GD-P2-3a) and never post a journal, so none is expected — and
  // none may be "reversed" either.
  const journalSourceType =
    doc.type === "purchase_return"
      ? "purchase_return"
      : doc.type === "opname"
        ? "opname"
        : doc.type === "transfer"
          ? null
          : "adjustment";
  let journalExpected = false;
  if (
    doc.type === "adjustment" ||
    doc.type === "damaged" ||
    doc.type === "expired" ||
    doc.type === "lost" ||
    doc.type === "purchase_return"
  ) {
    const docLines = await tx
      .select({ lineTotal: stockDocumentLines.lineTotal })
      .from(stockDocumentLines)
      .where(
        and(
          eq(stockDocumentLines.companyId, input.companyId),
          eq(stockDocumentLines.documentId, doc.id),
        ),
      );
    journalExpected = docLines.reduce((acc, line) => acc.plus(d(line.lineTotal)), d(0)).gt(0);
  } else if (doc.type === "opname") {
    const docLines = await tx
      .select({ qty: stockDocumentLines.qty, unitCost: stockDocumentLines.unitCost })
      .from(stockDocumentLines)
      .where(
        and(
          eq(stockDocumentLines.companyId, input.companyId),
          eq(stockDocumentLines.documentId, doc.id),
        ),
      );
    journalExpected = !docLines
      .reduce((acc, line) => acc.plus(d(line.qty).mul(d(line.unitCost))), d(0))
      .eq(0);
  }

  let reversal: { id: string; number: string } | null = null;
  if (journalSourceType && journalExpected) {
    reversal = await reverseSourceJournal(tx, {
      companyId: input.companyId,
      sourceType: journalSourceType,
      sourceId: doc.id,
      date: input.date,
      description: `Pembatalan dokumen stok ${doc.number} — ${input.reason}`,
      createdBy: input.userId,
    });
    if (!reversal) {
      throw new AppError(
        "VALIDATION",
        `Jurnal asal dokumen ${doc.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan dokumen dibatalkan agar stok dan buku besar tetap selaras; periksa jurnal dokumen ini terlebih dahulu.`,
      );
    }
  }

  // Batch-tracked products mirror through the batch ledger (G8/D-7): a
  // movement that carried a batch id is reversed against that same batch,
  // legacy movements without one fall back to FEFO / the batch-null
  // remainder, so Σ batch stays equal to stock_on_hand after the void.
  const trackedFlags = new Map<string, boolean>();
  {
    const ids = [...new Set(originals.map((movement) => movement.productId))];
    if (ids.length > 0) {
      const rows = await tx
        .select({ id: products.id, trackBatch: products.trackBatch })
        .from(products)
        .where(and(eq(products.companyId, input.companyId), inArray(products.id, ids)));
      for (const row of rows) trackedFlags.set(row.id, row.trackBatch);
    }
  }

  for (const movement of originals) {
    const delta = d(movement.qty).negated();
    if (trackedFlags.get(movement.productId)) {
      const slices = await applyBatchDelta(tx, {
        companyId: input.companyId,
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        delta,
        batchId: movement.batchId,
        purpose: "correction",
      });
      for (const slice of slices) {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: movement.warehouseId,
          productId: movement.productId,
          delta: delta.lt(0) ? slice.qty.negated() : slice.qty,
          unitCost: movement.unitCost,
          movementType: "reversal",
          referenceType: "stock_document_void",
          referenceId: doc.id,
          referenceNumber: doc.number,
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
      warehouseId: movement.warehouseId,
      productId: movement.productId,
      delta,
      unitCost: movement.unitCost,
      movementType: "reversal",
      referenceType: "stock_document_void",
      referenceId: doc.id,
      referenceNumber: doc.number,
      reason: input.reason,
      userId: input.userId,
      date: input.date,
    });
  }

  // SIM-2 S7B-2 Batch 5: pembatalan transfer mengembalikan seri ke
  // gudang asal (in_transit → in_stock; satu tahap → pindah balik).
  if (doc.type === "transfer" && doc.warehouseId) {
    await restoreSerialsForTransferVoid(tx, {
      companyId: input.companyId,
      userId: input.userId,
      documentId: doc.id,
      documentNumber: doc.number,
      fromWarehouseId: doc.warehouseId,
      toWarehouseId: doc.toWarehouseId ?? null,
    });
  }

  // WF-025: reset tugas opname yang tertaut ke dokumen ini agar riwayat penugasan tidak menunjuk dokumen batal.
  if (doc.type === "opname") {
    await tx
      .update(opnameTasks)
      .set({
        status: "cancelled",
        documentId: null,
      })
      .where(and(eq(opnameTasks.companyId, input.companyId), eq(opnameTasks.documentId, doc.id)));
  }

  await tx
    .update(stockDocuments)
    .set({ status: "void" })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.void",
    entityType: "stock_document",
    entityId: doc.id,
    after: {
      number: doc.number,
      type: doc.type,
      reason: input.reason,
      reversalNumber: reversal?.number,
    },
  });

  return { id: doc.id, number: doc.number };
}
