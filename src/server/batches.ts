import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  saleReturns,
  stockBatches,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { D, d, toDb, type Decimal, type MoneyInput } from "@/lib/money";
import { todayISO } from "@/lib/format";

/**
 * Batch & expiry domain (G8/D-7). Batch tracking is opt-in per product
 * (`products.trackBatch`). For tracked products the invariant is:
 *
 *     Σ stock_batches.qty (per product + warehouse) === stock_on_hand.qty
 *
 * The row whose batchNumber and expiryDate are both NULL is the legitimate
 * "Tanpa batch" remainder: it lazily absorbs stock that existed before
 * tracking was switched on (or that arrives without batch identity).
 * Sales allocate FEFO — earliest expiry first, no-expiry rows last — and
 * expired batches can never be sold. Corrections (voids, adjustments,
 * opname) allocate FEFO too but DO include expired rows: removing expired
 * stock is exactly what those documents are for. Batch never changes cost:
 * valuation stays on the global moving average.
 */

export type BatchSlice = {
  batchId: string;
  batchNumber: string | null;
  expiryDate: string | null;
  qty: Decimal;
};

type BatchRow = typeof stockBatches.$inferSelect;

function isExpired(expiryDate: string | null, asOfDate: string): boolean {
  return expiryDate !== null && expiryDate < asOfDate;
}

function sameIdentity(
  row: BatchRow,
  batchNumber: string | null,
  expiryDate: string | null,
): boolean {
  return row.batchNumber === batchNumber && row.expiryDate === expiryDate;
}

export async function isBatchTracked(
  tx: Tx,
  companyId: string,
  productId: string,
): Promise<boolean> {
  const [product] = await tx
    .select({ trackBatch: products.trackBatch })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.id, productId)))
    .limit(1);
  return product?.trackBatch ?? false;
}

/** Lock the stock_on_hand row (creating it when absent) and return its qty. */
async function lockOnHandQty(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  productId: string,
): Promise<Decimal> {
  await tx
    .insert(stockOnHand)
    .values({ companyId, warehouseId, productId, qty: "0" })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, companyId),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    )
    .for("update");
  return d(row?.qty ?? 0);
}

/** Every batch row of a product+warehouse, locked, in FEFO order. */
async function lockBatchRows(
  tx: Tx,
  companyId: string,
  productId: string,
  warehouseId: string,
): Promise<BatchRow[]> {
  return tx
    .select()
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.companyId, companyId),
        eq(stockBatches.productId, productId),
        eq(stockBatches.warehouseId, warehouseId),
      ),
    )
    .orderBy(sql`${stockBatches.expiryDate} asc nulls last`, asc(stockBatches.createdAt))
    .for("update");
}

async function setBatchQty(tx: Tx, batchId: string, qty: Decimal) {
  await tx
    .update(stockBatches)
    .set({ qty: toDb(qty), updatedAt: new Date() })
    .where(eq(stockBatches.id, batchId));
}

/**
 * Make Σ batch qty equal stock_on_hand for a tracked product+warehouse by
 * folding the difference into the batch-null remainder row (created lazily
 * when absent). Idempotent and safe to call before every batch mutation;
 * it is what lets pre-tracking stock join the batch world untouched.
 */
