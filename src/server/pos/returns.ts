// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: baca kredit retur pindah ke returns-credit.ts dan penyelesaian
// refund ke returns-settlement.ts; berkas ini memuat pembuatan retur.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashMovements, saleLines, saleReturnLines, saleReturns, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  D,
  d,
  toDb,
  type Decimal,
} from "@/lib/money";
import { getAccountMap, postJournal } from "@/server/accounting";
import { claimIdempotencyKey } from "@/server/idempotency";
import { writeAudit } from "@/server/audit";
import { applyStockMovement } from "@/server/inventory";
import { restoreSerialsForSale, serialTrackFlags } from "@/server/serials";
import { nextDocumentNumber } from "@/server/sequences";
import { batchTrackFlags, restoreSaleLineBatches, trackStockFlags } from "./sales-stock";
import type { SaleRow } from "./sales-void";
import { resolveReturnSettlement, type CreateSaleReturnInput, type RefundSettlement } from "./returns-settlement";

export async function createSaleReturn(tx: Tx, input: CreateSaleReturnInput) {
  if (!input.reason.trim()) throw new AppError("VALIDATION", "Alasan retur wajib diisi.");
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Pilih minimal satu barang yang diretur.");

  if (input.idempotencyKey) {
    const existing = () => tx.select({ id: saleReturns.id, number: saleReturns.number, total: saleReturns.total, saleId: saleReturns.saleId })
      .from(saleReturns).where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.idempotencyKey, input.idempotencyKey!))).limit(1);
    const replay = async () => {
      const [row] = await existing();
      if (!row) return null;
      if (row.saleId !== input.saleId) throw new AppError("CONFLICT", "Kunci retur sudah dipakai pada penjualan lain.");
      return { id: row.id, number: row.number, total: d(row.total).toNumber(), warnings: [] as string[] };
    };
    const found = await replay();
    if (found) return found;
    if (!await claimIdempotencyKey(tx, { companyId: input.companyId, key: input.idempotencyKey, scope: "pos.return" })) {
      const winner = await replay();
      if (winner) return winner;
      throw new AppError("CONFLICT", "Retur dengan kunci yang sama sedang diproses. Coba lagi.");
    }
  }

  const origin = await loadReturnOrigin(tx, input);
  const { sale, originalLines, map } = origin;

  const amounts = computeReturnLines(input, origin);
  const { computedLines, returnTotal, roundingPortion, refundDue, offsetPortion, excessPortion, costPortion } = amounts;

  const settlement = await resolveReturnSettlement(tx, input, sale, map, excessPortion);
  const { settleAccount, refundSessionId, settlementCredits, cashSettled, creditRestored, originSettled } = settlement;

  const ret = await insertSaleReturnDocument(tx, input, sale, computedLines);

  if (input.disposition !== "write_off") await restoreReturnedStock(tx, input, origin, ret, computedLines);

  // Total dokumen = nilai penyelesaian penuh retur (barang + porsi
  // pembulatan), sejajar dengan sales.total yang juga memuat
  // penyesuaiannya. Khusus penyelesaian kredit toko/tukar, total adalah
  // nilai kredit yang lahir (kelebihan di atas potongan piutang) —
  // itulah yang dapat ditebus pelanggan kemudian (getReturnCredit).
  const documentTotal =
    input.refundMethod === "store_credit" || input.refundMethod === "exchange"
      ? excessPortion
      : refundDue;
  await tx
    .update(saleReturns)
    .set({ total: toDb(documentTotal), costTotal: toDb(costPortion) })
    .where(eq(saleReturns.id, ret.id));

  const returnJournal = await postSaleReturnJournal(
    tx, input, sale, ret, map, amounts, settleAccount, settlementCredits,
  );

  // Mutasi laci hanya sebesar uang yang benar-benar keluar (kelebihan
  // di atas potongan piutang) — porsi pemotong piutang bukan pergerakan
  // kas. POS1-06: dan hanya sebesar porsi TUNAI dari alokasi tender
  // asal (cashSettled), bukan seluruh kelebihan — porsi kredit/metode
  // asal tidak pernah menyentuh laci.
  if (input.refundMethod === "cash" && cashSettled.gt(0) && refundSessionId) {
    await tx.insert(cashMovements).values({
      companyId: input.companyId,
      sessionId: refundSessionId,
      type: "refund",
      amount: toDb(cashSettled.neg()),
      referenceType: "sale_return",
      referenceId: ret.id,
      notes: input.reason,
      createdBy: input.userId,
    });
  }

  // FIX-P1 (AK4-03): potongan piutang menyelesaikan sebagian tagihan —
  // paidTotal berarti "bagian tagihan yang sudah terselesaikan" (tunai
  // maupun potongan retur), sehingga sisa piutang (total − paidTotal),
  // paymentStatus, daftar piutang, dan GL selalu konsisten.
  if (offsetPortion.gt(0)) {
    const newPaid = d(sale.paidTotal).plus(offsetPortion);
    await tx
      .update(sales)
      .set({
        paidTotal: toDb(newPaid),
        paymentStatus: newPaid.gte(d(sale.total)) ? "paid" : newPaid.gt(0) ? "partial" : "unpaid",
      })
      .where(and(eq(sales.companyId, input.companyId), eq(sales.id, sale.id)));
  }

  const allReturned = await tx
    .select({ total: sql<string>`coalesce(sum(${saleReturnLines.qty}), 0)` })
    .from(saleReturnLines)
    .innerJoin(saleReturns, eq(saleReturnLines.returnId, saleReturns.id))
    .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.saleId, sale.id)));
  const returnedQty = d(allReturned[0]?.total);
  const soldQty = originalLines.reduce((acc, line) => acc.plus(d(line.qty)), d(0));
  if (returnedQty.gte(soldQty)) {
    await tx
      .update(sales)
      .set({ status: "returned" })
      .where(and(eq(sales.companyId, input.companyId), eq(sales.id, sale.id)));
  }

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.return",
    entityType: "sale_return",
    entityId: ret.id,
    after: {
      number: ret.number,
      total: toDb(documentTotal),
      reason: input.reason,
      disposition: input.disposition ?? "sellable",
      // FIX-P1: rincian penyelesaian agar potongan piutang vs refund
      // dapat ditelusur dari audit, bukan ditebak dari jurnal.
      goodsValue: toDb(returnTotal),
      roundingPortion: toDb(roundingPortion),
      receivableOffset: toDb(offsetPortion),
      settledExcess: toDb(excessPortion),
      // POS1-06: rincian alokasi tender asal untuk refund tunai.
      ...(input.refundMethod === "cash"
        ? {
            cashSettled: toDb(cashSettled),
            creditRestored: toDb(creditRestored),
            originAccountSettled: toDb(originSettled),
          }
        : {}),
    },
  });

  // FIX-R2 Tahap 3 (RV2-01): peringatan penjaga saldo kas/bank (mode
  // warn) untuk jurnal refund tunai retur ini.
  return { id: ret.id, number: ret.number, total: documentTotal.toNumber(), warnings: returnJournal?.warnings ?? [] };
}


