// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: pesanan ditahan (holdSale) dipisah dari sales.ts.

import type { Tx } from "@/db";
import { and, eq } from "drizzle-orm";
import { saleLines, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { toDb } from "@/lib/money";
import { writeAudit } from "@/server/audit";
import {
  claimIdempotencyKey,
  paymentRequestFingerprint,
  readIdempotencyResultRef,
  writeIdempotencyResultRef,
} from "@/server/idempotency";
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
    dueDate?: string | null;
    label?: string | null;
    notes?: string;
    lines: CartLineInput[];
    canDiscount?: boolean;
    idempotencyKey?: string;
  },
) {
  const requestedLabel = input.label?.trim() ?? "";
  if (requestedLabel.length > 80) {
    throw new AppError("VALIDATION", "Nama pesanan maksimal 80 karakter.");
  }
  const fingerprint = paymentRequestFingerprint({
    userId: input.userId,
    warehouseId: input.warehouseId,
    customerId: input.customerId ?? null,
    dueDate: input.dueDate ?? null,
    groupId: input.groupId ?? null,
    label: requestedLabel,
    notes: input.notes ?? null,
    lines: input.lines,
  });
  if (input.idempotencyKey) {
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: input.idempotencyKey,
      scope: "pos.hold",
    });
    if (!claimed) {
      const resultRef = await readIdempotencyResultRef(tx, {
        companyId: input.companyId,
        scope: "pos.hold",
        key: input.idempotencyKey,
      });
      let replay: { type?: unknown; fingerprint?: unknown; saleId?: unknown; number?: unknown } | null = null;
      try {
        replay = resultRef ? JSON.parse(resultRef) : null;
      } catch {
        replay = null;
      }
      if (
        !replay ||
        replay.type !== "pos-held-sale-result" ||
        typeof replay.fingerprint !== "string" ||
        typeof replay.saleId !== "string" ||
        typeof replay.number !== "string"
      ) {
        throw new AppError(
          "CONFLICT",
          "Percobaan tahan sebelumnya belum memiliki hasil yang dapat dipulihkan. Periksa daftar pesanan ditahan sebelum mencoba ulang.",
        );
      }
      if (replay.fingerprint !== fingerprint) {
        throw new AppError("CONFLICT", "Kunci tahan pesanan sudah digunakan untuk isi keranjang yang berbeda.");
      }
      const [existingSale] = await tx
        .select({ id: sales.id, number: sales.number, status: sales.status })
        .from(sales)
        .where(and(eq(sales.companyId, input.companyId), eq(sales.id, replay.saleId)))
        .limit(1);
      if (!existingSale || existingSale.status !== "held" || existingSale.number !== replay.number) {
        throw new AppError(
          "CONFLICT",
          "Pesanan dari percobaan sebelumnya sudah tidak tersedia sebagai pesanan ditahan. Keranjang tetap dipertahankan; periksa daftar pesanan ditahan.",
        );
      }
      return { id: existingSale.id, number: existingSale.number };
    }
  }
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
  const label = requestedLabel || `Pesanan ${number}`;
  const [sale] = await tx
    .insert(sales)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      number,
      date: input.date,
      dueDate: input.dueDate ?? null,
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
      heldLabel: label,
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
      serialNumbers: line.serialNumbers,
    })),
  );

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.hold",
    entityType: "sale",
    entityId: sale.id,
    after: { number: sale.number, label },
  });

  if (input.idempotencyKey) {
    await writeIdempotencyResultRef(tx, {
      companyId: input.companyId,
      scope: "pos.hold",
      key: input.idempotencyKey,
      resultRef: JSON.stringify({
          type: "pos-held-sale-result",
          fingerprint,
          saleId: sale.id,
          number: sale.number,
      }),
    });
  }

  return sale;
}

export async function deleteHeldSale(
  tx: Tx,
  input: { companyId: string; userId: string; saleId: string; canDeleteAny: boolean },
) {
  const [sale] = await tx
    .select({
      status: sales.status,
      cashierId: sales.cashierId,
      number: sales.number,
      heldLabel: sales.heldLabel,
    })
    .from(sales)
    .where(and(eq(sales.companyId, input.companyId), eq(sales.id, input.saleId)))
    .limit(1)
    .for("update");
  if (!sale || sale.status !== "held") {
    throw new AppError("NOT_FOUND", "Pesanan ditahan tidak ditemukan.");
  }
  if (sale.cashierId !== input.userId && !input.canDeleteAny) {
    throw new AppError(
      "FORBIDDEN",
      "Pesanan ditahan hanya dapat dihapus oleh kasir yang menahannya atau supervisor.",
    );
  }

  await tx.delete(saleLines).where(
    and(eq(saleLines.companyId, input.companyId), eq(saleLines.saleId, input.saleId)),
  );
  const [deleted] = await tx
    .delete(sales)
    .where(
      and(
        eq(sales.companyId, input.companyId),
        eq(sales.id, input.saleId),
        eq(sales.status, "held"),
      ),
    )
    .returning({ id: sales.id });
  if (!deleted) throw new AppError("CONFLICT", "Pesanan berubah sebelum berhasil dihapus.");

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.held.delete",
    entityType: "sale",
    entityId: input.saleId,
    after: { number: sale.number, heldLabel: sale.heldLabel, cashierId: sale.cashierId },
  });
  return { id: input.saleId };
}

/** Convert an order hold only after its replacement sale has posted. */
export async function consumeHeldSale(
  tx: Tx,
  input: { companyId: string; userId: string; heldSaleId: string; completedSaleId: string },
) {
  const [held] = await tx
    .select({ id: sales.id, number: sales.number, heldLabel: sales.heldLabel, cashierId: sales.cashierId })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, input.companyId),
        eq(sales.id, input.heldSaleId),
        eq(sales.status, "held"),
      ),
    )
    .limit(1)
    .for("update");
  if (!held) throw new AppError("CONFLICT", "Pesanan tahan sudah berubah; penjualan tidak dapat diselesaikan.");

  await tx.delete(saleLines).where(
    and(eq(saleLines.companyId, input.companyId), eq(saleLines.saleId, input.heldSaleId)),
  );
  const [deleted] = await tx
    .delete(sales)
    .where(
      and(
        eq(sales.companyId, input.companyId),
        eq(sales.id, input.heldSaleId),
        eq(sales.status, "held"),
      ),
    )
    .returning({ id: sales.id });
  if (!deleted) throw new AppError("CONFLICT", "Pesanan tahan berubah saat penjualan diproses.");

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.held.consume",
    entityType: "sale",
    entityId: input.heldSaleId,
    after: {
      number: held.number,
      heldLabel: held.heldLabel,
      cashierId: held.cashierId,
      completedSaleId: input.completedSaleId,
    },
  });
}
