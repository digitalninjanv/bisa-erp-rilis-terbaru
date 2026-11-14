// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  attendanceRecords,
  branches,
  departments,
  employeeHistory,
  employeeStatutoryEnrollments,
  employees,
  hrParameters,
  jobPositions,
  leaveRequests,
  leaveTypes,
  overtimeRequests,
  payrollComponentDrafts,
  payrollItemLines,
  payrollItems,
  payrollRuns,
  workShifts,
} from "@/db/schema";
import { todayISO } from "@/lib/format";
import {
  getOpenAdvanceTotal,
  proposeAdvanceDeductionsBatch,
} from "@/server/employee-advances";
import { getLeaveBalance } from "./leave";
import { getTerminationReasons } from "./parameters";

export async function listEmployeeOptions(
  tx: Tx,
  companyId: string,
  opts?: { activeOnly?: boolean },
) {
  const conditions = [eq(employees.companyId, companyId)];
  if (opts?.activeOnly) conditions.push(eq(employees.isActive, true));
  return tx
    .select({ id: employees.id, code: employees.code, name: employees.name })
    .from(employees)
    .where(and(...conditions))
    .orderBy(employees.name);
}

export async function listEmployees(tx: Tx, companyId: string) {
  return tx
    .select({
      id: employees.id,
      code: employees.code,
      name: employees.name,
      isActive: employees.isActive,
    })
    .from(employees)
    .where(eq(employees.companyId, companyId))
    .orderBy(employees.name);
}

export async function listWorkShifts(tx: Tx, companyId: string) {
  return tx
    .select()
    .from(workShifts)
    .where(eq(workShifts.companyId, companyId))
    .orderBy(workShifts.name);
}

export async function listRecentAttendance(
  tx: Tx,
  companyId: string,
  range: { start: string; end: string },
) {
  return tx
    .select({
      id: attendanceRecords.id,
      employeeId: attendanceRecords.employeeId,
      date: attendanceRecords.date,
      status: attendanceRecords.status,
      checkIn: attendanceRecords.checkIn,
      checkOut: attendanceRecords.checkOut,
      lateMinutes: attendanceRecords.lateMinutes,
      employeeName: employees.name,
      note: attendanceRecords.note,
    })
    .from(attendanceRecords)
    .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
    .where(
      and(
        eq(attendanceRecords.companyId, companyId),
        gte(attendanceRecords.date, range.start),
        lte(attendanceRecords.date, range.end),
      ),
    )
    .orderBy(desc(attendanceRecords.date), employees.name)
    .limit(100);
}

export async function listLeaveTypes(tx: Tx, companyId: string) {
  return tx
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.companyId, companyId))
    .orderBy(leaveTypes.name);
}

export async function listLeaveRequests(tx: Tx, companyId: string) {
  return tx
    .select({
      id: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.days,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      decisionNote: leaveRequests.decisionNote,
      employeeName: employees.name,
      typeName: leaveTypes.name,
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(eq(leaveRequests.companyId, companyId))
    .orderBy(desc(leaveRequests.startDate))
    .limit(100);
}

/** Count every pending leave request for the HR shell badge without loading request details. */
export async function countPendingLeaveRequests(tx: Tx, companyId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.companyId, companyId), eq(leaveRequests.status, "pending")));
  return row?.value ?? 0;
}

export type LeaveBalanceRow = {
  employeeId: string;
  employeeName: string;
  typeName: string;
  quota: string | null;
  carryOver: string;
  used: string;
  available: string | null;
};

export async function listLeaveBalances(
  tx: Tx,
  companyId: string,
  year: number,
  staff: Array<{ id: string; name: string }>,
  types: Array<{ id: string; name: string; daysPerYear: string | null }>,
): Promise<LeaveBalanceRow[]> {
  const balances: LeaveBalanceRow[] = [];
  for (const person of staff) {
    for (const type of types) {
      if (type.daysPerYear === null) continue;
      const balance = await getLeaveBalance(tx, companyId, person.id, type.id, year);
      balances.push({
        employeeId: person.id,
        employeeName: person.name,
        typeName: type.name,
        quota: balance.quota?.toFixed(2) ?? null,
        carryOver: balance.carryOver.toFixed(2),
        used: balance.used.toFixed(2),
        available: balance.available?.toFixed(2) ?? null,
      });
    }
  }
  return balances;
}

export async function listOvertimeRequests(
  tx: Tx,
  companyId: string,
  range: { start: string; end: string },
) {
  return tx
    .select({
      id: overtimeRequests.id,
      date: overtimeRequests.date,
      dayType: overtimeRequests.dayType,
      hours: overtimeRequests.hours,
      reason: overtimeRequests.reason,
      status: overtimeRequests.status,
      decisionNote: overtimeRequests.decisionNote,
      employeeName: employees.name,
    })
    .from(overtimeRequests)
    .innerJoin(employees, eq(overtimeRequests.employeeId, employees.id))
    .where(
      and(
        eq(overtimeRequests.companyId, companyId),
        gte(overtimeRequests.date, range.start),
        lte(overtimeRequests.date, range.end),
      ),
    )
    .orderBy(desc(overtimeRequests.date));
}

