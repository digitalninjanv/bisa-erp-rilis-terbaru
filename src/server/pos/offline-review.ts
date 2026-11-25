import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashSessions, outbox, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { lockPosSaleAttempt } from "@/server/idempotency";
import { d, formatIDR } from "@/lib/money";
import type { OfflineSalePayload, OfflineSyncItemResult } from "@/lib/pos-offline";
import { offlineSaleRequestFingerprint } from "./offline-fingerprint";
import { createSale } from "./sales-create";
import { consumeHeldSale } from "./sales-hold";
import type { OriginEntitlement } from "../member-permissions";
import { offlinePayloadLines as mapLines, offlinePayloadPayments as mapPayments, snapshotTotalOf } from "./offline-payload";
import { processOfflineSaleItem, resolvePostingDates } from "./offline";

export type OfflineReviewQueueCursor = { createdAt: string; id: string };
export const OFFLINE_REVIEW_PAGE_SIZE = 50;

export function parseOfflineReviewCursor(value?: string): OfflineReviewQueueCursor | null {
  if (!value || value.length > 128) return null;
  const separator = value.lastIndexOf("~");
  if (separator < 1) return null;
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!Number.isFinite(new Date(createdAt).getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt, id };
}

function reviewCursorOf(row: { cursorAt: string; id: string }): string {
  return `${row.cursorAt}~${row.id}`;
}

/** Bounded keyset page for unresolved POS review items. */
export async function listOfflineReviewQueuePage(
  tx: Tx,
  companyId: string,
  options: {
    includePayload?: boolean;
    cursor?: OfflineReviewQueueCursor | null;
    direction?: "older" | "newer";
    limit?: number;
  } = {},
) {
  const includePayload = options.includePayload ?? false;
  const direction = options.direction ?? "older";
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? OFFLINE_REVIEW_PAGE_SIZE), 1), OFFLINE_REVIEW_PAGE_SIZE);
  const cursor = options.cursor;
  const cursorTime = cursor ? sql`${cursor.createdAt}::timestamptz` : undefined;
  const cursorFilter = cursor
    ? direction === "newer"
      ? or(
          sql`${outbox.createdAt} > ${cursorTime}`,
          and(sql`${outbox.createdAt} = ${cursorTime}`, gt(outbox.id, cursor.id)),
        )
      : or(
          sql`${outbox.createdAt} < ${cursorTime}`,
          and(sql`${outbox.createdAt} = ${cursorTime}`, lt(outbox.id, cursor.id)),
        )
    : undefined;
  const payloadProjection = includePayload
    ? outbox.payload
    : sql`(${outbox.payload} - 'sale')`;
  const rows = await tx
    .select({
      id: outbox.id,
      createdAt: outbox.createdAt,
      cursorAt: sql<string>`to_char(${outbox.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      payload: payloadProjection,
    })
    .from(outbox)
    .where(
      and(
        eq(outbox.companyId, companyId),
        eq(outbox.eventType, "pos_offline_sale"),
        isNull(outbox.processedAt),
        cursorFilter,
      ),
    )
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(limit + 1);
  const hasExtra = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const hasOlder = direction === "newer" ? Boolean(cursor) : hasExtra;
  const hasNewer = direction === "newer" ? hasExtra : Boolean(cursor);
  const items = pageRows.map((row) => {
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
    const { sale: storedSale, ...summary } = payload;
    return {
      id: row.id,
      createdAt: row.createdAt,
      payload: {
        ...summary,
        /** Muatan lengkap hanya menyeberang ke pemegang pos.void. */
        ...(includePayload && storedSale ? { sale: storedSale } : {}),
        canPost: includePayload && Boolean(storedSale),
      },
    };
  });
  return {
    items,
    olderCursor: hasOlder && pageRows.length ? reviewCursorOf(pageRows.at(-1)!) : null,
    newerCursor: hasNewer && pageRows.length ? reviewCursorOf(pageRows[0]) : null,
  };
}

/** Compatibility list for callers that need one bounded page only. */
export async function listOfflineReviewQueue(
  tx: Tx,
  companyId: string,
  options: { includePayload?: boolean } = {},
) {
  const page = await listOfflineReviewQueuePage(tx, companyId, options);
  return page.items;
}

/** Aggregate counts without hydrating payloads for every review item. */
export async function getOfflineReviewQueueSummary(tx: Tx, companyId: string) {
  const [summary] = await tx
    .select({
      total: sql<string>`count(*)::text`,
      conflicts: sql<string>`count(*) filter (where ${outbox.payload}->>'status' = 'conflict')::text`,
      failed: sql<string>`count(*) filter (where ${outbox.payload}->>'status' = 'failed')::text`,
    })
    .from(outbox)
    .where(
      and(
        eq(outbox.companyId, companyId),
        eq(outbox.eventType, "pos_offline_sale"),
        isNull(outbox.processedAt),
      ),
    );
  return {
    total: Number(summary?.total ?? 0),
    conflicts: Number(summary?.conflicts ?? 0),
    failed: Number(summary?.failed ?? 0),
  };
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

/** Read the origin cashier for one target item; the posting action uses this for entitlement lookup. */
export async function getOfflineReviewOriginCashierId(
  tx: Tx,
  companyId: string,
  outboxId: string,
): Promise<string | null> {
  const row = await loadPendingReviewRow(tx, companyId, outboxId);
  const payload = row.payload as { sale?: Pick<OfflineSalePayload, "cashierId"> | null };
  return payload.sale?.cashierId ?? null;
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

async function settledOverageAbsorbed(tx: Tx, companyId: string, sessionId: string) {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(nullif(${outbox.payload}->'settlement'->>'overageAbsorbed', '')::numeric), 0)`,
    })
    .from(outbox)
    .where(and(
      eq(outbox.companyId, companyId),
      eq(outbox.eventType, "pos_offline_sale"),
      sql`${outbox.payload}->'settlement'->>'sessionId' = ${sessionId}`,
    ));
  return d(row?.total ?? 0);
}

