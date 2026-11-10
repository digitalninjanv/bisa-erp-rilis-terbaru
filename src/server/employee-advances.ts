import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  employeeAdvanceEntries,
  employeeAdvances,
  employees,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import { getAccountId, listCashBankIds, postJournal, reverseSourceJournal } from "@/server/accounting";
import { nextDocumentNumber } from "@/server/sequences";

/**
 * A-11 (D-22): Kasbon Karyawan — employee cash advances settled through
 * payroll deductions with a FLEXIBLE per-advance plan:
 * - `full`: the whole remainder is deducted from the next payroll;
 * - `fixed`: a fixed installment per payroll period;
 * - `percent`: a percentage of the employee's base salary for the period.
 * The receivable lives on the `employee_receivable` account mapping
 * (seed/migration account 1220 "Piutang Karyawan"); nothing here guesses
 * an account when the mapping is missing. Every balance change is an
 * append-only row in `employee_advance_entries` tied to its journal, and
 * allocations always run FIFO (oldest open advance first).
 */

export const ADVANCE_PLAN_LABELS: Record<string, string> = {
  full: "Potong penuh di gaji berikutnya",
  fixed: "Cicilan nominal tetap per periode",
  percent: "Cicilan persen dari gaji pokok",
};

export const ADVANCE_STATUS_LABELS: Record<string, string> = {
  open: "Berjalan",
  settled: "Lunas",
  void: "Dibatalkan",
};

export const ADVANCE_ENTRY_KIND_LABELS: Record<string, string> = {
  payroll_deduction: "Potongan payroll",
  repayment: "Setoran manual",
  payroll_reversal: "Pemulihan (payroll dibatalkan)",
};

export type AdvancePlanMode = "full" | "fixed" | "percent";

type EmployeeRow = typeof employees.$inferSelect;
type AdvanceRow = typeof employeeAdvances.$inferSelect;

/**
 * Akun sumber/tujuan hanya boleh akun kas/bank: berkelas kas, bank,
 * atau kliring (A-27 B2 — keanggotaan dari kelas akun lewat
 * listCashBankIds, bukan lagi slot pemetaan cash/bank/qris). Validator
 * bersama untuk kasbon, pinjaman, klaim, beban, pembayaran utang, dan
 * transfer antar rekening.
 */
export async function assertCashLikeAccount(tx: Tx, companyId: string, accountId: string) {
  const [account] = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, isPostable: accounts.isPostable, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) throw new AppError("VALIDATION", "Akun kas/bank tidak ditemukan di perusahaan ini.");
  if (!account.isPostable || !account.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} — ${account.name} tidak dapat dipakai: akun harus aktif dan dapat diposting.`,
    );
  }
  const allowed = await listCashBankIds(tx, companyId);
  if (!allowed.has(accountId)) {
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} — ${account.name} bukan akun berkelas kas, bank, atau kliring untuk perusahaan ini. Pilih akun dari daftar akun kas/bank.`,
    );
  }
}

