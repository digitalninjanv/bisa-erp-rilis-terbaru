// A-26 Q4 (K-03): pecahan src/server/actions/hr.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  branches,
  departments,
  employeeStatutoryEnrollments,
  employees,
  jobPositions,
} from "@/db/schema";
import {
  AppError,
  guard,
} from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import { writeAudit } from "@/server/audit";
import {
  d,
  toDb,
} from "@/lib/money";

import {
  buildEmployeeHistoryDiff,
  processFinalPay,
  recordEmployeeHistory,
} from "@/server/hr";

import { revalidateHrPaths } from "./shared";

/* ------------------------------------------------------------------ */
/* Terminasi & pembayaran akhir (§6G)                                  */
/* ------------------------------------------------------------------ */

const terminateSchema = z.object({
  employeeId: z.string().uuid(),
  terminationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal berhenti harus YYYY-MM-DD."),
  terminationReason: z.string().trim().min(1).max(60),
  terminationNote: z.string().trim().max(500).nullish(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Periode harus YYYY-MM.")
    .optional(),
  acknowledgeShortfall: z.boolean().optional(),
});

export async function terminateEmployeeAction(input: z.input<typeof terminateSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(terminateSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      processFinalPay(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        period: data.period ?? data.terminationDate.slice(0, 7),
        terminateNow: true,
        terminationDate: data.terminationDate,
        terminationReason: data.terminationReason,
        terminationNote: data.terminationNote ?? null,
        acknowledgeShortfall: data.acknowledgeShortfall ?? false,
      }),
    );
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/payroll");
    return result;
  });
}

const finalPaySchema = z.object({
  employeeId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Periode harus YYYY-MM."),
  acknowledgeShortfall: z.boolean().optional(),
});

/** Membuat ulang pembayaran akhir karyawan yang sudah berhenti (mis. sesudah final run lama di-void). */
export async function createFinalPayAction(input: z.input<typeof finalPaySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(finalPaySchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      processFinalPay(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        employeeId: data.employeeId,
        period: data.period,
        terminateNow: false,
        acknowledgeShortfall: data.acknowledgeShortfall ?? false,
      }),
    );
    revalidateHrPaths();
    revalidatePath("/app/akuntansi/payroll");
    return result;
  });
}

/* ------------------------------------------------------------------ */
/* A-24 T2 (CB-A2): aksi karyawan & payroll — dipindah mekanis dari    */
/* src/server/actions/accounting.ts ke berkas aksi milik HR ini.       */
/* Perilaku & validasi identik dengan sebelum pemindahan. Gerbang      */
/* modulnya TIDAK lagi "akuntansi": keputusan Pemimpin 2026-11-05      */
/* (T2 susulan) menyelaraskan requirePermissionInModule ke "hr" di     */
/* seluruh aksi payroll — saklar perusahaan HR yang mengatur aksi      */
/* payroll, sesuai makna HR sebagai modul yang berdiri sendiri.        */
/* Seluruh pemanggil (komponen & test) kini mengimpor dari berkas ini.  */
/* ------------------------------------------------------------------ */

/** Nominal gaji tidak boleh negatif (AK-P2-10). */
const nonNegativeAmount = (label: string) =>
  z.union([z.string(), z.number()]).refine(
    (value) => {
      try {
        return d(value).isFinite() && d(value).gte(0);
      } catch {
        return false;
      }
    },
    { message: `${label} tidak boleh negatif.` },
  );

const employeeSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(40),
  name: z.string().min(2).max(160),
  position: z.string().max(80).optional(),
  baseSalary: nonNegativeAmount("Gaji pokok"),
  allowances: nonNegativeAmount("Tunjangan").optional(),
  deductions: nonNegativeAmount("Potongan").optional(),
  joinedAt: z.string().optional(),
  isActive: z.boolean().optional(),
  // SIM-2 S2: field terstruktur Payroll Indonesia — semuanya opsional;
  // pemanggil lama (dan payroll generik) tidak terpengaruh.
  nik: z.string().trim().max(20).optional(),
  npwp: z.string().trim().max(30).optional(),
  ptkpStatus: z.string().trim().max(6).optional(),
  birthDate: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
  contractType: z.enum(["pkwtt", "pkwt", "harian", "magang"]).optional(),
  jkkRiskClass: z.enum(["very_low", "low", "medium", "high", "very_high"]).optional(),
  workRegionCode: z.string().trim().max(20).optional(),
  statutoryEnrollments: z
    .record(z.enum(["bpjs_kes", "jht", "jkk", "jkm", "jp", "jkp"]), z.boolean())
    .optional(),
  // SIM-2 S7B-1 (§6A): struktur organisasi & kontrak — opsional dan
  // hanya ditulis bila dikirim (null eksplisit = dikosongkan), pola
  // yang sama dengan field S2 di atas.
  departmentId: z.string().uuid().nullish(),
  positionId: z.string().uuid().nullish(),
  managerEmployeeId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
  contractStart: z.string().nullish(),
  contractEnd: z.string().nullish(),
});

