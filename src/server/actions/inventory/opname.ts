// A-26 Q4 (K-03): pecahan src/server/actions/inventory.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  eq,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { opnameTasks } from "@/db/schema";
import {
  cancelOpnameTask,
  completeOpnameTask,
  createOpname,
  createOpnameTask,
} from "@/server/inventory";

import { requirePermissionInModule } from "@/lib/session";
import { can } from "@/lib/permissions";

import {
  AppError,
  guard,
} from "@/lib/errors";
import {
  amountField,
  isoDateField,
  parseInput,
} from "@/lib/action-validation";

const opnameSchema = z.object({
  warehouseId: z.string().uuid(),
  date: isoDateField,
  notes: z.string().max(500).optional(),
  // GDG3-06: kunci idempotensi buatan form (UUID per pembukaan form).
  idempotencyKey: z.string().trim().min(1).max(80).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        countedQty: amountField("Jumlah terhitung", "nonNegative"),
        // Satuan Kemasan S3: komponen hitungan campuran (kemasan +
        // pcs lepas); domain menghitung totalnya secara otoritatif.
        countComponents: z
          .array(
            z.object({
              packagingId: z.string().uuid().optional().nullable(),
              qty: amountField("Jumlah komponen hitung", "nonNegative"),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .min(1),
});

export async function createOpnameAction(input: z.input<typeof opnameSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(opnameSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createOpname(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId: data.warehouseId,
        date: data.date,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey ?? null,
        lines: data.lines,
      }),
    );
    revalidatePath("/app/gudang/opname");
    revalidatePath("/app/gudang");
    return result;
  });
}

const opnameTaskSchema = z.object({
  warehouseId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  assigneeId: z.string().trim().min(1).max(120),
  dueDate: isoDateField.optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

/** A-24 T3 (pola G3): buat tugas opname untuk staf gudang. */
export async function createOpnameTaskAction(input: z.input<typeof opnameTaskSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(opnameTaskSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createOpnameTask(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId: data.warehouseId,
        categoryId: data.categoryId ?? null,
        assigneeId: data.assigneeId,
        dueDate: data.dueDate ?? null,
        notes: data.notes ?? null,
      }),
    );
    revalidatePath("/app/gudang/opname");
    revalidatePath("/app/gudang/operasi");
    return result;
  });
}

const opnameTaskIdSchema = z.object({ id: z.string().uuid() });

/** Selesaikan tugas: yang ditugasi boleh menyelesaikan tugasnya
 *  sendiri; pengguna lain harus berizin inventory.manage. */
export async function completeOpnameTaskAction(input: z.input<typeof opnameTaskIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.view", "gudang");
    const data = parseInput(opnameTaskIdSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const [task] = await tx
        .select({ assigneeId: opnameTasks.assigneeId })
        .from(opnameTasks)
        .where(and(eq(opnameTasks.companyId, ctx.company.id), eq(opnameTasks.id, data.id)))
        .limit(1);
      if (task && task.assigneeId !== ctx.user.id && !can(ctx, "inventory.manage")) {
        throw new AppError(
          "FORBIDDEN",
          "Tugas ini ditugaskan ke pengguna lain; hanya penanggung jawab atau pemegang izin kelola yang dapat menyelesaikannya.",
        );
      }
      return completeOpnameTask(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        taskId: data.id,
      });
    });
    revalidatePath("/app/gudang/opname");
    revalidatePath("/app/gudang/operasi");
    revalidatePath("/app/gudang");
    return result;
  });
}

export async function cancelOpnameTaskAction(input: z.input<typeof opnameTaskIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(opnameTaskIdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      cancelOpnameTask(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        taskId: data.id,
      }),
    );
    revalidatePath("/app/gudang/opname");
    revalidatePath("/app/gudang/operasi");
    return result;
  });
}
