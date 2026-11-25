import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  customers,
  importJobs,
  importRows,
  partyOpeningBalances,
  products,
  stockMovements,
  stockOnHand,
  stockReceiptLines,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { createMigrationOpeningReceipt, createReceipt, recomputeCostFromLedger } from "@/server/inventory";
import { createOpeningBalance } from "@/server/opening-balances";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { mapOpeningStockRow, type MappedOpeningStock, type MappedOpeningBalance } from "@/lib/import-parse";
import { mapMasterRow } from "./masters";
import type { MasterCommitResult } from "./commit";
import { finalizeJob, markRow, type JobRow, type Mapping, type RowData } from "./shared";

/**
 * A-26 Q6 (K-10): commit saldo awal hasil impor (pecahan
 * src/server/import-masters.ts) — stok awal digabung menjadi satu
 * dokumen penerimaan; saldo awal hutang/piutang menjadi satu
 * dokumen per baris. Deteksi duplikat antar-job (T4R-5) tinggal di
 * sini bersama kedua commitnya.
 */

/**
 * Kunci identitas dokumen saldo awal untuk deteksi duplikat antar-job
 * (T4R-5): referensi adalah identitas dokumen bila terisi; tanpa
 * referensi, kombinasi pihak + nominal + tanggal yang dipakai.
 */
export function openingBalanceKey(
  partyId: string,
  reference: string | null,
  amount: string | number,
  date: string,
): string {
  const ref = reference?.trim().toLowerCase();
  return ref ? `ref|${partyId}|${ref}` : `amt|${partyId}|${d(amount).toFixed(4)}|${date}`;
}

const openingKey = (productId: string, warehouseId: string) => `${productId}|${warehouseId}`;

