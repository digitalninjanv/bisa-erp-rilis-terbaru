/**
 * SIM-2 S2 — Engine Payroll Indonesia (logika murni, tanpa DB).
 *
 * Engine TIDAK mengandung satu pun angka regulasi: tarif TER, tarif
 * Pasal 17, PTKP, tarif/batas BPJS, biaya jabatan, pengali lembur, dan
 * aturan THR semuanya tiba sebagai `StatutoryConfig` yang dibaca dari
 * tabel konfigurasi per perusahaan (lihat
 * `src/server/payroll-indonesia.ts`). Mengubah konfigurasi mengubah
 * hasil — dibuktikan test "ganti tarif TER di konfigurasi".
 *
 * Seluruh uang memakai Decimal (`src/lib/money.ts`); hasil iuran &
 * pajak dibulatkan ke rupiah penuh (praktik pemotongan PPh 21/BPJS).
 */
import { Decimal, d, type MoneyInput } from "@/lib/money";
import type {
  OvertimeDayType,
  StatutoryProgramCode,
  TerCategoryCode,
} from "@/lib/payroll-indonesia-defaults";

export type { OvertimeDayType, StatutoryProgramCode, TerCategoryCode };

export interface BracketRow {
  lower: MoneyInput;
  upper: MoneyInput | null;
  rate: MoneyInput; // persen
}

export interface PtkpRow {
  code: string;
  annualAmount: MoneyInput;
  terCategory: TerCategoryCode;
}

export interface ProgramRow {
  program: StatutoryProgramCode;
  riskClass: string | null;
  isEnabled: boolean;
  employerRate: MoneyInput; // persen
  employeeRate: MoneyInput; // persen
  wageCap: MoneyInput | null;
  wageFloor: MoneyInput | null;
  addsToTaxGross: boolean;
  employeeDeductibleAnnual: boolean;
  countsAsEmployerCost: boolean;
  fundingNote: string | null;
}

export interface OvertimeRuleRow {
  dayType: OvertimeDayType;
  hourFrom: number;
  hourTo: number | null;
  multiplier: MoneyInput;
}

export interface StatutoryConfig {
  pph21Enabled: boolean;
  ptkp: PtkpRow[];
  terBrackets: Record<TerCategoryCode, BracketRow[]>;
  taxBrackets: BracketRow[];
  programs: ProgramRow[];
  parameters: Record<string, string>;
  overtimeRules: OvertimeRuleRow[];
}

export function param(config: StatutoryConfig, key: string, fallback = 0): Decimal {
  const raw = config.parameters[key];
  return raw === undefined ? d(fallback) : d(raw);
}

