import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  companySettings,
  departments,
  member,
  organization,
} from "@/db/schema";
import { adminSql } from "@/db/admin";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { wipeCompanyFixture } from "../helpers/wipe-company";
import { createEmployeeAdvanceAction } from "@/server/actions/employee-advances";
import { saveDepartmentAction } from "@/server/actions/hr/organisasi";

// A-24 T2 susulan (keputusan Pemimpin 2026-11-05): gerbang lapisan
// aksi payroll/HR memakai modul "hr", BUKAN "akuntansi" — saklar
// perusahaan HR-lah yang mengatur aksi payroll, sesuai makna HR
// sebagai modul yang berdiri sendiri. Test ini membuktikan matriks
// saklarnya terhadap sesi ASLI (pola M-T4-5 / T5R) di perusahaan uji
// tersendiri:
//   HR mati + akuntansi hidup → aksi payroll DITOLAK (dulu: lolos).
//   HR hidup + akuntansi mati → aksi payroll LOLOS untuk pemegang
//     payroll.manage (dulu: ditolak).
// Perubahan perilaku ini disengaja dan tercatat; test lama yang
// menegaskan gerbang "akuntansi" untuk aksi payroll disesuaikan
// mengikuti keputusan ini.

const USER_ID = "01900000-0000-7000-8000-000000000010"; // demo owner
const ORG_ID = "01900000-0000-7000-8000-00000000aa24";
const suffix = crypto.randomUUID().slice(0, 8);
const HR_OFF_MESSAGE = "Modul HR sedang dinonaktifkan untuk perusahaan ini.";

const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: USER_ID, name: "Owner Demo", email: "owner@bisa.id" },
        session: { id: "sesi-uji-hr-gate" },
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
}));

type Switches = { pos: boolean; gudang: boolean; akuntansi: boolean; hr: boolean };

async function setEnabledModules(enabledModules: Switches): Promise<void> {
  await withCompany(ORG_ID, async (tx) => {
    await tx
      .update(companySettings)
      .set({ enabledModules })
      .where(eq(companySettings.companyId, ORG_ID));
  });
}

async function departmentCount(): Promise<number> {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const rows = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.companyId, ORG_ID));
    return rows.length;
  });
}

beforeAll(async () => {
  await db
    .insert(organization)
    .values({ id: ORG_ID, name: "Perusahaan Uji Gerbang HR", slug: `uji-hr-gate-${suffix}` })
    .onConflictDoNothing();
  await db
    .insert(member)
    .values({ id: crypto.randomUUID(), organizationId: ORG_ID, userId: USER_ID, role: "owner" })
    .onConflictDoNothing();
  await withCompany(ORG_ID, async (tx) => {
    await tx
      .insert(companySettings)
      .values({
        companyId: ORG_ID,
        legalName: "PT Uji Gerbang HR",
        enabledModules: { pos: true, gudang: true, akuntansi: true, hr: false },
      })
      .onConflictDoNothing();
  });
  cookieJar.values.set(COMPANY_COOKIE_NAME, ORG_ID);
});

afterAll(async () => {
  cookieJar.values.clear();
  // AUD-001: baris audit_log perusahaan uji dulu dibiarkan (trigger
  // forbid_mutation menghalangi delete peran aplikasi) — itulah salah
  // satu sumber residu AUD-001. Helper bersama menghapus tuntas lewat
  // koneksi pemilik dalam satu transaksi (pola suite fixture lain).
  await wipeCompanyFixture(adminSql, ORG_ID);
});

describe("A-24 T2 susulan — gerbang aksi payroll diatur saklar modul HR", () => {
  it("HR mati walau akuntansi hidup → aksi payroll (hr.ts) ditolak FORBIDDEN dan tidak menulis", async () => {
    await setEnabledModules({ pos: true, gudang: true, akuntansi: true, hr: false });
    const result = await saveDepartmentAction({ code: "OPS", name: "Operasional" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
      expect(result.message).toBe(HR_OFF_MESSAGE);
    }
    expect(await departmentCount()).toBe(0);
  });

  it("HR mati walau akuntansi hidup → aksi kasbon (employee-advances.ts) ikut ditolak oleh gerbang HR", async () => {
    await setEnabledModules({ pos: true, gudang: true, akuntansi: true, hr: false });
    const result = await createEmployeeAdvanceAction({
      employeeId: crypto.randomUUID(),
      date: "2026-11-05",
      amount: "100000",
      accountId: crypto.randomUUID(),
      planMode: "full",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
      expect(result.message).toBe(HR_OFF_MESSAGE);
    }
  });

  it("HR hidup walau akuntansi mati → aksi payroll lolos untuk pemegang payroll.manage dan benar-benar menulis", async () => {
    await setEnabledModules({ pos: true, gudang: true, akuntansi: false, hr: true });
    const result = await saveDepartmentAction({ code: "OPS", name: "Operasional" });
    expect(result.ok).toBe(true);
    expect(await departmentCount()).toBe(1);
  });
});
