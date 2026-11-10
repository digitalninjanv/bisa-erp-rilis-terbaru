// A-26 Q8b: posting & keputusan penyesuaian — dipisah dari adjustments.ts
// mengikuti fase yang sudah ada (posting bersama, gerakan per baris,
// jurnal, dan keputusan maker-checker). Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/inventory.ts.

import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { stockDocumentLines, stockDocuments } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import {
  assertPeriodOpen,
  getAccountMap,
  postJournal,
} from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { addToBatch, isBatchTracked } from "@/server/batches";
import { isSerialTracked, relocateSerialsByOutReference } from "@/server/serials";
import type { StockDocumentLineRow, StockDocumentRow } from "./documents";
import { applyDocumentMovement, applyStockMovement } from "./movements";

/**
 * Apply a stored adjustment document: replay its lines as stock
 * movements (plus the quarantine destination leg) and post its journal,
 * then mark it posted. This is THE posting path for the adjustment
 * family — createAdjustment calls it for immediate posting and
 * approveStockAdjustment calls it when a checker releases a pending
 * document, so movements and journal logic exist exactly once.
 *
 * Costs and values come from the stored lines (frozen at creation): the
 * checker approves the values they saw, even if the moving average has
 * drifted since. Batch allocation (FEFO) happens at posting time, which
 * for an approved document is the correct moment — stock may have moved
 * while the document waited.
 */


export async function postStockAdjustment(
  tx: Tx,
  input: { companyId: string; userId: string; documentId: string },
) {
  const [doc] = await tx
    .select()
    .from(stockDocuments)
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, input.documentId)))
    .limit(1)
    .for("update");
  if (!doc) throw new AppError("NOT_FOUND", "Dokumen penyesuaian tidak ditemukan.");
  if (doc.status === "posted") {
    throw new AppError("CONFLICT", `Dokumen ${doc.number} sudah pernah diposting.`);
  }
  if (doc.status !== "draft" && doc.status !== "pending") {
    throw new AppError("INVALID_STATE", `Dokumen ${doc.number} berstatus ${doc.status} tidak dapat diposting.`);
  }
  if (!doc.warehouseId) {
    throw new AppError("INVALID_STATE", `Dokumen ${doc.number} tidak memiliki gudang asal.`);
  }
  const warehouseId = doc.warehouseId;
  // FIX-GDG Tahap 2 (GDG3-02): kunci periode dinilai di titik posting
  // bersama ini — sebelum gerakan apa pun — untuk KEDUA jalur yang
  // memanggilnya: posting langsung dari createAdjustment dan
  // persetujuan dokumen pending (approveStockAdjustment). Dokumen
  // pending sendiri belum bermutasi, jadi pembuatannya tidak ditolak;
  // yang ditolak adalah mutasinya ke periode tertutup, dan dokumen
  // tetap pending (transaksi gugur utuh).
  await assertPeriodOpen(tx, input.companyId, doc.date);

  const lines = await tx
    .select()
    .from(stockDocumentLines)
    .where(
      and(
        eq(stockDocumentLines.companyId, input.companyId),
        eq(stockDocumentLines.documentId, doc.id),
      ),
    )
    .orderBy(asc(stockDocumentLines.id));

  const map = await getAccountMap(tx, input.companyId);

  const { inValue, outValue } = await applyAdjustmentLineMovements(tx, input, doc, warehouseId, lines);

  const totalValue = await postAdjustmentJournal(tx, input, doc, map, inValue, outValue);

  await tx
    .update(stockDocuments)
    .set({ status: "posted", postedAt: new Date(), total: toDb(totalValue) })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));
}


