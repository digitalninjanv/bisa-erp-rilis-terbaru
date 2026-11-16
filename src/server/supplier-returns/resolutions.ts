// A-24 Tahap T4B: bagian dari pemecahan src/server/supplier-returns.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/supplier-returns.ts.

import {
  and,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  products,
  supplierReturnLines,
  supplierReturnResolutions,
  supplierReturns,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  d,
  toDb,
  type Decimal,
  type MoneyInput,
} from "@/lib/money";
import {
  assertPeriodOpen,
  getAccountId,
  getAccountMap,
  postJournal,
} from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { applyStockMovement } from "@/server/inventory";
import { addToBatch } from "@/server/batches";
import {
  normalizeSerialNumbers,
  registerSerialsIn,
} from "@/server/serials";
import { allocateReturnToPayables, getSupplierOpenPayable } from "./payables";
import { createPurchaseAdvanceFromReturn } from "@/server/purchase-advances";
import { syncPartyCreditFromReturnResolution } from "@/server/party-credits";
import { lockSupplierReturn } from "./returns";
import type { SupplierReturnRow } from "./shared";

function claimRemaining(header: SupplierReturnRow): Decimal {
  return d(header.creditAmount).minus(d(header.resolvedAmount));
}

function assertResolvable(header: SupplierReturnRow): Decimal {
  if (header.status !== "posted" && header.status !== "partially_resolved") {
    throw new AppError(
      "INVALID_STATE",
      `Retur ${header.number} berstatus ${header.status} dan klaimnya tidak dapat diselesaikan.`,
    );
  }
  const remaining = claimRemaining(header);
  if (remaining.lte(0)) {
    throw new AppError("INVALID_STATE", `Klaim retur ${header.number} sudah habis diselesaikan.`);
  }
  return remaining;
}

async function recordResolution(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    header: SupplierReturnRow;
    kind: string;
    date: string;
    amount: Decimal;
    accountId?: string | null;
    returnLineId?: string | null;
    qty?: Decimal | null;
    note?: string | null;
  },
): Promise<string> {
  const [row] = await tx
    .insert(supplierReturnResolutions)
    .values({
      companyId: input.companyId,
      returnId: input.header.id,
      kind: input.kind,
      date: input.date,
      amount: toDb(input.amount),
      accountId: input.accountId ?? null,
      returnLineId: input.returnLineId ?? null,
      qty: input.qty != null ? toDb(input.qty) : null,
      note: input.note ?? null,
      createdBy: input.userId,
    })
    .returning({ id: supplierReturnResolutions.id });
  return row.id;
}

/**
 * Book one consumed slice of the claim: link the resolution to its
 * journal, grow the header's resolvedAmount from `resolvedBefore`, and
 * derive the header status. Returns the claim remaining afterwards.
 * Callers that settle several slices in one call (replacements) pass
 * their running totals so the header is written once per slice with
 * correct intermediate values.
 */
async function settleResolution(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    header: SupplierReturnRow;
    resolvedBefore: Decimal;
    resolutionId: string;
    journalId: string | null;
    consumed: Decimal;
    action: string;
  },
): Promise<Decimal> {
  await tx
    .update(supplierReturnResolutions)
    .set({ journalId: input.journalId })
    .where(
      and(
        eq(supplierReturnResolutions.companyId, input.companyId),
        eq(supplierReturnResolutions.id, input.resolutionId),
      ),
    );
  const resolved = input.resolvedBefore.plus(input.consumed);
  const remaining = d(input.header.creditAmount).minus(resolved);
  await tx
    .update(supplierReturns)
    .set({
      resolvedAmount: toDb(resolved),
      status: remaining.lte(0) ? "resolved" : "partially_resolved",
    })
    .where(
      and(eq(supplierReturns.companyId, input.companyId), eq(supplierReturns.id, input.header.id)),
    );
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: input.action,
    entityType: "supplier_return",
    entityId: input.header.id,
    after: {
      number: input.header.number,
      amount: toDb(input.consumed),
      remainingClaim: toDb(remaining),
    },
  });
  return remaining;
}

function assertResolutionAmount(header: SupplierReturnRow, amount: Decimal, remaining: Decimal) {
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nominal penyelesaian harus lebih dari nol.");
  }
  if (amount.gt(remaining)) {
    throw new AppError(
      "VALIDATION",
      `Nominal melebihi sisa klaim retur ${header.number} (${remaining.toFixed(0)}).`,
    );
  }
}

