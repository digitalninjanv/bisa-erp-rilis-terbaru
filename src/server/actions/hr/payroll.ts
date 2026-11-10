// A-26 Q4 (K-03): pecahan src/server/actions/hr.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { employees, payrollItemLines, payrollItems, payrollRuns } from "@/db/schema";
import {
  AppError,
  guard,
  isUniqueViolation,
} from "@/lib/errors";
import {
  isoDate,
  moneyString,
  parseInput,
} from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import {
  d,
  toDb,
  Decimal,
} from "@/lib/money";
import { periodEndDate } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import { nextDocumentNumber } from "@/server/sequences";
import {
  getAccountId,
  getAccountMap,
  postJournal,
} from "@/server/accounting";
import {
  applyPayrollAdvanceDeductions,
  getOpenAdvanceTotal,
  proposeAdvanceDeductions,
} from "@/server/employee-advances";
import {
  applyPayrollLoanDeductions,
  getLoanReceivableAccountId,
  proposeLoanDeductions,
} from "@/server/employee-loans";
import {
  computeEmployeeStatutory,
  ensurePayrollIndonesiaAccounts,
  getEmployeeEnrollments,
  getMinimumWage,
  getYearToDateFigures,
  loadStatutoryConfig,
  type EmployeeStatutoryResult,
  type StatutoryLineDraft,
} from "@/server/payroll-indonesia";
import {
  isBelowMinimumWage,
  type StatutoryConfig,
} from "@/lib/payroll-indonesia";
import {
  computeApprovedOvertimePay,
  getApprovedUnpaidLeaveDays,
  getHrParameters,
  hrParamBool,
  hrParamNumber,
  loadHrPayrollConfig,
  markComponentDraftsConsumed,
  peekComponentDrafts,
  payPayrollRun,
  voidPayrollRun,
} from "@/server/hr";

