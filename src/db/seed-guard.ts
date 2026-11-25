/**
 * Safety gate for the demo seed CLI.
 *
 * The demo seed installs a known owner account and demo catalogue. It is
 * safe for local development, CI and disposable test databases, but it must
 * never silently install the published fixture password on a production
 * deployment. Production use requires an explicit flag AND a unique,
 * operator-supplied password; the password is never printed.
 */
export const DEMO_OWNER_PASSWORD = "Bisa12345!";
export const MIN_PRODUCTION_SEED_PASSWORD_LENGTH = 16;
export const PRODUCTION_SEED_FLAG = "--allow-production-seed";

export type SeedOwnerPasswordInput = {
  isProduction: boolean;
  argv: readonly string[];
  ownerPassword?: string | null;
};

export type SeedOwnerPassword = {
  password: string;
  /** True when the published local-demo credential is in use. */
  demo: boolean;
};

export function resolveSeedOwnerPassword(
  input: SeedOwnerPasswordInput,
): SeedOwnerPassword {  if (!input.isProduction) {
    return { password: DEMO_OWNER_PASSWORD, demo: true };
  }

  if (!input.argv.includes(PRODUCTION_SEED_FLAG)) {
    throw new Error(
      `Seed demo ditolak pada NODE_ENV=production. ` +
        `Jika ini benar-benar instalasi demo yang terisolasi, jalankan ulang dengan ` +
        `${PRODUCTION_SEED_FLAG} dan set BISA_SEED_OWNER_PASSWORD (minimal ` +
        `${MIN_PRODUCTION_SEED_PASSWORD_LENGTH} karakter, unik, tidak pernah dicetak). ` +
        `Jangan gunakan seed demo pada database produksi berisi data asli.`,
    );
  }

  const password = input.ownerPassword?.trim() ?? "";
  if (password === DEMO_OWNER_PASSWORD) {
    throw new Error(
      "BISA_SEED_OWNER_PASSWORD tidak boleh memakai kredensial demo yang sudah dipublikasikan.",
    );
  }
  if (password.length < MIN_PRODUCTION_SEED_PASSWORD_LENGTH) {
    throw new Error(
      `BISA_SEED_OWNER_PASSWORD wajib diisi minimal ${MIN_PRODUCTION_SEED_PASSWORD_LENGTH} karakter ` +
        `saat menjalankan seed demo di production. Kredensial fixture tidak boleh dipakai.`,
    );
  }
  return { password, demo: false };
}

export function seedOwnerLoginMessage(owner: SeedOwnerPassword): string {
  return owner.demo
    ? `Login: owner@bisa.id / ${owner.password}`
    : "Login: owner@bisa.id / password dari BISA_SEED_OWNER_PASSWORD " +
        "(tidak dicetak; rotasi sebelum operasi normal).";
}

