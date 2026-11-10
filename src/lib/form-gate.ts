/**
 * A-24 T1 (SIS-05) — keputusan gerbang form dokumen.
 *
 * Beberapa halaman daftar menaruh form buat dokumen di atas riwayat.
 * Form itu hanya untuk pemegang izin kelola; datanya (gudang, pemasok)
 * adalah prasyarat nyata bagi pembuat. Audit A-23 menemukan halaman
 * yang mencampur kedua kondisi menjadi satu pesan else — peran
 * lihat-saja menerima "Tambahkan gudang terlebih dahulu" padahal
 * gudang ada dan yang sebenarnya terjadi hanyalah perannya tidak
 * membuat dokumen. Fungsi ini memisahkan tiga keadaan itu agar
 * halaman tidak bisa mencampurnya lagi:
 *
 * - "form"    — boleh membuat & prasyarat cukup: tampilkan form.
 * - "missing" — boleh membuat tetapi prasyarat kurang: pesan prasyarat
 *               BENAR untuk pengguna ini (ia yang harus/bisa mengisi).
 * - "view"    — tidak boleh membuat: keadaan mode-lihat yang jujur,
 *               apa pun keadaan datanya.
 */
export type FormGateState = "form" | "missing" | "view";

export function formGateState(input: {
  canManage: boolean;
  available: number;
  minimum?: number;
}): FormGateState {
  if (!input.canManage) return "view";
  return input.available >= (input.minimum ?? 1) ? "form" : "missing";
}
