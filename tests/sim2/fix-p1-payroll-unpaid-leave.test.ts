import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  employees,
  journalEntries,
  journalLines,
  leaveTypes,
  member,
  organization,
  payrollItems,
  payrollRuns,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import {
  decideLeaveRequestAction,
  submitLeaveRequestAction,
} from "@/server/actions/hr/cuti-lembur";
import { terminateEmployeeAction } from "@/server/actions/hr/karyawan";
import { updateHrParameterAction } from "@/server/actions/hr/organisasi";
import { ensureDefaultLeaveTypes } from "@/server/hr";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * FIX-P1 Tahap 2 (A-15) — AK4-05: cuti tidak berbayar dikreditkan
 * sebagai utang di jurnal payroll & final pay.
 *
 * Cuti tak berbayar adalah upah yang TIDAK PERNAH earned — ia pengurang
 * bruto, bukan kewajiban kepada siapa pun. Sebelum perbaikan, jurnal
 * run membebankan Beban Gaji sebesar bruto PENUH dan mengkredit
 * komponen cuti tak berbayar ke akun utang potongan, sehingga Beban
 * Gaji dan Utang sama-sama overstated permanen sebesar komponen itu
 * setiap periode (residunya menetap di akun utang karena pembayaran
 * hanya melunasi bersih).
 *
 * Sesudah perbaikan: bersih karyawan TIDAK berubah (aritmetika item &
 * slip sudah benar); yang berubah hanya komposisi jurnal — beban
 * dibebankan sebesar bruto efektif dan kredit utang potongan hanya
 * memuat potongan reguler yang sungguh terutang.
 *
 * Perusahaan fixture khusus berkas ini (f202), dibersihkan total
 * sesudah suite — perusahaan demo tidak disentuh.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000f202" },
    user: { id: "01900000-0000-7000-8000-00000000f240" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000f202";
const OWNER = "01900000-0000-7000-8000-00000000f240";


const F = { emp1: "", emp2: "", emp3: "", izin: "" };

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
    id: OWNER, name: "Pemilik Uji AK4-05", email: "owner@ak405.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "Ak405", slug: "ak405", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "Ak405", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const accRows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "2100", name: "Utang Gaji", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "2110", name: "Utang Potongan Gaji", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "6000", name: "Beban Gaji", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  const byCode = Object.fromEntries(accRows.map((row) => [row.code, row.id]));
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: byCode["1000"] },
    { companyId: ORG, key: "salary_payable", accountId: byCode["2100"] },
    // Akun potongan TERPISAH dari utang gaji agar kredit jurnal untuk
    // potongan reguler vs utang bersih dapat dibedakan persis.
    { companyId: ORG, key: "salary_deductions_payable", accountId: byCode["2110"] },
    { companyId: ORG, key: "salary_expense", accountId: byCode["6000"] },
  ]);
  const rows = await adminDb
    .insert(employees)
    .values([
      { companyId: ORG, code: "AK5-1", name: "Sari Cuti", baseSalary: "4400000", allowances: "0", deductions: "100000", joinedAt: "2026-01-01" },
      { companyId: ORG, code: "AK5-2", name: "Rudi Rajin", baseSalary: "3000000", allowances: "0", deductions: "0", joinedAt: "2026-01-01" },
    ])
    .returning({ id: employees.id, code: employees.code });
  F.emp1 = rows.find((row) => row.code === "AK5-1")!.id;
  F.emp2 = rows.find((row) => row.code === "AK5-2")!.id;
  await withCompany(ORG, (tx) => ensureDefaultLeaveTypes(tx, ORG));
  const types = await adminDb.select().from(leaveTypes).where(eq(leaveTypes.companyId, ORG));
  F.izin = types.find((row) => row.code === "izin")!.id;
}

/** Total debit/kredit per kode akun pada jurnal milik satu run payroll. */
async function journalByAccount(runId: string) {
  const [entry] = await adminDb
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.sourceType, "payroll"),
        eq(journalEntries.sourceId, runId),
      ),
    );
  expect(entry).toBeDefined();
  const lines = await adminDb
    .select({
      code: accounts.code,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entry.id));
  const totals = new Map<string, { debit: ReturnType<typeof d>; credit: ReturnType<typeof d> }>();
  let totalDebit = d(0);
  let totalCredit = d(0);
  for (const line of lines) {
    const bucket = totals.get(line.code) ?? { debit: d(0), credit: d(0) };
    bucket.debit = bucket.debit.plus(d(line.debit));
    bucket.credit = bucket.credit.plus(d(line.credit));
    totals.set(line.code, bucket);
    totalDebit = totalDebit.plus(d(line.debit));
    totalCredit = totalCredit.plus(d(line.credit));
  }
  return { totals, totalDebit, totalCredit };
}

