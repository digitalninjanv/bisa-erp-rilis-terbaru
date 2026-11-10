// Uang muka / DP pembelian: dokumen pembayaran ke pemasok SEBELUM
// barang diterima. Posting membuat aset Uang Muka Pembelian; saat
// penerimaan barang, saldo dipotong FIFO dan sisanya menjadi utang.

import { and, asc, count, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  purchaseAdvances,
  purchaseAdvanceAllocations,
  supplierReturns,
  suppliers,
  user,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type Decimal, type MoneyInput } from "@/lib/money";
import {
  assertPeriodOpen,
  getAccountId,
  postJournal,
  reverseSourceJournal,
} from "@/server/accounting";
import { assertCashLikeAccount } from "@/server/employee-advances";
import { claimIdempotencyKey } from "@/server/idempotency";
import { nextDocumentNumber } from "@/server/sequences";
import { writeAudit } from "@/server/audit";
import { listLinkedJournalsBySourceIds } from "@/server/catalog";

export type PurchaseAdvanceStatus = "open" | "partial" | "used" | "void";

export type PurchaseAdvanceAllocationPlan = {
  advanceId: string;
  amount: Decimal;
};

/**
 * Buat dokumen uang muka pembelian + jurnal Dr Uang Muka Pembelian /
 * Cr Kas-Bank. `taxInvoiceNumber` hanya referensi faktur uang muka
 * pemasok; nilai PPN mengikuti kebijakan pajak masing-masing dokumen
 * penerimaan.
 */
export async function createPurchaseAdvance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    supplierId: string;
    date: string;
    amount: MoneyInput;
    paymentAccountId: string;
    taxInvoiceNumber?: string | null;
    notes?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<{ id: string; number: string; journalId: string }> {
  const idemKey = input.idempotencyKey?.trim() || null;
  if (idemKey) {
    const [existing] = await tx
      .select({ id: purchaseAdvances.id, number: purchaseAdvances.number })
      .from(purchaseAdvances)
      .where(
        and(
          eq(purchaseAdvances.companyId, input.companyId),
          eq(purchaseAdvances.idempotencyKey, idemKey),
        ),
      )
      .limit(1);
    if (existing) {
      return { ...existing, journalId: await journalIdOf(tx, input.companyId, existing.id) };
    }
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: idemKey,
      scope: "purchase.advance",
    });
    if (!claimed) {
      throw new AppError(
        "CONFLICT",
        "Uang muka dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }

  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nominal uang muka harus lebih dari nol.");
  }
  await assertPeriodOpen(tx, input.companyId, input.date);

  const [supplier] = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.companyId, input.companyId),
        eq(suppliers.id, input.supplierId),
      ),
    )
    .limit(1);
  if (!supplier) {
    throw new AppError("VALIDATION", "Pemasok tidak ditemukan di perusahaan ini.");
  }
  await assertCashLikeAccount(tx, input.companyId, input.paymentAccountId);

  const advanceAccountId = await getAccountId(tx, input.companyId, "purchase_advance");
  const number = await nextDocumentNumber(
    tx,
    input.companyId,
    "PURCHASE_ADVANCE",
    input.date,
  );
  const [created] = await tx
    .insert(purchaseAdvances)
    .values({
      companyId: input.companyId,
      supplierId: input.supplierId,
      number,
      date: input.date,
      amount: toDb(amount),
      remainingAmount: toDb(amount),
      paymentAccountId: input.paymentAccountId,
      originType: "manual",
      taxInvoiceNumber: input.taxInvoiceNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "open",
      idempotencyKey: idemKey,
      createdBy: input.userId,
      postedAt: new Date(),
    })
    .returning({ id: purchaseAdvances.id, number: purchaseAdvances.number });

  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Uang muka pembelian ${created.number} — ${supplier.name}`,
    sourceType: "purchase_advance",
    sourceId: created.id,
    createdBy: input.userId,
    lines: [
      {
        accountId: advanceAccountId,
        debit: amount,
        description: "Uang muka pembelian",
        partyType: "supplier",
        partyId: input.supplierId,
      },
      {
        accountId: input.paymentAccountId,
        credit: amount,
        description: "Dibayar dari kas/bank",
      },
    ],
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase.advance.create",
    entityType: "purchase_advance",
    entityId: created.id,
    after: {
      number: created.number,
      supplier: supplier.name,
      amount: toDb(amount),
      taxInvoiceNumber: input.taxInvoiceNumber ?? null,
    },
  });

  return { id: created.id, number: created.number, journalId: journal.id };
}

async function journalIdOf(tx: Tx, companyId: string, advanceId: string) {
  const journals = await listLinkedJournalsBySourceIds(tx, companyId, [advanceId]);
  return (
    journals
      .get(advanceId)
      ?.find((row) => row.sourceType === "purchase_advance")?.id ?? ""
  );
}

/**
 * Uang muka yang lahir dari kredit retur pembelian. Tidak ada kas keluar;
 * jurnalnya mereklasifikasi klaim Kredit Pemasok menjadi aset Uang Muka
 * Pembelian, lalu saldo dipotong FIFO saat penerimaan pembelian berikutnya.
 */
export async function createPurchaseAdvanceFromReturn(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    supplierId: string;
    returnId: string;
    returnNumber: string;
    date: string;
    amount: MoneyInput;
    notes?: string | null;
  },
): Promise<{ id: string; number: string; journalId: string }> {
  const [existing] = await tx
    .select({ id: purchaseAdvances.id, number: purchaseAdvances.number })
    .from(purchaseAdvances)
    .where(
      and(
        eq(purchaseAdvances.companyId, input.companyId),
        eq(purchaseAdvances.originReturnId, input.returnId),
      ),
    )
    .limit(1);
  if (existing) {
    return { ...existing, journalId: await journalIdOf(tx, input.companyId, existing.id) };
  }

  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nilai kredit retur untuk uang muka harus lebih dari nol.");
  }
  await assertPeriodOpen(tx, input.companyId, input.date);

  const number = await nextDocumentNumber(
    tx,
    input.companyId,
    "PURCHASE_ADVANCE",
    input.date,
  );
  const [created] = await tx
    .insert(purchaseAdvances)
    .values({
      companyId: input.companyId,
      supplierId: input.supplierId,
      number,
      date: input.date,
      amount: toDb(amount),
      remainingAmount: toDb(amount),
      paymentAccountId: null,
      originType: "return",
      originReturnId: input.returnId,
      notes: input.notes?.trim() || `Kredit retur pembelian ${input.returnNumber}`,
      status: "open",
      createdBy: input.userId,
      postedAt: new Date(),
    })
    .returning({ id: purchaseAdvances.id, number: purchaseAdvances.number });

  const advanceAccountId = await getAccountId(tx, input.companyId, "purchase_advance");
  const creditAccountId = await getAccountId(tx, input.companyId, "supplier_credit");
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Uang muka dari retur ${input.returnNumber} — ${created.number}`,
    sourceType: "purchase_advance",
    sourceId: created.id,
    createdBy: input.userId,
    idempotencyKey: `purchase-advance-return:${input.returnId}`,
    lines: [
      {
        accountId: advanceAccountId,
        debit: amount,
        description: "Uang muka pembelian dari kredit retur",
        partyType: "supplier",
        partyId: input.supplierId,
      },
      {
        accountId: creditAccountId,
        credit: amount,
        description: "Klaim kredit retur dipindah ke uang muka",
        partyType: "supplier",
        partyId: input.supplierId,
      },
    ],
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase.advance.from_return",
    entityType: "purchase_advance",
    entityId: created.id,
    after: {
      number: created.number,
      returnNumber: input.returnNumber,
      amount: toDb(amount),
    },
  });

  return { id: created.id, number: created.number, journalId: journal.id };
}

