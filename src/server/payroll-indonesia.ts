/**
 * SIM-2 S2 — Domain Payroll Indonesia: seeding konfigurasi bawaan,
 * pemuatan konfigurasi bertanggal efektif, perhitungan statutory per
 * karyawan (membungkus engine murni `src/lib/payroll-indonesia.ts`),
 * agregat year-to-date untuk masa pajak terakhir, dan rekap setoran.
 *
 * Semua fungsi menerima `tx` (pola domain repo) dan mengasumsikan
 * pemanggil sudah berada di dalam `withCompany`.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import {
  employeeStatutoryEnrollments,
  employees,
  payrollItemLines,
  payrollItems,
  payrollMinimumWages,
  payrollOvertimeRules,
  payrollPtkpStatuses,
  payrollRuns,
  payrollStatutoryParameters,
  payrollStatutoryPrograms,
  payrollStatutorySettings,
  payrollTaxBrackets,
  payrollTerBrackets,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import {
  DEFAULT_MINIMUM_WAGES,
  DEFAULT_OVERTIME_RULES,
  DEFAULT_PARAMETERS,
  DEFAULT_PROGRAMS,
  DEFAULT_PTKP,
  DEFAULT_TAX_BRACKETS,
  DEFAULT_TER_BRACKETS,
  STATUTORY_PROGRAM_LABELS,
  type StatutoryProgramCode,
  type TerCategoryCode,
} from "@/lib/payroll-indonesia-defaults";
import {
  computeAnnualPph21,
  computeContributions,
  computeMonthlyPph21,
  findPtkp,
  type ContributionResult,
  type ProgramRow,
  type StatutoryConfig,
} from "@/lib/payroll-indonesia";
import { ensureSystemAccounts } from "@/server/system-accounts";

type Executor = Tx | Db;

/* ------------------------------------------------------------------ */
/* Seeding konfigurasi bawaan (idempoten)                              */
/* ------------------------------------------------------------------ */

