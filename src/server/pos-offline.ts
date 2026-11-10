import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashSessions, fiscalPeriods, outbox, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import type {
  OfflineReviewKind,
  OfflineSalePayload,
  OfflineSyncItemResult,
} from "@/lib/pos-offline";
import { createSale, quoteCart } from "./pos";
import type { OriginEntitlement } from "./member-permissions";

import { getCompanySettingsRow } from "@/server/settings";
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
 *    sama, dan muatan penjualan lengkap disimpan agar peninjauan
 *    dapat memposting ulang itemnya.
 */

export const OFFLINE_SYNC_STATUS_LABELS: Record<string, string> = {
  synced: "Tersinkron",
  duplicate: "Duplikat (sudah tercatat)",
  conflict: "Konflik stok",
  failed: "Gagal (dapat dicoba lagi)",
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

export async function assertOfflineEnabled(tx: Tx, companyId: string) {
  const settings = await getCompanySettingsRow(tx, companyId);
  if (!settings?.posOfflineEnabled) {
    throw new AppError(
      "FORBIDDEN",
      "Mode offline POS tidak aktif untuk perusahaan ini. Aktifkan saklar Mode offline POS di Pengaturan.",
    );
  }
}

/** Total struk offline: snapshot eksplisit, atau jumlah pembayaran
 *  untuk muatan warisan (pembayaran offline selalu menjumlah ke total
 *  struk; kembalian hidup di kolom tendered, bukan amount). */
export function snapshotTotalOf(item: OfflineSalePayload): number {
  if (item.expectedTotal != null) return item.expectedTotal;
  return item.payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function mapLines(item: OfflineSalePayload) {
  return item.lines.map((line) => ({
    productId: line.productId,
    qty: line.qty,
    discountType: line.discountType ?? null,
    discountValue: line.discountValue ?? 0,
    serialNumbers: line.serialNumbers,
    unitPrice: line.unitPrice,
    // S4: kemasan + faktor cuplikan muatan diteruskan apa adanya —
    // quoteCart menilainya sebagai jalur server tepercaya (faktor
    // dari cuplikan, harga dari master berlaku kini / snapshot beku).
    packagingId: line.packagingId ?? null,
    isiSnapshot: line.isiSnapshot,
  }));
}

function mapPayments(item: OfflineSalePayload) {
  return item.payments.map((payment) => ({
    methodId: payment.methodId,
    amount: payment.amount,
    tendered: payment.tendered,
    reference: payment.reference,
    // A-21 Tahap R3-A (R3-01): fee dari panel kasir asal diteruskan;
    // muatan lama tanpa fee memakai bawaan konfigurasi di domain.
    fee: payment.fee,
  }));
}

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
async function resolvePostingDates(tx: Tx, companyId: string, item: OfflineSalePayload) {
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
    /** Hak kasir asal per userId, diresolusi lapisan aksi dari
     *  keanggotaan. Bila diisi, kasir asal yang tidak berhak ditahan. */
    originEntitlements?: Record<string, OriginEntitlement | null>;
    item: OfflineSalePayload;
  },
): Promise<OfflineSyncItemResult> {
  const { item } = input;
  const originCashierId = item.cashierId ?? input.userId;
  const snapshotTotal = snapshotTotalOf(item);
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
      );
    for (const prior of priorPending) {
      await tx
        .update(outbox)
        .set({
          processedAt: new Date(),
          payload: {
            ...((prior.payload ?? {}) as Record<string, unknown>),
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
        // Muatan lengkap: peninjauan dapat memposting ulang item ini.
        sale: item,
      },
      processedAt:
        result.status === "synced" || result.status === "duplicate" ? new Date() : null,
    });
    return result;
  };

  const [existing] = await tx
    .select({ id: sales.id, number: sales.number })
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.idempotencyKey, item.clientKey)))
    .limit(1);
  if (existing) {
    return record({
      clientKey: item.clientKey,
      status: "duplicate",
      saleId: existing.id,
      saleNumber: existing.number,
    });
  }

  // POS3-02: hak dinilai dari KASIR ASAL. Asal yang tidak lagi berhak
  // ditahan untuk peninjauan supervisor — penjualan tidak dialihkan
  // ke penyinkron dan tidak diposting atas nama siapa pun.
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
    const sale = await tx.transaction(async (sp) =>
      createSale(sp as Tx, {
        companyId: input.companyId,
        userId: originCashierId,
        warehouseId: item.warehouseId,
        customerId: item.customerId ?? null,
        dueDate: dates.dueDate,
        groupId: item.groupId ?? null,
        date: dates.postingDate,
        lines: mapLines(item),
        payments: mapPayments(item),
        idempotencyKey: item.clientKey,
        canDiscount: originCanDiscount,
        sessionId: targetSessionId,
        notes: dates.shifted
          ? `Transaksi offline tanggal ${item.date}; diposting ${dates.postingDate} karena periode asal tertutup.`
          : undefined,
      }),
    );
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

