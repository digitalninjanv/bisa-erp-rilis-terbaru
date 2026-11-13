import { describe, expect, it } from "vitest";
import { createHealthHandler, latestMigrationTag } from "@/app/api/health/route";

// FIX-ARS Tahap 1 (ARS4-02): sebelum ini tidak ada cara mekanis untuk
// menjawab "aplikasi & DB hidup?" — /api hanya berisi auth/export/import.
// Handler dibuat lewat factory agar jalur sukses/gagal DB dapat diuji
// dengan checkDb tiruan, tanpa menyentuh database sungguhan.

describe("GET /api/health", () => {
  it("DB sehat -> 200 {status ok, db ok, migration, timestamp}", async () => {
    const GET = createHealthHandler(async () => {});
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.migration).toBe(latestMigrationTag());
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
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
    const GET = createHealthHandler(async () => {});
    const body = (await (await GET()).json()) as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      expect(key.toLowerCase()).not.toMatch(/secret|password|token|url|env/);
    }
  });
});

describe("latestMigrationTag", () => {
  it("membaca tag migrasi terakhir dari jurnal drizzle", () => {
    expect(latestMigrationTag()).toMatch(/^0073_/);
  });
});
