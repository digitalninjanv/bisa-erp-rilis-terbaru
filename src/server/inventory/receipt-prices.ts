import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { products } from "@/db/schema";
import { toDb, type Decimal } from "@/lib/money";
import type { ReceiptSource } from "./receipt-journal";

/**
 * Update harga jual master dari baris penerimaan pembelian. Hanya
 * berlaku untuk pembelian (bukan opening/bonus/retur) dan hanya bila
 * baris memang membawa harga jual — harga pokok sudah otomatis
 * menjadi moving average lewat pergerakan stok.
 */
export async function applyReceiptSalePrices(
  tx: Tx,
  input: {
    companyId: string;
    source: ReceiptSource;
    lines: { productId: string; salePriceBase: Decimal | null }[];
  },
) {
  if (input.source !== "purchase") return;
  const updates = new Map<string, Decimal>();
  for (const line of input.lines) {
    if (line.salePriceBase && line.salePriceBase.gt(0)) {
      updates.set(line.productId, line.salePriceBase);
    }
  }
  for (const [productId, salePrice] of updates) {
    await tx
      .update(products)
      .set({ salePrice: toDb(salePrice), updatedAt: new Date() })
      .where(and(eq(products.companyId, input.companyId), eq(products.id, productId)));
  }
}
