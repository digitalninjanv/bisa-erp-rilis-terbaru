/**
 * A-24 T3 (pola G4): daftar alasan penyesuaian stok yang dapat
 * dikonfigurasi per perusahaan. Daftar hidup di
 * `company_settings.adjustment_reasons` (jsonb, null = bawaan di
 * bawah) — BUKAN daftar mati di kode: pemilik menambah/mengurangi
 * alasan di Pengaturan tanpa menyentuh program (prinsip konfigurasi
 * program). Modul ini sumber kebenaran tunggal untuk bawaan,
 * sanitasi nilai tersimpan, dan komposisi teks alasan final yang
 * masuk ke dokumen stok.
 *
 * Nilai tersimpan adalah masukan tak tepercaya bagi lapisan domain:
 * sanitasi membuang entri kosong/duplikat/terlalu panjang dan
 * membatasi jumlah, sehingga jsonb yang disunting tangan tidak bisa
 * merusak form.
 */

/** Kategori bebas: teks rincian WAJIB menyertainya. */
export const OTHER_ADJUSTMENT_REASON = "Lainnya";

/** Bawaan saat perusahaan belum mengonfigurasi daftarnya sendiri. */
export const DEFAULT_ADJUSTMENT_REASONS: readonly string[] = [
  "Rusak",
  "Kedaluwarsa",
  "Hilang",
  "Koreksi hitung",
  OTHER_ADJUSTMENT_REASON,
];

export const MAX_ADJUSTMENT_REASONS = 30;
export const MAX_ADJUSTMENT_REASON_LENGTH = 60;

/** Sanitasi nilai jsonb tersimpan → daftar bersih, atau null bila
 *  bentuknya tidak dapat dipakai sama sekali (pemanggil memakai
 *  bawaan). Daftar kosong yang VALID ([]) juga menghasilkan null —
 *  perusahaan tidak boleh mengosongkan daftar sampai form tak bisa
 *  dipakai; mengosongkan berarti "kembali ke bawaan". */
export function sanitizeAdjustmentReasons(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const clean = entry.trim().slice(0, MAX_ADJUSTMENT_REASON_LENGTH);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    result.push(clean);
    if (result.length >= MAX_ADJUSTMENT_REASONS) break;
  }
  return result.length > 0 ? result : null;
}

/** Daftar efektif perusahaan: konfigurasi tersimpan bila sah,
 *  selain itu bawaan. */
export function resolveAdjustmentReasons(value: unknown): string[] {
  return sanitizeAdjustmentReasons(value) ?? [...DEFAULT_ADJUSTMENT_REASONS];
}

/**
 * Komposisi teks alasan final yang disimpan pada dokumen stok:
 * kategori selalu terlacak, rincian bebas menyertai bila diisi
 * ("Rusak — kemasan penyok"). Untuk kategori "Lainnya", rincian
 * adalah isinya sendiri sehingga wajib ada; tanpa rincian fungsi
 * mengembalikan string kosong dan form/server menolaknya.
 */
export function composeAdjustmentReason(category: string, detail: string): string {
  const cat = category.trim();
  const det = detail.trim();
  if (!cat) return "";
  if (cat === OTHER_ADJUSTMENT_REASON) return det;
  return det ? `${cat} — ${det}` : cat;
}