/** Uang muka yang masih bisa dipakai (open/partial, sisa > 0). */
export async function listOpenPurchaseAdvancesForSupplier(
  tx: Tx,
  companyId: string,
  supplierId: string,
) {
  const rows = await tx
    .select({
      id: purchaseAdvances.id,
      number: purchaseAdvances.number,
      date: purchaseAdvances.date,
      amount: purchaseAdvances.amount,
      remainingAmount: purchaseAdvances.remainingAmount,
      status: purchaseAdvances.status,
      originType: purchaseAdvances.originType,
    })
    .from(purchaseAdvances)
    .where(
      and(
        eq(purchaseAdvances.companyId, companyId),
        eq(purchaseAdvances.supplierId, supplierId),
        inArray(purchaseAdvances.status, ["open", "partial"]),
        gt(purchaseAdvances.remainingAmount, "0"),
      ),
    )
    .orderBy(asc(purchaseAdvances.date), asc(purchaseAdvances.number));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    date: row.date,
    amount: toDb(row.amount),
    remainingAmount: toDb(row.remainingAmount),
    status: row.status,
  }));
}

/**
 * Potong uang muka FIFO (tanggal terlama dulu) untuk satu penerimaan.
 * Baris dikunci FOR UPDATE agar dua penerimaan bersamaan tidak memakai
 * saldo yang sama.
 */
