import { formatIDR, type Decimal } from "@/lib/money";

/**
 * A-22 Tahap K4 (UX-10 audit + Pola 3 riset): SATU bahasa sinyal
 * keseimbangan jurnal untuk semua permukaan — modal Catat Transaksi,
 * bilah lengket mode kartu & panel ringkasan editor jurnal manual.
 * Sebelum K4 ketiganya berfrasa sendiri-sendiri ("Belum seimbang."
 * tanpa nominal di modal; "Selisih RpX" di bilah; panel lain lagi).
 *
 * Bahasa resmi:
 * - lencana/ringkas: "Seimbang" / "Selisih RpX"
 * - kalimat:          "Seimbang" / "Belum seimbang — selisih RpX"
 * Tanda ✓ digambar komponen (ikon Check), bukan karakter di teks ini,
 * dan suffix konteks ("siap diposting", "jurnal dibuat otomatis saat
 * Posting") ditambahkan pemanggil sesudah teks kalimat.
 */

export function balanceBadgeText(balanced: boolean, difference: Decimal): string {
  return balanced ? "Seimbang" : `Selisih ${formatIDR(difference.abs())}`;
}

export function balanceSentenceText(balanced: boolean, difference: Decimal): string {
  return balanced ? "Seimbang" : `Belum seimbang — selisih ${formatIDR(difference.abs())}`;
}
