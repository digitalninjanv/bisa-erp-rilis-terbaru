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

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  auditLog,
  customers,
  partyOpeningBalances,
  partyPayments,
  purchaseOrders,
  sales,
  stockReceipts,
  supplierReturns,
  suppliers,
} from "@/db/schema";
import { d } from "@/lib/money";
import { listPayables, listReceivables } from "@/server/reports";

/* ------------------------------------------------------------------ */
/* Deteksi duplikat pihak (§18G)                                       */
/* ------------------------------------------------------------------ */

export type PartyKind = "supplier" | "customer";

export type PartyBrief = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  isActive: boolean;
};

export type DuplicatePair = {
  kind: PartyKind;
  a: PartyBrief;
  b: PartyBrief;
  /** Skor kemiripan nama pg_trgm 0..1 (1 = sama persis). */
  nameSimilarity: number;
  reasons: string[];
};

export type SimilarPartyMatch = PartyBrief & {
  nameSimilarity: number;
  reasons: string[];
};

const DUPLICATE_NAME_THRESHOLD = 0.45;
const WARNING_NAME_THRESHOLD = 0.5;

/** Normalisasi telepon untuk perbandingan: hanya digit, tanpa awalan negara. */
function phoneKey(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits;
}

function phonesMatch(a: string | null, b: string | null): boolean {
  const keyA = phoneKey(a);
  const keyB = phoneKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  // Awalan negara vs lokal: 62812… vs 0812… — cocokkan 9 digit terakhir.
  if (keyA.length >= 9 && keyB.length >= 9) {
    return keyA.slice(-9) === keyB.slice(-9);
  }
  return false;
}

type PartyRowForDuplicates = PartyBrief & { taxId?: string | null };

async function loadPartiesForDuplicates(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
): Promise<PartyRowForDuplicates[]> {
  if (kind === "supplier") {
    return tx
      .select({
        id: suppliers.id,
        code: suppliers.code,
        name: suppliers.name,
        phone: suppliers.phone,
        isActive: suppliers.isActive,
        taxId: suppliers.taxId,
      })
      .from(suppliers)
      .where(eq(suppliers.companyId, companyId))
      .orderBy(asc(suppliers.name));
  }
  return tx
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      isActive: customers.isActive,
      taxId: customers.taxId,
    })
    .from(customers)
    .where(eq(customers.companyId, companyId))
    .orderBy(asc(customers.name));
}

/**
 * Kemiripan nama berpasangan lewat pg_trgm dalam SATU kueri self-join
 * (bukan satu round-trip per pasangan): similarity() dihitung di
 * database; pasangan di bawah ambang longgar 0.3 dibuang di SQL —
 * pasangan yang cocok hanya karena telepon/NPWP tetap diambil lewat
 * daftar id eksplisit di pemanggil bila diperlukan.
 */
async function nameSimilarities(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const rows = (await tx.execute(
    kind === "supplier"
      ? sql`
          select a.id as a_id, b.id as b_id, similarity(a.name, b.name) as sim
          from suppliers a
          join suppliers b on b.company_id = a.company_id and a.id < b.id
          where a.company_id = ${companyId}`
      : sql`
          select a.id as a_id, b.id as b_id, similarity(a.name, b.name) as sim
          from customers a
          join customers b on b.company_id = a.company_id and a.id < b.id
          where a.company_id = ${companyId}`,
  )) as unknown as { a_id: string; b_id: string; sim: number }[];
  for (const row of rows) {
    result.set(`${row.a_id}|${row.b_id}`, Number(row.sim ?? 0));
  }
  return result;
}

function taxIdsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
  const taxA = norm(a);
  const taxB = norm(b);
  return taxA.length >= 15 && taxA === taxB;
}

/**
 * Panel "Kemungkinan duplikat": pasangan pihak yang namanya sangat
 * mirip (trigram), teleponnya sama, atau NPWP-nya sama. Murni membaca —
 * tidak mengubah data apa pun; penggabungan adalah langkah terpisah
 * (merge) yang dipilih pengguna.
 */
export async function findPartyDuplicates(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
): Promise<DuplicatePair[]> {
  const rows = await loadPartiesForDuplicates(tx, companyId, kind);
  if (rows.length < 2) return [];
  const similarities = await nameSimilarities(tx, companyId, kind);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      const sim = similarities.get(`${a.id}|${b.id}`) ?? 0;
      const reasons: string[] = [];
      if (sim >= DUPLICATE_NAME_THRESHOLD) {
        reasons.push(`Nama mirip (${Math.round(sim * 100)}%)`);
      }
      if (phonesMatch(a.phone, b.phone)) reasons.push("Nomor telepon sama");
      if (taxIdsMatch(a.taxId, b.taxId)) reasons.push("NPWP sama");
      if (reasons.length === 0) continue;
      pairs.push({
        kind,
        a: { id: a.id, code: a.code, name: a.name, phone: a.phone, isActive: a.isActive },
        b: { id: b.id, code: b.code, name: b.name, phone: b.phone, isActive: b.isActive },
        nameSimilarity: sim,
        reasons,
      });
    }
  }
  return pairs.sort((x, y) => y.nameSimilarity - x.nameSimilarity);
}

