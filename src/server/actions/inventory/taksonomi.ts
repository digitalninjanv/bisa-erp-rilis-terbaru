// A-26 Q4 (K-03): pecahan src/server/actions/inventory.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  eq,
  ne,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  categories,
  products,
  units,
} from "@/db/schema";

import {
  assertCategoryDeactivatable,
  assertCategoryParent,
} from "@/server/catalog";

import { writeAudit } from "@/server/audit";
import { requirePermissionInModule } from "@/lib/session";

import {
  AppError,
  guard,
} from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";

const taxonomySchema = z.object({
  kind: z.enum(["category", "unit"]),
  name: z.string().min(1).max(80),
  code: z.string().max(20).optional(),
  // T5-3 (D-17): nested categories — optional parent for categories.
  parentId: z.string().uuid().nullable().optional(),
});

export async function createTaxonomyAction(input: z.input<typeof taxonomySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(taxonomySchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const name = data.name.trim();
      if (data.kind === "category") {
        // P3-4: konflik nama harus terlihat sebagai error, bukan tertelan
        // onConflictDoNothing yang mengembalikan null secara diam-diam.
        const [existing] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.companyId, ctx.company.id), eq(categories.name, name)))
          .limit(1);
        if (existing) {
          throw new AppError("CONFLICT", `Kategori "${name}" sudah ada. Gunakan nama lain.`);
        }
        const parentId = data.parentId ?? null;
        await assertCategoryParent(tx, ctx.company.id, { categoryId: null, parentId });
        const [row] = await tx
          .insert(categories)
          .values({ companyId: ctx.company.id, name, parentId })
          .returning({ id: categories.id });
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "category.create",
          entityType: "category",
          entityId: row.id,
          after: { name, parentId },
        });
        return row;
      }
      const code = (data.code ?? data.name).trim().toUpperCase();
      const [existing] = await tx
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.companyId, ctx.company.id), eq(units.code, code)))
        .limit(1);
      if (existing) {
        throw new AppError("CONFLICT", `Satuan dengan kode "${code}" sudah ada. Gunakan kode lain.`);
      }
      const [row] = await tx
        .insert(units)
        .values({ companyId: ctx.company.id, code, name })
        .returning({ id: units.id });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "unit.create",
        entityType: "unit",
        entityId: row.id,
        after: { code, name },
      });
      return row;
    });
    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/gudang/impor");
    return result;
  });
}

const taxonomyUpdateSchema = z.object({
  kind: z.enum(["category", "unit"]),
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  code: z.string().max(20).optional(),
  // T5-3 (D-17): omitted = keep current parent; null = back to root.
  parentId: z.string().uuid().nullable().optional(),
});

export async function updateTaxonomyAction(input: z.input<typeof taxonomyUpdateSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(taxonomyUpdateSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const name = data.name.trim();
      if (data.kind === "category") {
        const [current] = await tx
          .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
          .from(categories)
          .where(and(eq(categories.companyId, ctx.company.id), eq(categories.id, data.id)))
          .limit(1);
        if (!current) throw new AppError("NOT_FOUND", "Kategori tidak ditemukan.");
        const [duplicate] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.companyId, ctx.company.id),
              eq(categories.name, name),
              ne(categories.id, data.id),
            ),
          )
          .limit(1);
        if (duplicate) {
          throw new AppError("CONFLICT", `Kategori "${name}" sudah ada. Gunakan nama lain.`);
        }
        const parentId = data.parentId === undefined ? current.parentId : data.parentId;
        await assertCategoryParent(tx, ctx.company.id, { categoryId: data.id, parentId });
        await tx
          .update(categories)
          .set({ name, parentId })
          .where(and(eq(categories.companyId, ctx.company.id), eq(categories.id, data.id)));
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "category.update",
          entityType: "category",
          entityId: data.id,
          before: { name: current.name, parentId: current.parentId },
          after: { name, parentId },
        });
        return { id: data.id };
      }
      const [current] = await tx
        .select({ id: units.id, code: units.code, name: units.name })
        .from(units)
        .where(and(eq(units.companyId, ctx.company.id), eq(units.id, data.id)))
        .limit(1);
      if (!current) throw new AppError("NOT_FOUND", "Satuan tidak ditemukan.");
      const code = data.code ? data.code.trim().toUpperCase() : current.code;
      const [duplicate] = await tx
        .select({ id: units.id })
        .from(units)
        .where(
          and(eq(units.companyId, ctx.company.id), eq(units.code, code), ne(units.id, data.id)),
        )
        .limit(1);
      if (duplicate) {
        throw new AppError("CONFLICT", `Satuan dengan kode "${code}" sudah ada. Gunakan kode lain.`);
      }
      await tx
        .update(units)
        .set({ code, name })
        .where(and(eq(units.companyId, ctx.company.id), eq(units.id, data.id)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "unit.update",
        entityType: "unit",
        entityId: data.id,
        before: { code: current.code, name: current.name },
        after: { code, name },
      });
      return { id: data.id };
    });
    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/gudang/impor");
    return result;
  });
}

