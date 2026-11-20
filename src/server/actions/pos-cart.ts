"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { warehouses } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import { parseInput } from "@/lib/action-validation";
import { AppError, guard } from "@/lib/errors";
import { requirePermission } from "@/lib/session";
import { searchProducts } from "@/server/catalog";

async function assertWarehouseUsable(companyId: string, warehouseId: string): Promise<string> {
  const parsed = z.string().uuid().safeParse(warehouseId);
  if (!parsed.success) throw new AppError("VALIDATION", "Gudang tidak valid.");
  return withCompanyReadOnly(companyId, async (tx) => {
    const [row] = await tx
      .select({ id: warehouses.id, name: warehouses.name, isActive: warehouses.isActive })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, companyId), eq(warehouses.id, parsed.data)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Gudang tidak ditemukan di perusahaan ini.");
    if (!row.isActive) throw new AppError("VALIDATION", `Gudang ${row.name} sudah nonaktif.`);
    return row.id;
  });
}

export async function cartProductsAction(input: { warehouseId: string; productIds: string[] }) {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    const data = parseInput(
      z.object({ warehouseId: z.string().uuid(), productIds: z.array(z.string().uuid()).min(1).max(200) }),
      input,
    );
    const warehouseId = await assertWarehouseUsable(ctx.company.id, data.warehouseId);
    return withCompanyReadOnly(ctx.company.id, (tx) =>
      searchProducts(tx, {
        companyId: ctx.company.id,
        warehouseId,
        q: "",
        productIds: [...new Set(data.productIds)],
        limit: 200,
        includeCost: false,
      }),
    );
  });
}
