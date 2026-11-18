import { withCompany } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import type { OfflineSalePayload, OfflineSyncItemResult } from "@/lib/pos-offline";
import {
  resolveOriginEntitlement,
  type OriginEntitlement,
} from "@/server/member-permissions";
import { assertOfflineEnabled, processOfflineSaleItem } from "./offline";
import type { PosDeviceIdentity } from "./device-contract";

async function resolveEntitlements(
  companyId: string,
  cashierIds: Array<string | null | undefined>,
): Promise<Record<string, OriginEntitlement | null>> {
  const unique = [...new Set(cashierIds.filter((id): id is string => Boolean(id)))];
  const result: Record<string, OriginEntitlement | null> = {};
  for (const cashierId of unique) {
    result[cashierId] = await resolveOriginEntitlement(companyId, cashierId);
  }
  return result;
}

/** Jalankan setiap penjualan offline melalui jalur domain yang sama
 * dengan POS web, dengan hak kasir asal tetap dinilai per transaksi. */
export async function syncPosDeviceItems(
  device: PosDeviceIdentity,
  items: OfflineSalePayload[],
): Promise<OfflineSyncItemResult[]> {
  await withCompany(device.companyId, (tx) =>
    assertOfflineEnabled(tx, device.companyId),
  );
  const originEntitlements = await resolveEntitlements(
    device.companyId,
    items.map((item) => item.cashierId),
  );
  const actorEntitlement = await resolveOriginEntitlement(device.companyId, device.userId);
  if (!actorEntitlement?.canSell) {
    throw new AppError(
      "FORBIDDEN",
      "Perangkat POS tidak memiliki izin penjualan (pos.sell). Hubungi administrator.",
    );
  }
  const results: OfflineSyncItemResult[] = [];
  for (const item of items) {
    const result = await withCompany(device.companyId, (tx) =>
      processOfflineSaleItem(tx, {
        companyId: device.companyId,
        userId: device.userId,
        canDiscount: actorEntitlement.canDiscount,
        originEntitlements,
        item,
      }),
    );
    results.push(result);
  }
  return results;
}
