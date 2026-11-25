"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createPurchaseOrdersFromRecommendations,
  listOpenPurchaseOrdersForSupplier,
  listPurchaseRecommendations,
  sendPurchaseOrder,
} from "@/server/purchasing";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { guard } from "@/lib/errors";
import { amountField, isoDateField, parseInput } from "@/lib/action-validation";

const purchaseOrderSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  supplierId: z.string().uuid("Pemasok wajib dipilih."),
  date: isoDateField,
  expectedDate: isoDateField.nullish(),
  notes: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: amountField("Jumlah pesanan", "positive"),
        unitCost: amountField("Harga beli", "nonNegative"),
        // S2: kemasan baris — qty & harga menjadi per kemasan
        // (konversi ke satuan dasar di domain).
        packagingId: z.string().uuid().nullish(),
      }),
    )
    .min(1, "Tambahkan minimal satu barang."),
});

export async function savePurchaseOrderAction(input: z.input<typeof purchaseOrderSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(purchaseOrderSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createPurchaseOrder(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        supplierId: data.supplierId,
        date: data.date,
        expectedDate: data.expectedDate ?? null,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey ?? null,
        lines: data.lines.map((line) => ({ ...line, packagingId: line.packagingId ?? null })),
      }),
    );
    revalidatePath("/app/gudang/pembelian");
    revalidatePath("/app/gudang");
    return result;
  });
}

const orderIdSchema = z.object({ id: z.string().uuid() });

export async function sendPurchaseOrderAction(input: z.input<typeof orderIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(orderIdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      sendPurchaseOrder(tx, { companyId: ctx.company.id, userId: ctx.user.id, orderId: data.id }),
    );
    revalidatePath("/app/gudang/pembelian");
    revalidatePath(`/app/gudang/pembelian/${data.id}`);
    return result;
  });
}

export async function cancelPurchaseOrderAction(input: z.input<typeof orderIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(orderIdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      cancelPurchaseOrder(tx, { companyId: ctx.company.id, userId: ctx.user.id, orderId: data.id }),
    );
    revalidatePath("/app/gudang/pembelian");
    revalidatePath(`/app/gudang/pembelian/${data.id}`);
    revalidatePath("/app/gudang/penerimaan");
    return result;
  });
}

export async function listOpenPurchaseOrdersAction(input: { supplierId: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.view", "gudang");
    const data = parseInput(z.object({ supplierId: z.string().uuid() }), input);
    return withCompany(ctx.company.id, (tx) =>
      listOpenPurchaseOrdersForSupplier(tx, ctx.company.id, data.supplierId),
    );
  });
}

export async function listPurchaseRecommendationsAction() {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.view", "gudang");
    return withCompany(ctx.company.id, (tx) => listPurchaseRecommendations(tx, ctx.company.id));
  });
}

const fromRecommendationsSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu produk."),
});

export async function createOrdersFromRecommendationsAction(
  input: z.input<typeof fromRecommendationsSchema>,
) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(fromRecommendationsSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createPurchaseOrdersFromRecommendations(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        date: todayISO(),
        productIds: data.productIds,
      }),
    );
    revalidatePath("/app/gudang/rekomendasi");
    revalidatePath("/app/gudang/pembelian");
    revalidatePath("/app/gudang");
    return result;
  });
}
