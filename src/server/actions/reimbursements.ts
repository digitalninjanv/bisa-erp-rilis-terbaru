"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { amountField, isoDateField, parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import { effectiveTaxRate } from "@/server/expenses";
import {
  decideReimbursementClaim,
  payReimbursementClaim,
  submitReimbursementClaim,
} from "@/server/reimbursements";

/**
 * SIM-2 S7B-2 (§6F): Reimbursement — actions. Klaim diajukan staf
 * berizin payroll.manage atas nama karyawan; keputusan (sahkan/tolak)
 * wajib oleh pengguna LAIN (maker-checker ditegakkan domain);
 * pembayaran hanya untuk klaim approved dan menjurnal beban.
 */

function revalidateClaimPaths() {
  revalidatePath("/app/akuntansi/klaim");
  revalidatePath("/app/akuntansi");
}

const submitSchema = z.object({
  employeeId: z.string().uuid(),
  date: isoDateField,
  expenseAccountId: z.string().uuid(),
  amount: amountField("Nominal klaim", "positive"),
  description: z.string().trim().min(3).max(300),
  attachmentName: z.string().trim().max(200).optional(),
  attachmentNote: z.string().trim().max(300).optional(),
  // A-21 (R3-10): opsi "Termasuk PPN" — pola createExpenseAction:
  // tarif tidak pernah datang dari klien, dibaca dari pengaturan
  // perusahaan di dalam transaksi (effectiveTaxRate).
  taxIncluded: z.boolean().optional(),
});

export async function submitReimbursementClaimAction(input: z.input<typeof submitSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(submitSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const claim = await submitReimbursementClaim(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        date: data.date,
        expenseAccountId: data.expenseAccountId,
        amount: data.amount,
        description: data.description,
        attachmentName: data.attachmentName ?? null,
        attachmentNote: data.attachmentNote ?? null,
        taxIncluded: data.taxIncluded ?? false,
        taxRate: await effectiveTaxRate(tx, ctx.company.id),
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "reimbursement.submit",
        entityType: "reimbursement_claim",
        entityId: claim.id,
        after: {
          number: claim.number,
          amount: data.amount,
          employeeId: data.employeeId,
          ...(data.taxIncluded ? { taxRate: claim.taxRate } : {}),
        },
      });
      return { id: claim.id, number: claim.number, status: claim.status };
    });
    revalidateClaimPaths();
    return result;
  });
}

const decideSchema = z.object({
  id: z.string().uuid(),
  approve: z.boolean(),
  approvedAmount: amountField("Nominal disahkan", "positive").optional(),
  note: z.string().trim().max(300).optional(),
});

export async function decideReimbursementClaimAction(input: z.input<typeof decideSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(decideSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const claim = await decideReimbursementClaim(tx, {
        companyId: ctx.company.id,
        claimId: data.id,
        decidedBy: ctx.user.id,
        approve: data.approve,
        approvedAmount: data.approvedAmount ?? null,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.approve ? "reimbursement.approve" : "reimbursement.reject",
        entityType: "reimbursement_claim",
        entityId: claim.id,
        after: {
          number: claim.number,
          status: claim.status,
          approvedAmount: claim.approvedAmount,
          note: data.note ?? null,
        },
      });
      return { id: claim.id, number: claim.number, status: claim.status };
    });
    revalidateClaimPaths();
    return result;
  });
}

const paySchema = z.object({
  id: z.string().uuid(),
  paymentAccountId: z.string().uuid(),
  date: isoDateField.optional(),
});

export async function payReimbursementClaimAction(input: z.input<typeof paySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(paySchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const claim = await payReimbursementClaim(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        claimId: data.id,
        paymentAccountId: data.paymentAccountId,
        date: data.date ?? todayISO(),
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "reimbursement.pay",
        entityType: "reimbursement_claim",
        entityId: claim.id,
        after: { number: claim.number, journalId: claim.journalId, paidDate: claim.paidDate },
      });
      return { id: claim.id, number: claim.number, status: claim.status, journalId: claim.journalId };
    });
    revalidateClaimPaths();
    return result;
  });
}
