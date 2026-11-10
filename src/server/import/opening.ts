import { and, asc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  customers,
  importJobs,
  importRows,
  partyOpeningBalances,
  products,
  stockReceiptLines,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { createReceipt } from "@/server/inventory";
import { createOpeningBalance } from "@/server/opening-balances";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { mapOpeningStockRow, type MappedOpeningBalance } from "@/lib/import-parse";
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

/**
 * Produk yang sudah menerima stok awal DARI IMPOR job lain (T4R-5).
 * Penandanya adalah baris impor opening_stock berstatus "imported"
 * milik job lain — entityId baris itu adalah id penerimaan yang dibuat
 * commit-nya. Penerimaan opening manual dari UI tidak punya baris
 * impor, jadi tidak pernah menghalangi impor pertama. Penerimaan yang
 * sudah di-void juga tidak menghalangi (stoknya sudah ditarik kembali).
 */
export async function loadImportedOpeningStockProductIds(
  tx: Tx,
  companyId: string,
  excludeJobId: string,
): Promise<Set<string>> {
  const markerRows = await tx
    .select({ receiptId: importRows.entityId })
    .from(importRows)
    .innerJoin(importJobs, eq(importRows.jobId, importJobs.id))
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importJobs.entity, "opening_stock"),
        eq(importRows.status, "imported"),
        isNotNull(importRows.entityId),
        ne(importJobs.id, excludeJobId),
      ),
    );
  const receiptIds = [
    ...new Set(markerRows.map((row) => row.receiptId).filter((id): id is string => Boolean(id))),
  ];
  const productIds = new Set<string>();
  if (receiptIds.length === 0) return productIds;
  const lines = await tx
    .select({ productId: stockReceiptLines.productId })
    .from(stockReceiptLines)
    .innerJoin(stockReceipts, eq(stockReceiptLines.receiptId, stockReceipts.id))
    .where(
      and(
        eq(stockReceiptLines.companyId, companyId),
        inArray(stockReceiptLines.receiptId, receiptIds),
        eq(stockReceipts.status, "posted"),
      ),
    );
  for (const line of lines) productIds.add(line.productId);
  return productIds;
}