export async function createEmployeeAdvance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    employeeId: string;
    date: string;
    amount: MoneyInput;
    accountId: string;
    planMode: AdvancePlanMode;
    planValue?: MoneyInput | null;
    note?: string | null;
  },
): Promise<{ id: string; number: string; journalId: string }> {
  // Pemetaan wajib ada sebelum apa pun ditulis — jangan menebak akun.
  const receivableAccountId = await getAccountId(tx, input.companyId, "employee_receivable");

  const [person] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1);
  if (!person) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");
  if (!person.isActive) throw new AppError("VALIDATION", `Karyawan ${person.name} sudah nonaktif.`);

  const amount = d(input.amount);
  if (!amount.isFinite() || !amount.gt(0)) {
    throw new AppError("VALIDATION", "Jumlah kasbon harus lebih dari nol.");
  }

  let planValue: Decimal | null = null;
  if (input.planMode === "fixed") {
    planValue = d(input.planValue ?? 0);
    if (!planValue.isFinite() || !planValue.gt(0)) {
      throw new AppError("VALIDATION", "Nominal cicilan per periode harus lebih dari nol.");
    }
  } else if (input.planMode === "percent") {
    planValue = d(input.planValue ?? 0);
    if (!planValue.isFinite() || planValue.lt(1) || planValue.gt(100)) {
      throw new AppError("VALIDATION", "Persen potongan harus antara 1 dan 100.");
    }
  } else if (input.planMode !== "full") {
    throw new AppError("VALIDATION", "Mode rencana potongan tidak dikenal.");
  }

  await assertCashLikeAccount(tx, input.companyId, input.accountId);

  const number = await nextDocumentNumber(tx, input.companyId, "EMPLOYEE_ADVANCE", input.date);
  const [advance] = await tx
    .insert(employeeAdvances)
    .values({
      companyId: input.companyId,
      number,
      employeeId: person.id,
      date: input.date,
      amount: toDb(amount),
      remainingAmount: toDb(amount),
      accountId: input.accountId,
      planMode: input.planMode,
      planValue: planValue ? toDb(planValue) : null,
      note: input.note ?? null,
      status: "open",
      createdBy: input.userId,
    })
    .returning({ id: employeeAdvances.id });

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Kasbon karyawan ${number} — ${person.name}`,
    sourceType: "employee_advance",
    sourceId: advance.id,
    createdBy: input.userId,
    idempotencyKey: `employee_advance:${advance.id}`,
    lines: [
      {
        accountId: receivableAccountId,
        debit: amount,
        description: `Piutang kasbon ${person.name}`,
        partyType: "employee",
        partyId: person.id,
      },
      { accountId: input.accountId, credit: amount, description: `Kas/bank keluar untuk kasbon ${number}` },
    ],
  });

  await tx
    .update(employeeAdvances)
    .set({ journalId: entry.id })
    .where(and(eq(employeeAdvances.companyId, input.companyId), eq(employeeAdvances.id, advance.id)));

  return { id: advance.id, number, journalId: entry.id };
}

export async function listOpenAdvances(
  tx: Tx,
  companyId: string,
  employeeId: string,
  lock = false,
): Promise<AdvanceRow[]> {
  const query = tx
    .select()
    .from(employeeAdvances)
    .where(
      and(
        eq(employeeAdvances.companyId, companyId),
        eq(employeeAdvances.employeeId, employeeId),
        eq(employeeAdvances.status, "open"),
      ),
    )
    .orderBy(asc(employeeAdvances.date), asc(employeeAdvances.createdAt));
  return lock ? query.for("update") : query;
}

/** Total sisa seluruh kasbon berjalan satu karyawan. */
export async function getOpenAdvanceTotal(tx: Tx, companyId: string, employeeId: string): Promise<Decimal> {
  const open = await listOpenAdvances(tx, companyId, employeeId);
  return open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
}

/** Potongan yang diusulkan satu kasbon sebelum batas gaji bersih. */
export function plannedInstallment(advance: AdvanceRow, baseSalary: Decimal): Decimal {
  const remaining = d(advance.remainingAmount);
  if (advance.planMode === "fixed") {
    return Decimal.min(d(advance.planValue ?? 0), remaining);
  }
  if (advance.planMode === "percent") {
    // Basis persen (D-22): gaji pokok karyawan pada periode berjalan.
    return Decimal.min(baseSalary.mul(d(advance.planValue ?? 0)).div(100), remaining);
  }
  return remaining; // full
}

export type AdvanceProposal = {
  total: Decimal;
  allocations: Array<{ advanceId: string; amount: Decimal }>;
};

/**
 * Inti hitung usulan dari daftar kasbon berjalan yang SUDAH dimuat dan
 * terurut FIFO (date, createdAt). Satu-satunya tempat logika usulan
 * hidup: jalur per-karyawan dan jalur batch memanggil fungsi ini agar
 * angka usulan keduanya tidak pernah bisa berbeda.
 */
export function computeAdvanceProposal(open: AdvanceRow[], person: EmployeeRow): AdvanceProposal {
  const baseSalary = d(person.baseSalary);
  const netBefore = baseSalary.plus(d(person.allowances)).minus(d(person.deductions));
  let capLeft = Decimal.max(netBefore, 0);
  const allocations: Array<{ advanceId: string; amount: Decimal }> = [];
  let total = d(0);
  for (const advance of open) {
    if (capLeft.lte(0)) break;
    const planned = plannedInstallment(advance, baseSalary);
    const amount = Decimal.min(planned, capLeft);
    if (amount.gt(0)) {
      allocations.push({ advanceId: advance.id, amount });
      total = total.plus(amount);
      capLeft = capLeft.minus(amount);
    }
  }
  return { total, allocations };
}

/**
 * Usulan potongan payroll untuk satu karyawan: FIFO dari kasbon tertua,
 * dibatasi agar gaji bersih (bruto − potongan tetap) tidak negatif.
 * Kelebihan rencana terbawa ke periode berikut; rencana tidak berubah.
 */
export async function proposeAdvanceDeductions(
  tx: Tx,
  companyId: string,
  person: EmployeeRow,
): Promise<AdvanceProposal> {
  const open = await listOpenAdvances(tx, companyId, person.id);
  return computeAdvanceProposal(open, person);
}

export type AdvanceProposalBatchRow = {
  employeeId: string;
  openTotal: Decimal;
  proposal: AdvanceProposal;
};

/**
 * SIM-2 S4 (PERF-01): usulan potongan kasbon untuk SELURUH karyawan
 * aktif dalam SATU query. Halaman payroll sebelumnya menjalankan dua
 * query berurutan per karyawan berkasbon (getOpenAdvanceTotal +
 * proposeAdvanceDeductions di dalam loop) sehingga waktu muat tumbuh
 * linear dengan jumlah karyawan. Di sini semua kasbon berjalan
 * perusahaan dimuat sekali, dikelompokkan per karyawan di memori
 * dengan urutan FIFO yang sama (employeeId, date, createdAt), dan
 * dihitung oleh computeAdvanceProposal yang sama — hasil per karyawan
 * identik dengan jalur per-karyawan (dikunci test pembanding).
 * Hanya karyawan aktif dengan sisa kasbon > 0 yang dikembalikan,
 * mengikuti perilaku halaman.
 */
export async function proposeAdvanceDeductionsBatch(
  tx: Tx,
  companyId: string,
  staff: EmployeeRow[],
): Promise<AdvanceProposalBatchRow[]> {
  const openRows = await tx
    .select()
    .from(employeeAdvances)
    .where(and(eq(employeeAdvances.companyId, companyId), eq(employeeAdvances.status, "open")))
    .orderBy(
      asc(employeeAdvances.employeeId),
      asc(employeeAdvances.date),
      asc(employeeAdvances.createdAt),
    );
  const byEmployee = new Map<string, AdvanceRow[]>();
  for (const row of openRows) {
    const list = byEmployee.get(row.employeeId);
    if (list) list.push(row);
    else byEmployee.set(row.employeeId, [row]);
  }
  const result: AdvanceProposalBatchRow[] = [];
  for (const person of staff) {
    if (!person.isActive) continue;
    const open = byEmployee.get(person.id) ?? [];
    const openTotal = open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
    if (!openTotal.gt(0)) continue;
    result.push({
      employeeId: person.id,
      openTotal,
      proposal: computeAdvanceProposal(open, person),
    });
  }
  return result;
}

async function applyAllocations(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    employeeId: string;
    total: Decimal;
    kind: "payroll_deduction" | "repayment";
    date: string;
    journalId: string;
    payrollRunId?: string | null;
    accountId?: string | null;
    note?: string | null;
  },
): Promise<Array<{ advanceId: string; amount: Decimal }>> {
  const open = await listOpenAdvances(tx, input.companyId, input.employeeId, true);
  const openTotal = open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
  if (input.total.gt(openTotal)) {
    throw new AppError(
      "VALIDATION",
      `Nominal melebihi sisa kasbon berjalan (${openTotal.toFixed(2)}).`,
    );
  }
  const allocations: Array<{ advanceId: string; amount: Decimal }> = [];
  let left = input.total;
  for (const advance of open) {
    if (left.lte(0)) break;
    const amount = Decimal.min(d(advance.remainingAmount), left);
    if (!amount.gt(0)) continue;
    const remaining = d(advance.remainingAmount).minus(amount);
    await tx.insert(employeeAdvanceEntries).values({
      companyId: input.companyId,
      advanceId: advance.id,
      kind: input.kind,
      date: input.date,
      amount: toDb(amount),
      accountId: input.accountId ?? null,
      journalId: input.journalId,
      payrollRunId: input.payrollRunId ?? null,
      note: input.note ?? null,
      createdBy: input.userId,
    });
    await tx
      .update(employeeAdvances)
      .set({ remainingAmount: toDb(remaining), status: remaining.lte(0) ? "settled" : "open" })
      .where(and(eq(employeeAdvances.companyId, input.companyId), eq(employeeAdvances.id, advance.id)));
    allocations.push({ advanceId: advance.id, amount });
    left = left.minus(amount);
  }
  return allocations;
}

/**
 * Terapkan potongan kasbon yang sudah diputuskan run payroll (usulan atau
 * override manual yang sudah divalidasi pemanggil). Jurnalnya adalah
 * jurnal payroll itu sendiri; entri di sini menautkan alokasi ke jurnal
 * & run tersebut. Alokasi berjalan FIFO dengan plafon cicilan rencana
 * tiap kasbon: total potongan pertama-tama mengisi cicilan terencana
 * kasbon tertua dulu; hanya bila total yang diputuskan melebihi jumlah
 * seluruh cicilan terencana (override manual lebih besar) sisa total
 * mengisi sisa kasbon tertua berikutnya.
 */
export async function applyPayrollAdvanceDeductions(
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
    const open = await listOpenAdvances(tx, input.companyId, employeeId, true);
    const openTotal = open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
    if (total.gt(openTotal)) {
      throw new AppError("VALIDATION", `Potongan kasbon melebihi sisa kasbon berjalan (${openTotal.toFixed(2)}).`);
    }
    const baseSalary = d(person.baseSalary);
    let budget = total;
    const allocated = new Map<string, Decimal>();
    // Lintasan 1: cicilan terencana, FIFO.
    for (const advance of open) {
      if (budget.lte(0)) break;
      const amount = Decimal.min(plannedInstallment(advance, baseSalary), d(advance.remainingAmount), budget);
      if (amount.gt(0)) {
        allocated.set(advance.id, amount);
        budget = budget.minus(amount);
      }
    }
    // Lintasan 2: total override melebihi cicilan terencana — isi sisa
    // kasbon tertua dulu.
    for (const advance of open) {
      if (budget.lte(0)) break;
      const already = allocated.get(advance.id) ?? d(0);
      const room = d(advance.remainingAmount).minus(already);
      const amount = Decimal.min(room, budget);
      if (amount.gt(0)) {
        allocated.set(advance.id, already.plus(amount));
        budget = budget.minus(amount);
      }
    }
    for (const advance of open) {
      const amount = allocated.get(advance.id);
      if (!amount || !amount.gt(0)) continue;
      const remaining = d(advance.remainingAmount).minus(amount);
      await tx.insert(employeeAdvanceEntries).values({
        companyId: input.companyId,
        advanceId: advance.id,
        kind: "payroll_deduction",
        date: input.date,
        amount: toDb(amount),
        journalId: input.journalId,
        payrollRunId: input.runId,
        createdBy: input.userId,
      });
      await tx
        .update(employeeAdvances)
        .set({ remainingAmount: toDb(remaining), status: remaining.lte(0) ? "settled" : "open" })
        .where(and(eq(employeeAdvances.companyId, input.companyId), eq(employeeAdvances.id, advance.id)));
    }
  }
}

/**
 * Void payroll memulihkan sisa kasbon: setiap potongan milik run itu
 * yang belum dipulihkan mendapat entri pembalik dan sisa kasbonnya
 * bertambah kembali (status settled dapat kembali open).
 */
export async function restorePayrollAdvanceDeductions(
  tx: Tx,
  input: { companyId: string; userId: string; runId: string; date: string },
) {
  const deducted = await tx
    .select()
    .from(employeeAdvanceEntries)
    .where(
      and(
        eq(employeeAdvanceEntries.companyId, input.companyId),
        eq(employeeAdvanceEntries.kind, "payroll_deduction"),
        eq(employeeAdvanceEntries.payrollRunId, input.runId),
      ),
    )
    .orderBy(asc(employeeAdvanceEntries.createdAt));
  for (const entry of deducted) {
    const [already] = await tx
      .select({ id: employeeAdvanceEntries.id })
      .from(employeeAdvanceEntries)
      .where(
        and(
          eq(employeeAdvanceEntries.companyId, input.companyId),
          eq(employeeAdvanceEntries.kind, "payroll_reversal"),
          eq(employeeAdvanceEntries.reversalOfId, entry.id),
        ),
      )
      .limit(1);
    if (already) continue;
    const [advance] = await tx
      .select()
      .from(employeeAdvances)
      .where(and(eq(employeeAdvances.companyId, input.companyId), eq(employeeAdvances.id, entry.advanceId)))
      .limit(1)
      .for("update");
    if (!advance || advance.status === "void") continue;
    await tx.insert(employeeAdvanceEntries).values({
      companyId: input.companyId,
      advanceId: advance.id,
      kind: "payroll_reversal",
      date: input.date,
      amount: entry.amount,
      journalId: null,
      payrollRunId: input.runId,
      reversalOfId: entry.id,
      note: "Payroll dibatalkan — potongan kasbon dipulihkan",
      createdBy: input.userId,
    });
    const remaining = d(advance.remainingAmount).plus(d(entry.amount));
    await tx
      .update(employeeAdvances)
      .set({ remainingAmount: toDb(remaining), status: "open" })
      .where(and(eq(employeeAdvances.companyId, input.companyId), eq(employeeAdvances.id, advance.id)));
  }
}

/** Setoran tunai karyawan di luar payroll: Dr Kas/Bank / Cr Piutang Karyawan, FIFO. */
export async function recordAdvanceRepayment(
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
): Promise<{ journalId: string; allocations: Array<{ advanceId: string; amount: Decimal }> }> {
  const receivableAccountId = await getAccountId(tx, input.companyId, "employee_receivable");
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

  const open = await listOpenAdvances(tx, input.companyId, person.id, true);
  const openTotal = open.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
  if (amount.gt(openTotal)) {
    throw new AppError(
      "VALIDATION",
      `Setoran ${person.name} melebihi sisa kasbon berjalannya (${openTotal.toFixed(2)}).`,
    );
  }

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Setoran kasbon karyawan — ${person.name}`,
    sourceType: "employee_advance_repayment",
    sourceId: null,
    createdBy: input.userId,
    idempotencyKey: `employee_advance_repayment:${crypto.randomUUID()}`,
    lines: [
      { accountId: input.accountId, debit: amount, description: `Kas/bank masuk dari setoran kasbon ${person.name}` },
      {
        accountId: receivableAccountId,
        credit: amount,
        description: `Piutang kasbon ${person.name} berkurang`,
        partyType: "employee",
        partyId: person.id,
      },
    ],
  });

  const allocations = await applyAllocations(tx, {
    companyId: input.companyId,
    userId: input.userId,
    employeeId: person.id,
    total: amount,
    kind: "repayment",
    date: input.date,
    journalId: entry.id,
    accountId: input.accountId,
    note: input.note ?? null,
  });
  return { journalId: entry.id, allocations };
}

