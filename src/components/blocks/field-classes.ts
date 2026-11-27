/**
 * Gaya formulir bersama SELURUH modul — rumah netral sejak FIX-GDG
 * Tahap 4 (GDG2-07). Sebelumnya konstanta ini hidup di
 * `components/akuntansi/field-classes.ts` (FIX-R2, RD2U-12) dan gudang
 * menyalin polanya ke ≥11 berkas dengan penanda fokus lebih lemah
 * (border saja, tanpa ring). Kini satu definisi di blocks/; berkas
 * akuntansi lama menjadi re-export agar impor lama tetap bekerja.
 *
 * Pola resmi:
 * - label: mikro uppercase 10px (satu-satunya pengecualian lantai teks,
 *   sama seperti label StatCard/StatusBadge).
 * - field: h-9, teks 12px, fokus = border ring + ring tipis /20
 *   (identik dengan input SearchForm bersama).
 *
 * A-25 U0: penanda `field-label`/`field-control` adalah kait tema
 * berlingkup — di dalam `.theme-erp` aturan globals.css menaikkan
 * label menjadi 13px/500 sentence case sesuai ARAH-DESAIN-A25
 * §2.2/§2.4. Sejak A-25 U8 semua cangkang modul (termasuk POS)
 * berada di dalam lingkup itu.
 *
 * Validasi 3 (F-01): tinggi field SATU sumber — 44px di ponsel
 * (target sentuh) dan 36px di desktop lewat `lg:h-9` — di kelas ini
 * dan di komponen bersama (MoneyInput/QtyInput/PercentInput/DateField).
 * Penaikan tema .field-control yang dulu menjadi sumber kedua DIHAPUS
 * dari globals.css agar tidak ada dua tinggi yang bersaing.
 */
export const labelClass =
  "field-label block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

export const fieldClass =
  "field-control h-11 w-full rounded-md border border-input bg-background px-2.5 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60 lg:h-9";

/** Alias historis: sebagian komponen menamai gaya field-nya berbeda. */
export const inputClass = fieldClass;
export const selectClass = fieldClass;

/**
 * Validasi 3 (F-03): skala lebar field semantik. Audit mengukur field
 * sejenis berlebar liar antar-halaman (tanggal 118–195px, select
 * filter menyusut mengikuti isi) karena setiap halaman menebak
 * sendiri. Lebar mengikuti panjang isian (Baymard): pakai token ini
 * untuk field mandiri & bar filter; field di dalam grid form tetap
 * w-full mengikuti selnya.
 */
export const fieldWidths = {
  /** Tanggal tunggal (dd/mm/yyyy + ruang ketik longgar). */
  date: "w-[9.5rem]",
  /** Tiap sisi DateRangeField di bar filter. */
  dateRange: "w-36",
  /** Select filter baku di bar daftar. */
  filter: "w-44",
  /** Select filter berlabel panjang (mis. daftar akun). */
  filterWide: "w-56",
  /** Field uang mandiri di luar grid. */
  money: "w-44",
  /** Kuantitas / jam / hari pendek. */
  qty: "w-24",
  /** Kode & teks pendek. */
  short: "w-32",
} as const;
