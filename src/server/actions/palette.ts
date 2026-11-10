"use server";

import { z } from "zod";
import { withCompanyReadOnly } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { requireAuth } from "@/lib/session";
import { can } from "@/lib/permissions";
import { accessibleModules } from "@/lib/landing";
import { searchPaletteEntities, type PaletteEntityResults } from "@/server/palette";

const querySchema = z.string().trim().min(2).max(60);

/**
 * A-24 T1 (SIS-12) — aksi pencarian entitas palet perintah.
 *
 * Cakupan ditegakkan DI SINI per grup, bukan di klien: produk dan
 * dokumen stok hanya untuk peran yang menjangkau modul Gudang dengan
 * `inventory.view`; nota hanya untuk penjangkau POS dengan
 * `pos.sell`. Peran di luar cakupan menerima grup kosong — palet
 * tidak pernah membocorkan keberadaan data lintas modul.
 */
export async function searchPaletteAction(rawQuery: string) {
  return guard(async (): Promise<PaletteEntityResults> => {
    const ctx = await requireAuth();
    const query = parseInput(querySchema, rawQuery);
    const reachable = accessibleModules(ctx.modules, ctx.enabledModules);
    const scope = {
      products: reachable.includes("gudang") && can(ctx, "inventory.view"),
      documents: reachable.includes("gudang") && can(ctx, "inventory.view"),
      sales: reachable.includes("pos") && can(ctx, "pos.sell"),
    };
    if (!scope.products && !scope.sales && !scope.documents) {
      return { products: [], sales: [], documents: [] };
    }
    return withCompanyReadOnly(ctx.company.id, (tx) =>
      searchPaletteEntities(tx, ctx.company.id, query, scope),
    );
  });
}