async function approveUnpaidLeave(employeeId: string) {
  // Senin–Selasa 9–10 Nov 2026 = 2 hari kerja tak berbayar.
  const submitted = await submitLeaveRequestAction({
    employeeId, leaveTypeId: F.izin,
    startDate: "2026-11-09", endDate: "2026-11-10", reason: "Urusan pribadi",
  });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) throw new Error(submitted.message);
  const decided = await decideLeaveRequestAction({ id: submitted.data.id, approve: true });
  expect(decided.ok).toBe(true);
}

describe("AK4-05 — cuti tidak berbayar bukan utang (jurnal payroll)", () => {
  beforeAll(bootstrapFixture);
  afterAll(wipeFixture);

  it("run reguler: beban = bruto efektif, kredit utang potongan hanya potongan reguler, bersih karyawan tidak berubah", async () => {
    const on = await updateHrParameterAction({ key: "unpaid_leave_payroll_enabled", value: "true" });
    expect(on.ok).toBe(true);
    await approveUnpaidLeave(F.emp1);

    const run = await runPayrollAction({ period: "2026-11" });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);

    // Aritmetika karyawan TIDAK berubah dari perilaku sebelum perbaikan:
    // potongan item emp1 = reguler 100.000 + cuti tak berbayar
    // 2 hari × (4.400.000 ÷ 22) = 500.000; bersih 3.900.000.
    const [item1] = await adminDb
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, run.data.id), eq(payrollItems.employeeId, F.emp1)));
    expectMoney(item1.deductions, 500000);
    expectMoney(item1.net, 3900000);
    const [item2] = await adminDb
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, run.data.id), eq(payrollItems.employeeId, F.emp2)));
    expectMoney(item2.net, 3000000);

    const { totals, totalDebit, totalCredit } = await journalByAccount(run.data.id);
    // Bruto total 7.400.000; komponen cuti tak berbayar 400.000 adalah
    // PENGURANG bruto → Beban Gaji terdebit 7.000.000, BUKAN 7.400.000.
    expectMoney(totals.get("6000")?.debit, 7000000);
    // Utang potongan (2110) hanya memuat potongan reguler 100.000 yang
    // sungguh terutang — komponen cuti tak berbayar TIDAK dikreditkan
    // sebagai utang (sebelum perbaikan: 500.000).
    expectMoney(totals.get("2110")?.credit, 100000);
    // Utang gaji bersih = total bersih run.
    expectMoney(totals.get("2100")?.credit, 6900000);
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });

  it("final pay: perlakuan sama — beban efektif & utang potongan tanpa komponen cuti tak berbayar", async () => {
    // Karyawan ketiga dibuat SESUDAH run reguler agar penjaga final pay
    // (tidak boleh tercakup run reguler periode yang sama) tidak memicu.
    const [emp3] = await adminDb
      .insert(employees)
      .values({
        companyId: ORG, code: "AK5-3", name: "Tania Akhir", baseSalary: "4400000",
        allowances: "0", deductions: "100000", joinedAt: "2026-01-01",
      })
      .returning({ id: employees.id });
    F.emp3 = emp3.id;
    await approveUnpaidLeave(F.emp3);

    // Berhenti di hari terakhir periode → faktor prorata tepat 1,
    // bruto penuh 4.400.000 menjadi dasar angka uji.
    const terminated = await terminateEmployeeAction({
      employeeId: F.emp3, terminationDate: "2026-11-30", terminationReason: "resign",
    });
    expect(terminated.ok).toBe(true);
    if (!terminated.ok) throw new Error(terminated.message);

    const [run] = await adminDb
      .select()
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.companyId, ORG),
          eq(payrollRuns.kind, "final"),
          eq(payrollRuns.employeeId, F.emp3),
        ),
      );
    expect(run).toBeDefined();
    const [item] = await adminDb
      .select()
      .from(payrollItems)
      .where(eq(payrollItems.runId, run.id));
    // Bersih karyawan tidak berubah: 4.400.000 − 100.000 − 400.000.
    expectMoney(item.net, 3900000);

    const { totals, totalDebit, totalCredit } = await journalByAccount(run.id);
    expectMoney(totals.get("6000")?.debit, 4000000);
    expectMoney(totals.get("2110")?.credit, 100000);
    expectMoney(totals.get("2100")?.credit, 3900000);
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });
});
