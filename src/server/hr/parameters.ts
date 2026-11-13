// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  asc,
  eq,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { hrParameters } from "@/db/schema";
import { todayISO } from "@/lib/format";

export interface TerminationReason {
  code: string;
  label: string;
}

/** Bawaan awal alasan berhenti — dapat diubah admin lewat konfigurasi. */
export const DEFAULT_TERMINATION_REASONS: TerminationReason[] = [
  { code: "resign", label: "Mengundurkan diri" },
  { code: "phk", label: "PHK" },
  { code: "pensiun", label: "Pensiun" },
  { code: "kontrak_selesai", label: "Kontrak berakhir" },
  { code: "meninggal", label: "Meninggal dunia" },
  { code: "lainnya", label: "Lainnya" },
];

export const HR_PARAMETER_DEFAULTS: Array<{ key: string; value: string }> = [
  // Hari kerja per bulan untuk tarif harian (cuti tak berbayar, dll.) —
  // kebijakan perusahaan, bukan angka regulasi.
  { key: "working_days_per_month", value: "22" },
  // Pola hari kerja bawaan (weekday 0=Minggu…6=Sabtu) untuk karyawan
  // tanpa penugasan shift — dipakai menghitung hari cuti.
  { key: "default_work_days", value: "1,2,3,4,5" },
  // Saklar integrasi ke payroll (bawaan nonaktif = perilaku lama persis).
  { key: "overtime_payroll_enabled", value: "false" },
  { key: "unpaid_leave_payroll_enabled", value: "false" },
  // Sisa cuti tahun lalu boleh terbawa ke tahun berjalan.
  { key: "leave_carry_over_enabled", value: "false" },
  // Ambang peringatan kontrak PKWT akan berakhir (§6A acceptance).
  { key: "contract_expiry_warning_days", value: "30" },
  { key: "termination_reasons", value: JSON.stringify(DEFAULT_TERMINATION_REASONS) },
];

/** Menanam parameter bawaan untuk perusahaan yang belum memilikinya (idempoten). */
export async function seedHrDefaults(tx: Tx, companyId: string): Promise<void> {
  const existing = await tx
    .select({ id: hrParameters.id })
    .from(hrParameters)
    .where(eq(hrParameters.companyId, companyId))
    .limit(1);
  if (existing.length > 0) return;
  await tx.insert(hrParameters).values(
    HR_PARAMETER_DEFAULTS.map((row) => ({
      companyId,
      key: row.key,
      value: row.value,
      effectiveFrom: "2000-01-01",
    })),
  ).onConflictDoNothing({ target: [hrParameters.companyId, hrParameters.key, hrParameters.effectiveFrom] });
}

/** Membaca parameter HR yang efektif pada `asOf` (bawaan ditanam dulu bila kosong). */
export async function getHrParameters(
  tx: Tx,
  companyId: string,
  asOf: string = todayISO(),
): Promise<Record<string, string>> {
  await seedHrDefaults(tx, companyId);
  const rows = await tx
    .select()
    .from(hrParameters)
    .where(eq(hrParameters.companyId, companyId))
    .orderBy(asc(hrParameters.effectiveFrom));
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.effectiveFrom > asOf) continue;
    if (row.effectiveTo !== null && row.effectiveTo < asOf) continue;
    result[row.key] = row.value;
  }
  return result;
}

export function hrParamBool(params: Record<string, string>, key: string): boolean {
  return params[key] === "true";
}

export function hrParamNumber(params: Record<string, string>, key: string, fallback: number): number {
  const raw = params[key];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function getTerminationReasons(params: Record<string, string>): TerminationReason[] {
  const raw = params.termination_reasons;
  if (!raw) return DEFAULT_TERMINATION_REASONS;
  try {
    const parsed = JSON.parse(raw) as TerminationReason[];
    if (Array.isArray(parsed) && parsed.every((row) => row.code && row.label)) return parsed;
  } catch {
    /* konfigurasi rusak → bawaan */
  }
  return DEFAULT_TERMINATION_REASONS;
}

/** Menulis nilai parameter baru sebagai baris efektif mulai hari ini (riwayat konfigurasi terjaga). */
export async function setHrParameter(
  tx: Tx,
  companyId: string,
  key: string,
  value: string,
  effectiveFrom: string = todayISO(),
): Promise<void> {
  await seedHrDefaults(tx, companyId);
  await tx
    .insert(hrParameters)
    .values({ companyId, key, value, effectiveFrom })
    .onConflictDoUpdate({
      target: [hrParameters.companyId, hrParameters.key, hrParameters.effectiveFrom],
      set: { value },
    });
}

/* ------------------------------------------------------------------ */
/* Master departemen & jabatan                                         */
/* ------------------------------------------------------------------ */
