// A-26 Q8: posting & pembatalan retur terposting — dipisah dari
// returns.ts dan dipecah per fase bernama (bekukan nilai AVCO →
// keluarkan stok → rencanakan alokasi → jurnal → terapkan alokasi;
// untuk void: balik jurnal → pulihkan stok → lepaskan alokasi).
// Perilaku, urutan langkah, & pesan identik dengan fungsi asal di
// returns.ts sebelum tahap ini.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  journalEntries,
  products,
  stockBatches,
  stockMovements,
  supplierReturnAllocations,
  supplierReturnResolutions,
  supplierReturnLines,
  supplierReturns,
  suppliers,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type Decimal } from "@/lib/money";
import {
  assertPeriodOpen,
  getAccountId,
  getAccountMap,
  postJournal,
  reverseJournalEntry,
} from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { applyBatchDelta, creditBatchById } from "@/server/batches";
import { applyStockMovement, recomputeCostFromLedger } from "@/server/inventory";
import { pickSerialsOut, restoreSerialsForSale } from "@/server/serials";
import {
  allocateReturnToPayables,
  listOpenPayableDocs,
  refreshOpeningPayableStatus,
  refreshReceiptPaymentStatus,
  type OpenPayableDoc,
} from "./payables";
import { assertReturnWithinProvenance } from "./provenance";
import { convertSupplierCreditToAdvance } from "./resolutions";
import { lockSupplierReturn } from "./returns";
import { DecimalMin, SUPPLIER_RETURN_REASON_LABELS } from "./shared";
import type { SupplierReturnRow } from "./shared";

type ReturnLineRow = typeof supplierReturnLines.$inferSelect;
type ReturnProductRow = Pick<
  typeof products.$inferSelect,
  "id" | "name" | "costPrice" | "trackBatch" | "trackSerial"
