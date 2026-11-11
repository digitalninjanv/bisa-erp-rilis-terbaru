// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: penyelesaian refund retur (alokasi tender asal POS1-06 +
// resolusi akun/sesi D-8) dipisah dari returns.ts.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashSessions, journalEntries, journalLines, partyPayments, paymentMethods, salePayments, saleReturns } from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  D,
  d,
  toDb,
  type Decimal,
} from "@/lib/money";
import { getAccountMap } from "@/server/accounting";
import type { SaleRow } from "./sales-void";;

export type CreateSaleReturnInput = {
  companyId: string;
  userId: string;
  saleId: string;
  date: string;
  reason: string;
  refundMethod: "cash" | "transfer" | "store_credit" | "exchange";
  type: "return" | "exchange";
  lines: {
    productId: string;
    qty: string | number;
    /**
     * Program Satuan Kemasan S4: baris penjualan ASAL yang dituju.
     * Bila terisi, `qty` dinyatakan dalam BENTUK MASUKAN baris asal
     * itu ("1" = 1 Dus untuk baris Dus) dan dikonversi memakai
     * isi_snapshot baris asal — bukan master hari ini. Bila kosong
     * (pemanggil warisan), `qty` adalah qty SATUAN DASAR yang
     * dialokasikan FIFO ke baris-baris asal produk itu.
     */
    saleLineId?: string | null;
  }[];
};


export type RefundSettlement = {
  credits: { accountId: string; amount: Decimal; description: string }[];
  cashSettled: Decimal;
  creditRestored: Decimal;
  originSettled: Decimal;
};

/**
 * POS1-06: alokasi penyelesaian kelebihan retur TUNAI mengikuti
 * komposisi penerimaan penjualan asal. Uang hanya boleh keluar dari
 * laci sebesar porsi TUNAI yang benar-benar diterima penjualan itu;
 * porsi yang dibayar dengan Kredit Pelanggan kembali menjadi kredit
 * (memulihkan credit_used dokumen retur asal — pola voidSale), dan
 * porsi non-tunai lain (QRIS/transfer/dll.) kembali ke akun metode
 * asalnya. Kolam per akun = pembayaran asal (sale_payments, di luar
 * metode kredit/utang) + penerimaan piutang (party_payments posted),
 * dikurangi penyelesaian retur-retur posted sebelumnya yang dibaca
 * dari jurnalnya — sehingga plafon berlaku kumulatif lintas retur.
 * Sisa yang tidak terpetakan ke kolam mana pun menolak retur (fail
 * closed) daripada mengarang saluran keluar.
 */


