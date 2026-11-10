"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { amountField, isoDateField, parseInput } from "@/lib/action-validation";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { writeAudit } from "@/server/audit";
import { receiveTransfer } from "@/server/inventory";
import { createReservation, releaseReservation } from "@/server/reservations";

/**
 * SIM-2 S7B-2 Batch 4 — Actions reservasi stok & penerimaan transfer
 * dua tahap. Izin mengikuti gudang: inventory.manage.
 */

const createSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  qty: amountField("Qty reservasi", "positive"),
  date: isoDateField.optional(),
  expiresAt: z.string().datetime().nullish(),
  reason: z.string().max(300).optional(),
});

export async function createReservationAction(input: z.input<typeof createSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.manage");
    const data = parseInput(createSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const created = await createReservation(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId: data.warehouseId,
        productId: data.productId,
        qty: data.qty,
        date: data.date ?? todayISO(),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        reason: data.reason ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "stock_reservation.create",
        entityType: "stock_reservation",
        entityId: created.id,
        after: { number: created.number, qty: created.qty },
      });
      return created;
    });
    revalidatePath("/app/gudang/reservasi");
    revalidatePath("/app/pos");
    return row;
  });
}

const releaseSchema = z.object({
  reservationId: z.string().uuid(),
  cancelled: z.boolean().optional(),
});

export async function releaseReservationAction(input: z.input<typeof releaseSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.manage");
    const data = parseInput(releaseSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const released = await releaseReservation(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        reservationId: data.reservationId,
        cancelled: data.cancelled ?? false,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.cancelled ? "stock_reservation.cancel" : "stock_reservation.release",
        entityType: "stock_reservation",
        entityId: released.id,
        after: { number: released.number, status: released.status },
      });
      return released;
    });
    revalidatePath("/app/gudang/reservasi");
    revalidatePath("/app/pos");
    return row;
  });
}

const receiveSchema = z.object({
  documentId: z.string().uuid(),
  date: isoDateField.optional(),
  // FIX-GDG Tahap 2 (GDG1-07): penerimaan sebagian per baris + tutup
  // sisa sebagai selisih perjalanan (alasan wajib di domain).
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        receivedQty: amountField("Qty diterima", "nonNegative"),
        serialNumbers: z.array(z.string().min(1).max(120)).max(500).optional(),
      }),
    )
    .max(200)
    .optional(),
  closeRemainder: z.boolean().optional(),
  differenceReason: z.string().max(300).optional(),
});

export async function receiveTransferAction(input: z.input<typeof receiveSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.manage");
    const data = parseInput(receiveSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const received = await receiveTransfer(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        documentId: data.documentId,
        date: data.date ?? todayISO(),
        lines: data.lines,
        closeRemainder: data.closeRemainder,
        differenceReason: data.differenceReason,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "inventory.transfer.receive",
        entityType: "stock_document",
        entityId: received.id,
        after: { number: received.number },
      });
      return received;
    });
    revalidatePath("/app/gudang/transfer");
    revalidatePath("/app/gudang");
    return row;
  });
}
