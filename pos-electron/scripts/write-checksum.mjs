/**
 * Tulis .sha256 untuk artefak electron-builder. Dipanggil sesudah
 * `electron-builder` agar checksum tidak pernah tertinggal dari AppImage/NSIS
 * yang baru dibangun.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "..", "..", "dist-release", "pos-electron");
let written = 0;
for (const file of readdirSync(output)) {
  if (!/\.(AppImage|exe)$/i.test(file)) continue;
  const hash = createHash("sha256").update(readFileSync(join(output, file))).digest("hex");
  writeFileSync(join(output, `${file}.sha256`), `${hash}  ${file}\n`);
  written += 1;
}
console.log(`checksum: ${written} artefak ditulis`);
