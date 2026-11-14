import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const helper = path.join(process.cwd(), "scripts/backup-crypto.mjs");
const passphrase = "synthetic-backup-test-secret";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-backup-crypto-"));
  tempDirs.push(dir);
  const input = path.join(dir, "source.dump");
  const encrypted = path.join(dir, "source.dump.enc");
  const output = path.join(dir, "restored.dump");
  await fs.writeFile(input, Buffer.alloc(512 * 1024, 0x5a));
  return { dir, input, encrypted, output };
}

function run(args: string[], secret = passphrase) {
  return execFileSync("node", [helper, ...args], {
    env: { ...process.env, BACKUP_PASSPHRASE: secret },
    stdio: "pipe",
  });
}

describe("authenticated backup encryption", () => {
  it("round-trips a backup using a passphrase file without exporting the secret", async () => {
    const files = await fixture();
    const passphraseFile = path.join(files.dir, "credential");
    await fs.writeFile(passphraseFile, passphrase, { mode: 0o600 });
    const env = { ...process.env };
    delete env.BACKUP_PASSPHRASE;
    env.BACKUP_PASSPHRASE_FILE = passphraseFile;

    execFileSync("node", [helper, "encrypt", files.input, files.encrypted], { env, stdio: "pipe" });
    execFileSync("node", [helper, "decrypt", files.encrypted, files.output], { env, stdio: "pipe" });
    await expect(fs.readFile(files.output)).resolves.toEqual(await fs.readFile(files.input));
  });

  it("round-trips a backup with the matching passphrase", async () => {
    const files = await fixture();
    run(["encrypt", files.input, files.encrypted]);
    run(["decrypt", files.encrypted, files.output]);
    await expect(fs.readFile(files.output)).resolves.toEqual(await fs.readFile(files.input));
  });

  it("rejects a modified ciphertext before a restore can consume it", async () => {
    const files = await fixture();
    run(["encrypt", files.input, files.encrypted]);
    const bytes = await fs.readFile(files.encrypted);
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    await fs.writeFile(files.encrypted, bytes);

    expect(() => run(["decrypt", files.encrypted, files.output])).toThrow();
    await expect(fs.readFile(files.output)).rejects.toThrow();
  });

  it("rejects a wrong passphrase", async () => {
    const files = await fixture();
    run(["encrypt", files.input, files.encrypted]);
    expect(() => run(["decrypt", files.encrypted, files.output], "wrong-test-secret")).toThrow();
  });

  it("recognizes old CBC framing separately from the new authenticated format", async () => {
    const files = await fixture();
    run(["encrypt", files.input, files.encrypted]);
    expect(() => run(["is-legacy-cbc", files.encrypted])).toThrow();

    const legacy = path.join(files.dir, "legacy.dump.enc");
    await fs.writeFile(legacy, Buffer.concat([Buffer.from("Salted__"), Buffer.alloc(16)]));
    run(["is-legacy-cbc", legacy]);
  });
});
