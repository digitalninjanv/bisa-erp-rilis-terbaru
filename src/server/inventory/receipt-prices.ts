import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { products } from "@/db/schema";
import { toDb, type Decimal } from "@/lib/money";
import { writeAudit } from "@/server/audit";
import type { ReceiptSource } from "./receipt-journal";

/**
 * Update harga jual master dari baris penerimaan pembelian. Hanya
 * berlaku untuk pembelian (bukan opening/bonus/retur) dan HANYA bila
 * pengguna secara eksplisit menyetujui (updateCatalogSalePrices = true)
 * — DATA-002: mencegah posting penerimaan menimpa harga jual katalog tanpa konfirmasi.
 */
export async function applyReceiptSalePrices(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    source: ReceiptSource;
    updateCatalogSalePrices?: boolean;
    lines: { productId: string; salePriceBase: Decimal | null }[];
  },
) {
  if (input.source !== "purchase" || !input.updateCatalogSalePrices) return;
  const updates = new Map<string, Decimal>();
  for (const line of input.lines) {
    if (line.salePriceBase && line.salePriceBase.gt(0)) {
      updates.set(line.productId, line.salePriceBase);
    }
  }
  for (const [productId, salePrice] of updates) {
    const [existing] = await tx
      .select({ salePrice: products.salePrice })
      .from(products)
      .where(and(eq(products.companyId, input.companyId), eq(products.id, productId)))
      .limit(1);

    await tx
      .update(products)
      .set({ salePrice: toDb(salePrice), updatedAt: new Date() })
      .where(and(eq(products.companyId, input.companyId), eq(products.id, productId)));

    await writeAudit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      action: "catalog.price_update",
      entityType: "product",
      entityId: productId,
      before: { salePrice: existing?.salePrice },
      after: { salePrice: toDb(salePrice), source: "receipt" },
    });
  }
}
