import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  employeeLoanEntries,
  employeeLoans,
  employees,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import { getAccountId, getAccountMap, postJournal, reverseSourceJournal } from "@/server/accounting";
import { assertCashLikeAccount } from "@/server/employee-advances";
import { nextDocumentNumber } from "@/server/sequences";

/**
 * SIM-2 S7B-2 (§6F): Pinjaman Karyawan — fasilitas kredit karyawan
 * yang TERPISAH dari kasbon (A-11/D-22). Perbedaan yang ditegakkan di
 * sini dan di UI/laporan:
 * - Kasbon = uang muka operasional jangka pendek, rencana potongannya
 *   full/fixed/percent dan dokumennya seri KSB;
 * - Pinjaman = kredit terjadwal bertenor, rencana cicilannya
 *   tenor (pokok ÷ bulan) atau fixed (nominal per periode), dokumennya
 *   seri PJM, dan potongan payroll-nya adalah baris bernama
 *   `loan_installment` di payroll_item_lines + kolom
 *   payroll_items.loan_deduction — tidak pernah tercampur dengan
 *   advance_deduction.
 * Akuntansi keduanya sama-sama piutang karyawan: pinjaman memakai
 * pemetaan `employee_loan_receivable` bila perusahaan memetakannya,
 * selain itu jatuh ke `employee_receivable` (1220). Pinjaman tanpa
 * bunga: tidak ada komponen bunga di jurnal mana pun.
 * Setiap perubahan saldo adalah baris append-only di
 * employee_loan_entries yang tertelusur ke jurnalnya; alokasi FIFO.
 */

export const LOAN_PLAN_LABELS: Record<string, string> = {
  tenor: "Cicilan merata selama tenor (bulan)",
  fixed: "Cicilan nominal tetap per periode",
};

export const LOAN_STATUS_LABELS: Record<string, string> = {
  open: "Berjalan",
  settled: "Lunas",
  void: "Dibatalkan",
};

export const LOAN_ENTRY_KIND_LABELS: Record<string, string> = {
  payroll_deduction: "Cicilan payroll",
  repayment: "Setoran manual",
  payroll_reversal: "Pemulihan (payroll dibatalkan)",
};

export type LoanPlanMode = "tenor" | "fixed";

type EmployeeRow = typeof employees.$inferSelect;
type LoanRow = typeof employeeLoans.$inferSelect;

/**
 * Akun piutang pinjaman: pemetaan khusus `employee_loan_receivable`
 * menang; tanpa itu, akun piutang karyawan yang sama dengan kasbon.
 * Tidak pernah menebak akun di luar kedua kunci pemetaan ini.
 */
export async function getLoanReceivableAccountId(tx: Tx, companyId: string): Promise<string> {
  const map = await getAccountMap(tx, companyId);
  if (map.employee_loan_receivable) return map.employee_loan_receivable;
  return getAccountId(tx, companyId, "employee_receivable");
}