>;
type FrozenReturnLine = {
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
async function freezeReturnLineValues(
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
async function issueReturnStock(
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

type AllocationPlanItem = { doc: OpenPayableDoc; grossTake: Decimal };

/**
 * FIX-P1 Tahap 4 (AK4-04): rencana alokasi + reversi PPN Masukan.
 * Nilai retur (pada AVCO bersih pajak) dikonsumsi dokumen utang
 * FIFO; dokumen penerimaan ber-PPN menyumbang reversi pajak
 * proporsional: pajak yang masih melekat pada sisa terutang dokumen
 * (dibagi menurut komposisi faktur) × porsi bersih yang diambil
 * retur ini darinya. Baris alokasi mencatat pengambilan BRUTO
 * (bersih + pajak) agar retur penuh melunasi penerimaan ber-PPN
 * secara utuh — tanpa sisa utang sebesar PPN-nya.
 */
function planReturnAllocations(
  openDocs: OpenPayableDoc[],
  payableAmount: Decimal,
): { allocationPlan: AllocationPlanItem[]; taxReversal: Decimal; unallocatedNet: Decimal } {
  const allocationPlan: AllocationPlanItem[] = [];
  let taxReversal = d(0);
  let unallocatedNet = payableAmount;
  for (const doc of openDocs) {
    if (unallocatedNet.lte(0)) break;
    if (doc.kind === "receipt" && doc.taxAmount.gt(0) && doc.total.gt(0)) {
      const outstandingTax = doc.taxAmount.mul(doc.outstanding).div(doc.total);
      const outstandingNet = doc.outstanding.minus(outstandingTax);
      const takeNet = DecimalMin(outstandingNet, unallocatedNet);
      const takeTax = outstandingNet.gt(0) ? outstandingTax.mul(takeNet).div(outstandingNet) : d(0);
      if (takeNet.gt(0) || takeTax.gt(0)) {
        allocationPlan.push({ doc, grossTake: takeNet.plus(takeTax) });
        taxReversal = taxReversal.plus(takeTax);
        unallocatedNet = unallocatedNet.minus(takeNet);
      }
    } else {
      const take = DecimalMin(doc.outstanding, unallocatedNet);
      if (take.gt(0)) {
        allocationPlan.push({ doc, grossTake: take });
        unallocatedNet = unallocatedNet.minus(take);
      }
    }
  }
  return { allocationPlan, taxReversal, unallocatedNet };
}

/** Jurnal posting retur: Dr Utang (bruto) + Dr Kredit Pemasok / Cr Persediaan + Cr reversi PPN. */
async function postReturnJournal(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    header: SupplierReturnRow;
    totalValue: Decimal;
    payableAmount: Decimal;
    creditAmount: Decimal;
    taxReversal: Decimal;
  },
) {
  const { header } = input;
  const map = await getAccountMap(tx, input.companyId);
  const supplierParty = { partyType: "supplier", partyId: header.supplierId };
  const journalLines: {
    accountId: string;
    debit?: Decimal;
    credit?: Decimal;
    description: string;
    partyType?: string;
    partyId?: string;
  }[] = [];
  if (input.payableAmount.gt(0)) {
    journalLines.push({
      accountId: map.payable,
      // Bruto: porsi bersih nilai retur + reversi PPN Masukan —
      // utang faktur memang bruto, jadi debitnya harus bruto pula.
      debit: input.payableAmount.plus(input.taxReversal),
      description: "Utang pemasok berkurang oleh retur",
      ...supplierParty,
    });
  }
  if (input.creditAmount.gt(0)) {
    // getAccountId throws the VALIDATION that names the missing
    // mapping — the account is never guessed (D-20).
    const creditAccountId = await getAccountId(tx, input.companyId, "supplier_credit");
    journalLines.push({
      accountId: creditAccountId,
      debit: input.creditAmount,
      description: "Klaim kredit pemasok dari retur",
      ...supplierParty,
    });
  }
  journalLines.push({
    accountId: map.inventory,
    credit: input.totalValue,
    description: "Persediaan berkurang oleh retur",
  });
  if (input.taxReversal.gt(0)) {
    const taxInputAccountId = await getAccountId(tx, input.companyId, "tax_input");
    journalLines.push({
      accountId: taxInputAccountId,
      credit: input.taxReversal,
      description: "Reversi PPN masukan atas barang yang diretur",
      ...supplierParty,
    });
  }
  await postJournal(tx, {
    companyId: input.companyId,
    date: header.date,
    description: `Retur pembelian ${header.number} — ${SUPPLIER_RETURN_REASON_LABELS[header.reasonCategory] ?? header.reasonCategory}`,
    sourceType: "supplier_return",
    sourceId: header.id,
    createdBy: input.userId,
    idempotencyKey: `supplier-return:${header.id}`,
    lines: journalLines,
  });
}

/**
 * Posting: the ONLY step that moves stock and money. Values are frozen
 * here at the running AVCO — drafts carry no cost, so a draft left open
 * while the average moves settles at the average of its posting day.
 */
export async function postSupplierReturn(
  tx: Tx,
  input: { companyId: string; userId: string; userRole?: string | null; returnId: string },
) {
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  if (header.status !== "draft") {
    throw new AppError(
      "INVALID_STATE",
      `Retur ${header.number} berstatus ${header.status} dan tidak dapat diposting ulang.`,
    );
  }
  // WF-021: Maker-checker (Four-Eyes Principle) — pembuat draft retur pemasok tidak dapat memposting sendiri
  if (
    input.userRole &&
    input.userRole !== "owner" &&
    input.userRole !== "admin" &&
    input.userId &&
    header.createdBy &&
    header.createdBy === input.userId
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Prinsip Maker-Checker (Four-Eyes Principle): Retur pemasok harus diverifikasi dan diposting oleh pengguna selain pembuat draft retur.",
    );
  }
  await assertPeriodOpen(tx, input.companyId, header.date);

  // GDG1-01 (otoritatif): kunci baris pemasok selama penilaian plafon
  // + posting, sehingga dua retur ke pemasok yang sama yang diposting
  // bersamaan dinilai satu per satu — yang kedua membaca kumulatif
  // sesudah yang pertama commit dan tertahan bila plafon habis.
  await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, input.companyId), eq(suppliers.id, header.supplierId)))
    .limit(1)
    .for("update");

  const lines = await tx
    .select()
    .from(supplierReturnLines)
    .where(
      and(eq(supplierReturnLines.companyId, input.companyId), eq(supplierReturnLines.returnId, header.id)),
    )
    .orderBy(asc(supplierReturnLines.id));
  if (lines.length === 0) throw new AppError("VALIDATION", "Retur tidak memiliki baris barang.");

  const productIds = [...new Set(lines.map((line) => line.productId))];
  const productRows = await tx
    .select({
      id: products.id,
      name: products.name,
      costPrice: products.costPrice,
      trackBatch: products.trackBatch,
      trackSerial: products.trackSerial,
    })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
  const productById = new Map(productRows.map((row) => [row.id, row]));

  // GDG1-01 (otoritatif): plafon asal-usul dinilai ulang di sini —
  // retur ini sendiri masih berstatus draft sehingga belum ikut
  // terhitung di kumulatif terposting.
  const postedRequested = new Map<string, Decimal>();
  for (const line of lines) {
    postedRequested.set(line.productId, (postedRequested.get(line.productId) ?? d(0)).plus(d(line.qty)));
  }
  await assertReturnWithinProvenance(tx, {
    companyId: input.companyId,
    supplierId: header.supplierId,
    requested: postedRequested,
    productName: (productId) => productById.get(productId)?.name ?? productId,
  });

  const { frozenLines, totalValue } = await freezeReturnLineValues(tx, {
    companyId: input.companyId,
    lines,
    productById,
  });
  await issueReturnStock(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    frozenLines,
  });

  const openDocs = await listOpenPayableDocs(tx, input.companyId, header.supplierId);
  const openPayable = openDocs.reduce((acc, doc) => acc.plus(doc.outstanding), d(0));
  const payableAmount = DecimalMin(totalValue, openPayable);
  const creditAmount = totalValue.minus(payableAmount);

  const { allocationPlan, taxReversal, unallocatedNet } = planReturnAllocations(
    openDocs,
    payableAmount,
  );

  if (totalValue.gt(0)) {
    await postReturnJournal(tx, {
      companyId: input.companyId,
      userId: input.userId,
      header,
      totalValue,
      payableAmount,
      creditAmount,
      taxReversal,
    });
  }

  if (payableAmount.gt(0)) {
    // Alokasi per dokumen mengikuti rencana (pengambilan bruto per
    // dokumen, termasuk porsi reversi PPN-nya). Sisa bersih yang
    // tidak terpetakan rencana — hanya mungkin pada dokumen yang sisa
    // terutangnya murni porsi pajak — dialokasikan FIFO polos sebagai
    // jaring pengaman agar subledger dan jurnal tidak pernah selisih.
    for (const item of allocationPlan) {
      await allocateReturnToPayables(tx, {
        companyId: input.companyId,
        returnId: header.id,
        supplierId: header.supplierId,
        amount: item.grossTake,
        targetReceiptId: item.doc.kind === "receipt" ? item.doc.id : undefined,
        targetOpeningId: item.doc.kind === "opening" ? item.doc.id : undefined,
      });
    }
    if (unallocatedNet.gt(0)) {
      await allocateReturnToPayables(tx, {
        companyId: input.companyId,
        returnId: header.id,
        supplierId: header.supplierId,
        amount: unallocatedNet,
      });
    }
  }

  let status: string = creditAmount.eq(0) ? "resolved" : "posted";
  await tx
    .update(supplierReturns)
    .set({
      totalValue: toDb(totalValue),
      payableAmount: toDb(payableAmount),
      creditAmount: toDb(creditAmount),
      taxAmount: toDb(taxReversal),
      status,
      postedAt: new Date(),
    })
    .where(and(eq(supplierReturns.companyId, input.companyId), eq(supplierReturns.id, header.id)));

  // Pilihan "Jadikan uang muka pembelian berikutnya" tidak boleh berhenti
  // sebagai niat: sisa klaim langsung direklasifikasi menjadi uang muka
  // pembelian (Dr Uang Muka / Cr Kredit Pemasok) sehingga muncul di
  // /app/gudang/uang-muka dan dipotong FIFO pada penerimaan berikutnya.
  // "Potong utang pembelian berikutnya" tetap hanya menyimpan klaim.
  if (header.resolutionType === "purchase_advance" && creditAmount.gt(0)) {
    await convertSupplierCreditToAdvance(tx, {
      companyId: input.companyId,
      userId: input.userId,
      returnId: header.id,
      date: header.date,
      notes: `Otomatis dari retur ${header.number} — uang muka pembelian berikutnya`,
    });
    status = "resolved";
  }

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "supplier_return.post",
    entityType: "supplier_return",
    entityId: header.id,
    after: {
      number: header.number,
      totalValue: toDb(totalValue),
      payableAmount: toDb(payableAmount),
      creditAmount: toDb(creditAmount),
      advanceCreated: header.resolutionType === "purchase_advance" && creditAmount.gt(0),
    },
  });

  return {
    id: header.id,
    number: header.number,
    totalValue: toDb(totalValue),
    payableAmount: toDb(payableAmount),
    creditAmount: toDb(creditAmount),
    status,
  };
}

