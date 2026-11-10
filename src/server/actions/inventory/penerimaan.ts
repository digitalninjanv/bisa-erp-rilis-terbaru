// A-26 Q4 (K-03): pecahan src/server/actions/inventory.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  eq,
  inArray,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { products } from "@/db/schema";
import {
  createReceipt,
  voidReceipt,
  voidStockDocument,
} from "@/server/inventory";

import { requirePermissionInModule } from "@/lib/session";
import { can } from "@/lib/permissions";

import { todayISO } from "@/lib/format";
import {
  AppError,
  guard,
} from "@/lib/errors";
import {
  amountField,
  isoDateField,
  parseInput,
} from "@/lib/action-validation";

const receiptSchema = z
  .object({
    warehouseId: z.string().uuid(),
    // D-5: the receipt source decides the journal and whether a supplier
    // or a payment account applies; the domain enforces the same rules.
    source: z.enum(["purchase", "opening", "bonus", "customer_return", "other"]).optional(),
    supplierId: z.string().uuid().nullish(),
    // G7/D-6: optional link to an open purchase order of the same supplier.
    purchaseOrderId: z.string().uuid().nullish(),
    paymentAccountId: z.string().uuid().nullish(),
    supplierInvoiceNumber: z.string().trim().max(80).nullish(),
    // GDG3-06: kunci idempotensi buatan form (UUID per pembukaan form).
    idempotencyKey: z.string().trim().min(1).max(80).optional(),
    // FIX-P1 Tahap 4 (AK4-04): harga baris termasuk PPN — domain
    // memvalidasi sumber pembelian + saklar/tarif PPN perusahaan.
    taxIncluded: z.boolean().optional(),
    // PPN Masukan eksplisit (harga baris = DPP). Kosong/0 = non-PPN.
    taxAmount: amountField("PPN Masukan", "nonNegative").optional(),
    // PPN dalam persen (0–100); harga baris = DPP.
    taxPercent: amountField("PPN (%)", "nonNegative").optional(),
    // Porsi total yang dipotong dari uang muka pemasok (FIFO).
    advanceAmount: amountField("Uang muka dipakai", "nonNegative").optional(),
    date: isoDateField,
    notes: z.string().max(500).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qty: amountField("Jumlah penerimaan", "positive"),
          unitCost: amountField("Harga beli", "nonNegative"),
          // Diskon baris: percent = % dari bruto; nominal = TOTAL potongan
          // baris (bukan per unit). Domain menolak potongan > nilai baris.
          discountType: z.enum(["percent", "nominal"]).nullish(),
          discountValue: amountField("Diskon", "nonNegative").optional(),
          // Harga jual master baru (opsional, per satuan masukan).
          salePrice: amountField("Harga jual", "nonNegative").optional(),
          // S2: kemasan baris — qty & harga menjadi per kemasan
          // (konversi ke satuan dasar di domain penerimaan).
          packagingId: z.string().uuid().nullish(),
          // G8/D-7: batch identity for batch-tracked products (the number
          // is required for them — enforced per line in the action, where
          // the product flags are known; expiry stays optional).
          batchNumber: z.string().trim().max(80).nullish(),
          expiryDate: isoDateField.nullish(),
          // SIM-2 S7B-2 Batch 5: daftar nomor seri per unit untuk produk
          // track_serial (wajib & jumlahnya persis qty — ditegakkan domain).
          serialNumbers: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
        }),
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    const source = data.source ?? "purchase";
    if (source === "purchase" && !data.supplierId) {
      ctx.addIssue({
        code: "custom",
        path: ["supplierId"],
        message: "Pemasok wajib dipilih untuk penerimaan pembelian.",
      });
    }
    if (data.paymentAccountId && source !== "purchase") {
      ctx.addIssue({
        code: "custom",
        path: ["paymentAccountId"],
        message: "Akun pembayaran hanya berlaku untuk pembelian tunai.",
      });
    }
    if (source === "other" && !data.notes?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Alasan wajib ditulis di catatan untuk penerimaan dengan sumber Lainnya.",
      });
    }
    if (data.purchaseOrderId && source !== "purchase") {
      ctx.addIssue({
        code: "custom",
        path: ["purchaseOrderId"],
        message: "Penerimaan yang tertaut pesanan pembelian harus bersumber Pembelian dari pemasok.",
      });
    }
  });

export async function receiveStockAction(input: z.input<typeof receiptSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(receiptSchema, input);
    if (data.lines.some((line) => line.salePrice !== undefined && line.salePrice !== "") && !can(ctx, "inventory.price")) {
      throw new AppError(
        "FORBIDDEN",
        "Mengubah harga jual produk dari penerimaan memerlukan izin Ubah harga produk (peran manajer ke atas).",
      );
    }
    const result = await withCompany(ctx.company.id, async (tx) => {
      // G8/D-7: batch-tracked products must arrive under a batch number.
      // The flags live in the database, so the check runs here — with a
      // per-line message, like the schema validations above — and the
      // domain enforces the same rule for non-action callers.
      const flags = await tx
        .select({ id: products.id, name: products.name, trackBatch: products.trackBatch })
        .from(products)
        .where(
          and(
            eq(products.companyId, ctx.company.id),
            inArray(products.id, data.lines.map((line) => line.productId)),
          ),
        );
      const flagById = new Map(flags.map((row) => [row.id, row]));
      data.lines.forEach((line, index) => {
        const product = flagById.get(line.productId);
        if (product?.trackBatch && !line.batchNumber?.trim()) {
          throw new AppError(
            "VALIDATION",
            `Baris ${index + 1}: Nomor batch wajib diisi untuk ${product.name} karena produk ini dilacak per batch.`,
          );
        }
      });
      return createReceipt(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId: data.warehouseId,
        supplierId: data.supplierId ?? null,
        purchaseOrderId: data.purchaseOrderId ?? null,
        source: data.source,
        paymentAccountId: data.paymentAccountId ?? null,
        supplierInvoiceNumber: data.supplierInvoiceNumber ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        taxIncluded: data.taxIncluded ?? false,
        taxAmount: data.taxAmount ?? undefined,
        taxPercent: data.taxPercent ?? undefined,
        advanceAmount: data.advanceAmount ?? undefined,
        date: data.date,
        notes: data.notes,
        lines: data.lines.map((line) => ({
          ...line,
          packagingId: line.packagingId ?? null,
          salePrice: line.salePrice ?? undefined,
        })),
      });
    });
    revalidatePath("/app/gudang/penerimaan");
    revalidatePath("/app/gudang/pembelian");
    revalidatePath("/app/gudang");
    revalidatePath("/app/akuntansi");
    return result;
  });
}

const voidReceiptSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export async function voidReceiptAction(input: z.input<typeof voidReceiptSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(voidReceiptSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      voidReceipt(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        receiptId: data.id,
        reason: data.reason,
        date: todayISO(),
      }),
    );
    revalidatePath("/app/gudang/penerimaan");
    revalidatePath("/app/gudang/pembelian");
    revalidatePath("/app/gudang");
    revalidatePath("/app/akuntansi");
    return result;
  });
}

const voidStockDocumentSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export async function voidStockDocumentAction(input: z.input<typeof voidStockDocumentSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(voidStockDocumentSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      voidStockDocument(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        documentId: data.id,
        reason: data.reason,
        date: todayISO(),
      }),
    );
    revalidatePath("/app/gudang/penyesuaian");
    revalidatePath("/app/gudang/transfer");
    revalidatePath("/app/gudang/opname");
    revalidatePath("/app/gudang");
    revalidatePath("/app/akuntansi");
    return result;
  });
}
