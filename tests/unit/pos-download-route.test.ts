import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/pos/download/[format]/route";

afterEach(() => vi.unstubAllEnvs());

describe("POS desktop download route", () => {
  it("redirects AppImage to the published GitHub Release when no local release dir exists", async () => {
    vi.stubEnv("BISA_POS_RELEASE_DIR", "");
    const response = await GET(new Request("http://localhost/api/pos/download/appimage"), {
      params: Promise.resolve({ format: "appimage" }),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(
      "/releases/latest/download/Bisa-POS-linux-x86_64.AppImage",
    );
  });

  it("keeps the explicit 404 for formats without a published fallback", async () => {
    vi.stubEnv("BISA_POS_RELEASE_DIR", "");
    const response = await GET(new Request("http://localhost/api/pos/download/exe"), {
      params: Promise.resolve({ format: "exe" }),
    });
    expect(response.status).toBe(404);
  });
});
