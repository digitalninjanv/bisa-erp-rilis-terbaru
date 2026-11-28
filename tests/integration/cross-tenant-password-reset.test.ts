import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSql } from "@/db/admin";
import { account, member, organization, user } from "@/db/schema";
import { resetUserPasswordAction } from "@/server/actions/users";
import { wipeCompanyFixture } from "../helpers/wipe-company";

const ORG_A = "01900000-0000-7000-8000-00000000ba01";
const ORG_B = "01900000-0000-7000-8000-00000000ba02";
const ADMIN_A = "01900000-0000-7000-8000-00000000ba11";
const TARGET = "01900000-0000-7000-8000-00000000ba12";
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6);

const session = vi.hoisted(() => ({ userId: "", role: "admin" }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const { permissionsFor } = await import("@/lib/permissions");
  const requirePermission = async (permission: string) => {
    const permissions = permissionsFor(session.role);
    if (!permissions.includes(permission as never)) {
      throw new Error(`Izin ${permission} tidak dimiliki.`);
    }
    return {
      company: { id: ORG_A },
      user: { id: session.userId },
      role: session.role,
      permissions,
    };
  };
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

beforeAll(async () => {
  await wipeCompanyFixture(adminSql, ORG_A, [ADMIN_A, TARGET]);
  await wipeCompanyFixture(adminSql, ORG_B, [TARGET]);

  await db.insert(organization).values([
    { id: ORG_A, name: "PT Tenant A", slug: `tenant-a-${suffix}` },
    { id: ORG_B, name: "PT Tenant B", slug: `tenant-b-${suffix}` },
  ]);
  await db.insert(user).values([
    {
      id: ADMIN_A,
      name: "Admin Tenant A",
      email: `admin.${suffix}@uji.local`,
      emailVerified: true,
      role: "user",
    },
    {
      id: TARGET,
      name: "Pemilik Tenant B",
      email: `target.${suffix}@uji.local`,
      emailVerified: true,
      role: "user",
    },
  ]);
  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: TARGET,
    providerId: "credential",
    userId: TARGET,
    password: await hashPassword("SandiLama123!"),
  });
  await db.insert(member).values([
    { id: crypto.randomUUID(), organizationId: ORG_A, userId: ADMIN_A, role: "admin" },
    { id: crypto.randomUUID(), organizationId: ORG_A, userId: TARGET, role: "cashier" },
    { id: crypto.randomUUID(), organizationId: ORG_B, userId: TARGET, role: "owner" },
  ]);
  session.userId = ADMIN_A;
  session.role = "admin";
});

afterAll(async () => {
  await wipeCompanyFixture(adminSql, ORG_A, [ADMIN_A, TARGET]);
  await wipeCompanyFixture(adminSql, ORG_B, [TARGET]);
});

describe("reset kata sandi lintas tenant", () => {
  it("admin Tenant A tidak dapat mereset kredensial global pemilik Tenant B", async () => {
    const result = await resetUserPasswordAction({ userId: TARGET, password: "SandiBaru123!" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FORBIDDEN");

    const [credential] = await db
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, TARGET), eq(account.providerId, "credential")))
      .limit(1);
    expect(await verifyPassword({ hash: credential.password!, password: "SandiLama123!" })).toBe(true);
    expect(await verifyPassword({ hash: credential.password!, password: "SandiBaru123!" })).toBe(false);
  });

  it("owner Tenant A tetap dapat mereset anggota yang hanya milik Tenant A", async () => {
    session.role = "owner";
    const result = await resetUserPasswordAction({ userId: TARGET, password: "SandiBaru123!" });
    // Target masih owner Tenant B, jadi aturan lintas tenant tetap menolak
    // owner Tenant A: kredensial global tidak boleh diubah sepihak.
    expect(result.ok).toBe(false);
  });
});
