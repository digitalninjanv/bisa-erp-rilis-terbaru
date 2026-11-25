import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { posPromotions, products } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import type { PromotionRule } from "@/lib/pos/promotions";
import { writeAudit } from "@/server/audit";

export type PosPromotionRow = {
  id: string;
  name: string;
  type: "percent" | "nominal";
  value: string;
  minSubtotal: string;
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  active: boolean;
  createdAt: Date;
};

export async function listPosPromotions(tx: Tx, companyId: string): Promise<PosPromotionRow[]> {
  const rows = await tx
    .select({
      id: posPromotions.id,
      name: posPromotions.name,
      type: posPromotions.type,
      value: posPromotions.value,
      minSubtotal: posPromotions.minSubtotal,
      productId: posPromotions.productId,
      productName: products.name,
      productSku: products.sku,
      active: posPromotions.active,
      createdAt: posPromotions.createdAt,
    })
    .from(posPromotions)
    .leftJoin(products, and(eq(products.companyId, posPromotions.companyId), eq(products.id, posPromotions.productId)))
    .where(eq(posPromotions.companyId, companyId))
    .orderBy(asc(posPromotions.name));
  return rows.map((row) => ({
    ...row,
    type: row.type === "nominal" ? "nominal" : "percent",
  }));
}

export async function listActivePosPromotions(tx: Tx, companyId: string): Promise<PromotionRule[]> {
  const rows = await tx
    .select({
      id: posPromotions.id,
      name: posPromotions.name,
      type: posPromotions.type,
      value: posPromotions.value,
      minSubtotal: posPromotions.minSubtotal,
      productId: posPromotions.productId,
    })
    .from(posPromotions)
    .where(and(eq(posPromotions.companyId, companyId), eq(posPromotions.active, true)))
    .orderBy(asc(posPromotions.name))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type === "nominal" ? "nominal" : "percent",
    value: Number(row.value),
    minSubtotal: Number(row.minSubtotal),
    productId: row.productId,
  }));
}

export async function savePosPromotion(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    id?: string;
    name: string;
    type: "percent" | "nominal";
    value: string | number;
    minSubtotal?: string | number;
    productId?: string | null;
    active?: boolean;
  },
) {
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("VALIDATION", "Nama promo minimal 2 karakter.");
  const value = d(input.value);
  if (!value.isFinite() || value.lte(0)) {
    throw new AppError("VALIDATION", "Nilai promo harus lebih dari nol.");
  }
  if (input.type === "percent" && value.gt(100)) {
    throw new AppError("VALIDATION", "Promo persen tidak boleh melebihi 100%.");
  }
  const minSubtotal = d(input.minSubtotal ?? 0);
  if (!minSubtotal.isFinite() || minSubtotal.lt(0)) {
    throw new AppError("VALIDATION", "Minimal subtotal tidak boleh negatif.");
  }
  if (input.productId) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.companyId, input.companyId), eq(products.id, input.productId)))
      .limit(1);
    if (!product) throw new AppError("NOT_FOUND", "Produk target promo tidak ditemukan.");
  }

  const values = {
    name,
    type: input.type,
    value: toDb(value),
    minSubtotal: toDb(minSubtotal),
    productId: input.productId ?? null,
    active: input.active ?? true,
  };

  if (input.id) {
    const [updated] = await tx
      .update(posPromotions)
      .set(values)
      .where(and(eq(posPromotions.companyId, input.companyId), eq(posPromotions.id, input.id)))
      .returning({ id: posPromotions.id });
    if (!updated) throw new AppError("NOT_FOUND", "Promo tidak ditemukan.");
    await writeAudit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      action: "pos.promotion.update",
      entityType: "pos_promotion",
      entityId: updated.id,
      after: values,
    });
    return updated;
  }

  const [created] = await tx
    .insert(posPromotions)
    .values({ companyId: input.companyId, ...values })
    .returning({ id: posPromotions.id });
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.promotion.create",
    entityType: "pos_promotion",
    entityId: created.id,
    after: values,
  });
  return created;
}

export async function togglePosPromotion(
  tx: Tx,
  input: { companyId: string; userId: string; id: string; active: boolean },
) {
  const [updated] = await tx
    .update(posPromotions)
    .set({ active: input.active })
    .where(and(eq(posPromotions.companyId, input.companyId), eq(posPromotions.id, input.id)))
    .returning({ id: posPromotions.id, name: posPromotions.name });
  if (!updated) throw new AppError("NOT_FOUND", "Promo tidak ditemukan.");
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: input.active ? "pos.promotion.activate" : "pos.promotion.deactivate",
    entityType: "pos_promotion",
    entityId: updated.id,
    after: { name: updated.name, active: input.active },
  });
  return updated;
}

export async function deletePosPromotion(
  tx: Tx,
  input: { companyId: string; userId: string; id: string },
) {
  const [deleted] = await tx
    .delete(posPromotions)
    .where(and(eq(posPromotions.companyId, input.companyId), eq(posPromotions.id, input.id)))
    .returning({ id: posPromotions.id, name: posPromotions.name });
  if (!deleted) throw new AppError("NOT_FOUND", "Promo tidak ditemukan.");
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.promotion.delete",
    entityType: "pos_promotion",
    entityId: deleted.id,
    before: { name: deleted.name },
  });
  return deleted;
}
