// A-24 Tahap T4B: bagian dari pemecahan src/server/supplier-returns.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/supplier-returns.ts.

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  journalEntries,
  partyOpeningBalances,
  productPackagings,
  products,
  stockBatches,
  stockReceipts,
  supplierReturnLines,
  supplierReturnResolutions,
  supplierReturns,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";
import {
  d,
  toDb,
} from "@/lib/money";
import { normalizePageParams, pageOffset, pageResult } from "@/lib/pagination";
import { listPaymentAccounts } from "@/server/accounting";
import { listOpenPayableDocs, listOpenPayableDocsForSuppliers } from "./payables";
import type { OpenPayableDoc } from "./payables";

export async function getSupplierReturnDetail(tx: Tx, companyId: string, returnId: string) {
  const [header] = await tx
    .select()
    .from(supplierReturns)
    .where(and(eq(supplierReturns.companyId, companyId), eq(supplierReturns.id, returnId)))
    .limit(1);
  if (!header) return null;
  const lines = await tx
    .select({
      id: supplierReturnLines.id,
      productId: supplierReturnLines.productId,
      // REM-02: snapshot nama baris retur, fallback nama master.
      productName: sql<string>`coalesce(${supplierReturnLines.productName}, ${products.name})`,
      qty: supplierReturnLines.qty,
      unitCost: supplierReturnLines.unitCost,
      lineTotal: supplierReturnLines.lineTotal,
      batchId: supplierReturnLines.batchId,
      receiptLineId: supplierReturnLines.receiptLineId,
      replacedQty: supplierReturnLines.replacedQty,
      // S2: bentuk masukan berkemasan baris (nama kemasan diselesaikan
      // langsung; faktor & qty masukan adalah cuplikan baris).
      packagingId: supplierReturnLines.packagingId,
      packagingName: productPackagings.name,
      qtyInput: supplierReturnLines.qtyInput,
      isiSnapshot: supplierReturnLines.isiSnapshot,
    })
    .from(supplierReturnLines)
    .innerJoin(products, eq(supplierReturnLines.productId, products.id))
    .leftJoin(productPackagings, eq(supplierReturnLines.packagingId, productPackagings.id))
    .where(
      and(
        eq(supplierReturnLines.companyId, companyId),
        eq(supplierReturnLines.returnId, header.id),
      ),
    )
    .orderBy(asc(supplierReturnLines.id));
  const resolutions = await tx
    .select()
    .from(supplierReturnResolutions)
    .where(
      and(
        eq(supplierReturnResolutions.companyId, companyId),
        eq(supplierReturnResolutions.returnId, header.id),
      ),
    )
    .orderBy(asc(supplierReturnResolutions.createdAt));
  return { ...header, lines, resolutions };
}

export async function listSupplierReturns(
  tx: Tx,
  companyId: string,
  opts: { supplierId?: string; status?: string } = {},
) {
  return tx
    .select({
      id: supplierReturns.id,
      number: supplierReturns.number,
      date: supplierReturns.date,
      status: supplierReturns.status,
      reasonCategory: supplierReturns.reasonCategory,
      resolutionType: supplierReturns.resolutionType,
      totalValue: supplierReturns.totalValue,
      creditAmount: supplierReturns.creditAmount,
      resolvedAmount: supplierReturns.resolvedAmount,
      supplierId: supplierReturns.supplierId,
      supplierName: suppliers.name,
      warehouseId: supplierReturns.warehouseId,
    })
    .from(supplierReturns)
    .leftJoin(suppliers, eq(supplierReturns.supplierId, suppliers.id))
    .where(
      and(
        eq(supplierReturns.companyId, companyId),
        opts.supplierId ? eq(supplierReturns.supplierId, opts.supplierId) : sql`true`,
        opts.status ? eq(supplierReturns.status, opts.status) : sql`true`,
      ),
    )
    .orderBy(asc(supplierReturns.date), asc(supplierReturns.number));
}

