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
  employees,
  overtimeRequests,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  d,
  toDb,
  Decimal,
  type MoneyInput,
} from "@/lib/money";
import { periodRange } from "@/lib/hr";
import {
  computeOvertimePay,
  type OvertimeDayType,
  type OvertimeEntry,
  type StatutoryConfig,
} from "@/lib/payroll-indonesia";

export async function submitOvertimeRequest(
  tx: Tx,
  input: {
    companyId: string;
    userId: string | null;
    employeeId: string;
    date: string;
    dayType: OvertimeDayType;
    hours: MoneyInput;
    reason?: string | null;
  },
): Promise<{ id: string }> {
  const [person] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1)
    .for("update");
  if (!person) throw new AppError("VALIDATION", "Karyawan tidak ditemukan di perusahaan ini.");
  if (!d(input.hours).gt(0)) throw new AppError("VALIDATION", "Jam lembur harus lebih dari nol.");

  // WF-012: Pengajuan lembur memiliki penjaga tumpang tindih per karyawan dan tanggal
  const overlapping = await tx
    .select({ id: overtimeRequests.id })
    .from(overtimeRequests)
    .where(
      and(
        eq(overtimeRequests.companyId, input.companyId),
        eq(overtimeRequests.employeeId, input.employeeId),
        eq(overtimeRequests.date, input.date),
        sql`${overtimeRequests.status} in ('pending', 'approved')`,
      ),
    )
    .limit(1);
  if (overlapping.length > 0) {
    throw new AppError(
      "VALIDATION",
      `Sudah ada pengajuan lembur yang aktif (pending/disetujui) untuk karyawan ini pada tanggal ${input.date}.`,
    );
  }

  const [row] = await tx
    .insert(overtimeRequests)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      date: input.date,
      dayType: input.dayType,
      hours: toDb(input.hours),
      reason: input.reason ?? null,
      createdBy: input.userId,
    })
    .returning({ id: overtimeRequests.id });
  return row;
}

export async function decideOvertimeRequest(
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
    .select({
      id: overtimeRequests.id,
      employeeId: overtimeRequests.employeeId,
      date: overtimeRequests.date,
      status: overtimeRequests.status,
      createdBy: overtimeRequests.createdBy,
    })
    .from(overtimeRequests)
    .where(and(eq(overtimeRequests.companyId, input.companyId), eq(overtimeRequests.id, input.id)))
    .limit(1);

  if (!request) {
    throw new AppError("NOT_FOUND", "Pengajuan lembur tidak ditemukan.");
  }

  // Submission and decisions serialize on the employee row. Re-read the
  // request after obtaining that lock so concurrent decisions cannot use
  // stale state, then lock the request row for its state transition.
  const [person] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, request.employeeId)))
    .limit(1)
    .for("update");
  if (!person) throw new AppError("NOT_FOUND", "Karyawan pengajuan lembur tidak ditemukan.");
  const [lockedRequest] = await tx
    .select({
      id: overtimeRequests.id,
      employeeId: overtimeRequests.employeeId,
      date: overtimeRequests.date,
      status: overtimeRequests.status,
      createdBy: overtimeRequests.createdBy,
    })
    .from(overtimeRequests)
    .where(and(eq(overtimeRequests.companyId, input.companyId), eq(overtimeRequests.id, input.id)))
    .limit(1)
    .for("update");
  if (!lockedRequest) throw new AppError("NOT_FOUND", "Pengajuan lembur tidak ditemukan.");
  if (lockedRequest.status !== "pending") {
    throw new AppError("INVALID_STATE", "Pengajuan lembur sudah diputuskan.");
  }

  // WF-004: Maker-checker (Four-Eyes Principle) — pembuat pengajuan lembur tidak dapat mengesahkan sendiri
  if (
    input.approve &&
    input.userRole &&
    input.userRole !== "owner" &&
    input.userRole !== "admin" &&
    input.userId &&
    lockedRequest.createdBy &&
    lockedRequest.createdBy === input.userId
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Prinsip Maker-Checker (Four-Eyes Principle): Pengajuan lembur tidak dapat disahkan oleh pembuat pengajuan itu sendiri.",
    );
  }

  if (input.approve) {
    const [overlap] = await tx
      .select({ id: overtimeRequests.id })
      .from(overtimeRequests)
      .where(
        and(
          eq(overtimeRequests.companyId, input.companyId),
          eq(overtimeRequests.employeeId, lockedRequest.employeeId),
          eq(overtimeRequests.date, lockedRequest.date),
          sql`${overtimeRequests.status} in ('pending', 'approved')`,
          sql`${overtimeRequests.id} <> ${lockedRequest.id}`,
        ),
      )
      .limit(1);
    if (overlap) {
      throw new AppError(
        "VALIDATION",
        `Ada pengajuan lembur aktif lain untuk karyawan ini pada tanggal ${lockedRequest.date}. Selesaikan pengajuan lain sebelum menyetujui yang ini.`,
      );
    }
  }

  const [row] = await tx
    .update(overtimeRequests)
    .set({
      status: input.approve ? "approved" : "rejected",
      decidedBy: input.userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    })
    .where(
      and(
        eq(overtimeRequests.companyId, input.companyId),
        eq(overtimeRequests.id, input.id),
        eq(overtimeRequests.status, "pending"),
      ),
    )
    .returning({ id: overtimeRequests.id });
  if (!row) {
    throw new AppError("INVALID_STATE", "Pengajuan lembur tidak ditemukan atau sudah diputuskan.");
  }
}

export interface ApprovedOvertime {
  entries: OvertimeEntry[];
  requestIds: string[];
  totalHours: Decimal;
}

/** Lembur yang DISETUJUI pada satu periode — satu entri per hari agar pengali per jam dihitung per hari. */
export async function getApprovedOvertimeForPeriod(
  tx: Tx,
  companyId: string,
  employeeId: string,
  period: string,
): Promise<ApprovedOvertime> {
  const { start, end } = periodRange(period);
  const rows = await tx
    .select()
    .from(overtimeRequests)
    .where(
      and(
        eq(overtimeRequests.companyId, companyId),
        eq(overtimeRequests.employeeId, employeeId),
        eq(overtimeRequests.status, "approved"),
        gte(overtimeRequests.date, start),
        lte(overtimeRequests.date, end),
      ),
    )
    .orderBy(asc(overtimeRequests.date));
  return {
    entries: rows.map((row) => ({
      dayType: row.dayType as OvertimeDayType,
      hours: d(row.hours).toNumber(),
    })),
    requestIds: rows.map((row) => row.id),
    totalHours: rows.reduce((acc, row) => acc.plus(d(row.hours)), d(0)),
  };
}

/** Upah lembur satu karyawan satu periode dari konfigurasi perusahaan. */
export async function computeApprovedOvertimePay(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    period: string;
    monthlyWage: MoneyInput;
    config: StatutoryConfig;
  },
): Promise<{ amount: Decimal; hourlyWage: Decimal; approved: ApprovedOvertime }> {
  const approved = await getApprovedOvertimeForPeriod(tx, input.companyId, input.employeeId, input.period);
  if (approved.entries.length === 0) {
    return { amount: d(0), hourlyWage: d(0), approved };
  }
  const { hourlyWage, total } = computeOvertimePay({
    config: input.config,
    monthlyWage: input.monthlyWage,
    entries: approved.entries,
  });
  return { amount: total, hourlyWage, approved };
}

/* ---------------------------- THR --------------------------------- */