async function allocateCashRefundSettlement(
  tx: Tx,
  input: { companyId: string; saleId: string; map: Record<string, string>; excess: Decimal },
): Promise<RefundSettlement> {
  const { map } = input;
  const tenderRows = await tx
    .select({
      amount: salePayments.amount,
      accountId: paymentMethods.accountId,
      type: paymentMethods.type,
      reference: salePayments.reference,
    })
    .from(salePayments)
    .innerJoin(paymentMethods, eq(salePayments.methodId, paymentMethods.id))
    .where(eq(salePayments.saleId, input.saleId));
  const receiptRows = await tx
    .select({ amount: partyPayments.amount, accountId: partyPayments.accountId })
    .from(partyPayments)
    .where(
      and(
        eq(partyPayments.companyId, input.companyId),
        eq(partyPayments.saleId, input.saleId),
        eq(partyPayments.type, "receivable"),
        eq(partyPayments.status, "posted"),
      ),
    );

  const poolByAccount = new Map<string, Decimal>();
  const addToPool = (accountId: string | null, amount: Decimal) => {
    if (!accountId) return;
    poolByAccount.set(accountId, (poolByAccount.get(accountId) ?? d(0)).plus(amount));
  };
  const cashAccountIds = new Set<string>();
  if (map.cash) cashAccountIds.add(map.cash);
  const creditPayments: { reference: string; amount: Decimal }[] = [];
  for (const tender of tenderRows) {
    // Metode "credit" adalah piutang itu sendiri — porsinya sudah
    // ditangani potongan piutang (offsetPortion), bukan kolam refund.
    if (tender.type === "credit") continue;
    addToPool(tender.accountId, d(tender.amount));
    if (tender.type === "cash" && tender.accountId) cashAccountIds.add(tender.accountId);
    if (tender.type === "customer_credit") {
      creditPayments.push({ reference: tender.reference?.trim() ?? "", amount: d(tender.amount) });
    }
  }
  for (const receipt of receiptRows) {
    addToPool(receipt.accountId, d(receipt.amount));
  }

  // Penyelesaian retur sebelumnya per akun, dari jurnal retur posted
  // penjualan ini (kredit ke akun kolam saja yang dihitung; kredit ke
  // piutang adalah offset dan ke diskon/HPP bukan saluran penerimaan).
  const settledByAccount = new Map<string, Decimal>();
  const priorReturns = await tx
    .select({ id: saleReturns.id })
    .from(saleReturns)
    .where(
      and(
        eq(saleReturns.companyId, input.companyId),
        eq(saleReturns.saleId, input.saleId),
        eq(saleReturns.status, "posted"),
      ),
    );
  if (priorReturns.length > 0) {
    const settledRows = await tx
      .select({ accountId: journalLines.accountId, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.companyId, input.companyId),
          eq(journalEntries.sourceType, "sale_return"),
          inArray(
            journalEntries.sourceId,
            priorReturns.map((row) => row.id),
          ),
          eq(journalEntries.status, "posted"),
        ),
      );
    for (const row of settledRows) {
      if (!poolByAccount.has(row.accountId)) continue;
      settledByAccount.set(row.accountId, (settledByAccount.get(row.accountId) ?? d(0)).plus(d(row.credit)));
    }
  }
  const available = (accountId: string) =>
    D.max((poolByAccount.get(accountId) ?? d(0)).minus(settledByAccount.get(accountId) ?? d(0)), d(0));

  const credits: RefundSettlement["credits"] = [];
  let remaining = input.excess;
  let cashSettled = d(0);
  let creditRestored = d(0);
  let originSettled = d(0);

  // (a) Tunai — hanya sebesar porsi tunai yang masih tersedia.
  const orderedCashAccounts = [
    ...(map.cash ? [map.cash] : []),
    ...[...cashAccountIds].filter((id) => id !== map.cash),
  ];
  for (const accountId of orderedCashAccounts) {
    if (remaining.lte(0)) break;
    const take = D.min(remaining, available(accountId));
    if (take.lte(0)) continue;
    credits.push({ accountId, amount: take, description: "Pengembalian dana tunai" });
    cashSettled = cashSettled.plus(take);
    remaining = remaining.minus(take);
  }

  // (b) Kredit Pelanggan — pulihkan kredit dokumen retur asal yang
  // ditebus penjualan ini (baris dikunci terurut per id, pola kunci
  // yang sama dengan createSale/voidSale), lalu kreditkan kembali ke
  // liabilitas Kredit pelanggan sebesar yang benar-benar terpulihkan.
  const creditAccountId = map.customer_credit;
  if (remaining.gt(0) && creditAccountId && creditPayments.length > 0) {
    const restoreBudget = D.min(
      remaining,
      available(creditAccountId),
      creditPayments.reduce((acc, p) => acc.plus(p.amount), d(0)),
    );
    if (restoreBudget.gt(0)) {
      const numbers = [...new Set(creditPayments.map((p) => p.reference).filter(Boolean))];
      const candidates = await tx
        .select({ id: saleReturns.id, number: saleReturns.number })
        .from(saleReturns)
        .where(and(eq(saleReturns.companyId, input.companyId), inArray(saleReturns.number, numbers)));
      const sortedIds = [...new Set(candidates.map((row) => row.id))].sort();
      const lockedByNumber = new Map<string, { id: string; creditUsed: Decimal }>();
      for (const id of sortedIds) {
        const [locked] = await tx
          .select({ id: saleReturns.id, number: saleReturns.number, creditUsed: saleReturns.creditUsed })
          .from(saleReturns)
          .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.id, id)))
          .limit(1)
          .for("update");
        if (locked) lockedByNumber.set(locked.number, { id: locked.id, creditUsed: d(locked.creditUsed) });
      }
      let budget = restoreBudget;
      for (const payment of creditPayments) {
        if (budget.lte(0)) break;
        const locked = lockedByNumber.get(payment.reference);
        if (!locked) continue;
        const restore = D.min(payment.amount, locked.creditUsed, budget);
        if (restore.lte(0)) continue;
        locked.creditUsed = locked.creditUsed.minus(restore);
        await tx
          .update(saleReturns)
          .set({ creditUsed: toDb(locked.creditUsed) })
          .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.id, locked.id)));
        creditRestored = creditRestored.plus(restore);
        budget = budget.minus(restore);
      }
      if (creditRestored.gt(0)) {
        credits.push({
          accountId: creditAccountId,
          amount: creditRestored,
          description: "Pemulihan kredit pelanggan",
        });
        remaining = remaining.minus(creditRestored);
      }
    }
  }

  // (c) Non-tunai lain — kembali ke akun metode asalnya.
  for (const accountId of poolByAccount.keys()) {
    if (remaining.lte(0)) break;
    if (cashAccountIds.has(accountId) || accountId === creditAccountId) continue;
    const take = D.min(remaining, available(accountId));
    if (take.lte(0)) continue;
    credits.push({ accountId, amount: take, description: "Pengembalian dana ke akun metode asal" });
    originSettled = originSettled.plus(take);
    remaining = remaining.minus(take);
  }

  if (remaining.gt(0)) {
    throw new AppError(
      "VALIDATION",
      `Refund tunai tidak dapat diproses: sebagian nilai retur (Rp${remaining.toFixed(0)}) tidak berasal dari penerimaan tunai, kredit pelanggan, atau metode asal penjualan ini. Proses retur dengan metode Kredit Pelanggan agar penyelesaian mengikuti tender asal.`,
    );
  }

  return { credits, cashSettled, creditRestored, originSettled };
}


