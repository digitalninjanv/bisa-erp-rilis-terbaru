// FIX-ARS Tahap 4: bagian dari pemecahan src/server/inventory.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/inventory.ts.
// A-26 Q8b: penerimaan transfer dipisah ke transfers-receive.ts;
// berkas ini hanya memuat pembuatan & pengiriman transfer.

import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { products, stockDocumentLines, stockDocuments } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import { toBaseQty } from "@/lib/packaging";
import { assertPeriodOpen } from "@/server/accounting";
import { resolveLinePackagings } from "@/server/catalog";
import { writeAudit } from "@/server/audit";
import { addToBatch, applyBatchDelta, isBatchTracked } from "@/server/batches";
import { isSerialTracked, moveSerialsOneStep, shipSerialsForTransfer } from "@/server/serials";
import { nextDocumentNumber } from "@/server/sequences";
import { claimIdempotencyKey } from "@/server/idempotency";
import type { StockDocumentRow } from "./documents";
import { applyStockMovement, assertWarehouseOwned } from "./movements";
import { getCompanySettingsRow } from "@/server/settings";;

type CreateTransferInput = {
  companyId: string;
  userId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  date: string;
  notes?: string;
  /** GDG3-06: kunci idempotensi dari klien (pola POS). */
  idempotencyKey?: string | null;
  /**
   * Baris berkemasan (Satuan Kemasan S3): bila `packagingId` terisi,
   * `qty` adalah jumlah KEMASAN; yang bergerak & disimpan sebagai
   * `qty` baris selalu satuan dasar (qty × isi cuplikan).
   */
  lines: { productId: string; qty: string | number; packagingId?: string | null }[];
};

/** Baris transfer sesudah konversi kemasan: qty sudah satuan dasar. */
type NormalizedTransferLine = {
  productId: string;
  qty: string | number;
  packagingId: string | null;
  qtyInput: string;
  isiSnapshot: string;
};


export async function createTransfer(tx: Tx, input: CreateTransferInput) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new AppError("VALIDATION", "Gudang asal dan tujuan harus berbeda.");
  }
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Tambahkan minimal satu barang.");

  const { existing: existingTransfer, idemKey: transferIdemKey } = await claimTransferIdempotency(tx, input);
  if (existingTransfer) return existingTransfer;

  // GDG3-07: kedua gudang harus milik perusahaan ini.
  await assertWarehouseOwned(tx, input.companyId, input.fromWarehouseId, "Gudang asal");
  await assertWarehouseOwned(tx, input.companyId, input.toWarehouseId, "Gudang tujuan");

  // FIX-GDG Tahap 2 (GDG3-02): transfer tidak pernah menjurnal, jadi
  // tanpa pemeriksaan ini tanggal dokumennya lolos dari kunci periode.
  await assertPeriodOpen(tx, input.companyId, input.date);

  const transferProductById = await validateTransferLines(tx, input);

  // S3: selesaikan kemasan per baris lalu ubah ke satuan dasar —
  // gerakan stok, batch, dan seri sesudah ini hanya mengenal qty
  // dasar, persis seperti sebelum ada kemasan (pola S2).
  const resolved = await resolveLinePackagings(tx, input.companyId, input.lines, (productId) =>
    transferProductById.get(productId)?.name ?? "Produk",
  );
  const normalizedLines: NormalizedTransferLine[] = input.lines.map((line, index) => {
    const snap = resolved[index];
    return {
      productId: line.productId,
      qty: snap.packaging ? toBaseQty(line.qty, snap.isiSnapshot) : line.qty,
      packagingId: snap.packaging?.id ?? null,
      qtyInput: toDb(line.qty),
      isiSnapshot: snap.isiSnapshot,
    };
  });

  const { doc, twoStep } = await insertTransferDocument(tx, input, transferIdemKey);

  const totalValue = await shipTransferLines(
    tx,
    input,
    doc,
    transferProductById,
    twoStep,
    normalizedLines,
  );

  // GD-P2-1: document total = absolute value of the moved goods.
  await tx
    .update(stockDocuments)
    .set({ total: toDb(totalValue) })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: twoStep ? "inventory.transfer.ship" : "inventory.transfer",
    entityType: "stock_document",
    entityId: doc.id,
    after: { number: doc.number },
  });
  return doc;
}

/**
 * FIX-ARS Tahap 4: fase dari createTransfer — badan dipindah apa adanya;
 * klaim kunci idempotensi transfer (GDG3-06). Mengembalikan
 * dokumen yang sudah ada bila replay.
 */


