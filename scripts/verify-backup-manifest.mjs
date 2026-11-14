#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/verify-backup-manifest.mjs <dump-file>");
  process.exit(2);
}

const absoluteFile = path.resolve(file);
const sidecar = `${absoluteFile}.json`;
const latestManifest = path.join(path.dirname(absoluteFile), "backup-manifest.json");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

const metadataFiles = [];
if (await exists(sidecar)) metadataFiles.push(sidecar);
if (await exists(latestManifest)) metadataFiles.push(latestManifest);

let metadata;
for (const metadataFile of metadataFiles) {
  let candidate;
  try {
    candidate = await readJson(metadataFile);
  } catch {
    if (metadataFile === sidecar) {
      console.error(`Manifest backup rusak: ${sidecar}`);
      process.exit(1);
    }
    continue;
  }
  if (typeof candidate.file !== "string" || path.basename(candidate.file) !== path.basename(absoluteFile)) {
    continue;
  }
  metadata = candidate;
  break;
}

if (!metadata) {
  if (process.env.RESTORE_ALLOW_UNVERIFIED_BACKUP === "1") {
    console.warn("PERINGATAN: dump tidak memiliki manifest yang cocok; operator melewati pemeriksaan hash secara eksplisit.");
    process.exit(0);
  }
  console.error("Restore ditolak: manifest/hash untuk dump ini tidak ditemukan. Untuk dump lama yang sudah diverifikasi terpisah, set RESTORE_ALLOW_UNVERIFIED_BACKUP=1.");
  process.exit(1);
}

const expectedSize = metadata.sizeBytes ?? metadata.bytes;
if (!Number.isSafeInteger(expectedSize) || typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(metadata.sha256)) {
  console.error("Restore ditolak: manifest tidak memiliki ukuran atau SHA-256 yang valid.");
  process.exit(1);
}

const [fileStat, digest] = await Promise.all([
  stat(absoluteFile),
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absoluteFile);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  }),
]);

if (fileStat.size !== expectedSize || digest.toLowerCase() !== metadata.sha256.toLowerCase()) {
  console.error("Restore ditolak: ukuran atau SHA-256 dump berbeda dari manifest.");
  process.exit(1);
}

console.log(`Manifest dan SHA-256 cocok: ${path.basename(absoluteFile)}`);
