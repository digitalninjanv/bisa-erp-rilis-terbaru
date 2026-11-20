// FIX-ARS Tahap 4: bagian dari pemecahan src/server/inventory.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/inventory.ts.

import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockDocumentLines,
  stockDocuments,
  units,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import {
  sumCountComponents,
  toBaseQty,
  type CountBreakdownComponent,
} from "@/lib/packaging";
import { resolveLinePackagings } from "@/server/catalog";
import {
  assertPeriodOpen,
  getAccountMap,
  postJournal,
} from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { nextDocumentNumber } from "@/server/sequences";
import { claimIdempotencyKey } from "@/server/idempotency";
import { applyDocumentMovement, assertWarehouseOwned, lockStockQtyBatch } from "./movements";
import { autoCompleteOpnameTaskForPosting } from "./opname-tasks";

export async function createOpname(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    date: string;
    notes?: string;
    /** GDG3-06: kunci idempotensi dari klien (pola POS). */
    idempotencyKey?: string | null;
    lines: {
      productId: string;
      countedQty: string | number;
      /**
       * Hitungan campuran (Satuan Kemasan S3): komponen hitung per
       * bentuk — kemasan produk ini dan/atau satuan dasarnya
       * (`packagingId` null = pcs lepas). Bila terisi, total hitung
       * baris adalah Σ komponen × faktor cuplikannya (dihitung di
       * sini, otoritatif) dan `countedQty` klien hanya penyeimbang.
       * Rincian komponen disimpan di baris dokumen & muatan audit.
       */
      countComponents?: { packagingId?: string | null; qty: string | number }[];
    }[];
  },
) {
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Tambahkan minimal satu barang.");

  // GDG3-06: replay idempotensi.
  const opnameIdemKey = input.idempotencyKey?.trim() || null;
  const findOpnameByKey = async () => {
    if (!opnameIdemKey) return undefined;
    const [row] = await tx
      .select()
      .from(stockDocuments)
      .where(
        and(
          eq(stockDocuments.companyId, input.companyId),
          eq(stockDocuments.idempotencyKey, opnameIdemKey),
          eq(stockDocuments.type, "opname"),
        ),
      )
      .limit(1);
    return row;
  };
  if (opnameIdemKey) {
    const existing = await findOpnameByKey();
    if (existing) return existing;
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: opnameIdemKey,
      scope: "inventory.opname",
    });
    if (!claimed) {
      const winner = await findOpnameByKey();
      if (winner) return winner;
      throw new AppError(
        "CONFLICT",
        "Opname dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }

  // GDG3-07: gudang harus milik perusahaan ini.
  await assertWarehouseOwned(tx, input.companyId, input.warehouseId);
  // FIX-GDG Tahap 2 (GDG3-02): opname yang selisihnya neto-nol tidak
  // menjurnal, jadi kunci periode harus dinilai eksplisit dari tanggal
  // dokumennya — bukan diwarisi dari postJournal.
  await assertPeriodOpen(tx, input.companyId, input.date);
  // GD-P2-4: the same product twice in one count would apply the difference
  // twice against the same snapshot (the UI prevents it; the server must
  // too — same rule as createReceipt).
  const opnameProductIds = [...new Set(input.lines.map((l) => l.productId))];
  if (opnameProductIds.length !== input.lines.length) {
    throw new AppError("VALIDATION", "Produk yang sama muncul lebih dari sekali.");
  }
  const number = await nextDocumentNumber(tx, input.companyId, "OPNAME", input.date);
  const [doc] = await tx
    .insert(stockDocuments)
    .values({
      companyId: input.companyId,
      type: "opname",
      number,
      date: input.date,
      warehouseId: input.warehouseId,
      idempotencyKey: opnameIdemKey,
      status: "posted",
      notes: input.notes,
      reason: "Stok opname",
      createdBy: input.userId,
      postedAt: new Date(),
    })
    .returning({ id: stockDocuments.id, number: stockDocuments.number });

  // GD-P2-4: lock every counted product's stock row BEFORE reading the
  // system quantity, so a sale or receipt landing mid-count cannot make the
  // posted result differ from the physical count. Batched in lockStockQtyBatch
  // to execute in O(1) batched queries across sorted product IDs.
  const lockedStock = await lockStockQtyBatch(
    tx,
    input.companyId,
    input.warehouseId,
    opnameProductIds,
  );
  // S3: selesaikan kemasan komponen hitungan campuran lebih dulu —
  // satu gerbang validasi untuk semua baris (kemasan harus milik
  // produk barisnya & aktif; pola resolveLinePackagings S2). Nama
  // produk untuk pesan dimuat sekali di sini.
  const opnameNameRows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, opnameProductIds)));
  const opnameProductNames = new Map(opnameNameRows.map((row) => [row.id, row.name]));
  const flatComponents: { productId: string; packagingId: string | null }[] = [];
  const flatLineIndex: number[] = [];
  input.lines.forEach((line, lineIndex) => {
    for (const component of line.countComponents ?? []) {
      flatComponents.push({ productId: line.productId, packagingId: component.packagingId ?? null });
      flatLineIndex.push(lineIndex);
    }
  });
  const resolvedComponents = await resolveLinePackagings(
    tx,
    input.companyId,
    flatComponents,
    (productId) => opnameProductNames.get(productId) ?? "Produk",
  );
  const resolvedByLine = new Map<number, typeof resolvedComponents>();
  resolvedComponents.forEach((snap, flatIndex) => {
    const lineIndex = flatLineIndex[flatIndex];
    const list = resolvedByLine.get(lineIndex) ?? [];
    list.push(snap);
    resolvedByLine.set(lineIndex, list);
  });

  const map = await getAccountMap(tx, input.companyId);
  let netValue = d(0);
  let totalValue = d(0);
  // S3: lembar hitung lengkap untuk muatan audit — baris dokumen hanya
  // lahir untuk selisih ≠ 0 (perilaku lama), jadi tanpa ini hitungan
  // yang COCOK persis tidak meninggalkan jejak komponennya.
  const countWorksheet: {
    productId: string;
    countedQty: string;
    components: CountBreakdownComponent[] | null;
  }[] = [];

  const opnameProducts = await tx
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        costPrice: products.costPrice,
        unitName: units.name,
      })
      .from(products)
      .leftJoin(units, eq(products.unitId, units.id))
      .where(and(eq(products.companyId, input.companyId), inArray(products.id, opnameProductIds)))
      ;

  const productById = new Map(opnameProducts.map((product) => [product.id, product]));
  for (const [lineIndex, line] of input.lines.entries()) {
    const product = productById.get(line.productId);
    if (!product) throw new AppError("VALIDATION", "Produk tidak ditemukan.");
    const systemQty = lockedStock.get(line.productId) ?? d(0);

    // S3: hitungan campuran — total baris adalah Σ komponen × faktor
    // cuplikannya, dihitung di sini (otoritatif); komponen yang sama
    // dua kali dalam satu baris ditolak agar rincian tetap tegas.
    const components = line.countComponents ?? [];
    let breakdown: CountBreakdownComponent[] | null = null;
    let counted: ReturnType<typeof d>;
    if (components.length > 0) {
      const seenComponents = new Set<string>();
      const snaps = resolvedByLine.get(lineIndex) ?? [];
      breakdown = components.map((component, componentIndex) => {
        const key = component.packagingId ?? "__base__";
        if (seenComponents.has(key)) {
          throw new AppError(
            "VALIDATION",
            `Komponen hitungan ${product.name} memakai bentuk yang sama lebih dari sekali — gabungkan jumlahnya.`,
          );
        }
        seenComponents.add(key);
        const componentQty = d(component.qty);
        if (!componentQty.isFinite() || componentQty.lt(0)) {
          throw new AppError(
            "VALIDATION",
            `Komponen hitungan ${product.name} tidak boleh negatif.`,
          );
        }
        const snap = snaps[componentIndex];
        return {
          packagingId: component.packagingId ?? null,
          packagingName: snap.packaging?.name ?? product.unitName ?? "satuan dasar",
          isiSnapshot: snap.isiSnapshot,
          qtyInput: toDb(componentQty),
          baseQty: toBaseQty(component.qty, snap.isiSnapshot),
        };
      });
      counted = d(sumCountComponents(breakdown));
    } else {
      counted = d(line.countedQty);
    }
    // FIX-GDG Tahap 2 (GDG1-08): hasil hitung fisik tidak mungkin
    // negatif — hitungan negatif akan memalsukan delta sebesar dua
    // kali stok sistem. Nol adalah hitungan yang sah (stok habis).
    if (!counted.isFinite() || counted.lt(0)) {
      throw new AppError(
        "VALIDATION",
        `Hasil hitung ${product.name} tidak boleh negatif.`,
      );
    }
    countWorksheet.push({
      productId: line.productId,
      countedQty: toDb(counted),
      components: breakdown,
    });
    const delta = counted.minus(systemQty);
    if (delta.eq(0)) continue;
    const value = delta.mul(d(product.costPrice));
    netValue = netValue.plus(value);
    totalValue = totalValue.plus(value.abs());

    await tx.insert(stockDocumentLines).values({
      companyId: input.companyId,
      documentId: doc.id,
      productId: line.productId,
      productName: product.name,
      productSku: product.sku,
      qty: toDb(delta),
      // S3: untuk opname qtyInput adalah HASIL HITUNG fisik satuan
      // dasar (qty di atas tetap selisihnya); rincian campuran di
      // countBreakdown. packagingId null — hitungan bersifat gabungan.
      qtyInput: toDb(counted),
      isiSnapshot: "1",
      countBreakdown: breakdown,
      systemQty: toDb(systemQty),
      unitCost: product.costPrice,
      lineTotal: toDb(value.abs()),
      reason: "Stok opname",
    });
    // G8/D-7: opname differences follow the shared batch rules — shortfalls
    // leave FEFO, surpluses land in the batch-null remainder.
    await applyDocumentMovement(tx, {
      companyId: input.companyId,
      userId: input.userId,
      warehouseId: input.warehouseId,
      productId: line.productId,
      delta,
      unitCost: product.costPrice,
      movementType: "opname",
      referenceType: "opname",
      referenceId: doc.id,
      referenceNumber: doc.number,
      reason: "Stok opname",
      date: input.date,
    });
  }

  if (!netValue.eq(0)) {
    const abs = netValue.abs();
    await postJournal(tx, {
      companyId: input.companyId,
      date: input.date,
      description: `Stok opname ${doc.number}`,
      sourceType: "opname",
      sourceId: doc.id,
      createdBy: input.userId,
      lines: netValue.gt(0)
        ? [
            { accountId: map.inventory, debit: abs, description: "Selisih lebih persediaan" },
            { accountId: map.inventory_shrink, credit: abs, description: "Koreksi stok opname" },
          ]
        : [
            { accountId: map.inventory_shrink, debit: abs, description: "Selisih kurang persediaan" },
            { accountId: map.inventory, credit: abs, description: "Koreksi stok opname" },
          ],
    });
  }

  // GD-P2-1: document total = absolute value of the counted differences.
  await tx
    .update(stockDocuments)
    .set({ total: toDb(totalValue) })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.opname",
    entityType: "stock_document",
    entityId: doc.id,
    // S3: counts = lembar hitung lengkap (termasuk baris cocok yang
    // tidak melahirkan baris dokumen) — jejak audit komponen hitungan
    // campuran untuk SEMUA baris, bukan hanya yang berselisih.
    after: { number: doc.number, counts: countWorksheet },
  });

  // A-24 T3 (pola G3): tugas opname terbuka milik pemosting untuk
  // gudang ini selesai otomatis & tertaut ke dokumen ini. Lapisan
  // penugasan saja — stok & jurnal di atas tidak bergantung padanya.
  await autoCompleteOpnameTaskForPosting(tx, {
    companyId: input.companyId,
    userId: input.userId,
    warehouseId: input.warehouseId,
    documentId: doc.id,
  });
  return doc;
}

/** Lock the stock_on_hand row (creating it when absent) and return its qty. */
