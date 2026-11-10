import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  employeeAdvances,
  employeeStatutoryEnrollments,
  employees,
  journalEntries,
  journalLines,
  member,
  organization,
  payrollItemLines,
  payrollItems,
  payrollRuns,
  payrollStatutoryPrograms,
  payrollStatutorySettings,
  payrollTerBrackets,
  user,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { createEmployeeAdvance } from "@/server/employee-advances";
import {
  getPayrollRecap,
  getYearToDateFigures,
  loadStatutoryConfig,
  seedPayrollIndonesiaDefaults,
} from "@/server/payroll-indonesia";
import {
  runPayrollAction,
  voidPayrollRunAction,
} from "@/server/actions/hr/payroll";
import { ensureFiscalPeriods } from "@/server/accounting";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S2 — Payroll Indonesia (integrasi, perusahaan fixture dd01).
 *
 * Membuktikan di jalur aksi yang sesungguhnya: payroll generik tidak
 * berubah saat engine nonaktif; TER bulanan & iuran BPJS per program
 * dari konfigurasi DATABASE; saklar per program; perubahan tarif
 * bertanggal efektif; kasbon tidak mengurangi bruto pajak (TC-11);
 * upah minimum menghalangi posting (TC-12); void memulihkan keadaan.
 * Skenario masa pajak terakhir (TC-05) ada di berkas desember terpisah
 * agar tahun kalender karyawan ujinya bersih.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000dd01" },
    user: { id: "01900000-0000-7000-8000-00000000dd10" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000dd01";
const OWNER = "01900000-0000-7000-8000-00000000dd10";


const F = {
  acc: {} as Record<string, string>,
  emp: {} as Record<string, string>,
};

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
    id: OWNER, name: "Dina Payroll", email: "owner@payrollid.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PayrollID", slug: "payrollid", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PayrollID", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const accountSeeds: Array<[string, string, string, "debit" | "credit"]> = [
    ["1000", "Kas", "asset", "debit"],
    ["1100", "Bank BCA", "asset", "debit"],
    ["1220", "Piutang Karyawan", "asset", "debit"],
    ["2100", "Utang Gaji", "liability", "credit"],
    ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ];
  const rows = await adminDb
    .insert(accounts)
    .values(
      accountSeeds.map(([code, name, type, normalBalance]) => ({
        companyId: ORG, code, name, type, normalBalance,
        // A-27 B2: akun terpetakan cash/bank berkelas (invariant B1).
        cashBankKind: code === "1000" ? "cash" : code === "1100" ? "bank" : null,
      })),
    )
    .returning();
  for (const row of rows) F.acc[row.code] = row.id;
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: F.acc["1000"] },
    { companyId: ORG, key: "bank", accountId: F.acc["1100"] },
    { companyId: ORG, key: "employee_receivable", accountId: F.acc["1220"] },
    { companyId: ORG, key: "salary_payable", accountId: F.acc["2100"] },
    { companyId: ORG, key: "salary_expense", accountId: F.acc["6000"] },
  ]);
  // Konfigurasi bawaan ditanam domain (idempoten) — saklar masih mati.
  await withCompany(ORG, async (tx) => {
    await seedPayrollIndonesiaDefaults(tx, ORG);
    // FIX-P1 Tahap 3 (AK1-01): suite ini menjalankan run periode
    // 2025-06 — tahun lalu harus dimaterialisasi eksplisit karena
    // periode tanpa baris kini dianggap tertutup.
    await ensureFiscalPeriods(tx, ORG, 2025);
  });
  const map = await withCompanyReadOnly(ORG, async (tx) => {
    const rows = await tx.select().from(accountMappings).where(eq(accountMappings.companyId, ORG));
    return Object.fromEntries(rows.map((row) => [row.key, row.accountId]));
  });
  const accRows = await withCompanyReadOnly(ORG, async (tx) =>
    tx.select().from(accounts).where(eq(accounts.companyId, ORG)),
  );
  for (const row of accRows) F.acc[row.code] = row.id;
  expect(map.pph21_payable).toBeTruthy();
  expect(map.bpjs_payable).toBeTruthy();
  expect(map.payroll_employer_expense).toBeTruthy();
}

