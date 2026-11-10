// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  d,
  toDb,
} from "@/lib/money";
import {
  branches,
  cashMovements,
  cashSessions,
  sales,
  user,
} from "@/db/schema";

export async function getCashSessionSummary(tx: Tx, companyId: string, sessionId: string) {
  const [session] = await tx
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.companyId, companyId), eq(cashSessions.id, sessionId)))
    .limit(1);
  if (!session) return null;

  const movements = await tx
    .select()
    .from(cashMovements)
    .where(and(eq(cashMovements.companyId, companyId), eq(cashMovements.sessionId, sessionId)))
    .orderBy(desc(cashMovements.createdAt));

  const [totals] = await tx.execute(sql`
    select coalesce(sum(amount), 0) as expected,
           coalesce(sum(case when type = 'sale' then amount else 0 end), 0) as sales,
           coalesce(sum(case when type = 'refund' then amount else 0 end), 0) as refunds,
           coalesce(sum(case when type = 'deposit' then amount else 0 end), 0) as deposits,
           coalesce(sum(case when type = 'withdrawal' then amount else 0 end), 0) as withdrawals
      from cash_movements where company_id = ${companyId} and session_id = ${sessionId}
  `) as unknown as {
    expected: string;
    sales: string;
    refunds: string;
    deposits: string;
    withdrawals: string;
  }[];

  const [txCount] = await tx
    .select({ value: count() })
    .from(sales)
    .where(and(eq(sales.companyId, companyId), eq(sales.sessionId, sessionId), eq(sales.status, "completed")));

  return {
    session,
    movements,
    expected: Number(totals?.expected ?? 0),
    sales: Number(totals?.sales ?? 0),
    refunds: Number(totals?.refunds ?? 0),
    // POS-CASH-01 (D-9): mutasi deposit tersimpan negatif (kas keluar
    // laci ke bank), tetapi ringkasan melaporkannya sebagai total setor
    // ke bank bernominal positif berlabel arah. `expected` di atas tetap
    // memakai jumlah bertanda mentah dari SQL.
    deposits: Math.abs(Number(totals?.deposits ?? 0)),
    withdrawals: Math.abs(Number(totals?.withdrawals ?? 0)),
    transactionCount: txCount?.value ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* A-8.3 — riwayat sesi kasir (bagian tersendiri, mudah dibaca)        */
/* ------------------------------------------------------------------ */

export type CashSessionTotals = {
  /** Penjualan tunai (mutasi 'sale', selalu positif). */
  salesTotal: string;
  /** Refund tunai, dilaporkan positif sebagai uang keluar. */
  refundsTotal: string;
  /** Setor ke bank, dilaporkan positif sebagai uang keluar (D-9). */
  depositsTotal: string;
  /** Tarik dari bank (mutasi 'withdrawal'), uang masuk ke laci. */
  withdrawalsTotal: string;
  /** Masuk ke laci = penjualan tunai + tarik dari bank. */
  totalIn: string;
  /** Keluar dari laci = refund + setor ke bank. */
  totalOut: string;
  /** Saldo seharusnya = jumlah bertanda seluruh mutasi sesi. */
  expectedCash: string;
};

const emptySessionTotals = (): CashSessionTotals => ({
  salesTotal: "0",
  refundsTotal: "0",
  depositsTotal: "0",
  withdrawalsTotal: "0",
  totalIn: "0",
  totalOut: "0",
  expectedCash: "0",
});

/**
 * Agregasi mutasi kas per sesi langsung dari cash_movements — sumber
 * kebenaran tunggal untuk riwayat & rincian sesi, halaman tidak pernah
 * menghitung sendiri. Semantik bertanda mengikuti D-9: 'deposit'
 * (setor ke bank) tersimpan negatif karena kas laci berkurang,
 * 'withdrawal' (tarik dari bank) positif menambah laci, 'refund'
 * negatif, 'sale' dan 'opening' positif. Saldo seharusnya adalah
 * jumlah bertanda seluruh mutasi — persis angka yang dihitung
 * closeCashSession saat sesi ditutup.
 */
async function aggregateCashSessionMovements(
  tx: Tx,
  companyId: string,
  sessionIds: string[],
): Promise<Map<string, CashSessionTotals>> {
  const totals = new Map<string, CashSessionTotals>();
  if (sessionIds.length === 0) return totals;
  const rows = await tx
    .select({
      sessionId: cashMovements.sessionId,
      sales: sql<string>`coalesce(sum(case when ${cashMovements.type} = 'sale' then ${cashMovements.amount} else 0 end), 0)`,
      refunds: sql<string>`coalesce(sum(case when ${cashMovements.type} = 'refund' then ${cashMovements.amount} else 0 end), 0)`,
      deposits: sql<string>`coalesce(sum(case when ${cashMovements.type} = 'deposit' then ${cashMovements.amount} else 0 end), 0)`,
      withdrawals: sql<string>`coalesce(sum(case when ${cashMovements.type} = 'withdrawal' then ${cashMovements.amount} else 0 end), 0)`,
      total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)`,
    })
    .from(cashMovements)
    .where(and(eq(cashMovements.companyId, companyId), inArray(cashMovements.sessionId, sessionIds)))
    .groupBy(cashMovements.sessionId);
  for (const row of rows) {
    const sales = d(row.sales);
    const refunds = d(row.refunds).abs();
    const deposits = d(row.deposits).abs();
    const withdrawals = d(row.withdrawals);
    totals.set(row.sessionId, {
      salesTotal: toDb(sales),
      refundsTotal: toDb(refunds),
      depositsTotal: toDb(deposits),
      withdrawalsTotal: toDb(withdrawals),
      totalIn: toDb(sales.plus(withdrawals)),
      totalOut: toDb(refunds.plus(deposits)),
      expectedCash: toDb(d(row.total)),
    });
  }
  return totals;
}

/** Jumlah penjualan selesai (completed) per sesi — penjualan void/tertahan tidak dihitung. */
async function countSessionTransactions(
  tx: Tx,
  companyId: string,
  sessionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (sessionIds.length === 0) return counts;
  const rows = await tx
    .select({ sessionId: sales.sessionId, value: count() })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        inArray(sales.sessionId, sessionIds),
        eq(sales.status, "completed"),
      ),
    )
    .groupBy(sales.sessionId);
  for (const row of rows) {
    if (row.sessionId) counts.set(row.sessionId, row.value);
  }
  return counts;
}

const cashSessionHistoryColumns = {
  id: cashSessions.id,
  userId: cashSessions.userId,
  openedAt: cashSessions.openedAt,
  closedAt: cashSessions.closedAt,
  openingCash: cashSessions.openingCash,
  storedExpectedCash: cashSessions.expectedCash,
  countedCash: cashSessions.countedCash,
  storedDifference: cashSessions.difference,
  status: cashSessions.status,
  notes: cashSessions.notes,
  userName: user.name,
  branchName: branches.name,
};

type CashSessionHistoryRow = {
  id: string;
  userId: string;
  userName: string | null;
  branchName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  status: string;
  notes: string | null;
  openingCash: string;
  countedCash: string | null;
  storedExpectedCash: string | null;
  storedDifference: string | null;
};

function toHistoryRow(
  row: CashSessionHistoryRow,
  totals: CashSessionTotals,
  transactionCount: number,
) {
  const closed = row.status === "closed";
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    branchName: row.branchName,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    status: row.status,
    notes: row.notes,
    openingCash: row.openingCash,
    // Sesi tertutup memakai snapshot penutupan dari closeCashSession
    // (otoritatif); sesi terbuka memakai agregasi mutasi berjalan dan
    // tidak punya angka hitungan/selisih sama sekali.
    countedCash: closed ? row.countedCash : null,
    difference: closed ? row.storedDifference : null,
    ...totals,
    expectedCash:
      closed && row.storedExpectedCash != null ? row.storedExpectedCash : totals.expectedCash,
    transactionCount,
  };
}

/**
 * Daftar riwayat sesi kasir untuk halaman /app/pos/sesi/riwayat:
 * terbaru dulu, tersaring status/kasir, berpaginasi. Setiap baris
 * membawa agregat mutasi (masuk/keluar/seharusnya) hasil
 * aggregateCashSessionMovements, bukan hitungan tampilan.
 */
export async function listCashSessionHistory(
  tx: Tx,
  companyId: string,
  opts: { status?: string; userId?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  const where = and(
    eq(cashSessions.companyId, companyId),
    opts.status === "open" || opts.status === "closed"
      ? eq(cashSessions.status, opts.status)
      : undefined,
    opts.userId ? eq(cashSessions.userId, opts.userId) : undefined,
  );
  const [rows, totalRows] = await Promise.all([
    tx
      .select(cashSessionHistoryColumns)
      .from(cashSessions)
      .leftJoin(user, eq(cashSessions.userId, user.id))
      .leftJoin(branches, eq(cashSessions.branchId, branches.id))
      .where(where)
      .orderBy(desc(cashSessions.openedAt), desc(cashSessions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    tx.select({ value: count() }).from(cashSessions).where(where),
  ]);
  const ids = rows.map((row) => row.id);
  const [totalsMap, countsMap] = await Promise.all([
    aggregateCashSessionMovements(tx, companyId, ids),
    countSessionTransactions(tx, companyId, ids),
  ]);
  return {
    rows: rows.map((row) =>
      toHistoryRow(row, totalsMap.get(row.id) ?? emptySessionTotals(), countsMap.get(row.id) ?? 0),
    ),
    total: totalRows[0]?.value ?? 0,
    page,
    pageSize,
  };
}

/** Kasir yang pernah memiliki sesi — untuk pilihan saringan riwayat. */
export async function listCashSessionCashiers(tx: Tx, companyId: string) {
  return tx
    .selectDistinct({ userId: cashSessions.userId, userName: user.name })
    .from(cashSessions)
    .leftJoin(user, eq(cashSessions.userId, user.id))
    .where(eq(cashSessions.companyId, companyId))
    .orderBy(asc(user.name));
}

/**
 * Rincian satu sesi untuk /app/pos/sesi/riwayat/[id]: ringkasan sesi
 * (agregat yang sama dengan daftar) + seluruh mutasi kas kronologis
 * menaik beserta nama pelakunya.
 */
export async function getCashSessionHistoryDetail(tx: Tx, companyId: string, sessionId: string) {
  const [row] = await tx
    .select(cashSessionHistoryColumns)
    .from(cashSessions)
    .leftJoin(user, eq(cashSessions.userId, user.id))
    .leftJoin(branches, eq(cashSessions.branchId, branches.id))
    .where(and(eq(cashSessions.companyId, companyId), eq(cashSessions.id, sessionId)))
    .limit(1);
  if (!row) return null;

  const [totalsMap, countsMap, movements] = await Promise.all([
    aggregateCashSessionMovements(tx, companyId, [sessionId]),
    countSessionTransactions(tx, companyId, [sessionId]),
    tx
      .select({
        id: cashMovements.id,
        type: cashMovements.type,
        amount: cashMovements.amount,
        notes: cashMovements.notes,
        referenceType: cashMovements.referenceType,
        createdAt: cashMovements.createdAt,
        createdByName: user.name,
      })
      .from(cashMovements)
      .leftJoin(user, eq(cashMovements.createdBy, user.id))
      .where(and(eq(cashMovements.companyId, companyId), eq(cashMovements.sessionId, sessionId)))
      // createdAt saja tidak cukup urut di dalam satu transaksi —
      // id uuidv7 menjadi penentu urutan kedua yang monoton.
      .orderBy(asc(cashMovements.createdAt), asc(cashMovements.id)),
  ]);

  const historyRow = toHistoryRow(
    row,
    totalsMap.get(sessionId) ?? emptySessionTotals(),
    countsMap.get(sessionId) ?? 0,
  );
  const { salesTotal, refundsTotal, depositsTotal, withdrawalsTotal, totalIn, totalOut, expectedCash } =
    historyRow;
  return {
    session: {
      id: historyRow.id,
      userId: historyRow.userId,
      userName: historyRow.userName,
      branchName: historyRow.branchName,
      openedAt: historyRow.openedAt,
      closedAt: historyRow.closedAt,
      status: historyRow.status,
      notes: historyRow.notes,
      openingCash: historyRow.openingCash,
      countedCash: historyRow.countedCash,
      difference: historyRow.difference,
    },
    totals: { salesTotal, refundsTotal, depositsTotal, withdrawalsTotal, totalIn, totalOut, expectedCash },
    transactionCount: historyRow.transactionCount,
    movements,
  };
}
