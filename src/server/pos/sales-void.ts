// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: pembatalan penjualan (voidSale) + fase pemulihannya.

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashMovements, cashSessions, journalEntries, partyPayments, paymentMethods, saleLines, salePayments, saleReturns, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { D, d, toDb } from "@/lib/money";
import { reverseJournalEntry } from "@/server/accounting";
import { reverseSourceJournalPreferringDate } from "@/server/accounting-reversal";
import { writeAudit } from "@/server/audit";
import { applyStockMovement } from "@/server/inventory";
import { restoreReservationForVoidSale } from "@/server/reservations";
import { restoreSerialsForSale, serialTrackFlags } from "@/server/serials";
import { todayISO } from "@/lib/format";
import { restorePartyCreditUsage, voidOriginPartyCredit } from "@/server/party-credits";
import { batchTrackFlags, restoreSaleLineBatches, trackStockFlags } from "./sales-stock";

export async function voidSale(tx: Tx, input: VoidSaleInput) {
  const sale = await loadVoidableSale(tx, input);

  await restoreVoidedSaleStock(tx, input, sale);

  await reverseSourceJournalPreferringDate(tx, {
    companyId: input.companyId,
    sourceType: "sale",
    sourceId: sale.id,
    originalDate: String(sale.date).slice(0, 10),
    description: `Void penjualan ${sale.number}`,
    createdBy: input.userId,
  });

  const { reversedArTotal, reversedArCount } = await reverseVoidedSaleReceivables(tx, input, sale);

  const { refundSessionId, refundSessionSource } = await recordVoidCashRefund(tx, input, sale);

  await restoreVoidedSaleCredit(tx, input, sale);

  // POS-005: Pulihkan alokasi reservasi yang pernah dikonsumsi saat checkout penjualan ini
  await restoreReservationForVoidSale(tx, {
    companyId: input.companyId,
    userId: input.userId,
    saleId: sale.id,
    saleNumber: sale.number,
  });

  // FIX-P1 (AK3-01): paidTotal diturunkan sebesar penerimaan piutang
  // yang baru dibatalkan di atas, dan paymentStatus dihitung ulang —
  // bidang dokumen tidak boleh lagi menyatakan uang diterima dari
  // pembayaran yang jurnalnya sudah dibalik.
  const settledAfterVoid = d(sale.paidTotal).minus(reversedArTotal);
  await tx
    .update(sales)
    .set({
      status: "void",
      voidedAt: new Date(),
      voidedBy: input.userId,
      voidReason: input.reason,
      paidTotal: toDb(settledAfterVoid),
      paymentStatus: settledAfterVoid.gte(d(sale.total))
        ? "paid"
        : settledAfterVoid.gt(0)
          ? "partial"
          : "unpaid",
    })
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, sale.id)));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.void",
    entityType: "sale",
    entityId: sale.id,
    before: { status: sale.status, total: sale.total },
    after: {
      status: "void",
      reason: input.reason,
      // FIX-P1 (AK3-01): penerimaan piutang yang ikut dibatalkan.
      reversedReceivablePayments: reversedArCount,
      reversedReceivableTotal: toDb(reversedArTotal),
      // T3R-2: setiap refund tunai yang berhasil di-void sudah tercatat
      // pada sesi kas terbuka; bila tidak ada sesi yang sah, void gagal.
      refundSessionId,
      refundSessionSource,
    },
  });
}


export type VoidSaleInput = { companyId: string; userId: string; saleId: string; reason: string };


export type SaleRow = typeof sales.$inferSelect;

/**
 * FIX-ARS Tahap 4: fase dari voidSale — badan dipindah apa adanya;
 * muat & kunci penjualan, tegakkan syarat void (alasan, status,
 * dan larangan T4R-1: penjualan ber-retur posted tidak dapat
 * di-void).
 */