async function claimTransferIdempotency(
  tx: Tx,
  input: CreateTransferInput,
): Promise<{ existing: StockDocumentRow | undefined; idemKey: string | null }> {
  // GDG3-06: replay idempotensi.
  const transferIdemKey = input.idempotencyKey?.trim() || null;
  const findTransferByKey = async () => {
    if (!transferIdemKey) return undefined;
    const [row] = await tx
      .select()
      .from(stockDocuments)
      .where(
        and(
          eq(stockDocuments.companyId, input.companyId),
          eq(stockDocuments.idempotencyKey, transferIdemKey),
          eq(stockDocuments.type, "transfer"),
        ),
      )
      .limit(1);
    return row;
  };
  if (transferIdemKey) {
    const existing = await findTransferByKey();
    if (existing) return { existing, idemKey: transferIdemKey };
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: transferIdemKey,
      scope: "inventory.transfer",
    });
    if (!claimed) {
      const winner = await findTransferByKey();
      if (winner) return { existing: winner, idemKey: transferIdemKey };
      throw new AppError(
        "CONFLICT",
        "Transfer dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }
  return { existing: undefined, idemKey: transferIdemKey };
}


type TransferProductRow = {
  id: string;
  name: string;
  sku: string;
  costPrice: string;
};

/**
 * FIX-ARS Tahap 4: fase dari createTransfer — badan dipindah apa adanya;
 * validasi baris — produk ada, tidak duplikat, qty positif
 * (GDG1-08). Mengembalikan peta produk baris transfer.
 */


async function validateTransferLines(tx: Tx, input: CreateTransferInput) {
  // FIX-GDG Tahap 2 (GDG1-08/GDG3-08): domain memvalidasi tanda qty
  // sendiri — qty negatif dulu MEMBALIK arah mutasi (tujuan → asal)
  // dalam dokumen yang menyatakan sebaliknya, dan qty 0 mencatat
  // mutasi nol. Baris duplikat per produk juga ditolak (pola
  // penerimaan): gabungkan ke satu baris agar qty terkirim per produk
  // tidak ambigu untuk penerimaan sebagian (GDG1-07).
  const transferProductIds = [...new Set(input.lines.map((line) => line.productId))];
  const transferProducts = await tx
    .select({ id: products.id, name: products.name, sku: products.sku, costPrice: products.costPrice })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, transferProductIds)));
  if (transferProducts.length !== transferProductIds.length) {
    throw new AppError("VALIDATION", "Ada produk yang tidak ditemukan.");
  }
  const transferProductById = new Map(transferProducts.map((row) => [row.id, row]));
  if (transferProductIds.length !== input.lines.length) {
    throw new AppError(
      "VALIDATION",
      "Produk yang sama muncul lebih dari sekali dalam satu transfer. Gabungkan jumlahnya ke satu baris.",
    );
  }
  for (const line of input.lines) {
    const product = transferProductById.get(line.productId)!;
    const qty = d(line.qty);
    if (!qty.isFinite() || !qty.gt(0)) {
      throw new AppError(
        "VALIDATION",
        `Jumlah transfer ${product.name} harus lebih dari 0.`,
      );
    }
  }
  return transferProductById;
}

/**
 * FIX-ARS Tahap 4: fase dari createTransfer — badan dipindah apa adanya;
 * penulisan header dokumen — status mengikuti saklar transfer
 * dua tahap perusahaan (in_transit vs posted langsung).
 */


async function insertTransferDocument(tx: Tx, input: CreateTransferInput, transferIdemKey: string | null) {
  // SIM-2 S7B-2 Batch 4: saklar transfer dua tahap per perusahaan.
  // Mode dua tahap: dokumen berhenti di status `in_transit` sesudah leg
  // keluar; leg masuk diterapkan receiveTransfer. Mode satu tahap
  // (bawaan) tidak berubah: kedua leg langsung terposting.
  const settings = await getCompanySettingsRow(tx, input.companyId);
  const twoStep = settings?.transferTwoStepEnabled ?? false;
  const number = await nextDocumentNumber(tx, input.companyId, "TRANSFER", input.date);
  const [doc] = await tx
    .insert(stockDocuments)
    .values({
      companyId: input.companyId,
      type: "transfer",
      number,
      date: input.date,
      warehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      idempotencyKey: transferIdemKey,
      status: twoStep ? "in_transit" : "posted",
      notes: input.notes,
      createdBy: input.userId,
      postedAt: new Date(),
    })
    .returning({ id: stockDocuments.id, number: stockDocuments.number });
  return { doc, twoStep };
}

