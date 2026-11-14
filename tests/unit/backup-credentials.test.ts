import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const helper = path.join(process.cwd(), "deploy/backup-credentials.sh");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-backup-credentials-"));
  tempDirs.push(dir);
  const config = path.join(dir, "backup.conf");
  const credential = path.join(dir, "backup-passphrase");
  return { dir, config, credential };
}

function migrate(config: string, credential: string) {
  execFileSync("bash", [
    "-c",
    'source "$1"; migrate_backup_credential "$2" "$3"',
    "_",
    helper,
    config,
    credential,
  ]);
}

describe("backup passphrase migration", () => {
  it("moves the legacy value verbatim into a private file and removes it from config", async () => {
    const files = await fixture();
    const passphrase = "synthetic key $money # with spaces";
    await fs.writeFile(files.config, `BACKUP_DIR=/tmp/backups\nBACKUP_PASSPHRASE='${passphrase}'\n`, { mode: 0o600 });

    migrate(files.config, files.credential);

    await expect(fs.readFile(files.credential, "utf8")).resolves.toBe(passphrase);
    await expect(fs.readFile(files.config, "utf8")).resolves.not.toContain("BACKUP_PASSPHRASE");
    const mode = (await fs.stat(files.credential)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("removes an empty legacy setting without creating a credential", async () => {
    const files = await fixture();
    await fs.writeFile(files.config, "BACKUP_PASSPHRASE=\nBACKUP_DIR=/tmp/backups\n", { mode: 0o600 });

    migrate(files.config, files.credential);

    await expect(fs.readFile(files.config, "utf8")).resolves.not.toContain("BACKUP_PASSPHRASE");
    await expect(fs.access(files.credential)).rejects.toThrow();
  });

  it("rejects ambiguous keys without overwriting either value", async () => {
    const files = await fixture();
    await fs.writeFile(files.config, "BACKUP_PASSPHRASE='legacy-key'\n");
    await fs.writeFile(files.credential, "separate-key", { mode: 0o600 });

    expect(() => migrate(files.config, files.credential)).toThrow();
    await expect(fs.readFile(files.config, "utf8")).resolves.toContain("legacy-key");
    await expect(fs.readFile(files.credential, "utf8")).resolves.toBe("separate-key");
  });
});
