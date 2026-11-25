import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  account,
  accountMappings,
  accounts,
  branches,
  categories,
  companySettings,
  employees,
  fiscalPeriods,
  member,
  organization,
  products,
  suppliers,
  units,
  user,
  warehouses,
} from "@/db/schema";
import { can, type Permission } from "@/lib/permissions";
import { todayISO } from "@/lib/format";

/**
 * SIM-2 Fase S6 — Batch 2 (§13): matriks RBAC teruji.
 *
 * Setiap peran bawaan memanggil AKSI SERVER sungguhan (bukan sekadar
 * UI yang disembunyikan) lewat mock sesi dinamis yang menegakkan izin
 * ASLI dari `@/lib/permissions`. Hasil yang ditegaskan per sel:
 * - peran berizin penuh → aksi benar-benar berhasil (ok) bila murah
 *   dan aman di fixture, atau minimal lolos gerbang (bukan FORBIDDEN);
 * - peran tanpa izin → `{ ok: false, code: "FORBIDDEN" }` DAN keadaan
 *   data tidak berubah (produk tidak tercipta, harga tidak bergerak,
 *   pihak tidak tergabung).
 * Tabel ekspektasi ditulis tangan di sini, lalu dicocokkan ulang ke
 * `permissions.ts` oleh meta-test — perubahan matriks izin di masa
 * depan wajib meninjau berkas ini, bukan lolos diam-diam.
 */

