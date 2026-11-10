// A-24 Tahap T4B: bagian dari pemecahan src/server/supplier-returns.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/supplier-returns.ts.
// A-26 Q8: posting & void berpindah ke posting.ts, plafon asal-usul
// ke provenance.ts; berkas ini menyisakan pembuatan & penghapusan draf.

import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockBatches,
  stockReceiptLines,
  stockReceipts,
  supplierReturns,
  supplierReturnLines,
  suppliers,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type Decimal, type MoneyInput } from "@/lib/money";
import { toBaseQty } from "@/lib/packaging";
import { writeAudit } from "@/server/audit";
import { resolveLinePackagings } from "@/server/catalog";
import { claimIdempotencyKey } from "@/server/idempotency";
import { nextDocumentNumber } from "@/server/sequences";
import { assertReturnWithinProvenance } from "./provenance";
import { SUPPLIER_RETURN_REASON_LABELS, SUPPLIER_RETURN_RESOLUTION_LABELS } from "./shared";
import type { SupplierReturnRow } from "./shared";

/* ------------------------------------------------------------------ */
/* Document lifecycle                                                  */
/* ------------------------------------------------------------------ */

export async function lockSupplierReturn(
  tx: Tx,
  companyId: string,
  returnId: string,
): Promise<SupplierReturnRow> {
  const [row] = await tx
    .select()
    .from(supplierReturns)
    .where(and(eq(supplierReturns.companyId, companyId), eq(supplierReturns.id, returnId)))
    .limit(1)
    .for("update");
  if (!row) throw new AppError("NOT_FOUND", "Dokumen retur pembelian tidak ditemukan.");
  return row;
}

