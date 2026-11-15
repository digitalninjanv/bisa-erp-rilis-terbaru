import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSql } from "@/db/admin";
import { withCompany } from "@/db/tenant";
import { companySettings, member, organization, user } from "@/db/schema";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { assertSessionFresh } from "@/lib/session";
import { GET as payrollExportGET } from "@/app/api/export/payroll/route";
import {
  seedMissingPeriodsAction,
  setPeriodStatusAction,
} from "@/server/actions/accounting/periode";
import { updateUserRoleAction } from "@/server/actions/users";
import { closeSessionAction, openSessionAction } from "@/server/actions/pos";
import { ensureFiscalPeriods } from "@/server/accounting";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// =====================================================================
// Program Rekayasa — R3 K-5: gerbang kesegaran sesi (freshAge 3.600
// detik) pada 10 titik sensitif bernama. Semantik dinilai dari
// session.createdAt — cermin freshSessionMiddleware Better Auth
// 1.7.15 (refresh updateAge tidak menggeser createdAt). Mock hanya
// lapisan autentikasi Better Auth (createdAt dapat diatur per test)
// + cookie Next; resolusi member/izin sungguhan di perusahaan
// fixture buangan (…e331) dengan peran owner.
// =====================================================================

const ORG = "01900000-0000-7000-8000-00000000e331";
const OWNER_ID = "01900000-0000-7000-8000-00000000e341";
const TARGET_ID = "01900000-0000-7000-8000-00000000e342";
const YEAR = 2026;

const sessionState = vi.hoisted(() => ({ createdAt: new Date() }));
const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: OWNER_ID, name: "Pemilik Uji K5", email: "k5@uji.local" },
        session: {
          id: "sesi-uji-k5",
          createdAt: sessionState.createdAt,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.values.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.values.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => "/app",
  useSearchParams: () => new URLSearchParams(),
}));

function setFresh() {
  sessionState.createdAt = new Date();
}
function setStale() {
  sessionState.createdAt = new Date(Date.now() - 2 * 3_600_000);
}

async function bootstrap() {
  await db
    .insert(organization)
    .values({ id: ORG, name: "Perusahaan Uji K5", slug: "uji-r3-k5" })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values([
      { id: OWNER_ID, name: "Pemilik Uji K5", email: "k5@uji.local" },
      { id: TARGET_ID, name: "Sasaran Uji K5", email: "k5-target@uji.local" },
    ])
    .onConflictDoNothing();
  await db
    .insert(member)
    .values([
      { id: crypto.randomUUID(), organizationId: ORG, userId: OWNER_ID, role: "owner" },
      { id: crypto.randomUUID(), organizationId: ORG, userId: TARGET_ID, role: "cashier" },
    ])
    .onConflictDoNothing();
  cookieJar.values.set(COMPANY_COOKIE_NAME, ORG);

  await withCompany(ORG, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (existing) return;
    await tx.insert(companySettings).values({
      companyId: ORG,
      legalName: "Uji Rekayasa K5",
      roundingMode: "none",
      taxRate: "11",
      taxEnabled: false,
      enabledModules: { pos: true, gudang: true, akuntansi: true, hr: true },
    });
    await ensureFiscalPeriods(tx, ORG, YEAR);
  });
}

beforeAll(bootstrap, 120_000);
afterAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, [OWNER_ID, TARGET_ID]);
});

describe("K-5 — penilai kesegaran murni (batas Better Auth)", () => {
  const now = new Date("2026-11-08T10:00:00.000Z");
  it("umur 3.599 detik: lolos", () => {
    expect(() =>
      assertSessionFresh(new Date(now.getTime() - 3_599_000), now),
    ).not.toThrow();
  });
  it("umur 3.600 detik: ditolak (batas inklusif, cermin middleware)", () => {
    expect(() => assertSessionFresh(new Date(now.getTime() - 3_600_000), now)).toThrowError(
      /masuk ulang/,
    );
  });
  it("umur 3.601 detik: ditolak", () => {
    expect(() => assertSessionFresh(new Date(now.getTime() - 3_601_000), now)).toThrowError(
      /masuk ulang/,
    );
  });
});

describe("K-5 — titik sensitif bernama", () => {
  it("sesi SEGAR: tutup periode, ubah peran, ekspor payroll (404 run tak ada) semua lolos gerbang", async () => {
    setFresh();
    const closed = await setPeriodStatusAction({
      year: YEAR,
      month: 3,
      status: "closed",
      reason: "Uji kesegaran sesi segar",
    });
    expect(closed.ok).toBe(true);
    const reopened = await setPeriodStatusAction({
      year: YEAR,
      month: 3,
      status: "open",
      reason: "Buka kembali untuk uji kesegaran sesi",
    });
    expect(reopened.ok).toBe(true);

    const role = await updateUserRoleAction({ userId: TARGET_ID, role: "viewer" });
    expect(role.ok).toBe(true);

    const response = await payrollExportGET(
      new NextRequest("http://localhost/api/export/payroll?runId=01900000-0000-7000-8000-00000000e399"),
    );
    expect(response.status).toBe(404);
  });

  it("sesi TUA (2 jam): ketiga permukaan ditolak FORBIDDEN dengan pesan masuk ulang", async () => {
    setStale();
    const period = await setPeriodStatusAction({
      year: YEAR,
      month: 4,
      status: "closed",
      reason: "Uji kesegaran sesi tua",
    });
    expect(period.ok).toBe(false);
    if (!period.ok) {
      expect(period.code).toBe("FORBIDDEN");
      expect(period.message).toMatch(/masuk ulang/);
    }

    const role = await updateUserRoleAction({ userId: TARGET_ID, role: "cashier" });
    expect(role.ok).toBe(false);
    if (!role.ok) expect(role.code).toBe("FORBIDDEN");

    const exportResponse = await payrollExportGET(
      new NextRequest("http://localhost/api/export/payroll?runId=01900000-0000-7000-8000-00000000e399"),
    );
    expect(exportResponse.status).toBe(403);
    expect(await exportResponse.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("kontrol negatif: sesi TUA tetap lolos di permukaan yang sengaja tidak digerbang", async () => {
    setStale();
    // seedMissingPeriodsAction: dikecualikan sadar oleh R2 (bukan finalitas).
    const seeded = await seedMissingPeriodsAction({ year: YEAR });
    expect(seeded.ok).toBe(true);

    // Operasi POS (buka sesi kas): dikecualikan sadar — frekuensi
    // operasional tinggi, bergerbang izin + modul saja.
    const opened = await openSessionAction({ openingCash: "100000" });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      const closedSession = await closeSessionAction({
        sessionId: opened.data.id,
        countedCash: "100000",
      });
      expect(closedSession.ok).toBe(true);
    }
  });
});