async function addEmployee(input: {
  code: string;
  name: string;
  baseSalary: string;
  deductions?: string;
  ptkpStatus?: string;
  npwp?: string;
  jkkRiskClass?: string;
  workRegionCode?: string;
  enrollments?: Record<string, boolean>;
}) {
  const [row] = await withCompany(ORG, async (tx) =>
    tx
      .insert(employees)
      .values({
        companyId: ORG,
        code: input.code,
        name: input.name,
        baseSalary: input.baseSalary,
        allowances: "0",
        deductions: input.deductions ?? "0",
        ptkpStatus: input.ptkpStatus ?? null,
        npwp: input.npwp ?? null,
        jkkRiskClass: input.jkkRiskClass ?? null,
        workRegionCode: input.workRegionCode ?? null,
        isActive: true,
      })
      .returning({ id: employees.id }),
  );
  if (input.enrollments) {
    await withCompany(ORG, async (tx) => {
      await tx.insert(employeeStatutoryEnrollments).values(
        Object.entries(input.enrollments!).map(([program, isEnrolled]) => ({
          companyId: ORG,
          employeeId: row.id,
          program,
          isEnrolled,
        })),
      );
    });
  }
  F.emp[input.code] = row.id;
  return row.id;
}

async function setEmployeeActive(employeeId: string, isActive: boolean) {
  await withCompany(ORG, async (tx) => {
    await tx.update(employees).set({ isActive }).where(and(eq(employees.companyId, ORG), eq(employees.id, employeeId)));
  });
}

async function linesFor(runId: string, employeeId: string) {
  const rows = await withCompanyReadOnly(ORG, async (tx) =>
    tx
      .select()
      .from(payrollItemLines)
      .where(and(eq(payrollItemLines.companyId, ORG), eq(payrollItemLines.runId, runId), eq(payrollItemLines.employeeId, employeeId))),
  );
  return new Map(rows.map((row) => [row.code, row]));
}

async function itemFor(runId: string, employeeId: string) {
  const [row] = await withCompanyReadOnly(ORG, async (tx) =>
    tx
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.companyId, ORG), eq(payrollItems.runId, runId), eq(payrollItems.employeeId, employeeId)))
      .limit(1),
  );
  return row;
}

async function journalLinesFor(runId: string) {
  return withCompanyReadOnly(ORG, async (tx) => {
    const [entry] = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId)))
      .limit(1);
    if (!entry) return { entry: null, lines: [] as Array<{ code: string; debit: string; credit: string }> };
    const lines = await tx
      .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(and(eq(journalLines.companyId, ORG), eq(journalLines.entryId, entry.id)));
    return { entry, lines };
  });
}

async function runOk(period: string, extra?: { acknowledgeMinWage?: boolean }) {
  const result = await runPayrollAction({ period, ...extra });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("run gagal");
  return result.data.id;
}

beforeAll(bootstrapFixture);
afterAll(wipeFixture);