export async function applyPurchaseAdvancesFIFO(
  tx: Tx,
  input: {
    companyId: string;
    supplierId: string;
    amount: MoneyInput;
  },
): Promise<{ applied: Decimal; allocations: PurchaseAdvanceAllocationPlan[] }> {
  const requested = d(input.amount);
  if (!requested.isFinite() || requested.lte(0)) {
    return { applied: d(0), allocations: [] };
  }
  const rows = await tx
    .select({
      id: purchaseAdvances.id,
      remainingAmount: purchaseAdvances.remainingAmount,
    })
    .from(purchaseAdvances)
    .where(
      and(
        eq(purchaseAdvances.companyId, input.companyId),
        eq(purchaseAdvances.supplierId, input.supplierId),
        inArray(purchaseAdvances.status, ["open", "partial"]),
        gt(purchaseAdvances.remainingAmount, "0"),
      ),
    )
    .orderBy(asc(purchaseAdvances.date), asc(purchaseAdvances.number))
    .for("update");

  const available = rows.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
  if (available.lt(requested)) {
    throw new AppError(
      "VALIDATION",
      `Uang muka pemasok hanya tersedia ${available.toFixed(2)}. Kurangi jumlah yang dipakai.`,
    );
  }

  let left = requested;
  const allocations: PurchaseAdvanceAllocationPlan[] = [];
  for (const row of rows) {
    if (left.lte(0)) break;
    const remaining = d(row.remainingAmount);
    const take = DecimalMin(remaining, left);
    if (take.lte(0)) continue;
    allocations.push({ advanceId: row.id, amount: take });
    const nextRemaining = remaining.minus(take);
    left = left.minus(take);
    await tx
      .update(purchaseAdvances)
      .set({
        remainingAmount: toDb(nextRemaining),
        status: nextRemaining.isZero() ? "used" : "partial",
      })
      .where(eq(purchaseAdvances.id, row.id));
  }

  return {
    applied: requested.minus(left),
    allocations,
  };
}

function DecimalMin(a: Decimal, b: Decimal) {
  return a.lt(b) ? a : b;
}

/** Catat pemotongan ke baris penghubung setelah dokumen penerimaan dibuat. */
export async function insertPurchaseAdvanceAllocations(
  tx: Tx,
  companyId: string,
  receiptId: string,
  allocations: PurchaseAdvanceAllocationPlan[],
) {
  if (allocations.length === 0) return;
  await tx.insert(purchaseAdvanceAllocations).values(
    allocations.map((row) => ({
      companyId,
      advanceId: row.advanceId,
      receiptId,
      amount: toDb(row.amount),
    })),
  );
}

