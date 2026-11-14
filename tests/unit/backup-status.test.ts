import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluateBackupStatus,
  getBackupStatus,
  type BackupManifest,
  type RestoreDrillManifest,
} from "@/server/backup-status";

// A-28 Tahap 6 (H-X-01) — kontrak halaman Status sistem: status
// diturunkan HANYA dari manifest skrip. Tanpa manifest = "missing"
// (belum ada catatan) — tidak pernah dianggap segar; manifest basi =
// "stale"; latihan gagal = "failed" walau masih baru.

const NOW = new Date("2026-11-07T12:00:00Z");

function backupManifest(finishedAt: string): BackupManifest {
  return {
    version: 1,
    file: "bisa-20261107-020000.dump",
    finishedAt,
    sizeBytes: 4,
    sha256: "a".repeat(64),
    encrypted: false,
  };
}

function drillManifest(at: string, ok = true): RestoreDrillManifest {
  return {
    version: 1,
    at,
    sourceFile: "bisa-20261107-020000.dump",
    targetDatabase: "bisa_restore_test_20261107",
    ok,
    checks: {
      accounts: { source: 124, restored: 124 },
      products: { source: 65, restored: 65 },
      inventoryValue: { source: "28349600.0000", restored: "28349600.0000" },
      trialBalanceDifference: { source: "0.0000", restored: "0.0000" },
    },
  };
}

function evaluate(backup: BackupManifest | null, drill: RestoreDrillManifest | null) {
  return evaluateBackupStatus({
    backupManifest: backup,
    drillManifest: drill,
    now: NOW,
    maxAgeHours: 26,
    drillMaxAgeDays: 92,
    manifestDir: "/tmp/contoh",
  });
}

describe("evaluateBackupStatus (H-X-01)", () => {
  it("tanpa manifest: keduanya missing — tidak ada status yang dikarang", () => {
    const status = evaluate(null, null);
    expect(status.backup.state).toBe("missing");
    expect(status.backup.manifest).toBeNull();
    expect(status.drill.state).toBe("missing");
  });

  it("backup 10 jam lalu segar; 30 jam lalu basi (ambang 26 jam)", () => {
    expect(evaluate(backupManifest("2026-11-07T02:00:00Z"), null).backup.state).toBe("fresh");
    expect(evaluate(backupManifest("2026-11-06T06:00:00Z"), null).backup.state).toBe("stale");
  });

  it("tepat di ambang masih segar (inklusif)", () => {
    expect(evaluate(backupManifest("2026-11-06T10:00:00Z"), null).backup.state).toBe("fresh");
  });

  it("latihan 10 hari lalu & ok = fresh; 100 hari lalu = stale; gagal = failed walau baru", () => {
    expect(evaluate(null, drillManifest("2026-10-28T12:00:00Z")).drill.state).toBe("fresh");
    expect(evaluate(null, drillManifest("2026-07-30T12:00:00Z")).drill.state).toBe("stale");
    expect(evaluate(null, drillManifest("2026-11-07T11:00:00Z", false)).drill.state).toBe("failed");
  });
});

