/**
 * Skema domain: SDM (karyawan, struktur organisasi, presensi, cuti, kasbon, pinjaman, klaim).
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
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounting";
import { branches } from "./platform";

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    position: text("position"),
    baseSalary: numeric("base_salary", { precision: 19, scale: 4 }).notNull().default("0"),
    allowances: numeric("allowances", { precision: 19, scale: 4 }).notNull().default("0"),
    deductions: numeric("deductions", { precision: 19, scale: 4 }).notNull().default("0"),
    joinedAt: date("joined_at"),
    // SIM-2 S2: field terstruktur untuk engine Payroll Indonesia.
    // Semuanya nullable — karyawan lama tanpa field ini tetap diproses
    // payroll generik; engine hanya memakai field yang terisi.
    nik: text("nik"),
    npwp: text("npwp"),
    ptkpStatus: text("ptkp_status"), // kode status PTKP, mis. TK/0, K/1 (baris di payroll_ptkp_statuses)
    birthDate: date("birth_date"),
    gender: text("gender"), // male | female
    contractType: text("contract_type"), // pkwtt | pkwt | harian | magang
    jkkRiskClass: text("jkk_risk_class"), // very_low | low | medium | high | very_high
    workRegionCode: text("work_region_code"), // kode wilayah upah minimum, mis. ID-JK
    // SIM-2 S7B-1: struktur organisasi & siklus hidup karyawan (§6A/6G).
    // Semuanya nullable — karyawan lama tanpa field ini tetap berjalan.
    departmentId: uuid("department_id").references(() => departments.id),
    positionId: uuid("position_id").references(() => jobPositions.id),
    managerEmployeeId: uuid("manager_employee_id"),
    branchId: uuid("branch_id").references(() => branches.id),
    contractStart: date("contract_start"),
    contractEnd: date("contract_end"),
    // active | terminated — terminasi adalah status tercatat, bukan
    // penghapusan; histori payroll & kasbon tetap terbaca (§6G).
    employmentStatus: text("employment_status").notNull().default("active"),
    terminationDate: date("termination_date"),
    terminationReason: text("termination_reason"), // kode dari konfigurasi hr_parameters.termination_reasons
    terminationNote: text("termination_note"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("employees_company_code_uq").on(t.companyId, t.code)],
);
/* ------------------------------------------------------------------ */
/* SIM-2 S7B-1 — HR lanjutan (§6A–6G): struktur organisasi, riwayat    */
/* karyawan, parameter HR, absensi & shift, lembur, cuti, terminasi.   */
/*                                                                     */
/* Prinsip D-25 berlaku penuh: setiap angka aturan (jatah cuti, hari   */
/* kerja per bulan, ambang peringatan kontrak, daftar alasan berhenti) */
/* hidup di konfigurasi per perusahaan (hr_parameters / leave_types),  */
/* bukan konstanta di kode. Kode hanya menyediakan bawaan awal yang    */
/* dapat diubah admin.                                                 */
/* ------------------------------------------------------------------ */

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("departments_company_code_uq").on(t.companyId, t.code)],
);
export const jobPositions = pgTable(
  "job_positions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_positions_company_code_uq").on(t.companyId, t.code)],
);
/**
 * Riwayat perubahan karyawan (§6A): satu baris per perubahan kelompok
 * field (position | department | base_salary | contract | branch |
 * manager | status), berisi snapshot before/after agar perubahan
 * gaji/jabatan tidak pernah menimpa jejak lama. Run payroll lama tidak
 * terpengaruh — mereka membaca snapshot payroll_items, bukan master.
 */
export const employeeHistory = pgTable(
  "employee_history",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fieldGroup: text("field_group").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    effectiveDate: date("effective_date").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("employee_history_company_employee_idx").on(t.companyId, t.employeeId, t.effectiveDate)],
);
/**
 * Parameter HR per perusahaan (kunci-nilai bertanggal efektif, pola
 * yang sama dengan payroll_statutory_parameters tetapi nilainya teks
 * agar dapat menampung angka, saklar, dan daftar JSON). Kunci yang
 * dikenal kode: working_days_per_month, overtime_payroll_enabled,
 * unpaid_leave_payroll_enabled, leave_carry_over_enabled,
 * contract_expiry_warning_days, termination_reasons (JSON).
 */
