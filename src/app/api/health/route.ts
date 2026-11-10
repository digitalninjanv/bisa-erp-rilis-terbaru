import { sqlClient } from "@/db";
import migrationJournal from "@/db/migrations/meta/_journal.json";
import { log } from "@/lib/log";

/**
 * FIX-ARS Tahap 1 (ARS4-02): health check mekanis pertama repo ini.
 * Menjawab "aplikasi hidup dan DB aplikasi tersambung?" untuk
 * pemantauan/deployment, memakai koneksi peran aplikasi (DATABASE_URL)
 * dengan kueri paling ringan. Respons sengaja minimal: status, status
 * DB, tag migrasi terakhir yang dikenal build ini (dari jurnal drizzle
 * yang ter-bundle — tidak perlu hak baca ke skema internal drizzle di
 * runtime), dan timestamp. Tidak ada URL, env, atau detail error yang
 * dibocorkan; kegagalan DB hanya dicatat lewat logger terstruktur.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function latestMigrationTag(): string | null {
  const entries = migrationJournal.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const last = entries[entries.length - 1] as { tag?: unknown };
  return typeof last.tag === "string" ? last.tag : null;
}

export function createHealthHandler(checkDb: () => Promise<void>) {
  return async function GET(): Promise<Response> {
    const timestamp = new Date().toISOString();
    try {
      await checkDb();
      return Response.json(
        { status: "ok", db: "ok", migration: latestMigrationTag(), timestamp },
        { status: 200 },
      );
    } catch (error) {
      log.error("health.db_check_failed", undefined, error);
      return Response.json({ status: "error", db: "error", timestamp }, { status: 503 });
    }
  };
}

async function checkDb(): Promise<void> {
  await sqlClient`select 1`;
}

export const GET = createHealthHandler(checkDb);
