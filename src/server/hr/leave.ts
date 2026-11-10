// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  and,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  employees,
  leaveRequests,
  leaveTypes,
} from "@/db/schema";
import {
  AppError,
  isUniqueViolation,
} from "@/lib/errors";
import {
  d,
  toDb,
  Decimal,
} from "@/lib/money";
import {
  countWorkdays,
  enumerateDates,
  isWorkday,
  periodRange,
} from "@/lib/hr";
import { getShiftAssignmentForDate, recordAttendance } from "./attendance";
import { getHrParameters, hrParamBool } from "./parameters";

/**
 * Jenis cuti bawaan awal perusahaan — kebijakan yang dapat diubah
 * admin (jatah & status berbayar hidup di tabel, bukan kode). Cuti
 * tahunan 12 hari mengikuti hak minimum UU Ketenagakerjaan; sisanya
 * kebijakan umum perusahaan.
 */
export const DEFAULT_LEAVE_TYPES: Array<{
  code: string;
  name: string;
  daysPerYear: string | null;
  isPaid: boolean;
}> = [
  { code: "tahunan", name: "Cuti Tahunan", daysPerYear: "12", isPaid: true },
  { code: "sakit", name: "Cuti Sakit", daysPerYear: null, isPaid: true },
  { code: "melahirkan", name: "Cuti Melahirkan", daysPerYear: "90", isPaid: true },
  { code: "izin", name: "Izin Tidak Berbayar", daysPerYear: null, isPaid: false },
  { code: "khusus", name: "Cuti Khusus", daysPerYear: null, isPaid: true },
];

/** Menanam jenis cuti bawaan untuk perusahaan yang belum memilikinya (idempoten). */
export async function ensureDefaultLeaveTypes(tx: Tx, companyId: string): Promise<void> {
  const existing = await tx
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(eq(leaveTypes.companyId, companyId))
    .limit(1);
  if (existing.length > 0) return;
  await tx.insert(leaveTypes).values(
    DEFAULT_LEAVE_TYPES.map((row) => ({ companyId, ...row })),
  );
}

export async function saveLeaveType(
  tx: Tx,
  input: {
    companyId: string;
    id?: string;
    code: string;
    name: string;
    daysPerYear: string | null;
    isPaid: boolean;
  },
): Promise<{ id: string }> {
  const values = {
    code: input.code,
    name: input.name,
    daysPerYear: input.daysPerYear,
    isPaid: input.isPaid,
  };
  try {
    if (input.id) {
      const [row] = await tx
        .update(leaveTypes)
        .set(values)
        .where(and(eq(leaveTypes.companyId, input.companyId), eq(leaveTypes.id, input.id)))
        .returning({ id: leaveTypes.id });
      if (!row) throw new AppError("NOT_FOUND", "Jenis cuti tidak ditemukan.");
      return row;
    }
    const [row] = await tx
      .insert(leaveTypes)
      .values({ companyId: input.companyId, ...values })
      .returning({ id: leaveTypes.id });
    return row;
  } catch (error) {
    if (isUniqueViolation(error, "leave_types_company_code_uq")) {
      throw new AppError("CONFLICT", `Kode jenis cuti ${input.code} sudah dipakai.`);
    }
    throw error;
  }
}

export async function setLeaveTypeActive(
  tx: Tx,
  input: { companyId: string; id: string; isActive: boolean },
): Promise<void> {
  const [row] = await tx
    .update(leaveTypes)
    .set({ isActive: input.isActive })
    .where(and(eq(leaveTypes.companyId, input.companyId), eq(leaveTypes.id, input.id)))
    .returning({ id: leaveTypes.id });
  if (!row) throw new AppError("NOT_FOUND", "Jenis cuti tidak ditemukan.");
}

