import { AppError, type AppErrorCode } from "@/lib/errors";
import { log } from "@/lib/log";
import {
  POS_API_CORS_HEADERS,
  readPosDeviceSnapshot,
  resolvePosDevice,
} from "@/server/pos-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POS Native Langkah 1 — GET /api/pos/snapshot (RENCANA-TAURI D2/D7).
 *
 * Snapshot terminal untuk aplikasi desktop: katalog aktif +
 * harga jual + stok gudang bawaan + metode pembayaran aktif, dibaca
 * dari fungsi domain katalog yang sama dengan terminal web.
 * Autentikasi = token perangkat (Bearer) per-terminal dari
 * registry server (Langkah 6) — BUKAN sesi peramban.
 *
 * Langkah 3: parameter `?cursor=<ISO>` meminta DELTA sejak kursor
 * yang diterbitkan snapshot sebelumnya (`mode: "delta"` + hanya
 * baris berubah + `removedProductIds`). Kursor tidak valid/terlalu
 * tua atau perubahan terlalu besar → snapshot PENUH eksplisit
 * (`mode: "full"`). Logika penuh/delta hidup di `pos-device.ts`.
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

export async function GET(request: Request) {
  const device = await resolvePosDevice(request);
  if (!device) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED", message: "Token perangkat tidak dikenal." },
      { status: 401, headers: POS_API_CORS_HEADERS },
    );
  }
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    const snapshot = await readPosDeviceSnapshot(device, cursor);
    return Response.json(
      { ok: true, data: snapshot },
      { headers: POS_API_CORS_HEADERS },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(
        { ok: false, code: error.code, message: error.message },
        { status: APP_ERROR_STATUS[error.code] ?? 400, headers: POS_API_CORS_HEADERS },
      );
    }
    log.error("pos_device.snapshot_failed", undefined, error);
    return Response.json(
      { ok: false, code: "INTERNAL", message: "Terjadi kesalahan pada server." },
      { status: 500, headers: POS_API_CORS_HEADERS },
    );
  }
}
