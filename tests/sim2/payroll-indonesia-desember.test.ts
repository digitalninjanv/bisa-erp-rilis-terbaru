import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
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
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  getYearToDateFigures,
  seedPayrollIndonesiaDefaults,
} from "@/server/payroll-indonesia";
import {
  runPayrollAction,
  voidPayrollRunAction,
} from "@/server/actions/hr/payroll";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S2 — TC-05 masa pajak terakhir (perusahaan fixture dd02).
 *
 * Karyawan tunggal TK/0, bruto tetap Rp10.000.000/bulan sepanjang 2026,
 * hanya ikut JHT & JP (sesuai redaksi TC-05 di S0-C): Jan–Nov dipotong
 * TER 2% (Rp200.000/bln), Desember dihitung ulang setahun dengan Pasal
 * 17 → pajak setahun Rp2.820.000 → potongan Desember Rp620.000.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000dd02" },
    user: { id: "01900000-0000-7000-8000-00000000dd20" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000dd02";
const OWNER = "01900000-0000-7000-8000-00000000dd20";


let employeeId = "";

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
    id: OWNER, name: "Eko Desember", email: "owner@desember.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "DesemberID", slug: "desemberid", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "DesemberID", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const accountSeeds: Array<[string, string, string, "debit" | "credit"]> = [
    ["1000", "Kas", "asset", "debit"],
    ["1220", "Piutang Karyawan", "asset", "debit"],
    ["2100", "Utang Gaji", "liability", "credit"],
    ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ];
  const rows = await adminDb
    .insert(accounts)
    .values(accountSeeds.map(([code, name, type, normalBalance]) => ({ companyId: ORG, code, name, type, normalBalance })))
    .returning();
  const byCode = new Map(rows.map((row) => [row.code, row.id]));
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
    { companyId: ORG, key: "employee_receivable", accountId: byCode.get("1220")! },
    { companyId: ORG, key: "salary_payable", accountId: byCode.get("2100")! },
    { companyId: ORG, key: "salary_expense", accountId: byCode.get("6000")! },
  ]);
  await withCompany(ORG, async (tx) => {
    await seedPayrollIndonesiaDefaults(tx, ORG);
    await tx
      .update(payrollStatutorySettings)
      .set({ isEnabled: true })
      .where(eq(payrollStatutorySettings.companyId, ORG));
    const [person] = await tx
      .insert(employees)
      .values({
        companyId: ORG,
        code: "EMP-C",
        name: "Citra Setahun",
        baseSalary: "10000000",
        allowances: "0",
        deductions: "0",
        ptkpStatus: "TK/0",
        npwp: "09.123.456.7-890.100",
        isActive: true,
      })
      .returning({ id: employees.id });
    employeeId = person.id;
    // TC-05: pegawai hanya membayar JHT & JP.
    await tx.insert(employeeStatutoryEnrollments).values([
      { companyId: ORG, employeeId, program: "bpjs_kes", isEnrolled: false },
      { companyId: ORG, employeeId, program: "jkk", isEnrolled: false },
      { companyId: ORG, employeeId, program: "jkm", isEnrolled: false },
      { companyId: ORG, employeeId, program: "jkp", isEnrolled: false },
    ]);
  });
}

async function linesFor(runId: string) {
  const rows = await withCompanyReadOnly(ORG, async (tx) =>
    tx
      .select()
      .from(payrollItemLines)
      .where(and(eq(payrollItemLines.companyId, ORG), eq(payrollItemLines.runId, runId))),
  );
  return new Map(rows.map((row) => [row.code, row]));
}

async function runOk(period: string) {
  const result = await runPayrollAction({ period });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("run gagal");
  return result.data.id;
}

beforeAll(bootstrapFixture);
afterAll(wipeFixture);

describe("S2 TC-05 — masa pajak terakhir", () => {
  it("Jan–Nov 2026: TER 2% = Rp200.000 per bulan, iuran pekerja JHT+JP Rp300.000", async () => {
    for (let month = 1; month <= 11; month += 1) {
      const period = `2026-${String(month).padStart(2, "0")}`;
      const runId = await runOk(period);
      const lines = await linesFor(runId);
      expectMoney(lines.get("pph21")!.amount, 200_000);
      expectMoney(lines.get("jht_employee")!.amount, 200_000);
      expectMoney(lines.get("jp_employee")!.amount, 100_000);
      expect(lines.has("bpjs_kes_employee")).toBe(false);
      const [item] = await withCompanyReadOnly(ORG, async (tx) =>
        tx.select().from(payrollItems).where(eq(payrollItems.runId, runId)).limit(1),
      );
      expectMoney(item.net, 9_500_000);
    }
  });

  it("year-to-date sebelum Desember: 11 bulan, PPh terpotong Rp2.200.000, pengurang Rp3.300.000", async () => {
    const ytd = await withCompanyReadOnly(ORG, async (tx) =>
      getYearToDateFigures(tx, ORG, employeeId, 2026),
    );
    expect(ytd.months).toBe(11);
    expectMoney(ytd.taxGross.toFixed(4), 110_000_000);
    expectMoney(ytd.pphWithheld.toFixed(4), 2_200_000);
    expectMoney(ytd.deductibleContributions.toFixed(4), 3_300_000);
  });

  it("Desember: hitung ulang Pasal 17 → potongan Rp620.000 (TC-05 persis)", async () => {
    const runId = await runOk("2026-12");
    const lines = await linesFor(runId);
    const pph = lines.get("pph21")!;
    expectMoney(pph.amount, 620_000);
    expect(pph.basisSnapshot).toMatchObject({
      mode: "final_period",
      annualTax: "2820000.0000",
      pkp: "56400000.0000",
      biayaJabatan: "6000000.0000",
      ytdPphWithheld: "2200000.0000",
    });
    const [item] = await withCompanyReadOnly(ORG, async (tx) =>
      tx.select().from(payrollItems).where(eq(payrollItems.runId, runId)).limit(1),
    );
    expectMoney(item.net, 9_080_000);

    const journal = await withCompanyReadOnly(ORG, async (tx) => {
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId)))
        .limit(1);
      const rows = await tx
        .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(eq(journalLines.entryId, entry.id));
      return rows;
    });
    const pphCredit = journal
      .filter((line) => line.code === "2110")
      .reduce((acc, line) => acc.plus(d(line.credit)), d(0));
    expectMoney(pphCredit.toFixed(4), 620_000);
  });

  it("void Desember mengembalikan year-to-date ke 11 bulan", async () => {
    const [run] = await withCompanyReadOnly(ORG, async (tx) =>
      tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG), eq(payrollRuns.period, "2026-12")))
        .limit(1),
    );
    const result = await voidPayrollRunAction({ id: run.id, reason: "Uji void Desember S2" });
    expect(result.ok).toBe(true);
    const ytd = await withCompanyReadOnly(ORG, async (tx) =>
      getYearToDateFigures(tx, ORG, employeeId, 2026),
    );
    expect(ytd.months).toBe(11);
    expectMoney(ytd.pphWithheld.toFixed(4), 2_200_000);
  });
});