/** Count every pending overtime request for the HR shell badge. */
export async function countPendingOvertimeRequests(tx: Tx, companyId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(overtimeRequests)
    .where(and(eq(overtimeRequests.companyId, companyId), eq(overtimeRequests.status, "pending")));
  return row?.value ?? 0;
}

export async function listThrDrafts(tx: Tx, companyId: string, period: string) {
  return tx
    .select({
      id: payrollComponentDrafts.id,
      amount: payrollComponentDrafts.amount,
      status: payrollComponentDrafts.status,
      basisSnapshot: payrollComponentDrafts.basisSnapshot,
      employeeName: employees.name,
    })
    .from(payrollComponentDrafts)
    .innerJoin(employees, eq(payrollComponentDrafts.employeeId, employees.id))
    .where(
      and(
        eq(payrollComponentDrafts.companyId, companyId),
        eq(payrollComponentDrafts.kind, "thr"),
        eq(payrollComponentDrafts.period, period),
      ),
    )
    .orderBy(employees.name);
}

export async function listOrgMasters(tx: Tx, companyId: string) {
  const [deptRows, positionRows] = await Promise.all([
    tx.select().from(departments).where(eq(departments.companyId, companyId)).orderBy(departments.name),
    tx.select().from(jobPositions).where(eq(jobPositions.companyId, companyId)).orderBy(jobPositions.name),
  ]);
  return { departments: deptRows, positions: positionRows };
}

export async function listDepartmentOptions(tx: Tx, companyId: string) {
  return tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.companyId, companyId))
    .orderBy(departments.name);
}

export async function getEmployeeDetail(tx: Tx, companyId: string, employeeId: string) {
  const [person] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)))
    .limit(1);
  if (!person) return null;
  const [dept, pos, branch, manager, history, items] = await Promise.all([
    person.departmentId
      ? tx.select().from(departments).where(eq(departments.id, person.departmentId)).limit(1)
      : Promise.resolve([]),
    person.positionId
      ? tx.select().from(jobPositions).where(eq(jobPositions.id, person.positionId)).limit(1)
      : Promise.resolve([]),
    person.branchId
      ? tx.select().from(branches).where(eq(branches.id, person.branchId)).limit(1)
      : Promise.resolve([]),
    person.managerEmployeeId
      ? tx.select().from(employees).where(eq(employees.id, person.managerEmployeeId)).limit(1)
      : Promise.resolve([]),
    tx
      .select()
      .from(employeeHistory)
      .where(and(eq(employeeHistory.companyId, companyId), eq(employeeHistory.employeeId, employeeId)))
      .orderBy(desc(employeeHistory.effectiveDate), desc(employeeHistory.createdAt)),
    tx
      .select({
        period: payrollRuns.period,
        number: payrollRuns.number,
        status: payrollRuns.status,
        net: payrollItems.net,
      })
      .from(payrollItems)
      .innerJoin(payrollRuns, eq(payrollItems.runId, payrollRuns.id))
      .where(and(eq(payrollItems.companyId, companyId), eq(payrollItems.employeeId, employeeId)))
      .orderBy(desc(payrollRuns.period))
      .limit(12),
  ]);
  const [paramRows, finalRuns, openAdvance] = await Promise.all([
    tx
      .select()
      .from(hrParameters)
      .where(and(eq(hrParameters.companyId, companyId), eq(hrParameters.key, "termination_reasons"))),
    tx
      .select({ id: payrollRuns.id, status: payrollRuns.status })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.companyId, companyId),
          eq(payrollRuns.employeeId, employeeId),
          eq(payrollRuns.kind, "final"),
        ),
      ),
    getOpenAdvanceTotal(tx, companyId, employeeId),
  ]);
  const paramRecord: Record<string, string> = {};
  const today = todayISO();
  const effective = [...paramRows]
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
    .find((row) => row.effectiveFrom <= today && (row.effectiveTo === null || row.effectiveTo >= today));
  if (effective) paramRecord[effective.key] = effective.value;
  return {
    person,
    department: dept[0]?.name ?? null,
    positionName: pos[0]?.name ?? person.position,
    branch: branch[0]?.name ?? null,
    manager: manager[0]?.name ?? null,
    history,
    items,
    terminationReasons: getTerminationReasons(paramRecord),
    hasFinalRun: finalRuns.some((run) => run.status !== "void"),
    openAdvance: openAdvance.toFixed(2),
  };
}

