"use server";

/**
 * SIM-2 S2 — Aksi Pengaturan → Payroll Indonesia.
 *
 * Semua perubahan regulasi ditulis sebagai BARIS KONFIGURASI
 * BERTANGGAL EFEKTIF (pola yang sama dengan yang dibaca engine):
 * menyimpan dengan tanggal efektif baru menutup baris lama sehari
 * sebelumnya; menyimpan pada tanggal efektif yang sama memperbarui
 * baris itu. Tidak ada angka regulasi yang diubah lewat kode.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  payrollMinimumWages,
  payrollPtkpStatuses,
  payrollStatutoryParameters,
  payrollStatutoryPrograms,
  payrollStatutorySettings,
  payrollTerBrackets,
} from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { seedPayrollIndonesiaDefaults } from "@/server/payroll-indonesia";
import { requirePermission } from "@/lib/session";
import { guard } from "@/lib/errors";
import { isoDate, moneyString, parseInput } from "@/lib/action-validation";
import { toDb } from "@/lib/money";

function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const percentSchema = (label: string) =>
  z
    .union([z.string(), z.number()])
    .refine((value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    }, `${label} harus antara 0 dan 100`);

export async function saveStatutorySettingsAction(input: { isEnabled: boolean; pph21Enabled: boolean }) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(
      z.object({ isEnabled: z.boolean(), pph21Enabled: z.boolean() }),
      input,
    );
    await withCompany(ctx.company.id, async (tx) => {
      // Perusahaan yang belum punya konfigurasi sama sekali ditanami
      // bawaan lebih dulu (idempoten) agar saklar tidak menyala di atas
      // tabel kosong.
      await seedPayrollIndonesiaDefaults(tx, ctx.company.id);
      await tx
        .insert(payrollStatutorySettings)
        .values({ companyId: ctx.company.id, isEnabled: data.isEnabled, pph21Enabled: data.pph21Enabled })
        .onConflictDoUpdate({
          target: payrollStatutorySettings.companyId,
          set: { isEnabled: data.isEnabled, pph21Enabled: data.pph21Enabled, updatedAt: new Date() },
        });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll_indonesia.settings",
        entityType: "payroll_statutory_settings",
        entityId: ctx.company.id,
        after: { ...data },
      });
    });
    revalidatePath("/app/pengaturan/payroll-indonesia");
    revalidatePath("/app/akuntansi/payroll");
    return data;
  });
}

const programSchema = z.object({
  program: z.enum(["bpjs_kes", "jht", "jkk", "jkm", "jp", "jkp"]),
  riskClass: z.enum(["very_low", "low", "medium", "high", "very_high"]).nullish(),
  isEnabled: z.boolean(),
  employerRate: percentSchema("Tarif perusahaan"),
  employeeRate: percentSchema("Tarif pekerja"),
  wageCap: moneyString("Batas upah").nullish(),
  wageFloor: moneyString("Batas bawah upah").nullish(),
  effectiveFrom: isoDate("Tanggal efektif"),
});

export async function saveStatutoryProgramAction(input: z.input<typeof programSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(programSchema, input);
    const riskClass = data.program === "jkk" ? (data.riskClass ?? "very_low") : null;
    await withCompany(ctx.company.id, async (tx) => {
      await seedPayrollIndonesiaDefaults(tx, ctx.company.id);
      const scope = and(
        eq(payrollStatutoryPrograms.companyId, ctx.company.id),
        eq(payrollStatutoryPrograms.program, data.program),
        riskClass === null
          ? isNull(payrollStatutoryPrograms.riskClass)
          : eq(payrollStatutoryPrograms.riskClass, riskClass),
      );
      const values = {
        isEnabled: data.isEnabled,
        employerRate: toDb(data.employerRate),
        employeeRate: toDb(data.employeeRate),
        wageCap: data.wageCap ? toDb(data.wageCap) : null,
        wageFloor: data.wageFloor ? toDb(data.wageFloor) : null,
      };
      const [sameDay] = await tx
        .select({ id: payrollStatutoryPrograms.id })
        .from(payrollStatutoryPrograms)
        .where(and(scope, eq(payrollStatutoryPrograms.effectiveFrom, data.effectiveFrom)))
        .limit(1);
      if (sameDay) {
        await tx
          .update(payrollStatutoryPrograms)
          .set(values)
          .where(eq(payrollStatutoryPrograms.id, sameDay.id));
      } else {
        // Tutup baris yang sedang berlaku sehari sebelum tanggal
        // efektif baru, lalu sisipkan baris baru (effectiveTo baris
        // baru diwarisi dari baris yang ditutup bila ada).
        const candidates = await tx
          .select()
          .from(payrollStatutoryPrograms)
          .where(and(scope, lt(payrollStatutoryPrograms.effectiveFrom, data.effectiveFrom)));
        const latest = candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
        const inheritedTo = latest?.effectiveTo ?? null;
        if (latest && (latest.effectiveTo === null || latest.effectiveTo >= data.effectiveFrom)) {
          await tx
            .update(payrollStatutoryPrograms)
            .set({ effectiveTo: dayBefore(data.effectiveFrom) })
            .where(eq(payrollStatutoryPrograms.id, latest.id));
        }
        await tx.insert(payrollStatutoryPrograms).values({
          companyId: ctx.company.id,
          program: data.program,
          riskClass,
          ...values,
          addsToTaxGross: latest?.addsToTaxGross ?? false,
          employeeDeductibleAnnual: latest?.employeeDeductibleAnnual ?? false,
          countsAsEmployerCost: latest?.countsAsEmployerCost ?? true,
          fundingNote: latest?.fundingNote ?? null,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: inheritedTo && inheritedTo >= data.effectiveFrom ? inheritedTo : null,
        });
      }
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll_indonesia.program",
        entityType: "payroll_statutory_program",
        entityId: `${data.program}|${riskClass ?? "-"}`,
        after: { ...data, riskClass },
      });
    });
    revalidatePath("/app/pengaturan/payroll-indonesia");
    return { program: data.program, riskClass };
  });
}

const ptkpSchema = z.object({
  code: z.string().trim().min(3).max(6),
  annualAmount: moneyString("PTKP setahun"),
  terCategory: z.enum(["A", "B", "C"]),
  effectiveFrom: isoDate("Tanggal efektif"),
});

export async function savePtkpStatusAction(input: z.input<typeof ptkpSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(ptkpSchema, input);
    await withCompany(ctx.company.id, async (tx) => {
      await seedPayrollIndonesiaDefaults(tx, ctx.company.id);
      const scope = and(
        eq(payrollPtkpStatuses.companyId, ctx.company.id),
        eq(payrollPtkpStatuses.code, data.code),
      );
      const values = { annualAmount: toDb(data.annualAmount), terCategory: data.terCategory };
      const [sameDay] = await tx
        .select({ id: payrollPtkpStatuses.id })
        .from(payrollPtkpStatuses)
        .where(and(scope, eq(payrollPtkpStatuses.effectiveFrom, data.effectiveFrom)))
        .limit(1);
      if (sameDay) {
        await tx.update(payrollPtkpStatuses).set(values).where(eq(payrollPtkpStatuses.id, sameDay.id));
      } else {
        const candidates = await tx
          .select()
          .from(payrollPtkpStatuses)
          .where(and(scope, lt(payrollPtkpStatuses.effectiveFrom, data.effectiveFrom)));
        const latest = candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
        if (latest && (latest.effectiveTo === null || latest.effectiveTo >= data.effectiveFrom)) {
          await tx
            .update(payrollPtkpStatuses)
            .set({ effectiveTo: dayBefore(data.effectiveFrom) })
            .where(eq(payrollPtkpStatuses.id, latest.id));
        }
        await tx.insert(payrollPtkpStatuses).values({
          companyId: ctx.company.id,
          code: data.code,
          ...values,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: latest?.effectiveTo ?? null,
        });
      }
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll_indonesia.ptkp",
        entityType: "payroll_ptkp_status",
        entityId: data.code,
        after: { ...data },
      });
    });
    revalidatePath("/app/pengaturan/payroll-indonesia");
    return { code: data.code };
  });
}

const parameterSchema = z.object({
  key: z.enum([
    "biaya_jabatan_rate",
    "biaya_jabatan_cap_year",
    "biaya_jabatan_cap_month",
    "non_npwp_surcharge_rate",
    "thr_min_months",
    "thr_full_months",
    "overtime_hourly_divisor",
  ]),
  value: moneyString("Nilai parameter"),
  effectiveFrom: isoDate("Tanggal efektif"),
});

export async function saveStatutoryParameterAction(input: z.input<typeof parameterSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(parameterSchema, input);
    await withCompany(ctx.company.id, async (tx) => {
      await seedPayrollIndonesiaDefaults(tx, ctx.company.id);
      const scope = and(
        eq(payrollStatutoryParameters.companyId, ctx.company.id),
        eq(payrollStatutoryParameters.key, data.key),
      );
      const [sameDay] = await tx
        .select({ id: payrollStatutoryParameters.id })
        .from(payrollStatutoryParameters)
        .where(and(scope, eq(payrollStatutoryParameters.effectiveFrom, data.effectiveFrom)))
        .limit(1);
      if (sameDay) {
        await tx
          .update(payrollStatutoryParameters)
          .set({ value: toDb(data.value) })
          .where(eq(payrollStatutoryParameters.id, sameDay.id));
      } else {
        const candidates = await tx
          .select()
          .from(payrollStatutoryParameters)
          .where(and(scope, lt(payrollStatutoryParameters.effectiveFrom, data.effectiveFrom)));
        const latest = candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
        if (latest && (latest.effectiveTo === null || latest.effectiveTo >= data.effectiveFrom)) {
          await tx
            .update(payrollStatutoryParameters)
            .set({ effectiveTo: dayBefore(data.effectiveFrom) })
            .where(eq(payrollStatutoryParameters.id, latest.id));
        }
        await tx.insert(payrollStatutoryParameters).values({
          companyId: ctx.company.id,
          key: data.key,
          value: toDb(data.value),
          effectiveFrom: data.effectiveFrom,
          effectiveTo: latest?.effectiveTo ?? null,
        });
      }
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll_indonesia.parameter",
        entityType: "payroll_statutory_parameter",
        entityId: data.key,
        after: { ...data },
      });
    });
    revalidatePath("/app/pengaturan/payroll-indonesia");
    return { key: data.key };
  });
}

const minimumWageSchema = z.object({
  regionCode: z.string().trim().min(2).max(20),
  regionName: z.string().trim().min(2).max(80),
  year: z.number().int().min(2000).max(2100),
  amount: moneyString("Upah minimum"),
  decreeRef: z.string().trim().max(120).nullish(),
});

export async function saveMinimumWageAction(input: z.input<typeof minimumWageSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(minimumWageSchema, input);
    await withCompany(ctx.company.id, async (tx) => {
      await seedPayrollIndonesiaDefaults(tx, ctx.company.id);
      await tx
        .insert(payrollMinimumWages)
        .values({
          companyId: ctx.company.id,
          regionCode: data.regionCode,
          regionName: data.regionName,
          year: data.year,
          amount: toDb(data.amount),
          decreeRef: data.decreeRef || null,
        })
        .onConflictDoUpdate({
          target: [
            payrollMinimumWages.companyId,
            payrollMinimumWages.regionCode,
            payrollMinimumWages.year,
          ],
          set: { regionName: data.regionName, amount: toDb(data.amount), decreeRef: data.decreeRef || null },
        });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll_indonesia.minimum_wage",
        entityType: "payroll_minimum_wage",
        entityId: `${data.regionCode}|${data.year}`,
        after: { ...data },
      });
    });
    revalidatePath("/app/pengaturan/payroll-indonesia");
    return { regionCode: data.regionCode, year: data.year };
  });
}

const terRateSchema = z.object({
  category: z.enum(["A", "B", "C"]),
  lowerBound: moneyString("Batas bawah lapisan"),
  rate: percentSchema("Tarif TER"),
  effectiveFrom: isoDate("Tanggal efektif"),
});

export async function saveTerBracketRateAction(input: z.input<typeof terRateSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(terRateSchema, input);
    await withCompany(ctx.company.id, async (tx) => {
      await seedPayrollIndonesiaDefaults(tx, ctx.company.id);
      const scope = and(
        eq(payrollTerBrackets.companyId, ctx.company.id),
        eq(payrollTerBrackets.category, data.category),
        eq(payrollTerBrackets.lowerBound, toDb(data.lowerBound)),
      );
      const [sameDay] = await tx
        .select({ id: payrollTerBrackets.id })
        .from(payrollTerBrackets)
        .where(and(scope, eq(payrollTerBrackets.effectiveFrom, data.effectiveFrom)))
        .limit(1);
      if (sameDay) {
        await tx
          .update(payrollTerBrackets)
          .set({ rate: toDb(data.rate) })
          .where(eq(payrollTerBrackets.id, sameDay.id));
      } else {
        const candidates = await tx
          .select()
          .from(payrollTerBrackets)
          .where(and(scope, lt(payrollTerBrackets.effectiveFrom, data.effectiveFrom)));
        const latest = candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
        if (!latest) {
          throw new Error("Lapisan TER tidak ditemukan untuk batas bawah tersebut.");
        }
        if (latest.effectiveTo === null || latest.effectiveTo >= data.effectiveFrom) {
          await tx
            .update(payrollTerBrackets)
            .set({ effectiveTo: dayBefore(data.effectiveFrom) })
            .where(eq(payrollTerBrackets.id, latest.id));
        }
        await tx.insert(payrollTerBrackets).values({
          companyId: ctx.company.id,
          category: data.category,
          lowerBound: latest.lowerBound,
          upperBound: latest.upperBound,
          rate: toDb(data.rate),
          effectiveFrom: data.effectiveFrom,
          effectiveTo: latest.effectiveTo,
        });
      }
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll_indonesia.ter_rate",
        entityType: "payroll_ter_bracket",
        entityId: `${data.category}|${toDb(data.lowerBound)}`,
        after: { ...data },
      });
    });
    revalidatePath("/app/pengaturan/payroll-indonesia");
    return { category: data.category };
  });
}
