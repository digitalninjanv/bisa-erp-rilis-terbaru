// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  attendanceRecords,
  employeeShiftAssignments,
  employees,
  workShifts,
} from "@/db/schema";
import {
  AppError,
  isUniqueViolation,
} from "@/lib/errors";
import {
  lateMinutes as computeLateMinutes,
  periodRange,
} from "@/lib/hr";

export const ATTENDANCE_STATUSES = ["present", "permit", "sick", "leave", "absent"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

function normalizeTime(value: string): string {
  const [hours = "0", minutes = "0"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

export async function saveWorkShift(
  tx: Tx,
  input: {
    companyId: string;
    id?: string;
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    workDays: number[];
  },
): Promise<{ id: string }> {
  const startTime = normalizeTime(input.startTime);
  const endTime = normalizeTime(input.endTime);
  const values = {
    code: input.code,
    name: input.name,
    startTime,
    endTime,
    workDays: [...new Set(input.workDays)].sort((a, b) => a - b),
    // Jam pulang <= jam masuk berarti shift melewati tengah malam.
    crossesMidnight: endTime <= startTime,
  };
  try {
    if (input.id) {
      const [row] = await tx
        .update(workShifts)
        .set(values)
        .where(and(eq(workShifts.companyId, input.companyId), eq(workShifts.id, input.id)))
        .returning({ id: workShifts.id });
      if (!row) throw new AppError("NOT_FOUND", "Shift tidak ditemukan.");
      return row;
    }
    const [row] = await tx
      .insert(workShifts)
      .values({ companyId: input.companyId, ...values })
      .returning({ id: workShifts.id });
    return row;
  } catch (error) {
    if (isUniqueViolation(error, "work_shifts_company_code_uq")) {
      throw new AppError("CONFLICT", `Kode shift ${input.code} sudah dipakai.`);
    }
    throw error;
  }
}

export async function setWorkShiftActive(
  tx: Tx,
  input: { companyId: string; id: string; isActive: boolean },
): Promise<void> {
  const [row] = await tx
    .update(workShifts)
    .set({ isActive: input.isActive })
    .where(and(eq(workShifts.companyId, input.companyId), eq(workShifts.id, input.id)))
    .returning({ id: workShifts.id });
  if (!row) throw new AppError("NOT_FOUND", "Shift tidak ditemukan.");
}

function dayBefore(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Menugaskan shift ke karyawan mulai tanggal efektif. Penugasan
 * berjalan yang tumpang tindih ditutup sehari sebelum tanggal mulai
 * baru — riwayat penugasan tidak pernah ditimpa.
 */
export async function assignEmployeeShift(
  tx: Tx,
  input: { companyId: string; employeeId: string; shiftId: string; effectiveFrom: string },
): Promise<{ id: string }> {
  const [person] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1);
  if (!person) throw new AppError("VALIDATION", "Karyawan tidak ditemukan di perusahaan ini.");
  const [shift] = await tx
    .select({ id: workShifts.id })
    .from(workShifts)
    .where(and(eq(workShifts.companyId, input.companyId), eq(workShifts.id, input.shiftId)))
    .limit(1);
  if (!shift) throw new AppError("VALIDATION", "Shift tidak ditemukan di perusahaan ini.");

  const existing = await tx
    .select()
    .from(employeeShiftAssignments)
    .where(
      and(
        eq(employeeShiftAssignments.companyId, input.companyId),
        eq(employeeShiftAssignments.employeeId, input.employeeId),
      ),
    )
    .orderBy(asc(employeeShiftAssignments.effectiveFrom));
  for (const row of existing) {
    if (row.effectiveFrom >= input.effectiveFrom) {
      throw new AppError(
        "VALIDATION",
        `Sudah ada penugasan shift mulai ${row.effectiveFrom}; gunakan tanggal efektif yang lebih awal atau ubah penugasan itu.`,
      );
    }
    if (row.effectiveTo === null || row.effectiveTo >= input.effectiveFrom) {
      await tx
        .update(employeeShiftAssignments)
        .set({ effectiveTo: dayBefore(input.effectiveFrom) })
        .where(eq(employeeShiftAssignments.id, row.id));
    }
  }
  const [created] = await tx
    .insert(employeeShiftAssignments)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      effectiveFrom: input.effectiveFrom,
    })
    .returning({ id: employeeShiftAssignments.id });
  return created;
}

export interface ShiftAssignmentView {
  assignmentId: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  workDays: number[];
  crossesMidnight: boolean;
}

/** Shift yang berlaku bagi karyawan pada satu tanggal (null bila belum ditugaskan). */
export async function getShiftAssignmentForDate(
  tx: Tx,
  companyId: string,
  employeeId: string,
  date: string,
): Promise<ShiftAssignmentView | null> {
  const [row] = await tx
    .select({
      assignmentId: employeeShiftAssignments.id,
      shiftId: workShifts.id,
      shiftName: workShifts.name,
      startTime: workShifts.startTime,
      endTime: workShifts.endTime,
      workDays: workShifts.workDays,
      crossesMidnight: workShifts.crossesMidnight,
    })
    .from(employeeShiftAssignments)
    .innerJoin(workShifts, eq(employeeShiftAssignments.shiftId, workShifts.id))
    .where(
      and(
        eq(employeeShiftAssignments.companyId, companyId),
        eq(employeeShiftAssignments.employeeId, employeeId),
        lte(employeeShiftAssignments.effectiveFrom, date),
        sql`(${employeeShiftAssignments.effectiveTo} is null or ${employeeShiftAssignments.effectiveTo} >= ${date})`,
      ),
    )
    .orderBy(desc(employeeShiftAssignments.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export async function recordAttendance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string | null;
    employeeId: string;
    date: string;
    status: AttendanceStatus;
    checkIn?: string | null;
    checkOut?: string | null;
    note?: string | null;
    source?: "manual" | "import" | "leave";
    leaveRequestId?: string | null;
  },
): Promise<{ id: string }> {
  const [person] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1);
  if (!person) throw new AppError("VALIDATION", "Karyawan tidak ditemukan di perusahaan ini.");

  let late = 0;
  if (input.status === "present" && input.checkIn) {
    const assignment = await getShiftAssignmentForDate(tx, input.companyId, input.employeeId, input.date);
    if (assignment && !assignment.crossesMidnight) {
      late = computeLateMinutes(assignment.startTime, input.checkIn);
    }
  }
  const values = {
    status: input.status,
    checkIn: input.checkIn ? normalizeTime(input.checkIn) : null,
    checkOut: input.checkOut ? normalizeTime(input.checkOut) : null,
    lateMinutes: late,
    note: input.note ?? null,
    source: input.source ?? "manual",
    ...(input.leaveRequestId !== undefined ? { leaveRequestId: input.leaveRequestId } : {}),
  };
  const [row] = await tx
    .insert(attendanceRecords)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      date: input.date,
      createdBy: input.userId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [attendanceRecords.companyId, attendanceRecords.employeeId, attendanceRecords.date],
      set: values,
    })
    .returning({ id: attendanceRecords.id });
  return row;
}

