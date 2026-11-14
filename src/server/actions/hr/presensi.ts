// A-26 Q4 (K-03): pecahan src/server/actions/hr.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";


import { writeAudit } from "@/server/audit";

import {
  importAttendanceCsv,
  recordAttendance,
} from "@/server/hr";

import { revalidateHrPaths } from "./shared";

const attendanceSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD."),
  status: z.enum(["present", "permit", "sick", "leave", "absent"]),
  checkIn: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
  checkOut: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
  note: z.string().trim().max(300).nullish(),
});

const attendanceBatchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD."),
  entries: z.array(
    z.object({
      employeeId: z.string().uuid(),
      status: z.enum(["present", "permit", "sick", "leave", "absent"]),
      checkIn: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
      checkOut: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
      note: z.string().trim().max(300).nullish(),
    }),
  ).min(1).max(500),
});

export async function recordAttendanceAction(input: z.input<typeof attendanceSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(attendanceSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      recordAttendance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        date: data.date,
        status: data.status,
        checkIn: data.checkIn ?? null,
        checkOut: data.checkOut ?? null,
        note: data.note ?? null,
      }),
    );
    revalidateHrPaths();
    // G4 (CRUD-02): halaman absensi tidak tercakup helper bersama
    // (helper hanya hub HR/payroll/akuntansi) — revalidate jalurnya sendiri.
    revalidatePath("/app/akuntansi/hr/absensi");
    return result;
  });
}

/** Catat beberapa karyawan dalam satu transaksi supaya daftar hadir tidak tersimpan setengah. */
export async function recordAttendanceBatchAction(input: z.input<typeof attendanceBatchSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(attendanceBatchSchema, input);
    const employeeIds = data.entries.map((entry) => entry.employeeId);
    if (new Set(employeeIds).size !== employeeIds.length) {
      throw new AppError("VALIDATION", "Karyawan yang sama tidak boleh dicatat dua kali untuk tanggal yang sama.");
    }
    const result = await withCompany(ctx.company.id, async (tx) => {
      for (const entry of data.entries) {
        await recordAttendance(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          employeeId: entry.employeeId,
          date: data.date,
          status: entry.status,
          checkIn: entry.checkIn ?? null,
          checkOut: entry.checkOut ?? null,
          note: entry.note ?? null,
        });
      }
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "attendance.batch_record",
        entityType: "attendance",
        entityId: ctx.company.id,
        after: { date: data.date, employeeCount: data.entries.length },
      });
      return { saved: data.entries.length };
    });
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/hr/absensi");
    return result;
  });
}

export async function importAttendanceCsvAction(input: { text: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({ text: z.string().min(1).max(500_000) }),
      input,
    );
    const result = await withCompany(ctx.company.id, async (tx) => {
      const imported = await importAttendanceCsv(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        text: data.text,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "attendance.import",
        entityType: "attendance",
        entityId: ctx.company.id,
        after: { imported: imported.imported, errors: imported.errors.length },
      });
      return imported;
    });
    revalidateHrPaths();
    // G4 (CRUD-02): halaman absensi tidak tercakup helper bersama
    // (helper hanya hub HR/payroll/akuntansi) — revalidate jalurnya sendiri.
    revalidatePath("/app/akuntansi/hr/absensi");
    return result;
  });
}
