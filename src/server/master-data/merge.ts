/**
 * SIM-2 Fase S3 — Master Data Management (§18).
 *
 * Domain operasi master data massal & pihak: bulk-edit produk
 * berpreview, deteksi duplikat, detail pihak, dan merge pihak. Semua
 * operasi tulis berjalan dalam transaksi pemanggil (aksi server),
 * tercatat di audit_log, dan tidak pernah menghapus histori dokumen.
 *
 * A-26 Q8 (K-10): berkas asal server/master-data.ts dipecah per
 * agregat ke folder ini (bulk-edit / parties / merge); master-data.ts
 * kini barrel re-export murni. Perilaku tidak berubah.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  auditLog,
  customers,
  expenses,
  partyCredits,
  partyOpeningBalances,
  partyPayments,
  products,
  purchaseAdvances,
  purchaseOrders,
  sales,
  stockDocuments,
  stockReceipts,
  supplierReturns,
  suppliers,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import Decimal from "decimal.js";
import { listPayables, listReceivables } from "@/server/reports";
import { writeAudit } from "@/server/audit";
import type { PartyBrief, PartyKind } from "./parties";

/* ------------------------------------------------------------------ */
/* Merge pihak (§18G)                                                  */
/* ------------------------------------------------------------------ */
/**
 * Peta referensi yang dipindahkan saat merge. SENGAJA tidak mencakup:
 * - `journal_lines.party_id` — baris jurnal terposting append-only
 *   (AGENTS.md: koreksi hanya lewat jurnal balik, tidak pernah
 *   update/delete), jadi tag pihak historis di jurnal tetap menunjuk
 *   record asal. Saldo subledger TIDAK dihitung dari tag jurnal —
 *   saldo dihitung dari dokumen operasional yang semuanya dipetakan
 *   di sini, sehingga saldo gabungan tetap utuh.
 * - `supplier_return_allocations` — menunjuk dokumen penerimaan/saldo
 *   awal (yang ikut berpindah), bukan pihak secara langsung.
 * - `audit_log` — jejak historis tidak ditulis ulang.
 */
type MergeReference = { key: string; label: string };

const SUPPLIER_MERGE_REFERENCES: MergeReference[] = [
  { key: "products", label: "Produk (pemasok utama)" },
  { key: "purchaseOrders", label: "Pesanan pembelian" },
  { key: "stockReceipts", label: "Penerimaan barang" },
  { key: "supplierReturns", label: "Retur pembelian" },
  { key: "stockDocuments", label: "Dokumen stok" },
  { key: "partyPayments", label: "Pembayaran utang" },
  { key: "partyOpeningBalances", label: "Dokumen saldo awal" },
  { key: "purchaseAdvances", label: "Uang muka pembelian" },
  { key: "expenses", label: "Beban/biaya terutang" },
  { key: "partyCredits", label: "Kredit pihak" },
];

const CUSTOMER_MERGE_REFERENCES: MergeReference[] = [
  { key: "sales", label: "Penjualan" },
  { key: "partyPayments", label: "Penerimaan piutang" },
  { key: "partyOpeningBalances", label: "Dokumen saldo awal" },
  { key: "partyCredits", label: "Kredit pelanggan" },
];

