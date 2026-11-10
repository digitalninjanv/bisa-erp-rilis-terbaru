import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  employees,
  member,
  organization,
  overtimeRequests,
  payrollComponentDrafts,
  payrollItemLines,
  payrollItems,
  payrollRuns,
  user,
} from "@/db/schema";
import {
  runPayrollAction,
  voidPayrollRunAction,
} from "@/server/actions/hr/payroll";
import {
  computeThrAction,
  decideOvertimeRequestAction,
  submitOvertimeRequestAction,
} from "@/server/actions/hr/cuti-lembur";
import { updateHrParameterAction } from "@/server/actions/hr/organisasi";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-1 Batch 3 — Lembur terhubung payroll & THR (menutup R-6 S2).
 *
 * Angka acuan TC-10 S0-C: upah 5.190.000 → sejam 30.000; lembur hari
 * kerja 3 jam = (1,5+2+2) × 30.000 = 165.000. THR: masa kerja 6 bulan
 * → 50% × upah sebulan. Saklar perusahaan mati = perilaku lama persis.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000e703" },
    user: { id: "01900000-0000-7000-8000-00000000e730" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e703";
const OWNER = "01900000-0000-7000-8000-00000000e730";


const F = { empWage: "", empThr: "", runNov: "" };

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
    id: OWNER, name: "Tito Lembur", email: "owner@hrot.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "HrOt", slug: "hrot", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "HrOt", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
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
      { companyId: ORG, code: "OT-1", name: "Omar Lembur", baseSalary: "5190000", allowances: "0", deductions: "0", joinedAt: "2026-01-01" },
      { companyId: ORG, code: "OT-2", name: "Tania Thr", baseSalary: "6000000", allowances: "0", deductions: "0", joinedAt: "2026-07-01" },
    ])
    .returning({ id: employees.id, code: employees.code });
  F.empWage = rows.find((row) => row.code === "OT-1")!.id;
  F.empThr = rows.find((row) => row.code === "OT-2")!.id;
}

async function itemOf(runId: string, employeeId: string) {
  const [item] = await adminDb
    .select()
    .from(payrollItems)
    .where(and(eq(payrollItems.runId, runId), eq(payrollItems.employeeId, employeeId)));
  const lines = await adminDb
    .select()
    .from(payrollItemLines)
    .where(and(eq(payrollItemLines.runId, runId), eq(payrollItemLines.employeeId, employeeId)));
  return { item, lines };
}

