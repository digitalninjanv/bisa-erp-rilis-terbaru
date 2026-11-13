import { and, count, desc, eq, gte, lte, or } from "drizzle-orm";
import type { Tx } from "@/db";
import { bankTransfers, user } from "@/db/schema";
import { listLinkedJournalsBySourceIds } from "@/server/catalog";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { d, toDb, type MoneyInput } from "@/lib/money";
import { getAccountMap, postJournal, reverseSourceJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { assertCashLikeAccount } from "@/server/employee-advances";
import { claimIdempotencyKey } from "@/server/idempotency";
import { nextDocumentNumber } from "@/server/sequences";

/**
 * Domain transfer antar rekening kas/bank (diekstrak dari
 * createBankTransferAction agar modal Catat Transaksi A-12 memakai
 * jalur yang persis sama, dalam transaksi pemanggil): satu dokumen
 * transfer + jurnal Dr rekening tujuan (+ Dr biaya admin bila ada) /
 * Cr rekening asal sebesar nominal + biaya.
 */
export async function createBankTransfer(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    date: string;
    fromAccountId: string;
    toAccountId: string;
    amount: MoneyInput;
    fee?: MoneyInput;
    reference?: string;
    description?: string;
    /** Kunci idempotensi klien (R3-04, pola AK-P3-02). */
    idempotencyKey?: string | null;
  },
) {
  // A-21 (R3-04): replay idempotensi — submit ulang berkunci sama
  // mengembalikan transfer pertama, bukan membuat dokumen kedua.
  // Pola GDG3-06 yang sama dengan form gudang.
  const idemKey = input.idempotencyKey?.trim() || null;
  const findTransferByKey = async () => {
    if (!idemKey) return undefined;
    const [row] = await tx
      .select({ id: bankTransfers.id, number: bankTransfers.number })
      .from(bankTransfers)
      .where(
        and(eq(bankTransfers.companyId, input.companyId), eq(bankTransfers.idempotencyKey, idemKey)),
      )
      .limit(1);
    return row;
  };
  if (idemKey) {
    const existing = await findTransferByKey();
    if (existing) return { ...existing, warnings: [] as string[] };
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: idemKey,
      scope: "accounting.bank_transfer",
    });
    if (!claimed) {
      const winner = await findTransferByKey();
      if (winner) return { ...winner, warnings: [] as string[] };
      throw new AppError(
        "CONFLICT",
        "Transfer dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }

  if (input.fromAccountId === input.toAccountId) {
    throw new AppError("VALIDATION", "Rekening asal dan tujuan harus berbeda.");
  }
  const amount = d(input.amount);
  const fee = d(input.fee ?? 0);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nominal transfer harus lebih dari nol.");
  }
  if (!fee.isFinite() || fee.lt(0)) {
    throw new AppError("VALIDATION", "Biaya transfer tidak boleh negatif.");
  }

  // A-21 (R3-03): kedua rekening harus akun kas/bank/QRIS terpetakan —
  // penjaga domain yang sama seperti jalur kasbon/pinjaman/klaim;
  // tanpa ini "transfer" dapat menjurnal pasangan akun postable apa pun.
  await assertCashLikeAccount(tx, input.companyId, input.fromAccountId);
  await assertCashLikeAccount(tx, input.companyId, input.toAccountId);

  const number = await nextDocumentNumber(tx, input.companyId, "BANK_TRANSFER", input.date);
  const [transfer] = await tx
    .insert(bankTransfers)
    .values({
      companyId: input.companyId,
      number,
      date: input.date,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      idempotencyKey: idemKey,
      amount: toDb(amount),
      fee: toDb(fee),
      netAmount: toDb(amount),
      reference: input.reference,
      description: input.description,
      createdBy: input.userId,
    })
    .returning({ id: bankTransfers.id, number: bankTransfers.number });

  const map = await getAccountMap(tx, input.companyId);
  if (fee.gt(0) && !map.bank_fee) {
    throw new AppError(
      "VALIDATION",
      'Akun untuk "bank_fee" belum dipetakan di Pengaturan, jadi biaya transfer tidak dapat dijurnal.',
    );
  }
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Transfer bank ${number}${input.reference ? ` · ${input.reference}` : ""}`,
    sourceType: "bank_transfer",
    sourceId: transfer.id,
    createdBy: input.userId,
    idempotencyKey: `bank_transfer:${transfer.id}`,
    lines: [
      { accountId: input.toAccountId, debit: amount, description: "Dana diterima" },
      ...(fee.gt(0)
        ? [{ accountId: map.bank_fee, debit: fee, description: "Biaya administrasi bank" }]
        : []),
      { accountId: input.fromAccountId, credit: amount.plus(fee), description: "Dana keluar" },
    ],
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "bank.transfer",
    entityType: "bank_transfer",
    entityId: transfer.id,
    after: { number, amount: toDb(amount), fee: toDb(fee) },
  });
  // FIX-R2 Tahap 3 (RV2-01): peringatan penjaga saldo kas/bank (mode warn).
  return { ...transfer, warnings: journal.warnings };
}

/**
 * Daftar transfer untuk halaman Kas & bank (A-24 T4: dipindah dari
 * kueri inline halaman menjadi fungsi baca bernama agar tiap baris
 * membawa jurnal pembentuknya — pola "Rincian Jurnal" Accurate;
 * saringan, urutan, dan batas sama persis dengan kueri lama).
 */
type BankTransferListOptions = {
  /** Kosong = tanpa batas tanggal (semua waktu). */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  /** Rekening asal ATAU tujuan — filter "rekening" pada histori. */
  accountId?: string;
  /** posted | void */
  status?: string;
  createdBy?: string;
};

function bankTransferConditions(companyId: string, opts: BankTransferListOptions) {
  const conditions = [eq(bankTransfers.companyId, companyId)];
  if (opts.from) conditions.push(gte(bankTransfers.date, opts.from));
  if (opts.to) conditions.push(lte(bankTransfers.date, opts.to));
  if (opts.accountId) {
    conditions.push(
      or(
        eq(bankTransfers.fromAccountId, opts.accountId),
        eq(bankTransfers.toAccountId, opts.accountId),
      )!,
    );
  }
  if (opts.status) conditions.push(eq(bankTransfers.status, opts.status));
  if (opts.createdBy) conditions.push(eq(bankTransfers.createdBy, opts.createdBy));
  return and(...conditions);
}

export async function listBankTransfers(
  tx: Tx,
  companyId: string,
  opts: BankTransferListOptions,
) {
  const rows = await tx
    .select()
    .from(bankTransfers)
    .where(bankTransferConditions(companyId, opts))
    .orderBy(desc(bankTransfers.date), desc(bankTransfers.createdAt))
    .limit(opts.limit ?? 60)
    .offset(opts.offset ?? 0);
  const journalsByTransfer = await listLinkedJournalsBySourceIds(
    tx,
    companyId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const journals = journalsByTransfer.get(row.id) ?? [];
    const primary = journals.find(
      (journal) => journal.sourceType === "bank_transfer" && !journal.reversalOfId,
    );
    // postJournal memberi sourceType `${asal}_reversal` pada jurnal
    // pembalik, jadi jangan menyaring dengan "bank_transfer" lagi:
    // cukup reversalOfId yang menandai jurnal pembalik dokumen ini.
    const reversal = journals.find((journal) => Boolean(journal.reversalOfId));
    return {
      ...row,
      journalId: primary?.id ?? null,
      journalNumber: primary?.number ?? null,
      reversalJournalId: reversal?.id ?? null,
      reversalJournalNumber: reversal?.number ?? null,
    };
  });
}

/** Total dokumen untuk paginasi halaman riwayat transfer. */
export async function countBankTransfers(
  tx: Tx,
  companyId: string,
  opts: BankTransferListOptions,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(bankTransfers)
    .where(bankTransferConditions(companyId, opts));
  return row?.value ?? 0;
}

/** Pembuat transfer yang punya jejak — opsi filter "User" histori bank. */
export async function listBankTransferActors(
  tx: Tx,
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await tx
    .selectDistinct({ id: bankTransfers.createdBy, name: user.name })
    .from(bankTransfers)
    .innerJoin(user, eq(user.id, bankTransfers.createdBy))
    .where(eq(bankTransfers.companyId, companyId))
    .orderBy(user.name);
  return rows.filter((row): row is { id: string; name: string } => Boolean(row.id));
}

/**
 * A-26 Q4 (K-03): pembatalan transfer bank — dipindah utuh dari
 * voidBankTransferAction; lapisan aksi kini hanya auth, parsing, dan
 * revalidasi. Perilaku & pesan identik dengan blok transaksi lama.
 */
export async function voidBankTransfer(
  tx: Tx,
  input: { companyId: string; userId: string; transferId: string; reason: string },
) {
  const [transfer] = await tx
    .select()
    .from(bankTransfers)
    .where(and(eq(bankTransfers.companyId, input.companyId), eq(bankTransfers.id, input.transferId)))
    .limit(1);
  if (!transfer) throw new AppError("NOT_FOUND", "Transfer bank tidak ditemukan.");
  if (transfer.status === "void") throw new AppError("INVALID_STATE", "Transfer sudah dibatalkan.");
  if (transfer.status !== "posted") {
    throw new AppError("INVALID_STATE", "Hanya transfer berstatus posted yang bisa dibatalkan.");
  }

  // Pola AK-P2-05: jurnal transfer adalah satu jurnal utuh (nominal +
  // biaya admin), jadi pembalikannya lewat reverseSourceJournal; hasil
  // null tidak boleh ditelan — tanpa pembalik, dokumen void akan membuat
  // riwayat transfer dan buku besar berbeda diam-diam.
  const reversal = await reverseSourceJournal(tx, {
    companyId: input.companyId,
    sourceType: "bank_transfer",
    sourceId: transfer.id,
    date: todayISO(),
    description: `Pembatalan transfer bank ${transfer.number} — ${input.reason}`,
    createdBy: input.userId,
  });
  if (!reversal) {
    throw new AppError(
      "VALIDATION",
      `Jurnal asal transfer ${transfer.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan transfer dibatalkan agar riwayat transfer dan buku besar tetap selaras; periksa jurnal transfer ini terlebih dahulu.`,
    );
  }
  await tx
    .update(bankTransfers)
    .set({ status: "void" })
    .where(and(eq(bankTransfers.companyId, input.companyId), eq(bankTransfers.id, transfer.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "bank.transfer.void",
    entityType: "bank_transfer",
    entityId: transfer.id,
    after: { number: transfer.number, amount: transfer.amount, fee: transfer.fee, reason: input.reason, reversalNumber: reversal.number },
  });
}