/**
 * RET-2 (UI): paginated variant of listSupplierReturns for the Gudang
 * list page — newest first, with the warehouse name joined in. Read-only.
 */
export async function listSupplierReturnsPage(
  tx: Tx,
  companyId: string,
  opts: { supplierId?: string; status?: string; page?: number; pageSize?: number } = {},
) {
  const { page, pageSize } = normalizePageParams(opts, 40);
  const filters = and(
    eq(supplierReturns.companyId, companyId),
    opts.supplierId ? eq(supplierReturns.supplierId, opts.supplierId) : sql`true`,
    opts.status ? eq(supplierReturns.status, opts.status) : sql`true`,
  );
  const [countRow] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(supplierReturns)
    .where(filters);
  const rows = await tx
    .select({
      id: supplierReturns.id,
      number: supplierReturns.number,
      date: supplierReturns.date,
      status: supplierReturns.status,
      reasonCategory: supplierReturns.reasonCategory,
      resolutionType: supplierReturns.resolutionType,
      totalValue: supplierReturns.totalValue,
      creditAmount: supplierReturns.creditAmount,
      resolvedAmount: supplierReturns.resolvedAmount,
      supplierId: supplierReturns.supplierId,
      supplierName: suppliers.name,
      warehouseId: supplierReturns.warehouseId,
      warehouseName: warehouses.name,
    })
    .from(supplierReturns)
    .leftJoin(suppliers, eq(supplierReturns.supplierId, suppliers.id))
    .leftJoin(warehouses, eq(supplierReturns.warehouseId, warehouses.id))
    .where(filters)
    .orderBy(desc(supplierReturns.date), desc(supplierReturns.number))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));
  return pageResult(rows, countRow?.value ?? 0, page, pageSize);
}

/**
 * RET-2 (UI): the supplier's open payable documents with their document
 * numbers, oldest first — the target picker for "Terapkan ke Utang".
 * Same underlying bookkeeping as the posting allocation (allocations
 * netted out), so a document shown here can always absorb the picked
 * amount. Read-only.
 */
type OpenPayableDocNumbers = {
  receiptNumbers: Map<string, string>;
  openingInfo: Map<string, { number: string; reference: string | null }>;
};

/** Nomor dokumen untuk sekumpulan dokumen utang terbuka (2 kueri IN). */
async function loadOpenPayableDocNumbers(
  tx: Tx,
  companyId: string,
  docs: OpenPayableDoc[],
): Promise<OpenPayableDocNumbers> {
  const receiptIds = docs.filter((doc) => doc.kind === "receipt").map((doc) => doc.id);
  const openingIds = docs.filter((doc) => doc.kind === "opening").map((doc) => doc.id);
  const receiptNumbers = new Map<string, string>();
  if (receiptIds.length > 0) {
    const rows = await tx
      .select({ id: stockReceipts.id, number: stockReceipts.number })
      .from(stockReceipts)
      .where(and(eq(stockReceipts.companyId, companyId), inArray(stockReceipts.id, receiptIds)));
    for (const row of rows) receiptNumbers.set(row.id, row.number);
  }
  const openingInfo = new Map<string, { number: string; reference: string | null }>();
  if (openingIds.length > 0) {
    const rows = await tx
      .select({
        id: partyOpeningBalances.id,
        number: partyOpeningBalances.number,
        reference: partyOpeningBalances.reference,
      })
      .from(partyOpeningBalances)
      .where(
        and(
          eq(partyOpeningBalances.companyId, companyId),
          inArray(partyOpeningBalances.id, openingIds),
        ),
      );
    for (const row of rows) openingInfo.set(row.id, { number: row.number, reference: row.reference });
  }
  return { receiptNumbers, openingInfo };
}