export async function ensureBatchRemainder(
  tx: Tx,
  input: { companyId: string; productId: string; warehouseId: string },
): Promise<void> {
  if (!(await isBatchTracked(tx, input.companyId, input.productId))) return;
  const onHand = await lockOnHandQty(tx, input.companyId, input.warehouseId, input.productId);
  const rows = await lockBatchRows(tx, input.companyId, input.productId, input.warehouseId);
  const sum = rows.reduce((acc, row) => acc.plus(d(row.qty)), d(0));
  const diff = onHand.minus(sum);
  if (diff.eq(0)) return;
  const remainder = rows.find((row) => sameIdentity(row, null, null));
  if (remainder) {
    await setBatchQty(tx, remainder.id, d(remainder.qty).plus(diff));
  } else {
    // R-3: the remainder row may not exist yet in any locked row set
    // (nothing to lock), so a concurrent transaction can create the same
    // identity first. Insert with ON CONFLICT DO NOTHING — the
    // stock_on_hand pattern — then fold the diff into the winner's row,
    // re-read under lock, instead of exploding with a 23505.
    const [inserted] = await tx
      .insert(stockBatches)
      .values({
        companyId: input.companyId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        batchNumber: null,
        expiryDate: null,
        qty: toDb(diff),
      })
      .onConflictDoNothing()
      .returning({ id: stockBatches.id });
    if (!inserted) {
      const freshRows = await lockBatchRows(tx, input.companyId, input.productId, input.warehouseId);
      const winner = freshRows.find((row) => sameIdentity(row, null, null));
      if (winner) {
        await setBatchQty(tx, winner.id, d(winner.qty).plus(diff));
      }
    }
  }
}

/** Find the row for an identity among locked rows, or insert a fresh one. */
async function findOrCreateBatchRow(
  tx: Tx,
  lockedRows: BatchRow[],
  input: {
    companyId: string;
    productId: string;
    warehouseId: string;
    batchNumber: string | null;
    expiryDate: string | null;
  },
): Promise<BatchRow> {
  const existing = lockedRows.find((row) =>
    sameIdentity(row, input.batchNumber, input.expiryDate),
  );
  if (existing) return existing;
  // R-3: when the locked set was empty there was nothing to serialize
  // against, so a concurrent transaction may insert this same identity
  // first. ON CONFLICT DO NOTHING (the stock_on_hand pattern) plus a
  // locked re-read turns that race into a shared row instead of a 23505.
  const [created] = await tx
    .insert(stockBatches)
    .values({
      companyId: input.companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      batchNumber: input.batchNumber,
      expiryDate: input.expiryDate,
      qty: "0",
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const freshRows = await lockBatchRows(tx, input.companyId, input.productId, input.warehouseId);
  const winner = freshRows.find((row) =>
    sameIdentity(row, input.batchNumber, input.expiryDate),
  );
  if (winner) return winner;
  // The conflicting transaction rolled back after all; a plain insert is
  // safe now.
  const [row] = await tx
    .insert(stockBatches)
    .values({
      companyId: input.companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      batchNumber: input.batchNumber,
      expiryDate: input.expiryDate,
      qty: "0",
    })
    .returning();
  return row;
}

function toSlice(row: BatchRow, qty: Decimal): BatchSlice {
  return { batchId: row.id, batchNumber: row.batchNumber, expiryDate: row.expiryDate, qty };
}

/**
 * Upsert qty into the batch identified by (batchNumber, expiryDate) —
 * both null targets the "Tanpa batch" remainder. Returns the affected row.
 * Callers pair this with applyStockMovement so the invariant is preserved.
 */
export async function addToBatch(
  tx: Tx,
  input: {
    companyId: string;
    productId: string;
    warehouseId: string;
    batchNumber?: string | null;
    expiryDate?: string | null;
    delta: MoneyInput;
  },
): Promise<BatchRow> {
  await ensureBatchRemainder(tx, input);
  const rows = await lockBatchRows(tx, input.companyId, input.productId, input.warehouseId);
  const row = await findOrCreateBatchRow(tx, rows, {
    companyId: input.companyId,
    productId: input.productId,
    warehouseId: input.warehouseId,
    batchNumber: input.batchNumber ?? null,
    expiryDate: input.expiryDate ?? null,
  });
  await setBatchQty(tx, row.id, d(row.qty).plus(d(input.delta)));
  return { ...row, qty: toDb(d(row.qty).plus(d(input.delta))) };
}

/**
 * Add qty back to one specific batch row (returns/restores know exactly
 * which batch the goods came from). A missing row falls back to the
 * batch-null remainder so a restore can never lose stock.
 */
export async function creditBatchById(
  tx: Tx,
  input: { companyId: string; productId: string; warehouseId: string; batchId: string; qty: MoneyInput },
): Promise<BatchRow> {
  const rows = await lockBatchRows(tx, input.companyId, input.productId, input.warehouseId);
  const row = rows.find((candidate) => candidate.id === input.batchId);
  if (!row) {
    return addToBatch(tx, { ...input, delta: input.qty });
  }
  await setBatchQty(tx, row.id, d(row.qty).plus(d(input.qty)));
  return { ...row, qty: toDb(d(row.qty).plus(d(input.qty))) };
}

type FefoPlan = { slices: BatchSlice[]; shortfall: Decimal };

/** Greedy FEFO plan over already-locked rows; does not mutate anything. */
function planFefo(
  rows: BatchRow[],
  qty: Decimal,
  asOfDate: string,
  includeExpired: boolean,
): FefoPlan {
  const slices: BatchSlice[] = [];
  let remaining = qty;
  for (const row of rows) {
    if (remaining.lte(0)) break;
    const available = d(row.qty);
    if (available.lte(0)) continue;
    if (!includeExpired && isExpired(row.expiryDate, asOfDate)) continue;
    const take = D.min(available, remaining);
    slices.push(toSlice(row, take));
    remaining = remaining.minus(take);
  }
  return { slices, shortfall: remaining };
}

async function insufficientError(
  tx: Tx,
  input: { companyId: string; productId: string },
  rows: BatchRow[],
  asOfDate: string,
  includeExpired: boolean,
): Promise<AppError> {
  const [product] = await tx
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), eq(products.id, input.productId)))
    .limit(1);
  const name = product?.name ?? "produk";
  const fresh = rows
    .filter((row) => d(row.qty).gt(0) && !isExpired(row.expiryDate, asOfDate))
    .reduce((acc, row) => acc.plus(d(row.qty)), d(0));
  const expired = rows
    .filter((row) => d(row.qty).gt(0) && isExpired(row.expiryDate, asOfDate))
    .reduce((acc, row) => acc.plus(d(row.qty)), d(0));
  if (!includeExpired && expired.gt(0)) {
    return new AppError(
      "INSUFFICIENT_STOCK",
      `Stok ${name} tidak cukup: yang bisa dijual tinggal ${fresh.toFixed(2)} karena ${expired.toFixed(2)} sudah kedaluwarsa dan tidak dapat dijual. Keluarkan stok kedaluwarsa lewat penyesuaian stok.`,
    );
  }
  const available = rows.reduce((acc, row) => acc.plus(d(row.qty)), d(0));
  return new AppError(
    "INSUFFICIENT_STOCK",
    `Stok ${name} tidak cukup. Tersedia ${available.toFixed(2)}.`,
  );
}