/** Daftar peninjauan: percobaan sinkron yang belum tuntas (processed_at NULL). */
export async function listOfflineReviewQueue(tx: Tx, companyId: string) {
  const rows = await tx
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.companyId, companyId),
        eq(outbox.eventType, "pos_offline_sale"),
        isNull(outbox.processedAt),
      ),
    )
    .orderBy(desc(outbox.createdAt));
  return rows.map((row) => {
    const payload = row.payload as {
      clientKey: string;
      status: string;
      kind?: string | null;
      message: string | null;
      date: string;
      postingDate?: string;
      warehouseId: string;
      lineCount: number;
      totalPayments: number;
      expectedTotal?: number | null;
      priceConflict?: { expectedTotal: number; currentTotal: number; difference: number } | null;
      origin?: { cashierId: string; sessionId: string | null; deviceId: string | null } | null;
      queuedAt: string;
      sale?: OfflineSalePayload | null;
    };
    return {
      id: row.id,
      createdAt: row.createdAt,
      payload: {
        ...payload,
        /** Muatan lengkap tersimpan → peninjauan dapat memposting item ini. */
        canPost: Boolean(payload.sale),
      },
    };
  });
}

async function loadPendingReviewRow(tx: Tx, companyId: string, outboxId: string) {
  const [row] = await tx
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.companyId, companyId),
        eq(outbox.id, outboxId),
        eq(outbox.eventType, "pos_offline_sale"),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new AppError("NOT_FOUND", "Item antrean tidak ditemukan.");
  if (row.processedAt) throw new AppError("CONFLICT", "Item ini sudah diselesaikan.");
  return row;
}

function storedPayloadOf(row: { payload: unknown }): OfflineSalePayload {
  const payload = row.payload as { sale?: OfflineSalePayload | null };
  if (!payload.sale) {
    throw new AppError(
      "VALIDATION",
      "Item lama ini tidak menyimpan muatan penjualan lengkap, sehingga tidak dapat diposting dari peninjauan. Tangani secara manual lalu tandai selesai, atau buang dengan catatan.",
    );
  }
  return payload.sale;
}

/** Total selisih kas lebih sesi yang sudah diserap penyelesaian
 *  terdahulu — dibaca dari catatan penyelesaian di outbox agar
 *  penyelesaian berikutnya hanya menyerap sisanya. */
async function settledOverageAbsorbed(tx: Tx, companyId: string, sessionId: string) {
  const rows = await tx
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.companyId, companyId), eq(outbox.eventType, "pos_offline_sale")));
  let total = d(0);
  for (const row of rows) {
    const settlement = (row.payload as { settlement?: { sessionId?: string; overageAbsorbed?: number } })
      ?.settlement;
    if (settlement?.sessionId === sessionId) {
      total = total.plus(d(settlement.overageAbsorbed ?? 0));
    }
  }
  return total;
}

export type OfflineReviewPostResult = {
  mode: "retry" | "settle";
  status?: OfflineSyncItemResult["status"];
  saleId?: string;
  saleNumber?: string;
  overageAbsorbed?: number;
  message?: string;
};

/**
 * FIX-POS Tahap 2 (POS3-03/04): posting SAH dari daftar peninjauan —
 * dipanggil aksi bergerbang supervisor (`pos.void`).
 * - `retry`: jalankan ulang jalur sinkronisasi normal dari muatan
 *   tersimpan (harga berlaku kini; sesi asal terbuka).
 * - `settle`: penyelesaian eksplisit pada HARGA STRUK OFFLINE (harga
 *   beku dari snapshot baris) ke sesi asal — terbuka (mutasi normal)
 *   atau tertutup (tanpa mutasi baru; kaki kas menyerap selisih kas
 *   lebih sesi). Total hasil wajib sama dengan snapshot struk, bila
 *   tidak seluruh transaksi dibatalkan dan item tetap di peninjauan.
 * Pemanggil wajib membungkus dalam transaksi (withCompany): lemparan
 * sesudah createSale (ketidakcocokan total) membatalkan postingnya.
 */
