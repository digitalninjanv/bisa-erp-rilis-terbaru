import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, employees, reimbursementClaims } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, lineTax, toDb, type MoneyInput } from "@/lib/money";
import { getAccountId, postJournal } from "@/server/accounting";
import { assertCashLikeAccount } from "@/server/employee-advances";
import { nextDocumentNumber } from "@/server/sequences";

/**
 * SIM-2 S7B-2 (§6F): Reimbursement — klaim biaya karyawan dengan
 * persetujuan atasan (maker-checker: pengesah tidak boleh pengaju,
 * pola yang sama dengan persetujuan penyesuaian stok T5-3).
 *
 * Aturan akuntansi yang ditegakkan:
 * - Klaim yang DISAHKAN adalah beban perusahaan. Pembayarannya
 *   menjurnal Dr akun beban kategori klaim / Cr kas-bank — piutang
 *   karyawan (1220) tidak pernah tersentuh oleh reimbursement.
 * - Pembayaran memakai jalur tunai langsung (pola modul Beban), BUKAN
 *   digabung ke payroll: klaim adalah pengembalian biaya yang sudah
 *   keluar dari kantong karyawan, dan menggabungkannya ke gaji akan
 *   mencampurnya dengan komponen penghasilan kena pajak. Pilihan ini
 *   dicatat di laporan S7B-2.
 * - Klaim ditolak tidak dapat dibayar; klaim yang sama (karyawan,
 *   tanggal, kategori, nominal, keterangan) tidak dapat diajukan dua
 *   kali selama masih terbuka (acceptance §6F S0-C).
 */

export const REIMBURSEMENT_STATUS_LABELS: Record<string, string> = {
  submitted: "Menunggu persetujuan",
  approved: "Disahkan",
  rejected: "Ditolak",
  paid: "Terbayar",
};

type ClaimRow = typeof reimbursementClaims.$inferSelect;

