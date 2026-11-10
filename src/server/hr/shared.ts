// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  employees,
  payrollOvertimeRules,
  payrollStatutoryParameters,
} from "@/db/schema";
import {
  type OvertimeDayType,
  type StatutoryConfig,
} from "@/lib/payroll-indonesia";
import {
  loadStatutoryConfig,
  seedPayrollIndonesiaDefaults,
} from "@/server/payroll-indonesia";

export type EmployeeRow = typeof employees.$inferSelect;

/* ------------------------------------------------------------------ */
/* Parameter HR per perusahaan                                         */
/* ------------------------------------------------------------------ */

/**
 * Konfigurasi pengali lembur & parameter THR untuk perhitungan HR.
 * Berbeda dari loadStatutoryConfig (yang mengembalikan null saat
 * engine PPh/BPJS nonaktif): lembur/THR punya saklarnya sendiri, jadi
 * konfigurasi dibaca langsung dari tabel bertanggal efektif — baris
 * bawaan ditanam dulu bila perusahaan belum memilikinya sama sekali.
 */
export async function loadHrPayrollConfig(
  tx: Tx,
  companyId: string,
  asOfDate: string,
): Promise<StatutoryConfig> {
  const statutory = await loadStatutoryConfig(tx, companyId, asOfDate);
  if (statutory) return statutory;
  await seedPayrollIndonesiaDefaults(tx, companyId);
  const [parameterRows, overtimeRows] = await Promise.all([
    tx
      .select()
      .from(payrollStatutoryParameters)
      .where(eq(payrollStatutoryParameters.companyId, companyId)),
    tx
      .select()
      .from(payrollOvertimeRules)
      .where(eq(payrollOvertimeRules.companyId, companyId)),
  ]);
  const parameters: Record<string, string> = {};
  const latestParam = new Map<string, { from: string; value: string }>();
  for (const row of parameterRows) {
    if (row.effectiveFrom > asOfDate) continue;
    if (row.effectiveTo !== null && row.effectiveTo < asOfDate) continue;
    const current = latestParam.get(row.key);
    if (!current || row.effectiveFrom > current.from) {
      latestParam.set(row.key, { from: row.effectiveFrom, value: row.value });
    }
  }
  for (const [key, entry] of latestParam) parameters[key] = entry.value;
  return {
    pph21Enabled: false,
    ptkp: [],
    terBrackets: { A: [], B: [], C: [] },
    taxBrackets: [],
    programs: [],
    parameters,
    overtimeRules: overtimeRows
      .filter(
        (row) =>
          row.effectiveFrom <= asOfDate && (row.effectiveTo === null || row.effectiveTo >= asOfDate),
      )
      .map((row) => ({
        dayType: row.dayType as OvertimeDayType,
        hourFrom: row.hourFrom,
        hourTo: row.hourTo,
        multiplier: row.multiplier,
      })),
  };
}
