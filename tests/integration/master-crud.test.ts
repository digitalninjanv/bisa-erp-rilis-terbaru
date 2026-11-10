import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  auditLog,
  categories,
  customers,
  products,
  stockMovements,
  stockOnHand,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  createTaxonomyAction,
  deleteTaxonomyAction,
  updateTaxonomyAction,
} from "@/server/actions/inventory/taksonomi";
import {
  deleteCustomerAction,
  deleteSupplierAction,
  saveCustomerAction,
  saveSupplierAction,
  toggleCustomerAction,
  toggleSupplierAction,
} from "@/server/actions/inventory/pihak";
import {
  deleteProductAction,
  saveProductAction,
} from "@/server/actions/inventory/produk";
import { deleteWarehouseAction, saveWarehouseAction, toggleWarehouseAction } from "@/server/actions/settings/lokasi";

// Action-level tests need an authenticated company context and Next's cache
// revalidation; both are replaced so the real action code (validation,
// guards, audit) runs against the real database, following
// payroll-reverse.test.ts. Fixtures use unique P18 codes/names and are
// cleaned up afterwards; audit rows are append-only and stay.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  });
  // T5R-2: fixture sesi ini mewakili perusahaan dengan semua modul
  // aktif, jadi gerbang modul di lapisan action lolos persis seperti
  // requirePermission (gerbang sungguhannya diuji di review-fixes-t5r).
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
  };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const GHOST_ID = "01900000-0000-7000-8000-00000000dead";

const CAT_CLEAN = "Uji P18 Kategori Bersih";
const CAT_USED = "Uji P18 Kategori Dipakai";
const CAT_RENAMED = "Uji P18 Kategori Ganti Nama";
const UNIT_CODE = "P18PCS";
const UNIT_NAME = "Uji P18 Unit";
const SUPPLIER_CODE = "SUP-P18";
const CUSTOMER_CODE = "CUS-P18";
const WAREHOUSE_CODE = "GDGP18";
const SKU_USED_CATEGORY = "SKU-P18-KATEGORI";
const SKU_STOCKED = "SKU-P18-STOK";
const SKU_MOVED = "SKU-P18-GERAK";
const SKU_CLEAN = "SKU-P18-BERSIH";

async function cleanupFixtures() {
  await withCompany(ORG_ID, async (tx) => {
    const fixtureSkus = [SKU_USED_CATEGORY, SKU_STOCKED, SKU_MOVED, SKU_CLEAN];
    for (const sku of fixtureSkus) {
      const [product] = await tx
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .where(and(eq(products.companyId, ORG_ID), eq(products.sku, sku)))
        .limit(1);
      if (product) {
        await tx
          .delete(stockOnHand)
          .where(and(eq(stockOnHand.companyId, ORG_ID), eq(stockOnHand.productId, product.id)));
        // SIM-2 S7 (REM-01): a product that already has a stock ledger can
        // never be deleted — the append-only movements cannot be removed
        // and migration 0031's FK stock_movements.product_id now enforces
        // at the database level the same rule the delete guard enforces in
        // the app. Such fixtures are tombstoned instead: the SKU is renamed
        // unique and the row deactivated, freeing the canonical SKU for the
        // next run while the net-zero ledger rows stay intact.
        const [movementCount] = await tx
          .select({ value: count() })
          .from(stockMovements)
          .where(and(eq(stockMovements.companyId, ORG_ID), eq(stockMovements.productId, product.id)));
        if ((movementCount?.value ?? 0) > 0) {
          if (!product.sku.includes("-TERHAPUS-")) {
            await tx
              .update(products)
              .set({ sku: `${sku}-TERHAPUS-${product.id.slice(0, 8)}-${Date.now()}`, isActive: false })
              .where(and(eq(products.companyId, ORG_ID), eq(products.id, product.id)));
          }
        } else {
          await tx
            .delete(products)
            .where(and(eq(products.companyId, ORG_ID), eq(products.id, product.id)));
        }
      }
    }
    for (const name of [CAT_CLEAN, CAT_USED, CAT_RENAMED]) {
      await tx
        .delete(categories)
        .where(and(eq(categories.companyId, ORG_ID), eq(categories.name, name)));
    }
    await tx.delete(units).where(and(eq(units.companyId, ORG_ID), eq(units.code, UNIT_CODE)));
    await tx
      .delete(suppliers)
      .where(and(eq(suppliers.companyId, ORG_ID), eq(suppliers.code, SUPPLIER_CODE)));
    await tx
      .delete(customers)
      .where(and(eq(customers.companyId, ORG_ID), eq(customers.code, CUSTOMER_CODE)));
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.code, WAREHOUSE_CODE)))
      .limit(1);
    if (warehouse) {
      await tx
        .delete(stockOnHand)
        .where(and(eq(stockOnHand.companyId, ORG_ID), eq(stockOnHand.warehouseId, warehouse.id)));
      await tx
        .delete(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.id, warehouse.id)));
    }
  });
}

