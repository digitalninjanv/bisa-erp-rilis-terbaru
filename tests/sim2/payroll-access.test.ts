import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  companySettings,
  employees,
  member,
  organization,
  payrollComponentDrafts,
  payrollItems,
  payrollRuns,
  user,
} from "@/db/schema";
import { can } from "@/lib/permissions";
import { MODULES } from "@/lib/modules";

/**
 * SIM-2 Fase S6 — Batch 1 (SEC-01): data gaji & kasbon hanya terbaca
 * oleh pemegang izin `payroll.view`.
 *
 * Berbeda dari mock sesi statis suite lain (yang selalu owner dan
 * mengabaikan izin), mock di sini DINAMIS dan MENEGAKKAN izin dengan
 * fungsi asli dari `@/lib/permissions` — jadi halaman/rute yang salah
 * gerbang akan benar-benar lolos untuk peran yang seharusnya ditolak,
 * dan test ini gagal. Halaman dipanggil sebagai fungsi server
 * component sungguhan: gerbangnya adalah baris pertamanya.
 */

const sessionState = vi.hoisted(() => ({
  role: "owner" as string,
  permissions: null as string[] | null,
  modules: null as string[] | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// A-28 Tahap 5: render statis halaman untuk peran manageable memuat
// komponen klien (PayrollWizard/EmployeeForm) yang memanggil
// useRouter — sediakan ganda uji router agar renderToStaticMarkup
// dapat membuktikan masking angka gaji pada permukaan operasional.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => "/app/akuntansi/payroll",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session", async () => {
  const perms = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  const mods = await vi.importActual<typeof import("@/lib/modules")>("@/lib/modules");
  const ORG_ID = "01900000-0000-7000-8000-00000000cc07";
  const USER_ID = "01900000-0000-7000-8000-00000000cc17";
  const buildCtx = () => ({
    user: { id: USER_ID, name: "Uji Akses", email: "uji@akses.id" },
    session: { id: "sesi-uji" },
    company: { id: ORG_ID, name: "Akses Mart", slug: "akses-mart" },
    companies: [{ id: ORG_ID, name: "Akses Mart" }],
    role: sessionState.role,
    roleName: sessionState.role,
    permissions: (sessionState.permissions ??
      perms.permissionsFor(sessionState.role)) as never,
    modules: (sessionState.modules ?? perms.modulesFor(sessionState.role)) as never,
    enabledModules: ["pos", "gudang", "akuntansi"] as never,
  });
  const requireAuth = async () => buildCtx();
  const requirePermission = async (permission: never) => {
    const ctx = buildCtx();
    perms.assertCan(ctx, permission);
    return ctx;
  };
  const requirePermissionInModule = async (permission: never, module: never) => {
    const ctx = await requirePermission(permission);
    mods.assertModuleEnabled(ctx.enabledModules as never, module);
    return ctx;
  };
  // A-23 SIS-04: halaman kini memanggil requirePermissionPage (di
  // runtime: pantulan redirect + banner, bukan lemparan). Dalam harness
  // ini halaman dipanggil sebagai fungsi polos, jadi ganda uji menjaga
  // semantik penolakan yang sama dengan requirePermission mock —
  // kontrak yang diuji berkas ini adalah SIAPA boleh membaca, dan
  // presentasi pantulannya terbukti di browser produksi.
  const requirePermissionPage = requirePermission;
  const requirePermissionPageInModule = requirePermissionInModule;
  return {
    requireAuth,
    requirePermission,
    requirePermissionInModule,
    requirePermissionPage,
    requirePermissionPageInModule,
    requireModuleAccess: requireAuth,
    getCompanyId: async () => ORG_ID,
    getSession: async () => null,
    listUserMemberships: async () => [],
  };
});

// A-24 T2: berkas halaman HR berpindah ke route group (hr) — URL dan
// komponennya identik, hanya jalur berkasnya yang berubah.
import PayrollPage from "@/app/app/akuntansi/(hr)/payroll/page";
import PayrollDetailPage from "@/app/app/akuntansi/(hr)/payroll/[id]/page";
import PayrollSlipsPrintPage from "@/app/app/akuntansi/(hr)/payroll/[id]/cetak/page";
import KasbonPage from "@/app/app/akuntansi/(hr)/kasbon/page";
import { wipeCompanyFixture } from "../helpers/wipe-company";
import KasbonEmployeePage from "@/app/app/akuntansi/(hr)/kasbon/[employeeId]/page";
import EmployeeDetailPage from "@/app/app/akuntansi/(hr)/karyawan/[id]/page";
import OvertimeThrPage from "@/app/app/akuntansi/(hr)/hr/lembur/page";
import { GET as exportPayroll } from "@/app/api/export/payroll/route";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { runPayrollAction } from "@/server/actions/hr/payroll";

const ORG = "01900000-0000-7000-8000-00000000cc07";
const OWNER = "01900000-0000-7000-8000-00000000cc17";
const EMPLOYEE = "01900000-0000-7000-8000-00000000cc27";
const RUN = "01900000-0000-7000-8000-00000000cc37";


async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

async function bootstrapFixture() {
  await wipeFixture();
  await adminDb.insert(user).values({
    id: OWNER, name: "Uji Akses", email: "owner@akses.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER, password: "x",
  });
  await adminDb.insert(organization).values({
    id: ORG, name: "Akses Mart", slug: "akses-mart", createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "Akses Mart", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  await adminDb.insert(employees).values({
    id: EMPLOYEE,
    companyId: ORG,
    code: "K-001",
    name: "Sari Gaji",
    position: "Kasir Senior",
    baseSalary: "7500000",
    allowances: "500000",
    deductions: "100000",
    isActive: true,
  });
  await adminDb.insert(payrollRuns).values({
    id: RUN,
    companyId: ORG,
    number: "PAY-2026-00001",
    period: "2026-10",
    status: "posted",
    totalGross: "8000000",
    totalDeductions: "100000",
    totalNet: "7900000",
  });
  await adminDb.insert(payrollItems).values({
    companyId: ORG,
    runId: RUN,
    employeeId: EMPLOYEE,
    baseSalary: "7500000",
    allowances: "500000",
    deductions: "100000",
    net: "7900000",
  });
  // A-28 Tahap 5: draf THR senilai tepat gaji pokok — nominal THR
  // adalah turunan upah, jadi ikut diuji tertutup bagi view-saja.
  await adminDb.insert(payrollComponentDrafts).values({
    companyId: ORG,
    employeeId: EMPLOYEE,
    kind: "thr",
    period: "2026-10",
    amount: "7500000",
    status: "draft",
    basisSnapshot: { monthsOfService: 14 },
  });
}

function asRole(role: string) {
  sessionState.role = role;
  sessionState.permissions = null;
  sessionState.modules = null;
}

function asCustom(permissions: string[]) {
  sessionState.role = "custom-uji";
  sessionState.permissions = permissions;
  sessionState.modules = ["pos", "gudang", "akuntansi"];
}

async function expectForbidden(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });
}

const SURFACES: Array<[string, () => Promise<unknown>]> = [
  ["halaman Payroll", () => PayrollPage()],
  ["halaman detail run payroll", () =>
    PayrollDetailPage({ params: Promise.resolve({ id: RUN }) })],
  ["halaman cetak slip gaji", () =>
    PayrollSlipsPrintPage({
      params: Promise.resolve({ id: RUN }),
      searchParams: Promise.resolve({}),
    })],
  ["halaman Kasbon", () => KasbonPage()],
  ["halaman riwayat kasbon per karyawan", () =>
    KasbonEmployeePage({ params: Promise.resolve({ employeeId: EMPLOYEE }) })],
  ["ekspor CSV rekap payroll", () =>
    exportPayroll(new NextRequest(`http://localhost/api/export/payroll?runId=${RUN}`))],
];

beforeAll(bootstrapFixture);
afterAll(wipeFixture);

describe("SEC-01 — matriks izin payroll.view", () => {
  it("manager memegang payroll.view; accountant & viewer tidak", () => {
    expect(can("owner", "payroll.view")).toBe(true);
    expect(can("admin", "payroll.view")).toBe(true);
    expect(can("manager", "payroll.view")).toBe(true);
    expect(can("accountant", "payroll.view")).toBe(false);
    expect(can("viewer", "payroll.view")).toBe(false);
    expect(can("cashier", "payroll.view")).toBe(false);
    expect(can("warehouse", "payroll.view")).toBe(false);
  });

  it("A-28 Tahap 5: payroll.salary dipegang owner/admin/manager; accountant & viewer tidak", () => {
    expect(can("owner", "payroll.salary")).toBe(true);
    expect(can("admin", "payroll.salary")).toBe(true);
    expect(can("manager", "payroll.salary")).toBe(true);
    expect(can("accountant", "payroll.salary")).toBe(false);
    expect(can("viewer", "payroll.salary")).toBe(false);
    expect(can("cashier", "payroll.salary")).toBe(false);
    expect(can("warehouse", "payroll.salary")).toBe(false);
  });

  it("menu Payroll & Kasbon digerbang payroll.view, bukan accounting.view", () => {
    // A-24 T2: itemnya kini hidup di nav modul HR (label pertama
    // "Payroll & Karyawan") — gerbang izinnya tidak berubah.
    const nav = MODULES.hr.nav;
    expect(nav.find((item) => item.href === "/app/akuntansi/payroll")?.permission).toBe("payroll.view");
    expect(nav.find((item) => item.label === "Kasbon")?.permission).toBe("payroll.view");
    expect(MODULES.akuntansi.nav.some((item) => item.permission === "payroll.view")).toBe(false);
  });
});

describe("SEC-01 — peran tanpa payroll.view ditolak di semua permukaan baca gaji", () => {
  for (const role of ["cashier", "warehouse", "accountant", "viewer"]) {
    describe(`sebagai ${role}`, () => {
      for (const [label, call] of SURFACES) {
        it(`menolak ${label}`, async () => {
          asRole(role);
          await expectForbidden(call());
        });
      }
    });
  }

  it("peran kustom bergaya akuntan (accounting.* tanpa payroll.view) tetap ditolak", async () => {
    asCustom(["accounting.view", "accounting.post", "accounting.manage", "inventory.view"]);
    await expectForbidden(PayrollPage());
    await expectForbidden(KasbonPage());
  });
});

describe("SEC-01 — pemegang payroll.view tetap bisa membaca", () => {
  for (const role of ["owner", "admin", "manager"]) {
    it(`sebagai ${role}: semua halaman gaji terbuka`, async () => {
      asRole(role);
      for (const [label, call] of SURFACES.slice(0, 5)) {
        const result = await call();
        expect(result, label).toBeTruthy();
      }
    });

    it(`sebagai ${role}: ekspor rekap payroll menghasilkan CSV berisi data karyawan`, async () => {
      asRole(role);
      const response = await exportPayroll(
        new NextRequest(`http://localhost/api/export/payroll?runId=${RUN}`),
      );
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("Sari Gaji");
    });
  }

  it("peran kustom dengan payroll.view eksplisit bisa membaca", async () => {
    asCustom(["accounting.view", "payroll.view"]);
    await expect(PayrollPage()).resolves.toBeTruthy();
    await expect(KasbonPage()).resolves.toBeTruthy();
  });
});

/**
 * A-28 Tahap 5 (H-HR-01) — izin KHUSUS angka gaji `payroll.salary`,
 * mengikuti pola `inventory.cost` vs `inventory.view`:
 * - Halaman HR tetap terbuka dengan payroll.view, tetapi angka gaji
 *   (komponen per karyawan, total run, slip, rekap ekspor, kartu gaji
 *   pokok di kasbon) hanya tampil/terbit untuk pemegang payroll.salary
 *   (atau payroll.manage untuk permukaan operasional yang ia proses).
 * - Slip & ekspor adalah dokumen gaji yang keluar dari layar —
 *   gerbang servernya payroll.salary, ditolak tanpa itu.
 * - Aksi tulis tetap payroll.manage untuk semua varian di atas.
 * Angka fixture: gaji pokok Rp7.500.000, run bruto Rp8.000.000,
 * bersih Rp7.900.000 — ketiganya tidak boleh muncul bagi view-saja.
 */
describe("H-HR-01 — payroll.view TANPA payroll.salary: HR terbuka, angka gaji tertutup", () => {
  async function render(element: Promise<unknown>): Promise<string> {
    return renderToStaticMarkup((await element) as ReactElement);
  }

  it("halaman Payroll: nama karyawan tampil, semua angka gaji hilang", async () => {
    asCustom(["payroll.view"]);
    const html = await render(PayrollPage());
    expect(html).toContain("Sari Gaji");
    expect(html).not.toContain("7.500.000");
    expect(html).not.toContain("8.000.000");
    expect(html).not.toContain("7.900.000");
  });

  it("detail run payroll: struktur run tampil, angka per karyawan & total hilang", async () => {
    asCustom(["payroll.view"]);
    const html = await render(PayrollDetailPage({ params: Promise.resolve({ id: RUN }) }));
    expect(html).toContain("PAY-2026-00001");
    expect(html).not.toContain("7.500.000");
    expect(html).not.toContain("7.900.000");
    // Seksi jurnal ikut tertutup (baris jurnalnya = agregat total run).
    expect(html).toContain("Jurnal terkait run ini tidak ditampilkan");
  });

  it("detail karyawan: profil tampil, gaji pokok & bersih payroll terakhir hilang", async () => {
    asCustom(["payroll.view"]);
    const html = await render(
      EmployeeDetailPage({
        params: Promise.resolve({ id: EMPLOYEE }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain("Sari Gaji");
    expect(html).not.toContain("7.500.000");
    expect(html).not.toContain("7.900.000");
  });

  it("riwayat kasbon per karyawan: halaman terbuka, kartu gaji pokok tertutup", async () => {
    asCustom(["payroll.view"]);
    const html = await render(KasbonEmployeePage({ params: Promise.resolve({ employeeId: EMPLOYEE }) }));
    expect(html).toContain("Sari Gaji");
    expect(html).not.toContain("7.500.000");
  });

  it("draf THR (turunan upah sebulan): nominal tertutup bagi view-saja, tampil bagi view+salary", async () => {
    asCustom(["payroll.view"]);
    const masked = await render(
      OvertimeThrPage({ searchParams: Promise.resolve({ period: "2026-10" }) }),
    );
    expect(masked).toContain("Sari Gaji");
    expect(masked).not.toContain("7.500.000");

    asCustom(["payroll.view", "payroll.salary"]);
    const open = await render(
      OvertimeThrPage({ searchParams: Promise.resolve({ period: "2026-10" }) }),
    );
    expect(open).toContain("7.500.000");
  });

  it("slip gaji DITOLAK di server (dokumen gaji), bukan sekadar tautannya disembunyikan", async () => {
    asCustom(["payroll.view"]);
    await expectForbidden(
      PayrollSlipsPrintPage({
        params: Promise.resolve({ id: RUN }),
        searchParams: Promise.resolve({}),
      }),
    );
  });

  it("ekspor rekap payroll DITOLAK tanpa payroll.salary", async () => {
    asCustom(["payroll.view"]);
    await expectForbidden(
      exportPayroll(new NextRequest(`http://localhost/api/export/payroll?runId=${RUN}`)),
    );
  });

  it("aksi tulis payroll tetap DITOLAK untuk view-saja maupun view+salary (bukan manage)", async () => {
    asCustom(["payroll.view"]);
    const deniedView = await runPayrollAction({ period: "2026-11" });
    expect(deniedView.ok).toBe(false);
    if (!deniedView.ok) expect(deniedView.code).toBe("FORBIDDEN");

    asCustom(["payroll.view", "payroll.salary"]);
    const deniedSalary = await runPayrollAction({ period: "2026-11" });
    expect(deniedSalary.ok).toBe(false);
    if (!deniedSalary.ok) expect(deniedSalary.code).toBe("FORBIDDEN");
  });
});

describe("H-HR-01 — pemegang payroll.salary membaca angka gaji; manage tetap penuh", () => {
  async function render(element: Promise<unknown>): Promise<string> {
    return renderToStaticMarkup((await element) as ReactElement);
  }

  it("peran kustom view+salary: angka gaji tampil di halaman Payroll & slip terbuka", async () => {
    asCustom(["payroll.view", "payroll.salary"]);
    const list = await render(PayrollPage());
    expect(list).toContain("7.500.000");
    expect(list).toContain("7.900.000");
    const slip = await render(
      PayrollSlipsPrintPage({
        params: Promise.resolve({ id: RUN }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(slip).toContain("Sari Gaji");
    expect(slip).toContain("7.500.000");
  });

  it("peran kustom salary-saja (pola akuntan pemeriksa): ekspor rekap lolos, halaman HR tetap tertutup", async () => {
    asCustom(["payroll.salary"]);
    const response = await exportPayroll(
      new NextRequest(`http://localhost/api/export/payroll?runId=${RUN}`),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Sari Gaji");
    await expectForbidden(PayrollPage());
  });

  it("peran kustom view+manage tanpa salary: permukaan operasional tetap melihat angka yang ia proses", async () => {
    asCustom(["payroll.view", "payroll.manage"]);
    const list = await render(PayrollPage());
    expect(list).toContain("7.500.000");
  });

  it("manager (view+salary bawaan, tanpa manage): membaca penuh, menulis ditolak", async () => {
    asRole("manager");
    const list = await render(PayrollPage());
    expect(list).toContain("7.500.000");
    const denied = await runPayrollAction({ period: "2026-11" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("FORBIDDEN");
  });
});

/**
 * A-28 UI-4 (UX-C02) — riwayat payroll: NOMOR run adalah tautan ke
 * detail run; teks periode kembali polos. Sebelumnya terbalik
 * (periode tertaut, nomor teks redup) — menyimpang dari semua
 * daftar dokumen lain yang menautkan nomor dokumennya.
 */
describe("A-28 UI-4 — riwayat payroll menautkan nomor run, bukan periode", () => {
  async function render(element: Promise<unknown>): Promise<string> {
    return renderToStaticMarkup((await element) as ReactElement);
  }

  it("nomor run terbungkus tautan ke detail; periode tidak tertaut", async () => {
    asRole("owner");
    const html = await render(PayrollPage());
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*href="/app/akuntansi/payroll/${RUN}"[^>]*>\\s*PAY-2026-00001\\s*</a>`,
      ),
    );
    expect(html).not.toMatch(/<a[^>]*>\s*Oktober 2026\s*<\/a>/);
    expect(html).toContain("Oktober 2026");
  });
});
