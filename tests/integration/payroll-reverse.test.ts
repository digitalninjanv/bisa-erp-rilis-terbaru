import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, employees, journalEntries, journalLines, payrollRuns } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { ensureFiscalPeriods, getAccountMap, postJournal } from "@/server/accounting";
import { reverseJournalAction } from "@/server/actions/accounting/jurnal";
import {
  payPayrollAction,
  runPayrollAction,
  voidPayrollPaymentAction,
} from "@/server/actions/hr/payroll";
import { todayISO } from "@/lib/format";

// Server actions need an authenticated company context and Next's cache
// revalidation; both are replaced here so the real action code (validation,
// journal posting, account mapping) runs against the real database.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  });
  // T5R-2: fixture sesi ini mewakili perusahaan dengan semua modul
  // aktif, jadi gerbang modul di lapisan action lolos persis seperti
  // requirePermission (gerbang sungguhannya diuji di review-fixes-t5r).
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
  };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

// Far-future periods keep the committed journals of these action-level tests
// out of every current report range. Runs/items/employees are cleaned up;
// journal entries are append-only by design and stay (always balanced).
const PAYROLL_PERIOD = "2099-11";
const NEGATIVE_PERIOD = "2099-12";
const TEST_EMPLOYEE_CODE = "EMP-TST-AKP103";
const BAD_EMPLOYEE_CODE = "EMP-TST-AKP103NEG";

let runId: string | undefined;

async function cleanupFixtures() {
  await withCompany(ORG_ID, async (tx) => {
    // FIX-P1 Tahap 3 (AK1-01): periode 2099 yang dipakai test ini harus
    // dimaterialisasi eksplisit — periode tanpa baris kini tertutup.
    await ensureFiscalPeriods(tx, ORG_ID, 2099);
    await tx
      .delete(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ORG_ID), inArray(payrollRuns.period, [PAYROLL_PERIOD, NEGATIVE_PERIOD])));
    await tx
      .delete(employees)
      .where(and(eq(employees.companyId, ORG_ID), inArray(employees.code, [TEST_EMPLOYEE_CODE, BAD_EMPLOYEE_CODE])));
  });
}

beforeAll(cleanupFixtures);
afterAll(cleanupFixtures);

