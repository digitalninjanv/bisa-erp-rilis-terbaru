"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { guard } from "@/lib/errors";
import {
  amountField,
  isoDateField,
  parseInput,
} from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import {
  createPurchaseAdvance,
  listOpenPurchaseAdvancesForSupplier,
  voidPurchaseAdvance,
} from "@/server/purchase-advances";

const supplierSchema = z.object({ supplierId: z.string().uuid() });

/** Uang muka terbuka milik satu pemasok — dipakai form penerimaan. */
export async function listSupplierPurchaseAdvancesAction(
  input: z.input<typeof supplierSchema>,
) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.view", "gudang");
    const data = parseInput(supplierSchema, input);
    return withCompanyReadOnly(ctx.company.id, (tx) =>
      listOpenPurchaseAdvancesForSupplier(tx, ctx.company.id, data.supplierId),
    );
  });
}

const createSchema = z.object({
  supplierId: z.string().uuid(),
  date: isoDateField,
  amount: amountField("Nominal uang muka", "positive"),
  paymentAccountId: z.string().uuid(),
  taxInvoiceNumber: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(80).optional(),
});

export async function createPurchaseAdvanceAction(
  input: z.input<typeof createSchema>,
) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "gudang");
    const data = parseInput(createSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createPurchaseAdvance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        supplierId: data.supplierId,
        date: data.date,
        amount: data.amount,
        paymentAccountId: data.paymentAccountId,
        taxInvoiceNumber: data.taxInvoiceNumber,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey,
      }),
    );
    revalidatePath("/app/gudang/uang-muka");
    revalidatePath("/app/akuntansi");
    revalidatePath("/app/akuntansi/riwayat");
    return result;
  });
}

const voidSchema = z.object({
  advanceId: z.string().uuid(),
  date: isoDateField,
  reason: z.string().trim().min(3).max(200),
});

export async function voidPurchaseAdvanceAction(
  input: z.input<typeof voidSchema>,
) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "gudang");
    const data = parseInput(voidSchema, input);
    await withCompany(ctx.company.id, (tx) =>
      voidPurchaseAdvance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        advanceId: data.advanceId,
        date: data.date,
        reason: data.reason,
      }),
    );
    revalidatePath("/app/gudang/uang-muka");
    revalidatePath("/app/akuntansi");
    revalidatePath("/app/akuntansi/riwayat");
  });
}
