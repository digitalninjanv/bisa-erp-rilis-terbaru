import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  productPackagings,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockOnHand,
  suppliers,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import { costPerBaseUnit, suggestedPackagingLabel, toBaseQty } from "@/lib/packaging";
import { writeAudit } from "@/server/audit";
import { listPackagingsForProducts, resolveLinePackagings } from "@/server/catalog";
import { nextDocumentNumber } from "@/server/sequences";

/**
 * Purchase orders (G7/D-6). A PO is a commitment document: creating or
 * sending one moves no stock and posts no journal. Its only coupling to
 * the rest of the system is the goods receipt — a receipt may link to an
 * open PO of the same supplier, and posting it grows each line's
 * `receivedQty`; the PO status is always derived from its lines
 * (draft → sent → partial → received, or cancelled before any receipt).
 * This file owns the PO lifecycle and the receipt↔PO bridge so
 * `inventory.ts` only calls the two bridge functions.
 */

export const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Terkirim",
  partial: "Diterima sebagian",
  received: "Diterima penuh",
  cancelled: "Dibatalkan",
};

type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
type PurchaseOrderLineRow = typeof purchaseOrderLines.$inferSelect;

async function lockPurchaseOrder(
  tx: Tx,
  companyId: string,
  orderId: string,
): Promise<PurchaseOrderRow> {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, orderId)))
    .limit(1)
    .for("update");
  if (!order) throw new AppError("NOT_FOUND", "Pesanan pembelian tidak ditemukan.");
  return order;
}

/**
 * Lock only the PO header, without the fulfilment validation of
 * `lockPurchaseOrderForReceipt`. Used by `voidReceipt` (R-2) so the void
 * takes locks in the same order as `createReceipt` — PO header before
 * stock rows — instead of meeting the PO for the first time at release.
 */
export async function lockPurchaseOrderHeader(
  tx: Tx,
  companyId: string,
  orderId: string,
): Promise<PurchaseOrderRow> {
  return lockPurchaseOrder(tx, companyId, orderId);
}

async function listOrderLines(
  tx: Tx,
  companyId: string,
  orderId: string,
): Promise<PurchaseOrderLineRow[]> {
  return tx
    .select()
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.companyId, companyId),
        eq(purchaseOrderLines.orderId, orderId),
      ),
    )
    // No createdAt on lines; uuidv7 ids sort in insertion order.
    .orderBy(asc(purchaseOrderLines.id));
}

/**
 * Derive the fulfilment status from line progress. An order with no
 * receipts at all stays "sent" (it was necessarily sent before any receipt
 * could link to it); any receipt makes it at least "partial".
 */
function deriveFulfilmentStatus(lines: PurchaseOrderLineRow[]): string {
  const anyReceived = lines.some((line) => d(line.receivedQty).gt(0));
  if (!anyReceived) return "sent";
  const allReceived = lines.every((line) => d(line.receivedQty).gte(d(line.qty)));
  return allReceived ? "received" : "partial";
}