async function applyAdjustmentLineMovements(
  tx: Tx,
  input: { companyId: string; userId: string; documentId: string },
  doc: StockDocumentRow,
  warehouseId: string,
  lines: StockDocumentLineRow[],
) {
  let inValue = d(0);
  let outValue = d(0);

  for (const line of lines) {
    const delta = d(line.qty);
    const unitCost = d(line.unitCost);
    const value = d(line.lineTotal);
    if (delta.gt(0)) {
      inValue = inValue.plus(value);
    } else if (delta.lt(0)) {
      outValue = outValue.plus(value);
    }

    const outSlices = await applyDocumentMovement(tx, {
      companyId: input.companyId,
      userId: input.userId,
      warehouseId,
      productId: line.productId,
      delta,
      unitCost,
      movementType: doc.type === "purchase_return" ? "purchase_return" : doc.type,
      referenceType: doc.type === "purchase_return" ? "purchase_return" : "adjustment",
      referenceId: doc.id,
      referenceNumber: doc.number,
      reason: doc.reason ?? undefined,
      date: doc.date,
    });

    if (doc.type === "quarantine" && doc.toWarehouseId) {
      // Second leg of the quarantine move: the same quantity arrives in
      // the quarantine warehouse, traced to the same document. Like a
      // transfer, total company stock is unchanged, so no journal follows
      // (below). Batch-tracked goods keep their batch identity across the
      // move (G8/D-7): each outbound slice lands in the same batch at the
      // destination warehouse.
      const quarantineWarehouseId = doc.toWarehouseId;
      const tracked = await isBatchTracked(tx, input.companyId, line.productId);
      if (tracked) {
        for (const slice of outSlices) {
          const destBatch = await addToBatch(tx, {
            companyId: input.companyId,
            productId: line.productId,
            warehouseId: quarantineWarehouseId,
            batchNumber: slice.batchNumber,
            expiryDate: slice.expiryDate,
            delta: slice.qty,
          });
          await applyStockMovement(tx, {
            companyId: input.companyId,
            warehouseId: quarantineWarehouseId,
            productId: line.productId,
            delta: slice.qty,
            unitCost,
            movementType: "quarantine",
            referenceType: "adjustment",
            referenceId: doc.id,
            referenceNumber: doc.number,
            reason: doc.reason ?? undefined,
            userId: input.userId,
            allowNegative: false,
            batchId: destBatch.id,
            date: doc.date,
          });
        }
      } else {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: quarantineWarehouseId,
          productId: line.productId,
          delta: delta.abs(),
          unitCost,
          movementType: "quarantine",
          referenceType: "adjustment",
          referenceId: doc.id,
          referenceNumber: doc.number,
          reason: doc.reason ?? undefined,
          userId: input.userId,
          allowNegative: false,
          date: doc.date,
        });
      }
      // Seri yang dikeluarkan leg pertama dokumen ini berpindah ke
      // gudang karantina sebagai in_stock (bukan keluar perusahaan).
      if (await isSerialTracked(tx, input.companyId, line.productId)) {
        await relocateSerialsByOutReference(tx, {
          companyId: input.companyId,
          userId: input.userId,
          productId: line.productId,
          referenceId: doc.id,
          referenceNumber: doc.number,
          toWarehouseId: quarantineWarehouseId,
          note: "Dipindahkan ke gudang karantina",
        });
      }
    }
  }
  return { inValue, outValue };
}

/**
 * FIX-ARS Tahap 4: fase dari postStockAdjustment — badan dipindah apa adanya;
 * jurnal posting penyesuaian per keluarga tipe dokumen
 * (karantina tanpa jurnal; purchase_return warisan; koreksi
 * bertanda; rusak/kedaluwarsa/susut).
 */


