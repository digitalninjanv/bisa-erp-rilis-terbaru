// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  and,
  eq,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  departments,
  jobPositions,
} from "@/db/schema";
import {
  AppError,
  isUniqueViolation,
} from "@/lib/errors";

export async function saveDepartment(
  tx: Tx,
  input: { companyId: string; id?: string; code: string; name: string },
): Promise<{ id: string }> {
  try {
    if (input.id) {
      const [row] = await tx
        .update(departments)
        .set({ code: input.code, name: input.name })
        .where(and(eq(departments.companyId, input.companyId), eq(departments.id, input.id)))
        .returning({ id: departments.id });
      if (!row) throw new AppError("NOT_FOUND", "Departemen tidak ditemukan.");
      return row;
    }
    const [row] = await tx
      .insert(departments)
      .values({ companyId: input.companyId, code: input.code, name: input.name })
      .returning({ id: departments.id });
    return row;
  } catch (error) {
    if (isUniqueViolation(error, "departments_company_code_uq")) {
      throw new AppError("CONFLICT", `Kode departemen ${input.code} sudah dipakai.`);
    }
    throw error;
  }
}

export async function setDepartmentActive(
  tx: Tx,
  input: { companyId: string; id: string; isActive: boolean },
): Promise<void> {
  const [row] = await tx
    .update(departments)
    .set({ isActive: input.isActive })
    .where(and(eq(departments.companyId, input.companyId), eq(departments.id, input.id)))
    .returning({ id: departments.id });
  if (!row) throw new AppError("NOT_FOUND", "Departemen tidak ditemukan.");
}

export async function saveJobPosition(
  tx: Tx,
  input: { companyId: string; id?: string; code: string; name: string },
): Promise<{ id: string }> {
  try {
    if (input.id) {
      const [row] = await tx
        .update(jobPositions)
        .set({ code: input.code, name: input.name })
        .where(and(eq(jobPositions.companyId, input.companyId), eq(jobPositions.id, input.id)))
        .returning({ id: jobPositions.id });
      if (!row) throw new AppError("NOT_FOUND", "Jabatan tidak ditemukan.");
      return row;
    }
    const [row] = await tx
      .insert(jobPositions)
      .values({ companyId: input.companyId, code: input.code, name: input.name })
      .returning({ id: jobPositions.id });
    return row;
  } catch (error) {
    if (isUniqueViolation(error, "job_positions_company_code_uq")) {
      throw new AppError("CONFLICT", `Kode jabatan ${input.code} sudah dipakai.`);
    }
    throw error;
  }
}

export async function setJobPositionActive(
  tx: Tx,
  input: { companyId: string; id: string; isActive: boolean },
): Promise<void> {
  const [row] = await tx
    .update(jobPositions)
    .set({ isActive: input.isActive })
    .where(and(eq(jobPositions.companyId, input.companyId), eq(jobPositions.id, input.id)))
    .returning({ id: jobPositions.id });
  if (!row) throw new AppError("NOT_FOUND", "Jabatan tidak ditemukan.");
}

/* ------------------------------------------------------------------ */
/* Riwayat perubahan karyawan (§6A)                                    */
/* ------------------------------------------------------------------ */