export async function createPurchaseOrder(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    supplierId: string;
    date: string;
    expectedDate?: string | null;
    notes?: string;
    /**
     * Baris berkemasan (Satuan Kemasan S2): bila `packagingId` terisi,
     * `qty` adalah jumlah KEMASAN dan `unitCost` harga PER KEMASAN;
     * yang disimpan & dihitung selalu satuan dasar (qty dasar =
     * qty × isi cuplikan, harga per pcs = harga kemasan ÷ isi).
     */
    lines: {
      productId: string;
      qty: string | number;
      unitCost: string | number;
      packagingId?: string | null;
    }[];
  },
) {
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Tambahkan minimal satu barang.");

  const [supplier] = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, input.companyId), eq(suppliers.id, input.supplierId)))
    .limit(1);
  if (!supplier) throw new AppError("VALIDATION", "Pemasok tidak ditemukan di perusahaan ini.");

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  if (productIds.length !== input.lines.length) {
    throw new AppError("VALIDATION", "Produk yang sama muncul lebih dari sekali.");
  }
  const found = await tx
    .select({ id: products.id, name: products.name, sku: products.sku })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
  if (found.length !== productIds.length) {
    throw new AppError("VALIDATION", "Ada produk yang tidak ditemukan.");
  }
  const productById = new Map(found.map((row) => [row.id, row]));
  for (const line of input.lines) {
    if (!d(line.qty).gt(0)) {
      throw new AppError("VALIDATION", "Jumlah pesanan harus lebih dari 0 untuk semua baris.");
    }
    if (d(line.unitCost).lt(0)) {
      throw new AppError("VALIDATION", "Harga beli tidak boleh negatif.");
    }
  }

  // S2: selesaikan kemasan per baris lalu ubah baris ke satuan dasar —
  // total, lineTotal, dan sisa penerimaan sesudah ini hanya mengenal
  // qty dasar & harga per pcs, persis seperti sebelum ada kemasan.
  const resolved = await resolveLinePackagings(tx, input.companyId, input.lines, (productId) =>
    productById.get(productId)?.name ?? "Produk",
  );
  const normalizedLines = input.lines.map((line, index) => {
    const snap = resolved[index];
    return {
      productId: line.productId,
      qtyInput: toDb(line.qty),
      qty: snap.packaging ? toBaseQty(line.qty, snap.isiSnapshot) : toDb(line.qty),
      unitCost: snap.packaging
        ? costPerBaseUnit(line.unitCost, snap.isiSnapshot)
        : toDb(line.unitCost),
      packagingId: snap.packaging?.id ?? null,
      isiSnapshot: snap.isiSnapshot,
    };
  });

  const number = await nextDocumentNumber(tx, input.companyId, "PURCHASE_ORDER", input.date);
  const total = normalizedLines.reduce((acc, l) => acc.plus(d(l.qty).mul(d(l.unitCost))), d(0));

  const [order] = await tx
    .insert(purchaseOrders)
    .values({
      companyId: input.companyId,
      number,
      supplierId: input.supplierId,
      date: input.date,
      expectedDate: input.expectedDate ?? null,
      status: "draft",
      total: toDb(total),
      notes: input.notes,
      createdBy: input.userId,
    })
    .returning({ id: purchaseOrders.id, number: purchaseOrders.number });

  await tx.insert(purchaseOrderLines).values(
    normalizedLines.map((line) => ({
      companyId: input.companyId,
      orderId: order.id,
      productId: line.productId,
      // REM-02: freeze the master's name/SKU on the line (snapshot).
      productName: productById.get(line.productId)?.name ?? null,
      productSku: productById.get(line.productId)?.sku ?? null,
      qty: line.qty,
      unitCost: line.unitCost,
      lineTotal: toDb(d(line.qty).mul(d(line.unitCost))),
      // S2: bentuk masukan asli + faktor cuplikannya.
      packagingId: line.packagingId,
      qtyInput: line.qtyInput,
      isiSnapshot: line.isiSnapshot,
    })),
  );

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase_order.create",
    entityType: "purchase_order",
    entityId: order.id,
    after: { number: order.number, supplier: supplier.name, total: toDb(total) },
  });

  return order;
}

