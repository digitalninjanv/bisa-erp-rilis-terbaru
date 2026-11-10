"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — alasan penyesuaian stok dan siklus opname.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { categories, companySettings, warehouses } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { sanitizeAdjustmentReasons } from "@/lib/adjustment-reasons";
import {
  sanitizeOpnameCycleConfig,
  type OpnameCycleConfig,
} from "@/lib/opname-cycle";;

const adjustmentReasonsSchema = z.object({
  reasons: z.unknown(),
});

/**
 * A-24 T3 (pola G4): daftar alasan penyesuaian stok per perusahaan.
 * Sanitasi lib memiliki aturan bentuknya (label bersih, tanpa
 * duplikat, ≤30); daftar yang tidak menyisakan satu pun label sah
 * ditolak — mengosongkan daftar berarti kembali ke bawaan, dan itu
 * dilakukan dengan menyimpan daftar bawaan secara eksplisit dari
 * editor, bukan dengan daftar kosong.
 */
export async function saveAdjustmentReasonsAction(
  input: z.input<typeof adjustmentReasonsSchema>,
) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(adjustmentReasonsSchema, input);
    const stored = sanitizeAdjustmentReasons(data.reasons);
    if (!stored) {
      throw new AppError(
        "VALIDATION",
        "Daftar alasan penyesuaian harus berisi minimal satu label yang sah.",
      );
    }
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(companySettings)
        .set({ adjustmentReasons: stored, updatedAt: new Date() })
        .where(eq(companySettings.companyId, ctx.company.id));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.adjustment_reasons.update",
        entityType: "company_settings",
        entityId: ctx.company.id,
        after: { adjustmentReasons: stored },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/gudang/penyesuaian");
    return { ok: true };
  });
}


const opnameCycleSchema = z.object({
  config: z.unknown(),
});

/**
 * A-24 T3 (pola G3): frekuensi hitung opname per gudang/kategori
 * untuk pengingat jatuh tempo. Sanitasi lib membuang nilai tidak
 * sah; kunci yang menunjuk gudang/kategori perusahaan lain dibuang
 * di sini. Konfigurasi kosong disimpan sebagai null (pengingat mati).
 */
export async function saveOpnameCycleAction(input: z.input<typeof opnameCycleSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(opnameCycleSchema, input);
    const sanitized = sanitizeOpnameCycleConfig(data.config);
    const stored = await withCompany(ctx.company.id, async (tx) => {
      const [warehouseRows, categoryRows] = await Promise.all([
        tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.companyId, ctx.company.id)),
        tx.select({ id: categories.id }).from(categories).where(eq(categories.companyId, ctx.company.id)),
      ]);
      const warehouseIds = new Set(warehouseRows.map((row) => row.id));
      const categoryIds = new Set(categoryRows.map((row) => row.id));
      const filtered: OpnameCycleConfig = {
        warehouseDays: Object.fromEntries(
          Object.entries(sanitized.warehouseDays).filter(([id]) => warehouseIds.has(id)),
        ),
        categoryDays: Object.fromEntries(
          Object.entries(sanitized.categoryDays).filter(([id]) => categoryIds.has(id)),
        ),
      };
      const value: OpnameCycleConfig | null =
        Object.keys(filtered.warehouseDays).length + Object.keys(filtered.categoryDays).length > 0
          ? filtered
          : null;
      await tx
        .update(companySettings)
        .set({ opnameCycle: value, updatedAt: new Date() })
        .where(eq(companySettings.companyId, ctx.company.id));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.opname_cycle.update",
        entityType: "company_settings",
        entityId: ctx.company.id,
        after: { opnameCycle: value },
      });
      return value;
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/gudang");
    return { ok: true, config: stored };
  });
}