describe("S2 Payroll Indonesia — integrasi dd01", () => {
  it("konfigurasi absen sama sekali → engine mati (domain mengembalikan null)", async () => {
    const config = await withCompany("01900000-0000-7000-8000-00000000ee99", async (tx) =>
      loadStatutoryConfig(tx, "01900000-0000-7000-8000-00000000ee99", "2026-01-01"),
    );
    expect(config).toBeNull();
  });

  it("generik: saklar mati → payroll persis seperti sebelum S2, tanpa baris statutory", async () => {
    await addEmployee({ code: "EMP-G", name: "Generik Saja", baseSalary: "4000000", deductions: "100000" });
    const runId = await runOk("2025-06");
    const item = await itemFor(runId, F.emp["EMP-G"]);
    expectMoney(item.net, 3_900_000);
    const lines = await linesFor(runId, F.emp["EMP-G"]);
    expect(lines.size).toBe(0);
    const { lines: journal } = await journalLinesFor(runId);
    const totalDebit = journal.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
    expectMoney(totalDebit.toFixed(4), 4_000_000);
    expect(journal.some((line) => ["2110", "2120", "6080"].includes(line.code))).toBe(false);
    const [run] = await withCompanyReadOnly(ORG, async (tx) =>
      tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1),
    );
    expectMoney(run.totalPph21, 0);
    expectMoney(run.totalStatutoryEmployee, 0);
    await setEmployeeActive(F.emp["EMP-G"], false);
  });

  it("mengaktifkan engine + karyawan A (BPJS penuh) & B (tanpa kepesertaan): TER & iuran per program dari konfigurasi DB", async () => {
    await withCompany(ORG, async (tx) => {
      await tx
        .update(payrollStatutorySettings)
        .set({ isEnabled: true })
        .where(eq(payrollStatutorySettings.companyId, ORG));
    });
    await addEmployee({
      code: "EMP-A", name: "Andi Lengkap", baseSalary: "10000000",
      ptkpStatus: "TK/0", npwp: "09.123.456.7-890.000", jkkRiskClass: "very_low",
    });
    await addEmployee({
      code: "EMP-B", name: "Bella Tanpa BPJS", baseSalary: "10000000",
      ptkpStatus: "TK/0", npwp: "09.123.456.7-890.001",
      enrollments: { bpjs_kes: false, jht: false, jkk: false, jkm: false, jp: false, jkp: false },
    });

    const runId = await runOk("2026-03");

    const a = await linesFor(runId, F.emp["EMP-A"]);
    expectMoney(a.get("bpjs_kes_employee")!.amount, 100_000);
    expectMoney(a.get("bpjs_kes_employer")!.amount, 400_000);
    expectMoney(a.get("jht_employee")!.amount, 200_000);
    expectMoney(a.get("jht_employer")!.amount, 370_000);
    expectMoney(a.get("jkk_employer")!.amount, 24_000);
    expectMoney(a.get("jkm_employer")!.amount, 30_000);
    expectMoney(a.get("jp_employee")!.amount, 100_000);
    expectMoney(a.get("jp_employer")!.amount, 200_000);
    expectMoney(a.get("jkp_employer")!.amount, 18_000);
    // Bruto pajak memasukkan premi perusahaan JKK+JKM+Kesehatan:
    // 10.000.000 + 24.000 + 30.000 + 400.000 = 10.454.000 → TER A 2,5%.
    expectMoney(a.get("tax_gross")!.amount, 10_454_000);
    expectMoney(a.get("pph21")!.amount, 261_350);
    expect(a.get("pph21")!.basisSnapshot).toMatchObject({ mode: "ter", terRate: "2.5" });
    const itemA = await itemFor(runId, F.emp["EMP-A"]);
    expectMoney(itemA.net, 9_338_650);

    const b = await linesFor(runId, F.emp["EMP-B"]);
    expect(b.has("bpjs_kes_employee")).toBe(false);
    expect(b.has("jht_employee")).toBe(false);
    expectMoney(b.get("tax_gross")!.amount, 10_000_000);
    expectMoney(b.get("pph21")!.amount, 200_000); // TC-02 pada jalur run

    const { lines: journal } = await journalLinesFor(runId);
    const byCode = (code: string) => journal.filter((line) => line.code === code);
    // Utang BPJS = iuran pekerja 400.000 + beban perusahaan 1.024.000.
    expectMoney(byCode("2120").reduce((acc, line) => acc.plus(d(line.credit)), d(0)).toFixed(4), 1_424_000);
    expectMoney(byCode("6080").reduce((acc, line) => acc.plus(d(line.debit)), d(0)).toFixed(4), 1_024_000);
    // Utang PPh 21 = 261.350 + 200.000.
    expectMoney(byCode("2110").reduce((acc, line) => acc.plus(d(line.credit)), d(0)).toFixed(4), 461_350);
    const totalDebit = journal.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
    const totalCredit = journal.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });

  it("saklar per program: mematikan JKP saja menghilangkan hasil JKP persis sebesar iurannya", async () => {
    await withCompany(ORG, async (tx) => {
      await tx
        .update(payrollStatutoryPrograms)
        .set({ isEnabled: false })
        .where(and(eq(payrollStatutoryPrograms.companyId, ORG), eq(payrollStatutoryPrograms.program, "jkp")));
    });
    const runId = await runOk("2026-04");
    const a = await linesFor(runId, F.emp["EMP-A"]);
    expect(a.has("jkp_employer")).toBe(false);
    expectMoney(a.get("bpjs_kes_employer")!.amount, 400_000);
    expectMoney(a.get("pph21")!.amount, 261_350);
  });

  it("tarif TER diubah lewat baris konfigurasi bertanggal: Mei 5%, Maret tetap 2% (snapshot tidak berubah)", async () => {
    // Matikan semua program agar bruto pajak murni upah pada uji ini.
    await withCompany(ORG, async (tx) => {
      await tx
        .update(payrollStatutoryPrograms)
        .set({ isEnabled: false })
        .where(eq(payrollStatutoryPrograms.companyId, ORG));
      // Tutup lapisan lama pada akhir April, buka lapisan 5% untuk Mei,
      // lalu lapisan 2% lagi mulai Juni (pola perubahan tarif resmi).
      await tx
        .update(payrollTerBrackets)
        .set({ effectiveTo: "2026-04-30" })
        .where(
          and(
            eq(payrollTerBrackets.companyId, ORG),
            eq(payrollTerBrackets.category, "A"),
            eq(payrollTerBrackets.lowerBound, "9650001.0000"),
          ),
        );
    });
    await withCompany(ORG, async (tx) => {
      await tx.insert(payrollTerBrackets).values([
        {
          companyId: ORG, category: "A", lowerBound: "9650001", upperBound: "10050000",
          rate: "5", effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31",
        },
        {
          companyId: ORG, category: "A", lowerBound: "9650001", upperBound: "10050000",
          rate: "2", effectiveFrom: "2026-06-01", effectiveTo: null,
        },
      ]);
    });

    const runId = await runOk("2026-05");
    const b = await linesFor(runId, F.emp["EMP-B"]);
    expectMoney(b.get("pph21")!.amount, 500_000);
    const a = await linesFor(runId, F.emp["EMP-A"]);
    expect([...a.keys()].filter((code) => code.endsWith("_employee") || code.endsWith("_employer"))).toHaveLength(0);
    expectMoney(a.get("pph21")!.amount, 500_000);

    // Snapshot Maret tidak berubah oleh konfigurasi baru.
    const marchRuns = await withCompanyReadOnly(ORG, async (tx) =>
      tx.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, ORG), eq(payrollRuns.period, "2026-03"))).limit(1),
    );
    const bMarch = await linesFor(marchRuns[0].id, F.emp["EMP-B"]);
    expectMoney(bMarch.get("pph21")!.amount, 200_000);
  });

  it("TC-11: kasbon dipotong dari gaji tetapi PPh 21 tetap dihitung dari bruto penuh", async () => {
    await withCompany(ORG, async (tx) => {
      await tx
        .update(payrollStatutoryPrograms)
        .set({ isEnabled: true })
        .where(eq(payrollStatutoryPrograms.companyId, ORG));
      await createEmployeeAdvance(tx, {
        companyId: ORG,
        userId: OWNER,
        employeeId: F.emp["EMP-B"],
        date: "2026-06-05",
        amount: "5000000",
        accountId: F.acc["1000"],
        planMode: "full",
      });
    });
    const runId = await runOk("2026-06");
    const b = await linesFor(runId, F.emp["EMP-B"]);
    expectMoney(b.get("pph21")!.amount, 200_000);
    const item = await itemFor(runId, F.emp["EMP-B"]);
    expectMoney(item.advanceDeduction, 5_000_000);
    expectMoney(item.net, 4_800_000);
    const [advance] = await withCompanyReadOnly(ORG, async (tx) =>
      tx.select().from(employeeAdvances).where(eq(employeeAdvances.companyId, ORG)).limit(1),
    );
    expectMoney(advance.remainingAmount, 0);
  });

  it("TC-12: upah di bawah UMP wilayah menghalangi posting sampai diakui eksplisit", async () => {
    await addEmployee({
      code: "EMP-D", name: "Dodi Jakarta", baseSalary: "5000000",
      ptkpStatus: "TK/0", npwp: "09.123.456.7-890.002", workRegionCode: "ID-JK",
      enrollments: { bpjs_kes: false, jht: false, jkk: false, jkm: false, jp: false, jkp: false },
    });
    const blocked = await runPayrollAction({ period: "2026-07" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/upah minimum/i);

    const runId = await runOk("2026-07", { acknowledgeMinWage: true });
    const dLines = await linesFor(runId, F.emp["EMP-D"]);
    expectMoney(dLines.get("pph21")!.amount, 0);
    const item = await itemFor(runId, F.emp["EMP-D"]);
    expectMoney(item.net, 5_000_000);
  });

  it("void run statutory: jurnal dibalik dan run tidak lagi menyumbang year-to-date", async () => {
    const runs = await withCompanyReadOnly(ORG, async (tx) =>
      tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG), eq(payrollRuns.period, "2026-07")))
        .limit(1),
    );
    const runId = runs[0].id;
    const result = await voidPayrollRunAction({ id: runId, reason: "Uji pembatalan S2" });
    expect(result.ok).toBe(true);
    const [run] = await withCompanyReadOnly(ORG, async (tx) =>
      tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1),
    );
    expect(run.status).toBe("void");
    const ytd = await withCompanyReadOnly(ORG, async (tx) =>
      getYearToDateFigures(tx, ORG, F.emp["EMP-A"], 2026),
    );
    // Run Juli yang di-void tidak terhitung; A punya run Mar–Jun (4 bulan).
    expect(ytd.months).toBe(4);
  });

  it("rekap setoran per run membaca snapshot komponen (untuk CSV & slip)", async () => {
    const runs = await withCompanyReadOnly(ORG, async (tx) =>
      tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG), eq(payrollRuns.period, "2026-03")))
        .limit(1),
    );
    const recap = await withCompanyReadOnly(ORG, async (tx) => getPayrollRecap(tx, ORG, runs[0].id));
    const rowA = recap.find((row) => row.employeeCode === "EMP-A")!;
    expectMoney(rowA.pph21, 261_350);
    expectMoney(rowA.statutoryEmployee["bpjs_kes_employee"], 100_000);
    expectMoney(rowA.statutoryEmployer["jkp_employer"], 18_000);
    expectMoney(rowA.net, 9_338_650);
  });

  it("REM-04 (H-1): jurnal run bertanggal akhir bulan periode, bukan tanggal 28 kaku", async () => {
    const runId = await runOk("2026-08", { acknowledgeMinWage: true });
    const { entry } = await journalLinesFor(runId);
    expect(entry).not.toBeNull();
    expect(entry!.date).toBe("2026-08-31");
  });
});
