import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  accountMappings,
  accounts,
  auditLog,
  customerGroups,
  employees,
  expenses,
  fiscalPeriods,
  journalLines,
  paymentMethods,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  deleteAccountAction,
  saveAccountAction,
  saveMappingAction,
} from "@/server/actions/accounting/akun-pemetaan";
import { setPeriodStatusAction } from "@/server/actions/accounting/periode";
import { voidExpenseAction } from "@/server/actions/accounting/beban-transfer";
import { saveEmployeeAction } from "@/server/actions/hr/karyawan";

// Server actions need an authenticated company context and Next's cache
// revalidation; both are replaced here so the real action code runs against
// the real database. The role is mutable so AK-P2-01 can act as a non-owner.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const sessionState = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: sessionState.role,
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

const PERIOD_YEAR = 2099;
const PERIOD_MONTH = 3;
const UNLOCK_REASON = "Koreksi audit uji AK-P2-01";
const EXPENSE_NUMBER = "EXP-TST-AKP205";
const PM_ACCOUNT_CODE = "TST-P2-PM";
const GROUP_ACCOUNT_CODE = "TST-P2-GR";
const PM_CODE = "TST-P2";
const GROUP_NAME = "Grup Uji AK-P2-12";
const NEG_EMPLOYEE_CODE = "EMP-TST-AKP210NEG";

async function accountByCode(code: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
      .limit(1);
    return row;
  });
}

async function cleanupFixtures() {
  await withCompany(ORG_ID, async (tx) => {
    await tx
      .delete(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.code, PM_CODE)));
    await tx
      .delete(customerGroups)
      .where(and(eq(customerGroups.companyId, ORG_ID), eq(customerGroups.name, GROUP_NAME)));
    await tx
      .delete(expenses)
      .where(and(eq(expenses.companyId, ORG_ID), eq(expenses.number, EXPENSE_NUMBER)));
    await tx
      .delete(employees)
      .where(and(eq(employees.companyId, ORG_ID), eq(employees.code, NEG_EMPLOYEE_CODE)));
    await tx
      .delete(accountMappings)
      .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, "salary_deductions_payable")));
    // A-27 B6: pemetaan salary_deductions_payable kini bagian dari
    // templat demo (→ 21102) — pembersihan wajib memulihkannya,
    // bukan meninggalkan demo tanpa kunci itu (sebelum B6 baris ini
    // memang tidak ada di demo dan delete di atas cukup).
    const [deductionsAccount] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "210209")))
      .limit(1);
    if (deductionsAccount) {
      await tx.insert(accountMappings).values({
        companyId: ORG_ID,
        key: "salary_deductions_payable",
        accountId: deductionsAccount.id,
      });
    }
    for (const code of [PM_ACCOUNT_CODE, GROUP_ACCOUNT_CODE]) {
      await tx
        .delete(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)));
    }
    await tx
      .delete(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.companyId, ORG_ID),
          eq(fiscalPeriods.year, PERIOD_YEAR),
          eq(fiscalPeriods.month, PERIOD_MONTH),
        ),
      );
  });
  sessionState.role = "owner";
}

beforeAll(cleanupFixtures);
afterAll(cleanupFixtures);

describe("periode terkunci (AK-P2-01)", () => {
  let periodId: string;

  beforeAll(async () => {
    await withCompany(ORG_ID, async (tx) => {
      const [row] = await tx
        .insert(fiscalPeriods)
        .values({ companyId: ORG_ID, year: PERIOD_YEAR, month: PERIOD_MONTH, status: "locked" })
        .returning({ id: fiscalPeriods.id });
      periodId = row.id;
    });
  });

  async function periodStatus() {
    return withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ status: fiscalPeriods.status })
        .from(fiscalPeriods)
        .where(eq(fiscalPeriods.id, periodId))
        .limit(1);
      return row.status;
    });
  }

  it("rejects unlocking a locked period for a non-owner, even with a reason", async () => {
    sessionState.role = "accountant";
    try {
      const result = await setPeriodStatusAction({
        year: PERIOD_YEAR,
        month: PERIOD_MONTH,
        status: "open",
        reason: UNLOCK_REASON,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/owner|pemilik/i);
      expect(await periodStatus()).toBe("locked");
    } finally {
      sessionState.role = "owner";
    }
  });

  it("rejects unlocking a locked period for an owner without a reason", async () => {
    const result = await setPeriodStatusAction({
      year: PERIOD_YEAR,
      month: PERIOD_MONTH,
      status: "open",
    });
    expect(result.ok).toBe(false);
    expect(await periodStatus()).toBe("locked");
  });

  it("lets an owner unlock a locked period with a reason, recorded in the audit log", async () => {
    const result = await setPeriodStatusAction({
      year: PERIOD_YEAR,
      month: PERIOD_MONTH,
      status: "open",
      reason: UNLOCK_REASON,
    });
    expect(result.ok).toBe(true);
    expect(await periodStatus()).toBe("open");

    const audit = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.entityType, "fiscal_period"),
            eq(auditLog.entityId, periodId),
            eq(auditLog.action, "period.open"),
          ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      return row;
    });
    expect(JSON.stringify(audit?.after ?? {})).toContain(UNLOCK_REASON);
  });
});