/**
 * The single mutation entry point for batch quantities. Positive delta
 * credits one batch (explicit id, explicit identity, or the batch-null
 * remainder). Negative delta debits FEFO — from an explicit batch first
 * when one is given — and returns the slices actually taken, so callers
 * can write one stock movement per slice with the same reference.
 *
 * `purpose: "sale"` never touches expired batches; `"correction"` (void,
 * adjustment, opname, transfer) allocates across all batches. With
 * `allowNegative` (POS companies that permit negative stock) a sale
 * shortfall is booked onto the batch-null remainder instead of throwing.
 */
export async function applyBatchDelta(
  tx: Tx,
  input: {
    companyId: string;
    productId: string;
    warehouseId: string;
    delta: MoneyInput;
    batchId?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
    asOfDate?: string;
    purpose?: "sale" | "correction";
    allowNegative?: boolean;
  },
): Promise<BatchSlice[]> {
  const delta = d(input.delta);
  if (delta.eq(0)) return [];
  if (!(await isBatchTracked(tx, input.companyId, input.productId))) return [];
  const asOfDate = input.asOfDate ?? todayISO();
  const includeExpired = input.purpose === "correction";

  if (delta.gt(0)) {
    if (input.batchId) {
      const row = await creditBatchById(tx, { ...input, batchId: input.batchId, qty: delta });
      return [toSlice(row, delta)];
    }
    const row = await addToBatch(tx, { ...input, delta });
    return [toSlice(row, delta)];
  }

  // Outbound.
  let need = delta.negated();
  const slices: BatchSlice[] = [];
  await ensureBatchRemainder(tx, input);
  let rows = await lockBatchRows(tx, input.companyId, input.productId, input.warehouseId);

  // An explicitly identified batch (void of a receipt line, restore of a
  // document movement) is debited first; any overflow falls through to
  // FEFO so the batch can never go negative on its own.
  let explicit: BatchRow | undefined;
  if (input.batchId) {
    explicit = rows.find((row) => row.id === input.batchId);
  } else if (input.batchNumber !== undefined || input.expiryDate !== undefined) {
    explicit = rows.find((row) =>
      sameIdentity(row, input.batchNumber ?? null, input.expiryDate ?? null),
    );
  }
  if (explicit) {
    const take = D.min(d(explicit.qty), need);
    if (take.gt(0)) {
      await setBatchQty(tx, explicit.id, d(explicit.qty).minus(take));
      slices.push(toSlice(explicit, take));
      need = need.minus(take);
    }
  }

  if (need.gt(0)) {
    rows = await lockBatchRows(tx, input.companyId, input.productId, input.warehouseId);
    const plan = planFefo(rows, need, asOfDate, includeExpired);
    for (const slice of plan.slices) {
      const row = rows.find((candidate) => candidate.id === slice.batchId)!;
      await setBatchQty(tx, row.id, d(row.qty).minus(slice.qty));
      slices.push(slice);
    }
    need = plan.shortfall;
  }

  if (need.gt(0)) {
    if (!input.allowNegative) {
      throw await insufficientError(tx, input, rows, asOfDate, includeExpired);
    }
    // Negative-stock companies: the uncovered remainder is booked onto the
    // batch-null row, which is allowed to go negative together with
    // stock_on_hand so the invariant keeps holding.
    const remainder = await addToBatch(tx, { ...input, delta: need.negated() });
    slices.push(toSlice(remainder, need));
  }

  return slices;
}