/**
 * Batalkan kasbon: hanya bila belum ada potongan/setoran sama sekali.
 * Jurnal pemberian dibalik penuh mengikuti pola repo; dokumen yang
 * sudah bergerak ditolak agar sisa kasbon tidak menggantung.
 */
export async function voidEmployeeAdvance(
  tx: Tx,
  input: { companyId: string; userId: string; advanceId: string; reason: string; date: string },
) {
  const [advance] = await tx
    .select()
    .from(employeeAdvances)
    .where(and(eq(employeeAdvances.companyId, input.companyId), eq(employeeAdvances.id, input.advanceId)))
    .limit(1)
    .for("update");
  if (!advance) throw new AppError("NOT_FOUND", "Kasbon tidak ditemukan.");
  if (advance.status === "void") throw new AppError("INVALID_STATE", "Kasbon sudah dibatalkan.");
  if (advance.status !== "open") {
    throw new AppError("INVALID_STATE", "Hanya kasbon berstatus berjalan yang bisa dibatalkan.");
  }
  const [movement] = await tx
    .select({ id: employeeAdvanceEntries.id })
    .from(employeeAdvanceEntries)
    .where(eq(employeeAdvanceEntries.advanceId, advance.id))
    .limit(1);
  if (movement) {
    throw new AppError(
      "INVALID_STATE",
      `Kasbon ${advance.number} sudah memiliki potongan atau setoran dan tidak dapat dibatalkan. Selesaikan lewat pelunasan sisa kasbonnya.`,
    );
  }
  const reversal = await reverseSourceJournal(tx, {
    companyId: input.companyId,
    sourceType: "employee_advance",
    sourceId: advance.id,
    date: input.date,
    description: `Pembatalan kasbon ${advance.number} — ${input.reason}`,
    createdBy: input.userId,
  });
  if (!reversal) {
    throw new AppError(
      "VALIDATION",
      `Jurnal asal kasbon ${advance.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan dibatalkan agar buku besar tetap selaras.`,
    );
  }
  await tx
    .update(employeeAdvances)
    .set({ status: "void", remainingAmount: "0" })
    .where(and(eq(employeeAdvances.companyId, input.companyId), eq(employeeAdvances.id, advance.id)));
  return { id: advance.id, reversalNumber: reversal.number };
}