function roundRupiah(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

export function findPtkp(config: StatutoryConfig, code: string | null | undefined): PtkpRow | null {
  if (!code) return null;
  return config.ptkp.find((row) => row.code === code) ?? null;
}

/** Tarif TER (persen) untuk kategori & bruto bulanan tertentu. */
export function terRateFor(
  config: StatutoryConfig,
  category: TerCategoryCode,
  monthlyTaxGross: MoneyInput,
): Decimal {
  const gross = d(monthlyTaxGross);
  const rows = [...(config.terBrackets[category] ?? [])].sort((a, b) =>
    d(a.lower).comparedTo(d(b.lower)),
  );
  for (const row of rows) {
    const upper = row.upper === null || row.upper === undefined ? null : d(row.upper);
    if (gross.gte(d(row.lower)) && (upper === null || gross.lte(upper))) {
      return d(row.rate);
    }
  }
  return d(0);
}

export interface MonthlyPphResult {
  rate: Decimal;
  amount: Decimal;
  surchargeApplied: boolean;
}

/** PPh 21 masa berjalan (Jan–Nov): TER × bruto pajak sebulan. */
export function computeMonthlyPph21(input: {
  config: StatutoryConfig;
  category: TerCategoryCode;
  taxGross: MoneyInput;
  hasNpwp: boolean;
}): MonthlyPphResult {
  const rate = terRateFor(input.config, input.category, input.taxGross);
  let amount = d(input.taxGross).mul(rate).div(100);
  let surchargeApplied = false;
  if (!input.hasNpwp) {
    const surcharge = param(input.config, "non_npwp_surcharge_rate", 0);
    if (surcharge.gt(0)) {
      amount = amount.mul(d(100).plus(surcharge)).div(100);
      surchargeApplied = true;
    }
  }
  return { rate, amount: roundRupiah(amount), surchargeApplied };
}

/** Pajak progresif Pasal 17 atas PKP (dipakai masa pajak terakhir). */
export function computeProgressiveTax(brackets: BracketRow[], pkp: MoneyInput): Decimal {
  const income = d(pkp);
  if (income.lte(0)) return d(0);
  const rows = [...brackets].sort((a, b) => d(a.lower).comparedTo(d(b.lower)));
  let tax = d(0);
  for (const row of rows) {
    const lower = d(row.lower);
    const upper = row.upper === null || row.upper === undefined ? null : d(row.upper);
    if (income.lte(lower)) continue;
    const taxableTop = upper === null ? income : Decimal.min(income, upper);
    const slice = taxableTop.minus(lower);
    if (slice.gt(0)) tax = tax.plus(slice.mul(d(row.rate)).div(100));
  }
  return roundRupiah(tax);
}

export interface AnnualPphResult {
  biayaJabatan: Decimal;
  netIncome: Decimal;
  pkp: Decimal;
  annualTax: Decimal;
  surchargeApplied: boolean;
}

/**
 * Hitungan setahun masa pajak terakhir (PMK 168/2023): bruto setahun −
 * biaya jabatan (5%, terbatas per bulan & per tahun berjalan) − iuran
 * pekerja yang dapat dikurangkan (JHT/JP) − PTKP → PKP dibulatkan ke
 * bawah ke ribuan → tarif Pasal 17.
 */
export function computeAnnualPph21(input: {
  config: StatutoryConfig;
  annualTaxGross: MoneyInput;
  annualDeductibleContributions: MoneyInput;
  ptkpAmount: MoneyInput;
  monthsWorked: number;
  hasNpwp: boolean;
}): AnnualPphResult {
  const gross = d(input.annualTaxGross);
  const rateBiaya = param(input.config, "biaya_jabatan_rate", 0);
  const capYear = param(input.config, "biaya_jabatan_cap_year", 0);
  const capMonth = param(input.config, "biaya_jabatan_cap_month", 0);
  let biayaJabatan = gross.mul(rateBiaya).div(100);
  if (capYear.gt(0)) biayaJabatan = Decimal.min(biayaJabatan, capYear);
  if (capMonth.gt(0) && input.monthsWorked > 0) {
    biayaJabatan = Decimal.min(biayaJabatan, capMonth.mul(input.monthsWorked));
  }
  const netIncome = gross.minus(biayaJabatan).minus(d(input.annualDeductibleContributions));
  let pkp = netIncome.minus(d(input.ptkpAmount));
  if (pkp.lt(0)) pkp = d(0);
  pkp = pkp.div(1000).floor().mul(1000);
  let tax = computeProgressiveTax(input.config.taxBrackets, pkp);
  let surchargeApplied = false;
  if (!input.hasNpwp) {
    const surcharge = param(input.config, "non_npwp_surcharge_rate", 0);
    if (surcharge.gt(0)) {
      tax = roundRupiah(tax.mul(d(100).plus(surcharge)).div(100));
      surchargeApplied = true;
    }
  }
  return { biayaJabatan, netIncome, pkp, annualTax: tax, surchargeApplied };
}

export interface ContributionResult {
  program: StatutoryProgramCode;
  riskClass: string | null;
  basis: Decimal;
  employee: Decimal;
  employer: Decimal;
  employerRate: Decimal;
  employeeRate: Decimal;
  addsToTaxGross: boolean;
  employeeDeductibleAnnual: boolean;
  countsAsEmployerCost: boolean;
  fundingNote: string | null;
}

export function contributionBasis(program: ProgramRow, wage: MoneyInput): Decimal {
  let basis = d(wage);
  if (program.wageFloor !== null && program.wageFloor !== undefined) {
    basis = Decimal.max(basis, d(program.wageFloor));
  }
  if (program.wageCap !== null && program.wageCap !== undefined) {
    basis = Decimal.min(basis, d(program.wageCap));
  }
  return basis;
}

export function computeContribution(program: ProgramRow, wage: MoneyInput): ContributionResult {
  const basis = contributionBasis(program, wage);
  return {
    program: program.program,
    riskClass: program.riskClass,
    basis,
    employee: roundRupiah(basis.mul(d(program.employeeRate)).div(100)),
    employer: roundRupiah(basis.mul(d(program.employerRate)).div(100)),
    employerRate: d(program.employerRate),
    employeeRate: d(program.employeeRate),
    addsToTaxGross: program.addsToTaxGross,
    employeeDeductibleAnnual: program.employeeDeductibleAnnual,
    countsAsEmployerCost: program.countsAsEmployerCost,
    fundingNote: program.fundingNote,
  };
}

/**
 * Seluruh iuran seorang karyawan untuk satu periode. Hanya program
 * yang aktif di konfigurasi perusahaan DAN diikuti karyawan
 * (enrollments; ketiadaan baris enrollment = ikut) yang dihitung.
 * JKK memilih baris sesuai kelas risiko karyawan.
 */
export function computeContributions(input: {
  config: StatutoryConfig;
  wage: MoneyInput;
  enrollments?: Partial<Record<StatutoryProgramCode, boolean>>;
  jkkRiskClass?: string | null;
}): ContributionResult[] {
  const results: ContributionResult[] = [];
  const byProgram = new Map<StatutoryProgramCode, ProgramRow[]>();
  for (const row of input.config.programs) {
    if (!row.isEnabled) continue;
    const list = byProgram.get(row.program) ?? [];
    list.push(row);
    byProgram.set(row.program, list);
  }
  for (const [program, rows] of byProgram) {
    if (input.enrollments && input.enrollments[program] === false) continue;
    let row: ProgramRow | undefined;
    if (program === "jkk") {
      // Tanpa kelas risiko pada karyawan, bawaan yang deterministik
      // adalah kelas sangat rendah (tarif terkecil) — bukan baris acak.
      row =
        rows.find((candidate) => candidate.riskClass === (input.jkkRiskClass ?? null)) ??
        rows.find((candidate) => candidate.riskClass === null) ??
        rows.find((candidate) => candidate.riskClass === "very_low") ??
        [...rows].sort((a, b) => d(a.employerRate).comparedTo(d(b.employerRate)))[0];
    } else {
      row = rows.find((candidate) => candidate.riskClass === null) ?? rows[0];
    }
    if (!row) continue;
    results.push(computeContribution(row, input.wage));
  }
  const order: StatutoryProgramCode[] = ["bpjs_kes", "jht", "jkk", "jkm", "jp", "jkp"];
  return results.sort((a, b) => order.indexOf(a.program) - order.indexOf(b.program));
}

/**
 * THR (Permenaker 6/2016): masa kerja ≥ ambang penuh → 1 bulan upah;
 * di antara ambang minimum & penuh → prorata masa kerja ÷ ambang
 * penuh; di bawah minimum → tidak berhak.
 */
export function computeThr(input: {
  config: StatutoryConfig;
  monthlyWage: MoneyInput;
  monthsOfService: number;
}): Decimal {
  const minMonths = param(input.config, "thr_min_months", 1).toNumber();
  const fullMonths = param(input.config, "thr_full_months", 12).toNumber();
  if (input.monthsOfService < minMonths) return d(0);
  if (input.monthsOfService >= fullMonths) return d(input.monthlyWage);
  return roundRupiah(d(input.monthlyWage).mul(input.monthsOfService).div(fullMonths));
}

export interface OvertimeEntry {
  dayType: OvertimeDayType;
  hours: number;
}

/**
 * Upah lembur (PP 35/2021 Pasal 31–32): upah sejam = upah sebulan ÷
 * pembagi konfigurasi; tiap jam dikenai pengali baris aturan menurut
 * jenis hari & urutan jam.
 */
export function computeOvertimePay(input: {
  config: StatutoryConfig;
  monthlyWage: MoneyInput;
  entries: OvertimeEntry[];
}): { hourlyWage: Decimal; total: Decimal } {
  const divisor = param(input.config, "overtime_hourly_divisor", 173);
  const hourlyWage = divisor.gt(0) ? d(input.monthlyWage).div(divisor) : d(0);
  let total = d(0);
  for (const entry of input.entries) {
    const totalHours = d(entry.hours);
    if (totalHours.lte(0)) continue;

    const rules = input.config.overtimeRules
      .filter((rule) => rule.dayType === entry.dayType)
      .sort((a, b) => a.hourFrom - b.hourFrom);

    for (const rule of rules) {
      const tierStart = d(Math.max(0, rule.hourFrom - 1));
      if (totalHours.lte(tierStart)) continue;
      const tierEnd = rule.hourTo === null ? null : d(rule.hourTo);
      const effectiveEnd = tierEnd === null ? totalHours : Decimal.min(totalHours, tierEnd);
      const hoursInTier = effectiveEnd.minus(tierStart);
      if (hoursInTier.gt(0)) {
        total = total.plus(hourlyWage.mul(d(rule.multiplier)).mul(hoursInTier));
      }
    }
  }
  return { hourlyWage, total: roundRupiah(total) };
}

/** Pemeriksaan upah minimum (TC-12): murni perbandingan terhadap konfigurasi wilayah. */
export function isBelowMinimumWage(wage: MoneyInput, minimum: MoneyInput): boolean {
  return d(wage).lt(d(minimum));
}