/**
 * Peringatan lembut saat membuat/mengubah pihak: pihak lain yang
 * namanya sangat mirip atau kontaknya sama. Mengembalikan daftar —
 * pemanggil yang memutuskan menampilkan peringatan; TIDAK memblokir.
 */
export async function findSimilarParties(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
  input: { name: string; phone?: string | null; taxId?: string | null; excludeId?: string },
): Promise<SimilarPartyMatch[]> {
  const rows = await loadPartiesForDuplicates(tx, companyId, kind);
  const candidates = rows.filter((row) => row.id !== input.excludeId);
  // Kemiripan nama untuk semua kandidat dalam satu kueri.
  const simRows = (await tx.execute(
    kind === "supplier"
      ? sql`select id, similarity(name, ${input.name}) as sim from suppliers where company_id = ${companyId}`
      : sql`select id, similarity(name, ${input.name}) as sim from customers where company_id = ${companyId}`,
  )) as unknown as { id: string; sim: number }[];
  const simById = new Map(simRows.map((row) => [row.id, Number(row.sim ?? 0)]));
  const matches: SimilarPartyMatch[] = [];
  for (const candidate of candidates) {
    const sim = simById.get(candidate.id) ?? 0;
    const reasons: string[] = [];
    if (sim >= WARNING_NAME_THRESHOLD) reasons.push(`Nama mirip (${Math.round(sim * 100)}%)`);
    if (phonesMatch(input.phone ?? null, candidate.phone)) reasons.push("Nomor telepon sama");
    if (taxIdsMatch(input.taxId, candidate.taxId)) reasons.push("NPWP sama");
    if (reasons.length === 0) continue;
    matches.push({
      id: candidate.id,
      code: candidate.code,
      name: candidate.name,
      phone: candidate.phone,
      isActive: candidate.isActive,
      nameSimilarity: sim,
      reasons,
    });
  }
  return matches.sort((x, y) => y.nameSimilarity - x.nameSimilarity);
}

/* ------------------------------------------------------------------ */
/* Detail pihak (§18D)                                                 */
/* ------------------------------------------------------------------ */

export type PartyDetail = {
  kind: PartyKind;
  party: PartyRowForDuplicates & {
    email: string | null;
    address: string | null;
    notes: string | null;
    creditLimit?: string;
    creditLimitUnlimited?: boolean;
    groupId?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankAccountName?: string | null;
    paymentTermDays?: number | null;
    createdAt: Date;
  };
  /** Saldo berjalan dari subledger yang sama dengan daftar Piutang/Utang. */
  outstanding: string;
  /** Khusus pemasok: sisa klaim Kredit Pemasok dari retur terposting. */
  supplierCreditRemaining: string | null;
  receipts: {
    id: string;
    number: string;
    date: string;
    total: string;
    paidAmount: string;
    paymentStatus: string;
    status: string;
  }[];
  purchaseOrders: { id: string; number: string; date: string; total: string; status: string }[];
  supplierReturns: { id: string; number: string; date: string; totalValue: string; status: string }[];
  sales: {
    id: string;
    number: string;
    date: string;
    total: string;
    paidTotal: string;
    paymentStatus: string;
    status: string;
  }[];
  payments: { id: string; number: string; date: string; amount: string; status: string; type: string }[];
  openings: {
    id: string;
    number: string;
    date: string;
    dueDate: string | null;
    amount: string;
    paidAmount: string;
    status: string;
    kind: string;
  }[];
  auditTrail: {
    id: string;
    action: string;
    userId: string | null;
    before: unknown;
    after: unknown;
    createdAt: Date;
  }[];
};

const HISTORY_LIMIT = 50;

