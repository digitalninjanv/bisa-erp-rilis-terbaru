import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adminSql } from "@/db/admin";
import { withCompany } from "@/db/tenant";
import {
  paymentMethods,
  productPackagings,
  products,
  salePayments,
  sales,
  warehouses,
} from "@/db/schema";
import { seedChartOfAccounts } from "@/server/accounting";
import { saveProductAction } from "@/server/actions/inventory/produk";
import { updatePaymentMethodAction } from "@/server/actions/settings/pembayaran";
import { todayISO } from "@/lib/format";
import { wipeCompanyFixture } from "../helpers/wipe-company";

const state = vi.hoisted(() => ({
  companyId: "",
  permissions: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const context = async () => ({
    company: { id: state.companyId, name: "Uji", slug: "uji" },
    user: { id: crypto.randomUUID(), name: "Uji", email: "uji@local" },
    role: "custom",
    permissions: state.permissions,
    modules: [],
    enabledModules: [],
  });
  return {
    requireAuth: context,
    requirePermission: context,
    requirePermissionInModule: context,
  };
});

const created: string[] = [];

beforeEach(async () => {
  state.companyId = crypto.randomUUID();
  state.permissions = ["settings.manage", "inventory.manage"];
  created.push(state.companyId);
});

afterAll(async () => {
  for (const companyId of created) {
    await wipeCompanyFixture(adminSql, companyId);
  }
});

async function seed() {
  const companyId = state.companyId;
  return withCompany(companyId, async (tx) => {
    const map = await seedChartOfAccounts(tx, companyId);
    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId, code: "MAIN", name: "Main", isDefault: true })
      .returning();
    return { map, warehouse };
  });
}

describe("SET-01: identitas metode pembayaran yang sudah dipakai tidak boleh berubah", () => {
  it("menolak perubahan tipe/akun, tetapi mengizinkan ubah nama", async () => {
    const companyId = state.companyId;
    const { map, warehouse } = await seed();
    const ids = await withCompany(companyId, async (tx) => {
      const [method] = await tx
        .insert(paymentMethods)
        .values({
          companyId,
          code: "CASH",
          name: "Cash",
          type: "cash",
          accountId: map.cash,
        })
        .returning();
      const [sale] = await tx
        .insert(sales)
        .values({
          companyId,
          warehouseId: warehouse.id,
          number: `S-${crypto.randomUUID().slice(0, 8)}`,
          date: todayISO(),
          cashierId: crypto.randomUUID(),
          total: "100",
          paidTotal: "100",
        })
        .returning();
      await tx.insert(salePayments).values({
        companyId,
        saleId: sale.id,
        methodId: method.id,
        amount: "100",
        tendered: "100",
      });
      return { method };
    });

    const changed = await updatePaymentMethodAction({
      id: ids.method.id,
      name: "Cash",
      type: "bank",
      accountId: map.bank,
    });
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.code).toBe("CONFLICT");

    const renamed = await updatePaymentMethodAction({
      id: ids.method.id,
      name: "Tunai",
      type: "cash",
      accountId: map.cash,
    });
    expect(renamed.ok).toBe(true);
    const [row] = await withCompany(companyId, (tx) =>
      tx
        .select({ name: paymentMethods.name, type: paymentMethods.type })
        .from(paymentMethods)
        .where(eq(paymentMethods.id, ids.method.id)),
    );
    expect(row).toEqual({ name: "Tunai", type: "cash" });
  });
});

describe("INV-02: harga kemasan memerlukan inventory.price", () => {
  it("menolak perubahan harga kemasan oleh staf gudang", async () => {
    const companyId = state.companyId;
    await seed();
    const product = await withCompany(companyId, async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          companyId,
          sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
          name: "Produk kemasan",
          costPrice: "100",
          salePrice: "200",
          trackStock: true,
        })
        .returning();
      const [packaging] = await tx
        .insert(productPackagings)
        .values({
          companyId,
          productId: row.id,
          name: "Dus",
          isi: "10",
          buyPrice: "1000",
          salePrice: "2000",
          isDefaultSale: true,
        })
        .returning();
      return { row, packaging };
    });

    const result = await saveProductAction({
      id: product.row.id,
      name: product.row.name,
      sku: product.row.sku,
      costPrice: "100",
      salePrice: "200",
      packagings: [
        {
          id: product.packaging.id,
          name: "Dus",
          isi: "10",
          buyPrice: "1000",
          salePrice: "1",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});
