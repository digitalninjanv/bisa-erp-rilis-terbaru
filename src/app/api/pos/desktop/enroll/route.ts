import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolvePosDevice } from "@/server/pos-device";
import { enrollPosDesktopTerminal } from "@/server/pos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  companyId: z.string().min(1).max(128),
  installationId: z.string().uuid(),
});

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Auto-enrol after Better Auth login; only Rust receives the device token. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonError("Asal permintaan tidak diizinkan.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Permintaan pendaftaran terminal tidak valid.", 400);
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return jsonError("Perusahaan atau identitas instalasi tidak valid.", 400);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return jsonError("Sesi masuk sudah berakhir. Masuk kembali.", 401);

  const currentDevice = await resolvePosDevice(request);
  if (currentDevice && currentDevice.companyId !== parsed.data.companyId) {
    return jsonError("Terminal ini sudah terikat ke perusahaan lain. Hubungi supervisor untuk mengganti perusahaan terminal.", 409);
  }

  try {
    const enrolled = await enrollPosDesktopTerminal({
      companyId: parsed.data.companyId,
      userId: session.user.id,
      installationId: parsed.data.installationId,
      currentTerminalId: currentDevice?.terminalId ?? null,
    });
    return Response.json({ ok: true, data: enrolled }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Terminal POS tidak dapat didaftarkan.";
    const status = message.includes("tidak memiliki akses") ? 403 : message.includes("sudah") ? 409 : 400;
    return jsonError(message, status);
  }
}
