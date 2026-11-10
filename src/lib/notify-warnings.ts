import { toast } from "sonner";

/**
 * FIX-R2 Tahap 3 (RV2-01/AK3-11): tampilkan peringatan penjaga saldo
 * kas/bank (kebijakan perusahaan mode "warn") yang dikembalikan aksi
 * server. Durasi panjang & tipe warning agar tidak tenggelam oleh
 * toast sukses dan tidak hilang sebelum dibaca — peringatan saldo
 * negatif yang terlewat sama saja dengan tidak ada peringatan.
 */
export function showPostingWarnings(warnings?: string[] | null): void {
  for (const warning of warnings ?? []) {
    toast.warning(warning, { duration: 15000 });
  }
}