type SaleLineRow = typeof saleLines.$inferSelect;


type ComputedReturnLine = {
  /** S4: baris penjualan asal yang diretur irisan ini. */
  saleLineId: string;
  productId: string;
  /** Qty satuan dasar irisan ini (yang kembali ke stok & jurnal). */
  qty: Decimal;
  /** Qty dalam bentuk masukan baris asal (untuk baris Dus: jumlah Dus). */
  qtyInput: Decimal;
  original: SaleLineRow;
  lineTotal: Decimal;
  cost: Decimal;
  tracked: boolean;
};


type ReturnOrigin = {
  sale: SaleRow;
  originalLines: SaleLineRow[];
  /** S4: baris asal per id baris (retur kini berbasis baris, bukan produk). */
  originalById: Map<string, SaleLineRow>;
  /** S4: baris-baris asal per produk, urut nomor baris (alokasi FIFO warisan). */
  originalByProduct: Map<string, SaleLineRow[]>;
  returnProductIds: string[];
  trackStock: Map<string, boolean>;
  trackBatch: Map<string, boolean>;
  map: Awaited<ReturnType<typeof getAccountMap>>;
  /** S4: qty dasar yang sudah diretur, per BARIS asal. */
  returnedByLine: Map<string, Decimal>;
};

/**
 * S4: atribusi baris retur tersimpan ke baris penjualan asal.
 * Baris retur S4 membawa sale_line_id-nya; baris warisan (null)
 * diatribusikan ke baris asal produknya bila produk itu hanya punya
 * SATU baris pada penjualan ini — selalu benar untuk penjualan
 * pra-S4 (quote lama menolak produk ganda) — sehingga sisa retur
 * penjualan lama tetap terhitung persis.
 */
