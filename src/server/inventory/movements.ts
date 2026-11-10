// FIX-ARS Tahap 4: bagian dari pemecahan src/server/inventory.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/inventory.ts.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockMovements,
  stockOnHand,
  suppliers,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { applyBatchDelta, isBatchTracked } from "@/server/batches";
import { isSerialTracked, pickSerialsOut } from "@/server/serials";

export async function applyStockMovement(
  tx: Tx,
  input: {
    companyId: string;
    warehouseId: string;
    productId: string;
    delta: MoneyInput;
    unitCost?: MoneyInput;
    movementType: string;
    referenceType?: string;
    referenceId?: string;
    referenceNumber?: string;
    reason?: string;
    userId?: string;
    allowNegative?: boolean;
    // FIX-GDG Tahap 2 (GDG3-03): tanggal bisnis gerakan = tanggal
    // dokumen sumber. Wajib diisi pemanggil dokumen; bawaan hari ini
    // (WIB) hanya untuk pemanggil tanpa dokumen (penyesuaian langsung
    // di test/utilitas lama).
    date?: string;
    // Batch slice this movement belongs to (G8/D-7); batch quantities
    // themselves are mutated through src/server/batches.ts helpers.
    batchId?: string | null;
  },
): Promise<{ before: number; after: number }> {
  const delta = d(input.delta);

  await tx
    .insert(stockOnHand)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      qty: "0",
    })
    .onConflictDoNothing();

  const [locked] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, input.companyId),
        eq(stockOnHand.warehouseId, input.warehouseId),
        eq(stockOnHand.productId, input.productId),
      ),
    )
    .for("update");

  const before = d(locked?.qty ?? 0);
  const after = before.plus(delta);

  if (after.lt(0) && !input.allowNegative) {
    throw new AppError("INSUFFICIENT_STOCK", `Stok tidak cukup. Tersedia ${before.toFixed(2)}.`);
  }

  await tx
    .update(stockOnHand)
    .set({ qty: toDb(after), updatedAt: new Date() })
    .where(
      and(
        eq(stockOnHand.companyId, input.companyId),
        eq(stockOnHand.warehouseId, input.warehouseId),
        eq(stockOnHand.productId, input.productId),
      ),
    );

  await tx.insert(stockMovements).values({
    companyId: input.companyId,
    warehouseId: input.warehouseId,
    productId: input.productId,
    batchId: input.batchId ?? null,
    movementType: input.movementType,
    date: input.date ?? todayISO(),
    qty: toDb(delta),
    unitCost: toDb(input.unitCost ?? 0),
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    referenceNumber: input.referenceNumber ?? null,
    reason: input.reason ?? null,
    createdBy: input.userId ?? null,
  });

  // FIX-P1 (AK4-06a): the moving average re-blends on every inbound
  // movement that carries a REAL cost basis — purchases at invoice cost
  // and sale returns at the ORIGINAL cost of the sale they reverse.
  // Before this fix only "purchase" blended, so returned goods entered
  // the valuation at their historical cost while products.costPrice
  // stayed at the current average: Σ qty × costPrice drifted away from
  // the GL inventory balance (which the return journal credits at the
  // original cost) with no explaining entry. The blend below weights
  // exactly as the mandate formula: (on-hand value + returned qty ×
  // original cost) / (on-hand qty + returned qty).
  if (
    delta.gt(0) &&
    input.unitCost &&
    (input.movementType === "purchase" || input.movementType === "sale_return")
  ) {
    // GDG1-02: baris produk DIKUNCI selama blend. Tanpa kunci ini dua
    // penerimaan bersamaan di gudang berbeda sama-sama membaca
    // costPrice yang sama dan yang menulis terakhir menimpa blend yang
    // lain (audit GDG-1 catatan A3: benar secara empiris 4/4, tetapi
    // jendela balapannya nyata). Urutan kunci selalu on-hand → produk,
    // sama di semua pemanggil, jadi tidak ada siklus kunci baru.
    const [product] = await tx
      .select({ costPrice: products.costPrice })
      .from(products)
      .where(and(eq(products.companyId, input.companyId), eq(products.id, input.productId)))
      .limit(1)
      .for("update");
    if (product) {
      // products.costPrice is GLOBAL per product, so the moving average must
      // be weighted by the product's stock across ALL warehouses. Using only
      // this warehouse's `before` resets the average to the latest receipt
      // price whenever goods land in an empty warehouse while stock exists
      // elsewhere. stock_on_hand for the target warehouse was already updated
      // above, so the sum below is the global qty AFTER this movement.
      const [globalRow] = await tx
        .select({ total: sql<string>`coalesce(sum(${stockOnHand.qty}), 0)` })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, input.companyId),
            eq(stockOnHand.productId, input.productId),
          ),
        );
      const globalAfter = d(globalRow?.total ?? 0);
      const globalBefore = globalAfter.minus(delta);
      // GDG1-02: rumus tertimbang berlaku untuk SETIAP globalAfter > 0 —
      // termasuk globalBefore NEGATIF. Invariant nilainya: nilai akhir =
      // nilai sebelum + qty masuk × biaya masuk, dengan nilai sebelum =
      // globalBefore × costPrice berjalan TANPA memandang tandanya.
      // Lubang negatif membawa nilai pada AVCO lama (penjualannya sudah
      // mengkredit persediaan di GL sebesar itu), jadi isi ulang pertama
      // menutup defisit pada biaya lama sebelum memadukan sisanya:
      // (−5 × 10.000 + 10 × 20.000) / 5 = 30.000, dan qty akhir × biaya
      // baru = nilai ledger = saldo GL. Rumus lama melewati blend saat
      // globalBefore <= 0 dan menyetel biaya = biaya masuk, membiarkan
      // subledger menyimpang permanen dari GL. Kasus globalAfter <= 0
      // tetap pengecualian (belum ada stok positif untuk dihargai;
      // biaya disetel ke biaya masuk seperti sebelumnya).
      const newCost = globalAfter.gt(0)
        ? globalBefore
            .mul(d(product.costPrice))
            .plus(delta.mul(d(input.unitCost)))
            .div(globalAfter)
        : d(input.unitCost);
      await tx
        .update(products)
        .set({ costPrice: toDb(newCost), updatedAt: new Date() })
        .where(and(eq(products.companyId, input.companyId), eq(products.id, input.productId)));
    }
  }

  return { before: before.toNumber(), after: after.toNumber() };
}

