import { z } from "zod";
import { AppError, type AppErrorCode } from "@/lib/errors";
import { log } from "@/lib/log";
import { getPosDeviceCashSessionSummary } from "@/server/pos";
import { POS_API_CORS_HEADERS, resolvePosDevice } from "@/server/pos-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_ERROR_STATUS: Partial<Record<AppErrorCode, number>> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

const querySchema = z.object({ sessionId: z.string().uuid() });

function jsonError(message: string, status: number, code = "ERROR") {
  return Response.json(
    { ok: false, code, message },
    { status, headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
}

/** Saldo sesi resmi untuk ditampilkan pada hitung kas terminal desktop. */
export async function GET(request: Request) {
  const device = await resolvePosDevice(request);
  if (!device) return jsonError("Token perangkat tidak dikenal.", 401, "UNAUTHORIZED");

  const parsed = querySchema.safeParse({
    sessionId: new URL(request.url).searchParams.get("sessionId"),
  });
  if (!parsed.success) return jsonError("ID sesi kas tidak valid.", 400, "VALIDATION");

  try {
    const data = await getPosDeviceCashSessionSummary(device, parsed.data.sessionId);
    if (!data) return jsonError("Sesi kas tidak ditemukan.", 404, "NOT_FOUND");
    return Response.json(
      { ok: true, data },
      { headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonError(
        error.message,
        APP_ERROR_STATUS[error.code] ?? 400,
        error.code,
      );
    }
    log.error("pos_device.cash_session_summary_failed", {
      companyId: device.companyId,
      terminalId: device.terminalId,
    }, error);
    return jsonError("Ringkasan sesi kas belum dapat dimuat dari server.", 500, "INTERNAL");
  }
}