export async function saveEmployeeAction(input: z.input<typeof employeeSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(employeeSchema, input);
    const values = {
      code: data.code,
      name: data.name,
      position: data.position,
      baseSalary: toDb(data.baseSalary),
      allowances: toDb(data.allowances ?? 0),
      deductions: toDb(data.deductions ?? 0),
      joinedAt: data.joinedAt || null,
      isActive: data.isActive ?? true,
      // Field S2 hanya ditulis bila pemanggil memang mengirimnya —
      // pemanggil lama tidak boleh menghapus data statutory yang sudah
      // terisi hanya karena formulirnya belum mengenal field ini.
      ...(data.nik !== undefined ? { nik: data.nik || null } : {}),
      ...(data.npwp !== undefined ? { npwp: data.npwp || null } : {}),
      ...(data.ptkpStatus !== undefined ? { ptkpStatus: data.ptkpStatus || null } : {}),
      ...(data.birthDate !== undefined ? { birthDate: data.birthDate || null } : {}),
      ...(data.gender !== undefined ? { gender: data.gender } : {}),
      ...(data.contractType !== undefined ? { contractType: data.contractType } : {}),
      ...(data.jkkRiskClass !== undefined ? { jkkRiskClass: data.jkkRiskClass } : {}),
      ...(data.workRegionCode !== undefined ? { workRegionCode: data.workRegionCode || null } : {}),
    };
    const result = await withCompany(ctx.company.id, async (tx) => {
      // MD-013 & MD-017: Validasi keunikan NIK dan NPWP per perusahaan
      if (data.nik && data.nik.trim()) {
        const cleanNik = data.nik.trim();
        const [dupNik] = await tx
          .select({ id: employees.id, name: employees.name, code: employees.code })
          .from(employees)
          .where(
            and(
              eq(employees.companyId, ctx.company.id),
              eq(employees.nik, cleanNik),
              data.id ? ne(employees.id, data.id) : undefined,
            ),
          )
          .limit(1);
        if (dupNik) {
          throw new AppError("CONFLICT", `NIK ${cleanNik} sudah terdaftar untuk karyawan ${dupNik.name} (${dupNik.code}).`);
        }
      }
      if (data.npwp && data.npwp.trim()) {
        const cleanNpwp = data.npwp.trim();
        const [dupNpwp] = await tx
          .select({ id: employees.id, name: employees.name, code: employees.code })
          .from(employees)
          .where(
            and(
              eq(employees.companyId, ctx.company.id),
              eq(employees.npwp, cleanNpwp),
              data.id ? ne(employees.id, data.id) : undefined,
            ),
          )
          .limit(1);
        if (dupNpwp) {
          throw new AppError("CONFLICT", `NPWP ${cleanNpwp} sudah terdaftar untuk karyawan ${dupNpwp.name} (${dupNpwp.code}).`);
        }
      }
      // SIM-2 S7B-1 (§6A): referensi organisasi divalidasi berada di
      // perusahaan yang sama; jabatan master menyinkronkan teks jabatan
      // bebas agar tampilan lama (daftar payroll, slip) tetap utuh.
      const orgValues: Record<string, unknown> = {};
      if (data.departmentId !== undefined) {
        if (data.departmentId !== null) {
          const [dept] = await tx
            .select({ id: departments.id })
            .from(departments)
            .where(and(eq(departments.companyId, ctx.company.id), eq(departments.id, data.departmentId)))
            .limit(1);
          if (!dept) throw new AppError("VALIDATION", "Departemen tidak ditemukan di perusahaan ini.");
        }
        orgValues.departmentId = data.departmentId;
      }
      if (data.positionId !== undefined) {
        if (data.positionId !== null) {
          const [pos] = await tx
            .select({ id: jobPositions.id, name: jobPositions.name })
            .from(jobPositions)
            .where(and(eq(jobPositions.companyId, ctx.company.id), eq(jobPositions.id, data.positionId)))
            .limit(1);
          if (!pos) throw new AppError("VALIDATION", "Jabatan tidak ditemukan di perusahaan ini.");
          orgValues.position = pos.name;
        }
        orgValues.positionId = data.positionId;
      }
      if (data.managerEmployeeId !== undefined) {
        if (data.managerEmployeeId !== null) {
          if (data.id && data.managerEmployeeId === data.id) {
            throw new AppError("VALIDATION", "Karyawan tidak dapat menjadi atasan bagi dirinya sendiri.");
          }
          const [mgr] = await tx
            .select({ id: employees.id })
            .from(employees)
            .where(and(eq(employees.companyId, ctx.company.id), eq(employees.id, data.managerEmployeeId)))
            .limit(1);
          if (!mgr) throw new AppError("VALIDATION", "Atasan tidak ditemukan di perusahaan ini.");
        }
        orgValues.managerEmployeeId = data.managerEmployeeId;
      }
      if (data.branchId !== undefined) {
        if (data.branchId !== null) {
          const [branch] = await tx
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.companyId, ctx.company.id), eq(branches.id, data.branchId)))
            .limit(1);
          if (!branch) throw new AppError("VALIDATION", "Cabang tidak ditemukan di perusahaan ini.");
        }
        orgValues.branchId = data.branchId;
      }
      if (data.contractStart !== undefined) orgValues.contractStart = data.contractStart || null;
      if (data.contractEnd !== undefined) orgValues.contractEnd = data.contractEnd || null;
      const allValues = { ...values, ...orgValues };

      let row: { id: string } | undefined;
      if (data.id) {
        const [before] = await tx
          .select()
          .from(employees)
          .where(and(eq(employees.companyId, ctx.company.id), eq(employees.id, data.id)))
          .limit(1);
        // AK-P2-10: update yang tidak mengenai baris mana pun bukan sukses.
        if (!before) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");

        // MD-020: Jangan mengaktifkan kembali karyawan jika isActive tidak dikirim
        const finalValues = {
          ...allValues,
          isActive: data.isActive !== undefined ? data.isActive : before.isActive,
        };

        [row] = await tx
          .update(employees)
          .set(finalValues)
          .where(and(eq(employees.companyId, ctx.company.id), eq(employees.id, data.id)))
          .returning({ id: employees.id });
        if (!row) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");
        // SIM-2 S7B-1 (§6A): perubahan jabatan/departemen/gaji/kontrak/
        // cabang/atasan/status tercatat sebagai riwayat before/after —
        // menimpa master tidak lagi menghapus jejak perubahan.
        const after = { ...before, ...finalValues } as typeof before;
        const drafts = await buildEmployeeHistoryDiff(tx, ctx.company.id, before, after);
        await recordEmployeeHistory(tx, {
          companyId: ctx.company.id,
          employeeId: data.id,
          userId: ctx.user.id,
          drafts,
        });

        // MD-017 & MD-018: Audit log perubahan karyawan
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "employee.update",
          entityType: "employee",
          entityId: data.id,
          before: { code: before.code, name: before.name, isActive: before.isActive },
          after: { code: finalValues.code, name: finalValues.name, isActive: finalValues.isActive },
        });
      } else {
        const createValues = {
          ...allValues,
          isActive: data.isActive ?? true,
        };
        [row] = await tx
          .insert(employees)
          .values({ companyId: ctx.company.id, ...createValues })
          .returning({ id: employees.id });

        // MD-017 & MD-018: Audit log pembuatan karyawan
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "employee.create",
          entityType: "employee",
          entityId: row.id,
          after: { code: createValues.code, name: createValues.name, position: createValues.position },
        });
      }
      // Kepesertaan program statutory per karyawan: hanya baris
      // pengecualian yang perlu disimpan, tetapi formulir mengirim
      // keadaan lengkap — simpan apa adanya (upsert per program).
      if (data.statutoryEnrollments) {
        for (const [program, isEnrolled] of Object.entries(data.statutoryEnrollments)) {
          await tx
            .insert(employeeStatutoryEnrollments)
            .values({ companyId: ctx.company.id, employeeId: row.id, program, isEnrolled })
            .onConflictDoUpdate({
              target: [
                employeeStatutoryEnrollments.companyId,
                employeeStatutoryEnrollments.employeeId,
                employeeStatutoryEnrollments.program,
              ],
              set: { isEnrolled },
            });
        }
      }
      return row;
    });
    revalidatePath("/app/akuntansi/payroll");
    return result;
  });
}