async function assertExpenseAccount(tx: Tx, companyId: string, accountId: string) {
  const [account] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) throw new AppError("VALIDATION", "Akun kategori beban tidak ditemukan di perusahaan ini.");
  if (account.type !== "expense" || !account.isPostable || !account.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} — ${account.name} tidak dapat menjadi kategori reimbursement: harus akun beban yang aktif dan dapat diposting.`,
    );
  }
  return account;
}

export async function submitReimbursementClaim(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    employeeId: string;
    date: string;
    expenseAccountId: string;
    amount: MoneyInput;
    description: string;
    attachmentName?: string | null;
    attachmentNote?: string | null;
    /** Nominal termasuk PPN — pisahkan PPN Masukan saat pembayaran
     * (A-21 R3-10, pola createExpense persis). */
    taxIncluded?: boolean;
    /** Tarif PPN perusahaan (persen) saat pengajuan; dari pengaturan. */
    taxRate?: MoneyInput;
  },
): Promise<ClaimRow> {
  const [person] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.employeeId)))
    .limit(1);
  if (!person) throw new AppError("NOT_FOUND", "Karyawan tidak ditemukan.");
  const amount = d(input.amount);
  if (!amount.isFinite() || !amount.gt(0)) {
    throw new AppError("VALIDATION", "Nominal klaim harus lebih dari nol.");
  }
  // A-21 (R3-10): opsi "Termasuk PPN" dibekukan sebagai tarif di baris
  // klaim — pola createExpense: opsi aktif dengan tarif efektif 0
  // (PPN nonaktif/belum diatur) DITOLAK, tidak diabaikan diam-diam
  // (D-25). Porsi pajaknya dihitung saat pembayaran dari nominal yang
  // disahkan, jadi pengurangan oleh pengesah tetap proporsional.
  const taxIncluded = input.taxIncluded ?? false;
  const taxRate = taxIncluded ? d(input.taxRate ?? 0) : d(0);
  if (taxIncluded && (!taxRate.isFinite() || taxRate.lte(0))) {
    throw new AppError(
      "VALIDATION",
      "Opsi \"Termasuk PPN\" dipilih, tetapi PPN perusahaan sedang nonaktif atau tarifnya 0. Aktifkan PPN dan atur tarifnya di Pengaturan, atau matikan opsi tersebut.",
    );
  }
  const description = input.description.trim();
  if (description.length < 3) {
    throw new AppError("VALIDATION", "Keterangan klaim wajib diisi (minimal 3 karakter).");
  }
  await assertExpenseAccount(tx, input.companyId, input.expenseAccountId);

  // Penjaga duplikat §6F: dokumen sumber yang sama tidak boleh masuk
  // dua kali selama klaim sebelumnya masih terbuka (submitted/approved).
  const duplicates = await tx
    .select({ id: reimbursementClaims.id, number: reimbursementClaims.number, amount: reimbursementClaims.amount, status: reimbursementClaims.status, description: reimbursementClaims.description })
    .from(reimbursementClaims)
    .where(
      and(
        eq(reimbursementClaims.companyId, input.companyId),
        eq(reimbursementClaims.employeeId, person.id),
        eq(reimbursementClaims.date, input.date),
        eq(reimbursementClaims.expenseAccountId, input.expenseAccountId),
        eq(reimbursementClaims.amount, toDb(amount)),
        eq(reimbursementClaims.description, description),
      ),
    );
  const openDuplicate = duplicates.find((row) => row.status === "submitted" || row.status === "approved");
  if (openDuplicate) {
    throw new AppError(
      "CONFLICT",
      `Klaim yang sama sudah tercatat sebagai ${openDuplicate.number} dan masih terbuka. Periksa daftar klaim sebelum mengajukan ulang.`,
    );
  }

  const number = await nextDocumentNumber(tx, input.companyId, "REIMBURSEMENT", input.date);
  const [claim] = await tx
    .insert(reimbursementClaims)
    .values({
      companyId: input.companyId,
      number,
      employeeId: person.id,
      date: input.date,
      expenseAccountId: input.expenseAccountId,
      amount: toDb(amount),
      taxRate: toDb(taxRate),
      description,
      attachmentName: input.attachmentName ?? null,
      attachmentNote: input.attachmentNote ?? null,
      status: "submitted",
      createdBy: input.userId,
    })
    .returning();
  return claim;
}

export async function decideReimbursementClaim(
  tx: Tx,
  input: {
    companyId: string;
    claimId: string;
    decidedBy: string;
    approve: boolean;
    approvedAmount?: MoneyInput | null;
    note?: string | null;
  },
): Promise<ClaimRow> {
  const [claim] = await tx
    .select()
    .from(reimbursementClaims)
    .where(and(eq(reimbursementClaims.companyId, input.companyId), eq(reimbursementClaims.id, input.claimId)))
    .limit(1)
    .for("update");
  if (!claim) throw new AppError("NOT_FOUND", "Klaim reimbursement tidak ditemukan.");
  if (claim.status !== "submitted") {
    throw new AppError(
      "INVALID_STATE",
      `Klaim ${claim.number} sudah diputuskan (status: ${REIMBURSEMENT_STATUS_LABELS[claim.status] ?? claim.status}).`,
    );
  }
  // Maker-checker: pengesah wajib orang yang berbeda dari pengaju agar
  // tidak ada klaim yang disahkan sendiri.
  if (claim.createdBy && claim.createdBy === input.decidedBy) {
    throw new AppError(
      "FORBIDDEN",
      "Klaim tidak dapat disahkan oleh pengajunya sendiri. Minta atasan atau pengguna lain untuk memutuskan.",
    );
  }
  if (!input.approve) {
    if (!input.note?.trim()) {
      throw new AppError("VALIDATION", "Alasan penolakan wajib diisi.");
    }
    const [updated] = await tx
      .update(reimbursementClaims)
      .set({
        status: "rejected",
        decidedBy: input.decidedBy,
        decidedAt: new Date(),
        decisionNote: input.note.trim(),
      })
      .where(and(eq(reimbursementClaims.companyId, input.companyId), eq(reimbursementClaims.id, claim.id)))
      .returning();
    return updated;
  }
  const approvedAmount = input.approvedAmount == null ? d(claim.amount) : d(input.approvedAmount);
  if (!approvedAmount.isFinite() || !approvedAmount.gt(0)) {
    throw new AppError("VALIDATION", "Nominal yang disahkan harus lebih dari nol.");
  }
  if (approvedAmount.gt(d(claim.amount))) {
    throw new AppError(
      "VALIDATION",
      `Nominal disahkan (${approvedAmount.toFixed(2)}) tidak boleh melebihi nominal klaim (${d(claim.amount).toFixed(2)}).`,
    );
  }
  const [updated] = await tx
    .update(reimbursementClaims)
    .set({
      status: "approved",
      approvedAmount: toDb(approvedAmount),
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    })
    .where(and(eq(reimbursementClaims.companyId, input.companyId), eq(reimbursementClaims.id, claim.id)))
    .returning();
  return updated;
}

export async function payReimbursementClaim(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    claimId: string;
    paymentAccountId: string;
    date: string;
  },
): Promise<ClaimRow> {
  const [claim] = await tx
    .select()
    .from(reimbursementClaims)
    .where(and(eq(reimbursementClaims.companyId, input.companyId), eq(reimbursementClaims.id, input.claimId)))
    .limit(1)
    .for("update");
  if (!claim) throw new AppError("NOT_FOUND", "Klaim reimbursement tidak ditemukan.");
  if (claim.status === "paid") {
    throw new AppError("INVALID_STATE", `Klaim ${claim.number} sudah terbayar.`);
  }
  if (claim.status !== "approved") {
    throw new AppError(
      "INVALID_STATE",
      `Klaim ${claim.number} belum disahkan (status: ${REIMBURSEMENT_STATUS_LABELS[claim.status] ?? claim.status}) dan tidak dapat dibayar.`,
    );
  }
  const amount = d(claim.approvedAmount ?? claim.amount);
  await assertCashLikeAccount(tx, input.companyId, input.paymentAccountId);
  const [person] = await tx
    .select({ name: employees.name })
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.id, claim.employeeId)))
    .limit(1);

  // A-21 (R3-10): belah PPN Masukan persis seperti createExpense —
  // mesin belah yang sama (lineTax inklusif) atas nominal yang
  // DISAHKAN dengan tarif yang dibekukan di klaim: jurnal menjadi
  // Dr Beban (DPP) + Dr PPN Masukan (pemetaan tax_input) / Cr kas
  // (bruto yang diterima karyawan). Klaim tanpa tarif beku (0)
  // menjurnal persis seperti sebelum tahap ini (2 baris).
  const taxRate = d(claim.taxRate);
  const tax = taxRate.gt(0) ? lineTax({ net: amount, rate: taxRate, inclusive: true }) : d(0);
  const taxInputAccountId = tax.gt(0)
    ? await getAccountId(tx, input.companyId, "tax_input")
    : null;

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Reimbursement ${claim.number} — ${person?.name ?? "karyawan"}: ${claim.description}`,
    sourceType: "reimbursement",
    sourceId: claim.id,
    createdBy: input.userId,
    idempotencyKey: `reimbursement:${claim.id}`,
    lines: [
      {
        accountId: claim.expenseAccountId,
        debit: amount.minus(tax),
        description: `Beban reimbursement ${claim.number}`,
        partyType: "employee",
        partyId: claim.employeeId,
      },
      ...(taxInputAccountId
        ? [{ accountId: taxInputAccountId, debit: tax, description: "PPN masukan atas reimbursement" }]
        : []),
      { accountId: input.paymentAccountId, credit: amount, description: `Pembayaran reimbursement ${claim.number}` },
    ],
  });

  const [updated] = await tx
    .update(reimbursementClaims)
    .set({
      status: "paid",
      paymentAccountId: input.paymentAccountId,
      paidDate: input.date,
      journalId: entry.id,
    })
    .where(and(eq(reimbursementClaims.companyId, input.companyId), eq(reimbursementClaims.id, claim.id)))
    .returning();
  return updated;
}

