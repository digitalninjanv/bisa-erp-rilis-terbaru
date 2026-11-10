"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — penomoran dokumen.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { companySettings } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import {
  DOCUMENT_NUMBER_TYPES,
  MAX_NUMBER_PADDING,
  MIN_NUMBER_PADDING,
  isValidNumberingPrefix,
  normalizeNumberingPrefix,
  type DocumentNumbering,
} from "@/lib/document-numbering";

const numberingSchema = z.object({
  entries: z
    .array(
      z.object({
        docType: z.string().min(1),
        prefix: z.string().max(20).optional().nullable(),
        padding: z
          .number()
          .int()
          .min(MIN_NUMBER_PADDING, `Lebar nomor minimal ${MIN_NUMBER_PADDING} digit.`)
          .max(MAX_NUMBER_PADDING, `Lebar nomor maksimal ${MAX_NUMBER_PADDING} digit.`)
          .optional()
          .nullable(),
      }),
    )
    .max(DOCUMENT_NUMBER_TYPES.length * 2),
});

/**
 * Document numbering overrides (AK-P3-07). Each entry may set a custom
 * prefix and/or zero-padding width for one document type; an entry with
 * neither (or an empty entries list) removes the override so issuance
 * falls back to the built-in defaults. Stored as jsonb on
 * company_settings; null means "all defaults".
 */
export async function saveDocumentNumberingAction(input: z.input<typeof numberingSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(numberingSchema, input);

    const numbering: DocumentNumbering = {};
    for (const entry of data.entries) {
      const type = DOCUMENT_NUMBER_TYPES.find((row) => row.key === entry.docType);
      if (!type) {
        throw new AppError("VALIDATION", `Jenis dokumen tidak dikenal: ${entry.docType}.`);
      }
      const clean: DocumentNumbering[string] = {};
      if (entry.prefix !== undefined && entry.prefix !== null) {
        const prefix = normalizeNumberingPrefix(entry.prefix);
        if (prefix) {
          if (!isValidNumberingPrefix(prefix)) {
            throw new AppError(
              "VALIDATION",
              `Awalan untuk ${type.label} hanya boleh berisi huruf, angka, dan tanda strip (maksimal 10 karakter).`,
            );
          }
          clean.prefix = prefix;
        }
      }
      if (entry.padding !== undefined && entry.padding !== null) {
        clean.padding = entry.padding;
      }
      if (clean.prefix !== undefined || clean.padding !== undefined) {
        numbering[entry.docType] = clean;
      }
    }

    const stored = Object.keys(numbering).length > 0 ? numbering : null;
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(companySettings)
        .set({ documentNumbering: stored, updatedAt: new Date() })
        .where(eq(companySettings.companyId, ctx.company.id));

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.numbering.update",
        entityType: "company_settings",
        entityId: ctx.company.id,
        after: { documentNumbering: stored },
      });
    });
    revalidatePath("/app/pengaturan");
    return { ok: true };
  });
}
