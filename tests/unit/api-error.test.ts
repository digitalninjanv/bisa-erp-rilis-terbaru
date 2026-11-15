import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiErrorResponse, withApiError } from "@/lib/api-error";
import { AppError } from "@/lib/errors";

describe("SEC-006 — mapper error route export/API", () => {
  it("memetakan AppError ke status HTTP yang benar", async () => {
    const cases = [
      ["VALIDATION", 400],
      ["FORBIDDEN", 403],
      ["NOT_FOUND", 404],
      ["CONFLICT", 409],
      ["PERIOD_CLOSED", 409],
      ["INSUFFICIENT_STOCK", 409],
      ["INVALID_STATE", 409],
      ["INTERNAL", 500],
    ] as const;
    for (const [code, status] of cases) {
      const response = apiErrorResponse(new AppError(code, `pesan ${code}`));
      expect(response.status, code).toBe(status);
      const body = (await response.json()) as { code?: string; error?: string };
      expect(body.code).toBe(code);
      expect(body.error).toContain(code);
    }
  });

  it("memetakan ZodError ke 400 dengan issue per field", async () => {
    const parsed = z.object({ qty: z.number().positive() }).safeParse({ qty: -1 });
    expect(parsed.success).toBe(false);
    const response = apiErrorResponse(parsed.error);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; issues: { path: string }[] };
    expect(body.code).toBe("VALIDATION");
    expect(body.issues[0]?.path).toBe("qty");
  });

  it("error tak dikenal tetap 500 tanpa membocorkan detail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiErrorResponse(new Error("rahasia internal"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toContain("rahasia internal");
    spy.mockRestore();
  });

  it("wrapper meneruskan hasil sukses dan menangkap error", async () => {
    const ok = withApiError(async () => new Response("ok", { status: 200 }));
    expect((await ok()).status).toBe(200);
    const denied = withApiError(async () => {
      throw new AppError("FORBIDDEN", "Tidak punya akses.");
    });
    expect((await denied()).status).toBe(403);
  });
});
