/**
 * Agregat baca STOK & DOKUMEN STOK (A-26 Q5, K-04) — pecahan
 * src/server/catalog.ts: gerakan stok, riwayat penerimaan/PO/dokumen,
 * stok per produk, dan data beranda gudang.
 * Badan kueri dipindah apa adanya; mekanik paginasi kini lewat
 * lib/pagination (P-06).
 */
import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  productPackagings,
  products,
  purchaseOrders,
  stockDocumentLines,
  stockDocuments,
  stockMovements,
  stockReceiptLines,
  stockReceipts,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";
import { d, formatQty } from "@/lib/money";
import { formatCountBreakdown, type CountBreakdownComponent } from "@/lib/packaging";
import { normalizePage, normalizePageParams, pageOffset, pageResult } from "@/lib/pagination";

export async function listMovements(
  tx: Tx,
  input: {
    companyId: string;
    productId?: string;
    warehouseId?: string;
    type?: string;
    q?: string;
    /** FIX-GDG Tahap 4 (GDG2-10): saring rentang tanggal bisnis gerakan. */
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const page = normalizePage(input.page);
  // Penyimpangan historis yang DIPERTAHANKAN persis (A-26 Q5, D-05):
  // pageSize fungsi ini tidak pernah dijepit bawah (Math.max(1, …))
  // seperti situs paginasi lain — menyamakan jepitnya mengubah hasil
  // untuk pageSize ≤ 0, jadi helper bersama hanya dipakai untuk page
  // dan offset di sini.
  const pageSize = Math.min(200, input.pageSize ?? 30);
  const conditions = [eq(stockMovements.companyId, input.companyId)];
  if (input.productId) conditions.push(eq(stockMovements.productId, input.productId));
  if (input.warehouseId) conditions.push(eq(stockMovements.warehouseId, input.warehouseId));
  if (input.type) conditions.push(eq(stockMovements.movementType, input.type));
  if (input.from) conditions.push(gte(stockMovements.date, input.from));
  if (input.to) conditions.push(lte(stockMovements.date, input.to));
  const q = input.q?.trim();
  if (q) {
    // GD-P3-7: kotak "Filter dokumen…" di halaman pergerakan kini benar-benar
    // menyaring — cocokkan nama produk, SKU, atau nomor referensi dokumen.
    conditions.push(
      or(
        ilike(products.name, `%${q}%`),
        ilike(products.sku, `%${q}%`),
        ilike(stockMovements.referenceNumber, `%${q}%`),
      )!,
    );
  }
  const where = and(...conditions);

  const [totalRow] = await tx
    .select({ value: count() })
    .from(stockMovements)
    .leftJoin(products, eq(stockMovements.productId, products.id))
    .where(where);
  const rows = await tx
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      productId: stockMovements.productId,
      productName: products.name,
      sku: products.sku,
      warehouseName: warehouses.name,
      unitName: units.name,
      movementType: stockMovements.movementType,
      qty: stockMovements.qty,
      unitCost: stockMovements.unitCost,
      referenceNumber: stockMovements.referenceNumber,
      referenceId: stockMovements.referenceId,
      referenceType: stockMovements.referenceType,
      reason: stockMovements.reason,
      createdBy: stockMovements.createdBy,
    })
    .from(stockMovements)
    .leftJoin(products, eq(stockMovements.productId, products.id))
    .leftJoin(units, eq(products.unitId, units.id))
    .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
    .where(where)
    // id uuidv7 sebagai pemutus seri createdAt agar pagination stabil.
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));

  // S3: anotasi satuan MASUKAN untuk baris berkemasan — gerakan tetap
  // satuan dasar; label "2 Dus" ditempel HANYA bila gerakan ini adalah
  // seluruh baris dokumennya (qty gerakan == qty dasar baris) dan
  // baris (dokumen, produk) itu tunggal, agar irisan batch tidak
  // pernah terklaim dua kali. Rincian hitungan campuran opname
  // ditempel sebagai label hitungan (informatif, bukan qty).
  const referenceIds = [
    ...new Set(rows.map((row) => row.referenceId).filter((id): id is string => Boolean(id))),
  ];
  type InputLine = {
    packagingId: string | null;
    packagingName: string | null;
    qtyInput: string;
    qty: string;
    countBreakdown: CountBreakdownComponent[] | null;
  };
  const inputLines = new Map<string, InputLine[]>();
  if (referenceIds.length > 0) {
    const docLines = await tx
      .select({
        documentId: stockDocumentLines.documentId,
        productId: stockDocumentLines.productId,
        packagingId: stockDocumentLines.packagingId,
        packagingName: productPackagings.name,
        qtyInput: stockDocumentLines.qtyInput,
        qty: stockDocumentLines.qty,
        countBreakdown: stockDocumentLines.countBreakdown,
      })
      .from(stockDocumentLines)
      .leftJoin(productPackagings, eq(stockDocumentLines.packagingId, productPackagings.id))
      .where(
        and(
          eq(stockDocumentLines.companyId, input.companyId),
          inArray(stockDocumentLines.documentId, referenceIds),
        ),
      );
    for (const line of docLines) {
      const key = `${line.documentId}:${line.productId}`;
      const list = inputLines.get(key) ?? [];
      list.push({
        packagingId: line.packagingId,
        packagingName: line.packagingName,
        qtyInput: line.qtyInput,
        qty: line.qty,
        countBreakdown: line.countBreakdown,
      });
      inputLines.set(key, list);
    }
    const receiptLines = await tx
      .select({
        receiptId: stockReceiptLines.receiptId,
        productId: stockReceiptLines.productId,
        packagingId: stockReceiptLines.packagingId,
        packagingName: productPackagings.name,
        qtyInput: stockReceiptLines.qtyInput,
        qty: stockReceiptLines.qty,
      })
      .from(stockReceiptLines)
      .leftJoin(productPackagings, eq(stockReceiptLines.packagingId, productPackagings.id))
      .where(
        and(
          eq(stockReceiptLines.companyId, input.companyId),
          inArray(stockReceiptLines.receiptId, referenceIds),
        ),
      );
    for (const line of receiptLines) {
      const key = `${line.receiptId}:${line.productId}`;
      const list = inputLines.get(key) ?? [];
      list.push({
        packagingId: line.packagingId,
        packagingName: line.packagingName,
        qtyInput: line.qtyInput,
        qty: line.qty,
        countBreakdown: null,
      });
      inputLines.set(key, list);
    }
  }
  const enriched = rows.map((row) => {
    let packagingInputLabel: string | null = null;
    let countBreakdownLabel: string | null = null;
    if (row.referenceId) {
      const candidates = inputLines.get(`${row.referenceId}:${row.productId}`) ?? [];
      if (candidates.length === 1) {
        const line = candidates[0];
        if (
          line.packagingId &&
          line.packagingName &&
          d(row.qty).abs().eq(d(line.qty).abs())
        ) {
          packagingInputLabel = `${formatQty(line.qtyInput)} ${line.packagingName}`;
        }
        if (line.countBreakdown && line.countBreakdown.length > 0) {
          countBreakdownLabel = formatCountBreakdown(line.countBreakdown);
        }
      }
    }
    return { ...row, packagingInputLabel, countBreakdownLabel };
  });

  return pageResult(enriched, totalRow?.value ?? 0, page, pageSize);
}