/* ------------------------------------------------------------------ */
/* Read models for the Kasbon pages                                    */
/* ------------------------------------------------------------------ */

export async function listEmployeeAdvances(tx: Tx, companyId: string) {
  return tx
    .select({
      id: employeeAdvances.id,
      number: employeeAdvances.number,
      employeeId: employeeAdvances.employeeId,
      employeeCode: employees.code,
      employeeName: employees.name,
      date: employeeAdvances.date,
      amount: employeeAdvances.amount,
      remainingAmount: employeeAdvances.remainingAmount,
      planMode: employeeAdvances.planMode,
      planValue: employeeAdvances.planValue,
      note: employeeAdvances.note,
      status: employeeAdvances.status,
      journalId: employeeAdvances.journalId,
      createdAt: employeeAdvances.createdAt,
    })
    .from(employeeAdvances)
    .innerJoin(employees, eq(employeeAdvances.employeeId, employees.id))
    .where(eq(employeeAdvances.companyId, companyId))
    .orderBy(desc(employeeAdvances.date), desc(employeeAdvances.createdAt));
}

export async function getEmployeeAdvanceHistory(tx: Tx, companyId: string, employeeId: string) {
  const [person] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)))
    .limit(1);
  if (!person) return null;
  const advances = await tx
    .select()
    .from(employeeAdvances)
    .where(and(eq(employeeAdvances.companyId, companyId), eq(employeeAdvances.employeeId, employeeId)))
    .orderBy(asc(employeeAdvances.date), asc(employeeAdvances.createdAt));
  const advanceIds = advances.map((adv) => adv.id);
  const own =
    advanceIds.length === 0
      ? []
      : await tx
          .select({
            id: employeeAdvanceEntries.id,
            advanceId: employeeAdvanceEntries.advanceId,
            advanceNumber: employeeAdvances.number,
            kind: employeeAdvanceEntries.kind,
            date: employeeAdvanceEntries.date,
            amount: employeeAdvanceEntries.amount,
            journalId: employeeAdvanceEntries.journalId,
            payrollRunId: employeeAdvanceEntries.payrollRunId,
            note: employeeAdvanceEntries.note,
            createdAt: employeeAdvanceEntries.createdAt,
          })
          .from(employeeAdvanceEntries)
          .innerJoin(employeeAdvances, eq(employeeAdvanceEntries.advanceId, employeeAdvances.id))
          .where(
            and(
              eq(employeeAdvanceEntries.companyId, companyId),
              inArray(employeeAdvanceEntries.advanceId, advanceIds),
            ),
          )
          .orderBy(asc(employeeAdvanceEntries.date), asc(employeeAdvanceEntries.createdAt));
  const runIds = [...new Set(own.map((entry) => entry.payrollRunId).filter(Boolean))] as string[];
  return { employee: person, advances, entries: own, runIds };
}

// FIX-ARS Tahap 6 (ARS1-01): id kasbon yang sudah memiliki entri
// (pernah bergerak) — dulu kueri inline di halaman daftar kasbon.
export async function listMovedAdvanceIds(tx: Tx, companyId: string, advanceIds: string[]) {
  if (advanceIds.length === 0) return new Set<string>();
  const rows = await tx
    .select({ advanceId: employeeAdvanceEntries.advanceId })
    .from(employeeAdvanceEntries)
    .where(
      and(
        eq(employeeAdvanceEntries.companyId, companyId),
        inArray(employeeAdvanceEntries.advanceId, advanceIds),
      ),
    );
  return new Set(rows.map((row) => row.advanceId));
}