export async function sendPurchaseOrder(
  tx: Tx,
  input: { companyId: string; userId: string; orderId: string },
) {
  const order = await lockPurchaseOrder(tx, input.companyId, input.orderId);
  if (order.status !== "draft") {
    throw new AppError(
      "INVALID_STATE",
      `Pesanan pembelian ${order.number} berstatus ${PURCHASE_ORDER_STATUS_LABELS[order.status] ?? order.status} dan tidak dapat dikirim. Hanya PO draft yang dapat dikirim.`,
    );
  }
  await tx
    .update(purchaseOrders)
    .set({ status: "sent", postedAt: new Date() })
    .where(and(eq(purchaseOrders.companyId, input.companyId), eq(purchaseOrders.id, order.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase_order.send",
    entityType: "purchase_order",
    entityId: order.id,
    after: { number: order.number },
  });
  return { id: order.id, number: order.number };
}

export async function cancelPurchaseOrder(
  tx: Tx,
  input: { companyId: string; userId: string; orderId: string },
) {
  const order = await lockPurchaseOrder(tx, input.companyId, input.orderId);
  if (order.status === "cancelled") {
    throw new AppError("INVALID_STATE", `Pesanan pembelian ${order.number} sudah dibatalkan.`);
  }
  // D-6: cancellation is only possible before any receipt exists — after
  // that, the receipts (and their journals) are the correction path.
  const lines = await listOrderLines(tx, input.companyId, order.id);
  if (lines.some((line) => d(line.receivedQty).gt(0))) {
    throw new AppError(
      "INVALID_STATE",
      `Pesanan pembelian ${order.number} sudah memiliki penerimaan barang dan tidak dapat dibatalkan. Batalkan penerimaan terkait terlebih dahulu bila penerimaan itu memang salah.`,
    );
  }
  await tx
    .update(purchaseOrders)
    .set({ status: "cancelled" })
    .where(and(eq(purchaseOrders.companyId, input.companyId), eq(purchaseOrders.id, order.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase_order.cancel",
    entityType: "purchase_order",
    entityId: order.id,
    after: { number: order.number },
  });
  return { id: order.id, number: order.number };
}

/**
 * Receipt↔PO bridge, step 1 (called by createReceipt before anything is
 * written): lock the PO and prove every receipt line fits inside it —
 * same supplier, PO open (`sent`/`partial`), every product ordered, and
 * the cumulative received qty never exceeding the ordered qty. All
 * failures are AppError VALIDATION raised after SELECTs only, so a
 * rejected receipt leaves no partial writes behind.
 */
export async function lockPurchaseOrderForReceipt(
  tx: Tx,
  input: {
    companyId: string;
    orderId: string;
    supplierId: string;
    lines: { productId: string; qty: string | number }[];
  },
): Promise<{ order: PurchaseOrderRow; orderLines: PurchaseOrderLineRow[] }> {
  const order = await lockPurchaseOrder(tx, input.companyId, input.orderId);

  if (order.supplierId !== input.supplierId) {
    throw new AppError(
      "VALIDATION",
      `Pemasok penerimaan berbeda dengan pemasok pada pesanan pembelian ${order.number}. Pilih PO milik pemasok yang sama.`,
    );
  }
  if (order.status === "draft") {
    throw new AppError(
      "VALIDATION",
      `Pesanan pembelian ${order.number} masih berstatus draft — kirim PO terlebih dahulu sebelum menerima barang terhadapnya.`,
    );
  }
  if (order.status === "received") {
    throw new AppError(
      "VALIDATION",
      `Pesanan pembelian ${order.number} sudah diterima penuh dan tidak dapat menerima penerimaan lagi.`,
    );
  }
  if (order.status === "cancelled") {
    throw new AppError(
      "VALIDATION",
      `Pesanan pembelian ${order.number} sudah dibatalkan dan tidak dapat dipakai untuk penerimaan.`,
    );
  }

  const orderLines = await listOrderLines(tx, input.companyId, order.id);
  const byProduct = new Map(orderLines.map((line) => [line.productId, line]));
  const productIds = input.lines.map((l) => l.productId);
  const productRows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
  const names = new Map(productRows.map((row) => [row.id, row.name]));

  // R-4: a receipt may carry one product on several lines (split across
  // batches), so the cap check must compare the AGGREGATED qty per
  // product against the remaining ordered qty — line-by-line checks
  // would let two individually-fitting lines overflow the PO together.
  const requestedByProduct = new Map<string, ReturnType<typeof d>>();
  for (const line of input.lines) {
    requestedByProduct.set(
      line.productId,
      (requestedByProduct.get(line.productId) ?? d(0)).plus(d(line.qty)),
    );
  }
  for (const [productId, requestedQty] of requestedByProduct) {
    const orderLine = byProduct.get(productId);
    const productName = names.get(productId) ?? "Produk";
    if (!orderLine) {
      throw new AppError(
        "VALIDATION",
        `Produk ${productName} tidak ada di pesanan pembelian ${order.number}. Tambahkan produk itu ke PO atau terima tanpa tautan PO.`,
      );
    }
    const remaining = d(orderLine.qty).minus(d(orderLine.receivedQty));
    if (requestedQty.gt(remaining)) {
      throw new AppError(
        "VALIDATION",
        `Qty penerimaan ${productName} melebihi sisa pesanan pembelian ${order.number}: sisa ${remaining.toFixed(2)}, diterima ${requestedQty.toFixed(2)}.`,
      );
    }
  }

  return { order, orderLines };
}

/**
 * Receipt↔PO bridge, step 2 (called by createReceipt after the receipt is
 * posted): grow each line's receivedQty and re-derive the PO status.
 */
export async function applyReceiptToPurchaseOrder(
  tx: Tx,
  input: {
    companyId: string;
    order: PurchaseOrderRow;
    orderLines: PurchaseOrderLineRow[];
    lines: { productId: string; qty: string | number }[];
  },
) {
  const byProduct = new Map(input.orderLines.map((line) => [line.productId, line]));
  // R-4: aggregate per product first — applying line-by-line from the
  // same snapshot would overwrite receivedQty with each batch line
  // instead of summing them.
  const receivedByProduct = new Map<string, ReturnType<typeof d>>();
  for (const line of input.lines) {
    receivedByProduct.set(
      line.productId,
      (receivedByProduct.get(line.productId) ?? d(0)).plus(d(line.qty)),
    );
  }
  const updatedLines: PurchaseOrderLineRow[] = [];
  for (const [productId, receivedDelta] of receivedByProduct) {
    const orderLine = byProduct.get(productId);
    if (!orderLine) continue;
    const receivedQty = d(orderLine.receivedQty).plus(receivedDelta);
    await tx
      .update(purchaseOrderLines)
      .set({ receivedQty: toDb(receivedQty) })
      .where(
        and(
          eq(purchaseOrderLines.companyId, input.companyId),
          eq(purchaseOrderLines.id, orderLine.id),
        ),
      );
    updatedLines.push({ ...orderLine, receivedQty: toDb(receivedQty) });
  }
  const allLines = input.orderLines.map(
    (line) => updatedLines.find((updated) => updated.id === line.id) ?? line,
  );
  await tx
    .update(purchaseOrders)
    .set({ status: deriveFulfilmentStatus(allLines) })
    .where(
      and(eq(purchaseOrders.companyId, input.companyId), eq(purchaseOrders.id, input.order.id)),
    );
}

/**
 * Receipt↔PO bridge, void counterpart (called by voidReceipt): give the
 * voided receipt's quantities back to the PO so it can be received again,
 * and re-derive the status (a fully received PO falls back to partial,
 * or to sent when nothing remains received).
 */
export async function releaseReceiptFromPurchaseOrder(
  tx: Tx,
  input: {
    companyId: string;
    orderId: string;
    lines: { productId: string; qty: string | number }[];
  },
) {
  const order = await lockPurchaseOrder(tx, input.companyId, input.orderId);
  if (order.status === "cancelled") return;
  const orderLines = await listOrderLines(tx, input.companyId, order.id);
  const byProduct = new Map(orderLines.map((line) => [line.productId, line]));
  // R-4: aggregate per product (a receipt may split one product across
  // batch lines) before touching receivedQty.
  const releasedByProduct = new Map<string, ReturnType<typeof d>>();
  for (const line of input.lines) {
    releasedByProduct.set(
      line.productId,
      (releasedByProduct.get(line.productId) ?? d(0)).plus(d(line.qty)),
    );
  }
  const productRows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.companyId, input.companyId),
        inArray(products.id, [...releasedByProduct.keys()]),
      ),
    );
  const names = new Map(productRows.map((row) => [row.id, row.name]));
  const updatedLines: PurchaseOrderLineRow[] = [];
  for (const [productId, releasedQty] of releasedByProduct) {
    const orderLine = byProduct.get(productId);
    if (!orderLine) continue;
    const receivedQty = d(orderLine.receivedQty).minus(releasedQty);
    // R-10: never clamp a negative result silently — that would hide a
    // real imbalance between the receipt ledger and the PO. Fail loudly,
    // naming the order and the product, so the mismatch is investigated.
    if (receivedQty.lt(0)) {
      throw new AppError(
        "VALIDATION",
        `Qty yang dilepas untuk ${names.get(productId) ?? "produk"} pada pesanan pembelian ${order.number} melebihi qty yang sudah diterima: sudah diterima ${d(orderLine.receivedQty).toFixed(2)}, dilepas ${releasedQty.toFixed(2)}. Data penerimaan dan PO tidak selaras — periksa riwayat dokumen terkait sebelum melanjutkan.`,
      );
    }
    await tx
      .update(purchaseOrderLines)
      .set({ receivedQty: toDb(receivedQty) })
      .where(
        and(
          eq(purchaseOrderLines.companyId, input.companyId),
          eq(purchaseOrderLines.id, orderLine.id),
        ),
      );
    updatedLines.push({ ...orderLine, receivedQty: toDb(receivedQty) });
  }
  const allLines = orderLines.map(
    (line) => updatedLines.find((updated) => updated.id === line.id) ?? line,
  );
  await tx
    .update(purchaseOrders)
    .set({ status: deriveFulfilmentStatus(allLines) })
    .where(
      and(eq(purchaseOrders.companyId, input.companyId), eq(purchaseOrders.id, order.id)),
    );
}

