import { PageSkeleton } from "@/components/blocks/page-skeleton";

/**
 * FIX-R2 Tahap 2 (RD2U-09): skeleton formulir jurnal — tanpa baris
 * kartu statistik, karena halaman tujuannya formulir, bukan daftar.
 * Sebelumnya satu PageSkeleton generik melayani semua halaman
 * akuntansi sehingga tata letak melompat sesaat sebelum muat.
 */
export default function Loading() {
  return <PageSkeleton stats={0} rows={6} />;
}
