import { and, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { stockReceipts, suppliers } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/server/audit";

/** Record a unique supplier invoice against an already-posted purchase receipt. */
export async function recordReceiptInvoiceNumber(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    receiptId: string;
    supplierInvoiceNumber: string;
  },
) {
  const invoiceNumber = input.supplierInvoiceNumber.trim();
  if (!invoiceNumber || invoiceNumber.length > 80) {
    throw new AppError("VALIDATION", "Nomor faktur harus diisi dan maksimal 80 karakter.");
  }

  const [receipt] = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      supplierId: stockReceipts.supplierId,
      source: stockReceipts.source,
      status: stockReceipts.status,
      supplierInvoiceNumber: stockReceipts.supplierInvoiceNumber,
    })
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, input.receiptId)))
    .limit(1)
    .for("update");
  if (!receipt) throw new AppError("NOT_FOUND", "Penerimaan tidak ditemukan.");
  if (receipt.source !== "purchase" || receipt.status !== "posted" || !receipt.supplierId) {
    throw new AppError("INVALID_STATE", "Nomor faktur hanya dapat dicatat pada penerimaan pembelian yang terposting.");
  }

  // Match the supplier before checking duplicates. Receipt creation uses the
  // same supplier lock, serializing invoice-number checks for this supplier.
  const [supplier] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, input.companyId), eq(suppliers.id, receipt.supplierId)))
    .limit(1)
    .for("update");
  if (!supplier) throw new AppError("NOT_FOUND", "Pemasok penerimaan tidak ditemukan.");

  const [duplicate] = await tx
    .select({ number: stockReceipts.number })
    .from(stockReceipts)
    .where(
      and(
        eq(stockReceipts.companyId, input.companyId),
        eq(stockReceipts.supplierId, receipt.supplierId),
        ne(stockReceipts.status, "void"),
        sql`lower(trim(${stockReceipts.supplierInvoiceNumber})) = ${invoiceNumber.toLowerCase()}`,
        ne(stockReceipts.id, receipt.id),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new AppError(
      "VALIDATION",
      `Nomor faktur pemasok "${invoiceNumber}" sudah dipakai pada penerimaan ${duplicate.number} untuk pemasok ini. Periksa kembali agar utang tidak tercatat dua kali.`,
    );
  }

  await tx
    .update(stockReceipts)
    .set({ supplierInvoiceNumber: invoiceNumber })
    .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.id, receipt.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "update_supplier_invoice_number",
    entityType: "stock_receipt",
    entityId: receipt.id,
    before: { number: receipt.number, supplierInvoiceNumber: receipt.supplierInvoiceNumber },
    after: { number: receipt.number, supplierInvoiceNumber: invoiceNumber },
  });

  return { id: receipt.id, number: receipt.number, supplierInvoiceNumber: invoiceNumber };
}
