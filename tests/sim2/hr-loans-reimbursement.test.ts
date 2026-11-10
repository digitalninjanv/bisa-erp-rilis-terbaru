import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  employeeLoanEntries,
  employeeLoans,
  employees,
  journalEntries,
  journalLines,
  member,
  organization,
  payrollItemLines,
  payrollItems,
  payrollRuns,
  reimbursementClaims,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  runPayrollAction,
  voidPayrollRunAction,
} from "@/server/actions/hr/payroll";
import { terminateEmployeeAction } from "@/server/actions/hr/karyawan";
import {
  createEmployeeLoanAction,
  repayEmployeeLoanAction,
} from "@/server/actions/employee-loans";
import { getOpenLoanTotal } from "@/server/employee-loans";
import {
  decideReimbursementClaim,
  payReimbursementClaim,
  submitReimbursementClaim,
} from "@/server/reimbursements";
import { createEmployeeAdvanceAction } from "@/server/actions/employee-advances";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-2 Batch 1 — Pinjaman karyawan (§6F) & reimbursement.
 *
 * Pinjaman TERPISAH dari kasbon: pinjaman 12 jt tenor 12 bulan terpotong
 * tepat Rp1.000.000 pada dua run berurutan sebagai baris bernama
 * loan_installment (bukan advance_deduction); void run memulihkan sisa;
 * pembayaran akhir menagih sisa pinjaman. Reimbursement yang disahkan
 * dibayar sebagai BEBAN (Dr akun beban / Cr kas) — saldo Piutang
 * Karyawan tidak bergerak; klaim ditolak tidak bisa dibayar.
 */

const state = vi.hoisted(() => ({ org: "", user: "" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: state.org },
    user: { id: state.user },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e801";
const OWNER = "01900000-0000-7000-8000-00000000e850";
const APPROVER = "01900000-0000-7000-8000-00000000e851";


function expectMoney(actual: unknown, expected: number | string) {
  expect(d(actual as string).toFixed(2)).toBe(d(expected).toFixed(2));
}

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER, APPROVER]);
}

const acc: Record<string, string> = {};
let employeeId = "";
let employee2Id = "";

async function bootstrap() {
  await wipeFixture();
  for (const [id, name, email] of [
    [OWNER, "Pemilik Uji", "owner-e801@bisa.id"],
    [APPROVER, "Penyetuju Uji", "approver-e801@bisa.id"],
  ] as const) {
    await adminDb.insert(user).values({ id, name, email, emailVerified: true, role: "owner" });
    await adminDb.insert(account).values({
      id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id,
    });
  }
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji Pinjaman", slug: "uji-pinjaman", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji Pinjaman", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
      { companyId: ORG, code: "1220", name: "Piutang Karyawan", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "2100", name: "Utang Gaji", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "6000", name: "Beban Gaji", type: "expense", normalBalance: "debit" },
      { companyId: ORG, code: "6040", name: "Beban Transportasi", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  for (const row of rows) acc[row.code] = row.id;
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc["1000"] },
    { companyId: ORG, key: "employee_receivable", accountId: acc["1220"] },
    { companyId: ORG, key: "salary_payable", accountId: acc["2100"] },
    { companyId: ORG, key: "salary_expense", accountId: acc["6000"] },
  ]);
  const [emp] = await adminDb
    .insert(employees)
    .values({
      companyId: ORG, code: "EMP-L01", name: "Lala Pinjam", baseSalary: "6000000",
      allowances: "0", deductions: "0", joinedAt: "2025-01-02", isActive: true,
    })
    .returning({ id: employees.id });
  employeeId = emp.id;
  const [emp2] = await adminDb
    .insert(employees)
    .values({
      companyId: ORG, code: "EMP-L02", name: "Bima Klaim", baseSalary: "5000000",
      allowances: "0", deductions: "0", joinedAt: "2025-01-02", isActive: true,
    })
    .returning({ id: employees.id });
  employee2Id = emp2.id;
  state.org = ORG;
  state.user = OWNER;
}

async function journalLinesOf(sourceType: string, sourceId: string) {
  return adminDb
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
      ),
    );
}

async function accountBalance(accountId: string): Promise<number> {
  const rows = await adminDb
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.status, "posted"),
      ),
    );
  return rows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
}

beforeAll(bootstrap);
afterAll(wipeFixture);

