import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockSerialMovements,
  stockSerials,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, type MoneyInput } from "@/lib/money";

/**
 * SIM-2 S7B-2 Batch 5 — Nomor seri.
 *
 * Identitas per unit untuk produk `track_serial`: seri hanya MASUK lewat
 * penerimaan (daftar seri eksplisit per unit, unik per perusahaan+produk)
 * dan hanya keluar dengan status `in_stock` di gudang yang benar —
 * unit yang sama tidak bisa keluar dua kali. Berbeda dari batch, stok
 * lama tanpa identitas seri TIDAK bisa dikarang identitasnya: produk
 * yang baru ditandai serial sesudah mempunyai stok harus menerima stok
 * berikutnya dengan seri agar bisa dijual per seri.
 */

export const SERIAL_STATUS_LABELS: Record<string, string> = {
  in_stock: "Di stok",
  in_transit: "Dalam perjalanan",
  out: "Keluar",
  void: "Dibatalkan",
};

export function normalizeSerialNumbers(values: string[]): string[] {
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return cleaned;
}

export async function isSerialTracked(tx: Tx, companyId: string, productId: string): Promise<boolean> {
  const [row] = await tx
    .select({ trackSerial: products.trackSerial })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.id, productId)))
    .limit(1);
  return row?.trackSerial ?? false;
}

export async function serialTrackFlags(
  tx: Tx,
  companyId: string,
  productIds: string[],
  saleId?: string,
): Promise<Map<string, boolean>> {
  if (productIds.length === 0) return new Map();
  const result = new Map<string, boolean>();

  if (saleId) {
    const movements = await tx
      .select({ productId: stockSerialMovements.productId })
      .from(stockSerialMovements)
      .where(
        and(
          eq(stockSerialMovements.companyId, companyId),
          eq(stockSerialMovements.referenceId, saleId),
          inArray(stockSerialMovements.productId, productIds),
          eq(stockSerialMovements.kind, "out"),
        ),
      );
    const moved = new Set(movements.map((m) => m.productId));
    for (const pid of productIds) {
      if (moved.has(pid)) result.set(pid, true);
    }
  }

  const missing = productIds.filter((id) => !result.has(id));
  if (missing.length > 0) {
    const rows = await tx
      .select({ id: products.id, trackSerial: products.trackSerial })
      .from(products)
      .where(and(eq(products.companyId, companyId), inArray(products.id, missing)));
    for (const row of rows) {
      result.set(row.id, saleId ? false : row.trackSerial);
    }
  }
  return result;
}

async function recordSerialMovement(
  tx: Tx,
  input: {
    companyId: string;
    serialId: string;
    productId: string;
    kind: string;
    warehouseId?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    referenceNumber?: string | null;
    note?: string | null;
    userId: string;
  },
) {
  await tx.insert(stockSerialMovements).values({
    companyId: input.companyId,
    serialId: input.serialId,
    productId: input.productId,
    kind: input.kind,
    warehouseId: input.warehouseId ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    referenceNumber: input.referenceNumber ?? null,
    note: input.note ?? null,
    createdBy: input.userId,
  });
}

/** Daftarkan seri masuk dari penerimaan. Duplikat ditolak (juga oleh indeks unik DB). */
export async function registerSerialsIn(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    productName: string;
    warehouseId: string;
    serialNumbers: string[];
    receiptId: string;
    receiptNumber: string;
    // FIX-GDG Tahap 2 (GDG1-04): dokumen masuk selain penerimaan
    // (barang pengganti retur pemasok) menamai referensinya sendiri;
    // bawaan tetap stock_receipt seperti sebelumnya.
    referenceType?: string;
  },
) {
  const serialNumbers = normalizeSerialNumbers(input.serialNumbers);
  if (new Set(serialNumbers).size !== serialNumbers.length) {
    throw new AppError("VALIDATION", `Nomor seri ${input.productName} duplikat dalam satu penerimaan.`);
  }
  const existing = await tx
    .select({ serialNumber: stockSerials.serialNumber })
    .from(stockSerials)
    .where(
      and(
        eq(stockSerials.companyId, input.companyId),
        eq(stockSerials.productId, input.productId),
        inArray(stockSerials.serialNumber, serialNumbers),
      ),
    );
  if (existing.length > 0) {
    throw new AppError(
      "CONFLICT",
      `Nomor seri ${existing.map((row) => row.serialNumber).join(", ")} untuk ${input.productName} sudah pernah diterima.`,
    );
  }
  const inserted = await tx
    .insert(stockSerials)
    .values(
      serialNumbers.map((serialNumber) => ({
        companyId: input.companyId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        serialNumber,
        status: "in_stock",
        receiptId: input.receiptId,
      })),
    )
    .returning();
  for (const row of inserted) {
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: row.id,
      productId: input.productId,
      kind: "in",
      warehouseId: input.warehouseId,
      referenceType: input.referenceType ?? "stock_receipt",
      referenceId: input.receiptId,
      referenceNumber: input.receiptNumber,
      userId: input.userId,
    });
  }
  return inserted;
}

