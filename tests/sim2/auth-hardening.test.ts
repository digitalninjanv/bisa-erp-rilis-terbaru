import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { adminDb, adminSql } from "@/db/admin";
import { account, member, organization, user } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * SIM-2 Fase S6 — SEC-02 & SEC-08 diuji pada handler auth SUNGGUHAN
 * (tanpa mock sesi):
 * - plugin admin()/organization() sudah dicabut dari konfigurasi dan
 *   endpoint-endpointnya tidak lagi dilayani;
 * - pendaftaran publik dimatikan: POST sign-up ditolak dan tidak
 *   membuat akun yatim;
 * - login email+sandi dan pembacaan sesi tetap bekerja persis seperti
 *   sebelumnya (bukti pencabutan plugin tidak merusak alur inti).
 */

const ORG = "01900000-0000-7000-8000-00000000cc09";
const USER_ID = "01900000-0000-7000-8000-00000000cc19";
const EMAIL = "pemilik@auth.id";
const PASSWORD = "Rahasia123!";
const BASE = "http://localhost:3000";

function authRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: { origin: BASE, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function wipeFixture() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    await tx.unsafe(`DELETE FROM session WHERE user_id = $1`, [USER_ID]);
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM account WHERE user_id = $1`, [USER_ID]);
    await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [USER_ID]);
    await tx.unsafe(`DELETE FROM "user" WHERE email = $1`, ["pendaftar@auth.id"]);
  });
}

beforeAll(async () => {
  await wipeFixture();
  await adminDb.insert(user).values({
    id: USER_ID, name: "Pemilik Auth", email: EMAIL, emailVerified: true, role: "user",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(),
    accountId: USER_ID,
    providerId: "credential",
    userId: USER_ID,
    password: await hashPassword(PASSWORD),
  });
  await adminDb.insert(organization).values({
    id: ORG, name: "Auth Mart", slug: "auth-mart", createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: USER_ID, role: "owner", createdAt: new Date(),
  });
});
afterAll(wipeFixture);

describe("SEC-02 — plugin dorman dicabut", () => {
  it("konfigurasi auth tidak lagi memuat plugin admin/organization", () => {
    const ids = (auth.options.plugins ?? []).map((plugin) => (plugin as { id?: string }).id);
    expect(ids).not.toContain("admin");
    expect(ids).not.toContain("organization");
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it("endpoint plugin organization tidak lagi dilayani (404)", async () => {
    const response = await auth.handler(
      authRequest("/api/auth/organization/create", {
        method: "POST",
        body: JSON.stringify({ name: "Org Siluman", slug: "org-siluman" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("endpoint plugin admin tidak lagi dilayani (404)", async () => {
    const response = await auth.handler(authRequest("/api/auth/admin/list-users?limit=1"));
    expect(response.status).toBe(404);
  });
});

describe("SEC-08 — pendaftaran publik dimatikan", () => {
  it("POST /sign-up/email ditolak dan tidak membuat akun", async () => {
    const response = await auth.handler(
      authRequest("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({ name: "Pendaftar", email: "pendaftar@auth.id", password: "Rahasia123!" }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const [created] = await adminDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "pendaftar@auth.id"))
      .limit(1);
    expect(created).toBeUndefined();
  });
});

describe("alur inti tetap hidup sesudah pencabutan", () => {
  it("sign-in kredensial yang benar berhasil dan sesi terbaca kembali", async () => {
    const signIn = await auth.handler(
      authRequest("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      }),
    );
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("session_token");

    const sessionResponse = await auth.handler(
      authRequest("/api/auth/get-session", { headers: { cookie } }),
    );
    expect(sessionResponse.status).toBe(200);
    const body = (await sessionResponse.json()) as { user?: { email?: string } } | null;
    expect(body?.user?.email).toBe(EMAIL);
  });

  it("sign-in dengan sandi salah tetap ditolak 401", async () => {
    const response = await auth.handler(
      authRequest("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: EMAIL, password: "BukanSandi123!" }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
