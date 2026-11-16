import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERTIME_RULES,
  DEFAULT_PARAMETERS,
  DEFAULT_PROGRAMS,
  DEFAULT_PTKP,
  DEFAULT_TAX_BRACKETS,
  DEFAULT_TER_BRACKETS,
  type TerCategoryCode,
} from "@/lib/payroll-indonesia-defaults";
import {
  computeAnnualPph21,
  computeContributions,
  computeMonthlyPph21,
  computeOvertimePay,
  computeThr,
  findPtkp,
  isBelowMinimumWage,
  terRateFor,
  type BracketRow,
  type StatutoryConfig,
} from "@/lib/payroll-indonesia";

/**
 * SIM-2 S2 — Test case regulasi S0-C Bagian 3.4 (TC-01 s.d. TC-12)
 * pada engine murni, memakai konfigurasi yang dibangun dari data
 * bawaan (payroll-indonesia-defaults.ts). Test integrasi terhadap
 * konfigurasi DATABASE ada di tests/sim2/payroll-indonesia.test.ts.
 */

function bracketsFromPairs(pairs: Array<[number | null, number]>): BracketRow[] {
  let lower = 0;
  return pairs.map(([upper, rate]) => {
    const row: BracketRow = { lower, upper, rate };
    if (upper !== null) lower = upper + 1;
    return row;
  });
}

function defaultConfig(): StatutoryConfig {
  const ter = {} as Record<TerCategoryCode, BracketRow[]>;
  for (const category of ["A", "B", "C"] as TerCategoryCode[]) {
    ter[category] = bracketsFromPairs(DEFAULT_TER_BRACKETS[category]);
  }
  return {
    pph21Enabled: true,
    ptkp: DEFAULT_PTKP.map((row) => ({
      code: row.code,
      annualAmount: row.annualAmount,
      terCategory: row.terCategory,
    })),
    terBrackets: ter,
    taxBrackets: DEFAULT_TAX_BRACKETS.map((row) => ({
      lower: row.lower,
      upper: row.upper,
      rate: row.rate,
    })),
    // Konfigurasi "periode berjalan": baris program yang efektif untuk
    // periode ≥ Maret 2025 (JKP memakai baris 0,36%).
    programs: DEFAULT_PROGRAMS.filter(
      (row) => !(row.program === "jkp" && row.effectiveTo !== null),
    ).map((row) => ({
      program: row.program,
      riskClass: row.riskClass,
      isEnabled: true,
      employerRate: row.employerRate,
      employeeRate: row.employeeRate,
      wageCap: row.wageCap,
      wageFloor: row.wageFloor,
      addsToTaxGross: row.addsToTaxGross,
      employeeDeductibleAnnual: row.employeeDeductibleAnnual,
      countsAsEmployerCost: row.countsAsEmployerCost,
      fundingNote: row.fundingNote,
    })),
    parameters: Object.fromEntries(DEFAULT_PARAMETERS.map((row) => [row.key, String(row.value)])),
    overtimeRules: DEFAULT_OVERTIME_RULES.map((row) => ({
      dayType: row.dayType,
      hourFrom: row.hourFrom,
      hourTo: row.hourTo,
      multiplier: row.multiplier,
    })),
  };
}

const config = defaultConfig();

describe("tabel konfigurasi bawaan", () => {
  it("memuat 44/40/41 lapisan TER (Lampiran PP 58/2023)", () => {
    expect(DEFAULT_TER_BRACKETS.A).toHaveLength(44);
    expect(DEFAULT_TER_BRACKETS.B).toHaveLength(40);
    expect(DEFAULT_TER_BRACKETS.C).toHaveLength(41);
  });

  it("memetakan status PTKP ke kategori TER sesuai PMK 168/2023", () => {
    expect(findPtkp(config, "TK/0")).toMatchObject({ annualAmount: 54_000_000, terCategory: "A" });
    expect(findPtkp(config, "K/1")).toMatchObject({ annualAmount: 63_000_000, terCategory: "B" });
    expect(findPtkp(config, "K/3")).toMatchObject({ annualAmount: 72_000_000, terCategory: "C" });
  });
});

