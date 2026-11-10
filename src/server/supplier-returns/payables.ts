// A-24 Tahap T4B: bagian dari pemecahan src/server/supplier-returns.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/supplier-returns.ts.

import {
  and,
  asc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  partyOpeningBalances,
  stockReceipts,
  supplierReturnAllocations,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  d,
  toDb,
  type Decimal,
} from "@/lib/money";
import { DecimalMin } from "./shared";

/** Σ return allocations settled against one payable document. */
export async function sumReturnAllocations(
  tx: Tx,
  companyId: string,
  target: { receiptId?: string; openingId?: string },
): Promise<Decimal> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${supplierReturnAllocations.amount}), 0)` })
    .from(supplierReturnAllocations)
    .where(
      and(
        eq(supplierReturnAllocations.companyId, companyId),
        target.receiptId
          ? eq(supplierReturnAllocations.receiptId, target.receiptId)
          : eq(supplierReturnAllocations.openingId, target.openingId!),
      ),
    );
  return d(row?.total ?? "0");
}

export type OpenPayableDoc = {
  kind: "receipt" | "opening";
  id: string;
  date: string;
  total: Decimal;
  paid: Decimal;
  allocated: Decimal;
  outstanding: Decimal;
  /** PPN Masukan yang dibekukan di penerimaan (0 untuk saldo awal &
   * penerimaan tanpa PPN) — dasar reversi proporsional saat retur. */
  taxAmount: Decimal;
};

/**
 * The supplier's open payable documents, oldest first, with return
 * allocations netted out. This is the single definition of "utang
 * terbuka pemasok": posted credit purchases (total − payments −
 * return allocations) plus open opening-balance payables (amount −
 * payments − return allocations). Cash purchases and non-purchase
 * receipts never appear (D-5).
 */
type OpenPayableReceiptRow = {
  id: string;
  date: string;
  createdAt: Date;
  total: string;
  paidAmount: string;
  taxAmount: string;
};

type OpenPayableOpeningRow = {
  id: string;
  date: string;
  createdAt: Date;
  amount: string;
  paidAmount: string;
};

/**
 * Perakitan murni dokumen utang terbuka dari baris penerimaan &
 * saldo awal: sisa (total − dibayar − alokasi retur) > 0 saja,
 * digabung lalu diurutkan (tanggal, waktu buat). `allocatedByDoc`
 * berkunci "receipt:<id>" / "opening:<id>". Dipakai bersama oleh
 * varian satu pemasok dan varian batch agar semantiknya sama.
 */
function assembleOpenPayableDocs(
  receipts: OpenPayableReceiptRow[],
  openings: OpenPayableOpeningRow[],
  allocatedByDoc: Map<string, Decimal>,
): OpenPayableDoc[] {
  const docs: (OpenPayableDoc & { createdAt: Date })[] = [];
  for (const receipt of receipts) {
    const allocated = allocatedByDoc.get(`receipt:${receipt.id}`) ?? d(0);
    const outstanding = d(receipt.total).minus(d(receipt.paidAmount)).minus(allocated);
    if (outstanding.gt(0)) {
      docs.push({
        kind: "receipt",
        id: receipt.id,
        date: receipt.date,
        createdAt: receipt.createdAt,
        total: d(receipt.total),
        paid: d(receipt.paidAmount),
        allocated,
        outstanding,
        taxAmount: d(receipt.taxAmount),
      });
    }
  }
  for (const opening of openings) {
    const allocated = allocatedByDoc.get(`opening:${opening.id}`) ?? d(0);
    const outstanding = d(opening.amount).minus(d(opening.paidAmount)).minus(allocated);
    if (outstanding.gt(0)) {
      docs.push({
        kind: "opening",
        id: opening.id,
        date: opening.date,
        createdAt: opening.createdAt,
        total: d(opening.amount),
        paid: d(opening.paidAmount),
        allocated,
        outstanding,
        taxAmount: d(0),
      });
    }
  }
  docs.sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return docs.map((doc) => ({
    kind: doc.kind,
    id: doc.id,
    date: doc.date,
    total: doc.total,
    paid: doc.paid,
    allocated: doc.allocated,
    outstanding: doc.outstanding,
    taxAmount: doc.taxAmount,
  }));
}

export async function listOpenPayableDocs(
  tx: Tx,
  companyId: string,
  supplierId: string,
): Promise<OpenPayableDoc[]> {
  const receipts = await tx
    .select({
      id: stockReceipts.id,
      date: stockReceipts.date,
      createdAt: stockReceipts.createdAt,
      total: stockReceipts.total,
      paidAmount: stockReceipts.paidAmount,
      taxAmount: stockReceipts.taxAmount,
    })
    .from(stockReceipts)
    .where(
      and(
        eq(stockReceipts.companyId, companyId),
        eq(stockReceipts.supplierId, supplierId),
        eq(stockReceipts.status, "posted"),
        eq(stockReceipts.source, "purchase"),
        sql`${stockReceipts.paymentAccountId} is null`,
      ),
    )
    .orderBy(asc(stockReceipts.date), asc(stockReceipts.createdAt));
  const openings = await tx
    .select({
      id: partyOpeningBalances.id,
      date: partyOpeningBalances.date,
      createdAt: partyOpeningBalances.createdAt,
      amount: partyOpeningBalances.amount,
      paidAmount: partyOpeningBalances.paidAmount,
    })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.kind, "payable"),
        eq(partyOpeningBalances.partyId, supplierId),
        eq(partyOpeningBalances.status, "open"),
      ),
    )
    .orderBy(asc(partyOpeningBalances.date), asc(partyOpeningBalances.createdAt));

  const allocatedByDoc = new Map<string, Decimal>();
  for (const receipt of receipts) {
    allocatedByDoc.set(
      `receipt:${receipt.id}`,
      await sumReturnAllocations(tx, companyId, { receiptId: receipt.id }),
    );
  }
  for (const opening of openings) {
    allocatedByDoc.set(
      `opening:${opening.id}`,
      await sumReturnAllocations(tx, companyId, { openingId: opening.id }),
    );
  }
  return assembleOpenPayableDocs(receipts, openings, allocatedByDoc);
}

/**
 * Σ alokasi retur untuk BANYAK dokumen sekaligus — satu kueri
 * GROUP BY (pasangan batch sumReturnAllocations; jumlah per dokumen
 * identik dengan menjumlah per dokumen satu per satu).
 */
async function sumReturnAllocationsForDocs(
  tx: Tx,
  companyId: string,
  receiptIds: string[],
  openingIds: string[],
): Promise<Map<string, Decimal>> {
  const allocatedByDoc = new Map<string, Decimal>();
  if (receiptIds.length === 0 && openingIds.length === 0) return allocatedByDoc;
  const targets = [
    ...(receiptIds.length > 0
      ? [inArray(supplierReturnAllocations.receiptId, receiptIds)]
      : []),
    ...(openingIds.length > 0
      ? [inArray(supplierReturnAllocations.openingId, openingIds)]
      : []),
  ];
  const rows = await tx
    .select({
      receiptId: supplierReturnAllocations.receiptId,
      openingId: supplierReturnAllocations.openingId,
      total: sql<string>`coalesce(sum(${supplierReturnAllocations.amount}), 0)`,
    })
    .from(supplierReturnAllocations)
    .where(and(eq(supplierReturnAllocations.companyId, companyId), or(...targets)))
    .groupBy(supplierReturnAllocations.receiptId, supplierReturnAllocations.openingId);
  for (const row of rows) {
    if (row.receiptId) allocatedByDoc.set(`receipt:${row.receiptId}`, d(row.total));
    if (row.openingId) allocatedByDoc.set(`opening:${row.openingId}`, d(row.total));
  }
  return allocatedByDoc;
}

/**
 * A-26 Q1b (I-01): varian batch listOpenPayableDocs untuk banyak
 * pemasok sekaligus — 3 kueri total (penerimaan + saldo awal dengan
 * IN, alokasi retur satu GROUP BY), bukan 2+ kueri per pemasok
 * ditambah satu kueri alokasi per dokumen. Hasil per pemasok
 * IDENTIK dengan listOpenPayableDocs satu per satu (urutan kueri &
 * perakit murninya sama). Pemasok tanpa dokumen memetakan ke [].
 */
export async function listOpenPayableDocsForSuppliers(
  tx: Tx,
  companyId: string,
  supplierIds: string[],
): Promise<Map<string, OpenPayableDoc[]>> {
  const result = new Map<string, OpenPayableDoc[]>();
  if (supplierIds.length === 0) return result;
  const receipts = await tx
    .select({
      supplierId: stockReceipts.supplierId,
      id: stockReceipts.id,
      date: stockReceipts.date,
      createdAt: stockReceipts.createdAt,
      total: stockReceipts.total,
      paidAmount: stockReceipts.paidAmount,
      taxAmount: stockReceipts.taxAmount,
    })
    .from(stockReceipts)
    .where(
      and(
        eq(stockReceipts.companyId, companyId),
        inArray(stockReceipts.supplierId, supplierIds),
        eq(stockReceipts.status, "posted"),
        eq(stockReceipts.source, "purchase"),
        sql`${stockReceipts.paymentAccountId} is null`,
      ),
    )
    .orderBy(asc(stockReceipts.date), asc(stockReceipts.createdAt));
  const openings = await tx
    .select({
      partyId: partyOpeningBalances.partyId,
      id: partyOpeningBalances.id,
      date: partyOpeningBalances.date,
      createdAt: partyOpeningBalances.createdAt,
      amount: partyOpeningBalances.amount,
      paidAmount: partyOpeningBalances.paidAmount,
    })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.kind, "payable"),
        inArray(partyOpeningBalances.partyId, supplierIds),
        eq(partyOpeningBalances.status, "open"),
      ),
    )
    .orderBy(asc(partyOpeningBalances.date), asc(partyOpeningBalances.createdAt));

  const allocatedByDoc = await sumReturnAllocationsForDocs(
    tx,
    companyId,
    receipts.map((row) => row.id),
    openings.map((row) => row.id),
  );
  const receiptsBySupplier = new Map<string, OpenPayableReceiptRow[]>();
  for (const row of receipts) {
    if (!row.supplierId) continue;
    const { supplierId, ...rest } = row;
    const list = receiptsBySupplier.get(supplierId) ?? [];
    list.push(rest);
    receiptsBySupplier.set(supplierId, list);
  }
  const openingsBySupplier = new Map<string, OpenPayableOpeningRow[]>();
  for (const row of openings) {
    const { partyId, ...rest } = row;
    const list = openingsBySupplier.get(partyId) ?? [];
    list.push(rest);
    openingsBySupplier.set(partyId, list);
  }
  for (const supplierId of supplierIds) {
    result.set(
      supplierId,
      assembleOpenPayableDocs(
        receiptsBySupplier.get(supplierId) ?? [],
        openingsBySupplier.get(supplierId) ?? [],
        allocatedByDoc,
      ),
    );
  }
  return result;
}

/** Total open payable of one supplier (see listOpenPayableDocs). */
export async function getSupplierOpenPayable(
  tx: Tx,
  companyId: string,
  supplierId: string,
): Promise<Decimal> {
  const docs = await listOpenPayableDocs(tx, companyId, supplierId);
  return docs.reduce((acc, doc) => acc.plus(doc.outstanding), d(0));
}

/** Re-derive a receipt's paymentStatus from payments + return allocations. */
export async function refreshReceiptPaymentStatus(
  tx: Tx,
  companyId: string,
  receiptId: string,
): Promise<void> {
  const [receipt] = await tx
    .select({
      total: stockReceipts.total,
      paidAmount: stockReceipts.paidAmount,
      source: stockReceipts.source,
      paymentAccountId: stockReceipts.paymentAccountId,
    })
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.id, receiptId)))
    .limit(1);
  if (!receipt) return;
  // Only credit purchases carry a payable lifecycle (D-5).
  if (receipt.source !== "purchase" || receipt.paymentAccountId) return;
  const allocated = await sumReturnAllocations(tx, companyId, { receiptId });
  const settled = d(receipt.paidAmount).plus(allocated);
  const status = settled.gte(d(receipt.total)) ? "paid" : settled.gt(0) ? "partial" : "unpaid";
  await tx
    .update(stockReceipts)
    .set({ paymentStatus: status })
    .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.id, receiptId)));
}

/** Re-derive an opening payable's status from payments + allocations. */
export async function refreshOpeningPayableStatus(
  tx: Tx,
  companyId: string,
  openingId: string,
): Promise<void> {
  const [doc] = await tx
    .select({
      amount: partyOpeningBalances.amount,
      paidAmount: partyOpeningBalances.paidAmount,
      status: partyOpeningBalances.status,
    })
    .from(partyOpeningBalances)
    .where(and(eq(partyOpeningBalances.companyId, companyId), eq(partyOpeningBalances.id, openingId)))
    .limit(1);
  if (!doc || doc.status === "void") return;
  const allocated = await sumReturnAllocations(tx, companyId, { openingId });
  const settled = d(doc.paidAmount).plus(allocated);
  await tx
    .update(partyOpeningBalances)
    .set({ status: settled.gte(d(doc.amount)) ? "settled" : "open" })
    .where(and(eq(partyOpeningBalances.companyId, companyId), eq(partyOpeningBalances.id, openingId)));
}

/**
 * Settle `amount` of a return against the supplier's open payables:
 * writes allocation rows (one explicit target, or oldest-first) and
 * refreshes each touched document's status. Callers validate the amount
 * against the outstanding first; the final guard here keeps the books
 * honest if the payable moved underneath us.
 */
export async function allocateReturnToPayables(
  tx: Tx,
  input: {
    companyId: string;
    returnId: string;
    supplierId: string;
    amount: Decimal;
    targetReceiptId?: string;
    targetOpeningId?: string;
  },
): Promise<void> {
  let remaining = input.amount;
  const docs = await listOpenPayableDocs(tx, input.companyId, input.supplierId);
  const targets = input.targetReceiptId
    ? docs.filter((doc) => doc.kind === "receipt" && doc.id === input.targetReceiptId)
    : input.targetOpeningId
      ? docs.filter((doc) => doc.kind === "opening" && doc.id === input.targetOpeningId)
      : docs;
  if (input.targetReceiptId || input.targetOpeningId) {
    if (targets.length === 0) {
      throw new AppError(
        "VALIDATION",
        "Dokumen utang tujuan tidak ditemukan atau sudah lunas untuk pemasok ini.",
      );
    }
    if (targets[0].outstanding.lt(remaining)) {
      throw new AppError(
        "VALIDATION",
        `Nominal melebihi sisa utang dokumen tujuan (${targets[0].outstanding.toFixed(0)}).`,
      );
    }
  }
  for (const doc of targets) {
    if (remaining.lte(0)) break;
    const take = DecimalMin(doc.outstanding, remaining);
    await tx.insert(supplierReturnAllocations).values({
      companyId: input.companyId,
      returnId: input.returnId,
      receiptId: doc.kind === "receipt" ? doc.id : null,
      openingId: doc.kind === "opening" ? doc.id : null,
      amount: toDb(take),
    });
    if (doc.kind === "receipt") {
      await refreshReceiptPaymentStatus(tx, input.companyId, doc.id);
    } else {
      await refreshOpeningPayableStatus(tx, input.companyId, doc.id);
    }
    remaining = remaining.minus(take);
  }
  if (remaining.gt(0)) {
    throw new AppError(
      "VALIDATION",
      "Nominal melebihi total utang terbuka pemasok saat ini.",
    );
  }
}