describe("getBackupStatus — baca manifest dari disk", () => {
  let dir = "";

  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("direktori kosong → missing; manifest tertulis → terbaca & dinilai", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-backup-status-"));
    const empty = await getBackupStatus({ dir, now: NOW });
    expect(empty.backup.state).toBe("missing");
    expect(empty.drill.state).toBe("missing");
    expect(empty.manifestDir).toBe(dir);

    await fs.writeFile(path.join(dir, "bisa-20261107-020000.dump"), "dump");
    await fs.writeFile(
      path.join(dir, "backup-manifest.json"),
      JSON.stringify(backupManifest("2026-11-07T02:00:00Z")),
    );
    await fs.writeFile(
      path.join(dir, "restore-drill-manifest.json"),
      JSON.stringify(drillManifest("2026-11-01T12:00:00Z")),
    );
    const filled = await getBackupStatus({ dir, now: NOW });
    expect(filled.backup.state).toBe("fresh");
    expect(filled.backup.manifest?.file).toBe("bisa-20261107-020000.dump");
    expect(filled.backup.artifactAvailable).toBe(true);
    expect(filled.drill.state).toBe("fresh");
    const legacyChecks = filled.drill.manifest?.checks;
    expect(legacyChecks && !("postedJournals" in legacyChecks) ? legacyChecks.products.restored : null).toBe(65);

    await fs.rm(path.join(dir, "bisa-20261107-020000.dump"));
    const removed = await getBackupStatus({ dir, now: NOW });
    expect(removed.backup.state).toBe("missing");
    expect(removed.backup.manifest?.file).toBe("bisa-20261107-020000.dump");
    expect(removed.backup.artifactAvailable).toBe(false);
  });

  it("menolak manifest yang menunjuk keluar dari direktori backup", async () => {
    const unsafe = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-backup-status-unsafe-"));
    try {
      await fs.writeFile(
        path.join(unsafe, "backup-manifest.json"),
        JSON.stringify({ ...backupManifest("2026-11-07T02:00:00Z"), file: "../outside.dump" }),
      );
      const status = await getBackupStatus({ dir: unsafe, now: NOW });
      expect(status.backup.state).toBe("missing");
      expect(status.backup.artifactAvailable).toBe(false);
    } finally {
      await fs.rm(unsafe, { recursive: true, force: true });
    }
  });

  it("manifest rusak bentuknya diperlakukan sebagai tidak ada catatan", async () => {
    await fs.writeFile(path.join(dir, "backup-manifest.json"), JSON.stringify({ file: 123 }));
    const status = await getBackupStatus({ dir, now: NOW });
    expect(status.backup.state).toBe("missing");
    expect(status.backup.manifest).toBeNull();

    await fs.writeFile(
      path.join(dir, "backup-manifest.json"),
      JSON.stringify({ ...backupManifest("2026-11-07T02:00:00Z"), sha256: "not-a-sha256" }),
    );
    expect((await getBackupStatus({ dir, now: NOW })).backup.manifest).toBeNull();
  });

  it("membaca manifest drill v2 dengan pemeriksaan integritas hasil restore", async () => {
    const v2Dir = await fs.mkdtemp(path.join(os.tmpdir(), "bisa-backup-status-v2-"));
    try {
      await fs.writeFile(
        path.join(v2Dir, "restore-drill-manifest.json"),
        JSON.stringify({
          version: 2,
          at: "2026-11-07T11:00:00Z",
          sourceFile: "bisa-20261107-020000.dump",
          targetDatabase: "bisa_restore_test_20261107",
          ok: true,
          checks: {
            accounts: 124,
            products: 65,
            inventoryValue: "28349600.0000",
            postedJournals: 320,
            unbalancedJournals: 0,
            orphanJournalLines: 0,
          },
        }),
      );
      const status = await getBackupStatus({ dir: v2Dir, now: NOW });
      expect(status.drill.state).toBe("fresh");
      expect(status.drill.manifest?.checks).toMatchObject({
        accounts: 124,
        postedJournals: 320,
        unbalancedJournals: 0,
      });

      await fs.writeFile(
        path.join(v2Dir, "restore-drill-manifest.json"),
        JSON.stringify({
          version: 2,
          at: "2026-11-07T11:00:00Z",
          sourceFile: "bisa-20261107-020000.dump",
          targetDatabase: "bisa_restore_test_20261107",
          ok: true,
          checks: {
            accounts: 124,
            products: 65,
            inventoryValue: "28349600.0000",
            postedJournals: 320,
            unbalancedJournals: -1,
            orphanJournalLines: 0,
          },
        }),
      );
      expect((await getBackupStatus({ dir: v2Dir, now: NOW })).drill.state).toBe("missing");
    } finally {
      await fs.rm(v2Dir, { recursive: true, force: true });
    }
  });
});
