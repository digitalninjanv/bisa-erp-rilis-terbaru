/**
 * Skema domain: payroll & statutori Indonesia (run payroll + konfigurasi PPh 21/BPJS).
 * A-26 Q2: pecahan src/db/schema.ts — definisi dipindah utuh, tanpa perubahan.
 * Impor publik tetap lewat barrel "@/db/schema" (src/db/schema.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { employees } from "./hr";

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    period: text("period").notNull(), // YYYY-MM
    // SIM-2 S7B-1: regular = run bulanan semua karyawan aktif;
    // final = pembayaran akhir khusus satu karyawan yang berhenti
    // (§6G) — tidak terhalang keunikan periode run reguler.
    kind: text("kind").notNull().default("regular"), // regular | final
    employeeId: uuid("employee_id").references(() => employees.id),
    status: text("status").notNull().default("posted"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull(),
    totalDeductions: numeric("total_deductions", { precision: 19, scale: 4 }).notNull(),
    // A-11 (D-22): potongan kasbon dipisah dari potongan tetap agar jurnal
    // payroll bisa mengkredit Piutang Karyawan secara eksplisit.
    totalAdvanceDeductions: numeric("total_advance_deductions", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    // SIM-2 S7B-2 (§6F): cicilan pinjaman karyawan pada run ini — baris
    // jurnal & snapshot terpisah dari kasbon agar kedua produk piutang
    // karyawan tidak pernah tercampur dalam laporan.
    totalLoanDeductions: numeric("total_loan_deductions", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    // SIM-2 S2: total komponen statutory Indonesia pada run ini (0 untuk
    // payroll generik). Rinciannya per karyawan ada di payroll_item_lines.
    totalPph21: numeric("total_pph21", { precision: 19, scale: 4 }).notNull().default("0"),
    totalStatutoryEmployee: numeric("total_statutory_employee", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    totalEmployerContributions: numeric("total_employer_contributions", {
      precision: 19,
      scale: 4,
    })
      .notNull()
      .default("0"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull(),
    createdBy: text("created_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payroll_runs_company_number_uq").on(t.companyId, t.number),
    // AK-P3-03: at most one non-void run per (company, period), enforced by
    // the database — the application check alone races. Partial on purpose:
    // a voided run must not block the legitimate void → re-run correction
    // flow (AK-P2-04), so void rows stay outside the index.
    uniqueIndex("payroll_runs_company_period_uq")
      .on(t.companyId, t.period)
      .where(sql`${t.status} <> 'void' and ${t.kind} = 'regular'`),
    // SIM-2 S7B-1: satu pembayaran akhir non-void per karyawan.
    uniqueIndex("payroll_runs_final_employee_uq")
      .on(t.companyId, t.employeeId)
      .where(sql`${t.status} <> 'void' and ${t.kind} = 'final'`),
  ],
);
export const payrollItems = pgTable(
  "payroll_items",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    baseSalary: numeric("base_salary", { precision: 19, scale: 4 }).notNull(),
    allowances: numeric("allowances", { precision: 19, scale: 4 }).notNull(),
    deductions: numeric("deductions", { precision: 19, scale: 4 }).notNull(),
    // A-11 (D-22): potongan kasbon periode ini (di luar potongan tetap).
    advanceDeduction: numeric("advance_deduction", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    // SIM-2 S7B-2 (§6F): cicilan pinjaman periode ini — terpisah dari
    // advance_deduction; rincian bernama ada di payroll_item_lines
    // (code loan_installment).
    loanDeduction: numeric("loan_deduction", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    net: numeric("net", { precision: 19, scale: 4 }).notNull(),
  },
  (t) => [
    index("payroll_items_run_idx").on(t.runId),
    // SIM-2 S4 (PERF-03): halaman payroll & riwayat per karyawan
    // menyaring payroll_items per perusahaan (dan per karyawan) —
    // sebelumnya hanya (run_id) sehingga baca per perusahaan adalah
    // seq scan atas seluruh riwayat item.
    index("payroll_items_company_employee_idx").on(t.companyId, t.employeeId),
  ],
);
/* ------------------------------------------------------------------ */
/* SIM-2 S2 — Payroll Indonesia: konfigurasi statutory per perusahaan  */
/*                                                                     */
/* Prinsip: TIDAK ADA tarif/batas regulasi di kode. Semua angka hidup  */
/* di tabel-tabel ini sebagai baris bertanggal efektif per perusahaan, */
/* disemai dari src/lib/payroll-indonesia-defaults.ts (sumber: lembar  */
/* fakta docs/sim2/S0-C-HR-PAYROLL.md) dan dapat diubah admin lewat    */
/* Pengaturan → Payroll Indonesia. Engine membaca baris yang efektif   */
/* pada tanggal periode; run yang sudah posted tidak pernah berubah    */
/* karena hasil perhitungan tersnapshot di payroll_item_lines.         */
/* ------------------------------------------------------------------ */