export async function getPartyDetail(
  tx: Tx,
  companyId: string,
  kind: PartyKind,
  partyId: string,
): Promise<PartyDetail | null> {
  const isSupplier = kind === "supplier";
  const [party] = isSupplier
    ? await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.companyId, companyId), eq(suppliers.id, partyId)))
        .limit(1)
    : await tx
        .select()
        .from(customers)
        .where(and(eq(customers.companyId, companyId), eq(customers.id, partyId)))
        .limit(1);
  if (!party) return null;

  // Saldo diambil dari fungsi subledger yang sama persis dengan halaman
  // Piutang/Utang global, disaring ke pihak ini — saldo detail tidak
  // mungkin berbeda dari saldo daftar menurut konstruksinya.
  const outstanding = isSupplier
    ? (await listPayables(tx, companyId))
        .filter((row) => row.supplierId === partyId)
        .reduce((sum, row) => sum.plus(d(row.outstanding)), d(0))
    : (await listReceivables(tx, companyId))
        .filter((row) => row.customerId === partyId)
        .reduce((sum, row) => sum.plus(d(row.outstanding)), d(0));

  let supplierCreditRemaining: string | null = null;
  if (isSupplier) {
    const returns = await tx
      .select({ creditAmount: supplierReturns.creditAmount, resolvedAmount: supplierReturns.resolvedAmount })
      .from(supplierReturns)
      .where(
        and(
          eq(supplierReturns.companyId, companyId),
          eq(supplierReturns.supplierId, partyId),
          inArray(supplierReturns.status, ["posted", "partially_resolved", "resolved"]),
        ),
      );
    supplierCreditRemaining = returns
      .reduce((sum, row) => sum.plus(d(row.creditAmount)).minus(d(row.resolvedAmount)), d(0))
      .toFixed(2);
  }

  const receipts = isSupplier
    ? await tx
        .select({
          id: stockReceipts.id,
          number: stockReceipts.number,
          date: stockReceipts.date,
          total: stockReceipts.total,
          paidAmount: stockReceipts.paidAmount,
          paymentStatus: stockReceipts.paymentStatus,
          status: stockReceipts.status,
        })
        .from(stockReceipts)
        .where(and(eq(stockReceipts.companyId, companyId), eq(stockReceipts.supplierId, partyId)))
        .orderBy(desc(stockReceipts.date), desc(stockReceipts.createdAt))
        .limit(HISTORY_LIMIT)
    : [];
  const purchaseOrdersRows = isSupplier
    ? await tx
        .select({
          id: purchaseOrders.id,
          number: purchaseOrders.number,
          date: purchaseOrders.date,
          total: purchaseOrders.total,
          status: purchaseOrders.status,
        })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.supplierId, partyId)))
        .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.createdAt))
        .limit(HISTORY_LIMIT)
    : [];
  const supplierReturnRows = isSupplier
    ? await tx
        .select({
          id: supplierReturns.id,
          number: supplierReturns.number,
          date: supplierReturns.date,
          totalValue: supplierReturns.totalValue,
          status: supplierReturns.status,
        })
        .from(supplierReturns)
        .where(and(eq(supplierReturns.companyId, companyId), eq(supplierReturns.supplierId, partyId)))
        .orderBy(desc(supplierReturns.date), desc(supplierReturns.createdAt))
        .limit(HISTORY_LIMIT)
    : [];
  const saleRows = !isSupplier
    ? await tx
        .select({
          id: sales.id,
          number: sales.number,
          date: sales.date,
          total: sales.total,
          paidTotal: sales.paidTotal,
          paymentStatus: sales.paymentStatus,
          status: sales.status,
        })
        .from(sales)
        .where(and(eq(sales.companyId, companyId), eq(sales.customerId, partyId)))
        .orderBy(desc(sales.date), desc(sales.createdAt))
        .limit(HISTORY_LIMIT)
    : [];
  const paymentRows = await tx
    .select({
      id: partyPayments.id,
      number: partyPayments.number,
      date: partyPayments.date,
      amount: partyPayments.amount,
      status: partyPayments.status,
      type: partyPayments.type,
    })
    .from(partyPayments)
    .where(
      and(
        eq(partyPayments.companyId, companyId),
        eq(partyPayments.partyType, kind),
        eq(partyPayments.partyId, partyId),
      ),
    )
    .orderBy(desc(partyPayments.date), desc(partyPayments.createdAt))
    .limit(HISTORY_LIMIT);
  const openingRows = await tx
    .select({
      id: partyOpeningBalances.id,
      number: partyOpeningBalances.number,
      date: partyOpeningBalances.date,
      dueDate: partyOpeningBalances.dueDate,
      amount: partyOpeningBalances.amount,
      paidAmount: partyOpeningBalances.paidAmount,
      status: partyOpeningBalances.status,
      kind: partyOpeningBalances.kind,
    })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.partyType, kind),
        eq(partyOpeningBalances.partyId, partyId),
      ),
    )
    .orderBy(desc(partyOpeningBalances.date), desc(partyOpeningBalances.createdAt))
    .limit(HISTORY_LIMIT);
  const auditRows = await tx
    .select({
      id: auditLog.id,
      action: auditLog.action,
      userId: auditLog.userId,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, companyId),
        eq(auditLog.entityType, kind),
        eq(auditLog.entityId, partyId),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(HISTORY_LIMIT);

  return {
    kind,
    party: party as PartyDetail["party"],
    outstanding: outstanding.toFixed(2),
    supplierCreditRemaining,
    receipts,
    purchaseOrders: purchaseOrdersRows,
    supplierReturns: supplierReturnRows,
    sales: saleRows,
    payments: paymentRows,
    openings: openingRows,
    auditTrail: auditRows,
  };
}

/* ------------------------------------------------------------------ */
/* Merge pihak (§18G)                                                  */
