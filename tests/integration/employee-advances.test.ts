import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  employeeAdvanceEntries,
  employeeAdvances,
  employees,
  journalEntries,
  journalLines,
  payrollItems,
  payrollRuns,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { ensureFiscalPeriods, getAccountMap } from "@/server/accounting";
import {
  createEmployeeAdvance,
  proposeAdvanceDeductions,
  recordAdvanceRepayment,
} from "@/server/employee-advances";
import {
  createEmployeeAdvanceAction,
  repayEmployeeAdvanceAction,
  voidEmployeeAdvanceAction,
} from "@/server/actions/employee-advances";
import {
  runPayrollAction,
  voidPayrollRunAction,
} from "@/server/actions/hr/payroll";
import { makeFlexibleRollbackTransaction } from "../helpers/rollback-transaction";

// A-11 (D-22): Kasbon Karyawan.
//  (a) kasbon fixed 300rb dari 1jt → payroll memotong 300rb, sisa 700rb,
//      jurnal payroll mengkredit Piutang Karyawan (11120) sebesar potongan.
//  (b) mode full → potongan = seluruh sisa.
//  (c) mode percent 50% → basis gaji pokok periode itu.
//  (d) potongan dibatasi gaji bersih sebelum kasbon (gaji tidak negatif,
//      sisa terbawa).
//  (e) potongan diubah manual di run → nilai manual yang dipakai.
//  (f) setoran manual → Dr Kas / Cr Piutang Karyawan, sisa berkurang.
//  (g) batal kasbon tanpa pergerakan OK; sesudah ada potongan ditolak.
//  (h) dua kasbon satu karyawan → alokasi FIFO tertua dulu.
//  Void payroll memulihkan sisa kasbon yang terpotong run itu.
// Aksi diuji pada perusahaan demo dengan sesi mock (pola payroll-reverse);
// fungsi domain murni diuji dalam transaksi rollback di perusahaan aa53.

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  });
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const PERIOD = "2099-09";

const CODES = {
  fixed: "EMP-KSB-FIXED",
  full: "EMP-KSB-FULL",
  percent: "EMP-KSB-PERCENT",
  cap: "EMP-KSB-CAP",
  override: "EMP-KSB-OVERRIDE",
  fifo: "EMP-KSB-FIFO",
} as const;

const empId: Record<string, string> = {};
const advId: Record<string, string> = {};
let cashAccountId = "";
let receivableAccountId = "";
let runId = "";

async function cleanupFixtures() {
  await withCompany(ORG_ID, async (tx) => {
    const rows = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.companyId, ORG_ID), inArray(employees.code, Object.values(CODES))));
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      const advs = await tx
        .select({ id: employeeAdvances.id })
        .from(employeeAdvances)
        .where(and(eq(employeeAdvances.companyId, ORG_ID), inArray(employeeAdvances.employeeId, ids)));
      const advIds = advs.map((row) => row.id);
      if (advIds.length > 0) {
        await tx
          .delete(employeeAdvanceEntries)
          .where(and(eq(employeeAdvanceEntries.companyId, ORG_ID), inArray(employeeAdvanceEntries.advanceId, advIds)));
        await tx
          .delete(employeeAdvances)
          .where(and(eq(employeeAdvances.companyId, ORG_ID), inArray(employeeAdvances.id, advIds)));
      }
    }
    await tx
      .delete(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ORG_ID), eq(payrollRuns.period, PERIOD)));
    if (ids.length > 0) {
      await tx.delete(employees).where(and(eq(employees.companyId, ORG_ID), inArray(employees.id, ids)));
    }
  });
}

async function makeEmployee(code: string, baseSalary: string, deductions = "0") {
  const [row] = await withCompany(ORG_ID, async (tx) =>
    tx
      .insert(employees)
      .values({
        companyId: ORG_ID,
        code,
        name: `Karyawan ${code}`,
        baseSalary,
        allowances: "0",
        deductions,
        isActive: true,
      })
      .returning({ id: employees.id }),
  );
  empId[code] = row.id;
  return row.id;
}

async function makeAdvance(
  key: string,
  employeeId: string,
  input: { amount: string; planMode: "full" | "fixed" | "percent"; planValue?: string; date?: string },
) {
  const result = await createEmployeeAdvanceAction({
    employeeId,
    date: input.date ?? "2099-09-01",
    amount: input.amount,
    accountId: cashAccountId,
    planMode: input.planMode,
    planValue: input.planValue,
    note: `Kasbon uji ${key}`,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  advId[key] = result.data.id;
  return result.data.id;
}

async function readAdvance(id: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select()
      .from(employeeAdvances)
      .where(and(eq(employeeAdvances.companyId, ORG_ID), eq(employeeAdvances.id, id)))
      .limit(1);
    return row;
  });
}