/**
 * Keluarkan seri yang DIPILIH eksplisit (penjualan POS). Setiap seri
 * dikunci FOR UPDATE dan wajib berstatus in_stock di gudang penjualan.
 */
export async function consumeSerials(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    productName: string;
    warehouseId: string;
    serialNumbers: string[];
    kind?: string;
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
  },
) {
  const serialNumbers = normalizeSerialNumbers(input.serialNumbers);
  const rows = await tx
    .select()
    .from(stockSerials)
    .where(
      and(
        eq(stockSerials.companyId, input.companyId),
        eq(stockSerials.productId, input.productId),
        inArray(stockSerials.serialNumber, serialNumbers),
      ),
    )
    .for("update");
  const byNumber = new Map(rows.map((row) => [row.serialNumber, row]));
  for (const serialNumber of serialNumbers) {
    const row = byNumber.get(serialNumber);
    if (!row) {
      throw new AppError("VALIDATION", `Nomor seri ${serialNumber} tidak dikenal untuk ${input.productName}.`);
    }
    if (row.status !== "in_stock" || row.warehouseId !== input.warehouseId) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `Nomor seri ${serialNumber} untuk ${input.productName} tidak tersedia di gudang ini (status: ${row.status}).`,
      );
    }
  }
  for (const serialNumber of serialNumbers) {
    const row = byNumber.get(serialNumber)!;
    await tx
      .update(stockSerials)
      .set({ status: "out", updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, row.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: row.id,
      productId: input.productId,
      kind: input.kind ?? "out",
      warehouseId: input.warehouseId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      userId: input.userId,
    });
  }
}

/** Keluarkan N seri tertua yang in_stock (dokumen gudang tanpa pilihan seri eksplisit). */
export async function pickSerialsOut(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    productName: string;
    warehouseId: string;
    qty: MoneyInput;
    kind?: string;
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
  },
) {
  const qty = d(input.qty);
  if (!qty.isInteger() || qty.lte(0)) {
    throw new AppError("VALIDATION", `Qty keluar ${input.productName} untuk produk serial harus bilangan bulat positif.`);
  }
  const rows = await tx
    .select()
    .from(stockSerials)
    .where(
      and(
        eq(stockSerials.companyId, input.companyId),
        eq(stockSerials.productId, input.productId),
        eq(stockSerials.warehouseId, input.warehouseId),
        eq(stockSerials.status, "in_stock"),
      ),
    )
    .orderBy(asc(stockSerials.createdAt), asc(stockSerials.serialNumber))
    .limit(qty.toNumber())
    .for("update");
  if (rows.length < qty.toNumber()) {
    throw new AppError(
      "INSUFFICIENT_STOCK",
      `Seri tersedia untuk ${input.productName} hanya ${rows.length} unit, diminta ${qty.toString()}.`,
    );
  }
  for (const row of rows) {
    await tx
      .update(stockSerials)
      .set({ status: "out", updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, row.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: row.id,
      productId: input.productId,
      kind: input.kind ?? "out",
      warehouseId: input.warehouseId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      userId: input.userId,
    });
  }
  return rows;
}

/**
 * Pulihkan seri yang keluar oleh satu penjualan (void/retur): seri yang
 * gerakan keluarnya menunjuk penjualan itu dan masih berstatus out
 * kembali in_stock di gudang asal penjualan. `qty` membatasi jumlah
 * (retur sebagian); tanpa qty semua dipulihkan.
 */
