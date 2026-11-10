/**
 * SIM-2 S2 — Nilai bawaan konfigurasi Payroll Indonesia.
 *
 * Berkas ini HANYA data awal (seed) untuk tabel konfigurasi per
 * perusahaan (`payroll_ptkp_statuses`, `payroll_ter_brackets`, dst.).
 * Engine (`src/lib/payroll-indonesia.ts`) TIDAK membaca berkas ini —
 * engine hanya membaca konfigurasi perusahaan dari database, jadi
 * mengubah angka di sini tidak mengubah perilaku perusahaan yang sudah
 * berjalan; admin mengubah konfigurasi lewat halaman Pengaturan →
 * Payroll Indonesia tanpa deploy.
 *
 * Sumber angka: docs/sim2/S0-C-HR-PAYROLL.md Bagian 2 (lembar fakta
 * regulasi). Tabel TER diverifikasi silang pada 2026-11-04 terhadap dua
 * reproduksi Lampiran PP 58/2023 yang independen (tools.satutim.id &
 * online-pajak/weefer untuk lapisan contoh) — seluruh lapisan contoh
 * yang tercantum di S0-C cocok.
 *
 * Yang SENGAJA tidak disemai (status "terverifikasi sebagian" di
 * S0-C): batas upah JP 2026 (Rp11.086.300), lapisan TER harian, dan
 * status PPh 21 DTP 2026. Strukturnya didukung konfigurasi; nilainya
 * menunggu verifikasi dokumen resmi.
 */

export type TerCategoryCode = "A" | "B" | "C";

export interface PtkpDefault {
  code: string;
  annualAmount: number;
  terCategory: TerCategoryCode;
  effectiveFrom: string;
}

/** PMK 101/PMK.010/2016 — berlaku sejak 2016, tidak berubah s.d. riset S0-C. */
export const DEFAULT_PTKP: PtkpDefault[] = [
  { code: "TK/0", annualAmount: 54_000_000, terCategory: "A", effectiveFrom: "2016-01-01" },
  { code: "TK/1", annualAmount: 58_500_000, terCategory: "A", effectiveFrom: "2016-01-01" },
  { code: "K/0", annualAmount: 58_500_000, terCategory: "A", effectiveFrom: "2016-01-01" },
  { code: "TK/2", annualAmount: 63_000_000, terCategory: "B", effectiveFrom: "2016-01-01" },
  { code: "K/1", annualAmount: 63_000_000, terCategory: "B", effectiveFrom: "2016-01-01" },
  { code: "TK/3", annualAmount: 67_500_000, terCategory: "B", effectiveFrom: "2016-01-01" },
  { code: "K/2", annualAmount: 67_500_000, terCategory: "B", effectiveFrom: "2016-01-01" },
  { code: "K/3", annualAmount: 72_000_000, terCategory: "C", effectiveFrom: "2016-01-01" },
];

/**
 * Lapisan TER sebagai pasangan [batas atas inklusif, tarif %]; null =
 * tanpa batas atas. Batas bawah lapisan = batas atas lapisan
 * sebelumnya + 1 (lapisan pertama mulai dari 0).
 * Lampiran PP 58/2023, berlaku 2024-01-01.
 */
