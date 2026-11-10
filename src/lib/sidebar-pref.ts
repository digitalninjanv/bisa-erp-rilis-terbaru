/**
 * Validasi UI/UX Putaran 2 (V-01) — preferensi sidebar ciut.
 *
 * Keadaan ciut/kembang sidebar modul disimpan sebagai cookie agar
 * cangkang server dapat merender lebar & mode yang benar sejak HTML
 * pertama (tanpa kedip sesudah hidrasi). Cookie ditulis komponen
 * klien `SidebarFrame` setiap pengguna menekan tombol ciut; ketiadaan
 * cookie berarti pengguna belum pernah memilih — bawaan kembang,
 * kecuali jendela sempit (diurus klien, lihat sidebar-frame.tsx).
 */
export const SIDEBAR_COLLAPSED_COOKIE = "bisa_sidebar_collapsed";

/** Nilai cookie mentah → keadaan awal. Hanya "1" yang berarti ciut. */
export function parseSidebarCollapsedCookie(
  value: string | undefined | null,
): boolean {
  return value === "1";
}