/**
 * Read-only sellable availability per product for POS quoting: `fresh` is
 * what may be sold on `asOfDate`, `expired` is physical stock locked by
 * expiry, `total` is fresh + expired. Unmaterialized remainder stock (no
 * batch rows yet, or a positive gap between on-hand and Σ batch) counts as
 * fresh — it carries no expiry. Untracked products are absent from the map.
 */
export async function getBatchAvailability(
  tx: Tx,
  input: { companyId: string; warehouseId: string; productIds: string[]; asOfDate: string },
): Promise<Map<string, { total: Decimal; fresh: Decimal; expired: Decimal }>> {
  const result = new Map<string, { total: Decimal; fresh: Decimal; expired: Decimal }>();
  if (input.productIds.length === 0) return result;
  const tracked = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.companyId, input.companyId),
        inArray(products.id, input.productIds),
        eq(products.trackBatch, true),
      ),
    );
  for (const product of tracked) {
    const [onHand] = await tx
      .select({ qty: stockOnHand.qty })
      .from(stockOnHand)
      .where(
        and(
          eq(stockOnHand.companyId, input.companyId),
          eq(stockOnHand.warehouseId, input.warehouseId),
          eq(stockOnHand.productId, product.id),
        ),
      );
    const rows = await tx
      .select({ qty: stockBatches.qty, expiryDate: stockBatches.expiryDate })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.companyId, input.companyId),
          eq(stockBatches.warehouseId, input.warehouseId),
          eq(stockBatches.productId, product.id),
        ),
      );
    // R-7: batch rows are summed SIGNED. A negative row (the shape
    // negative-stock sales leave behind) must net against its bucket —
    // skipping it, as a positive-only sum does, lets a quote offer the
    // gross positive stock while physical net stock is lower.
    let fresh = d(0);
    let expired = d(0);
    for (const row of rows) {
      const qty = d(row.qty);
      if (isExpired(row.expiryDate, input.asOfDate)) expired = expired.plus(qty);
      else fresh = fresh.plus(qty);
    }
    // The gap between stock_on_hand and Σ batch (unmaterialized remainder
    // or drift) carries no expiry, so it lands in fresh — signed, so a
    // negative gap nets down instead of being clamped away.
    const onHandQty = d(onHand?.qty ?? 0);
    fresh = fresh.plus(onHandQty.minus(fresh.plus(expired)));
    if (expired.lt(0)) {
      fresh = fresh.plus(expired);
      expired = d(0);
    }
    if (fresh.lt(0)) fresh = d(0);
    // Final guard: with non-negative physical stock, never quote more
    // than stock_on_hand in total.
    if (onHandQty.gte(0) && fresh.plus(expired).gt(onHandQty)) {
      const excess = fresh.plus(expired).minus(onHandQty);
      const cutFromFresh = D.min(fresh, excess);
      fresh = fresh.minus(cutFromFresh);
      expired = expired.minus(excess.minus(cutFromFresh));
    }
    result.set(product.id, { total: fresh.plus(expired), fresh, expired });
  }
  return result;
}

