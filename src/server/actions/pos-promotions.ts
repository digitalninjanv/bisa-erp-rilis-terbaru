"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { amountField, parseInput } from "@/lib/action-validation";
import { guard } from "@/lib/errors";
import { requirePermissionInModule } from "@/lib/session";
import { deletePosPromotion, savePosPromotion, togglePosPromotion } from "@/server/pos";

const savePromotionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Nama promo minimal 2 karakter.").max(120),
  type: z.enum(["percent", "nominal"]),
  value: amountField("Nilai promo", "positive"),
  minSubtotal: amountField("Minimal subtotal", "nonNegative").optional(),
  productId: z.string().uuid().nullish(),
  active: z.boolean().optional(),
});

export async function savePosPromotionAction(input: z.input<typeof savePromotionSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.discount", "pos");
    const data = parseInput(savePromotionSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      savePosPromotion(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        id: data.id,
        name: data.name,
        type: data.type,
        value: data.value,
        minSubtotal: data.minSubtotal ?? "0",
        productId: data.productId ?? null,
        active: data.active ?? true,
      }),
    );
    revalidatePath("/app/pos/promo");
    revalidatePath("/app/pos");
    return result;
  });
}

export async function togglePosPromotionAction(input: { id: string; active: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.discount", "pos");
    const data = parseInput(z.object({ id: z.string().uuid(), active: z.boolean() }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      togglePosPromotion(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        id: data.id,
        active: data.active,
      }),
    );
    revalidatePath("/app/pos/promo");
    revalidatePath("/app/pos");
    return result;
  });
}

export async function deletePosPromotionAction(input: { id: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.discount", "pos");
    const data = parseInput(z.object({ id: z.string().uuid() }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      deletePosPromotion(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        id: data.id,
      }),
    );
    revalidatePath("/app/pos/promo");
    revalidatePath("/app/pos");
    return result;
  });
}
