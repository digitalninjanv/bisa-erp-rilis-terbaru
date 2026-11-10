import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, organization } from "@/db/schema";
import { switchCompanyAction } from "@/server/actions/company";

// LINTAS-01: the switch action validates membership against the real
// member table and writes the choice to an httpOnly cookie. Only the
// session lookup and Next's cookie store are faked; the database is real.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const cookieJar = vi.hoisted(() => ({
  values: new Map<string, { value: string; options?: Record<string, unknown> }>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = cookieJar.values.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieJar.values.set(name, { value, options });
    },
    delete: (name: string) => {
      cookieJar.values.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

const USER_ID = "01900000-0000-7000-8000-000000000010"; // demo owner
vi.mock("@/lib/session", () => ({
  getSession: async () => ({ user: { id: USER_ID }, session: { id: "test-session" } }),
}));

const ORG2_ID = "01900000-0000-7000-8000-00000000bb02";
const ORG2_SLUG = "uji-kedua-t46a";
const FOREIGN_ORG_ID = "01900000-0000-7000-8000-00000000bb99";

beforeAll(async () => {
  await db
    .insert(organization)
    .values({ id: ORG2_ID, name: "Perusahaan Uji Kedua", slug: ORG2_SLUG })
    .onConflictDoNothing();
  await db
    .insert(member)
    .values({
      id: crypto.randomUUID(),
      organizationId: ORG2_ID,
      userId: USER_ID,
      role: "admin",
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db
    .delete(member)
    .where(and(eq(member.organizationId, ORG2_ID), eq(member.userId, USER_ID)));
  await db.delete(organization).where(eq(organization.id, ORG2_ID));
});

beforeEach(() => {
  cookieJar.values.clear();
});

describe("switchCompanyAction (LINTAS-01)", () => {
  it("menerima perusahaan tempat pengguna menjadi anggota dan menulis cookie httpOnly", async () => {
    const result = await switchCompanyAction(ORG2_ID);
    expect(result.ok).toBe(true);

    const stored = cookieJar.values.get("bisa_company");
    expect(stored?.value).toBe(ORG2_ID);
    expect(stored?.options?.httpOnly).toBe(true);
    expect(stored?.options?.sameSite).toBe("lax");
    expect(stored?.options?.path).toBe("/");
  });

  it("menolak perusahaan yang bukan keanggotaan pengguna (FORBIDDEN) tanpa menulis cookie", async () => {
    const result = await switchCompanyAction(FOREIGN_ORG_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    expect(cookieJar.values.has("bisa_company")).toBe(false);
  });
});