export const payrollStatutorySettings = pgTable("payroll_statutory_settings", {
  companyId: text("company_id").primaryKey(),
  // Saklar utama engine Indonesia. false = payroll berjalan generik
  // persis seperti sebelum S2 (perilaku bawaan semua perusahaan).
  isEnabled: boolean("is_enabled").notNull().default(false),
  // Saklar engine PPh 21 (TER + masa pajak terakhir). Program BPJS
  // punya saklarnya sendiri per baris payroll_statutory_programs.
  pph21Enabled: boolean("pph21_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const payrollPtkpStatuses = pgTable(
  "payroll_ptkp_statuses",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(), // TK/0 … K/3
    annualAmount: numeric("annual_amount", { precision: 19, scale: 4 }).notNull(),
    terCategory: text("ter_category").notNull(), // A | B | C
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("payroll_ptkp_company_code_from_uq").on(t.companyId, t.code, t.effectiveFrom),
    index("payroll_ptkp_company_idx").on(t.companyId, t.code),
  ],
);
export const payrollTerBrackets = pgTable(
  "payroll_ter_brackets",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    category: text("category").notNull(), // A | B | C
    lowerBound: numeric("lower_bound", { precision: 19, scale: 4 }).notNull(),
    upperBound: numeric("upper_bound", { precision: 19, scale: 4 }),
    rate: numeric("rate", { precision: 7, scale: 4 }).notNull(), // persen
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("payroll_ter_company_cat_lower_from_uq").on(
      t.companyId,
      t.category,
      t.lowerBound,
      t.effectiveFrom,
    ),
    index("payroll_ter_company_idx").on(t.companyId, t.category),
  ],
);
export const payrollTaxBrackets = pgTable(
  "payroll_tax_brackets",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    lowerBound: numeric("lower_bound", { precision: 19, scale: 4 }).notNull(),
    upperBound: numeric("upper_bound", { precision: 19, scale: 4 }),
    rate: numeric("rate", { precision: 7, scale: 4 }).notNull(), // persen
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("payroll_tax_brackets_company_lower_from_uq").on(
      t.companyId,
      t.lowerBound,
      t.effectiveFrom,
    ),
    index("payroll_tax_brackets_company_idx").on(t.companyId),
  ],
);
export const payrollStatutoryPrograms = pgTable(
  "payroll_statutory_programs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    program: text("program").notNull(), // bpjs_kes | jht | jkk | jkm | jp | jkp
    riskClass: text("risk_class"), // khusus JKK; null untuk program lain
    // Saklar per program per perusahaan: nonaktif = tidak dihitung,
    // tidak tampil di slip, tidak dijurnal.
    isEnabled: boolean("is_enabled").notNull().default(true),
    employerRate: numeric("employer_rate", { precision: 7, scale: 4 }).notNull(), // persen
    employeeRate: numeric("employee_rate", { precision: 7, scale: 4 }).notNull(), // persen
    wageCap: numeric("wage_cap", { precision: 19, scale: 4 }),
    wageFloor: numeric("wage_floor", { precision: 19, scale: 4 }),
    // Premi perusahaan program ini menambah penghasilan bruto pajak
    // karyawan (JKK, JKM, BPJS Kesehatan perusahaan = ya; JHT/JP = tidak).
    addsToTaxGross: boolean("adds_to_tax_gross").notNull().default(false),
    // Iuran pekerja program ini mengurangi penghasilan neto pada
    // hitungan tahunan masa pajak terakhir (JHT & JP = ya).
    employeeDeductibleAnnual: boolean("employee_deductible_annual").notNull().default(false),
    // false untuk program yang iurannya bukan beban kas perusahaan
    // (JKP: Pemerintah Pusat + rekomposisi) — tetap dihitung dan
    // dilaporkan, tetapi tidak dijurnal sebagai beban/utang.
    countsAsEmployerCost: boolean("counts_as_employer_cost").notNull().default(true),
    fundingNote: text("funding_note"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("payroll_programs_company_program_risk_from_uq").on(
      t.companyId,
      t.program,
      t.riskClass,
      t.effectiveFrom,
    ),
    index("payroll_programs_company_idx").on(t.companyId, t.program),
  ],
);
export const payrollStatutoryParameters = pgTable(
  "payroll_statutory_parameters",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    key: text("key").notNull(),
    value: numeric("value", { precision: 19, scale: 4 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("payroll_params_company_key_from_uq").on(t.companyId, t.key, t.effectiveFrom),
    index("payroll_params_company_idx").on(t.companyId, t.key),
  ],
);
export const payrollOvertimeRules = pgTable(
  "payroll_overtime_rules",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    dayType: text("day_type").notNull(), // workday | rest_5day | rest_6day | shortest_day_6day
    hourFrom: integer("hour_from").notNull(),
    hourTo: integer("hour_to"),
    multiplier: numeric("multiplier", { precision: 7, scale: 4 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("payroll_overtime_company_type_from_uq").on(
      t.companyId,
      t.dayType,
      t.hourFrom,
      t.effectiveFrom,
    ),
    index("payroll_overtime_company_idx").on(t.companyId, t.dayType),
  ],
);
export const payrollMinimumWages = pgTable(
  "payroll_minimum_wages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    regionCode: text("region_code").notNull(),
    regionName: text("region_name").notNull(),
    year: integer("year").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    decreeRef: text("decree_ref"),
  },
  (t) => [
    uniqueIndex("payroll_min_wages_company_region_year_uq").on(t.companyId, t.regionCode, t.year),
    index("payroll_min_wages_company_idx").on(t.companyId, t.regionCode),
  ],
);
/**
 * Kepesertaan program statutory per karyawan. Ketiadaan baris berarti
 * karyawan IKUT program (bawaan); baris is_enrolled=false adalah
 * pengecualian eksplisit per karyawan per program.
 */
export const employeeStatutoryEnrollments = pgTable(
  "employee_statutory_enrollments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    program: text("program").notNull(),
    isEnrolled: boolean("is_enrolled").notNull().default(true),
  },
  (t) => [
    uniqueIndex("employee_enrollments_company_employee_program_uq").on(
      t.companyId,
      t.employeeId,
      t.program,
    ),
    index("employee_enrollments_company_employee_idx").on(t.companyId, t.employeeId),
  ],
);
/**
 * Snapshot komponen terstruktur per baris item payroll: satu baris per
 * komponen statutory per karyawan per run (iuran pekerja, iuran
 * perusahaan, PPh 21, bruto pajak). `basisAmount` adalah dasar yang
 * dipakai (upah berbatas / bruto pajak) agar agregat year-to-date untuk
 * masa pajak terakhir dapat dijumlahkan langsung dari baris-baris ini;
 * `basisSnapshot` menyimpan tarif & konteks perhitungan untuk audit.
 */
export const payrollItemLines = pgTable(
  "payroll_item_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => payrollItems.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),
    code: text("code").notNull(), // mis. bpjs_kes_employee, jht_employer, pph21, tax_gross
    label: text("label").notNull(),
    category: text("category").notNull(), // statutory_employee | statutory_employer | tax | info
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    basisAmount: numeric("basis_amount", { precision: 19, scale: 4 }),
    deductibleAnnual: boolean("deductible_annual").notNull().default(false),
    basisSnapshot: jsonb("basis_snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payroll_item_lines_run_idx").on(t.runId),
    index("payroll_item_lines_company_employee_idx").on(t.companyId, t.employeeId, t.code),
  ],
);
