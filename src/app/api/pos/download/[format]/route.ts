import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public download endpoint for the supported Electron desktop package.
 *
 * The retired Tauri prototype never serves from `src-tauri/target` here;
 * operators publish Electron artifacts (AppImage / NSIS .exe / .msi) into
 * `BISA_POS_RELEASE_DIR`, outside the repository. If the directory is not
 * configured or the artifact is absent, the endpoint answers 404 instead
 * of pretending a package exists.
 */
const RELEASE_FORMATS: Record<string, string> = {
  appimage: ".AppImage",
  exe: ".exe",
  msi: ".msi",
};

/**
 * Fallback unduhan untuk build resmi yang dipublikasikan sebagai aset
 * GitHub Release. Direktori lokal (`BISA_POS_RELEASE_DIR`) selalu menang;
 * fallback ini hanya dipakai bila server belum memiliki artefak lokal.
 * Hanya AppImage yang tersedia sebagai aset rilis saat ini.
 */
const GITHUB_RELEASE_FALLBACK =
  process.env.BISA_POS_DOWNLOAD_FALLBACK_URL?.trim() ||
  "https://github.com/digitalninjanv/bisa-erp-rilis-terbaru/releases/latest/download";
const FALLBACK_ASSETS: Record<string, string> = {
  appimage: "Bisa-POS-linux-x86_64.AppImage",
  exe: "Bisa-POS-windows-x86_64-setup.exe",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ format: string }> },
) {
  const { format } = await context.params;
  const normalized = format.toLowerCase().trim();
  const ext = RELEASE_FORMATS[normalized];
  const releaseDir = process.env.BISA_POS_RELEASE_DIR?.trim();

  if (ext && releaseDir && existsSync(releaseDir)) {
    try {
      const files = readdirSync(releaseDir);
      const match = files.find(
        (file) =>
          file.toLowerCase().endsWith(ext.toLowerCase()) &&
          !file.endsWith(".sig") &&
          !file.endsWith(".tar.gz"),
      );
      if (match) {
        const fullPath = join(releaseDir, match);
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          const stream = Readable.toWeb(createReadStream(fullPath));
          return new Response(stream as unknown as BodyInit, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(stat.size),
              "Content-Disposition": `attachment; filename="${match}"`,
            },
          });
        }
      }
    } catch {
      // Fall through to the explicit 404 below. A filesystem error must
      // not turn into a misleading successful download.
    }
  }

  // Fallback resmi: AppImage dipublikasikan sebagai aset GitHub Release
  // sehingga terminal tetap bisa mengunduh walau direktori rilis lokal
  // belum disiapkan di server ini.
  const fallbackAsset = FALLBACK_ASSETS[normalized];
  if (fallbackAsset && GITHUB_RELEASE_FALLBACK) {
    return Response.redirect(`${GITHUB_RELEASE_FALLBACK}/${fallbackAsset}`, 302);
  }

  return Response.json(
    {
      ok: false,
      message: `Paket installer ${format} belum tersedia. Administrator harus menerbitkan paket Electron ke BISA_POS_RELEASE_DIR.`,
      availableFormats: Object.keys(RELEASE_FORMATS),
    },
    { status: 404 },
  );
}
