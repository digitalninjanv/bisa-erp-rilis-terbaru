// FIX-ARS Tahap 4 pola: bagian dari modul inventory — model baca
// Mode Operasi gudang (A-24 T3, pola G1). Antrean operasi adalah
// LAPISAN PRESENTASI di atas dokumen & domain yang sudah ada:
// penerimaan dari PO terbuka, transfer dua tahap yang menunggu
// diterima, dan tugas opname terbuka. Tidak ada status baru yang
// dikenalkan ke dokumen mana pun oleh fungsi baca ini.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  purchaseOrderLines,
  purchaseOrders,
  stockDocumentLines,
  stockDocuments,
  suppliers,
  warehouses,
} from "@/db/schema";
import { d, formatQty } from "@/lib/money";
import { listOpnameTasks } from "./opname-tasks";

export type OperationQueueCard = {
  kind: "purchase_order" | "transfer" | "opname_task";
  id: string;
  /** Nomor dokumen persis seperti tercetak ("" untuk tugas opname —
   *  tugas tidak punya nomor tercetak dan tidak dibuka lewat pindaian). */
  number: string;
  title: string;
  detail: string;
  href: string;
  productIds: string[];
  /** Tugas opname milik pengguna yang sedang masuk. */
  mine: boolean;
  dueDate: string | null;
};

export type OperationQueue = {
  myTasks: OperationQueueCard[];
  queue: OperationQueueCard[];
};

