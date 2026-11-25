import { AppError } from "@/lib/errors";

export const POS_DEVICE_SNAPSHOT_MAX_PRODUCTS = 20_000;

export function assertPosDeviceSnapshotComplete(productCount: number, hasMore: boolean): void {
  if (productCount >= POS_DEVICE_SNAPSHOT_MAX_PRODUCTS && hasMore) {
    throw new AppError(
      "VALIDATION",
      "Katalog terminal melebihi batas snapshot 20.000 produk. Snapshot penuh tidak dibuat agar perangkat tidak memakai katalog yang terpotong.",
    );
  }
}
