import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const scriptPath = path.resolve("scripts/verify-backup-manifest.mjs");

async function createBackupFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bisa-backup-manifest-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, "fixture.dump");
  const contents = Buffer.from("synthetic custom-format dump fixture");
  await writeFile(file, contents, { mode: 0o600 });
  await writeFile(
    `${file}.json`,
    JSON.stringify({
      version: 1,
      file: path.basename(file),
      sizeBytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
      encrypted: false,
      archiveListVerified: true,
    }),
    { mode: 0o600 },
  );
  return file;
}

function verify(file: string, allowUnverified = false) {
  return spawnSync(process.execPath, [scriptPath, file], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...(allowUnverified ? { RESTORE_ALLOW_UNVERIFIED_BACKUP: "1" } : {}),
    },
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("backup manifest verification", () => {
  it("accepts a dump whose size and SHA-256 match its sidecar", async () => {
    const file = await createBackupFixture();
    const result = verify(file);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Manifest dan SHA-256 cocok");
  });

  it("rejects content changed after the manifest was written", async () => {
    const file = await createBackupFixture();
    await writeFile(file, "changed fixture");
    const result = verify(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SHA-256 dump berbeda");
  });

  it("rejects a legacy dump without metadata unless explicitly overridden", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "bisa-legacy-backup-test-"));
    tempDirs.push(dir);
    const file = path.join(dir, "legacy.dump");
    await writeFile(file, "legacy fixture", { mode: 0o600 });

    expect(verify(file).status).toBe(1);
    expect(verify(file, true).status).toBe(0);
  });
});
