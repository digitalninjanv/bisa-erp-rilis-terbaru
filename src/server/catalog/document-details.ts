/**
 * Agregat baca DETAIL DOKUMEN STOK (A-26 Q5, K-04) — pecahan
 * src/server/catalog.ts: jurnal terkait dokumen, detail penerimaan &
 * dokumen stok, dan data cetak penerimaan.
 * Badan kueri dipindah apa adanya.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { d } from "@/lib/money";
import {
  accounts,
  journalEntries,
  productPackagings,
  products,
  purchaseAdvanceAllocations,
  purchaseOrders,
  stockBatches,
  stockDocumentLines,
  stockDocuments,
  stockMovements,
  stockReceiptLines,
  stockReceipts,
  stockSerialMovements,
  stockSerials,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";

/* ------------------------------------------------------------------ */
/* FIX-GDG Tahap 4 (GDG2-02) — detail dokumen stok                     */
/*                                                                     */
/* Sebelum tahap ini penerimaan/opname/penyesuaian/transfer tidak      */
/* punya halaman detail: isi dokumen hanya bisa ditebak dari daftar    */
/* riwayat (nomor, tanggal, jumlah item) atau membuka cetak GRN.       */
/* Dua getter ini memberi satu bentuk data untuk halaman detail:       */
/* header + baris (+ batch/seri) + jurnal terkait.                     */
/* ------------------------------------------------------------------ */

export type LinkedJournal = {
  id: string;
  number: string;
  date: string;
  description: string;
  status: string;
  sourceType: string;
  reversalOfId: string | null;
};

/**
 * Jurnal-jurnal yang terbentuk dari satu dokumen sumber (pola
 * "Rincian Jurnal" Accurate): jurnal posting dokumen + jurnal
 * pembayaran yang menunjuk dokumen yang sama + jurnal pembaliknya —
 * semuanya memang menyimpan sourceId dokumen itu. Dipakai halaman
 * detail dokumen (penerimaan, dokumen stok, payroll, …) lewat
 * komponen bersama DocumentJournals. A-24 T4 mengekspornya agar
 * modul lain memakai mekanisme yang sama, bukan jalur baca kedua.
 */
export async function listLinkedJournals(
  tx: Tx,
  companyId: string,
  sourceId: string,
): Promise<LinkedJournal[]> {
  return tx
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.date,
      description: journalEntries.description,
      status: journalEntries.status,
      sourceType: journalEntries.sourceType,
      reversalOfId: journalEntries.reversalOfId,
    })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.sourceId, sourceId)))
    .orderBy(asc(journalEntries.createdAt), asc(journalEntries.id));
}

/** Varian batch listLinkedJournals untuk halaman daftar: satu kueri
 * untuk banyak dokumen, dikelompokkan per sourceId. Dokumen tanpa
 * jurnal tidak muncul sebagai kunci (pemanggil memakai [] bawaan). */
export async function listLinkedJournalsBySourceIds(
  tx: Tx,
  companyId: string,
  sourceIds: string[],
): Promise<Map<string, LinkedJournal[]>> {
  const grouped = new Map<string, LinkedJournal[]>();
  if (sourceIds.length === 0) return grouped;
  const rows = await tx
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.date,
      description: journalEntries.description,
      status: journalEntries.status,
      sourceType: journalEntries.sourceType,
      reversalOfId: journalEntries.reversalOfId,
      sourceId: journalEntries.sourceId,
    })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.sourceId, sourceIds)))
    .orderBy(asc(journalEntries.createdAt), asc(journalEntries.id));
  for (const row of rows) {
    if (!row.sourceId) continue;
    const list = grouped.get(row.sourceId) ?? [];
    list.push({
      id: row.id,
      number: row.number,
      date: row.date,
      description: row.description,
      status: row.status,
      sourceType: row.sourceType,
      reversalOfId: row.reversalOfId,
    });
    grouped.set(row.sourceId, list);
  }
  return grouped;
}

/** Nomor jurnal dari daftar id jurnal — untuk tabel yang menyimpan
 * journal_id langsung (saldo awal pihak, kredit pihak, aset tetap). */
export async function listJournalNumbersById(
  tx: Tx,
  companyId: string,
  journalIds: string[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  const unique = [...new Set(journalIds)];
  if (unique.length === 0) return numbers;
  const rows = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.id, unique)));
  for (const row of rows) numbers.set(row.id, row.number);
  return numbers;
}