async function syncPartyCreditResolution(
  tx: Tx,
  companyId: string,
  supplierId: string,
  returnNumber: string,
  amount: Decimal,
  mode: "consume" | "settle_all",
) {
  await syncPartyCreditFromReturnResolution(tx, { companyId, supplierId, returnNumber, amount, mode });
}

/**
 * Apply part of the claim against the supplier's open payable — the
 * "potong pembelian berikutnya" settlement. One explicit target document
 * may be given; otherwise the oldest open payable absorbs it first.
 */
export async function applySupplierCredit(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    returnId: string;
    amount: MoneyInput;
    date: string;
    targetReceiptId?: string | null;
    targetOpeningId?: string | null;
  },
) {
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  const remaining = assertResolvable(header);
  const amount = d(input.amount);
  assertResolutionAmount(header, amount, remaining);
  await assertPeriodOpen(tx, input.companyId, input.date);

  const openPayable = await getSupplierOpenPayable(tx, input.companyId, header.supplierId);
  if (amount.gt(openPayable)) {
    throw new AppError(
      "VALIDATION",
      `Nominal melebihi total utang terbuka pemasok saat ini (${openPayable.toFixed(0)}).`,
    );
  }

  const map = await getAccountMap(tx, input.companyId);
  const creditAccountId = await getAccountId(tx, input.companyId, "supplier_credit");
  const supplierParty = { partyType: "supplier", partyId: header.supplierId };
  const resolutionId = await recordResolution(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    kind: "apply_credit",
    date: input.date,
    amount,
  });
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Kredit retur ${header.number} diterapkan ke utang pemasok`,
    sourceType: "supplier_return_credit_apply",
    sourceId: header.id,
    createdBy: input.userId,
    idempotencyKey: `supplier-return-apply:${resolutionId}`,
    lines: [
      {
        accountId: map.payable,
        debit: amount,
        description: "Utang pemasok berkurang oleh kredit retur",
        ...supplierParty,
      },
      {
        accountId: creditAccountId,
        credit: amount,
        description: "Klaim kredit pemasok terpakai",
        ...supplierParty,
      },
    ],
  });
  await allocateReturnToPayables(tx, {
    companyId: input.companyId,
    returnId: header.id,
    supplierId: header.supplierId,
    amount,
    targetReceiptId: input.targetReceiptId ?? undefined,
    targetOpeningId: input.targetOpeningId ?? undefined,
  });
  const remainingClaim = await settleResolution(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    resolvedBefore: d(header.resolvedAmount),
    resolutionId,
    journalId: journal.id,
    consumed: amount,
    action: "supplier_return.apply_credit",
  });
  await syncPartyCreditResolution(tx, input.companyId, header.supplierId, header.number, amount, "consume");
  return { resolutionId, remainingClaim: toDb(remainingClaim) };
}

/**
 * Ubah sisa klaim retur menjadi uang muka pembelian (DP) untuk pemasok
 * yang sama. Jurnal: Dr Uang Muka Pembelian / Cr Kredit Pemasok —
 * tanpa kas keluar. Saldo DP dipotong FIFO pada penerimaan berikutnya.
 */
export async function convertSupplierCreditToAdvance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    returnId: string;
    date: string;
    notes?: string | null;
  },
) {
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  const amount = assertResolvable(header);
  await assertPeriodOpen(tx, input.companyId, input.date);

  const advance = await createPurchaseAdvanceFromReturn(tx, {
    companyId: input.companyId,
    userId: input.userId,
    supplierId: header.supplierId,
    returnId: header.id,
    returnNumber: header.number,
    date: input.date,
    amount,
    notes: input.notes,
  });
  const resolutionId = await recordResolution(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    kind: "purchase_advance",
    date: input.date,
    amount,
    note: input.notes ?? `Menjadi uang muka ${advance.number}`,
  });
  const remainingClaim = await settleResolution(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    resolvedBefore: d(header.resolvedAmount),
    resolutionId,
    journalId: advance.journalId,
    consumed: amount,
    action: "supplier_return.to_advance",
  });
  await syncPartyCreditResolution(tx, input.companyId, header.supplierId, header.number, amount, "settle_all");
  return {
    advanceId: advance.id,
    advanceNumber: advance.number,
    journalId: advance.journalId,
    remainingClaim: toDb(remainingClaim),
  };
}

/** The supplier pays the claim back in cash/bank money. */
export async function refundSupplierReturn(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    returnId: string;
    accountId: string;
    amount: MoneyInput;
    date: string;
  },
) {
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  const remaining = assertResolvable(header);
  const amount = d(input.amount);
  assertResolutionAmount(header, amount, remaining);
  await assertPeriodOpen(tx, input.companyId, input.date);

  const [account] = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, input.accountId)))
    .limit(1);
  if (!account) throw new AppError("VALIDATION", "Akun kas/bank tujuan refund tidak ditemukan.");

  const creditAccountId = await getAccountId(tx, input.companyId, "supplier_credit");
  const resolutionId = await recordResolution(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    kind: "refund",
    date: input.date,
    amount,
    accountId: input.accountId,
  });
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Refund retur ${header.number} dari pemasok`,
    sourceType: "supplier_return_refund",
    sourceId: header.id,
    createdBy: input.userId,
    idempotencyKey: `supplier-return-refund:${resolutionId}`,
    lines: [
      { accountId: input.accountId, debit: amount, description: "Kas/bank diterima dari pemasok" },
      {
        accountId: creditAccountId,
        credit: amount,
        description: "Klaim kredit pemasok terpakai",
        partyType: "supplier",
        partyId: header.supplierId,
      },
    ],
  });
  const remainingClaim = await settleResolution(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    resolvedBefore: d(header.resolvedAmount),
    resolutionId,
    journalId: journal.id,
    consumed: amount,
    action: "supplier_return.refund",
  });
  await syncPartyCreditResolution(tx, input.companyId, header.supplierId, header.number, amount, "consume");
  return { resolutionId, remainingClaim: toDb(remainingClaim) };
}

