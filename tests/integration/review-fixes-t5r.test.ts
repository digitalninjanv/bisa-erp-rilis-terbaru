import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  cashSessions,
  companySettings,
  member,
  organization,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { adminSql } from "@/db/admin";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { sanitizeEnabledModules } from "@/lib/modules";
import { wipeCompanyFixture } from "../helpers/wipe-company";
import { openSessionAction } from "@/server/actions/pos";
import { saveEnabledModulesAction } from "@/server/actions/settings/modul";

// Tindak lanjut review Tahap 5:
//   T5R-1 (P1) — mematikan modul akuntansi TIDAK boleh mengunci
//     Pengaturan itu sendiri: layout pengaturan tidak lagi memakai
//     gerbang modul, dan action penyimpan saklar (jalan kembali masuk)
//     tidak pernah tergerbang modul. Test ini membuktikan lapisan
//     action-nya terhadap sesi ASLI: dengan akuntansi mati,
//     saveEnabledModulesAction tetap berhasil menyalakan semuanya lagi.
//   T5R-2 (P2) — saklar modul ditegakkan juga di lapisan action tulis,
//     bukan hanya layout halaman: openSessionAction (POS) ditolak
//     FORBIDDEN selama saklar pos mati, dan lolos sesudah dinyalakan.
// Sesi & cookie memakai pola M-T4-5 (modul sesi asli lewat auth dan
// next/headers yang diganti) di perusahaan uji tersendiri.

const USER_ID = "01900000-0000-7000-8000-000000000010"; // demo owner
const ORG_ID = "01900000-0000-7000-8000-00000000bb21";
const suffix = crypto.randomUUID().slice(0, 8);

const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: USER_ID, name: "Owner Demo", email: "owner@bisa.id" },
        session: { id: "sesi-uji-t5r" },
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

async function sessionCount(): Promise<number> {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const rows = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(eq(cashSessions.companyId, ORG_ID));
    return rows.length;
  });
}

beforeAll(async () => {
  await db
    .insert(organization)
    .values({ id: ORG_ID, name: "Perusahaan Uji T5R", slug: `uji-t5r-${suffix}` })
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
        legalName: "PT Uji T5R",
        enabledModules: { pos: false, gudang: true, akuntansi: false },
      })
      .onConflictDoNothing();
  });
  cookieJar.values.set(COMPANY_COOKIE_NAME, ORG_ID);
});

afterAll(async () => {
  cookieJar.values.clear();
  // AUD-001: dulu hanya 3 tabel + member + organisasi yang dihapus —
  // baris audit_log & tabel lain perusahaan uji tertinggal sebagai
  // residu. Helper bersama menghapus tuntas satu transaksi.
  await wipeCompanyFixture(adminSql, ORG_ID);
});

describe("T5R-2 saklar modul ditegakkan di lapisan action", () => {
  it("saklar pos mati → action tulis POS ditolak FORBIDDEN dan tidak menulis apa pun", async () => {
    const result = await openSessionAction({ openingCash: "10000" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
      expect(result.message).toBe("Modul POS sedang dinonaktifkan untuk perusahaan ini.");
    }
    expect(await sessionCount()).toBe(0);
  });
});

describe("T5R-1 jalan kembali dari saklar yang mematikan akuntansi", () => {
  it("saveEnabledModulesAction tetap bekerja saat akuntansi mati dan menyalakan semua modul lagi", async () => {
    // A-24 T2: payload saklar kini wajib memuat kunci "hr".
    const result = await saveEnabledModulesAction({ pos: true, gudang: true, akuntansi: true, hr: true, analisa: true });
    expect(result.ok).toBe(true);

    const stored = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ enabledModules: companySettings.enabledModules })
        .from(companySettings)
        .where(eq(companySettings.companyId, ORG_ID))
        .limit(1);
      return row?.enabledModules;
    });
    expect(sanitizeEnabledModules(stored)).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
  });

  it("sesudah saklar dinyalakan lagi, action tulis POS yang sama lolos dan benar-benar menulis", async () => {
    const result = await openSessionAction({ openingCash: "10000" });
    expect(result.ok).toBe(true);
    expect(await sessionCount()).toBe(1);
  });
});
