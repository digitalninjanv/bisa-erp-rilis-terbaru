import { AppError, type AppErrorCode } from "@/lib/errors";
import { log } from "@/lib/log";
import type { OfflineSalePayload } from "@/lib/pos-offline";
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
    const results = await syncPosDeviceItems(
      device,
      parsed.data.items as OfflineSalePayload[],
    );
    const intentResults = parsed.data.sessionIntents?.length
      ? await syncPosDeviceSessionIntents(device, parsed.data.sessionIntents)
      : [];
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