describe("Pinjaman karyawan — siklus payroll", () => {
  it("pemberian pinjaman menjurnal Dr Piutang Karyawan / Cr Kas", async () => {
    const result = await createEmployeeLoanAction({
      employeeId,
      date: "2026-01-05",
      amount: "12000000",
      accountId: acc["1000"],
      planMode: "tenor",
      planValue: "12",
      note: "Pinjaman renovasi",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = await journalLinesOf("employee_loan", result.data.id);
    const debitReceivable = lines.find((l) => l.accountId === acc["1220"]);
    const creditCash = lines.find((l) => l.accountId === acc["1000"]);
    expectMoney(debitReceivable?.debit, 12000000);
    expectMoney(creditCash?.credit, 12000000);
  });

  it("dua run payroll memotong cicilan tepat Rp1.000.000 sebagai baris pinjaman terpisah", async () => {
    for (const period of ["2026-01", "2026-02"]) {
      const run = await runPayrollAction({ period });
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      const [item] = await adminDb
        .select()
        .from(payrollItems)
        .where(and(eq(payrollItems.runId, run.data.id), eq(payrollItems.employeeId, employeeId)));
      expectMoney(item.loanDeduction, 1000000);
      expectMoney(item.advanceDeduction, 0);
      const named = await adminDb
        .select()
        .from(payrollItemLines)
        .where(
          and(
            eq(payrollItemLines.runId, run.data.id),
            eq(payrollItemLines.employeeId, employeeId),
            eq(payrollItemLines.code, "loan_installment"),
          ),
        );
      expect(named).toHaveLength(1);
      expectMoney(named[0].amount, 1000000);
    }
    const remaining = await withCompany(ORG, (tx) => getOpenLoanTotal(tx, ORG, employeeId));
    expectMoney(remaining.toFixed(2), 10000000);
  });

  it("void run memulihkan sisa pinjaman run itu", async () => {
    const [run] = await adminDb
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ORG), eq(payrollRuns.period, "2026-02")));
    const voided = await voidPayrollRunAction({ id: run.id, reason: "Salah periode uji" });
    expect(voided.ok).toBe(true);
    const remaining = await withCompany(ORG, (tx) => getOpenLoanTotal(tx, ORG, employeeId));
    expectMoney(remaining.toFixed(2), 11000000);
    const entries = await adminDb
      .select()
      .from(employeeLoanEntries)
      .where(and(eq(employeeLoanEntries.companyId, ORG), eq(employeeLoanEntries.kind, "payroll_reversal")));
    expect(entries).toHaveLength(1);
    expectMoney(entries[0].amount, 1000000);
  });

  it("setoran manual mengurangi sisa pinjaman (FIFO)", async () => {
    const repaid = await repayEmployeeLoanAction({
      employeeId,
      date: "2026-02-10",
      amount: "1000000",
      accountId: acc["1000"],
    });
    expect(repaid.ok).toBe(true);
    const remaining = await withCompany(ORG, (tx) => getOpenLoanTotal(tx, ORG, employeeId));
    expectMoney(remaining.toFixed(2), 10000000);
  });

  it("kasbon dan pinjaman terpotong sebagai dua baris berbeda pada run yang sama", async () => {
    const advance = await createEmployeeAdvanceAction({
      employeeId: employee2Id,
      date: "2026-01-05",
      amount: "300000",
      accountId: acc["1000"],
      planMode: "full",
    });
    expect(advance.ok).toBe(true);
    const loan = await createEmployeeLoanAction({
      employeeId: employee2Id,
      date: "2026-01-06",
      amount: "2400000",
      accountId: acc["1000"],
      planMode: "fixed",
      planValue: "400000",
    });
    expect(loan.ok).toBe(true);
    const run = await runPayrollAction({ period: "2026-03" });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const [item] = await adminDb
      .select()
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, run.data.id), eq(payrollItems.employeeId, employee2Id)));
    expectMoney(item.advanceDeduction, 300000);
    expectMoney(item.loanDeduction, 400000);
    expectMoney(item.net, 5000000 - 300000 - 400000);
    const [loanRow] = await adminDb
      .select()
      .from(employeeLoans)
      .where(eq(employeeLoans.companyId, ORG));
    expect(loanRow).toBeTruthy();
  });
});

describe("Pinjaman karyawan — pembayaran akhir", () => {
  it("terminasi menagih sisa pinjaman dari pembayaran akhir", async () => {
    const before = await withCompany(ORG, (tx) => getOpenLoanTotal(tx, ORG, employeeId));
    // Sisa pinjaman melebihi gaji sebulan Rp6.000.000, jadi tanpa
    // penegasan eksplisit terminasi harus DITOLAK dulu.
    expect(before.gt(6000000)).toBe(true);
    const rejected = await terminateEmployeeAction({
      employeeId,
      terminationDate: "2026-04-30",
      terminationReason: "resign",
      period: "2026-04",
    });
    expect(rejected.ok).toBe(false);

    const accepted = await terminateEmployeeAction({
      employeeId,
      terminationDate: "2026-04-30",
      terminationReason: "resign",
      period: "2026-04",
      acknowledgeShortfall: true,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    // Gaji penuh sebulan (faktor prorata 1) Rp6.000.000 tertagih ke
    // pinjaman; bersih 0 dan sisanya tetap piutang terbuka.
    expectMoney(accepted.data.net, 0);
    expectMoney(accepted.data.loanCharged, 6000000);
    const remaining = await withCompany(ORG, (tx) => getOpenLoanTotal(tx, ORG, employeeId));
    expectMoney(remaining.toFixed(2), before.minus(6000000).toFixed(2));
    const [run] = await adminDb
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ORG), eq(payrollRuns.kind, "final")));
    expectMoney(run.totalLoanDeductions, 6000000);
  });
});

