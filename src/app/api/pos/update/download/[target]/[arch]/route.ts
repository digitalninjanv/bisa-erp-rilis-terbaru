import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { POS_API_CORS_HEADERS, resolvePosDevice } from "@/server/pos-device";
import { releaseDir, resolveReleaseArtifact } from "@/server/pos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POS Native Langkah 7 — GET /api/pos/update/download/:target/:arch
 *
 * Unduhan artefak pembaruan yang ditunjuk dokumen updater. Nama
 * berkas TIDAK pernah datang dari URL: pasangan (target, arch)
 * dipetakan domain ke nama kanonis di direktori rilis
 * (`resolveReleaseArtifact`), jadi tidak ada permukaan traversal.
 * Autentikasi token perangkat yang sama dengan endpoint keputusan
 * (plugin updater meneruskan header yang dikonfigurasi
 * updater_builder ke permintaan unduh juga) — artefak tidak
 * diunduh anonim.
 */

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ target: string; arch: string }> },
) {
  const { target, arch } = await context.params;
  const device = await resolvePosDevice(request);
  if (!device) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED", message: "Token perangkat tidak dikenal." },
      { status: 401, headers: POS_API_CORS_HEADERS },
    );
  }
  const dir = releaseDir();
  const artifact = dir ? resolveReleaseArtifact(dir, target, arch) : null;
  if (!artifact) {
    return new Response(null, { status: 404, headers: POS_API_CORS_HEADERS });
  }
  const stream = Readable.toWeb(createReadStream(artifact.filePath));
  return new Response(stream as unknown as BodyInit, {
    headers: {
      ...POS_API_CORS_HEADERS,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(artifact.sizeBytes),
      "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
    },
  });
}
