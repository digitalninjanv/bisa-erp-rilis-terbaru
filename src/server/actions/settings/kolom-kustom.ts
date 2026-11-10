"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — definisi kolom kustom.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { companySettings } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import {
  validateCustomFieldDefinitions,
  type CustomFieldDefinitions,
} from "@/lib/custom-fields";

const customFieldsSchema = z.object({
  definitions: z.unknown(),
});

/**
 * Custom field definitions (T5-2, D-16). The strict domain validator
 * owns the rules (unique slug keys, ≤10 per entity, labels required,
 * select fields need options) and throws VALIDATION naming the
 * problem; the sanitized result is stored, or null when the company
 * has no custom fields left. Stored entity values are never touched —
 * values of removed definitions stay on their rows as orphans.
 */
export async function saveCustomFieldsAction(input: z.input<typeof customFieldsSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(customFieldsSchema, input);
    const definitions = validateCustomFieldDefinitions(data.definitions);
    const stored: CustomFieldDefinitions | null =
      Object.keys(definitions).length > 0 ? definitions : null;
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(companySettings)
        .set({ customFields: stored, updatedAt: new Date() })
        .where(eq(companySettings.companyId, ctx.company.id));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.custom_fields.update",
        entityType: "company_settings",
        entityId: ctx.company.id,
        after: { customFields: stored },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/gudang");
    return { ok: true };
  });
}