/**
 * Replacement goods arrive against the claim. Stock comes back in at
 * the original line's frozen claim value (the AVCO of the posting day),
 * so the claim is consumed exactly by qty × that unit value; receipts
 * may be partial and repeated. Movements use type "purchase" so the
 * moving average blends the replacement in at its claim cost, exactly
 * like a receipt — the reference type keeps them traceable to the RTB.
 */
export async function receiveReplacement(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    returnId: string;
    date: string;
    lines: {
      returnLineId: string;
      qty: MoneyInput;
      batchNumber?: string | null;
      expiryDate?: string | null;
      // FIX-GDG Tahap 2 (GDG1-04): daftar nomor seri per unit untuk
      // produk track_serial — wajib, jumlahnya persis qty baris.
      serialNumbers?: string[];
    }[];
  },
) {
  if (input.lines.length === 0) {
    throw new AppError("VALIDATION", "Tambahkan minimal satu baris penggantian.");
  }
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  const remaining = assertResolvable(header);
  await assertPeriodOpen(tx, input.companyId, input.date);

  const returnLines = await tx
    .select()
    .from(supplierReturnLines)
    .where(
      and(
        eq(supplierReturnLines.companyId, input.companyId),
        eq(supplierReturnLines.returnId, header.id),
      ),
    );
  const lineById = new Map(returnLines.map((line) => [line.id, line]));
  const productIds = [...new Set(returnLines.map((line) => line.productId))];
  const productRows = await tx
    .select({
      id: products.id,
      name: products.name,
      trackBatch: products.trackBatch,
      trackSerial: products.trackSerial,
    })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
  const productById = new Map(productRows.map((row) => [row.id, row]));

  // FIX-GDG Tahap 2 (GDG1-05): agregasikan qty pengganti per
  // returnLineId SEBELUM plafon dinilai (pola agregasi POS1-01).
  // Penilaian per baris input terhadap snapshot replacedQty yang sama
  // membiarkan dua baris 5+5 lolos atas sisa 5 — dan penulisan balik
  // dari snapshot yang sama menutupi kelebihannya (replacedQty akhir
  // tertulis 5, bukan 10).
  const requestedByLine = new Map<string, Decimal>();
  for (const inputLine of input.lines) {
    const qty = d(inputLine.qty);
    requestedByLine.set(
      inputLine.returnLineId,
      (requestedByLine.get(inputLine.returnLineId) ?? d(0)).plus(qty),
    );
  }
  const validatedLines = new Set<string>();
  const serialsSeenByProduct = new Map<string, Set<string>>();

  let consumed = d(0);
  const prepared: {
    returnLine: (typeof returnLines)[number];
    product: (typeof productRows)[number];
    qty: Decimal;
    value: Decimal;
    batchNumber: string | null;
    expiryDate: string | null;
    serialNumbers: string[];
  }[] = [];
  for (const inputLine of input.lines) {
    const returnLine = lineById.get(inputLine.returnLineId);
    if (!returnLine) throw new AppError("VALIDATION", "Baris retur untuk penggantian tidak ditemukan.");
    const product = productById.get(returnLine.productId)!;
    const qty = d(inputLine.qty);
    if (!qty.isFinite() || !qty.gt(0)) {
      throw new AppError("VALIDATION", `Jumlah penggantian ${product.name} harus lebih dari 0.`);
    }
    if (!validatedLines.has(returnLine.id)) {
      validatedLines.add(returnLine.id);
      const replaceable = d(returnLine.qty).minus(d(returnLine.replacedQty));
      const requestedTotal = requestedByLine.get(returnLine.id) ?? d(0);
      if (requestedTotal.gt(replaceable)) {
        throw new AppError(
          "VALIDATION",
          `Penggantian ${product.name} melebihi sisa qty retur yang belum diganti (${replaceable.toFixed(2)}).`,
        );
      }
    }
    const batchNumber = inputLine.batchNumber?.trim() || null;
    if (product.trackBatch && !batchNumber) {
      throw new AppError(
        "VALIDATION",
        `Nomor batch wajib diisi untuk ${product.name} karena produk ini dilacak per batch.`,
      );
    }
    // FIX-GDG Tahap 2 (GDG1-04): produk serial hanya boleh menerima
    // barang pengganti dengan daftar nomor seri per unit — aturan yang
    // sama seperti penerimaan biasa (applyDocumentMovement menolak
    // stok masuk serial tanpa seri; jalur pengganti dulu melewatinya
    // diam-diam dan menciptakan stok hantu yang tidak bisa dijual).
    let serialNumbers: string[] = [];
    if (product.trackSerial) {
      serialNumbers = normalizeSerialNumbers(inputLine.serialNumbers ?? []);
      if (!qty.isInteger() || serialNumbers.length !== qty.toNumber()) {
        throw new AppError(
          "VALIDATION",
          `Nomor seri wajib diisi per unit untuk barang pengganti ${product.name}: dibutuhkan ${qty.toString()} nomor seri.`,
        );
      }
      const seen = serialsSeenByProduct.get(product.id) ?? new Set<string>();
      for (const serialNumber of serialNumbers) {
        if (seen.has(serialNumber)) {
          throw new AppError(
            "VALIDATION",
            `Nomor seri ${serialNumber} untuk ${product.name} muncul lebih dari sekali dalam penggantian ini.`,
          );
        }
        seen.add(serialNumber);
      }
      serialsSeenByProduct.set(product.id, seen);
    }
    const value = qty.mul(d(returnLine.unitCost));
    consumed = consumed.plus(value);
    prepared.push({
      returnLine,
      product,
      qty,
      value,
      batchNumber,
      expiryDate: inputLine.expiryDate || null,
      serialNumbers,
    });
  }
  if (consumed.gt(remaining)) {
    throw new AppError(
      "VALIDATION",
      `Nilai barang pengganti melebihi sisa klaim retur ${header.number} (${remaining.toFixed(0)}).`,
    );
  }

  const map = await getAccountMap(tx, input.companyId);
  const creditAccountId = await getAccountId(tx, input.companyId, "supplier_credit");

  const resolutionIds: string[] = [];
  // GDG1-05: replacedQty ditulis dari total BERJALAN per baris retur,
  // bukan dari snapshot awal — dua baris sah untuk baris retur yang
  // sama (pemisahan batch) harus menjumlah dengan benar.
  const runningReplaced = new Map<string, Decimal>();
  for (const item of prepared) {
    let batchId: string | null = null;
    if (item.product.trackBatch) {
      const batch = await addToBatch(tx, {
        companyId: input.companyId,
        productId: item.returnLine.productId,
        warehouseId: header.warehouseId,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        delta: item.qty,
      });
      batchId = batch.id;
    }
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: header.warehouseId,
      productId: item.returnLine.productId,
      delta: item.qty,
      unitCost: item.returnLine.unitCost,
      movementType: "purchase",
      referenceType: "supplier_return_replacement",
      referenceId: header.id,
      referenceNumber: header.number,
      reason: `Barang pengganti retur ${header.number}`,
      userId: input.userId,
      batchId,
      date: input.date,
    });
    if (item.serialNumbers.length > 0) {
      await registerSerialsIn(tx, {
        companyId: input.companyId,
        userId: input.userId,
        productId: item.returnLine.productId,
        productName: item.product.name,
        warehouseId: header.warehouseId,
        serialNumbers: item.serialNumbers,
        receiptId: header.id,
        receiptNumber: header.number,
        referenceType: "supplier_return_replacement",
      });
    }
    const nextReplaced = (runningReplaced.get(item.returnLine.id) ?? d(item.returnLine.replacedQty)).plus(item.qty);
    runningReplaced.set(item.returnLine.id, nextReplaced);
    await tx
      .update(supplierReturnLines)
      .set({ replacedQty: toDb(nextReplaced) })
      .where(
        and(
          eq(supplierReturnLines.companyId, input.companyId),
          eq(supplierReturnLines.id, item.returnLine.id),
        ),
      );
    resolutionIds.push(
      await recordResolution(tx, {
        companyId: input.companyId,
        userId: input.userId,
        header,
        kind: "replacement",
        date: input.date,
        amount: item.value,
        returnLineId: item.returnLine.id,
        qty: item.qty,
      }),
    );
  }

  let journalId: string | null = null;
  if (consumed.gt(0)) {
    const journal = await postJournal(tx, {
      companyId: input.companyId,
      date: input.date,
      description: `Barang pengganti retur ${header.number} diterima`,
      sourceType: "supplier_return_replacement",
      sourceId: header.id,
      createdBy: input.userId,
      idempotencyKey: `supplier-return-replacement:${resolutionIds[0]}`,
      lines: [
        { accountId: map.inventory, debit: consumed, description: "Persediaan bertambah (barang pengganti)" },
        {
          accountId: creditAccountId,
          credit: consumed,
          description: "Klaim kredit pemasok terpakai",
          partyType: "supplier",
          partyId: header.supplierId,
        },
      ],
    });
    journalId = journal.id;
  }
  // All per-line resolutions share the one journal of this receipt;
  // settle them in order with running totals.
  let resolvedBefore = d(header.resolvedAmount);
  let remainingClaim = claimRemaining(header);
  for (const [index, resolutionId] of resolutionIds.entries()) {
    remainingClaim = await settleResolution(tx, {
      companyId: input.companyId,
      userId: input.userId,
      header,
      resolvedBefore,
      resolutionId,
      journalId,
      consumed: prepared[index].value,
      action: "supplier_return.replacement",
    });
    resolvedBefore = resolvedBefore.plus(prepared[index].value);
  }
  await syncPartyCreditResolution(tx, input.companyId, header.supplierId, header.number, consumed, "consume");
  return { consumedAmount: toDb(consumed), remainingClaim: toDb(remainingClaim) };
}

