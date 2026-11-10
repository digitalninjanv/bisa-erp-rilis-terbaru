"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — kelompok pelanggan dan aturan harga per kelompok produk.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { accounts, customerGroupPrices, customerGroups, customers, products } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { toDb } from "@/lib/money";

const groupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  roundingStep: z.number().int().min(0).max(100_000),
  roundingDirection: z.enum(["down", "up", "nearest"]),
  roundCashTotal: z.boolean(),
  discountAccountId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});

export async function saveCustomerGroupAction(input: z.input<typeof groupSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(groupSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      if (data.discountAccountId) {
        const [account] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, data.discountAccountId)))
          .limit(1);
        if (!account) throw new AppError("NOT_FOUND", "Akun diskon tidak ditemukan.");
      }
      const values = {
        name: data.name,
        roundingStep: data.roundingStep,
        roundingDirection: data.roundingDirection,
        roundCashTotal: data.roundCashTotal,
        discountAccountId: data.discountAccountId ?? null,
        isActive: data.isActive ?? true,
        updatedAt: new Date(),
      };
      if (data.id) {
        const [existing] = await tx
          .select()
          .from(customerGroups)
          .where(and(eq(customerGroups.companyId, ctx.company.id), eq(customerGroups.id, data.id)))
          .limit(1);
        if (!existing) throw new AppError("NOT_FOUND", "Kelompok tidak ditemukan.");

        // MD-020: Jangan mengaktifkan kembali kelompok non-aktif jika isActive tidak dikirim
        const updateValues = {
          name: data.name,
          roundingStep: data.roundingStep,
          roundingDirection: data.roundingDirection,
          roundCashTotal: data.roundCashTotal,
          discountAccountId: data.discountAccountId !== undefined ? (data.discountAccountId ?? null) : existing.discountAccountId,
          isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
          updatedAt: new Date(),
        };

        const [row] = await tx
          .update(customerGroups)
          .set(updateValues)
          .where(and(eq(customerGroups.companyId, ctx.company.id), eq(customerGroups.id, data.id)))
          .returning({ id: customerGroups.id });

        // MD-018: Audit perubahan kelompok harga
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "customer_group.update",
          entityType: "customer_group",
          entityId: data.id,
          before: { name: existing.name, isActive: existing.isActive },
          after: { name: updateValues.name, isActive: updateValues.isActive },
        });

        return row;
      }
      const [row] = await tx
        .insert(customerGroups)
        .values({ companyId: ctx.company.id, ...values })
        .returning({ id: customerGroups.id });

      // MD-018: Audit pembuatan kelompok harga
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "customer_group.create",
        entityType: "customer_group",
        entityId: row.id,
        after: { name: values.name },
      });

      return row;
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return result;
  });
}

export async function deleteCustomerGroupAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const groupId = parseInput(z.string().uuid(), id);
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(customers)
        .set({ groupId: null })
        .where(and(eq(customers.companyId, ctx.company.id), eq(customers.groupId, groupId)));
      const [row] = await tx
        .delete(customerGroups)
        .where(and(eq(customerGroups.companyId, ctx.company.id), eq(customerGroups.id, groupId)))
        .returning({ id: customerGroups.id });
      if (!row) throw new AppError("NOT_FOUND", "Kelompok tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "customer_group.delete",
        entityType: "customer_group",
        entityId: groupId,
        before: { id: groupId },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return { id: groupId };
  });
}


const groupPriceSchema = z.object({
  groupId: z.string().uuid(),
  productId: z.string().uuid(),
  ruleType: z.enum(["normal", "percent", "fixed"]),
  value: z.union([z.string(), z.number()]).optional(),
});

/** Set or clear the price rule for one product inside a group. */
export async function saveGroupProductPriceAction(input: z.input<typeof groupPriceSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(groupPriceSchema, input);

    const result = await withCompany(ctx.company.id, async (tx) => {
      const [group] = await tx
        .select({ id: customerGroups.id })
        .from(customerGroups)
        .where(and(eq(customerGroups.companyId, ctx.company.id), eq(customerGroups.id, data.groupId)))
        .limit(1);
      if (!group) throw new AppError("NOT_FOUND", "Kelompok tidak ditemukan.");

      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.companyId, ctx.company.id), eq(products.id, data.productId)))
        .limit(1);
      if (!product) throw new AppError("NOT_FOUND", "Produk tidak ditemukan.");

      if (data.ruleType === "normal") {
        await tx
          .delete(customerGroupPrices)
          .where(
            and(
              eq(customerGroupPrices.companyId, ctx.company.id),
              eq(customerGroupPrices.groupId, data.groupId),
              eq(customerGroupPrices.productId, data.productId),
            ),
          );
        return { ruleType: "normal" as const };
      }

      const value = Number(data.value);
      if (!Number.isFinite(value) || value < 0) {
        throw new AppError("VALIDATION", "Nilai harga/diskon tidak boleh negatif.");
      }
      if (data.ruleType === "percent" && value > 100) {
        throw new AppError("VALIDATION", "Diskon persen maksimal 100%.");
      }

      await tx
        .insert(customerGroupPrices)
        .values({
          companyId: ctx.company.id,
          groupId: data.groupId,
          productId: data.productId,
          ruleType: data.ruleType,
          value: toDb(value),
        })
        .onConflictDoUpdate({
          target: [customerGroupPrices.companyId, customerGroupPrices.groupId, customerGroupPrices.productId],
          set: { ruleType: data.ruleType, value: toDb(value), updatedAt: new Date() },
        });

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "customer_group.price",
        entityType: "customer_group_price",
        entityId: data.productId,
        after: { groupId: data.groupId, productId: data.productId, ruleType: data.ruleType, value: toDb(value) },
      });
      return { ruleType: data.ruleType, value };
    });

    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return result;
  });
}


/** Remove every product rule for a group (keeps the group itself). */
export async function clearGroupProductPricesAction(groupId: string) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const id = parseInput(z.string().uuid(), groupId);
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .delete(customerGroupPrices)
        .where(
          and(
            eq(customerGroupPrices.companyId, ctx.company.id),
            eq(customerGroupPrices.groupId, id),
          ),
        );
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return { id };
  });
}
