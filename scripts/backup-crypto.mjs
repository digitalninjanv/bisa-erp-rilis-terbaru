#!/usr/bin/env node
import { createCipheriv, createDecipheriv, pbkdf2 as pbkdf2Callback, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";

const pbkdf2 = promisify(pbkdf2Callback);
const MAGIC = Buffer.from("BISAENC1", "ascii");
const LEGACY_CBC_MAGIC = Buffer.from("Salted__", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const ITERATIONS = 600_000;

function usage() {
  console.error("Usage: BACKUP_PASSPHRASE_FILE=... node scripts/backup-crypto.mjs <encrypt|decrypt|is-v1|is-legacy-cbc> <input> [output]");
  process.exit(2);
}

async function deriveKey(salt) {
  const passphraseFile = process.env.BACKUP_PASSPHRASE_FILE;
  const passphrase = passphraseFile
    ? await readFile(passphraseFile, "utf8")
    : process.env.BACKUP_PASSPHRASE;
  if (!passphrase) throw new Error("BACKUP_PASSPHRASE wajib diatur.");
  return pbkdf2(passphrase, salt, ITERATIONS, 32, "sha256");
}

async function hasV1Header(file) {
  const handle = await open(file, "r");
  try {
    const magic = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    return bytesRead === MAGIC.length && magic.equals(MAGIC);
  } finally {
    await handle.close();
  }
}

async function hasLegacyCbcHeader(file) {
  const handle = await open(file, "r");
  try {
    const magic = Buffer.alloc(LEGACY_CBC_MAGIC.length);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    return bytesRead === LEGACY_CBC_MAGIC.length && magic.equals(LEGACY_CBC_MAGIC);
  } finally {
    await handle.close();
  }
}

async function encrypt(input, output) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const header = Buffer.concat([MAGIC, salt, iv]);
  await writeFile(output, header, { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }));
  const handle = await open(output, "a", 0o600);
  try {
    await handle.write(cipher.getAuthTag());
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function decrypt(input, output) {
  const fileSize = (await stat(input)).size;
  if (fileSize < HEADER_BYTES + TAG_BYTES) throw new Error("Berkas terenkripsi terlalu pendek atau rusak.");
  const handle = await open(input, "r");
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER_BYTES);
    tag = Buffer.alloc(TAG_BYTES);
    const headerRead = await handle.read(header, 0, HEADER_BYTES, 0);
    const tagRead = await handle.read(tag, 0, TAG_BYTES, fileSize - TAG_BYTES);
    if (headerRead.bytesRead !== HEADER_BYTES || tagRead.bytesRead !== TAG_BYTES || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Format backup terenkripsi tidak dikenal.");
    }
  } finally {
    await handle.close();
  }

  const saltStart = MAGIC.length;
  const ivStart = saltStart + SALT_BYTES;
  const key = await deriveKey(header.subarray(saltStart, ivStart));
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(ivStart), { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: fileSize - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(output, { flags: "w", mode: 0o600 }),
    );
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

const [operation, input, output] = process.argv.slice(2);
if (!operation || !input || (!["is-v1", "is-legacy-cbc"].includes(operation) && !output) || !["encrypt", "decrypt", "is-v1", "is-legacy-cbc"].includes(operation)) usage();

try {
  if (operation === "is-v1") {
    process.exitCode = (await hasV1Header(input)) ? 0 : 1;
  } else if (operation === "is-legacy-cbc") {
    process.exitCode = (await hasLegacyCbcHeader(input)) ? 0 : 1;
  } else if (operation === "encrypt") {
    await encrypt(input, output);
  } else {
    await decrypt(input, output);
  }
} catch (error) {
  console.error(`Operasi backup crypto gagal: ${error instanceof Error ? error.message : "kesalahan tidak diketahui"}`);
  process.exitCode = 1;
}