function withOpenPayableDocNumbers(docs: OpenPayableDoc[], numbers: OpenPayableDocNumbers) {
  return docs.map((doc) => ({
    kind: doc.kind,
    id: doc.id,
    number:
      doc.kind === "receipt"
        ? (numbers.receiptNumbers.get(doc.id) ?? null)
        : (numbers.openingInfo.get(doc.id)?.number ?? null),
    reference: doc.kind === "opening" ? (numbers.openingInfo.get(doc.id)?.reference ?? null) : null,
    date: doc.date,
    total: toDb(doc.total),
    paid: toDb(doc.paid),
    allocated: toDb(doc.allocated),
    outstanding: toDb(doc.outstanding),
  }));
}

export async function listSupplierOpenPayableDocs(
  tx: Tx,
  companyId: string,
  supplierId: string,
) {
  const docs = await listOpenPayableDocs(tx, companyId, supplierId);
  return withOpenPayableDocNumbers(docs, await loadOpenPayableDocNumbers(tx, companyId, docs));
}

/**
 * A-26 Q1b (I-01): varian batch listSupplierOpenPayableDocs untuk
 * banyak pemasok — dokumen dari listOpenPayableDocsForSuppliers dan
 * nomor dokumennya dimuat sekali untuk semua pemasok. Hasil per
 * pemasok IDENTIK dengan varian satu pemasok.
 */
