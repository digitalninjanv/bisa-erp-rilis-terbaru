import { isIP } from "node:net";
import { z } from "zod";

/**
 * FIX-ARS Tahap 1 (ARS4-03): modul env tunggal tervalidasi.
 *
 * Sebelum ini pemeriksaan env tersebar dan sebagian: `db/index.ts`
 * melempar bila DATABASE_URL kosong, `db/admin.ts` idem untuk
 * DIRECT_URL, dan `auth.ts` meneruskan `BETTER_AUTH_SECRET` yang bisa
 * `undefined` secara senyap (dengan BETTER_AUTH_URL jatuh ke localhost).
 * Sekarang satu skema Zod menilai semuanya, dan modul ini diimpor oleh
 * titik-titik kritis (db/index, db/admin, lib/auth) serta
 * `src/instrumentation.ts`, sehingga server GAGAL START dengan pesan
 * yang menyebut variabel yang salah — bukan berjalan dengan konfigurasi
 * yang diam-diam rusak.
 *
 * `parseEnv` adalah fungsi murni atas objek sumber (dapat diuji tanpa
 * menyentuh process.env); ekspor `env` di bawah adalah hasil parse
 * process.env saat modul pertama kali diimpor.
 *
 * Jalur yang SENGAJA tidak lewat modul ini (bukan pelemahan diam-diam):
 * - drizzle-kit (`pnpm db:generate/migrate/studio`) membaca
 *   drizzle.config.ts yang mengambil process.env langsung — peralatan
 *   CLI operator, bukan runtime server; memaksakan validasi produksi
 *   (mis. BETTER_AUTH_URL non-localhost) di sana akan memblokir migrasi
 *   sah dari mesin dev.
 * - Skrip di `scripts/` (bench, sim2-gen, backup/restore shell) adalah
 *   peralatan operator sekali jalan dengan penjaga masing-masing.
 */

const MIN_SECRET_LENGTH = 32;

/**
 * Nilai contoh/placeholder yang dikenal dan tidak boleh pernah menjadi
 * secret sungguhan — termasuk nilai persis dari `.env.example` repo ini
 * (panjangnya lolos uji ≥32, jadi harus ditolak secara eksplisit).
 * Perbandingan tidak peka huruf besar/kecil dan mengabaikan spasi tepi.
 */
const KNOWN_EXAMPLE_SECRETS: ReadonlySet<string> = new Set(
  [
    "GantiSecretIniDenganNilaiAcakYangPanjangDanRahasia",
    "changeme",
    "change-me",
    "your-secret-here",
    "your_better_auth_secret",
    "secret",
    "dev-secret",
  ].map((value) => value.toLowerCase()),
);

function isPostgresUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
  if (!url.hostname) return false;
  // Nama database wajib ada di path ("/bisa"), bukan sekadar "/".
  return url.pathname.length > 1;
}

function postgresUrlField(name: string) {
  return z
    .string({ error: `${name} wajib diisi.` })
    .min(1, `${name} wajib diisi.`)
    .refine(isPostgresUrl, `${name} harus berupa URL postgres yang valid (postgres://user:pass@host:port/nama-db).`);
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: postgresUrlField("DATABASE_URL"),
    DIRECT_URL: postgresUrlField("DIRECT_URL"),
    BETTER_AUTH_SECRET: z
      .string({ error: "BETTER_AUTH_SECRET wajib diisi." })
      .min(1, "BETTER_AUTH_SECRET wajib diisi.")
      .refine(
        (value) => value.length >= MIN_SECRET_LENGTH,
        `BETTER_AUTH_SECRET harus minimal ${MIN_SECRET_LENGTH} karakter.`,
      )
      .refine(
        (value) => !KNOWN_EXAMPLE_SECRETS.has(value.trim().toLowerCase()),
        "BETTER_AUTH_SECRET masih bernilai contoh/placeholder — ganti dengan nilai acak yang unik.",
      ),
    BETTER_AUTH_URL: z
      .string()
      .refine((value) => {
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      }, "BETTER_AUTH_URL harus berupa URL yang valid.")
      .optional(),
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Bisa ERP"),
    // Explicit operator acknowledgement, see parseEnv docs: only ever
    // set by the Playwright webServer harness (playwright.config.ts).
    BISA_ALLOW_LOCALHOST_AUTH_URL: z.string().optional(),
    BISA_ALLOW_INSECURE_AUTH_URL: z.string().optional(),
    /**
     * SEC-012: daftar alamat proksi tepercaya (IP atau CIDR, dipisah
     * koma). Hanya header forwarded dari proksi ini yang dipakai untuk
     * menentukan IP klien; entri kosong berarti header multi-hop tidak
     * dipercaya (Better Auth hanya menerima satu nilai).
     */
    BISA_TRUSTED_PROXIES: z.string().optional(),
  });

/** IP atau CIDR yang valid; dipakai untuk memvalidasi BISA_TRUSTED_PROXIES. */
function isTrustedProxyEntry(value: string): boolean {
  const slash = value.lastIndexOf("/");
  const ip = slash === -1 ? value : value.slice(0, slash);
  const prefix = slash === -1 ? null : value.slice(slash + 1);
  const family = isIP(ip);
  if (family === 0) return false;
  if (prefix === null) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (family === 4 ? 32 : 128);
}