async function readItem(runIdValue: string, employeeId: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, runIdValue), eq(payrollItems.employeeId, employeeId)))
      .limit(1);
    return row;
  });
}

beforeAll(async () => {
  await cleanupFixtures();
  // FIX-P1 Tahap 3 (AK1-01): periode uji 2099-09 harus dimaterialisasi
  // eksplisit — periode tanpa baris kini dianggap tertutup.
  await withCompany(ORG_ID, async (tx) => {
    await ensureFiscalPeriods(tx, ORG_ID, 2099);
  });
  await withCompanyReadOnly(ORG_ID, async (tx) => {
    const map = await getAccountMap(tx, ORG_ID);
    // Pemetaan employee_receivable wajib ada di perusahaan demo —
    // A-27 B6: kini tertanam templat 5 digit sebagai 11120.
    expect(map.employee_receivable).toBeTruthy();
    receivableAccountId = map.employee_receivable;
    cashAccountId = map.cash;
    const [acct] = await tx
      .select({ code: accounts.code })
      .from(accounts)
      .where(eq(accounts.id, receivableAccountId))
      .limit(1);
    expect(acct.code).toBe("110304");
  });
});

afterAll(cleanupFixtures);

describe("kasbon karyawan (A-11/D-22)", () => {
  it("setup: karyawan + kasbon berbagai mode rencana terposting ke Piutang Karyawan", async () => {
    await makeEmployee(CODES.fixed, "5000000");
    await makeEmployee(CODES.full, "4000000");
    await makeEmployee(CODES.percent, "4000000");
    await makeEmployee(CODES.cap, "1000000", "200000");
    await makeEmployee(CODES.override, "6000000");
    await makeEmployee(CODES.fifo, "5000000");

    await makeAdvance("fixed", empId[CODES.fixed], { amount: "1000000", planMode: "fixed", planValue: "300000" });
    await makeAdvance("full", empId[CODES.full], { amount: "750000", planMode: "full" });
    await makeAdvance("percent", empId[CODES.percent], { amount: "3000000", planMode: "percent", planValue: "50" });
    await makeAdvance("cap", empId[CODES.cap], { amount: "2000000", planMode: "full" });
    await makeAdvance("override", empId[CODES.override], { amount: "900000", planMode: "fixed", planValue: "300000" });
    await makeAdvance("fifoA", empId[CODES.fifo], { amount: "200000", planMode: "fixed", planValue: "150000", date: "2099-09-01" });
    await makeAdvance("fifoB", empId[CODES.fifo], { amount: "500000", planMode: "fixed", planValue: "100000", date: "2099-09-03" });

    // Jurnal pemberian kasbon: Dr Piutang Karyawan / Cr Kas, bertag karyawan.
    const adv = await readAdvance(advId.fixed);
    expect(adv.status).toBe("open");
    expect(Number(adv.remainingAmount)).toBe(1000000);
    const lines = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx.select().from(journalLines).where(eq(journalLines.entryId, adv.journalId!)),
    );
    const debit = lines.find((line) => line.accountId === receivableAccountId);
    const credit = lines.find((line) => line.accountId === cashAccountId);
    expect(Number(debit?.debit)).toBe(1000000);
    expect(debit?.partyType).toBe("employee");
    expect(debit?.partyId).toBe(empId[CODES.fixed]);
    expect(Number(credit?.credit)).toBe(1000000);
  });

  it("(a-h) payroll memotong kasbon menurut rencana, override manual, batas bersih, dan FIFO", async () => {
    const result = await runPayrollAction({
      period: PERIOD,
      advanceDeductions: [{ employeeId: empId[CODES.override], amount: "100000" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    runId = result.data.id;

    // (a) fixed 300rb
    const itemFixed = await readItem(runId, empId[CODES.fixed]);
    expect(Number(itemFixed.advanceDeduction)).toBe(300000);
    expect(Number(itemFixed.net)).toBe(4700000);
    expect(Number((await readAdvance(advId.fixed)).remainingAmount)).toBe(700000);

    // (b) full = seluruh sisa
    const itemFull = await readItem(runId, empId[CODES.full]);
    expect(Number(itemFull.advanceDeduction)).toBe(750000);
    expect((await readAdvance(advId.full)).status).toBe("settled");

    // (c) percent 50% dari gaji pokok 4jt = 2jt
    const itemPercent = await readItem(runId, empId[CODES.percent]);
    expect(Number(itemPercent.advanceDeduction)).toBe(2000000);
    expect(Number((await readAdvance(advId.percent)).remainingAmount)).toBe(1000000);

    // (d) dibatasi gaji bersih sebelum kasbon: 1jt − 200rb = 800rb, gaji 0
    const itemCap = await readItem(runId, empId[CODES.cap]);
    expect(Number(itemCap.advanceDeduction)).toBe(800000);
    expect(Number(itemCap.net)).toBe(0);
    expect(Number((await readAdvance(advId.cap)).remainingAmount)).toBe(1200000);

    // (e) override manual 100rb mengalahkan usulan 300rb
    const itemOverride = await readItem(runId, empId[CODES.override]);
    expect(Number(itemOverride.advanceDeduction)).toBe(100000);
    expect(Number((await readAdvance(advId.override)).remainingAmount)).toBe(800000);

    // (h) FIFO: potongan 250rb = 150rb dari kasbon tertua + 100rb berikutnya
    const itemFifo = await readItem(runId, empId[CODES.fifo]);
    expect(Number(itemFifo.advanceDeduction)).toBe(250000);
    expect(Number((await readAdvance(advId.fifoA)).remainingAmount)).toBe(50000);
    expect(Number((await readAdvance(advId.fifoB)).remainingAmount)).toBe(400000);

    // Jurnal payroll mengkredit Piutang Karyawan sebesar total potongan.
    const [entry] = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId)))
        .limit(1),
    );
    const lines = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id)),
    );
    const advanceCredit = lines
      .filter((line) => line.accountId === receivableAccountId)
      .reduce((acc, line) => acc + Number(line.credit), 0);
    expect(advanceCredit).toBe(4200000);
    const totalDebit = lines.reduce((acc, line) => acc + Number(line.debit), 0);
    const totalCredit = lines.reduce((acc, line) => acc + Number(line.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });

  it("(f) setoran manual mengurangi sisa dengan jurnal Dr Kas / Cr Piutang Karyawan", async () => {
    const result = await repayEmployeeAdvanceAction({
      employeeId: empId[CODES.fixed],
      date: "2099-09-15",
      amount: "200000",
      accountId: cashAccountId,
      note: "Setor tunai sebagian",
    });
    expect(result.ok).toBe(true);
    expect(Number((await readAdvance(advId.fixed)).remainingAmount)).toBe(500000);

    const entries = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select()
        .from(employeeAdvanceEntries)
        .where(
          and(
            eq(employeeAdvanceEntries.companyId, ORG_ID),
            eq(employeeAdvanceEntries.advanceId, advId.fixed),
            eq(employeeAdvanceEntries.kind, "repayment"),
          ),
        ),
    );
    expect(entries).toHaveLength(1);
    const lines = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx.select().from(journalLines).where(eq(journalLines.entryId, entries[0].journalId!)),
    );
    expect(Number(lines.find((line) => line.accountId === cashAccountId)?.debit)).toBe(200000);
    expect(Number(lines.find((line) => line.accountId === receivableAccountId)?.credit)).toBe(200000);
  });

  it("(g) kasbon yang sudah bergerak tidak bisa dibatalkan; yang segar bisa", async () => {
    const used = await voidEmployeeAdvanceAction({ id: advId.fixed, reason: "Salah input uji" });
    expect(used.ok).toBe(false);

    const fresh = await createEmployeeAdvanceAction({
      employeeId: empId[CODES.fixed],
      date: "2099-09-16",
      amount: "50000",
      accountId: cashAccountId,
      planMode: "full",
      note: "Kasbon segar untuk dibatalkan",
    });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) throw new Error(fresh.message);
    const cancelled = await voidEmployeeAdvanceAction({ id: fresh.data.id, reason: "Salah input uji" });
    expect(cancelled.ok).toBe(true);
    expect((await readAdvance(fresh.data.id)).status).toBe("void");
  });

  it("void payroll memulihkan sisa kasbon yang terpotong run itu", async () => {
    const result = await voidPayrollRunAction({ id: runId, reason: "Uji pemulihan kasbon" });
    expect(result.ok).toBe(true);
    // fixed: 500rb sisa berjalan + 300rb potongan run yang dibatalkan = 800rb
    expect(Number((await readAdvance(advId.fixed)).remainingAmount)).toBe(800000);
    // full: tadinya settled → terbuka lagi dengan sisa penuh
    const full = await readAdvance(advId.full);
    expect(full.status).toBe("open");
    expect(Number(full.remainingAmount)).toBe(750000);
    const reversals = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select()
        .from(employeeAdvanceEntries)
        .where(
          and(
            eq(employeeAdvanceEntries.companyId, ORG_ID),
            eq(employeeAdvanceEntries.kind, "payroll_reversal"),
            eq(employeeAdvanceEntries.payrollRunId, runId),
          ),
        ),
    );
    expect(reversals.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Domain murni dalam transaksi rollback (perusahaan aa53 / aa54)      */
/* ------------------------------------------------------------------ */

const ORG = "01900000-0000-7000-8000-00000000aa53";
const ORG_NO_MAP = "01900000-0000-7000-8000-00000000aa54";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeFlexibleRollbackTransaction(ORG);

async function ensureCompany(tx: Tx, org: string, withReceivableMapping: boolean) {
  const [settings] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, org))
    .limit(1);
  if (settings) return { cashId: "", employeeId: "" };

  await tx.insert(companySettings).values({ companyId: org, legalName: "Uji Kasbon" });
  const rows = await tx
    .insert(accounts)
    .values([
      { companyId: org, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
      { companyId: org, code: "1220", name: "Piutang Karyawan", type: "asset", normalBalance: "debit" },
      { companyId: org, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit" },
    ])
    .returning({ id: accounts.id, code: accounts.code });
  const byCode = new Map(rows.map((row) => [row.code, row.id]));
  const mappings: Array<[string, string]> = [["cash", byCode.get("1000")!]];
  if (withReceivableMapping) mappings.push(["employee_receivable", byCode.get("1220")!]);
  await tx.insert(accountMappings).values(
    mappings.map(([key, accountId]) => ({ companyId: org, key, accountId })),
  );
  const [person] = await tx
    .insert(employees)
    .values({ companyId: org, code: "EMP-DOM", name: "Karyawan Domain", baseSalary: "4000000", isActive: true })
    .returning({ id: employees.id });
  return { cashId: byCode.get("1000")!, employeeId: person.id };
}

describe("domain kasbon (rollback)", () => {
  it("pemberian kasbon memposting Dr Piutang Karyawan / Cr Kas bertag karyawan", async () => {
    await rollbackTransaction(async (tx) => {
      const { cashId, employeeId } = await ensureCompany(tx, ORG, true);
      const adv = await createEmployeeAdvance(tx, {
        companyId: ORG,
        userId: USER_ID,
        employeeId,
        date: "2026-11-04",
        amount: "1000000",
        accountId: cashId,
        planMode: "fixed",
        planValue: "300000",
      });
      expect(adv.number).toMatch(/^KSB-/);
      const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, adv.journalId!));
      const [mapRow] = await tx
        .select()
        .from(accountMappings)
        .where(and(eq(accountMappings.companyId, ORG), eq(accountMappings.key, "employee_receivable")));
      const debit = lines.find((line) => line.accountId === mapRow.accountId);
      expect(Number(debit?.debit)).toBe(1000000);
      expect(debit?.partyType).toBe("employee");
      expect(Number(lines.find((line) => line.accountId === cashId)?.credit)).toBe(1000000);
    });
  });

  it("tanpa pemetaan employee_receivable → VALIDATION yang menyebut pemetaannya", async () => {
    await rollbackTransaction(async (tx) => {
      const { cashId, employeeId } = await ensureCompany(tx, ORG_NO_MAP, false);
      await expect(
        createEmployeeAdvance(tx, {
          companyId: ORG_NO_MAP,
          userId: USER_ID,
          employeeId,
          date: "2026-11-04",
          amount: "100000",
          accountId: cashId,
          planMode: "full",
        }),
      ).rejects.toThrow(/employee_receivable/);
    }, ORG_NO_MAP);
  });

  it("usulan potongan: percent memakai basis gaji pokok; akun sumber di luar kas/bank ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const { cashId, employeeId } = await ensureCompany(tx, ORG, true);
      const [inventory] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG), eq(accounts.code, "1300")));
      await expect(
        createEmployeeAdvance(tx, {
          companyId: ORG,
          userId: USER_ID,
          employeeId,
          date: "2026-11-04",
          amount: "100000",
          accountId: inventory.id,
          planMode: "full",
        }),
      ).rejects.toThrow(/berkelas kas, bank, atau kliring/);

      await createEmployeeAdvance(tx, {
        companyId: ORG,
        userId: USER_ID,
        employeeId,
        date: "2026-11-04",
        amount: "3000000",
        accountId: cashId,
        planMode: "percent",
        planValue: "50",
      });
      const [person] = await tx.select().from(employees).where(eq(employees.id, employeeId));
      const proposal = await proposeAdvanceDeductions(tx, ORG, person);
      expect(proposal.total.toNumber()).toBe(2000000);
      expect(proposal.allocations).toHaveLength(1);

      // Setoran manual lewat domain mengurangi sisa FIFO.
      await recordAdvanceRepayment(tx, {
        companyId: ORG,
        userId: USER_ID,
        employeeId,
        date: "2026-11-10",
        amount: "500000",
        accountId: cashId,
      });
      const [adv] = await tx
        .select()
        .from(employeeAdvances)
        .where(eq(employeeAdvances.companyId, ORG))
        .orderBy(asc(employeeAdvances.createdAt));
      expect(Number(adv.remainingAmount)).toBe(2500000);
    });
  });
});