export async function toggleCategoryAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      // T5-3 (D-17): deactivating a category with active children is
      // rejected — the children would dangle under an inactive parent.
      if (!data.isActive) await assertCategoryDeactivatable(tx, ctx.company.id, data.id);
      const [updated] = await tx
        .update(categories)
        .set({ isActive: data.isActive })
        .where(and(eq(categories.companyId, ctx.company.id), eq(categories.id, data.id)))
        .returning({ id: categories.id });
      if (!updated) throw new AppError("NOT_FOUND", "Kategori tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "category.activate" : "category.deactivate",
        entityType: "category",
        entityId: data.id,
      });
    });
    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/gudang/impor");
    return data;
  });
}

export async function toggleUnitAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [updated] = await tx
        .update(units)
        .set({ isActive: data.isActive })
        .where(and(eq(units.companyId, ctx.company.id), eq(units.id, data.id)))
        .returning({ id: units.id });
      if (!updated) throw new AppError("NOT_FOUND", "Satuan tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "unit.activate" : "unit.deactivate",
        entityType: "unit",
        entityId: data.id,
      });
    });
    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/gudang/impor");
    return data;
  });
}

const taxonomyDeleteSchema = z.object({
  kind: z.enum(["category", "unit"]),
  id: z.string().uuid(),
});

export async function deleteTaxonomyAction(input: z.input<typeof taxonomyDeleteSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(taxonomyDeleteSchema, input);
    await withCompany(ctx.company.id, async (tx) => {
      if (data.kind === "category") {
        const [category] = await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.companyId, ctx.company.id), eq(categories.id, data.id)))
          .limit(1);
        if (!category) throw new AppError("NOT_FOUND", "Kategori tidak ditemukan.");
        const [used] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(products)
          .where(and(eq(products.companyId, ctx.company.id), eq(products.categoryId, data.id)));
        if ((used?.value ?? 0) > 0) {
          throw new AppError(
            "CONFLICT",
            `Kategori masih dipakai oleh ${used!.value} produk. Ganti kategori produk tersebut, atau nonaktifkan kategori ini.`,
          );
        }
        const [children] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(categories)
          .where(and(eq(categories.companyId, ctx.company.id), eq(categories.parentId, data.id)));
        if ((children?.value ?? 0) > 0) {
          throw new AppError(
            "CONFLICT",
            "Kategori masih menjadi induk kategori lain. Pindahkan sub-kategori terlebih dahulu.",
          );
        }
        await tx
          .delete(categories)
          .where(and(eq(categories.companyId, ctx.company.id), eq(categories.id, data.id)));
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "category.delete",
          entityType: "category",
          entityId: data.id,
          before: { name: category.name },
        });
        return;
      }
      const [unit] = await tx
        .select({ id: units.id, code: units.code, name: units.name })
        .from(units)
        .where(and(eq(units.companyId, ctx.company.id), eq(units.id, data.id)))
        .limit(1);
      if (!unit) throw new AppError("NOT_FOUND", "Satuan tidak ditemukan.");
      const [used] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.companyId, ctx.company.id), eq(products.unitId, data.id)));
      if ((used?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          `Satuan masih dipakai oleh ${used!.value} produk. Ganti satuan produk tersebut terlebih dahulu.`,
        );
      }
      await tx
        .delete(units)
        .where(and(eq(units.companyId, ctx.company.id), eq(units.id, data.id)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "unit.delete",
        entityType: "unit",
        entityId: data.id,
        before: { code: unit.code, name: unit.name },
      });
    });
    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/gudang/impor");
    return { id: data.id };
  });
}
