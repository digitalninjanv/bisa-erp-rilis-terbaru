import { beforeEach, describe, expect, it, vi } from "vitest";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("@/lib/log", () => ({ log: { info } }));
vi.mock("@/lib/session", () => ({
  requireAuth: async () => ({
    company: { id: "company-auth" },
    user: { id: "user-auth" },
  }),
}));

import { POST } from "@/app/api/pos/telemetry/route";

describe("POS telemetry route input bounds", () => {
  beforeEach(() => info.mockClear());

  it("rejects non-JSON content types", async () => {
    const response = await POST(new Request("http://localhost/api/pos/telemetry", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }));
    expect(response.status).toBe(415);
    expect(info).not.toHaveBeenCalled();
  });

  it("rejects request bodies over 8 KiB", async () => {
    const response = await POST(new Request("http://localhost/api/pos/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ details: { payload: "x".repeat(9_000) } }),
    }));
    expect(response.status).toBe(413);
    expect(info).not.toHaveBeenCalled();
  });

  it("caps detail fields/strings and keeps authenticated identity authoritative", async () => {
    const details = {
      companyId: "attacker",
      userId: "attacker",
      event: "attacker",
      longValue: "x".repeat(300),
      ...Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [`field${index}`, "x".repeat(80)]),
      ),
    };
    const response = await POST(new Request("http://localhost/api/pos/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "checkout", details }),
    }));

    expect(response.status).toBe(200);
    const fields = info.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.companyId).toBe("company-auth");
    expect(fields.userId).toBe("user-auth");
    expect(fields.event).toBe("checkout");
    expect(Object.keys(fields).filter((key) => key.startsWith("field"))).toHaveLength(28);
    expect((fields.longValue as string).length).toBe(256);
  });
});