const sessionState = vi.hoisted(() => ({ role: "owner" as string }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const perms = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  const mods = await vi.importActual<typeof import("@/lib/modules")>("@/lib/modules");
  const ORG_ID = "01900000-0000-7000-8000-00000000cc08";
  const USER_ID = "01900000-0000-7000-8000-00000000cc18";
  const buildCtx = () => ({
    user: { id: USER_ID, name: "Uji RBAC", email: "uji@rbac.id" },
    session: { id: "sesi-rbac" },
    company: { id: ORG_ID, name: "RBAC Mart", slug: "rbac-mart" },
    companies: [{ id: ORG_ID, name: "RBAC Mart" }],
    role: sessionState.role,
    roleName: sessionState.role,
    permissions: perms.permissionsFor(sessionState.role) as never,
    modules: perms.modulesFor(sessionState.role) as never,
    // Semua modul aktif. "hr" wajib ada sejak A-24 T2 susulan
    // (keputusan Pemimpin 2026-11-05): gerbang aksi payroll kini
    // bermodul "hr", bukan "akuntansi" — tanpa "hr" di daftar ini
    // seluruh sel payroll akan tertolak FORBIDDEN oleh saklar modul,
    // bukan oleh matriks izin yang sedang diuji berkas ini.
    enabledModules: ["pos", "gudang", "akuntansi", "hr"] as never,
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
  return {
    requireAuth,
    requirePermission,
    requirePermissionInModule,
    requireModuleAccess: requireAuth,
    getCompanyId: async () => ORG_ID,
    getSession: async () => null,
    listUserMemberships: async () => [],
  };
});

import {
  checkoutAction,
  createReturnAction,
  voidSaleAction,
} from "@/server/actions/pos";
import {
  closeSessionAction,
  openSessionAction,
  prepareSessionCloseAction,
} from "@/server/actions/pos-sessions";
import {
  deleteProductAction,
  saveProductAction,
} from "@/server/actions/inventory/produk";
import { postManualJournalAction } from "@/server/actions/accounting/jurnal";
import { setPeriodStatusAction } from "@/server/actions/accounting/periode";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import { wipeCompanyFixture } from "../helpers/wipe-company";
import { createEmployeeAdvanceAction } from "@/server/actions/employee-advances";
import { createCompanyUserAction } from "@/server/actions/users";
import { saveSettingsAction } from "@/server/actions/settings/identitas-pajak";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import {
  applyBulkEditProductsAction,
  mergePartyAction,
} from "@/server/actions/master-data";

const ORG = "01900000-0000-7000-8000-00000000cc08";
const OWNER = "01900000-0000-7000-8000-00000000cc18";
const FAKE = "01900000-0000-7000-8000-00000000dead";
const TODAY = todayISO();

const ROLES = ["owner", "admin", "manager", "cashier", "warehouse", "accountant", "viewer"] as const;
type Role = (typeof ROLES)[number];

const F = {
  wh: "",
  cat: "",
  unit: "",
  kas: "",
  pendapatan: "",
  employee: "",
  sentinelProduct: "",
  sentinelPair: { primary: "", duplicate: "" },
};


async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

async function bootstrapFixture() {
  await wipeFixture();
  await adminDb.insert(user).values({
    id: OWNER, name: "Uji RBAC", email: "owner@rbac.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER, password: "x",
  });
  await adminDb.insert(organization).values({
    id: ORG, name: "RBAC Mart", slug: "rbac-mart", createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  const [branch] = await adminDb
    .insert(branches)
    .values({ companyId: ORG, code: "BR-RB", name: "RBAC Pusat", isDefault: true })
    .returning();
  const [wh] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, branchId: branch.id, code: "WH-RB", name: "Gudang RBAC", type: "warehouse", isDefault: true })
    .returning();
  F.wh = wh.id;
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "RBAC Mart", defaultWarehouseId: wh.id,
    roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const accountSeeds: Array<[string, string, string, "debit" | "credit"]> = [
    ["1000", "Kas", "asset", "debit"],
    ["1300", "Persediaan", "asset", "debit"],
    ["2100", "Utang Gaji", "liability", "credit"],
    ["4000", "Penjualan", "revenue", "credit"],
    ["6000", "Beban Gaji", "expense", "debit"],
  ];
  const rows = await adminDb
    .insert(accounts)
    .values(accountSeeds.map(([code, name, type, normalBalance]) => ({ companyId: ORG, code, name, type, normalBalance })))
    .returning();
  const acc: Record<string, string> = {};
  for (const row of rows) acc[row.code] = row.id;
  F.kas = acc["1000"];
  F.pendapatan = acc["4000"];
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc["1000"] },
    { companyId: ORG, key: "inventory", accountId: acc["1300"] },
    { companyId: ORG, key: "salary_payable", accountId: acc["2100"] },
    { companyId: ORG, key: "revenue", accountId: acc["4000"] },
    { companyId: ORG, key: "salary_expense", accountId: acc["6000"] },
  ]);
  const [cat] = await adminDb.insert(categories).values({ companyId: ORG, name: "RBAC Umum" }).returning();
  F.cat = cat.id;
  const [unit] = await adminDb.insert(units).values({ companyId: ORG, code: "PCS", name: "Pieces" }).returning();
  F.unit = unit.id;
  // Baris periode fiskal 2020 yang akan ditutup oleh peran berizin
  // (setPeriodStatusAction menolak periode tanpa baris: NOT_FOUND).
  await adminDb.insert(fiscalPeriods).values(
    [1, 2, 3, 6].map((month) => ({ companyId: ORG, year: 2020, month, status: "open" })),
  );
  const [emp] = await adminDb
    .insert(employees)
    .values({ companyId: ORG, code: "K-RB1", name: "Rani RBAC", baseSalary: "5000000", isActive: true })
    .returning();
  F.employee = emp.id;
  const [sentinel] = await adminDb
    .insert(products)
    .values({
      companyId: ORG, sku: "RBAC-SENTINEL", name: "Produk Sentinel RBAC",
      categoryId: cat.id, unitId: unit.id, costPrice: "8000", salePrice: "10000", isActive: true,
    })
    .returning();
  F.sentinelProduct = sentinel.id;
  const pair = await adminDb
    .insert(suppliers)
    .values([
      { companyId: ORG, code: "RB-SUP-S1", name: "PT Sentinel Utama", isActive: true },
      { companyId: ORG, code: "RB-SUP-S2", name: "PT Sentinel Duplikat", isActive: true },
    ])
    .returning();
  F.sentinelPair = { primary: pair[0].id, duplicate: pair[1].id };
}

function asRole(role: Role) {
  sessionState.role = role;
}

type Result = { ok: boolean; code?: string };

function expectDenied(result: Result) {
  expect(result.ok).toBe(false);
  expect(result.code).toBe("FORBIDDEN");
}

function expectGatePass(result: Result) {
  if (!result.ok) expect(result.code).not.toBe("FORBIDDEN");
}

async function readProduct(id: string) {
  return withCompanyReadOnly(ORG, async (tx) => {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.companyId, ORG), eq(products.id, id)))
      .limit(1);
    return row ?? null;
  });
}

