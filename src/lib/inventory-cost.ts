import { can } from "@/lib/permissions";

/**
 * SEC-003: biaya/HPP/nilai persediaan hanya boleh terlihat oleh pemegang
 * izin `inventory.cost`. Halaman gudang yang menampilkan angka biaya
 * wajib memakai helper ini (dan menyembunyikan kolom, bukan sekadar
 * menampilkan "—", agar struktur biaya tidak bocor).
 */
export const COST_MASK = "—";

export function canSeeInventoryCost(subject: Parameters<typeof can>[0]): boolean {
  return can(subject, "inventory.cost");
}

export function maskCost(value: string, canSee: boolean): string {
  return canSee ? value : COST_MASK;
}
