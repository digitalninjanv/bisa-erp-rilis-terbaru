import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  employeeHistory,
  employeeStatutoryEnrollments,
  employees,
  journalEntries,
  journalLines,
  member,
  organization,
  payrollItemLines,
  payrollItems,
  payrollRuns,
  payrollStatutorySettings,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import { createEmployeeAdvanceAction } from "@/server/actions/employee-advances";
import {
  createFinalPayAction,
  terminateEmployeeAction,
} from "@/server/actions/hr/karyawan";
import { getOpenAdvanceTotal } from "@/server/employee-advances";
import { seedPayrollIndonesiaDefaults } from "@/server/payroll-indonesia";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-1 Batch 5 — Terminasi & final pay (§6G).
 *
 * Perusahaan generik (e705): final pay PRORATA hari kerja terpakai
 * (Nov 2026: 10 dari 21 hari kerja × Rp6.000.000), kasbon ditagihkan
 * penuh, karyawan berhenti hilang dari run reguler, histori terbaca,
 * dan sisa kasbon melebihi pembayaran akhir ditolak tanpa penegasan
 * eksplisit. Perusahaan statutory (e706): final pay memakai mode masa
 * terakhir S2 — PPh November = pajak tahunan 11 bulan − TER Jan–Okt.
 */

const state = vi.hoisted(() => ({ org: "", owner: "" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: state.org },
    user: { id: state.owner },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG_A = "01900000-0000-7000-8000-00000000e705";
const OWNER_A = "01900000-0000-7000-8000-00000000e750";
const ORG_B = "01900000-0000-7000-8000-00000000e706";
const OWNER_B = "01900000-0000-7000-8000-00000000e760";


function expectMoney(actual: unknown, expected: number) {
  expect(d(actual as string).toFixed(2)).toBe(d(expected).toFixed(2));
}

async function wipeFixture(org: string, owner: string) {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, org, [owner]);
}

async function bootstrapBase(org: string, owner: string, name: string, email: string) {
  await wipeFixture(org, owner);
  await adminDb.insert(user).values({
    id: owner, name, email, emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: owner, providerId: "credential", userId: owner,
  });
  await adminDb.insert(organization).values({ id: org, name, slug: name.toLowerCase(), createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: org, userId: owner, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: org, legalName: name, roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: org, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
      { companyId: org, code: "1220", name: "Piutang Karyawan", type: "asset", normalBalance: "debit" },
      { companyId: org, code: "2100", name: "Utang Gaji", type: "liability", normalBalance: "credit" },
      { companyId: org, code: "6000", name: "Beban Gaji", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  const byCode = Object.fromEntries(rows.map((row) => [row.code, row.id]));
  await adminDb.insert(accountMappings).values([
    { companyId: org, key: "cash", accountId: byCode["1000"] },
    { companyId: org, key: "employee_receivable", accountId: byCode["1220"] },
    { companyId: org, key: "salary_payable", accountId: byCode["2100"] },
    { companyId: org, key: "salary_expense", accountId: byCode["6000"] },
  ]);
  return byCode;
}

/* ------------------------------------------------------------------ */
/* Perusahaan generik e705                                             */
/* ------------------------------------------------------------------ */

const A = { cash: "", emp1: "", emp2: "", emp3: "", finalRunId: "" };

async function bootstrapA() {
  state.org = ORG_A;
  state.owner = OWNER_A;
  const byCode = await bootstrapBase(ORG_A, OWNER_A, "HrFinal", "owner@hrfinal.id");
  A.cash = byCode["1000"];
  const rows = await adminDb
    .insert(employees)
    .values([
      { companyId: ORG_A, code: "T-1", name: "Tania Resign", baseSalary: "6000000", allowances: "0", deductions: "0", joinedAt: "2026-01-05" },
      { companyId: ORG_A, code: "T-2", name: "Umar Tetap", baseSalary: "5000000", allowances: "0", deductions: "0", joinedAt: "2026-01-05" },
      { companyId: ORG_A, code: "T-3", name: "Vera Kasbon", baseSalary: "1000000", allowances: "0", deductions: "0", joinedAt: "2026-01-05" },
    ])
    .returning({ id: employees.id, code: employees.code });
  A.emp1 = rows.find((row) => row.code === "T-1")!.id;
  A.emp2 = rows.find((row) => row.code === "T-2")!.id;
  A.emp3 = rows.find((row) => row.code === "T-3")!.id;
}

describe("S7B-1 Batch 5 — terminasi & final pay (generik)", () => {
  beforeAll(bootstrapA);
  afterAll(() => wipeFixture(ORG_A, OWNER_A));

  it("final pay prorata 10/21 hari kerja, kasbon Rp900.000 tertagih penuh, jurnal seimbang", async () => {
    const advance = await createEmployeeAdvanceAction({
      employeeId: A.emp1, date: "2026-11-02", amount: 900000, accountId: A.cash, planMode: "full",
    });
    expect(advance.ok).toBe(true);

    const result = await terminateEmployeeAction({
      employeeId: A.emp1, terminationDate: "2026-11-13", terminationReason: "resign",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.message);
    A.finalRunId = result.data.runId;
    expect(result.data.prorataFactor).toBe("0.476190");
    expectMoney(result.data.advanceCharged, 900000);
    expectMoney(result.data.leftoverReceivable, 0);
    expectMoney(result.data.net, 1957142.86);

    const [run] = await adminDb.select().from(payrollRuns).where(eq(payrollRuns.id, A.finalRunId));
    expect(run.kind).toBe("final");
    expect(run.employeeId).toBe(A.emp1);
    const [item] = await adminDb
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, A.finalRunId), eq(payrollItems.employeeId, A.emp1)));
    expectMoney(item.baseSalary, 2857142.86);
    expectMoney(item.advanceDeduction, 900000);
    const lines = await adminDb
      .select()
      .from(payrollItemLines)
      .where(eq(payrollItemLines.runId, A.finalRunId));
    expect(lines.some((line) => line.code === "final_prorata")).toBe(true);

    const [entry] = await adminDb
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, ORG_A), eq(journalEntries.sourceId, A.finalRunId)));
    const entryLines = await adminDb
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry.id));
    const debit = entryLines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
    const credit = entryLines.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
    expect(debit.toFixed(2)).toBe(credit.toFixed(2));

    const [person] = await adminDb.select().from(employees).where(eq(employees.id, A.emp1));
    expect(person.isActive).toBe(false);
    expect(person.employmentStatus).toBe("terminated");
    expect(person.terminationDate).toBe("2026-11-13");
    expect(person.terminationReason).toBe("resign");

    const remaining = await withCompany(ORG_A, (tx) => getOpenAdvanceTotal(tx, ORG_A, A.emp1));
    expect(remaining.toFixed(2)).toBe("0.00");

    const history = await adminDb
      .select()
      .from(employeeHistory)
      .where(and(eq(employeeHistory.companyId, ORG_A), eq(employeeHistory.employeeId, A.emp1)));
    expect(history.some((row) => row.fieldGroup === "status")).toBe(true);
  });

  it("karyawan berhenti hilang dari run reguler berikutnya; histori tetap terbaca", async () => {
    const run = await runPayrollAction({ period: "2026-11" });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);
    const items = await adminDb
      .select()
      .from(payrollItems)
      .where(eq(payrollItems.runId, run.data.id));
    expect(items.map((item) => item.employeeId).sort()).toEqual([A.emp2, A.emp3].sort());
    const [person] = await adminDb.select().from(employees).where(eq(employees.id, A.emp1));
    expect(person.name).toBe("Tania Resign");
  });

  it("terminasi ganda & final pay ganda ditolak; alasan di luar konfigurasi ditolak", async () => {
    const again = await terminateEmployeeAction({
      employeeId: A.emp1, terminationDate: "2026-11-20", terminationReason: "resign",
    });
    expect(again.ok).toBe(false);
    const redo = await createFinalPayAction({ employeeId: A.emp1, period: "2026-11" });
    expect(redo.ok).toBe(false);
    const badReason = await terminateEmployeeAction({
      employeeId: A.emp2, terminationDate: "2026-12-01", terminationReason: "kabur",
    });
    expect(badReason.ok).toBe(false);
  });

  it("sisa kasbon melebihi pembayaran akhir: ditolak tanpa penegasan, diterima dengan penegasan tercatat", async () => {
    const advance = await createEmployeeAdvanceAction({
      employeeId: A.emp3, date: "2026-12-01", amount: 5000000, accountId: A.cash, planMode: "full",
    });
    expect(advance.ok).toBe(true);

    const refused = await terminateEmployeeAction({
      employeeId: A.emp3, terminationDate: "2026-12-31", terminationReason: "kontrak_selesai",
    });
    expect(refused.ok).toBe(false);

    const accepted = await terminateEmployeeAction({
      employeeId: A.emp3, terminationDate: "2026-12-31", terminationReason: "kontrak_selesai",
      acknowledgeShortfall: true,
    });
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    if (!accepted.ok) throw new Error(accepted.message);
    expectMoney(accepted.data.net, 0);
    expectMoney(accepted.data.advanceCharged, 1000000);
    expectMoney(accepted.data.leftoverReceivable, 4000000);
    const remaining = await withCompany(ORG_A, (tx) => getOpenAdvanceTotal(tx, ORG_A, A.emp3));
    expect(remaining.toFixed(2)).toBe("4000000.00");
  });
});

