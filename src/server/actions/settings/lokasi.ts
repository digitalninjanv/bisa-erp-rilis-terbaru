"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — gudang dan cabang.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  branches,
  companySettings,
  opnameTasks,
  posTerminalSessionReviews,
  posTerminals,
  sales,
  stockDocuments,
  stockMovements,
  stockOnHand,
  stockReceipts,
  stockReservations,
  warehouses,
} from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";

const warehouseSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().uuid().nullish(),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(80),
  type: z.enum(["warehouse", "store", "quarantine"]),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function saveWarehouseAction(input: z.input<typeof warehouseSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(warehouseSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      // MD-005: validasi cabang milik perusahaan yang aktif
      if (data.branchId) {
        const [branch] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.companyId, ctx.company.id), eq(branches.id, data.branchId)))
          .limit(1);
        if (!branch) {
          throw new AppError("VALIDATION", "Cabang tidak ditemukan di perusahaan ini.");
        }
      }

      const values = {
        branchId: data.branchId ?? null,
        code: data.code.toUpperCase(),
        name: data.name,
        type: data.type,
        isDefault: data.isDefault ?? false,
        isActive: data.isActive ?? true,
      };
      if (data.isDefault) {
        await tx
          .update(warehouses)
          .set({ isDefault: false })
          .where(eq(warehouses.companyId, ctx.company.id));
      }
      if (data.id) {
        const [current] = await tx
          .select()
          .from(warehouses)
          .where(and(eq(warehouses.companyId, ctx.company.id), eq(warehouses.id, data.id)))
          .limit(1);
        if (!current) throw new AppError("NOT_FOUND", "Gudang tidak ditemukan.");

        // MD-020: Jangan mengaktifkan kembali gudang non-aktif jika isActive tidak dikirim
        const updateValues = {
          branchId: data.branchId !== undefined ? (data.branchId ?? null) : current.branchId,
          code: data.code ? data.code.toUpperCase() : current.code,
          name: data.name ?? current.name,
          type: data.type ?? current.type,
          isDefault: data.isDefault ?? current.isDefault,
          isActive: data.isActive !== undefined ? data.isActive : current.isActive,
        };

        const [row] = await tx
          .update(warehouses)
          .set(updateValues)
          .where(and(eq(warehouses.companyId, ctx.company.id), eq(warehouses.id, data.id)))
          .returning({ id: warehouses.id });

        // MD-018: Audit log perubahan gudang
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "warehouse.update",
          entityType: "warehouse",
          entityId: data.id,
          before: { code: current.code, name: current.name, isActive: current.isActive },
          after: { code: updateValues.code, name: updateValues.name, isActive: updateValues.isActive },
        });

        return row;
      }
      const [row] = await tx
        .insert(warehouses)
        .values({ companyId: ctx.company.id, ...values })
        .returning({ id: warehouses.id });

      // MD-018: Audit log pembuatan gudang
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "warehouse.create",
        entityType: "warehouse",
        entityId: row.id,
        after: { code: values.code, name: values.name, isDefault: values.isDefault },
      });

      return row;
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/gudang");
    return result;
  });
}

export async function toggleWarehouseAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [updated] = await tx
        .update(warehouses)
        .set({ isActive: data.isActive })
        .where(and(eq(warehouses.companyId, ctx.company.id), eq(warehouses.id, data.id)))
        .returning({ id: warehouses.id });
      if (!updated) throw new AppError("NOT_FOUND", "Gudang tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "warehouse.activate" : "warehouse.deactivate",
        entityType: "warehouse",
        entityId: data.id,
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/gudang");
    return data;
  });
}