describe("payroll journal (AK-P1-03)", () => {
  it("posts gross salary expense, net salary payable, and a separate deductions credit", async () => {
    await withCompany(ORG_ID, async (tx) => {
      await tx.insert(employees).values({
        companyId: ORG_ID,
        code: TEST_EMPLOYEE_CODE,
        name: "Karyawan Uji Potongan",
        baseSalary: "5000000",
        allowances: "500000",
        deductions: "250000",
        isActive: true,
      });
    });

    const result = await runPayrollAction({ period: PAYROLL_PERIOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runId = result.data.id;

    const data = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [run] = await tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG_ID), eq(payrollRuns.id, runId!)))
        .limit(1);
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId!)))
        .limit(1);
      const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id));
      const map = await getAccountMap(tx, ORG_ID);
      return { run, entry, lines, map };
    });

    const gross = Number(data.run.totalGross);
    const deductions = Number(data.run.totalDeductions);
    const net = Number(data.run.totalNet);
    expect(deductions).toBeGreaterThan(0);
    expect(gross).toBeCloseTo(net + deductions, 2);

    // Expense must be the GROSS amount, not the net.
    const expenseDebit = data.lines
      .filter((line) => line.accountId === data.map.salary_expense)
      .reduce((acc, line) => acc + Number(line.debit), 0);
    expect(expenseDebit).toBeCloseTo(gross, 2);

    // Net salary stays payable to employees.
    const netCredit = data.lines.find(
      (line) => line.accountId === data.map.salary_payable && Math.abs(Number(line.credit) - net) < 0.01,
    );
    expect(netCredit).toBeDefined();

    // Deductions withheld (BPJS/PPh/…) must appear as their own payable line,
    // not vanish. A-27 B6: the template now SEEDS the dedicated
    // deductions-payable mapping (21102 Hutang Potongan Gaji), so the
    // line lands there — before B6 the demo had no such key and the
    // line fell back to the salary payable account.
    const deductionsLine = data.lines.find(
      (line) => Math.abs(Number(line.credit) - deductions) < 0.01 && /potongan/i.test(line.description ?? ""),
    );
    expect(deductionsLine).toBeDefined();
    expect(deductionsLine!.accountId).toBe(data.map.salary_deductions_payable);

    // Journal stays balanced at the gross total.
    const totalDebit = data.lines.reduce((acc, line) => acc + Number(line.debit), 0);
    const totalCredit = data.lines.reduce((acc, line) => acc + Number(line.credit), 0);
    expect(totalDebit).toBeCloseTo(gross, 2);
    expect(totalCredit).toBeCloseTo(gross, 2);
  });

  it("paying the run settles only the net payable, leaving deductions payable outstanding", async () => {
    expect(runId).toBeDefined();
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));

    const paid = await payPayrollAction({ runId: runId!, accountId: map.cash, date: todayISO() });
    expect(paid.ok).toBe(true);

    const remaining = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const entries = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalEntries.sourceId, runId!)));
      const lines = await tx
        .select()
        .from(journalLines)
        .where(
          and(
            inArray(
              journalLines.entryId,
              entries.map((entry) => entry.id),
            ),
            // A-27 B6: potongan kini tinggal di akun khususnya
            // (salary_deductions_payable); salary_payable sendiri
            // lunas penuh oleh pembayaran neto.
            eq(journalLines.accountId, map.salary_deductions_payable),
          ),
        );
      const [run] = await tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG_ID), eq(payrollRuns.id, runId!)))
        .limit(1);
      return {
        balance: lines.reduce((acc, line) => acc + Number(line.credit) - Number(line.debit), 0),
        deductions: Number(run.totalDeductions),
      };
    });
    expect(remaining.balance).toBeCloseTo(remaining.deductions, 2);
  });

  it("membatalkan pembayaran gaji mengembalikan run ke posted dan membuat jurnal pembalik", async () => {
    const result = await voidPayrollPaymentAction({
      runId: runId!,
      reason: "Salah akun pembayaran uji",
    });
    expect(result.ok).toBe(true);

    const data = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [run] = await tx
        .select({ status: payrollRuns.status, number: payrollRuns.number })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG_ID), eq(payrollRuns.id, runId!)));
      const paymentEntries = await tx
        .select({ id: journalEntries.id, status: journalEntries.status })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "payroll_payment"),
            eq(journalEntries.sourceId, runId!),
          ),
        );
      const reversalRows = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            inArray(
              journalEntries.reversalOfId,
              paymentEntries.map((row) => row.id),
            ),
          ),
        );
      return { run, paymentEntries, reversalRows };
    });
    expect(data.run.status).toBe("posted");
    expect(data.reversalRows.length).toBeGreaterThan(0);
  });

  it("rejects a run when an employee's deductions exceed their gross pay", async () => {
    await withCompany(ORG_ID, async (tx) => {
      await tx.insert(employees).values({
        companyId: ORG_ID,
        code: BAD_EMPLOYEE_CODE,
        name: "Karyawan Potongan Berlebih",
        baseSalary: "1000000",
        allowances: "0",
        deductions: "1500000",
        isActive: true,
      });
    });
    try {
      const result = await runPayrollAction({ period: NEGATIVE_PERIOD });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/potongan|negatif/i);
    } finally {
      await withCompany(ORG_ID, async (tx) => {
        await tx
          .delete(employees)
          .where(and(eq(employees.companyId, ORG_ID), eq(employees.code, BAD_EMPLOYEE_CODE)));
      });
    }
  });
});

describe("journal reversal guard (AK-P1-04)", () => {
  it("rejects reversing a module journal at journal level but allows a manual journal", async () => {
    const created = await withCompany(ORG_ID, async (tx) => {
      const rows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID));
      const cash = rows.find((row) => row.code === "110107");
      const revenue = rows.find((row) => row.code === "400001");
      const equity = rows.find((row) => row.code === "300001");
      expect(cash).toBeDefined();
      expect(revenue).toBeDefined();
      expect(equity).toBeDefined();

      const systemEntry = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: "Uji AK-P1-04 jurnal sistem penjualan",
        sourceType: "sale",
        sourceId: crypto.randomUUID(),
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 1000, description: "Kas" },
          { accountId: revenue!.id, credit: 1000, description: "Penjualan" },
        ],
      });
      const manualEntry = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: "Uji AK-P1-04 jurnal manual",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 2000, description: "Kas" },
          { accountId: equity!.id, credit: 2000, description: "Modal" },
        ],
      });
      return { systemEntry, manualEntry };
    });

    const rejected = await reverseJournalAction({ entryId: created.systemEntry.id, date: todayISO() });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toMatch(/modul/i);

    const reversalCount = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.reversalOfId, created.systemEntry.id));
      return rows.length;
    });
    expect(reversalCount).toBe(0);

    const allowed = await reverseJournalAction({
      entryId: created.manualEntry.id,
      date: todayISO(),
      description: "Uji AK-P1-04 pembalikan manual",
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.data.number).toBeTruthy();
  });
});