/* ------------------------------------------------------------------ */
/* Perusahaan statutory e706 — PPh masa terakhir                       */
/* ------------------------------------------------------------------ */

const B = { emp: "" };

async function bootstrapB() {
  state.org = ORG_B;
  state.owner = OWNER_B;
  await bootstrapBase(ORG_B, OWNER_B, "HrFinalTax", "owner@hrfinaltax.id");
  await withCompany(ORG_B, async (tx) => {
    await seedPayrollIndonesiaDefaults(tx, ORG_B);
    await tx
      .update(payrollStatutorySettings)
      .set({ isEnabled: true })
      .where(eq(payrollStatutorySettings.companyId, ORG_B));
    const [person] = await tx
      .insert(employees)
      .values({
        companyId: ORG_B, code: "F-1", name: "Fajar Pensiun", baseSalary: "10000000",
        allowances: "0", deductions: "0", ptkpStatus: "TK/0",
        npwp: "09.123.456.7-890.100", joinedAt: "2026-01-01", isActive: true,
      })
      .returning({ id: employees.id });
    B.emp = person.id;
    // Sama seperti fixture TC-05 S2: hanya JHT & JP pekerja.
    await tx.insert(employeeStatutoryEnrollments).values([
      { companyId: ORG_B, employeeId: B.emp, program: "bpjs_kes", isEnrolled: false },
      { companyId: ORG_B, employeeId: B.emp, program: "jkk", isEnrolled: false },
      { companyId: ORG_B, employeeId: B.emp, program: "jkm", isEnrolled: false },
      { companyId: ORG_B, employeeId: B.emp, program: "jkp", isEnrolled: false },
    ]);
  });
}