export async function createSupplierReturn(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    supplierId: string;
    warehouseId: string;
    date: string;
    reasonCategory: string;
    reasonDetail: string;
    resolutionType: string;
    resolutionNote?: string | null;
    /** GDG3-06: kunci idempotensi dari klien (pola POS). */
    idempotencyKey?: string | null;
    lines: ReturnLineInput[];
  },
) {
  // GDG3-06: replay idempotensi — submit ulang berkunci sama
  // mengembalikan draf retur pertama.
  const idemKey = input.idempotencyKey?.trim() || null;
  if (idemKey) {
    const existing = await claimReturnIdempotency(tx, input.companyId, idemKey);
    if (existing) return existing;
  }
  if (!SUPPLIER_RETURN_REASON_LABELS[input.reasonCategory]) {
    throw new AppError("VALIDATION", "Kategori alasan retur tidak dikenal.");
  }
  if (!SUPPLIER_RETURN_RESOLUTION_LABELS[input.resolutionType]) {
    throw new AppError("VALIDATION", "Jenis penyelesaian retur tidak dikenal.");
  }
  const reasonDetail = input.reasonDetail.trim();
  if (reasonDetail.length < 3) {
    throw new AppError(
      "VALIDATION",
      "Alasan retur wajib diisi dengan detail yang jelas (minimal 3 karakter) — kategori saja tidak cukup.",
    );
  }
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Tambahkan minimal satu barang.");

  const [supplier] = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, input.companyId), eq(suppliers.id, input.supplierId)))
    .limit(1);
  if (!supplier) throw new AppError("VALIDATION", "Pemasok tidak ditemukan di perusahaan ini.");
  const [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, input.companyId), eq(warehouses.id, input.warehouseId)))
    .limit(1);
  if (!warehouse) throw new AppError("VALIDATION", "Gudang tidak ditemukan di perusahaan ini.");

  const { productById, linePlans } = await validateReturnLines(tx, {
    companyId: input.companyId,
    warehouseId: input.warehouseId,
    supplierId: input.supplierId,
    lines: input.lines,
  });

  // GDG1-01 (penasihat): plafon asal-usul dinilai sejak draf dibuat,
  // agar kesalahan pilih pemasok tertangkap sebelum dokumen tersimpan.
  // Penilaian OTORITATIF ada di postSupplierReturn di bawah kunci
  // baris pemasok — draf tidak memesan plafon, jadi dua draf boleh
  // sama-sama lolos di sini dan salah satunya tertahan saat posting.
  // S2: plafon selalu dinilai dalam SATUAN DASAR (rencana baris sudah
  // dikonversi dari kemasan pilihannya / cuplikan asalnya).
  const requestedByProduct = new Map<string, Decimal>();
  input.lines.forEach((line, index) => {
    requestedByProduct.set(
      line.productId,
      (requestedByProduct.get(line.productId) ?? d(0)).plus(linePlans[index].qtyBase),
    );
  });
  await assertReturnWithinProvenance(tx, {
    companyId: input.companyId,
    supplierId: input.supplierId,
    requested: requestedByProduct,
    productName: (productId) => productById.get(productId)?.name ?? productId,
  });

  const number = await nextDocumentNumber(tx, input.companyId, "SUPPLIER_RETURN", input.date);
  const [created] = await tx
    .insert(supplierReturns)
    .values({
      companyId: input.companyId,
      number,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      idempotencyKey: idemKey,
      date: input.date,
      reasonCategory: input.reasonCategory,
      reasonDetail,
      resolutionType: input.resolutionType,
      resolutionNote: input.resolutionNote ?? null,
      status: "draft",
      createdBy: input.userId,
    })
    .returning({ id: supplierReturns.id, number: supplierReturns.number });

  await tx.insert(supplierReturnLines).values(
    input.lines.map((line, index) => ({
      companyId: input.companyId,
      returnId: created.id,
      productId: line.productId,
      // REM-02: freeze the master's name/SKU on the line (snapshot).
      productName: productById.get(line.productId)?.name ?? null,
      productSku: productById.get(line.productId)?.sku ?? null,
      qty: toDb(linePlans[index].qtyBase),
      // S2: cuplikan kemasan baris (dari pilihan eksplisit atau warisan
      // baris penerimaan asal — lihat validateReturnLines).
      packagingId: linePlans[index].packagingId,
      qtyInput: linePlans[index].qtyInput,
      isiSnapshot: linePlans[index].isiSnapshot,
      batchId: line.batchId ?? null,
      receiptLineId: line.receiptLineId ?? null,
    })),
  );

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "supplier_return.create",
    entityType: "supplier_return",
    entityId: created.id,
    after: { number: created.number, supplier: supplier.name, reasonCategory: input.reasonCategory },
  });

  return created;
}

/**
 * GDG3-06: klaim kunci idempotensi pembuatan retur. Mengembalikan
 * draf yang sudah ada bila kunci pernah dipakai (replay), atau
 * undefined bila kunci berhasil diklaim pemanggil ini.
 */
async function claimReturnIdempotency(tx: Tx, companyId: string, idemKey: string) {
  const findReturnByKey = async () => {
    const [row] = await tx
      .select({ id: supplierReturns.id, number: supplierReturns.number })
      .from(supplierReturns)
      .where(and(eq(supplierReturns.companyId, companyId), eq(supplierReturns.idempotencyKey, idemKey)))
      .limit(1);
    return row;
  };
  const existing = await findReturnByKey();
  if (existing) return existing;
  const claimed = await claimIdempotencyKey(tx, {
    companyId,
    key: idemKey,
    scope: "inventory.supplier_return",
  });
  if (!claimed) {
    const winner = await findReturnByKey();
    if (winner) return winner;
    throw new AppError(
      "CONFLICT",
      "Retur dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
    );
  }
  return undefined;
}