async function postAdjustmentJournal(
  tx: Tx,
  input: { companyId: string; userId: string; documentId: string },
  doc: StockDocumentRow,
  map: Awaited<ReturnType<typeof getAccountMap>>,
  inValue: Decimal,
  outValue: Decimal,
) {
  const totalValue = inValue.plus(outValue);

  // Quarantine posts no journal: the goods remain inventory, only their
  // location changes (GD-P2-3a). Every other type settles financially.
  if (totalValue.gt(0) && doc.type !== "quarantine") {
    if (doc.type === "purchase_return") {
      // LEGASI (FIX-P1 AK4-02): cabang ini hanya melayani dokumen
      // purchase_return yang dibuat SEBELUM jalur penyesuaian ditutup
      // dan masih menunggu persetujuan — createAdjustment menolak tipe
      // ini, jadi tidak ada dokumen baru yang dapat mencapainya. Void
      // dokumen historis berjalan lewat reverseSourceJournal di
      // voidStockDocument, bukan lewat cabang ini.
      // Every line left the warehouse, so totalValue === outValue here.
      // D-3: a "replacement" return must NOT reduce the payable — the
      // supplier owes replacement goods, not money back. The debit goes to
      // the receivable account as a claim against the supplier; the payable
      // is settled later by the replacement receipt. Refund methods keep
      // settling against cash / the payable as before.
      const isReplacement = doc.refundMethod === "replacement";
      const settleAccount = isReplacement
        ? map.receivable
        : doc.refundMethod === "cash"
          ? map.cash
          : map.payable;
      await postJournal(tx, {
        companyId: input.companyId,
        date: doc.date,
        description: isReplacement
          ? `Retur pembelian ${doc.number} — penggantian barang dari pemasok`
          : `Retur pembelian ${doc.number}`,
        sourceType: "purchase_return",
        sourceId: doc.id,
        createdBy: input.userId,
        lines: [
          {
            accountId: settleAccount,
            debit: outValue,
            description: isReplacement
              ? "Klaim penggantian barang ke pemasok"
              : "Pengembalian dari pemasok",
          },
          { accountId: map.inventory, credit: outValue, description: "Persediaan berkurang" },
        ],
      });
    } else if (doc.type === "adjustment") {
      // Signed corrections may mix directions in one document; journal each
      // direction at its own value so the entry always matches the actual
      // inventory change (never Σ|qty| in a single direction).
      const adjustmentAccount = map.inventory_shrink;
      const lines2: { accountId: string; debit?: MoneyInput; credit?: MoneyInput; description: string }[] = [];
      if (inValue.gt(0)) {
        lines2.push(
          { accountId: map.inventory, debit: inValue, description: "Persediaan bertambah" },
          { accountId: adjustmentAccount, credit: inValue, description: "Koreksi persediaan masuk" },
        );
      }
      if (outValue.gt(0)) {
        lines2.push(
          { accountId: adjustmentAccount, debit: outValue, description: doc.reason ?? "" },
          { accountId: map.inventory, credit: outValue, description: "Persediaan berkurang" },
        );
      }
      await postJournal(tx, {
        companyId: input.companyId,
        date: doc.date,
        description: `Penyesuaian stok ${doc.number} — ${doc.reason ?? ""}`,
        sourceType: "adjustment",
        sourceId: doc.id,
        createdBy: input.userId,
        lines: lines2,
      });
    } else {
      const adjustmentAccount =
        doc.type === "damaged" || doc.type === "expired"
          ? map.damaged
          : map.inventory_shrink;
      await postJournal(tx, {
        companyId: input.companyId,
        date: doc.date,
        description: `Penyesuaian stok ${doc.number} — ${doc.reason ?? ""}`,
        sourceType: "adjustment",
        sourceId: doc.id,
        createdBy: input.userId,
        lines: [
          { accountId: adjustmentAccount, debit: outValue, description: doc.reason ?? "" },
          { accountId: map.inventory, credit: outValue, description: "Persediaan berkurang" },
        ],
      });
    }
  }
  return totalValue;
}


/**
 * Document types the approval gate may park as "pending" (T5R-5): the
 * write-off family only. purchase_return and quarantine belong to the
 * wider adjustment family for posting purposes but are never gated.
 */



/** Document types owned by the adjustment family (createAdjustment). */


const ADJUSTMENT_FAMILY_TYPES = [
  "adjustment",
  "damaged",
  "expired",
  "lost",
  "quarantine",
  "purchase_return",
];

/**
 * Load a pending adjustment document under a row lock and enforce the
 * shared approval preconditions (exists, is an adjustment-family
 * document, still pending). The lock serializes competing checkers: the
 * second approval reads the status the first one committed — never a
 * stale "pending" — so movements and journal are applied exactly once.
 */