export async function restoreSerialsForSale(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    saleId: string;
    productId: string;
    warehouseId: string;
    qty?: MoneyInput;
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
  },
) {
  // POS-004: inner join dengan stockSerials berstatus "out" sebelum membatasi limit
  // agar retur bertahap tidak mengambil gerakan yang serialnya sudah pernah dipulihkan.
  const outMovements = await tx
    .select({ serialId: stockSerialMovements.serialId })
    .from(stockSerialMovements)
    .innerJoin(
      stockSerials,
      and(
        eq(stockSerials.companyId, stockSerialMovements.companyId),
        eq(stockSerials.id, stockSerialMovements.serialId),
        eq(stockSerials.status, "out"),
      ),
    )
    .where(
      and(
        eq(stockSerialMovements.companyId, input.companyId),
        eq(stockSerialMovements.productId, input.productId),
        eq(stockSerialMovements.kind, "out"),
        eq(stockSerialMovements.referenceId, input.saleId),
      ),
    )
    .orderBy(asc(stockSerialMovements.createdAt));
  const limit = input.qty != null ? d(input.qty).toNumber() : outMovements.length;
  const targets = outMovements.slice(0, limit);
  for (const movement of targets) {
    const [serial] = await tx
      .select()
      .from(stockSerials)
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, movement.serialId)))
      .limit(1)
      .for("update");
    if (!serial || serial.status !== "out") continue;
    await tx
      .update(stockSerials)
      .set({ status: "in_stock", warehouseId: input.warehouseId, updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, serial.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: serial.id,
      productId: input.productId,
      kind: "restore",
      warehouseId: input.warehouseId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      userId: input.userId,
    });
  }
  return targets.length;
}

/** Batalkan seri milik satu penerimaan (void penerimaan): hanya seri yang belum pernah keluar. */
export async function voidSerialsForReceipt(
  tx: Tx,
  input: { companyId: string; userId: string; receiptId: string; receiptNumber: string },
) {
  const rows = await tx
    .select()
    .from(stockSerials)
    .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.receiptId, input.receiptId)))
    .for("update");
  for (const row of rows) {
    if (row.status !== "in_stock" && row.status !== "in_transit") {
      throw new AppError(
        "INVALID_STATE",
        `Penerimaan tidak bisa dibatalkan: nomor seri ${row.serialNumber} sudah keluar.`,
      );
    }
  }
  for (const row of rows) {
    if (row.status === "void") continue;
    await tx
      .update(stockSerials)
      .set({ status: "void", updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, row.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: row.id,
      productId: row.productId,
      kind: "void",
      warehouseId: row.warehouseId,
      referenceType: "stock_receipt",
      referenceId: input.receiptId,
      referenceNumber: input.receiptNumber,
      userId: input.userId,
    });
  }
}

/** Kirim seri untuk transfer dua tahap: in_stock → in_transit (pilihan tertua). */
export async function shipSerialsForTransfer(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    productName: string;
    fromWarehouseId: string;
    qty: MoneyInput;
    documentId: string;
    documentNumber: string;
  },
) {
  const rows = await pickSerialsOut(tx, {
    ...input,
    warehouseId: input.fromWarehouseId,
    kind: "transfer_out",
    referenceType: "transfer",
    referenceId: input.documentId,
    referenceNumber: input.documentNumber,
  });
  // pickSerialsOut menandai out; untuk pengiriman dua tahap status yang
  // benar adalah in_transit sampai diterima di tujuan.
  for (const row of rows) {
    await tx
      .update(stockSerials)
      .set({ status: "in_transit", updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, row.id)));
  }
  return rows;
}