export async function loadOpeningStockContext(
  tx: Tx,
  companyId: string,
  rows: readonly MappedOpeningStock[],
  warehouseId?: string,
  lockProducts = false,
) {
  const skuKeys = [...new Set(rows.flatMap((row) => row.sku ? [row.sku.toLowerCase()] : []))];
  const nameKeys = [...new Set(rows.flatMap((row) => !row.sku && row.name ? [row.name.toLowerCase()] : []))];
  const productQuery = tx
    .select({ id: products.id, sku: products.sku, name: products.name,
      trackStock: products.trackStock, trackBatch: products.trackBatch, trackSerial: products.trackSerial })
    .from(products).where(and(
      eq(products.companyId, companyId),
      or(
        sql`lower(${products.sku}) in (select jsonb_array_elements_text(${JSON.stringify(skuKeys)}::jsonb))`,
        sql`lower(${products.name}) in (select jsonb_array_elements_text(${JSON.stringify(nameKeys)}::jsonb))`,
      ),
    )).orderBy(asc(products.id));
  const productRows = await (lockProducts ? productQuery.for("update") : productQuery);
  const warehouseRows = await tx
    .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isDefault: warehouses.isDefault })
    .from(warehouses).where(eq(warehouses.companyId, companyId)).orderBy(asc(warehouses.code));
  const productIds = JSON.stringify(productRows.map((product) => product.id));
  const prior = await tx
    .selectDistinct({ productId: stockReceiptLines.productId, warehouseId: stockReceipts.warehouseId })
    .from(stockReceiptLines)
    .innerJoin(stockReceipts, and(eq(stockReceiptLines.receiptId, stockReceipts.id), eq(stockReceipts.companyId, companyId)))
    .innerJoin(importRows, and(eq(importRows.entityId, stockReceipts.id), eq(importRows.companyId, companyId), eq(importRows.status, "imported")))
    .innerJoin(importJobs, and(eq(importRows.jobId, importJobs.id), eq(importJobs.entity, "opening_stock")))
    .where(and(eq(stockReceiptLines.companyId, companyId), eq(stockReceipts.status, "posted"),
      sql`${stockReceiptLines.productId} in (select jsonb_array_elements_text(${productIds}::jsonb)::uuid)`));
  const nonPositiveSkus = new Set(rows.filter((row) => row.qty <= 0).map((row) => (row.sku ?? row.name)!.toLowerCase()));
  const checkIds = JSON.stringify(productRows.filter((product) => nonPositiveSkus.has(product.sku.toLowerCase()) || nonPositiveSkus.has(product.name.toLowerCase())).map((product) => product.id));
  const movementRows = checkIds === "[]" ? [] : await tx.selectDistinct({ productId: stockMovements.productId, warehouseId: stockMovements.warehouseId })
    .from(stockMovements)
    .leftJoin(stockReceipts, and(eq(stockReceipts.id, stockMovements.referenceId),
      eq(stockReceipts.companyId, companyId),
      inArray(stockMovements.referenceType, ["stock_receipt", "stock_receipt_void"])))
    .where(and(eq(stockMovements.companyId, companyId),
      sql`${stockMovements.productId} in (select jsonb_array_elements_text(${checkIds}::jsonb)::uuid)`,
      sql`coalesce(${stockReceipts.status}, '') <> 'void'`));
  const balances = checkIds === "[]" ? [] : await tx.select({ productId: stockOnHand.productId, warehouseId: stockOnHand.warehouseId })
    .from(stockOnHand).where(and(eq(stockOnHand.companyId, companyId), sql`${stockOnHand.qty} <> 0`,
      sql`${stockOnHand.productId} in (select jsonb_array_elements_text(${checkIds}::jsonb)::uuid)`));

  const byName = new Map<string, (typeof productRows)[number] | null>();
  for (const product of productRows) {
    const key = product.name.toLowerCase();
    byName.set(key, byName.has(key) ? null : product);
  }
  const warehouseByKey = new Map<string, (typeof warehouseRows)[number] | null>();
  for (const warehouse of warehouseRows) {
    for (const key of new Set([warehouse.name.toLowerCase(), warehouse.code.toLowerCase()])) {
      warehouseByKey.set(key, warehouseByKey.has(key) ? null : warehouse);
    }
  }
  return {
    productBySku: new Map(productRows.map((product) => [product.sku.toLowerCase(), product])),
    productByName: byName,
    warehouseByKey,
    warehouseIds: new Map(warehouseRows.map((warehouse) => [warehouse.id, warehouse])),
    fallbackWarehouseId: warehouseId ?? warehouseRows.find((warehouse) => warehouse.isDefault)?.id ?? warehouseRows[0]?.id,
    imported: new Set(prior.map((row) => openingKey(row.productId, row.warehouseId))),
    occupied: new Set([...movementRows, ...balances].map((row) => openingKey(row.productId, row.warehouseId))),
  };
}

export function resolveOpeningStockRow(
  row: MappedOpeningStock,
  context: Awaited<ReturnType<typeof loadOpeningStockContext>>,
  fallbackDate?: string,
  allowZeroCost = false,
) {
  const product = row.sku ? context.productBySku.get(row.sku.toLowerCase()) : context.productByName.get(row.name!.toLowerCase());
  if (!product) return { error: `Produk tidak ditemukan atau nama ambigu ("${row.sku ?? row.name}") — gunakan SKU yang terdaftar.`, unknownProduct: true };
  const warehouse = row.warehouse ? context.warehouseByKey.get(row.warehouse.toLowerCase())
    : context.warehouseIds.get(context.fallbackWarehouseId ?? "");
  if (!warehouse) return { error: `Gudang "${row.warehouse ?? "tujuan"}" tidak ditemukan atau ambigu.` };
  const key = openingKey(product.id, warehouse.id);
  if (context.imported.has(key)) return { skip: "Duplikat — stok awal SKU ini sudah diimpor di gudang yang sama." };
  if (!product.trackStock) return { error: "Produk non-persediaan/jasa tidak boleh menerima stok awal." };
  if (row.qty !== 0 && (product.trackBatch || product.trackSerial)) {
    return { error: "Saldo produk batch/serial memerlukan rincian batch atau nomor seri. Gunakan Penerimaan." };
  }
  // POS-IMP-02: biaya 0 tidak boleh menjadi nilai default diam-diam.
  // Stok bernilai nol hanya sah bila pengguna mencentang konfirmasi
  // eksplisit; tanpa itu, AVCO dapat menurunkan harga pokok produk ke 0.
  if (row.qty !== 0 && row.unitCost === 0 && !allowZeroCost) {
    return {
      error:
        "Biaya satuan wajib diisi untuk saldo selain nol. Isi Nilai Satuan, atau centang \"Izinkan biaya 0\" bila stok memang gratis.",
    };
  }
  if (row.qty <= 0 && context.occupied.has(key)) {
    return { error: "Saldo nol atau minus hanya dapat diimpor pada SKU/gudang tanpa saldo atau mutasi aktif." };
  }
  return { product, warehouse, key, date: row.date ?? fallbackDate ?? todayISO() };
}

