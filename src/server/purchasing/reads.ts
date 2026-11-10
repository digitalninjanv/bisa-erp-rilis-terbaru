/**
 * Fungsi baca halaman PO (FIX-ARS Tahap 6, ARS1-01): kueri detail/cetak
 * PO yang dulu inline di halaman; badan kueri dipindah apa adanya —
 * urutan dan bentuk baris tidak berubah. Berkas ini diekstrak dari
 * server/purchasing.ts pada Satuan Kemasan S2 mengikuti pola A-26
 * (berkas asal menembus ratchet 800 baris); purchasing.ts me-re-export
 * fungsi-fungsi ini agar jalur impor publiknya tidak berubah.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  productPackagings,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockReceipts,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";

async function listPurchaseOrderLines(tx: Tx, companyId: string, orderId: string) {
  return tx
    .select({
      id: purchaseOrderLines.id,
      // REM-02: tampilkan snapshot nama/SKU baris; master hanya fallback
      // untuk baris lama yang snapshotnya belum terisi.
      productName: sql<string>`coalesce(${purchaseOrderLines.productName}, ${products.name})`,
      sku: sql<string | null>`coalesce(${purchaseOrderLines.productSku}, ${products.sku})`,
      unitName: units.name,
      qty: purchaseOrderLines.qty,
      receivedQty: purchaseOrderLines.receivedQty,
      unitCost: purchaseOrderLines.unitCost,
      lineTotal: purchaseOrderLines.lineTotal,
      // S2: bentuk masukan berkemasan baris (nama kemasan diselesaikan
      // langsung; faktor & qty masukan adalah cuplikan baris).
      packagingId: purchaseOrderLines.packagingId,
      packagingName: productPackagings.name,
      qtyInput: purchaseOrderLines.qtyInput,
      isiSnapshot: purchaseOrderLines.isiSnapshot,
    })
    .from(purchaseOrderLines)
    .innerJoin(products, eq(purchaseOrderLines.productId, products.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .leftJoin(productPackagings, eq(purchaseOrderLines.packagingId, productPackagings.id))
    .where(
      and(
        eq(purchaseOrderLines.companyId, companyId),
        eq(purchaseOrderLines.orderId, orderId),
      ),
    )
    .orderBy(asc(sql`coalesce(${purchaseOrderLines.productName}, ${products.name})`));
}

export async function getPurchaseOrderDetail(tx: Tx, companyId: string, id: string) {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      date: purchaseOrders.date,
      expectedDate: purchaseOrders.expectedDate,
      status: purchaseOrders.status,
      total: purchaseOrders.total,
      notes: purchaseOrders.notes,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, id)))
    .limit(1);
  if (!order) return null;

  const lines = await listPurchaseOrderLines(tx, companyId, id);

  const receipts = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      date: stockReceipts.date,
      status: stockReceipts.status,
      total: stockReceipts.total,
      warehouseName: warehouses.name,
    })
    .from(stockReceipts)
    .leftJoin(warehouses, eq(stockReceipts.warehouseId, warehouses.id))
    .where(
      and(
        eq(stockReceipts.companyId, companyId),
        eq(stockReceipts.purchaseOrderId, id),
      ),
    )
    .orderBy(asc(stockReceipts.date), asc(stockReceipts.number));

  return { order, lines, receipts };
}

export async function getPurchaseOrderPrintData(tx: Tx, companyId: string, id: string) {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      date: purchaseOrders.date,
      expectedDate: purchaseOrders.expectedDate,
      status: purchaseOrders.status,
      total: purchaseOrders.total,
      notes: purchaseOrders.notes,
      supplierName: suppliers.name,
      supplierAddress: suppliers.address,
      supplierPhone: suppliers.phone,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, id)))
    .limit(1);
  if (!order) return null;

  const lines = await listPurchaseOrderLines(tx, companyId, id);
  return { order, lines };
}

export async function getPurchaseOrderSupplier(tx: Tx, companyId: string, id: string) {
  const [po] = await tx
    .select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, id)))
    .limit(1);
  return po ?? null;
}
