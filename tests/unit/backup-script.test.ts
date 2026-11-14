import { execFileSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeBackupSandbox() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-backup-script-"));
  tempDirs.push(dir);
  const root = path.join(dir, "repo");
  const scripts = path.join(root, "scripts");
  const bin = path.join(dir, "bin");
  const backupDir = path.join(dir, "backups");
  await fs.mkdir(scripts, { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.copyFile(path.join(process.cwd(), "scripts/backup.sh"), path.join(scripts, "backup.sh"));
  await fs.copyFile(path.join(process.cwd(), "scripts/backup-crypto.mjs"), path.join(scripts, "backup-crypto.mjs"));

  const pgDumpMarker = path.join(dir, "pg-dump-called");
  const pgDump = `#!/bin/sh
touch '${pgDumpMarker}'
for arg do
  case "$arg" in --file=*) output="${"$"}{arg#--file=}" ;; esac
done
test -n "$output" || exit 2
sleep "$BACKUP_TEST_DUMP_DELAY"
printf 'test archive bytes' > "$output"
`;
  const pgRestore = "#!/bin/sh\nexit 0\n";
  for (const [name, content] of [
    ["pg_dump", pgDump],
    ["pg_restore", pgRestore],
  ] as const) {
    const file = path.join(bin, name);
    await fs.writeFile(file, content, { mode: 0o700 });
  }
  return { dir, root, bin, backupDir, pgDumpMarker };
}

function runBackup(input: {
  root: string;
  bin: string;
  backupDir: string;
  passphrase?: string;
  passphraseFile?: string;
  dumpDelay?: string;
}) {
  const env = { ...process.env };
  delete env.BACKUP_PASSPHRASE;
  Object.assign(env, {
    PATH: `${input.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    DIRECT_URL: "postgres://backup-test.invalid/unused",
    BACKUP_DIR: input.backupDir,
    BACKUP_TEST_DUMP_DELAY: input.dumpDelay ?? "0",
    ...(input.passphraseFile
      ? { BACKUP_PASSPHRASE_FILE: input.passphraseFile }
      : { BACKUP_PASSPHRASE: input.passphrase ?? "" }),
  });
  try {
    return {
      status: 0,
      output: execFileSync("bash", [path.join(input.root, "scripts/backup.sh")], {
        cwd: input.root,
        encoding: "utf8",
        env,
      }),
    };
  } catch (error) {
    const failure = error as Error & { status?: number; stderr?: string; stdout?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

function runBackupAsync(input: {
  root: string;
  bin: string;
  backupDir: string;
  passphrase: string;
  dumpDelay: string;
}): Promise<{ status: number | null; output: string }> {
  const env = {
    ...process.env,
    PATH: `${input.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    DIRECT_URL: "postgres://backup-test.invalid/unused",
    BACKUP_DIR: input.backupDir,
    BACKUP_PASSPHRASE: input.passphrase,
    BACKUP_TEST_DUMP_DELAY: input.dumpDelay,
  };
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(input.root, "scripts/backup.sh")], {
      cwd: input.root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}

describe("scripts/backup.sh encryption policy", () => {
  it("fails before pg_dump when the required passphrase is empty", async () => {
    const sandbox = await makeBackupSandbox();
    const result = runBackup(sandbox);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("backup plaintext tidak diizinkan");
    await expect(fs.access(sandbox.pgDumpMarker)).rejects.toThrow();
    await expect(fs.access(sandbox.backupDir)).rejects.toThrow();
  });

  it("publishes only an encrypted artifact and manifest when configured", async () => {
    const sandbox = await makeBackupSandbox();
    const result = runBackup({ ...sandbox, passphrase: "test-secret-from-isolated-fixture" });

    expect(result.status).toBe(0);
    const files = await fs.readdir(sandbox.backupDir);
    const dump = files.find((file) => file.endsWith(".dump.enc"));
    expect(dump).toBeDefined();
    expect(files.some((file) => file.endsWith(".dump"))).toBe(false);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    const manifest = JSON.parse(
      await fs.readFile(path.join(sandbox.backupDir, "backup-manifest.json"), "utf8"),
    ) as { file: string; encrypted: boolean };
    expect(manifest).toMatchObject({
      file: dump,
      encrypted: true,
    });
    const encrypted = path.join(sandbox.backupDir, dump!);
    const decrypted = path.join(sandbox.dir, "round-trip.dump");
    execFileSync("node", [path.join(sandbox.root, "scripts/backup-crypto.mjs"), "decrypt", encrypted, decrypted], {
      env: { ...process.env, BACKUP_PASSPHRASE: "test-secret-from-isolated-fixture" },
    });
    await expect(fs.readFile(decrypted, "utf8")).resolves.toBe("test archive bytes");
  });

  it("uses a credential file without passing the passphrase through the environment", async () => {
    const sandbox = await makeBackupSandbox();
    const passphraseFile = path.join(sandbox.dir, "backup-passphrase");
    await fs.writeFile(passphraseFile, "credential-file-test-secret", { mode: 0o600 });
    const result = runBackup({ ...sandbox, passphraseFile });

    expect(result.status).toBe(0);
    const files = await fs.readdir(sandbox.backupDir);
    expect(files.some((file) => file.endsWith(".dump.enc"))).toBe(true);
    expect(files).toContain("backup-manifest.json");
  });

  it("serializes overlapping backups and publishes distinct complete artifacts", async () => {
    const sandbox = await makeBackupSandbox();
    const input = {
      ...sandbox,
      passphrase: "concurrent-test-secret",
      dumpDelay: "1",
    };
    const results = await Promise.all([runBackupAsync(input), runBackupAsync(input)]);

    expect(results.map((result) => result.status)).toEqual([0, 0]);
    const files = await fs.readdir(sandbox.backupDir);
    const dumps = files.filter((file) => file.endsWith(".dump.enc"));
    expect(dumps).toHaveLength(2);
    expect(new Set(dumps).size).toBe(2);
    for (const dump of dumps) {
      expect(files).toContain(`${dump}.json`);
    }
    const manifest = JSON.parse(
      await fs.readFile(path.join(sandbox.backupDir, "backup-manifest.json"), "utf8"),
    ) as { file: string };
    expect(dumps).toContain(manifest.file);
  });
});