export type OfflineReviewPostResult = {
  mode: "retry" | "settle";
  status?: OfflineSyncItemResult["status"];
  saleId?: string;
  saleNumber?: string;
  overageAbsorbed?: number;
  message?: string;
};

/** Posting SAH dari daftar peninjauan (supervisor `pos.void`). */
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
  const preRow = await loadPendingReviewRow(tx, input.companyId, input.outboxId);
  const item = storedPayloadOf(preRow);
  await lockPosSaleAttempt(tx, input.companyId, item.clientKey);
  const row = await loadPendingReviewRow(tx, input.companyId, input.outboxId);
  const idempotencyFingerprint = offlineSaleRequestFingerprint(item);

  if (input.mode === "retry") {
    const result = await processOfflineSaleItem(tx, {
      companyId: input.companyId,
      userId: input.actorId,
      allowCrossCashier: true,
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

  if (item.heldSaleId) {
    const [held] = await tx
      .select({ id: sales.id, status: sales.status, warehouseId: sales.warehouseId })
      .from(sales)
      .where(and(eq(sales.companyId, input.companyId), eq(sales.id, item.heldSaleId)))
      .limit(1)
      .for("update");
    if (!held || held.status !== "held" || held.warehouseId !== item.warehouseId) {
      throw new AppError(
        "CONFLICT",
        "Pesanan tahanan sudah diproses atau dihapus di terminal lain; penyelesaian dibatalkan.",
      );
    }
  }

  const dates = await resolvePostingDates(tx, input.companyId, item);
  const snapshotTotal = snapshotTotalOf(item);
  const hasFrozenPrices = item.lines.every((line) => line.unitPrice != null);

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
      sessionId: targetSession.id,
      offlineSettlement: closedSettlement ? { overageLimit } : undefined,
      frozenPrices: hasFrozenPrices || undefined,
      allowInactiveProducts: true,
      notes: `Penyelesaian offline dari peninjauan: transaksi asli ${item.date} oleh kasir asal; diposting ${dates.postingDate} oleh peninjau.`,
    });
    if (hasFrozenPrices && !d(posted.total).eq(d(snapshotTotal))) {
      throw new AppError(
        "VALIDATION",
        `Total penyelesaian ${formatIDR(posted.total)} tidak sama dengan total struk offline ${formatIDR(snapshotTotal)} — kemungkinan tarif pajak atau aturan pembulatan berubah sejak transaksi. Item tetap di peninjauan.`,
      );
    }
    if (item.heldSaleId) {
      await consumeHeldSale(sp as Tx, {
        companyId: input.companyId,
        userId: originCashierId,
        heldSaleId: item.heldSaleId,
        completedSaleId: posted.id,
      });
    }
    return posted;
  });

  const absorbed = sale.overageAbsorbed ?? 0;
  const payload = { ...((row.payload ?? {}) as Record<string, unknown>) };
  delete payload.sale;
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
  const preRow = await loadPendingReviewRow(tx, input.companyId, input.outboxId);
  const prePayload = (preRow.payload ?? {}) as { clientKey?: unknown };
  if (typeof prePayload.clientKey === "string" && prePayload.clientKey) {
    await lockPosSaleAttempt(tx, input.companyId, prePayload.clientKey);
  }
  const row = await loadPendingReviewRow(tx, input.companyId, input.outboxId);
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const summary = { ...payload };
  delete summary.sale;
  const [updated] = await tx
    .update(outbox)
    .set({
      processedAt: new Date(),
      payload: {
        ...summary,
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