describe("void beban tanpa jurnal sumber (AK-P2-05)", () => {
  it("fails hard and keeps the expense posted when there is no journal to reverse", async () => {
    const expenseAccount = await accountByCode("600004");
    const paymentAccount = await accountByCode("110107");
    expect(expenseAccount).toBeDefined();
    expect(paymentAccount).toBeDefined();

    const [expense] = await withCompany(ORG_ID, (tx) =>
      tx
        .insert(expenses)
        .values({
          companyId: ORG_ID,
          number: EXPENSE_NUMBER,
          date: "2099-01-15",
          expenseAccountId: expenseAccount!.id,
          paymentAccountId: paymentAccount!.id,
          amount: "150000",
          description: "Beban uji tanpa jurnal sumber",
          status: "posted",
        })
        .returning({ id: expenses.id }),
    );

    const result = await voidExpenseAction({ id: expense.id, reason: "Uji gagal jurnal hilang" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");

    const status = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ status: expenses.status })
        .from(expenses)
        .where(eq(expenses.id, expense.id))
        .limit(1);
      return row.status;
    });
    expect(status).toBe("posted");
  });
});

describe("pemetaan akun (AK-P2-06)", () => {
  it("rejects an unknown mapping key", async () => {
    const cash = await accountByCode("110107");
    expect(cash).toBeDefined();
    const result = await saveMappingAction({ key: "kunci_liar_p2", accountId: cash!.id });
    expect(result.ok).toBe(false);
  });

  it("rejects a mapping to a non-existent account, and accepts a valid one", async () => {
    const ghost = await saveMappingAction({ key: "cash", accountId: crypto.randomUUID() });
    expect(ghost.ok).toBe(false);

    // The ghost attempt must not have touched the real cash mapping.
    const cash = await accountByCode("110107");
    const salaryPayable = await accountByCode("210101");
    expect(cash).toBeDefined();
    expect(salaryPayable).toBeDefined();
    const current = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, "cash")))
        .limit(1);
      return row;
    });
    expect(current.accountId).toBe(cash!.id);

    const saved = await saveMappingAction({
      key: "salary_deductions_payable",
      accountId: salaryPayable!.id,
    });
    expect(saved.ok).toBe(true);
  });
});

describe("update id hantu & tipe akun (AK-P2-10)", () => {
  it("rejects updating an account id that does not exist", async () => {
    const result = await saveAccountAction({
      id: crypto.randomUUID(),
      code: "TST-GHOST",
      name: "Akun Hantu Uji",
      type: "asset",
      normalBalance: "debit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects updating an employee id that does not exist", async () => {
    const result = await saveEmployeeAction({
      id: crypto.randomUUID(),
      code: "EMP-TST-GHOST",
      name: "Karyawan Hantu",
      baseSalary: 1000000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects a negative base salary", async () => {
    const result = await saveEmployeeAction({
      code: NEG_EMPLOYEE_CODE,
      name: "Karyawan Gaji Negatif",
      baseSalary: -5000,
    });
    expect(result.ok).toBe(false);
    const rows = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.companyId, ORG_ID), eq(employees.code, NEG_EMPLOYEE_CODE))),
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects changing the type of an account that already has journal lines", async () => {
    const transacted = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ account: accounts })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(eq(journalLines.companyId, ORG_ID))
        .limit(1);
      return row?.account;
    });
    expect(transacted).toBeDefined();

    const flipped: "asset" | "liability" = transacted!.type === "asset" ? "liability" : "asset";
    const result = await saveAccountAction({
      id: transacted!.id,
      code: transacted!.code,
      name: transacted!.name,
      type: flipped,
      normalBalance: transacted!.normalBalance as "debit" | "credit",
      parentId: transacted!.parentId,
      section: transacted!.section as never,
      cashFlowGroup: transacted!.cashFlowGroup as never,
      description: transacted!.description,
      isPostable: transacted!.isPostable,
      isActive: transacted!.isActive,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/tipe|jurnal/i);

    const after = await accountByCode(transacted!.code);
    expect(after?.type).toBe(transacted!.type);
  });
});

describe("penjaga hapus akun referensi lain (AK-P2-12)", () => {
  async function createBareAccount(code: string) {
    const result = await saveAccountAction({
      code,
      name: `Akun Uji ${code}`,
      type: "asset",
      normalBalance: "debit",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    return result.data.id as string;
  }

  it("rejects deleting an account referenced by a payment method, allows it after the reference is gone", async () => {
    const accountId = await createBareAccount(PM_ACCOUNT_CODE);
    await withCompany(ORG_ID, (tx) =>
      tx.insert(paymentMethods).values({
        companyId: ORG_ID,
        code: PM_CODE,
        name: "Metode Uji AK-P2-12",
        type: "bank",
        accountId,
      }),
    );

    const rejected = await deleteAccountAction(accountId);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toMatch(/metode pembayaran/i);

    await withCompany(ORG_ID, (tx) =>
      tx
        .delete(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.code, PM_CODE))),
    );
    const allowed = await deleteAccountAction(accountId);
    expect(allowed.ok).toBe(true);
  });

  it("rejects deleting an account referenced as a customer group discount account", async () => {
    const accountId = await createBareAccount(GROUP_ACCOUNT_CODE);
    await withCompany(ORG_ID, (tx) =>
      tx.insert(customerGroups).values({
        companyId: ORG_ID,
        name: GROUP_NAME,
        discountAccountId: accountId,
      }),
    );

    const rejected = await deleteAccountAction(accountId);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toMatch(/kelompok/i);

    await withCompany(ORG_ID, (tx) =>
      tx
        .delete(customerGroups)
        .where(and(eq(customerGroups.companyId, ORG_ID), eq(customerGroups.name, GROUP_NAME))),
    );
    const allowed = await deleteAccountAction(accountId);
    expect(allowed.ok).toBe(true);
  });
});
