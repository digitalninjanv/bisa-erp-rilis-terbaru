import { log } from "@/lib/log";
import { withCompanyReadOnly } from "@/db/tenant";
import { POS_API_CORS_HEADERS, resolvePosDevice } from "@/server/pos-device";
import {
  artifactFileName,
  decideDesktopUpdate,
  getDesktopReleaseSettings,
  releaseDir,
  resolveReleaseArtifact,
  rolloutBucket,
} from "@/server/pos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POS Native Langkah 7 — GET /api/pos/update/:target/:arch/:version
 * (RENCANA-TAURI D4): endpoint DINAMIS updater Tauri v2.
 *
 * Kontraknya adalah kontrak updater, BUKAN amplop { ok, data }
 * jalur /api/pos/* lain: jawaban adalah dokumen JSON updater
 * { version, notes, pub_date, url, signature } atau 204 (tidak ada
 * pembaruan). Klien membangun URL ini saat runtime
 * (updater_builder endpoints + header Authorization) karena
 * keputusannya PER TERMINAL:
 * - autentikasi token perangkat registry (Langkah 6) — tanpa token
 *   / terminal dicabut → 401;
 * - versi terminal >= versi rilis perusahaan → 204;
 * - di bawah versi minimum → tawaran WAJIB (rollout diabaikan,
 *   kolom tambahan `mandatory: true` untuk UI klien);
 * - selain itu bucket deterministik per (perusahaan, terminal,
 *   versi) melawan persen rollout pengaturan rilis;
 * - artefak + .sig harus benar-benar ada di direktori rilis
 *   (env BISA_POS_RELEASE_DIR) — tanpa itu 204, bukan janji kosong.
 */

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ target: string; arch: string; version: string }> },
) {
  const { target, arch, version } = await context.params;
  if (!artifactFileName(target, arch)) {
    return new Response(null, { status: 404, headers: POS_API_CORS_HEADERS });
  }
  const device = await resolvePosDevice(request);
  if (!device) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED", message: "Token perangkat tidak dikenal." },
      { status: 401, headers: POS_API_CORS_HEADERS },
    );
  }
  try {
    const settings = await withCompanyReadOnly(device.companyId, (tx) =>
      getDesktopReleaseSettings(tx, device.companyId),
    );
    const decision = decideDesktopUpdate({
      currentVersion: version,
      settings,
      bucket: settings
        ? rolloutBucket(device.companyId, device.terminalId, settings.version)
        : 0,
    });
    if (!decision.offer || !settings) {
      return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
    }
    const dir = releaseDir();
    const artifact = dir ? resolveReleaseArtifact(dir, target, arch) : null;
    if (!artifact) {
      log.warn("pos_device.update_artifact_missing", {
        companyId: device.companyId,
        terminalId: device.terminalId,
        target,
        arch,
        version: settings.version,
      });
      return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
    }
    const origin = new URL(request.url).origin;
    return Response.json(
      {
        version: settings.version,
        notes: settings.notes ?? "",
        pub_date: settings.publishedAt.toISOString(),
        url: `${origin}/api/pos/update/download/${target}/${arch}`,
        signature: artifact.signature,
        mandatory: decision.mandatory,
      },
      { headers: POS_API_CORS_HEADERS },
    );
  } catch (error) {
    log.error("pos_device.update_check_failed", undefined, error);
    return Response.json(
      { ok: false, code: "INTERNAL", message: "Terjadi kesalahan pada server." },
      { status: 500, headers: POS_API_CORS_HEADERS },
    );
  }
}
