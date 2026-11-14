/**
 * SIM-2 S7B-1 — Domain HR lanjutan (§6A–6G): struktur organisasi,
 * riwayat karyawan, parameter HR, absensi & shift, lembur, cuti, dan
 * terminasi/final pay.
 *
 * Prinsip D-25: angka aturan HR (hari kerja per bulan, ambang
 * peringatan kontrak, jatah cuti, daftar alasan berhenti, saklar
 * lembur/cuti ke payroll) adalah KONFIGURASI per perusahaan
 * (hr_parameters / leave_types), bukan konstanta di kode. Berkas ini
 * hanya menyediakan nilai bawaan awal yang dapat diubah admin.
 *
 * Semua fungsi menerima `tx` dan mengasumsikan pemanggil sudah berada
 * di dalam `withCompany` (pola domain repo).
 */

// A-24 Tahap T4B: indeks modul hasil pemecahan src/server/hr.ts.
// Mengekspor ulang persis API publik berkas asal.

export { loadHrPayrollConfig } from "./shared";
export { DEFAULT_TERMINATION_REASONS, HR_PARAMETER_DEFAULTS, seedHrDefaults, getHrParameters, hrParamBool, hrParamNumber, getTerminationReasons, setHrParameter } from "./parameters";
export type { TerminationReason } from "./parameters";
export { saveDepartment, setDepartmentActive, saveJobPosition, setJobPositionActive } from "./org";
export { recordEmployeeHistory, buildEmployeeHistoryDiff, listExpiringContracts } from "./employees";
export type { EmployeeHistoryDraft, ExpiringContract } from "./employees";
export { ATTENDANCE_STATUSES, saveWorkShift, setWorkShiftActive, assignEmployeeShift, getShiftAssignmentForDate, recordAttendance, importAttendanceCsv, getAttendanceRecap } from "./attendance";
export type { AttendanceStatus, ShiftAssignmentView, AttendanceImportResult, AttendanceRecapRow } from "./attendance";
export { submitOvertimeRequest, decideOvertimeRequest, getApprovedOvertimeForPeriod, computeApprovedOvertimePay } from "./overtime";
export type { ApprovedOvertime } from "./overtime";
export { computeThrDrafts, peekComponentDrafts, markComponentDraftsConsumed, restoreComponentDrafts, voidComponentDraft } from "./drafts";
export { payPayrollRun, voidPayrollRun } from "./payroll-runs";
export type { ThrComputation, ComponentDraftView } from "./drafts";
export { DEFAULT_LEAVE_TYPES, ensureDefaultLeaveTypes, saveLeaveType, setLeaveTypeActive, getEmployeeWorkDays, getLeaveBalance, submitLeaveRequest, decideLeaveRequest, getApprovedUnpaidLeaveDays } from "./leave";
export type { LeaveBalance } from "./leave";
export { processFinalPay } from "./final-pay";
export type { FinalPayInput, FinalPayResult } from "./final-pay";
export { listEmployeeOptions, listEmployees, listWorkShifts, listRecentAttendance, listLeaveTypes, listLeaveRequests, countPendingLeaveRequests, listLeaveBalances, listOvertimeRequests, countPendingOvertimeRequests, listThrDrafts, listOrgMasters, listDepartmentOptions, getEmployeeDetail, getPayrollPageData, getPayrollRunDetail, getPayrollSlipData, listPayrollRunsByIds } from "./reads";
export type { LeaveBalanceRow } from "./reads";
