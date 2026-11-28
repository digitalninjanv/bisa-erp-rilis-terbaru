import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  branches,
  companySettings,
  departments,
  employeeHistory,
  employees,
  hrParameters,
  member,
  organization,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { saveEmployeeAction } from "@/server/actions/hr/karyawan";
import {
  saveDepartmentAction,
  saveJobPositionAction,
  setDepartmentActiveAction,
} from "@/server/actions/hr/organisasi";
import { listExpiringContracts } from "@/server/hr";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-1 Batch 1 — Struktur organisasi & riwayat karyawan (§6A).
 *
 * Membuktikan lewat aksi nyata: master departemen & jabatan (CRUD +
 * nonaktif), karyawan menunjuk departemen/jabatan/atasan/cabang +
 * tanggal kontrak PKWT, dan SETIAP perubahan jabatan/departemen/gaji
 * pokok/kontrak tercatat di employee_history dengan snapshot
 * before/after — tanpa mengubah data master lama yang belum memakai
 * struktur baru.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000e701" },
    user: { id: "01900000-0000-7000-8000-00000000e710" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e701";
const OWNER = "01900000-0000-7000-8000-00000000e710";


const F = {
  deptOps: "",
  deptSales: "",
  posStaff: "",
  posLead: "",
  branch: "",
  manager: "",
  staff: "",
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
    id: OWNER, name: "Hana HR", email: "owner@hrorg.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "HrOrg", slug: "hrorg", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "HrOrg", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const [branch] = await adminDb
    .insert(branches)
    .values({ companyId: ORG, code: "PST", name: "Kantor Pusat" })
    .returning({ id: branches.id });
  F.branch = branch.id;
}

async function historyOf(employeeId: string) {
  return withCompany(ORG, (tx) =>
    tx
      .select()
      .from(employeeHistory)
      .where(and(eq(employeeHistory.companyId, ORG), eq(employeeHistory.employeeId, employeeId)))
      .orderBy(asc(employeeHistory.createdAt)),
  );
}

describe("S7B-1 Batch 1 — organisasi & riwayat karyawan", () => {
  beforeAll(bootstrapFixture);
  afterAll(wipeFixture);

  it("master departemen & jabatan: buat, ubah, nonaktifkan", async () => {
    const ops = await saveDepartmentAction({ code: "OPS", name: "Operasional" });
    expect(ops.ok).toBe(true);
    if (!ops.ok) throw new Error(ops.message);
    F.deptOps = ops.data.id;
    const sales = await saveDepartmentAction({ code: "SLS", name: "Penjualan" });
    if (!sales.ok) throw new Error(sales.message);
    F.deptSales = sales.data.id;

    const staff = await saveJobPositionAction({ code: "STF", name: "Staf" });
    if (!staff.ok) throw new Error(staff.message);
    F.posStaff = staff.data.id;
    const lead = await saveJobPositionAction({ code: "LEAD", name: "Kepala Tim" });
    if (!lead.ok) throw new Error(lead.message);
    F.posLead = lead.data.id;

    const off = await setDepartmentActiveAction({ id: F.deptSales, isActive: false });
    expect(off.ok).toBe(true);
    const [row] = await adminDb
      .select()
      .from(departments)
      .where(eq(departments.id, F.deptSales));
    expect(row.isActive).toBe(false);
  });

  it("karyawan lama tanpa struktur organisasi tetap dapat dibuat & diubah", async () => {
    const created = await saveEmployeeAction({
      code: "LEG-1", name: "Karyawan Lama", position: "Serabutan",
      baseSalary: "3000000", allowances: "0", deductions: "0",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);
    const [row] = await adminDb.select().from(employees).where(eq(employees.id, created.data.id));
    expect(row.departmentId).toBeNull();
    expect(row.employmentStatus).toBe("active");
    expect(await historyOf(created.data.id)).toHaveLength(0);
  });

  it("karyawan baru menunjuk departemen/jabatan/atasan/cabang & kontrak PKWT", async () => {
    const mgr = await saveEmployeeAction({
      code: "MGR-1", name: "Maya Manajer", position: "Manajer Operasional",
      baseSalary: "9000000", allowances: "1000000", deductions: "0",
      departmentId: F.deptOps, positionId: F.posLead, branchId: F.branch,
    });
    if (!mgr.ok) throw new Error(mgr.message);
    F.manager = mgr.data.id;

    const staff = await saveEmployeeAction({
      code: "STF-1", name: "Bima Staf", position: "Staf",
      baseSalary: "5000000", allowances: "500000", deductions: "0",
      departmentId: F.deptOps, positionId: F.posStaff, managerEmployeeId: F.manager,
      branchId: F.branch, contractType: "pkwt",
      contractStart: "2026-11-01", contractEnd: "2027-01-20",
    });
    expect(staff.ok).toBe(true);
    if (!staff.ok) throw new Error(staff.message);
    F.staff = staff.data.id;
    const [row] = await adminDb.select().from(employees).where(eq(employees.id, F.staff));
    expect(row.departmentId).toBe(F.deptOps);
    expect(row.positionId).toBe(F.posStaff);
    expect(row.managerEmployeeId).toBe(F.manager);
    expect(row.branchId).toBe(F.branch);
    expect(row.contractEnd).toBe("2027-01-20");
    // Teks jabatan bebas disinkronkan dari master agar tampilan lama utuh.
    expect(row.position).toBe("Staf");
    // Pembuatan awal bukan "perubahan" — belum ada baris riwayat.
    expect(await historyOf(F.staff)).toHaveLength(0);
  });

  it("atasan tidak boleh diri sendiri / lintas perusahaan ditolak", async () => {
    const self = await saveEmployeeAction({
      id: F.staff, code: "STF-1", name: "Bima Staf", baseSalary: "5000000",
      managerEmployeeId: F.staff,
    });
    expect(self.ok).toBe(false);
    const ghost = await saveEmployeeAction({
      id: F.staff, code: "STF-1", name: "Bima Staf", baseSalary: "5000000",
      departmentId: "01900000-0000-7000-8000-00000000ffff",
    });
    expect(ghost.ok).toBe(false);
  });

  it("perubahan jabatan, departemen & gaji tercatat sebagai riwayat before/after", async () => {
    const updated = await saveEmployeeAction({
      id: F.staff, code: "STF-1", name: "Bima Staf",
      baseSalary: "6000000", allowances: "500000", deductions: "0",
      departmentId: F.deptSales, positionId: F.posLead, managerEmployeeId: F.manager,
      branchId: F.branch, contractType: "pkwt",
      contractStart: "2026-11-01", contractEnd: "2027-01-20",
    });
    expect(updated.ok).toBe(true);
    const rows = await historyOf(F.staff);
    const groups = rows.map((row) => row.fieldGroup).sort();
    expect(groups).toEqual(["base_salary", "department", "position"]);
    const salary = rows.find((row) => row.fieldGroup === "base_salary");
    expect((salary?.before as { baseSalary: string }).baseSalary).toBe("5000000.0000");
    expect((salary?.after as { baseSalary: string }).baseSalary).toBe("6000000.0000");
    const position = rows.find((row) => row.fieldGroup === "position");
    expect((position?.before as { position: string }).position).toBe("Staf");
    expect((position?.after as { position: string }).position).toBe("Kepala Tim");
    const dept = rows.find((row) => row.fieldGroup === "department");
    expect((dept?.after as { department: string }).department).toBe("Penjualan");
  });

  it("edit tanpa field joinedAt tidak menghapus tanggal masuk karyawan", async () => {
    const created = await saveEmployeeAction({
      code: "JOIN-1", name: "Karyawan Bergabung", position: "Kasir",
      baseSalary: "4000000", allowances: "0", deductions: "0",
      joinedAt: "2024-03-01",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);

    const updated = await saveEmployeeAction({
      id: created.data.id, code: "JOIN-1", name: "Karyawan Bergabung",
      position: "Kasir Senior", baseSalary: "4500000", allowances: "0", deductions: "0",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.message);

    const [row] = await adminDb
      .select({ joinedAt: employees.joinedAt })
      .from(employees)
      .where(eq(employees.id, created.data.id));
    expect(row.joinedAt).toBe("2024-03-01");
  });

  it("simpan ulang tanpa perubahan tidak menambah riwayat", async () => {
    const before = await historyOf(F.staff);
    const again = await saveEmployeeAction({
      id: F.staff, code: "STF-1", name: "Bima Staf",
      baseSalary: "6000000", allowances: "500000", deductions: "0",
      departmentId: F.deptSales, positionId: F.posLead, managerEmployeeId: F.manager,
      branchId: F.branch, contractType: "pkwt",
      contractStart: "2026-11-01", contractEnd: "2027-01-20",
    });
    expect(again.ok).toBe(true);
    expect(await historyOf(F.staff)).toHaveLength(before.length);
  });

  it("kontrak PKWT yang berakhir ≤ ambang konfigurasi muncul di daftar peringatan", async () => {
    const expiring = await withCompany(ORG, (tx) =>
      listExpiringContracts(tx, ORG, "2027-01-05"),
    );
    expect(expiring.map((row) => row.employeeId)).toContain(F.staff);
    const far = await withCompany(ORG, (tx) =>
      listExpiringContracts(tx, ORG, "2026-11-05"),
    );
    expect(far.map((row) => row.employeeId)).not.toContain(F.staff);
  });

  it("parameter HR tersemai sebagai konfigurasi (bukan konstanta kode)", async () => {
    const rows = await adminDb
      .select()
      .from(hrParameters)
      .where(eq(hrParameters.companyId, ORG));
    const keys = rows.map((row) => row.key);
    expect(keys).toContain("working_days_per_month");
    expect(keys).toContain("overtime_payroll_enabled");
    expect(keys).toContain("termination_reasons");
  });
});
