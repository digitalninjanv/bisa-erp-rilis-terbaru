"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — pengaturan cetak nota/dokumen.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.
// A-28 UI-2 (UX-D01/D02/D03/D05): tab warisan "Nota & printer" dilebur
// ke sini — mesin cetak adalah SATU-SATUNYA pintu pengaturan cetak:
// saklar elemen nota (kasir, PPN, pelanggan, sesi, merek), unggah
// logo berkas, dan label tanda tangan per jenis dokumen.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { companySettings } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { printLogoDataUrlSchema, printLogoUrlSchema } from "@/lib/print-logo";
import {
  sanitizePrintSignatureLabels,
  type PrintSignatureLabels,
} from "@/components/print/types";

const printSettingsSchema = z.object({
  printTemplate: z.enum(["modern", "minimal", "classic"]),
  printLogoUrl: printLogoUrlSchema.optional().nullable(),
  printAccentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Warna aksen harus dalam format hex #RRGGBB."),
  printFont: z.enum(["sans", "serif", "mono"]),
  printHeaderText: z.string().max(500).optional().nullable(),
  printFooterText: z.string().max(500).optional().nullable(),
  printShowSignature: z.boolean(),
  printShowQr: z.boolean(),
  printReceiptPaper: z.enum(["thermal58", "thermal80", "a5", "a4"]),
  printDocumentPaper: z.enum(["a4", "a5"]),
  // A-28 UI-2: saklar elemen nota (bawaan menyala di UI untuk
  // pemanggil lama yang belum mengirim field ini).
  printShowCashier: z.boolean().optional(),
  printShowTax: z.boolean().optional(),
  printShowCustomer: z.boolean().optional(),
  printShowSession: z.boolean().optional(),
  printShowBranding: z.boolean().optional(),
  // Label tanda tangan per jenis dokumen; disanitasi sebelum simpan
  // (kunci tak dikenal / label kosong dibuang — posisi kosong jatuh
  // ke label bawaan dokumen saat cetak).
  printSignatureLabels: z
    .record(z.string(), z.array(z.string().max(60)).max(4))
    .optional()
    .nullable(),
});

/**
 * Print Engine settings (T4-4, D-13). Kept as its own action so the
 * general settings form never has to carry print fields it does not
 * show; every printed document (receipt, GRN, PO) reads these columns.
 */
export async function savePrintSettingsAction(input: z.input<typeof printSettingsSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(printSettingsSchema, input);
    const signatureLabels: PrintSignatureLabels = sanitizePrintSignatureLabels(
      data.printSignatureLabels,
    );
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(companySettings)
        .set({
          printTemplate: data.printTemplate,
          printLogoUrl: data.printLogoUrl || null,
          printAccentColor: data.printAccentColor,
          printFont: data.printFont,
          printHeaderText: data.printHeaderText || null,
          printFooterText: data.printFooterText || null,
          printShowSignature: data.printShowSignature,
          printShowQr: data.printShowQr,
          printReceiptPaper: data.printReceiptPaper,
          printDocumentPaper: data.printDocumentPaper,
          ...(data.printShowCashier !== undefined ? { printShowCashier: data.printShowCashier } : {}),
          ...(data.printShowTax !== undefined ? { printShowTax: data.printShowTax } : {}),
          ...(data.printShowCustomer !== undefined ? { printShowCustomer: data.printShowCustomer } : {}),
          ...(data.printShowSession !== undefined ? { printShowSession: data.printShowSession } : {}),
          ...(data.printShowBranding !== undefined ? { printShowBranding: data.printShowBranding } : {}),
          ...(data.printSignatureLabels !== undefined
            ? {
                printSignatureLabels:
                  Object.keys(signatureLabels).length > 0 ? signatureLabels : null,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(companySettings.companyId, ctx.company.id));

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.print.update",
        entityType: "company_settings",
        entityId: ctx.company.id,
        after: {
          printTemplate: data.printTemplate,
          printFont: data.printFont,
          printReceiptPaper: data.printReceiptPaper,
          printDocumentPaper: data.printDocumentPaper,
          printShowSignature: data.printShowSignature,
          printShowQr: data.printShowQr,
          printShowCashier: data.printShowCashier,
          printShowTax: data.printShowTax,
          printShowCustomer: data.printShowCustomer,
          printShowSession: data.printShowSession,
          printShowBranding: data.printShowBranding,
        },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    revalidatePath("/app/gudang");
    return { ok: true };
  });
}

/**
 * A-28 UI-2 (UX-D02): unggah logo cetak sebagai berkas — pola unggah
 * QRIS (data URL raster tervalidasi di server, tersimpan pada kolom
 * print_logo_url yang sama dengan jalur URL). Logo tampil di nota &
 * dokumen lewat PrintHeader seperti logo URL.
 */
export async function uploadPrintLogoAction(input: { dataUrl: string }) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(z.object({ dataUrl: printLogoDataUrlSchema }), input);
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(companySettings)
        .set({ printLogoUrl: data.dataUrl, updatedAt: new Date() })
        .where(eq(companySettings.companyId, ctx.company.id));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.print.logo_upload",
        entityType: "company_settings",
        entityId: ctx.company.id,
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    revalidatePath("/app/gudang");
    return { ok: true };
  });
}
