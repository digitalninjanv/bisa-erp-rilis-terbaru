import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { adminDb } from "@/db/admin";
import { auditLog, companySettings } from "@/db/schema";
import { uploadQrisAction } from "@/server/actions/settings/pembayaran";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: ORG },
    user: { id: USER },
    role: "owner",
    permissions: ["settings.manage"],
  }),
  requirePermissionInModule: async () => ({
    company: { id: ORG },
    user: { id: USER },
    role: "owner",
    permissions: ["settings.manage"],
  }),
  requireAuth: async () => ({ company: { id: ORG }, user: { id: USER } }),
}));

let previous: string | null = null;

beforeAll(async () => {
  const [row] = await adminDb
    .select({ qrisImage: companySettings.qrisImage })
    .from(companySettings)
    .where(eq(companySettings.companyId, ORG));
  previous = row?.qrisImage ?? null;
});

afterAll(async () => {
  await adminDb
    .update(companySettings)
    .set({ qrisImage: previous })
    .where(eq(companySettings.companyId, ORG));
});

describe("audit perubahan QRIS", () => {
  it("menulis audit hash before/after tanpa menyimpan data URL penuh", async () => {
    const result = await uploadQrisAction({ dataUrl: DATA_URL });
    expect(result.ok).toBe(true);

    const [entry] = await adminDb
      .select({
        action: auditLog.action,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, ORG), eq(auditLog.action, "settings.qris.update")))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    expect(entry).toBeDefined();
    expect(entry.action).toBe("settings.qris.update");
    const after = entry.after as { hasImage?: boolean; sha256?: string };
    expect(after.hasImage).toBe(true);
    expect(after.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
