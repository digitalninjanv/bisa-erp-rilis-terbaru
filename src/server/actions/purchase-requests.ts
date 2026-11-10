"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { amountField, isoDateField, parseInput } from "@/lib/action-validation";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { writeAudit } from "@/server/audit";
import {
  convertPurchaseRequestToPo,
  createPurchaseRequest,
  decidePurchaseRequest,
} from "@/server/purchase-requests";

/**
 * SIM-2 S7B-2 Batch 3 — Actions Purchase Request. Izin mengikuti PO:
 * inventory.manage (modul gudang). Peran aktor diteruskan ke domain
 * untuk aturan ambang persetujuan (D-25).
 */

function revalidatePrPaths(id?: string) {
  revalidatePath("/app/gudang/purchase-request");
  if (id) revalidatePath(`/app/gudang/purchase-request/${id}`);
  revalidatePath("/app/gudang/pembelian");
}

const createSchema = z.object({
  requesterEmployeeId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  date: isoDateField,
  notes: z.string().max(300).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: amountField("Qty", "positive"),
        estimatedPrice: amountField("Perkiraan harga", "nonNegative"),
        reason: z.string().max(200).optional(),
      }),
    )
    .min(1),
});

export async function createPurchaseRequestAction(input: z.input<typeof createSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.manage");
    const data = parseInput(createSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const created = await createPurchaseRequest(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        requesterEmployeeId: data.requesterEmployeeId ?? null,
        departmentId: data.departmentId ?? null,
        date: data.date,
        notes: data.notes ?? null,
        lines: data.lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          estimatedPrice: line.estimatedPrice,
          reason: line.reason ?? null,
        })),
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "purchase_request.create",
        entityType: "purchase_request",
        entityId: created.id,
        after: { number: created.number, totalEstimate: created.totalEstimate },
      });
      return created;
    });
    revalidatePrPaths(row.id);
    return row;
  });
}

const decideSchema = z.object({
  requestId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().max(300).optional(),
});

export async function decidePurchaseRequestAction(input: z.input<typeof decideSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.manage");
    const data = parseInput(decideSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const decided = await decidePurchaseRequest(tx, {
        companyId: ctx.company.id,
        actor: { userId: ctx.user.id, role: ctx.role },
        requestId: data.requestId,
        approve: data.approve,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.approve ? "purchase_request.approve" : "purchase_request.reject",
        entityType: "purchase_request",
        entityId: decided.id,
        after: { number: decided.number, status: decided.status },
      });
      return decided;
    });
    revalidatePrPaths(row.id);
    return row;
  });
}

const convertSchema = z.object({
  requestId: z.string().uuid(),
  supplierId: z.string().uuid(),
  date: isoDateField.optional(),
  expectedDate: isoDateField.nullish(),
});

export async function convertPurchaseRequestAction(input: z.input<typeof convertSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.manage");
    const data = parseInput(convertSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const po = await convertPurchaseRequestToPo(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        requestId: data.requestId,
        supplierId: data.supplierId,
        date: data.date ?? todayISO(),
        expectedDate: data.expectedDate ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "purchase_request.convert",
        entityType: "purchase_request",
        entityId: data.requestId,
        after: { poId: po.id, poNumber: po.number },
      });
      return po;
    });
    revalidatePrPaths(data.requestId);
    return row;
  });
}