/**
 * Plan how a return/void of `qty` goes back onto the batches a sale
 * originally drew from: the sale's own outbound slices, in the order they
 * were taken, each capped at what earlier returns of the same sale have
 * not already restored. Falls back to an empty plan for sales that predate
 * batch tracking — callers then credit the batch-null remainder.
 */
export async function planBatchRestore(
  tx: Tx,
  input: {
    companyId: string;
    productId: string;
    warehouseId: string;
    saleId: string;
    qty: MoneyInput;
  },
): Promise<BatchSlice[]> {
  const originals = await tx
    .select({
      batchId: stockMovements.batchId,
      qty: stockMovements.qty,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, input.companyId),
        eq(stockMovements.referenceType, "sale"),
        eq(stockMovements.referenceId, input.saleId),
        eq(stockMovements.productId, input.productId),
        eq(stockMovements.warehouseId, input.warehouseId),
        isNotNull(stockMovements.batchId),
      ),
    )
    .orderBy(asc(stockMovements.createdAt));
  if (originals.length === 0) return [];

  const returnRows = await tx
    .select({ id: saleReturns.id })
    .from(saleReturns)
    .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.saleId, input.saleId)));
  const restoreRefs: { referenceType: string; referenceId: string }[] = [
    { referenceType: "sale_void", referenceId: input.saleId },
    ...returnRows.map((row) => ({ referenceType: "sale_return", referenceId: row.id })),
  ];
  const restoredByBatch = new Map<string, Decimal>();
  for (const ref of restoreRefs) {
    const restored = await tx
      .select({ batchId: stockMovements.batchId, qty: stockMovements.qty })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.companyId, input.companyId),
          eq(stockMovements.referenceType, ref.referenceType),
          eq(stockMovements.referenceId, ref.referenceId),
          eq(stockMovements.productId, input.productId),
          eq(stockMovements.warehouseId, input.warehouseId),
          isNotNull(stockMovements.batchId),
        ),
      );
    for (const row of restored) {
      if (!row.batchId) continue;
      restoredByBatch.set(
        row.batchId,
        (restoredByBatch.get(row.batchId) ?? d(0)).plus(d(row.qty)),
      );
    }
  }

  const batchIds = [...new Set(originals.map((row) => row.batchId).filter(Boolean))] as string[];
  const batchRows = batchIds.length
    ? await tx
        .select()
        .from(stockBatches)
        .where(and(eq(stockBatches.companyId, input.companyId), inArray(stockBatches.id, batchIds)))
    : [];
  const batchById = new Map(batchRows.map((row) => [row.id, row]));

  const slices: BatchSlice[] = [];
  let remaining = d(input.qty);
  for (const original of originals) {
    if (remaining.lte(0)) break;
    if (!original.batchId) continue;
    const capacity = d(original.qty)
      .negated()
      .minus(restoredByBatch.get(original.batchId) ?? d(0));
    if (capacity.lte(0)) continue;
    const take = D.min(capacity, remaining);
    const batch = batchById.get(original.batchId);
    slices.push({
      batchId: original.batchId,
      batchNumber: batch?.batchNumber ?? null,
      expiryDate: batch?.expiryDate ?? null,
      qty: take,
    });
    remaining = remaining.minus(take);
  }
  return slices;
}