export const DEFAULT_TER_BRACKETS: Record<TerCategoryCode, Array<[number | null, number]>> = {
  A: [
    [5_400_000, 0], [5_650_000, 0.25], [5_950_000, 0.5], [6_300_000, 0.75],
    [6_750_000, 1], [7_500_000, 1.25], [8_550_000, 1.5], [9_650_000, 1.75],
    [10_050_000, 2], [10_350_000, 2.25], [10_700_000, 2.5], [11_050_000, 3],
    [11_600_000, 3.5], [12_500_000, 4], [13_750_000, 5], [15_100_000, 6],
    [16_950_000, 7], [19_750_000, 8], [24_150_000, 9], [26_450_000, 10],
    [28_000_000, 11], [30_050_000, 12], [32_400_000, 13], [35_400_000, 14],
    [39_100_000, 15], [43_850_000, 16], [47_800_000, 17], [51_400_000, 18],
    [56_300_000, 19], [62_200_000, 20], [68_600_000, 21], [77_500_000, 22],
    [89_000_000, 23], [103_000_000, 24], [125_000_000, 25], [157_000_000, 26],
    [206_000_000, 27], [337_000_000, 28], [454_000_000, 29], [550_000_000, 30],
    [695_000_000, 31], [910_000_000, 32], [1_400_000_000, 33], [null, 34],
  ],
  B: [
    [6_200_000, 0], [6_500_000, 0.25], [6_850_000, 0.5], [7_300_000, 0.75],
    [9_200_000, 1], [10_750_000, 1.5], [11_250_000, 2], [11_600_000, 2.5],
    [12_600_000, 3], [13_600_000, 4], [14_950_000, 5], [16_400_000, 6],
    [18_450_000, 7], [21_850_000, 8], [26_000_000, 9], [27_700_000, 10],
    [29_350_000, 11], [31_450_000, 12], [33_950_000, 13], [37_100_000, 14],
    [41_100_000, 15], [45_800_000, 16], [49_500_000, 17], [53_800_000, 18],
    [58_500_000, 19], [64_000_000, 20], [71_000_000, 21], [80_000_000, 22],
    [93_000_000, 23], [109_000_000, 24], [129_000_000, 25], [163_000_000, 26],
    [211_000_000, 27], [374_000_000, 28], [459_000_000, 29], [555_000_000, 30],
    [704_000_000, 31], [957_000_000, 32], [1_405_000_000, 33], [null, 34],
  ],
  C: [
    [6_600_000, 0], [6_950_000, 0.25], [7_350_000, 0.5], [7_800_000, 0.75],
    [8_850_000, 1], [9_800_000, 1.25], [10_950_000, 1.5], [11_200_000, 1.75],
    [12_050_000, 2], [12_950_000, 3], [14_150_000, 4], [15_550_000, 5],
    [17_050_000, 6], [19_500_000, 7], [22_700_000, 8], [26_600_000, 9],
    [28_100_000, 10], [30_100_000, 11], [32_600_000, 12], [35_400_000, 13],
    [38_900_000, 14], [43_000_000, 15], [47_400_000, 16], [51_200_000, 17],
    [55_800_000, 18], [60_400_000, 19], [66_700_000, 20], [74_500_000, 21],
    [83_200_000, 22], [95_600_000, 23], [110_000_000, 24], [134_000_000, 25],
    [169_000_000, 26], [221_000_000, 27], [390_000_000, 28], [463_000_000, 29],
    [561_000_000, 30], [709_000_000, 31], [965_000_000, 32], [1_419_000_000, 33],
    [null, 34],
  ],
};

/** Tarif Pasal 17 UU PPh sebagaimana diubah UU 7/2021 (HPP), berlaku 2022-01-01. */
export const DEFAULT_TAX_BRACKETS: Array<{
  lower: number;
  upper: number | null;
  rate: number;
  effectiveFrom: string;
}> = [
  { lower: 0, upper: 60_000_000, rate: 5, effectiveFrom: "2022-01-01" },
  { lower: 60_000_000, upper: 250_000_000, rate: 15, effectiveFrom: "2022-01-01" },
  { lower: 250_000_000, upper: 500_000_000, rate: 25, effectiveFrom: "2022-01-01" },
  { lower: 500_000_000, upper: 5_000_000_000, rate: 30, effectiveFrom: "2022-01-01" },
  { lower: 5_000_000_000, upper: null, rate: 35, effectiveFrom: "2022-01-01" },
];

export type StatutoryProgramCode = "bpjs_kes" | "jht" | "jkk" | "jkm" | "jp" | "jkp";

export const STATUTORY_PROGRAM_CODES: StatutoryProgramCode[] = [
  "bpjs_kes",
  "jht",
  "jkk",
  "jkm",
  "jp",
  "jkp",
];

export const STATUTORY_PROGRAM_LABELS: Record<StatutoryProgramCode, string> = {
  bpjs_kes: "BPJS Kesehatan",
  jht: "BPJS TK — JHT",
  jkk: "BPJS TK — JKK",
  jkm: "BPJS TK — JKM",
  jp: "BPJS TK — JP",
  jkp: "BPJS TK — JKP",
};