function attributeReturnedByLine(
  originalLines: SaleLineRow[],
  rows: { saleLineId: string | null; productId: string; qty: string }[],
): Map<string, Decimal> {
  const byProduct = new Map<string, SaleLineRow[]>();
  for (const line of originalLines) {
    const list = byProduct.get(line.productId) ?? [];
    list.push(line);
    byProduct.set(line.productId, list);
  }
  const result = new Map<string, Decimal>();
  for (const row of rows) {
    let targetId = row.saleLineId;
    if (!targetId) {
      const candidates = byProduct.get(row.productId) ?? [];
      if (candidates.length === 1) targetId = candidates[0].id;
    }
    if (!targetId) continue;
    result.set(targetId, (result.get(targetId) ?? d(0)).plus(d(row.qty)));
  }
  return result;
}

/**
 * FIX-ARS Tahap 4: fase dari createSaleReturn — badan dipindah apa adanya;
 * muat konteks asal — penjualan dikunci lebih dulu (POS-RET-01),
 * baris asal, flag pelacakan, peta akun, dan snapshot qty yang
 * sudah diretur dibaca di bawah kunci itu.
 */


async function loadReturnOrigin(tx: Tx, input: CreateSaleReturnInput): Promise<ReturnOrigin> {
  // POS-RET-01 (+ R-5 review Tahap 2): lock the origin sale row FIRST. The
  // already-returned snapshot below and the batch restore plan are only
  // trustworthy while this lock is held — without it two concurrent returns
  // of the same sale can both validate against the same remaining qty and
  // over-return. (The SALE_RETURN document sequence accidentally serialized
  // same-year returns; backdated returns in another fiscal year raced for
  // real.)
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, input.saleId)))
    .limit(1)
    .for("update");
  if (!sale) throw new AppError("NOT_FOUND", "Transaksi asal tidak ditemukan.");
  if (sale.status !== "completed") throw new AppError("INVALID_STATE", "Hanya transaksi selesai yang bisa diretur.");

  const originalLines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, sale.id))
    .orderBy(asc(saleLines.lineNo));
  const originalById = new Map(originalLines.map((line) => [line.id, line]));
  const originalByProduct = new Map<string, SaleLineRow[]>();
  for (const line of originalLines) {
    const list = originalByProduct.get(line.productId) ?? [];
    list.push(line);
    originalByProduct.set(line.productId, list);
  }
  const returnProductIds = [...new Set(input.lines.map((line) => line.productId))];
  const trackStock = await trackStockFlags(tx, input.companyId, returnProductIds, sale.id);
  const trackBatch = await batchTrackFlags(tx, input.companyId, returnProductIds, sale.id);

  const map = await getAccountMap(tx, input.companyId);
  const alreadyReturned = await tx
    .select({
      saleLineId: saleReturnLines.saleLineId,
      productId: saleReturnLines.productId,
      qty: saleReturnLines.qty,
    })
    .from(saleReturnLines)
    .innerJoin(saleReturns, eq(saleReturnLines.returnId, saleReturns.id))
    .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.saleId, sale.id)));
  const returnedByLine = attributeReturnedByLine(originalLines, alreadyReturned);
  return {
    sale, originalLines, originalById, originalByProduct, returnProductIds,
    trackStock, trackBatch, map, returnedByLine,
  };
}


type ReturnAmounts = {
  computedLines: ComputedReturnLine[];
  revenuePortion: Decimal;
  taxPortion: Decimal;
  discountPortion: Decimal;
  costPortion: Decimal;
  returnTotal: Decimal;
  roundingPortion: Decimal;
  refundDue: Decimal;
  offsetPortion: Decimal;
  excessPortion: Decimal;
};