export async function createEmployeeLoan(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    employeeId: string;
    date: string;
    amount: MoneyInput;
    accountId: string;
    planMode: LoanPlanMode;
    planValue?: MoneyInput | null;
    note?: string | null;
  },
): Promise<{ id: string; number: string; journalId: string }> {
  const receivableAccountId = await getLoanReceivableAccountId(tx, input.companyId);

  const [person] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1);
  if (!person) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");
  if (!person.isActive) throw new AppError("VALIDATION", `Karyawan ${person.name} sudah nonaktif.`);

  const amount = d(input.amount);
  if (!amount.isFinite() || !amount.gt(0)) {
    throw new AppError("VALIDATION", "Jumlah pinjaman harus lebih dari nol.");
  }

  const planValue = d(input.planValue ?? 0);
  if (input.planMode === "tenor") {
    if (!planValue.isFinite() || !planValue.isInteger() || planValue.lt(1) || planValue.gt(360)) {
      throw new AppError("VALIDATION", "Tenor pinjaman harus bilangan bulat 1–360 bulan.");
    }
  } else if (input.planMode === "fixed") {
    if (!planValue.isFinite() || !planValue.gt(0)) {
      throw new AppError("VALIDATION", "Nominal cicilan per periode harus lebih dari nol.");
    }
  } else {
    throw new AppError("VALIDATION", "Mode rencana cicilan tidak dikenal.");
  }

  await assertCashLikeAccount(tx, input.companyId, input.accountId);

  const number = await nextDocumentNumber(tx, input.companyId, "EMPLOYEE_LOAN", input.date);
  const [loan] = await tx
    .insert(employeeLoans)
    .values({
      companyId: input.companyId,
      number,
      employeeId: person.id,
      date: input.date,
      amount: toDb(amount),
      remainingAmount: toDb(amount),
      accountId: input.accountId,
      planMode: input.planMode,
      planValue: toDb(planValue),
      note: input.note ?? null,
      status: "open",
      createdBy: input.userId,
    })
    .returning({ id: employeeLoans.id });

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Pinjaman karyawan ${number} — ${person.name}`,
    sourceType: "employee_loan",
    sourceId: loan.id,
    createdBy: input.userId,
    idempotencyKey: `employee_loan:${loan.id}`,
    lines: [
      {
        accountId: receivableAccountId,
        debit: amount,
        description: `Piutang pinjaman ${person.name}`,
        partyType: "employee",
        partyId: person.id,
      },
      { accountId: input.accountId, credit: amount, description: `Kas/bank keluar untuk pinjaman ${number}` },
    ],
  });

  await tx
    .update(employeeLoans)
    .set({ journalId: entry.id })
    .where(and(eq(employeeLoans.companyId, input.companyId), eq(employeeLoans.id, loan.id)));

  return { id: loan.id, number, journalId: entry.id };
}

export async function listOpenLoans(
  tx: Tx,
  companyId: string,
  employeeId: string,
  lock = false,
): Promise<LoanRow[]> {
  const query = tx
    .select()
    .from(employeeLoans)
    .where(
      and(
        eq(employeeLoans.companyId, companyId),
        eq(employeeLoans.employeeId, employeeId),
        eq(employeeLoans.status, "open"),
      ),
    )
    .orderBy(asc(employeeLoans.date), asc(employeeLoans.createdAt));
  return lock ? query.for("update") : query;
}

/** Total sisa seluruh pinjaman berjalan satu karyawan. */
export async function getOpenLoanTotal(tx: Tx, companyId: string, employeeId: string): Promise<Decimal> {
  const open = await listOpenLoans(tx, companyId, employeeId);
  return open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
}

/** Jumlah cicilan payroll yang masih berlaku (potongan yang tidak pernah dipulihkan void). */
async function countActiveInstallments(tx: Tx, loanId: string): Promise<number> {
  const deducted = await tx
    .select({ id: employeeLoanEntries.id })
    .from(employeeLoanEntries)
    .where(and(eq(employeeLoanEntries.loanId, loanId), eq(employeeLoanEntries.kind, "payroll_deduction")));
  if (deducted.length === 0) return 0;
  const reversed = await tx
    .select({ reversalOfId: employeeLoanEntries.reversalOfId })
    .from(employeeLoanEntries)
    .where(and(eq(employeeLoanEntries.loanId, loanId), eq(employeeLoanEntries.kind, "payroll_reversal")));
  const reversedIds = new Set(reversed.map((row) => row.reversalOfId));
  return deducted.filter((row) => !reversedIds.has(row.id)).length;
}

/**
 * Cicilan terencana satu pinjaman untuk satu periode payroll.
 * - fixed: nominal rencana, dibatasi sisa.
 * - tenor: sisa ÷ sisa bulan tenor (cicilan terakhir menyerap sisa
 *   pembulatan secara alami karena pembaginya menyusut ke 1).
 */
export async function plannedLoanInstallment(tx: Tx, loan: LoanRow): Promise<Decimal> {
  const remaining = d(loan.remainingAmount);
  if (loan.planMode === "fixed") {
    return Decimal.min(d(loan.planValue ?? 0), remaining);
  }
  const months = Math.max(1, Math.round(d(loan.planValue ?? 1).toNumber()));
  const taken = await countActiveInstallments(tx, loan.id);
  const periodsLeft = Math.max(months - taken, 1);
  const installment = remaining.div(periodsLeft).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return Decimal.min(installment, remaining);
}

export type LoanProposal = {
  total: Decimal;
  allocations: Array<{ loanId: string; amount: Decimal }>;
};

/**
 * Usulan cicilan payroll: FIFO dari pinjaman tertua, dibatasi plafon
 * yang diberikan pemanggil (gaji bersih sesudah potongan lain —
 * pinjaman dipotong SESUDAH kasbon agar urutan prioritasnya tetap:
 * potongan wajib, kasbon, lalu pinjaman).
 */
export async function proposeLoanDeductions(
  tx: Tx,
  companyId: string,
  employeeId: string,
  cap: Decimal,
): Promise<LoanProposal> {
  const open = await listOpenLoans(tx, companyId, employeeId);
  let capLeft = Decimal.max(cap, 0);
  const allocations: Array<{ loanId: string; amount: Decimal }> = [];
  let total = d(0);
  for (const loan of open) {
    if (capLeft.lte(0)) break;
    const planned = await plannedLoanInstallment(tx, loan);
    const amount = Decimal.min(planned, capLeft);
    if (amount.gt(0)) {
      allocations.push({ loanId: loan.id, amount });
      total = total.plus(amount);
      capLeft = capLeft.minus(amount);
    }
  }
  return { total, allocations };
}

/**
 * Terapkan cicilan pinjaman yang sudah diputuskan run payroll. Jurnal
 * adalah jurnal payroll itu sendiri; entri di sini menautkan alokasi
 * ke jurnal & run. Alokasi FIFO dua lintasan seperti kasbon: cicilan
 * terencana dulu, lalu sisa pinjaman tertua bila total melebihi
 * rencana (kasus pembayaran akhir yang menagih seluruh sisa).
 */
export async function applyPayrollLoanDeductions(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    runId: string;
    journalId: string;
    date: string;
    deductions: Map<string, Decimal>;
  },
) {
  for (const [employeeId, total] of input.deductions) {
    if (!total.gt(0)) continue;
    const [person] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.companyId, input.companyId), eq(employees.id, employeeId)))
      .limit(1);
    if (!person) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");
    const open = await listOpenLoans(tx, input.companyId, employeeId, true);
    const openTotal = open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
    if (total.gt(openTotal)) {
      throw new AppError("VALIDATION", `Cicilan pinjaman melebihi sisa pinjaman berjalan (${openTotal.toFixed(2)}).`);
    }
    let budget = total;
    const allocated = new Map<string, Decimal>();
    for (const loan of open) {
      if (budget.lte(0)) break;
      const planned = await plannedLoanInstallment(tx, loan);
      const amount = Decimal.min(planned, d(loan.remainingAmount), budget);
      if (amount.gt(0)) {
        allocated.set(loan.id, amount);
        budget = budget.minus(amount);
      }
    }
    for (const loan of open) {
      if (budget.lte(0)) break;
      const already = allocated.get(loan.id) ?? d(0);
      const room = d(loan.remainingAmount).minus(already);
      const amount = Decimal.min(room, budget);
      if (amount.gt(0)) {
        allocated.set(loan.id, already.plus(amount));
        budget = budget.minus(amount);
      }
    }
    for (const loan of open) {
      const amount = allocated.get(loan.id);
      if (!amount || !amount.gt(0)) continue;
      const remaining = d(loan.remainingAmount).minus(amount);
      await tx.insert(employeeLoanEntries).values({
        companyId: input.companyId,
        loanId: loan.id,
        kind: "payroll_deduction",
        date: input.date,
        amount: toDb(amount),
        journalId: input.journalId,
        payrollRunId: input.runId,
        createdBy: input.userId,
      });
      await tx
        .update(employeeLoans)
        .set({ remainingAmount: toDb(remaining), status: remaining.lte(0) ? "settled" : "open" })
        .where(and(eq(employeeLoans.companyId, input.companyId), eq(employeeLoans.id, loan.id)));
    }
  }
}

/** Void payroll memulihkan sisa pinjaman — pasangan applyPayrollLoanDeductions. */
export async function restorePayrollLoanDeductions(
  tx: Tx,
  input: { companyId: string; userId: string; runId: string; date: string },
) {
  const deducted = await tx
    .select()
    .from(employeeLoanEntries)
    .where(
      and(
        eq(employeeLoanEntries.companyId, input.companyId),
        eq(employeeLoanEntries.kind, "payroll_deduction"),
        eq(employeeLoanEntries.payrollRunId, input.runId),
      ),
    )
    .orderBy(asc(employeeLoanEntries.createdAt));
  for (const entry of deducted) {
    const [already] = await tx
      .select({ id: employeeLoanEntries.id })
      .from(employeeLoanEntries)
      .where(
        and(
          eq(employeeLoanEntries.companyId, input.companyId),
          eq(employeeLoanEntries.kind, "payroll_reversal"),
          eq(employeeLoanEntries.reversalOfId, entry.id),
        ),
      )
      .limit(1);
    if (already) continue;
    const [loan] = await tx
      .select()
      .from(employeeLoans)
      .where(and(eq(employeeLoans.companyId, input.companyId), eq(employeeLoans.id, entry.loanId)))
      .limit(1)
      .for("update");
    if (!loan || loan.status === "void") continue;
    await tx.insert(employeeLoanEntries).values({
      companyId: input.companyId,
      loanId: loan.id,
      kind: "payroll_reversal",
      date: input.date,
      amount: entry.amount,
      journalId: null,
      payrollRunId: input.runId,
      reversalOfId: entry.id,
      note: "Payroll dibatalkan — cicilan pinjaman dipulihkan",
      createdBy: input.userId,
    });
    const remaining = d(loan.remainingAmount).plus(d(entry.amount));
    await tx
      .update(employeeLoans)
      .set({ remainingAmount: toDb(remaining), status: "open" })
      .where(and(eq(employeeLoans.companyId, input.companyId), eq(employeeLoans.id, loan.id)));
  }
}

/** Setoran tunai karyawan di luar payroll: Dr Kas/Bank / Cr Piutang Pinjaman, FIFO. */
export async function recordLoanRepayment(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    employeeId: string;
    date: string;
    amount: MoneyInput;
    accountId: string;
    note?: string | null;
  },
): Promise<{ journalId: string; allocations: Array<{ loanId: string; amount: Decimal }> }> {
  const receivableAccountId = await getLoanReceivableAccountId(tx, input.companyId);
  const [person] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1);
  if (!person) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");
  const amount = d(input.amount);
  if (!amount.isFinite() || !amount.gt(0)) {
    throw new AppError("VALIDATION", "Nominal setoran harus lebih dari nol.");
  }
  await assertCashLikeAccount(tx, input.companyId, input.accountId);

  const open = await listOpenLoans(tx, input.companyId, person.id, true);
  const openTotal = open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
  if (amount.gt(openTotal)) {
    throw new AppError(
      "VALIDATION",
      `Setoran ${person.name} melebihi sisa pinjaman berjalannya (${openTotal.toFixed(2)}).`,
    );
  }

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Setoran pinjaman karyawan — ${person.name}`,
    sourceType: "employee_loan_repayment",
    sourceId: null,
    createdBy: input.userId,
    idempotencyKey: `employee_loan_repayment:${crypto.randomUUID()}`,
    lines: [
      { accountId: input.accountId, debit: amount, description: `Kas/bank masuk dari setoran pinjaman ${person.name}` },
      {
        accountId: receivableAccountId,
        credit: amount,
        description: `Piutang pinjaman ${person.name} berkurang`,
        partyType: "employee",
        partyId: person.id,
      },
    ],
  });

  const allocations: Array<{ loanId: string; amount: Decimal }> = [];
  let left = amount;
  for (const loan of open) {
    if (left.lte(0)) break;
    const applied = Decimal.min(d(loan.remainingAmount), left);
    if (!applied.gt(0)) continue;
    const remaining = d(loan.remainingAmount).minus(applied);
    await tx.insert(employeeLoanEntries).values({
      companyId: input.companyId,
      loanId: loan.id,
      kind: "repayment",
      date: input.date,
      amount: toDb(applied),
      accountId: input.accountId,
      journalId: entry.id,
      note: input.note ?? null,
      createdBy: input.userId,
    });
    await tx
      .update(employeeLoans)
      .set({ remainingAmount: toDb(remaining), status: remaining.lte(0) ? "settled" : "open" })
      .where(and(eq(employeeLoans.companyId, input.companyId), eq(employeeLoans.id, loan.id)));
    allocations.push({ loanId: loan.id, amount: applied });
    left = left.minus(applied);
  }
  return { journalId: entry.id, allocations };
}

