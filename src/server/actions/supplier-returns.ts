"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { AppError, guard } from "@/lib/errors";
import { amountField, isoDateField, parseInput } from "@/lib/action-validation";
import { can } from "@/lib/permissions";
import { requireAuth, requirePermission, requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { d } from "@/lib/money";
import { listBatches } from "@/server/batches";
import { getStock } from "@/server/inventory";
import {
  applySupplierCredit,
  convertSupplierCreditToAdvance,
  createSupplierReturn,
  deleteSupplierReturn,
  postSupplierReturn,
  receiveReplacement,
  refundSupplierReturn,
  resolveSupplierReturnOther,
  voidPostedSupplierReturn,
} from "@/server/supplier-returns";

/**
 * A-9 (D-20): Retur Pembelian ke Pemasok — actions. Document lifecycle
 * (create/post/delete/void/replacement receipt) belongs to the Gudang
 * module (inventory.manage); money settlements against the claim
 * (apply credit / refund / other close) may also be recorded by
 * accounting.post holders, mirroring payOpeningBalanceAction's dual
 * permission for party money movements.
 */

function revalidateReturnPaths() {
  revalidatePath("/app/gudang");
  revalidatePath("/app/gudang/retur-pembelian");
  revalidatePath("/app/gudang/uang-muka");
  revalidatePath("/app/akuntansi/piutang-utang");
  revalidatePath("/app/akuntansi");
}

async function requireReturnSettlementPermission() {
  const ctx = await requireAuth();
  // SIM-2 S6 (SEC-10): izin ganda kini juga menghormati saklar modul
  // perusahaan (D-16), seperti aksi tulis lain lewat
  // requirePermissionInModule — jalur akuntansi mensyaratkan modul
  // akuntansi aktif, jalur gudang mensyaratkan modul gudang aktif.
  // enabledModules yang absen (konteks lama) diperlakukan semua aktif,
  // mengikuti kelonggaran sanitizeEnabledModules.
  const enabled = ctx.enabledModules ?? ["pos", "gudang", "akuntansi"];
  const viaAccounting = can(ctx, "accounting.post") && enabled.includes("akuntansi");
  const viaInventory = can(ctx, "inventory.manage") && enabled.includes("gudang");
  if (!viaAccounting && !viaInventory) {
    throw new AppError(
      "FORBIDDEN",
      "Anda tidak memiliki izin menyelesaikan klaim retur pembelian.",
    );
  }
  return ctx;
}

const productInfoSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
});

/**
 * RET-2 (UI): stock on hand + live batches of one product in one
 * warehouse, for the create form's line editor (available-stock hint
 * and the batch picker). Read-only.
 */
export async function supplierReturnProductInfoAction(input: z.input<typeof productInfoSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.view");
    const data = parseInput(productInfoSchema, input);
    return withCompany(ctx.company.id, async (tx) => {
      const stock = await getStock(tx, ctx.company.id, data.warehouseId, [data.productId]);
      const batches = await listBatches(tx, ctx.company.id, data.productId, data.warehouseId);
      return {
        stock: stock.get(data.productId) ?? 0,
        batches: batches
          .filter((batch) => d(batch.qty).gt(0))
          .map((batch) => ({
            id: batch.id,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            qty: batch.qty,
          })),
      };
    });
  });
}

const createReturnSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  date: isoDateField,
  reasonCategory: z.enum(["damaged", "expired", "wrong_item", "over_delivery", "quality", "other"]),
  reasonDetail: z.string().trim().min(3).max(500),
  resolutionType: z.enum(["replacement", "next_purchase_credit", "purchase_advance", "refund", "other"]),
  resolutionNote: z.string().max(500).optional(),
  // GDG3-06: kunci idempotensi buatan form (UUID per pembukaan form).
  idempotencyKey: z.string().trim().min(1).max(80).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: amountField("Jumlah", "positive"),
        batchId: z.string().uuid().nullish(),
        receiptLineId: z.string().uuid().nullish(),
        // S2: qty dinyatakan dalam kemasan ini; bersama receiptLineId
        // yang kemasannya sama, faktornya adalah cuplikan baris asal.
        packagingId: z.string().uuid().nullish(),
      }),
    )
    .min(1),
});