const ATTENDANCE_STATUS_ALIASES: Record<string, AttendanceStatus> = {
  hadir: "present",
  present: "present",
  izin: "permit",
  permit: "permit",
  sakit: "sick",
  sick: "sick",
  cuti: "leave",
  leave: "leave",
  alpa: "absent",
  absen: "absent",
  absent: "absent",
};

export interface AttendanceImportResult {
  imported: number;
  errors: Array<{ line: number; message: string }>;
}

/**
 * Impor absensi CSV sederhana. Format per baris:
 * `kode_karyawan;tanggal;status;masuk;pulang;catatan` (pemisah `;`
 * atau `,` dideteksi dari baris pertama; baris judul dilewati).
 * Baris yang rusak tidak menggagalkan seluruh impor — dilaporkan
 * per baris agar dapat diperbaiki dan diimpor ulang.
 */
export async function importAttendanceCsv(
  tx: Tx,
  input: { companyId: string; userId: string | null; text: string },
): Promise<AttendanceImportResult> {
  const lines = input.text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const result: AttendanceImportResult = { imported: 0, errors: [] };
  if (lines.length === 0) return result;
  const delimiter = lines[0].includes(";") ? ";" : ",";

  const staff = await tx
    .select({ id: employees.id, code: employees.code })
    .from(employees)
    .where(eq(employees.companyId, input.companyId));
  const byCode = new Map(staff.map((person) => [person.code, person.id]));

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const cells = lines[index].split(delimiter).map((cell) => cell.trim());
    const [code, date, statusRaw, checkIn, checkOut, note] = cells;
    // Baris judul: sel tanggal bukan format tanggal.
    if (index === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) continue;
    try {
      if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Kolom kode/tanggal tidak lengkap atau format tanggal bukan YYYY-MM-DD.");
      }
      const employeeId = byCode.get(code);
      if (!employeeId) throw new Error(`Kode karyawan ${code} tidak dikenal.`);
      const status = ATTENDANCE_STATUS_ALIASES[(statusRaw ?? "").toLowerCase()];
      if (!status) throw new Error(`Status "${statusRaw}" tidak dikenal (hadir/izin/sakit/cuti/alpa).`);
      await recordAttendance(tx, {
        companyId: input.companyId,
        userId: input.userId,
        employeeId,
        date,
        status,
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        note: note || null,
        source: "import",
      });
      result.imported += 1;
    } catch (error) {
      result.errors.push({
        line: lineNumber,
        message: error instanceof Error ? error.message : "Baris tidak dapat diproses.",
      });
    }
  }
  return result;
}

export interface AttendanceRecapRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  counts: Record<AttendanceStatus, number>;
  totalLateMinutes: number;
  days: number;
}

/** Rekap absensi satu periode (YYYY-MM) per karyawan — tertelusur ke catatan harian. */
export async function getAttendanceRecap(
  tx: Tx,
  companyId: string,
  period: string,
): Promise<AttendanceRecapRow[]> {
  const { start, end } = periodRange(period);
  const rows = await tx
    .select({
      employeeId: attendanceRecords.employeeId,
      employeeCode: employees.code,
      employeeName: employees.name,
      status: attendanceRecords.status,
      lateMinutes: attendanceRecords.lateMinutes,
    })
    .from(attendanceRecords)
    .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
    .where(
      and(
        eq(attendanceRecords.companyId, companyId),
        gte(attendanceRecords.date, start),
        lte(attendanceRecords.date, end),
      ),
    );
  const byEmployee = new Map<string, AttendanceRecapRow>();
  for (const row of rows) {
    const entry =
      byEmployee.get(row.employeeId) ??
      ({
        employeeId: row.employeeId,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        counts: { present: 0, permit: 0, sick: 0, leave: 0, absent: 0 },
        totalLateMinutes: 0,
        days: 0,
      } satisfies AttendanceRecapRow);
    if ((ATTENDANCE_STATUSES as readonly string[]).includes(row.status)) {
      entry.counts[row.status as AttendanceStatus] += 1;
    }
    entry.totalLateMinutes += row.lateMinutes;
    entry.days += 1;
    byEmployee.set(row.employeeId, entry);
  }
  return [...byEmployee.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/* ------------------------------------------------------------------ */
/* Lembur & THR terhubung payroll (§6D, menutup R-6 S2)                */
/* ------------------------------------------------------------------ */