/**
 * FIX-ARS Tahap 4: fase dari createSaleReturn — badan dipindah apa adanya;
 * hitung baris & porsi uang (Pass 1) — agregasi per produk
 * (POS1-01), validasi sisa retur, porsi pendapatan/pajak/diskon/
 * biaya, porsi pembulatan (AK4-01), dan belah potongan piutang
 * vs kelebihan (AK2-01/AK4-03). Tanpa tulisan apa pun.
 */


function computeReturnLines(input: CreateSaleReturnInput, origin: ReturnOrigin): ReturnAmounts {
  const { sale, originalLines, originalById, originalByProduct, returnedByLine, trackStock } = origin;
  // POS1-01: agregatkan baris permintaan SEBELUM validasi — penjaga
  // sisa menilai tiap baris terhadap snapshot yang dibaca sekali;
  // dua baris untuk sasaran yang sama dalam satu permintaan tidak
  // boleh masing-masing lolos terhadap sisa penuh (refund 160%
  // terbukti oleh probe audit).
  // S4: sasaran agregasi kini BARIS penjualan asal, bukan produk —
  // satu produk dapat mempunyai dua baris asal (Dus + Pcs) dengan
  // harga & faktor cuplikan berbeda, dan setiap irisan retur dinilai
  // dari baris asalnya sendiri. Permintaan dipecah menjadi irisan:
  // - bertarget (saleLineId): qty dalam bentuk masukan baris asal,
  //   dikonversi isi_snapshot baris itu (master tidak dibaca);
  // - warisan per produk: qty satuan dasar, diagregat per produk
  //   (POS1-01) lalu dialokasikan FIFO ke baris-baris asal produk.
  type Slice = { original: SaleLineRow; qtyInput: Decimal; qty: Decimal };
  const slices: Slice[] = [];
  const allocatedByLine = new Map<string, Decimal>();
  const remainingOf = (original: SaleLineRow) =>
    d(original.qty)
      .minus(returnedByLine.get(original.id) ?? d(0))
      .minus(allocatedByLine.get(original.id) ?? d(0));
  const pushSlice = (original: SaleLineRow, qtyInput: Decimal, qtyBase: Decimal) => {
    slices.push({ original, qtyInput, qty: qtyBase });
    allocatedByLine.set(original.id, (allocatedByLine.get(original.id) ?? d(0)).plus(qtyBase));
  };

  for (const line of input.lines) {
    if (!line.saleLineId) continue;
    const original = originalById.get(line.saleLineId);
    if (!original) throw new AppError("VALIDATION", "Baris transaksi asal tidak ditemukan.");
    if (original.productId !== line.productId) {
      throw new AppError("VALIDATION", "Baris retur tidak cocok dengan produk pada baris transaksi asal.");
    }
    const qtyInput = d(line.qty);
    if (qtyInput.lte(0)) throw new AppError("VALIDATION", "Jumlah retur harus lebih dari nol.");
    const qtyBase = qtyInput.mul(d(original.isiSnapshot));
    const remaining = remainingOf(original);
    if (qtyBase.gt(remaining)) {
      // Sisa dinyatakan dalam bentuk masukan baris asal (Dus untuk
      // baris Dus, satuan dasar untuk baris biasa — pola pesan lama).
      const remainingShown = original.packagingId
        ? remaining.div(d(original.isiSnapshot)).toNumber()
        : remaining.toNumber();
      throw new AppError(
        "VALIDATION",
        `Jumlah retur ${original.productName} melebihi sisa yang bisa diretur (${remainingShown}).`,
      );
    }
    pushSlice(original, qtyInput, qtyBase);
  }

  const legacyByProduct = new Map<string, Decimal>();
  for (const line of input.lines) {
    if (line.saleLineId) continue;
    legacyByProduct.set(line.productId, (legacyByProduct.get(line.productId) ?? d(0)).plus(d(line.qty)));
  }
  for (const [productId, wanted] of legacyByProduct) {
    const candidates = originalByProduct.get(productId) ?? [];
    if (candidates.length === 0) throw new AppError("VALIDATION", "Produk tidak ada pada transaksi asal.");
    if (wanted.lte(0)) throw new AppError("VALIDATION", "Jumlah retur harus lebih dari nol.");
    const capacityTotal = candidates.reduce(
      (acc, original) => acc.plus(d(original.qty).minus(returnedByLine.get(original.id) ?? d(0))),
      d(0),
    );
    if (wanted.gt(capacityTotal)) {
      throw new AppError(
        "VALIDATION",
        `Jumlah retur ${candidates[0].productName} melebihi sisa yang bisa diretur (${capacityTotal.toNumber()}).`,
      );
    }
    let remaining = wanted;
    for (const original of candidates) {
      if (remaining.lte(0)) break;
      const capacity = remainingOf(original);
      if (capacity.lte(0)) continue;
      const take = D.min(capacity, remaining);
      // qtyInput irisan warisan dinyatakan ulang dalam bentuk
      // masukan baris asalnya (pecahan kemasan mungkin — mis. 30 Pcs
      // dari baris 1 Dus = 0,75 Dus; angka dasarnya yang otoritatif).
      pushSlice(original, take.div(d(original.isiSnapshot)), take);
      remaining = remaining.minus(take);
    }
  }

  // Gabungkan irisan-irisan satu baris asal (bertumpuk dari jalur
  // bertarget & warisan) menjadi satu baris retur per baris asal.
  const aggregatedSlices: Slice[] = [];
  {
    const byLine = new Map<string, Slice>();
    for (const slice of slices) {
      const existing = byLine.get(slice.original.id);
      if (existing) {
        existing.qty = existing.qty.plus(slice.qty);
        existing.qtyInput = existing.qtyInput.plus(slice.qtyInput);
      } else {
        byLine.set(slice.original.id, { ...slice });
      }
    }
    aggregatedSlices.push(...byLine.values());
  }

  // Pass 1 — validate every line and accumulate the money portions WITHOUT
  // writing anything, so a rejection (over-return, missing settlement
  // prerequisite below) leaves no partial document behind.
  let revenuePortion = d(0);
  let taxPortion = d(0);
  let discountPortion = d(0);
  let totalPortion = d(0);
  let costPortion = d(0);
  const computedLines: ComputedReturnLine[] = [];

  for (const slice of aggregatedSlices) {
    const original = slice.original;
    const qty = slice.qty;
    const originalQty = d(original.qty);
    const ratio = qty.div(originalQty);
    const gross = d(original.unitPrice).mul(qty);
    const discount = d(original.discountAmount).mul(ratio);
    const tax = d(original.taxAmount).mul(ratio);
    const lineTotal = d(original.lineTotal).mul(ratio);
    const cost = d(original.unitCost).mul(qty);
    // Non-stock lines never relieved inventory at checkout, so a return must
    // not put stock back nor book the Dr Inventory / Cr COGS reversal legs.
    const tracked = trackStock.get(slice.original.productId) !== false;

    revenuePortion = revenuePortion.plus(gross.minus(tax));
    taxPortion = taxPortion.plus(tax);
    discountPortion = discountPortion.plus(discount);
    totalPortion = totalPortion.plus(lineTotal);
    if (tracked) costPortion = costPortion.plus(cost);

    computedLines.push({
      saleLineId: original.id,
      productId: original.productId,
      qty,
      qtyInput: slice.qtyInput,
      original,
      lineTotal,
      cost,
      tracked,
    });
  }

  const returnTotal = totalPortion;

  // FIX-P1 (AK4-01): nilai yang wajib dikembalikan ke pelanggan adalah
  // returnTotal + porsi penyesuaian pembulatan penjualan asal — pelanggan
  // membayar total yang TERBULATKAN, jadi penyelesaian retur harus
  // mencakup porsi itu; tanpanya jurnal retur tak seimbang persis
  // sebesar porsi pembulatan dan postJournal menolak seluruh retur.
  // Porsi dihitung terhadap total SEBELUM pembulatan (Σ lineTotal asal,
  // basis yang sama dengan porsi baris lain), sehingga retur penuh
  // mereversi seluruh penyesuaian.
  const preRoundingTotal = originalLines.reduce((acc, line) => acc.plus(d(line.lineTotal)), d(0));
  const roundingPortion = preRoundingTotal.gt(0)
    ? d(sale.roundingAdjustment).mul(returnTotal.div(preRoundingTotal))
    : d(0);
  const refundDue = returnTotal.plus(roundingPortion);

  // FIX-P1 (AK2-01/AK4-03): penyelesaian atas penjualan BERPIUTANG
  // selalu memotong piutang lebih dulu sampai sisa piutang penjualan
  // itu habis; hanya kelebihannya — bagian yang benar-benar sudah
  // dibayar pelanggan — yang boleh keluar sebagai refund tunai/transfer
  // atau menjadi kredit pelanggan. Tanpa urutan ini perusahaan membayar
  // refund tunai atas utang yang belum pernah diterima uangnya, dan
  // piutang fiktif tetap tertagih penuh.
  const outstanding = D.max(d(sale.total).minus(d(sale.paidTotal)), d(0));
  const offsetPortion = D.min(refundDue, outstanding);
  const excessPortion = refundDue.minus(offsetPortion);
  return {
    computedLines, revenuePortion, taxPortion, discountPortion, costPortion,
    returnTotal, roundingPortion, refundDue, offsetPortion, excessPortion,
  };
}