beforeAll(cleanupFixtures);
afterAll(cleanupFixtures);

async function createProduct(sku: string, extra: Record<string, unknown> = {}) {
  const result = await saveProductAction({
    name: `Produk ${sku}`,
    sku,
    costPrice: "1000",
    salePrice: "2000",
    minStock: "0",
    ...extra,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.data.id;
}

async function defaultWarehouseId() {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
      .limit(1);
    expect(warehouse).toBeDefined();
    return warehouse!.id;
  });
}

describe("taxonomy: kategori & satuan (GD-P1-8)", () => {
  let categoryId = "";
  let unitId = "";

  it("creates a category and a unit through the taxonomy action", async () => {
    const category = await createTaxonomyAction({ kind: "category", name: CAT_CLEAN });
    expect(category.ok).toBe(true);
    if (category.ok) {
      expect(category.data).not.toBeNull();
      categoryId = category.data!.id;
    }

    const unit = await createTaxonomyAction({ kind: "unit", name: UNIT_NAME, code: UNIT_CODE });
    expect(unit.ok).toBe(true);
    if (unit.ok) {
      expect(unit.data).not.toBeNull();
      unitId = unit.data!.id;
    }
  });

  it("rejects a duplicate category name and duplicate unit code as CONFLICT", async () => {
    const dupCategory = await createTaxonomyAction({ kind: "category", name: CAT_CLEAN });
    expect(dupCategory.ok).toBe(false);
    if (!dupCategory.ok) {
      expect(dupCategory.code).toBe("CONFLICT");
      expect(dupCategory.message).toMatch(/sudah ada/i);
    }

    const dupUnit = await createTaxonomyAction({ kind: "unit", name: "Nama Unit Lain", code: UNIT_CODE });
    expect(dupUnit.ok).toBe(false);
    if (!dupUnit.ok) {
      expect(dupUnit.code).toBe("CONFLICT");
      expect(dupUnit.message).toMatch(/sudah ada/i);
    }
  });

  it("edits taxonomy rows, rejects rename conflicts and ghost ids", async () => {
    const renamed = await updateTaxonomyAction({ kind: "category", id: categoryId, name: CAT_RENAMED });
    expect(renamed.ok).toBe(true);

    const unitRenamed = await updateTaxonomyAction({ kind: "unit", id: unitId, name: `${UNIT_NAME} Baru`, code: UNIT_CODE });
    expect(unitRenamed.ok).toBe(true);

    const other = await createTaxonomyAction({ kind: "category", name: CAT_USED });
    expect(other.ok).toBe(true);
    const conflict = await updateTaxonomyAction({ kind: "category", id: categoryId, name: CAT_USED });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.code).toBe("CONFLICT");

    const ghost = await updateTaxonomyAction({ kind: "category", id: GHOST_ID, name: "Hantu" });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");

    // Restore the clean category name for the delete test below.
    const restored = await updateTaxonomyAction({ kind: "category", id: categoryId, name: CAT_CLEAN });
    expect(restored.ok).toBe(true);
  });

  it("blocks deleting a category used by a product, deletes a clean one with audit", async () => {
    const [usedCategory] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.companyId, ORG_ID), eq(categories.name, CAT_USED)))
        .limit(1),
    );
    expect(usedCategory).toBeDefined();
    await createProduct(SKU_USED_CATEGORY, { categoryId: usedCategory!.id });

    const blocked = await deleteTaxonomyAction({ kind: "category", id: usedCategory!.id });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("CONFLICT");
      expect(blocked.message).toMatch(/dipakai|nonaktif/i);
    }

    const removed = await deleteTaxonomyAction({ kind: "category", id: categoryId });
    expect(removed.ok).toBe(true);
    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.companyId, ORG_ID), eq(categories.id, categoryId)))
        .limit(1),
    );
    expect(row).toBeUndefined();

    const audits = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.action, "category.delete"),
            eq(auditLog.entityId, categoryId),
          ),
        ),
    );
    expect(audits.length).toBeGreaterThan(0);

    const removedUnit = await deleteTaxonomyAction({ kind: "unit", id: unitId });
    expect(removedUnit.ok).toBe(true);
  });
});