/** Batalkan pinjaman: hanya bila belum ada cicilan/setoran sama sekali. */
export async function voidEmployeeLoan(
  tx: Tx,
  input: { companyId: string; userId: string; loanId: string; reason: string; date: string },
) {
  const [loan] = await tx
    .select()
    .from(employeeLoans)
    .where(and(eq(employeeLoans.companyId, input.companyId), eq(employeeLoans.id, input.loanId)))
    .limit(1)
    .for("update");
  if (!loan) throw new AppError("NOT_FOUND", "Pinjaman tidak ditemukan.");
  if (loan.status === "void") throw new AppError("INVALID_STATE", "Pinjaman sudah dibatalkan.");
  if (loan.status !== "open") {
    throw new AppError("INVALID_STATE", "Hanya pinjaman berstatus berjalan yang bisa dibatalkan.");
  }
  const [movement] = await tx
    .select({ id: employeeLoanEntries.id })
    .from(employeeLoanEntries)
    .where(eq(employeeLoanEntries.loanId, loan.id))
    .limit(1);
  if (movement) {
    throw new AppError(
      "INVALID_STATE",
      `Pinjaman ${loan.number} sudah memiliki cicilan atau setoran dan tidak dapat dibatalkan. Selesaikan lewat pelunasan sisa pinjamannya.`,
    );
  }
  const reversal = await reverseSourceJournal(tx, {
    companyId: input.companyId,
    sourceType: "employee_loan",
    sourceId: loan.id,
    date: input.date,
    description: `Pembatalan pinjaman ${loan.number} — ${input.reason}`,
    createdBy: input.userId,
  });
  if (!reversal) {
    throw new AppError(
      "VALIDATION",
      `Jurnal asal pinjaman ${loan.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan dibatalkan agar buku besar tetap selaras.`,
    );
  }
  await tx
    .update(employeeLoans)
    .set({ status: "void", remainingAmount: "0" })
    .where(and(eq(employeeLoans.companyId, input.companyId), eq(employeeLoans.id, loan.id)));
  return { id: loan.id, reversalNumber: reversal.number };
}