/** Pola hari kerja karyawan pada satu tanggal: shift yang berlaku, atau pola bawaan konfigurasi. */
export async function getEmployeeWorkDays(
  tx: Tx,
  companyId: string,
  employeeId: string,
  date: string,
): Promise<number[]> {
  const assignment = await getShiftAssignmentForDate(tx, companyId, employeeId, date);
  if (assignment) return assignment.workDays;
  const params = await getHrParameters(tx, companyId, date);
  const parsed = (params.default_work_days ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return parsed.length > 0 ? parsed : [1, 2, 3, 4, 5];
}

export interface LeaveBalance {
  quota: Decimal | null;
  carryOver: Decimal;
  used: Decimal;
  available: Decimal | null;
}

/**
 * Saldo cuti satu karyawan/jenis/tahun: jatah konfigurasi + sisa tahun
 * lalu (hanya bila saklar carry-over aktif dan jenisnya berjatah) −
 * hari terpakai dari pengajuan yang DISETUJUI pada tahun itu. Saldo
 * tidak pernah negatif dari sisi pemakaian karena pengajuan yang
 * melebihi saldo ditolak.
 */
export async function getLeaveBalance(
  tx: Tx,
  companyId: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<LeaveBalance> {
  const [type] = await tx
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.companyId, companyId), eq(leaveTypes.id, leaveTypeId)))
    .limit(1);
  if (!type) throw new AppError("VALIDATION", "Jenis cuti tidak ditemukan di perusahaan ini.");
  const usedOf = async (targetYear: number): Promise<Decimal> => {
    const rows = await tx
      .select({ days: leaveRequests.days })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.leaveTypeId, leaveTypeId),
          eq(leaveRequests.status, "approved"),
          gte(leaveRequests.startDate, `${targetYear}-01-01`),
          lte(leaveRequests.startDate, `${targetYear}-12-31`),
        ),
      );
    return rows.reduce((acc, row) => acc.plus(d(row.days)), d(0));
  };
  const used = await usedOf(year);
  const quota = type.daysPerYear === null ? null : d(type.daysPerYear);
  let carryOver = d(0);
  if (quota !== null) {
    const params = await getHrParameters(tx, companyId, `${year}-01-01`);
    if (hrParamBool(params, "leave_carry_over_enabled")) {
      const previousRemaining = quota.minus(await usedOf(year - 1));
      if (previousRemaining.gt(0)) carryOver = previousRemaining;
    }
  }
  return {
    quota,
    carryOver,
    used,
    available: quota === null ? null : quota.plus(carryOver).minus(used),
  };
}

export async function submitLeaveRequest(
  tx: Tx,
  input: {
    companyId: string;
    userId: string | null;
    employeeId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    halfDay?: boolean;
    reason?: string | null;
  },
): Promise<{ id: string; days: string }> {
  const [person] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1);
  if (!person) throw new AppError("VALIDATION", "Karyawan tidak ditemukan di perusahaan ini.");
  const [type] = await tx
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.companyId, input.companyId), eq(leaveTypes.id, input.leaveTypeId)))
    .limit(1);
  if (!type) throw new AppError("VALIDATION", "Jenis cuti tidak ditemukan di perusahaan ini.");
  if (!type.isActive) throw new AppError("VALIDATION", `Jenis cuti ${type.name} sedang nonaktif.`);
  if (input.endDate < input.startDate) {
    throw new AppError("VALIDATION", "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }

  const overlapping = await tx
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.companyId, input.companyId),
        eq(leaveRequests.employeeId, input.employeeId),
        sql`${leaveRequests.status} in ('pending', 'approved')`,
        lte(leaveRequests.startDate, input.endDate),
        gte(leaveRequests.endDate, input.startDate),
      ),
    )
    .limit(1);
  if (overlapping.length > 0) {
    throw new AppError("VALIDATION", "Sudah ada pengajuan cuti yang tumpang tindih pada rentang tanggal itu.");
  }

  const workDays = await getEmployeeWorkDays(tx, input.companyId, input.employeeId, input.startDate);
  const days =
    input.halfDay && input.startDate === input.endDate
      ? d("0.5")
      : d(countWorkdays(input.startDate, input.endDate, workDays));
  if (days.lte(0)) {
    throw new AppError("VALIDATION", "Rentang tanggal tidak memuat hari kerja menurut pola kerja karyawan.");
  }

  const year = Number(input.startDate.slice(0, 4));
  const balance = await getLeaveBalance(tx, input.companyId, input.employeeId, input.leaveTypeId, year);
  if (balance.available !== null && days.gt(balance.available)) {
    throw new AppError(
      "VALIDATION",
      `Pengajuan ${days.toFixed(2)} hari melebihi sisa cuti ${type.name} (${balance.available.toFixed(2)} hari) untuk tahun ${year}.`,
    );
  }

  const [row] = await tx
    .insert(leaveRequests)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      days: toDb(days),
      reason: input.reason ?? null,
      createdBy: input.userId,
    })
    .returning({ id: leaveRequests.id });
  return { id: row.id, days: toDb(days) };
}