describe("PPh 21 TER bulanan", () => {
  it("TC-01: TK/0 bruto 5.000.000 → PPh 0 (lapisan A 0%)", () => {
    const result = computeMonthlyPph21({ config, category: "A", taxGross: 5_000_000, hasNpwp: true });
    expect(result.rate.toNumber()).toBe(0);
    expect(result.amount.toNumber()).toBe(0);
  });

  it("TC-02: TK/0 bruto 10.000.000 → TER A 2% → Rp200.000", () => {
    const result = computeMonthlyPph21({ config, category: "A", taxGross: 10_000_000, hasNpwp: true });
    expect(result.rate.toNumber()).toBe(2);
    expect(result.amount.toNumber()).toBe(200_000);
  });

  it("TC-03: K/1 (kategori B) bruto 6.000.000 → PPh 0", () => {
    const ptkp = findPtkp(config, "K/1")!;
    const result = computeMonthlyPph21({ config, category: ptkp.terCategory, taxGross: 6_000_000, hasNpwp: true });
    expect(result.amount.toNumber()).toBe(0);
  });

  it("TC-04: K/3 (kategori C) bruto 6.500.000 → PPh 0", () => {
    const ptkp = findPtkp(config, "K/3")!;
    const result = computeMonthlyPph21({ config, category: ptkp.terCategory, taxGross: 6_500_000, hasNpwp: true });
    expect(result.amount.toNumber()).toBe(0);
  });

  it("lapisan TER cocok dengan contoh lintas sumber (weefer/online-pajak)", () => {
    // Bruto 12 jt: A 4%, B 3%, C 2% — contoh terverifikasi S0-C/riset S2.
    expect(terRateFor(config, "A", 12_000_000).toNumber()).toBe(4);
    expect(terRateFor(config, "B", 12_000_000).toNumber()).toBe(3);
    expect(terRateFor(config, "C", 12_000_000).toNumber()).toBe(2);
    expect(terRateFor(config, "A", 20_000_000).toNumber()).toBe(9);
    expect(terRateFor(config, "C", 30_000_000).toNumber()).toBe(11);
  });

  it("tanpa NPWP: tarif 20% lebih tinggi (Pasal 21 ayat 5a)", () => {
    const result = computeMonthlyPph21({ config, category: "A", taxGross: 10_000_000, hasNpwp: false });
    expect(result.amount.toNumber()).toBe(240_000);
    expect(result.surchargeApplied).toBe(true);
  });

  it("TC-11 (prinsip): PPh dihitung dari bruto penuh — kasbon bukan masukan engine pajak", () => {
    // Potongan kasbon mengurangi neto, bukan bruto; engine pajak hanya
    // menerima bruto. Angka 200.000 identik dengan TC-02 meski pada
    // bulan yang sama ada potongan kasbon Rp1.000.000 (dibuktikan di
    // test integrasi run payroll).
    const result = computeMonthlyPph21({ config, category: "A", taxGross: 10_000_000, hasNpwp: true });
    expect(result.amount.toNumber()).toBe(200_000);
  });
});