/**
 * FIX-ARS Tahap 4: fase dari createSaleReturn — badan dipindah apa adanya;
 * penulisan dokumen retur dan baris-barisnya.
 */


async function insertSaleReturnDocument(
  tx: Tx,
  input: CreateSaleReturnInput,
  sale: SaleRow,
  computedLines: ComputedReturnLine[],
) {
  const number = await nextDocumentNumber(tx, input.companyId, "SALE_RETURN", input.date);
  const [ret] = await tx
    .insert(saleReturns)
    .values({
      companyId: input.companyId,
      saleId: sale.id,
      number,
      date: input.date,
      type: input.type,
      status: "posted",
      refundMethod: input.refundMethod,
      idempotencyKey: input.idempotencyKey ?? null,
      disposition: input.disposition ?? "sellable",
      reason: input.reason,
      createdBy: input.userId,
      postedAt: new Date(),
    })
    .returning({ id: saleReturns.id, number: saleReturns.number });

  const lineValues: (typeof saleReturnLines.$inferInsert)[] = computedLines.map((line) => ({
    companyId: input.companyId,
    returnId: ret.id,
    productId: line.productId,
    qty: toDb(line.qty),
    unitPrice: line.original.unitPrice,
    unitCost: line.original.unitCost,
    lineTotal: toDb(line.lineTotal),
    productName: line.original.productName,
    // S4: cuplikan diwarisi dari baris penjualan asal baris ini —
    // faktor & bentuk masukan asal, bukan master hari ini.
    saleLineId: line.saleLineId,
    packagingId: line.original.packagingId,
    qtyInput: toDb(line.qtyInput),
    isiSnapshot: line.original.isiSnapshot,
  }));
  await tx.insert(saleReturnLines).values(lineValues);
  return ret;
}

