import { PageSkeleton } from "@/components/blocks/page-skeleton";

/**
 * FIX-R2 Tahap 2 (RD2U-09): skeleton detail jurnal mengikuti lebar
 * dokumen tujuannya (max-w-3xl) — bukan skeleton daftar lebar penuh.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageSkeleton stats={0} rows={5} />
    </div>
  );
}
