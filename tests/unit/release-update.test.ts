import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const sourceRoot = process.cwd();

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("production release update recovery", () => {
  it("switches back when service restart fails before any migration is applied", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-update-recovery-"));
    tempDirs.push(root);

    const bin = path.join(root, "bin");
    const releaseRoot = path.join(root, "releases");
    const previousRelease = path.join(releaseRoot, "bisa-erp-1");
    const stagedRoot = path.join(root, "staged");
    const nextRelease = path.join(stagedRoot, "bisa-erp-2");
    const backupDir = path.join(root, "backups");
    const configDir = path.join(root, "config");
    const logDir = path.join(root, "logs");
    const restartCountFile = path.join(root, "restart-count");

    await Promise.all([
      fs.mkdir(bin, { recursive: true }),
      fs.mkdir(path.join(previousRelease, "deploy"), { recursive: true }),
      fs.mkdir(path.join(nextRelease, "deploy"), { recursive: true }),
      fs.mkdir(backupDir, { recursive: true }),
      fs.mkdir(configDir, { recursive: true }),
      fs.mkdir(logDir, { recursive: true }),
    ]);
    await fs.writeFile(path.join(previousRelease, "VERSION"), "1");
    await fs.writeFile(path.join(nextRelease, "VERSION"), "2");
    await fs.writeFile(path.join(nextRelease, "migrate.mjs"), "// simulated release migration\n");
    await fs.writeFile(path.join(configDir, "bisa-erp.env"), "PORT=39991\n");
    await fs.writeFile(
      path.join(previousRelease, "deploy/backup-run.sh"),
      `#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p "$BISA_BACKUP_DIR"\nprintf synthetic > "$BISA_BACKUP_DIR/bisa-pre-update.dump.enc"\n`,
      { mode: 0o755 },
    );

    const current = path.join(releaseRoot, "current");
    await fs.symlink(previousRelease, current);

    const fakes: Array<[string, string]> = [
      ["id", `#!/usr/bin/env bash\n[[ "$1" == -u ]] && { echo 0; exit 0; }\nexec /usr/bin/id "$@"\n`],
      ["chown", "#!/usr/bin/env bash\nexit 0\n"],
      [
        "node",
        `#!/usr/bin/env bash\nif [[ "$1" == *migrate.mjs ]]; then echo 'MIGRASI sebelum=5 sesudah=5 diterapkan=0'; exit 0; fi\necho "unexpected fake node invocation: $*" >&2\nexit 1\n`,
      ],
      [
        "systemctl",
        `#!/usr/bin/env bash\nif [[ "$1" != restart ]]; then exit 0; fi\nn="$(cat "${restartCountFile}" 2>/dev/null || echo 0)"\nn=$((n + 1))\nprintf '%s' "$n" > "${restartCountFile}"\n[[ "$n" -gt 1 ]]\n`,
      ],
    ];
    await Promise.all(
      fakes.map(async ([name, source]) => {
        const file = path.join(bin, name);
        await fs.writeFile(file, source, { mode: 0o755 });
      }),
    );

    const archive = path.join(root, "bisa-erp-2.tar.gz");
    execFileSync("tar", ["-czf", archive, "bisa-erp-2"], { cwd: stagedRoot });

    const result = spawnSync("bash", [path.join(sourceRoot, "deploy/update.sh"), archive], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        BISA_ROOT: releaseRoot,
        BISA_CONFDIR: configDir,
        BISA_BACKUP_DIR: backupDir,
        BISA_LOG_DIR: logDir,
        BISA_SERVICE: "bisa-erp-test",
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(await fs.realpath(current)).toBe(previousRelease);
    expect(await fs.readFile(restartCountFile, "utf8")).toBe("2");
    expect(result.stdout).toContain("restart layanan GAGAL");
    expect(result.stdout).toContain("ROLLBACK SELESAI");
  });
});
