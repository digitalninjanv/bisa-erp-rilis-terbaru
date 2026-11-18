import type { CashSession, SnapshotName, SnapshotWarehouse } from "./pos-bridge";

/** Gudang default untuk register: yang berflag default, lalu yang pertama. */
export function selectDefaultWarehouseId(warehouses: SnapshotWarehouse[]): string {
  return warehouses.find((warehouse) => warehouse.isDefault)?.id ?? warehouses[0]?.id ?? "";
}

/**
 * Preferensi tampilan riwayat kasir native.
 *
 * Modul murni (tanpa invoke/Tauri) supaya bisa diuji di Vitest dan dipakai
 * ulang oleh komponen UI. Kasir harus melihat NAMAkasir, bukan potongan
 * UUID `openedBy` yang hanya bermakna bagi mesin.
 */

export const CASHIER_FALLBACK_LABEL = "Kasir terminal";

/** Indeks id pengguna → nama dari direktori snapshot terminal. */
export function buildCashierNameIndex(names: SnapshotName[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of names) {
    if (entry.id && entry.name && !index.has(entry.id)) index.set(entry.id, entry.name);
  }
  return index;
}

/** Nama kasir yang aman ditampilkan; tidak pernah membocorkan UUID pendek. */
export function displayCashierName(
  openedBy: string | null | undefined,
  index: Map<string, string>,
  fallback: string = CASHIER_FALLBACK_LABEL,
): string {
  if (!openedBy) return fallback;
  return index.get(openedBy) ?? fallback;
}

/** Pencarian riwayat: nama kasir, id shift, tanggal buka/tutup. */
export function sessionMatchesSearch(
  entry: CashSession,
  cashierName: string,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase("id-ID");
  if (!normalized) return true;
  const searchable = [
    cashierName,
    entry.id,
    entry.openedBy ?? "",
    formatShiftDate(entry.openedAt),
    entry.closedAt ? formatShiftDate(entry.closedAt) : "",
  ]
    .join(" ")
    .toLocaleLowerCase("id-ID");
  return searchable.includes(normalized);
}

/** Format tanggal shift yang konsisten di seluruh riwayat kasir. */
export function formatShiftDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