/**
 * FIX-ARS Tahap 4: fase dari createSaleReturn — badan dipindah apa adanya;
 * resolusi penyelesaian kelebihan SEBELUM dokumen ditulis
 * (D-8/POS-RET-02 + POS1-06) — akun penyelesaian per metode,
 * alokasi tender asal untuk refund tunai, sesi kas pemroses.
 */


export async function resolveReturnSettlement(
  tx: Tx,
  input: CreateSaleReturnInput,
  sale: SaleRow,
  map: Awaited<ReturnType<typeof getAccountMap>>,
  excessPortion: Decimal,
) {
  // D-8 / POS-RET-02: resolve the settlement BEFORE writing the document.
  // Exchange and store credit are settled into the customer-credit liability
  // (mapping key "customer_credit") — never cash, never the receivable
  // account (a cash sale has no receivable to credit; doing so fabricated a
  // negative receivable). The mapping is mandatory: guessing a fallback
  // account would silently misstate the liability.
  // FIX-P1: penyelesaian metode terpilih hanya berlaku untuk KELEBIHAN
  // di atas potongan piutang (excessPortion) — porsi pemotong piutang
  // tidak memerlukan akun penyelesaian maupun sesi kas.
  let settleAccount: string;
  let refundSessionId: string | null = null;
  // POS1-06: baris kredit penyelesaian kelebihan — untuk refund tunai
  // diisi alokasi mengikuti tender asal (bisa lebih dari satu akun);
  // metode lain tetap satu baris ke akun penyelesaiannya.
  let settlementCredits: RefundSettlement["credits"] = [];
  let cashSettled = d(0);
  let creditRestored = d(0);
  let originSettled = d(0);
  if (input.refundMethod === "transfer") {
    settleAccount = map.bank;
  } else if (input.refundMethod === "store_credit" || input.refundMethod === "exchange") {
    const creditAccountId = map.customer_credit;
    if (!creditAccountId && excessPortion.gt(0)) {
      throw new AppError(
        "VALIDATION",
        'Akun untuk "customer_credit" belum dipetakan di Pengaturan. Atur pemetaan Kredit pelanggan terlebih dahulu.',
      );
    }
    // Tanpa kelebihan, tidak ada baris penyelesaian yang terbit, jadi
    // akun ini tidak pernah dipakai — nilai cadangan apa pun aman.
    settleAccount = creditAccountId ?? map.receivable;
  } else {
    settleAccount = map.cash;
    if (excessPortion.gt(0)) {
      // POS1-06: refund tunai mengikuti tender asal — alokasi dapat
      // menghasilkan nol tunai (penjualan non-tunai), dan hanya porsi
      // tunai nyatalah yang memerlukan sesi kas pemroses.
      const allocation = await allocateCashRefundSettlement(tx, {
        companyId: input.companyId,
        saleId: sale.id,
        map,
        excess: excessPortion,
      });
      settlementCredits = allocation.credits;
      cashSettled = allocation.cashSettled;
      creditRestored = allocation.creditRestored;
      originSettled = allocation.originSettled;
      if (cashSettled.gt(0)) {
        // Cash refunds leave the drawer of the session the PROCESSING cashier
        // currently has open — not the origin sale's session, which may
        // already be closed (writing into it would rewrite a closed session).
        const [openSession] = await tx
          .select({ id: cashSessions.id })
          .from(cashSessions)
          .where(
            and(
              eq(cashSessions.companyId, input.companyId),
              eq(cashSessions.userId, input.userId),
              eq(cashSessions.status, "open"),
            ),
          )
          .orderBy(sql`${cashSessions.openedAt} DESC`)
          .limit(1)
          .for("update");
        if (!openSession) {
          throw new AppError(
            "VALIDATION",
            "Buka sesi kasir terlebih dahulu untuk memproses refund tunai.",
          );
        }
        refundSessionId = openSession.id;
      }
    }
  }
  return { settleAccount, refundSessionId, settlementCredits, cashSettled, creditRestored, originSettled };
}