export async function getPayrollPageData(tx: Tx, companyId: string) {
  const [staff, runs] = await Promise.all([
    tx
      .select()
      .from(employees)
      .where(eq(employees.companyId, companyId))
      .orderBy(desc(employees.isActive), employees.name),
    tx
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.companyId, companyId))
      .orderBy(desc(payrollRuns.period))
      .limit(24),
  ]);
  const items = await tx
    .select({
      runId: payrollItems.runId,
      employeeName: employees.name,
      net: payrollItems.net,
    })
    .from(payrollItems)
    .leftJoin(employees, eq(payrollItems.employeeId, employees.id))
    .where(and(eq(payrollItems.companyId, companyId)));
  // SIM-2 S7B-1: opsi struktur organisasi untuk formulir karyawan.
  const [deptRows, positionRows, branchRows] = await Promise.all([
    tx.select().from(departments).where(eq(departments.companyId, companyId)).orderBy(departments.name),
    tx.select().from(jobPositions).where(eq(jobPositions.companyId, companyId)).orderBy(jobPositions.name),
    tx.select().from(branches).where(eq(branches.companyId, companyId)).orderBy(branches.name),
  ]);
  const orgOptions = {
    departments: deptRows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive })),
    positions: positionRows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive })),
    branches: branchRows.map((row) => ({ id: row.id, name: row.name, isActive: true })),
    managers: staff.map((person) => ({ id: person.id, name: person.name })),
  };
  // SIM-2 S2: kepesertaan program statutory per karyawan untuk
  // formulir (ketiadaan baris = ikut; formulir menampilkan bawaan itu).
  const enrollmentRows = await tx
    .select()
    .from(employeeStatutoryEnrollments)
    .where(eq(employeeStatutoryEnrollments.companyId, companyId));
  const enrollmentsByEmployee = new Map<string, Record<string, boolean>>();
  for (const row of enrollmentRows) {
    const entry = enrollmentsByEmployee.get(row.employeeId) ?? {};
    entry[row.program] = row.isEnrolled;
    enrollmentsByEmployee.set(row.employeeId, entry);
  }
  // A-11 (D-22): usulan potongan kasbon untuk formulir proses payroll —
  // hanya karyawan aktif yang masih memiliki kasbon berjalan.
  // SIM-2 S4 (PERF-01): satu query batch untuk semua karyawan —
  // sebelumnya loop ini menjalankan 2 query berurutan per karyawan
  // berkasbon (N+1). Hasilnya identik (computeAdvanceProposal yang sama).
  const nameById = new Map(staff.map((person) => [person.id, person.name]));
  const advanceProposals = (
    await proposeAdvanceDeductionsBatch(tx, companyId, staff)
  ).map((row) => ({
    employeeId: row.employeeId,
    employeeName: nameById.get(row.employeeId) ?? "",
    openTotal: row.openTotal.toFixed(2),
    proposed: row.proposal.total.toFixed(2),
  }));
  return { staff, runs, items, advanceProposals, enrollmentsByEmployee, orgOptions };
}

export async function getPayrollRunDetail(tx: Tx, companyId: string, runId: string) {
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.id, runId)))
    .limit(1);
  if (!run) return null;
  const items = await tx
    .select({
      id: payrollItems.id,
      employeeId: payrollItems.employeeId,
      employeeName: employees.name,
      employeeCode: employees.code,
      baseSalary: payrollItems.baseSalary,
      allowances: payrollItems.allowances,
      deductions: payrollItems.deductions,
      advanceDeduction: payrollItems.advanceDeduction,
      net: payrollItems.net,
    })
    .from(payrollItems)
    .leftJoin(employees, eq(payrollItems.employeeId, employees.id))
    .where(and(eq(payrollItems.companyId, companyId), eq(payrollItems.runId, run.id)))
    .orderBy(asc(employees.name));
  // SIM-2 S2: snapshot komponen statutory (dari payroll_item_lines,
  // bukan hitung ulang) untuk kolom PPh 21 & iuran pekerja.
  const lines = await tx
    .select()
    .from(payrollItemLines)
    .where(and(eq(payrollItemLines.companyId, companyId), eq(payrollItemLines.runId, run.id)));
  return { run, items, lines };
}

export async function getPayrollSlipData(tx: Tx, companyId: string, runId: string) {
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.id, runId)))
    .limit(1);
  if (!run) return null;
  const items = await tx
    .select({
      itemId: payrollItems.id,
      employeeId: payrollItems.employeeId,
      employeeName: employees.name,
      employeeCode: employees.code,
      position: employees.position,
      ptkpStatus: employees.ptkpStatus,
      baseSalary: payrollItems.baseSalary,
      allowances: payrollItems.allowances,
      deductions: payrollItems.deductions,
      advanceDeduction: payrollItems.advanceDeduction,
      net: payrollItems.net,
    })
    .from(payrollItems)
    .leftJoin(employees, eq(payrollItems.employeeId, employees.id))
    .where(and(eq(payrollItems.companyId, companyId), eq(payrollItems.runId, run.id)))
    .orderBy(asc(employees.name));
  const lines = await tx
    .select()
    .from(payrollItemLines)
    .where(and(eq(payrollItemLines.companyId, companyId), eq(payrollItemLines.runId, run.id)));
  return { run, items, lines };
}

export async function listPayrollRunsByIds(tx: Tx, companyId: string, runIds: string[]) {
  if (runIds.length === 0) return [];
  return tx
    .select({ id: payrollRuns.id, number: payrollRuns.number, period: payrollRuns.period })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, companyId), inArray(payrollRuns.id, runIds)));
}