describe("masa pajak terakhir (Desember)", () => {
  it("TC-05: TK/0 bruto 10 jt × 12, JHT+JP pekerja → potongan Desember Rp620.000", () => {
    // Jan–Nov dipotong TER 2% × 10 jt = 200.000 per bulan.
    const monthly = computeMonthlyPph21({ config, category: "A", taxGross: 10_000_000, hasNpwp: true });
    const withheldJanNov = monthly.amount.mul(11);
    expect(withheldJanNov.toNumber()).toBe(2_200_000);

    const annual = computeAnnualPph21({
      config,
      annualTaxGross: 120_000_000,
      annualDeductibleContributions: 3_600_000, // JHT 2.400.000 + JP 1.200.000
      ptkpAmount: 54_000_000,
      monthsWorked: 12,
      hasNpwp: true,
    });
    expect(annual.biayaJabatan.toNumber()).toBe(6_000_000);
    expect(annual.netIncome.toNumber()).toBe(110_400_000);
    expect(annual.pkp.toNumber()).toBe(56_400_000);
    expect(annual.annualTax.toNumber()).toBe(2_820_000);
    expect(annual.annualTax.minus(withheldJanNov).toNumber()).toBe(620_000);
  });

  it("PKP dibulatkan ke bawah ke ribuan terdekat", () => {
    const annual = computeAnnualPph21({
      config,
      annualTaxGross: 120_000_999,
      annualDeductibleContributions: 0,
      ptkpAmount: 54_000_000,
      monthsWorked: 12,
      hasNpwp: true,
    });
    expect(annual.pkp.toNumber() % 1000).toBe(0);
  });
});

describe("BPJS", () => {
  it("TC-06: BPJS Kesehatan di atas batas — dasar dibatasi Rp12.000.000", () => {
    const above = computeContributions({ config, wage: 16_000_000, enrollments: { jht: false, jkk: false, jkm: false, jp: false, jkp: false } });
    const kes = above.find((row) => row.program === "bpjs_kes")!;
    expect(kes.basis.toNumber()).toBe(12_000_000);
    expect(kes.employer.toNumber()).toBe(480_000);
    expect(kes.employee.toNumber()).toBe(120_000);

    const below = computeContributions({ config, wage: 8_000_000, enrollments: { jht: false, jkk: false, jkm: false, jp: false, jkp: false } });
    const kesBelow = below.find((row) => row.program === "bpjs_kes")!;
    expect(kesBelow.employer.toNumber()).toBe(320_000);
    expect(kesBelow.employee.toNumber()).toBe(80_000);
  });

  it("TC-07: paket BPJS TK lengkap pada upah Rp10.000.000", () => {
    const rows = computeContributions({
      config,
      wage: 10_000_000,
      jkkRiskClass: "very_low",
      enrollments: { bpjs_kes: false },
    });
    const byProgram = new Map(rows.map((row) => [row.program, row]));
    expect(byProgram.get("jht")).toMatchObject({ employer: expect.objectContaining({}), });
    expect(byProgram.get("jht")!.employer.toNumber()).toBe(370_000);
    expect(byProgram.get("jht")!.employee.toNumber()).toBe(200_000);
    expect(byProgram.get("jkk")!.employer.toNumber()).toBe(24_000);
    expect(byProgram.get("jkm")!.employer.toNumber()).toBe(30_000);
    expect(byProgram.get("jp")!.employer.toNumber()).toBe(200_000);
    expect(byProgram.get("jp")!.employee.toNumber()).toBe(100_000);
    // JKP: dasar dibatasi 5 jt × 0,36% = 18.000, dibiayai pemerintah +
    // rekomposisi (bukan potongan pekerja, bukan beban kas perusahaan).
    expect(byProgram.get("jkp")!.employer.toNumber()).toBe(18_000);
    expect(byProgram.get("jkp")!.employee.toNumber()).toBe(0);
    expect(byProgram.get("jkp")!.countsAsEmployerCost).toBe(false);
    const employeeTotal = rows
      .filter((row) => ["jht", "jp"].includes(row.program))
      .reduce((acc, row) => acc + row.employee.toNumber(), 0);
    expect(employeeTotal).toBe(300_000);
  });

  it("TC-08: batas atas JP mengikat pada upah Rp15.000.000", () => {
    const rows = computeContributions({ config, wage: 15_000_000, enrollments: { bpjs_kes: false, jht: false, jkk: false, jkm: false, jkp: false } });
    const jp = rows.find((row) => row.program === "jp")!;
    expect(jp.basis.toNumber()).toBe(10_547_400);
    expect(jp.employer.toNumber()).toBe(210_948);
    expect(jp.employee.toNumber()).toBe(105_474);
  });

  it("JKK mengikuti kelas risiko karyawan", () => {
    const rows = computeContributions({ config, wage: 10_000_000, jkkRiskClass: "high", enrollments: { bpjs_kes: false, jht: false, jkm: false, jp: false, jkp: false } });
    expect(rows.find((row) => row.program === "jkk")!.employer.toNumber()).toBe(127_000);
  });
});