async function loadVoidableSale(tx: Tx, input: VoidSaleInput) {
  if (!input.reason.trim()) throw new AppError("VALIDATION", "Alasan void wajib diisi.");
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, input.saleId)))
    .limit(1)
    .for("update");
  if (!sale) throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.");
  if (sale.status === "void") throw new AppError("INVALID_STATE", "Transaksi sudah dibatalkan.");
  if (sale.status === "held") throw new AppError("INVALID_STATE", "Pesanan ditahan tidak bisa di-void; hapus pesanan.");
  if (sale.status !== "completed") throw new AppError("INVALID_STATE", "Hanya transaksi selesai yang bisa di-void.");

  // T4R-1 (review Tahap 4, P1): penjualan yang sudah memiliki retur
  // posted TIDAK boleh di-void. Retur itu sudah memulihkan stok dan
  // membalik jurnal penjualan untuk porsinya — void di sini memulihkan
  // stok dan membalik jurnal secara PENUH, sehingga porsi retur
  // terhitung dua kali, dan kredit toko/tukar dari retur akan tetap
  // bisa ditebus untuk penjualan yang sudah tidak ada. Domain tidak
  // memiliki jalur void retur (retur posted bersifat final dan tidak
  // pernah berubah status), jadi keberadaan retur posted adalah
  // predikat penghalangnya — tidak ada keadaan "retur sudah di-void
  // semua" yang bisa membuka void penjualan.
  const postedReturns = await tx
    .select({ id: saleReturns.id, number: saleReturns.number })
    .from(saleReturns)
    .where(
      and(
        eq(saleReturns.companyId, input.companyId),
        eq(saleReturns.saleId, sale.id),
        eq(saleReturns.status, "posted"),
      ),
    );
  if (postedReturns.length > 0) {
    throw new AppError(
      "VALIDATION",
      `Penjualan ini tidak dapat di-void karena sudah memiliki retur yang terposting (${postedReturns
        .map((row) => row.number)
        .join(", ")}). Retur yang terposting tidak dapat dibatalkan, dan void penjualan akan ` +
        "menggandakan pemulihan stok serta pembalikan jurnal untuk porsi yang sudah diretur. " +
        "Koreksi penjualan ini hanya dapat dilakukan lewat retur sampai seluruh barang kembali.",
    );
  }
  return sale;
}

/**
 * FIX-ARS Tahap 4: fase dari voidSale — badan dipindah apa adanya;
 * pulihkan stok per baris — seri kembali, batch kembali ke batch
 * asalnya, sisanya gerakan masuk sale_return.
 */


async function restoreVoidedSaleStock(tx: Tx, input: VoidSaleInput, sale: SaleRow) {
  const lines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, sale.id));

  const lineProductIds = [...new Set(lines.map((line) => line.productId))];
  const trackStock = await trackStockFlags(tx, input.companyId, lineProductIds, sale.id);
  const trackBatch = await batchTrackFlags(tx, input.companyId, lineProductIds, sale.id);
  const trackSerial = await serialTrackFlags(tx, input.companyId, lineProductIds, sale.id);

  for (const line of lines) {
    // Service/non-stock lines were never moved out at checkout, so there is
    // nothing to move back on void.
    if (trackStock.get(line.productId) === false) continue;
    if (trackSerial.get(line.productId)) {
      // SIM-2 S7B-2 Batch 5: seri yang keluar oleh penjualan ini kembali.
      await restoreSerialsForSale(tx, {
        companyId: input.companyId,
        userId: input.userId,
        saleId: sale.id,
        productId: line.productId,
        warehouseId: sale.warehouseId,
        referenceType: "sale_void",
        referenceId: sale.id,
        referenceNumber: sale.number,
      });
    }
    if (trackBatch.get(line.productId)) {
      // Batch-tracked lines go back onto the batches the sale drew from.
      await restoreSaleLineBatches(tx, {
        companyId: input.companyId,
        userId: input.userId,
        warehouseId: sale.warehouseId,
        productId: line.productId,
        saleId: sale.id,
        referenceNumber: sale.number,
        qty: d(line.qty),
        unitCost: line.unitCost,
        referenceType: "sale_void",
        referenceId: sale.id,
        reason: input.reason,
        date: todayISO(),
      });
      continue;
    }
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: sale.warehouseId,
      productId: line.productId,
      delta: d(line.qty),
      unitCost: line.unitCost,
      movementType: "sale_return",
      referenceType: "sale_void",
      referenceId: sale.id,
      referenceNumber: sale.number,
      reason: input.reason,
      userId: input.userId,
      allowNegative: true,
      date: todayISO(),
    });
  }
}