export async function getReceiptDetail(tx: Tx, companyId: string, id: string) {
  const [receipt] = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      date: stockReceipts.date,
      status: stockReceipts.status,
      source: stockReceipts.source,
      total: stockReceipts.total,
      taxRate: stockReceipts.taxRate,
      taxAmount: stockReceipts.taxAmount,
      paidAmount: stockReceipts.paidAmount,
      paymentStatus: stockReceipts.paymentStatus,
      supplierInvoiceNumber: stockReceipts.supplierInvoiceNumber,
      supplierInvoiceDate: stockReceipts.supplierInvoiceDate,
      dueDate: stockReceipts.dueDate,
      priceVarianceReason: stockReceipts.priceVarianceReason,
      notes: stockReceipts.notes,
      createdBy: stockReceipts.createdBy,
      postedAt: stockReceipts.postedAt,
      createdAt: stockReceipts.createdAt,
      purchaseOrderId: stockReceipts.purchaseOrderId,
      supplierId: stockReceipts.supplierId,
      warehouseId: stockReceipts.warehouseId,
      supplierName: suppliers.name,
      warehouseName: warehouses.name,
      paymentAccountCode: accounts.code,
      paymentAccountName: accounts.name,
      purchaseOrderNumber: purchaseOrders.number,
    })
    .from(stockReceipts)
    .leftJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .leftJoin(warehouses, eq(stockReceipts.warehouseId, warehouses.id))
    .leftJoin(accounts, eq(stockReceipts.paymentAccountId, accounts.id))
    .leftJoin(purchaseOrders, eq(stockReceipts.purchaseOrderId, purchaseOrders.id))
    .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.id, id)))
    .limit(1);
  if (!receipt) return null;

  const lines = await tx
    .select({
      id: stockReceiptLines.id,
      productId: stockReceiptLines.productId,
      productName: sql<string>`coalesce(${stockReceiptLines.productName}, ${products.name})`,
      sku: sql<string | null>`coalesce(${stockReceiptLines.productSku}, ${products.sku})`,
      unitName: units.name,
      qty: stockReceiptLines.qty,
      unitCost: stockReceiptLines.unitCost,
      lineTotal: stockReceiptLines.lineTotal,
      discountType: stockReceiptLines.discountType,
      discountValue: stockReceiptLines.discountValue,
      discountAmount: stockReceiptLines.discountAmount,
      // S2: bentuk masukan berkemasan baris (nama kemasan diselesaikan
      // langsung; faktor & qty masukan adalah cuplikan baris).
      packagingId: stockReceiptLines.packagingId,
      packagingName: productPackagings.name,
      qtyInput: stockReceiptLines.qtyInput,
      isiSnapshot: stockReceiptLines.isiSnapshot,
      batchNumber: stockReceiptLines.batchNumber,
      expiryDate: stockReceiptLines.expiryDate,
      trackBatch: products.trackBatch,
      sourceBatchId: stockBatches.id,
      sourceBatchQty: stockBatches.qty,
    })
    .from(stockReceiptLines)
    .innerJoin(products, eq(stockReceiptLines.productId, products.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .leftJoin(productPackagings, eq(stockReceiptLines.packagingId, productPackagings.id))
    .leftJoin(
      stockBatches,
      and(
        eq(stockBatches.companyId, stockReceiptLines.companyId),
        eq(stockBatches.productId, stockReceiptLines.productId),
        eq(stockBatches.warehouseId, receipt.warehouseId),
        sql`${stockBatches.batchNumber} IS NOT DISTINCT FROM ${stockReceiptLines.batchNumber}`,
        sql`${stockBatches.expiryDate} IS NOT DISTINCT FROM ${stockReceiptLines.expiryDate}`,
      ),
    )
    .where(and(eq(stockReceiptLines.companyId, companyId), eq(stockReceiptLines.receiptId, id)))
    .orderBy(asc(sql`coalesce(${stockReceiptLines.productName}, ${products.name})`));

  // Nomor seri yang terdaftar atas penerimaan ini (stock_serials
  // menyimpan receipt_id unitnya) — ditampilkan per produk.
  const serialRows = await tx
    .select({
      productId: stockSerials.productId,
      serialNumber: stockSerials.serialNumber,
      status: stockSerials.status,
    })
    .from(stockSerials)
    .where(and(eq(stockSerials.companyId, companyId), eq(stockSerials.receiptId, id)))
    .orderBy(asc(stockSerials.serialNumber));
  const serialsByProduct = new Map<string, { serialNumber: string; status: string }[]>();
  for (const row of serialRows) {
    const list = serialsByProduct.get(row.productId) ?? [];
    list.push({ serialNumber: row.serialNumber, status: row.status });
    serialsByProduct.set(row.productId, list);
  }

  const journals = await listLinkedJournals(tx, companyId, id);
  const [advanceRow] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${purchaseAdvanceAllocations.amount}), 0)`,
    })
    .from(purchaseAdvanceAllocations)
    .where(
      and(
        eq(purchaseAdvanceAllocations.companyId, companyId),
        eq(purchaseAdvanceAllocations.receiptId, id),
      ),
    );
  return {
    receipt: { ...receipt, advanceApplied: d(advanceRow?.amount ?? 0).toNumber() },
    lines,
    serialsByProduct,
    journals,
  };
}

export async function getStockDocumentDetail(tx: Tx, companyId: string, id: string) {
  const [doc] = await tx
    .select({
      id: stockDocuments.id,
      type: stockDocuments.type,
      number: stockDocuments.number,
      date: stockDocuments.date,
      status: stockDocuments.status,
      reason: stockDocuments.reason,
      refundMethod: stockDocuments.refundMethod,
      total: stockDocuments.total,
      notes: stockDocuments.notes,
      createdBy: stockDocuments.createdBy,
      approvedBy: stockDocuments.approvedBy,
      approvedAt: stockDocuments.approvedAt,
      rejectionReason: stockDocuments.rejectionReason,
      receivedBy: stockDocuments.receivedBy,
      receivedAt: stockDocuments.receivedAt,
      differenceReason: stockDocuments.differenceReason,
      postedAt: stockDocuments.postedAt,
      createdAt: stockDocuments.createdAt,
      supplierId: stockDocuments.supplierId,
      warehouseName: warehouses.name,
      toWarehouseName: sql<string | null>`(select name from warehouses w where w.id = ${stockDocuments.toWarehouseId})`,
      supplierName: suppliers.name,
    })
    .from(stockDocuments)
    .leftJoin(warehouses, eq(stockDocuments.warehouseId, warehouses.id))
    .leftJoin(suppliers, eq(stockDocuments.supplierId, suppliers.id))
    .where(and(eq(stockDocuments.companyId, companyId), eq(stockDocuments.id, id)))
    .limit(1);
  if (!doc) return null;

  const lines = await tx
    .select({
      id: stockDocumentLines.id,
      productId: stockDocumentLines.productId,
      productName: sql<string>`coalesce(${stockDocumentLines.productName}, ${products.name})`,
      sku: sql<string | null>`coalesce(${stockDocumentLines.productSku}, ${products.sku})`,
      unitName: units.name,
      qty: stockDocumentLines.qty,
      receivedQty: stockDocumentLines.receivedQty,
      systemQty: stockDocumentLines.systemQty,
      unitCost: stockDocumentLines.unitCost,
      lineTotal: stockDocumentLines.lineTotal,
      reason: stockDocumentLines.reason,
      trackBatch: products.trackBatch,
      trackSerial: products.trackSerial,
      // S3: bentuk masukan berkemasan baris (transfer/penyesuaian)
      // dan rincian hitungan campuran (opname) — cuplikan baris,
      // nama kemasan diselesaikan langsung.
      packagingId: stockDocumentLines.packagingId,
      packagingName: productPackagings.name,
      qtyInput: stockDocumentLines.qtyInput,
      isiSnapshot: stockDocumentLines.isiSnapshot,
      countBreakdown: stockDocumentLines.countBreakdown,
    })
    .from(stockDocumentLines)
    .innerJoin(products, eq(stockDocumentLines.productId, products.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .leftJoin(productPackagings, eq(stockDocumentLines.packagingId, productPackagings.id))
    .where(
      and(eq(stockDocumentLines.companyId, companyId), eq(stockDocumentLines.documentId, id)),
    )
    .orderBy(asc(sql`coalesce(${stockDocumentLines.productName}, ${products.name})`));

  // Irisan batch per baris dari ledger gerakan dokumen ini (batch hidup
  // di gerakan, bukan di baris dokumen) — untuk detail & surat jalan.
  const movementRows = await tx
    .select({
      productId: stockMovements.productId,
      warehouseId: stockMovements.warehouseId,
      movementType: stockMovements.movementType,
      qty: stockMovements.qty,
      batchNumber: stockBatches.batchNumber,
      expiryDate: stockBatches.expiryDate,
    })
    .from(stockMovements)
    .leftJoin(stockBatches, eq(stockMovements.batchId, stockBatches.id))
    .where(
      and(
        eq(stockMovements.companyId, companyId),
        eq(stockMovements.referenceId, id),
      ),
    )
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));

  // Seri yang bergerak atas dokumen ini (kirim/terima transfer, keluar
  // penyesuaian) dari jurnal gerakan seri.
  const serialRows = await tx
    .select({
      productId: stockSerialMovements.productId,
      kind: stockSerialMovements.kind,
      serialNumber: stockSerials.serialNumber,
      status: stockSerials.status,
    })
    .from(stockSerialMovements)
    .innerJoin(stockSerials, eq(stockSerialMovements.serialId, stockSerials.id))
    .where(
      and(
        eq(stockSerialMovements.companyId, companyId),
        eq(stockSerialMovements.referenceId, id),
      ),
    )
    .orderBy(asc(stockSerialMovements.createdAt), asc(stockSerials.serialNumber));

  const journals = await listLinkedJournals(tx, companyId, id);
  return { doc, lines, movements: movementRows, serials: serialRows, journals };
}

export async function getReceiptPrintData(tx: Tx, companyId: string, id: string) {
  const [receipt] = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      date: stockReceipts.date,
      status: stockReceipts.status,
      source: stockReceipts.source,
      total: stockReceipts.total,
      paidAmount: stockReceipts.paidAmount,
      paymentStatus: stockReceipts.paymentStatus,
      paymentAccountId: stockReceipts.paymentAccountId,
      supplierInvoiceNumber: stockReceipts.supplierInvoiceNumber,
      supplierInvoiceDate: stockReceipts.supplierInvoiceDate,
      dueDate: stockReceipts.dueDate,
      priceVarianceReason: stockReceipts.priceVarianceReason,
      notes: stockReceipts.notes,
      supplierName: suppliers.name,
      warehouseName: warehouses.name,
      paymentAccountCode: accounts.code,
      paymentAccountName: accounts.name,
    })
    .from(stockReceipts)
    .leftJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .leftJoin(warehouses, eq(stockReceipts.warehouseId, warehouses.id))
    .leftJoin(accounts, eq(stockReceipts.paymentAccountId, accounts.id))
    .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.id, id)))
    .limit(1);
  if (!receipt) return null;

  const lines = await tx
    .select({
      id: stockReceiptLines.id,
      productId: stockReceiptLines.productId,
      // REM-02: snapshot nama/SKU baris, fallback nama master.
      productName: sql<string>`coalesce(${stockReceiptLines.productName}, ${products.name})`,
      sku: sql<string | null>`coalesce(${stockReceiptLines.productSku}, ${products.sku})`,
      unitName: units.name,
      qty: stockReceiptLines.qty,
      unitCost: stockReceiptLines.unitCost,
      lineTotal: stockReceiptLines.lineTotal,
      discountType: stockReceiptLines.discountType,
      discountValue: stockReceiptLines.discountValue,
      discountAmount: stockReceiptLines.discountAmount,
      // FIX-GDG Tahap 4 (GDG2-05): GRN memuat batch & kedaluwarsa
      // per baris — sebelumnya data ini hanya hidup di ledger
      // gerakan dan tidak pernah sampai ke dokumen kertas.
      batchNumber: stockReceiptLines.batchNumber,
      expiryDate: stockReceiptLines.expiryDate,
    })
    .from(stockReceiptLines)
    .innerJoin(products, eq(stockReceiptLines.productId, products.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .where(
      and(
        eq(stockReceiptLines.companyId, companyId),
        eq(stockReceiptLines.receiptId, id),
      ),
    )
    .orderBy(asc(sql`coalesce(${stockReceiptLines.productName}, ${products.name})`));

  // Nomor seri unit yang terdaftar atas penerimaan ini (GDG2-05).
  const serialRows = await tx
    .select({ productId: stockSerials.productId, serialNumber: stockSerials.serialNumber })
    .from(stockSerials)
    .where(and(eq(stockSerials.companyId, companyId), eq(stockSerials.receiptId, id)))
    .orderBy(asc(stockSerials.serialNumber));
  const serialsByProduct = new Map<string, string[]>();
  for (const row of serialRows) {
    const list = serialsByProduct.get(row.productId) ?? [];
    list.push(row.serialNumber);
    serialsByProduct.set(row.productId, list);
  }

  const [advanceRow] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${purchaseAdvanceAllocations.amount}), 0)`,
    })
    .from(purchaseAdvanceAllocations)
    .where(
      and(
        eq(purchaseAdvanceAllocations.companyId, companyId),
        eq(purchaseAdvanceAllocations.receiptId, id),
      ),
    );
  return {
    receipt: { ...receipt, advanceApplied: d(advanceRow?.amount ?? 0).toNumber() },
    lines,
    serialsByProduct,
  };
}
