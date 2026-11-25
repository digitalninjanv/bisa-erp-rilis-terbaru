import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashSessions, fiscalPeriods, idempotencyKeys, outbox, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { lockPosSaleAttempt } from "@/server/idempotency";
import { d, formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import type {
  OfflineReviewKind,
  OfflineSalePayload,
  OfflineSyncItemResult,
} from "@/lib/pos-offline";
import { matchesWebCheckoutFingerprint, offlineSaleRequestFingerprint } from "./offline-fingerprint";
import { quoteCart } from "./quote";
import { createSale } from "./sales-create";
import { consumeHeldSale } from "./sales-hold";
import type { OriginEntitlement } from "../member-permissions";

export { assertOfflineEnabled } from "./offline-settings";
/**
 * SIM-2 S7B-2 Batch 6 + FIX-POS Tahap 2 — Sinkronisasi penjualan
 * offline POS (§12; temuan POS3-01..06, POS3-17, POS1-04).
 *
 * Setiap item antrean diproses lewat jalur checkout NORMAL
 * (createSale) dengan idempotency key = clientKey dari klien:
 * - penjualan dengan kunci yang sama sudah ada → `duplicate`;
 * - stok tidak cukup saat sinkron → `conflict` (TIDAK dipaksakan);
 * - kesalahan lain → `failed` (dapat dicoba lagi / ditinjau).
 *
 * Keputusan desain Tahap 2:
 * 1. IDENTITAS ASAL (POS3-02): penjualan diposting atas nama kasir
 *    asal & ke sesi asal yang dibawa muatan — hak diskon dinilai dari
 *    kasir asal (diresolusi lapisan aksi dari keanggotaan), bukan dari
 *    penyinkron. Kasir asal yang tidak lagi berhak → peninjauan
 *    beralasan (kind `origin_ineligible`), tidak dialihkan diam-diam.
 *    Muatan warisan tanpa identitas asal dianggap milik penyinkron.
 * 2. SESI TERTUTUP (POS3-03): sinkronisasi biasa TIDAK memposting
 *    penjualan yang sesi asalnya sudah tertutup — item masuk
 *    peninjauan (kind `session_closed`) dan hanya dapat diposting
 *    lewat penyelesaian eksplisit supervisor (`postOfflineReviewItem`
 *    mode `settle`): tanpa mutasi kas baru ke sesi tertutup, dan kaki
 *    kas tunai menyerap selisih kas lebih sesi itu (lihat createSale).
 * 3. HARGA (POS1-04/POS3-04): muatan membawa snapshot total struk
 *    (expectedTotal; warisan: jumlah pembayaran). Kutipan ulang yang
 *    berbeda dari snapshot TIDAK diposting senyap — item masuk
 *    peninjauan dengan kedua total & selisihnya (kind `price`;
 *    turun → conflict, naik → failed karena pembayaran menjadi
 *    kurang). Resolusi eksplisitnya: posting pada harga struk offline
 *    (mode `settle`, harga beku dari snapshot baris) atau buang.
 * 4. TANGGAL (POS3-17): tanggal transaksi di periode tertutup tidak
 *    lagi buntu — penjualan diposting bertanggal sinkron, tanggal
 *    asli tersimpan di catatan dokumen & muatan outbox, dan jatuh
 *    tempo bergeser sebesar delta hari yang sama. Konsisten dengan
 *    doktrin FIX-P1: tidak ada posting ke periode tertutup.
 * 5. SATU BARIS PENINJAUAN PER KUNCI (POS3-05): setiap pencatatan
 *    menutup (supersede) baris pending terdahulu untuk clientKey yang
 *    sama. Muatan lengkap disimpan hanya selama item unresolved agar
 *    peninjauan dapat memposting ulang; baris terminal menyimpan ringkasan.
 */

export const OFFLINE_SYNC_STATUS_LABELS: Record<string, string> = {
  synced: "Tersinkron",
  duplicate: "Duplikat (sudah tercatat)",
  conflict: "Konflik stok",
  failed: "Gagal (dapat dicoba lagi)",
  resolved: "Dibatalkan di peninjauan",
};

export const OFFLINE_REVIEW_KIND_LABELS: Record<string, string> = {
  stock: "Konflik stok",
  price: "Harga berubah sejak transaksi",
  session: "Tidak ada sesi kas",
  session_closed: "Sesi asal sudah ditutup — perlu penyelesaian",
  origin_ineligible: "Kasir asal tidak lagi berhak",
  period: "Periode fiskal tertutup",
  other: "Gagal lain",
};

import {
  findTerminalOfflineResolution,
  offlinePayloadLines as mapLines,
  offlinePayloadPayments as mapPayments,
  snapshotTotalOf,
} from "./offline-payload";

export { snapshotTotalOf } from "./offline-payload";


/** Cermin baca assertPeriodOpen (FIX-P1): tanpa baris = tertutup,
 *  kecuali tahun berjalan/berikutnya yang termaterialisasi lazy. */
async function isPeriodClosed(tx: Tx, companyId: string, date: string): Promise<boolean> {
  const parsed = new Date(`${date}T00:00:00Z`);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return false;
  const [row] = await tx
    .select({ status: fiscalPeriods.status })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, companyId),
        eq(fiscalPeriods.year, year),
        eq(fiscalPeriods.month, month),
      ),
    )
    .limit(1);
  if (row) return row.status !== "open";
  const currentYear = new Date().getFullYear();
  return year !== currentYear && year !== currentYear + 1;
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** POS3-17: tanggal posting & jatuh tempo efektif untuk item ini. */
export async function resolvePostingDates(tx: Tx, companyId: string, item: OfflineSalePayload) {
  const closed = await isPeriodClosed(tx, companyId, item.date);
  if (!closed) {
    return { postingDate: item.date, dueDate: item.dueDate ?? null, shifted: false };
  }
  const postingDate = todayISO();
  let dueDate = item.dueDate ?? null;
  if (dueDate) {
    const deltaDays = Math.round(
      (Date.parse(postingDate) - Date.parse(item.date)) / 86400000,
    );
    dueDate = shiftDate(dueDate, deltaDays);
  }
  return { postingDate, dueDate, shifted: true };
}