/**
 * FIX-ARS Tahap 4: fase dari createSaleReturn — badan dipindah apa adanya;
 * kembalikan barang (Pass 2) — seri kembali in_stock, batch
 * kembali ke batch asal penjualan (G8/D-7), sisanya gerakan
 * masuk sale_return.
 */


async function restoreReturnedStock(
  tx: Tx,
  input: CreateSaleReturnInput,
  origin: ReturnOrigin,
  ret: { id: string; number: string },
  computedLines: ComputedReturnLine[],
) {
  const { sale, trackBatch, returnProductIds } = origin;
  // Pass 2 — put the goods back. Batch-tracked lines restore onto the
  // batches the sale drew from (G8/D-7); planBatchRestore runs under the
  // sale-row lock taken above, so two returns cannot restore the same
  // batch slices twice.
  // S4: pemulihan stok bekerja per PRODUK (batch & seri melacak
  // gerakan penjualan per produk) — irisan-irisan satu produk dari
  // beberapa baris asal digabung lebih dulu; unitCost per satuan
  // dasar satu penjualan satu produk selalu sama (satu quote).
  const restoreLines: { productId: string; qty: Decimal; original: SaleLineRow; tracked: boolean }[] = [];
  {
    const byProduct = new Map<string, (typeof restoreLines)[number]>();
    for (const line of computedLines) {
      const existing = byProduct.get(line.productId);
      if (existing) existing.qty = existing.qty.plus(line.qty);
      else {
        const entry = {
          productId: line.productId,
          qty: line.qty,
          original: line.original,
          tracked: line.tracked,
        };
        byProduct.set(line.productId, entry);
        restoreLines.push(entry);
      }
    }
  }
  const trackSerialReturn = await serialTrackFlags(tx, input.companyId, returnProductIds, sale.id);
  for (const line of restoreLines) {
    if (!line.tracked) continue;
    if (trackSerialReturn.get(line.productId)) {
      // SIM-2 S7B-2 Batch 5: seri yang diretur (sebanyak qty retur,
      // dari seri yang keluar oleh penjualan asal) kembali in_stock.
      await restoreSerialsForSale(tx, {
        companyId: input.companyId,
        userId: input.userId,
        saleId: sale.id,
        productId: line.productId,
        warehouseId: sale.warehouseId,
        qty: line.qty,
        referenceType: "sale_return",
        referenceId: ret.id,
        referenceNumber: ret.number,
      });
    }
    if (trackBatch.get(line.productId)) {
      await restoreSaleLineBatches(tx, {
        companyId: input.companyId,
        userId: input.userId,
        warehouseId: sale.warehouseId,
        productId: line.productId,
        saleId: sale.id,
        referenceNumber: ret.number,
        qty: line.qty,
        unitCost: line.original.unitCost,
        referenceType: "sale_return",
        referenceId: ret.id,
        reason: input.reason,
        date: input.date,
      });
    } else {
      await applyStockMovement(tx, {
        companyId: input.companyId,
        warehouseId: sale.warehouseId,
        productId: line.productId,
        delta: line.qty,
        unitCost: line.original.unitCost,
        movementType: "sale_return",
        referenceType: "sale_return",
        referenceId: ret.id,
        referenceNumber: ret.number,
        reason: input.reason,
        userId: input.userId,
        allowNegative: true,
        date: input.date,
      });
    }
  }
}