export const hrParameters = pgTable(
  "hr_parameters",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("hr_parameters_company_key_from_uq").on(t.companyId, t.key, t.effectiveFrom),
    index("hr_parameters_company_idx").on(t.companyId, t.key),
  ],
);
/**
 * Master shift (§6B): jam masuk/pulang + pola hari kerja (weekday
 * 0=Minggu … 6=Sabtu, disimpan sebagai array JSON). Semua nilai adalah
 * konfigurasi perusahaan — tidak ada pola shift yang diasumsikan kode.
 */
export const workShifts = pgTable(
  "work_shifts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    workDays: jsonb("work_days").$type<number[]>().notNull(),
    crossesMidnight: boolean("crosses_midnight").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("work_shifts_company_code_uq").on(t.companyId, t.code)],
);
/** Penugasan shift per karyawan bertanggal efektif (riwayat penugasan terjaga). */
export const employeeShiftAssignments = pgTable(
  "employee_shift_assignments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => workShifts.id),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_shift_assignments_company_employee_idx").on(t.companyId, t.employeeId, t.effectiveFrom),
  ],
);
/**
 * Catatan absensi harian (§6B): satu baris per karyawan per tanggal.
 * Absensi TIDAK mengubah payroll secara diam-diam — ia hanya menjadi
 * dasar fitur yang saklarnya diaktifkan (cuti di Batch 4 menulis baris
 * berstatus leave dari pengajuan yang disahkan).
 */
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: text("status").notNull(), // present | permit | sick | leave | absent
    checkIn: time("check_in"),
    checkOut: time("check_out"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    note: text("note"),
    source: text("source").notNull().default("manual"), // manual | import | leave
    leaveRequestId: uuid("leave_request_id").references(() => leaveRequests.id),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attendance_records_company_employee_date_uq").on(t.companyId, t.employeeId, t.date),
    index("attendance_records_company_date_idx").on(t.companyId, t.date),
  ],
);
/**
 * Pengajuan lembur (§6D): diajukan → disahkan/ditolak atasan (penyetuju
 * tercatat). Hanya lembur BERSTATUS approved pada periode run yang
 * menjadi upah lembur, dan hanya bila saklar perusahaan
 * `overtime_payroll_enabled` aktif. Pengali & dasar upah membaca
 * konfigurasi Payroll Indonesia (payroll_overtime_rules), bukan kode.
 */
export const overtimeRequests = pgTable(
  "overtime_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    dayType: text("day_type").notNull(), // workday | rest_5day | rest_6day | shortest_day_6day
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("overtime_requests_company_employee_idx").on(t.companyId, t.employeeId, t.date),
    index("overtime_requests_company_status_idx").on(t.companyId, t.status),
  ],
);
/**
 * Draf komponen payroll hasil perhitungan khusus (saat ini: THR).
 * Draf TIDAK memposting jurnal apa pun — ia menjadi baris bernama di
 * run payroll periode yang sama saat run berjalan, lalu berstatus
 * consumed; void run mengembalikannya ke draft (pola kasbon).
 */
export const payrollComponentDrafts = pgTable(
  "payroll_component_drafts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // thr
    period: text("period").notNull(), // YYYY-MM — periode run yang akan memuatnya
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    basisSnapshot: jsonb("basis_snapshot").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("draft"), // draft | consumed | void
    consumedRunId: uuid("consumed_run_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payroll_component_drafts_company_period_idx").on(t.companyId, t.period, t.status),
    // Satu draf aktif per karyawan/jenis/periode — hitung ulang
    // mem-void draf lama sebelum membuat yang baru.
    uniqueIndex("payroll_component_drafts_active_uq")
      .on(t.companyId, t.employeeId, t.kind, t.period)
      .where(sql`${t.status} = 'draft'`),
  ],
);
/**
 * Jenis cuti terkonfigurasi (§6C): jatah hari per tahun (null = tanpa
 * jatah/tidak dibatasi saldo), berbayar atau tidak. Nilai bawaan yang
 * ditanam domain adalah kebijakan awal perusahaan yang dapat diubah
 * admin — bukan angka regulasi yang dikunci kode.
 */
