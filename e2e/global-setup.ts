import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

/**
 * AUD-003 — kerapuhan urutan suite→e2e: e2e mengasumsikan baseline
 * demo kanonis (65 produk, nilai persediaan tetap), tetapi suite
 * vitest penuh meninggalkan perusahaan demo berubah (beberapa test
 * integrasi commit ke org demo). Menjalankan e2e tepat sesudah suite
 * pernah menggagalkan spec akuntansi.
 *
 * Mitigasi: saklar BISA_E2E_RESEED=1 membuat global setup me-reseed
 * demo (`pnpm db:seed -- --force`) sebelum server & login setup
 * berjalan, sehingga run gerbang resmi selalu mulai dari baseline
 * yang sama. TANPA saklar, perilaku lama dipertahankan persis —
 * e2e harian tidak diperlambat dan DB dev tidak direset diam-diam.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.BISA_E2E_RESEED !== "1") return;

  const root = process.cwd();
  // db:seed tidak membaca .env.local sendiri (lihat AGENTS.md) —
  // muat manual ke env proses anak.
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    const raw = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && env[match[1]] === undefined) {
        env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env.local absen: biarkan seed gagal dengan pesannya sendiri.
  }

  console.log("[e2e] BISA_E2E_RESEED=1 — reseed demo ke baseline kanonis…");
  execSync("pnpm db:seed -- --force", { cwd: root, env, stdio: "inherit" });

  // SEC-012: penghitung rate limit login tersimpan di database. Run E2E
  // berulang dari IP yang sama bisa menghabiskan kuota 10/menit dan
  // menggagalkan auth.setup — bersihkan hanya pada run gerbang yang
  // memang me-reseed baseline.
  const directUrl = env.DIRECT_URL;
  if (directUrl) {
    const sql = postgres(directUrl, { max: 1 });
    try {
      await sql`delete from rate_limit`;
      console.log("[e2e] rate_limit dibersihkan.");
    } catch (error) {
      // DB lama sebelum migrasi 0083 tidak punya tabel — bukan alasan
      // menggagalkan suite.
      console.warn("[e2e] rate_limit tidak dibersihkan:", (error as Error).message);
    } finally {
      await sql.end();
    }
  }
}