describe("S7B-1 Batch 3 — lembur & THR ke payroll", () => {
  beforeAll(bootstrapFixture);
  afterAll(wipeFixture);

  it("pengajuan lembur: disahkan tercatat penyetuju, ditolak tidak masuk hitungan", async () => {
    const on = await updateHrParameterAction({ key: "overtime_payroll_enabled", value: "true" });
    expect(on.ok).toBe(true);

    const req = await submitOvertimeRequestAction({
      employeeId: F.empWage, date: "2026-11-10", dayType: "workday", hours: "3",
      reason: "Inventaris akhir bulan",
    });
    expect(req.ok).toBe(true);
    if (!req.ok) throw new Error(req.message);
    const decided = await decideOvertimeRequestAction({ id: req.data.id, approve: true, note: "OK" });
    expect(decided.ok).toBe(true);
    const [row] = await adminDb.select().from(overtimeRequests).where(eq(overtimeRequests.id, req.data.id));
    expect(row.status).toBe("approved");
    expect(row.decidedBy).toBe(OWNER);

    const rejected = await submitOvertimeRequestAction({
      employeeId: F.empWage, date: "2026-11-12", dayType: "workday", hours: "2", reason: "Lainnya",
    });
    if (!rejected.ok) throw new Error(rejected.message);
    await decideOvertimeRequestAction({ id: rejected.data.id, approve: false, note: "Tidak mendesak" });
    const pending = await submitOvertimeRequestAction({
      employeeId: F.empWage, date: "2026-11-13", dayType: "workday", hours: "5", reason: "Belum diputuskan",
    });
    expect(pending.ok).toBe(true);

    // Keputusan ganda atas pengajuan yang sama ditolak.
    const twice = await decideOvertimeRequestAction({ id: req.data.id, approve: true });
    expect(twice.ok).toBe(false);
  });

  it("run November: lembur disahkan 3 jam hari kerja = Rp165.000 sebagai baris bernama", async () => {
    const run = await runPayrollAction({ period: "2026-11" });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);
    F.runNov = run.data.id;

    const { item, lines } = await itemOf(F.runNov, F.empWage);
    expectMoney(item.allowances, 165000);
    expectMoney(item.net, 5190000 + 165000);
    const overtimeLine = lines.find((line) => line.code === "overtime");
    expect(overtimeLine).toBeDefined();
    expectMoney(overtimeLine?.amount, 165000);
    expect(overtimeLine?.label).toBe("Upah lembur");

    const [runRow] = await adminDb.select().from(payrollRuns).where(eq(payrollRuns.id, F.runNov));
    // Bruto run mencakup lembur: (5.190.000+165.000) + 6.000.000.
    expectMoney(runRow.totalGross, 11355000);
  });

  it("saklar mati: lembur yang disahkan TIDAK masuk run (perilaku lama persis)", async () => {
    const req = await submitOvertimeRequestAction({
      employeeId: F.empWage, date: "2026-12-08", dayType: "workday", hours: "3", reason: "Desember",
    });
    if (!req.ok) throw new Error(req.message);
    await decideOvertimeRequestAction({ id: req.data.id, approve: true });
    const off = await updateHrParameterAction({ key: "overtime_payroll_enabled", value: "false" });
    expect(off.ok).toBe(true);

    const run = await runPayrollAction({ period: "2026-12" });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);
    const { item, lines } = await itemOf(run.data.id, F.empWage);
    expectMoney(item.allowances, 0);
    expect(lines.find((line) => line.code === "overtime")).toBeUndefined();
  });

  it("THR: hitung draf prorata 6 bulan = 50% upah; run memuatnya; void mengembalikan draf", async () => {
    const computed = await computeThrAction({ period: "2027-01" });
    expect(computed.ok).toBe(true);
    if (!computed.ok) throw new Error(computed.message);
    expect(computed.data.created).toBe(2);

    const drafts = await adminDb
      .select()
      .from(payrollComponentDrafts)
      .where(and(eq(payrollComponentDrafts.companyId, ORG), eq(payrollComponentDrafts.period, "2027-01")));
    const thrDraft = drafts.find((row) => row.employeeId === F.empThr);
    expectMoney(thrDraft?.amount, 3000000); // 6/12 × 6.000.000
    const fullDraft = drafts.find((row) => row.employeeId === F.empWage);
    expectMoney(fullDraft?.amount, 5190000); // ≥12 bulan → penuh

    const run = await runPayrollAction({ period: "2027-01" });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);
    const { item, lines } = await itemOf(run.data.id, F.empThr);
    expectMoney(item.allowances, 3000000);
    expect(lines.find((line) => line.code === "thr")).toBeDefined();
    const [consumed] = await adminDb
      .select()
      .from(payrollComponentDrafts)
      .where(eq(payrollComponentDrafts.id, thrDraft!.id));
    expect(consumed.status).toBe("consumed");
    expect(consumed.consumedRunId).toBe(run.data.id);

    const voided = await voidPayrollRunAction({ id: run.data.id, reason: "Uji pemulihan draf" });
    expect(voided.ok).toBe(true);
    const [restored] = await adminDb
      .select()
      .from(payrollComponentDrafts)
      .where(eq(payrollComponentDrafts.id, thrDraft!.id));
    expect(restored.status).toBe("draft");
    expect(restored.consumedRunId).toBeNull();
  });
});
