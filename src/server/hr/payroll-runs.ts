// A-26 Q4 (K-03): domain pembayaran & pembatalan run payroll —
// dipindah utuh dari payPayrollAction & voidPayrollRunAction di
// lapisan aksi; aksi kini hanya auth, parsing, dan revalidasi.
// Perilaku, urutan langkah, & pesan identik dengan blok lama.
// Run payroll itu sendiri (runPayrollAction) belum berpindah —
// lihat catatan sisa terukur tahap Q4.

import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { journalEntries, payrollRuns } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { d, toDb } from "@/lib/money";
import { getAccountMap, listCashBankIds, postJournal } from "@/server/accounting";
import { reverseSourceJournalPreferringDate } from "@/server/accounting-reversal";
import { writeAudit } from "@/server/audit";
import {
  restorePayrollAdvanceDeductions,
} from "@/server/employee-advances";
import {
  restorePayrollLoanDeductions,
} from "@/server/employee-loans";
import { periodEndDate } from "@/lib/format";
import { restoreComponentDrafts } from "./drafts";

export async function payPayrollRun(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    userRole?: string | null;
    runId: string;
    accountId: string;
    date: string;
  },
) {
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, input.companyId), eq(payrollRuns.id, input.runId)))
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND", "Payroll tidak ditemukan.");
  if (run.status === "paid") throw new AppError("INVALID_STATE", "Payroll sudah dibayar.");
  if (run.status !== "posted") throw new AppError("INVALID_STATE", "Payroll belum berstatus posted.");

  // WF-022: Maker-checker — pembuat payroll run tidak dapat melakukan pembayaran gaji sendiri (Four-Eyes Principle)
  if (
    input.userRole &&
    input.userRole !== "owner" &&
    input.userRole !== "admin" &&
    input.userId &&
    run.createdBy &&
    run.createdBy === input.userId
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Prinsip Maker-Checker (Four-Eyes Principle): Pembayaran gaji harus dieksekusi atau disahkan oleh pengguna selain pembuat draft run payroll.",
    );
  }

  const map = await getAccountMap(tx, input.companyId);
  // ACC-02: pembayaran gaji hanya boleh mengkredit akun kas/bank/kliring
  // yang aktif dan postable. Tanpa ini akun pendapatan/piutang dapat
  // dikredit dan run tetap ditandai paid tanpa arus kas keluar.
  const cashBankIds = await listCashBankIds(tx, input.companyId);
  if (!cashBankIds.has(input.accountId)) {
    throw new AppError(
      "VALIDATION",
      "Akun pembayaran gaji harus akun kas, bank, atau kliring yang aktif dan dapat diposting.",
    );
  }
  const amount = d(run.totalNet);
  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Pembayaran gaji ${run.number}`,
    sourceType: "payroll_payment",
    sourceId: run.id,
    createdBy: input.userId,
    idempotencyKey: `payroll_payment:${run.id}`,
    lines: [
      { accountId: map.salary_payable, debit: amount, description: "Utang gaji berkurang" },
      { accountId: input.accountId, credit: amount, description: "Kas/bank keluar" },
    ],
  });

  await tx
    .update(payrollRuns)
    .set({ status: "paid" })
    .where(and(eq(payrollRuns.companyId, input.companyId), eq(payrollRuns.id, run.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "payroll.pay",
    entityType: "payroll_run",
    entityId: run.id,
    after: { number: run.number, amount: toDb(amount), entry: entry.number },
  });
  return { entry, amount };
}

/**
 * Membatalkan pembayaran gaji (bukan run-nya). Jurnal pembayaran
 * `payroll_payment:<runId>` dibalik dan status run kembali `posted`,
 * sehingga run dapat dibayar ulang dengan akun/tanggal yang benar.
 */
export async function voidPayrollPayment(
  tx: Tx,
  input: { companyId: string; userId: string; runId: string; reason: string },
) {
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, input.companyId), eq(payrollRuns.id, input.runId)))
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND", "Payroll tidak ditemukan.");
  if (run.status !== "paid") {
    throw new AppError("INVALID_STATE", "Hanya pembayaran gaji berstatus paid yang dapat dibatalkan.");
  }
  const [paymentEntry] = await tx
    .select({ id: journalEntries.id, number: journalEntries.number, date: journalEntries.date })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.sourceType, "payroll_payment"),
        eq(journalEntries.sourceId, run.id),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (!paymentEntry) {
    throw new AppError(
      "INVALID_STATE",
      `Jurnal pembayaran gaji ${run.number} tidak ditemukan; status run tidak dapat dikembalikan dengan aman.`,
    );
  }
  const reversal = await reverseSourceJournalPreferringDate(tx, {
    companyId: input.companyId,
    sourceType: "payroll_payment",
    sourceId: run.id,
    originalDate: paymentEntry.date,
    description: `Pembatalan pembayaran gaji ${run.number} — ${input.reason}`,
    createdBy: input.userId,
  });
  if (!reversal) {
    throw new AppError(
      "VALIDATION",
      `Jurnal pembayaran gaji ${run.number} tidak dapat dibalik. Periksa jurnal ${paymentEntry.number} terlebih dahulu.`,
    );
  }
  await tx
    .update(payrollRuns)
    .set({ status: "posted" })
    .where(and(eq(payrollRuns.companyId, input.companyId), eq(payrollRuns.id, run.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "payroll.payment.void",
    entityType: "payroll_run",
    entityId: run.id,
    before: { status: "paid", paymentJournal: paymentEntry.number },
    after: { status: "posted", reversalJournal: reversal.number, reason: input.reason },
  });
  return { id: run.id, reversalNumber: reversal.number };
}

export async function voidPayrollRun(
  tx: Tx,
  input: { companyId: string; userId: string; userRole?: string | null; id: string; reason: string },
) {
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, input.companyId), eq(payrollRuns.id, input.id)))
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND", "Payroll tidak ditemukan.");
  if (run.status === "void") throw new AppError("INVALID_STATE", "Payroll sudah dibatalkan.");
  // AK-P2-04: run yang gajinya sudah dibayarkan tidak boleh di-void —
  // membaliknya akan menarik kembali beban yang kasnya sudah keluar.
  // Pembatalan pembayaran gaji sendiri berada di luar cakupan fitur ini.
  if (run.status === "paid") {
    throw new AppError(
      "INVALID_STATE",
      `Payroll ${run.number} sudah dibayar dan tidak bisa dibatalkan. Batalkan pembayaran gaji terlebih dahulu bila pembayaran itu memang salah.`,
    );
  }
  if (run.status !== "posted") {
    throw new AppError("INVALID_STATE", "Hanya payroll berstatus posted yang bisa dibatalkan.");
  }

  // WF-022: Maker-checker — pembatalan payroll diproses atau disahkan oleh selain pembuat run
  if (
    input.userRole &&
    input.userRole !== "owner" &&
    input.userRole !== "admin" &&
    input.userId &&
    run.createdBy &&
    run.createdBy === input.userId
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Prinsip Maker-Checker (Four-Eyes Principle): Pembatalan (void) payroll harus disahkan oleh pengguna selain pembuat draft run payroll.",
    );
  }
  // Penjaga kedua: jurnal pembayaran gaji yang masih posted juga menolak,
  // seandainya status run tidak sinkron dengan buku besar.
  const [paymentEntry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.sourceType, "payroll_payment"),
        eq(journalEntries.sourceId, run.id),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (paymentEntry) {
    throw new AppError(
      "INVALID_STATE",
      `Payroll ${run.number} sudah memiliki jurnal pembayaran gaji dan tidak bisa dibatalkan. Batalkan pembayaran gaji terlebih dahulu bila pembayaran itu memang salah.`,
    );
  }

  // Pola AK-P2-05: kegagalan membuat jurnal pembalik tidak boleh ditelan —
  // menandai run void tanpa pembalik membuat daftar payroll dan buku
  // besar berbeda diam-diam.
  const reversal = await reverseSourceJournalPreferringDate(tx, {
    companyId: input.companyId,
    sourceType: "payroll",
    sourceId: run.id,
    originalDate: periodEndDate(run.period),
    description: `Pembatalan payroll ${run.number} — ${input.reason}`,
    createdBy: input.userId,
  });
  if (!reversal) {
    throw new AppError(
      "VALIDATION",
      `Jurnal asal payroll ${run.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan payroll dibatalkan agar daftar payroll dan buku besar tetap selaras; periksa jurnal payroll ini terlebih dahulu.`,
    );
  }
  // A-11 (D-22): jurnal pembalik di atas sudah membalik kredit
  // Piutang Karyawan; sisa kasbon yang terpotong run ini dipulihkan
  // di sini agar saldo kasbon dan buku besar kembali selaras.
  await restorePayrollAdvanceDeductions(tx, {
    companyId: input.companyId,
    userId: input.userId,
    runId: run.id,
    date: todayISO(),
  });
  // SIM-2 S7B-2: cicilan pinjaman run ini juga dipulihkan agar sisa
  // pinjaman dan buku besar kembali selaras.
  await restorePayrollLoanDeductions(tx, {
    companyId: input.companyId,
    userId: input.userId,
    runId: run.id,
    date: todayISO(),
  });
  // SIM-2 S7B-1: draf komponen (THR) yang terpakai run ini kembali
  // menjadi draf agar proses ulang memuatnya lagi.
  await restoreComponentDrafts(tx, { companyId: input.companyId, runId: run.id });
  await tx
    .update(payrollRuns)
    .set({ status: "void" })
    .where(and(eq(payrollRuns.companyId, input.companyId), eq(payrollRuns.id, run.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "payroll.void",
    entityType: "payroll_run",
    entityId: run.id,
    after: { number: run.number, period: run.period, reason: input.reason, reversalNumber: reversal.number },
  });
}
