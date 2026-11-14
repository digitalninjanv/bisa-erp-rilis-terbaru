import { sqlClient } from "@/db";
import migrationJournal from "@/db/migrations/meta/_journal.json";
import { log } from "@/lib/log";

/**
 * FIX-ARS Tahap 1 (ARS4-02): health check mekanis pertama repo ini.
 * Menjawab "aplikasi hidup dan DB aplikasi tersambung?" untuk
 * pemantauan/deployment, memakai koneksi peran aplikasi (DATABASE_URL)
 * dengan kueri paling ringan. Respons sengaja minimal: status, status
 * DB, dan status migrasi terhadap jurnal build ini. Peran runtime hanya
 * diberi hak baca ke tabel jurnal migrasi; respons tidak memuat URL, env,
 * atau detail error. Kegagalan dicatat lewat logger terstruktur.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function latestMigrationTag(): string | null {
  const entries = migrationJournal.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const last = entries[entries.length - 1] as { tag?: unknown };
  return typeof last.tag === "string" ? last.tag : null;
}

export function expectedMigrationTimestamps(): number[] | null {
  const entries = migrationJournal.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const timestamps = entries.map((entry) => (entry as { when?: unknown }).when);
  if (
    timestamps.some(
      (timestamp) => typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0,
    )
  ) {
    return null;
  }
  const validTimestamps = timestamps as number[];
  return new Set(validTimestamps).size === validTimestamps.length ? validTimestamps : null;
}

export function latestMigrationTimestamp(): number | null {
  return expectedMigrationTimestamps()?.at(-1) ?? null;
}

export function createHealthHandler(checkDb: () => Promise<number[] | null>) {
  return async function GET(): Promise<Response> {
    const timestamp = new Date().toISOString();
    try {
      const appliedTimestamps = await checkDb();
      const requiredTimestamps = expectedMigrationTimestamps();
      const validAppliedTimestamps =
        appliedTimestamps !== null &&
        appliedTimestamps.every(
          (timestamp) => Number.isSafeInteger(timestamp) && timestamp >= 0,
        ) &&
        new Set(appliedTimestamps).size === appliedTimestamps.length
          ? appliedTimestamps
          : null;
      let migrationStatus: "current" | "behind" | "ahead" | "unknown" = "unknown";
      if (validAppliedTimestamps && requiredTimestamps) {
        const applied = new Set(validAppliedTimestamps);
        const missing = requiredTimestamps.some((timestamp) => !applied.has(timestamp));
        if (missing) {
          migrationStatus = "behind";
        } else {
          const required = new Set(requiredTimestamps);
          const extra = validAppliedTimestamps.filter((timestamp) => !required.has(timestamp));
          const latestRequiredTimestamp = Math.max(...requiredTimestamps);
          migrationStatus =
            extra.length === 0
              ? "current"
              : extra.every((timestamp) => timestamp > latestRequiredTimestamp)
                ? "ahead"
                : "unknown";
        }
      }
      if (migrationStatus === "behind" || migrationStatus === "unknown") {
        return Response.json(
          {
            status: "error",
            db: "ok",
            migration: latestMigrationTag(),
            migrationStatus,
            timestamp,
          },
          { status: 503 },
        );
      }
      return Response.json(
        {
          status: "ok",
          db: "ok",
          migration: latestMigrationTag(),
          migrationStatus,
          timestamp,
        },
        { status: 200 },
      );
    } catch (error) {
      log.error("health.db_check_failed", undefined, error);
      return Response.json({ status: "error", db: "error", timestamp }, { status: 503 });
    }
  };
}

async function checkDb(): Promise<number[]> {
  const rows = await sqlClient<{ applied: string | null }[]>`
    select created_at::text as applied
    from drizzle.__drizzle_migrations
    order by created_at asc
  `;
  return rows.map(({ applied }) => (applied === null ? Number.NaN : Number(applied)));
}

export const GET = createHealthHandler(checkDb);