/**
 * FIX-ARS Tahap 4: fase dari voidSale — badan dipindah apa adanya;
 * balik jurnal penerimaan piutang satu per satu (AK3-01) dan
 * tandai pembayarannya void; jurnal yang hilang menggagalkan
 * void secara keras. Mengembalikan total penerimaan terbalik.
 */


async function reverseVoidedSaleReceivables(tx: Tx, input: VoidSaleInput, sale: SaleRow) {
  // FIX-P1 (AK3-01): penjualan berpiutang dapat sudah menerima
  // pembayaran lewat payReceivable (baris party_payments + jurnal
  // sourceType "payment"). Void WAJIB membalik jurnal penerimaan itu
  // satu per satu — ditargetkan lewat idempotency key per pembayaran
  // (pola AK-P2-03) — dan menandai pembayarannya void. Tanpa ini jurnal
  // penjualan terbalik penuh tetapi jurnal penerimaan tetap berdiri:
  // GL piutang menjadi negatif sebesar pembayaran dan kas tercatat
  // menyimpan uang dari penjualan yang sudah tidak ada, sementara
  // dokumennya hilang dari daftar piutang (subledger ≠ GL).
  const arPayments = await tx
    .select()
    .from(partyPayments)
    .where(
      and(
        eq(partyPayments.companyId, input.companyId),
        eq(partyPayments.saleId, sale.id),
        eq(partyPayments.type, "receivable"),
        ne(partyPayments.status, "void"),
      ),
    );
  let reversedArTotal = d(0);
  for (const payment of arPayments) {
    const [entry] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, input.companyId),
          eq(journalEntries.idempotencyKey, `ar:${sale.id}:${payment.number}`),
          eq(journalEntries.status, "posted"),
        ),
      )
      .limit(1);
    if (!entry) {
      // Pola AK-P2-05: gagal keras daripada membiarkan dokumen void
      // dengan penerimaan yang tetap tercatat di buku besar.
      throw new AppError(
        "VALIDATION",
        `Jurnal penerimaan ${payment.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Void penjualan dibatalkan agar daftar piutang dan buku besar tetap selaras; periksa jurnal penerimaan ini terlebih dahulu.`,
      );
    }
    await reverseJournalEntry(tx, {
      companyId: input.companyId,
      entryId: entry.id,
      date: todayISO(),
      description: `Void penjualan ${sale.number} — penerimaan piutang ${payment.number} dibatalkan`,
      createdBy: input.userId,
    });
    await tx
      .update(partyPayments)
      .set({ status: "void" })
      .where(and(eq(partyPayments.companyId, input.companyId), eq(partyPayments.id, payment.id)));

    // WF-006: pulihkan saldo pemakaian kredit pelanggan dan batalkan kredit yang lahir dari penerimaan ini
    await restorePartyCreditUsage(tx, { companyId: input.companyId, userId: input.userId, payment });
    await voidOriginPartyCredit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      paymentId: payment.id,
    });

    reversedArTotal = reversedArTotal.plus(d(payment.amount));
  }
  return { reversedArTotal, reversedArCount: arPayments.length };
}

/**
 * FIX-ARS Tahap 4: fase dari voidSale — badan dipindah apa adanya;
 * catat refund tunai ke sesi yang sah (T3R-2): sesi asal bila
 * masih terbuka, atau sesi terbuka pemroses. Jika keduanya tidak
 * tersedia, gagalkan void agar tidak ada refund laci yang hilang.
 */


