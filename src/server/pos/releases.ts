import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { posDesktopReleaseSettings } from "@/db/schema";

/**
 * Rilis aplikasi desktop POS (POS Native Langkah 7, RENCANA-TAURI
 * D4) — pemilik tunggal tabel `pos_desktop_release_settings`
 * (kontrak kepemilikan tulis: semua insert/update tabel itu hidup
 * di berkas ini; aksi admin & endpoint updater memanggil fungsi di
 * sini).
 *
 * Model rilis:
 * - Pengaturan rilis adalah SATU baris per perusahaan: versi yang
 *   ditawarkan, persen rollout bertahap, dan versi minimum shell.
 *   Rollout bersifat per-perusahaan karena armada & keberanian
 *   naik versi adalah keputusan pemilik tiap perusahaan.
 * - Bucket rollout DETERMINISTIK per (perusahaan, terminal,
 *   versi): hash yang sama selalu menghasilkan keputusan yang sama
 *   untuk terminal itu pada versi itu (terminal tidak berdenyut
 *   masuk/keluar penawaran antar-pemeriksaan); versi baru menggulung
 *   ulang bucket secara wajar.
 * - Di bawah versi minimum, penawaran bersifat WAJIB (mandatory):
 *   rollout diabaikan — shell terlalu tua untuk didukung.
 * - Artefak biner TIDAK di database: bundel + berkas `.sig`
 *   pendamping tinggal di direktori rilis server (env
 *   `BISA_POS_RELEASE_DIR`, di luar repo), disalin skrip rilis
 *   dengan nama kanonis per (target, arch) — lihat
 *   `artifactFileName` & docs/pos-native/RUNBOOK-RILIS.md. Endpoint
 *   updater hanya menawarkan versi yang artefaknya BENAR-BENAR ada
 *   beserta tanda tangannya; pengaturan tanpa artefak = tidak ada
 *   penawaran (204), bukan janji kosong.
 */

// ---------------------------------------------------------------------------
// Versi & keputusan (murni — tanpa DB/FS, teruji langsung)
// ---------------------------------------------------------------------------

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function isValidVersion(value: string): boolean {
  return VERSION_PATTERN.test(value.trim());
}

/**
 * Bandingkan dua versi semver inti (mayor.minor.patch numerik;
 * akhiran prarilis/metadata diabaikan — rilis desktop tidak memakai
 * prarilis). Mengembalikan -1 | 0 | 1, atau null bila salah satu
 * tidak terbaca sebagai versi.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (value: string): number[] | null => {
    const core = value.trim().replace(/^v/i, "").split(/[-+]/)[0];
    const parts = core.split(".");
    if (parts.length === 0 || parts.length > 4) return null;
    const numbers: number[] = [];
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null;
      numbers.push(Number(part));
    }
    while (numbers.length < 3) numbers.push(0);
    return numbers;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Bucket rollout 0..99 — deterministik per (perusahaan, terminal, versi). */