/** All batch rows of a product (optionally one warehouse), FEFO-ordered. */
export async function listBatches(
  tx: Tx,
  companyId: string,
  productId: string,
  warehouseId?: string,
) {
  return tx
    .select()
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.companyId, companyId),
        eq(stockBatches.productId, productId),
        warehouseId ? eq(stockBatches.warehouseId, warehouseId) : sql`true`,
      ),
    )
    .orderBy(
      asc(stockBatches.warehouseId),
      sql`${stockBatches.expiryDate} asc nulls last`,
      asc(stockBatches.createdAt),
    );
}

/**
 * Batches already expired or expiring within `withinDays` from today,
 * with stock still on hand — the warehouse dashboard's watch list.
 */
export async function listExpiringBatches(tx: Tx, companyId: string, withinDays: number) {
  const today = todayISO();
  const cutoffDate = new Date(`${today}T00:00:00Z`);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() + withinDays);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const where = and(
    eq(stockBatches.companyId, companyId),
    isNotNull(stockBatches.expiryDate),
    lte(stockBatches.expiryDate, cutoff),
    sql`${stockBatches.qty} > 0`,
  );
  return tx
    .select({
      id: stockBatches.id,
      productId: stockBatches.productId,
      productName: products.name,
      productSku: products.sku,
      warehouseId: stockBatches.warehouseId,
      warehouseName: warehouses.name,
      batchNumber: stockBatches.batchNumber,
      expiryDate: stockBatches.expiryDate,
      qty: stockBatches.qty,
    })
    .from(stockBatches)
    .innerJoin(products, eq(stockBatches.productId, products.id))
    .innerJoin(warehouses, eq(stockBatches.warehouseId, warehouses.id))
    .where(where)
    .orderBy(sql`${stockBatches.expiryDate} asc`, asc(stockBatches.createdAt));
}

/** Bounded warehouse-home list plus exact full-set counters. */
export async function getExpiringBatchDashboard(
  tx: Tx,
  companyId: string,
  withinDays: number,
  limit = 15,
) {
  const today = todayISO();
  const cutoffDate = new Date(`${today}T00:00:00Z`);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() + withinDays);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const where = and(
    eq(stockBatches.companyId, companyId),
    isNotNull(stockBatches.expiryDate),
    lte(stockBatches.expiryDate, cutoff),
    sql`${stockBatches.qty} > 0`,
  );
  const rows = await tx
    .select({
      id: stockBatches.id,
      productId: stockBatches.productId,
      productName: products.name,
      productSku: products.sku,
      warehouseId: stockBatches.warehouseId,
      warehouseName: warehouses.name,
      batchNumber: stockBatches.batchNumber,
      expiryDate: stockBatches.expiryDate,
      qty: stockBatches.qty,
      totalCount: sql<string>`count(*) over ()`,
      expiredCount: sql<string>`count(*) filter (where ${stockBatches.expiryDate} < ${today}) over ()`,
    })
    .from(stockBatches)
    .innerJoin(products, eq(stockBatches.productId, products.id))
    .innerJoin(warehouses, eq(stockBatches.warehouseId, warehouses.id))
    .where(where)
    .orderBy(sql`${stockBatches.expiryDate} asc`, asc(stockBatches.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
  const first = rows[0];
  const items = rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    productSku: row.productSku,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    batchNumber: row.batchNumber,
    expiryDate: row.expiryDate,
    qty: row.qty,
  }));

  return {
    items,
    totalCount: Number(first?.totalCount ?? 0),
    expiredCount: Number(first?.expiredCount ?? 0),
  };
}
