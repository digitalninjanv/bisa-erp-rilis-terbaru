import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const sourceRoot = process.cwd();

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("restore with a credential file", () => {
  it("decrypts to a synthetic target without exporting the passphrase", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-restore-credential-"));
    tempDirs.push(dir);
    const root = path.join(dir, "repo");
    const scripts = path.join(root, "scripts");
    const bin = path.join(dir, "bin");
    await fs.mkdir(scripts, { recursive: true });
    await fs.mkdir(bin, { recursive: true });
    for (const file of ["restore.sh", "backup-crypto.mjs", "verify-backup-manifest.mjs"]) {
      await fs.copyFile(path.join(sourceRoot, "scripts", file), path.join(scripts, file));
    }

    const secret = "restore-credential-synthetic-secret";
    const secretFile = path.join(dir, "backup-passphrase");
    await fs.writeFile(secretFile, secret, { mode: 0o600 });
    const plain = path.join(dir, "source.dump");
    const encrypted = path.join(root, "bisa-test.dump.enc");
    await fs.writeFile(plain, "synthetic archive; no database connection is used");
    const env = { ...process.env };
    delete env.BACKUP_PASSPHRASE;
    env.BACKUP_PASSPHRASE = secret;
    execFileSync("node", [path.join(scripts, "backup-crypto.mjs"), "encrypt", plain, encrypted], {
      env,
      stdio: "pipe",
    });
    delete env.BACKUP_PASSPHRASE;

    const encryptedBytes = await fs.readFile(encrypted);
    await fs.writeFile(
      `${encrypted}.json`,
      JSON.stringify({
        file: path.basename(encrypted),
        sizeBytes: encryptedBytes.length,
        sha256: createHash("sha256").update(encryptedBytes).digest("hex"),
      }),
    );

    const restoreMarker = path.join(dir, "pg-restore-arguments.txt");
    await fs.writeFile(
      path.join(bin, "pg_restore"),
      `#!/bin/sh\nlast=''\nfor arg do last="$arg"; done\nprintf '%s\\n' "$(cat "$last")" >> '${restoreMarker}'\n`,
      { mode: 0o700 },
    );

    const output = execFileSync("bash", [path.join(scripts, "restore.sh"), encrypted], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...env,
        PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        TMPDIR: dir,
        DIRECT_URL: "postgres://erp@127.0.0.1:5433/source_db",
        RESTORE_TARGET_URL: "postgres://erp@127.0.0.1:5433/restore_target",
        RESTORE_CONFIRM_TARGET: "127.0.0.1:5433/restore_target",
        BACKUP_PASSPHRASE_FILE: secretFile,
      },
    });

    expect(output).toContain("Restore selesai.");
    await expect(fs.readFile(restoreMarker, "utf8")).resolves.toContain("synthetic archive; no database connection is used");
    const remaining = await fs.readdir(dir);
    expect(remaining.some((name) => name.startsWith("bisa-restore-") && name.endsWith(".dump"))).toBe(false);
  });
});