/**
 * A-22 Tahap K5: antrean persetujuan klaim untuk kartu dashboard —
 * klaim berstatus "submitted" adalah satu-satunya keadaan yang
 * menunggu keputusan pengguna lain (maker-checker). Klaim disahkan
 * menunggu pembayaran dicatat di halaman klaim itu sendiri.
 */
export async function countPendingReimbursementClaims(
  tx: Tx,
  companyId: string,
): Promise<{ count: number; total: string }> {
  const [row] = await tx
    .select({
      count: count(),
      total: sql<string>`coalesce(sum(${reimbursementClaims.amount}), 0)::text`,
    })
    .from(reimbursementClaims)
    .where(
      and(
        eq(reimbursementClaims.companyId, companyId),
        eq(reimbursementClaims.status, "submitted"),
      ),
    );
  return { count: row?.count ?? 0, total: toDb(row?.total ?? 0) };
}

export async function listReimbursementClaims(tx: Tx, companyId: string) {
  return tx
    .select({
      id: reimbursementClaims.id,
      number: reimbursementClaims.number,
      employeeId: reimbursementClaims.employeeId,
      employeeCode: employees.code,
      employeeName: employees.name,
      date: reimbursementClaims.date,
      expenseAccountId: reimbursementClaims.expenseAccountId,
      expenseAccountLabel: accounts.name,
      amount: reimbursementClaims.amount,
      taxRate: reimbursementClaims.taxRate,
      approvedAmount: reimbursementClaims.approvedAmount,
      description: reimbursementClaims.description,
      attachmentName: reimbursementClaims.attachmentName,
      status: reimbursementClaims.status,
      decidedBy: reimbursementClaims.decidedBy,
      decisionNote: reimbursementClaims.decisionNote,
      paidDate: reimbursementClaims.paidDate,
      journalId: reimbursementClaims.journalId,
      createdBy: reimbursementClaims.createdBy,
      createdAt: reimbursementClaims.createdAt,
    })
    .from(reimbursementClaims)
    .innerJoin(employees, eq(reimbursementClaims.employeeId, employees.id))
    .innerJoin(accounts, eq(reimbursementClaims.expenseAccountId, accounts.id))
    .where(eq(reimbursementClaims.companyId, companyId))
    .orderBy(desc(reimbursementClaims.date), desc(reimbursementClaims.createdAt));
}