async function recordVoidCashRefund(tx: Tx, input: VoidSaleInput, sale: SaleRow) {
  // T3R-2: mutasi refund tunai tidak boleh menulis ke sesi yang sudah
  // ditutup — ringkasan sesi dihitung ulang dari mutasinya, jadi mutasi
  // yang terlambat mengubah sesi final secara retroaktif dan merusak
  // kecocokan dengan jurnal selisihnya. Ikuti pola D-8 pada retur:
  // sesi asal hanya dipakai bila masih terbuka; bila sudah ditutup,
  // refund dicatat ke sesi terbuka milik pemroses void. Jika pemroses
  // pun tidak punya sesi terbuka, gagalkan transaksi: semua perubahan
  // sebelumnya pada tx ikut dibatalkan oleh batas transaksi pemanggil.
  const cashPaid = await tx
    .select({ amount: salePayments.amount, methodType: paymentMethods.type })
    .from(salePayments)
    .innerJoin(paymentMethods, eq(salePayments.methodId, paymentMethods.id))
    .where(eq(salePayments.saleId, sale.id));
  const cashTotal = cashPaid
    .filter((p) => p.methodType === "cash")
    .reduce((acc, p) => acc.plus(d(p.amount)), d(0));
  let refundSessionId: string | null = null;
  let refundSessionSource: "origin" | "processor" | null = null;
  if (cashTotal.gt(0)) {
    if (sale.sessionId) {
      const [originSession] = await tx
        .select({ status: cashSessions.status })
        .from(cashSessions)
        .where(and(eq(cashSessions.companyId, input.companyId), eq(cashSessions.id, sale.sessionId)))
        .limit(1)
        .for("update");
      if (originSession?.status === "open") {
        refundSessionId = sale.sessionId;
        refundSessionSource = "origin";
      }
    }
    if (!refundSessionId) {
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
      if (openSession) {
        refundSessionId = openSession.id;
        refundSessionSource = "processor";
      }
    }
    if (!refundSessionId) {
      throw new AppError(
        "INVALID_STATE",
        "Void ditolak: refund tunai memerlukan sesi kas terbuka. Sesi asal tidak tersedia atau sudah ditutup, dan Anda belum memiliki sesi terbuka. Buka sesi kas Anda lalu ulangi void; penjualan belum dibatalkan.",
      );
    }
    await tx.insert(cashMovements).values({
      companyId: input.companyId,
      sessionId: refundSessionId,
      type: "refund",
      amount: toDb(cashTotal.neg()),
      referenceType: "sale_void",
      referenceId: sale.id,
      notes: input.reason,
      createdBy: input.userId,
    });
  }
  return { cashTotal, refundSessionId, refundSessionSource };
}

/**
 * FIX-ARS Tahap 4: fase dari voidSale — badan dipindah apa adanya;
 * kembalikan kredit retur yang pernah ditebus penjualan ini
 * (D-12) — baris retur dikunci terurut per id seperti di
 * createSale.
 */


async function restoreVoidedSaleCredit(tx: Tx, input: VoidSaleInput, sale: SaleRow) {
  // D-12: penjualan yang di-void mengembalikan kredit retur yang pernah
  // ditebusnya, agar sisa kredit dokumen itu dapat dipakai ulang. Baris
  // retur dikunci terurut per id — pola kunci yang sama dengan
  // createSale — dan credit_used diturunkan sebesar pembayaran kredit
  // penjualan ini.
  const creditPaid = await tx
    .select({ amount: salePayments.amount, reference: salePayments.reference })
    .from(salePayments)
    .innerJoin(paymentMethods, eq(salePayments.methodId, paymentMethods.id))
    .where(and(eq(salePayments.saleId, sale.id), eq(paymentMethods.type, "customer_credit")));
  if (creditPaid.length > 0) {
    const numbers = creditPaid.map((p) => p.reference?.trim() ?? "");
    const candidates = await tx
      .select({ id: saleReturns.id, number: saleReturns.number })
      .from(saleReturns)
      .where(and(eq(saleReturns.companyId, input.companyId), inArray(saleReturns.number, numbers)));
    const sortedIds = [...new Set(candidates.map((row) => row.id))].sort();
    const lockedByNumber = new Map<string, { id: string; creditUsed: D }>();
    for (const id of sortedIds) {
      const [locked] = await tx
        .select({ id: saleReturns.id, number: saleReturns.number, creditUsed: saleReturns.creditUsed })
        .from(saleReturns)
        .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.id, id)))
        .limit(1)
        .for("update");
      if (locked) lockedByNumber.set(locked.number, { id: locked.id, creditUsed: d(locked.creditUsed) });
    }
    for (const payment of creditPaid) {
      const locked = lockedByNumber.get(payment.reference?.trim() ?? "");
      if (!locked) continue;
      const restored = locked.creditUsed.minus(d(payment.amount));
      if (restored.lt(0)) {
        throw new AppError(
          "INVALID_STATE",
          "Data kredit retur tidak konsisten: kredit terpakai lebih kecil dari pembayaran kredit yang di-void.",
        );
      }
      locked.creditUsed = restored;
      await tx
        .update(saleReturns)
        .set({ creditUsed: toDb(restored) })
        .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.id, locked.id)));
    }
  }
}