async function readSupplier(id: string) {
  return withCompanyReadOnly(ORG, async (tx) => {
    const [row] = await tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.companyId, ORG), eq(suppliers.id, id)))
      .limit(1);
    return row ?? null;
  });
}

/** Tabel ekspektasi tangan: izin yang menggerbangi aksi → peran yang memilikinya. */
const CASES: Array<{
  name: string;
  permission: Permission;
  allowed: Role[];
}> = [
  { name: "POS checkout", permission: "pos.sell", allowed: ["owner", "admin", "manager", "cashier"] },
  { name: "POS void penjualan", permission: "pos.void", allowed: ["owner", "admin", "manager"] },
  // A-23 SIS-03: kasir kini berizin retur (pekerjaan harian pemilik
  // nota di minimarket) — tabel diselaraskan dengan template baru.
  { name: "POS retur penjualan", permission: "pos.return", allowed: ["owner", "admin", "manager", "cashier"] },
  { name: "POS sesi kas", permission: "pos.session", allowed: ["owner", "admin", "manager", "cashier"] },
  { name: "ubah/hapus produk", permission: "inventory.manage", allowed: ["owner", "admin", "manager", "warehouse"] },
  // MD-009: bulk edit harga produk wajib memiliki izin inventory.price (owner, admin, manager)
  { name: "bulk edit harga produk", permission: "inventory.price", allowed: ["owner", "admin", "manager"] },
  { name: "merge pihak", permission: "inventory.manage", allowed: ["owner", "admin", "manager", "warehouse"] },
  { name: "jurnal manual", permission: "accounting.post", allowed: ["owner", "admin", "manager", "accountant"] },
  { name: "tutup periode", permission: "accounting.manage", allowed: ["owner", "admin", "accountant"] },
  { name: "run payroll", permission: "payroll.manage", allowed: ["owner", "admin"] },
  { name: "kasbon karyawan", permission: "payroll.manage", allowed: ["owner", "admin"] },
  { name: "kelola pengguna", permission: "users.manage", allowed: ["owner", "admin"] },
  { name: "ubah pengaturan", permission: "settings.manage", allowed: ["owner", "admin"] },
  { name: "impor commit", permission: "import.manage", allowed: ["owner", "admin", "manager"] },
  // A-28 Tahap 5 (H-HR-01): lihat angka gaji izinnya sendiri —
  // owner/admin (semua izin) + manager (kemarin memang melihat angka
  // gaji lewat payroll.view); akuntan/lihat-saja tetap di luar.
  // (Di akhir array: test di bawah merujuk CASES lewat indeks.)
  { name: "lihat angka gaji", permission: "payroll.salary", allowed: ["owner", "admin", "manager"] },
];

beforeAll(bootstrapFixture);
afterAll(wipeFixture);

describe("meta — tabel ekspektasi selaras dengan permissions.ts", () => {
  for (const entry of CASES) {
    it(`${entry.name}: peran berizin menurut permissions.ts = tabel tangan`, () => {
      const derived = ROLES.filter((role) => can(role, entry.permission));
      expect([...derived].sort()).toEqual([...entry.allowed].sort());
    });
  }
});

describe("matriks RBAC — POS", () => {
  it("checkout: hanya pos.sell yang lolos gerbang", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await checkoutAction({
        warehouseId: F.wh,
        lines: [{ productId: FAKE, qty: "1" }],
        payments: [{ methodId: FAKE, amount: "1000" }],
        idempotencyKey: `rbac-checkout-${role}-0001`,
      });
      if (CASES[0].allowed.includes(role)) expectGatePass(result);
      else expectDenied(result);
    }
  });

  it("void penjualan: kasir yang bisa menjual tetap tidak bisa void", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await voidSaleAction({ saleId: FAKE, reason: "uji matriks rbac" });
      if (CASES[1].allowed.includes(role)) expectGatePass(result);
      else expectDenied(result);
    }
  });

  it("retur penjualan: hanya pos.return yang lolos gerbang", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await createReturnAction({ idempotencyKey: crypto.randomUUID(),
        saleId: FAKE,
        reason: "uji matriks rbac",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: FAKE, qty: "1" }],
      });
      if (CASES[2].allowed.includes(role)) expectGatePass(result);
      else expectDenied(result);
    }
  });

  it("sesi kas: kasir bisa buka & tutup sesi sendiri; peran non-POS ditolak", async () => {
    asRole("cashier");
    const opened = await openSessionAction({ openingCash: "100000" });
    expect(opened.ok).toBe(true);
    const sessionId = opened.ok ? (opened.data as { id: string }).id : "";
    const prepared = await prepareSessionCloseAction({ sessionId, countedCash: "100000" });
    const closed = await closeSessionAction({
      sessionId,
      countedCash: "100000",
      countToken: prepared.ok ? prepared.data.token : "",
    });
    expect(closed.ok).toBe(true);

    for (const role of ROLES) {
      asRole(role);
      const result = await openSessionAction({ openingCash: "50000" });
      if (CASES[3].allowed.includes(role)) {
        expectGatePass(result);
        if (result.ok) {
          const id = (result as { data: { id: string } }).data.id;
          const prep = await prepareSessionCloseAction({
            sessionId: id,
            countedCash: "50000",
          });
          await closeSessionAction({
            sessionId: id,
            countedCash: "50000",
            countToken: prep.ok ? prep.data.token : "",
          });
        }
      } else expectDenied(result);
    }
  });
});

