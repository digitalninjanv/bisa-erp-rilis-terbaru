import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLogLine, log } from "@/lib/log";

// FIX-ARS Tahap 1 (ARS4-02): logger terstruktur satu baris JSON — level,
// timestamp, event, konteks aman (tanpa rahasia), dan ringkasan error
// tanpa stack. Dipakai guard() untuk error tak terduga agar insiden
// produksi dapat dicari & dikorelasikan, bukan console.error telanjang.

describe("formatLogLine", () => {
  it("menghasilkan satu baris JSON dengan ts, level, dan event", () => {
    const line = formatLogLine("info", "server.started");
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("server.started");
    expect(typeof parsed.ts).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.ts as string))).toBe(false);
  });

  it("menyertakan konteks skalar yang aman (companyId/userId/action/requestId)", () => {
    const parsed = JSON.parse(
      formatLogLine("warn", "action.slow", {
        companyId: "comp-1",
        userId: "user-1",
        action: "createSale",
        requestId: "req-1",
        durationMs: 120,
      }),
    ) as Record<string, unknown>;
    expect(parsed.companyId).toBe("comp-1");
    expect(parsed.userId).toBe("user-1");
    expect(parsed.action).toBe("createSale");
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.durationMs).toBe(120);
  });

  it("membuang kunci sensitif dan nilai non-skalar dari konteks", () => {
    const parsed = JSON.parse(
      formatLogLine("info", "x", {
        companyId: "comp-1",
        secret: "<redacted>",
        BETTER_AUTH_SECRET: "abc",
        password: "p",
        token: "t",
        authorization: "Bearer x",
        nested: { a: 1 },
        list: [1, 2],
      }),
    ) as Record<string, unknown>;
    expect(parsed.companyId).toBe("comp-1");
    expect("secret" in parsed).toBe(false);
    expect("BETTER_AUTH_SECRET" in parsed).toBe(false);
    expect("password" in parsed).toBe(false);
    expect("token" in parsed).toBe(false);
    expect("authorization" in parsed).toBe(false);
    expect("nested" in parsed).toBe(false);
    expect("list" in parsed).toBe(false);
  });

  it("meringkas error menjadi name + message tanpa stack", () => {
    const parsed = JSON.parse(
      formatLogLine("error", "action.failed", undefined, new TypeError("boom")),
    ) as { error?: { name?: string; message?: string; stack?: string } };
    expect(parsed.error?.name).toBe("TypeError");
    expect(parsed.error?.message).toBe("boom");
    expect(parsed.error?.stack).toBeUndefined();
  });

  it("menangani error non-Error sebagai pesan string", () => {
    const parsed = JSON.parse(
      formatLogLine("error", "action.failed", undefined, "gagal total"),
    ) as { error?: { message?: string } };
    expect(parsed.error?.message).toBe("gagal total");
  });
});

describe("log.* menulis ke console sesuai level", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("log.error -> console.error, log.warn -> console.warn, log.info -> console.log", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    log.error("e1", { companyId: "c" }, new Error("x"));
    log.warn("e2");
    log.info("e3");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string).event).toBe("e1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string).event).toBe("e2");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string).event).toBe("e3");
  });
});