async function countPartyReferences(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
  partyId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (kind === "supplier") {
    const countOne = async (rows: Promise<{ value: number }[]>) => (await rows)[0]?.value ?? 0;
    counts.products = await countOne(
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.companyId, companyId), eq(products.supplierId, partyId))),
    );
    counts.purchaseOrders = await countOne(
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.supplierId, partyId))),
    );
    counts.stockReceipts = await countOne(
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockReceipts)
        .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.supplierId, partyId))),
    );
    counts.supplierReturns = await countOne(
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(supplierReturns)
        .where(and(eq(supplierReturns.companyId, companyId), eq(supplierReturns.supplierId, partyId))),
    );
    counts.stockDocuments = await countOne(
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockDocuments)
        .where(and(eq(stockDocuments.companyId, companyId), eq(stockDocuments.supplierId, partyId))),
    );
    counts.purchaseAdvances = await countOne(
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(purchaseAdvances)
        .where(and(eq(purchaseAdvances.companyId, companyId), eq(purchaseAdvances.supplierId, partyId))),
    );
    counts.expenses = await countOne(
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(expenses)
        .where(and(eq(expenses.companyId, companyId), eq(expenses.supplierId, partyId))),
    );
  } else {
    const [row] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(sales)
      .where(and(eq(sales.companyId, companyId), eq(sales.customerId, partyId)));
    counts.sales = row?.value ?? 0;
  }
  const [payments] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(partyPayments)
    .where(
      and(
        eq(partyPayments.companyId, companyId),
        eq(partyPayments.partyType, kind),
        eq(partyPayments.partyId, partyId),
      ),
    );
  counts.partyPayments = payments?.value ?? 0;
  const [openings] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.partyType, kind),
        eq(partyOpeningBalances.partyId, partyId),
      ),
    );
  counts.partyOpeningBalances = openings?.value ?? 0;
  const [credits] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(partyCredits)
    .where(
      and(
        eq(partyCredits.companyId, companyId),
        eq(partyCredits.partyType, kind),
        eq(partyCredits.partyId, partyId),
      ),
    );
  counts.partyCredits = credits?.value ?? 0;
  return counts;
}

async function partyOutstanding(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
  partyId: string,
): Promise<Decimal> {
  if (kind === "supplier") {
    return (await listPayables(tx, companyId))
      .filter((row) => row.supplierId === partyId)
      .reduce((sum, row) => sum.plus(d(row.outstanding)), d(0));
  }
  return (await listReceivables(tx, companyId))
    .filter((row) => row.customerId === partyId)
    .reduce((sum, row) => sum.plus(d(row.outstanding)), d(0));
}