export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    daysPerYear: numeric("days_per_year", { precision: 8, scale: 2 }),
    isPaid: boolean("is_paid").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leave_types_company_code_uq").on(t.companyId, t.code)],
);
/**
 * Pengajuan cuti (§6C): saldo tidak pernah negatif — pengajuan yang
 * melebihi saldo ditolak saat diajukan dan diperiksa ulang saat
 * disahkan. Cuti yang disahkan menulis catatan absensi berstatus
 * leave; cuti tidak berbayar yang disahkan menjadi potongan bernama
 * di payroll bila saklar perusahaan aktif.
 */
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: numeric("days", { precision: 8, scale: 2 }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_requests_company_employee_idx").on(t.companyId, t.employeeId, t.startDate),
    index("leave_requests_company_status_idx").on(t.companyId, t.status),
  ],
);
export const employeeAdvances = pgTable(
  "employee_advances",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    employeeId: uuid("employee_id").notNull(),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    remainingAmount: numeric("remaining_amount", { precision: 19, scale: 4 }).notNull(),
    accountId: uuid("account_id").notNull(), // akun kas/bank sumber dana
    // Rencana potongan fleksibel (D-22): full | fixed | percent.
    // plan_value = nominal cicilan (fixed) atau persen 1–100 (percent).
    planMode: text("plan_mode").notNull().default("full"),
    planValue: numeric("plan_value", { precision: 19, scale: 4 }),
    note: text("note"),
    status: text("status").notNull().default("open"), // open | settled | void
    journalId: uuid("journal_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_advances_company_number_uq").on(t.companyId, t.number),
    index("employee_advances_company_employee_idx").on(t.companyId, t.employeeId, t.status),
    index("employee_advances_company_date_idx").on(t.companyId, t.date),
  ],
);
export const employeeAdvanceEntries = pgTable(
  "employee_advance_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    advanceId: uuid("advance_id")
      .notNull()
      .references(() => employeeAdvances.id, { onDelete: "cascade" }),
    // payroll_deduction | repayment | payroll_reversal
    kind: text("kind").notNull(),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    accountId: uuid("account_id"), // akun kas/bank tujuan setoran (repayment)
    journalId: uuid("journal_id"),
    payrollRunId: uuid("payroll_run_id"),
    reversalOfId: uuid("reversal_of_id"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_advance_entries_advance_idx").on(t.advanceId),
    index("employee_advance_entries_company_employee_idx").on(t.companyId, t.advanceId),
    index("employee_advance_entries_run_idx").on(t.payrollRunId),
  ],
);
/**
 * SIM-2 S7B-2 (§6F): Pinjaman Karyawan — fasilitas kredit karyawan yang
 * SENGAJA terpisah dari kasbon (employee_advances). Kasbon adalah uang
 * muka operasional jangka pendek; pinjaman adalah kredit terjadwal
 * dengan tenor. Keduanya piutang karyawan tetapi tidak pernah berbagi
 * dokumen, entri, atau baris payroll. Piutang pinjaman memakai pemetaan
 * `employee_loan_receivable` bila perusahaan memetakannya, dan jatuh
 * kembali ke `employee_receivable` (1220) bila tidak — tidak pernah
 * menebak akun lain. Rencana cicilan mengikuti pola kasbon (D-22):
 * - `tenor`: plan_value = jumlah bulan; cicilan = pokok ÷ bulan
 *   (cicilan terakhir menyerap sisa pembulatan);
 * - `fixed`: plan_value = nominal cicilan per periode.
 * Pinjaman di repo ini tanpa bunga — tidak ada kolom bunga karena tidak
 * ada kebijakan bunga yang dimandatkan; mencatatnya sebagai nol persen
 * secara eksplisit lewat ketiadaan komponen bunga di jurnal.
 */