describe("matriks RBAC — Gudang & master data", () => {
  it("simpan produk: peran berizin benar-benar membuat produk; yang lain ditolak & tidak ada produk tercipta", async () => {
    for (const role of ROLES) {
      asRole(role);
      const sku = `RBAC-BUAT-${role.toUpperCase()}`;
      const result = await saveProductAction({
        name: `Produk RBAC ${role}`,
        sku,
        categoryId: F.cat,
        unitId: F.unit,
        costPrice: "1000",
        salePrice: "2000",
      });
      const created = await withCompanyReadOnly(ORG, async (tx) => {
        const [row] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.companyId, ORG), eq(products.sku, sku)))
          .limit(1);
        return row ?? null;
      });
      if (CASES[4].allowed.includes(role)) {
        expect(result.ok).toBe(true);
        expect(created).not.toBeNull();
      } else {
        expectDenied(result);
        expect(created).toBeNull();
      }
    }
  });

  it("hapus produk: peran berizin menghapus; yang lain ditolak & produk tetap ada", async () => {
    for (const role of CASES[4].allowed) {
      const [victim] = await adminDb
        .insert(products)
        .values({
          companyId: ORG, sku: `RBAC-HAPUS-${role.toUpperCase()}`, name: `Korban hapus ${role}`,
          categoryId: F.cat, unitId: F.unit, costPrice: "1000", salePrice: "2000", isActive: true,
        })
        .returning();
      asRole(role);
      const result = await deleteProductAction(victim.id);
      expect(result.ok).toBe(true);
      expect(await readProduct(victim.id)).toBeNull();
    }
    for (const role of ROLES.filter((r) => !CASES[4].allowed.includes(r))) {
      asRole(role);
      const result = await deleteProductAction(F.sentinelProduct);
      expectDenied(result);
      expect(await readProduct(F.sentinelProduct)).not.toBeNull();
    }
  });

  it("bulk edit: peran berizin mengubah harga tepat +10%; yang lain ditolak & harga sentinel tidak bergerak", async () => {
    for (const role of CASES[5].allowed) {
      const [target] = await adminDb
        .insert(products)
        .values({
          companyId: ORG, sku: `RBAC-BULK-${role.toUpperCase()}`, name: `Target bulk ${role}`,
          categoryId: F.cat, unitId: F.unit, costPrice: "8000", salePrice: "10000", isActive: true,
        })
        .returning();
      asRole(role);
      const result = await applyBulkEditProductsAction({
        selection: { mode: "ids", ids: [target.id] },
        operation: { kind: "price", target: "salePrice", mode: "percent", value: "10" },
        confirm: true,
      });
      expect(result.ok).toBe(true);
      expect(Number((await readProduct(target.id))?.salePrice)).toBe(11000);
    }
    for (const role of ROLES.filter((r) => !CASES[5].allowed.includes(r))) {
      asRole(role);
      const result = await applyBulkEditProductsAction({
        selection: { mode: "ids", ids: [F.sentinelProduct] },
        operation: { kind: "price", target: "salePrice", mode: "percent", value: "10" },
        confirm: true,
      });
      expectDenied(result);
      expect(Number((await readProduct(F.sentinelProduct))?.salePrice)).toBe(10000);
    }
  });

  it("merge pihak: peran berizin menggabungkan; yang lain ditolak & kedua pihak sentinel tetap aktif", async () => {
    for (const role of CASES[6].allowed) {
      const pair = await adminDb
        .insert(suppliers)
        .values([
          { companyId: ORG, code: `RB-MRG-${role.toUpperCase()}-1`, name: `Utama ${role}`, isActive: true },
          { companyId: ORG, code: `RB-MRG-${role.toUpperCase()}-2`, name: `Duplikat ${role}`, isActive: true },
        ])
        .returning();
      asRole(role);
      const result = await mergePartyAction({
        kind: "supplier", primaryId: pair[0].id, duplicateId: pair[1].id, confirm: true,
      });
      expect(result.ok).toBe(true);
      expect((await readSupplier(pair[1].id))?.isActive).toBe(false);
    }
    for (const role of ROLES.filter((r) => !CASES[6].allowed.includes(r))) {
      asRole(role);
      const result = await mergePartyAction({
        kind: "supplier",
        primaryId: F.sentinelPair.primary,
        duplicateId: F.sentinelPair.duplicate,
        confirm: true,
      });
      expectDenied(result);
    }
    expect((await readSupplier(F.sentinelPair.primary))?.isActive).toBe(true);
    expect((await readSupplier(F.sentinelPair.duplicate))?.isActive).toBe(true);
  });
});

