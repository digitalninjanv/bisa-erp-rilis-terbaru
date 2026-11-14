import { describe, expect, it } from "vitest";
import migrationJournal from "@/db/migrations/meta/_journal.json";
import {
  createHealthHandler,
  expectedMigrationTimestamps,
  latestMigrationTag,
  latestMigrationTimestamp,
} from "@/app/api/health/route";

// FIX-ARS Tahap 1 (ARS4-02): sebelum ini tidak ada cara mekanis untuk
// menjawab "aplikasi & DB hidup?" — /api hanya berisi auth/export/import.
// Handler dibuat lewat factory agar jalur sukses/gagal DB dapat diuji
// dengan checkDb tiruan, tanpa menyentuh database sungguhan.

describe("GET /api/health", () => {
  it("DB dan migrasi sesuai -> 200 dengan status current", async () => {
    const GET = createHealthHandler(async () => expectedMigrationTimestamps());
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.migration).toBe(latestMigrationTag());
    expect(body.migrationStatus).toBe("current");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
  });

  it("migrasi database tertinggal -> 503 tanpa menandai DB putus", async () => {
    const GET = createHealthHandler(async () => expectedMigrationTimestamps()!.slice(0, -1));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    expect(body.db).toBe("ok");
    expect(body.migrationStatus).toBe("behind");
  });

  it("timestamp migrasi DB tidak tersedia -> 503 dengan status unknown", async () => {
    const GET = createHealthHandler(async () => null);
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).migrationStatus).toBe("unknown");
  });

  it("timestamp migrasi tidak valid tidak boleh memberi health 200", async () => {
    const GET = createHealthHandler(async () => [Number.NaN]);
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).migrationStatus).toBe("unknown");
  });

  it("migrasi DB lebih baru tetap sehat untuk rollout kompatibel", async () => {
    const GET = createHealthHandler(async () => [
      ...expectedMigrationTimestamps()!,
      (latestMigrationTimestamp() ?? 0) + 1,
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).migrationStatus).toBe("ahead");
  });

  it("DB gagal -> 503 {status error, db error} tanpa membocorkan detail error", async () => {
    const GET = createHealthHandler(async () => {
      throw new Error("connect ECONNREFUSED postgres://app_user:appdev@db:5432/bisa");
    });
    const response = await GET();
    expect(response.status).toBe(503);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.status).toBe("error");
    expect(body.db).toBe("error");
    expect(text).not.toContain("appdev");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("ECONNREFUSED");
  });

  it("respons tidak memuat kunci env/rahasia apa pun", async () => {
    const GET = createHealthHandler(async () => expectedMigrationTimestamps()!.slice(0, -1));
    const body = (await (await GET()).json()) as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      expect(key.toLowerCase()).not.toMatch(/secret|password|token|url|env/);
    }
  });
});

describe("latestMigrationTag", () => {
  it("menggunakan tag dan timestamp terakhir dari jurnal source", () => {
    const latest = migrationJournal.entries.at(-1);
    expect(latestMigrationTag()).toBe(latest?.tag ?? null);
    expect(latestMigrationTimestamp()).toBe(latest?.when ?? null);
  });

  it("mendeteksi migration gap meski timestamp tertinggi sudah terpasang", async () => {
    const expected = expectedMigrationTimestamps()!;
    const appliedExceptOne = expected.filter((_, index) => index !== expected.length - 2);
    const GET = createHealthHandler(async () => appliedExceptOne);
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).migrationStatus).toBe("behind");
  });
});