export interface ProgramDefault {
  program: StatutoryProgramCode;
  riskClass: string | null;
  employerRate: number; // persen
  employeeRate: number; // persen
  wageCap: number | null;
  wageFloor: number | null;
  addsToTaxGross: boolean;
  employeeDeductibleAnnual: boolean;
  countsAsEmployerCost: boolean;
  fundingNote: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export const JKK_RISK_CLASSES: Array<{ code: string; label: string }> = [
  { code: "very_low", label: "Sangat rendah" },
  { code: "low", label: "Rendah" },
  { code: "medium", label: "Sedang" },
  { code: "high", label: "Tinggi" },
  { code: "very_high", label: "Sangat tinggi" },
];

/**
 * Program BPJS. Dasar hukum per baris ada di S0-C §2.2–2.3.
 * - JKK/JKM/premi perusahaan BPJS Kesehatan menambah bruto pajak;
 *   JHT/JP perusahaan tidak (S0-C §2.1 catatan bruto).
 * - Iuran pekerja yang mengurangi penghasilan neto tahunan: JHT & JP.
 * - JKP bukan beban kas perusahaan (dibiayai Pemerintah Pusat +
 *   rekomposisi JKK), jadi `countsAsEmployerCost=false`: dihitung dan
 *   dilaporkan, tetapi tidak dijurnal sebagai beban/utang perusahaan.
 */
export const DEFAULT_PROGRAMS: ProgramDefault[] = [
  {
    program: "bpjs_kes", riskClass: null,
    employerRate: 4, employeeRate: 1,
    wageCap: 12_000_000, wageFloor: null,
    addsToTaxGross: true, employeeDeductibleAnnual: false,
    countsAsEmployerCost: true,
    fundingNote: "Perpres 64/2020 Pasal 30 & 32(1): total 5% dari upah (pokok + tunjangan tetap), dasar dibatasi Rp12.000.000.",
    effectiveFrom: "2024-01-01", effectiveTo: null,
  },
  {
    program: "jht", riskClass: null,
    employerRate: 3.7, employeeRate: 2,
    wageCap: null, wageFloor: null,
    addsToTaxGross: false, employeeDeductibleAnnual: true,
    countsAsEmployerCost: true,
    fundingNote: "PP 46/2015 Pasal 16: total 5,7% dari upah sebulan, tanpa batas atas.",
    effectiveFrom: "2024-01-01", effectiveTo: null,
  },
  ...([
    ["very_low", 0.24],
    ["low", 0.54],
    ["medium", 0.89],
    ["high", 1.27],
    ["very_high", 1.74],
  ] as Array<[string, number]>).map(([riskClass, rate]) => ({
    program: "jkk" as const,
    riskClass,
    employerRate: rate, employeeRate: 0,
    wageCap: null, wageFloor: null,
    addsToTaxGross: true, employeeDeductibleAnnual: false,
    countsAsEmployerCost: true,
    fundingNote: "PP 44/2015 Pasal 16: tarif menurut kelas risiko pekerjaan, ditanggung perusahaan.",
    effectiveFrom: "2024-01-01", effectiveTo: null,
  })),
  {
    program: "jkm", riskClass: null,
    employerRate: 0.3, employeeRate: 0,
    wageCap: null, wageFloor: null,
    addsToTaxGross: true, employeeDeductibleAnnual: false,
    countsAsEmployerCost: true,
    fundingNote: "PP 44/2015 Pasal 18: 0,30% dari upah, ditanggung perusahaan.",
    effectiveFrom: "2024-01-01", effectiveTo: null,
  },
  {
    program: "jp", riskClass: null,
    employerRate: 2, employeeRate: 1,
    // Batas 2025 terverifikasi (S0-C §2.3). Batas 2026 TIDAK disemai —
    // masih terverifikasi sebagian; admin menambah baris efektif baru
    // setelah pengumuman resmi BPJS Ketenagakerjaan dikonfirmasi.
    wageCap: 10_547_400, wageFloor: null,
    addsToTaxGross: false, employeeDeductibleAnnual: true,
    countsAsEmployerCost: true,
    fundingNote: "PP 45/2015 Pasal 28–29: total 3%; batas upah disesuaikan tahunan mengikuti pertumbuhan PDB (efektif Maret 2025: Rp10.547.400).",
    effectiveFrom: "2025-03-01", effectiveTo: null,
  },
  {
    program: "jkp", riskClass: null,
    employerRate: 0.46, employeeRate: 0,
    wageCap: 5_000_000, wageFloor: null,
    addsToTaxGross: false, employeeDeductibleAnnual: false,
    countsAsEmployerCost: false,
    fundingNote: "PP 37/2021 Pasal 11: 0,46% — 0,22% Pemerintah Pusat + 0,14% rekomposisi JKK + 0,10% rekomposisi JKM.",
    effectiveFrom: "2021-02-02", effectiveTo: "2025-02-06",
  },
  {
    program: "jkp", riskClass: null,
    employerRate: 0.36, employeeRate: 0,
    wageCap: 5_000_000, wageFloor: null,
    addsToTaxGross: false, employeeDeductibleAnnual: false,
    countsAsEmployerCost: false,
    fundingNote: "PP 6/2025: 0,36% — 0,22% Pemerintah Pusat + 0,14% rekomposisi JKK. Bukan beban kas perusahaan.",
    effectiveFrom: "2025-02-07", effectiveTo: null,
  },
];

/** Parameter tunggal bertanggal efektif (S0-C §2.1, §2.4, §2.5). */
export const DEFAULT_PARAMETERS: Array<{ key: string; value: number; effectiveFrom: string }> = [
  // Biaya jabatan: 5% dari bruto, maks Rp500.000/bln / Rp6.000.000/thn.
  { key: "biaya_jabatan_rate", value: 5, effectiveFrom: "2024-01-01" },
  { key: "biaya_jabatan_cap_year", value: 6_000_000, effectiveFrom: "2024-01-01" },
  { key: "biaya_jabatan_cap_month", value: 500_000, effectiveFrom: "2024-01-01" },
  // UU PPh Pasal 21 ayat (5a): tanpa NPWP tarif 20% lebih tinggi.
  { key: "non_npwp_surcharge_rate", value: 20, effectiveFrom: "2024-01-01" },
  // THR Permenaker 6/2016: hak mulai 1 bulan masa kerja; penuh pada 12.
  { key: "thr_min_months", value: 1, effectiveFrom: "2024-01-01" },
  { key: "thr_full_months", value: 12, effectiveFrom: "2024-01-01" },
  // PP 35/2021 Pasal 32: upah sejam = upah sebulan / 173.
  { key: "overtime_hourly_divisor", value: 173, effectiveFrom: "2024-01-01" },
];

export type OvertimeDayType = "workday" | "rest_5day" | "rest_6day" | "shortest_day_6day";

export const OVERTIME_DAY_TYPE_LABELS: Record<OvertimeDayType, string> = {
  workday: "Hari kerja biasa",
  rest_5day: "Hari istirahat/libur — pola 5 hari kerja",
  rest_6day: "Hari istirahat/libur — pola 6 hari kerja",
  shortest_day_6day: "Libur pada hari kerja terpendek — pola 6 hari kerja",
};

/** Pengali lembur PP 35/2021 Pasal 31. hourTo null = jam berikutnya tanpa batas. */
export const DEFAULT_OVERTIME_RULES: Array<{
  dayType: OvertimeDayType;
  hourFrom: number;
  hourTo: number | null;
  multiplier: number;
  effectiveFrom: string;
}> = [
  { dayType: "workday", hourFrom: 1, hourTo: 1, multiplier: 1.5, effectiveFrom: "2021-02-02" },
  { dayType: "workday", hourFrom: 2, hourTo: null, multiplier: 2, effectiveFrom: "2021-02-02" },
  { dayType: "rest_5day", hourFrom: 1, hourTo: 8, multiplier: 2, effectiveFrom: "2021-02-02" },
  { dayType: "rest_5day", hourFrom: 9, hourTo: 9, multiplier: 3, effectiveFrom: "2021-02-02" },
  { dayType: "rest_5day", hourFrom: 10, hourTo: null, multiplier: 4, effectiveFrom: "2021-02-02" },
  { dayType: "rest_6day", hourFrom: 1, hourTo: 7, multiplier: 2, effectiveFrom: "2021-02-02" },
  { dayType: "rest_6day", hourFrom: 8, hourTo: 8, multiplier: 3, effectiveFrom: "2021-02-02" },
  { dayType: "rest_6day", hourFrom: 9, hourTo: null, multiplier: 4, effectiveFrom: "2021-02-02" },
  { dayType: "shortest_day_6day", hourFrom: 1, hourTo: 5, multiplier: 2, effectiveFrom: "2021-02-02" },
  { dayType: "shortest_day_6day", hourFrom: 6, hourTo: 6, multiplier: 3, effectiveFrom: "2021-02-02" },
  { dayType: "shortest_day_6day", hourFrom: 7, hourTo: null, multiplier: 4, effectiveFrom: "2021-02-02" },
];

/**
 * Upah minimum per wilayah & tahun (S0-C §2.6) — contoh terverifikasi
 * 2026. Wilayah/tahun lain ditambah admin lewat konfigurasi; tidak ada
 * angka nasional.
 */
export const DEFAULT_MINIMUM_WAGES: Array<{
  regionCode: string;
  regionName: string;
  year: number;
  amount: number;
  decreeRef: string | null;
}> = [
  {
    regionCode: "ID-JK",
    regionName: "DKI Jakarta",
    year: 2026,
    amount: 5_729_876,
    decreeRef: "Kepgub DKI 1142/2025",
  },
  {
    regionCode: "ID-JB",
    regionName: "Jawa Barat",
    year: 2026,
    amount: 2_317_601,
    decreeRef: null,
  },
];
