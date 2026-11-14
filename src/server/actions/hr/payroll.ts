// A-26 Q4 (K-03): pecahan src/server/actions/hr.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { employees, payrollItems, payrollRuns } from "@/db/schema";
import {
  AppError,
  guard,
  isUniqueViolation,
} from "@/lib/errors";
import {
  isoDate,
  moneyString,
  parseInput,
} from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import {
  Decimal,
  d,
  toDb,
} from "@/lib/money";
import { periodEndDate } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import { nextDocumentNumber } from "@/server/sequences";
import {
  getAccountId,
  getAccountMap,
  postJournal,
} from "@/server/accounting";
import { applyPayrollAdvanceDeductions, proposeAdvanceDeductionsBatch } from "@/server/employee-advances";
import {
  payPayrollRun,
  voidPayrollRun,
} from "@/server/hr";

export async function runPayrollAction(input: {
  period: string;
  /** Legacy payload fields are accepted for older clients and ignored. */
  advanceDeductions?: Array<{ employeeId: string; amount: string | number }>;
  finalPeriod?: boolean;
  acknowledgeMinWage?: boolean;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        advanceDeductions: z
          .array(z.object({ employeeId: z.string().uuid(), amount: moneyString("Potongan kasbon") }))
          .optional(),
        finalPeriod: z.boolean().optional(),
        acknowledgeMinWage: z.boolean().optional(),
      }),
      input,
    );
    const overrides = new Map((data.advanceDeductions ?? []).map((row) => [row.employeeId, d(row.amount)]));

    const result = await withCompany(ctx.company.id, async (tx) => {
      const [existing] = await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.companyId, ctx.company.id),
            eq(payrollRuns.period, data.period),
            eq(payrollRuns.kind, "regular"),
            ne(payrollRuns.status, "void"),
          ),
        )
        .limit(1);
      if (existing) throw new AppError("CONFLICT", `Payroll periode ${data.period} sudah pernah diproses.`);

      const staff = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.companyId, ctx.company.id), eq(employees.isActive, true)));
      if (staff.length === 0) throw new AppError("VALIDATION", "Belum ada karyawan aktif.");

      const proposals = await proposeAdvanceDeductionsBatch(tx, ctx.company.id, staff);
      const proposalByEmployee = new Map(proposals.map((row) => [row.employeeId, row]));
      const items = staff.map((employee) => {
        const baseSalary = d(employee.baseSalary);
        const allowances = d(employee.allowances);
        const deductions = d(employee.deductions);
        const gross = baseSalary.plus(allowances);
        const proposal = proposalByEmployee.get(employee.id);
        let advanceDeduction = proposal?.proposal.total ?? d(0);
        const override = overrides.get(employee.id);
        if (override !== undefined) {
          if (override.lt(0)) throw new AppError("VALIDATION", `Potongan kasbon ${employee.name} tidak boleh negatif.`);
          if (override.gt(proposal?.openTotal ?? 0)) {
            throw new AppError("VALIDATION", `Potongan kasbon ${employee.name} melebihi sisa kasbon berjalan.`);
          }
          if (override.gt(Decimal.max(gross.minus(deductions), 0))) {
            throw new AppError("VALIDATION", `Potongan kasbon ${employee.name} melebihi gaji bersih sebelum kasbon.`);
          }
          advanceDeduction = override;
        }
        const net = gross.minus(deductions).minus(advanceDeduction);
        if (net.lt(0)) {
          throw new AppError(
            "VALIDATION",
            `Potongan ${employee.name} melebihi gaji pokok dan tunjangannya. Periksa data gaji karyawan tersebut.`,
          );
        }
        return { employee, baseSalary, allowances, deductions, advanceDeduction, gross, net };
      });
      const totalGross = items.reduce((sum, item) => sum.plus(item.gross), d(0));
      const totalDeductions = items.reduce((sum, item) => sum.plus(item.deductions), d(0));
      const totalAdvanceDeductions = items.reduce((sum, item) => sum.plus(item.advanceDeduction), d(0));
      const totalNet = items.reduce((sum, item) => sum.plus(item.net), d(0));
      if (totalNet.lte(0)) throw new AppError("VALIDATION", "Total gaji bersih harus lebih dari nol.");

      const runDate = periodEndDate(data.period);
      const number = await nextDocumentNumber(tx, ctx.company.id, "PAYROLL", runDate);
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          companyId: ctx.company.id,
          number,
          period: data.period,
          totalGross: toDb(totalGross),
          totalDeductions: toDb(totalDeductions),
          totalAdvanceDeductions: toDb(totalAdvanceDeductions),
          totalLoanDeductions: "0",
          totalPph21: "0",
          totalStatutoryEmployee: "0",
          totalEmployerContributions: "0",
          totalNet: toDb(totalNet),
          createdBy: ctx.user.id,
          postedAt: new Date(),
        })
        .returning({ id: payrollRuns.id, number: payrollRuns.number });

      await tx.insert(payrollItems).values(
        items.map((item) => ({
          companyId: ctx.company.id,
          runId: run.id,
          employeeId: item.employee.id,
          baseSalary: toDb(item.baseSalary),
          allowances: toDb(item.allowances),
          deductions: toDb(item.deductions),
          advanceDeduction: toDb(item.advanceDeduction),
          loanDeduction: "0",
          net: toDb(item.net),
        })),
      );

      const map = await getAccountMap(tx, ctx.company.id);
      const deductionsAccountId = map.salary_deductions_payable ?? map.salary_payable;
      const advanceAccountId = totalAdvanceDeductions.gt(0)
        ? await getAccountId(tx, ctx.company.id, "employee_receivable")
        : null;
      const payrollEntry = await postJournal(tx, {
        companyId: ctx.company.id,
        date: runDate,
        description: `Beban gaji ${data.period} (${number})`,
        sourceType: "payroll",
        sourceId: run.id,
        createdBy: ctx.user.id,
        idempotencyKey: `payroll:${run.id}`,
        lines: [
          { accountId: map.salary_expense, debit: totalGross, description: "Beban gaji pokok dan tunjangan" },
          { accountId: map.salary_payable, credit: totalNet, description: "Utang gaji bersih" },
          { accountId: deductionsAccountId, credit: totalDeductions, description: "Utang potongan gaji tetap" },
          ...(advanceAccountId
            ? [{ accountId: advanceAccountId, credit: totalAdvanceDeductions, description: "Potongan kasbon karyawan" }]
            : []),
        ],
      });

      await applyPayrollAdvanceDeductions(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        runId: run.id,
        journalId: payrollEntry.id,
        date: runDate,
        deductions: new Map(
          items
            .filter((item) => item.advanceDeduction.gt(0))
            .map((item) => [item.employee.id, item.advanceDeduction]),
        ),
      });

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll.run",
        entityType: "payroll_run",
        entityId: run.id,
        after: {
          number,
          period: data.period,
          totalGross: toDb(totalGross),
          totalDeductions: toDb(totalDeductions),
          totalAdvanceDeductions: toDb(totalAdvanceDeductions),
          totalNet: toDb(totalNet),
          journalId: payrollEntry.id,
        },
      });
      return { id: run.id, number, totalNet: totalNet.toNumber(), employees: items.length };
    }).catch((error: unknown) => {
      if (
        isUniqueViolation(error, "payroll_runs_company_period_uq") ||
        isUniqueViolation(error, "payroll_runs_company_number_uq")
      ) {
        throw new AppError("CONFLICT", `Payroll periode ${data.period} sudah pernah diproses.`);
      }
      throw error;
    });

    revalidatePath("/app/akuntansi/payroll");
    revalidatePath("/app/akuntansi");
    return result;
  });
}
export async function payPayrollAction(input: { runId: string; accountId: string; date: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({ runId: z.string().uuid(), accountId: z.string().uuid(), date: isoDate("Tanggal pembayaran") }),
      input,
    );

    // A-26 Q4 (K-03): logika pembayaran run hidup di domain hr/payroll-runs.
    const result = await withCompany(ctx.company.id, async (tx) => {
      const paid = await payPayrollRun(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        userRole: ctx.role,
        runId: data.runId,
        accountId: data.accountId,
        date: data.date,
      });
      return { entry: paid.entry, amount: paid.amount.toNumber() };
    });

    revalidatePath("/app/akuntansi/payroll");
    revalidatePath(`/app/akuntansi/payroll/${data.runId}`);
    revalidatePath("/app/akuntansi");
    return result;
  });
}

export async function voidPayrollRunAction(input: { id: string; reason: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(200) }), input);

    // A-26 Q4 (K-03): rantai pembatalan run hidup di domain hr/payroll-runs.
    await withCompany(ctx.company.id, async (tx) =>
      voidPayrollRun(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        userRole: ctx.role,
        id: data.id,
        reason: data.reason,
      }),
    );

    revalidatePath("/app/akuntansi/payroll");
    revalidatePath(`/app/akuntansi/payroll/${data.id}`);
    revalidatePath("/app/akuntansi");
    return { id: data.id };
  });
}