/**
 * FIX-ARS Tahap 4: fase dari createSaleReturn — badan dipindah apa adanya;
 * jurnal retur — debit retur penjualan/PPN/pembulatan, kredit
 * potongan piutang & penyelesaian kelebihan per alokasi tender,
 * pembalik diskon, dan kaki persediaan/HPP.
 */


async function postSaleReturnJournal(
  tx: Tx,
  input: CreateSaleReturnInput,
  sale: SaleRow,
  ret: { id: string; number: string },
  map: Awaited<ReturnType<typeof getAccountMap>>,
  amounts: ReturnAmounts,
  settleAccount: string,
  settlementCredits: RefundSettlement["credits"],
) {
  const { revenuePortion, taxPortion, discountPortion, roundingPortion, offsetPortion, excessPortion, costPortion } = amounts;
  const settleDescription =
    input.refundMethod === "store_credit" || input.refundMethod === "exchange"
      ? "Kredit pelanggan"
      : "Pengembalian dana";
  const lines = [
    { accountId: map.sales_return, debit: revenuePortion, description: `Retur penjualan ${ret.number}` },
    ...(taxPortion.gt(0) ? [{ accountId: map.tax_output, debit: taxPortion, description: "Pembalik PPN" }] : []),
    ...(roundingPortion.gt(0)
      ? [{ accountId: map.rounding_gain, debit: roundingPortion, description: "Pembalik pembulatan" }]
      : []),
    // FIX-P1 (AK2-01/AK4-03): porsi pemotong piutang dikredit ke akun
    // piutang bertag pelanggan; hanya kelebihannya yang dikredit ke
    // akun penyelesaian metode terpilih.
    ...(offsetPortion.gt(0)
      ? [{ accountId: map.receivable, credit: offsetPortion, description: "Potong piutang penjualan", partyType: "customer", partyId: sale.customerId ?? undefined }]
      : []),
    // POS1-06: kelebihan diselesaikan per alokasi tender asal untuk
    // refund tunai (satu baris kredit per akun tujuan); metode lain
    // tetap satu baris ke akun penyelesaiannya.
    ...(excessPortion.gt(0)
      ? input.refundMethod === "cash"
        ? settlementCredits.map((s) => ({
            accountId: s.accountId,
            credit: s.amount,
            description: s.description,
            partyType: "customer",
            partyId: sale.customerId ?? undefined,
          }))
        : [{ accountId: settleAccount, credit: excessPortion, description: settleDescription, partyType: "customer", partyId: sale.customerId ?? undefined }]
      : []),
    ...(discountPortion.gt(0)
      ? [{ accountId: map.sales_discount, credit: discountPortion, description: "Pembalik diskon" }]
      : []),
    ...(roundingPortion.lt(0)
      ? [{ accountId: map.rounding_loss, credit: roundingPortion.abs(), description: "Pembalik selisih pembulatan" }]
      : []),
    ...(costPortion.gt(0)
      ? [
          { accountId: input.disposition === "write_off" ? (map.damaged ?? map.inventory_shrink) : map.inventory, debit: costPortion, description: input.disposition === "write_off" ? "Barang retur tidak layak jual — dibebankan" : "Persediaan kembali" },
          { accountId: map.cogs, credit: costPortion, description: "Pembalik HPP" },
        ]
      : []),
  ];

  const activeLines = lines.filter((l) => (l.debit && d(l.debit).gt(0)) || (l.credit && d(l.credit).gt(0)));
  if (activeLines.length === 0) {
    return null;
  }

  const returnJournal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Retur penjualan ${ret.number}`,
    sourceType: "sale_return",
    sourceId: ret.id,
    createdBy: input.userId,
    idempotencyKey: `sale_return:${ret.id}`,
    lines: activeLines,
  });
  return returnJournal;
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman (FIX-ARS Tahap 6, ARS1-01): kueri riwayat retur &
// akumulasi qty ter-retur yang dulu inline di halaman retur penjualan
// kini tinggal di modul retur; badan kueri dipindah apa adanya.
// ---------------------------------------------------------------------------

export async function listRecentSaleReturns(tx: Tx, companyId: string, limit = 20) {
  return tx
    .select({
      id: saleReturns.id,
      number: saleReturns.number,
      date: saleReturns.date,
      type: saleReturns.type,
      refundMethod: saleReturns.refundMethod,
      total: saleReturns.total,
      creditUsed: saleReturns.creditUsed,
      reason: saleReturns.reason,
      saleNumber: sql<string>`(select number from sales s where s.id = ${saleReturns.saleId})`,
    })
    .from(saleReturns)
    .where(eq(saleReturns.companyId, companyId))
    .orderBy(desc(saleReturns.createdAt))
    .limit(limit);
}

export async function getReturnedQtyByProduct(tx: Tx, companyId: string, saleId: string) {
  const rows = await tx.execute(sql`
    select srl.product_id, coalesce(sum(srl.qty), 0) as qty
    from sale_return_lines srl
    join sale_returns sr on sr.id = srl.return_id
    where sr.company_id = ${companyId} and sr.sale_id = ${saleId}
    group by srl.product_id
  `);
  return new Map(
    (rows as unknown as { product_id: string; qty: string }[]).map((row) => [
      row.product_id,
      Number(row.qty),
    ]),
  );
}

/**
 * S4: qty dasar yang sudah diretur per BARIS penjualan asal (peta
 * saleLineId → qty dasar) — halaman retur menilai sisa per baris
 * karena satu produk kini dapat mempunyai dua baris asal. Atribusi
 * baris warisan sama dengan domain retur (attributeReturnedByLine).
 */
export async function getReturnedQtyBySaleLine(tx: Tx, companyId: string, saleId: string) {
  const originalLines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(saleLines.lineNo));
  const rows = await tx
    .select({
      saleLineId: saleReturnLines.saleLineId,
      productId: saleReturnLines.productId,
      qty: saleReturnLines.qty,
    })
    .from(saleReturnLines)
    .innerJoin(saleReturns, eq(saleReturnLines.returnId, saleReturns.id))
    .where(and(eq(saleReturns.companyId, companyId), eq(saleReturns.saleId, saleId)));
  const attributed = attributeReturnedByLine(originalLines, rows);
  return new Map([...attributed.entries()].map(([id, qty]) => [id, qty.toNumber()]));
}