/**
 * Riwayat penerimaan barang terpaginasi (GD-P3-6) — dipakai halaman
 * penerimaan; dulu query-nya inline di halaman dengan limit tetap 40
 * sehingga dokumen lama tidak terjangkau.
 */
export async function listReceiptHistory(
  tx: Tx,
  input: {
    companyId: string;
    page?: number;
    pageSize?: number;
    q?: string;
    from?: string;
    to?: string;
    supplierId?: string;
    warehouseId?: string;
    status?: string;
    source?: string;
  },
) {
  const { page, pageSize } = normalizePageParams(input, 40);
  // FIX-GDG Tahap 4 (GDG2-06): pencarian nomor dokumen / no. invoice
  // pemasok / nama pemasok — sebelumnya daftar ini hanya berpaginasi.
  const q = input.q?.trim();
  const where = and(
    eq(stockReceipts.companyId, input.companyId),
    input.from ? gte(stockReceipts.date, input.from) : undefined,
    input.to ? lte(stockReceipts.date, input.to) : undefined,
    input.supplierId ? eq(stockReceipts.supplierId, input.supplierId) : undefined,
    input.warehouseId ? eq(stockReceipts.warehouseId, input.warehouseId) : undefined,
    input.status ? eq(stockReceipts.status, input.status) : undefined,
    input.source ? eq(stockReceipts.source, input.source) : undefined,
    q
      ? or(
          ilike(stockReceipts.number, `%${q}%`),
          ilike(stockReceipts.supplierInvoiceNumber, `%${q}%`),
          ilike(suppliers.name, `%${q}%`),
        )
      : undefined,
  );

  const [totalRow] = await tx
    .select({ value: count() })
    .from(stockReceipts)
    .leftJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .where(where);
  const rows = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      date: stockReceipts.date,
      total: stockReceipts.total,
      paidAmount: stockReceipts.paidAmount,
      paymentStatus: stockReceipts.paymentStatus,
      status: stockReceipts.status,
      source: stockReceipts.source,
      paymentAccountId: stockReceipts.paymentAccountId,
      supplierInvoiceNumber: stockReceipts.supplierInvoiceNumber,
      notes: stockReceipts.notes,
      supplierName: suppliers.name,
      warehouseName: warehouses.name,
      itemCount: sql<string>`(select coalesce(sum(srl.qty), 0) from stock_receipt_lines srl where srl.receipt_id = ${stockReceipts.id})`,
    })
    .from(stockReceipts)
    .leftJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .leftJoin(warehouses, eq(stockReceipts.warehouseId, warehouses.id))
    .where(where)
    .orderBy(desc(stockReceipts.createdAt), desc(stockReceipts.id))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));

  return pageResult(rows, totalRow?.value ?? 0, page, pageSize);
}