/** Retur yang sudah punya penyelesaian klaim tidak dapat dibatalkan di sini. */
async function assertReturnHasNoResolutions(tx: Tx, header: SupplierReturnRow) {
  const [resolutionCount] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(supplierReturnResolutions)
    .where(
      and(
        eq(supplierReturnResolutions.companyId, header.companyId),
        eq(supplierReturnResolutions.returnId, header.id),
      ),
    );
  if ((resolutionCount?.value ?? 0) > 0 || d(header.resolvedAmount).gt(0)) {
    throw new AppError(
      "INVALID_STATE",
      `Retur ${header.number} sudah memiliki penyelesaian klaim dan tidak dapat dibatalkan. Koreksi setiap penyelesaian terlebih dahulu.`,
    );
  }
}

/** Balik jurnal posting retur (hanya bila retur bernilai > 0). */
async function reverseReturnPostingJournal(
  tx: Tx,
  input: { companyId: string; userId: string; header: SupplierReturnRow; date: string; reason: string },
) {
  const { header } = input;
  if (!d(header.totalValue).gt(0)) return;
  const [original] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.sourceType, "supplier_return"),
        eq(journalEntries.sourceId, header.id),
        eq(journalEntries.status, "posted"),
        sql`${journalEntries.reversalOfId} is null`,
      ),
    )
    .limit(1);
  if (!original) {
    throw new AppError(
      "VALIDATION",
      `Jurnal asal retur ${header.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan retur dibatalkan agar stok dan buku besar tetap selaras; periksa jurnal retur ini terlebih dahulu.`,
    );
  }
  await reverseJournalEntry(tx, {
    companyId: input.companyId,
    entryId: original.id,
    date: input.date,
    description: `Pembatalan retur pembelian ${header.number} — ${input.reason}`,
    createdBy: input.userId,
  });
}

