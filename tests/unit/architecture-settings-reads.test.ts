import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A-26 Q4 (P-08, audit sentralisasi §2) — ratchet kontrak baca settings.
 *
 * Baca settings perusahaan punya SATU pintu bernama:
 * `getCompanySettingsRow` di `src/server/settings.ts` (baris utuh;
 * konsumen mengambil kolom yang dibutuhkannya). Berkas lain TIDAK
 * boleh memilih `companySettings` langsung (`.from(companySettings)`).
 *
 * Pengecualian yang sah dibekukan di ALLOWLIST dengan alasan; daftar
 * ini HANYA BOLEH MENYUSUT — tahap yang memigrasikan berkas
 * terdaftar WAJIB menghapus entrinya di perubahan yang sama, dan test
 * "daftar izinkan tidak basi" menggagalkan suite selama entri basi
 * tertinggal (pola architecture-read-paths & architecture-file-size).
 * Menambah entri demi meloloskan baca langsung baru adalah
 * pelanggaran ratchet: pakai kontraknya, jangan geser daftarnya.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const CONTRACT_FILE = "server/settings.ts";

/** Kunci: jalur relatif terhadap src/ (posix). Nilai: alasan tertulis. */
const ALLOWLIST: Record<string, string> = {
  // Lapisan lib tidak boleh mengimpor modul server (arah dependensi
  // akan terbalik & berisiko siklus); sesi hanya butuh enabledModules.
  "lib/session.ts": "lapisan lib tidak mengimpor server; proyeksi 1 kolom untuk resolusi sesi",
  // Pemilik TULIS settings: bacanya bagian dari alur tulisnya sendiri
  // (cek keberadaan & gudang bawaan sebelum upsert), bukan konsumen.
  // A-26 Q8b: actions/settings.ts terpecah per topik ke folder
  // actions/settings/ — dua pecahan yang membaca langsung:
  "server/actions/settings/identitas-pajak.ts": "pemilik tulis settings; baca adalah bagian alur tulisnya",
  "server/actions/settings/lokasi.ts": "pemilik tulis settings; baca gudang bawaan adalah bagian alur hapus gudangnya",
};

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const relative = (file: string) => path.relative(SRC_DIR, file).split(path.sep).join("/");

const DIRECT_READ = /\.from\(\s*companySettings\s*\)/;

describe("arsitektur: kontrak baca settings (A-26 Q4, P-08)", () => {
  const files = listSourceFiles(SRC_DIR);

  it("kontrak bernama ada dan menjadi satu-satunya definisi baca", () => {
    const contractPath = path.join(SRC_DIR, CONTRACT_FILE);
    expect(existsSync(contractPath)).toBe(true);
    const source = readFileSync(contractPath, "utf8");
    expect(source).toContain("export async function getCompanySettingsRow");
    expect(DIRECT_READ.test(source)).toBe(true);
  });

  it("tidak ada baca companySettings langsung di luar daftar izinkan", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (rel === CONTRACT_FILE || rel in ALLOWLIST) continue;
      if (DIRECT_READ.test(readFileSync(file, "utf8"))) violations.push(rel);
    }
    expect(violations).toEqual([]);
  });

  it("daftar izinkan tidak basi (hanya boleh menyusut)", () => {
    for (const rel of Object.keys(ALLOWLIST)) {
      const filePath = path.join(SRC_DIR, rel);
      expect(existsSync(filePath), `entri basi (berkas hilang): ${rel}`).toBe(true);
      expect(
        DIRECT_READ.test(readFileSync(filePath, "utf8")),
        `entri basi (sudah tidak membaca langsung — hapus dari ALLOWLIST): ${rel}`,
      ).toBe(true);
    }
  });
});
