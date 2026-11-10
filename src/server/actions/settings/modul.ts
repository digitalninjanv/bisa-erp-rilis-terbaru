"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — saklar modul aktif perusahaan.
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
import type { ModuleEnabledMap } from "@/lib/modules";

const enabledModulesSchema = z.object({
  pos: z.boolean(),
  gudang: z.boolean(),
  akuntansi: z.boolean(),
  // A-24 T2: saklar perusahaan berbasis ModuleKey — modul HR ikut
  // sejak ia menjadi ModuleKey sendiri.
  hr: z.boolean(),
  analisa: z.boolean(),
});

/**
 * Company module switch (T5-2, D-16). Stored on
 * company_settings.enabled_modules; when every module is on the column
 * goes back to null ("no switch set"), otherwise the explicit map is
 * kept. Turning a module off hides it from the shell and makes its
 * segment layout redirect to Beranda — data is never touched, and
 * Pengaturan itself always stays reachable to turn it back on.
 */
export async function saveEnabledModulesAction(input: z.input<typeof enabledModulesSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(enabledModulesSchema, input);
    const allEnabled = data.pos && data.gudang && data.akuntansi && data.hr && data.analisa;
    const stored: ModuleEnabledMap | null = allEnabled
      ? null
      : { pos: data.pos, gudang: data.gudang, akuntansi: data.akuntansi, hr: data.hr, analisa: data.analisa };
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(companySettings)
        .set({ enabledModules: stored, updatedAt: new Date() })
        .where(eq(companySettings.companyId, ctx.company.id));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.modules.update",
        entityType: "company_settings",
        entityId: ctx.company.id,
        after: { enabledModules: stored },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app", "layout");
    return { ok: true };
  });
}
