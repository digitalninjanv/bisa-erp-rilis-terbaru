import { AppError, type AppErrorCode } from "@/lib/errors";
import { log } from "@/lib/log";
import type { OfflineSalePayload } from "@/lib/pos-offline";
import { orderPosSyncEvents, type PosSyncEvent } from "@/lib/pos/sync-timeline";
import {
  POS_API_CORS_HEADERS,
  posSyncRequestSchema,
  resolvePosDevice,
  syncPosDeviceItems,
  syncPosDeviceSessionIntents,
} from "@/server/pos-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POS Native Langkah 1 — POST /api/pos/sync (RENCANA-TAURI D2/D7).
 *
 * Pintu HTTP untuk kontrak sinkronisasi offline yang SUDAH ada:
 * badan permintaan `{ items: OfflineSalePayload[] }` (maks 50/panggil,
 * skema Zod yang sama dengan `syncOfflineSalesAction`) diproses item
 * per item lewat domain `processOfflineSaleItem` — idempotensi per
 * clientKey, konflik stok/harga masuk peninjauan, tidak ada aturan
 * bisnis duplikat di lapisan HTTP ini. Autentikasi = token perangkat
 * (Bearer) per-terminal dari registry server (Langkah 6).
 *
 * Langkah 6: badan boleh membawa `sessionIntents` (intent tutup
 * sesi kas terminal) — dicatat sebagai bahan peninjauan lewat
 * domain registry, hasilnya di field `intentResults` respons.
 */

const APP_ERROR_STATUS: Partial<Record<AppErrorCode, number>> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
}

export async function POST(request: Request) {
  const device = await resolvePosDevice(request);
  if (!device) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED", message: "Token perangkat tidak dikenal." },
      { status: 401, headers: POS_API_CORS_HEADERS },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, code: "VALIDATION", message: "Badan permintaan bukan JSON yang valid." },
      { status: 400, headers: POS_API_CORS_HEADERS },
    );
  }
  const parsed = posSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "VALIDATION",
        message: "Muatan sinkronisasi tidak valid.",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400, headers: POS_API_CORS_HEADERS },
    );
  }
  try {
    const sessionIntents = parsed.data.sessionIntents ?? [];
    type SyncEventValue =
      | { type: "sale"; item: OfflineSalePayload }
      | { type: "session"; intent: (typeof sessionIntents)[number] };
    const events: PosSyncEvent<SyncEventValue>[] = [];
    let order = 0;
    for (const intent of sessionIntents) {
      const occurredAt =
        intent.action === "open"
          ? intent.openedAt
          : intent.action === "movement"
            ? intent.createdAt
            : intent.closedAt;
      events.push({
        kind: intent.action,
        occurredAt,
        order: order++,
        value: { type: "session", intent },
      });
    }
    for (const item of parsed.data.items as OfflineSalePayload[]) {
      events.push({
        kind: "sale",
        occurredAt: item.queuedAt,
        order: order++,
        value: { type: "sale", item },
      });
    }

    // Process the device's real timeline. Opening a later offline shift
    // before closing the earlier one would violate the one-open-session
    // guard; processing all sales before a cash deposit could also falsify
    // the drawer-balance check. Keep session movements and sales ordered by
    // their local creation timestamps, and close only after prior activity.
    const results = [];
    const intentResults = [];
    const sessionsNeedingReview = new Set<string>();
    const timeline = orderPosSyncEvents(events);
    for (let index = 0; index < timeline.length;) {
      const event = timeline[index];
      if (event.value.type === "sale") {
        const batch: OfflineSalePayload[] = [];
        while (index < timeline.length && timeline[index].value.type === "sale") {
          const next = timeline[index++];
          if (next.value.type === "sale") batch.push(next.value.item);
        }
        const batchResults = await syncPosDeviceItems(device, batch);
        results.push(...batchResults);
        for (const result of batchResults) {
          const item = batch.find((candidate) => candidate.clientKey === result.clientKey);
          if (
            item?.originSessionId &&
            result.status !== "synced" &&
            result.status !== "duplicate"
          ) {
            sessionsNeedingReview.add(item.originSessionId);
          }
        }
        continue;
      }
      if (
        event.value.intent.action === "close" &&
        sessionsNeedingReview.has(event.value.intent.localSessionId)
      ) {
        intentResults.push({
          clientKey: event.value.intent.clientKey,
          status: "needsReview",
          message: "Sesi belum ditutup karena ada penjualan atau mutasi kas yang belum tersinkron. Selesaikan peninjauan lalu sinkronkan kembali.",
        });
        index++;
        continue;
      }
      const [result] = await syncPosDeviceSessionIntents(device, [event.value.intent]);
      if (result) intentResults.push(result);
      if (
        result && result.status !== "recorded" && result.status !== "duplicate"
      ) {
        sessionsNeedingReview.add(event.value.intent.localSessionId);
      }
      index++;
    }
    return Response.json(
      { ok: true, data: results, intentResults },
      { headers: POS_API_CORS_HEADERS },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(
        { ok: false, code: error.code, message: error.message },
        { status: APP_ERROR_STATUS[error.code] ?? 400, headers: POS_API_CORS_HEADERS },
      );
    }
    log.error("pos_device.sync_failed", undefined, error);
    return Response.json(
      { ok: false, code: "INTERNAL", message: "Terjadi kesalahan pada server." },
      { status: 500, headers: POS_API_CORS_HEADERS },
    );
  }
}