/**
 * Commit stok awal bersifat satu dokumen: seluruh baris pending yang
 * valid digabung menjadi SATU penerimaan sumber "opening" lewat
 * createReceipt, agar jurnal Dr Persediaan / Cr Ekuitas, gerakan stok,
 * dan batch mengikuti jalur penerimaan biasa. Baris produk yang sama
 * digabung (qty dijumlah, biaya dirata-rata tertimbang menurut nilai)
 * karena satu dokumen tidak mengulang produk non-batch.
 */
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
    selectedRows?: number[];
  },
): Promise<MasterCommitResult> {
  const { companyId, job, mapping } = input;

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

  const productRows = await tx
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      trackStock: products.trackStock,
      trackBatch: products.trackBatch,
      trackSerial: products.trackSerial,
    })
    .from(products)
    .where(eq(products.companyId, companyId));
  const productBySku = new Map(productRows.map((row) => [row.sku.toLowerCase(), row]));
  const productByName = new Map<string, (typeof productRows)[number]>();
  for (const row of productRows) {
    if (!productByName.has(row.name.toLowerCase())) productByName.set(row.name.toLowerCase(), row);
  }
  // T4R-5: produk yang stok awalnya sudah diimpor job lain dilewati —
  // commit ulang berkas yang sama tidak menggandakan stok.
  const importedProductIds = await loadImportedOpeningStockProductIds(tx, companyId, job.id);

  const warehouseRows = await tx
    .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.companyId, companyId));
  const warehouseByName = new Map(
    warehouseRows.map((row) => [row.name.toLowerCase(), row.id]),
  );
  const warehouseByCode = new Map(
    warehouseRows.map((row) => [row.code.toLowerCase(), row.id]),
  );

  let failed = 0;
  let skipped = 0;
  type OpeningGroup = {
    warehouseId: string;
    date: string;
    items: Map<string, { qty: ReturnType<typeof d>; value: ReturnType<typeof d> }>;
  };
  const groups = new Map<string, OpeningGroup>();
  const validRows: { rowId: string; groupKey: string }[] = [];

  for (const row of rows) {
    const mapped = mapOpeningStockRow((row.data ?? {}) as RowData, mapping);
    if (!mapped.value) {
      failed += 1;
      await markRow(tx, row.id, "error", mapped.error ?? "Baris tidak valid");
      continue;
    }
    const found =
      (mapped.value.sku ? productBySku.get(mapped.value.sku.toLowerCase()) : undefined) ??
      (mapped.value.name ? productByName.get(mapped.value.name.toLowerCase()) : undefined);
    if (!found) {
      failed += 1;
      await markRow(
        tx,
        row.id,
        "error",
        `Produk tidak ditemukan (SKU/nama "${mapped.value.sku ?? mapped.value.name ?? ""}") — buat produknya dulu`,
      );
      continue;
    }
    if (!found.trackStock) {
      failed += 1;
      await markRow(
        tx,
        row.id,
        "error",
        "Produk non-persediaan/jasa tidak boleh menerima stok awal — kosongkan baris ini atau ubah produk menjadi produk stok.",
      );
      continue;
    }
    if (found.trackSerial || found.trackBatch) {
      failed += 1;
      await markRow(
        tx,
        row.id,
        "error",
        found.trackSerial
          ? "Produk bernomor seri tidak dapat menerima stok awal lewat impor ini — gunakan Penerimaan dengan daftar nomor seri."
          : "Produk ber-batch tidak dapat menerima stok awal lewat impor ini — gunakan Penerimaan dengan batch/kedaluwarsa.",
      );
      continue;
    }
    if (importedProductIds.has(found.id)) {
      skipped += 1;
      await markRow(
        tx,
        row.id,
        "skipped",
        "Duplikat — produk ini sudah memiliki stok awal dari impor sebelumnya",
      );
      continue;
    }
    const warehouseId = mapped.value.warehouse
      ? (warehouseByName.get(mapped.value.warehouse.toLowerCase()) ??
        warehouseByCode.get(mapped.value.warehouse.toLowerCase()))
      : input.warehouseId;
    if (!warehouseId) {
      failed += 1;
      await markRow(
        tx,
        row.id,
        "error",
        `Gudang "${mapped.value.warehouse}" tidak ditemukan — buat gudangnya dulu atau kosongkan kolom Gudang`,
      );
      continue;
    }
    const date = mapped.value.date ?? input.date ?? todayISO();
    const groupKey = `${warehouseId}|${date}`;
    const group: OpeningGroup =
      groups.get(groupKey) ?? { warehouseId, date, items: new Map() };
    const current = group.items.get(found.id) ?? { qty: d(0), value: d(0) };
    current.qty = current.qty.plus(mapped.value.qty);
    current.value = current.value.plus(d(mapped.value.qty).mul(mapped.value.unitCost));
    group.items.set(found.id, current);
    groups.set(groupKey, group);
    validRows.push({ rowId: row.id, groupKey });
  }

  let receiptNumber: string | null = null;
  let receiptId: string | null = null;
  let imported = 0;
  const receiptByGroup = new Map<string, { id: string; number: string }>();
  for (const [groupKey, group] of groups) {
    if (group.items.size === 0) continue;
    const receipt = await createReceipt(tx, {
      companyId,
      userId: input.userId,
      warehouseId: group.warehouseId,
      source: "opening",
      date: group.date,
      notes: `Saldo awal hasil impor ${job.fileName}`,
      lines: [...group.items.entries()].map(([productId, agg]) => ({
        productId,
        qty: toDb(agg.qty),
        unitCost: toDb(agg.qty.gt(0) ? agg.value.div(agg.qty) : d(0)),
      })),
    });
    receiptByGroup.set(groupKey, { id: receipt.id, number: receipt.number });
    if (!receiptId) {
      receiptId = receipt.id;
      receiptNumber = receipt.number;
    }
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

