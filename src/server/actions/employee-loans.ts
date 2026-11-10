"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { amountField, isoDateField, parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import {
  createEmployeeLoan,
  recordLoanRepayment,
  voidEmployeeLoan,
} from "@/server/employee-loans";

/**
 * SIM-2 S7B-2 (§6F): Pinjaman Karyawan — actions. Pinjaman adalah
 * fitur payroll seperti kasbon, tetapi dokumen & jalurnya terpisah
 * tegas: seri PJM, halaman Pinjaman sendiri, dan baris payroll
 * loan_installment. Gerbang izin sama (payroll.manage, modul "hr"
 * sejak keputusan Pemimpin A-24 T2 susulan 2026-11-05 — sebelumnya
 * modul "akuntansi").
 */

function revalidateLoanPaths() {
  revalidatePath("/app/akuntansi/pinjaman");
  revalidatePath("/app/akuntansi/payroll");
  revalidatePath("/app/akuntansi");
}

const createSchema = z.object({
  employeeId: z.string().uuid(),
  date: isoDateField,
  amount: amountField("Jumlah pinjaman", "positive"),
  accountId: z.string().uuid(),
  planMode: z.enum(["tenor", "fixed"]),
  planValue: amountField("Nilai rencana cicilan", "positive"),
  note: z.string().max(300).optional(),
});

export async function createEmployeeLoanAction(input: z.input<typeof createSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(createSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const created = await createEmployeeLoan(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        date: data.date,
        amount: data.amount,
        accountId: data.accountId,
        planMode: data.planMode,
        planValue: data.planValue,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "employee_loan.create",
        entityType: "employee_loan",
        entityId: created.id,
        after: { number: created.number, amount: data.amount, planMode: data.planMode, planValue: data.planValue },
      });
      return created;
    });
    revalidateLoanPaths();
    return result;
  });
}

const repaySchema = z.object({
  employeeId: z.string().uuid(),
  date: isoDateField,
  amount: amountField("Nominal setoran", "positive"),
  accountId: z.string().uuid(),
  note: z.string().max(300).optional(),
});

export async function repayEmployeeLoanAction(input: z.input<typeof repaySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(repaySchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const repaid = await recordLoanRepayment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        date: data.date,
        amount: data.amount,
        accountId: data.accountId,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "employee_loan.repay",
        entityType: "employee",
        entityId: data.employeeId,
        after: { amount: data.amount, journalId: repaid.journalId },
      });
      return repaid;
    });
    revalidateLoanPaths();
    return { journalId: result.journalId };
  });
}

const voidSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
});

export async function voidEmployeeLoanAction(input: z.input<typeof voidSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(voidSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const voided = await voidEmployeeLoan(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        loanId: data.id,
        reason: data.reason,
        date: todayISO(),
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "employee_loan.void",
        entityType: "employee_loan",
        entityId: voided.id,
        after: { reason: data.reason, reversalNumber: voided.reversalNumber },
      });
      return voided;
    });
    revalidateLoanPaths();
    return result;
  });
}
