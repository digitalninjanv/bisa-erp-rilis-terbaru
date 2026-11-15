import { describe, expect, it } from "vitest";
import { resolveClientIp, trustedProxiesFromEnv } from "@/lib/client-ip";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("SEC-012 — resolusi IP klien", () => {
  it("tanpa proksi tepercaya hanya menerima header satu nilai", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.9" }), [])).toBe(
      "203.0.113.9",
    );
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), []),
    ).toBeNull();
    expect(resolveClientIp(headers({ "x-forwarded-for": "bukan-ip" }), [])).toBeNull();
  });

  it("melewati rantai proksi dari kanan sampai klien pertama", () => {
    const value = "203.0.113.9, 10.0.0.2, 10.0.0.1";
    expect(resolveClientIp(headers({ "x-forwarded-for": value }), ["10.0.0.0/8"])).toBe(
      "203.0.113.9",
    );
    // Hop kanan bukan proksi tepercaya → itulah klien (bukan menebak hop kiri).
    expect(resolveClientIp(headers({ "x-forwarded-for": value }), ["192.0.2.1"])).toBe(
      "10.0.0.1",
    );
  });

  it("CIDR IPv4/IPv6 dan header cadangan X-Real-IP", () => {
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "198.51.100.7, 2001:db8::1" }), [
        "2001:db8::/32",
      ]),
    ).toBe("198.51.100.7");
    expect(resolveClientIp(headers({ "x-real-ip": "198.51.100.8" }), [])).toBe(
      "198.51.100.8",
    );
    expect(resolveClientIp(headers({}), [])).toBeNull();
  });

  it("membaca daftar proksi dari environment", () => {
    const previous = process.env.BISA_TRUSTED_PROXIES;
    process.env.BISA_TRUSTED_PROXIES = "127.0.0.1, 10.0.0.0/8";
    try {
      expect(trustedProxiesFromEnv()).toEqual(["127.0.0.1", "10.0.0.0/8"]);
    } finally {
      if (previous === undefined) delete process.env.BISA_TRUSTED_PROXIES;
      else process.env.BISA_TRUSTED_PROXIES = previous;
    }
  });
});