const ACCOUNT_SPECS: Array<{
  key: string;
  code: string;
  fallbackCode: string;
  name: string;
  type: string;
  normalBalance: string;
  // FIX-R2 Tahap 3 (AK2-04): kelompok laporan eksplisit — fallback
  // laporan tidak lagi menebak dari kode akun.
  section: string;
  cashFlowGroup: string;
}> = [
  { key: "pph21_payable", code: "2110", fallbackCode: "2110-PPH", name: "Utang PPh 21", type: "liability", normalBalance: "credit", section: "current_liability", cashFlowGroup: "operating" },
  { key: "bpjs_payable", code: "2120", fallbackCode: "2120-BPJS", name: "Utang BPJS", type: "liability", normalBalance: "credit", section: "current_liability", cashFlowGroup: "operating" },
  { key: "payroll_employer_expense", code: "6080", fallbackCode: "6080-BPJS", name: "Beban Iuran BPJS Perusahaan", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
];

/** Pola migrasi 0025 di lapisan domain: akun + pemetaan statutory.
 * R3 K-2: algoritma ensure kini hidup SATU di server/system-accounts;
 * berkas ini hanya menyimpan daftar spec domainnya. */
export async function ensurePayrollIndonesiaAccounts(tx: Executor, companyId: string): Promise<void> {
  await ensureSystemAccounts(tx as Tx, companyId, ACCOUNT_SPECS);
}

/**
 * Menanam konfigurasi bawaan (dari lembar fakta S0-C) untuk perusahaan
 * yang belum memilikinya. Idempoten: perusahaan yang sudah punya baris
 * PTKP tidak disentuh sama sekali.
 */
export async function seedPayrollIndonesiaDefaults(tx: Executor, companyId: string): Promise<void> {
  const existing = await tx
    .select({ id: payrollPtkpStatuses.id })
    .from(payrollPtkpStatuses)
    .where(eq(payrollPtkpStatuses.companyId, companyId))
    .limit(1);
  if (existing.length > 0) return;

  await tx
    .insert(payrollStatutorySettings)
    .values({ companyId, isEnabled: false, pph21Enabled: true })
    .onConflictDoNothing();
  await tx.insert(payrollPtkpStatuses).values(
    DEFAULT_PTKP.map((row) => ({
      companyId,
      code: row.code,
      annualAmount: toDb(row.annualAmount),
      terCategory: row.terCategory,
      effectiveFrom: row.effectiveFrom,
    })),
  );
  const terRows: Array<{
    companyId: string;
    category: string;
    lowerBound: string;
    upperBound: string | null;
    rate: string;
    effectiveFrom: string;
  }> = [];
  for (const category of ["A", "B", "C"] as TerCategoryCode[]) {
    let lower = 0;
    for (const [upper, rate] of DEFAULT_TER_BRACKETS[category]) {
      terRows.push({
        companyId,
        category,
        lowerBound: toDb(lower),
        upperBound: upper === null ? null : toDb(upper),
        rate: toDb(rate),
        effectiveFrom: "2024-01-01",
      });
      if (upper !== null) lower = upper + 1;
    }
  }
  await tx.insert(payrollTerBrackets).values(terRows);
  await tx.insert(payrollTaxBrackets).values(
    DEFAULT_TAX_BRACKETS.map((row) => ({
      companyId,
      lowerBound: toDb(row.lower),
      upperBound: row.upper === null ? null : toDb(row.upper),
      rate: toDb(row.rate),
      effectiveFrom: row.effectiveFrom,
    })),
  );
  await tx.insert(payrollStatutoryPrograms).values(
    DEFAULT_PROGRAMS.map((row) => ({
      companyId,
      program: row.program,
      riskClass: row.riskClass,
      isEnabled: true,
      employerRate: toDb(row.employerRate),
      employeeRate: toDb(row.employeeRate),
      wageCap: row.wageCap === null ? null : toDb(row.wageCap),
      wageFloor: row.wageFloor === null ? null : toDb(row.wageFloor),
      addsToTaxGross: row.addsToTaxGross,
      employeeDeductibleAnnual: row.employeeDeductibleAnnual,
      countsAsEmployerCost: row.countsAsEmployerCost,
      fundingNote: row.fundingNote,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    })),
  );
  await tx.insert(payrollStatutoryParameters).values(
    DEFAULT_PARAMETERS.map((row) => ({
      companyId,
      key: row.key,
      value: toDb(row.value),
      effectiveFrom: row.effectiveFrom,
    })),
  );
  await tx.insert(payrollOvertimeRules).values(
    DEFAULT_OVERTIME_RULES.map((row) => ({
      companyId,
      dayType: row.dayType,
      hourFrom: row.hourFrom,
      hourTo: row.hourTo,
      multiplier: toDb(row.multiplier),
      effectiveFrom: row.effectiveFrom,
    })),
  );
  await tx.insert(payrollMinimumWages).values(
    DEFAULT_MINIMUM_WAGES.map((row) => ({
      companyId,
      regionCode: row.regionCode,
      regionName: row.regionName,
      year: row.year,
      amount: toDb(row.amount),
      decreeRef: row.decreeRef,
    })),
  );
  await ensurePayrollIndonesiaAccounts(tx, companyId);
}

/* ------------------------------------------------------------------ */
/* Pemuatan konfigurasi bertanggal efektif                             */
/* ------------------------------------------------------------------ */

interface EffectiveRow {
  effectiveFrom: string;
  effectiveTo: string | null;
}

function effectiveAt<T extends EffectiveRow>(rows: T[], asOf: string): T[] {
  return rows.filter(
    (row) => row.effectiveFrom <= asOf && (row.effectiveTo === null || row.effectiveTo >= asOf),
  );
}

export interface LoadedStatutorySettings {
  isEnabled: boolean;
  pph21Enabled: boolean;
}

export async function getStatutorySettings(
  tx: Executor,
  companyId: string,
): Promise<LoadedStatutorySettings | null> {
  const [row] = await tx
    .select()
    .from(payrollStatutorySettings)
    .where(eq(payrollStatutorySettings.companyId, companyId))
    .limit(1);
  if (!row) return null;
  return { isEnabled: row.isEnabled, pph21Enabled: row.pph21Enabled };
}

/**
 * Membaca seluruh konfigurasi statutory yang efektif pada `asOfDate`
 * (biasanya tanggal 1 periode payroll). Mengembalikan null bila
 * perusahaan belum mengaktifkan engine — pemanggil lalu menjalankan
 * payroll generik persis seperti sebelum S2.
 */
export async function loadStatutoryConfig(
  tx: Executor,
  companyId: string,
  asOfDate: string,
): Promise<StatutoryConfig | null> {
  const settings = await getStatutorySettings(tx, companyId);
  if (!settings?.isEnabled) return null;

  const pickLatest = <T extends EffectiveRow>(rows: T[], keyOf: (row: T) => string): T[] => {
    const byKey = new Map<string, T>();
    for (const row of effectiveAt(rows, asOfDate)) {
      const key = keyOf(row);
      const current = byKey.get(key);
      if (!current || row.effectiveFrom > current.effectiveFrom) byKey.set(key, row);
    }
    return [...byKey.values()];
  };

  const [ptkpRows, terRows, taxRows, programRows, parameterRows, overtimeRows] = await Promise.all([
    tx.select().from(payrollPtkpStatuses).where(eq(payrollPtkpStatuses.companyId, companyId)),
    tx.select().from(payrollTerBrackets).where(eq(payrollTerBrackets.companyId, companyId)),
    tx.select().from(payrollTaxBrackets).where(eq(payrollTaxBrackets.companyId, companyId)),
    tx.select().from(payrollStatutoryPrograms).where(eq(payrollStatutoryPrograms.companyId, companyId)),
    tx.select().from(payrollStatutoryParameters).where(eq(payrollStatutoryParameters.companyId, companyId)),
    tx.select().from(payrollOvertimeRules).where(eq(payrollOvertimeRules.companyId, companyId)),
  ]);

  const ptkp = pickLatest(ptkpRows, (row) => row.code).map((row) => ({
    code: row.code,
    annualAmount: row.annualAmount,
    terCategory: (row.terCategory as TerCategoryCode) ?? "A",
  }));

  const terBrackets: StatutoryConfig["terBrackets"] = { A: [], B: [], C: [] };
  for (const row of pickLatest(terRows, (candidate) => `${candidate.category}|${candidate.lowerBound}`)) {
    const category = row.category as TerCategoryCode;
    if (category !== "A" && category !== "B" && category !== "C") continue;
    terBrackets[category].push({ lower: row.lowerBound, upper: row.upperBound, rate: row.rate });
  }
  for (const category of ["A", "B", "C"] as TerCategoryCode[]) {
    terBrackets[category].sort((a, b) => d(a.lower).comparedTo(d(b.lower)));
  }

  const taxBrackets = pickLatest(taxRows, (row) => `${row.lowerBound}`)
    .map((row) => ({ lower: row.lowerBound, upper: row.upperBound, rate: row.rate }))
    .sort((a, b) => d(a.lower).comparedTo(d(b.lower)));

  const programs: ProgramRow[] = pickLatest(programRows, (row) => `${row.program}|${row.riskClass ?? ""}`).map(
    (row) => ({
      program: row.program as StatutoryProgramCode,
      riskClass: row.riskClass,
      isEnabled: row.isEnabled,
      employerRate: row.employerRate,
      employeeRate: row.employeeRate,
      wageCap: row.wageCap,
      wageFloor: row.wageFloor,
      addsToTaxGross: row.addsToTaxGross,
      employeeDeductibleAnnual: row.employeeDeductibleAnnual,
      countsAsEmployerCost: row.countsAsEmployerCost,
      fundingNote: row.fundingNote,
    }),
  );

  const parameters: Record<string, string> = {};
  for (const row of pickLatest(parameterRows, (row) => row.key)) {
    parameters[row.key] = row.value;
  }

  const overtimeRules = effectiveAt(overtimeRows, asOfDate).map((row) => ({
    dayType: row.dayType as StatutoryConfig["overtimeRules"][number]["dayType"],
    hourFrom: row.hourFrom,
    hourTo: row.hourTo,
    multiplier: row.multiplier,
  }));

  return {
    pph21Enabled: settings.pph21Enabled,
    ptkp,
    terBrackets,
    taxBrackets,
    programs,
    parameters,
    overtimeRules,
  };
}

/* ------------------------------------------------------------------ */
/* Kepesertaan & year-to-date                                          */
/* ------------------------------------------------------------------ */

export async function getEmployeeEnrollments(
  tx: Executor,
  companyId: string,
  employeeIds: string[],
): Promise<Map<string, Partial<Record<StatutoryProgramCode, boolean>>>> {
  const result = new Map<string, Partial<Record<StatutoryProgramCode, boolean>>>();
  if (employeeIds.length === 0) return result;
  const rows = await tx
    .select()
    .from(employeeStatutoryEnrollments)
    .where(
      and(
        eq(employeeStatutoryEnrollments.companyId, companyId),
        inArray(employeeStatutoryEnrollments.employeeId, employeeIds),
      ),
    );
  for (const row of rows) {
    const entry = result.get(row.employeeId) ?? {};
    entry[row.program as StatutoryProgramCode] = row.isEnrolled;
    result.set(row.employeeId, entry);
  }
  return result;
}

export interface YearToDateFigures {
  taxGross: Decimal;
  pphWithheld: Decimal;
  deductibleContributions: Decimal;
  /** Jumlah periode (run) berbeda yang menyumbang angka tahun ini. */
  months: number;
}

/**
 * Agregat tahun berjalan dari snapshot `payroll_item_lines` run-run
 * non-void pada tahun yang sama — dasar hitungan masa pajak terakhir.
 * Run yang di-void tidak dihitung (jurnalnya sudah dibalik).
 */
export async function getYearToDateFigures(
  tx: Executor,
  companyId: string,
  employeeId: string,
  year: number,
): Promise<YearToDateFigures> {
  const rows = await tx
    .select({
      code: payrollItemLines.code,
      amount: payrollItemLines.amount,
      basisAmount: payrollItemLines.basisAmount,
      deductibleAnnual: payrollItemLines.deductibleAnnual,
      period: payrollRuns.period,
    })
    .from(payrollItemLines)
    .innerJoin(payrollRuns, eq(payrollItemLines.runId, payrollRuns.id))
    .where(
      and(
        eq(payrollItemLines.companyId, companyId),
        eq(payrollItemLines.employeeId, employeeId),
        ne(payrollRuns.status, "void"),
        sql`${payrollRuns.period} like ${`${year}-%`}`,
      ),
    );
  const figures: YearToDateFigures = {
    taxGross: d(0),
    pphWithheld: d(0),
    deductibleContributions: d(0),
    months: 0,
  };
  const periods = new Set<string>();
  for (const row of rows) {
    periods.add(row.period);
    if (row.code === "tax_gross") figures.taxGross = figures.taxGross.plus(d(row.amount));
    if (row.code === "pph21") figures.pphWithheld = figures.pphWithheld.plus(d(row.amount));
    if (row.deductibleAnnual) {
      figures.deductibleContributions = figures.deductibleContributions.plus(d(row.amount));
    }
  }
  figures.months = periods.size;
  return figures;
}

/* ------------------------------------------------------------------ */
/* Perhitungan per karyawan                                            */
/* ------------------------------------------------------------------ */

export interface StatutoryLineDraft {
  code: string;
  label: string;
  // earning/deduction ditambahkan SIM-2 S7B-1 untuk baris komponen HR
  // bernama (upah lembur, THR, potongan cuti tidak berbayar).
  category: "statutory_employee" | "statutory_employer" | "tax" | "info" | "earning" | "deduction";
  amount: Decimal;
  basisAmount: Decimal | null;
  deductibleAnnual: boolean;
  basisSnapshot: Record<string, unknown>;
}

export interface EmployeeStatutoryResult {
  contributions: ContributionResult[];
  /** Bruto pajak bulan ini: upah + premi perusahaan yang kena pajak. */
  taxGross: Decimal;
  pphAmount: Decimal;
  /** Σ iuran pekerja (BPJS) — pengurang neto. */
  employeeTotal: Decimal;
  /** Σ iuran perusahaan yang menjadi beban kas perusahaan (jurnal). */
  employerCostTotal: Decimal;
  /** Σ seluruh iuran perusahaan termasuk yang bukan beban kas (JKP). */
  employerReportedTotal: Decimal;
  lines: StatutoryLineDraft[];
}

export function computeEmployeeStatutory(input: {
  config: StatutoryConfig;
  employee: {
    baseSalary: MoneyInput;
    allowances: MoneyInput;
    ptkpStatus: string | null;
    npwp: string | null;
    nik: string | null;
    jkkRiskClass: string | null;
  };
  enrollments?: Partial<Record<StatutoryProgramCode, boolean>>;
  isFinalPeriod: boolean;
  ytd?: YearToDateFigures;
  /**
   * SIM-2 S7B-1: penghasilan kena pajak di luar upah pokok+tunjangan
   * (upah lembur & THR dari draf komponen) — menambah bruto pajak,
   * tetapi BUKAN dasar iuran BPJS (dasar iuran tetap upah
   * pokok+tunjangan sesuai konvensi engine). Bawaan 0 = perilaku S2.
   */
  taxableExtra?: MoneyInput;
}): EmployeeStatutoryResult {
  const { config, employee } = input;
  const wage = d(employee.baseSalary).plus(d(employee.allowances));

  const contributions = computeContributions({
    config,
    wage,
    enrollments: input.enrollments,
    jkkRiskClass: employee.jkkRiskClass,
  });

  const lines: StatutoryLineDraft[] = [];
  let employeeTotal = d(0);
  let employerCostTotal = d(0);
  let employerReportedTotal = d(0);
  let employerTaxable = d(0);
  let monthlyDeductible = d(0);

  for (const row of contributions) {
    const label = STATUTORY_PROGRAM_LABELS[row.program];
    if (row.addsToTaxGross) employerTaxable = employerTaxable.plus(row.employer);
    if (row.employeeDeductibleAnnual) monthlyDeductible = monthlyDeductible.plus(row.employee);
    employeeTotal = employeeTotal.plus(row.employee);
    employerReportedTotal = employerReportedTotal.plus(row.employer);
    if (row.countsAsEmployerCost) employerCostTotal = employerCostTotal.plus(row.employer);
    if (!row.employee.isZero()) {
      lines.push({
        code: `${row.program}_employee`,
        label: `${label} — iuran pekerja`,
        category: "statutory_employee",
        amount: row.employee,
        basisAmount: row.basis,
        deductibleAnnual: row.employeeDeductibleAnnual,
        basisSnapshot: {
          program: row.program,
          riskClass: row.riskClass,
          wage: toDb(wage),
          basis: toDb(row.basis),
          employeeRate: row.employeeRate.toString(),
        },
      });
    }
    if (!row.employer.isZero()) {
      lines.push({
        code: `${row.program}_employer`,
        label: `${label} — iuran perusahaan`,
        category: "statutory_employer",
        amount: row.employer,
        basisAmount: row.basis,
        deductibleAnnual: false,
        basisSnapshot: {
          program: row.program,
          riskClass: row.riskClass,
          wage: toDb(wage),
          basis: toDb(row.basis),
          employerRate: row.employerRate.toString(),
          addsToTaxGross: row.addsToTaxGross,
          countsAsEmployerCost: row.countsAsEmployerCost,
          fundingNote: row.fundingNote,
        },
      });
    }
  }

  const taxableExtra = d(input.taxableExtra ?? 0);
  const taxGross = wage.plus(employerTaxable).plus(taxableExtra);
  lines.push({
    code: "tax_gross",
    label: "Penghasilan bruto pajak (termasuk premi perusahaan)",
    category: "info",
    amount: taxGross,
    basisAmount: taxGross,
    deductibleAnnual: false,
    basisSnapshot: {
      wage: toDb(wage),
      employerTaxablePremiums: toDb(employerTaxable),
      taxableExtra: toDb(taxableExtra),
    },
  });

  let pphAmount = d(0);
  if (config.pph21Enabled) {
    const ptkpRow = findPtkp(config, employee.ptkpStatus) ?? findPtkp(config, "TK/0");
    if (!ptkpRow) {
      throw new AppError(
        "VALIDATION",
        "Konfigurasi PTKP Payroll Indonesia belum lengkap — periksa Pengaturan → Payroll Indonesia.",
      );
    }
    const ptkpAssumed = !employee.ptkpStatus || !findPtkp(config, employee.ptkpStatus);
    const hasNpwp = Boolean(employee.npwp || employee.nik);
    if (input.isFinalPeriod) {
      const ytd = input.ytd ?? { taxGross: d(0), pphWithheld: d(0), deductibleContributions: d(0), months: 0 };
      const annual = computeAnnualPph21({
        config,
        annualTaxGross: ytd.taxGross.plus(taxGross),
        annualDeductibleContributions: ytd.deductibleContributions.plus(monthlyDeductible),
        ptkpAmount: ptkpRow.annualAmount,
        monthsWorked: ytd.months + 1,
        hasNpwp,
      });
      pphAmount = annual.annualTax.minus(ytd.pphWithheld);
      lines.push({
        code: "pph21",
        label: "PPh 21 — masa pajak terakhir (hitung ulang setahun, Pasal 17)",
        category: "tax",
        amount: pphAmount,
        basisAmount: taxGross,
        deductibleAnnual: false,
        basisSnapshot: {
          mode: "final_period",
          ptkpStatus: ptkpRow.code,
          ptkpAssumed,
          terCategory: ptkpRow.terCategory,
          hasNpwp,
          annualTaxGross: toDb(ytd.taxGross.plus(taxGross)),
          ytdTaxGross: toDb(ytd.taxGross),
          annualDeductibleContributions: toDb(ytd.deductibleContributions.plus(monthlyDeductible)),
          biayaJabatan: toDb(annual.biayaJabatan),
          pkp: toDb(annual.pkp),
          annualTax: toDb(annual.annualTax),
          ytdPphWithheld: toDb(ytd.pphWithheld),
        },
      });
    } else {
      const monthly = computeMonthlyPph21({
        config,
        category: ptkpRow.terCategory,
        taxGross,
        hasNpwp,
      });
      pphAmount = monthly.amount;
      lines.push({
        code: "pph21",
        label: `PPh 21 — TER kategori ${ptkpRow.terCategory}`,
        category: "tax",
        amount: pphAmount,
        basisAmount: taxGross,
        deductibleAnnual: false,
        basisSnapshot: {
          mode: "ter",
          ptkpStatus: ptkpRow.code,
          ptkpAssumed,
          terCategory: ptkpRow.terCategory,
          terRate: monthly.rate.toString(),
          hasNpwp,
          surchargeApplied: monthly.surchargeApplied,
        },
      });
    }
  }

  return {
    contributions,
    taxGross,
    pphAmount,
    employeeTotal,
    employerCostTotal,
    employerReportedTotal,
    lines,
  };
}

/* ------------------------------------------------------------------ */
/* Upah minimum & rekap                                                */
/* ------------------------------------------------------------------ */

export async function getMinimumWage(
  tx: Executor,
  companyId: string,
  regionCode: string,
  year: number,
): Promise<{ amount: string; regionName: string } | null> {
  const [row] = await tx
    .select({ amount: payrollMinimumWages.amount, regionName: payrollMinimumWages.regionName })
    .from(payrollMinimumWages)
    .where(
      and(
        eq(payrollMinimumWages.companyId, companyId),
        eq(payrollMinimumWages.regionCode, regionCode),
        eq(payrollMinimumWages.year, year),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface PayrollRecapRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  ptkpStatus: string | null;
  gross: string;
  regularDeductions: string;
  statutoryEmployee: Record<string, string>;
  statutoryEmployer: Record<string, string>;
  pph21: string;
  advanceDeduction: string;
  net: string;
}

/** Rekap per karyawan satu run untuk slip, halaman detail & ekspor CSV. */
export async function getPayrollRecap(
  tx: Executor,
  companyId: string,
  runId: string,
): Promise<PayrollRecapRow[]> {
  const items = await tx
    .select({
      itemId: payrollItems.id,
      employeeId: payrollItems.employeeId,
      employeeCode: employees.code,
      employeeName: employees.name,
      ptkpStatus: employees.ptkpStatus,
      baseSalary: payrollItems.baseSalary,
      allowances: payrollItems.allowances,
      deductions: payrollItems.deductions,
      advanceDeduction: payrollItems.advanceDeduction,
      net: payrollItems.net,
    })
    .from(payrollItems)
    .leftJoin(employees, eq(payrollItems.employeeId, employees.id))
    .where(and(eq(payrollItems.companyId, companyId), eq(payrollItems.runId, runId)))
    .orderBy(asc(employees.name));
  const lines = await tx
    .select()
    .from(payrollItemLines)
    .where(and(eq(payrollItemLines.companyId, companyId), eq(payrollItemLines.runId, runId)));
  const linesByItem = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByItem.get(line.itemId) ?? [];
    list.push(line);
    linesByItem.set(line.itemId, list);
  }
  return items.map((item) => {
    const itemLines = linesByItem.get(item.itemId) ?? [];
    const statutoryEmployee: Record<string, string> = {};
    const statutoryEmployer: Record<string, string> = {};
    let pph21 = "0";
    for (const line of itemLines) {
      if (line.category === "statutory_employee") statutoryEmployee[line.code] = line.amount;
      if (line.category === "statutory_employer") statutoryEmployer[line.code] = line.amount;
      if (line.code === "pph21") pph21 = line.amount;
    }
    return {
      employeeId: item.employeeId,
      employeeCode: item.employeeCode ?? "—",
      employeeName: item.employeeName ?? "—",
      ptkpStatus: item.ptkpStatus ?? null,
      gross: toDb(d(item.baseSalary).plus(d(item.allowances))),
      regularDeductions: item.deductions,
      statutoryEmployee,
      statutoryEmployer,
      pph21,
      advanceDeduction: item.advanceDeduction,
      net: item.net,
    };
  });
}

export { Decimal };

// FIX-ARS Tahap 6 (ARS1-01): enam tabel konfigurasi statutory mentah
// untuk halaman pengaturan Payroll Indonesia — dulu enam kueri inline
// di halaman; pemilihan baris efektif tetap dilakukan halaman.
export async function getPayrollIndonesiaSettingsData(tx: Tx, companyId: string) {
  const [settingsRows, programRows, ptkpRows, parameterRows, terRows, wageRows] =
    await Promise.all([
      tx.select().from(payrollStatutorySettings).where(eq(payrollStatutorySettings.companyId, companyId)),
      tx.select().from(payrollStatutoryPrograms).where(eq(payrollStatutoryPrograms.companyId, companyId)),
      tx.select().from(payrollPtkpStatuses).where(eq(payrollPtkpStatuses.companyId, companyId)),
      tx.select().from(payrollStatutoryParameters).where(eq(payrollStatutoryParameters.companyId, companyId)),
      tx.select().from(payrollTerBrackets).where(eq(payrollTerBrackets.companyId, companyId)),
      tx.select().from(payrollMinimumWages).where(eq(payrollMinimumWages.companyId, companyId)),
    ]);
  return { settingsRows, programRows, ptkpRows, parameterRows, terRows, wageRows };
}