export async function commitOpeningStockImport(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    job: JobRow;
    mapping: Mapping;
    warehouseId: string;
    /** Tanggal cut-off default; baris boleh menimpa lewat kolom Tanggal. */
    date?: string;
    /** Konfirmasi eksplisit untuk baris bersaldo non-nol dengan biaya 0. */
    allowZeroCost?: boolean;
    selectedRows?: number[];
  },
): Promise<MasterCommitResult> {
  const { companyId, job, mapping } = input;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"opening_stock:" + companyId}, 0))`);

  const rows = await tx
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, job.id),
        eq(importRows.status, "pending"),
        input.selectedRows?.length ? inArray(importRows.rowNumber, input.selectedRows) : sql`true`,
      ),
    )
    .orderBy(asc(importRows.rowNumber));

  if (rows.length === 0) {
    const summary = (job.summary ?? {}) as Record<string, unknown>;
    const remaining = await finalizeJob(tx, { companyId, userId: input.userId, job, imported: 0, failed: 0 });
    return {
      processed: 0,
      remaining,
      done: remaining === 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      receiptNumber: typeof summary.receiptNumber === "string" ? summary.receiptNumber : null,
    };
  }

  const mappedRows = rows.map((row) => ({ row, mapped: mapOpeningStockRow((row.data ?? {}) as RowData, mapping) }));
  const context = await loadOpeningStockContext(tx, companyId,
    mappedRows.flatMap(({ mapped }) => mapped.value ? [mapped.value] : []), input.warehouseId, true);
  const chosen = new Map<string, { date: string; sign: number }>();

  let failed = 0;
  let skipped = 0;
  type OpeningGroup = {
    warehouseId: string;
    date: string;
    requiresMigrationReceipt: boolean;
    items: Map<string, { qty: ReturnType<typeof d>; value: ReturnType<typeof d> }>;
  };
  const groups = new Map<string, OpeningGroup>();
  const validRows: { rowId: string; groupKey: string }[] = [];

  for (const { row, mapped } of mappedRows) {
    if (!mapped.value) {
      failed += 1;
      await markRow(tx, row.id, "error", mapped.error ?? "Baris tidak valid");
      continue;
    }
    const resolved = resolveOpeningStockRow(
      mapped.value,
      context,
      input.date,
      input.allowZeroCost ?? false,
    );
    if (!resolved.product) {
      if (resolved.skip) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", resolved.skip);
      } else {
        failed += 1;
        await markRow(tx, row.id, "error", resolved.error ?? "Baris tidak valid.");
      }
      continue;
    }
    const { product, warehouse, key, date } = resolved;
    const sign = Math.sign(mapped.value.qty);
    const previous = chosen.get(key);
    if (previous && (previous.date !== date || previous.sign !== sign)) {
      failed += 1;
      await markRow(tx, row.id, "error", "Saldo SKU dan gudang yang sama memiliki tanda atau tanggal cut-off berbeda.");
      continue;
    }
    chosen.set(key, { date, sign });
    const warehouseId = warehouse.id;
    const requiresMigrationReceipt = sign <= 0;
    const groupKey = `${warehouseId}|${date}|${requiresMigrationReceipt}`;
    const group: OpeningGroup =
      groups.get(groupKey) ?? { warehouseId, date, requiresMigrationReceipt, items: new Map() };
    const current = group.items.get(product.id) ?? { qty: d(0), value: d(0) };
    current.qty = current.qty.plus(mapped.value.qty);
    current.value = current.value.plus(d(mapped.value.qty).mul(mapped.value.unitCost));
    group.items.set(product.id, current);
    groups.set(groupKey, group);
    validRows.push({ rowId: row.id, groupKey });
  }

  let receiptNumber: string | null = null;
  let receiptId: string | null = null;
  let imported = 0;
  const touchedProducts = new Set<string>();
  const receiptByGroup = new Map<string, { id: string; number: string }>();
  const orderedGroups = [...groups].sort(([, left], [, right]) =>
    Number(left.requiresMigrationReceipt) - Number(right.requiresMigrationReceipt));
  for (const [groupKey, group] of orderedGroups) {
    if (group.items.size === 0) continue;
    const receiptInput = {
      companyId,
      userId: input.userId,
      warehouseId: group.warehouseId,
      date: group.date,
      notes: `Stok awal hasil impor ${job.fileName}`,
      lines: [...group.items.entries()].map(([productId, agg]) => ({
        productId,
        qty: toDb(agg.qty),
        unitCost: toDb(agg.qty.isZero() ? d(0) : agg.value.div(agg.qty)),
      })),
    };
    const receipt = group.requiresMigrationReceipt
      ? await createMigrationOpeningReceipt(tx, receiptInput)
      : await createReceipt(tx, { ...receiptInput, source: "opening" });
    if (group.requiresMigrationReceipt) {
      for (const [productId, item] of group.items) {
        if (!item.qty.isZero()) touchedProducts.add(productId);
      }
    }
    receiptByGroup.set(groupKey, { id: receipt.id, number: receipt.number });
    if (!receiptId) {
      receiptId = receipt.id;
      receiptNumber = receipt.number;
    }
  }
  for (const productId of touchedProducts) {
    await recomputeCostFromLedger(tx, companyId, productId, true);
  }
  for (const valid of validRows) {
    const receipt = receiptByGroup.get(valid.groupKey);
    if (!receipt) continue;
    imported += 1;
    await markRow(tx, valid.rowId, "imported", null, receipt.id);
  }

  const remaining = await finalizeJob(tx, {
    companyId,
    userId: input.userId,
    job,
    imported,
    failed,
    extraSummary: receiptNumber
      ? { receiptNumber, receiptId, receiptCount: receiptByGroup.size }
      : undefined,
  });
  return {
    processed: rows.length,
    remaining,
    done: remaining === 0,
    imported,
    skipped,
    failed,
    receiptNumber,
  };
}


/**
 * Commit saldo awal hutang/piutang (T4-5b): setiap baris valid menjadi
 * SATU dokumen saldo awal lewat domain opening-balances (satu jurnal
 * pembuka per dokumen). Berbeda dengan stok awal, baris-barisnya
 * independen sehingga diproses per batch seperti master lain. Pihak
 * dicocokkan dari nama ATAU kode master yang sudah ada.
 */
export async function commitOpeningBalancesImport(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    job: JobRow;
    mapping: Mapping;
    limit: number;
    selectedRows?: number[];
  },
): Promise<MasterCommitResult> {
  const { companyId, job, mapping } = input;
  const entity = job.entity as "opening_payables" | "opening_receivables";
  const kind = entity === "opening_payables" ? ("payable" as const) : ("receivable" as const);
  const partyLabel = entity === "opening_payables" ? "Pemasok" : "Pelanggan";

  const rows = await tx
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, job.id),
        eq(importRows.status, "pending"),
        input.selectedRows?.length ? inArray(importRows.rowNumber, input.selectedRows) : sql`true`,
      ),
    )
    .orderBy(asc(importRows.rowNumber))
    .limit(input.limit);

  if (rows.length === 0) {
    const remaining = await finalizeJob(tx, { companyId, userId: input.userId, job, imported: 0, failed: 0 });
    return { processed: 0, remaining, done: remaining === 0, imported: 0, skipped: 0, failed: 0 };
  }

  // Muat hanya pihak yang disebut baris batch ini (pola GD-P3-8).
  const mappedRows = rows.map((row) => ({
    row,
    mapped: mapMasterRow(entity, (row.data ?? {}) as RowData, mapping),
  }));
  const partyKeys = [
    ...new Set(
      mappedRows.flatMap(({ mapped }) =>
        mapped.value &&
        (mapped.value.kind === "opening_payables" || mapped.value.kind === "opening_receivables")
          ? [mapped.value.value.party.toLowerCase()]
          : [],
      ),
    ),
  ];
  const partyByKey = new Map<string, string>();
  if (partyKeys.length) {
    const table = entity === "opening_payables" ? suppliers : customers;
    const found = await tx
      .select({ id: table.id, name: table.name, code: table.code })
      .from(table)
      .where(
        and(
          eq(table.companyId, companyId),
          or(inArray(sql`lower(${table.name})`, partyKeys), inArray(sql`lower(${table.code})`, partyKeys)),
        ),
      );
    for (const row of found) {
      if (!partyByKey.has(row.name.toLowerCase())) partyByKey.set(row.name.toLowerCase(), row.id);
      if (!partyByKey.has(row.code.toLowerCase())) partyByKey.set(row.code.toLowerCase(), row.id);
    }
  }

  // T4R-5: kunci dokumen saldo awal yang sudah ada (job/form mana pun,
  // selama belum void) — impor berkas yang sama dua kali tidak boleh
  // menggandakan dokumen. Kunci yang dibuat batch ini dilacak terpisah
  // agar pesan duplikat-di-file tetap akurat.
  const existingDocs = await tx
    .select({
      id: partyOpeningBalances.id,
      partyId: partyOpeningBalances.partyId,
      reference: partyOpeningBalances.reference,
      amount: partyOpeningBalances.amount,
      date: partyOpeningBalances.date,
    })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.kind, kind),
        ne(partyOpeningBalances.status, "void"),
      ),
    );
  const existingDocByKey = new Map(
    existingDocs.map((doc) => [
      openingBalanceKey(doc.partyId, doc.reference, doc.amount, doc.date),
      doc.id,
    ]),
  );
  const createdKeys = new Set<string>();

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  for (const { row, mapped } of mappedRows) {
    if (!mapped.value) {
      failed += 1;
      await markRow(tx, row.id, "error", mapped.error ?? "Baris tidak valid");
      continue;
    }
    const value = mapped.value.value as MappedOpeningBalance;
    const partyId = partyByKey.get(value.party.toLowerCase());
    if (!partyId) {
      failed += 1;
      await markRow(
        tx,
        row.id,
        "error",
        `${partyLabel} "${value.party}" tidak ditemukan — buat dulu lewat menu ${partyLabel} atau impor ${partyLabel}`,
      );
      continue;
    }
    const docKey = openingBalanceKey(partyId, value.reference, value.amount, value.date);
    const existingDocId = existingDocByKey.get(docKey);
    if (existingDocId) {
      skipped += 1;
      await markRow(
        tx,
        row.id,
        "skipped",
        "Duplikat — dokumen saldo awal untuk pihak ini sudah ada",
        existingDocId,
      );
      continue;
    }
    if (createdKeys.has(docKey)) {
      failed += 1;
      await markRow(
        tx,
        row.id,
        "error",
        "Duplikat di file — dokumen saldo awal yang sama sudah dibuat dari baris sebelumnya di berkas ini",
      );
      continue;
    }
    try {
      const doc = await createOpeningBalance(tx, {
        companyId,
        userId: input.userId,
        kind,
        partyId,
        date: value.date,
        dueDate: value.dueDate,
        amount: value.amount,
        reference: value.reference,
        notes: `Saldo awal hasil impor ${job.fileName}`,
      });
      createdKeys.add(docKey);
      imported += 1;
      await markRow(tx, row.id, "imported", null, doc.id);
    } catch (error) {
      failed += 1;
      await markRow(
        tx,
        row.id,
        "error",
        error instanceof AppError ? error.message : "Baris gagal diproses.",
      );
    }
  }

  const remaining = await finalizeJob(tx, { companyId, userId: input.userId, job, imported, failed });
  return { processed: rows.length, remaining, done: remaining === 0, imported, skipped, failed };
}