/** Kembalikan saldo uang muka saat penerimaan di-void. */
export async function restorePurchaseAdvancesForReceipt(
  tx: Tx,
  companyId: string,
  receiptId: string,
) {
  const allocations = await tx
    .select({
      id: purchaseAdvanceAllocations.id,
      advanceId: purchaseAdvanceAllocations.advanceId,
      amount: purchaseAdvanceAllocations.amount,
    })
    .from(purchaseAdvanceAllocations)
    .where(
      and(
        eq(purchaseAdvanceAllocations.companyId, companyId),
        eq(purchaseAdvanceAllocations.receiptId, receiptId),
      ),
    )
    .orderBy(asc(purchaseAdvanceAllocations.advanceId))
    .for("update");
  for (const allocation of allocations) {
    const [advance] = await tx
      .select({
        amount: purchaseAdvances.amount,
        remainingAmount: purchaseAdvances.remainingAmount,
      })
      .from(purchaseAdvances)
      .where(
        and(
          eq(purchaseAdvances.companyId, companyId),
          eq(purchaseAdvances.id, allocation.advanceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!advance) continue;
    const restored = d(advance.remainingAmount).plus(d(allocation.amount));
    await tx
      .update(purchaseAdvances)
      .set({
        remainingAmount: toDb(restored),
        status: restored.gte(d(advance.amount)) ? "open" : "partial",
      })
      .where(eq(purchaseAdvances.id, allocation.advanceId));
    await tx
      .delete(purchaseAdvanceAllocations)
      .where(eq(purchaseAdvanceAllocations.id, allocation.id));
  }
}

/** Total uang muka yang sudah dipotong pada satu penerimaan. */
export async function getReceiptAdvanceApplied(
  tx: Tx,
  companyId: string,
  receiptId: string,
): Promise<Decimal> {
  const [row] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${purchaseAdvanceAllocations.amount}), 0)`,
    })
    .from(purchaseAdvanceAllocations)
    .where(
      and(
        eq(purchaseAdvanceAllocations.companyId, companyId),
        eq(purchaseAdvanceAllocations.receiptId, receiptId),
      ),
    );
  return d(row?.amount ?? 0);
}

export async function listPurchaseAdvances(
  tx: Tx,
  companyId: string,
  opts: {
    from: string;
    to: string;
    supplierId?: string;
    status?: string;
    page: number;
    pageSize: number;
    offset: number;
  },
) {
  const conditions = [
    eq(purchaseAdvances.companyId, companyId),
    gte(purchaseAdvances.date, opts.from),
    lte(purchaseAdvances.date, opts.to),
  ];
  if (opts.supplierId) conditions.push(eq(purchaseAdvances.supplierId, opts.supplierId));
  if (opts.status) conditions.push(eq(purchaseAdvances.status, opts.status));
  const where = and(...conditions);
  const [totalRow] = await tx
    .select({ value: count() })
    .from(purchaseAdvances)
    .where(where);
  const rows = await tx
    .select({
      id: purchaseAdvances.id,
      number: purchaseAdvances.number,
      date: purchaseAdvances.date,
      amount: purchaseAdvances.amount,
      remainingAmount: purchaseAdvances.remainingAmount,
      taxInvoiceNumber: purchaseAdvances.taxInvoiceNumber,
      notes: purchaseAdvances.notes,
      status: purchaseAdvances.status,
      supplierId: purchaseAdvances.supplierId,
      supplierName: suppliers.name,
      originType: purchaseAdvances.originType,
      originReturnId: purchaseAdvances.originReturnId,
      originReturnNumber: supplierReturns.number,
    })
    .from(purchaseAdvances)
    .innerJoin(suppliers, eq(purchaseAdvances.supplierId, suppliers.id))
    .leftJoin(supplierReturns, eq(purchaseAdvances.originReturnId, supplierReturns.id))
    .where(where)
    .orderBy(desc(purchaseAdvances.date), desc(purchaseAdvances.number))
    .limit(opts.pageSize)
    .offset(opts.offset);
  const journals = await listLinkedJournalsBySourceIds(
    tx,
    companyId,
    rows.map((row) => row.id),
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      journalId:
        journals.get(row.id)?.find((journal) => journal.sourceType === "purchase_advance")?.id ??
        null,
      journalNumber:
        journals.get(row.id)?.find((journal) => journal.sourceType === "purchase_advance")
          ?.number ?? null,
    })),
    total: totalRow?.value ?? 0,
  };
}

/** Void hanya bila belum dipakai sama sekali; jurnal asli direversal. */
export async function voidPurchaseAdvance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    advanceId: string;
    date: string;
    reason: string;
  },
) {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new AppError("VALIDATION", "Alasan pembatalan wajib diisi (minimal 3 karakter).");
  }
  const [advance] = await tx
    .select({
      id: purchaseAdvances.id,
      number: purchaseAdvances.number,
      amount: purchaseAdvances.amount,
      remainingAmount: purchaseAdvances.remainingAmount,
      status: purchaseAdvances.status,
      originType: purchaseAdvances.originType,
    })
    .from(purchaseAdvances)
    .where(
      and(
        eq(purchaseAdvances.companyId, input.companyId),
        eq(purchaseAdvances.id, input.advanceId),
      ),
    )
    .limit(1)
    .for("update");
  if (!advance) {
    throw new AppError("VALIDATION", "Uang muka tidak ditemukan.");
  }
  if (advance.status === "void") {
    throw new AppError("INVALID_STATE", `Uang muka ${advance.number} sudah dibatalkan.`);
  }
  if (advance.originType === "return") {
    throw new AppError(
      "INVALID_STATE",
      `Uang muka ${advance.number} berasal dari retur pembelian. Batalkan lewat dokumen retur asal setelah seluruh penyelesaiannya dikoreksi.`,
    );
  }
  if (d(advance.remainingAmount).lt(d(advance.amount))) {
    throw new AppError(
      "INVALID_STATE",
      `Uang muka ${advance.number} sudah dipakai pada penerimaan dan tidak dapat dibatalkan.`,
    );
  }
  await assertPeriodOpen(tx, input.companyId, input.date);
  await reverseSourceJournal(tx, {
    companyId: input.companyId,
    sourceType: "purchase_advance",
    sourceId: advance.id,
    date: input.date,
    description: `Pembatalan uang muka ${advance.number} — ${reason}`,
    createdBy: input.userId,
  });
  await tx
    .update(purchaseAdvances)
    .set({ status: "void", remainingAmount: "0" })
    .where(eq(purchaseAdvances.id, advance.id));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase.advance.void",
    entityType: "purchase_advance",
    entityId: advance.id,
    after: { number: advance.number, reason },
  });
}

export async function listPurchaseAdvanceActors(tx: Tx, companyId: string) {
  const rows = await tx
    .selectDistinct({ id: purchaseAdvances.createdBy, name: user.name })
    .from(purchaseAdvances)
    .innerJoin(user, eq(user.id, purchaseAdvances.createdBy))
    .where(eq(purchaseAdvances.companyId, companyId))
    .orderBy(asc(user.name));
  return rows.filter((row): row is { id: string; name: string } => Boolean(row.id));
}
