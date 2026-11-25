import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { stockSerialMovements, stockSerials } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { recordSerialMovement } from "@/server/serials";

/**
 * Pulihkan seri yang dikonsumsi satu dokumen stok (penyesuaian,
 * opname, atau retur pembelian warisan) saat dokumen di-void.
 *
 * - Barang rusak/kedaluwarsa/hilang/opname: seri berstatus `out`
 *   kembali `in_stock` di gudang asal gerakan keluarnya.
 * - Karantina: seri sudah dipindahkan ke gudang karantina sebagai
 *   `in_stock`; fungsi ini memindahkannya kembali ke gudang asal.
 *
 * Hanya seri yang gerakan TERAKHIRNYA masih menunjuk dokumen ini yang
 * dipulihkan — seri yang sudah dijual/dipindah lagi sesudah dokumen
 * tidak boleh ditarik kembali dari tempatnya sekarang.
 */
export async function restoreSerialsForStockDocumentVoid(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    documentId: string;
    documentNumber: string;
    note?: string | null;
  },
) {
  const outRows = await tx
    .select({
      serialId: stockSerialMovements.serialId,
      warehouseId: stockSerialMovements.warehouseId,
    })
    .from(stockSerialMovements)
    .where(
      and(
        eq(stockSerialMovements.companyId, input.companyId),
        eq(stockSerialMovements.referenceId, input.documentId),
        eq(stockSerialMovements.kind, "out"),
      ),
    );
  if (outRows.length === 0) return;

  const outBySerial = new Map(outRows.map((row) => [row.serialId, row]));
  const serialIds = [...outBySerial.keys()];
  const allMovements = await tx
    .select({
      serialId: stockSerialMovements.serialId,
      kind: stockSerialMovements.kind,
      referenceId: stockSerialMovements.referenceId,
    })
    .from(stockSerialMovements)
    .where(
      and(
        eq(stockSerialMovements.companyId, input.companyId),
        inArray(stockSerialMovements.serialId, serialIds),
      ),
    )
    .orderBy(desc(stockSerialMovements.createdAt), desc(stockSerialMovements.id));
  const latestBySerial = new Map<string, (typeof allMovements)[number]>();
  for (const movement of allMovements) {
    if (!latestBySerial.has(movement.serialId)) latestBySerial.set(movement.serialId, movement);
  }

  for (const serialId of serialIds) {
    const out = outBySerial.get(serialId);
    const latest = latestBySerial.get(serialId);
    if (!out || !latest) continue;
    // Gerakan terakhir harus milik dokumen ini (out atau transfer_in
    // karantina). Bila tidak, seri sudah bergerak lagi — jangan sentuh.
    if (latest.referenceId !== input.documentId) continue;
    if (latest.kind !== "out" && latest.kind !== "transfer_in") continue;

    const [serial] = await tx
      .select()
      .from(stockSerials)
      .where(
        and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, serialId)),
      )
      .limit(1)
      .for("update");
    if (!serial) continue;
    if (serial.status === "in_stock" && serial.warehouseId === out.warehouseId) continue;

    await tx
      .update(stockSerials)
      .set({ status: "in_stock", warehouseId: out.warehouseId, updatedAt: new Date() })
      .where(
        and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, serialId)),
      );
    await recordSerialMovement(tx, {
      companyId: input.companyId,
      serialId,
      productId: serial.productId,
      kind: "restore",
      warehouseId: out.warehouseId,
      referenceType: "stock_document_void",
      referenceId: input.documentId,
      referenceNumber: input.documentNumber,
      note: input.note ?? "Dokumen stok dibatalkan",
      userId: input.userId,
    });
  }
}


/**
 * Pulihkan seri yang disebutkan eksplisit oleh retur penjualan. Setiap
 * seri harus benar-benar keluar oleh penjualan asal (movement out dengan
 * referenceId sale) dan masih berstatus out; seri milik penjualan lain
 * tidak dapat dipulihkan lewat retur ini.
 */
export async function restoreSaleSerials(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    saleId: string;
    productId: string;
    warehouseId: string;
    serialNumbers: string[];
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
  },
) {
  const serialNumbers = [
    ...new Set(input.serialNumbers.map((value) => value.trim()).filter(Boolean)),
  ];
  if (serialNumbers.length === 0) return 0;
  const rows = await tx
    .select({
      id: stockSerials.id,
      serialNumber: stockSerials.serialNumber,
      status: stockSerials.status,
    })
    .from(stockSerials)
    .where(
      and(
        eq(stockSerials.companyId, input.companyId),
        eq(stockSerials.productId, input.productId),
        inArray(stockSerials.serialNumber, serialNumbers),
      ),
    );
  const byNumber = new Map(rows.map((row) => [row.serialNumber, row]));
  let restored = 0;
  for (const serialNumber of serialNumbers) {
    const initial = byNumber.get(serialNumber);
    if (!initial) {
      throw new AppError(
        "VALIDATION",
        `Nomor seri ${serialNumber} tidak sedang keluar untuk produk ini.`,
      );
    }
    const [serial] = await tx
      .select({ id: stockSerials.id, status: stockSerials.status })
      .from(stockSerials)
      .where(
        and(eq(stockSerials.companyId, input.companyId), eq(stockSerials.id, initial.id)),
      )
      .limit(1)
      .for("update");
    if (!serial || serial.status !== "out") {
      throw new AppError(
        "VALIDATION",
        `Nomor seri ${serialNumber} tidak sedang keluar untuk produk ini.`,
      );
    }
    const [movement] = await tx
      .select({ id: stockSerialMovements.id })
      .from(stockSerialMovements)
      .where(
        and(
          eq(stockSerialMovements.companyId, input.companyId),
          eq(stockSerialMovements.serialId, serial.id),
          eq(stockSerialMovements.kind, "out"),
          eq(stockSerialMovements.referenceId, input.saleId),
        ),
      )
      .limit(1);
    if (!movement) {
      throw new AppError(
        "VALIDATION",
        `Nomor seri ${serialNumber} bukan bagian dari penjualan asal ini.`,
      );
    }
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
    restored += 1;
  }
  return restored;
}