export async function listSupplierOpenPayableDocsForSuppliers(
  tx: Tx,
  companyId: string,
  supplierIds: string[],
) {
  const bySupplier = await listOpenPayableDocsForSuppliers(tx, companyId, supplierIds);
  const allDocs = [...bySupplier.values()].flat();
  const numbers = await loadOpenPayableDocNumbers(tx, companyId, allDocs);
  const result = new Map<string, ReturnType<typeof withOpenPayableDocNumbers>>();
  for (const [supplierId, docs] of bySupplier) {
    result.set(supplierId, withOpenPayableDocNumbers(docs, numbers));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman (FIX-ARS Tahap 6, ARS1-01): rakitan baca halaman
// detail & cetak retur yang dulu inline kini tinggal di modul ini; badan
// kueri dipindah apa adanya — urutan dan bentuk hasil tidak berubah.
// ---------------------------------------------------------------------------

async function lookupPartyName(
  tx: Tx,
  companyId: string,
  table: typeof suppliers | typeof warehouses,
  id: string,
) {
  const [row] = await tx
    .select({ name: table.name })
    .from(table)
    .where(and(eq(table.companyId, companyId), eq(table.id, id)))
    .limit(1);
  return row?.name ?? null;
}

async function loadBatchMap(tx: Tx, companyId: string, batchIds: string[]) {
  const batchById = new Map<string, { batchNumber: string | null; expiryDate: string | null }>();
  if (batchIds.length > 0) {
    const rows = await tx
      .select({ id: stockBatches.id, batchNumber: stockBatches.batchNumber, expiryDate: stockBatches.expiryDate })
      .from(stockBatches)
      .where(and(eq(stockBatches.companyId, companyId), inArray(stockBatches.id, batchIds)));
    for (const row of rows) batchById.set(row.id, { batchNumber: row.batchNumber, expiryDate: row.expiryDate });
  }
  return batchById;
}

export async function getSupplierReturnPageData(tx: Tx, companyId: string, returnId: string) {
  const detail = await getSupplierReturnDetail(tx, companyId, returnId);
  if (!detail) return null;

  const supplierName = await lookupPartyName(tx, companyId, suppliers, detail.supplierId);
  const warehouseName = await lookupPartyName(tx, companyId, warehouses, detail.warehouseId);

  const batchIds = detail.lines.map((line) => line.batchId).filter((v): v is string => Boolean(v));
  const batchById = await loadBatchMap(tx, companyId, batchIds);

  const productIds = [...new Set(detail.lines.map((line) => line.productId))];
  const trackBatchById = new Map<string, boolean>();
  const skuById = new Map<string, string>();
  if (productIds.length > 0) {
    const rows = await tx
      .select({ id: products.id, trackBatch: products.trackBatch, sku: products.sku })
      .from(products)
      .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
    for (const row of rows) {
      trackBatchById.set(row.id, row.trackBatch);
      skuById.set(row.id, row.sku);
    }
  }

  // Jurnal posting retur ini (+ jurnal pembaliknya bila dibatalkan).
  const [postingJournal] = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.sourceType, "supplier_return"),
        eq(journalEntries.sourceId, detail.id),
        eq(journalEntries.status, "posted"),
      ),
    )
    .orderBy(asc(journalEntries.createdAt))
    .limit(1);
  let reversalJournal: { id: string; number: string } | undefined;
  if (postingJournal) {
    const [reversal] = await tx
      .select({ id: journalEntries.id, number: journalEntries.number })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.reversalOfId, postingJournal.id),
        ),
      )
      .limit(1);
    reversalJournal = reversal;
  }

  // Nomor jurnal & nama akun untuk riwayat penyelesaian.
  const resolutionJournalIds = detail.resolutions
    .map((row) => row.journalId)
    .filter((v): v is string => Boolean(v));
  const journalNumberById = new Map<string, string>();
  if (resolutionJournalIds.length > 0) {
    const rows = await tx
      .select({ id: journalEntries.id, number: journalEntries.number })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.id, resolutionJournalIds)));
    for (const row of rows) journalNumberById.set(row.id, row.number);
  }
  const refundAccountIds = detail.resolutions
    .map((row) => row.accountId)
    .filter((v): v is string => Boolean(v));
  const accountNameById = new Map<string, string>();
  if (refundAccountIds.length > 0) {
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), inArray(accounts.id, refundAccountIds)));
    for (const row of rows) accountNameById.set(row.id, `${row.code} — ${row.name}`);
  }

  const remaining = d(detail.creditAmount).minus(d(detail.resolvedAmount));
  const resolvable =
    (detail.status === "posted" || detail.status === "partially_resolved") && remaining.gt(0);

  let openPayables: Awaited<ReturnType<typeof listSupplierOpenPayableDocs>> = [];
  let paymentAccounts: Awaited<ReturnType<typeof listPaymentAccounts>> = [];
  if (resolvable) {
    openPayables = await listSupplierOpenPayableDocs(tx, companyId, detail.supplierId);
    paymentAccounts = await listPaymentAccounts(tx, companyId);
  }

  return {
    detail,
    supplierName,
    warehouseName,
    batchById,
    trackBatchById,
    skuById,
    postingJournal: postingJournal ?? null,
    reversalJournal: reversalJournal ?? null,
    journalNumberById,
    accountNameById,
    remaining,
    resolvable,
    openPayables,
    paymentAccounts,
  };
}

export async function getSupplierReturnPrintData(tx: Tx, companyId: string, returnId: string) {
  const detail = await getSupplierReturnDetail(tx, companyId, returnId);
  if (!detail) return null;

  const supplierName = await lookupPartyName(tx, companyId, suppliers, detail.supplierId);
  const warehouseName = await lookupPartyName(tx, companyId, warehouses, detail.warehouseId);

  const productIds = [...new Set(detail.lines.map((line) => line.productId))];
  const productInfo = new Map<string, { sku: string; unitName: string | null }>();
  if (productIds.length > 0) {
    const rows = await tx
      .select({ id: products.id, sku: products.sku, unitName: units.name })
      .from(products)
      .leftJoin(units, eq(products.unitId, units.id))
      .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
    for (const row of rows) productInfo.set(row.id, { sku: row.sku, unitName: row.unitName });
  }
  const batchIds = detail.lines.map((line) => line.batchId).filter((v): v is string => Boolean(v));
  const batchById = await loadBatchMap(tx, companyId, batchIds);

  return {
    detail,
    supplierName,
    warehouseName,
    productInfo,
    batchById,
  };
}
