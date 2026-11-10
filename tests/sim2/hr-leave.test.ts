import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  attendanceRecords,
  companySettings,
  employees,
  leaveRequests,
  leaveTypes,
  member,
  organization,
  payrollItemLines,
  payrollItems,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import {
  decideLeaveRequestAction,
  submitLeaveRequestAction,
} from "@/server/actions/hr/cuti-lembur";
import { updateHrParameterAction } from "@/server/actions/hr/organisasi";
import { ensureDefaultLeaveTypes, getLeaveBalance } from "@/server/hr";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-1 Batch 4 — Cuti (§6C).
 *
 * Jenis cuti terkonfigurasi tersemai; saldo = jatah − terpakai (+ sisa
 * tahun lalu bila carry-over aktif); pengajuan melebihi saldo dan yang
 * tumpang tindih ditolak; pengesahan menulis absensi berstatus leave;
 * cuti tidak berbayar 2 hari pada upah 4.400.000 dengan 22 hari kerja
 * konfigurasi = potongan payroll tepat Rp400.000.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000e704" },
    user: { id: "01900000-0000-7000-8000-00000000e740" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e704";
const OWNER = "01900000-0000-7000-8000-00000000e740";


const F = { emp: "", emp2: "", tahunan: "", izin: "" };

function expectMoney(actual: unknown, expected: number) {
  expect(d(actual as string).toFixed(2)).toBe(d(expected).toFixed(2));
}

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

async function bootstrapFixture() {
  await wipeFixture();
  await adminDb.insert(user).values({
    id: OWNER, name: "Lala Cuti", email: "owner@hrleave.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "HrLeave", slug: "hrleave", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "HrLeave", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const accRows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "2100", name: "Utang Gaji", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "6000", name: "Beban Gaji", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  const byCode = Object.fromEntries(accRows.map((row) => [row.code, row.id]));
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: byCode["1000"] },
    { companyId: ORG, key: "salary_payable", accountId: byCode["2100"] },
    { companyId: ORG, key: "salary_expense", accountId: byCode["6000"] },
  ]);
  const rows = await adminDb
    .insert(employees)
    .values([
      { companyId: ORG, code: "LV-1", name: "Laras Cuti", baseSalary: "4400000", allowances: "0", deductions: "0", joinedAt: "2026-01-01" },
      { companyId: ORG, code: "LV-2", name: "Bimo Biasa", baseSalary: "3000000", allowances: "0", deductions: "0", joinedAt: "2026-01-01" },
    ])
    .returning({ id: employees.id, code: employees.code });
  F.emp = rows.find((row) => row.code === "LV-1")!.id;
  F.emp2 = rows.find((row) => row.code === "LV-2")!.id;
  await withCompany(ORG, (tx) => ensureDefaultLeaveTypes(tx, ORG));
  const types = await adminDb.select().from(leaveTypes).where(eq(leaveTypes.companyId, ORG));
  F.tahunan = types.find((row) => row.code === "tahunan")!.id;
  F.izin = types.find((row) => row.code === "izin")!.id;
}

async function balance(employeeId: string, typeId: string, year: number) {
  return withCompany(ORG, (tx) => getLeaveBalance(tx, ORG, employeeId, typeId, year));
}

