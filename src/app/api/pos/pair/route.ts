import { log } from "@/lib/log";
import {
  pairAttemptAllowed,
  pairAttemptSource,
  recordPairFailure,
  resetPairFailures,
} from "@/lib/pair-throttle";
import { POS_API_CORS_HEADERS } from "@/server/pos-device";
import { consumePairingCode } from "@/server/pos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POS Native Langkah 6 — POST /api/pos/pair (RENCANA-TAURI D7,
 * pemasangan ala Accurate).
 *
 * Terminal yang belum terpasang menukar KODE PASANGAN sekali pakai
 * (diterbitkan admin dari halaman Terminal desktop POS web, umur
 * 15 menit) menjadi TOKEN perangkat per-terminal. Tanpa header
 * Authorization — kode itu sendiri kredensialnya. Kode tidak
 * dikenal / sudah terpakai / kedaluwarsa / terminal dicabut semua
 * dijawab 401 yang sama, tanpa membedakan sebab. Token hanya
 * dikembalikan di respons ini; server menyimpan digest-nya saja.
 * Terminal menyimpan token di keychain OS (D5).
 */

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, code: "VALIDATION", message: "Badan permintaan bukan JSON yang valid." },
      { status: 400, headers: POS_API_CORS_HEADERS },
    );
  }
  const code =
    typeof body === "object" && body !== null && "code" in body
      ? String((body as { code: unknown }).code ?? "")
      : "";
  if (!code.trim()) {
    return Response.json(
      { ok: false, code: "VALIDATION", message: "Kode pasangan wajib diisi." },
      { status: 400, headers: POS_API_CORS_HEADERS },
    );
  }
  // AUD-015: sumber yang melampaui batas percobaan gagal menerima 401
  // yang sama persis dengan kode tidak berlaku — tanpa sinyal beda.
  const source = pairAttemptSource(request);
  if (!pairAttemptAllowed(source)) {
    return Response.json(
      {
        ok: false,
        code: "UNAUTHORIZED",
        message: "Kode pasangan tidak berlaku (tidak dikenal, sudah terpakai, atau kedaluwarsa).",
      },
      { status: 401, headers: POS_API_CORS_HEADERS },
    );
  }
  try {
    const result = await consumePairingCode(code);
    if (!result) {
      recordPairFailure(source);
      return Response.json(
        {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Kode pasangan tidak berlaku (tidak dikenal, sudah terpakai, atau kedaluwarsa).",
        },
        { status: 401, headers: POS_API_CORS_HEADERS },
      );
    }
    resetPairFailures(source);
    return Response.json(
      {
        ok: true,
        data: {
          token: result.token,
          terminal: {
            id: result.terminal.terminalId,
            name: result.terminal.terminalName,
            companyId: result.terminal.companyId,
            warehouseId: result.terminal.warehouseId,
            userId: result.terminal.userId,
          },
        },
      },
      { headers: POS_API_CORS_HEADERS },
    );
  } catch (error) {
    log.error("pos_device.pair_failed", undefined, error);
    return Response.json(
      { ok: false, code: "INTERNAL", message: "Terjadi kesalahan pada server." },
      { status: 500, headers: POS_API_CORS_HEADERS },
    );
  }
}
