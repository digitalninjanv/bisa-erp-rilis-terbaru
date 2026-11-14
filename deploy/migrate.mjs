#!/usr/bin/env node
/**
 * A-24 T5 — migration runner for the standalone release artifact.
 *
 * The production release does NOT ship drizzle-kit/tsx (dev tooling), so
 * `pnpm db:migrate` cannot run on a target machine. This script applies
 * the exact same migration files (copied into the release as
 * ./migrations) through the official drizzle-orm runtime migrator,
 * using the `postgres` driver the application itself uses. It connects
 * with DIRECT_URL (schema owner `erp`), never DATABASE_URL.
 *
 * It prints one machine-checkable line:
 *   MIGRASI sebelum=<n> sesudah=<n> diterapkan=<n>
 * deploy/update.sh parses "diterapkan=" to decide whether a rollback by
 * symlink switch-back is still safe (0) or a backup restore is required.
 *
 * Usage: DIRECT_URL=postgres://... node deploy/migrate.mjs [migrationsDir]
 * Exit codes: 0 ok (including "nothing to do"), 1 config/connection error,
 * 2 migration failure.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(process.argv[2] ?? `${here}/../migrations`);

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("MIGRASI GAGAL: DIRECT_URL belum diatur di environment.");
  process.exit(1);
}

// onnotice silenced: idempotent migrations emit hundreds of harmless
// "does not exist, skipping" NOTICEs that would bury the real result.
const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });

async function appliedCount() {
  const [catalog] = await sql`
    select to_regclass('drizzle.__drizzle_migrations') as relation
  `;
  if (!catalog?.relation) return 0; // no migration table on a fresh database
  const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  return rows[0].n;
}

let before = null;
let migrationStarted = false;
try {
  before = await appliedCount();
  const db = drizzle(sql);
  migrationStarted = true;
  await migrate(db, { migrationsFolder });
  const after = await appliedCount();
  console.log(
    `MIGRASI sebelum=${before} sesudah=${after} diterapkan=${after - before}`,
  );
} catch (error) {
  let outcome = "keadaan=unknown";
  if (migrationStarted && before !== null) {
    try {
      const after = await appliedCount();
      outcome = `sebelum=${before} sesudah=${after} diterapkan=${after - before}`;
    } catch {
      outcome = `sebelum=${before} sesudah=unknown diterapkan=unknown`;
    }
  }
  console.error(`MIGRASI GAGAL ${outcome}: ${error?.message ?? error}`);
  process.exitCode = 2;
} finally {
  await sql.end({ timeout: 5 });
}