export async function decideLeaveRequest(
  tx: Tx,
  input: {
    companyId: string;
    userId: string | null;
    userRole?: string | null;
    id: string;
    approve: boolean;
    note?: string | null;
  },
): Promise<void> {
  const [request] = await tx
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.companyId, input.companyId), eq(leaveRequests.id, input.id)))
    .limit(1);
  if (!request) throw new AppError("NOT_FOUND", "Pengajuan cuti tidak ditemukan.");
  if (request.status !== "pending") {
    throw new AppError("INVALID_STATE", "Pengajuan cuti sudah diputuskan.");
  }
  // WF-003: Maker-checker (Four-Eyes Principle) — pembuat pengajuan cuti tidak dapat mengesahkan sendiri
  if (
    input.approve &&
    input.userId &&
    request.createdBy &&
    request.createdBy === input.userId &&
    input.userRole !== "owner"
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Prinsip Maker-Checker (Four-Eyes Principle): Pengajuan cuti tidak dapat disahkan oleh pembuat pengajuan itu sendiri.",
    );
  }
  if (input.approve) {
    // Saldo diperiksa ulang saat pengesahan: persetujuan lain dapat
    // saja menghabiskan saldo sesudah pengajuan dibuat.
    const year = Number(request.startDate.slice(0, 4));
    const balance = await getLeaveBalance(
      tx,
      input.companyId,
      request.employeeId,
      request.leaveTypeId,
      year,
    );
    if (balance.available !== null && d(request.days).gt(balance.available)) {
      throw new AppError(
        "VALIDATION",
        `Saldo cuti tidak lagi mencukupi (sisa ${balance.available.toFixed(2)} hari, pengajuan ${d(request.days).toFixed(2)} hari).`,
      );
    }
  }
  const [updated] = await tx
    .update(leaveRequests)
    .set({
      status: input.approve ? "approved" : "rejected",
      decidedBy: input.userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    })
    .where(
      and(
        eq(leaveRequests.companyId, input.companyId),
        eq(leaveRequests.id, input.id),
        eq(leaveRequests.status, "pending"),
      ),
    )
    .returning({ id: leaveRequests.id });
  if (!updated) throw new AppError("INVALID_STATE", "Pengajuan cuti sudah diputuskan.");

  if (input.approve) {
    // Cuti yang disahkan menjadi catatan absensi berstatus leave pada
    // hari-hari kerja rentangnya — tertelusur ke pengajuan ini.
    const [type] = await tx
      .select({ name: leaveTypes.name })
      .from(leaveTypes)
      .where(eq(leaveTypes.id, request.leaveTypeId))
      .limit(1);
    const workDays = await getEmployeeWorkDays(tx, input.companyId, request.employeeId, request.startDate);
    for (const date of enumerateDates(request.startDate, request.endDate)) {
      if (!isWorkday(date, workDays)) continue;
      await recordAttendance(tx, {
        companyId: input.companyId,
        userId: input.userId,
        employeeId: request.employeeId,
        date,
        status: "leave",
        note: `Cuti: ${type?.name ?? ""}`.trim(),
        source: "leave",
        leaveRequestId: request.id,
      });
    }
  }
}

/**
 * Hari cuti TIDAK BERBAYAR yang disetujui dan jatuh pada satu periode
 * payroll — dasar potongan bernama di run (Batch 4). Untuk pengajuan
 * multi-hari, hari dihitung ulang pada irisan rentang × periode
 * menurut pola kerja karyawan.
 */
export async function getApprovedUnpaidLeaveDays(
  tx: Tx,
  companyId: string,
  employeeId: string,
  period: string,
): Promise<Decimal> {
  const { start, end } = periodRange(period);
  const rows = await tx
    .select({
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.days,
    })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(
      and(
        eq(leaveRequests.companyId, companyId),
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.status, "approved"),
        eq(leaveTypes.isPaid, false),
        lte(leaveRequests.startDate, end),
        gte(leaveRequests.endDate, start),
      ),
    );
  let total = d(0);
  for (const row of rows) {
    if (row.startDate === row.endDate) {
      total = total.plus(d(row.days));
      continue;
    }
    const workDays = await getEmployeeWorkDays(tx, companyId, employeeId, row.startDate);
    const overlapStart = row.startDate < start ? start : row.startDate;
    const overlapEnd = row.endDate > end ? end : row.endDate;
    total = total.plus(d(countWorkdays(overlapStart, overlapEnd, workDays)));
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Terminasi & pembayaran akhir (§6G)                                  */
/* ------------------------------------------------------------------ */