/**
 * Riwayat pesanan pembelian (PO) terpaginasi (G7/D-6) — pola yang sama
 * dengan listReceiptHistory, ditambah total qty dipesan/diterima agar
 * progres penerimaan terbaca langsung dari daftar.
 */
export async function listPurchaseOrderHistory(
  tx: Tx,
  input: {
    companyId: string;
    page?: number;
    pageSize?: number;
    q?: string;
    status?: string;
    supplierId?: string;
    from?: string;
    to?: string;
  },
) {
  const { page, pageSize } = normalizePageParams(input, 40);
  // FIX-GDG Tahap 4 (GDG2-06): pencarian nomor PO / nama pemasok.
  const q = input.q?.trim();
  const where = and(
    eq(purchaseOrders.companyId, input.companyId),
    input.status ? eq(purchaseOrders.status, input.status) : undefined,
    input.supplierId ? eq(purchaseOrders.supplierId, input.supplierId) : undefined,
    input.from ? gte(purchaseOrders.date, input.from) : undefined,
    input.to ? lte(purchaseOrders.date, input.to) : undefined,
    q
      ? or(ilike(purchaseOrders.number, `%${q}%`), ilike(suppliers.name, `%${q}%`))
      : undefined,
  );

  const [totalRow] = await tx
    .select({ value: count() })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(where);
  const rows = await tx
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      date: purchaseOrders.date,
      expectedDate: purchaseOrders.expectedDate,
      status: purchaseOrders.status,
      total: purchaseOrders.total,
      supplierName: suppliers.name,
      orderedQty: sql<string>`(select coalesce(sum(pol.qty), 0) from purchase_order_lines pol where pol.order_id = ${purchaseOrders.id})`,
      receivedQty: sql<string>`(select coalesce(sum(pol.received_qty), 0) from purchase_order_lines pol where pol.order_id = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));

  return pageResult(rows, totalRow?.value ?? 0, page, pageSize);
}

/**
 * Riwayat dokumen stok terpaginasi (GD-P3-6) untuk keluarga dokumen di
 * `stock_documents` — halaman penyesuaian, transfer, dan opname memakai
 * fungsi yang sama dengan daftar `types` masing-masing. Dulu tiap halaman
 * memakai limit tetap (40/40/30) tanpa pagination.
 */
export async function listDocumentHistory(
  tx: Tx,
  input: {
    companyId: string;
    types: string[];
    page?: number;
    pageSize?: number;
    q?: string;
    /** Filter status dokumen — alasan kerja (Fiori list report). */
    status?: string;
    warehouseId?: string;
    from?: string;
    to?: string;
  },
) {
  const { page, pageSize } = normalizePageParams(input, 40);
  // FIX-GDG Tahap 4 (GDG2-06): pencarian nomor dokumen / catatan.
  const q = input.q?.trim();
  const where = and(
    eq(stockDocuments.companyId, input.companyId),
    inArray(stockDocuments.type, input.types),
    input.status ? eq(stockDocuments.status, input.status) : undefined,
    input.warehouseId ? eq(stockDocuments.warehouseId, input.warehouseId) : undefined,
    input.from ? gte(stockDocuments.date, input.from) : undefined,
    input.to ? lte(stockDocuments.date, input.to) : undefined,
    q
      ? or(ilike(stockDocuments.number, `%${q}%`), ilike(stockDocuments.notes, `%${q}%`))
      : undefined,
  );

  const [totalRow] = await tx.select({ value: count() }).from(stockDocuments).where(where);
  const rows = await tx
    .select({
      id: stockDocuments.id,
      type: stockDocuments.type,
      number: stockDocuments.number,
      date: stockDocuments.date,
      reason: stockDocuments.reason,
      notes: stockDocuments.notes,
      refundMethod: stockDocuments.refundMethod,
      total: stockDocuments.total,
      status: stockDocuments.status,
      createdBy: stockDocuments.createdBy,
      approvedBy: stockDocuments.approvedBy,
      rejectionReason: stockDocuments.rejectionReason,
      warehouseName: warehouses.name,
      toWarehouseName: sql<string>`(select name from warehouses w where w.id = ${stockDocuments.toWarehouseId})`,
      supplierName: suppliers.name,
      itemCount: sql<string>`(select count(*) from stock_document_lines sdl where sdl.document_id = ${stockDocuments.id})`,
      totalQty: sql<string>`(select coalesce(sum(abs(sdl.qty)), 0) from stock_document_lines sdl where sdl.document_id = ${stockDocuments.id})`,
    })
    .from(stockDocuments)
    .leftJoin(warehouses, eq(stockDocuments.warehouseId, warehouses.id))
    .leftJoin(suppliers, eq(stockDocuments.supplierId, suppliers.id))
    .where(where)
    .orderBy(desc(stockDocuments.createdAt), desc(stockDocuments.id))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));

  return pageResult(rows, totalRow?.value ?? 0, page, pageSize);
}

export async function stockByProduct(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  ids: string[],
) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await tx.execute(sql`
    select product_id, qty from stock_on_hand
    where company_id = ${companyId} and warehouse_id = ${warehouseId}
      and product_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  return new Map(
    (rows as unknown as { product_id: string; qty: string }[]).map((r) => [r.product_id, d(r.qty).toNumber()]),
  );
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman (FIX-ARS Tahap 6, ARS1-01): kueri yang dulu inline di
// halaman gudang kini tinggal di modul pemilik konteksnya; badan kueri
// dipindah apa adanya — urutan, batas, dan bentuk baris tidak berubah.
// ---------------------------------------------------------------------------

export async function getWarehouseDashboardData(tx: Tx, companyId: string) {
  const [productCountRows, lowCountRows, receipts, docs, movements, warehouseRows] =
    await Promise.all([
      tx
        .select({ value: count() })
        .from(products)
        .where(and(eq(products.companyId, companyId), eq(products.isActive, true))),
      tx
        .select({ value: count() })
        .from(products)
        .where(
          and(
            eq(products.companyId, companyId),
            eq(products.isActive, true),
            sql`coalesce((select sum(soh.qty) from stock_on_hand soh where soh.company_id = ${companyId} and soh.product_id = ${products.id}), 0) <= ${products.minStock}`,
          ),
        ),
      tx
        .select({
          id: stockReceipts.id,
          number: stockReceipts.number,
          date: stockReceipts.date,
          total: stockReceipts.total,
          paymentStatus: stockReceipts.paymentStatus,
        })
        .from(stockReceipts)
        .where(eq(stockReceipts.companyId, companyId))
        .orderBy(desc(stockReceipts.createdAt))
        .limit(5),
      tx
        .select({
          id: stockDocuments.id,
          type: stockDocuments.type,
          number: stockDocuments.number,
          date: stockDocuments.date,
          total: stockDocuments.total,
        })
        .from(stockDocuments)
        .where(eq(stockDocuments.companyId, companyId))
        .orderBy(desc(stockDocuments.createdAt))
        .limit(5),
      tx
        .select({
          id: stockMovements.id,
          createdAt: stockMovements.createdAt,
          productName: products.name,
          sku: products.sku,
          warehouseName: warehouses.name,
          movementType: stockMovements.movementType,
          qty: stockMovements.qty,
          unitCost: stockMovements.unitCost,
          referenceNumber: stockMovements.referenceNumber,
          // A-28 UI-4 (UX-C03): id + tipe referensi ikut dibaca agar
          // beranda dapat menautkan nomor ke dokumen asalnya lewat
          // movementReferenceHref dan mengelompokkan per dokumen —
          // pola yang sama dengan daftar Pergerakan stok.
          referenceId: stockMovements.referenceId,
          referenceType: stockMovements.referenceType,
        })
        .from(stockMovements)
        .leftJoin(products, eq(stockMovements.productId, products.id))
        .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
        .where(eq(stockMovements.companyId, companyId))
        .orderBy(desc(stockMovements.createdAt))
        .limit(8),
      tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, companyId), eq(warehouses.isActive, true))),
    ]);
  return {
    productCount: productCountRows[0]?.value ?? 0,
    lowCount: lowCountRows[0]?.value ?? 0,
    receipts,
    docs,
    movements,
    warehouses: warehouseRows,
  };
}
