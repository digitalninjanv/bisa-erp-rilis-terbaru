// A-26 Q4 (K-03): pecahan src/server/actions/hr.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

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
  assignEmployeeShift,
  saveDepartment,
  saveJobPosition,
  saveWorkShift,
  setDepartmentActive,
  setHrParameter,
  setJobPositionActive,
  setWorkShiftActive,
} from "@/server/hr";

import { revalidateHrPaths } from "./shared";

const masterSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
});

export async function saveDepartmentAction(input: z.input<typeof masterSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(masterSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const row = await saveDepartment(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.id ? "department.update" : "department.create",
        entityType: "department",
        entityId: row.id,
        after: { code: data.code, name: data.name },
      });
      return row;
    });
    revalidateHrPaths();
    return result;
  });
}

export async function setDepartmentActiveAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({ id: z.string().uuid(), isActive: z.boolean() }),
      input,
    );
    await withCompany(ctx.company.id, async (tx) => {
      await setDepartmentActive(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "department.activate" : "department.deactivate",
        entityType: "department",
        entityId: data.id,
        after: { isActive: data.isActive },
      });
    });
    revalidateHrPaths();
    return { id: data.id };
  });
}

export async function saveJobPositionAction(input: z.input<typeof masterSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(masterSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const row = await saveJobPosition(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.id ? "job_position.update" : "job_position.create",
        entityType: "job_position",
        entityId: row.id,
        after: { code: data.code, name: data.name },
      });
      return row;
    });
    revalidateHrPaths();
    return result;
  });
}

export async function setJobPositionActiveAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({ id: z.string().uuid(), isActive: z.boolean() }),
      input,
    );
    await withCompany(ctx.company.id, async (tx) => {
      await setJobPositionActive(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "job_position.activate" : "job_position.deactivate",
        entityType: "job_position",
        entityId: data.id,
        after: { isActive: data.isActive },
      });
    });
    revalidateHrPaths();
    return { id: data.id };
  });
}

/* ------------------------------------------------------------------ */
/* Absensi & shift (§6B)                                               */
/* ------------------------------------------------------------------ */

const shiftSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/, "Jam mulai harus HH:MM."),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/, "Jam pulang harus HH:MM."),
  workDays: z.array(z.number().int().min(0).max(6)).min(1, "Pilih minimal satu hari kerja."),
});

export async function saveWorkShiftAction(input: z.input<typeof shiftSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(shiftSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const row = await saveWorkShift(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.id ? "work_shift.update" : "work_shift.create",
        entityType: "work_shift",
        entityId: row.id,
        after: { code: data.code, name: data.name, startTime: data.startTime, endTime: data.endTime },
      });
      return row;
    });
    revalidateHrPaths();
    return result;
  });
}

export async function setWorkShiftActiveAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      await setWorkShiftActive(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "work_shift.activate" : "work_shift.deactivate",
        entityType: "work_shift",
        entityId: data.id,
        after: { isActive: data.isActive },
      });
    });
    revalidateHrPaths();
    return { id: data.id };
  });
}

export async function assignEmployeeShiftAction(input: {
  employeeId: string;
  shiftId: string;
  effectiveFrom: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({
        employeeId: z.string().uuid(),
        shiftId: z.string().uuid(),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal efektif harus YYYY-MM-DD."),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, async (tx) => {
      const row = await assignEmployeeShift(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "employee_shift.assign",
        entityType: "employee",
        entityId: data.employeeId,
        after: { shiftId: data.shiftId, effectiveFrom: data.effectiveFrom },
      });
      return row;
    });
    revalidateHrPaths();
    return result;
  });
}

const HR_PARAMETER_KEYS = [
  "working_days_per_month",
  "default_work_days",
  "overtime_payroll_enabled",
  "unpaid_leave_payroll_enabled",
  "leave_carry_over_enabled",
  "contract_expiry_warning_days",
  "termination_reasons",
] as const;

export async function updateHrParameterAction(input: { key: string; value: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({
        key: z.enum(HR_PARAMETER_KEYS),
        value: z.string().trim().min(1).max(2000),
      }),
      input,
    );
    if (data.key === "default_work_days") {
      const days = data.value.split(",").map((part) => Number(part.trim()));
      if (
        days.length === 0 ||
        days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      ) {
        throw new AppError(
          "VALIDATION",
          "Pola hari kerja harus daftar weekday 0–6 dipisah koma (mis. 1,2,3,4,5).",
        );
      }
    } else if (
      data.key !== "termination_reasons" &&
      data.key !== "overtime_payroll_enabled" &&
      data.key !== "unpaid_leave_payroll_enabled" &&
      data.key !== "leave_carry_over_enabled"
    ) {
      const numeric = Number(data.value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new AppError("VALIDATION", "Nilai parameter harus angka positif.");
      }
    }
    if (data.key.endsWith("_enabled") && data.value !== "true" && data.value !== "false") {
      throw new AppError("VALIDATION", "Nilai saklar harus true atau false.");
    }
    await withCompany(ctx.company.id, async (tx) => {
      await setHrParameter(tx, ctx.company.id, data.key, data.value);
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "hr_parameter.update",
        entityType: "hr_parameter",
        entityId: data.key,
        after: { key: data.key, value: data.value },
      });
    });
    revalidateHrPaths();
    return { key: data.key };
  });
}