export async function runPayrollAction(input: {
  period: string;
  advanceDeductions?: Array<{ employeeId: string; amount: string | number }>;
  finalPeriod?: boolean;
  acknowledgeMinWage?: boolean;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        // A-11 (D-22): potongan kasbon per karyawan boleh diubah manual
        // dari usulan rencana sebelum posting; karyawan yang tidak
        // disebut memakai usulan rencananya.
        advanceDeductions: z
          .array(z.object({ employeeId: z.string().uuid(), amount: moneyString("Potongan kasbon") }))
          .optional(),
        // SIM-2 S2: masa pajak terakhir (hitung ulang setahun Pasal 17).
        // Otomatis untuk periode Desember; flag ini untuk karyawan yang
        // berhenti di tengah tahun. Hanya berpengaruh bila perusahaan
        // mengaktifkan Payroll Indonesia.
        finalPeriod: z.boolean().optional(),
        // SIM-2 S2 (TC-12): pengakuan eksplisit bahwa ada karyawan di
        // bawah upah minimum wilayahnya — tanpa ini run ditolak.
        acknowledgeMinWage: z.boolean().optional(),
      }),
      input,
    );
    const overrides = new Map((data.advanceDeductions ?? []).map((row) => [row.employeeId, d(row.amount)]));

    // AK-P3-03: the existence check inside races — two concurrent runs can
    // both pass it. The partial unique index (migration 0019) is the real
    // guard; translate its violation into the same CONFLICT the check
    // produces instead of leaking a generic server error.
    const result = await withCompany(ctx.company.id, async (tx) => {
      const [existing] = await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.companyId, ctx.company.id),
            eq(payrollRuns.period, data.period),
            // SIM-2 S7B-1: pembayaran akhir (kind='final') satu karyawan
            // TIDAK menghalangi run reguler periode yang sama — karyawan
            // berhenti memang dibayar terpisah dari run staf lainnya.
            eq(payrollRuns.kind, "regular"),
            // AK-P2-04: run yang sudah di-void tidak menghalangi pemrosesan
            // ulang periode yang sama — itulah alur koreksi payroll yang sah.
            ne(payrollRuns.status, "void"),
          ),
        )
        .limit(1);
      if (existing) throw new AppError("CONFLICT", `Payroll periode ${data.period} sudah pernah diproses.`);

      const staff = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.companyId, ctx.company.id), eq(employees.isActive, true)));
      if (staff.length === 0) throw new AppError("VALIDATION", "Belum ada karyawan aktif.");

      // SIM-2 S2: engine Payroll Indonesia hanya berjalan bila
      // perusahaan mengaktifkannya (Pengaturan → Payroll Indonesia);
      // tanpa konfigurasi aktif, seluruh blok ini dilewati dan payroll
      // berjalan generik persis seperti sebelum S2.
      const periodYear = Number(data.period.slice(0, 4));
      const isFinalPeriod = data.finalPeriod === true || data.period.slice(5, 7) === "12";
      const statutoryConfig = await loadStatutoryConfig(tx, ctx.company.id, `${data.period}-01`);
      const enrollmentsByEmployee = statutoryConfig
        ? await getEmployeeEnrollments(
            tx,
            ctx.company.id,
            staff.map((person) => person.id),
          )
        : new Map<string, Partial<Record<string, boolean>>>();
      if (statutoryConfig) await ensurePayrollIndonesiaAccounts(tx, ctx.company.id);
      const minWageViolations: string[] = [];

      // SIM-2 S7B-1 (§6D): komponen HR yang masuk run — lembur yang
      // disahkan (hanya bila saklar perusahaan aktif) dan draf THR
      // periode ini. Keduanya menjadi pendapatan bernama per karyawan;
      // tanpa saklar/draf, blok ini tidak mengubah apa pun (perilaku
      // lama persis).
      // Saklar HR dinilai per AKHIR periode (saklar operasional yang
      // dinyalakan di tengah bulan berlaku untuk run bulan itu);
      // aturan bertarif (statutory & lembur) tetap per awal periode.
      const hrParams = await getHrParameters(tx, ctx.company.id, periodEndDate(data.period));
      const overtimeEnabled = hrParamBool(hrParams, "overtime_payroll_enabled");
      const thrDrafts = await peekComponentDrafts(tx, {
        companyId: ctx.company.id,
        period: data.period,
        kind: "thr",
      });
      let hrConfig: StatutoryConfig | null = null;

      // A-11 (D-22): potongan kasbon per karyawan — usulan mengikuti
      // rencana tiap kasbon (penuh/cicilan/persen) dan dibatasi gaji
      // bersih sebelum kasbon; override manual dari formulir dihormati
      // selama tidak melebihi sisa kasbon maupun gaji bersih itu.
      const items = [];
      for (const person of staff) {
        const gross = d(person.baseSalary).plus(d(person.allowances));
        const regularDeductions = d(person.deductions);

        // SIM-2 S7B-1: pendapatan tambahan periode ini (lembur disahkan
        // + THR draf). Masuk snapshot tunjangan item agar bruto & jurnal
        // tetap satu jalur; rincian namanya hidup di payroll_item_lines.
        const extraLines: StatutoryLineDraft[] = [];
        let overtimeAmount = d(0);
        if (overtimeEnabled) {
          hrConfig ??= await loadHrPayrollConfig(tx, ctx.company.id, `${data.period}-01`);
          const overtime = await computeApprovedOvertimePay(tx, {
            companyId: ctx.company.id,
            employeeId: person.id,
            period: data.period,
            monthlyWage: gross,
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
                monthlyWage: toDb(gross),
              },
            });
          }
        }
        const thrAmount = thrDrafts.get(person.id)?.amount ?? d(0);
        if (thrAmount.gt(0)) {
          extraLines.push({
            code: "thr",
            label: "THR",
            category: "earning",
            amount: thrAmount,
            basisAmount: null,
            deductibleAnnual: false,
            basisSnapshot: { draftIds: thrDrafts.get(person.id)?.draftIds ?? [] },
          });
        }
        const extraEarnings = overtimeAmount.plus(thrAmount);

        // SIM-2 S7B-1 Batch 4 (§6C): cuti tidak berbayar yang disahkan
        // menjadi potongan bernama — tarif harian = upah bulanan ÷
        // hari kerja per bulan KONFIGURASI perusahaan. Hanya bila
        // saklar perusahaan aktif; tanpa saklar, absensi/cuti tidak
        // menyentuh payroll sama sekali.
        let unpaidLeaveAmount = d(0);
        if (hrParamBool(hrParams, "unpaid_leave_payroll_enabled")) {
          const unpaidDays = await getApprovedUnpaidLeaveDays(tx, ctx.company.id, person.id, data.period);
          if (unpaidDays.gt(0)) {
            const workingDays = hrParamNumber(hrParams, "working_days_per_month", 22);
            const dailyRate = workingDays > 0 ? gross.div(workingDays) : d(0);
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
                monthlyWage: toDb(gross),
                dailyRate: toDb(dailyRate),
              },
            });
          }
        }
        const allDeductions = regularDeductions.plus(unpaidLeaveAmount);

        // SIM-2 S2: komponen statutory dihitung SEBELUM kasbon agar
        // batas gaji bersih untuk potongan kasbon sudah memperhitungkan
        // iuran pekerja & PPh 21 (kasbon tidak pernah mengurangi bruto
        // pajak — TC-11).
        let statutory: EmployeeStatutoryResult | null = null;
        if (statutoryConfig) {
          const ytd = isFinalPeriod
            ? await getYearToDateFigures(tx, ctx.company.id, person.id, periodYear)
            : undefined;
          statutory = computeEmployeeStatutory({
            config: statutoryConfig,
            employee: person,
            enrollments: enrollmentsByEmployee.get(person.id),
            isFinalPeriod,
            ytd,
            // Lembur & THR adalah penghasilan kena pajak; dasar iuran
            // BPJS tetap upah pokok+tunjangan (konvensi engine S2).
            taxableExtra: extraEarnings,
          });
          if (person.workRegionCode) {
            const minimum = await getMinimumWage(tx, ctx.company.id, person.workRegionCode, periodYear);
            if (minimum && isBelowMinimumWage(gross, minimum.amount)) {
              minWageViolations.push(
                `${person.name} (${minimum.regionName}: upah ${gross.toFixed(0)} < minimum ${d(minimum.amount).toFixed(0)})`,
              );
            }
          }
        }
        const statutoryDeductions = statutory
          ? statutory.employeeTotal.plus(statutory.pphAmount)
          : d(0);
        const netBeforeAdvance = gross
          .plus(extraEarnings)
          .minus(allDeductions)
          .minus(statutoryDeductions);
        const proposal = await proposeAdvanceDeductions(tx, ctx.company.id, person);
        let advanceDeduction = proposal.total;
        const override = overrides.get(person.id);
        if (override !== undefined) {
          if (override.lt(0)) {
            throw new AppError("VALIDATION", `Potongan kasbon ${person.name} tidak boleh negatif.`);
          }
          const openTotal = await getOpenAdvanceTotal(tx, ctx.company.id, person.id);
          if (override.gt(openTotal)) {
            throw new AppError(
              "VALIDATION",
              `Potongan kasbon ${person.name} (${override.toFixed(2)}) melebihi sisa kasbon berjalannya (${openTotal.toFixed(2)}).`,
            );
          }
          if (override.gt(netBeforeAdvance)) {
            throw new AppError(
              "VALIDATION",
              `Potongan kasbon ${person.name} melebihi gaji bersihnya sebelum potongan kasbon, sehingga gaji bersihnya negatif.`,
            );
          }
          advanceDeduction = override;
        }
        // SIM-2 S7B-2 (§6F): cicilan PINJAMAN dipotong sesudah kasbon
        // dari sisa bersih yang sama, sebagai komponen bernama yang
        // terpisah (loan_installment) — pinjaman dan kasbon tidak
        // pernah digabung menjadi satu angka potongan.
        const netBeforeLoan = netBeforeAdvance.minus(advanceDeduction);
        const loanProposal = await proposeLoanDeductions(tx, ctx.company.id, person.id, netBeforeLoan);
        const loanDeduction = loanProposal.total;
        if (loanDeduction.gt(0)) {
          extraLines.push({
            code: "loan_installment",
            label: "Cicilan pinjaman karyawan",
            category: "deduction",
            amount: loanDeduction,
            basisAmount: null,
            deductibleAnnual: false,
            basisSnapshot: {
              allocations: loanProposal.allocations.map((row) => ({
                loanId: row.loanId,
                amount: toDb(row.amount),
              })),
            },
          });
        }
        items.push({
          employee: person,
          baseSalary: d(person.baseSalary),
          // Snapshot tunjangan memuat pendapatan HR periode ini
          // (lembur/THR) — bruto item & jurnal mencakupnya, rincian
          // per komponen ada di extraLines → payroll_item_lines.
          allowances: d(person.allowances).plus(extraEarnings),
          deductions: allDeductions,
          // FIX-P1 (AK4-05): komponen cuti tidak berbayar dibawa
          // terpisah agar komposisi JURNAL dapat memperlakukannya
          // sebagai pengurang bruto — aritmetika item (potongan &
          // bersih) tidak berubah sama sekali.
          unpaidLeave: unpaidLeaveAmount,
          advanceDeduction,
          loanDeduction,
          statutory,
          extraLines,
          net: netBeforeLoan.minus(loanDeduction),
        });
      }
      // SIM-2 S2 (TC-12): upah di bawah minimum wilayah menghalangi
      // posting kecuali diakui eksplisit oleh pemroses.
      if (minWageViolations.length > 0 && data.acknowledgeMinWage !== true) {
        throw new AppError(
          "VALIDATION",
          `Payroll ditahan: upah karyawan berikut di bawah upah minimum wilayah kerjanya — ${minWageViolations.join("; ")}. Perbaiki upah atau jalankan ulang dengan pengakuan eksplisit.`,
        );
      }
      const totalNet = items.reduce((acc, item) => acc.plus(item.net), d(0));
      if (totalNet.lte(0)) throw new AppError("VALIDATION", "Total gaji bersih harus lebih dari nol.");
      const totalGross = items.reduce((acc, i) => acc.plus(i.baseSalary).plus(i.allowances), d(0));
      const totalDeductions = items.reduce((acc, i) => acc.plus(i.deductions), d(0));
      const totalUnpaidLeave = items.reduce((acc, i) => acc.plus(i.unpaidLeave), d(0));
      const totalAdvanceDeductions = items.reduce((acc, i) => acc.plus(i.advanceDeduction), d(0));
      const totalLoanDeductions = items.reduce((acc, i) => acc.plus(i.loanDeduction), d(0));
      const totalPph21 = items.reduce((acc, i) => acc.plus(i.statutory?.pphAmount ?? d(0)), d(0));
      const totalStatutoryEmployee = items.reduce(
        (acc, i) => acc.plus(i.statutory?.employeeTotal ?? d(0)),
        d(0),
      );
      const totalEmployerContributions = items.reduce(
        (acc, i) => acc.plus(i.statutory?.employerCostTotal ?? d(0)),
        d(0),
      );
      const negativeItem = items.find((item) => item.net.lt(0));
      if (negativeItem) {
        throw new AppError(
          "VALIDATION",
          `Potongan ${negativeItem.employee.name} melebihi gaji brutonya sehingga gaji bersihnya negatif. Periksa data karyawan tersebut.`,
        );
      }

      // REM-04 (H-1): dokumen & jurnal payroll bertanggal akhir bulan
      // periode yang sebenarnya, bukan tanggal 28 kaku. Run historis
      // tidak berubah (tanggalnya sudah tercatat apa adanya).
      const runDate = periodEndDate(data.period);
      const number = await nextDocumentNumber(tx, ctx.company.id, "PAYROLL", runDate);
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          companyId: ctx.company.id,
          number,
          period: data.period,
          totalGross: toDb(totalGross),
          totalDeductions: toDb(totalDeductions),
          totalAdvanceDeductions: toDb(totalAdvanceDeductions),
          totalLoanDeductions: toDb(totalLoanDeductions),
          totalPph21: toDb(totalPph21),
          totalStatutoryEmployee: toDb(totalStatutoryEmployee),
          totalEmployerContributions: toDb(totalEmployerContributions),
          totalNet: toDb(totalNet),
          createdBy: ctx.user.id,
          postedAt: new Date(),
        })
        .returning({ id: payrollRuns.id, number: payrollRuns.number });

      const insertedItems = await tx
        .insert(payrollItems)
        .values(
          items.map((item) => ({
            companyId: ctx.company.id,
            runId: run.id,
            employeeId: item.employee.id,
            baseSalary: toDb(item.baseSalary),
            allowances: toDb(item.allowances),
            deductions: toDb(item.deductions),
            advanceDeduction: toDb(item.advanceDeduction),
            loanDeduction: toDb(item.loanDeduction),
            net: toDb(item.net),
          })),
        )
        .returning({ id: payrollItems.id, employeeId: payrollItems.employeeId });

      // SIM-2 S2: snapshot komponen terstruktur per karyawan — inilah
      // yang dibaca slip gaji, rekap setoran, dan hitungan year-to-date
      // masa pajak terakhir. Konfigurasi yang berubah sesudah run ini
      // tidak pernah mengubah snapshot.
      // SIM-2 S7B-1: draf THR periode ini resmi terpakai oleh run ini.
      if (thrDrafts.size > 0) {
        await markComponentDraftsConsumed(tx, {
          companyId: ctx.company.id,
          runId: run.id,
          period: data.period,
          kind: "thr",
        });
      }

      const itemIdByEmployee = new Map(insertedItems.map((row) => [row.employeeId, row.id]));
      const lineRows = items.flatMap((item) => {
        const itemId = itemIdByEmployee.get(item.employee.id);
        if (!itemId) return [];
        const drafts = [...(item.statutory?.lines ?? []), ...item.extraLines];
        return drafts.map((line) => ({
          companyId: ctx.company.id,
          runId: run.id,
          itemId,
          employeeId: item.employee.id,
          code: line.code,
          label: line.label,
          category: line.category,
          amount: toDb(line.amount),
          basisAmount: line.basisAmount === null ? null : toDb(line.basisAmount),
          deductibleAnnual: line.deductibleAnnual,
          basisSnapshot: line.basisSnapshot,
        }));
      });
      if (lineRows.length > 0) await tx.insert(payrollItemLines).values(lineRows);

      const map = await getAccountMap(tx, ctx.company.id);
      // Potongan gaji (BPJS/PPh/dll.) adalah utang ke pihak ketiga, bukan
      // pengurang beban. Pemetaan belum menyediakan kunci akun khusus utang
      // potongan, jadi potongan dikreditkan sebagai baris tersendiri ke akun
      // Utang Gaji (salary_payable) — kecuali perusahaan sudah memetakan
      // kunci "salary_deductions_payable" sendiri di account_mappings.
      const deductionsAccountId = map.salary_deductions_payable ?? map.salary_payable;
      // A-11 (D-22): potongan kasbon mengkredit Piutang Karyawan (pemetaan
      // employee_receivable) — piutang ke karyawan berkurang sebesar yang
      // dipotong dari gaji, dan gaji bersih yang menjadi utang gaji ikut
      // berkurang. Tanpa potongan kasbon, baris ini tidak dibuat.
      const advanceAccountId = totalAdvanceDeductions.gt(0)
        ? await getAccountId(tx, ctx.company.id, "employee_receivable")
        : null;
      // SIM-2 S7B-2 (§6F): cicilan pinjaman adalah baris kredit piutang
      // yang TERPISAH dari kasbon — akunnya boleh sama (1220) tetapi
      // baris jurnal & snapshotnya tidak pernah digabung.
      const loanAccountId = totalLoanDeductions.gt(0)
        ? await getLoanReceivableAccountId(tx, ctx.company.id)
        : null;
      // FIX-P1 (AK4-05): cuti tidak berbayar adalah upah yang TIDAK
      // PERNAH earned — pengurang bruto, bukan kewajiban kepada siapa
      // pun. Jurnal membebankan Beban Gaji sebesar bruto EFEKTIF
      // (bruto − cuti tidak berbayar) dan mengkredit utang potongan
      // hanya sebesar potongan yang sungguh terutang. Kedua sisi
      // menyusut sebesar komponen yang sama, jurnal tetap seimbang,
      // dan gaji bersih karyawan tidak berubah — sebelum perbaikan,
      // Beban Gaji dan Utang sama-sama overstated permanen sebesar
      // total cuti tidak berbayar setiap periode.
      const journalLines: Array<{
        accountId: string;
        debit?: typeof totalGross;
        credit?: typeof totalGross;
        description: string;
      }> = [
        {
          accountId: map.salary_expense,
          debit: totalGross.minus(totalUnpaidLeave),
          description: totalUnpaidLeave.gt(0)
            ? `Beban gaji bruto efektif (sesudah pengurang cuti tidak berbayar ${totalUnpaidLeave.toFixed(0)})`
            : "Beban gaji bruto",
        },
        { accountId: map.salary_payable, credit: totalNet, description: "Utang gaji bersih" },
        {
          accountId: deductionsAccountId,
          credit: totalDeductions.minus(totalUnpaidLeave),
          description: "Utang potongan gaji",
        },
        ...(advanceAccountId
          ? [{ accountId: advanceAccountId, credit: totalAdvanceDeductions, description: "Potongan kasbon karyawan" }]
          : []),
        ...(loanAccountId
          ? [{ accountId: loanAccountId, credit: totalLoanDeductions, description: "Potongan pinjaman karyawan" }]
          : []),
      ];
      // SIM-2 S2: baris statutory hanya muncul bila engine aktif dan
      // totalnya bukan nol. Iuran pekerja + iuran perusahaan yang
      // menjadi beban kas sama-sama terutang ke BPJS (satu baris kredit
      // gabungan); beban perusahaan didebit ke akun bebannya sendiri.
      // JKP tidak masuk jurnal (bukan beban kas perusahaan).
      if (totalStatutoryEmployee.gt(0) || totalEmployerContributions.gt(0)) {
        const bpjsPayableId = await getAccountId(tx, ctx.company.id, "bpjs_payable");
        if (totalEmployerContributions.gt(0)) {
          const employerExpenseId = await getAccountId(tx, ctx.company.id, "payroll_employer_expense");
          journalLines.push({
            accountId: employerExpenseId,
            debit: totalEmployerContributions,
            description: "Beban iuran BPJS perusahaan",
          });
        }
        journalLines.push({
          accountId: bpjsPayableId,
          credit: totalStatutoryEmployee.plus(totalEmployerContributions),
          description: "Utang iuran BPJS",
        });
      }
      if (!totalPph21.isZero()) {
        const pphPayableId = await getAccountId(tx, ctx.company.id, "pph21_payable");
        if (totalPph21.gt(0)) {
          journalLines.push({
            accountId: pphPayableId,
            credit: totalPph21,
            description: "Utang PPh 21",
          });
        } else {
          // Masa pajak terakhir dengan kelebihan potongan setahun:
          // kelebihan dikembalikan ke karyawan (sudah tercermin pada
          // gaji bersih yang lebih besar) dan utang PPh 21 berkurang.
          journalLines.push({
            accountId: pphPayableId,
            debit: totalPph21.abs(),
            description: "Kelebihan potongan PPh 21 dikembalikan",
          });
        }
      }
      const payrollEntry = await postJournal(tx, {
        companyId: ctx.company.id,
        date: runDate,
        description: `Beban gaji ${data.period} (${number})`,
        sourceType: "payroll",
        sourceId: run.id,
        createdBy: ctx.user.id,
        idempotencyKey: `payroll:${run.id}`,
        lines: journalLines,
      });

      // Alokasi FIFO potongan ke kasbon tertua tiap karyawan, tertelusur
      // per entri ke jurnal & run ini.
      await applyPayrollAdvanceDeductions(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        runId: run.id,
        journalId: payrollEntry.id,
        date: runDate,
        deductions: new Map(
          items
            .filter((item) => item.advanceDeduction.gt(0))
            .map((item) => [item.employee.id, item.advanceDeduction]),
        ),
      });
      // SIM-2 S7B-2: alokasi FIFO cicilan ke pinjaman tertua, entri
      // terpisah di employee_loan_entries dengan jurnal & run yang sama.
      await applyPayrollLoanDeductions(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        runId: run.id,
        journalId: payrollEntry.id,
        date: runDate,
        deductions: new Map(
          items
            .filter((item) => item.loanDeduction.gt(0))
            .map((item) => [item.employee.id, item.loanDeduction]),
        ),
      });

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payroll.run",
        entityType: "payroll_run",
        entityId: run.id,
        after: {
          number,
          period: data.period,
          totalNet: toDb(totalNet),
          totalAdvanceDeductions: toDb(totalAdvanceDeductions),
          totalLoanDeductions: toDb(totalLoanDeductions),
          totalPph21: toDb(totalPph21),
          totalStatutoryEmployee: toDb(totalStatutoryEmployee),
          totalEmployerContributions: toDb(totalEmployerContributions),
        },
      });
      return { id: run.id, number, totalNet: totalNet.toNumber(), employees: items.length };
    }).catch((error: unknown) => {
      // AK-P3-03 + AUD-001 (A4): balapan dua proses konkuren kadang
      // tertangkap indeks nomor (payroll_runs_company_number_uq),
      // bukan indeks periode — nomor urut ditarik sebelum insert dan
      // jendela tabrakannya bergantung waktu. Keduanya berarti hal
      // yang sama bagi pengguna: periode ini sudah diproses proses
      // lain. Terjemahkan keduanya ke CONFLICT yang sama; pelanggaran
      // unik LAIN tetap diteruskan apa adanya.
      if (
        isUniqueViolation(error, "payroll_runs_company_period_uq") ||
        isUniqueViolation(error, "payroll_runs_company_number_uq")
      ) {
        throw new AppError("CONFLICT", `Payroll periode ${data.period} sudah pernah diproses.`);
      }
      throw error;
    });

    revalidatePath("/app/akuntansi/payroll");
    revalidatePath("/app/akuntansi");
    return result;
  });
}
export async function payPayrollAction(input: { runId: string; accountId: string; date: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(
      z.object({ runId: z.string().uuid(), accountId: z.string().uuid(), date: isoDate("Tanggal pembayaran") }),
      input,
    );

    // A-26 Q4 (K-03): logika pembayaran run hidup di domain hr/payroll-runs.
    const result = await withCompany(ctx.company.id, async (tx) => {
      const paid = await payPayrollRun(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        runId: data.runId,
        accountId: data.accountId,
        date: data.date,
      });
      return { entry: paid.entry, amount: paid.amount.toNumber() };
    });

    revalidatePath("/app/akuntansi/payroll");
    revalidatePath(`/app/akuntansi/payroll/${data.runId}`);
    revalidatePath("/app/akuntansi");
    return result;
  });
}

export async function voidPayrollRunAction(input: { id: string; reason: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("payroll.manage", "hr");
    const data = parseInput(z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(200) }), input);

    // A-26 Q4 (K-03): rantai pembatalan run hidup di domain hr/payroll-runs.
    await withCompany(ctx.company.id, async (tx) =>
      voidPayrollRun(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        id: data.id,
        reason: data.reason,
      }),
    );

    revalidatePath("/app/akuntansi/payroll");
    revalidatePath(`/app/akuntansi/payroll/${data.id}`);
    revalidatePath("/app/akuntansi");
    return { id: data.id };
  });
}
