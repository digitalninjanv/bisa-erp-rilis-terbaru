// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  and,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  employees,
  payrollComponentDrafts,
  payrollItemLines,
  payrollItems,
  payrollRuns,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  d,
  toDb,
  Decimal,
} from "@/lib/money";
import {
  countWorkdays,
  periodRange,
} from "@/lib/hr";
import {
  getAccountId,
  getAccountMap,
  postJournal,
} from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import {
  applyPayrollAdvanceDeductions,
  getOpenAdvanceTotal,
} from "@/server/employee-advances";
import {
  applyPayrollLoanDeductions,
  getLoanReceivableAccountId,
  getOpenLoanTotal,
} from "@/server/employee-loans";
import {
  computeEmployeeStatutory,
  ensurePayrollIndonesiaAccounts,
  getEmployeeEnrollments,
  getYearToDateFigures,
  loadStatutoryConfig,
  type EmployeeStatutoryResult,
  type StatutoryLineDraft,
} from "@/server/payroll-indonesia";
import { nextDocumentNumber } from "@/server/sequences";
import { peekComponentDrafts } from "./drafts";
import { buildEmployeeHistoryDiff, recordEmployeeHistory } from "./employees";
import { getApprovedUnpaidLeaveDays, getEmployeeWorkDays } from "./leave";
import { computeApprovedOvertimePay } from "./overtime";
import { getHrParameters, getTerminationReasons, hrParamBool, hrParamNumber } from "./parameters";
import { loadHrPayrollConfig } from "./shared";
import type { EmployeeRow } from "./shared";

export interface FinalPayInput {
  companyId: string;
  userId: string;
  employeeId: string;
  /** Periode run akhir (YYYY-MM) — bawaan: bulan tanggal berhenti. */
  period: string;
  /** true: proses ini sekaligus mencatat pemberhentian karyawan. */
  terminateNow: boolean;
  terminationDate?: string;
  terminationReason?: string;
  terminationNote?: string | null;
  /**
   * Penegasan eksplisit tercatat: sisa kasbon/pinjaman yang melebihi
   * pembayaran akhir tetap menjadi piutang terbuka (tidak dipotong
   * paksa sampai bersih negatif).
   */
  acknowledgeShortfall?: boolean;
}

export interface FinalPayResult {
  runId: string;
  number: string;
  period: string;
  net: string;
  advanceCharged: string;
  loanCharged: string;
  leftoverReceivable: string;
  prorataFactor: string;
}

/**
 * Pembayaran akhir karyawan berhenti (§6G): run khusus kind='final'
 * dengan gaji PRORATA hari kerja terpakai, PPh 21 mode masa terakhir
 * (isFinalPeriod — hitung ulang tahunan) bila engine S2 aktif, lembur/
 * THR/cuti tak berbayar mengikuti saklar yang sama seperti run reguler,
 * dan sisa kasbon ditagihkan PENUH sampai batas bersih (kelebihannya
 * hanya boleh dibiarkan terbuka dengan penegasan eksplisit tercatat).
 * Karyawan yang sudah masuk run reguler non-void periode yang sama
 * ditolak — void run reguler itu dulu atau pilih periode lain.
 * Jurnal & snapshot meniru run reguler persis (sourceType "payroll")
 * agar pembayaran (pay) dan pembatalan (void) generik tetap berlaku.
 */