/* ------------------------------------------------------------------ */
/* Read models for the Pinjaman pages                                  */
/* ------------------------------------------------------------------ */

export async function listEmployeeLoans(tx: Tx, companyId: string) {
  return tx
    .select({
      id: employeeLoans.id,
      number: employeeLoans.number,
      employeeId: employeeLoans.employeeId,
      employeeCode: employees.code,
      employeeName: employees.name,
      date: employeeLoans.date,
      amount: employeeLoans.amount,
      remainingAmount: employeeLoans.remainingAmount,
      planMode: employeeLoans.planMode,
      planValue: employeeLoans.planValue,
      note: employeeLoans.note,
      status: employeeLoans.status,
      journalId: employeeLoans.journalId,
      createdAt: employeeLoans.createdAt,
    })
    .from(employeeLoans)
    .innerJoin(employees, eq(employeeLoans.employeeId, employees.id))
    .where(eq(employeeLoans.companyId, companyId))
    .orderBy(desc(employeeLoans.date), desc(employeeLoans.createdAt));
}

export async function getEmployeeLoanHistory(tx: Tx, companyId: string, employeeId: string) {
  const [person] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)))
    .limit(1);
  if (!person) return null;
  const loans = await tx
    .select()
    .from(employeeLoans)
    .where(and(eq(employeeLoans.companyId, companyId), eq(employeeLoans.employeeId, employeeId)))
    .orderBy(asc(employeeLoans.date), asc(employeeLoans.createdAt));
  const loanIds = loans.map((loan) => loan.id);
  const own =
    loanIds.length === 0
      ? []
      : await tx
          .select({
            id: employeeLoanEntries.id,
            loanId: employeeLoanEntries.loanId,
            loanNumber: employeeLoans.number,
            kind: employeeLoanEntries.kind,
            date: employeeLoanEntries.date,
            amount: employeeLoanEntries.amount,
            journalId: employeeLoanEntries.journalId,
            payrollRunId: employeeLoanEntries.payrollRunId,
            note: employeeLoanEntries.note,
            createdAt: employeeLoanEntries.createdAt,
          })
          .from(employeeLoanEntries)
          .innerJoin(employeeLoans, eq(employeeLoanEntries.loanId, employeeLoans.id))
          .where(
            and(
              eq(employeeLoanEntries.companyId, companyId),
              inArray(employeeLoanEntries.loanId, loanIds),
            ),
          )
          .orderBy(asc(employeeLoanEntries.date), asc(employeeLoanEntries.createdAt));
  const runIds = [...new Set(own.map((entry) => entry.payrollRunId).filter(Boolean))] as string[];
  return { employee: person as EmployeeRow, loans, entries: own, runIds };
}

// FIX-ARS Tahap 6 (ARS1-01): id pinjaman yang sudah memiliki entri
// (pernah bergerak) — dulu kueri inline di halaman daftar pinjaman.
export async function listMovedLoanIds(tx: Tx, companyId: string, loanIds: string[]) {
  if (loanIds.length === 0) return new Set<string>();
  const rows = await tx
    .select({ loanId: employeeLoanEntries.loanId })
    .from(employeeLoanEntries)
    .where(
      and(
        eq(employeeLoanEntries.companyId, companyId),
        inArray(employeeLoanEntries.loanId, loanIds),
      ),
    );
  return new Set(rows.map((row) => row.loanId));
}
