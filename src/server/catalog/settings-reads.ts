/**
 * Agregat baca PENGATURAN & MASTER PLATFORM (A-26 Q5, K-04) — pecahan
 * src/server/catalog.ts: fasad settings (kontrak Q4/P-08), gudang,
 * metode pembayaran, dan data halaman pengaturan.
 * Badan kueri dipindah apa adanya.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { accountMappings, accounts, branches, paymentMethods, warehouses } from "@/db/schema";
import { getCompanySettingsRow } from "@/server/settings";
import { listCustomerGroupsWithCounts } from "./parties";

export async function getSettings(tx: Tx, companyId: string) {
  // A-26 Q4 (P-08): baca settings kini satu pintu di server/settings;
  // fungsi ini dipertahankan sebagai fasad kompatibilitas catalog.
  return getCompanySettingsRow(tx, companyId);
}

export async function listWarehouses(tx: Tx, companyId: string) {
  return tx
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      type: warehouses.type,
      isDefault: warehouses.isDefault,
    })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), eq(warehouses.isActive, true)))
    .orderBy(asc(warehouses.name));
}

/**
 * Gudang awal yang terpilih untuk form/dokumen baru (GD-P2-9): gudang dari
 * pengaturan perusahaan (`companySettings.defaultWarehouseId`) bila masih
 * aktif, lalu gudang bertanda `isDefault`, lalu gudang aktif pertama.
 * Mengembalikan "" hanya bila perusahaan belum punya gudang aktif.
 */
export function pickDefaultWarehouseId(
  warehouses: { id: string; isDefault: boolean }[],
  settingsDefaultId: string | null | undefined,
): string {
  return (
    warehouses.find((w) => w.id === settingsDefaultId)?.id ??
    warehouses.find((w) => w.isDefault)?.id ??
    warehouses[0]?.id ??
    ""
  );
}

export async function listPaymentMethods(tx: Tx, companyId: string) {
  return tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.isActive, true)))
    .orderBy(asc(paymentMethods.sortOrder));
}

export async function listWarehouseOptions(tx: Tx, companyId: string) {
  return tx
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.companyId, companyId))
    .orderBy(asc(warehouses.name));
}

export async function listBranchOptions(tx: Tx, companyId: string) {
  return tx
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId))
    .orderBy(asc(branches.name));
}

export async function getSettingsPageData(tx: Tx, companyId: string) {
  const [settingsRow, methods, groups, warehouseRows, branchRows, mappings, accountRows] =
    await Promise.all([
      getCompanySettingsRow(tx, companyId),
      tx
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.companyId, companyId))
        .orderBy(asc(paymentMethods.sortOrder)),
      listCustomerGroupsWithCounts(tx, companyId),
      tx.select().from(warehouses).where(eq(warehouses.companyId, companyId)).orderBy(asc(warehouses.name)),
      tx.select().from(branches).where(eq(branches.companyId, companyId)).orderBy(asc(branches.name)),
      tx.select().from(accountMappings).where(eq(accountMappings.companyId, companyId)),
      tx.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.code)),
    ]);
  return {
    settings: settingsRow ?? null,
    methods,
    groups,
    warehouses: warehouseRows,
    branches: branchRows,
    mappings,
    accounts: accountRows,
  };
}
