import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

// FIX-ARS Tahap 1 (ARS4-03): env dulu hanya diperiksa sepotong-sepotong
// (DATABASE_URL di db/index, DIRECT_URL di db/admin) dan BETTER_AUTH_SECRET
// boleh kosong secara senyap. parseEnv adalah fungsi murni atas objek
// sumber agar matriks valid/gagal dapat diuji tanpa menyentuh process.env.

const VALID_DEV: Record<string, string> = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://app_user:appdev@localhost:5433/bisa",
  DIRECT_URL: "postgres://erp:erpdev@localhost:5433/bisa",
  BETTER_AUTH_SECRET: "dev-secret-yang-cukup-panjang-untuk-lolos-32",
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_NAME: "Bisa ERP",
};

const VALID_PROD: Record<string, string> = {
  ...VALID_DEV,
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app_user:sandi-kuat@db.internal:5432/bisa",
  DIRECT_URL: "postgres://erp:sandi-kuat@db.internal:5432/bisa",
  BETTER_AUTH_SECRET: "prod-secret-acak-yang-sangat-panjang-dan-unik",
  BETTER_AUTH_URL: "https://erp.contoh.id",
};

describe("parseEnv — konfigurasi valid", () => {
  it("menerima env dev lengkap dan mengembalikan nilai tertipe", () => {
    const env = parseEnv(VALID_DEV);
    expect(env.databaseUrl).toBe(VALID_DEV.DATABASE_URL);
    expect(env.directUrl).toBe(VALID_DEV.DIRECT_URL);
    expect(env.betterAuthSecret).toBe(VALID_DEV.BETTER_AUTH_SECRET);
    expect(env.betterAuthUrl).toBe("http://localhost:3000");
    expect(env.appName).toBe("Bisa ERP");
    expect(env.nodeEnv).toBe("development");
    expect(env.isProduction).toBe(false);
  });

  it("menerima env produksi yang benar (URL publik, secret kuat)", () => {
    const env = parseEnv(VALID_PROD);
    expect(env.isProduction).toBe(true);
    expect(env.betterAuthUrl).toBe("https://erp.contoh.id");
  });

  it("BETTER_AUTH_URL localhost diizinkan di luar production", () => {
    expect(() => parseEnv(VALID_DEV)).not.toThrow();
    expect(() => parseEnv({ ...VALID_DEV, NODE_ENV: "test" })).not.toThrow();
  });

  it("secret tepat 32 karakter lolos; appName ber-bawaan bila tidak diset", () => {
    const env = parseEnv({
      ...VALID_DEV,
      BETTER_AUTH_SECRET: "12345678901234567890123456789012",
      NEXT_PUBLIC_APP_NAME: undefined,
    });
    expect(env.betterAuthSecret).toHaveLength(32);
    expect(env.appName).toBe("Bisa ERP");
  });
});

describe("parseEnv — kegagalan wajib keras dan menyebut variabelnya", () => {
  it("sumber kosong: satu error yang menyebut DATABASE_URL, DIRECT_URL, dan BETTER_AUTH_SECRET", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({})).toThrow(/DIRECT_URL/);
    expect(() => parseEnv({})).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("DATABASE_URL hilang / bukan URL / protokol bukan postgres -> gagal", () => {
    expect(() => parseEnv({ ...VALID_DEV, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...VALID_DEV, DATABASE_URL: "bukan-url" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...VALID_DEV, DATABASE_URL: "mysql://u:p@h:3306/db" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => parseEnv({ ...VALID_DEV, DATABASE_URL: "postgres://u:p@h:5432/" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("DIRECT_URL hilang / tidak valid -> gagal", () => {
    expect(() => parseEnv({ ...VALID_DEV, DIRECT_URL: undefined })).toThrow(/DIRECT_URL/);
    expect(() => parseEnv({ ...VALID_DEV, DIRECT_URL: "http://localhost/db" })).toThrow(
      /DIRECT_URL/,
    );
  });

  it("BETTER_AUTH_SECRET hilang / <32 karakter -> gagal", () => {
    expect(() => parseEnv({ ...VALID_DEV, BETTER_AUTH_SECRET: undefined })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => parseEnv({ ...VALID_DEV, BETTER_AUTH_SECRET: "pendek" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(
      () => parseEnv({ ...VALID_DEV, BETTER_AUTH_SECRET: "1234567890123456789012345678901" }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("BETTER_AUTH_SECRET bernilai contoh dari .env.example -> gagal walau panjang", () => {
    expect(
      () =>
        parseEnv({
          ...VALID_DEV,
          BETTER_AUTH_SECRET: "GantiSecretIniDenganNilaiAcakYangPanjangDanRahasia",
        }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("production tanpa BETTER_AUTH_URL -> gagal", () => {
    expect(() => parseEnv({ ...VALID_PROD, BETTER_AUTH_URL: undefined })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });

  it("production dengan BETTER_AUTH_URL localhost / 127.0.0.1 -> gagal", () => {
    expect(() => parseEnv({ ...VALID_PROD, BETTER_AUTH_URL: "http://localhost:3000" })).toThrow(
      /BETTER_AUTH_URL/,
    );
    expect(() => parseEnv({ ...VALID_PROD, BETTER_AUTH_URL: "http://127.0.0.1:3000" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });

  it("BETTER_AUTH_URL yang bukan URL valid -> gagal di semua lingkungan", () => {
    expect(() => parseEnv({ ...VALID_DEV, BETTER_AUTH_URL: "bukan url" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });

  it("flag BISA_ALLOW_LOCALHOST_AUTH_URL=1 mengakui harness lokal secara eksplisit", () => {
    const env = parseEnv({
      ...VALID_PROD,
      BETTER_AUTH_URL: "http://localhost:3000",
      BISA_ALLOW_LOCALHOST_AUTH_URL: "1",
    });
    expect(env.localhostAuthUrlAllowed).toBe(true);
    // …tetapi flag TIDAK memaafkan BETTER_AUTH_URL yang hilang di production.
    expect(
      () =>
        parseEnv({
          ...VALID_PROD,
          BETTER_AUTH_URL: undefined,
          BISA_ALLOW_LOCALHOST_AUTH_URL: "1",
        }),
    ).toThrow(/BETTER_AUTH_URL/);
  });

  it("opsi enforceProductionAuthUrl=false (fase build) hanya melonggarkan aturan URL produksi", () => {
    const relaxed = { enforceProductionAuthUrl: false };
    expect(() =>
      parseEnv({ ...VALID_PROD, BETTER_AUTH_URL: "http://localhost:3000" }, relaxed),
    ).not.toThrow();
    expect(() => parseEnv({ ...VALID_PROD, BETTER_AUTH_URL: undefined }, relaxed)).not.toThrow();
    // Aturan lain tetap keras pada mode yang sama:
    expect(() => parseEnv({ ...VALID_PROD, BETTER_AUTH_SECRET: "pendek" }, relaxed)).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => parseEnv({ ...VALID_PROD, DATABASE_URL: "bukan-url" }, relaxed)).toThrow(
      /DATABASE_URL/,
    );
  });

  it("fungsi murni: tidak membaca process.env (sumber eksplisit yang dipakai)", () => {
    // process.env proses test ini justru terisi dari .env.local oleh
    // vitest; parseEnv({}) tetap harus gagal karena sumbernya kosong.
    expect(() => parseEnv({})).toThrow();
  });
});