describe("pemasok, pelanggan, gudang: edit & NOT_FOUND (GD-P1-8, P3-10)", () => {
  it("edits a supplier and rejects a ghost id with NOT_FOUND", async () => {
    const created = await saveSupplierAction({ code: SUPPLIER_CODE, name: "Pemasok Uji P18" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data!.id;

    const edited = await saveSupplierAction({ id, code: SUPPLIER_CODE, name: "Pemasok Uji P18 Revisi", phone: "0800" });
    expect(edited.ok).toBe(true);
    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(suppliers).where(and(eq(suppliers.companyId, ORG_ID), eq(suppliers.id, id))).limit(1),
    );
    expect(row?.name).toBe("Pemasok Uji P18 Revisi");

    const ghost = await saveSupplierAction({ id: GHOST_ID, code: "SUP-GHOST", name: "Pemasok Hantu" });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");

    const toggled = await toggleSupplierAction({ id, isActive: false });
    expect(toggled.ok).toBe(true);
    const ghostToggle = await toggleSupplierAction({ id: GHOST_ID, isActive: false });
    expect(ghostToggle.ok).toBe(false);
    if (!ghostToggle.ok) expect(ghostToggle.code).toBe("NOT_FOUND");
  });

  it("edits a customer and rejects a ghost id with NOT_FOUND", async () => {
    const created = await saveCustomerAction({ code: CUSTOMER_CODE, name: "Pelanggan Uji P18", creditLimit: "100000" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data!.id;

    const edited = await saveCustomerAction({ id, code: CUSTOMER_CODE, name: "Pelanggan Uji P18 Revisi", creditLimit: "250000" });
    expect(edited.ok).toBe(true);
    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(customers).where(and(eq(customers.companyId, ORG_ID), eq(customers.id, id))).limit(1),
    );
    expect(row?.name).toBe("Pelanggan Uji P18 Revisi");
    expect(Number(row?.creditLimit)).toBe(250000);

    const ghost = await saveCustomerAction({ id: GHOST_ID, code: "CUS-GHOST", name: "Pelanggan Hantu" });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");

    const toggled = await toggleCustomerAction({ id, isActive: false });
    expect(toggled.ok).toBe(true);
  });

  it("edits a warehouse and rejects a ghost id with NOT_FOUND", async () => {
    const created = await saveWarehouseAction({ code: WAREHOUSE_CODE, name: "Gudang Uji P18", type: "warehouse" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data!.id;

    const edited = await saveWarehouseAction({ id, code: WAREHOUSE_CODE, name: "Gudang Uji P18 Revisi", type: "warehouse" });
    expect(edited.ok).toBe(true);
    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(warehouses).where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.id, id))).limit(1),
    );
    expect(row?.name).toBe("Gudang Uji P18 Revisi");

    const ghost = await saveWarehouseAction({ id: GHOST_ID, code: "GDGHANTU", name: "Gudang Hantu", type: "warehouse" });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");

    const toggled = await toggleWarehouseAction({ id, isActive: false });
    expect(toggled.ok).toBe(true);
    const ghostToggle = await toggleWarehouseAction({ id: GHOST_ID, isActive: true });
    expect(ghostToggle.ok).toBe(false);
    if (!ghostToggle.ok) expect(ghostToggle.code).toBe("NOT_FOUND");
  });
});