export type PurchaseRecommendation = {
  productId: string;
  sku: string;
  name: string;
  totalStock: string;
  minStock: string;
  suggestedQty: string;
  /** S6: petunjuk "≈ X Dus" dari kemasan bawaan beli (display-only). */
  suggestedPackaging: string | null;
  costPrice: string;
  supplierId: string | null;
  supplierName: string | null;
};

/**
 * Purchase recommendations (D-6): the canonical low-stock definition (D-4)
 * applied to the all-warehouse total — a product is listed when its total
 * stock is at or below its minimum, with the honest suggested qty of
 * max(2 × minStock − current stock, 0): restock up to twice the minimum.
 * Only rows with a positive suggestion make the list.
 */
export async function listPurchaseRecommendations(
  tx: Tx,
  companyId: string,
): Promise<PurchaseRecommendation[]> {
  const rows = await tx
    .select({
      productId: products.id,
      sku: products.sku,
      name: products.name,
      minStock: products.minStock,
      costPrice: products.costPrice,
      supplierId: products.supplierId,
      supplierName: suppliers.name,
      totalStock: sql<string>`coalesce(sum(${stockOnHand.qty}), 0)`,
    })
    .from(products)
    .leftJoin(stockOnHand, eq(stockOnHand.productId, products.id))
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(
      and(
        eq(products.companyId, companyId),
        eq(products.isActive, true),
        eq(products.trackStock, true),
      ),
    )
    .groupBy(
      products.id,
      products.sku,
      products.name,
      products.minStock,
      products.costPrice,
      products.supplierId,
      suppliers.name,
    )
    .orderBy(asc(products.name));

  const recommendations: PurchaseRecommendation[] = [];
  for (const row of rows) {
    const totalStock = d(row.totalStock);
    const minStock = d(row.minStock);
    if (!totalStock.lte(minStock)) continue;
    const suggested = d(2).mul(minStock).minus(totalStock);
    if (!suggested.gt(0)) continue;
    recommendations.push({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      totalStock: toDb(totalStock),
      minStock: toDb(minStock),
      suggestedQty: toDb(suggested),
      suggestedPackaging: null,
      costPrice: row.costPrice,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
    });
  }
  // S6: petunjuk kemasan bawaan beli per produk rekomendasi — hanya
  // kemasan AKTIF yang ditandai bawaan beli yang dipakai (kemasan
  // terbesar atau yang lain tidak ditebak).
  if (recommendations.length > 0) {
    const packagings = await listPackagingsForProducts(
      tx,
      companyId,
      recommendations.map((row) => row.productId),
    );
    for (const row of recommendations) {
      const def = (packagings.get(row.productId) ?? []).find(
        (pack) => pack.isActive && pack.isDefaultPurchase,
      );
      row.suggestedPackaging = suggestedPackagingLabel(row.suggestedQty, def ?? null);
    }
  }
  return recommendations;
}