/**
 * Apply one warehouse document line's stock delta (G8/D-7). Untracked
 * products keep the single-movement behavior. Batch-tracked products are
 * split into one movement per batch slice: outbound deltas allocate FEFO
 * across batches, inbound deltas credit the batch-null remainder.
 * Returns the slices so transfer-like flows can mirror the same batches
 * at the destination.
 *
 * A-28 Tahap 2 (H-GDG-01): WHICH batches an outbound delta may touch is
 * decided by `purpose`, judged at the DOCUMENT date (`date`, forwarded
 * as the allocation's as-of date — never silently "today"):
 * - "sale" (productive outflow): batches whose expiry is BEFORE the
 *   document date are skipped — expired stock can never leave through
 *   this path; a batch expiring exactly ON the document date is still
 *   eligible. When only expired stock remains, the allocation throws
 *   the INSUFFICIENT_STOCK error that names the expiry and points at
 *   the stock-adjustment document as the way out.
 * - "correction" (the default; adjustments incl. the `expired` family,
 *   opname): expired batches ARE included — those documents are exactly
 *   how expired stock is written off, so they must be able to take it.
 * Every current caller is a correction flow and keeps the default; a
 * productive outflow must opt into "sale" explicitly.
 */


export async function applyDocumentMovement(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    productId: string;
    delta: Decimal;
    unitCost: MoneyInput;
    movementType: string;
    referenceType?: string;
    referenceId?: string;
    referenceNumber?: string;
    reason?: string;
    // FIX-GDG Tahap 2 (GDG3-03): tanggal dokumen diteruskan ke gerakan.
    date?: string;
    // A-28 Tahap 2 (H-GDG-01): semantik alokasi batch keluar — lihat
    // komentar fungsi. Bawaan "correction" mempertahankan perilaku
    // semua pemanggil yang ada (penyesuaian & opname).
    purpose?: "sale" | "correction";
  },
): Promise<{ batchId: string; batchNumber: string | null; expiryDate: string | null; qty: Decimal }[]> {
  // SIM-2 S7B-2 Batch 5: produk serial — keluar mengonsumsi seri
  // tertua; masuk lewat jalur dokumen generik DITOLAK karena seri hanya
  // boleh masuk lewat penerimaan dengan daftar seri eksplisit.
  const serialTracked = await isSerialTracked(tx, input.companyId, input.productId);
  if (serialTracked) {
    if (input.delta.gt(0)) {
      throw new AppError(
        "VALIDATION",
        "Stok masuk produk bernomor seri hanya dapat lewat Penerimaan dengan daftar nomor seri per unit.",
      );
    }
    if (input.delta.lt(0)) {
      const [product] = await tx
        .select({ name: products.name })
        .from(products)
        .where(and(eq(products.companyId, input.companyId), eq(products.id, input.productId)))
        .limit(1);
      await pickSerialsOut(tx, {
        companyId: input.companyId,
        userId: input.userId,
        productId: input.productId,
        productName: product?.name ?? "Produk serial",
        warehouseId: input.warehouseId,
        qty: input.delta.abs(),
        referenceType: input.referenceType ?? "stock_document",
        referenceId: input.referenceId ?? "",
        referenceNumber: input.referenceNumber ?? "",
      });
    }
  }
  const tracked = await isBatchTracked(tx, input.companyId, input.productId);
  if (!tracked) {
    await applyStockMovement(tx, { ...input, allowNegative: false });
    return [];
  }
  const slices = await applyBatchDelta(tx, {
    companyId: input.companyId,
    productId: input.productId,
    warehouseId: input.warehouseId,
    delta: input.delta,
    // A-28 Tahap 2 (H-GDG-01): kedaluwarsa dinilai pada tanggal
    // dokumen, bukan hari pemrosesan — dokumen bertanggal mundur
    // mengalokasi seperti pada hari dokumen itu berlaku.
    asOfDate: input.date,
    purpose: input.purpose ?? "correction",
  });
  for (const slice of slices) {
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      delta: input.delta.lt(0) ? slice.qty.negated() : slice.qty,
      unitCost: input.unitCost,
      movementType: input.movementType,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      reason: input.reason,
      userId: input.userId,
      allowNegative: false,
      batchId: slice.batchId,
      date: input.date,
    });
  }
  return slices;
}