type ReturnLineInput = {
  productId: string;
  qty: MoneyInput;
  batchId?: string | null;
  receiptLineId?: string | null;
  /**
   * Baris berkemasan (Satuan Kemasan S2): bila terisi, `qty` adalah
   * jumlah dalam kemasan itu. Bila kemasannya sama dengan kemasan
   * baris penerimaan asal (`receiptLineId`), faktor yang dipakai
   * adalah CUPLIKAN baris asal — bukan isi master hari ini; tanpa
   * baris asal yang cocok, kemasan divalidasi ke master (aktif, milik
   * produk ini) seperti jalur beli.
   */
  packagingId?: string | null;
};

/** Rencana satuan satu baris retur sesudah resolusi kemasan (S2). */
type ReturnLinePlan = {
  packagingId: string | null;
  isiSnapshot: string;
  /** Qty SATUAN DASAR yang benar-benar keluar dari stok. */
  qtyBase: Decimal;
  /** Qty sebagaimana dimasukkan, dinyatakan dalam kemasan baris. */
  qtyInput: string;
};

/**
 * Validasi baris draf retur: produk ada, qty sah, identitas
 * produk+batch unik, batch & baris penerimaan asal cocok, dan resolusi
 * kemasan per baris (S2). Mengembalikan peta produk + rencana satuan
 * sejajar baris masukan untuk pemanggil.
 */
