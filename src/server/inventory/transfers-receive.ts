// A-26 Q8b: penerimaan transfer — dipisah dari transfers.ts mengikuti
// fase yang sudah ada (rencana penerimaan, penerapan irisan, penyelesaian
// seri & selisih perjalanan). Perilaku tidak berubah; jalur impor publik
// tetap lewat src/server/inventory.ts.

import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { stockBatches, stockDocumentLines, stockDocuments, stockMovements } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import {
  assertPeriodOpen,
  getAccountMap,
  postJournal,
} from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { addToBatch, isBatchTracked } from "@/server/batches";
import { closeSerialsForTransferDifference, isSerialTracked, receiveSerialsForTransfer } from "@/server/serials";
import type { StockDocumentLineRow, StockDocumentRow } from "./documents";
import { applyStockMovement } from "./movements";

type ReceiveTransferInput = {
  companyId: string;
  userId: string;
  userRole?: string | null;
  documentId: string;
  date: string;
  lines?: { productId: string; receivedQty: MoneyInput; serialNumbers?: string[] }[];
  closeRemainder?: boolean;
  differenceReason?: string | null;
};

/**
 * SIM-2 S7B-2 Batch 4 + FIX-GDG Tahap 2 (GDG1-07) — terima transfer
 * dua tahap, kini mendukung penerimaan SEBAGIAN dan selisih perjalanan.
 *
 * Model (konsisten dengan model dokumen yang ada):
 * - Setiap baris mencatat received_qty kumulatif. Tanpa `lines`,
 *   penerimaan menerima SELURUH sisa kirim (perilaku lama persis).
 *   Dengan `lines`, qty diterima per baris ≤ sisa kirim baris itu;
 *   dokumen tetap `in_transit` selama masih ada sisa, dan sisa itu
 *   dapat diterima lagi pada panggilan berikutnya.
 * - Sisa kirim dapat DITUTUP sebagai selisih perjalanan lewat
 *   `closeRemainder` + `differenceReason` (alasan wajib): barang
 *   dinyatakan hilang/rusak di jalan. Penutupan mengikuti pola
 *   penyesuaian yang berlaku — jurnal Dr Beban Susut Persediaan /
 *   Cr Persediaan sebesar selisih × biaya baris (akun persediaan
 *   tingkat perusahaan memang masih memuat barang di perjalanan,
 *   karena pengiriman tidak menjurnal) — dan ledger stok mencatat
 *   pasangan gerakan transfer_in + transfer_difference di gudang
 *   tujuan atas dokumen yang sama, sehingga kartu stok tujuan
 *   menunjukkan barang datang lalu selisihnya ditulis sebagai
 *   kehilangan perjalanan (bukan susut gudang tujuan), dokumen
 *   menampilkan terkirim/diterima/selisih beserta alasannya, dan
 *   invariant Σ gerakan = stok on-hand tetap utuh per gudang.
 * - Produk batch: irisan diterima mengikuti urutan irisan keluar
 *   dokumen ini sendiri (batch yang sama tiba di tujuan). Produk
 *   serial: seri yang diterima dapat disebut eksplisit; seri sisa
 *   yang ditutup sebagai selisih berstatus out berkind
 *   transfer_difference (lihat serials.ts).
 */


