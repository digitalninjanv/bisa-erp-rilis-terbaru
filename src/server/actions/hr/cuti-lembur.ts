// A-26 Q4 (K-03): pecahan src/server/actions/hr.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  AppError,
  guard,
} from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";


import { writeAudit } from "@/server/audit";

import {
  computeThrDrafts,
  decideLeaveRequest,
  decideOvertimeRequest,
  ensureDefaultLeaveTypes,
  saveLeaveType,
  setLeaveTypeActive,
  submitLeaveRequest,
  submitOvertimeRequest,
  voidComponentDraft,
} from "@/server/hr";

import { revalidateHrPaths } from "./shared";

/* ------------------------------------------------------------------ */
/* Lembur & THR (§6D)                                                  */
/* ------------------------------------------------------------------ */

const overtimeSubmitSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD."),
  dayType: z.enum(["workday", "rest_5day", "rest_6day", "shortest_day_6day"]),
  hours: z.union([z.string(), z.number()]),
  reason: z.string().trim().max(300).nullish(),
});

export async function submitOvertimeRequestAction(input: z.input<typeof overtimeSubmitSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(overtimeSubmitSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const row = await submitOvertimeRequest(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        date: data.date,
        dayType: data.dayType,
        hours: data.hours,
        reason: data.reason ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "overtime.submit",
        entityType: "overtime_request",
        entityId: row.id,
        after: { employeeId: data.employeeId, date: data.date, hours: String(data.hours) },
      });
      return row;
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/lembur");
    revalidatePath("/app/akuntansi/hr/persetujuan");
    return result;
  });
}

export async function decideOvertimeRequestAction(input: {
  id: string;
  approve: boolean;
  note?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({
        id: z.string().uuid(),
        approve: z.boolean(),
        note: z.string().trim().max(300).nullish(),
      }),
      input,
    );
    await withCompany(ctx.company.id, async (tx) => {
      await decideOvertimeRequest(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        id: data.id,
        approve: data.approve,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.approve ? "overtime.approve" : "overtime.reject",
        entityType: "overtime_request",
        entityId: data.id,
        after: { decidedBy: ctx.user.id, note: data.note ?? null },
      });
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/lembur");
    revalidatePath("/app/akuntansi/hr/persetujuan");
    return { id: data.id };
  });
}

export async function computeThrAction(input: { period: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, "Periode harus YYYY-MM.") }),
      input,
    );
    const result = await withCompany(ctx.company.id, async (tx) => {
      const computed = await computeThrDrafts(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        period: data.period,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "thr.compute",
        entityType: "payroll_component_draft",
        entityId: data.period,
        after: { created: computed.created, skipped: computed.skipped, total: computed.total.toString() },
      });
      return { created: computed.created, skipped: computed.skipped, total: computed.total.toNumber() };
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/lembur");
    return result;
  });
}

export async function voidComponentDraftAction(input: { id: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(z.object({ id: z.string().uuid() }), input);
    // A-26 Q4 (K-03): logika pembatalan draf hidup di domain hr/drafts.
    await withCompany(ctx.company.id, async (tx) =>
      voidComponentDraft(tx, { companyId: ctx.company.id, userId: ctx.user.id, id: data.id }),
    );
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/lembur");
    return { id: data.id };
  });
}

/* ------------------------------------------------------------------ */
/* Cuti (§6C)                                                          */
/* ------------------------------------------------------------------ */

const leaveTypeSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  daysPerYear: z.union([z.string(), z.number()]).nullish(),
  isPaid: z.boolean(),
});

export async function saveLeaveTypeAction(input: z.input<typeof leaveTypeSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(leaveTypeSchema, input);
    const daysPerYear =
      data.daysPerYear === null || data.daysPerYear === undefined || data.daysPerYear === ""
        ? null
        : String(data.daysPerYear);
    if (daysPerYear !== null && !(Number(daysPerYear) >= 0)) {
      throw new AppError("VALIDATION", "Jatah hari cuti tidak boleh negatif.");
    }
    const result = await withCompany(ctx.company.id, async (tx) => {
      const row = await saveLeaveType(tx, {
        companyId: ctx.company.id,
        id: data.id,
        code: data.code,
        name: data.name,
        daysPerYear,
        isPaid: data.isPaid,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.id ? "leave_type.update" : "leave_type.create",
        entityType: "leave_type",
        entityId: row.id,
        after: { code: data.code, name: data.name, daysPerYear, isPaid: data.isPaid },
      });
      return row;
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/cuti");
    return result;
  });
}

export async function setLeaveTypeActiveAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      await setLeaveTypeActive(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "leave_type.activate" : "leave_type.deactivate",
        entityType: "leave_type",
        entityId: data.id,
        after: { isActive: data.isActive },
      });
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/cuti");
    return { id: data.id };
  });
}

const leaveSubmitSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal mulai harus YYYY-MM-DD."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal selesai harus YYYY-MM-DD."),
  halfDay: z.boolean().optional(),
  reason: z.string().trim().max(300).nullish(),
});

export async function submitLeaveRequestAction(input: z.input<typeof leaveSubmitSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(leaveSubmitSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      await ensureDefaultLeaveTypes(tx, ctx.company.id);
      const row = await submitLeaveRequest(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        startDate: data.startDate,
        endDate: data.endDate,
        halfDay: data.halfDay ?? false,
        reason: data.reason ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "leave.submit",
        entityType: "leave_request",
        entityId: row.id,
        after: {
          employeeId: data.employeeId,
          leaveTypeId: data.leaveTypeId,
          startDate: data.startDate,
          endDate: data.endDate,
          days: row.days,
        },
      });
      return row;
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/cuti");
    revalidatePath("/app/akuntansi/hr/persetujuan");
    return result;
  });
}

export async function decideLeaveRequestAction(input: {
  id: string;
  approve: boolean;
  note?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({
        id: z.string().uuid(),
        approve: z.boolean(),
        note: z.string().trim().max(300).nullish(),
      }),
      input,
    );
    await withCompany(ctx.company.id, async (tx) => {
      await decideLeaveRequest(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        id: data.id,
        approve: data.approve,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.approve ? "leave.approve" : "leave.reject",
        entityType: "leave_request",
        entityId: data.id,
        after: { decidedBy: ctx.user.id, note: data.note ?? null },
      });
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/cuti");
    revalidatePath("/app/akuntansi/hr/persetujuan");
    return { id: data.id };
  });
}