/**
 * Turn selected recommendations into draft POs, one per primary supplier
 * (D-6). Products without a primary supplier cannot be ordered yet and
 * are returned as `skipped` so the UI can say so instead of silently
 * dropping them.
 */
export async function createPurchaseOrdersFromRecommendations(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    date: string;
    productIds: string[];
  },
): Promise<{
  orders: { id: string; number: string; supplierId: string; supplierName: string | null }[];
  skipped: { productId: string; sku: string; name: string }[];
  noLongerLow: { productId: string; sku: string; name: string }[];
}> {
  if (input.productIds.length === 0) {
    throw new AppError("VALIDATION", "Pilih minimal satu produk untuk dibuatkan PO.");
  }
  const wanted = new Set(input.productIds);
  const recommendations = (await listPurchaseRecommendations(tx, input.companyId)).filter((row) =>
    wanted.has(row.productId),
  );
  // R-11: a selected product that dropped out of the recommendation
  // list because its stock recovered is reported in its own category
  // instead of failing the whole request (or vanishing silently).
  const stillLowIds = new Set(recommendations.map((row) => row.productId));
  const missingIds = input.productIds.filter((id) => !stillLowIds.has(id));
  let noLongerLow: { productId: string; sku: string; name: string }[] = [];
  if (missingIds.length > 0) {
    const rows = await tx
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(and(eq(products.companyId, input.companyId), inArray(products.id, missingIds)));
    noLongerLow = rows.map((row) => ({ productId: row.id, sku: row.sku, name: row.name }));
  }
  if (recommendations.length === 0 && noLongerLow.length === 0) {
    throw new AppError(
      "VALIDATION",
      "Tidak ada produk terpilih yang masih menipis saat ini — muat ulang rekomendasi terlebih dahulu.",
    );
  }

  const skipped = recommendations
    .filter((row) => !row.supplierId)
    .map((row) => ({ productId: row.productId, sku: row.sku, name: row.name }));

  const bySupplier = new Map<string, PurchaseRecommendation[]>();
  for (const row of recommendations) {
    if (!row.supplierId) continue;
    const group = bySupplier.get(row.supplierId) ?? [];
    group.push(row);
    bySupplier.set(row.supplierId, group);
  }

  const orders: { id: string; number: string; supplierId: string; supplierName: string | null }[] = [];
  for (const [supplierId, group] of bySupplier) {
    const created = await createPurchaseOrder(tx, {
      companyId: input.companyId,
      userId: input.userId,
      supplierId,
      date: input.date,
      notes: "Dibuat dari rekomendasi pembelian (target stok 2× stok minimum).",
      lines: group.map((row) => ({
        productId: row.productId,
        qty: row.suggestedQty,
        unitCost: row.costPrice,
      })),
    });
    orders.push({
      id: created.id,
      number: created.number,
      supplierId,
      supplierName: group[0].supplierName,
    });
  }

  return { orders, skipped, noLongerLow };
}

