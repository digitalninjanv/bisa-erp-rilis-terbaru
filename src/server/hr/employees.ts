// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  and,
  asc,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  branches,
  departments,
  employeeHistory,
  employees,
  jobPositions,
} from "@/db/schema";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { getHrParameters, hrParamNumber } from "./parameters";
import type { EmployeeRow } from "./shared";

export interface EmployeeHistoryDraft {
  fieldGroup: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export async function recordEmployeeHistory(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    userId: string | null;
    effectiveDate?: string;
    note?: string | null;
    drafts: EmployeeHistoryDraft[];
  },
): Promise<void> {
  if (input.drafts.length === 0) return;
  await tx.insert(employeeHistory).values(
    input.drafts.map((draft) => ({
      companyId: input.companyId,
      employeeId: input.employeeId,
      fieldGroup: draft.fieldGroup,
      before: draft.before,
      after: draft.after,
      effectiveDate: input.effectiveDate ?? todayISO(),
      note: input.note ?? null,
      createdBy: input.userId,
    })),
  );
}

async function nameOf(
  tx: Tx,
  table: "department" | "position" | "branch" | "employee",
  companyId: string,
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  if (table === "department") {
    const [row] = await tx
      .select({ name: departments.name })
      .from(departments)
      .where(and(eq(departments.companyId, companyId), eq(departments.id, id)))
      .limit(1);
    return row?.name ?? null;
  }
  if (table === "position") {
    const [row] = await tx
      .select({ name: jobPositions.name })
      .from(jobPositions)
      .where(and(eq(jobPositions.companyId, companyId), eq(jobPositions.id, id)))
      .limit(1);
    return row?.name ?? null;
  }
  if (table === "branch") {
    const [row] = await tx
      .select({ name: branches.name })
      .from(branches)
      .where(and(eq(branches.companyId, companyId), eq(branches.id, id)))
      .limit(1);
    return row?.name ?? null;
  }
  const [row] = await tx
    .select({ name: employees.name })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)))
    .limit(1);
  return row?.name ?? null;
}

function positionLabelOf(row: EmployeeRow, masterName: string | null): string | null {
  return row.positionId ? masterName : row.position;
}

/**
 * Membandingkan keadaan karyawan sebelum & sesudah simpan dan
 * menghasilkan draf baris riwayat untuk kelompok field yang berubah:
 * jabatan, departemen, gaji pokok, kontrak, cabang, atasan, status.
 * Snapshot memuat id + label terbaca agar riwayat tetap bermakna
 * walau master dirujuk berubah nama kemudian.
 */
export async function buildEmployeeHistoryDiff(
  tx: Tx,
  companyId: string,
  before: EmployeeRow,
  after: EmployeeRow,
): Promise<EmployeeHistoryDraft[]> {
  const drafts: EmployeeHistoryDraft[] = [];

  const [beforePosName, afterPosName] = [
    await nameOf(tx, "position", companyId, before.positionId),
    await nameOf(tx, "position", companyId, after.positionId),
  ];
  const beforePosLabel = positionLabelOf(before, beforePosName);
  const afterPosLabel = positionLabelOf(after, afterPosName);
  if (before.positionId !== after.positionId || beforePosLabel !== afterPosLabel) {
    drafts.push({
      fieldGroup: "position",
      before: { positionId: before.positionId, position: beforePosLabel },
      after: { positionId: after.positionId, position: afterPosLabel },
    });
  }

  if (before.departmentId !== after.departmentId) {
    drafts.push({
      fieldGroup: "department",
      before: {
        departmentId: before.departmentId,
        department: await nameOf(tx, "department", companyId, before.departmentId),
      },
      after: {
        departmentId: after.departmentId,
        department: await nameOf(tx, "department", companyId, after.departmentId),
      },
    });
  }

  if (!d(before.baseSalary).eq(d(after.baseSalary))) {
    drafts.push({
      fieldGroup: "base_salary",
      before: { baseSalary: before.baseSalary },
      after: { baseSalary: after.baseSalary },
    });
  }

  if (
    before.contractType !== after.contractType ||
    before.contractStart !== after.contractStart ||
    before.contractEnd !== after.contractEnd
  ) {
    drafts.push({
      fieldGroup: "contract",
      before: {
        contractType: before.contractType,
        contractStart: before.contractStart,
        contractEnd: before.contractEnd,
      },
      after: {
        contractType: after.contractType,
        contractStart: after.contractStart,
        contractEnd: after.contractEnd,
      },
    });
  }

  if (before.branchId !== after.branchId) {
    drafts.push({
      fieldGroup: "branch",
      before: { branchId: before.branchId, branch: await nameOf(tx, "branch", companyId, before.branchId) },
      after: { branchId: after.branchId, branch: await nameOf(tx, "branch", companyId, after.branchId) },
    });
  }

  if (before.managerEmployeeId !== after.managerEmployeeId) {
    drafts.push({
      fieldGroup: "manager",
      before: {
        managerEmployeeId: before.managerEmployeeId,
        manager: await nameOf(tx, "employee", companyId, before.managerEmployeeId),
      },
      after: {
        managerEmployeeId: after.managerEmployeeId,
        manager: await nameOf(tx, "employee", companyId, after.managerEmployeeId),
      },
    });
  }

  if (before.isActive !== after.isActive || before.employmentStatus !== after.employmentStatus) {
    drafts.push({
      fieldGroup: "status",
      before: { isActive: before.isActive, employmentStatus: before.employmentStatus },
      after: { isActive: after.isActive, employmentStatus: after.employmentStatus },
    });
  }

  return drafts;
}

/* ------------------------------------------------------------------ */
/* Peringatan kontrak berakhir (§6A acceptance)                         */
/* ------------------------------------------------------------------ */

export interface ExpiringContract {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  contractEnd: string;
  daysLeft: number;
}

/** Karyawan aktif berkontrak PKWT yang tanggal akhir kontraknya jatuh dalam ambang konfigurasi. */
export async function listExpiringContracts(
  tx: Tx,
  companyId: string,
  asOf: string = todayISO(),
): Promise<ExpiringContract[]> {
  const params = await getHrParameters(tx, companyId, asOf);
  const warningDays = hrParamNumber(params, "contract_expiry_warning_days", 30);
  const until = new Date(`${asOf}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + warningDays);
  const untilISO = until.toISOString().slice(0, 10);
  const rows = await tx
    .select({
      employeeId: employees.id,
      employeeCode: employees.code,
      employeeName: employees.name,
      contractEnd: employees.contractEnd,
    })
    .from(employees)
    .where(
      and(
        eq(employees.companyId, companyId),
        eq(employees.isActive, true),
        eq(employees.contractType, "pkwt"),
        sql`${employees.contractEnd} is not null`,
        gte(employees.contractEnd, asOf),
        lte(employees.contractEnd, untilISO),
      ),
    )
    .orderBy(asc(employees.contractEnd));
  return rows.map((row) => ({
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    contractEnd: row.contractEnd as string,
    daysLeft: Math.round(
      (new Date(`${row.contractEnd}T00:00:00Z`).getTime() - new Date(`${asOf}T00:00:00Z`).getTime()) / 86_400_000,
    ),
  }));
}

/* ------------------------------------------------------------------ */
/* Absensi & shift (§6B)                                               */
/* ------------------------------------------------------------------ */
