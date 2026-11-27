"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { getSettings, listWarehouses, pickDefaultWarehouseId } from "@/server/catalog";
import {
  applyBulkEditProducts,
  findSimilarParties,
  mergeParties,
  previewBulkEditProducts,
  previewPartyMerge,
  type BulkProductOperation,
  type BulkProductSelection,
  type PartyKind,
} from "@/server/master-data";
import { requirePermissionInModule } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { parseInput } from "@/lib/action-validation";
import { todayISO } from "@/lib/format";
import type { Tx } from "@/db";

/**
 * SIM-2 Fase S3 — aksi master data massal (§18B/E). Pola repo: Zod +
 * requirePermission + guard; logika di src/server/master-data.ts.
 * Operasi massal WAJIB dua langkah: pratinjau (tanpa menulis) lalu
 * terapkan dengan konfirmasi eksplisit.
 */

async function resolveWarehouseId(
  tx: Tx,
  companyId: string,
  requested?: string,
): Promise<string> {
  const [settings, warehouses] = await Promise.all([
    getSettings(tx, companyId),
    listWarehouses(tx, companyId),
  ]);
  // Operasi massal harus memakai gudang yang sedang dilihat pengguna,
  // bukan diam-diam jatuh ke gudang default saat filter stok dipakai.
  if (requested && warehouses.some((warehouse) => warehouse.id === requested)) {
    return requested;
  }
  return pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId);
}

const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ids"), ids: z.array(z.string().uuid()).min(1).max(5000) }),
  z.object({
    mode: z.literal("filter"),
    q: z.string().max(120).optional(),
    categoryId: z.string().uuid().optional(),
    lowStock: z.boolean().optional(),
    warehouseId: z.string().uuid().optional(),
  }),
]);

const operationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("price"),
    target: z.enum(["salePrice", "costPrice"]),
    mode: z.enum(["percent", "nominal"]),
    value: z.string().regex(/^-?\d+(\.\d+)?$/, "Nilai harus berupa angka (boleh negatif untuk penurunan)."),
  }),
  z.object({ kind: z.literal("category"), categoryId: z.string().uuid().nullable() }),
  z.object({ kind: z.literal("unit"), unitId: z.string().uuid() }),
  z.object({ kind: z.literal("active"), isActive: z.boolean() }),
  z.object({
    kind: z.literal("minStock"),
    value: z.string().regex(/^\d+(\.\d+)?$/, "Stok minimum harus berupa angka nol atau positif."),
  }),
]);

const bulkEditSchema = z.object({
  selection: selectionSchema,
  operation: operationSchema,
});

export async function previewBulkEditProductsAction(input: z.input<typeof bulkEditSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(bulkEditSchema, input);
    return withCompanyReadOnly(ctx.company.id, async (tx) => {
      const warehouseId = await resolveWarehouseId(
        tx,
        ctx.company.id,
        data.selection.mode === "filter" ? data.selection.warehouseId : undefined,
      );
      return previewBulkEditProducts(tx, {
        companyId: ctx.company.id,
        warehouseId,
        selection: data.selection as BulkProductSelection,
        operation: data.operation as BulkProductOperation,
      });
    });
  });
}

const applyBulkEditSchema = bulkEditSchema.extend({
  // Konfirmasi eksplisit pengguna sesudah melihat pratinjau — server
  // menolak penerapan tanpa tanda ini.
  confirm: z.literal(true),
});

const checkSimilaritySchema = z.object({
  kind: z.enum(["supplier", "customer"]),
  name: z.string().min(1).max(160),
  phone: z.string().max(40).nullish(),
  taxId: z.string().max(40).nullish(),
  excludeId: z.string().uuid().optional(),
});

const mergePreviewSchema = z.object({
  kind: z.enum(["supplier", "customer"]),
  primaryId: z.string().uuid(),
  duplicateId: z.string().uuid(),
});

/**
 * Pratinjau merge pihak (§18G): saldo kedua pihak, saldo gabungan, dan
 * jumlah referensi yang akan berpindah — tanpa mengubah data.
 */
export async function previewPartyMergeAction(input: z.input<typeof mergePreviewSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.view", "gudang");
    const data = parseInput(mergePreviewSchema, input);
    return withCompanyReadOnly(ctx.company.id, (tx) =>
      previewPartyMerge(tx, ctx.company.id, data.kind as PartyKind, data.primaryId, data.duplicateId),
    );
  });
}

const mergePartySchema = mergePreviewSchema.extend({
  // Konfirmasi eksplisit sesudah pratinjau — sama seperti bulk-edit.
  confirm: z.literal(true),
});

/**
 * Gabung duplikat ke record utama (§18G): satu transaksi, referensi
 * dipetakan ulang, duplikat dinonaktifkan dengan catatan (tidak
 * dihapus), audit lengkap di kedua record.
 */
export async function mergePartyAction(input: z.input<typeof mergePartySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(mergePartySchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      mergeParties(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        kind: data.kind as PartyKind,
        primaryId: data.primaryId,
        duplicateId: data.duplicateId,
        today: todayISO(),
      }),
    );
    revalidatePath("/app/gudang/pemasok");
    revalidatePath("/app/gudang/pemasok/duplikat");
    return result;
  });
}

/**
 * Peringatan lembut duplikat (§18G): mengembalikan pihak lain yang
 * namanya sangat mirip / kontaknya sama. Hanya membaca — formulir
 * menampilkan peringatan dan pengguna yang memutuskan tetap menyimpan.
 */
export async function checkPartySimilarityAction(input: z.input<typeof checkSimilaritySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.view", "gudang");
    const data = parseInput(checkSimilaritySchema, input);
    return withCompanyReadOnly(ctx.company.id, (tx) =>
      findSimilarParties(tx, ctx.company.id, data.kind as PartyKind, {
        name: data.name,
        phone: data.phone ?? null,
        taxId: data.taxId ?? null,
        excludeId: data.excludeId,
      }),
    );
  });
}

export async function applyBulkEditProductsAction(input: z.input<typeof applyBulkEditSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(applyBulkEditSchema, input);
    // MD-009: Operasi perubahan harga massal wajib memiliki izin inventory.price
    if (data.operation.kind === "price" && !can(ctx, "inventory.price")) {
      throw new AppError(
        "FORBIDDEN",
        "Mengubah harga jual atau harga pokok massal memerlukan izin Ubah harga produk ('inventory.price') (peran manajer ke atas).",
      );
    }
    const result = await withCompany(ctx.company.id, async (tx) => {
      const warehouseId = await resolveWarehouseId(
        tx,
        ctx.company.id,
        data.selection.mode === "filter" ? data.selection.warehouseId : undefined,
      );
      return applyBulkEditProducts(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId,
        selection: data.selection as BulkProductSelection,
        operation: data.operation as BulkProductOperation,
      });
    });
    revalidatePath("/app/gudang/produk");
    return {
      appliedCount: result.applied.length,
      applied: result.applied.slice(0, 100),
      skipped: result.skipped,
      unchangedCount: result.unchangedCount,
    };
  });
}