/** Stok kembali masuk pada irisan gerakan asal persis, batch & seri ikut pulih. */
async function restoreReturnedStock(
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

  // FIX-GDG Tahap 2 (GDG1-03): seri yang dikeluarkan retur ini ikut
  // dipulihkan — simetris pemulihan batch & stok di atas dan pola
  // voidSale/voidReceipt. Tanpa ini qty stok kembali tetapi unit
  // serialnya berstatus out selamanya: stok hantu yang tidak bisa
  // dipilih kasir dan invariant seri hidup = on-hand patah diam-diam.
  // Gerakan keluar seri retur ber-referenceId = retur ini (kind "out"
  // dari pickSerialsOut saat posting), jadi helper pemulihan penjualan
  // berlaku persis dengan saleId = id retur.
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

/** Lepaskan alokasi utang retur dan segarkan status bayar dokumen sumbernya. */
async function releaseReturnAllocations(tx: Tx, companyId: string, returnId: string) {
  const allocations = await tx
    .select({
      receiptId: supplierReturnAllocations.receiptId,
      openingId: supplierReturnAllocations.openingId,
    })
    .from(supplierReturnAllocations)
    .where(
      and(eq(supplierReturnAllocations.companyId, companyId), eq(supplierReturnAllocations.returnId, returnId)),
    );
  await tx
    .delete(supplierReturnAllocations)
    .where(
      and(eq(supplierReturnAllocations.companyId, companyId), eq(supplierReturnAllocations.returnId, returnId)),
    );
  for (const allocation of allocations) {
    if (allocation.receiptId) {
      await refreshReceiptPaymentStatus(tx, companyId, allocation.receiptId);
    }
    if (allocation.openingId) {
      await refreshOpeningPayableStatus(tx, companyId, allocation.openingId);
    }
  }
}

/**
 * Void a posted return that has NO resolution yet: stock comes back in
 * on the exact original movement slices, the posting journal is
 * reversed, and its payable allocations are released so the supplier's
 * open payable returns to what it was. Once any resolution exists the
 * claim has already been spent — the return can no longer be unwound
 * here (correct each resolution instead).
 */
export async function voidPostedSupplierReturn(
  tx: Tx,
  input: { companyId: string; userId: string; returnId: string; reason: string; date: string },
) {
  if (!input.reason.trim()) throw new AppError("VALIDATION", "Alasan pembatalan wajib diisi.");
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  if (header.status === "void") {
    throw new AppError("INVALID_STATE", `Retur ${header.number} sudah dibatalkan.`);
  }
  if (header.status === "draft") {
    throw new AppError(
      "INVALID_STATE",
      `Retur ${header.number} masih draft — hapus draft-nya, bukan dibatalkan.`,
    );
  }
  await assertReturnHasNoResolutions(tx, header);

  await assertPeriodOpen(tx, input.companyId, input.date);

  await reverseReturnPostingJournal(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    date: input.date,
    reason: input.reason,
  });
  await restoreReturnedStock(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    date: input.date,
    reason: input.reason,
  });
  // Stock yang kembali dari retur tidak mengikuti blend inkremental
  // (movement "reversal"), jadi AVCO produk harus dihitung ulang dari
  // ledger agar nilai persediaan = GL.
  const returnedProducts = await tx
    .select({ productId: supplierReturnLines.productId })
    .from(supplierReturnLines)
    .where(
      and(
        eq(supplierReturnLines.companyId, input.companyId),
        eq(supplierReturnLines.returnId, header.id),
      ),
    );
  for (const productId of [...new Set(returnedProducts.map((row) => row.productId))]) {
    await recomputeCostFromLedger(tx, input.companyId, productId);
  }
  await releaseReturnAllocations(tx, input.companyId, header.id);

  await tx
    .update(supplierReturns)
    .set({ status: "void" })
    .where(and(eq(supplierReturns.companyId, input.companyId), eq(supplierReturns.id, header.id)));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "supplier_return.void",
    entityType: "supplier_return",
    entityId: header.id,
    after: { number: header.number, reason: input.reason },
  });

  return { id: header.id, number: header.number };
}
