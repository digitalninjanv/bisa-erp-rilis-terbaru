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
  createEmployeeAdvance,
  recordAdvanceRepayment,
  voidEmployeeAdvance,
} from "@/server/employee-advances";

/**
 * A-11 (D-22): Kasbon Karyawan — actions. Kasbon adalah fitur payroll,
 * jadi seluruh aksi tulis bergate `payroll.manage` di modul "hr"
 * (keputusan Pemimpin A-24 T2 susulan 2026-11-05 — sebelumnya modul
 * "akuntansi"), sama seperti aksi karyawan & run payroll di
 * actions/hr.ts.
 */

function revalidateAdvancePaths() {
  revalidatePath("/app/akuntansi/kasbon");
  revalidatePath("/app/akuntansi/payroll");
  revalidatePath("/app/akuntansi");
}

const createSchema = z.object({
  employeeId: z.string().uuid(),
  date: isoDateField,
  amount: amountField("Jumlah kasbon", "positive"),
  accountId: z.string().uuid(),
  planMode: z.enum(["full", "fixed", "percent"]),
  planValue: amountField("Nilai rencana", "positive").optional(),
  note: z.string().max(300).optional(),
});

export async function createEmployeeAdvanceAction(input: z.input<typeof createSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(createSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const created = await createEmployeeAdvance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        date: data.date,
        amount: data.amount,
        accountId: data.accountId,
        planMode: data.planMode,
        planValue: data.planValue ?? null,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "employee_advance.create",
        entityType: "employee_advance",
        entityId: created.id,
        after: { number: created.number, amount: data.amount, planMode: data.planMode },
      });
      return created;
    });
    revalidateAdvancePaths();
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

export async function repayEmployeeAdvanceAction(input: z.input<typeof repaySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(repaySchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const repaid = await recordAdvanceRepayment(tx, {
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
        action: "employee_advance.repay",
        entityType: "employee",
        entityId: data.employeeId,
        after: { amount: data.amount, journalId: repaid.journalId },
      });
      return repaid;
    });
    revalidateAdvancePaths();
    return { journalId: result.journalId };
  });
}

const voidSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
});

export async function voidEmployeeAdvanceAction(input: z.input<typeof voidSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(voidSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const voided = await voidEmployeeAdvance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        advanceId: data.id,
        reason: data.reason,
        date: todayISO(),
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "employee_advance.void",
        entityType: "employee_advance",
        entityId: voided.id,
        after: { reason: data.reason, reversalNumber: voided.reversalNumber },
      });
      return voided;
    });
    revalidateAdvancePaths();
    return result;
  });
}
