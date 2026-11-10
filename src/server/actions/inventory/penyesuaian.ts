// A-26 Q4 (K-03): pecahan src/server/actions/inventory.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";


import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";

import {
  approveStockAdjustment,
  cancelStockAdjustment,
  createAdjustment,
  rejectStockAdjustment,
} from "@/server/inventory";

import { requirePermissionInModule } from "@/lib/session";
import { can } from "@/lib/permissions";

import { guard } from "@/lib/errors";
import {
  amountField,
  isoDateField,
  parseInput,
} from "@/lib/action-validation";

const OUTBOUND_ADJUSTMENT_TYPES = ["damaged", "expired", "lost", "quarantine"];

const adjustmentSchema = z
  .object({
    warehouseId: z.string().uuid(),
    date: isoDateField,
    // FIX-P1 (AK4-02): "purchase_return" dicabut dari penyesuaian stok —
    // retur ke pemasok hanya lewat modul Retur Pembelian (A-9/D-20).
    // Domain createAdjustment juga menolaknya sebagai pertahanan lapis
    // kedua untuk pemanggil non-aksi.
    type: z.enum(["adjustment", "damaged", "expired", "lost", "quarantine"]),
    reason: z.string().min(3).max(300),
    // FIX-P1 (AK4-06c): alasan pengubahan harga pokok — wajib diisi
    // (ditegakkan domain) bila ada baris yang harga pokoknya menyimpang
    // dari harga berjalan.
    costOverrideReason: z.string().trim().min(3).max(300).optional(),
    supplierId: z.string().uuid().optional(),
    refundMethod: z.enum(["cash", "credit_note", "replacement", "deduction"]).optional(),
    notes: z.string().max(500).optional(),
    // GDG3-06: kunci idempotensi buatan form (UUID per pembukaan form).
    idempotencyKey: z.string().trim().min(1).max(80).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          // Numeric validity is enforced here; the sign convention itself
          // (positive magnitude for outbound types, signed for "adjustment")
          // stays owned by the superRefine below and createAdjustment.
          qty: amountField("Jumlah"),
          unitCost: amountField("Harga pokok", "nonNegative").optional(),
          // Satuan Kemasan S3: kemasan baris; qty lalu berarti per kemasan.
          packagingId: z.string().uuid().optional().nullable(),
        }),
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    // Sign convention (mirrors createAdjustment): outbound types take a
    // positive magnitude; the generic "adjustment" type takes a signed,
    // non-zero qty.
    const isOutbound = OUTBOUND_ADJUSTMENT_TYPES.includes(data.type);
    data.lines.forEach((line, index) => {
      const qty = Number(line.qty);
      if (!Number.isFinite(qty)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "qty"],
          message: "Jumlah harus berupa angka yang valid.",
        });
      } else if (qty === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "qty"],
          message: "Jumlah tidak boleh nol.",
        });
      } else if (isOutbound && qty < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "qty"],
          message:
            "Jumlah keluar harus diisi positif (besaran barang yang keluar); arah keluar sudah ditentukan oleh jenis dokumen ini.",
        });
      }
    });
  });

export async function createAdjustmentAction(input: z.input<typeof adjustmentSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(adjustmentSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      createAdjustment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId: data.warehouseId,
        date: data.date,
        type: data.type,
        reason: data.reason,
        supplierId: data.supplierId,
        refundMethod: data.refundMethod,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey ?? null,
        lines: data.lines,
        // FIX-P1 (AK4-06c): izin ubah harga pokok dinilai dari peran
        // pemanggil di lapisan aksi (pola izin repo) dan diteruskan ke
        // domain sebagai atestasi; domain yang mendeteksi override
        // terhadap harga berjalan aktual & menegakkan alasan + audit.
        costOverrideReason: data.costOverrideReason,
        allowCostOverride: can(ctx, "inventory.cost_override"),
      }),
    );
    revalidatePath("/app/gudang/penyesuaian");
    revalidatePath("/app/gudang");
    return result;
  });
}

// T5-3 (D-17): approval decisions for pending adjustments. Permission is
// the same inventory.manage as creating them; the maker ≠ checker rule
// itself is enforced in the domain, not here.
const approveAdjustmentSchema = z.object({ id: z.string().uuid() });

export async function approveStockAdjustmentAction(input: z.input<typeof approveAdjustmentSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(approveAdjustmentSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      approveStockAdjustment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        documentId: data.id,
      }),
    );
    revalidatePath("/app/gudang/penyesuaian");
    revalidatePath("/app/gudang");
    revalidatePath("/app/akuntansi");
    return result;
  });
}

const rejectAdjustmentSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export async function rejectStockAdjustmentAction(input: z.input<typeof rejectAdjustmentSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(rejectAdjustmentSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      rejectStockAdjustment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        documentId: data.id,
        reason: data.reason,
      }),
    );
    revalidatePath("/app/gudang/penyesuaian");
    revalidatePath("/app/gudang");
    return result;
  });
}

export async function cancelStockAdjustmentAction(input: z.input<typeof approveAdjustmentSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(approveAdjustmentSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      cancelStockAdjustment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        documentId: data.id,
      }),
    );
    revalidatePath("/app/gudang/penyesuaian");
    revalidatePath("/app/gudang");
    return result;
  });
}