async function loadPendingAdjustmentForDecision(
  tx: Tx,
  companyId: string,
  documentId: string,
) {
  const [doc] = await tx
    .select()
    .from(stockDocuments)
    .where(and(eq(stockDocuments.companyId, companyId), eq(stockDocuments.id, documentId)))
    .limit(1)
    .for("update");
  if (!doc) throw new AppError("NOT_FOUND", "Dokumen penyesuaian tidak ditemukan.");
  if (!ADJUSTMENT_FAMILY_TYPES.includes(doc.type)) {
    throw new AppError("INVALID_STATE", `Dokumen ${doc.number} bukan dokumen penyesuaian stok.`);
  }
  if (doc.status !== "pending") {
    throw new AppError(
      "INVALID_STATE",
      `Dokumen ${doc.number} tidak sedang menunggu persetujuan (status saat ini: ${doc.status}).`,
    );
  }
  return doc;
}

/**
 * T5-3 (D-17): approve a pending adjustment. Maker ≠ checker is enforced
 * here in the domain (not only in the UI or action): the document's
 * creator can never release their own document. Posting goes through
 * postStockAdjustment, so the period of the DOCUMENT date must be open
 * at approval time — a closed period fails the approval and the
 * document stays pending.
 */


export async function approveStockAdjustment(
  tx: Tx,
  input: { companyId: string; userId: string; documentId: string },
) {
  const doc = await loadPendingAdjustmentForDecision(tx, input.companyId, input.documentId);
  if (doc.createdBy === input.userId) {
    throw new AppError(
      "FORBIDDEN",
      "Pembuat dokumen tidak dapat menyetujui dokumennya sendiri. Minta pengguna lain yang memiliki izin mengelola gudang untuk memeriksa dan menyetujuinya.",
    );
  }
  await assertPeriodOpen(tx, input.companyId, doc.date);
  await postStockAdjustment(tx, {
    companyId: input.companyId,
    userId: input.userId,
    documentId: doc.id,
  });
  await tx
    .update(stockDocuments)
    .set({ approvedBy: input.userId, approvedAt: new Date() })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.adjust.approve",
    entityType: "stock_document",
    entityId: doc.id,
    after: { number: doc.number, type: doc.type, value: doc.total },
  });
  return { id: doc.id, number: doc.number, status: "posted" as const };
}

/**
 * T5-3 (D-17): reject a pending adjustment with a mandatory reason. A
 * rejected document never moves stock and never posts a journal; the
 * reason stays on the document for the maker to see.
 */


export async function rejectStockAdjustment(
  tx: Tx,
  input: { companyId: string; userId: string; documentId: string; reason: string },
) {
  if (!input.reason.trim()) throw new AppError("VALIDATION", "Alasan penolakan wajib diisi.");
  const doc = await loadPendingAdjustmentForDecision(tx, input.companyId, input.documentId);
  if (doc.createdBy === input.userId) {
    throw new AppError(
      "FORBIDDEN",
      "Pembuat dokumen tidak dapat menolak dokumennya sendiri. Batalkan dokumen ini, atau minta pengguna lain untuk memeriksanya.",
    );
  }
  await tx
    .update(stockDocuments)
    .set({
      status: "rejected",
      rejectionReason: input.reason.trim(),
      approvedBy: input.userId,
      approvedAt: new Date(),
    })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.adjust.reject",
    entityType: "stock_document",
    entityId: doc.id,
    after: { number: doc.number, type: doc.type, reason: input.reason.trim() },
  });
  return { id: doc.id, number: doc.number, status: "rejected" as const };
}

/**
 * T5-3 (D-17): the maker withdraws their own pending adjustment. The
 * document becomes "void" having never moved stock or posted a journal.
 * Anyone else must use reject instead.
 */


export async function cancelStockAdjustment(
  tx: Tx,
  input: { companyId: string; userId: string; documentId: string },
) {
  const doc = await loadPendingAdjustmentForDecision(tx, input.companyId, input.documentId);
  if (doc.createdBy !== input.userId) {
    throw new AppError(
      "FORBIDDEN",
      "Hanya pembuat dokumen yang dapat membatalkan dokumen yang menunggu persetujuan ini.",
    );
  }
  await tx
    .update(stockDocuments)
    .set({ status: "void" })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.adjust.cancel",
    entityType: "stock_document",
    entityId: doc.id,
    after: { number: doc.number, type: doc.type },
  });
  return { id: doc.id, number: doc.number, status: "void" as const };
}