export async function receiveTransfer(tx: Tx, input: ReceiveTransferInput) {
  const [doc] = await tx
    .select()
    .from(stockDocuments)
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, input.documentId)))
    .limit(1)
    .for("update");
  if (!doc) throw new AppError("NOT_FOUND", "Dokumen transfer tidak ditemukan.");
  if (doc.type !== "transfer") throw new AppError("VALIDATION", "Dokumen ini bukan transfer.");
  if (doc.status !== "in_transit") {
    throw new AppError("INVALID_STATE", "Hanya transfer berstatus Dalam Perjalanan yang bisa diterima.");
  }
  if (!doc.toWarehouseId) throw new AppError("VALIDATION", "Transfer tidak memiliki gudang tujuan.");
  const toWarehouseId = doc.toWarehouseId;

  // WF-023: Pembuat dokumen transfer (pengirim) tidak dapat menerima transfer sendiri (Maker-Checker / Four-Eyes Principle)
  if (
    input.userRole &&
    input.userRole !== "owner" &&
    input.userRole !== "admin" &&
    input.userId &&
    doc.createdBy &&
    doc.createdBy === input.userId
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Prinsip Maker-Checker (Four-Eyes Principle): Pembuat dokumen transfer tidak dapat menerima transfer barang itu sendiri di gudang tujuan.",
    );
  }

  // FIX-GDG Tahap 2 (GDG3-02): tanggal penerimaan adalah tanggal
  // gerakan stoknya — periode tertutup menolaknya seperti dokumen lain.
  await assertPeriodOpen(tx, input.companyId, input.date);

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

  const { plans, totalRequested, totalLeftover, closing, differenceReason } =
    planTransferReceipt(input, lines);

  const differenceValue = await applyTransferReceiptPlans(
    tx, input, doc, toWarehouseId, plans, closing, differenceReason,
  );

  await settleTransferSerials(tx, input, doc, toWarehouseId, plans, closing, differenceReason);

  if (closing && differenceValue.gt(0)) {
    const map = await getAccountMap(tx, input.companyId);
    await postJournal(tx, {
      companyId: input.companyId,
      date: input.date,
      description: `Selisih perjalanan transfer ${doc.number} — ${differenceReason}`,
      sourceType: "transfer_difference",
      sourceId: doc.id,
      createdBy: input.userId,
      lines: [
        {
          accountId: map.inventory_shrink,
          debit: differenceValue,
          description: "Selisih barang hilang/rusak dalam perjalanan",
        },
        {
          accountId: map.inventory,
          credit: differenceValue,
          description: "Persediaan berkurang (selisih perjalanan)",
        },
      ],
    });
  }

  const fullyReceived = plans.every((plan) => plan.leftoverAfter.lte(0));
  const isFinal = closing || fullyReceived;
  // Penerimaan sebagian murni tidak mengubah kolom header apa pun —
  // update dilewati (set kosong ditolak drizzle); baris dokumen yang
  // sudah terkunci dikembalikan apa adanya.
  const docPatch = {
    ...(isFinal ? { status: "posted", receivedBy: input.userId, receivedAt: new Date() } : {}),
    ...(closing && totalLeftover.gt(0) ? { differenceReason } : {}),
  };
  const [updated] =
    Object.keys(docPatch).length > 0
      ? await tx
          .update(stockDocuments)
          .set(docPatch)
          .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)))
          .returning()
      : [doc];
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: isFinal ? "inventory.transfer.receive" : "inventory.transfer.receive.partial",
    entityType: "stock_document",
    entityId: doc.id,
    after: {
      number: doc.number,
      receivedQty: toDb(totalRequested),
      ...(closing && totalLeftover.gt(0)
        ? { differenceQty: toDb(totalLeftover), differenceReason }
        : {}),
      ...(!isFinal ? { remainingQty: toDb(totalLeftover) } : {}),
    },
  });
  return updated;
}


type TransferLinePlan = {
  line: StockDocumentLineRow;
  remaining: Decimal;
  requested: Decimal;
  leftoverAfter: Decimal;
  serialNumbers?: string[];
};

/**
 * FIX-ARS Tahap 4: fase dari receiveTransfer — badan dipindah apa adanya;
 * rencana penerimaan — divalidasi PENUH sebelum gerakan apa pun
 * (qty per baris, sisa kirim, alasan selisih wajib saat penutupan).
 */


function planTransferReceipt(input: ReceiveTransferInput, lines: StockDocumentLineRow[]) {
  // ---- Rencana penerimaan: divalidasi PENUH sebelum gerakan apa pun,
  // agar penolakan (qty berlebih, selisih tanpa alasan) tidak
  // meninggalkan penerimaan parsial yang tidak diminta.
  const requestedByProduct = new Map<string, { qty: Decimal; serialNumbers?: string[] }>();
  if (input.lines) {
    for (const inputLine of input.lines) {
      if (requestedByProduct.has(inputLine.productId)) {
        throw new AppError(
          "VALIDATION",
          "Produk yang sama muncul lebih dari sekali dalam satu penerimaan. Gabungkan jumlahnya ke satu baris.",
        );
      }
      requestedByProduct.set(inputLine.productId, {
        qty: d(inputLine.receivedQty),
        serialNumbers: inputLine.serialNumbers,
      });
    }
  }
  const plans: TransferLinePlan[] = [];
  for (const line of lines) {
    const remaining = d(line.qty).minus(d(line.receivedQty));
    const explicit = requestedByProduct.get(line.productId);
    const requested = explicit ? explicit.qty : remaining;
    if (!requested.isFinite() || requested.lt(0)) {
      throw new AppError(
        "VALIDATION",
        `Qty diterima untuk ${line.productName ?? "produk"} tidak boleh negatif.`,
      );
    }
    if (requested.gt(remaining)) {
      throw new AppError(
        "VALIDATION",
        `Qty diterima untuk ${line.productName ?? "produk"} melebihi sisa qty kirim (${remaining.toString()}).`,
      );
    }
    plans.push({
      line,
      remaining,
      requested,
      leftoverAfter: remaining.minus(requested),
      serialNumbers: explicit?.serialNumbers,
    });
  }
  for (const productId of requestedByProduct.keys()) {
    if (!lines.some((line) => line.productId === productId)) {
      throw new AppError("VALIDATION", "Ada produk penerimaan yang tidak termasuk dalam transfer ini.");
    }
  }
  const totalRequested = plans.reduce((acc, plan) => acc.plus(plan.requested), d(0));
  const totalLeftover = plans.reduce((acc, plan) => acc.plus(plan.leftoverAfter), d(0));
  const closing = input.closeRemainder === true;
  if (totalRequested.lte(0) && !(closing && totalLeftover.gt(0))) {
    throw new AppError("VALIDATION", "Tidak ada qty yang diterima pada penerimaan ini.");
  }
  const differenceReason = input.differenceReason?.trim() ?? "";
  if (closing && totalLeftover.gt(0) && differenceReason.length === 0) {
    throw new AppError(
      "VALIDATION",
      "Alasan selisih perjalanan wajib diisi saat sisa kirim ditutup sebagai selisih (barang hilang/rusak di jalan harus dapat ditelusur).",
    );
  }
  return { plans, totalRequested, totalLeftover, closing, differenceReason };
}