export const employeeLoans = pgTable(
  "employee_loans",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    remainingAmount: numeric("remaining_amount", { precision: 19, scale: 4 }).notNull(),
    accountId: uuid("account_id").notNull(), // akun kas/bank sumber dana
    planMode: text("plan_mode").notNull().default("tenor"), // tenor | fixed
    planValue: numeric("plan_value", { precision: 19, scale: 4 }),
    note: text("note"),
    status: text("status").notNull().default("open"), // open | settled | void
    journalId: uuid("journal_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_loans_company_number_uq").on(t.companyId, t.number),
    index("employee_loans_company_employee_idx").on(t.companyId, t.employeeId, t.status),
    index("employee_loans_company_date_idx").on(t.companyId, t.date),
  ],
);
export const employeeLoanEntries = pgTable(
  "employee_loan_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => employeeLoans.id, { onDelete: "cascade" }),
    // payroll_deduction | repayment | payroll_reversal
    kind: text("kind").notNull(),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    accountId: uuid("account_id"), // akun kas/bank tujuan setoran (repayment)
    journalId: uuid("journal_id"),
    payrollRunId: uuid("payroll_run_id"),
    reversalOfId: uuid("reversal_of_id"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_loan_entries_loan_idx").on(t.loanId),
    index("employee_loan_entries_run_idx").on(t.payrollRunId),
  ],
);
/**
 * SIM-2 S7B-2 (§6F): Reimbursement — klaim biaya karyawan dengan
 * persetujuan atasan. Perbedaan akuntansi yang ditegakkan domain:
 * klaim yang DISAHKAN adalah BEBAN perusahaan (Dr akun beban kategori
 * klaim / Cr kas saat dibayar) — tidak pernah menjadi piutang karyawan
 * dan tidak pernah menyentuh akun 1220. Klaim ditolak tidak dapat
 * dibayar; nominal disahkan boleh berbeda dari yang diajukan dan
 * selisihnya tercatat (approved_amount vs amount).
 */
export const reimbursementClaims = pgTable(
  "reimbursement_claims",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    number: text("number").notNull(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    date: date("date").notNull(),
    // Kategori beban = akun COA bertipe expense yang dipilih pengaju.
    expenseAccountId: uuid("expense_account_id").notNull().references(() => accounts.id),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    // A-21 (R3-10, migrasi 0049): tarif PPN yang dibekukan saat
    // pengajuan bila klaim ditandai "termasuk PPN" (pola expenses:
    // amount adalah bruto yang dibayar karyawan; 0 = tanpa PPN).
    // Porsi pajak dihitung ulang dari tarif ini atas nominal yang
    // DISAHKAN saat pembayaran, jadi pengurangan nominal oleh
    // pengesah tetap terbelah proporsional.
    taxRate: numeric("tax_rate", { precision: 7, scale: 4 }).notNull().default("0"),
    approvedAmount: numeric("approved_amount", { precision: 19, scale: 4 }),
    description: text("description").notNull(),
    // Lampiran disimpan sebagai nama berkas + catatan (penyimpanan
    // berkas biner bukan bagian dari fase ini — lihat laporan S7B-2).
    attachmentName: text("attachment_name"),
    attachmentNote: text("attachment_note"),
    // submitted | approved | rejected | paid
    status: text("status").notNull().default("submitted"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    paymentAccountId: uuid("payment_account_id"),
    paidDate: date("paid_date"),
    journalId: uuid("journal_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reimbursement_claims_company_number_uq").on(t.companyId, t.number),
    index("reimbursement_claims_company_employee_idx").on(t.companyId, t.employeeId, t.status),
    index("reimbursement_claims_company_status_idx").on(t.companyId, t.status, t.date),
  ],
);