/**
 * "Other" settlement: a free-text close. When claim remains, the user
 * must explicitly confirm the forced close — the remainder is NOT
 * journaled away here (D-20: the accountant clears it with a manual
 * journal); it stays visible via closedWithRemainder + closeNote.
 */
export async function resolveSupplierReturnOther(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    returnId: string;
    date: string;
    note: string;
    writeOffRemainder?: boolean;
  },
) {
  const note = input.note.trim();
  if (note.length < 3) {
    throw new AppError("VALIDATION", "Catatan penyelesaian wajib diisi (minimal 3 karakter).");
  }
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  if (header.status !== "posted" && header.status !== "partially_resolved") {
    throw new AppError(
      "INVALID_STATE",
      `Retur ${header.number} berstatus ${header.status} dan tidak dapat ditutup.`,
    );
  }
  const remaining = claimRemaining(header);
  if (remaining.gt(0) && !input.writeOffRemainder) {
    throw new AppError(
      "VALIDATION",
      `Retur ${header.number} masih memiliki sisa klaim ${remaining.toFixed(0)} di Kredit Pemasok. Selesaikan klaimnya terlebih dahulu, atau tegaskan penutupan dengan sisa klaim yang tetap tercatat di buku.`,
    );
  }
  await recordResolution(tx, {
    companyId: input.companyId,
    userId: input.userId,
    header,
    kind: "other",
    date: input.date,
    amount: d(0),
    note:
      remaining.gt(0)
        ? `${note} (ditutup dengan sisa klaim ${remaining.toFixed(0)} yang tetap tercatat di Kredit Pemasok)`
        : note,
  });
  await tx
    .update(supplierReturns)
    .set({
      status: "resolved",
      closedWithRemainder: remaining.gt(0),
      closeNote: note,
    })
    .where(and(eq(supplierReturns.companyId, input.companyId), eq(supplierReturns.id, header.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "supplier_return.resolve_other",
    entityType: "supplier_return",
    entityId: header.id,
    after: { number: header.number, note, remainder: toDb(remaining) },
  });
  return { id: header.id, number: header.number, status: "resolved" as const };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */
