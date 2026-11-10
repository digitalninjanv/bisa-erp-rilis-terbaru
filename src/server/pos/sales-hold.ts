// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: pesanan ditahan (holdSale) dipisah dari sales.ts.

import type { Tx } from "@/db";
import { saleLines, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { toDb } from "@/lib/money";
import { writeAudit } from "@/server/audit";
import { nextDocumentNumber } from "@/server/sequences";
import { quoteCart } from "./quote";
import type { CartLineInput } from "./quote";

export async function holdSale(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    customerId?: string | null;
    // POS-HOLD-01: kelompok harga ikut disimpan agar harga yang
    // dijanjikan saat ditahan sama dengan yang dipakai saat checkout.
    groupId?: string | null;
    date: string;
    label: string;
    notes?: string;
    lines: CartLineInput[];
    canDiscount?: boolean;
  },
) {
  if (!input.label.trim()) throw new AppError("VALIDATION", "Nama pesanan wajib diisi.");
  const quote = await quoteCart(tx, {
    companyId: input.companyId,
    warehouseId: input.warehouseId,
    customerId: input.customerId,
    groupId: input.groupId,
    lines: input.lines,
    canDiscount: input.canDiscount,
  });
  // POS-HOLD-02: seri HOLD terpisah dari seri faktur SALE.
  const number = await nextDocumentNumber(tx, input.companyId, "HOLD", input.date);
  const [sale] = await tx
    .insert(sales)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      number,
      date: input.date,
      cashierId: input.userId,
      customerId: input.customerId ?? null,
      customerGroupId: quote.customerGroupId ?? null,
      status: "held",
      subtotal: toDb(quote.subtotal),
      discountTotal: toDb(quote.discountTotal),
      taxTotal: toDb(quote.taxTotal),
      roundingAdjustment: toDb(quote.roundingAdjustment),
      roundingMode: quote.roundingMode,
      total: toDb(quote.total),
      heldLabel: input.label,
      notes: input.notes,
      createdBy: input.userId,
    })
    .returning({ id: sales.id, number: sales.number });

  await tx.insert(saleLines).values(
    quote.lines.map((line, index) => ({
      companyId: input.companyId,
      saleId: sale.id,
      productId: line.productId,
      lineNo: index + 1,
      qty: toDb(line.qty),
      unitPrice: toDb(line.unitPrice),
      discountType: line.discountType,
      discountValue: toDb(line.discountValue),
      discountAmount: toDb(line.discountAmount),
      taxAmount: toDb(line.taxAmount),
      lineTotal: toDb(line.lineTotal),
      unitCost: toDb(line.unitCost),
      taxRate: toDb(line.taxRate),
      productName: line.name,
      productSku: line.sku,
      // S4: cuplikan kemasan ikut disimpan agar resume memulihkan
      // baris dalam bentuk masukannya ("1 Dus"), bukan 40 Pcs.
      packagingId: line.packagingId,
      qtyInput: toDb(line.qtyInput),
      isiSnapshot: line.isiSnapshot,
    })),
  );

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.hold",
    entityType: "sale",
    entityId: sale.id,
    after: { number: sale.number, label: input.label },
  });

  return sale;
}