/**
 * FIX-ARS Tahap 4: fase dari receiveTransfer — badan dipindah apa adanya;
 * terapkan qty per irisan gerakan keluar dokumen ini, dalam
 * urutan irisan itu dibuat: `skip` melompati porsi yang sudah
 * diterima penerimaan sebelumnya, `take` mengambil sampai
 * kebutuhan baris ini. Mode "difference" menulis pasangan
 * masuk+selesih untuk penutupan sisa.
 */


async function applyTransferSlices(
  tx: Tx,
  input: ReceiveTransferInput,
  doc: StockDocumentRow,
  toWarehouseId: string,
  plan: TransferLinePlan,
  skipQty: Decimal,
  takeQty: Decimal,
  mode: "receive" | "difference",
  differenceReason: string,
): Promise<void> {
  const { line } = plan;
  const outMovements = await tx
    .select()
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, input.companyId),
        eq(stockMovements.referenceId, doc.id),
        eq(stockMovements.movementType, "transfer_out"),
        eq(stockMovements.productId, line.productId),
      ),
    )
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));
  let skip = skipQty;
  let need = takeQty;
  for (const movement of outMovements) {
    if (need.lte(0)) break;
    const sliceQty = d(movement.qty).abs();
    const skippedHere = Decimal.min(skip, sliceQty);
    skip = skip.minus(skippedHere);
    const availableHere = sliceQty.minus(skippedHere);
    const take = Decimal.min(availableHere, need);
    if (take.lte(0)) continue;
    need = need.minus(take);
    if (!movement.batchId) {
      await applyStockMovement(tx, {
        companyId: input.companyId,
        warehouseId: toWarehouseId,
        productId: line.productId,
        delta: take,
        unitCost: line.unitCost,
        movementType: "transfer_in",
        referenceType: "transfer",
        referenceId: doc.id,
        referenceNumber: doc.number,
        userId: input.userId,
        date: input.date,
      });
      if (mode === "difference") {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: toWarehouseId,
          productId: line.productId,
          delta: take.negated(),
          unitCost: line.unitCost,
          movementType: "transfer_difference",
          referenceType: "transfer",
          referenceId: doc.id,
          referenceNumber: doc.number,
          reason: differenceReason,
          userId: input.userId,
          date: input.date,
        });
      }
      continue;
    }
    const [batch] = await tx
      .select({ batchNumber: stockBatches.batchNumber, expiryDate: stockBatches.expiryDate })
      .from(stockBatches)
      .where(and(eq(stockBatches.companyId, input.companyId), eq(stockBatches.id, movement.batchId)))
      .limit(1);
    if (!batch) throw new AppError("NOT_FOUND", "Batch asal transfer tidak ditemukan.");
    const destBatch = await addToBatch(tx, {
      companyId: input.companyId,
      productId: line.productId,
      warehouseId: toWarehouseId,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      delta: take,
    });
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: toWarehouseId,
      productId: line.productId,
      delta: take,
      unitCost: line.unitCost,
      movementType: "transfer_in",
      referenceType: "transfer",
      referenceId: doc.id,
      referenceNumber: doc.number,
      userId: input.userId,
      batchId: destBatch.id,
      date: input.date,
    });
    if (mode === "difference") {
      await addToBatch(tx, {
        companyId: input.companyId,
        productId: line.productId,
        warehouseId: toWarehouseId,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        delta: take.negated(),
      });
      await applyStockMovement(tx, {
        companyId: input.companyId,
        warehouseId: toWarehouseId,
        productId: line.productId,
        delta: take.negated(),
        unitCost: line.unitCost,
        movementType: "transfer_difference",
        referenceType: "transfer",
        referenceId: doc.id,
        referenceNumber: doc.number,
        reason: differenceReason,
        userId: input.userId,
        batchId: destBatch.id,
        date: input.date,
      });
    }
  }
  if (need.gt(0)) {
    throw new AppError(
      "VALIDATION",
      `Gerakan keluar transfer tidak mencukupi untuk ${plan.line.productName ?? "produk"}.`,
    );
  }
}

