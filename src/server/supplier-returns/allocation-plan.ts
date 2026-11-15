import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { stockReceiptLines, stockReceipts } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, type Decimal } from "@/lib/money";
import { calculateLinkedSupplierReturnValuation } from "@/lib/supplier-return-valuation";
import type { OpenPayableDoc } from "./payables";
import { DecimalMin } from "./shared";

export type AllocationPlanItem = { doc: OpenPayableDoc; grossTake: Decimal };

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
export function planReturnAllocations(
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

/** Receipt-linked credit-note amounts are already gross of tax; allocate
 * them directly to the source document's open gross payable. */
export function planGrossReturnAllocations(
  openDocs: OpenPayableDoc[],
  payableGross: Decimal,
): { allocationPlan: AllocationPlanItem[]; unallocatedGross: Decimal } {
  const allocationPlan: AllocationPlanItem[] = [];
  let unallocatedGross = payableGross;
  for (const doc of openDocs) {
    if (unallocatedGross.lte(0)) break;
    const grossTake = DecimalMin(doc.outstanding, unallocatedGross);
    if (grossTake.gt(0)) {
      allocationPlan.push({ doc, grossTake });
      unallocatedGross = unallocatedGross.minus(grossTake);
    }
  }
  return { allocationPlan, unallocatedGross };
}

export async function calculateReceiptLinkedClaim(
  tx: Tx,
  input: {
    companyId: string;
    receiptId: string;
    lines: { receiptLineId: string | null; qty: string }[];
    inventoryValue: Decimal;
  },
) {
  const [receipt] = await tx
    .select({ total: stockReceipts.total, taxAmount: stockReceipts.taxAmount })
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, input.receiptId)))
    .limit(1);
  if (!receipt) throw new AppError("VALIDATION", "Faktur penerimaan asal tidak ditemukan.");

  const sourceLines = await tx
    .select({ id: stockReceiptLines.id, qty: stockReceiptLines.qty, lineTotal: stockReceiptLines.lineTotal })
    .from(stockReceiptLines)
    .where(and(eq(stockReceiptLines.companyId, input.companyId), eq(stockReceiptLines.receiptId, input.receiptId)));
  const valuation = calculateLinkedSupplierReturnValuation({
    sourceLines,
    returnLines: input.lines.map((line) => ({
      receiptLineId: line.receiptLineId!,
      qty: line.qty,
    })),
    receiptTotal: receipt.total,
    receiptTaxAmount: receipt.taxAmount,
    inventoryValue: input.inventoryValue,
  });
  if (!valuation) {
    throw new AppError(
      "VALIDATION",
      "Nilai faktur asal tidak dapat direkonsiliasi dengan baris dan PPN-nya. Periksa dokumen penerimaan sebelum memposting retur.",
    );
  }
  return valuation;
}