export async function createSupplierReturnAction(input: z.input<typeof createReturnSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(createReturnSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createSupplierReturn(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        supplierId: data.supplierId,
        warehouseId: data.warehouseId,
        date: data.date,
        reasonCategory: data.reasonCategory,
        reasonDetail: data.reasonDetail,
        resolutionType: data.resolutionType,
        resolutionNote: data.resolutionNote,
        idempotencyKey: data.idempotencyKey ?? null,
        lines: data.lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          batchId: line.batchId ?? null,
          receiptLineId: line.receiptLineId ?? null,
          packagingId: line.packagingId ?? null,
        })),
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

const returnIdSchema = z.object({ returnId: z.string().uuid() });

export async function postSupplierReturnAction(input: z.input<typeof returnIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(returnIdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      postSupplierReturn(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

export async function deleteSupplierReturnAction(input: z.input<typeof returnIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(returnIdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      deleteSupplierReturn(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

const voidReturnSchema = z.object({
  returnId: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
});

export async function voidSupplierReturnAction(input: z.input<typeof voidReturnSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(voidReturnSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      voidPostedSupplierReturn(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
        reason: data.reason,
        date: todayISO(),
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

const applyCreditSchema = z.object({
  returnId: z.string().uuid(),
  amount: amountField("Nominal kredit", "positive"),
  date: isoDateField.optional(),
  targetReceiptId: z.string().uuid().nullish(),
  targetOpeningId: z.string().uuid().nullish(),
});

export async function applySupplierCreditAction(input: z.input<typeof applyCreditSchema>) {
  return guard(async () => {
    const ctx = await requireReturnSettlementPermission();
    const data = parseInput(applyCreditSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      applySupplierCredit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
        amount: data.amount,
        date: data.date ?? todayISO(),
        targetReceiptId: data.targetReceiptId ?? null,
        targetOpeningId: data.targetOpeningId ?? null,
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

const convertToAdvanceSchema = z.object({
  returnId: z.string().uuid(),
  date: isoDateField.optional(),
  notes: z.string().trim().max(500).optional(),
});

/** Ubah seluruh sisa klaim retur menjadi uang muka pembelian pemasok yang sama. */
export async function convertSupplierCreditToAdvanceAction(
  input: z.input<typeof convertToAdvanceSchema>,
) {
  return guard(async () => {
    const ctx = await requireReturnSettlementPermission();
    const data = parseInput(convertToAdvanceSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      convertSupplierCreditToAdvance(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
        date: data.date ?? todayISO(),
        notes: data.notes,
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

const refundSchema = z.object({
  returnId: z.string().uuid(),
  accountId: z.string().uuid(),
  amount: amountField("Nominal refund", "positive"),
  date: isoDateField.optional(),
});

export async function refundSupplierReturnAction(input: z.input<typeof refundSchema>) {
  return guard(async () => {
    const ctx = await requireReturnSettlementPermission();
    const data = parseInput(refundSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      refundSupplierReturn(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
        accountId: data.accountId,
        amount: data.amount,
        date: data.date ?? todayISO(),
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

const replacementSchema = z.object({
  returnId: z.string().uuid(),
  date: isoDateField.optional(),
  lines: z
    .array(
      z.object({
        returnLineId: z.string().uuid(),
        qty: amountField("Jumlah penggantian", "positive"),
        batchNumber: z.string().max(80).nullish(),
        expiryDate: isoDateField.nullish(),
        // FIX-GDG Tahap 2 (GDG1-04): nomor seri per unit untuk produk
        // track_serial — diwajibkan & divalidasi jumlahnya di domain.
        serialNumbers: z.array(z.string().min(1).max(120)).max(500).optional(),
      }),
    )
    .min(1),
});

export async function receiveReplacementAction(input: z.input<typeof replacementSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(replacementSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      receiveReplacement(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
        date: data.date ?? todayISO(),
        lines: data.lines.map((line) => ({
          returnLineId: line.returnLineId,
          qty: line.qty,
          batchNumber: line.batchNumber ?? null,
          expiryDate: line.expiryDate ?? null,
          serialNumbers: line.serialNumbers,
        })),
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}

const resolveOtherSchema = z.object({
  returnId: z.string().uuid(),
  note: z.string().trim().min(3).max(500),
  writeOffRemainder: z.boolean().optional(),
  date: isoDateField.optional(),
});

export async function resolveSupplierReturnOtherAction(input: z.input<typeof resolveOtherSchema>) {
  return guard(async () => {
    const ctx = await requireReturnSettlementPermission();
    const data = parseInput(resolveOtherSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      resolveSupplierReturnOther(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        returnId: data.returnId,
        date: data.date ?? todayISO(),
        note: data.note,
        writeOffRemainder: data.writeOffRemainder ?? false,
      }),
    );
    revalidateReturnPaths();
    return result;
  });
}