async function wasMergedAway(tx: Tx, companyId: string, kind: PartyKind, partyId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, companyId),
        eq(auditLog.entityType, kind),
        eq(auditLog.entityId, partyId),
        eq(auditLog.action, "party.merged_into"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type PartyMergePreview = {
  kind: PartyKind;
  primary: PartyBrief & { outstanding: string };
  duplicate: PartyBrief & { outstanding: string };
  combinedOutstanding: string;
  references: { key: string; label: string; count: number }[];
  duplicateAlreadyMerged: boolean;
};

/** Pratinjau merge: saldo kedua pihak, saldo gabungan, dan jumlah referensi yang akan berpindah. */
export async function previewPartyMerge(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
  primaryId: string,
  duplicateId: string,
): Promise<PartyMergePreview> {
  if (primaryId === duplicateId) {
    throw new AppError("VALIDATION", "Pihak utama dan duplikat harus dua record yang berbeda.");
  }
  const table = kind === "supplier" ? suppliers : customers;
  const briefs = await tx
    .select({
      id: table.id,
      code: table.code,
      name: table.name,
      phone: table.phone,
      isActive: table.isActive,
    })
    .from(table)
    .where(and(eq(table.companyId, companyId), inArray(table.id, [primaryId, duplicateId])));
  const primary = briefs.find((row) => row.id === primaryId);
  const duplicate = briefs.find((row) => row.id === duplicateId);
  if (!primary || !duplicate) {
    throw new AppError("NOT_FOUND", "Salah satu pihak tidak ditemukan di perusahaan ini.");
  }
  const [primaryOutstanding, duplicateOutstanding, counts] = await Promise.all([
    partyOutstanding(tx, companyId, kind, primaryId),
    partyOutstanding(tx, companyId, kind, duplicateId),
    countPartyReferences(tx, companyId, kind, duplicateId),
  ]);
  const definitions = kind === "supplier" ? SUPPLIER_MERGE_REFERENCES : CUSTOMER_MERGE_REFERENCES;
  return {
    kind,
    primary: { ...primary, outstanding: primaryOutstanding.toFixed(2) },
    duplicate: { ...duplicate, outstanding: duplicateOutstanding.toFixed(2) },
    combinedOutstanding: primaryOutstanding.plus(duplicateOutstanding).toFixed(2),
    references: definitions.map((def) => ({ ...def, count: counts[def.key] ?? 0 })),
    duplicateAlreadyMerged: await wasMergedAway(tx, companyId, kind, duplicateId),
  };
}

/**
 * Gabung duplikat ke record utama dalam SATU transaksi:
 * semua referensi operasional dipetakan ulang ke utama, duplikat
 * dinonaktifkan dengan catatan penggabungan (TIDAK dihapus — histori
 * tetap ada), dan dua baris audit ditulis (di utama & di duplikat).
 * Saldo mengikuti dokumen yang berpindah, bukan dijumlahkan manual —
 * saldo gabungan pasca-merge harus sama dengan jumlah saldo sebelum.
 */
export async function mergeParties(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    kind: PartyKind;
    primaryId: string;
    duplicateId: string;
    today: string;
  },
): Promise<{ references: Record<string, number>; combinedOutstanding: string }> {
  const { companyId, kind, primaryId, duplicateId } = input;
  if (primaryId === duplicateId) {
    throw new AppError("VALIDATION", "Tidak dapat menggabungkan pihak ke dirinya sendiri.");
  }
  const table = kind === "supplier" ? suppliers : customers;
  const rows = await tx
    .select()
    .from(table)
    .where(and(eq(table.companyId, companyId), inArray(table.id, [primaryId, duplicateId])));
  const primary = rows.find((row) => row.id === primaryId);
  const duplicate = rows.find((row) => row.id === duplicateId);
  if (!primary || !duplicate) {
    throw new AppError("NOT_FOUND", "Salah satu pihak tidak ditemukan di perusahaan ini.");
  }
  if (await wasMergedAway(tx, companyId, kind, duplicateId)) {
    throw new AppError("INVALID_STATE", "Pihak duplikat ini sudah pernah digabungkan ke pihak lain.");
  }
  if (await wasMergedAway(tx, companyId, kind, primaryId)) {
    throw new AppError("INVALID_STATE", "Pihak utama yang dipilih sudah pernah digabungkan ke pihak lain.");
  }

  const primaryOutstandingBefore = await partyOutstanding(tx, companyId, kind, primaryId);
  const duplicateOutstandingBefore = await partyOutstanding(tx, companyId, kind, duplicateId);
  const outstandingBefore = primaryOutstandingBefore.plus(duplicateOutstandingBefore);

  const references: Record<string, number> = {};
  if (kind === "supplier") {
    references.products = (
      await tx
        .update(products)
        .set({ supplierId: primaryId })
        .where(and(eq(products.companyId, companyId), eq(products.supplierId, duplicateId)))
        .returning({ id: products.id })
    ).length;
    references.purchaseOrders = (
      await tx
        .update(purchaseOrders)
        .set({ supplierId: primaryId })
        .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.supplierId, duplicateId)))
        .returning({ id: purchaseOrders.id })
    ).length;
    references.stockReceipts = (
      await tx
        .update(stockReceipts)
        .set({ supplierId: primaryId })
        .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.supplierId, duplicateId)))
        .returning({ id: stockReceipts.id })
    ).length;
    references.supplierReturns = (
      await tx
        .update(supplierReturns)
        .set({ supplierId: primaryId })
        .where(and(eq(supplierReturns.companyId, companyId), eq(supplierReturns.supplierId, duplicateId)))
        .returning({ id: supplierReturns.id })
    ).length;
    references.stockDocuments = (
      await tx
        .update(stockDocuments)
        .set({ supplierId: primaryId })
        .where(and(eq(stockDocuments.companyId, companyId), eq(stockDocuments.supplierId, duplicateId)))
        .returning({ id: stockDocuments.id })
    ).length;
    references.purchaseAdvances = (
      await tx
        .update(purchaseAdvances)
        .set({ supplierId: primaryId })
        .where(and(eq(purchaseAdvances.companyId, companyId), eq(purchaseAdvances.supplierId, duplicateId)))
        .returning({ id: purchaseAdvances.id })
    ).length;
    references.expenses = (
      await tx
        .update(expenses)
        .set({ supplierId: primaryId })
        .where(and(eq(expenses.companyId, companyId), eq(expenses.supplierId, duplicateId)))
        .returning({ id: expenses.id })
    ).length;
  } else {
    const updated = await tx
      .update(sales)
      .set({ customerId: primaryId })
      .where(and(eq(sales.companyId, companyId), eq(sales.customerId, duplicateId)))
      .returning({ id: sales.id });
    references.sales = updated.length;
  }
  const paymentRows = await tx
    .update(partyPayments)
    .set({ partyId: primaryId })
    .where(
      and(
        eq(partyPayments.companyId, companyId),
        eq(partyPayments.partyType, kind),
        eq(partyPayments.partyId, duplicateId),
      ),
    )
    .returning({ id: partyPayments.id });
  references.partyPayments = paymentRows.length;
  const openingRows = await tx
    .update(partyOpeningBalances)
    .set({ partyId: primaryId })
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.partyType, kind),
        eq(partyOpeningBalances.partyId, duplicateId),
      ),
    )
    .returning({ id: partyOpeningBalances.id });
  references.partyOpeningBalances = openingRows.length;
  const creditRows = await tx
    .update(partyCredits)
    .set({ partyId: primaryId })
    .where(
      and(
        eq(partyCredits.companyId, companyId),
        eq(partyCredits.partyType, kind),
        eq(partyCredits.partyId, duplicateId),
      ),
    )
    .returning({ id: partyCredits.id });
  references.partyCredits = creditRows.length;

  const marker = `[Digabung ke ${primary.name} (${primary.code}) pada ${input.today}]`;
  const mergedNotes = duplicate.notes ? `${duplicate.notes}\n${marker}` : marker;
  await tx
    .update(table)
    .set({ isActive: false, notes: mergedNotes })
    .where(and(eq(table.companyId, companyId), eq(table.id, duplicateId)));

  const outstandingAfter = await partyOutstanding(tx, companyId, kind, primaryId);
  if (!outstandingAfter.eq(outstandingBefore)) {
    // Transaksi pemanggil akan rollback: saldo gabungan WAJIB utuh.
    throw new AppError(
      "INTERNAL",
      `Saldo sesudah merge (${outstandingAfter.toFixed(2)}) tidak sama dengan jumlah saldo sebelum (${outstandingBefore.toFixed(2)}). Penggabungan dibatalkan.`,
    );
  }

  await writeAudit(tx, {
    companyId,
    userId: input.userId,
    action: "party.merge",
    entityType: kind,
    entityId: primaryId,
    before: {
      duplicate: { id: duplicate.id, code: duplicate.code, name: duplicate.name },
      primaryOutstanding: primaryOutstandingBefore.toFixed(2),
      duplicateOutstanding: duplicateOutstandingBefore.toFixed(2),
    },
    after: {
      primaryId,
      duplicateId,
      references,
      combinedOutstanding: outstandingAfter.toFixed(2),
    },
  });
  await writeAudit(tx, {
    companyId,
    userId: input.userId,
    action: "party.merged_into",
    entityType: kind,
    entityId: duplicateId,
    after: { primaryId, primaryCode: primary.code, primaryName: primary.name },
  });

  return { references, combinedOutstanding: outstandingAfter.toFixed(2) };
}