describe("matriks RBAC — Akuntansi, payroll, pengaturan, impor", () => {
  it("jurnal manual: peran berizin memposting jurnal seimbang; yang lain ditolak", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await postManualJournalAction({
        date: TODAY,
        description: `Jurnal uji RBAC ${role}`,
        idempotencyKey: `rbac-journal-${role}-0001`,
        lines: [
          { accountId: F.kas, debit: "1000", credit: "0" },
          { accountId: F.pendapatan, debit: "0", credit: "1000" },
        ],
      });
      if (CASES[7].allowed.includes(role)) expect(result.ok).toBe(true);
      else expectDenied(result);
    }
  });

  it("tutup periode: manager (accounting.post tanpa accounting.manage) ditolak; akuntan lolos", async () => {
    const months: Partial<Record<Role, number>> = { owner: 1, admin: 2, accountant: 3 };
    for (const role of ROLES) {
      asRole(role);
      const result = await setPeriodStatusAction({
        year: 2020,
        month: months[role] ?? 6,
        status: "closed",
        reason: "uji matriks rbac",
      });
      if (CASES[8].allowed.includes(role)) expect(result.ok).toBe(true);
      else expectDenied(result);
    }
  });

  it("run payroll: hanya owner/admin yang lolos gerbang payroll.manage", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await runPayrollAction({ period: "2026-11" });
      if (CASES[9].allowed.includes(role)) expectGatePass(result);
      else expectDenied(result);
    }
  });

  it("kasbon: hanya owner/admin yang lolos gerbang payroll.manage", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await createEmployeeAdvanceAction({
        employeeId: F.employee,
        date: TODAY,
        amount: "100000",
        accountId: FAKE,
        planMode: "full",
      });
      if (CASES[10].allowed.includes(role)) expectGatePass(result);
      else expectDenied(result);
    }
  });

  it("kelola pengguna: hanya owner/admin yang lolos gerbang users.manage", async () => {
    for (const role of ROLES) {
      asRole(role);
      // Sandi sengaja tidak sah: peran berizin berhenti di VALIDATION
      // (gerbang lolos), peran tanpa izin berhenti di FORBIDDEN.
      const result = await createCompanyUserAction({
        name: "Pengguna Uji",
        email: `uji-${role}@rbac.id`,
        password: "x",
        role: "viewer",
      });
      if (CASES[11].allowed.includes(role)) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("VALIDATION");
      } else expectDenied(result);
    }
  });

  it("ubah pengaturan: hanya owner/admin yang lolos gerbang settings.manage", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await saveSettingsAction({} as never);
      if (CASES[12].allowed.includes(role)) expectGatePass(result);
      else expectDenied(result);
    }
  });

  it("impor commit: hanya import.manage yang lolos gerbang", async () => {
    for (const role of ROLES) {
      asRole(role);
      const result = await commitImportBatchAction({ jobId: FAKE, mapping: {} } as never);
      if (CASES[13].allowed.includes(role)) expectGatePass(result);
      else expectDenied(result);
    }
  });
});