export async function postOfflineReviewItem(
  tx: Tx,
  input: {
    companyId: string;
    actorId: string;
    outboxId: string;
    mode: "retry" | "settle";
    originEntitlements?: Record<string, OriginEntitlement | null>;
  },
): Promise<OfflineReviewPostResult> {
  const row = await loadPendingReviewRow(tx, input.companyId, input.outboxId);
  const item = storedPayloadOf(row);

  if (input.mode === "retry") {
    const result = await processOfflineSaleItem(tx, {
      companyId: input.companyId,
      userId: input.actorId,
      item,
      originEntitlements: input.originEntitlements,
    });
    return {
      mode: "retry",
      status: result.status,
      saleId: result.saleId,
      saleNumber: result.saleNumber,
      message: result.message,
    };
  }

  // mode "settle"
  const originCashierId = item.cashierId ?? input.actorId;
  let originCanDiscount = false;
  if (item.cashierId && input.originEntitlements) {
    const entitlement = input.originEntitlements[item.cashierId] ?? null;
    if (!entitlement || !entitlement.canSell) {
      throw new AppError(
        "VALIDATION",
        "Kasir asal tidak lagi berhak menjual di perusahaan ini; penjualan ini tidak dapat diselesaikan atas namanya. Buang item dengan catatan atau tangani secara manual.",
      );
    }
    originCanDiscount = entitlement.canDiscount;
  }

  let targetSession: { id: string; status: string };
  if (item.originSessionId) {
    const [originSession] = await tx
      .select({ id: cashSessions.id, userId: cashSessions.userId, status: cashSessions.status })
      .from(cashSessions)
      .where(
        and(eq(cashSessions.companyId, input.companyId), eq(cashSessions.id, item.originSessionId)),
      )
      .limit(1)
      .for("update");
    if (!originSession || originSession.userId !== originCashierId) {
      throw new AppError(
        "VALIDATION",
        "Sesi kas asal tidak ditemukan atau bukan milik kasir asal; penyelesaian tidak dapat dilakukan.",
      );
    }
    targetSession = originSession;
  } else {
    const [open] = await tx
      .select({ id: cashSessions.id, status: cashSessions.status })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.companyId, input.companyId),
          eq(cashSessions.userId, originCashierId),
          eq(cashSessions.status, "open"),
        ),
      )
      .orderBy(desc(cashSessions.openedAt))
      .limit(1)
      .for("update");
    if (!open) {
      throw new AppError(
        "VALIDATION",
        "Kasir asal tidak memiliki sesi kas terbuka untuk penyelesaian ini.",
      );
    }
    targetSession = open;
  }
  const closedSettlement = targetSession.status !== "open";

  let overageLimit = 0;
  if (closedSettlement) {
    const [sessionRow] = await tx
      .select({ difference: cashSessions.difference })
      .from(cashSessions)
      .where(eq(cashSessions.id, targetSession.id));
    const absorbed = await settledOverageAbsorbed(tx, input.companyId, targetSession.id);
    overageLimit = Math.max(0, d(sessionRow?.difference ?? 0).minus(absorbed).toNumber());
  }

  const dates = await resolvePostingDates(tx, input.companyId, item);
  const snapshotTotal = snapshotTotalOf(item);
  const hasFrozenPrices = item.lines.every((line) => line.unitPrice != null);

  const sale = await tx.transaction(async (sp) =>
    createSale(sp as Tx, {
      companyId: input.companyId,
      userId: originCashierId,
      warehouseId: item.warehouseId,
      customerId: item.customerId ?? null,
      dueDate: dates.dueDate,
      groupId: item.groupId ?? null,
      date: dates.postingDate,
      lines: mapLines(item),
      payments: mapPayments(item),
      idempotencyKey: item.clientKey,
      canDiscount: originCanDiscount,
      sessionId: targetSession.id,
      offlineSettlement: closedSettlement ? { overageLimit } : undefined,
      frozenPrices: hasFrozenPrices || undefined,
      notes: `Penyelesaian offline dari peninjauan: transaksi asli ${item.date} oleh kasir asal; diposting ${dates.postingDate} oleh peninjau.`,
    }),
  );
  if (hasFrozenPrices && !d(sale.total).eq(d(snapshotTotal))) {
    throw new AppError(
      "VALIDATION",
      `Total penyelesaian ${formatIDR(sale.total)} tidak sama dengan total struk offline ${formatIDR(snapshotTotal)} — kemungkinan tarif pajak atau aturan pembulatan berubah sejak transaksi. Item tetap di peninjauan.`,
    );
  }

  const absorbed = sale.overageAbsorbed ?? 0;
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  await tx
    .update(outbox)
    .set({
      processedAt: new Date(),
      payload: {
        ...payload,
        resolution: { action: "settled", by: input.actorId, at: new Date().toISOString() },
        settlement: {
          saleId: sale.id,
          saleNumber: sale.number,
          sessionId: targetSession.id,
          closedSession: closedSettlement,
          overageAbsorbed: absorbed,
          postingDate: dates.postingDate,
          originalDate: item.date,
          priceMode: hasFrozenPrices ? "offline_snapshot" : "current",
        },
      },
    })
    .where(eq(outbox.id, row.id));

  return { mode: "settle", saleId: sale.id, saleNumber: sale.number, overageAbsorbed: absorbed };
}

/** Selesaikan item peninjauan (sudah ditangani manual / dibuang dengan catatan). */
export async function resolveOfflineOutboxItem(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    outboxId: string;
    resolution: "done" | "discarded";
    note?: string | null;
  },
) {
  const [row] = await tx
    .select()
    .from(outbox)
    .where(and(eq(outbox.companyId, input.companyId), eq(outbox.id, input.outboxId)))
    .limit(1)
    .for("update");
  if (!row) throw new AppError("NOT_FOUND", "Item antrean tidak ditemukan.");
  if (row.processedAt) throw new AppError("CONFLICT", "Item ini sudah diselesaikan.");
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const [updated] = await tx
    .update(outbox)
    .set({
      processedAt: new Date(),
      payload: {
        ...payload,
        resolution: {
          action: input.resolution,
          note: input.note ?? null,
          by: input.userId,
          at: new Date().toISOString(),
        },
      },
    })
    .where(and(eq(outbox.companyId, input.companyId), eq(outbox.id, input.outboxId)))
    .returning();
  return updated;
}
