/**
 * Agregat baca TAKSONOMI (A-26 Q5, K-04) — pecahan src/server/catalog.ts:
 * kategori (daftar + penjaga induk/penonaktifan) dan satuan.
 * Badan kueri dipindah apa adanya.
 */
import { and, asc, count, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, units } from "@/db/schema";
import { AppError } from "@/lib/errors";

export async function listCategories(tx: Tx, companyId: string) {
  return tx
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), eq(categories.isActive, true)))
    .orderBy(asc(categories.name));
}

/**
 * T5-3 (D-17): validate a category parent assignment. The parent must
 * exist in the same company, must not be the category itself, and must
 * not be one of the category's own descendants (walking the ancestor
 * chain of the proposed parent must never meet the category). For a new
 * category (categoryId null) only the existence check applies.
 */
export async function assertCategoryParent(
  tx: Tx,
  companyId: string,
  input: { categoryId: string | null; parentId: string | null },
): Promise<void> {
  if (!input.parentId) return;
  if (input.categoryId && input.parentId === input.categoryId) {
    throw new AppError("VALIDATION", "Kategori tidak dapat menjadi induk bagi dirinya sendiri.");
  }
  const rows = await tx
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.companyId, companyId));
  const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
  if (!parentById.has(input.parentId)) {
    throw new AppError("VALIDATION", "Kategori induk tidak ditemukan di perusahaan ini.");
  }
  if (!input.categoryId) return;
  // Walk up from the proposed parent; meeting the category itself means
  // the assignment would close a cycle. The hop bound keeps corrupt
  // legacy chains from looping forever.
  let current: string | null = input.parentId;
  for (let hops = 0; current && hops < 100; hops += 1) {
    if (current === input.categoryId) {
      throw new AppError(
        "VALIDATION",
        "Induk tersebut adalah keturunan kategori ini — susunan kategori akan membentuk lingkaran. Pilih induk di luar keturunan kategori ini.",
      );
    }
    current = parentById.get(current) ?? null;
  }
}

/**
 * T5-3 (D-17): a category that still has ACTIVE sub-categories cannot be
 * deactivated — its children would dangle under an inactive parent and
 * vanish from pickers. Deactivate (or move) the children first.
 */
export async function assertCategoryDeactivatable(
  tx: Tx,
  companyId: string,
  categoryId: string,
): Promise<void> {
  const [child] = await tx
    .select({ value: count() })
    .from(categories)
    .where(
      and(
        eq(categories.companyId, companyId),
        eq(categories.parentId, categoryId),
        eq(categories.isActive, true),
      ),
    );
  if ((child?.value ?? 0) > 0) {
    throw new AppError(
      "CONFLICT",
      `Kategori masih memiliki ${child!.value} sub-kategori aktif. Nonaktifkan atau pindahkan sub-kategori tersebut terlebih dahulu.`,
    );
  }
}

export async function listUnits(tx: Tx, companyId: string) {
  // T5-2: only active units are offered in pickers (same rule as
  // categories); a product keeping an inactive unit resolves it via a
  // direct lookup on its detail page instead.
  return tx
    .select({ id: units.id, code: units.code, name: units.name })
    .from(units)
    .where(and(eq(units.companyId, companyId), eq(units.isActive, true)))
    .orderBy(asc(units.name));
}

export async function listAllCategories(tx: Tx, companyId: string) {
  return tx
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      isActive: categories.isActive,
    })
    .from(categories)
    .where(eq(categories.companyId, companyId))
    .orderBy(asc(categories.name));
}

export async function listAllUnits(tx: Tx, companyId: string) {
  return tx
    .select({ id: units.id, code: units.code, name: units.name, isActive: units.isActive })
    .from(units)
    .where(eq(units.companyId, companyId))
    .orderBy(asc(units.name));
}