export function rolloutBucket(companyId: string, terminalId: string, version: string): number {
  const digest = createHash("sha256")
    .update(`pos-rollout:${companyId}:${terminalId}:${version}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

export type DesktopReleaseSettingsView = {
  version: string;
  rolloutPercent: number;
  minVersion: string | null;
  notes: string | null;
  publishedAt: Date;
  updatedAt: Date;
};

export type DesktopUpdateDecision =
  | { offer: false; reason: string }
  | { offer: true; mandatory: boolean };

export function decideDesktopUpdate(input: {
  currentVersion: string;
  settings: Pick<DesktopReleaseSettingsView, "version" | "rolloutPercent" | "minVersion"> | null;
  bucket: number;
}): DesktopUpdateDecision {
  const { currentVersion, settings, bucket } = input;
  if (!settings) return { offer: false, reason: "belum ada rilis yang ditetapkan" };
  const vsLatest = compareVersions(currentVersion, settings.version);
  if (vsLatest === null) return { offer: false, reason: "versi terminal tidak terbaca" };
  if (vsLatest >= 0) return { offer: false, reason: "sudah versi terkini" };
  const mandatory =
    settings.minVersion !== null &&
    (compareVersions(currentVersion, settings.minVersion) ?? 0) < 0;
  if (mandatory) return { offer: true, mandatory: true };
  if (bucket < settings.rolloutPercent) return { offer: true, mandatory: false };
  return { offer: false, reason: "di luar gelombang rollout" };
}

// ---------------------------------------------------------------------------
// Pengaturan rilis per perusahaan (konteks tenant)
// ---------------------------------------------------------------------------

export async function getDesktopReleaseSettings(
  tx: Tx,
  companyId: string,
): Promise<DesktopReleaseSettingsView | null> {
  const [row] = await tx
    .select({
      version: posDesktopReleaseSettings.version,
      rolloutPercent: posDesktopReleaseSettings.rolloutPercent,
      minVersion: posDesktopReleaseSettings.minVersion,
      notes: posDesktopReleaseSettings.notes,
      publishedAt: posDesktopReleaseSettings.publishedAt,
      updatedAt: posDesktopReleaseSettings.updatedAt,
    })
    .from(posDesktopReleaseSettings)
    .where(eq(posDesktopReleaseSettings.companyId, companyId))
    .limit(1);
  return row ?? null;
}

/**
 * Tetapkan pengaturan rilis perusahaan (upsert satu baris).
 * `publishedAt` hanya bergerak bila VERSI berubah — itulah
 * `pub_date` kontrak updater; mengubah persen rollout/catatan
 * tidak memalsukan tanggal terbit versi.
 */
export async function setDesktopReleaseSettings(
  tx: Tx,
  input: {
    companyId: string;
    version: string;
    rolloutPercent: number;
    minVersion: string | null;
    notes: string | null;
    updatedBy: string;
  },
): Promise<DesktopReleaseSettingsView> {
  const existing = await getDesktopReleaseSettings(tx, input.companyId);
  const now = new Date();
  const publishedAt =
    existing && existing.version === input.version ? existing.publishedAt : now;
  const values = {
    companyId: input.companyId,
    version: input.version,
    rolloutPercent: input.rolloutPercent,
    minVersion: input.minVersion,
    notes: input.notes,
    publishedAt,
    updatedBy: input.updatedBy,
    updatedAt: now,
  };
  const [row] = await tx
    .insert(posDesktopReleaseSettings)
    .values(values)
    .onConflictDoUpdate({
      target: posDesktopReleaseSettings.companyId,
      set: {
        version: values.version,
        rolloutPercent: values.rolloutPercent,
        minVersion: values.minVersion,
        notes: values.notes,
        publishedAt: values.publishedAt,
        updatedBy: values.updatedBy,
        updatedAt: values.updatedAt,
      },
    })
    .returning({
      version: posDesktopReleaseSettings.version,
      rolloutPercent: posDesktopReleaseSettings.rolloutPercent,
      minVersion: posDesktopReleaseSettings.minVersion,
      notes: posDesktopReleaseSettings.notes,
      publishedAt: posDesktopReleaseSettings.publishedAt,
      updatedAt: posDesktopReleaseSettings.updatedAt,
    });
  return row;
}

// ---------------------------------------------------------------------------
// Artefak di direktori rilis server
// ---------------------------------------------------------------------------

/** Direktori rilis dari env; null = fitur rilis nonaktif di server ini. */
export function releaseDir(): string | null {
  const dir = process.env.BISA_POS_RELEASE_DIR?.trim();
  return dir ? dir : null;
}

/**
 * Nama berkas kanonis artefak per (target, arch) — SATU definisi
 * yang dipakai endpoint, rute unduh, dan skrip rilis
 * (the native release tooling copies the bundle to this name).
 * Kombinasi di luar peta → null (tidak didukung, 404).
 * Linux hanya AppImage yang dapat memperbarui diri (D4); Windows
 * hanya NSIS.
 */
export function artifactFileName(target: string, arch: string): string | null {
  switch (`${target}/${arch}`) {
    case "linux/x86_64":
      return "bisa-pos_linux-x86_64.AppImage";
    case "linux/aarch64":
      return "bisa-pos_linux-aarch64.AppImage";
    case "windows/x86_64":
      return "bisa-pos_windows-x86_64-setup.exe";
    default:
      return null;
  }
}

export type ReleaseArtifact = {
  fileName: string;
  filePath: string;
  /** Isi berkas `.sig` pendamping (string base64 minisign untuk JSON updater). */
  signature: string;
  sizeBytes: number;
};

/**
 * Resolusi artefak untuk penawaran: bundel DAN `.sig`-nya harus
 * sama-sama ada di direktori rilis; bila salah satu hilang →
 * null (endpoint menjawab 204: lebih baik tidak menawarkan
 * daripada menawarkan unduhan yang gagal diverifikasi klien).
 */
export function resolveReleaseArtifact(
  dir: string,
  target: string,
  arch: string,
): ReleaseArtifact | null {
  const fileName = artifactFileName(target, arch);
  if (!fileName) return null;
  const filePath = path.join(dir, fileName);
  const sigPath = `${filePath}.sig`;
  if (!existsSync(filePath) || !existsSync(sigPath)) return null;
  const signature = readFileSync(sigPath, "utf8").trim();
  if (!signature) return null;
  return { fileName, filePath, signature, sizeBytes: statSync(filePath).size };
}