describe("Reimbursement — persetujuan & pembayaran sebagai beban", () => {
  it("klaim disahkan lalu dibayar: Dr Beban / Cr Kas, piutang karyawan tidak bergerak", async () => {
    const receivableBefore = await accountBalance(acc["1220"]);
    const claim = await withCompany(ORG, (tx) =>
      submitReimbursementClaim(tx, {
        companyId: ORG,
        userId: OWNER,
        employeeId: employee2Id,
        date: "2026-03-03",
        expenseAccountId: acc["6040"],
        amount: "750000",
        description: "Bensin kunjungan klien",
        attachmentName: "struk-bensin.jpg",
      }),
    );
    const decided = await withCompany(ORG, (tx) =>
      decideReimbursementClaim(tx, {
        companyId: ORG,
        claimId: claim.id,
        decidedBy: APPROVER,
        approve: true,
        approvedAmount: "700000",
        note: "Disahkan sebagian sesuai struk",
      }),
    );
    expect(decided.status).toBe("approved");
    expectMoney(decided.approvedAmount, 700000);

    const paid = await withCompany(ORG, (tx) =>
      payReimbursementClaim(tx, {
        companyId: ORG,
        userId: APPROVER,
        claimId: claim.id,
        paymentAccountId: acc["1000"],
        date: "2026-03-05",
      }),
    );
    expect(paid.status).toBe("paid");
    const lines = await journalLinesOf("reimbursement", claim.id);
    expectMoney(lines.find((l) => l.accountId === acc["6040"])?.debit, 700000);
    expectMoney(lines.find((l) => l.accountId === acc["1000"])?.credit, 700000);
    // Piutang karyawan TIDAK berubah oleh reimbursement.
    expect(await accountBalance(acc["1220"])).toBe(receivableBefore);
  });

  it("klaim yang sama tidak dapat diajukan dua kali selama masih terbuka", async () => {
    await withCompany(ORG, (tx) =>
      submitReimbursementClaim(tx, {
        companyId: ORG,
        userId: OWNER,
        employeeId: employee2Id,
        date: "2026-03-10",
        expenseAccountId: acc["6040"],
        amount: "150000",
        description: "Parkir dan tol",
      }),
    );
    await expect(
      withCompany(ORG, (tx) =>
        submitReimbursementClaim(tx, {
          companyId: ORG,
          userId: OWNER,
          employeeId: employee2Id,
          date: "2026-03-10",
          expenseAccountId: acc["6040"],
          amount: "150000",
          description: "Parkir dan tol",
        }),
      ),
    ).rejects.toThrow();
  });

  it("klaim ditolak tidak bisa dibayar; pengesah tidak boleh pengaju yang sama", async () => {
    const claim = await withCompany(ORG, (tx) =>
      submitReimbursementClaim(tx, {
        companyId: ORG,
        userId: OWNER,
        employeeId: employee2Id,
        date: "2026-03-12",
        expenseAccountId: acc["6040"],
        amount: "200000",
        description: "Konsumsi rapat",
      }),
    );
    // Maker-checker: pengaju tidak boleh mengesahkan klaimnya sendiri.
    await expect(
      withCompany(ORG, (tx) =>
        decideReimbursementClaim(tx, {
          companyId: ORG,
          claimId: claim.id,
          decidedBy: OWNER,
          approve: true,
        }),
      ),
    ).rejects.toThrow();
    const rejected = await withCompany(ORG, (tx) =>
      decideReimbursementClaim(tx, {
        companyId: ORG,
        claimId: claim.id,
        decidedBy: APPROVER,
        approve: false,
        note: "Bukti tidak lengkap",
      }),
    );
    expect(rejected.status).toBe("rejected");
    await expect(
      withCompany(ORG, (tx) =>
        payReimbursementClaim(tx, {
          companyId: ORG,
          userId: APPROVER,
          claimId: claim.id,
          paymentAccountId: acc["1000"],
          date: "2026-03-13",
        }),
      ),
    ).rejects.toThrow();
    const [row] = await adminDb
      .select()
      .from(reimbursementClaims)
      .where(eq(reimbursementClaims.id, claim.id));
    expect(row.status).toBe("rejected");
    expect(row.journalId).toBeNull();
  });
});
