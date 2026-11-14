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

describe("production release operational scripts", () => {
  it("packages backup, restore, credential, crypto, and drill dependencies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-release-ops-"));
    tempDirs.push(root);
    const dirs = [
      ".next/standalone/.next/server",
      ".next/standalone/node_modules",
      ".next/standalone/backups",
      ".next/standalone/fixture-data",
      ".next/static",
      "public",
      "src/db/migrations",
      "node_modules/drizzle-orm",
      "node_modules/postgres",
      "deploy/systemd",
      "scripts",
    ];
    await Promise.all(dirs.map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ version: "9.8.7" }));
    await fs.writeFile(path.join(root, ".next/standalone/server.js"), "// fixture");
    await fs.writeFile(path.join(root, ".next/standalone/backups/private.dump"), "synthetic backup sentinel");
    await fs.writeFile(path.join(root, ".next/standalone/fixture-data/private.dump.enc"), "synthetic encrypted backup sentinel");
    await fs.writeFile(path.join(root, "deploy/build-release.sh"), await fs.readFile(path.join(sourceRoot, "deploy/build-release.sh")));
    await fs.writeFile(path.join(root, "deploy/migrate.mjs"), "// fixture\n");

    for (const file of ["backup.sh", "restore.sh", "restore-drill.sh", "backup-crypto.mjs", "verify-backup-manifest.mjs"]) {
      await fs.writeFile(path.join(root, "scripts", file), `# fixture ${file}\n`);
    }
    for (const file of ["install.sh", "update.sh", "backup-run.sh", "backup-credentials.sh"]) {
      await fs.writeFile(path.join(root, "deploy", file), `# fixture ${file}\n`);
    }
    await fs.writeFile(path.join(root, "deploy/systemd/bisa-erp-backup.service"), "[Service]\n");
    await fs.writeFile(path.join(root, "deploy/systemd/bisa-erp-restore-drill.service"), "[Service]\n");
    await fs.writeFile(path.join(root, "migrate.mjs"), "// fixture\n");

    execFileSync("bash", ["deploy/build-release.sh", "--skip-build"], {
      cwd: root,
      stdio: "pipe",
    });

    const archive = path.join(root, "dist-release/bisa-erp-9.8.7.tar.gz");
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n");
    for (const file of [
      "scripts/backup.sh",
      "scripts/restore.sh",
      "scripts/restore-drill.sh",
      "scripts/backup-crypto.mjs",
      "scripts/verify-backup-manifest.mjs",
      "deploy/backup-credentials.sh",
      "deploy/systemd/bisa-erp-backup.service",
      "deploy/systemd/bisa-erp-restore-drill.service",
    ]) {
      expect(entries).toContain(`bisa-erp-9.8.7/${file}`);
    }
    expect(entries.some((entry) => entry.startsWith("bisa-erp-9.8.7/backups/"))).toBe(false);
    expect(entries.some((entry) => entry.endsWith("private.dump.enc"))).toBe(false);
  });
});
