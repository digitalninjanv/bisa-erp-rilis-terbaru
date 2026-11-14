import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint publik untuk mengunduh installer Bisa POS Desktop.
 * Mendukung format: rpm, appimage, deb, exe, msi.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ format: string }> },
) {
  const { format } = await context.params;
  const normalized = format.toLowerCase().trim();

  const searchDirs: { dir: string; ext: string }[] = [];
  const root = process.cwd();

  if (normalized === "rpm") {
    searchDirs.push({ dir: join(root, "src-tauri/target/release/bundle/rpm"), ext: ".rpm" });
  } else if (normalized === "appimage") {
    searchDirs.push({ dir: join(root, "src-tauri/target/release/bundle/appimage"), ext: ".AppImage" });
  } else if (normalized === "deb") {
    searchDirs.push({ dir: join(root, "src-tauri/target/release/bundle/deb"), ext: ".deb" });
  } else if (normalized === "exe" || normalized === "msi") {
    searchDirs.push({ dir: join(root, "src-tauri/target/release/bundle/nsis"), ext: ".exe" });
    searchDirs.push({ dir: join(root, "src-tauri/target/release/bundle/msi"), ext: ".msi" });
  }

  const releaseDir = process.env.BISA_POS_RELEASE_DIR?.trim();
  if (releaseDir && existsSync(releaseDir)) {
    searchDirs.unshift({ dir: releaseDir, ext: `.${normalized}` });
  }

  for (const { dir, ext } of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir);
      const match = files.find(
        (f) =>
          f.toLowerCase().endsWith(ext.toLowerCase()) &&
          !f.endsWith(".sig") &&
          !f.endsWith(".tar.gz"),
      );
      if (match) {
        const fullPath = join(dir, match);
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
      // Abaikan dan coba direktori berikutnya
    }
  }

  return Response.json(
    {
      ok: false,
      message: `Paket installer format ${format} belum dibuat atau belum tersedia di server.`,
      availableFormats: ["rpm", "appimage", "deb"],
    },
    { status: 404 },
  );
}