describe("hapus master berpenjaga (GD-P1-8)", () => {
  it("blocks deleting a stocked product and a moved product, deletes a clean one", async () => {
    const warehouseId = await defaultWarehouseId();

    const stockedId = await createProduct(SKU_STOCKED);
    await withCompany(ORG_ID, async (tx) => {
      await tx.insert(stockOnHand).values({
        companyId: ORG_ID,
        warehouseId,
        productId: stockedId,
        qty: "5",
      });
    });
    const blockedStock = await deleteProductAction(stockedId);
    expect(blockedStock.ok).toBe(false);
    if (!blockedStock.ok) {
      expect(blockedStock.code).toBe("CONFLICT");
      expect(blockedStock.message).toMatch(/stok|nonaktif/i);
    }

    const movedId = await createProduct(SKU_MOVED);
    await withCompany(ORG_ID, async (tx) => {
      // Net-zero pair: the movement guard must trigger on history existing,
      // while the append-only ledger still reconciles with stock_on_hand.
      await tx.insert(stockMovements).values([
        {
          companyId: ORG_ID,
          warehouseId,
          productId: movedId,
          movementType: "opening",
          qty: "5",
          unitCost: "1000",
        },
        {
          companyId: ORG_ID,
          warehouseId,
          productId: movedId,
          movementType: "adjustment",
          qty: "-5",
          unitCost: "1000",
        },
      ]);
    });
    const blockedMovement = await deleteProductAction(movedId);
    expect(blockedMovement.ok).toBe(false);
    if (!blockedMovement.ok) expect(blockedMovement.code).toBe("CONFLICT");

    const cleanId = await createProduct(SKU_CLEAN);
    const removed = await deleteProductAction(cleanId);
    expect(removed.ok).toBe(true);
    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select({ id: products.id }).from(products).where(and(eq(products.companyId, ORG_ID), eq(products.id, cleanId))).limit(1),
    );
    expect(row).toBeUndefined();

    const ghost = await deleteProductAction(GHOST_ID);
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");
  });

  it("blocks deleting the default warehouse and a stocked warehouse, deletes a clean one", async () => {
    const defaultId = await defaultWarehouseId();
    const blockedDefault = await deleteWarehouseAction(defaultId);
    expect(blockedDefault.ok).toBe(false);
    if (!blockedDefault.ok) expect(blockedDefault.code).toBe("CONFLICT");

    const [warehouse] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.code, WAREHOUSE_CODE)))
        .limit(1),
    );
    expect(warehouse).toBeDefined();

    const [anyProduct] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.companyId, ORG_ID)).limit(1),
    );
    await withCompany(ORG_ID, async (tx) => {
      await tx.insert(stockOnHand).values({
        companyId: ORG_ID,
        warehouseId: warehouse!.id,
        productId: anyProduct!.id,
        qty: "3",
      });
    });
    const blockedStock = await deleteWarehouseAction(warehouse!.id);
    expect(blockedStock.ok).toBe(false);
    if (!blockedStock.ok) {
      expect(blockedStock.code).toBe("CONFLICT");
      expect(blockedStock.message).toMatch(/stok/i);
    }

    await withCompany(ORG_ID, async (tx) => {
      await tx
        .delete(stockOnHand)
        .where(and(eq(stockOnHand.companyId, ORG_ID), eq(stockOnHand.warehouseId, warehouse!.id)));
    });
    const removed = await deleteWarehouseAction(warehouse!.id);
    expect(removed.ok).toBe(true);
  });

  it("deletes clean supplier and customer rows", async () => {
    const [supplier] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.companyId, ORG_ID), eq(suppliers.code, SUPPLIER_CODE))).limit(1),
    );
    expect(supplier).toBeDefined();
    const removedSupplier = await deleteSupplierAction(supplier!.id);
    expect(removedSupplier.ok).toBe(true);

    const [customer] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select({ id: customers.id }).from(customers).where(and(eq(customers.companyId, ORG_ID), eq(customers.code, CUSTOMER_CODE))).limit(1),
    );
    expect(customer).toBeDefined();
    const removedCustomer = await deleteCustomerAction(customer!.id);
    expect(removedCustomer.ok).toBe(true);

    const ghost = await deleteSupplierAction(GHOST_ID);
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.code).toBe("NOT_FOUND");
  });
});
