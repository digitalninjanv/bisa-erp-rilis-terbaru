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
  stockReceiptLines,
  supplierReturnAllocations,
  supplierReturnResolutions,
  supplierReturnLines,
  supplierReturns,
  suppliers,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type Decimal } from "@/lib/money";

import { assertPeriodOpen, getAccountId, getAccountMap, postJournal, reverseJournalEntry } from "@/server/accounting";
import { createPartyCredit, setPartyCreditJournal, voidPartyCreditForReturn } from "@/server/party-credits";
import { writeAudit } from "@/server/audit";
import {
  calculateReceiptLinkedClaim,
  planGrossReturnAllocations,
  planReturnAllocations,
  type AllocationPlanItem,
} from "./allocation-plan";
import { recomputeCostFromLedger } from "@/server/inventory";
import {
  allocateReturnToPayables,
  listOpenPayableDocs,
  refreshOpeningPayableStatus,
  refreshReceiptPaymentStatus,
} from "./payables";
import { assertReturnWithinProvenance, assertReturnWithinReceiptLines } from "./provenance";
import { convertSupplierCreditToAdvance } from "./resolutions";
import { lockSupplierReturn } from "./returns";
import { DecimalMin, SUPPLIER_RETURN_REASON_LABELS } from "./shared";
import type { SupplierReturnRow } from "./shared";
import { freezeReturnLineValues, issueReturnStock, restoreReturnedStock } from "./stock";

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
    invoiceLinked: boolean;
    priceVariance: Decimal;
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
      // Manual returns keep the legacy net-plus-proportional-tax policy.
      // A receipt-linked credit note is already gross and includes its own
      // tax reversal, so it is applied to the source payable as-is.
      debit: input.invoiceLinked
        ? input.payableAmount
        : input.payableAmount.plus(input.taxReversal),
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
  if (input.invoiceLinked && !input.priceVariance.isZero()) {
    const cogsAccountId = await getAccountId(tx, input.companyId, "cogs");
    journalLines.push({
      accountId: cogsAccountId,
      ...(input.priceVariance.gt(0)
        ? { credit: input.priceVariance }
        : { debit: input.priceVariance.abs() }),
      description: input.priceVariance.gt(0)
        ? "Pemulihan HPP: kredit nota melebihi nilai persediaan AVCO"
        : "Selisih HPP: nilai persediaan AVCO melebihi kredit nota",
    });
  }
  return await postJournal(tx, {
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

  const linkedReceiptLineIds = lines
    .map((line) => line.receiptLineId)
    .filter((id): id is string => Boolean(id));
  const sourceReceiptIds = new Set<string>();
  if (linkedReceiptLineIds.length > 0) {
    if (linkedReceiptLineIds.length !== lines.length) {
      throw new AppError(
        "VALIDATION",
        "Retur dari penerimaan harus memakai satu dokumen sumber yang sama untuk semua barang.",
      );
    }
    const originRows = await tx
      .select({ receiptId: stockReceiptLines.receiptId })
      .from(stockReceiptLines)
      .where(
        and(
          eq(stockReceiptLines.companyId, input.companyId),
          inArray(stockReceiptLines.id, linkedReceiptLineIds),
        ),
      );
    originRows.forEach((row) => sourceReceiptIds.add(row.receiptId));
    if (sourceReceiptIds.size !== 1 || originRows.length !== linkedReceiptLineIds.length) {
      throw new AppError(
        "VALIDATION",
        "Satu retur dari penerimaan hanya dapat merujuk satu dokumen asal yang valid.",
      );
    }
  }
  const sourceReceiptId = [...sourceReceiptIds][0] ?? null;

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
  await assertReturnWithinReceiptLines(tx, {
    companyId: input.companyId,
    supplierId: header.supplierId,
    warehouseId: header.warehouseId,
    lines: lines.map((line) => ({
      receiptLineId: line.receiptLineId,
      productId: line.productId,
      batchId: line.batchId,
      qty: d(line.qty),
      productName: productById.get(line.productId)?.name ?? line.productId,
    })),
  });

  const { frozenLines, totalValue } = await freezeReturnLineValues(tx, {
    companyId: input.companyId,
    lines,
    productById,
  });
  const invoiceValuation = sourceReceiptId
    ? await calculateReceiptLinkedClaim(tx, {
        companyId: input.companyId,
        receiptId: sourceReceiptId,
        lines,
        inventoryValue: totalValue,
      })
    : null;
  const invoiceLinked = invoiceValuation !== null;
  const invoiceCreditValue = invoiceValuation ? d(invoiceValuation.invoiceCreditValue) : d(0);
  const priceVariance = invoiceValuation ? d(invoiceValuation.inventoryVariance) : d(0);
  await issueReturnStock(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    frozenLines,
  });

  const openDocs = await listOpenPayableDocs(tx, input.companyId, header.supplierId);
  // A receipt-linked return reduces that receipt's payable first. Any
  // remaining value becomes a supplier credit; it is never silently
  // allocated to a different purchase invoice. Manual returns retain the
  // existing supplier-wide oldest-first policy.
  const allocationDocs = sourceReceiptId
    ? openDocs.filter((doc) => doc.kind === "receipt" && doc.id === sourceReceiptId)
    : openDocs;
  const openPayable = allocationDocs.reduce((acc, doc) => acc.plus(doc.outstanding), d(0));
  let payableAmount: Decimal;
  let creditAmount: Decimal;
  let taxReversal: Decimal;
  let allocationPlan: AllocationPlanItem[];
  let unallocatedNet: Decimal;
  if (invoiceValuation) {
    payableAmount = DecimalMin(invoiceCreditValue, openPayable);
    creditAmount = invoiceCreditValue.minus(payableAmount);
    taxReversal = d(invoiceValuation.taxValue);
    const allocation = planGrossReturnAllocations(allocationDocs, payableAmount);
    allocationPlan = allocation.allocationPlan;
    unallocatedNet = allocation.unallocatedGross;
  } else {
    payableAmount = DecimalMin(totalValue, openPayable);
    creditAmount = totalValue.minus(payableAmount);
    const allocation = planReturnAllocations(allocationDocs, payableAmount);
    allocationPlan = allocation.allocationPlan;
    taxReversal = allocation.taxReversal;
    unallocatedNet = allocation.unallocatedNet;
  }

  let returnJournal: { id: string; number: string } | null = null;
  if (totalValue.gt(0) || invoiceCreditValue.gt(0)) {
    returnJournal = await postReturnJournal(tx, {
      companyId: input.companyId,
      userId: input.userId,
      header,
      totalValue,
      payableAmount,
      creditAmount,
      taxReversal,
      invoiceLinked,
      priceVariance,
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
    if (invoiceValuation && unallocatedNet.gt(0)) {
      throw new AppError(
        "VALIDATION",
        "Kredit nota melebihi saldo utang faktur asal yang dapat dialokasikan. Periksa ulang saldo faktur sebelum memposting retur.",
      );
    }
    if (!invoiceValuation && unallocatedNet.gt(0)) {
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
      invoiceCreditAmount: toDb(invoiceCreditValue),
      priceVarianceAmount: toDb(priceVariance),
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
  } else if (creditAmount.gt(0)) {
    const partyCredit = await createPartyCredit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      partyType: "supplier",
      partyId: header.supplierId,
      date: header.date,
      amount: creditAmount,
      originLabel: `Retur ${header.number}`,
      notes: `Kredit klaim retur ${header.number}`,
    });
    if (returnJournal?.id) {
      await setPartyCreditJournal(tx, input.companyId, partyCredit.id, returnJournal.id);
    }
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
      invoiceCreditAmount: toDb(invoiceCreditValue),
      priceVarianceAmount: toDb(priceVariance),
      advanceCreated: header.resolutionType === "purchase_advance" && creditAmount.gt(0),
    },
  });

  return {
    id: header.id,
    number: header.number,
    totalValue: toDb(totalValue),
    payableAmount: toDb(payableAmount),
    creditAmount: toDb(creditAmount),
    invoiceCreditAmount: toDb(invoiceCreditValue),
    priceVarianceAmount: toDb(priceVariance),
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

  await voidPartyCreditForReturn(tx, {
    companyId: input.companyId,
    returnNumber: header.number,
  });

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
    .where(and(eq(supplierReturnLines.companyId, input.companyId), eq(supplierReturnLines.returnId, header.id)));
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
