import { Check } from "lucide-react";
import { balanceBadgeText, balanceSentenceText } from "@/lib/balance-status";
import type { Decimal } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A-22 Tahap K4 (UX-10 audit + Pola 3 riset): komponen SATU-SATUNYA
 * untuk sinyal keseimbangan jurnal — dipakai bilah lengket & panel
 * editor jurnal manual dan pratinjau modal Catat Transaksi, dengan
 * bahasa dari lib/balance-status. Warna nada tetap urusan pemanggil
 * (className), komponen ini hanya menyatukan kata & tanda ✓.
 */
export function BalanceIndicator({
  balanced,
  difference,
  variant = "badge",
  suffix,
  className,
}: {
  balanced: boolean;
  difference: Decimal;
  variant?: "badge" | "sentence";
  /** Kelanjutan kalimat sesudah "Seimbang ✓" pada keadaan seimbang,
   * mis. "siap diposting" atau "jurnal dibuat otomatis saat Posting." */
  suffix?: string;
  className?: string;
}) {
  const text =
    variant === "badge"
      ? balanceBadgeText(balanced, difference)
      : balanceSentenceText(balanced, difference);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {text}
      {balanced ? <Check className="size-3.5" aria-hidden /> : null}
      {balanced && suffix ? <> — {suffix}</> : null}
    </span>
  );
}
