export const dynamic = "force-dynamic";

/**
 * A-24 T2 (Opsi A): segmen /app/akuntansi kini menaungi DUA modul
 * cangkang — Akuntansi dan HR — lewat route group yang tidak mengubah
 * URL satu pun:
 *
 * - `(akuntansi)/layout.tsx` — cangkang Akuntansi untuk rute keuangan.
 * - `(hr)/layout.tsx` — cangkang HR untuk rute payroll/karyawan/dll.
 *
 * Layout segmen ini sendiri sengaja hanya meneruskan children:
 * penjaga modul & cangkangnya hidup di layout grup masing-masing,
 * supaya halaman HR tidak lagi mewarisi sidebar akuntansi.
 */
export default function AkuntansiSegmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