describe("S7B-1 Batch 4 — cuti", () => {
  beforeAll(bootstrapFixture);
  afterAll(wipeFixture);

  it("jenis cuti tersemai sebagai konfigurasi; saldo awal = jatah penuh", async () => {
    const types = await adminDb.select().from(leaveTypes).where(eq(leaveTypes.companyId, ORG));
    expect(types.map((row) => row.code).sort()).toEqual(
      ["izin", "khusus", "melahirkan", "sakit", "tahunan"].sort(),
    );
    const tahunan = types.find((row) => row.code === "tahunan");
    expect(tahunan?.daysPerYear).toBe("12.00");
    expect(tahunan?.isPaid).toBe(true);
    const izin = types.find((row) => row.code === "izin");
    expect(izin?.isPaid).toBe(false);
    const saldo = await balance(F.emp, F.tahunan, 2026);
    expect(saldo.available?.toFixed(2)).toBe("12.00");
  });

  it("pengajuan 3 hari kerja disahkan: saldo berkurang tepat & absensi leave tertulis", async () => {
    // Senin 2026-11-02 s.d. Rabu 2026-11-04 = 3 hari kerja (pola bawaan Sen–Jum).
    const submitted = await submitLeaveRequestAction({
      employeeId: F.emp, leaveTypeId: F.tahunan,
      startDate: "2026-11-02", endDate: "2026-11-04", reason: "Liburan keluarga",
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error(submitted.message);
    expect(submitted.data.days).toBe("3.0000");
    const decided = await decideLeaveRequestAction({ id: submitted.data.id, approve: true });
    expect(decided.ok).toBe(true);

    const saldo = await balance(F.emp, F.tahunan, 2026);
    expect(saldo.used.toFixed(2)).toBe("3.00");
    expect(saldo.available?.toFixed(2)).toBe("9.00");

    const records = await adminDb
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, ORG),
          eq(attendanceRecords.employeeId, F.emp),
          eq(attendanceRecords.source, "leave"),
        ),
      );
    expect(records).toHaveLength(3);
    expect(records.every((row) => row.status === "leave")).toBe(true);
    expect(records.every((row) => row.leaveRequestId === submitted.data.id)).toBe(true);
  });

  it("hari di luar pola kerja tidak dihitung (Jumat–Senin = 2 hari)", async () => {
    const submitted = await submitLeaveRequestAction({
      employeeId: F.emp2, leaveTypeId: F.tahunan,
      startDate: "2026-11-06", endDate: "2026-11-09",
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error(submitted.message);
    expect(submitted.data.days).toBe("2.0000");
  });

  it("pengajuan melebihi saldo ditolak; pengajuan tumpang tindih ditolak", async () => {
    // Sisa 9 hari; rentang 7–18 Des 2026 = 10 hari kerja.
    const tooMany = await submitLeaveRequestAction({
      employeeId: F.emp, leaveTypeId: F.tahunan,
      startDate: "2026-12-07", endDate: "2026-12-18",
    });
    expect(tooMany.ok).toBe(false);
    const overlap = await submitLeaveRequestAction({
      employeeId: F.emp, leaveTypeId: F.tahunan,
      startDate: "2026-11-03", endDate: "2026-11-05",
    });
    expect(overlap.ok).toBe(false);
  });

  it("carry-over aktif: sisa 2026 terbawa menjadi saldo 2027", async () => {
    const off = await balance(F.emp, F.tahunan, 2027);
    expect(off.available?.toFixed(2)).toBe("12.00"); // tanpa carry-over
    const on = await updateHrParameterAction({ key: "leave_carry_over_enabled", value: "true" });
    expect(on.ok).toBe(true);
    const carried = await balance(F.emp, F.tahunan, 2027);
    expect(carried.carryOver.toFixed(2)).toBe("9.00");
    expect(carried.available?.toFixed(2)).toBe("21.00");
  });

  it("cuti tidak berbayar yang disahkan memotong payroll tepat Rp200.000/hari", async () => {
    const on = await updateHrParameterAction({ key: "unpaid_leave_payroll_enabled", value: "true" });
    expect(on.ok).toBe(true);
    // Senin–Selasa 9–10 Nov 2026 = 2 hari tak berbayar.
    const submitted = await submitLeaveRequestAction({
      employeeId: F.emp, leaveTypeId: F.izin,
      startDate: "2026-11-09", endDate: "2026-11-10", reason: "Urusan pribadi",
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error(submitted.message);
    await decideLeaveRequestAction({ id: submitted.data.id, approve: true });

    const run = await runPayrollAction({ period: "2026-11" });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);
    const [item] = await adminDb
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, run.data.id), eq(payrollItems.employeeId, F.emp)));
    // 4.400.000 ÷ 22 hari konfigurasi = 200.000/hari × 2 hari.
    expectMoney(item.deductions, 400000);
    expectMoney(item.net, 4000000);
    const lines = await adminDb
      .select()
      .from(payrollItemLines)
      .where(and(eq(payrollItemLines.runId, run.data.id), eq(payrollItemLines.employeeId, F.emp)));
    const leaveLine = lines.find((line) => line.code === "unpaid_leave");
    expect(leaveLine).toBeDefined();
    expectMoney(leaveLine?.amount, 400000);

    // Karyawan tanpa cuti tak berbayar tidak terpotong.
    const [other] = await adminDb
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, run.data.id), eq(payrollItems.employeeId, F.emp2)));
    expectMoney(other.deductions, 0);
    expectMoney(other.net, 3000000);

    const requests = await adminDb
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.id, submitted.data.id));
    expect(requests[0].status).toBe("approved");
  });
});
