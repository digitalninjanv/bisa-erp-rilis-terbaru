import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * A-28 Tahap 6 (H-X-01) — status backup & latihan restore untuk
 * Pengaturan → Status sistem.
 *
 * Sumber kebenarannya adalah MANIFEST yang ditulis skrip operasional:
 * - `backup-manifest.json` ditulis `scripts/backup.sh` setiap backup
 *   berhasil (nama berkas, waktu selesai, ukuran, sha256, enkripsi).
 * - `restore-drill-manifest.json` ditulis `scripts/restore-drill.sh`
 *   setiap latihan restore (angka verifikasi sumber vs hasil restore).
 *
 * Modul ini HANYA membaca berkas itu. Tanpa manifest, statusnya
 * "missing" — aplikasi tidak pernah mengarang backup yang tidak
 * tercatat. Ambang basi terkonfigurasi lewat env:
 * - BISA_BACKUP_MAX_AGE_HOURS (bawaan 26 — backup harian + kelonggaran)
 * - BISA_RESTORE_DRILL_MAX_AGE_DAYS (bawaan 92 — latihan triwulanan)
 * Direktori manifest: BISA_BACKUP_DIR, atau BACKUP_DIR, atau
 * `<cwd>/backups` (lokasi bawaan skrip di lingkungan dev).
 */

export type BackupManifest = {
  version: number;
  file: string;
  finishedAt: string;
  sizeBytes: number;
  sha256: string;
  encrypted: boolean;
};

export type RestoreDrillChecks = {
  accounts: { source: number; restored: number };
  products: { source: number; restored: number };
  inventoryValue: { source: string; restored: string };
  trialBalanceDifference: { source: string; restored: string };
};

export type RestoreDrillManifest = {
  version: number;
  at: string;
  sourceFile: string;
  targetDatabase: string;
  ok: boolean;
  checks: RestoreDrillChecks;
};

export type BackupFreshness = "fresh" | "stale" | "missing";
export type DrillFreshness = "fresh" | "stale" | "missing" | "failed";

export type BackupStatus = {
  manifestDir: string;
  maxAgeHours: number;
  drillMaxAgeDays: number;
  backup: { state: BackupFreshness; manifest: BackupManifest | null; ageHours: number | null };
  drill: { state: DrillFreshness; manifest: RestoreDrillManifest | null; ageDays: number | null };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBackupManifest(raw: unknown): BackupManifest | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.file !== "string" ||
    typeof raw.finishedAt !== "string" ||
    typeof raw.sizeBytes !== "number" ||
    typeof raw.sha256 !== "string" ||
    typeof raw.encrypted !== "boolean" ||
    Number.isNaN(Date.parse(raw.finishedAt))
  ) {
    return null;
  }
  return {
    version: typeof raw.version === "number" ? raw.version : 0,
    file: raw.file,
    finishedAt: raw.finishedAt,
    sizeBytes: raw.sizeBytes,
    sha256: raw.sha256,
    encrypted: raw.encrypted,
  };
}

function parseDrillManifest(raw: unknown): RestoreDrillManifest | null {
  if (!isRecord(raw) || !isRecord(raw.checks)) return null;
  const { checks } = raw;
  const pair = (value: unknown): { source: number; restored: number } | null =>
    isRecord(value) && typeof value.source === "number" && typeof value.restored === "number"
      ? { source: value.source, restored: value.restored }
      : null;
  const pairText = (value: unknown): { source: string; restored: string } | null =>
    isRecord(value) && typeof value.source === "string" && typeof value.restored === "string"
      ? { source: value.source, restored: value.restored }
      : null;
  const accounts = pair(checks.accounts);
  const products = pair(checks.products);
  const inventoryValue = pairText(checks.inventoryValue);
  const trialBalanceDifference = pairText(checks.trialBalanceDifference);
  if (
    typeof raw.at !== "string" ||
    typeof raw.sourceFile !== "string" ||
    typeof raw.targetDatabase !== "string" ||
    typeof raw.ok !== "boolean" ||
    Number.isNaN(Date.parse(raw.at)) ||
    !accounts ||
    !products ||
    !inventoryValue ||
    !trialBalanceDifference
  ) {
    return null;
  }
  return {
    version: typeof raw.version === "number" ? raw.version : 0,
    at: raw.at,
    sourceFile: raw.sourceFile,
    targetDatabase: raw.targetDatabase,
    ok: raw.ok,
    checks: { accounts, products, inventoryValue, trialBalanceDifference },
  };
}

/** Penilaian murni atas isi manifest — terpisah agar teruji unit. */
export function evaluateBackupStatus(input: {
  backupManifest: BackupManifest | null;
  drillManifest: RestoreDrillManifest | null;
  now: Date;
  maxAgeHours: number;
  drillMaxAgeDays: number;
  manifestDir: string;
}): BackupStatus {
  const { backupManifest, drillManifest, now, maxAgeHours, drillMaxAgeDays, manifestDir } = input;

  let backup: BackupStatus["backup"] = { state: "missing", manifest: null, ageHours: null };
  if (backupManifest) {
    const ageHours = (now.getTime() - Date.parse(backupManifest.finishedAt)) / 3_600_000;
    backup = {
      state: ageHours <= maxAgeHours ? "fresh" : "stale",
      manifest: backupManifest,
      ageHours,
    };
  }

  let drill: BackupStatus["drill"] = { state: "missing", manifest: null, ageDays: null };
  if (drillManifest) {
    const ageDays = (now.getTime() - Date.parse(drillManifest.at)) / 86_400_000;
    drill = {
      state: !drillManifest.ok ? "failed" : ageDays <= drillMaxAgeDays ? "fresh" : "stale",
      manifest: drillManifest,
      ageDays,
    };
  }

  return { manifestDir, maxAgeHours, drillMaxAgeDays, backup, drill };
}

async function readManifest<T>(filePath: string, parse: (raw: unknown) => T | null): Promise<T | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parse(JSON.parse(text) as unknown);
  } catch {
    // Berkas tidak ada / JSON rusak = tidak ada catatan yang valid.
    return null;
  }
}

function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function getBackupStatus(options?: {
  dir?: string;
  now?: Date;
}): Promise<BackupStatus> {
  const manifestDir =
    options?.dir ??
    process.env.BISA_BACKUP_DIR ??
    process.env.BACKUP_DIR ??
    path.join(process.cwd(), "backups");
  const [backupManifest, drillManifest] = await Promise.all([
    readManifest(path.join(manifestDir, "backup-manifest.json"), parseBackupManifest),
    readManifest(path.join(manifestDir, "restore-drill-manifest.json"), parseDrillManifest),
  ]);
  return evaluateBackupStatus({
    backupManifest,
    drillManifest,
    now: options?.now ?? new Date(),
    maxAgeHours: envPositiveNumber("BISA_BACKUP_MAX_AGE_HOURS", 26),
    drillMaxAgeDays: envPositiveNumber("BISA_RESTORE_DRILL_MAX_AGE_DAYS", 92),
    manifestDir,
  });
}