/**
 * FIX-ARS Tahap 4: fase dari createTransfer — badan dipindah apa adanya;
 * pengiriman baris — tulis baris dokumen, gerakkan leg keluar
 * (dan leg masuk bila satu tahap) per irisan batch, pindahkan
 * identitas seri. Mengembalikan nilai total barang bergerak.
 */


async function shipTransferLines(
  tx: Tx,
  input: CreateTransferInput,
  doc: { id: string; number: string },
  transferProductById: Map<string, TransferProductRow>,
  twoStep: boolean,
  normalizedLines: NormalizedTransferLine[],
) {
  let totalValue = d(0);
  for (const line of normalizedLines) {
    const product = transferProductById.get(line.productId)!;
    totalValue = totalValue.plus(d(line.qty).mul(d(product.costPrice)));
    await tx.insert(stockDocumentLines).values({
      companyId: input.companyId,
      documentId: doc.id,
      productId: line.productId,
      productName: product.name,
      productSku: product.sku,
      qty: toDb(line.qty),
      // S3: bentuk masukan berkemasan + faktor cuplikannya.
      packagingId: line.packagingId,
      qtyInput: line.qtyInput,
      isiSnapshot: line.isiSnapshot,
      unitCost: product.costPrice,
      lineTotal: toDb(d(line.qty).mul(d(product.costPrice))),
    });
    // G8/D-7: batch-tracked goods leave FEFO and arrive in the SAME batch
    // at the destination warehouse — a transfer never mixes batches.
    const tracked = await isBatchTracked(tx, input.companyId, line.productId);
    if (tracked) {
      const slices = await applyBatchDelta(tx, {
        companyId: input.companyId,
        productId: line.productId,
        warehouseId: input.fromWarehouseId,
        delta: d(line.qty).neg(),
        purpose: "correction",
      });
      for (const slice of slices) {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: input.fromWarehouseId,
          productId: line.productId,
          delta: slice.qty.negated(),
          unitCost: product.costPrice,
          movementType: "transfer_out",
          referenceType: "transfer",
          referenceId: doc.id,
          referenceNumber: doc.number,
          userId: input.userId,
          batchId: slice.batchId,
          date: input.date,
        });
        if (twoStep) continue; // leg masuk menunggu penerimaan di tujuan
        const destBatch = await addToBatch(tx, {
          companyId: input.companyId,
          productId: line.productId,
          warehouseId: input.toWarehouseId,
          batchNumber: slice.batchNumber,
          expiryDate: slice.expiryDate,
          delta: slice.qty,
        });
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: input.toWarehouseId,
          productId: line.productId,
          delta: slice.qty,
          unitCost: product.costPrice,
          movementType: "transfer_in",
          referenceType: "transfer",
          referenceId: doc.id,
          referenceNumber: doc.number,
          userId: input.userId,
          batchId: destBatch.id,
          date: input.date,
        });
      }
    } else {
      await applyStockMovement(tx, {
        companyId: input.companyId,
        warehouseId: input.fromWarehouseId,
        productId: line.productId,
        delta: d(line.qty).neg(),
        unitCost: product.costPrice,
        movementType: "transfer_out",
        referenceType: "transfer",
        referenceId: doc.id,
        referenceNumber: doc.number,
        userId: input.userId,
        date: input.date,
      });
      if (!twoStep) {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: input.toWarehouseId,
          productId: line.productId,
          delta: line.qty,
          unitCost: product.costPrice,
          movementType: "transfer_in",
          referenceType: "transfer",
          referenceId: doc.id,
          referenceNumber: doc.number,
          userId: input.userId,
          date: input.date,
        });
      }
    }
    // SIM-2 S7B-2 Batch 5: identitas seri ikut berpindah bersama unit.
    if (await isSerialTracked(tx, input.companyId, line.productId)) {
      if (twoStep) {
        await shipSerialsForTransfer(tx, {
          companyId: input.companyId,
          userId: input.userId,
          productId: line.productId,
          productName: product.name,
          fromWarehouseId: input.fromWarehouseId,
          qty: line.qty,
          documentId: doc.id,
          documentNumber: doc.number,
        });
      } else {
        await moveSerialsOneStep(tx, {
          companyId: input.companyId,
          userId: input.userId,
          productId: line.productId,
          productName: product.name,
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          qty: line.qty,
          documentId: doc.id,
          documentNumber: doc.number,
        });
      }
    }
  }
  return totalValue;
}