/**
 * FIX-ARS Tahap 4: fase dari receiveTransfer — badan dipindah apa adanya;
 * terapkan rencana per baris — terima qty diminta dan/atau tutup
 * sisa sebagai selisih, lalu kumulatifkan received_qty baris.
 * Mengembalikan nilai rupiah total selisih perjalanan.
 */


async function applyTransferReceiptPlans(
  tx: Tx,
  input: ReceiveTransferInput,
  doc: StockDocumentRow,
  toWarehouseId: string,
  plans: TransferLinePlan[],
  closing: boolean,
  differenceReason: string,
) {
  let differenceValue = d(0);
  for (const plan of plans) {
    const { line } = plan;
    const tracked = await isBatchTracked(tx, input.companyId, line.productId);
    if (plan.requested.gt(0)) {
      if (tracked) {
        await applyTransferSlices(tx, input, doc, toWarehouseId, plan, d(line.receivedQty), plan.requested, "receive", differenceReason);
      } else {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: toWarehouseId,
          productId: line.productId,
          delta: plan.requested,
          unitCost: line.unitCost,
          movementType: "transfer_in",
          referenceType: "transfer",
          referenceId: doc.id,
          referenceNumber: doc.number,
          userId: input.userId,
          date: input.date,
        });
      }
    }
    if (closing && plan.leftoverAfter.gt(0)) {
      differenceValue = differenceValue.plus(plan.leftoverAfter.mul(d(line.unitCost)));
      if (tracked) {
        await applyTransferSlices(
          tx, input, doc, toWarehouseId,
          plan,
          d(line.receivedQty).plus(plan.requested),
          plan.leftoverAfter,
          "difference",
          differenceReason,
        );
      } else {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: toWarehouseId,
          productId: line.productId,
          delta: plan.leftoverAfter,
          unitCost: line.unitCost,
          movementType: "transfer_in",
          referenceType: "transfer",
          referenceId: doc.id,
          referenceNumber: doc.number,
          userId: input.userId,
          date: input.date,
        });
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: toWarehouseId,
          productId: line.productId,
          delta: plan.leftoverAfter.negated(),
          unitCost: line.unitCost,
          movementType: "transfer_difference",
          referenceType: "transfer",
          referenceId: doc.id,
          referenceNumber: doc.number,
          reason: differenceReason,
          userId: input.userId,
          date: input.date,
        });
      }
    }
    if (plan.requested.gt(0)) {
      await tx
        .update(stockDocumentLines)
        .set({ receivedQty: toDb(d(line.receivedQty).plus(plan.requested)) })
        .where(
          and(
            eq(stockDocumentLines.companyId, input.companyId),
            eq(stockDocumentLines.id, line.id),
          ),
        );
    }
  }
  return differenceValue;
}

/**
 * FIX-ARS Tahap 4: fase dari receiveTransfer — badan dipindah apa adanya;
 * penyelesaian identitas seri per baris — seri diterima pindah
 * ke gudang tujuan; seri sisa yang ditutup menjadi selisih
 * perjalanan.
 */


async function settleTransferSerials(
  tx: Tx,
  input: ReceiveTransferInput,
  doc: StockDocumentRow,
  toWarehouseId: string,
  plans: TransferLinePlan[],
  closing: boolean,
  differenceReason: string,
) {
  for (const plan of plans) {
    if (!(await isSerialTracked(tx, input.companyId, plan.line.productId))) continue;
    if (plan.requested.gt(0)) {
      await receiveSerialsForTransfer(tx, {
        companyId: input.companyId,
        userId: input.userId,
        productId: plan.line.productId,
        toWarehouseId,
        documentId: doc.id,
        documentNumber: doc.number,
        qty: plan.requested,
        serialNumbers: plan.serialNumbers,
      });
    }
    if (closing && plan.leftoverAfter.gt(0)) {
      await closeSerialsForTransferDifference(tx, {
        companyId: input.companyId,
        userId: input.userId,
        productId: plan.line.productId,
        documentId: doc.id,
        documentNumber: doc.number,
        reason: differenceReason,
      });
    }
  }
}