describe("S7B-1 Batch 5 — final pay mode masa terakhir (statutory)", () => {
  beforeAll(bootstrapB);
  afterAll(() => wipeFixture(ORG_B, OWNER_B));

  it("Jan–Okt TER Rp200.000/bln; final pay November memakai hitung ulang tahunan", async () => {
    for (let month = 1; month <= 10; month += 1) {
      const period = `2026-${String(month).padStart(2, "0")}`;
      const run = await runPayrollAction({ period });
      expect(run.ok, JSON.stringify(run)).toBe(true);
    }
    const result = await terminateEmployeeAction({
      employeeId: B.emp, terminationDate: "2026-11-30", terminationReason: "pensiun",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const [run] = await adminDb.select().from(payrollRuns).where(eq(payrollRuns.id, result.data.runId));
    expect(run.kind).toBe("final");
    const lines = await adminDb
      .select()
      .from(payrollItemLines)
      .where(eq(payrollItemLines.runId, result.data.runId));
    const byCode = new Map(lines.map((line) => [line.code, line]));
    // Pajak tahunan 11 bulan: (110.000.000 − 3.300.000 iuran − 5.500.000
    // biaya jabatan − 54.000.000 PTKP) × 5% = 2.360.000; dikurangi TER
    // Jan–Okt 2.000.000 → PPh November 360.000 (bukan TER 200.000).
    const pph = byCode.get("pph21");
    expect(pph).toBeDefined();
    expectMoney(pph?.amount, 360000);
    expect(pph?.basisSnapshot).toMatchObject({ mode: "final_period" });
    expectMoney(byCode.get("jht_employee")?.amount, 200000);
    expectMoney(byCode.get("jp_employee")?.amount, 100000);
    const [item] = await adminDb
      .select()
      .from(payrollItems)
      .where(eq(payrollItems.runId, result.data.runId));
    expectMoney(item.net, 9340000);
  });

  it("sesudah berhenti, run reguler Desember tidak lagi memuatnya", async () => {
    const run = await runPayrollAction({ period: "2026-12" });
    expect(run.ok).toBe(false); // tidak ada karyawan aktif tersisa
    const finals = await adminDb
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ORG_B), eq(payrollRuns.kind, "final")));
    expect(finals).toHaveLength(1);
  });
});