export async function getOperationQueue(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<OperationQueue> {
  const queue: OperationQueueCard[] = [];
  const myTasks: OperationQueueCard[] = [];

  // --- Penerimaan menunggu: PO terkirim/sebagian dengan sisa baris ---
  const openOrders = await tx
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      date: purchaseOrders.date,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        inArray(purchaseOrders.status, ["sent", "partial"]),
      ),
    )
    .orderBy(asc(purchaseOrders.date), asc(purchaseOrders.number));

  if (openOrders.length > 0) {
    const orderIds = openOrders.map((order) => order.id);
    const lines = await tx
      .select({
        orderId: purchaseOrderLines.orderId,
        productId: purchaseOrderLines.productId,
        qty: purchaseOrderLines.qty,
        receivedQty: purchaseOrderLines.receivedQty,
      })
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.companyId, companyId),
          inArray(purchaseOrderLines.orderId, orderIds),
        ),
      );
    const linesByOrder = new Map<string, typeof lines>();
    for (const line of lines) {
      const bucket = linesByOrder.get(line.orderId) ?? [];
      bucket.push(line);
      linesByOrder.set(line.orderId, bucket);
    }
    for (const order of openOrders) {
      const remaining = (linesByOrder.get(order.id) ?? [])
        .map((line) => ({ productId: line.productId, remaining: d(line.qty).minus(d(line.receivedQty)) }))
        .filter((line) => line.remaining.gt(0));
      if (remaining.length === 0) continue;
      const totalRemaining = remaining.reduce((acc, line) => acc.plus(line.remaining), d(0));
      queue.push({
        kind: "purchase_order",
        id: order.id,
        number: order.number,
        title: `Penerimaan — ${order.number}`,
        detail: `${order.supplierName} · ${remaining.length} produk · sisa ${formatQty(totalRemaining)} unit belum diterima`,
        href: `/app/gudang/penerimaan?po=${order.id}`,
        productIds: remaining.map((line) => line.productId),
        mine: false,
        dueDate: null,
      });
    }
  }

  // --- Transfer menunggu diterima di gudang tujuan ---
  const inTransit = await tx
    .select({
      id: stockDocuments.id,
      number: stockDocuments.number,
      date: stockDocuments.date,
      fromName: warehouses.name,
    })
    .from(stockDocuments)
    .leftJoin(warehouses, eq(stockDocuments.warehouseId, warehouses.id))
    .where(
      and(
        eq(stockDocuments.companyId, companyId),
        eq(stockDocuments.type, "transfer"),
        eq(stockDocuments.status, "in_transit"),
      ),
    )
    .orderBy(asc(stockDocuments.date), asc(stockDocuments.number));

  if (inTransit.length > 0) {
    const docIds = inTransit.map((doc) => doc.id);
    const lines = await tx
      .select({
        documentId: stockDocumentLines.documentId,
        productId: stockDocumentLines.productId,
        qty: stockDocumentLines.qty,
        receivedQty: stockDocumentLines.receivedQty,
      })
      .from(stockDocumentLines)
      .where(
        and(
          eq(stockDocumentLines.companyId, companyId),
          inArray(stockDocumentLines.documentId, docIds),
        ),
      );
    const linesByDoc = new Map<string, typeof lines>();
    for (const line of lines) {
      const bucket = linesByDoc.get(line.documentId) ?? [];
      bucket.push(line);
      linesByDoc.set(line.documentId, bucket);
    }
    // Nama gudang tujuan dibaca terpisah (satu tabel, tanpa join ganda
    // pada kueri utama) dari baris dokumennya sendiri.
    const docs = await tx
      .select({ id: stockDocuments.id, toWarehouseId: stockDocuments.toWarehouseId })
      .from(stockDocuments)
      .where(and(eq(stockDocuments.companyId, companyId), inArray(stockDocuments.id, docIds)));
    const toIds = docs.map((doc) => doc.toWarehouseId).filter((id): id is string => Boolean(id));
    const toNames = toIds.length
      ? await tx
          .select({ id: warehouses.id, name: warehouses.name })
          .from(warehouses)
          .where(and(eq(warehouses.companyId, companyId), inArray(warehouses.id, toIds)))
      : [];
    const toNameById = new Map(toNames.map((row) => [row.id, row.name]));
    const toIdByDoc = new Map(docs.map((doc) => [doc.id, doc.toWarehouseId]));

    for (const doc of inTransit) {
      const remaining = (linesByDoc.get(doc.id) ?? [])
        .map((line) => ({ productId: line.productId, remaining: d(line.qty).minus(d(line.receivedQty)) }))
        .filter((line) => line.remaining.gt(0));
      if (remaining.length === 0) continue;
      const totalRemaining = remaining.reduce((acc, line) => acc.plus(line.remaining), d(0));
      const toName = toNameById.get(toIdByDoc.get(doc.id) ?? "") ?? "gudang tujuan";
      queue.push({
        kind: "transfer",
        id: doc.id,
        number: doc.number,
        title: `Terima transfer — ${doc.number}`,
        detail: `Dari ${doc.fromName ?? "gudang asal"} ke ${toName} · ${remaining.length} produk · sisa ${formatQty(totalRemaining)} unit dalam perjalanan`,
        href: `/app/gudang/dokumen/${doc.id}`,
        productIds: remaining.map((line) => line.productId),
        mine: false,
        dueDate: null,
      });
    }
  }

  // --- Tugas opname terbuka (milikku dipisah sebagai "tugas saya") ---
  const openTasks = await listOpnameTasks(tx, companyId, { status: "open" });
  for (const task of openTasks) {
    const scope = task.categoryName ? `${task.warehouseName} · ${task.categoryName}` : task.warehouseName;
    const card: OperationQueueCard = {
      kind: "opname_task",
      id: task.id,
      number: "",
      title: `Opname — ${scope}`,
      detail: `Ditugaskan ke ${task.assigneeName}${task.dueDate ? ` · target ${task.dueDate}` : ""}${task.notes ? ` · ${task.notes}` : ""}`,
      href: "/app/gudang/opname",
      productIds: [],
      mine: task.assigneeId === userId,
      dueDate: task.dueDate,
    };
    if (card.mine) myTasks.push(card);
    else queue.push(card);
  }

  return { myTasks, queue };
}