function parseTrustedProxies(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Serving-runtime production rules for BETTER_AUTH_URL, checked in
 * parseEnv (not in the zod schema) so the build phase can relax
 * exactly these and nothing else — see ParseEnvOptions.
 */
function productionAuthUrlProblems(
  parsed: z.output<typeof envSchema>,
  enforce: boolean,
): string[] {
  if (!enforce || parsed.NODE_ENV !== "production") return [];
  if (!parsed.BETTER_AUTH_URL) {
    return ["BETTER_AUTH_URL: BETTER_AUTH_URL wajib diisi pada NODE_ENV=production."];
  }
  const host = new URL(parsed.BETTER_AUTH_URL).hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host) && !isTruthyFlag(parsed.BISA_ALLOW_LOCALHOST_AUTH_URL)) {
    return [
      "BETTER_AUTH_URL: BETTER_AUTH_URL tidak boleh ber-host localhost pada NODE_ENV=production.",
    ];
  }
  const protocol = new URL(parsed.BETTER_AUTH_URL).protocol;
  if (protocol !== "https:" && !isTruthyFlag(parsed.BISA_ALLOW_INSECURE_AUTH_URL)) {
    return [
      "BETTER_AUTH_URL: gunakan https pada NODE_ENV=production agar cookie sesi Secure. Set BISA_ALLOW_INSECURE_AUTH_URL=1 hanya untuk uji lokal yang disengaja.",
    ];
  }
  return [];
}

export interface Env {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  databaseUrl: string;
  directUrl: string;
  betterAuthSecret: string;
  /** Undefined when unset outside production (Better Auth then infers from the request). */
  betterAuthUrl?: string;
  appName: string;
  /** True when the operator explicitly allowed a localhost auth URL in production mode. */
  localhostAuthUrlAllowed: boolean;
  /** Proksi tepercaya untuk resolusi IP klien (SEC-012). */
  trustedProxies: string[];
}

export interface ParseEnvOptions {
  /**
   * The production BETTER_AUTH_URL rules (required + non-localhost) are
   * serving-runtime rules. During `next build` (NEXT_PHASE=
   * phase-production-build) modules are evaluated with
   * NODE_ENV=production but nothing is served yet, so the module-scope
   * export below relaxes ONLY these two rules; every other rule (DB
   * URLs, secret) still fails the build, and `next start` re-validates
   * strictly via src/instrumentation.ts. Default: true (strict).
   */
  enforceProductionAuthUrl?: boolean;
}

/** Pure validation over an explicit source object — the unit-testable core of this module. */
export function parseEnv(
  source: Record<string, string | undefined>,
  options: ParseEnvOptions = {},
): Env {
  // Empty strings count as "not set" (a common .env accident), so
  // required-field failures name the variable instead of a confusing
  // downstream parse error.
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    cleaned[key] = value === "" ? undefined : value;
  }
  const result = envSchema.safeParse(cleaned);
  const problems: string[] = [];
  if (!result.success) {
    problems.push(
      ...result.error.issues.map((issue) => {
        const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${where}: ${issue.message}`;
      }),
    );
  } else {
    problems.push(
      ...productionAuthUrlProblems(result.data, options.enforceProductionAuthUrl !== false),
    );
  }
  if (problems.length > 0 || !result.success) {
    throw new Error(
      `Konfigurasi environment tidak valid:\n- ${problems.join("\n- ")}\n` +
        "Periksa .env.local (dev) atau variabel environment server (produksi).",
    );
  }
  const parsed = result.data;
  const trustedProxies = parseTrustedProxies(parsed.BISA_TRUSTED_PROXIES);
  const invalidProxies = trustedProxies.filter((entry) => !isTrustedProxyEntry(entry));
  if (invalidProxies.length > 0) {
    throw new Error(
      `Konfigurasi environment tidak valid:\n- BISA_TRUSTED_PROXIES: entri tidak valid: ${invalidProxies.join(", ")}. ` +
        "Gunakan alamat IP atau CIDR, mis. 127.0.0.1 atau 10.0.0.0/8.",
    );
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    isProduction: parsed.NODE_ENV === "production",
    databaseUrl: parsed.DATABASE_URL,
    directUrl: parsed.DIRECT_URL,
    betterAuthSecret: parsed.BETTER_AUTH_SECRET,
    betterAuthUrl: parsed.BETTER_AUTH_URL,
    appName: parsed.NEXT_PUBLIC_APP_NAME,
    localhostAuthUrlAllowed: isTruthyFlag(parsed.BISA_ALLOW_LOCALHOST_AUTH_URL),
    trustedProxies,
  };
}

/**
 * Validated environment for the running server. Importing this module
 * IS the fail-fast check: an invalid environment throws here, at first
 * import, before any request is served. The single relaxation is the
 * build phase (NEXT_PHASE=phase-production-build), which evaluates
 * modules without serving — see ParseEnvOptions; `next start`
 * re-validates strictly through src/instrumentation.ts.
 */
export const env: Env = parseEnv(process.env, {
  enforceProductionAuthUrl: process.env.NEXT_PHASE !== "phase-production-build",
});