/**
 * Open POs of one supplier with their remaining lines — the receipt form's
 * PO picker (only `sent`/`partial` orders can still receive goods).
 */
export async function listOpenPurchaseOrdersForSupplier(
  tx: Tx,
  companyId: string,
  supplierId: string,
) {
  const orders = await tx
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      date: purchaseOrders.date,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        eq(purchaseOrders.supplierId, supplierId),
        inArray(purchaseOrders.status, ["sent", "partial"]),
      ),
    )
    .orderBy(asc(purchaseOrders.date), asc(purchaseOrders.number));

  const result = [];
  for (const order of orders) {
    const lines = await tx
      .select({
        productId: purchaseOrderLines.productId,
        // REM-02: snapshot nama/SKU baris PO, fallback nama master.
        productName: sql<string>`coalesce(${purchaseOrderLines.productName}, ${products.name})`,
        sku: sql<string | null>`coalesce(${purchaseOrderLines.productSku}, ${products.sku})`,
        // G8: the receipt form needs the flag to render batch inputs for
        // PO-prefilled lines of batch-tracked products.
        trackBatch: products.trackBatch,
        trackSerial: products.trackSerial,
        qty: purchaseOrderLines.qty,
        receivedQty: purchaseOrderLines.receivedQty,
        unitCost: purchaseOrderLines.unitCost,
        // S2: cuplikan kemasan baris PO — form penerimaan mengisi awal
        // dalam kemasan yang sama (sisa dinyatakan ulang per kemasan).
        packagingId: purchaseOrderLines.packagingId,
        packagingName: productPackagings.name,
        qtyInput: purchaseOrderLines.qtyInput,
        isiSnapshot: purchaseOrderLines.isiSnapshot,
      })
      .from(purchaseOrderLines)
      .innerJoin(products, eq(purchaseOrderLines.productId, products.id))
      .leftJoin(productPackagings, eq(purchaseOrderLines.packagingId, productPackagings.id))
      .where(
        and(
          eq(purchaseOrderLines.companyId, companyId),
          eq(purchaseOrderLines.orderId, order.id),
        ),
      )
      .orderBy(asc(sql`coalesce(${purchaseOrderLines.productName}, ${products.name})`));
    // S2: opsi kemasan aktif per produk untuk pemilih di form
    // penerimaan (baris PO tanpa kemasan pun boleh diterima berkemasan).
    const packagingsByProduct = await listPackagingsForProducts(
      tx,
      companyId,
      lines.map((line) => line.productId),
    );
    const remainingLines = lines
      .map((line) => {
        const remainingQty = d(line.qty).minus(d(line.receivedQty));
        return {
          ...line,
          remainingQty: toDb(remainingQty),
          packagings: (packagingsByProduct.get(line.productId) ?? []).filter((p) => p.isActive),
          // Sisa dalam kemasan baris PO & harga per kemasannya, untuk
          // isian awal form; null bila baris PO satuan dasar.
          remainingInputQty: line.packagingId
            ? toDb(remainingQty.div(d(line.isiSnapshot)))
            : null,
          packagingUnitCost: line.packagingId
            ? toDb(d(line.unitCost).mul(d(line.isiSnapshot)))
            : null,
        };
      })
      .filter((line) => d(line.remainingQty).gt(0));
    if (remainingLines.length > 0) {
      result.push({ ...order, lines: remainingLines });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman PO (detail/cetak/pemasok) tinggal di
// purchasing/reads.ts — diekstrak pada S2 mengikuti pola A-26 karena
// berkas ini menembus ratchet ukuran; di-re-export agar jalur impor
// publik "@/server/purchasing" tidak berubah.
// ---------------------------------------------------------------------------
export {
  getPurchaseOrderDetail,
  getPurchaseOrderPrintData,
  getPurchaseOrderSupplier,
} from "./purchasing/reads";