async function validateReturnLines(
  tx: Tx,
  input: {
    companyId: string;
    warehouseId: string;
    supplierId: string;
    lines: ReturnLineInput[];
  },
): Promise<{
  productById: Map<string, { id: string; name: string; sku: string }>;
  linePlans: ReturnLinePlan[];
}> {
  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  const found = await tx
    .select({ id: products.id, name: products.name, sku: products.sku })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
  if (found.length !== productIds.length) {
    throw new AppError("VALIDATION", "Ada produk yang tidak ditemukan.");
  }
  const productById = new Map(found.map((row) => [row.id, row]));

  const seenIdentities = new Set<string>();
  // Cuplikan baris penerimaan asal per baris (null = tanpa asal /
  // asal satuan dasar), sejajar input.lines.
  const origins: ({ packagingId: string; isiSnapshot: string } | null)[] = [];
  const enteredQtys: Decimal[] = [];
  for (const line of input.lines) {
    const product = productById.get(line.productId)!;
    let qty: Decimal;
    try {
      qty = d(line.qty);
    } catch {
      throw new AppError("VALIDATION", `Jumlah retur ${product.name} harus berupa angka yang valid.`);
    }
    if (!qty.isFinite() || !qty.gt(0)) {
      throw new AppError("VALIDATION", `Jumlah retur ${product.name} harus lebih dari 0.`);
    }
    enteredQtys.push(qty);
    const identity = `${line.productId}|${line.batchId ?? ""}`;
    if (seenIdentities.has(identity)) {
      throw new AppError(
        "VALIDATION",
        `Produk ${product.name} muncul lebih dari sekali untuk batch yang sama. Gabungkan jumlahnya ke satu baris.`,
      );
    }
    seenIdentities.add(identity);

    if (line.batchId) {
      const [batch] = await tx
        .select({ id: stockBatches.id })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.companyId, input.companyId),
            eq(stockBatches.id, line.batchId),
            eq(stockBatches.productId, line.productId),
            eq(stockBatches.warehouseId, input.warehouseId),
          ),
        )
        .limit(1);
      if (!batch) {
        throw new AppError(
          "VALIDATION",
          `Batch yang dipilih untuk ${product.name} tidak ditemukan di gudang ini.`,
        );
      }
    }
    let origin: { packagingId: string; isiSnapshot: string } | null = null;
    if (line.receiptLineId) {
      const [receiptLine] = await tx
        .select({
          id: stockReceiptLines.id,
          productId: stockReceiptLines.productId,
          supplierId: stockReceipts.supplierId,
          packagingId: stockReceiptLines.packagingId,
          isiSnapshot: stockReceiptLines.isiSnapshot,
        })
        .from(stockReceiptLines)
        .innerJoin(stockReceipts, eq(stockReceiptLines.receiptId, stockReceipts.id))
        .where(
          and(eq(stockReceiptLines.companyId, input.companyId), eq(stockReceiptLines.id, line.receiptLineId)),
        )
        .limit(1);
      if (!receiptLine) {
        throw new AppError("VALIDATION", "Baris penerimaan asal tidak ditemukan.");
      }
      if (receiptLine.productId !== line.productId) {
        throw new AppError("VALIDATION", `Baris penerimaan asal bukan untuk produk ${product.name}.`);
      }
      if (receiptLine.supplierId !== input.supplierId) {
        throw new AppError(
          "VALIDATION",
          "Baris penerimaan asal berasal dari pemasok yang berbeda.",
        );
      }
      if (receiptLine.packagingId) {
        origin = { packagingId: receiptLine.packagingId, isiSnapshot: receiptLine.isiSnapshot };
      }
    }
    origins.push(origin);
  }

  // Kemasan eksplisit yang TIDAK ditanggung cuplikan asal divalidasi
  // ke master lewat gerbang yang sama dengan jalur beli. Baris yang
  // kemasannya sama dengan asalnya sengaja dikosongkan di sini:
  // faktornya warisan cuplikan, dan master hari ini (isi berubah /
  // kemasan sudah nonaktif) tidak boleh menghalangi retur barang yang
  // memang datang dalam kemasan itu.
  const explicit = await resolveLinePackagings(
    tx,
    input.companyId,
    input.lines.map((line, index) => ({
      productId: line.productId,
      packagingId:
        line.packagingId && origins[index]?.packagingId !== line.packagingId
          ? line.packagingId
          : null,
    })),
    (productId) => productById.get(productId)?.name ?? "Produk",
  );

  const linePlans = input.lines.map((line, index): ReturnLinePlan => {
    const qty = enteredQtys[index];
    const origin = origins[index];
    if (line.packagingId && origin?.packagingId === line.packagingId) {
      // Faktor WARISAN baris asal — isi master tidak dibaca sama sekali.
      return {
        packagingId: line.packagingId,
        isiSnapshot: origin.isiSnapshot,
        qtyBase: d(toBaseQty(toDb(qty), origin.isiSnapshot)),
        qtyInput: toDb(qty),
      };
    }
    const snap = explicit[index];
    if (snap.packaging) {
      return {
        packagingId: snap.packaging.id,
        isiSnapshot: snap.isiSnapshot,
        qtyBase: d(toBaseQty(toDb(qty), snap.isiSnapshot)),
        qtyInput: toDb(qty),
      };
    }
    if (origin) {
      // Lahir dari penerimaan berkemasan, qty dinyatakan dalam satuan
      // dasar: baris tetap mencatat kemasan & faktor asalnya sebagai
      // asal-usul, qtyInput dinyatakan ulang dalam kemasan asal itu.
      return {
        packagingId: origin.packagingId,
        isiSnapshot: origin.isiSnapshot,
        qtyBase: qty,
        qtyInput: toDb(qty.div(d(origin.isiSnapshot))),
      };
    }
    return { packagingId: null, isiSnapshot: "1", qtyBase: qty, qtyInput: toDb(qty) };
  });

  return { productById, linePlans };
}

/** Drafts are deleted outright — they never moved stock or money. */
export async function deleteSupplierReturn(
  tx: Tx,
  input: { companyId: string; userId: string; returnId: string },
) {
  const header = await lockSupplierReturn(tx, input.companyId, input.returnId);
  if (header.status !== "draft") {
    throw new AppError(
      "INVALID_STATE",
      `Retur ${header.number} sudah diposting dan tidak dapat dihapus. Batalkan lewat pembatalan retur terposting.`,
    );
  }
  await tx
    .delete(supplierReturns)
    .where(and(eq(supplierReturns.companyId, input.companyId), eq(supplierReturns.id, header.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "supplier_return.delete",
    entityType: "supplier_return",
    entityId: header.id,
    before: { number: header.number },
  });
  return { id: header.id, number: header.number };
}