/** Terima seri transfer dua tahap: seri in_transit milik dokumen ini → in_stock di tujuan. */
export async function receiveSerialsForTransfer(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    toWarehouseId: string;
    documentId: string;
    documentNumber: string;
    // FIX-GDG Tahap 2 (GDG1-07): penerimaan SEBAGIAN — batasi jumlah
    // seri yang diterima (tertua lebih dulu, konsisten dengan urutan
    // pengiriman) atau sebutkan persis seri yang tiba. Tanpa keduanya
    // perilaku lama berlaku: semua seri in_transit diterima.
    qty?: MoneyInput;
    serialNumbers?: string[];
  },
) {
  const movements = await tx
    .select({ serialId: stockSerialMovements.serialId })
    .from(stockSerialMovements)
    .where(
      and(
        eq(stockSerialMovements.companyId, input.companyId),
        eq(stockSerialMovements.productId, input.productId),
        eq(stockSerialMovements.kind, "transfer_out"),
        eq(stockSerialMovements.referenceId, input.documentId),
      ),
    )
    .orderBy(asc(stockSerialMovements.createdAt));
  const wanted = input.serialNumbers
    ? new Set(normalizeSerialNumbers(input.serialNumbers))
    : null;
  let remaining = input.qty != null ? d(input.qty).toNumber() : Number.POSITIVE_INFINITY;
  for (const movement of movements) {
    if (remaining <= 0) break;
    const [serial] = await tx
      .select()
      .from(stockSerials)
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, movement.serialId)))
      .limit(1)
      .for("update");
    if (!serial || serial.status !== "in_transit") continue;
    if (wanted && !wanted.has(serial.serialNumber)) continue;
    await tx
      .update(stockSerials)
      .set({ status: "in_stock", warehouseId: input.toWarehouseId, updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, serial.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: serial.id,
      productId: input.productId,
      kind: "transfer_in",
      warehouseId: input.toWarehouseId,
      referenceType: "transfer",
      referenceId: input.documentId,
      referenceNumber: input.documentNumber,
      userId: input.userId,
    });
    remaining -= 1;
    if (wanted) wanted.delete(serial.serialNumber);
  }
  if (wanted && wanted.size > 0) {
    throw new AppError(
      "VALIDATION",
      `Nomor seri ${[...wanted].join(", ")} tidak termasuk seri yang sedang dalam perjalanan pada dokumen ini.`,
    );
  }
}

/**
 * FIX-GDG Tahap 2 (GDG1-07): tutup selisih perjalanan untuk seri —
 * seri yang masih in_transit milik dokumen ini dinyatakan hilang di
 * jalan: status menjadi `out` (tidak lagi berada di stok mana pun)
 * dengan gerakan seri berkind transfer_difference yang membawa alasan
 * penutupannya, sehingga identitas unitnya tetap tertelusur.
 */
export async function closeSerialsForTransferDifference(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    documentId: string;
    documentNumber: string;
    reason: string;
  },
) {
  const movements = await tx
    .select({ serialId: stockSerialMovements.serialId })
    .from(stockSerialMovements)
    .where(
      and(
        eq(stockSerialMovements.companyId, input.companyId),
        eq(stockSerialMovements.productId, input.productId),
        eq(stockSerialMovements.kind, "transfer_out"),
        eq(stockSerialMovements.referenceId, input.documentId),
      ),
    );
  let closed = 0;
  for (const movement of movements) {
    const [serial] = await tx
      .select()
      .from(stockSerials)
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, movement.serialId)))
      .limit(1)
      .for("update");
    if (!serial || serial.status !== "in_transit") continue;
    await tx
      .update(stockSerials)
      .set({ status: "out", updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, serial.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: serial.id,
      productId: input.productId,
      kind: "transfer_difference",
      warehouseId: serial.warehouseId,
      referenceType: "transfer",
      referenceId: input.documentId,
      referenceNumber: input.documentNumber,
      note: input.reason,
      userId: input.userId,
    });
    closed += 1;
  }
  return closed;
}

/** Pindahkan seri untuk transfer satu tahap: gudang berubah, status tetap in_stock. */
export async function moveSerialsOneStep(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    productName: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    qty: MoneyInput;
    documentId: string;
    documentNumber: string;
  },
) {
  const qty = d(input.qty);
  const rows = await tx
    .select()
    .from(stockSerials)
    .where(
      and(
        eq(stockSerials.companyId, input.companyId),
        eq(stockSerials.productId, input.productId),
        eq(stockSerials.warehouseId, input.fromWarehouseId),
        eq(stockSerials.status, "in_stock"),
      ),
    )
    .orderBy(asc(stockSerials.createdAt), asc(stockSerials.serialNumber))
    .limit(qty.toNumber())
    .for("update");
  if (rows.length < qty.toNumber()) {
    throw new AppError(
      "INSUFFICIENT_STOCK",
      `Seri tersedia untuk ${input.productName} hanya ${rows.length} unit, diminta ${qty.toString()}.`,
    );
  }
  for (const row of rows) {
    await tx
      .update(stockSerials)
      .set({ warehouseId: input.toWarehouseId, updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, row.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: row.id,
      productId: input.productId,
      kind: "transfer_out",
      warehouseId: input.fromWarehouseId,
      referenceType: "transfer",
      referenceId: input.documentId,
      referenceNumber: input.documentNumber,
      userId: input.userId,
    });
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: row.id,
      productId: input.productId,
      kind: "transfer_in",
      warehouseId: input.toWarehouseId,
      referenceType: "transfer",
      referenceId: input.documentId,
      referenceNumber: input.documentNumber,
      userId: input.userId,
    });
  }
  return rows;
}