export async function processFinalPay(tx: Tx, input: FinalPayInput): Promise<FinalPayResult> {
  const { companyId, userId, employeeId, period } = input;
  const { start: periodStart, end: periodEnd } = periodRange(period);
  const [employee] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)))
    .limit(1);
  if (!employee) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");

  const [existingFinal] = await tx
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.companyId, companyId),
        eq(payrollRuns.employeeId, employeeId),
        eq(payrollRuns.kind, "final"),
        sql`${payrollRuns.status} <> 'void'`,
      ),
    )
    .limit(1);
  if (existingFinal) {
    throw new AppError(
      "VALIDATION",
      "Karyawan ini sudah memiliki pembayaran akhir. Void pembayaran akhir lama sebelum membuat yang baru.",
    );
  }
  const [inRegularRun] = await tx
    .select({ id: payrollItems.id })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollItems.runId, payrollRuns.id))
    .where(
      and(
        eq(payrollItems.companyId, companyId),
        eq(payrollItems.employeeId, employeeId),
        eq(payrollRuns.period, period),
        eq(payrollRuns.kind, "regular"),
        sql`${payrollRuns.status} <> 'void'`,
      ),
    )
    .limit(1);
  if (inRegularRun) {
    throw new AppError(
      "VALIDATION",
      `Karyawan sudah tercakup run reguler periode ${period}. Void run reguler tersebut atau jalankan pembayaran akhir pada periode berikutnya.`,
    );
  }

  const hrParams = await getHrParameters(tx, companyId, periodEnd);
  let terminationDate = employee.terminationDate;
  let terminationReason = employee.terminationReason;
  if (input.terminateNow) {
    if (!employee.isActive || employee.employmentStatus === "terminated") {
      throw new AppError("VALIDATION", "Karyawan sudah tidak aktif.");
    }
    if (!input.terminationDate || !input.terminationReason) {
      throw new AppError("VALIDATION", "Tanggal dan alasan berhenti wajib diisi.");
    }
    const reasons = getTerminationReasons(hrParams);
    if (!reasons.some((reason) => reason.code === input.terminationReason)) {
      throw new AppError("VALIDATION", "Alasan berhenti tidak ada di konfigurasi perusahaan.");
    }
    if (employee.joinedAt && input.terminationDate < employee.joinedAt) {
      throw new AppError("VALIDATION", "Tanggal berhenti tidak boleh sebelum tanggal bergabung.");
    }
    terminationDate = input.terminationDate;
    terminationReason = input.terminationReason;
  } else if (employee.employmentStatus !== "terminated" || !terminationDate) {
    throw new AppError("VALIDATION", "Karyawan belum tercatat berhenti.");
  }
  const stopDate = terminationDate as string;

  /* Prorata menurut hari kerja terpakai pada pola kerja karyawan. */
  const workDays = await getEmployeeWorkDays(tx, companyId, employeeId, periodStart);
  const from = employee.joinedAt && employee.joinedAt > periodStart ? employee.joinedAt : periodStart;
  const to = stopDate < periodEnd ? stopDate : periodEnd;
  const totalWorkdays = countWorkdays(periodStart, periodEnd, workDays);
  const workedDays = to >= from ? countWorkdays(from, to, workDays) : 0;
  const factor = totalWorkdays > 0 ? d(workedDays).div(totalWorkdays) : d(1);
  const fullBase = d(employee.baseSalary);
  const fullAllowances = d(employee.allowances);
  const fullGross = fullBase.plus(fullAllowances);
  const proratedBase = fullBase.mul(factor);
  const proratedAllowances = fullAllowances.mul(factor);
  const proratedGross = proratedBase.plus(proratedAllowances);
  const regularDeductions = d(employee.deductions);

  /* Komponen HR periode ini — jalur yang sama seperti run reguler. */
  const extraLines: StatutoryLineDraft[] = [];
  let overtimeAmount = d(0);
  if (hrParamBool(hrParams, "overtime_payroll_enabled")) {
    const hrConfig = await loadHrPayrollConfig(tx, companyId, periodStart);
    const overtime = await computeApprovedOvertimePay(tx, {
      companyId,
      employeeId,
      period,
      monthlyWage: fullGross,
      config: hrConfig,
    });
    if (overtime.amount.gt(0)) {
      overtimeAmount = overtime.amount;
      extraLines.push({
        code: "overtime",
        label: "Upah lembur",
        category: "earning",
        amount: overtime.amount,
        basisAmount: overtime.approved.totalHours,
        deductibleAnnual: false,
        basisSnapshot: {
          entries: overtime.approved.entries,
          requestIds: overtime.approved.requestIds,
          totalHours: overtime.approved.totalHours.toString(),
          hourlyWage: toDb(overtime.hourlyWage),
          monthlyWage: toDb(fullGross),
        },
      });
    }
  }
  const thrDrafts = await peekComponentDrafts(tx, { companyId, period, kind: "thr" });
  const thrEntry = thrDrafts.get(employeeId);
  const thrAmount = thrEntry?.amount ?? d(0);
  if (thrAmount.gt(0)) {
    extraLines.push({
      code: "thr",
      label: "THR",
      category: "earning",
      amount: thrAmount,
      basisAmount: null,
      deductibleAnnual: false,
      basisSnapshot: { draftIds: thrEntry?.draftIds ?? [] },
    });
  }
  const extraEarnings = overtimeAmount.plus(thrAmount);

  let unpaidLeaveAmount = d(0);
  if (hrParamBool(hrParams, "unpaid_leave_payroll_enabled")) {
    const unpaidDays = await getApprovedUnpaidLeaveDays(tx, companyId, employeeId, period);
    if (unpaidDays.gt(0)) {
      const workingDays = hrParamNumber(hrParams, "working_days_per_month", 22);
      const dailyRate = workingDays > 0 ? fullGross.div(workingDays) : d(0);
      unpaidLeaveAmount = dailyRate.mul(unpaidDays).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      extraLines.push({
        code: "unpaid_leave",
        label: "Potongan cuti tidak berbayar",
        category: "deduction",
        amount: unpaidLeaveAmount,
        basisAmount: unpaidDays,
        deductibleAnnual: false,
        basisSnapshot: {
          days: unpaidDays.toString(),
          workingDaysPerMonth: workingDays,
          monthlyWage: toDb(fullGross),
          dailyRate: toDb(dailyRate),
        },
      });
    }
  }
  const allDeductions = regularDeductions.plus(unpaidLeaveAmount);

  // SIM-2 S2: pembayaran akhir adalah masa pajak terakhir — PPh 21
  // dihitung ulang setahun (Pasal 17) memakai YTD Jan–bulan ini,
  // bukan tarif TER bulanan. Iuran pekerja (JHT/JP/BPJS) juga tetap
  // dipotong dari pembayaran akhir dan menjadi utang BPJS.
  const periodYear = Number(period.slice(0, 4));
  const statutoryConfig = await loadStatutoryConfig(tx, companyId, `${period}-01`);
  let statutory: EmployeeStatutoryResult | null = null;
  if (statutoryConfig) {
    await ensurePayrollIndonesiaAccounts(tx, companyId);
    const enrollments = await getEmployeeEnrollments(tx, companyId, [employeeId]);
    const ytd = await getYearToDateFigures(tx, companyId, employeeId, periodYear);
    statutory = computeEmployeeStatutory({
      config: statutoryConfig,
      employee: {
        ...employee,
        baseSalary: proratedBase,
        allowances: proratedAllowances,
      },
      enrollments: enrollments.get(employeeId),
      isFinalPeriod: true,
      ytd,
      taxableExtra: extraEarnings,
    });
  }
  const statutoryDeductions = statutory
    ? statutory.employeeTotal.plus(statutory.pphAmount)
    : d(0);

  const netBeforeAdvance = proratedGross
    .plus(extraEarnings)
    .minus(allDeductions)
    .minus(statutoryDeductions);
  if (netBeforeAdvance.lt(0)) {
    throw new AppError(
      "VALIDATION",
      `Pembayaran akhir ${employee.name} negatif (Rp${netBeforeAdvance.toFixed(0)}) — periksa potongan/cuti tidak berbayar sebelum memproses.`,
    );
  }

  /* Kasbon ditagihkan penuh sampai batas bersih, lalu sisa PINJAMAN
     ditagih dari sisanya (SIM-2 S7B-2 §6F — titik integrasi final pay
     diperluas dari kasbon saja menjadi kedua produk piutang). */
  const remainingAdvance = await getOpenAdvanceTotal(tx, companyId, employeeId);
  const advanceCharge = Decimal.min(remainingAdvance, netBeforeAdvance);
  const remainingLoan = await getOpenLoanTotal(tx, companyId, employeeId);
  const loanCharge = Decimal.min(remainingLoan, netBeforeAdvance.minus(advanceCharge));
  const leftover = remainingAdvance
    .minus(advanceCharge)
    .plus(remainingLoan.minus(loanCharge));
  if (leftover.gt(0) && !input.acknowledgeShortfall) {
    throw new AppError(
      "VALIDATION",
      `Sisa kasbon/pinjaman ${employee.name} Rp${remainingAdvance.plus(remainingLoan).toFixed(0)} melebihi pembayaran akhir Rp${netBeforeAdvance.toFixed(0)}. Lunasi sebagian di luar payroll, atau beri penegasan eksplisit agar sisa Rp${leftover.toFixed(0)} tetap menjadi piutang terbuka.`,
    );
  }
  const net = netBeforeAdvance.minus(advanceCharge).minus(loanCharge);
  const totalGross = proratedGross.plus(extraEarnings);

  const lines: StatutoryLineDraft[] = [
    ...(statutory?.lines ?? []),
    ...extraLines,
  ];
  if (factor.lt(1)) {
    lines.push({
      code: "final_prorata",
      label: "Prorata pembayaran akhir (hari kerja terpakai)",
      category: "info",
      amount: proratedGross,
      basisAmount: factor,
      deductibleAnnual: false,
      basisSnapshot: {
        workedDays,
        totalWorkdays,
        fullBaseSalary: toDb(fullBase),
        fullAllowances: toDb(fullAllowances),
        terminationDate: stopDate,
      },
    });
  }
  if (loanCharge.gt(0)) {
    lines.push({
      code: "loan_installment",
      label: "Pelunasan pinjaman (pembayaran akhir)",
      category: "deduction",
      amount: loanCharge,
      basisAmount: null,
      deductibleAnnual: false,
      basisSnapshot: { finalPay: true, remainingBefore: toDb(remainingLoan) },
    });
  }

  const number = await nextDocumentNumber(tx, companyId, "PAYROLL", periodEnd);
  const [run] = await tx
    .insert(payrollRuns)
    .values({
      companyId,
      number,
      period,
      kind: "final",
      employeeId,
      totalGross: toDb(totalGross),
      totalDeductions: toDb(allDeductions),
      totalAdvanceDeductions: toDb(advanceCharge),
      totalLoanDeductions: toDb(loanCharge),
      totalPph21: toDb(statutory?.pphAmount ?? 0),
      totalStatutoryEmployee: toDb(statutory?.employeeTotal ?? 0),
      totalEmployerContributions: toDb(statutory?.employerCostTotal ?? 0),
      totalNet: toDb(net),
      createdBy: userId,
      postedAt: new Date(),
    })
    .returning({ id: payrollRuns.id, number: payrollRuns.number });

  const [item] = await tx
    .insert(payrollItems)
    .values({
      companyId,
      runId: run.id,
      employeeId,
      baseSalary: toDb(proratedBase),
      allowances: toDb(proratedAllowances.plus(extraEarnings)),
      deductions: toDb(allDeductions),
      advanceDeduction: toDb(advanceCharge),
      loanDeduction: toDb(loanCharge),
      net: toDb(net),
    })
    .returning({ id: payrollItems.id });

  if (lines.length > 0) {
    await tx.insert(payrollItemLines).values(
      lines.map((line) => ({
        companyId,
        runId: run.id,
        itemId: item.id,
        employeeId,
        code: line.code,
        label: line.label,
        category: line.category,
        amount: toDb(line.amount),
        basisAmount: line.basisAmount === null ? null : toDb(line.basisAmount),
        deductibleAnnual: line.deductibleAnnual,
        basisSnapshot: line.basisSnapshot,
      })),
    );
  }

  const map = await getAccountMap(tx, companyId);
  const deductionsAccountId = map.salary_deductions_payable ?? map.salary_payable;
  const advanceAccountId = advanceCharge.gt(0)
    ? await getAccountId(tx, companyId, "employee_receivable")
    : null;
  const loanAccountId = loanCharge.gt(0)
    ? await getLoanReceivableAccountId(tx, companyId)
    : null;
  // FIX-P1 (AK4-05): perlakuan yang sama seperti run reguler — cuti
  // tidak berbayar adalah pengurang bruto, BUKAN utang. Beban dibebankan
  // sebesar bruto efektif dan utang potongan hanya memuat potongan
  // reguler; bersih karyawan tidak berubah.
  const journalLines: Array<{
    accountId: string;
    debit?: Decimal;
    credit?: Decimal;
    description: string;
  }> = [
    {
      accountId: map.salary_expense,
      debit: totalGross.minus(unpaidLeaveAmount),
      description: unpaidLeaveAmount.gt(0)
        ? `Beban pembayaran akhir ${employee.name} (sesudah pengurang cuti tidak berbayar ${unpaidLeaveAmount.toFixed(0)})`
        : `Beban pembayaran akhir ${employee.name}`,
    },
    { accountId: map.salary_payable, credit: net, description: "Utang gaji pembayaran akhir" },
    {
      accountId: deductionsAccountId,
      credit: allDeductions.minus(unpaidLeaveAmount),
      description: "Utang potongan pembayaran akhir",
    },
    ...(advanceAccountId
      ? [{ accountId: advanceAccountId, credit: advanceCharge, description: "Pelunasan kasbon dari pembayaran akhir" }]
      : []),
    ...(loanAccountId
      ? [{ accountId: loanAccountId, credit: loanCharge, description: "Pelunasan pinjaman dari pembayaran akhir" }]
      : []),
  ];
  if (statutory && (statutory.employeeTotal.gt(0) || statutory.employerCostTotal.gt(0))) {
    const bpjsPayableId = await getAccountId(tx, companyId, "bpjs_payable");
    if (statutory.employerCostTotal.gt(0)) {
      const employerExpenseId = await getAccountId(tx, companyId, "payroll_employer_expense");
      journalLines.push({
        accountId: employerExpenseId,
        debit: statutory.employerCostTotal,
        description: "Beban iuran BPJS perusahaan (pembayaran akhir)",
      });
    }
    journalLines.push({
      accountId: bpjsPayableId,
      credit: statutory.employeeTotal.plus(statutory.employerCostTotal),
      description: "Utang iuran BPJS (pembayaran akhir)",
    });
  }
  if (statutory && !statutory.pphAmount.isZero()) {
    const pphPayableId = await getAccountId(tx, companyId, "pph21_payable");
    if (statutory.pphAmount.gt(0)) {
      journalLines.push({
        accountId: pphPayableId,
        credit: statutory.pphAmount,
        description: "Utang PPh 21 (pembayaran akhir)",
      });
    } else {
      journalLines.push({
        accountId: pphPayableId,
        debit: statutory.pphAmount.abs(),
        description: "Kelebihan potongan PPh 21 dikembalikan (pembayaran akhir)",
      });
    }
  }
  const payrollEntry = await postJournal(tx, {
    companyId,
    date: periodEnd,
    description: `Pembayaran akhir ${employee.name} ${period} (${number})`,
    sourceType: "payroll",
    sourceId: run.id,
    createdBy: userId,
    idempotencyKey: `payroll:${run.id}`,
    lines: journalLines,
  });

  if (advanceCharge.gt(0)) {
    await applyPayrollAdvanceDeductions(tx, {
      companyId,
      userId,
      runId: run.id,
      journalId: payrollEntry.id,
      date: periodEnd,
      deductions: new Map([[employeeId, advanceCharge]]),
    });
  }
  if (loanCharge.gt(0)) {
    await applyPayrollLoanDeductions(tx, {
      companyId,
      userId,
      runId: run.id,
      journalId: payrollEntry.id,
      date: periodEnd,
      deductions: new Map([[employeeId, loanCharge]]),
    });
  }
  if (thrEntry && thrEntry.draftIds.length > 0) {
    // Hanya draf karyawan ini yang terpakai (berbeda dari run reguler
    // yang mengonsumsi seluruh draf periode).
    await tx
      .update(payrollComponentDrafts)
      .set({ status: "consumed", consumedRunId: run.id })
      .where(
        and(
          eq(payrollComponentDrafts.companyId, companyId),
          eq(payrollComponentDrafts.status, "draft"),
          inArray(payrollComponentDrafts.id, thrEntry.draftIds),
        ),
      );
  }

  if (input.terminateNow) {
    const updatedEmployee: EmployeeRow = {
      ...employee,
      isActive: false,
      employmentStatus: "terminated",
      terminationDate: stopDate,
      terminationReason,
      terminationNote: input.terminationNote ?? null,
    };
    await tx
      .update(employees)
      .set({
        isActive: false,
        employmentStatus: "terminated",
        terminationDate: stopDate,
        terminationReason,
        terminationNote: input.terminationNote ?? null,
      })
      .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)));
    const drafts = await buildEmployeeHistoryDiff(tx, companyId, employee, updatedEmployee);
    await recordEmployeeHistory(tx, {
      companyId,
      employeeId,
      userId,
      effectiveDate: stopDate,
      note: `Pembayaran akhir ${number}; kasbon tertagih Rp${advanceCharge.toFixed(0)}; pinjaman tertagih Rp${loanCharge.toFixed(0)}; sisa piutang terbuka Rp${leftover.toFixed(0)}.`,
      drafts,
    });
  }

  await writeAudit(tx, {
    companyId,
    userId,
    action: input.terminateNow ? "employee.terminate_final_pay" : "payroll.final_pay",
    entityType: "payroll_run",
    entityId: run.id,
    after: {
      number,
      period,
      employeeId,
      terminationDate: stopDate,
      terminationReason,
      prorataFactor: factor.toFixed(6),
      net: toDb(net),
      advanceCharged: toDb(advanceCharge),
      loanCharged: toDb(loanCharge),
      leftoverReceivable: toDb(leftover),
      acknowledgeShortfall: Boolean(input.acknowledgeShortfall),
    },
  });

  return {
    runId: run.id,
    number,
    period,
    net: toDb(net),
    advanceCharged: toDb(advanceCharge),
    loanCharged: toDb(loanCharge),
    leftoverReceivable: toDb(leftover),
    prorataFactor: factor.toFixed(6),
  };
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman (FIX-ARS Tahap 6, ARS1-01). Kueri yang dulu inline di
// halaman HR/payroll kini tinggal di modul pemilik konteksnya; badan kueri
// dipindah apa adanya — urutan, batas, dan bentuk baris tidak berubah.
// ---------------------------------------------------------------------------