export async function deleteWarehouseAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const warehouseId = parseInput(z.string().uuid(), id);
    await withCompany(ctx.company.id, async (tx) => {
      const [warehouse] = await tx
        .select({
          id: warehouses.id,
          code: warehouses.code,
          name: warehouses.name,
          isDefault: warehouses.isDefault,
        })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ctx.company.id), eq(warehouses.id, warehouseId)))
        .limit(1);
      if (!warehouse) throw new AppError("NOT_FOUND", "Gudang tidak ditemukan.");
      if (warehouse.isDefault) {
        throw new AppError(
          "CONFLICT",
          "Gudang utama tidak dapat dihapus. Jadikan gudang lain sebagai gudang utama terlebih dahulu.",
        );
      }
      const [settings] = await tx
        .select({ defaultWarehouseId: companySettings.defaultWarehouseId })
        .from(companySettings)
        .where(eq(companySettings.companyId, ctx.company.id))
        .limit(1);
      if (settings?.defaultWarehouseId === warehouseId) {
        throw new AppError(
          "CONFLICT",
          "Gudang ini adalah gudang default perusahaan. Ganti gudang default di Pengaturan terlebih dahulu.",
        );
      }
      const [stocked] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ctx.company.id),
            eq(stockOnHand.warehouseId, warehouseId),
            sql`${stockOnHand.qty} <> 0`,
          ),
        );
      if ((stocked?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang masih menyimpan stok produk. Kosongkan atau pindahkan stoknya terlebih dahulu, atau nonaktifkan gudang alih-alih menghapus.",
        );
      }
      const [movements] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockMovements)
        .where(and(eq(stockMovements.companyId, ctx.company.id), eq(stockMovements.warehouseId, warehouseId)));
      if ((movements?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang sudah memiliki riwayat pergerakan stok dan tidak dapat dihapus. Nonaktifkan gudang alih-alih menghapus.",
        );
      }
      const [sold] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(sales)
        .where(and(eq(sales.companyId, ctx.company.id), eq(sales.warehouseId, warehouseId)));
      if ((sold?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang sudah dipakai pada transaksi penjualan. Nonaktifkan gudang alih-alih menghapus.",
        );
      }
      const [receipts] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockReceipts)
        .where(and(eq(stockReceipts.companyId, ctx.company.id), eq(stockReceipts.warehouseId, warehouseId)));
      const [documents] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockDocuments)
        .where(and(eq(stockDocuments.companyId, ctx.company.id), eq(stockDocuments.warehouseId, warehouseId)));
      if ((receipts?.value ?? 0) > 0 || (documents?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang sudah dipakai pada dokumen gudang (penerimaan/penyesuaian/transfer/opname). Nonaktifkan gudang alih-alih menghapus.",
        );
      }

      // WF-018 & MD-002: cek referensi gudang tujuan transfer, terminal POS, review sesi, opname task, dan reservasi
      const [destTransfer] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockDocuments)
        .where(and(eq(stockDocuments.companyId, ctx.company.id), eq(stockDocuments.toWarehouseId, warehouseId)));
      if ((destTransfer?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang sudah menjadi tujuan transfer barang dari gudang lain. Nonaktifkan gudang alih-alih menghapus.",
        );
      }
      const [terminals] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(posTerminals)
        .where(and(eq(posTerminals.companyId, ctx.company.id), eq(posTerminals.warehouseId, warehouseId)));
      if ((terminals?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang terikat pada terminal POS. Lepaskan atau ubah gudang pada terminal terlebih dahulu.",
        );
      }
      const [reviews] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(posTerminalSessionReviews)
        .where(and(eq(posTerminalSessionReviews.companyId, ctx.company.id), eq(posTerminalSessionReviews.warehouseId, warehouseId)));
      if ((reviews?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang memiliki riwayat peninjauan sesi terminal kasir. Nonaktifkan gudang alih-alih menghapus.",
        );
      }
      const [tasks] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(opnameTasks)
        .where(and(eq(opnameTasks.companyId, ctx.company.id), eq(opnameTasks.warehouseId, warehouseId)));
      if ((tasks?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang memiliki penugasan stock opname. Selesaikan atau batalkan tugas terlebih dahulu.",
        );
      }
      const [reservations] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockReservations)
        .where(and(eq(stockReservations.companyId, ctx.company.id), eq(stockReservations.warehouseId, warehouseId)));
      if ((reservations?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Gudang masih memiliki alokasi reservasi stok. Batalkan reservasi terlebih dahulu.",
        );
      }

      // Only zero-qty on-hand leftovers can remain at this point.
      await tx
        .delete(stockOnHand)
        .where(and(eq(stockOnHand.companyId, ctx.company.id), eq(stockOnHand.warehouseId, warehouseId)));
      await tx
        .delete(warehouses)
        .where(and(eq(warehouses.companyId, ctx.company.id), eq(warehouses.id, warehouseId)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "warehouse.delete",
        entityType: "warehouse",
        entityId: warehouseId,
        before: { code: warehouse.code, name: warehouse.name },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/gudang");
    revalidatePath("/app/pos");
    return { id: warehouseId };
  });
}

const branchSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(80),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  isDefault: z.boolean().optional(),
});

export async function saveBranchAction(input: z.input<typeof branchSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(branchSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      if (data.isDefault) {
        await tx.update(branches).set({ isDefault: false }).where(eq(branches.companyId, ctx.company.id));
      }
      const values = {
        code: data.code.toUpperCase(),
        name: data.name,
        address: data.address,
        phone: data.phone,
        isDefault: data.isDefault ?? false,
      };
      if (data.id) {
        // S3 (§18I): simpan cabang ikut teraudit before/after seperti
        // master lain (sebelumnya save cabang tidak menulis audit sama
        // sekali — temuan S0-B).
        const [current] = await tx
          .select()
          .from(branches)
          .where(and(eq(branches.companyId, ctx.company.id), eq(branches.id, data.id)))
          .limit(1);
        const [row] = await tx
          .update(branches)
          .set(values)
          .where(and(eq(branches.companyId, ctx.company.id), eq(branches.id, data.id)))
          .returning({ id: branches.id });
        if (row && current) {
          await writeAudit(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            action: "branch.update",
            entityType: "branch",
            entityId: row.id,
            before: {
              code: current.code,
              name: current.name,
              address: current.address,
              phone: current.phone,
              isDefault: current.isDefault,
            },
            after: values,
          });
        }
        return row;
      }
      const [row] = await tx
        .insert(branches)
        .values({ companyId: ctx.company.id, ...values })
        .returning({ id: branches.id });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "branch.create",
        entityType: "branch",
        entityId: row.id,
        after: values,
      });
      return row;
    });
    revalidatePath("/app/pengaturan");
    return result;
  });
}