type RecordMeta = {
  kind?: OfflineReviewKind;
  priceConflict?: { expectedTotal: number; currentTotal: number; difference: number } | null;
  postingDate?: string;
};

export async function processOfflineSaleItem(
  tx: Tx,
  input: {
    companyId: string;
    /** Penyinkron (aktor pemanggil) — BUKAN pemilik penjualan. */
    userId: string;
    /** Hak diskon penyinkron; hanya fallback untuk muatan warisan. */
    canDiscount?: boolean;
    /** Only an authenticated supervisor may sync for another cashier. */
    allowCrossCashier?: boolean;
    /** Hak kasir asal per userId, diresolusi lapisan aksi dari
     *  keanggotaan. Bila diisi, kasir asal yang tidak berhak ditahan. */
    originEntitlements?: Record<string, OriginEntitlement | null>;
    item: OfflineSalePayload;
    reconcileWebCheckout?: boolean;
  },
): Promise<OfflineSyncItemResult> {
  const { item } = input;
  await lockPosSaleAttempt(tx, input.companyId, item.clientKey);
  const originCashierId = item.cashierId ?? input.userId;
  const snapshotTotal = snapshotTotalOf(item);
  const idempotencyFingerprint = offlineSaleRequestFingerprint(item);
  const meta: RecordMeta = {};

  const record = async (result: OfflineSyncItemResult) => {
    // POS3-05: tutup baris pending terdahulu untuk kunci yang sama —
    // daftar peninjauan selalu memuat paling banyak satu baris hidup
    // per penjualan antrean, dan baris basi tidak bertahan sesudah
    // percobaan yang lebih baru (apalagi sesudah sukses).
    const priorPending = await tx
      .select({ id: outbox.id, payload: outbox.payload })
      .from(outbox)
      .where(
        and(
          eq(outbox.companyId, input.companyId),
          eq(outbox.eventType, "pos_offline_sale"),
          isNull(outbox.processedAt),
          sql`${outbox.payload}->>'clientKey' = ${item.clientKey}`,
        ),
      )
      .for("update");
    for (const prior of priorPending) {
      const priorSummary = { ...((prior.payload ?? {}) as Record<string, unknown>) };
      delete priorSummary.sale;
      await tx
        .update(outbox)
        .set({
          processedAt: new Date(),
          payload: {
            ...priorSummary,
            resolution: {
              action: "superseded",
              by: input.userId,
              at: new Date().toISOString(),
              note: "Digantikan percobaan sinkronisasi yang lebih baru untuk kunci klien yang sama.",
            },
          },
        })
        .where(eq(outbox.id, prior.id));
    }
    const [countRow] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(outbox)
      .where(
        and(
          eq(outbox.companyId, input.companyId),
          eq(outbox.eventType, "pos_offline_sale"),
          sql`${outbox.payload}->>'clientKey' = ${item.clientKey}`,
        ),
      );
    const terminal = result.status === "synced" ||
      result.status === "duplicate" ||
      result.status === "resolved";
    await tx.insert(outbox).values({
      companyId: input.companyId,
      eventType: "pos_offline_sale",
      payload: {
        clientKey: item.clientKey,
        status: result.status,
        kind: result.kind ?? meta.kind ?? null,
        saleId: result.saleId ?? null,
        saleNumber: result.saleNumber ?? null,
        message: result.message ?? null,
        date: item.date,
        postingDate: meta.postingDate ?? item.date,
        warehouseId: item.warehouseId,
        lineCount: item.lines.length,
        totalPayments: item.payments.reduce((sum, payment) => sum + payment.amount, 0),
        expectedTotal: snapshotTotal,
        priceConflict: meta.priceConflict ?? null,
        origin: {
          cashierId: originCashierId,
          sessionId: item.originSessionId ?? null,
          deviceId: item.deviceId ?? null,
        },
        queuedAt: item.queuedAt,
        syncedBy: input.userId,
        attempts: (countRow?.value ?? 0) + 1,
        // Failed/conflict rows need the full payload for supervisor
        // review. Terminal history retains only the compact summary.
        ...(terminal ? {} : { sale: item }),
      },
      processedAt: terminal ? new Date() : null,
    });
    return result;
  };

  const terminalResolution = await findTerminalOfflineResolution(
    tx,
    input.companyId,
    item.clientKey,
  );
  if (terminalResolution) {
    return record({
      clientKey: item.clientKey,
      status: "resolved",
      message:
        terminalResolution === "discarded"
          ? "Item ini sudah dibuang oleh supervisor; antrean lokal dibersihkan dan tidak diposting."
          : "Item ini sudah ditandai selesai oleh supervisor; antrean lokal dibersihkan.",
    });
  }

  const [existing] = await tx
    .select({ id: sales.id, number: sales.number })
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.idempotencyKey, item.clientKey)))
    .limit(1);
  if (existing) {
    const [claim] = await tx
      .select({ resultRef: idempotencyKeys.resultRef })
      .from(idempotencyKeys)
      .where(and(
        eq(idempotencyKeys.companyId, input.companyId),
        eq(idempotencyKeys.scope, "pos.sale"),
        eq(idempotencyKeys.key, item.clientKey),
      ))
      .limit(1);
    const matchesWebCheckout = input.reconcileWebCheckout &&
      originCashierId === input.userId &&
      matchesWebCheckoutFingerprint(input.companyId, originCashierId, item, claim?.resultRef);
    if (claim?.resultRef !== idempotencyFingerprint && !matchesWebCheckout) {
      return record({
        clientKey: item.clientKey,
        status: "conflict",
        kind: "other",
        saleId: existing.id,
        saleNumber: existing.number,
        message: claim?.resultRef
          ? "Kunci offline sudah digunakan untuk payload transaksi yang berbeda. Periksa riwayat dan tinjau item ini sebelum menyelesaikannya."
          : "Transaksi lama ditemukan tanpa fingerprint retry. Periksa riwayat sebelum menandai item offline sebagai duplikat.",
      });
    }
    return record({
      clientKey: item.clientKey,
      status: "duplicate",
      saleId: existing.id,
      saleNumber: existing.number,
    });
  }

  // A desktop checkout resumed from a server-held order consumes that
  // order only after the sale posts. Lock it before quoting/posting so a
  // second terminal cannot complete the same held order concurrently.
  if (item.heldSaleId) {
    const [held] = await tx
      .select({ id: sales.id, status: sales.status, warehouseId: sales.warehouseId })
      .from(sales)
      .where(and(
        eq(sales.companyId, input.companyId),
        eq(sales.id, item.heldSaleId),
      ))
      .limit(1)
      .for("update");
    if (!held || held.status !== "held" || held.warehouseId !== item.warehouseId) {
      meta.kind = "other";
      return record({
        clientKey: item.clientKey,
        status: "conflict",
        kind: "other",
        message: "Pesanan server sudah diproses atau dihapus di terminal lain. Penjualan ini belum diposting; minta supervisor memeriksa antrean sebelum mencoba lagi.",
      });
    }
  }

  // POS3-02: hak dinilai dari KASIR ASAL. Asal yang tidak lagi berhak
  // ditahan untuk peninjauan supervisor — penjualan tidak dialihkan
  // ke penyinkron dan tidak diposting atas nama siapa pun.
  if (originCashierId !== input.userId && !input.allowCrossCashier) {
    meta.kind = "origin_ineligible";
    return record({ clientKey: item.clientKey, status: "failed", kind: "origin_ineligible",
      message: "Identitas kasir asal berbeda dari penyinkron. Minta supervisor meninjau dan menyelesaikan transaksi ini." });
  }
  let originCanDiscount = input.canDiscount ?? false;
  if (item.cashierId && input.originEntitlements) {
    const entitlement = input.originEntitlements[item.cashierId] ?? null;
    if (!entitlement || !entitlement.canSell) {
      meta.kind = "origin_ineligible";
      return record({
        clientKey: item.clientKey,
        status: "failed",
        kind: "origin_ineligible",
        message:
          "Kasir asal penjualan ini tidak lagi berhak menjual di perusahaan ini (keanggotaan dicabut atau peran berubah). Item ditahan untuk ditinjau supervisor dan tidak dialihkan ke penyinkron.",
      });
    }
    originCanDiscount = entitlement.canDiscount;
  }

  // POS3-02/03: sesi asal eksplisit menentukan tempel penjualan.
  let targetSessionId: string | undefined;
  if (item.originSessionId) {
    const [originSession] = await tx
      .select({ id: cashSessions.id, userId: cashSessions.userId, status: cashSessions.status })
      .from(cashSessions)
      .where(
        and(eq(cashSessions.companyId, input.companyId), eq(cashSessions.id, item.originSessionId)),
      )
      .limit(1);
    if (!originSession || originSession.userId !== originCashierId) {
      meta.kind = "session";
      return record({
        clientKey: item.clientKey,
        status: "failed",
        kind: "session",
        message:
          "Sesi kas asal tidak ditemukan atau bukan milik kasir asal. Item ditahan untuk ditinjau supervisor.",
      });
    }
    if (originSession.status !== "open") {
      meta.kind = "session_closed";
      return record({
        clientKey: item.clientKey,
        status: "failed",
        kind: "session_closed",
        message:
          "Sesi kas asal sudah ditutup. Penjualan ini hanya dapat diposting lewat penyelesaian dari daftar peninjauan agar kasnya tidak terhitung dua kali.",
      });
    }
    targetSessionId = originSession.id;
  }

  const dates = await resolvePostingDates(tx, input.companyId, item);
  meta.postingDate = dates.postingDate;

  // POS1-04/POS3-04: bandingkan kutipan ulang dengan snapshot struk.
  // Selisih berapa pun berarti harga/aturan berubah sejak transaksi —
  // penjualan yang sudah dibayar pelanggan tidak boleh dibukukan pada
  // total lain secara senyap, dan kembalian tidak boleh dikarang.
  let currentTotal: number;
  try {
    const quote = await quoteCart(tx, {
      companyId: input.companyId,
      warehouseId: item.warehouseId,
      customerId: item.customerId ?? null,
      groupId: item.groupId ?? null,
      lines: mapLines(item),
      asOfDate: dates.postingDate,
      canDiscount: originCanDiscount,
      allowInactiveProducts: true,
    });
    currentTotal = quote.total;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kesalahan tidak dikenal.";
    meta.kind = "other";
    return record({ clientKey: item.clientKey, status: "failed", kind: "other", message });
  }
  if (!d(currentTotal).eq(d(snapshotTotal))) {
    const difference = d(currentTotal).minus(d(snapshotTotal));
    meta.kind = "price";
    meta.priceConflict = {
      expectedTotal: snapshotTotal,
      currentTotal,
      difference: difference.toNumber(),
    };
    return record({
      clientKey: item.clientKey,
      status: difference.lt(0) ? "conflict" : "failed",
      kind: "price",
      message: `Harga berubah sejak transaksi offline: total struk ${formatIDR(snapshotTotal)}, harga berlaku kini ${formatIDR(currentTotal)} (selisih ${formatIDR(difference.abs().toNumber())}). Item ditahan untuk ditinjau — selesaikan dari daftar peninjauan (posting pada harga struk atau batalkan).`,
    });
  }

  try {
    const sale = await tx.transaction(async (sp) => {
      const posted = await createSale(sp as Tx, {
        companyId: input.companyId,
        userId: originCashierId,
        warehouseId: item.warehouseId,
        customerId: item.customerId ?? null,
        dueDate: dates.dueDate,
        groupId: item.groupId ?? null,
        reservationId: item.reservationId ?? null,
        date: dates.postingDate,
        lines: mapLines(item),
        payments: mapPayments(item),
        idempotencyKey: item.clientKey,
        idempotencyFingerprint,
        canDiscount: originCanDiscount,
        sessionId: targetSessionId,
        allowInactiveProducts: true,
        notes: dates.shifted
          ? `Transaksi offline tanggal ${item.date}; diposting ${dates.postingDate} karena periode asal tertutup.`
          : undefined,
      });
      if (item.heldSaleId) {
        // Sale posting and hold consumption share this savepoint. A lost
        // hold race must roll back stock, cash, journal, and the new sale
        // together instead of returning a failed sync with a posted sale.
        await consumeHeldSale(sp as Tx, {
          companyId: input.companyId,
          userId: originCashierId,
          heldSaleId: item.heldSaleId,
          completedSaleId: posted.id,
        });
      }
      return posted;
    });
    return record({
      clientKey: item.clientKey,
      status: "synced",
      saleId: sale.id,
      saleNumber: sale.number,
    });
  } catch (error) {
    const code = error instanceof AppError ? error.code : undefined;
    const message = error instanceof Error ? error.message : "Kesalahan tidak dikenal.";
    const kind: OfflineReviewKind =
      code === "INSUFFICIENT_STOCK" ? "stock" : code === "PERIOD_CLOSED" ? "period" : "other";
    meta.kind = kind;
    return record({
      clientKey: item.clientKey,
      status: kind === "stock" ? "conflict" : "failed",
      kind,
      message,
    });
  }
}