export async function getStock(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx
    .select({ productId: stockOnHand.productId, qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, companyId),
        eq(stockOnHand.warehouseId, warehouseId),
        inArray(stockOnHand.productId, productIds),
      ),
    );
  return new Map(rows.map((r) => [r.productId, d(r.qty).toNumber()]));
}

/**
 * GDG3-07: validasi kepemilikan setenant untuk referensi yang masuk
 * dari klien. FK basis data hanya membuktikan baris itu ada di SUATU
 * perusahaan; tanpa pemeriksaan ini, dokumen perusahaan A dapat
 * menanam stok di gudang perusahaan B atau menagih pemasok perusahaan
 * B (RLS tidak menolong karena baris ditulis ber-company_id pemanggil).
 * Pola yang sama seperti validasi produk/akun pembayaran yang sudah
 * lebih dulu ada di createReceipt.
 */


export async function assertWarehouseOwned(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  label = "Gudang",
): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), eq(warehouses.id, warehouseId)))
    .limit(1);
  if (!row) throw new AppError("VALIDATION", `${label} tidak ditemukan di perusahaan ini.`);
}


export async function assertSupplierOwned(tx: Tx, companyId: string, supplierId: string): Promise<void> {
  const [row] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, companyId), eq(suppliers.id, supplierId)))
    .limit(1);
  if (!row) throw new AppError("VALIDATION", "Pemasok tidak ditemukan di perusahaan ini.");
}


export async function lockStockQty(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  productId: string,
): Promise<ReturnType<typeof d>> {
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

/**
 * FIX-P1 (AK4-06b): recompute a product's moving average (costPrice)
 * from its remaining movement ledger after a receipt void.
 *
 * Definition: costPrice = Σ(qty × unitCost over ALL stock_movements of
 * the product, every warehouse) ÷ Σ(qty over the same set) — the net
 * ledger value still carried by the remaining quantity. Every movement
 * records the cost at which value entered or left (receipts at invoice
 * cost, sales at the AVCO of their moment, sale returns at original
 * cost, reversals mirroring their original documents), so the quotient
 * is exactly the average cost of what remains — the same value the GL
 * inventory balance carries after the void's reversal journal. When
 * the net quantity is ≤ 0 there is no remaining stock to value: the
 * last costPrice is kept on purpose (an empty product's cost is reset
 * by the next inbound blend anyway, and zeroing it would erase the
 * reference cost users see). Batch rows carry quantities only, so this
 * recompute cannot disturb the Σ batch qty = stock_on_hand invariant.
 */


export async function recomputeCostFromLedger(tx: Tx, companyId: string, productId: string) {
  const [row] = await tx
    .select({
      value: sql<string>`coalesce(sum(${stockMovements.qty} * ${stockMovements.unitCost}), 0)`,
      qty: sql<string>`coalesce(sum(${stockMovements.qty}), 0)`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, companyId),
        eq(stockMovements.productId, productId),
      ),
    );
  const qty = d(row?.qty ?? 0);
  if (qty.lte(0)) return;
  await tx
    .update(products)
    .set({ costPrice: toDb(d(row?.value ?? 0).div(qty)), updatedAt: new Date() })
    .where(and(eq(products.companyId, companyId), eq(products.id, productId)));
}

/**
 * Void a posted goods receipt (GD-P1-5, generalized for D-5 sources).
 * Corrections stay append-only: the received quantities leave the same
 * warehouse again as "reversal" movements valued at the original receipt
 * cost, and the receipt's own journal — whatever source posted it — is
 * reversed. Afterwards each affected product's moving average IS
 * recomputed from the remaining movement ledger (FIX-P1 AK4-06b,
 * recomputeCostFromLedger): without it the average kept blending
 * against a receipt that no longer exists, and Σ qty × costPrice
 * drifted permanently away from the GL inventory balance.
 */
