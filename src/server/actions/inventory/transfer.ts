// A-26 Q4 (K-03): pecahan src/server/actions/inventory.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";

import { createTransfer } from "@/server/inventory";

import { requirePermissionInModule } from "@/lib/session";

import { guard } from "@/lib/errors";
import {
  amountField,
  isoDateField,
  parseInput,
} from "@/lib/action-validation";

const transferSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  date: isoDateField,
  notes: z.string().max(500).optional(),
  // GDG3-06: kunci idempotensi buatan form (UUID per pembukaan form).
  idempotencyKey: z.string().trim().min(1).max(80).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: amountField("Jumlah transfer", "positive"),
        // Satuan Kemasan S3: kemasan baris; qty lalu berarti per kemasan.
        packagingId: z.string().uuid().optional().nullable(),
      }),
    )
    .min(1),
});

export async function createTransferAction(input: z.input<typeof transferSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(transferSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createTransfer(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        date: data.date,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey ?? null,
        lines: data.lines,
      }),
    );
    revalidatePath("/app/gudang/transfer");
    revalidatePath("/app/gudang");
    return result;
  });
}