describe("THR & lembur", () => {
  it("TC-09: THR prorata 8 bulan, penuh ≥12 bulan, 0 di bawah 1 bulan", () => {
    expect(computeThr({ config, monthlyWage: 6_000_000, monthsOfService: 8 }).toNumber()).toBe(4_000_000);
    expect(computeThr({ config, monthlyWage: 6_000_000, monthsOfService: 12 }).toNumber()).toBe(6_000_000);
    expect(computeThr({ config, monthlyWage: 6_000_000, monthsOfService: 24 }).toNumber()).toBe(6_000_000);
    expect(computeThr({ config, monthlyWage: 6_000_000, monthsOfService: 0 }).toNumber()).toBe(0);
  });

  it("TC-10: lembur hari kerja & hari libur pola 5 hari", () => {
    const workday = computeOvertimePay({
      config,
      monthlyWage: 5_190_000,
      entries: [{ dayType: "workday", hours: 3 }],
    });
    expect(workday.hourlyWage.toNumber()).toBe(30_000);
    expect(workday.total.toNumber()).toBe(165_000);

    const rest = computeOvertimePay({
      config,
      monthlyWage: 5_190_000,
      entries: [{ dayType: "rest_5day", hours: 9 }],
    });
    expect(rest.total.toNumber()).toBe(570_000);

    const fractional = computeOvertimePay({
      config,
      monthlyWage: 5_190_000,
      entries: [{ dayType: "workday", hours: 1.5 }],
    });
    // 1.0 jam pertama: 1.0 × 30.000 × 1.5 = 45.000
    // 0.5 jam kedua:   0.5 × 30.000 × 2.0 = 30.000
    // Total: 75.000 (tidak dipotong/terpotong menjadi 1 jam)
    expect(fractional.total.toNumber()).toBe(75_000);
  });
});

describe("upah minimum (TC-12)", () => {
  it("gaji Rp5.000.000 melanggar UMP DKI 2026 tetapi lolos UMP Jawa Barat 2026", () => {
    expect(isBelowMinimumWage(5_000_000, 5_729_876)).toBe(true);
    expect(isBelowMinimumWage(5_000_000, 2_317_601)).toBe(false);
  });
});

describe("konfigurasi mengubah hasil (tanpa ubah kode)", () => {
  it("menaikkan tarif TER lapisan bruto 10 jt menjadi 5% mengubah PPh menjadi Rp500.000", () => {
    const changed = defaultConfig();
    changed.terBrackets.A = changed.terBrackets.A.map((row) =>
      row.lower !== null && Number(row.lower) === 9_650_001 ? { ...row, rate: 5 } : row,
    );
    const result = computeMonthlyPph21({ config: changed, category: "A", taxGross: 10_000_000, hasNpwp: true });
    expect(result.amount.toNumber()).toBe(500_000);
  });

  it("mematikan JKP saja menghilangkan hasil JKP; mematikan semua program mengosongkan iuran", () => {
    const withoutJkp = defaultConfig();
    withoutJkp.programs = withoutJkp.programs.map((row) =>
      row.program === "jkp" ? { ...row, isEnabled: false } : row,
    );
    const rows = computeContributions({ config: withoutJkp, wage: 10_000_000 });
    expect(rows.find((row) => row.program === "jkp")).toBeUndefined();
    expect(rows.length).toBeGreaterThan(0);

    const allOff = defaultConfig();
    allOff.programs = allOff.programs.map((row) => ({ ...row, isEnabled: false }));
    expect(computeContributions({ config: allOff, wage: 10_000_000 })).toHaveLength(0);
  });
});