/**
 * Pindahkan seri yang baru saja dikeluarkan oleh satu dokumen ke gudang
 * lain sebagai in_stock (leg masuk karantina: unit tidak keluar
 * perusahaan, hanya berpindah gudang).
 */
export async function relocateSerialsByOutReference(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    productId: string;
    referenceId: string;
    referenceNumber: string;
    toWarehouseId: string;
    note?: string | null;
  },
) {
  const movements = await tx
    .select({ serialId: stockSerialMovements.serialId })
    .from(stockSerialMovements)
    .where(
      and(
        eq(stockSerialMovements.companyId, input.companyId),
        eq(stockSerialMovements.productId, input.productId),
        eq(stockSerialMovements.kind, "out"),
        eq(stockSerialMovements.referenceId, input.referenceId),
      ),
    );
  for (const movement of movements) {
    const [serial] = await tx
      .select()
      .from(stockSerials)
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, movement.serialId)))
      .limit(1)
      .for("update");
    if (!serial || serial.status !== "out") continue;
    await tx
      .update(stockSerials)
      .set({ status: "in_stock", warehouseId: input.toWarehouseId, updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, serial.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: serial.id,
      productId: input.productId,
      kind: "transfer_in",
      warehouseId: input.toWarehouseId,
      referenceType: "adjustment",
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      note: input.note ?? null,
      userId: input.userId,
    });
  }
}

/** Pulihkan seri saat transfer dibatalkan (satu tahap maupun in-transit). */
export async function restoreSerialsForTransferVoid(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    documentId: string;
    documentNumber: string;
    fromWarehouseId: string;
    toWarehouseId: string | null;
  },
) {
  const movements = await tx
    .select({ serialId: stockSerialMovements.serialId })
    .from(stockSerialMovements)
    .where(
      and(
        eq(stockSerialMovements.companyId, input.companyId),
        eq(stockSerialMovements.kind, "transfer_out"),
        eq(stockSerialMovements.referenceId, input.documentId),
      ),
    );
  for (const movement of movements) {
    const [serial] = await tx
      .select()
      .from(stockSerials)
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, movement.serialId)))
      .limit(1)
      .for("update");
    if (!serial) continue;
    const wasInTransit = serial.status === "in_transit";
    const wasMovedOneStep =
      serial.status === "in_stock" && input.toWarehouseId && serial.warehouseId === input.toWarehouseId;
    if (!wasInTransit && !wasMovedOneStep) continue;
    await tx
      .update(stockSerials)
      .set({ status: "in_stock", warehouseId: input.fromWarehouseId, updatedAt: new Date() })
      .where(and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, serial.id)));
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId: serial.id,
      productId: serial.productId,
      kind: "restore",
      warehouseId: input.fromWarehouseId,
      referenceType: "transfer",
      referenceId: input.documentId,
      referenceNumber: input.documentNumber,
      note: "Transfer dibatalkan",
      userId: input.userId,
    });
  }
}

/** Kartu seri per produk: setiap unit + riwayat gerakannya. */
export async function getProductSerialCard(tx: Tx, companyId: string, productId: string) {
  const serials = await tx
    .select()
    .from(stockSerials)
    .where(and(eq(stockSerials.companyId, companyId), eq(stockSerials.productId, productId)))
    .orderBy(asc(stockSerials.createdAt), asc(stockSerials.serialNumber));
  if (serials.length === 0) return [];
  const movements = await tx
    .select()
    .from(stockSerialMovements)
    .where(
      and(
        eq(stockSerialMovements.companyId, companyId),
        inArray(
          stockSerialMovements.serialId,
          serials.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(stockSerialMovements.createdAt));
  const bySerial = new Map<string, typeof movements>();
  for (const movement of movements) {
    const list = bySerial.get(movement.serialId) ?? [];
    list.push(movement);
    bySerial.set(movement.serialId, list);
  }
  return serials.map((row) => ({ ...row, movements: bySerial.get(row.id) ?? [] }));
}
